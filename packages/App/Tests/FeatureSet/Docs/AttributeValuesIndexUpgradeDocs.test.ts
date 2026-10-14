import {
  DOCS_CONTENT_DIR,
  UPGRADING_PAGE,
  getHeadings,
  getSection,
  read,
} from "./KubernetesAiAgentDocsSupport";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "Common/Models/AnalyticsModels/Log";
import { ClickhouseAppInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import LogAggregationService from "Common/Server/Services/LogAggregationService";
import appendAttributeOperatorFilter from "Common/Server/Utils/AnalyticsDatabase/AttributeFilterStatement";
import { DEFAULT_CLICKHOUSE_CLUSTER_NAME } from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import {
  SQL,
  Statement,
} from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { ATTRIBUTE_VALUES_INDEX_NAME } from "Common/Types/AnalyticsDatabase/AttributeValueIndex";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import { ObjectType } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  ATTRIBUTE_VALUES_INDEX_MODELS,
  MaterializeInBackgroundOptions,
} from "../../../FeatureSet/Workers/DataMigrations/MaterializeAttributeValuesIndex";
import { describe, expect, it } from "@jest/globals";
import path from "path";

/*
 * The upgrade note for the attribute value index (#4706), and the tip on
 * the Search Syntax page: what gets faster and what does not, that nothing
 * needs doing, and how an operator follows or stops the background build.
 * The tables, the index name, the cluster name and the query limit the
 * note quotes are the code's own, so the note cannot drift from what the
 * upgrade does.
 */

const THIRTEEN_TO_FOURTEEN_HEADING: string =
  "## Upgrading from OneUptime 13 → 14";
const NOTE_HEADING: string =
  "### Searches by attribute value skip what cannot match";
const PREVIOUS_NOTE_HEADING: string = "### IPv6 Ping, Port and SSL monitors";
const NEXT_NOTE_HEADING: string =
  "### Kubernetes agent chart: the Kubernetes AI agent";

const SEARCH_PAGE: string = path.join(
  DOCS_CONTENT_DIR,
  "telemetry/search-syntax.md",
);
const GOOD_TO_KNOW_HEADING: string = "## Good to know";
const MATCHING_VALUES_HEADING: string = "## Matching values";

const SQL_BLOCK: RegExp = /```sql\n([\s\S]*?)\n```/g;
const WHITESPACE: RegExp = /\s+/g;
const QUERY_LIMIT: RegExp = /max_execution_time = (\d+)/;
const LIMIT_IN_NOTE: RegExp = /the (\d+)-second query limit/;
const VALUE_CHECK: RegExp = /has(Any)?\(mapValues\(attributes\)/;

function note(): string {
  return getSection(read(UPGRADING_PAGE), NOTE_HEADING);
}

function flat(text: string): string {
  return text.replace(WHITESPACE, " ").trim();
}

function tip(): string {
  const items: Array<string> = getSection(
    read(SEARCH_PAGE),
    GOOD_TO_KNOW_HEADING,
  )
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("- ") && line.includes("index");
    });

  expect(items).toHaveLength(1);

  return items[0]!;
}

// The predicate the charts compile for one operator on one attribute.
function chartPredicate(operator: Record<string, unknown>): string {
  const statement: Statement = SQL`WHERE true`;

  appendAttributeOperatorFilter({
    statement,
    attributeKey: "http.route",
    operator,
  });

  return statement.query;
}

