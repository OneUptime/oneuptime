Update changes existing records. **Query** picks which ones, **Data** holds the new values. Both are keyed on this model's column names, which the row editor lists for you.

## Query first

A query that matches nothing updates nothing:

```json
{ "monitorType": "Website" }
```

The ID column is `_id`, not `id` — though `id` is accepted as an alias.

## Update Many stops at Limit

Update Many touches at most **Limit** records, **10 by default**. `Items Updated: 10` means ten were updated, not that ten matched. Raise Limit if you meant all of them.

## Zero updated is not an error

`Items Updated: 0` takes the **Success** port. It only means the query matched nothing. If the workflow should react to that, wire the count into an **If / Else** component.

## Writing a status is not the same as recording one

Setting a status column changes the field but does not add an entry to the record's status timeline. To record a change the way the rest of the product does, create the matching timeline record instead.

## When it fails

A failed component takes the **Error** port and writes the reason to the workflow log. If a Query key is not a column, the log also lists every column the model does have.
