Create writes new records. The fields are this model's own columns, which the row editor lists for you. `_id` is generated — you never set it here.

## Unknown column names are dropped

A key that is not a column on this model is ignored and the record is written without it. The workflow log names anything it ignored, along with the columns you could have used.

If a **required** column ends up missing because of a typo, the component takes the **Error** port and the log reads `<column> is required`. An optional one just goes quietly missing, so check the log if a record comes out emptier than you expected.

## The project is set for you

Records are always created in the project the workflow runs in. You do not set the project column, and a value supplied for it is ignored.

## What comes back

`Model` is the record that was written, including its new `_id`. The **Returns** panel above shows the exact reference another step uses to read it.

## Create Many

Create Many takes a JSON array and keeps the raw editor, because rows cannot represent a list. Each element is one record, keyed on the same column names.

```json
[{ "name": "First" }, { "name": "Second" }]
```