describe("the attribute value index upgrade note", () => {
  it("sits in the 13 → 14 notes, between the IPv6 note and the Kubernetes agent chart note, once", () => {
    const headings: Array<string> = getHeadings(
      getSection(read(UPGRADING_PAGE), THIRTEEN_TO_FOURTEEN_HEADING),
    );
    const position: number = headings.indexOf(NOTE_HEADING);

    expect(position).toBeGreaterThan(-1);
    expect(headings[position - 1]).toBe(PREVIOUS_NOTE_HEADING);
    expect(headings[position + 1]).toBe(NEXT_NOTE_HEADING);
    expect(
      getHeadings(read(UPGRADING_PAGE)).filter((heading: string): boolean => {
        return heading === NOTE_HEADING;
      }),
    ).toHaveLength(1);
  });

  it("names the tables the upgrade indexes, as their models name them", () => {
    const tables: Array<string> = ATTRIBUTE_VALUES_INDEX_MODELS.map(
      (modelType: { new (): AnalyticsBaseModel }): string => {
        return new modelType().tableName;
      },
    );

    expect(tables).toEqual(["LogItemV3", "SpanItemV3"]);

    for (const table of tables) {
      expect(flat(note())).toContain(`\`${table}\``);
    }

    expect(flat(note())).toContain("the log and span tables");
  });

  it("quotes the query limit the charts run under", () => {
    const histogram: Statement = (
      LogAggregationService as any
    ).buildHistogramStatement({
      projectId: ObjectID.generate(),
      startTime: new Date("2026-10-12T00:00:00.000Z"),
      endTime: new Date("2026-10-13T00:00:00.000Z"),
      bucketSizeInMinutes: 30,
      attributes: { "http.route": "/orders" },
    });

    const limit: RegExpMatchArray | null = histogram.query.match(QUERY_LIMIT);
    const quoted: RegExpMatchArray | null = flat(note()).match(LIMIT_IN_NOTE);

    expect(limit).not.toBeNull();
    expect(quoted).not.toBeNull();
    expect(quoted![1]).toBe(limit![1]);
  });

  it("says nothing needs doing, and that boot adds the index without rewriting the tables", () => {
    const text: string = flat(note());
    const attributes: AnalyticsTableColumn = new Log().getTableColumn(
      "attributes",
    )!;
    const boot: Statement | null = new StatementGenerator<Log>({
      modelType: Log,
      database: ClickhouseAppInstance,
    }).toAddSkipIndexStatement(attributes);

    expect(text).toContain("Nothing to do.");
    expect(text).toContain("without rewriting them");
    // What boot schema-sync runs: the definition, and nothing that rewrites.
    expect(boot!.query).toContain(
      `ADD INDEX IF NOT EXISTS ${ATTRIBUTE_VALUES_INDEX_NAME} `,
    );
    expect(boot!.query).not.toContain("MATERIALIZE");
  });

  it("says the existing rows are indexed in the background, as the migration queues it", () => {
    const text: string = flat(note());

    expect(text).toContain("in the background");
    expect(text).toContain("it reads the attributes of every row once");
    expect(
      MaterializeInBackgroundOptions.clickhouseSettings?.mutations_sync,
    ).toBe("0");
  });

  it("gives the statements to follow and to stop the build, with the index's and the cluster's names", () => {
    const blocks: Array<string> = Array.from(note().matchAll(SQL_BLOCK)).map(
      (match: RegExpMatchArray): string => {
        return flat(match[1]!);
      },
    );

    expect(blocks).toEqual([
      `SELECT table, parts_to_do FROM system.mutations WHERE command LIKE '%${ATTRIBUTE_VALUES_INDEX_NAME}%' AND NOT is_done; KILL MUTATION ON CLUSTER '${DEFAULT_CLICKHOUSE_CLUSTER_NAME}' WHERE command LIKE '%${ATTRIBUTE_VALUES_INDEX_NAME}%';`,
    ]);
    expect(flat(note())).toContain(
      `(\`${DEFAULT_CLICKHOUSE_CLUSTER_NAME}\` is the default cluster name)`,
    );
    expect(flat(note())).toContain("`clickhouse-client`");
  });

  it("says what a stopped build leaves behind", () => {
    expect(flat(note())).toContain(
      "Days it has not reached are searched as before",
    );
  });
});

describe("the Search Syntax tip", () => {
  it("is a Good to know item that names forms the page's own table defines", () => {
    const matching: string = getSection(
      read(SEARCH_PAGE),
      MATCHING_VALUES_HEADING,
    );

    expect(tip()).toContain("`@k:(a OR b)`");
    expect(matching).toContain("| `@k:(a OR b)` | either value.");
    expect(tip()).toContain("`@http.route:/orders`");
    expect(tip()).toContain("a value clicked in the facet sidebar");
  });

  it("promises the index only to exact values, as the charts compile them", () => {
    expect(tip()).toContain("a search for an exact value");
    expect(tip()).toContain(
      "Wildcards, contains, exclusions and comparisons read every log line or span in the range",
    );

    // An exact value and "is any of" are checked against the index...
    expect(chartPredicate({ _type: ObjectType.EqualTo, value: "/a" })).toMatch(
      VALUE_CHECK,
    );
    expect(
      chartPredicate({ _type: ObjectType.Includes, value: ["/a", "/b"] }),
    ).toMatch(VALUE_CHECK);

    // ...wildcards, contains, exclusions and comparisons are not.
    for (const operator of [
      { _type: ObjectType.Wildcard, value: ["/a*"] },
      { _type: ObjectType.Search, value: "a" },
      { _type: ObjectType.NotEqual, value: "/a" },
      { _type: ObjectType.IncludesNone, value: ["/a"] },
      { _type: ObjectType.GreaterThan, value: 5 },
    ]) {
      expect(chartPredicate(operator)).not.toMatch(VALUE_CHECK);
    }
  });

  it("is about logs and traces, the two tables that carry the index", () => {
    expect(tip()).toContain("On logs and traces");
    expect(
      ATTRIBUTE_VALUES_INDEX_MODELS.map(
        (modelType: { new (): AnalyticsBaseModel }): string => {
          return new modelType().tableName;
        },
      ),
    ).toEqual(["LogItemV3", "SpanItemV3"]);
  });
});
