import {
  DOCS_CONTENT_DIR,
  UPGRADING_PAGE,
  getHeadings,
  getSection,
  read,
} from "./KubernetesAiAgentDocsSupport";
import { sectionAtEnglishPlace } from "./UpgradingDocsNotes";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
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
 *
 * The statement that follows the build and the one that stops it are code
 * blocks of their own, in every language: a block's Copy button copies the
 * whole block, and a reader who copied a block holding both to see how far
 * the build had got would have stopped it.
 */

const THIRTEEN_TO_FOURTEEN_HEADING: string =
  "## Upgrading from OneUptime 13 → 14";
const NOTE_HEADING_TEXT: string =
  "Log and trace searches by attribute value use an index";
const NOTE_HEADING: string = `### ${NOTE_HEADING_TEXT}`;
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
const KILL_STATEMENT: RegExp = /\bKILL\s+MUTATION\b/i;
const SELECT_STATEMENT: RegExp = /\bSELECT\b/i;
const WHITESPACE: RegExp = /\s+/g;
const QUERY_LIMIT: RegExp = /max_execution_time = (\d+)/;
const LIMIT_IN_NOTE: RegExp = /the (\d+)-second query limit/;
const VALUE_CHECK: RegExp = /has(Any)?\(mapValues\(attributes\)/;

function note(): string {
  return getSection(read(UPGRADING_PAGE), NOTE_HEADING);
}

// The note's SQL blocks, in order, each read as one line.
function sqlBlocks(markdown: string): Array<string> {
  return Array.from(markdown.matchAll(SQL_BLOCK)).map(
    (match: RegExpMatchArray): string => {
      return flat(match[1]!);
    },
  );
}

const FOLLOW_STATEMENT: string = `SELECT table, parts_to_do FROM system.mutations WHERE command LIKE '%${ATTRIBUTE_VALUES_INDEX_NAME}%' AND NOT is_done;`;
const STOP_STATEMENT: string = `KILL MUTATION ON CLUSTER '${DEFAULT_CLICKHOUSE_CLUSTER_NAME}' WHERE command LIKE '%${ATTRIBUTE_VALUES_INDEX_NAME}%';`;

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
    expect(sqlBlocks(note())).toEqual([FOLLOW_STATEMENT, STOP_STATEMENT]);
    expect(flat(note())).toContain(
      `(\`${DEFAULT_CLICKHOUSE_CLUSTER_NAME}\` is the default cluster name)`,
    );
    expect(flat(note())).toContain("`clickhouse-client`");
  });

  it("keeps the statement that stops the build out of the block that follows it, so copying one never runs the other", () => {
    const blocks: Array<string> = sqlBlocks(note());

    expect(blocks).toHaveLength(2);
    expect(SELECT_STATEMENT.test(blocks[0]!)).toBe(true);
    expect(KILL_STATEMENT.test(blocks[0]!)).toBe(false);
    expect(KILL_STATEMENT.test(blocks[1]!)).toBe(true);
    expect(SELECT_STATEMENT.test(blocks[1]!)).toBe(false);
  });

  it("says what the progress query shows once the indexing is done, as the query reads it", () => {
    // Only mutations still running are listed...
    expect(FOLLOW_STATEMENT).toContain("AND NOT is_done");
    // ...so a finished build lists nothing, which the note says.
    expect(flat(note())).toContain(
      "It lists each table still being indexed with the number of parts left, and nothing once the indexing is done:",
    );
  });

  it("says when to stop the build, and what a stopped build leaves behind", () => {
    expect(flat(note())).toContain(
      "If the indexing slows a very large install down, stop it",
    );
    expect(flat(note())).toContain(
      "Days it has not reached are then searched as before, until they are merged again or age out.",
    );
  });

  it("says a value most rows carry gains little, rather than that it is read as before", () => {
    expect(flat(note())).toContain(
      "A value most rows carry, such as `GET`, gains little",
    );
    expect(flat(note())).not.toContain("is read as before");
  });

  it("carries the same two statements, follow first, in every language", () => {
    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      expect({
        language,
        blocks: sqlBlocks(sectionAtEnglishPlace(language, NOTE_HEADING_TEXT)),
      }).toEqual({ language, blocks: [FOLLOW_STATEMENT, STOP_STATEMENT] });
    }
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
    expect(tip()).toContain("an exact value, such as");
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

  it("promises speed only for a value few rows carry, as the upgrade note does, and says what to do when a search is slow", () => {
    expect(tip()).toContain(
      "so a search for a value few rows carry stays quick over long time ranges",
    );
    expect(flat(note())).toContain("It helps most with a value few rows carry");
    expect(tip()).toContain(
      "when one is slow, add an exact value or pick a shorter range",
    );
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
