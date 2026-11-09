import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Results } from "../../../../Server/Services/AnalyticsDatabaseService";
import LogService, {
  LogService as LogServiceClass,
} from "../../../../Server/Services/LogService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import SigmaClickhouseCompiler from "../../../../Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";
import {
  TelemetryScanWindow,
  buildAuditRecordsStatement,
  buildTraceCandidatesStatement,
} from "../../../../Server/Utils/SecurityEvent/TelemetryScan/TelemetryScanStatements";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SecurityLogParser, {
  SECURITY_LOG_PREFILTER,
} from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import SigmaRuleSetParser, {
  sigmaRulesOf,
} from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import { SECURITY_SCAN_WORDS } from "../../../../Utils/SecurityEvent/SecurityScanWords";
import {
  CLICKHOUSE_VERSION,
  clickHouseErrorLogLine,
  echoStatement,
  echoStatementAsWritten,
  readStatementValues,
  statementUrlQuery,
} from "../../../Helpers/StatementEcho";
import { getJestSpyOn } from "../../../Spy";
import { logLine } from "../../../Utils/SecurityEvent/LogParsers/LogParserFixtures";

/*
 * ISSUE #6419, AS A GUARD OVER EVERY QUERY THE SECURITY SCANS SEND.
 *
 * A scan's query holds the words it looks for. Whatever writes that query
 * down - ClickHouse's error line and query_log, an ORM's debug line, a
 * proxy's access log of the URL the client sends - then holds them too, and
 * the scan read its own query back as an attack: "Log4Shell exploit
 * attempt" from 26.7.38.18, ClickHouse's version. So each query the scans
 * build is written down here every way it can be, and read the way the
 * log scan reads a line:
 *
 *   - no scan word is in the echo, the query or the URL as written;
 *   - no parser makes an event of any of those lines;
 *   - the values the query computes are still the words.
 *
 * The same query with the words sent as written is the control: it would
 * read as an attack again.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-000000006419",
);

const WINDOW: TelemetryScanWindow = {
  projectId: PROJECT_ID,
  arrivedAfter: new Date("2026-11-08T09:07:44.000Z"),
  arrivedUntil: new Date("2026-11-08T09:12:44.000Z"),
  happenedAfter: new Date("2026-11-08T08:12:44.000Z"),
};

afterEach(() => {
  jest.restoreAllMocks();
});

// Every way a query is written down, as the log lines that carry it.
function linesOf(echo: string, url: string): Record<string, string> {
  return {
    clickHouseErrorLine: clickHouseErrorLogLine(echo),
    ormDebugLine: `DEBUG [clickhouse] executing query: ${echo}`,
    queryLogJson: JSON.stringify({
      type: "ExceptionWhileProcessing",
      query: echo,
    }),
    proxyAccessLine: `10.42.0.17 - - [08/Nov/2026:09:12:44 +0000] "POST /?${url} HTTP/1.1" 500 512 "-" "clickhouse-js/1.12.1"`,
    urlInAppLine: `WARN request to http://clickhouse:8123/?${url} failed from 10.42.0.17`,
  };
}

function wordsIn(text: string): Array<string> {
  const lower: string = text.toLowerCase();

  return SECURITY_SCAN_WORDS.filter((word: string): boolean => {
    return lower.includes(word);
  });
}

function eventsOf(line: string): Array<NormalizedSecurityEvent> {
  return SecurityLogParser.parse(logLine(line));
}

// What the guard holds every scan query to.
function expectReadsBackAsNothing(name: string, statement: Statement): void {
  const echo: string = echoStatement(statement);
  const url: string = statementUrlQuery(statement);

  expect({ name, words: wordsIn(echo) }).toEqual({ name, words: [] });
  expect({ name, words: wordsIn(statement.query) }).toEqual({
    name,
    words: [],
  });
  expect({ name, words: wordsIn(url) }).toEqual({ name, words: [] });
  expect({ name, words: wordsIn(decodeURIComponent(url)) }).toEqual({
    name,
    words: [],
  });

  for (const [form, line] of Object.entries(linesOf(echo, url))) {
    const events: Array<NormalizedSecurityEvent> = eventsOf(line);

    expect({ name, form, events: events.length }).toEqual({
      name,
      form,
      events: 0,
    });
  }
}

async function captureLogScanRead(): Promise<Statement> {
  getJestSpyOn(LogService.database, "getDatasourceOptions").mockReturnValue({
    database: "oneuptime",
  } as never);

  const spy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
    LogService,
    "executeQuery",
  ).mockResolvedValue({
    json: (): Promise<unknown> => {
      return Promise.resolve({ data: [] as Array<JSONObject> });
    },
  } as unknown as Results as never);

  await LogService.findSecurityLogCandidates({
    projectId: PROJECT_ID,
    arrivedAfter: WINDOW.arrivedAfter,
    arrivedUntil: WINDOW.arrivedUntil,
    happenedAfter: WINDOW.happenedAfter,
    limit: 1000,
    offset: 0,
  });

  expect(spy).toHaveBeenCalledTimes(1);

  return spy.mock.calls[0]![0] as Statement;
}

describe("the log scan's query, written down, reads as nothing", () => {
  test("the prefilter alone", () => {
    expectReadsBackAsNothing(
      "prefilter",
      LogServiceClass.buildSecurityLogPrefilter(),
    );
  });

  test("every word of the prefilter goes in hex, a group's words too", () => {
    const query: string = LogServiceClass.buildSecurityLogPrefilter().query;
    const withoutHex: string = query
      .split(/unhex\(\{p\d+(?:_\d+)?:String\}\)/)
      .join("");

    expect(query).toContain("unhex({p");
    expect(withoutHex).not.toContain(":String}");
    expect(withoutHex).not.toContain(":Array(String)}");

    /*
     * The echo quotes no group's word either: 'audit.k8s.io/', '4625'. (A
     * short id like 4697 can turn up inside a hex string by chance, so a
     * word is looked for as the quoted literal a plain parameter would be.)
     */
    const echo: string = echoStatement(
      LogServiceClass.buildSecurityLogPrefilter(),
    ).toLowerCase();

    for (const group of SECURITY_LOG_PREFILTER.groups) {
      for (const word of [group.requires, ...group.anyOf]) {
        const literal: string = `'${word
          .toLowerCase()
          .split("\\")
          .join("\\\\")
          .split("'")
          .join("\\'")}'`;

        expect({ word, inEcho: echo.includes(literal) }).toEqual({
          word,
          inEcho: false,
        });
      }
    }
  });

  test("the whole read, as the scan sends it", async () => {
    expectReadsBackAsNothing(
      "findSecurityLogCandidates",
      await captureLogScanRead(),
    );
  });

  test("the line of issue #6419 is not made again: no Log4Shell case from the version", async () => {
    const line: string = clickHouseErrorLogLine(
      echoStatement(await captureLogScanRead()),
    );

    expect(line).toContain(`(version ${CLICKHOUSE_VERSION} (official build))`);
    expect(line).toContain("multiSearchAnyCaseInsensitive(body, [unhex('");
    expect(line.toLowerCase()).not.toContain("${jndi:");
    expect(line.toLowerCase()).not.toContain("%24%7bjndi");
    expect(eventsOf(line)).toEqual([]);
  });

  test("the words are still what the query looks for", () => {
    const values: Array<unknown> = readStatementValues(
      LogServiceClass.buildSecurityLogPrefilter(),
    );

    expect(values[0]).toEqual([...SECURITY_LOG_PREFILTER.anyOf]);
    expect(values.flat()).toEqual(
      expect.arrayContaining(["${jndi:", "%24%7bjndi", "union select"]),
    );
  });

  test("control: sent as written, the same query reads as an attack again", () => {
    const asWritten: string = echoStatementAsWritten(
      LogServiceClass.buildSecurityLogPrefilter(),
    );

    expect(wordsIn(asWritten)).toEqual(
      expect.arrayContaining(["${jndi:", "%24%7bjndi", "union select"]),
    );
    expect(
      eventsOf(`DEBUG [clickhouse] executing query: ${asWritten}`).length,
    ).toBeGreaterThan(0);
  });
});

