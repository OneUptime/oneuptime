import { describe, expect, test } from "@jest/globals";
import CloudCost from "../../../Models/AnalyticsModels/CloudCost";
import ClickhouseDatabase from "../../../Server/Infrastructure/ClickhouseDatabase";
import { CloudCostService } from "../../../Server/Services/CloudCostService";
import AggregateBy from "../../../Server/Types/AnalyticsDatabase/AggregateBy";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { CLOUD_COST_TAG_KEY_MAX_LENGTH } from "../../../Types/Cloud/CloudCost";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";

/*
 * The costs summed by one tag's value - Cloud > Costs' breakdown by tag,
 * through the same /aggregate every analytics model answers: the one key
 * asked, never more and never written into the text; each row carrying
 * { [key]: value } as its attributes; the costs' filter, the time bucket
 * when one is asked and the columns asked beside it. Every other
 * aggregate is the generic one. (CloudCostWriterClickhouseIntegration runs
 * these statements against a real ClickHouse.)
 */

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-0000000000a1");
const START: Date = new Date("2026-11-01T00:00:00.000Z");
const END: Date = new Date("2026-11-20T12:00:00.000Z");

function service(): CloudCostService {
  const created: CloudCostService = new CloudCostService();
  created.database = {
    getDatasourceOptions: (): { database: string } => {
      return { database: "oneuptime" };
    },
  } as unknown as ClickhouseDatabase;
  return created;
}

/*
 * A statement with its parameters written in - identifiers bare, values as
 * JSON - so what it groups and orders by reads as it runs. A plain scan for
 * each "{name:" placeholder, never a pattern built from the name.
 */
function inline(statement: Statement): string {
  let text: string = statement.query;

  for (const [name, value] of Object.entries(
    statement.query_params as Record<string, unknown>,
  )) {
    const opening: string = `{${name}:`;
    let start: number = text.indexOf(opening);

    while (start >= 0) {
      const end: number = text.indexOf("}", start);
      const type: string = text.slice(start + opening.length, end);
      const written: string =
        type === "Identifier" ? String(value) : JSON.stringify(value);

      text = text.slice(0, start) + written + text.slice(end + 1);
      start = text.indexOf(opening);
    }
  }

  return text.split("\n").join(" ");
}

function aggregateBy(
  overrides: Partial<AggregateBy<CloudCost>> = {},
): AggregateBy<CloudCost> {
  return {
    query: {
      projectId: PROJECT,
      currency: "USD",
      day: new InBetween<Date>(START, END),
    } as AggregateBy<CloudCost>["query"],
    aggregationType: AggregationType.Sum,
    aggregateColumnName: "cost",
    aggregationTimestampColumnName: "day",
    aggregationInterval: AggregationInterval.Total,
    startTimestamp: START,
    endTimestamp: END,
    limit: 10000,
    skip: 0,
    sort: { day: SortOrder.Ascending },
    props: { isRoot: true },
    ...overrides,
  } as AggregateBy<CloudCost>;
}

describe("the tag a breakdown is by", () => {
  test("the one key asked, trimmed; none asked is no breakdown by tag", () => {
    expect(CloudCostService.getTagKey([" team "])).toBe("team");
    expect(CloudCostService.getTagKey(undefined)).toBeNull();
    expect(CloudCostService.getTagKey([])).toBeNull();
    expect(CloudCostService.getTagKey(["", "  "])).toBeNull();
    expect(CloudCostService.getTagKey([7 as unknown as string, "env"])).toBe(
      "env",
    );
  });

  test("two at once, or one longer than a tag's key may be, is refused", () => {
    expect(() => {
      CloudCostService.getTagKey(["team", "env"]);
    }).toThrow(BadDataException);
    expect(() => {
      CloudCostService.getTagKey([
        "t".repeat(CLOUD_COST_TAG_KEY_MAX_LENGTH + 1),
      ]);
    }).toThrow(`at most ${CLOUD_COST_TAG_KEY_MAX_LENGTH} characters`);
    expect(
      CloudCostService.getTagKey(["t".repeat(CLOUD_COST_TAG_KEY_MAX_LENGTH)]),
    ).toHaveLength(CLOUD_COST_TAG_KEY_MAX_LENGTH);
  });
});

