<template>
    <div class="nrdb-ui-form-builder" :class="{'nrdb-ui-form-builder--editing': editing}">
        <div v-if="label || canEdit" class="nrdb-ui-form-builder-header">
            <label v-if="label" class="nrdb-ui-form-label">{{ renderText(label) }}</label>
            <v-spacer />
            <v-btn
                v-if="canEdit" size="small" variant="text" data-action="form-builder-edit"
                :prepend-icon="editing ? 'mdi-check' : 'mdi-pencil'" @click="toggleEdit"
            >
                {{ editing ? t('done') : t('edit') }}
            </v-btn>
        </div>

        <!-- template toolbar -->
        <div v-if="showTemplates" class="nrdb-ui-form-builder-templates" data-el="form-builder-templates">
            <v-select
                v-model="selectedTemplate" :items="templateNames" :label="t('template')" density="compact"
                variant="outlined" hide-details clearable class="nrdb-ui-form-builder-template-select"
                @update:model-value="loadTemplate"
            />
            <template v-if="props.allowTemplates">
                <v-text-field
                    v-model="newTemplateName" :label="t('templateName')" density="compact" variant="outlined"
                    hide-details class="nrdb-ui-form-builder-template-name"
                />
                <v-btn size="small" variant="tonal" prepend-icon="mdi-content-save" data-action="template-save" :disabled="!newTemplateName && !selectedTemplate" @click="saveTemplate">{{ t('save') }}</v-btn>
                <v-btn size="small" variant="text" icon="mdi-content-copy" :title="t('duplicate')" data-action="template-duplicate" :disabled="!selectedTemplate" @click="op({action: 'duplicateTemplate', name: selectedTemplate})" />
                <v-btn size="small" variant="text" icon="mdi-delete" :title="t('delete')" data-action="template-delete" :disabled="!selectedTemplate" @click="deleteTemplate" />
            </template>
        </div>
        <v-dialog v-model="confirmDelete" max-width="420" data-el="form-builder-delete-dialog">
            <v-card>
                <v-card-title>{{ t('deleteTitle') }}</v-card-title>
                <v-card-text>{{ t('deleteText') }} <b>{{ selectedTemplate }}</b>?</v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn variant="text" data-action="template-delete-cancel" @click="confirmDelete = false">{{ t('cancel') }}</v-btn>
                    <v-btn variant="flat" color="error" data-action="template-delete-confirm" @click="confirmDeleteTemplate">{{ t('delete') }}</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
        <v-alert v-if="error" type="error" density="compact" closable class="mb-2" @click:close="error = null">{{ error }}</v-alert>

        <div class="nrdb-ui-form-builder-body">
            <!-- in-dashboard editor -->
            <div v-if="editing" class="nrdb-ui-form-builder-editor" data-el="form-builder-editor">
                <div class="nrdb-ui-form-builder-fieldlist">
                    <div
                        v-for="(f, i) in draft" :key="f._uid"
                        class="nrdb-ui-form-builder-fielditem" :class="{selected: i === selectedIndex, dragover: i === dragOver}"
                        draggable="true"
                        @dragstart="dragFrom = i" @dragover.prevent="dragOver = i" @dragleave="dragOver = null" @drop.prevent="drop(i)"
                        @click="selectedIndex = i"
                    >
                        <v-icon size="small" class="handle">mdi-drag</v-icon>
                        <span class="name">{{ f.label || f.key }}</span>
                        <span class="type">{{ f.type }}</span>
                        <v-btn size="x-small" variant="text" icon="mdi-content-copy" :title="t('duplicate')" @click.stop="duplicateField(i)" />
                        <v-btn size="x-small" variant="text" icon="mdi-close" :title="t('delete')" @click.stop="removeField(i)" />
                    </div>
                    <v-btn size="small" variant="tonal" prepend-icon="mdi-plus" block data-action="field-add" @click="addField">{{ t('addField') }}</v-btn>
                </div>
                <div v-if="current" class="nrdb-ui-form-builder-props" data-el="form-builder-props">
                    <v-select v-model="current.type" :items="fieldTypes" :label="t('type')" density="compact" variant="outlined" hide-details />
                    <v-text-field v-model="current.key" :label="t('key')" density="compact" variant="outlined" hide-details />
                    <v-text-field v-model="current.label" :label="t('label')" density="compact" variant="outlined" hide-details />
                    <v-text-field v-model="current.default" :label="t('default')" density="compact" variant="outlined" hide-details />
                    <v-text-field v-model="current.placeholder" :label="t('placeholder')" density="compact" variant="outlined" hide-details />
                    <v-text-field v-model.number="current.cols" type="number" min="1" max="12" :label="t('cols')" density="compact" variant="outlined" hide-details />
                    <template v-if="current.type === 'number'">
                        <v-text-field v-model="current.min" :label="t('min')" density="compact" variant="outlined" hide-details />
                        <v-text-field v-model="current.max" :label="t('max')" density="compact" variant="outlined" hide-details />
                    </template>
                    <v-text-field v-if="isTexty(current)" v-model="current.pattern" :label="t('pattern')" density="compact" variant="outlined" hide-details />
                    <v-textarea
                        v-if="current.type === 'select' || current.type === 'radio'" :model-value="optionsText(current)"
                        :label="t('options')" rows="3" density="compact" variant="outlined" hide-details
                        @update:model-value="v => setOptions(current, v)"
                    />
                    <v-checkbox v-model="current.required" :label="t('required')" density="compact" hide-details />
                </div>
                <div class="nrdb-ui-form-builder-editor-actions">
                    <v-btn size="small" variant="flat" color="primary" data-action="schema-save" @click="saveSchema">{{ t('apply') }}</v-btn>
                    <v-btn size="small" variant="text" @click="cancelEdit">{{ t('cancel') }}</v-btn>
                </div>
            </div>

            <!-- the form itself (also the live preview while editing) -->
            <v-form ref="form" v-model="isValid" class="nrdb-ui-form-builder-form" :disabled="!state.enabled" validate-on="blur" @submit.prevent="onSubmit">
                <div class="nrdb-ui-form-builder-grid">
                    <div v-for="f in visibleSchema" :key="f.key" class="nrdb-ui-form-builder-cell" :style="{'grid-column': `span ${f.cols || 12}`}" :data-form="`form-row-${f.key}`">
                        <v-checkbox v-if="f.type === 'checkbox'" v-model="values[f.key]" :label="fieldLabel(f)" :rules="rules(f)" hide-details="auto" @update:model-value="touch(f.key)" />
                        <v-switch v-else-if="f.type === 'switch'" v-model="values[f.key]" :label="fieldLabel(f)" :rules="rules(f)" color="primary" hide-details="auto" @update:model-value="touch(f.key)" />
                        <v-select
                            v-else-if="f.type === 'select'" v-model="values[f.key]" :label="fieldLabel(f)" :rules="rules(f)"
                            :items="renderOptions(f)" item-title="label" item-value="value" variant="outlined" hide-details="auto"
                            @update:focused="v => !v && touch(f.key)" @update:model-value="touch(f.key)"
                        />
                        <v-radio-group v-else-if="f.type === 'radio'" v-model="values[f.key]" :label="fieldLabel(f)" :rules="rules(f)" inline hide-details="auto" @update:model-value="touch(f.key)">
                            <v-radio v-for="o in renderOptions(f)" :key="String(o.value)" :label="o.label" :value="o.value" />
                        </v-radio-group>
                        <v-textarea
                            v-else-if="f.type === 'textarea'" v-model="values[f.key]" :label="fieldLabel(f)" :rules="rules(f)"
                            :placeholder="renderText(f.placeholder)" :rows="f.rows || 3" variant="outlined" hide-details="auto"
                            @update:focused="v => !v && touch(f.key)"
                        />
                        <v-text-field
                            v-else v-model="values[f.key]" :label="fieldLabel(f)" :rules="rules(f)" :type="f.type"
                            :placeholder="renderText(f.placeholder)" :min="f.min" :max="f.max" variant="outlined" hide-details="auto"
                            @update:focused="v => !v && touch(f.key)"
                        />
                    </div>
                </div>
                <div class="nrdb-ui-form-actions">
                    <v-btn data-action="form-submit" type="submit" variant="flat" size="large" :disabled="!state.enabled">{{ props.submit || 'submit' }}</v-btn>
                    <v-btn v-if="props.cancel" data-action="form-clear" variant="outlined" size="large" :disabled="!state.enabled" @click="reset">{{ props.cancel }}</v-btn>
                </div>
            </v-form>
        </div>
    </div>
