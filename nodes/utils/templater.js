/**
 * Form templater helpers shared by the ui-form-builder runtime node.
 * NOTE: keep in sync with ui/src/widgets/ui-form-builder/templater.mjs (a test checks parity).
 */
const FIELD_TYPES = ['text', 'textarea', 'number', 'email', 'password', 'select', 'radio', 'checkbox', 'switch', 'date', 'time', 'color']
const PLACEHOLDER = /\{\{\s*([\w$.-]+)\s*\}\}/g
const EXACT_PLACEHOLDER = /^\{\{\s*([\w$.-]+)\s*\}\}$/

function isObject (v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function getPath (obj, path) {
    if (!obj || typeof path !== 'string') { return undefined }
    return path.split('.').reduce((acc, part) => (acc === null || acc === undefined) ? undefined : acc[part], obj)
}

/** replace {{var}} placeholders in a string, unknown variables are left untouched */
function interpolate (str, ctx) {
    if (typeof str !== 'string') { return str }
    return str.replace(PLACEHOLDER, (match, path) => {
        const v = getPath(ctx, path)
        if (v === undefined || v === null) { return match }
        return typeof v === 'object' ? JSON.stringify(v) : String(v)
    })
}

/** deep render: strings that are exactly "{{var}}" keep the raw (typed) value */
function render (value, ctx) {
    if (typeof value === 'string') {
        const exact = value.match(EXACT_PLACEHOLDER)
        if (exact) {
            const v = getPath(ctx, exact[1])
            return v === undefined ? value : v
        }
        return interpolate(value, ctx)
    }
    if (Array.isArray(value)) { return value.map(v => render(v, ctx)) }
    if (isObject(value)) {
        const out = {}
        for (const k of Object.keys(value)) { out[interpolate(k, ctx)] = render(value[k], ctx) }
        return out
    }
    return value
}

/** list the variable names used in a string / object */
function extractVariables (value, found = new Set()) {
    if (typeof value === 'string') {
        let m
        const re = new RegExp(PLACEHOLDER.source, 'g')
        while ((m = re.exec(value)) !== null) { found.add(m[1]) }
    } else if (Array.isArray(value)) {
        value.forEach(v => extractVariables(v, found))
    } else if (isObject(value)) {
        Object.keys(value).forEach(k => { extractVariables(k, found); extractVariables(value[k], found) })
    }
    return Array.from(found)
}

function normalizeField (field, index = 0) {
    const f = Object.assign({}, field || {})
    f.type = FIELD_TYPES.includes(f.type) ? f.type : 'text'
    f.key = (typeof f.key === 'string' && f.key.trim()) ? f.key.trim() : `field${index + 1}`
    f.label = typeof f.label === 'string' ? f.label : f.key
    f.required = !!f.required
    if (f.type === 'select' || f.type === 'radio') {
        f.options = Array.isArray(f.options)
            ? f.options.map(o => isObject(o) ? { label: String(o.label ?? o.value), value: o.value } : { label: String(o), value: o })
            : []
    }
    if (f.cols !== undefined) {
        const c = parseInt(f.cols)
        f.cols = Number.isNaN(c) ? 12 : Math.min(12, Math.max(1, c))
    }
    return f
}

function normalizeSchema (schema) {
    if (!Array.isArray(schema)) { return [] }
    return schema.map((f, i) => normalizeField(f, i))
}

/** returns a list of human readable problems with a schema (empty when valid) */
function validateSchema (schema) {
    const errors = []
    if (!Array.isArray(schema)) { return ['schema must be an array of fields'] }
    const keys = new Set()
    schema.forEach((f, i) => {
        if (!f || typeof f.key !== 'string' || !f.key.trim()) {
            errors.push(`field #${i + 1}: key is required`)
            return
        }
        if (!/^[A-Za-z_$][\w$-]*$/.test(f.key)) { errors.push(`field "${f.key}": key must be a valid variable name`) }
        if (keys.has(f.key)) { errors.push(`field "${f.key}": duplicate key`) }
        keys.add(f.key)
        if (f.type && !FIELD_TYPES.includes(f.type)) { errors.push(`field "${f.key}": unknown type "${f.type}"`) }
        if ((f.type === 'select' || f.type === 'radio') && (!Array.isArray(f.options) || f.options.length === 0)) {
            errors.push(`field "${f.key}": options are required`)
        }
    })
    return errors
}

/** default values for a schema, defaults may use {{var}} placeholders resolved from ctx */
function defaultValues (schema, ctx = {}) {
    const values = {}
    normalizeSchema(schema).forEach(f => {
        let v = f.default
        if (typeof v === 'string') { v = render(v, ctx) }
        values[f.key] = coerce(f, v)
    })
    return values
}

function isEmpty (v) {
    return v === undefined || v === null || v === '' || (typeof v === 'number' && Number.isNaN(v))
}

/** converts a raw value into the type expected by the field */
function coerce (field, v) {
    switch (field.type) {
    case 'checkbox':
    case 'switch':
        if (typeof v === 'string') { return v === 'true' || v === '1' || v === 'on' }
        return !!v
    case 'number': {
        if (isEmpty(v)) { return null }
        const n = Number(v)
        return Number.isNaN(n) ? null : n
    }
    default:
        return isEmpty(v) ? '' : v
    }
}

function coerceValues (schema, values) {
    const out = {}
    normalizeSchema(schema).forEach(f => { out[f.key] = coerce(f, values ? values[f.key] : undefined) })
    return out
}

/** returns { key: message } for every invalid value */
function validateValues (schema, values) {
    const errors = {}
    normalizeSchema(schema).forEach(f => {
        const v = values ? values[f.key] : undefined
        const label = f.label || f.key
        if (f.required && (isEmpty(v) || ((f.type === 'checkbox' || f.type === 'switch') && v !== true))) {
            errors[f.key] = `${label} is required`
            return
        }
        if (isEmpty(v)) { return }
        if (f.type === 'number') {
            const n = Number(v)
            if (Number.isNaN(n)) { errors[f.key] = `${label} must be a number`; return }
            if (!isEmpty(f.min) && n < Number(f.min)) { errors[f.key] = `${label} must be >= ${f.min}`; return }
            if (!isEmpty(f.max) && n > Number(f.max)) { errors[f.key] = `${label} must be <= ${f.max}`; return }
        }
        if (typeof v === 'string') {
            if (!isEmpty(f.minLength) && v.length < Number(f.minLength)) { errors[f.key] = `${label} must be at least ${f.minLength} characters`; return }
            if (!isEmpty(f.maxLength) && v.length > Number(f.maxLength)) { errors[f.key] = `${label} must be at most ${f.maxLength} characters`; return }
            if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { errors[f.key] = `${label} must be a valid e-mail`; return }
            if (f.pattern) {
                let re = null
                try { re = new RegExp(f.pattern) } catch (_e) { re = null }
                if (re && !re.test(v)) { errors[f.key] = f.patternMessage || `${label} has an invalid format` }
            }
        }
    })
    return errors
}

/** builds the output payload: the values object, or the rendered output template */
function buildOutput (outputTemplate, values, vars = {}) {
    const ctx = Object.assign({}, vars, values)
    if (outputTemplate === undefined || outputTemplate === null || outputTemplate === '') { return Object.assign({}, values) }
    let tpl = outputTemplate
    if (typeof tpl === 'string') {
        try { tpl = JSON.parse(tpl) } catch (_e) { return interpolate(tpl, ctx) }
    }
    return render(tpl, ctx)
}

/* ---------- template collection helpers (immutable) ---------- */

function sanitizeTemplate (tpl) {
    if (!isObject(tpl) || typeof tpl.name !== 'string' || !tpl.name.trim()) { throw new Error('template must have a name') }
    const out = { name: tpl.name.trim(), values: isObject(tpl.values) ? tpl.values : {} }
    if (Array.isArray(tpl.schema)) { out.schema = normalizeSchema(tpl.schema) }
    if (isObject(tpl.vars)) { out.vars = tpl.vars }
    if (typeof tpl.description === 'string') { out.description = tpl.description }
    out.updated = tpl.updated || new Date().toISOString()
    return out
}

function upsertTemplate (list, tpl) {
    const t = sanitizeTemplate(tpl)
    const out = (Array.isArray(list) ? list : []).filter(x => x && x.name !== t.name)
    out.push(t)
    return out
}

function removeTemplate (list, name) {
    return (Array.isArray(list) ? list : []).filter(x => x && x.name !== name)
}

function findTemplate (list, name) {
    return (Array.isArray(list) ? list : []).find(x => x && x.name === name)
}

function duplicateTemplate (list, name, newName) {
    const src = findTemplate(list, name)
    if (!src) { throw new Error(`template "${name}" not found`) }
    let target = newName
    if (!target) {
        let i = 1
        do { target = `${name} (${i++})` } while (findTemplate(list, target))
    }
    return upsertTemplate(list, Object.assign(JSON.parse(JSON.stringify(src)), { name: target, updated: undefined }))
}

module.exports = {
    FIELD_TYPES,
    getPath,
    interpolate,
    render,
    extractVariables,
    normalizeField,
    normalizeSchema,
    validateSchema,
    defaultValues,
    coerce,
    coerceValues,
    validateValues,
    buildOutput,
    sanitizeTemplate,
    upsertTemplate,
    removeTemplate,
    findTemplate,
    duplicateTemplate
}
