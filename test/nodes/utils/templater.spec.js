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

    describe('conditional rules', function () {
        const v = { delivery: 'yes', total: 120, tags: 'a,b', empty: '', flag: true }
        it('evaluates every operator', function () {
            T.evaluateRule({ field: 'delivery', op: 'eq', value: 'yes' }, v).should.be.true()
            T.evaluateRule({ field: 'delivery', op: 'neq', value: 'yes' }, v).should.be.false()
            T.evaluateRule({ field: 'total', op: 'gt', value: '100' }, v).should.be.true()
            T.evaluateRule({ field: 'total', op: 'lt', value: '100' }, v).should.be.false()
            T.evaluateRule({ field: 'total', op: 'gte', value: 120 }, v).should.be.true()
            T.evaluateRule({ field: 'total', op: 'lte', value: 119 }, v).should.be.false()
            T.evaluateRule({ field: 'tags', op: 'contains', value: 'b' }, v).should.be.true()
            T.evaluateRule({ field: 'empty', op: 'empty' }, v).should.be.true()
            T.evaluateRule({ field: 'delivery', op: 'notEmpty' }, v).should.be.true()
            T.evaluateRule({ field: 'delivery', op: 'in', value: 'no, yes' }, v).should.be.true()
            T.evaluateRule({ field: 'flag', op: 'eq', value: 'true' }, v).should.be.true()
        })
        it('combines rules with AND / OR', function () {
            const rules = [{ field: 'delivery', op: 'eq', value: 'yes' }, { field: 'total', op: 'gt', value: 500 }]
            T.evaluateCondition({ match: 'all', rules }, v).should.be.false()
            T.evaluateCondition({ match: 'any', rules }, v).should.be.true()
        })
        it('hides, disables and requires fields', function () {
            const schema = [
                { key: 'delivery', type: 'select', options: [{ label: 'yes', value: 'yes' }, { label: 'no', value: 'no' }] },
                { key: 'address', type: 'text', visibleIf: { match: 'all', rules: [{ field: 'delivery', op: 'eq', value: 'yes' }] }, requiredIf: { rules: [{ field: 'delivery', op: 'eq', value: 'yes' }] } },
                { key: 'note', type: 'text', disabledIf: { rules: [{ field: 'delivery', op: 'eq', value: 'no' }] }, required: true }
            ]
            let st = T.applyLogic(schema, { delivery: 'no' }).state
            st.address.visible.should.be.false()
            st.note.disabled.should.be.true()
            T.validateValues(schema, { delivery: 'no' }).should.eql({})
            st = T.applyLogic(schema, { delivery: 'yes' }).state
            st.address.visible.should.be.true()
            st.address.required.should.be.true()
            Object.keys(T.validateValues(schema, { delivery: 'yes' })).sort().should.eql(['address', 'note'])
        })
    })

    describe('computed fields', function () {
        it('evaluates formulas safely', function () {
            T.evaluateFormula('{{qty}} * {{price}}', { qty: '3', price: 2.5 }).should.equal(7.5)
            T.evaluateFormula('round(10 / 3, 2)', {}).should.equal(3.33)
            T.evaluateFormula('max(1, {{a}}, 3) + min(4, 2)', { a: 7 }).should.equal(9)
            T.evaluateFormula('if({{t}} > 100, "big", "small")', { t: 120 }).should.equal('big')
            T.evaluateFormula('"Total: " & {{t}}', { t: 5 }).should.equal('Total: 5')
            T.evaluateFormula('days({{a}}, {{b}})', { a: '2026-01-01', b: '2026-01-31' }).should.equal(30)
            T.evaluateFormula('2 ^ 3 % 5', {}).should.equal(3)
        })
        it('rejects code injection', function () {
            (() => T.evaluateFormula('process.exit()', {})).should.throw()
            should(T.evaluateFormula('constructor', {})).be.null()
            ;(() => T.evaluateFormula('{{constructor}}', {})).should.not.throw()
            should(T.evaluateFormula('{{constructor}}', {})).not.be.a.Function()
            ;(() => T.evaluateFormula('alert(1)', {})).should.throw()
            ;(() => T.parseFormula('{{a}} +')).should.throw()
        })
        it('formats values', function () {
            T.formatComputed({ decimals: 2, prefix: '$', suffix: ' USD' }, 7.5).should.equal('$7.50 USD')
            T.formatComputed({}, null).should.equal('')
        })
        it('computes chains in dependency order', function () {
            const schema = [
                { key: 'total', type: 'computed', formula: '{{sub}} - {{discount}}' },
                { key: 'sub', type: 'computed', formula: '{{qty}} * {{price}}' },
                { key: 'qty', type: 'number' }, { key: 'price', type: 'number' }, { key: 'discount', type: 'number' }
            ]
            const r = T.applyLogic(schema, { qty: 2, price: 10, discount: 5 })
            r.values.sub.should.equal(20)
            r.values.total.should.equal(15)
            r.state.total.disabled.should.be.true()
        })
        it('detects circular dependencies', function () {
            const schema = [{ key: 'a', type: 'computed', formula: '{{b}} + 1' }, { key: 'b', type: 'computed', formula: '{{a}} * 2' }]
            T.findCycle(T.normalizeSchema(schema)).should.eql(['a', 'b', 'a'])
            T.validateSchema(schema).join().should.match(/circular dependency: a → b → a/)
            T.applyLogic(schema, {}).errors.a.should.match(/circular/)
        })
        it('reports bad rules and formulas in validateSchema', function () {
            T.validateSchema([{ key: 'x', type: 'text', visibleIf: { rules: [{ field: 'nope', op: 'eq' }] } }]).length.should.be.above(0)
            T.validateSchema([{ key: 'x', type: 'text', visibleIf: { rules: [{ field: 'x', op: 'bogus' }] } }]).length.should.be.above(0)
            T.validateSchema([{ key: 'c', type: 'computed', formula: '1 +' }]).length.should.be.above(0)
        })
        it('prepares a submission (drops hidden, recomputes)', function () {
            const schema = [
                { key: 'qty', type: 'number' }, { key: 'price', type: 'number' },
                { key: 'total', type: 'computed', formula: '{{qty}} * {{price}}' },
                { key: 'discount', type: 'number', visibleIf: { rules: [{ field: 'total', op: 'gt', value: 100 }] } }
            ]
            let r = T.prepareSubmission(schema, { qty: '2', price: '10', total: 999, discount: 5 })
            r.values.should.eql({ qty: 2, price: 10, total: 20 })
            r = T.prepareSubmission(schema, { qty: 2, price: 10, discount: 5 }, { keepHidden: true })
            r.values.discount.should.equal(5)
            r = T.prepareSubmission(schema, { qty: 20, price: 10, discount: 5 })
            r.values.should.eql({ qty: 20, price: 10, total: 200, discount: 5 })
        })
        it('keeps rules and formulas in templates', function () {
            const schema = [{ key: 't', type: 'computed', formula: '1+1', decimals: 2, prefix: '$', visibleIf: { match: 'any', rules: [{ field: 'x', op: 'empty' }] } }, { key: 'x', type: 'text' }]
            const tpl = T.sanitizeTemplate({ name: 'n', schema })
            tpl.schema[0].formula.should.equal('1+1')
            tpl.schema[0].visibleIf.rules[0].op.should.equal('empty')
        })
    })

    it('client ESM copy is in sync with the server logic (npm run sync check)', function () {
        const { generate, DEST } = require('../../../scripts/sync-form-templater.js')
        fs.readFileSync(DEST, 'utf8').should.equal(generate())
    })

    it('client ESM copy exports the same API', async function () {
        const file = path.join(__dirname, '../../../ui/src/widgets/ui-form-builder/templater.mjs')
        fs.existsSync(file).should.be.true()
        const esm = await import(file)
        Object.keys(T).forEach(k => should.exist(esm[k], k))
        esm.buildOutput('{"q":"{{q}}"}', { q: 1 }).should.eql({ q: 1 })
    })
})