</template>

<script>
import { FIELD_TYPES, defaultValues, findTemplate, interpolate, normalizeSchema, validateSchema, validateValues } from './templater.mjs'

const RU = {
    edit: 'Редактировать',
    done: 'Готово',
    template: 'Шаблон',
    templateName: 'Имя шаблона',
    save: 'Сохранить',
    duplicate: 'Дублировать',
    delete: 'Удалить',
    addField: 'Добавить поле',
    type: 'Тип',
    key: 'Переменная',
    label: 'Подпись',
    default: 'По умолчанию',
    placeholder: 'Подсказка',
    cols: 'Ширина (1-12)',
    min: 'Мин.',
    max: 'Макс.',
    pattern: 'RegExp',
    options: 'Варианты (label=value, по строке)',
    required: 'Обязательное',
    apply: 'Применить',
    cancel: 'Отмена',
    deleteTitle: 'Удалить шаблон',
    deleteText: 'Удалить шаблон'
}
const EN = {
    edit: 'Edit',
    done: 'Done',
    template: 'Template',
    templateName: 'Template name',
    save: 'Save',
    duplicate: 'Duplicate',
    delete: 'Delete',
    addField: 'Add field',
    type: 'Type',
    key: 'Variable',
    label: 'Label',
    default: 'Default',
    placeholder: 'Placeholder',
    cols: 'Width (1-12)',
    min: 'Min',
    max: 'Max',
    pattern: 'RegExp',
    options: 'Options (label=value per line)',
    required: 'Required',
    apply: 'Apply',
    cancel: 'Cancel',
    deleteTitle: 'Delete template',
    deleteText: 'Delete template'
}
let uid = 0

