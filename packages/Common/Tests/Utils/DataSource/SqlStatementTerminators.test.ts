import PostgresConnector, {
  PgClientFactory,
  PgClientLike,
} from "../../../Server/Utils/DataSource/Connectors/PostgresConnector";
import DataSourceEgressGuard from "../../../Server/Utils/DataSource/EgressGuard";
import { DataSourceConnectionSettings } from "../../../Server/Utils/DataSource/Types";
import DataSourceType from "../../../Types/DataSource/DataSourceType";
import { withoutTrailingStatementTerminators } from "../../../Utils/DataSource/SqlStatementTerminators";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * A QUERY'S TRAILING ";" COME OFF IN TIME IN LINE WITH THE QUERY'S LENGTH,
 * AND EXACTLY AS THEY CAME OFF BEFORE.
 *
 * A data source (on the server) and a SQL monitor (on every probe, shared
 * ones too) take the statement terminators off the end of a project's query
 * before they embed it in a cursor or check it. The pattern that did so was
 * tried again from every ";" of a run that is not at the end - a run inside
 * a string literal, say - each try reading on to the end of the run.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

const BEFORE: RegExp = /;+\s*$/g;

const before: (query: string) => string = (query: string): string => {
  return query.replace(new RegExp(BEFORE.source, BEFORE.flags), "");
};

const WORST_CASES: Array<[string, string]> = [
  ["semicolons, then text", repeat(";", LENGTH) + "x;"],
  ["semicolons inside a literal", "SELECT '" + repeat(";", LENGTH) + "x'"],
  ["semicolons and white space, then text", repeat("; \t", LENGTH) + "x"],
  ["semicolons that are at the end", "SELECT 1" + repeat(";", LENGTH)],
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe("trailing terminators come off in time in line with the query's length", () => {
  test.each(WORST_CASES)("%s", (_label: string, query: string) => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        withoutTrailingStatementTerminators(query);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });

  test("a data source's query with a long literal reaches its cursor quickly, the literal whole", async () => {
    const query: string = "SELECT '" + repeat(";", LENGTH) + "x' AS value;";
    const statements: Array<string> = [];

    const factory: PgClientFactory = (): PgClientLike => {
      return {
        connect: async (): Promise<void> => {},
        query: async (
          text: string,
        ): Promise<{ rows: Array<Record<string, unknown>> }> => {
          statements.push(text);
          return { rows: [] };
        },
        end: async (): Promise<void> => {},
      };
    };

    jest
      .spyOn(DataSourceEgressGuard, "assertHostnameAllowed")
      .mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);

    const settings: DataSourceConnectionSettings = {
      dataSourceType: DataSourceType.PostgreSQL,
      databaseHost: "db.example.com",
      databasePort: 5432,
      databaseName: "metrics",
      username: "reader",
      password: "pw-not-real",
    };

    const startedAt: number = Date.now();

    await new PostgresConnector(factory).queryTable(settings, query, {
      startDate: new Date(Date.UTC(2026, 0, 1)),
      endDate: new Date(Date.UTC(2026, 0, 2)),
    });

    expect(Date.now() - startedAt).toBeLessThan(2000);

    const declared: string | undefined = statements.find(
      (statement: string): boolean => {
        return statement.startsWith("DECLARE");
      },
    );

    expect(declared?.endsWith("x' AS value")).toBe(true);
  });
});

describe("the terminators that come off are the ones that came off before", () => {
  test("on forty thousand drawn queries", () => {
    const mismatches: Array<{ query: string; now: string; before: string }> =
      [];
    let changed: number = 0;

    for (const query of generatedTexts(
      40000,
      2718,
      [";", ";", ";;", " ", "\t", "\n", "\r", "x", "'", "\u00a0", "$1"],
      16,
    )) {
      const expected: string = before(query);
      const now: string = withoutTrailingStatementTerminators(query);

      if (expected !== query) {
        changed++;
      }

      if (now !== expected) {
        mismatches.push({ query, now, before: expected });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(changed).toBeGreaterThan(10000);
  });

  test("the last run of them and the white space after it, nothing else", () => {
    expect(withoutTrailingStatementTerminators("SELECT 1;;  \n")).toBe(
      "SELECT 1",
    );
    expect(withoutTrailingStatementTerminators(";;;")).toBe("");
    expect(withoutTrailingStatementTerminators("SELECT ';' ;x")).toBe(
      "SELECT ';' ;x",
    );
    expect(withoutTrailingStatementTerminators("SELECT $1;")).toBe("SELECT $1");
  });
});