describe("the telemetry scans' queries, written down, read as nothing", () => {
  test("the trace read", () => {
    expectReadsBackAsNothing(
      "buildTraceCandidatesStatement",
      buildTraceCandidatesStatement({ ...WINDOW, limit: 1000, offset: 0 }),
    );
  });

  test("the audit log read", () => {
    expectReadsBackAsNothing(
      "buildAuditRecordsStatement",
      buildAuditRecordsStatement({ ...WINDOW, limit: 1000, offset: 0 }),
    );
  });

  test("control: the trace read sent as written would read as an attack", () => {
    const asWritten: string = echoStatementAsWritten(
      buildTraceCandidatesStatement({ ...WINDOW, limit: 1000, offset: 0 }),
    );

    expect(
      eventsOf(`DEBUG [clickhouse] executing query: ${asWritten}`).length,
    ).toBeGreaterThan(0);
  });
});

/*
 * The detection rules read the security events with the same words in
 * their selections - the Log4Shell rule of issue #6419's case among them -
 * so each rule of the library, compiled as it runs, is held to the same.
 */
describe("the detection rule library's queries, written down, read as nothing", () => {
  // Each rule a library entry evaluates - a correlation's steps one by one - compiled as it runs.
  const compiled: Array<{
    entry: DetectionRuleLibraryEntry;
    statement: Statement;
  }> = [];
  const notCompiled: Array<string> = [];

  for (const entry of DETECTION_RULE_LIBRARY) {
    try {
      for (const rule of sigmaRulesOf(
        SigmaRuleSetParser.parse(entry.sigmaRuleYaml),
      )) {
        compiled.push({
          entry,
          statement: SigmaClickhouseCompiler.compile(rule),
        });
      }
    } catch {
      // A rule that reads a watchlist compiles only once its project's lists are bound.
      notCompiled.push(entry.id);
    }
  }

  test("the library compiles, correlations and all", () => {
    expect(notCompiled).toEqual([]);
    expect(compiled.length).toBeGreaterThanOrEqual(
      DETECTION_RULE_LIBRARY.length,
    );
    expect(
      compiled.some((item: { entry: DetectionRuleLibraryEntry }): boolean => {
        return item.entry.id === "866b7566-304e-442b-b1ad-ca08264af493";
      }),
    ).toBe(true);
  });

  test("every compiled rule", () => {
    for (const { entry, statement } of compiled) {
      expectReadsBackAsNothing(entry.id, statement);
    }
  });

  test("control: the Log4Shell rule sent as written would read as an attack", () => {
    const log4Shell: Statement = compiled.find(
      (item: { entry: DetectionRuleLibraryEntry }): boolean => {
        return item.entry.id === "866b7566-304e-442b-b1ad-ca08264af493";
      },
    )!.statement;
    const asWritten: string = echoStatementAsWritten(log4Shell);
    const values: Array<string> = readStatementValues(log4Shell)
      .flat()
      .map((value: unknown): string => {
        return String(value);
      });

    expect(wordsIn(asWritten).length).toBeGreaterThan(0);
    // The rule still looks for the string, in whatever pattern it compiles to.
    expect(
      values.some((value: string): boolean => {
        return value.toLowerCase().includes("jndi");
      }),
    ).toBe(true);
  });
});
