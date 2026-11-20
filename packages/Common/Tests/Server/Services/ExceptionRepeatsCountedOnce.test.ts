import ExceptionInstanceService, {
  EXCEPTION_ORIGINALS_SQL,
  readsOriginalOccurrences,
} from "../../../Server/Services/ExceptionInstanceService";
import ExceptionAggregationService from "../../../Server/Services/ExceptionAggregationService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import Query from "../../../Server/Types/AnalyticsDatabase/Query";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

/*
 * #9923: an iOS crash KSCrash and MetricKit both report is one crash. Its
 * second report is kept as an occurrence of its own - the evidence it is -
 * naming the first in duplicateOf, and nothing that lists or counts
 * occurrences reads it unless it asks for it by name. Pinned here: the
 * rule itself, every way the service reads the table, and every read of
 * the table written by hand.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const START: Date = new Date("2026-11-19T00:00:00.000Z");
const END: Date = new Date("2026-11-20T00:00:00.000Z");
const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

// The rule, as a statement compiled from a query writes it.
const ORIGINALS_ONLY: string = `"duplicateOf" = ""`;

// The statements the service runs, captured instead of run.
function captureStatements(
  rows: Array<JSONObject> = [{ count: 3 }],
): Array<Statement> {
  const captured: Array<Statement> = [];

  jest.spyOn(ExceptionInstanceService, "executeQuery").mockImplementation(((
    statement: Statement,
  ): Promise<Results> => {
    captured.push(statement);

    return Promise.resolve({
      json: (): Promise<unknown> => {
        return Promise.resolve({ data: rows });
      },
    } as unknown as Results);
  }) as never);

  return captured;
}

// A statement with its parameters written in.
function inline(statement: Statement): string {
  let text: string = statement.query;
  const params: Record<string, unknown> = statement.query_params as Record<
    string,
    unknown
  >;

  for (const [name, value] of Object.entries(params)) {
    text = text.replace(
      new RegExp(`\\{${name}:[^}]+\\}`, "g"),
      JSON.stringify(value),
    );
  }

  return text.replace(/\s+/g, " ").trim();
}

function pastDay(): Query<ExceptionInstance> {
  return {
    projectId: PROJECT_ID,
    time: new InBetween<Date>(START, END),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what a read of occurrences reads", () => {
  test("the occurrences that repeat none, unless it asks for repeats or for one occurrence", () => {
    expect(readsOriginalOccurrences(pastDay())).toEqual({
      ...pastDay(),
      duplicateOf: "",
    });

    // The repeats of an occurrence, as the occurrences table asks for them.
    const repeatsOf: Query<ExceptionInstance> = {
      projectId: PROJECT_ID,
      duplicateOf: new Includes(["occurrence-1"]),
    };

    expect(readsOriginalOccurrences(repeatsOf)).toBe(repeatsOf);

    // One occurrence, by its id: found, whatever it is.
    const byId: Query<ExceptionInstance> = {
      projectId: PROJECT_ID,
      _id: "occurrence-2",
    } as Query<ExceptionInstance>;

    expect(readsOriginalOccurrences(byId)).toBe(byId);
  });

  test("the rule leaves the caller's query as it was", () => {
    const query: Query<ExceptionInstance> = pastDay();

    readsOriginalOccurrences(query);

    expect(Object.keys(query)).toEqual(["projectId", "time"]);
  });
});

describe("every way the service reads the table", () => {
  test("a count", async () => {
    const captured: Array<Statement> = captureStatements();

    await ExceptionInstanceService.countBy({ query: pastDay(), props: ROOT });

    expect(inline(captured[0]!)).toContain(ORIGINALS_ONLY);
  });

  test("a list, and the count beside it, describe the same rows", async () => {
    const captured: Array<Statement> = captureStatements([]);

    await ExceptionInstanceService.findBy({
      query: pastDay(),
      select: { _id: true, fingerprint: true },
      limit: 10,
      skip: 0,
      props: ROOT,
    });

    expect(inline(captured[captured.length - 1]!)).toContain(ORIGINALS_ONLY);
  });

  test("a count per window - a rule's preview, an anomaly's baseline", async () => {
    const captured: Array<Statement> = captureStatements([]);

    await ExceptionInstanceService.countPerWindow({
      query: pastDay(),
      timeColumnName: "time",
      windowInSeconds: 3600,
      props: ROOT,
    });

    expect(inline(captured[0]!)).toContain(ORIGINALS_ONLY);
  });

  test("a count per value in windows - a spike's and a regression's", async () => {
    const captured: Array<Statement> = captureStatements([]);

    await ExceptionInstanceService.countPerValueInWindows({
      query: pastDay(),
      valueColumnName: "fingerprint",
      timeColumnName: "time",
      windows: [{ startsAt: START, endsAt: END }],
      props: ROOT,
    });

    expect(inline(captured[0]!)).toContain(ORIGINALS_ONLY);
  });

  test("whether any exists", async () => {
    const captured: Array<Statement> = captureStatements([]);

    await ExceptionInstanceService.existsBy({ query: pastDay(), props: ROOT });

    expect(inline(captured[0]!)).toContain(ORIGINALS_ONLY);
  });

  test("a chart's aggregate", async () => {
    const captured: Array<Statement> = captureStatements([]);

    await ExceptionInstanceService.aggregateBy({
      query: pastDay(),
      aggregationType: AggregationType.Count,
      aggregateColumnName: "_id",
      aggregationTimestampColumnName: "time",
      startTimestamp: START,
      endTimestamp: END,
      limit: 10,
      skip: 0,
      props: ROOT,
    } as never);

    expect(
      captured.some((statement: Statement) => {
        return inline(statement).includes(ORIGINALS_ONLY);
      }),
    ).toBe(true);
  });

  test("the installs or sessions a monitor's exceptions happened on", async () => {
    const captured: Array<Statement> = captureStatements([{ count: 2 }]);

    await ExceptionInstanceService.countDistinctNonEmpty({
      query: pastDay(),
      expression: "sessionId",
      props: ROOT,
    });

    expect(inline(captured[0]!)).toContain(ORIGINALS_ONLY);
  });

  test("a read that asks for an occurrence's repeats reads them", async () => {
    const captured: Array<Statement> = captureStatements([]);

    await ExceptionInstanceService.findBy({
      query: { ...pastDay(), duplicateOf: new Includes(["occurrence-1"]) },
      select: { duplicateOf: true },
      limit: 10,
      skip: 0,
      props: ROOT,
    });

    const text: string = inline(captured[captured.length - 1]!);

    expect(text).toContain("occurrence-1");
    expect(text).not.toContain(ORIGINALS_ONLY);
  });
});

describe("the exceptions explorer's charts and the Overview's counts", () => {
  test("the histogram, the facets and the sessions and installs a crash ended read originals only", async () => {
    const captured: Array<Statement> = captureStatements([]);

    await ExceptionAggregationService.getHistogram({
      projectId: PROJECT_ID,
      startTime: START,
      endTime: END,
      bucketSizeInMinutes: 60,
    });
    await ExceptionAggregationService.getFacetValues({
      projectId: PROJECT_ID,
      startTime: START,
      endTime: END,
      facetKey: "exceptionType",
    });

    expect(captured).toHaveLength(2);

    for (const statement of captured) {
      expect(statement.query).toContain(EXCEPTION_ORIGINALS_SQL);
    }

    expect(
      ExceptionAggregationService.buildSessionCountStatement({
        projectId: PROJECT_ID,
        startTime: START,
        endTime: END,
        countInstalls: true,
      }).query,
    ).toContain(EXCEPTION_ORIGINALS_SQL);
  });
});

/*
 * A read of the table written by hand goes around the service's rule, so it
 * says the same itself (EXCEPTION_ORIGINALS_SQL). One that reads every row
 * on purpose says why here.
 */
