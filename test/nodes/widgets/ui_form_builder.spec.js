const helper = require('node-red-node-test-helper')
const should = require('should') // eslint-disable-line no-unused-vars

const datastore = require('../../../nodes/store/data.js')
const statestore = require('../../../nodes/store/state.js')
const { testData1 } = require('../fixtures/index.js')
const { verifyFlowLoaded } = require('../utils.js')
const testFlow1 = testData1.flows
const nodeImports = testData1.getImports(null, ['ui_form_builder'])

helper.init(require.resolve('node-red'))

describe('ui-form-builder node', function () {
    beforeEach(function (done) { helper.startServer(done) })
    afterEach(function (done) {
        helper.unload()
        helper.stopServer(done)
    })

    const flow = [
        {
            id: 'node-ui-form-builder',
            type: 'ui-form-builder',
            z: 'tab-id',
            group: 'config-ui-group',
            name: 'fb',
            label: 'Order',
            schema: JSON.stringify([{ type: 'text', key: 'item', label: 'Item' }, { type: 'number', key: 'qty', label: 'Qty', default: '{{defaultQty}}' }]),
            templates: JSON.stringify([{ name: 'coffee', values: { item: '{{product}}', qty: 2 }, vars: { product: 'Coffee' } }]),
            vars: '{"defaultQty": 1}',
            outputTemplate: '{"order":"{{item}} x{{qty}}","qty":"{{qty}}"}',
            allowEdit: true,
            allowTemplates: true,
            wires: [['helper-node']]
        },
        { id: 'helper-node', type: 'helper', z: 'tab-id' },
        ...testFlow1
    ]

    it('should be loaded and registered', async function () {
        await helper.load(nodeImports, flow)
        verifyFlowLoaded(helper, flow)
        const base = helper.getNode('config-ui-base')
        base.ui.widgets.has('node-ui-form-builder').should.be.true()
    })

    it('should load a template and substitute variables', async function () {
        await helper.load(nodeImports, flow)
        const n = helper.getNode('node-ui-form-builder')
        const msg = { action: 'loadTemplate', template: 'coffee' }
        n.receive(msg)
        await new Promise(resolve => setTimeout(resolve, 50))
        // the msg forwarded to the dashboard clients carries the substituted values
        msg.payload.should.eql({ item: 'Coffee', qty: 2 })
        msg.ui_update.currentTemplate.should.equal('coffee')
        statestore.getProperty('node-ui-form-builder', 'currentTemplate').should.equal('coffee')
    })

    it('should save, list and delete templates via msg', async function () {
        await helper.load(nodeImports, flow)
        const n = helper.getNode('node-ui-form-builder')
        const h = helper.getNode('helper-node')
        n.receive({ action: 'saveTemplate', template: 'tea', payload: { item: 'Tea', qty: 1 } })
        await new Promise(resolve => setTimeout(resolve, 20))
        const listed = new Promise(resolve => h.once('input', resolve))
        n.receive({ action: 'listTemplates' })
        const msg = await listed
        msg.payload.should.containEql('tea').and.containEql('coffee')
        n.context().get('formBuilder').templates.length.should.equal(2)
        n.receive({ action: 'deleteTemplate', template: 'tea' })
        await new Promise(resolve => setTimeout(resolve, 20))
        n.context().get('formBuilder').templates.map(t => t.name).should.eql(['coffee'])
    })

    it('should render the output template on submit', async function () {
        await helper.load(nodeImports, flow)
        const base = helper.getNode('config-ui-base')
        const widget = base.ui.widgets.get('node-ui-form-builder')
        const msg = await widget.hooks.beforeSend({ _event: 'submit', payload: { item: 'Milk', qty: '3' } })
        msg.payload.should.eql({ order: 'Milk x3', qty: 3 })
        msg.values.should.eql({ item: 'Milk', qty: 3 })
    })

    it('should handle dashboard socket operations', async function () {
        await helper.load(nodeImports, flow)
        const n = helper.getNode('node-ui-form-builder')
        const base = helper.getNode('config-ui-base')
        base.emit = () => {}
        const widget = base.ui.widgets.get('node-ui-form-builder')
        const handler = widget.hooks.onSocket['ui-form-builder-op:node-ui-form-builder']
        const conn = { emit: () => {} }
        handler(conn, 'node-ui-form-builder', { action: 'setSchema', schema: [{ key: 'only', type: 'text' }] })
        n.context().get('formBuilder').schema.map(f => f.key).should.eql(['only'])
        let err = null
        handler({ emit: (e, m) => { err = m } }, 'node-ui-form-builder', { action: 'setSchema', schema: [{ key: 'a' }, { key: 'a' }] })
        should.exist(err)
    })

    it('should keep loaded template values (incl. select) for reload/restore', async function () {
        const selFlow = JSON.parse(JSON.stringify(flow))
        const s = JSON.parse(selFlow[0].schema)
        s.push({ type: 'select', key: 'product', label: 'Product', options: [{ label: 'Coffee', value: 'coffee' }, { label: 'Tea', value: 'tea' }] })
        selFlow[0].schema = JSON.stringify(s)
        selFlow[0].templates = JSON.stringify([{ name: 'coffee', values: { item: '{{p}}', qty: 2, product: 'tea' }, vars: { p: 'Coffee' } }])
        await helper.load(nodeImports, selFlow)
        const n = helper.getNode('node-ui-form-builder')
        n.receive({ action: 'loadTemplate', template: 'coffee' })
        await new Promise(resolve => setTimeout(resolve, 50))
        const expected = { item: 'Coffee', qty: 2, product: 'tea' }
        datastore.get('node-ui-form-builder').payload.should.eql(expected)
        n.context().get('formBuilder').values.should.eql(expected)
    })

    it('should store values after a dashboard loadTemplate op', async function () {
        await helper.load(nodeImports, flow)
        const n = helper.getNode('node-ui-form-builder')
        const base = helper.getNode('config-ui-base')
        base.emit = () => {}
        const widget = base.ui.widgets.get('node-ui-form-builder')
        widget.hooks.onSocket['ui-form-builder-op:node-ui-form-builder']({ emit: () => {} }, 'node-ui-form-builder', { action: 'loadTemplate', name: 'coffee' })
        datastore.get('node-ui-form-builder').payload.should.eql({ item: 'Coffee', qty: 2 })
        n.context().get('formBuilder').current.should.equal('coffee')
    })

    it('should validate conditional / computed fields server-side on submit', async function () {
        const logicFlow = flow.map(n => n.id === 'node-ui-form-builder'
            ? Object.assign({}, n, {
                outputTemplate: '',
                schema: JSON.stringify([
                    { key: 'qty', type: 'number', required: true },
                    { key: 'price', type: 'number' },
                    { key: 'total', type: 'computed', formula: '{{qty}} * {{price}}' },
                    { key: 'delivery', type: 'select', options: [{ label: 'yes', value: 'yes' }, { label: 'no', value: 'no' }] },
                    { key: 'address', type: 'text', visibleIf: { rules: [{ field: 'delivery', op: 'eq', value: 'yes' }] }, requiredIf: { rules: [{ field: 'delivery', op: 'eq', value: 'yes' }] } }
                ])
            })
            : n)
        await helper.load(nodeImports, logicFlow)
        const base = helper.getNode('config-ui-base')
        const widget = base.ui.widgets.get('node-ui-form-builder')
        let msg = await widget.hooks.beforeSend({ _event: 'submit', payload: { qty: '2', price: '5', total: 1e6, delivery: 'no', address: 'hidden st' } })
        msg.payload.should.eql({ qty: 2, price: 5, total: 10, delivery: 'no' })
        msg.hidden.should.eql(['address'])
        should.not.exist(msg.errors)
        msg = await widget.hooks.beforeSend({ _event: 'submit', payload: { qty: 2, price: 5, delivery: 'yes' } })
        msg.errors.should.have.property('address')
    })

    it('should reject a schema with a circular formula', async function () {
        await helper.load(nodeImports, flow)
        const base = helper.getNode('config-ui-base')
        base.emit = () => {}
        const widget = base.ui.widgets.get('node-ui-form-builder')
        let err = null
        widget.hooks.onSocket['ui-form-builder-op:node-ui-form-builder']({ emit: (e, m) => { err = m } }, 'node-ui-form-builder', {
            action: 'setSchema', schema: [{ key: 'a', type: 'computed', formula: '{{b}}' }, { key: 'b', type: 'computed', formula: '{{a}}' }]
        })
        String(err).should.match(/circular dependency/)
    })
})
