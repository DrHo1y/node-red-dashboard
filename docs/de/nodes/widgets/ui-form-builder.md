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
| Type | `text`, `textarea`, `number`, `email`, `password`, `select`, `radio`, `checkbox`, `switch`, `date`, `time`, `color`, `computed` |
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

## Conditions and computed fields

> **RU:** Без единой строчки кода: у каждого поля есть визуальный конструктор правил — **«Показывать, если»**,
> **«Блокировать, если»** и **«Обязательно, если»**. Правило = *поле* + *оператор* + *значение*; правила объединяются
> через **И** (все) или **ИЛИ** (любое). Операторы: `=`, `≠`, `>`, `<`, `≥`, `≤`, *содержит*, *пусто*, *не пусто*,
> *в списке* (`a, b, c`). Скрытые поля не проверяются и по умолчанию не попадают в `msg.payload`
> (флажок *Включать скрытые поля в payload* это меняет; список скрытых ключей — в `msg.hidden`).
>
> Тип **«Вычисляемое»** — поле только для чтения с формулой, например `{{quantity}} * {{price}}`. Значение
> пересчитывается на лету и отправляется в `msg.payload`; на сервере оно **пересчитывается заново** (присланное браузером
> значение игнорируется). Формулы разбираются собственным безопасным парсером — без `eval` и `new Function`.
> Доступно: `+ - * / % ^`, сравнения, `&&` `||` `!`, склейка строк `&`, функции `round(x, n)`, `floor`, `ceil`, `abs`,
> `min`, `max`, `sum`, `if(условие, да, нет)`, `concat`, `len`, `upper`, `lower`, `number`, `text`, `today()`,
> `days(от, до)` (разница дат в днях; разность двух ISO-дат тоже даёт дни). Формат: *знаков после запятой*, *префикс*, *суффикс*.
> Циклы (`a` зависит от `b`, а `b` от `a`) обнаруживаются: схема не сохраняется, показывается
> «circular dependency: a → b → a».

**EN:** Every field has a no-code rule builder for **Show only if**, **Disable if** and **Required if**. A rule is
*field* + *operator* + *value*; rules are combined with **AND** (all) or **OR** (any). Operators: `=`, `≠`, `>`, `<`, `≥`,
`≤`, *contains*, *is empty*, *is not empty*, *in list* (`a, b, c`). Hidden fields are skipped by validation and, unless
*Include hidden fields in the payload* is ticked, removed from `msg.payload` (`msg.hidden` lists them).

The **computed** type is a read-only field driven by a formula such as `{{quantity}} * {{price}}`. It updates live, is
included in `msg.payload`, and is **recomputed on the server** (whatever the browser sent is ignored). Formulas use a
small safe parser (no `eval` / `new Function`): arithmetic `+ - * / % ^`, comparisons, `&&` `||` `!`, string concat `&`,
`round(x, n)`, `floor`, `ceil`, `abs`, `min`, `max`, `sum`, `if(cond, a, b)`, `concat`, `len`, `upper`, `lower`,
`number`, `text`, `today()`, `days(from, to)` (subtracting two ISO dates also gives days). Display options: decimals,
prefix, suffix. Circular dependencies are rejected with `circular dependency: a → b → a`.

In JSON (`msg.schema`, templates):

```json
[
  { "key": "qty", "type": "number" }, { "key": "price", "type": "number" },
  { "key": "total", "type": "computed", "formula": "{{price}} * {{qty}}", "decimals": 2, "suffix": " ₽" },
  { "key": "discount", "type": "number",
    "visibleIf": { "match": "all", "rules": [{ "field": "total", "op": "gt", "value": 100 }] } },
  { "key": "address", "type": "text",
    "visibleIf":  { "match": "all", "rules": [{ "field": "delivery", "op": "eq", "value": "yes" }] },
    "requiredIf": { "match": "all", "rules": [{ "field": "delivery", "op": "eq", "value": "yes" }] } }
]
```

`op` is one of `eq`, `neq`, `gt`, `lt`, `gte`, `lte`, `contains`, `empty`, `notEmpty`, `in`. The same code
(`nodes/utils/templater.js`, mirrored to the dashboard by `scripts/sync-form-templater.js`) runs in the editor preview,
the dashboard and the server.

Notes: a formula still sees the value of a hidden field (wrap it with `if(...)` as in the example); disabled fields are not validated.

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

See `examples/form-builder-templates.json`, `examples/form-builder-dynamic.json` and `examples/form-builder-conditional.json` (order: total = price × qty, discount only if total > 100, address only if delivery = yes) (Import ▸ Examples ▸ @flowfuse/node-red-dashboard).
