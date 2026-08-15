Delete removes records matching a **Query**, keyed on this model's column names. Deletes are not undoable from a workflow.

## Query

The ID column is `_id`, though `id` is accepted as an alias:

```json
{ "_id": "09dc4d63-2fc3-4757-a509-5f688ae38ffd" }
```

A query is always scoped to the current project.

## Delete Many stops at Limit

Delete Many removes at most **Limit** records, **10 by default**. `Items Deleted: 10` means ten were deleted, not that ten matched — run it again, or raise Limit, if you meant all of them.

## An empty query is not a filter

`{}` matches every record in the project. On Delete Many that deletes the first ten of them. Make sure the query says what you mean before saving.

## Zero deleted is not an error

`Items Deleted: 0` takes the **Success** port and means nothing matched. If the workflow should react to that, wire the count into an **If / Else** component.

## When it fails

A failed component takes the **Error** port and writes the reason to the workflow log. If a Query key is not a column, the log also lists every column the model does have.
