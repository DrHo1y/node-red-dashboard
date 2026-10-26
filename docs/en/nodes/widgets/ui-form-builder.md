---
description: Build forms visually, save them as reusable templates and substitute {{variables}} with ui-form-builder.
---

# Form Builder `ui-form-builder`

> **RU:** Конструктор форм с шаблонами. Поля формы собираются мышкой (перетаскивание, добавление, дублирование,
> панель свойств и живой предпросмотр) — в редакторе Node-RED и прямо в дашборде. Готовую форму вместе со значениями
> можно сохранить как именованный **шаблон**, а затем загрузить его и подставить новые значения в `{{переменные}}`.
> Результат отправки — объект в `msg.payload` (или объект, собранный по «выходному шаблону»).

**EN:** A form whose fields are designed visually (drag & drop ordering, add / duplicate / remove, property panel,
live preview) both in the Node-RED editor and, optionally, directly in the dashboard. A form plus its values can be saved
as a named **template**, later loaded again with new values substituted into `{{variables}}`. On submit the values
(or an object rendered from the *Output* template) are sent as `msg.payload`.

## Fields

| Property | Description |
| --- | --- |
| Type | `text`, `textarea`, `number`, `email`, `password`, `select`, `radio`, `checkbox`, `switch`, `date`, `time`, `color` |
| Variable | key of the value in `msg.payload`, and the name usable as `{{variable}}` |
| Label / Placeholder / Default | may contain `{{var}}` placeholders |
| Required, Min/Max, Min/Max length, RegExp | validation, enforced in the browser and re-checked on the server (`msg.errors`) |
| Width | 1-12 columns of the form grid |
| Options | for `select`/`radio`, one `label=value` per line |

## Templates and variables

A template is `{ name, values, vars?, schema?, description? }`.

- `values` – the saved form values, may contain `{{var}}`.
- `vars` – variables of the template, substituted when loading it.
- `schema` – the fields at the time of saving; loading the template restores them.

Variables are resolved from (lowest to highest priority) the node *Variables*, the template `vars`, `msg.vars`, and the
current form values. Nested paths such as `{{customer.name}}` are supported. Unknown variables stay untouched.

The *Output* template (JSON) shapes `msg.payload` on submit. A string that is exactly `"{{qty}}"` keeps the value
type (number, boolean…); other strings are interpolated. Leave it empty to send the raw values object.

### Persistence

Templates and runtime schema changes are stored in the **node context** under the key `formBuilder`, using the
context store chosen in the node (*Store*). Configure a persistent store (e.g. `localfilesystem`) in `settings.js`
to keep them across restarts. Templates entered in the node config are *seeds* – runtime-saved templates with the same
name take precedence. Use `listTemplates` to export them.

## Input messages

| `msg.action` | Other properties | Effect |
| --- | --- | --- |
| *(none)* | `payload` (object), `vars` | set form values (rendered with `vars`) |
| *(none)* | `schema` (array) | replace form fields |
| `setSchema` | `schema` | replace form fields |
| `loadTemplate` | `template` (name), `vars` | load a template |
| `saveTemplate` | `template` (name or object), `payload` (values), `vars` | save/overwrite a template |
| `duplicateTemplate` | `template`, `newName` | copy a template |
| `deleteTemplate` | `template` | delete a template |
| `listTemplates` | | outputs `{ payload: [names], templates: [...] }` |

`msg.ui_update.label`, `msg.enabled`, `msg.visible` and `msg.class` work as for other widgets.

## Output message

```json
{ "payload": { "...": "values or rendered Output template" }, "values": { }, "template": "name", "topic": "" }
```

## Dashboard edit mode

With *Allow editing the form in the dashboard* the widget shows an **Edit** button: a field list (drag to reorder,
duplicate, delete, add), a property panel for the selected field and a live preview. *Apply* saves the schema for all
users. With *Allow saving templates* the template bar can save, duplicate and delete templates.

## Examples

See `examples/form-builder-templates.json` and `examples/form-builder-dynamic.json` (Import ▸ Examples ▸ @flowfuse/node-red-dashboard).
