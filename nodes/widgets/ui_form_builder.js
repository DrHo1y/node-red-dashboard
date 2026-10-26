const datastore = require('../store/data.js')
const statestore = require('../store/state.js')
const { getTopic } = require('../utils/index.js')
const T = require('../utils/templater.js')

/**
 * ui-form-builder
 * A form whose schema is built visually, with named, reusable templates and {{variable}} substitution.
 *
 * Persistence: templates and runtime schema changes are stored in the node context
 * (key "formBuilder"), using the context store selected in the node config. Choose a
 * persistent store (e.g. localfilesystem) in settings.js to survive Node-RED restarts.
 * Templates defined in the node config are seeds: they are merged in on start and
 * templates saved at runtime with the same name take precedence.
 */
module.exports = function (RED) {
    function FormBuilderNode (config) {
        RED.nodes.createNode(this, config)
        const node = this

        const group = RED.nodes.getNode(config.group)
        if (!group) { return }
        const base = group.getBase()

        const store = config.contextStore || undefined
        const ctxKey = 'formBuilder'
        const ctx = node.context()

        function parseJSON (v, fallback) {
            if (typeof v !== 'string') { return v ?? fallback }
            try { return JSON.parse(v) } catch (_e) { return fallback }
        }

        const seedSchema = T.normalizeSchema(parseJSON(config.schema, []))
        const seedTemplates = (parseJSON(config.templates, []) || []).reduce((list, t) => {
            try { return T.upsertTemplate(list, t) } catch (_e) { return list }
        }, [])
        const vars = parseJSON(config.vars, {}) || {}

        let saved = {}
        try { saved = ctx.get(ctxKey, store) || {} } catch (_e) { saved = {} }
        const data = {
            schema: Array.isArray(saved.schema) ? saved.schema : seedSchema,
            templates: (saved.templates || []).reduce((list, t) => T.upsertTemplate(list, t), seedTemplates),
            current: saved.current || null,
            values: (saved.values && typeof saved.values === 'object') ? saved.values : null
        }

        // keep the latest form values in the datastore so a page reload restores them
        function storeValues (values) {
            if (!values || typeof values !== 'object' || Array.isArray(values)) { return }
            data.values = values
            try { datastore.save(base, node, { payload: values }) } catch (err) { node.warn(err.message) }
        }

        function persist () {
            try { ctx.set(ctxKey, data, store) } catch (err) { node.warn(err.message) }
        }

        function publish (msg) {
            statestore.set(base, node, msg, 'schema', data.schema)
            statestore.set(base, node, msg, 'templates', data.templates)
            statestore.set(base, node, msg, 'currentTemplate', data.current)
        }

        function broadcast (extra) {
            const out = Object.assign({ ui_update: { schema: data.schema, templates: data.templates, currentTemplate: data.current } }, extra || {})
            base.emit('msg-input:' + node.id, out, node)
        }

        function setStatus () {
            node.status({ fill: 'blue', shape: 'dot', text: `${data.schema.length} fields, ${data.templates.length} templates` })
        }

        /**
         * Applies an operation; shared by msg input and the dashboard editor.
         * returns { values?, error? }
         */
        function applyOp (op) {
            const action = op.action
            switch (action) {
            case 'setSchema': {
                const schema = T.normalizeSchema(op.schema)
                const errors = T.validateSchema(schema)
                if (errors.length) { return { error: errors.join('; ') } }
                data.schema = schema
                return {}
            }
            case 'saveTemplate': {
                const tpl = op.template || {}
                const t = T.sanitizeTemplate({
                    name: tpl.name,
                    values: tpl.values || {},
                    vars: tpl.vars,
                    description: tpl.description,
                    schema: tpl.includeSchema === false ? undefined : (tpl.schema || data.schema)
                })
                data.templates = T.upsertTemplate(data.templates, t)
                data.current = t.name
                return { template: t }
            }
            case 'loadTemplate': {
                const t = T.findTemplate(data.templates, op.name)
                if (!t) { return { error: `template "${op.name}" not found` } }
                if (Array.isArray(t.schema)) { data.schema = t.schema }
                data.current = t.name
                const tvars = Object.assign({}, vars, t.vars, op.vars)
                const values = Object.assign(T.defaultValues(data.schema, tvars), T.render(t.values, tvars), op.values || {})
                return { values, template: t }
            }
            case 'duplicateTemplate':
                data.templates = T.duplicateTemplate(data.templates, op.name, op.newName)
                return {}
            case 'deleteTemplate':
                data.templates = T.removeTemplate(data.templates, op.name)
                if (data.current === op.name) { data.current = null }
                return {}
            case 'listTemplates':
                return {}
            default:
                return { error: `unknown action "${action}"` }
            }
        }

        const evts = {
            onAction: true,
            onInput: async function (msg, send) {
                // msg.action drives template operations, everything else sets values
                const action = msg.action
                let result = {}
                if (action) {
                    try {
                        result = applyOp({
                            action,
                            name: msg.template?.name ?? msg.template ?? msg.name,
                            newName: msg.newName,
                            schema: msg.schema ?? msg.payload,
                            vars: msg.vars,
                            template: typeof msg.template === 'object' ? msg.template : { name: msg.template ?? msg.name, values: msg.payload, vars: msg.vars }
                        })
                    } catch (err) { result = { error: err.message } }
                    if (result.error) {
                        node.error(result.error, msg)
                    } else {
                        persist()
                        publish(msg)
                    }
                    if (result.values) { msg.payload = result.values; storeValues(result.values); persist() }
                    msg.ui_update = Object.assign({}, msg.ui_update, { schema: data.schema, templates: data.templates, currentTemplate: data.current })
                    if (action === 'listTemplates') {
                        send({ topic: msg.topic, action, payload: data.templates.map(t => t.name), templates: data.templates })
                    }
                } else if (msg.schema) {
                    const r = applyOp({ action: 'setSchema', schema: msg.schema })
                    if (r.error) { node.error(r.error, msg) } else { persist(); publish(msg) }
                    msg.ui_update = Object.assign({}, msg.ui_update, { schema: data.schema })
                }
                // set values: substitute {{vars}} given in msg.vars
                if (msg.payload && typeof msg.payload === 'object' && !Array.isArray(msg.payload) && msg.vars) {
                    msg.payload = T.render(msg.payload, Object.assign({}, vars, msg.vars))
                }
                if (!action && msg.payload && typeof msg.payload === 'object' && !Array.isArray(msg.payload)) {
                    storeValues(msg.payload)
                    persist()
                }
                setStatus()
            },
            beforeSend: async function (msg) {
                if (msg?._event === 'submit') {
                    const values = T.coerceValues(data.schema, msg.payload || {})
                    const errors = T.validateValues(data.schema, values)
                    if (Object.keys(errors).length) {
                        msg.errors = errors
                    }
                    const tpl = data.current ? T.findTemplate(data.templates, data.current) : null
                    const tvars = Object.assign({}, vars, tpl?.vars)
                    msg.values = values
                    if (!config.resetOnSubmit) { storeValues(values); persist() }
                    msg.template = data.current
                    msg.payload = T.buildOutput(config.outputTemplate, values, tvars)
                    delete msg._event
                    if (config.topic || config.topicType) {
                        msg.topic = (await getTopic(RED, config, node, msg)) ?? ''
                    }
                }
                return msg
            },
            onSocket: {
                ['ui-form-builder-op:' + node.id]: function (conn, id, op) {
                    if (id !== node.id || !op) { return }
                    if (!config.allowEdit && ['setSchema'].includes(op.action)) { return }
                    if (!config.allowTemplates && ['saveTemplate', 'deleteTemplate', 'duplicateTemplate'].includes(op.action)) { return }
                    let result
                    try { result = applyOp(op) } catch (err) { result = { error: err.message } }
                    if (result.error) {
                        conn.emit('ui-form-builder-error:' + node.id, result.error)
                        return
                    }
                    if (result.values) { storeValues(result.values) }
                    persist()
                    publish(null)
                    setStatus()
                    broadcast(result.values ? { payload: result.values } : null)
                }
            }
        }

        publish(null)
        setStatus()
        group.register(node, config, evts)
        if (data.values) { storeValues(data.values) }
    }
    RED.nodes.registerType('ui-form-builder', FormBuilderNode)
}
