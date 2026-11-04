# Checks and Reconciliations

Table health says whether a table changes. A **check** says whether what it holds is right, a **reconciliation** says whether two copies of the data agree, and **dbt's tests** report on the tables dbt builds. Each one runs where the database's collection runs, by OneUptime or by its probe, and only a number ever leaves the database.

## Checks

Add a check on a table's **Checks** tab:

| Check | What it reads |
| --- | --- |
| **Null Percent** | Percent of rows whose column is empty |
| **Duplicate Percent** | Percent of values that repeat another row's |
| **Distinct Count** | How many different values the column holds |
| **Minimum**, **Maximum**, **Average**, **Sum** | Of a numeric column (a Sum of no rows is 0) |
| **Invalid Percent** | Percent of values outside a list you give |
| **Format Mismatch Percent** | Percent of values that do not match a regular expression (every engine but SQL Server) |
| **Orphan Count** | Rows whose value has no match in another table's column |
| **Row Count** | Rows in the table, most useful with **Segment By** |
| **Custom SQL** | The number one read-only SELECT of yours returns, named `value` (on MongoDB, an aggregation pipeline's) |

Each check runs every 15 minutes, hour, 6 hours or day, as one aggregate statement in a read-only transaction with a statement timeout. Its value is written as `oneuptime.data.check.value`, with `oneuptime.data.check.id`, `oneuptime.data.check.name` and `oneuptime.data.check.segment`.

## Suggested checks

**Suggested Checks** on the same tab offer the checks a table's columns call for, from their names and types alone: an id is unique, a `customer_id` has a matching row in `customers`, an email looks like one, an amount is not negative, a status keeps its usual values, and a table split by tenant is counted per tenant. Add one, add them all, or dismiss one for good.

## A check from a sentence

**Write a Check from a Sentence** turns a rule such as "orders never have a negative total" into a Custom SQL check that counts the rows breaking it, in your engine's own SQL, with an alert when any do. You read the query before **Add Check** adds it, and it is held to everything any Custom SQL check is. It needs OneUptime AI to be on for the project.

## Segments

**Segment By** runs a check once per value of a column, such as a tenant or a region: one series and one alert each, for the largest 100 segments. A segmented Row Count alerts when one tenant stops sending data while the others carry on.

## Alerts on a check

Set **Alert When** to alert on a check:

- **Unusually High** or **Unusually Low** compares each value with its own learned baseline for that hour of the week.
- **Above** or **Below** compares it with a threshold.

Saving the check makes a metric monitor for it, as you and with your permissions. Clearing the condition removes the monitor.

## Reconciliations

Copies drift: the warehouse has fewer orders than the application's database, or a migration lost rows. A reconciliation compares one measure of two tables, in one database or two, under **Reconciliations**:

- **Row Count**
- **Sum** of a column
- **Distinct Count** of a column
- **Custom SQL**: a read-only query that returns one number, named `value`

It has a tolerance: an **Absolute** amount, or a **Percent** of the source's value. Each side is read by a check of its own, which the reconciliation makes and keeps, with its database's collection, so a reconciliation can compare a PostgreSQL table in your network with its copy in Snowflake. The two values are compared once both have been read within 15 minutes of each other. A reconciliation writes:

- `oneuptime.data.reconciliation.drifted`: 1 when the two have drifted beyond the tolerance, 0 when they agree. Its monitor reads this.
- `oneuptime.data.reconciliation.difference`: the target's value less the source's.
- `oneuptime.data.reconciliation.difference_percent`: the difference as a percentage of the source's value.

A copy loaded on a schedule lags its source: compare a measure both have settled on, such as rows older than an hour, with Custom SQL, or allow for the lag in the tolerance.

## dbt tests

After a dbt build, `oneuptime dbt upload` sends the project's artifacts (see [Lineage and Pipelines](/docs/data-observability/lineage-and-pipelines)). Each test of a watched table then shows on its **Checks** tab, with its last result and the rows it found failing. Choose **Alert on Failures** to have a failing test open an alert.

## Next steps

:::cards
- [Lineage and Pipelines](/docs/data-observability/lineage-and-pipelines): Send dbt's artifacts, and see the run behind a failing check.
- [Data Products](/docs/data-observability/data-products): Promise the people who use the data that it is fresh.
:::