describe("the statement", () => {
  test("the costs summed by the tag's value, as attributes, the key a bound parameter, never written into the text", () => {
    const key: string = "team'; DROP TABLE CloudCostV1; --";
    const built: { statement: Statement; columns: Array<string> } =
      service().toAggregateStatement(
        aggregateBy({ groupByAttributeKeys: [key] }),
      );
    const text: string = inline(built.statement);

    expect(built.statement.query).toContain("sum(cost) as cost");
    expect(built.statement.query).toContain("min(day) as day");
    expect(built.statement.query).toContain("AS attributes");
    expect(built.statement.query).toContain("GROUP BY attributes");
    expect(text).toContain("FROM oneuptime.CloudCostV1");
    expect(text).toContain(
      `map(${JSON.stringify(key)}, tags[${JSON.stringify(key)}]) AS attributes`,
    );
    // The key is a value bound to the statement: never part of its text.
    expect(built.statement.query).not.toContain("DROP TABLE");
    expect(
      Object.values(built.statement.query_params).filter((value: unknown) => {
        return value === key;
      }),
    ).toHaveLength(2);
    expect(Object.values(built.statement.query_params)).toContain(
      PROJECT.toString(),
    );
    // A whole window is one row a value: no time bucket to group by.
    expect(built.statement.query).not.toContain("GROUP BY day");
    expect(built.statement.query).toContain("max_execution_time");
    expect(built.columns).toEqual(["cost", "day", "attributes"]);
  });

  test("the columns asked beside it are grouped by and returned too; a bucketed read groups by its day first", () => {
    const built: { statement: Statement; columns: Array<string> } =
      service().toAggregateStatement(
        aggregateBy({
          groupByAttributeKeys: ["team"],
          groupBy: { accountId: true, region: true },
          aggregationInterval: AggregationInterval.Day,
        }),
      );

    expect(inline(built.statement)).toContain(
      "GROUP BY day, attributes, accountId, region ORDER BY",
    );
    expect(inline(built.statement)).toContain(
      "AS attributes, accountId, region FROM",
    );
    expect(built.columns).toEqual([
      "cost",
      "day",
      "attributes",
      "accountId",
      "region",
    ]);
  });

  test("ordered as asked, else the costliest first; limited and offset as asked", () => {
    const asked: Statement = service().toAggregateStatement(
      aggregateBy({ groupByAttributeKeys: ["team"], skip: 20, limit: 10 }),
    ).statement;

    expect(inline(asked)).toContain("ORDER BY day ASC");
    expect(Object.values(asked.query_params)).toEqual(
      expect.arrayContaining([10, 20]),
    );

    const unsorted: Statement = service().toAggregateStatement(
      aggregateBy({ groupByAttributeKeys: ["team"], sort: {} }),
    ).statement;

    expect(unsorted.query).toContain("ORDER BY cost DESC");
  });

  test("a percentile is a quantile, as the generic aggregate compiles it", () => {
    const built: Statement = service().toAggregateStatement(
      aggregateBy({
        groupByAttributeKeys: ["team"],
        aggregationType: AggregationType.P95,
      }),
    ).statement;

    expect(built.query).toContain("quantile(0.95)(cost) as cost");
    expect(built.query).not.toContain("p95(");
  });

  test("a column the costs do not have is refused, beside a tag as anywhere", () => {
    expect(() => {
      service().toAggregateStatement(
        aggregateBy({
          groupByAttributeKeys: ["team"],
          groupBy: { nothing: true } as never,
        }),
      );
    }).toThrow(BadDataException);
  });

  test("no tag asked: the generic aggregate, as every analytics model's", () => {
    const generic: Statement = service().toAggregateStatement(
      aggregateBy({ groupBy: { service: true } }),
    ).statement;

    expect(generic.query).not.toContain("attributes");
    expect(inline(generic)).toContain("GROUP BY service");
  });
});
