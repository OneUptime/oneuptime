# Data Products

The people who use data - analysts, finance, executives, AI agents - think in what they use: "the revenue dashboard's tables", not databases. A **data product** names those tables, with its owner, its consumers and its freshness SLA, and tells everyone who depends on it whether today's data is in.

## Create a data product

Under **Data Observability > Data Products**, create a data product: name it, pick its tables, and give it an SLA of either or both of:

- **Fresh by a time of day (UTC):** each day's data lands that day, by then. From that time, every table must have changed that day; until then, yesterday's load stands. A load that is always half an hour late is late for that half hour every day.
- **A maximum age:** no table's last change may be older than this.

Every five minutes each product's tables are checked against its SLA. The product is **Late** when any table is, and its data is as of the oldest last change among them. It writes `oneuptime.data.product.late_tables` and `oneuptime.data.product.data_age`, so you can chart every product's freshness side by side.

## On status pages

Saving a product also makes a **monitor** for it, as you and with your permissions. The monitor is Degraded while a table is late, and opens an incident and an alert at your project's least severe level, which resolve on their own. Add it to a status page, private or public, as a resource: consumers who subscribe hear when the product is late, and when it is fresh again. See [Status Page Resources](/docs/status-pages/resources-and-groups).

## As an SLO

Saving a product also makes an **SLO** over its monitor: the share of the time the data is on time, against the product's target over 30 days, with the fast and slow burn-rate alerts every SLO starts with. See [SLOs](/docs/slo/introduction). Deleting the product deletes its monitor and its SLO.

## The "data as of" badge

Each product has a **badge** that says what its data is as of, green while on time and amber with "late" once not. Embed it in a BI dashboard, a wiki page or a README from the product's **Overview**:

```markdown
![Data as of](https://oneuptime.com/api/data-observability/data-products/<data product ID>/badge?token=<badge token>)
```

Its link needs no sign-in, so treat it like a shared link. **Reset Badge Link** makes a new one and retires the old.

## Next steps

:::cards
- [Table Health](/docs/data-observability/table-health): How each table's freshness is learned.
- [OneUptime AI and the API](/docs/data-observability/ai-and-api): Let AI agents check a product's tables before they use them.
:::