export default {
    name: 'DBUIFormBuilder',
    inject: ['$socket', '$dataTracker'],
    props: {
        id: { type: String, required: true },
        props: { type: Object, default: () => ({}) },
        state: { type: Object, default: () => ({}) }
    },
    data () {
        return {
            values: {},
            isValid: null,
            editing: false,
            draft: [],
            selectedIndex: -1,
            dragFrom: null,
            dragOver: null,
            selectedTemplate: null,
            newTemplateName: '',
            error: null,
            touched: {},
            submitted: false,
            confirmDelete: false,
            fieldTypes: FIELD_TYPES
        }
    },
    computed: {
        label () { return this.getProperty('label') },
        schema () {
            let s = this.getProperty('schema')
            if (typeof s === 'string') { try { s = JSON.parse(s) } catch (_e) { s = [] } }
            return normalizeSchema(s || [])
        },
        templates () {
            let t = this.getProperty('templates')
            if (typeof t === 'string') { try { t = JSON.parse(t) } catch (_e) { t = [] } }
            return Array.isArray(t) ? t : []
        },
        templateNames () { return this.templates.map(t => t.name) },
        vars () {
            let v = this.props.vars
            if (typeof v === 'string') { try { v = JSON.parse(v) } catch (_e) { v = {} } }
            const tpl = this.selectedTemplate ? findTemplate(this.templates, this.selectedTemplate) : null
            return Object.assign({}, v || {}, tpl?.vars || {})
        },
        ctx () { return Object.assign({}, this.vars, this.values) },
        canEdit () { return !!this.props.allowEdit },
        showTemplates () { return this.props.allowTemplates || this.templates.length > 0 },
        visibleSchema () { return this.editing ? normalizeSchema(this.draft) : this.schema },
        current () { return this.draft[this.selectedIndex] }
    },
    watch: {
        schema (n, o) {
            if (JSON.stringify(n) !== JSON.stringify(o)) { this.applyDefaults(false) }
        }
    },
    created () {
        this.$dataTracker(this.id, this.onInput, this.onLoad, this.onDynamicProperties)
        this.$socket.on('ui-form-builder-error:' + this.id, this.onError)
    },
    unmounted () {
        this.$socket?.off('ui-form-builder-error:' + this.id, this.onError)
    },
    mounted () {
        this.selectedTemplate = this.getProperty('currentTemplate') || null
        this.applyDefaults(true)
    },
    methods: {
        t (key) {
            const lang = (navigator.language || 'en').toLowerCase()
            return (lang.startsWith('ru') ? RU : EN)[key] || key
        },
        renderText (s) { return typeof s === 'string' ? interpolate(s, this.ctx) : s },
        fieldLabel (f) { const l = this.renderText(f.label); return f.required ? `* ${l}` : l },
        renderOptions (f) { return (f.options || []).map(o => ({ label: this.renderText(o.label), value: o.value })) },
        isTexty (f) { return ['text', 'textarea', 'email', 'password'].includes(f.type) },
        rules (f) {
            return [(v) => {
                if (!this.submitted && !this.touched[f.key]) { return true }
                const err = validateValues([f], { [f.key]: v })[f.key]
                return err ? this.renderText(err) : true
            }]
        },
        applyDefaults (overwrite) {
            const defs = defaultValues(this.schema, this.vars)
            const next = {}
            for (const k of Object.keys(defs)) {
                next[k] = (!overwrite && k in this.values) ? this.values[k] : defs[k]
            }
            this.values = next
        },
        touch (key) {
            if (this.touched[key]) { return }
            this.touched = Object.assign({}, this.touched, { [key]: true })
            this.$nextTick(() => this.$refs.form?.validate())
        },
        clearValidation () {
            this.touched = {}
            this.submitted = false
            this.$nextTick(() => this.$refs.form?.resetValidation())
        },
        reset () {
            this.applyDefaults(true)
            this.clearValidation()
        },
        onSubmit () {
            this.submitted = true
            this.$nextTick(() => this.$refs.form?.validate())
            const errors = validateValues(this.schema, this.values)
            if (Object.keys(errors).length) { this.error = Object.values(errors).join('; '); return }
            this.$socket.emit('widget-action', this.id, { payload: { ...this.values }, _event: 'submit' })
            if (this.props.resetOnSubmit) { this.reset() }
        },
        setValues (payload) {
            if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
                this.values = Object.assign({}, this.values, payload)
                this.clearValidation()
            }
        },
        onInput (msg) {
            if (msg.ui_update) { this.onDynamicProperties(msg) }
            this.setValues(msg.payload)
        },
        onLoad (msg) {
            if (msg && msg.payload) { this.setValues(msg.payload) }
        },
        onDynamicProperties (msg) {
            const u = msg.ui_update
            if (!u) { return }
            this.updateDynamicProperty('label', u.label)
            this.updateDynamicProperty('schema', u.schema)
            this.updateDynamicProperty('templates', u.templates)
            if (u.currentTemplate !== undefined) {
                this.updateDynamicProperty('currentTemplate', u.currentTemplate)
                this.selectedTemplate = u.currentTemplate
            }
        },
        onError (err) { this.error = err },
        op (payload) { this.$socket.emit('ui-form-builder-op:' + this.id, this.id, payload) },
        loadTemplate (name) {
            if (name) { this.op({ action: 'loadTemplate', name }) } else { this.reset() }
        },
        saveTemplate () {
            const name = (this.newTemplateName || this.selectedTemplate || '').trim()
            if (!name) { return }
            const existing = findTemplate(this.templates, name)
            this.op({ action: 'saveTemplate', template: { name, values: { ...this.values }, vars: existing?.vars } })
            this.newTemplateName = ''
        },
        deleteTemplate () {
            if (this.selectedTemplate) { this.confirmDelete = true }
        },
        confirmDeleteTemplate () {
            this.confirmDelete = false
            if (this.selectedTemplate) { this.op({ action: 'deleteTemplate', name: this.selectedTemplate }) }
        },
        /* editor */
        withUid (f) { return Object.assign({}, JSON.parse(JSON.stringify(f)), { _uid: ++uid }) },
        toggleEdit () {
            if (this.editing) { this.saveSchema(); return }
            this.draft = this.schema.map(this.withUid)
            this.selectedIndex = this.draft.length ? 0 : -1
            this.editing = true
        },
        cancelEdit () { this.editing = false; this.applyDefaults(false) },
        cleanDraft () { return this.draft.map(({ _uid, ...f }) => f) },
        saveSchema () {
            const schema = normalizeSchema(this.cleanDraft())
            const errors = validateSchema(schema)
            if (errors.length) { this.error = errors.join('; '); return }
            this.op({ action: 'setSchema', schema })
            this.editing = false
        },
        addField () {
            let n = this.draft.length + 1
            while (this.draft.some(f => f.key === `field${n}`)) { n++ }
            this.draft.push(this.withUid({ type: 'text', key: `field${n}`, label: `Field ${n}` }))
            this.selectedIndex = this.draft.length - 1
        },
        duplicateField (i) {
            const copy = this.withUid(this.draft[i])
            let n = 2
            while (this.draft.some(f => f.key === `${copy.key}_${n}`)) { n++ }
            copy.key = `${copy.key}_${n}`
            this.draft.splice(i + 1, 0, copy)
            this.selectedIndex = i + 1
        },
        removeField (i) {
            this.draft.splice(i, 1)
            this.selectedIndex = Math.min(this.selectedIndex, this.draft.length - 1)
        },
        drop (i) {
            const from = this.dragFrom
            this.dragOver = null
            if (from === null || from === i) { return }
            const [f] = this.draft.splice(from, 1)
            this.draft.splice(i, 0, f)
            this.selectedIndex = i
            this.dragFrom = null
        },
        optionsText (f) { return (f.options || []).map(o => o.label === String(o.value) ? o.label : `${o.label}=${o.value}`).join('\n') },
        setOptions (f, text) {
            f.options = String(text || '').split('\n').map(s => s.trim()).filter(Boolean).map(line => {
                const i = line.lastIndexOf('=')
                return i > 0 ? { label: line.slice(0, i), value: line.slice(i + 1) } : { label: line, value: line }
            })
        }
    }
}
</script>

