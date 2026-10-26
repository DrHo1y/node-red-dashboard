#!/usr/bin/env node
/**
 * Generates ui/src/widgets/ui-form-builder/templater.mjs (ESM, dashboard client)
 * from nodes/utils/templater.js (CommonJS, Node-RED runtime) so both share one logic.
 * Usage: node scripts/sync-form-templater.js [--check]
 */
const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, '../nodes/utils/templater.js')
const DEST = path.join(__dirname, '../ui/src/widgets/ui-form-builder/templater.mjs')

function generate () {
    let src = fs.readFileSync(SRC, 'utf8')
    const m = /\nmodule\.exports = \{([\s\S]*?)\n\}\n?$/.exec(src)
    if (!m) { throw new Error('module.exports block not found') }
    const names = m[1].split(',').map(s => s.trim()).filter(Boolean)
    src = src.slice(0, m.index) + '\n'
    for (const name of names) {
        const re = new RegExp(`^(function|const) ${name.replace('$', '\\$')}\\b`, 'm')
        if (!re.test(src)) { throw new Error(`top-level declaration for "${name}" not found`) }
        src = src.replace(re, `export $1 ${name}`)
    }
    src = src.replace(/^ \* NOTE: keep in sync with .*$/m, ' * GENERATED from nodes/utils/templater.js by scripts/sync-form-templater.js - do not edit.')
    return src.replace(/\n+$/, '\n')
}

if (require.main === module) {
    const out = generate()
    if (process.argv.includes('--check')) {
        const cur = fs.existsSync(DEST) ? fs.readFileSync(DEST, 'utf8') : ''
        if (cur !== out) { console.error('templater.mjs is out of date, run: node scripts/sync-form-templater.js'); process.exit(1) }
    } else {
        fs.writeFileSync(DEST, out)
    }
}

module.exports = { generate, DEST }
