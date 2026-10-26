/**
 * Form templater helpers shared by the ui-form-builder runtime node.
 * GENERATED from nodes/utils/templater.js by scripts/sync-form-templater.js - do not edit.
 */
export const FIELD_TYPES = ['text', 'textarea', 'number', 'email', 'password', 'select', 'radio', 'checkbox', 'switch', 'date', 'time', 'color', 'computed']
const PLACEHOLDER = /\{\{\s*([\w$.-]+)\s*\}\}/g
const EXACT_PLACEHOLDER = /^\{\{\s*([\w$.-]+)\s*\}\}$/

function isObject (v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function getPath (obj, path) {
    if (!obj || typeof path !== 'string') { return undefined }
    return path.split('.').reduce((acc, part) => (acc === null || acc === undefined || !Object.prototype.hasOwnProperty.call(Object(acc), part)) ? undefined : acc[part], obj)
}

/** replace {{var}} placeholders in a string, unknown variables are left untouched */
export function interpolate (str, ctx) {
    if (typeof str !== 'string') { return str }
    return str.replace(PLACEHOLDER, (match, path) => {
        const v = getPath(ctx, path)
        if (v === undefined || v === null) { return match }
        return typeof v === 'object' ? JSON.stringify(v) : String(v)
    })
}

/** deep render: strings that are exactly "{{var}}" keep the raw (typed) value */
export function render (value, ctx) {
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
export function extractVariables (value, found = new Set()) {
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

export function normalizeField (field, index = 0) {
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

export function normalizeSchema (schema) {
    if (!Array.isArray(schema)) { return [] }
    return schema.map((f, i) => normalizeField(f, i))
}

/** returns a list of human readable problems with a schema (empty when valid) */
export function validateSchema (schema) {
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
    return errors.concat(validateLogic(schema))
}

/** default values for a schema, defaults may use {{var}} placeholders resolved from ctx */
export function defaultValues (schema, ctx = {}) {
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
export function coerce (field, v) {
    switch (field.type) {
    case 'checkbox':
    case 'switch':
        if (typeof v === 'string') { return v === 'true' || v === '1' || v === 'on' }
        return !!v
    case 'computed':
        return v === undefined ? null : v
    case 'number': {
        if (isEmpty(v)) { return null }
        const n = Number(v)
        return Number.isNaN(n) ? null : n
    }
    default:
        return isEmpty(v) ? '' : v
    }
}

export function coerceValues (schema, values) {
    const out = {}
    normalizeSchema(schema).forEach(f => { out[f.key] = coerce(f, values ? values[f.key] : undefined) })
    return out
}

/** returns { key: message } for every invalid value */
export function validateValues (schema, values) {
    const errors = {}
    const logic = applyLogic(schema, values || {})
    normalizeSchema(schema).forEach(f => {
        const st = logic.state[f.key] || {}
        if (f.type === 'computed') {
            if (logic.errors[f.key]) { errors[f.key] = logic.errors[f.key] }
            return
        }
        if (st.visible === false || st.disabled) { return }
        const v = values ? values[f.key] : undefined
        const label = f.label || f.key
        if (st.required && (isEmpty(v) || ((f.type === 'checkbox' || f.type === 'switch') && v !== true))) {
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
export function buildOutput (outputTemplate, values, vars = {}) {
    const ctx = Object.assign({}, vars, values)
    if (outputTemplate === undefined || outputTemplate === null || outputTemplate === '') { return Object.assign({}, values) }
    let tpl = outputTemplate
    if (typeof tpl === 'string') {
        try { tpl = JSON.parse(tpl) } catch (_e) { return interpolate(tpl, ctx) }
    }
    return render(tpl, ctx)
}

/* ---------- conditional rules & computed fields (no eval / new Function) ---------- */

export const RULE_OPS = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains', 'empty', 'notEmpty', 'in']

function toNum (v) {
    if (typeof v === 'number') { return v }
    if (typeof v === 'boolean') { return v ? 1 : 0 }
    if (isEmpty(v)) { return 0 }
    const n = Number(v)
    return Number.isNaN(n) ? NaN : n
}

function looseEq (a, b) {
    if (typeof a === 'boolean' || typeof b === 'boolean') {
        const ab = typeof a === 'boolean' ? a : (a === 'true' || a === '1' || a === 1)
        const bb = typeof b === 'boolean' ? b : (b === 'true' || b === '1' || b === 1)
        return ab === bb
    }
    if (!isEmpty(a) && !isEmpty(b) && !Number.isNaN(Number(a)) && !Number.isNaN(Number(b))) { return Number(a) === Number(b) }
    return String(a ?? '') === String(b ?? '')
}

/** evaluates one rule {field, op, value} against the form values */
export function evaluateRule (rule, values) {
    if (!rule || !rule.field) { return true }
    const v = values ? values[rule.field] : undefined
    const x = rule.value
    switch (rule.op || 'eq') {
    case 'eq': return looseEq(v, x)
    case 'neq': return !looseEq(v, x)
    case 'gt': return !isEmpty(v) && toNum(v) > toNum(x)
    case 'lt': return !isEmpty(v) && toNum(v) < toNum(x)
    case 'gte': return !isEmpty(v) && toNum(v) >= toNum(x)
    case 'lte': return !isEmpty(v) && toNum(v) <= toNum(x)
    case 'contains':
        if (Array.isArray(v)) { return v.some(i => looseEq(i, x)) }
        return String(v ?? '').toLowerCase().includes(String(x ?? '').toLowerCase())
    case 'empty': return isEmpty(v) || v === false || (Array.isArray(v) && v.length === 0)
    case 'notEmpty': return !(isEmpty(v) || v === false || (Array.isArray(v) && v.length === 0))
    case 'in': {
        const list = Array.isArray(x) ? x : String(x ?? '').split(',').map(i => i.trim())
        return list.some(i => looseEq(v, i))
    }
    default: return true
    }
}

/** condition: {match: 'all'|'any', rules: [...]} - an empty condition is "true" */
export function evaluateCondition (cond, values) {
    if (!cond || !Array.isArray(cond.rules) || cond.rules.length === 0) { return true }
    const rules = cond.rules.filter(r => r && r.field)
    if (!rules.length) { return true }
    return cond.match === 'any' ? rules.some(r => evaluateRule(r, values)) : rules.every(r => evaluateRule(r, values))
}

function hasCondition (cond) {
    return !!(cond && Array.isArray(cond.rules) && cond.rules.some(r => r && r.field))
}

/* --- safe formula parser: numbers, strings, {{var}} / identifiers, + - * / % ^, comparisons, && || !, whitelisted functions --- */

function tokenize (src) {
    const tokens = []
    let i = 0
    const s = String(src ?? '')
    while (i < s.length) {
        const c = s[i]
        if (/\s/.test(c)) { i++; continue }
        if (s.startsWith('{{', i)) {
            const end = s.indexOf('}}', i)
            if (end < 0) { throw new Error('unclosed {{') }
            tokens.push({ t: 'ref', v: s.slice(i + 2, end).trim() })
            i = end + 2
            continue
        }
        if (/[0-9.]/.test(c)) {
            const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i))
            if (!m) { throw new Error(`unexpected "${c}"`) }
            tokens.push({ t: 'num', v: Number(m[0]) })
            i += m[0].length
            continue
        }
        if (c === '"' || c === "'") {
            let j = i + 1
            let out = ''
            while (j < s.length && s[j] !== c) {
                if (s[j] === '\\' && j + 1 < s.length) { j++ }
                out += s[j++]
            }
            if (j >= s.length) { throw new Error('unclosed string') }
            tokens.push({ t: 'str', v: out })
            i = j + 1
            continue
        }
        const id = /^[A-Za-z_$][\w$.]*/.exec(s.slice(i))
        if (id) { tokens.push({ t: 'id', v: id[0] }); i += id[0].length; continue }
        const op = /^(==|!=|>=|<=|&&|\|\||[-+*/%^()<>!,=&])/.exec(s.slice(i))
        if (op) { tokens.push({ t: 'op', v: op[0] === '=' ? '==' : op[0] }); i += op[0].length; continue }
        throw new Error(`unexpected "${c}"`)
    }
    return tokens
}

export function parseFormula (src) {
    const tk = tokenize(src)
    let p = 0
    const peek = () => tk[p]
    const isOp = (v) => tk[p] && tk[p].t === 'op' && tk[p].v === v
    const expect = (v) => { if (!isOp(v)) { throw new Error(`expected "${v}"`) } p++ }
    const bin = (next, ops) => () => {
        let left = next()
        while (tk[p] && tk[p].t === 'op' && ops.includes(tk[p].v)) {
            const op = tk[p++].v
            left = { k: 'bin', op, a: left, b: next() }
        }
        return left
    }
    function primary () {
        const t = peek()
        if (!t) { throw new Error('unexpected end of formula') }
        if (t.t === 'num' || t.t === 'str') { p++; return { k: 'lit', v: t.v } }
        if (t.t === 'ref') { p++; return { k: 'ref', v: t.v } }
        if (t.t === 'id') {
            p++
            if (t.v === 'true' || t.v === 'false') { return { k: 'lit', v: t.v === 'true' } }
            if (isOp('(')) {
                p++
                const args = []
                if (!isOp(')')) {
                    do { args.push(expr()) } while (isOp(',') && ++p)
                }
                expect(')')
                const name = t.v.toLowerCase()
                if (!FORMULA_FUNCS[name]) { throw new Error(`unknown function "${t.v}"`) }
                return { k: 'call', name, args }
            }
            return { k: 'ref', v: t.v }
        }
        if (isOp('(')) { p++; const e = expr(); expect(')'); return e }
        throw new Error(`unexpected "${t.v}"`)
    }
    function unary () {
        if (isOp('-') || isOp('!') || isOp('+')) { const op = tk[p++].v; return { k: 'un', op, a: unary() } }
        return power()
    }
    function power () {
        const base = primary()
        if (isOp('^')) { p++; return { k: 'bin', op: '^', a: base, b: unary() } }
        return base
    }
    const mul = bin(unary, ['*', '/', '%'])
    const add = bin(mul, ['+', '-'])
    const cat = bin(add, ['&'])
    const cmp = bin(cat, ['>', '<', '>=', '<='])
    const eq = bin(cmp, ['==', '!='])
    const and = bin(eq, ['&&'])
    const or = bin(and, ['||'])
    function expr () { return or() }
    const ast = expr()
    if (p < tk.length) { throw new Error(`unexpected "${tk[p].v}"`) }
    return ast
}

function toDate (v) {
    if (v instanceof Date) { return v }
    if (isEmpty(v)) { return null }
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
}

const FORMULA_FUNCS = {
    round: (x, d) => { const f = Math.pow(10, toNum(d) || 0); return Math.round(toNum(x) * f) / f },
    floor: (x) => Math.floor(toNum(x)),
    ceil: (x) => Math.ceil(toNum(x)),
    abs: (x) => Math.abs(toNum(x)),
    min: (...a) => Math.min(...a.map(toNum)),
    max: (...a) => Math.max(...a.map(toNum)),
    sum: (...a) => a.reduce((s, x) => s + toNum(x), 0),
    if: (c, a, b) => (c ? a : b),
    concat: (...a) => a.map(x => (x ?? '')).join(''),
    len: (s) => String(s ?? '').length,
    upper: (s) => String(s ?? '').toUpperCase(),
    lower: (s) => String(s ?? '').toLowerCase(),
    number: (x) => toNum(x),
    text: (x) => String(x ?? ''),
    today: () => new Date().toISOString().slice(0, 10),
    days: (a, b) => {
        const d1 = toDate(a)
        const d2 = b === undefined ? new Date() : toDate(b)
        if (!d1 || !d2) { return null }
        return Math.round((d2.getTime() - d1.getTime()) / 86400000)
    }
}

function evalNode (n, scope) {
    switch (n.k) {
    case 'lit': return n.v
    case 'ref': {
        const v = getPath(scope, n.v)
        return (v === undefined || typeof v === 'function') ? null : v
    }
    case 'un': {
        const a = evalNode(n.a, scope)
        if (n.op === '!') { return !a }
        return n.op === '-' ? -toNum(a) : toNum(a)
    }
    case 'call': {
        if (n.name === 'if') {
            return evalNode(n.args[0], scope) ? evalNode(n.args[1], scope) : (n.args[2] ? evalNode(n.args[2], scope) : null)
        }
        return FORMULA_FUNCS[n.name](...n.args.map(a => evalNode(a, scope)))
    }
    case 'bin': {
        if (n.op === '&&') { return evalNode(n.a, scope) && evalNode(n.b, scope) }
        if (n.op === '||') { return evalNode(n.a, scope) || evalNode(n.b, scope) }
        const a = evalNode(n.a, scope)
        const b = evalNode(n.b, scope)
        switch (n.op) {
        case '+': {
            const na = toNum(a)
            const nb = toNum(b)
            if ((typeof a === 'string' && Number.isNaN(na)) || (typeof b === 'string' && Number.isNaN(nb))) { return String(a ?? '') + String(b ?? '') }
            return na + nb
        }
        case '&': return String(a ?? '') + String(b ?? '')
        case '-': {
            const da = typeof a === 'string' && /^\d{4}-\d{2}-\d{2}/.test(a) ? toDate(a) : null
            const db = typeof b === 'string' && /^\d{4}-\d{2}-\d{2}/.test(b) ? toDate(b) : null
            if (da && db) { return Math.round((da.getTime() - db.getTime()) / 86400000) }
            return toNum(a) - toNum(b)
        }
        case '*': return toNum(a) * toNum(b)
        case '/': return toNum(b) === 0 ? null : toNum(a) / toNum(b)
        case '%': return toNum(b) === 0 ? null : toNum(a) % toNum(b)
        case '^': return Math.pow(toNum(a), toNum(b))
        case '>': return toNum(a) > toNum(b)
        case '<': return toNum(a) < toNum(b)
        case '>=': return toNum(a) >= toNum(b)
        case '<=': return toNum(a) <= toNum(b)
        case '==': return looseEq(a, b)
        case '!=': return !looseEq(a, b)
        }
    }
    }
    throw new Error('invalid formula')
}

/** evaluates a formula string over a scope object; throws on syntax errors */
export function evaluateFormula (formula, scope = {}) {
    const v = evalNode(parseFormula(formula), scope || {})
    return (typeof v === 'number' && !Number.isFinite(v)) ? null : v
}

function collectRefs (n, out) {
    if (!n) { return out }
    if (n.k === 'ref') { out.add(String(n.v).split('.')[0]) }
    if (n.a) { collectRefs(n.a, out) }
    if (n.b) { collectRefs(n.b, out) }
    if (n.args) { n.args.forEach(a => collectRefs(a, out)) }
    return out
}

/** field keys referenced by a formula (empty when the formula is invalid) */
export function formulaRefs (formula) {
    try { return Array.from(collectRefs(parseFormula(formula), new Set())) } catch (_e) { return [] }
}

/** finds a circular dependency between computed fields, returns the cycle path or null */
export function findCycle (schema) {
    const computed = {}
    ;(Array.isArray(schema) ? schema : []).forEach(f => {
        if (f && f.type === 'computed' && f.key) { computed[f.key] = formulaRefs(f.formula) }
    })
    const state = {}
    const stack = []
    function visit (k) {
        if (state[k] === 2) { return null }
        if (state[k] === 1) { return stack.slice(stack.indexOf(k)).concat(k) }
        state[k] = 1
        stack.push(k)
        for (const d of computed[k] || []) {
            if (computed[d]) {
                const c = visit(d)
                if (c) { return c }
            }
        }
        stack.pop()
        state[k] = 2
        return null
    }
    for (const k of Object.keys(computed)) {
        const c = visit(k)
        if (c) { return c }
    }
    return null
}

/** problems with rules and formulas (part of validateSchema) */
export function validateLogic (schema) {
    const errors = []
    if (!Array.isArray(schema)) { return errors }
    const keys = new Set(schema.filter(f => f && f.key).map(f => f.key))
    schema.forEach(f => {
        if (!f || !f.key) { return }
        ['visibleIf', 'disabledIf', 'requiredIf'].forEach(prop => {
            const c = f[prop]
            if (!c) { return }
            (Array.isArray(c.rules) ? c.rules : []).forEach(r => {
                if (!r || !r.field) { return }
                if (!keys.has(r.field)) { errors.push(`field "${f.key}": rule refers to unknown field "${r.field}"`) }
                if (r.op && !RULE_OPS.includes(r.op)) { errors.push(`field "${f.key}": unknown rule operator "${r.op}"`) }
            })
        })
        if (f.type === 'computed') {
            if (!f.formula || !String(f.formula).trim()) {
                errors.push(`field "${f.key}": formula is required`)
            } else {
                try { parseFormula(f.formula) } catch (err) { errors.push(`field "${f.key}": formula error: ${err.message}`) }
            }
        }
    })
    const cycle = findCycle(schema)
    if (cycle) { errors.push(`circular dependency: ${cycle.join(' → ')}`) }
    return errors
}

/** formats a computed value for display (decimals, prefix, suffix) */
export function formatComputed (field, v) {
    if (v === null || v === undefined || v === '') { return '' }
    let out = v
    if (typeof v === 'number' && field && field.decimals !== undefined && field.decimals !== '' && field.decimals !== null) {
        out = v.toFixed(Math.max(0, Math.min(10, parseInt(field.decimals) || 0)))
    }
    return `${field?.prefix || ''}${out}${field?.suffix || ''}`
}

/**
 * applies computed formulas and conditional rules
 * returns { values, state: {key: {visible, disabled, required}}, errors: {key: msg}, cycle }
 */
export function applyLogic (schema, values, vars = {}) {
    const fields = normalizeSchema(schema)
    const out = Object.assign({}, values || {})
    const errors = {}
    const cycle = findCycle(fields)
    const computed = fields.filter(f => f.type === 'computed')
    if (cycle) {
        computed.forEach(f => { if (cycle.includes(f.key)) { errors[f.key] = `circular dependency: ${cycle.join(' → ')}`; out[f.key] = null } })
    }
    // evaluate computed fields in dependency order
    const done = new Set()
    const byKey = {}
    computed.forEach(f => { byKey[f.key] = f })
    function compute (f, depth) {
        if (done.has(f.key) || errors[f.key] || depth > fields.length) { return }
        formulaRefs(f.formula).forEach(r => { if (byKey[r] && r !== f.key) { compute(byKey[r], depth + 1) } })
        try {
            let v = evaluateFormula(f.formula, Object.assign({}, vars, out))
            if (typeof v === 'number' && f.decimals !== undefined && f.decimals !== '' && f.decimals !== null) {
                const m = Math.pow(10, Math.max(0, parseInt(f.decimals) || 0))
                v = Math.round(v * m) / m
            }
            out[f.key] = v
        } catch (err) {
            errors[f.key] = `${f.label || f.key}: ${err.message}`
            out[f.key] = null
        }
        done.add(f.key)
    }
    computed.forEach(f => compute(f, 0))
    const state = {}
    fields.forEach(f => {
        state[f.key] = {
            visible: hasCondition(f.visibleIf) ? evaluateCondition(f.visibleIf, out) : true,
            disabled: f.type === 'computed' || (hasCondition(f.disabledIf) ? evaluateCondition(f.disabledIf, out) : false),
            required: !!f.required || (hasCondition(f.requiredIf) ? evaluateCondition(f.requiredIf, out) : false)
        }
    })
    return { values: out, state, errors, cycle }
}

/** values to submit: computed fields filled in, hidden fields dropped unless keepHidden */
export function prepareSubmission (schema, values, options = {}) {
    const fields = normalizeSchema(schema)
    const coerced = coerceValues(fields, values)
    const logic = applyLogic(fields, coerced, options.vars || {})
    const errors = validateValues(fields, logic.values)
    const out = {}
    fields.forEach(f => {
        if (!options.keepHidden && logic.state[f.key] && logic.state[f.key].visible === false) { return }
        out[f.key] = logic.values[f.key]
    })
    return { values: out, errors, state: logic.state }
}

/* ---------- template collection helpers (immutable) ---------- */

export function sanitizeTemplate (tpl) {
    if (!isObject(tpl) || typeof tpl.name !== 'string' || !tpl.name.trim()) { throw new Error('template must have a name') }
    const out = { name: tpl.name.trim(), values: isObject(tpl.values) ? tpl.values : {} }
    if (Array.isArray(tpl.schema)) { out.schema = normalizeSchema(tpl.schema) }
    if (isObject(tpl.vars)) { out.vars = tpl.vars }
    if (typeof tpl.description === 'string') { out.description = tpl.description }
    out.updated = tpl.updated || new Date().toISOString()
    return out
}

export function upsertTemplate (list, tpl) {
    const t = sanitizeTemplate(tpl)
    const out = (Array.isArray(list) ? list : []).filter(x => x && x.name !== t.name)
    out.push(t)
    return out
}

export function removeTemplate (list, name) {
    return (Array.isArray(list) ? list : []).filter(x => x && x.name !== name)
}

export function findTemplate (list, name) {
    return (Array.isArray(list) ? list : []).find(x => x && x.name === name)
}

export function duplicateTemplate (list, name, newName) {
    const src = findTemplate(list, name)
    if (!src) { throw new Error(`template "${name}" not found`) }
    let target = newName
    if (!target) {
        let i = 1
        do { target = `${name} (${i++})` } while (findTemplate(list, target))
    }
    return upsertTemplate(list, Object.assign(JSON.parse(JSON.stringify(src)), { name: target, updated: undefined }))
}