<style scoped>
.nrdb-ui-form-builder-header { display: flex; align-items: center; }
.nrdb-ui-form-builder-templates { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 6px 0 10px; }
.nrdb-ui-form-builder-template-select { min-width: 180px; flex: 2; }
.nrdb-ui-form-builder-template-name { min-width: 140px; flex: 1; }
.nrdb-ui-form-builder-body { display: flex; gap: 12px; flex-wrap: wrap; }
.nrdb-ui-form-builder-form { flex: 1 1 300px; }
.nrdb-ui-form-builder-editor { flex: 1 1 260px; display: flex; flex-direction: column; gap: 8px; border: 1px dashed rgba(128,128,128,0.5); border-radius: 6px; padding: 8px; }
.nrdb-ui-form-builder-grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 8px; margin-top: 4px; }
.nrdb-ui-form-builder-fielditem { display: flex; align-items: center; gap: 4px; padding: 2px 4px; border-radius: 4px; cursor: pointer; border: 1px solid transparent; }
.nrdb-ui-form-builder-fielditem .handle { cursor: grab; }
.nrdb-ui-form-builder-fielditem .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nrdb-ui-form-builder-fielditem .type { opacity: 0.6; font-size: 0.8em; }
.nrdb-ui-form-builder-fielditem.selected { border-color: rgb(var(--v-theme-primary)); }
.nrdb-ui-form-builder-fielditem.dragover { border-top: 2px solid rgb(var(--v-theme-primary)); }
.nrdb-ui-form-builder-props { display: flex; flex-direction: column; gap: 6px; }
.nrdb-ui-form-builder-editor-actions { display: flex; gap: 6px; }
.nrdb-ui-form-builder .nrdb-ui-form-actions { margin-top: 10px; display: flex; gap: 8px; }
</style>
