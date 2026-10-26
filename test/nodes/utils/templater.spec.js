const fs = require('fs')
const path = require('path')

const should = require('should') // eslint-disable-line no-unused-vars

const T = require('../../../nodes/utils/templater.js')

describe('form templater', function () {
    describe('interpolate / render', function () {
        it('replaces placeholders including nested paths', function () {
            T.interpolate('Hi {{ name }} from {{city.name}}', { name: 'Ann', city: { name: 'Krasnoyarsk' } })
                .should.equal('Hi Ann from Krasnoyarsk')
        })
        it('leaves unknown variables untouched', function () {
            T.interpolate('{{a}} {{b}}', { a: 1 }).should.equal('1 {{b}}')
        })
        it('keeps value types for exact placeholders', function () {
            T.render({ qty: '{{qty}}', ok: '{{ok}}', text: 'n={{qty}}', list: ['{{qty}}'] }, { qty: 3, ok: true })
                .should.eql({ qty: 3, ok: true, text: 'n=3', list: [3] })
        })
        it('extracts variables', function () {
            T.extractVariables({ a: '{{x}} {{y.z}}', b: ['{{x}}'] }).should.eql(['x', 'y.z'])
        })
    })

    describe('schema', function () {
        it('normalizes fields', function () {
            const s = T.normalizeSchema([{ type: 'bogus' }, { type: 'select', key: 'k', options: ['a', { label: 'B', value: 2 }] }])
            s[0].should.have.properties({ type: 'text', key: 'field1' })
            s[1].options.should.eql([{ label: 'a', value: 'a' }, { label: 'B', value: 2 }])
        })
        it('reports invalid schema', function () {
            T.validateSchema([{ key: 'a' }, { key: 'a' }, { key: '1x' }, { key: 's', type: 'select' }]).length.should.equal(3)
            T.validateSchema([{ key: 'a', type: 'text' }]).should.eql([])
        })
        it('computes typed defaults with variables', function () {
            T.defaultValues([
                { key: 'n', type: 'number', default: '{{count}}' },
                { key: 'c', type: 'checkbox', default: 'true' },
                { key: 't', default: 'Hello {{who}}' }
            ], { count: 5, who: 'Bob' }).should.eql({ n: 5, c: true, t: 'Hello Bob' })
        })
    })

    describe('validation', function () {
        const schema = [
            { key: 'name', required: true, label: 'Name' },
            { key: 'age', type: 'number', min: 18, max: 99 },
            { key: 'mail', type: 'email' },
            { key: 'code', pattern: '^[A-Z]{3}$', patternMessage: 'bad code' }
        ]
        it('accepts valid values', function () {
            T.validateValues(schema, { name: 'x', age: 20, mail: 'a@b.cd', code: 'ABC' }).should.eql({})
        })
        it('returns errors per key', function () {
            const e = T.validateValues(schema, { name: '', age: 10, mail: 'nope', code: 'abc' })
            e.should.have.keys('name', 'age', 'mail', 'code')
            e.code.should.equal('bad code')
        })
    })

    describe('output', function () {
        it('returns values when no template', function () {
            T.buildOutput('', { a: 1 }).should.eql({ a: 1 })
        })
        it('renders a JSON output template', function () {
            T.buildOutput('{"order":{"who":"{{name}}","qty":"{{qty}}","note":"{{prefix}}-{{qty}}"}}', { name: 'Ann', qty: 2 }, { prefix: 'PO' })
                .should.eql({ order: { who: 'Ann', qty: 2, note: 'PO-2' } })
        })
        it('renders a plain string template', function () {
            T.buildOutput('Hello {{name}}', { name: 'Ann' }).should.equal('Hello Ann')
        })
    })

    describe('templates collection', function () {
        it('upserts, finds, duplicates and removes', function () {
            let list = T.upsertTemplate([], { name: 'a', values: { x: 1 } })
            list = T.upsertTemplate(list, { name: 'a', values: { x: 2 } })
            list.length.should.equal(1)
            T.findTemplate(list, 'a').values.x.should.equal(2)
            list = T.duplicateTemplate(list, 'a')
            list.map(t => t.name).should.eql(['a', 'a (1)'])
            list = T.removeTemplate(list, 'a')
            list.map(t => t.name).should.eql(['a (1)'])
        })
        it('rejects templates without a name', function () {
            (() => T.upsertTemplate([], { values: {} })).should.throw()
        })
    })

    it('client ESM copy exports the same API', async function () {
        const file = path.join(__dirname, '../../../ui/src/widgets/ui-form-builder/templater.mjs')
        fs.existsSync(file).should.be.true()
        const esm = await import(file)
        Object.keys(T).forEach(k => should.exist(esm[k], k))
        esm.buildOutput('{"q":"{{q}}"}', { q: 1 }).should.eql({ q: 1 })
    })
})
