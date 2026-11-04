# Checks and Reconciliations

Table health says whether a table changes. A **check** says whether what it holds is right, a **reconciliation** says whether two copies of the data agree, and **dbt's tests** report on the tables dbt builds. Each one runs where the database's collection runs, by OneUptime or by its probe, and only a number leaves the database, unless a self-hosted project chooses to keep a masked sample of failing rows.

## Checks

Add a check on a table's **Checks** tab:

| Check | What it reads |
| --- | --- |
| **Null Percent** | Percent of rows whose column is empty |
| **Duplicate Percent** | Percent of values that repeat another row's |
| **Distinct Count** | How many different values the column holds |
| **Minimum**, **Maximum**, **Average**, **Sum** | Of a numeric column (a Sum of no rows is 0) |
| **Invalid Percent** | Percent of values outside a list you give |
| **Format Mismatch Percent** | Percent of values that are not in a format you pick, such as Email, UUID or Country Code, or that do not match a regular expression of yours (every engine but SQL Server) |
| **Orphan Count** | Rows whose value has no match in another table's column |
| **Row Count** | Rows in the table, most useful with **Segment By** |
| **Custom SQL** | The number one read-only SELECT of yours returns, named `value` (on MongoDB, an aggregation pipeline's) |
| **Failing Rows** | How many rows one read-only SELECT of yours returns: the rows that should not exist. 0 is healthy (on MongoDB, the documents a pipeline ends in) |

Each check runs every 15 minutes, hour, 6 hours or day, as one aggregate statement in a read-only transaction with a statement timeout. Its value is written as `oneuptime.data.check.value`, with `oneuptime.data.check.id`, `oneuptime.data.check.name` and `oneuptime.data.check.segment`.

## Suggested checks

**Suggested Checks** on the same tab offer the checks a table's columns call for, from their names and types alone: an id is unique, a `customer_id` has a matching row in `customers`, an email looks like one, an amount is not negative, a status keeps its usual values, and a table split by tenant is counted per tenant. A column Data Security knows holds an email address, a phone number or an IP address is held to that format, whatever it is called. Add one, add them all, or dismiss one for good.

## A check from a sentence

**Write a Check from a Sentence** turns a rule such as "orders never have a negative total" into a Custom SQL check that counts the rows breaking it, in your engine's own SQL, with an alert when any do. You read the query before **Add Check** adds it, and it is held to everything any Custom SQL check is. It needs OneUptime AI to be on for the project. On MongoDB, it writes an aggregation pipeline instead.

## Segments

**Segment By** runs a check once per value of a column, such as a tenant or a region: one series and one alert each, for the largest 100 segments. A segmented Row Count alerts when one tenant stops sending data while the others carry on.

## Alerts on a check

Set **Alert When** to alert on a check:

- **Unusually High** or **Unusually Low** compares each value with its own learned baseline for that hour of the week.
- **Above** or **Below** compares it with a threshold.

Saving the check makes a metric monitor for it, as you and with your permissions. Clearing the condition removes the monitor.

## What a check costs

A check competes with your application for the database, and on a warehouse that bills by what a query reads, it costs money. Three things keep that in hand:

- **Sample Percent** reads a share of the rows instead of all of them, for a check that reads a rate: Null Percent, Average, Invalid Percent and Format Mismatch Percent. Most engines skip whole pages of the table; MySQL, Redshift, ClickHouse and MongoDB still read every row, and are spared the work on the rest. A view can refuse it, and the check says so.
- **Most a Check May Read (GB)**, under **Settings**, stops a check on BigQuery or Athena before it reads more than that many gigabytes. It is 10 until you change it.
- **Wait When a Database Is Busy**, under **Settings**, leaves due checks for the next collection when a PostgreSQL, MySQL or SQL Server database looks busy. It is on until you turn it off, and the database says when checks waited.

## Failing rows

A number says something is wrong; a few rows say what. On a self-hosted OneUptime, **Keep Failing Rows** under **Settings** keeps up to 20 of the rows a Failing Rows, Invalid Percent, Format Mismatch Percent or Orphan Count check found, and **Failing Rows** on the check shows them. Sensitive columns are masked where the row is read, by what Data Security found in them or by their names, so what leaves the database, or a probe, is already masked. OneUptime Cloud keeps none.

## Checks in a file

Checks written by hand drift from the code that changes the tables. Keep them in your repository, reviewed in the same pull request:

```yaml
checks:
  - name: Orders have a total
    table: public.orders
    type: Null Percent
    column: total
    every: 60
    alert: { when: Above, threshold: 1 }
  - name: Emails look right
    table: public.customers
    database: Orders database
    type: Format Mismatch Percent
    column: email
    format: Email
    sample_percent: 10
  - name: Orders have a customer
    table: public.orders
    type: Orphan Count
    column: customer_id
    references: public.customers.id
  - name: No negative totals
    table: public.orders
    type: Failing Rows
    query: SELECT id FROM orders WHERE total < 0
    alert: { when: Above, threshold: 0 }
```

Apply it from CI with the [OneUptime CLI](/docs/cli/index) and an API key:

```bash
oneuptime data-checks apply checks.yaml --dry-run
oneuptime data-checks apply checks.yaml --prune
```

A check is the same check if it has the same name on the same table, so applying a file twice changes nothing. A mistake anywhere in the file applies nothing and exits with an error, so run `--dry-run` on the pull request and apply on merge. With `--prune`, a check an earlier apply made that the file no longer names is deleted. A check you added by hand never is. A check from a file says so on its row, and its next apply overwrites what was changed by hand.

The keys are `name`, `table`, `database`, `type`, `column`, `segment`, `accepted_values`, `format`, `pattern`, `references`, `query`, `sample_percent`, `every`, `alert`, `description` and `enabled`.

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
