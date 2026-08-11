These components read and write OneUptime records directly. Every one of them is keyed on **column names**, so the whole job is knowing what the columns are called.

## The ID column is `_id`

This is the one that catches everyone out. In the dashboard, in the API and on the record itself, an ID is called `id`. In the database the column is `_id`.

Both spellings work here — `id` is accepted everywhere as an alias for `_id` — but `_id` is what the record actually gives you back, so prefer it:

```json
{ "_id": "09dc4d63-2fc3-4757-a509-5f688ae38ffd" }
```

## Finding column names

Use the **Select Fields** picker on any Find component: it lists every column on the model, with its type, and it searches. The names it shows are exactly the names Query and Data expect.

Related records nest one level:

```json
{ "monitorStatus": { "_id": true, "name": true } }
```

## Query

Query decides which records the component acts on. Keys are column names, values are what to match:

```json
{ "monitorType": "Website", "isEnabled": true }
```

A query is always scoped to the current project — you cannot reach another project's records from a workflow.

## Data

Data is what gets written, again keyed on column names:

```json
{ "currentMonitorStatusId": "dfadda01-fdf6-4cdd-921d-73edcfd71124" }
```

For a monitor, note that writing `currentMonitorStatusId` sets the status field but does **not** add an entry to the monitor's status timeline. To record a status change the way the rest of the product does, use **Create One Monitor Status Timeline** instead.

## Knowing whether it worked

**Update** and **Delete** components return `Items Updated` / `Items Deleted`. A query that matched nothing returns `0` and still takes the **Success** port — that is not a failure, it just means nothing matched. If a workflow must react to that, wire the count into a Condition component.

The workflow log records the count on every run.

## When it fails

A failed component takes the **Error** port and writes the reason to the workflow log. If the reason is an unknown column, the log also lists every column the model does have — that list is the fastest way to spot a typo.

Connect something to the Error port if the workflow should react to a failure. An unconnected Error port simply ends that branch.