describe("every read of the table written by hand", () => {
  const PACKAGES: string = path.resolve(__dirname, "../../../..");

  const READS_EVERY_ROW: Record<string, string> = {
    "Common/Server/Utils/DataSecurity/Telemetry/TelemetryDataScanner.ts":
      "scans every stored row for data to redact, repeats with the rest",
    "Common/Server/Utils/AnalyticsDatabase/ClickhouseCapacity.ts":
      "measures what the table stores",
    "Common/Server/Utils/AnalyticsDatabase/StatementGenerator.ts":
      "finds the spans an exception was thrown in: a repeat, from a log record, names none of its own",
    "Common/Server/Services/TraceAggregationService.ts":
      "finds the spans an exception was thrown in, as the statement generator does",
    "Common/Server/Utils/Activation/TelemetryMilestoneBackfill.ts":
      "asks whether a project has sent an exception at all",
    "Common/Server/Utils/Activation/TelemetryMilestones.ts":
      "names the table a milestone is read from",
  };

  const MATCHES: RegExp =
    /AnalyticsTableName\.ExceptionInstance|ExceptionInstanceService\.execute|ExceptionItemV3/;

  function sourceFiles(directory: string): Array<string> {
    const files: Array<string> = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (
          [
            "node_modules",
            "build",
            "Tests",
            "DataMigrations",
            "Dashboard",
          ].includes(entry.name)
        ) {
          continue;
        }

        files.push(...sourceFiles(full));
      } else if (entry.name.endsWith(".ts")) {
        files.push(full);
      }
    }

    return files;
  }

  const readers: Array<string> = [
    ...sourceFiles(path.join(PACKAGES, "Common/Server")),
    ...sourceFiles(path.join(PACKAGES, "App/FeatureSet")),
  ]
    .filter((file: string): boolean => {
      return MATCHES.test(fs.readFileSync(file, "utf8"));
    })
    .map((file: string): string => {
      return path.relative(PACKAGES, file).split(path.sep).join("/");
    })
    .sort();

  test("finds the readers it is held to", () => {
    expect(readers).toEqual(
      expect.arrayContaining([
        "App/FeatureSet/Workers/Jobs/Rum/FinalizeSessions.ts",
        "Common/Server/Services/ExceptionAggregationService.ts",
        "Common/Server/Utils/SessionReplay/SessionReplayReadService.ts",
        "Common/Server/Utils/Telemetry/ExceptionListStatsReader.ts",
        "Common/Server/Utils/Telemetry/TelemetryExceptionMerge.ts",
      ]),
    );
  });

  test("each reads the occurrences that repeat none, or says why it reads every row", () => {
    const unheld: Array<string> = readers.filter((file: string): boolean => {
      return (
        !READS_EVERY_ROW[file] &&
        !fs
          .readFileSync(path.join(PACKAGES, file), "utf8")
          .includes("EXCEPTION_ORIGINALS_SQL")
      );
    });

    expect(unheld).toEqual([]);
  });

  test("the service's own reads written by hand say it too", () => {
    const source: string = fs.readFileSync(
      path.join(PACKAGES, "Common/Server/Services/ExceptionInstanceService.ts"),
      "utf8",
    );

    expect(source).toContain("statement.append(EXCEPTION_ORIGINALS_SQL);");
  });

  test("every reason given is for a file that still reads the table", () => {
    for (const file of Object.keys(READS_EVERY_ROW)) {
      expect({ file, reads: readers.includes(file) }).toEqual({
        file,
        reads: true,
      });
    }
  });
});
