Find reads records. **Query** picks which ones, **Select Fields** picks what comes back. Both are keyed on this model's column names, which the row editor lists for you.

## The ID column is `_id`

In the dashboard, in the API and on the record itself an ID is called `id`. In the database the column is `_id`. Both spellings work here, but `_id` is what the record gives back, so prefer it:

```json
{ "_id": "09dc4d63-2fc3-4757-a509-5f688ae38ffd" }
```

## Query

Keys are columns, values are what to match:

```json
{ "monitorType": "Website", "isEnabled": true }
```

A query is always scoped to the current project. You cannot reach another project's records from a workflow.

## Nothing matched is not an error

**Find One** returns `Model: null` and still takes the **Success** port. Referencing a field of that null record downstream ships the reference text itself, not a value — so if the workflow depends on having found something, test for it with an **If / Else** component.

**Find Many** returns at most **Limit** records, 10 by default.

## When it fails

A failed component takes the **Error** port and writes the reason to the workflow log. If a Query key is not a column, the log also lists every column the model does have — the fastest way to spot a typo.

An unconnected Error port simply ends that branch.
