import {
  AliasShadow,
  SqlText,
  countSelects,
  findAliasShadows,
  findAliasesSpellingColumns,
  isAggregateFunction,
  isPostgresSql,
  listServerSourceFiles,
  sqlTextsOf,
} from "../../../Helpers/ClickhouseAliasScan";
import { REPOSITORY_DIRECTORY } from "../../../Helpers/TagStripScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * GUARD: NO SELECT ALIAS SPELLS A COLUMN THAT ANOTHER PART OF ITS SELECT
 * READS (issue #5157).
 *
 * ClickHouse reads a name as an alias of the SELECT before it reads it as a
 * column - under its current analyzer and the older one alike. The threat
 * intel queries wrote `max(confidence) AS confidence` beside
 * `argMax(stixId, confidence)` and `max(version) AS version` beside
 * `argMax(validFrom, version)`: each argMax then read the max() - an
 * aggregate inside an aggregate - and every match, enrichment and poll
 * query failed with ILLEGAL_AGGREGATION, so no feed ever held an indicator
 * and no event ever matched one. The session replay finalizer, the session
 * replay reads and the generic aggregate statements had met the same rule
 * before (their comments say so), each on its own.
 *
 * This reads every string and template literal of the server code that
 * builds SQL (Helpers/ClickhouseAliasScan: each literal, and each function's
 * literals joined in order, since a statement is often appended in pieces)
 * and fails on an alias that spells a column (its own expression reads the
 * name) when another expression reads that name inside an aggregate, or a
 * WHERE or PREWHERE reads it - the query fails, or quietly reads the
 * expression instead of the column. Name such an alias for what it holds
 * (confidenceLatest, versionLatest), or qualify the column (t.time), as
 * StatementGenerator does for the aggregate statements (QualifiedColumn).
 *
 * The detector is pinned on SQL written here first - the very statements
 * issue #5157 quotes among them - then run over the real tree with checks
 * that it read it.
 */

// The statement the matcher sent, as the issue's server log quotes it.
const ISSUE_5157_MATCH_STATEMENT: string = `SELECT i.indicatorValue AS indicatorValue, any(i.stixId) AS stixId, any(i.indicatorType) AS indicatorType, any(i.indicatorName) AS indicatorName, any(i.confidence) AS confidence, count() AS matchCount, any(e.message) AS sampleMessage, arrayDistinct(arrayFlatten(groupArray(20)(e.observables))) AS sampleObservables FROM oneuptime.SecurityEventItemV1 AS e ARRAY JOIN e.observables AS matchedObservable GLOBAL INNER JOIN (SELECT indicatorValue, argMax(stixId, confidence) AS stixId, argMax(indicatorType, confidence) AS indicatorType, argMax(indicatorName, confidence) AS indicatorName, max(confidence) AS confidence FROM (SELECT indicatorValue, stixId, argMax(feedName, version) AS feedName, argMax(indicatorType, version) AS indicatorType, argMax(indicatorName, version) AS indicatorName, argMax(confidence, version) AS confidence, argMax(revoked, version) AS revokedLatest, argMax(validFrom, version) AS validFromLatest, argMax(validUntil, version) AS validUntilLatest FROM oneuptime.ThreatIntelIndicatorItemV1 WHERE (projectId = 'a0ea4f6c-8276-44eb-acd8-f9d0346d4d20') AND (feedId = 'eaf1b3b2-84f2-4e4b-b047-7e7e3ba4ff14') GROUP BY indicatorValue, stixId HAVING (revokedLatest = false) AND (validFromLatest <= _CAST('1792414320.408', 'DateTime64(9)')) AND (validUntilLatest > _CAST('1792414320.408', 'DateTime64(9)'))) GROUP BY indicatorValue) AS i ON lowerUTF8(matchedObservable) = i.indicatorValue WHERE (e.projectId = 'a0ea4f6c-8276-44eb-acd8-f9d0346d4d20') AND (e.time >= _CAST('1792414260.385', 'DateTime64(9)')) AND (e.time < _CAST('1792414320.408', 'DateTime64(9)')) AND (e.classUid != _CAST(2004, 'Int32')) GROUP BY i.indicatorValue ORDER BY matchCount DESC LIMIT _CAST(100, 'Int32') SETTINGS max_execution_time = 60 FORMAT JSON`;

// The poller's read of what a feed already stores, before the fix.
const ISSUE_5157_VERSIONS_STATEMENT: string = `SELECT
  stixId,
  indicatorValue,
  argMax(indicatorType, version) AS indicatorType,
  argMax(indicatorName, version) AS indicatorName,
  argMax(confidence, version) AS confidence,
  max(version) AS version,
  argMax(validFrom, version) AS validFrom,
  argMax(validUntil, version) AS validUntil,
  max(retentionDate) AS retentionDate
FROM oneuptime.ThreatIntelIndicatorItemV1
WHERE projectId = {p0:String} AND feedId = {p1:String} AND stixId IN {p2:Array(String)}
GROUP BY stixId, indicatorValue`;

function aliasesOf(shadows: Array<AliasShadow>): Array<string> {
  return Array.from(
    new Set(
      shadows.map((shadow: AliasShadow): string => {
        return `${shadow.alias} (${shadow.kind}, ${shadow.readIn})`;
      }),
    ),
  ).sort();
}

describe("the detector", () => {
  test("names the aliases issue #5157's statements failed on", () => {
    expect(aliasesOf(findAliasShadows(ISSUE_5157_MATCH_STATEMENT))).toEqual([
      "confidence (aggregate-inside-aggregate, SELECT)",
    ]);
    expect(aliasesOf(findAliasShadows(ISSUE_5157_VERSIONS_STATEMENT))).toEqual([
      "version (aggregate-inside-aggregate, SELECT)",
    ]);
  });

  test("names an aggregate's alias read in WHERE or PREWHERE", () => {
    expect(
      aliasesOf(
        findAliasShadows(
          "SELECT name, max(confidence) AS confidence FROM t WHERE confidence > 10 GROUP BY name",
        ),
      ),
    ).toEqual(["confidence (aggregate-in-where, WHERE)"]);
    expect(
      aliasesOf(
        findAliasShadows(
          "SELECT sum(bytes) AS bytes FROM t PREWHERE bytes > 0 GROUP BY host",
        ),
      ),
    ).toEqual(["bytes (aggregate-in-where, PREWHERE)"]);
  });

  test("names any other alias a WHERE or another expression reads in place of its column", () => {
    expect(
      aliasesOf(
        findAliasShadows(
          "SELECT toStartOfInterval(time, INTERVAL 1 minute) AS time, count() AS hits FROM t WHERE time >= {start:DateTime64} GROUP BY time",
        ),
      ),
    ).toEqual(["time (reads-the-alias, WHERE)"]);
    expect(
      aliasesOf(
        findAliasShadows(
          "SELECT lowerUTF8(host) AS host, length(host) AS hostLength FROM t",
        ),
      ),
    ).toEqual(["host (reads-the-alias, SELECT)"]);
  });

  test("leaves alone what reads as meant", () => {
    const meant: Array<string> = [
      // An alias of a new name, read by a window function and ORDER BY.
      "SELECT countIf(__isProblem = 1) AS groupCount, maxIf(time, __isProblem = 0) > maxIf(time, __isProblem = 1) AS isResolved, sum(groupCount) OVER (PARTITION BY isResolved) AS totalCount FROM (SELECT time, 1 AS __isProblem FROM t) ORDER BY isResolved ASC, groupCount DESC",
      // A self-alias read nowhere else: the latest version of each column.
      "SELECT metricPointId, argMax(time, version) AS time, argMax(value, version) AS value FROM t WHERE projectId = {p:String} GROUP BY metricPointId",
      // The alias of a new name, read by WHERE on purpose.
      "SELECT attributes['db.system'] AS dbSystem, count() AS calls FROM t WHERE dbSystem != '' GROUP BY dbSystem",
      // Columns repeated under their own names.
      "SELECT tabId AS tabId, e.message AS message, sum(errors) AS errorCount FROM t AS e WHERE tabId != '' GROUP BY tabId, message",
      // Qualified reads are the columns, whatever the aliases are.
      "SELECT min(t.time) AS time, avg(t.value) AS value FROM metrics AS t WHERE t.time >= now() - 60 AND t.value > 0",
      // An aggregate's alias read outside an aggregate reads the aggregate.
      "SELECT max(x) AS x, x + 1 AS next FROM t",
      // Lambda parameters, CAST types and a subquery's own names are not reads of this level.
      "SELECT arrayFilter(confidence -> confidence > 50, scores) AS confidence, CAST(version AS String) AS label, (SELECT max(version) FROM t2) AS version FROM t",
    ];

    for (const sql of meant) {
      expect(findAliasShadows(sql)).toEqual([]);
    }
  });

  test("reads the subqueries of a statement as levels of their own", () => {
    expect(countSelects(ISSUE_5157_MATCH_STATEMENT)).toBe(3);
    expect(
      aliasesOf(
        findAliasShadows(
          "SELECT x FROM (SELECT max(v) AS v, argMax(k, v) AS k FROM t GROUP BY g) WHERE v > 1",
        ),
      ),
    ).toEqual(["v (aggregate-inside-aggregate, SELECT)"]);
  });

  test("knows aggregate functions with their combinators, and not other functions", () => {
    for (const name of [
      "max",
      "argMax",
      "countIf",
      "uniqExactIf",
      "groupArrayState",
      "sumMerge",
      "quantileExactWeighted",
      "medianTiming",
      "anyLast",
    ]) {
      expect(isAggregateFunction(name)).toBe(true);
    }

    for (const name of [
      "toString",
      "lowerUTF8",
      "arrayDistinct",
      "toStartOfInterval",
      "if",
      "multiIf",
      "greatest",
    ]) {
      expect(isAggregateFunction(name)).toBe(false);
    }
  });

  test("the strict form names every alias its SELECT reads, its own expression included", () => {
    expect(
      findAliasesSpellingColumns(ISSUE_5157_VERSIONS_STATEMENT)
        .map((found: { alias: string }): string => {
          return found.alias;
        })
        .sort(),
    ).toEqual([
      "confidence",
      "indicatorName",
      "indicatorType",
      "retentionDate",
      "validFrom",
      "validUntil",
      "version",
    ]);
    expect(
      findAliasesSpellingColumns(
        "SELECT stixId, argMax(confidence, version) AS confidenceLatest, max(version) AS versionLatest FROM t WHERE feedId = {f:String} GROUP BY stixId HAVING versionLatest > 0 ORDER BY confidenceLatest",
      ),
    ).toEqual([]);
  });
});

describe("reading SQL out of source", () => {
  test("reads a template's ${...} as a name of its own, and a function's literals together", () => {
    const texts: Array<SqlText> = sqlTextsOf(
      "Service.ts",
      [
        "function build(statement: Statement, databaseName: string): void {",
        "  statement.append(`SELECT stixId, max(version) AS version, argMax(validFrom, version) AS validFrom FROM ${databaseName}.t`);",
        "  statement.append(SQL` WHERE projectId = ${{ type: TableColumnType.ObjectID, value: projectId }}`);",
        "}",
        "function other(): string {",
        "  return 'SELECT toStartOfHour(time) AS time FROM t';",
        "}",
        "function another(): string {",
        "  return ' WHERE time > now()';",
        "}",
      ].join("\n"),
    );

    expect(
      texts.map((text: SqlText): number => {
        return text.line;
      }),
    ).toEqual([2, 2, 6]);
    expect(
      texts.flatMap((text: SqlText): Array<string> => {
        return aliasesOf(findAliasShadows(text.text));
      }),
    ).toEqual([
      "version (aggregate-inside-aggregate, SELECT)",
      "version (aggregate-inside-aggregate, SELECT)",
    ]);
  });

  test("tells Postgres SQL, whose WHERE never reads an alias, from ClickHouse's", () => {
    expect(
      isPostgresSql(
        'SELECT "_id"::text AS "_id" FROM "StatusPageSubscriber" WHERE ($2::uuid IS NULL OR "_id" > $2::uuid) LIMIT $1',
      ),
    ).toBe(true);
    expect(isPostgresSql("SELECT count(*) FROM t WHERE x = $1")).toBe(true);
    expect(isPostgresSql(ISSUE_5157_MATCH_STATEMENT)).toBe(false);
    expect(isPostgresSql(ISSUE_5157_VERSIONS_STATEMENT)).toBe(false);
    expect(
      isPostgresSql("SELECT `time`, toString(x) AS y FROM t WHERE a = 'b\"c'"),
    ).toBe(false);
  });

  test("joins a SELECT list and the WHERE appended after it", () => {
    const texts: Array<SqlText> = sqlTextsOf(
      "Service.ts",
      [
        "function build(statement: Statement): void {",
        "  statement.append(`SELECT host, sum(bytes) AS bytes FROM t`);",
        "  statement.append(` WHERE bytes > 0 GROUP BY host`);",
        "}",
      ].join("\n"),
    );

    expect(
      texts.flatMap((text: SqlText): Array<string> => {
        return aliasesOf(findAliasShadows(text.text));
      }),
    ).toEqual(["bytes (aggregate-in-where, WHERE)"]);
  });
});

// The server code that builds SQL; the frontends build none.
const SCANNED_ROOTS: ReadonlyArray<string> = [
  "packages/Common/Server",
  "packages/Common/Utils",
  "packages/Common/Types",
  "packages/App/FeatureSet",
  "ee/Server",
];

const FRONTEND_FOLDERS: ReadonlySet<string> = new Set<string>([
  "Dashboard",
  "AdminDashboard",
  "StatusPage",
  "Accounts",
  "PublicDashboard",
  "Docs",
  "Home",
  "Tests",
]);

describe("the server code", () => {
  const files: Array<string> = listServerSourceFiles(
    SCANNED_ROOTS,
    FRONTEND_FOLDERS,
  );

  const texts: Array<SqlText> = files.flatMap(
    (file: string): Array<SqlText> => {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_DIRECTORY, file),
        "utf8",
      );

      return source.toLowerCase().includes("select")
        ? sqlTextsOf(file, source).filter((text: SqlText): boolean => {
            return !isPostgresSql(text.text);
          })
        : [];
    },
  );

  test("was read: the files that build SQL, and the statements in them", () => {
    expect(files.length).toBeGreaterThan(2000);
    expect(
      files.includes(
        "packages/Common/Server/Services/ThreatIntelIndicatorService.ts",
      ),
    ).toBe(true);
    expect(texts.length).toBeGreaterThan(300);
    expect(
      texts.some((text: SqlText): boolean => {
        return (
          text.file ===
            "packages/Common/Server/Services/ThreatIntelIndicatorService.ts" &&
          text.text.includes("argMax(confidence, version)")
        );
      }),
    ).toBe(true);
  });

  test("names no alias that spells a column another part of its SELECT reads", () => {
    const found: Array<string> = Array.from(
      new Set(
        texts.flatMap((text: SqlText): Array<string> => {
          return findAliasShadows(text.text).map(
            (shadow: AliasShadow): string => {
              return `${text.file}:${text.line}: ${shadow.alias} (${shadow.kind}, read in ${shadow.readIn}) = ${shadow.expression}`;
            },
          );
        }),
      ),
    ).sort();

    // Name the alias for what it holds (fooLatest), or qualify the column (t.foo).
    expect(found).toEqual([]);
  });
});
