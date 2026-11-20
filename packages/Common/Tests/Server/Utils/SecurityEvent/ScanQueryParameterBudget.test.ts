import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Results } from "../../../../Server/Services/AnalyticsDatabaseService";
import LogService, {
  LogService as LogServiceClass,
} from "../../../../Server/Services/LogService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  buildSingleRuleRetrohuntStatement,
  readDetectionRetrohuntCounting,
} from "../../../../Server/Utils/SecurityEvent/DetectionRuleRetrohunt";
import {
  SecurityTelemetryTable,
  buildSecurityTelemetryMentionsStatement,
} from "../../../../Server/Utils/SecurityEvent/Connections/SecurityTelemetryStatements";
import SigmaClickhouseCompiler from "../../../../Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";
import { MAX_THREAT_INTEL_ADDRESSES } from "../../../../Server/Utils/SecurityEvent/TelemetryScan/FlowSecurityScan";
import {
  TelemetryScanWindow,
  buildAuditRecordsStatement,
  buildFlowAddressesStatement,
  buildFlowsOfAddressesStatement,
  buildLargeTransferStatement,
  buildMassDeleteStatement,
  buildNetworkSweepStatement,
  buildPortScanStatement,
  buildRumUserCountriesStatement,
  buildTraceCandidatesStatement,
} from "../../../../Server/Utils/SecurityEvent/TelemetryScan/TelemetryScanStatements";
import {
  MAX_DETECTION_READ_PARAMETERS,
  MAX_DETECTION_READ_PARAMETER_BYTES,
  assertDetectionReadFits,
  getParameterTextUrlBytes,
  getStatementParameterUrlBytes,
  getWatchlistValueUrlBytes,
} from "../../../../Server/Utils/SecurityEvent/Watchlists/SecurityWatchlistMatch";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { SECURITY_TELEMETRY_MAX_VALUES } from "../../../../Types/SecurityCase/SecurityConnection";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import { DETECTION_RETROHUNT_MAX_GROUPS } from "../../../../Types/SecurityEvent/DetectionRetrohunt";
import { DETECTION_RULE_LIBRARY } from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import {
  SecurityTelemetrySearchValue,
  getTelemetrySearchValues,
} from "../../../../Utils/SecurityCase/SecurityTelemetrySearch";
import {
  SECURITY_LOG_PREFILTER,
  SecurityLogPrefilterGroup,
} from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import SigmaRuleSetParser, {
  sigmaRulesOf,
} from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import {
  PROMPT_INJECTION_PHRASES,
  getTraceScanUrlMarkers,
} from "../../../../Utils/SecurityEvent/TelemetryScan/TraceSignals";
import { readStatementValues } from "../../../Helpers/StatementEcho";
import { getJestSpyOn } from "../../../Spy";

/*
 * HOW MUCH A SECURITY SCAN'S READ SENDS (issue #10520).
 *
 * @clickhouse/client sends a statement's parameters as fields of the
 * request's URL, beside the query id, the database and the read's settings,
 * and ClickHouse 26.7 refuses a request of more than 1,000 fields: "Too many
 * form fields" (http_max_fields). The log scan's read once sent one
 * parameter for each word it looks for - 999 parameters in all - and "Your
 * logs" read nothing.
 *
 * So every scan's read is built here with all it sends today - every word
 * of the log prefilter, every attack marker and prompt-injection phrase of
 * the trace scan, the most addresses the flow scan asks about, every rule
 * of the detection library as a retrohunt reads it - and held to:
 *
 *   - PARAMETER_BUDGET parameters, a quarter of what ClickHouse takes, so
 *     the words can grow for a long while before this fails, and a read
 *     that went back to one parameter per word fails at once;
 *   - 128 KiB a parameter (http_max_field_value_size);
 *   - MAX_DETECTION_READ_PARAMETER_BYTES for the whole URL, under its
 *     1 MiB (http_max_uri_size).
 */

// What ClickHouse 26.7 takes in one request (http_max_fields): the parameters are some of them.
const CLICKHOUSE_MAX_REQUEST_FIELDS: number = 1000;

// The most parameters a scan's read may send: well under what ClickHouse takes.
const PARAMETER_BUDGET: number = CLICKHOUSE_MAX_REQUEST_FIELDS / 4;

// The longest field ClickHouse takes (http_max_field_value_size), URL-encoded.
const MAX_FIELD_VALUE_BYTES: number = 128 * 1024;

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-000000010520",
);

const WINDOW: TelemetryScanWindow = {
  projectId: PROJECT_ID,
  arrivedAfter: new Date("2026-11-20T09:07:44.000Z"),
  arrivedUntil: new Date("2026-11-20T09:12:44.000Z"),
  happenedAfter: new Date("2026-11-20T08:12:44.000Z"),
};

afterEach(() => {
  jest.restoreAllMocks();
});

// What one parameter takes in the URL, written as the client writes it.
function urlBytesOf(value: unknown): number {
  if (Array.isArray(value)) {
    return (
      6 +
      value.reduce((total: number, item: unknown): number => {
        return (
          total +
          (typeof item === "string"
            ? getWatchlistValueUrlBytes(item)
            : getParameterTextUrlBytes(String(item)) + 3)
        );
      }, 0)
    );
  }

  return getParameterTextUrlBytes(String(value));
}

interface Measured {
  name: string;
  parameters: number;
  longestParameterBytes: number;
  urlBytes: number;
}

function measure(name: string, statement: Statement): Measured {
  const values: Array<unknown> = Object.values(statement.query_params);

  return {
    name,
    parameters: values.length,
    longestParameterBytes: Math.max(0, ...values.map(urlBytesOf)),
    urlBytes: getStatementParameterUrlBytes(statement),
  };
}

function expectWithinBudget(name: string, statement: Statement): Measured {
  const measured: Measured = measure(name, statement);

  expect({
    name,
    parameters: measured.parameters <= PARAMETER_BUDGET,
    longestParameter: measured.longestParameterBytes <= MAX_FIELD_VALUE_BYTES,
    url: measured.urlBytes <= MAX_DETECTION_READ_PARAMETER_BYTES,
  }).toEqual({
    name,
    parameters: true,
    longestParameter: true,
    url: true,
  });

  return measured;
}

// The log scan's own read of a window ("Your logs"), as it sends it.
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

// Every word the log prefilter sends: its own, and each group's.
function prefilterWords(): Array<string> {
  return [
    ...SECURITY_LOG_PREFILTER.anyOf,
    ...SECURITY_LOG_PREFILTER.groups.flatMap(
      (group: SecurityLogPrefilterGroup): Array<string> => {
        return [
          group.requires,
          ...group.anyOf,
          ...(group.noneOf || []),
          ...(group.unlessAnyOf || []),
        ];
      },
    ),
  ];
}

describe("the log scan's read (Your logs) fits one request, with every word it looks for", () => {
  test("the whole read, as the scan sends it", async () => {
    const statement: Statement = await captureLogScanRead();
    const measured: Measured = expectWithinBudget(
      "findSecurityLogCandidates",
      statement,
    );

    // One parameter for each of the prefilter's lists, not one for each of its words.
    expect(measured.parameters).toBeLessThan(prefilterWords().length / 5);
  });

  test("the prefilter alone", () => {
    expectWithinBudget(
      "buildSecurityLogPrefilter",
      LogServiceClass.buildSecurityLogPrefilter(),
    );
  });

  test("the words are all still sent: the catalogue is the one the scan reads", () => {
    const sent: Array<string> = readStatementValues(
      LogServiceClass.buildSecurityLogPrefilter(),
    ).flat() as Array<string>;

    expect(sent.sort()).toEqual(prefilterWords().sort());
  });

  test("control: a read with a parameter per word, as #10520 found it, would be over the budget", () => {
    // So the budget holds the read to a parameter per list, not per word.
    expect(prefilterWords().length).toBeGreaterThan(PARAMETER_BUDGET);
  });
});

describe("the telemetry scans' reads fit one request", () => {
  test("the trace read, with every attack marker and prompt-injection phrase", () => {
    const statement: Statement = buildTraceCandidatesStatement({
      ...WINDOW,
      limit: 1000,
      offset: 0,
    });

    expectWithinBudget("buildTraceCandidatesStatement", statement);

    // The markers and the phrases each go as one parameter, however many there are.
    const values: Array<unknown> = readStatementValues(statement);

    expect(values).toContainEqual(getTraceScanUrlMarkers());
    expect(values).toContainEqual([...PROMPT_INJECTION_PHRASES]);
  });

  test("the flow reads", () => {
    expectWithinBudget(
      "buildPortScanStatement",
      buildPortScanStatement({ ...WINDOW, minPorts: 25, limit: 50 }),
    );
    expectWithinBudget(
      "buildNetworkSweepStatement",
      buildNetworkSweepStatement({ ...WINDOW, minHosts: 25, limit: 50 }),
    );
    expectWithinBudget(
      "buildLargeTransferStatement",
      buildLargeTransferStatement({
        ...WINDOW,
        minBytes: 1024 * 1024 * 1024,
        limit: 50,
      }),
    );
    expectWithinBudget(
      "buildFlowAddressesStatement",
      buildFlowAddressesStatement({ ...WINDOW, limit: 2000 }),
    );
  });

  test("the traffic of the most addresses threat intel is asked about, one a cloud metadata address", () => {
    // The metadata address is a scan word: the lists are sent hex encoded.
    const addresses: Array<string> = [
      "169.254.169.254",
      ...Array.from(
        { length: MAX_THREAT_INTEL_ADDRESSES - 1 },
        (_value: unknown, index: number): string => {
          return `2001:db8::${index.toString(16)}`;
        },
      ),
    ];
    const statement: Statement = buildFlowsOfAddressesStatement({
      ...WINDOW,
      addresses,
      limit: 50,
    });

    expect(statement.query).toContain("srcIp IN (CAST(unhex({p");
    expectWithinBudget("buildFlowsOfAddressesStatement", statement);
    expect(readStatementValues(statement)).toEqual(
      expect.arrayContaining([addresses]),
    );
  });

  test("the audit and session reads", () => {
    expectWithinBudget(
      "buildAuditRecordsStatement",
      buildAuditRecordsStatement({ ...WINDOW, limit: 1000, offset: 0 }),
    );
    expectWithinBudget(
      "buildMassDeleteStatement",
      buildMassDeleteStatement({ ...WINDOW, minDeletes: 50, limit: 50 }),
    );
    expectWithinBudget(
      "buildRumUserCountriesStatement",
      buildRumUserCountriesStatement({
        ...WINDOW,
        startedAfter: WINDOW.happenedAfter,
        sessionsPerUser: 10,
        limit: 50,
      }),
    );
  });

  test("a case's values in your logs and traces, the most a read takes", () => {
    const values: Array<SecurityTelemetrySearchValue> =
      getTelemetrySearchValues(
        Array.from(
          { length: SECURITY_TELEMETRY_MAX_VALUES },
          (
            _value: unknown,
            index: number,
          ): { type: SecurityEntityType; value: string } => {
            return {
              type: SecurityEntityType.Url,
              value: `https://evil.example/${index}?q=\${jndi:ldap://x}&p=../../etc/passwd`,
            };
          },
        ),
      ).values;

    expect(values).toHaveLength(SECURITY_TELEMETRY_MAX_VALUES);

    for (const table of [
      SecurityTelemetryTable.Logs,
      SecurityTelemetryTable.Spans,
    ]) {
      expectWithinBudget(
        `buildSecurityTelemetryMentionsStatement ${table}`,
        buildSecurityTelemetryMentionsStatement({
          table,
          databaseName: "oneuptime",
          tableName:
            table === SecurityTelemetryTable.Logs ? "LogItemV3" : "SpanItemV3",
          projectId: PROJECT_ID,
          startTime: WINDOW.happenedAfter,
          endTime: WINDOW.arrivedUntil,
          values,
          serviceFilter: {},
        })!,
      );
    }
  });
});

/*
 * Hunts and retrohunts read the security events through the detection
 * library's rules: each rule of the library, compiled as it runs, alone and
 * in the read a retrohunt sends.
 */
describe("the detection library's reads fit one request", () => {
  const reads: Array<{ name: string; statement: Statement }> = [];

  for (const entry of DETECTION_RULE_LIBRARY) {
    for (const rule of sigmaRulesOf(
      SigmaRuleSetParser.parse(entry.sigmaRuleYaml),
    )) {
      const ruleWhere: Statement = SigmaClickhouseCompiler.compile(rule);

      reads.push({ name: `${entry.id} rule`, statement: ruleWhere });
      reads.push({
        name: `${entry.id} retrohunt`,
        statement: buildSingleRuleRetrohuntStatement({
          projectId: PROJECT_ID,
          tableName: "oneuptime.SecurityEventItemV1",
          ruleWhere: SigmaClickhouseCompiler.compile(rule),
          // Counted as a retrohunt of the library's rule counts it.
          counting: readDetectionRetrohuntCounting({
            sigmaRuleYaml: entry.sigmaRuleYaml,
            groupByField: entry.groupByField,
            distinctCountField: entry.distinctCountField,
            matchCountThreshold: entry.matchCountThreshold,
            evaluationIntervalInMinutes: entry.evaluationIntervalInMinutes,
          }),
          skipped: null,
          serviceFilter: {},
          startTime: WINDOW.happenedAfter,
          endTime: WINDOW.arrivedUntil,
          maxGroups: DETECTION_RETROHUNT_MAX_GROUPS + 1,
        }),
      });
    }
  }

  test("the library is read whole", () => {
    expect(reads.length).toBeGreaterThanOrEqual(
      2 * DETECTION_RULE_LIBRARY.length,
    );
  });

  test("every rule, and every retrohunt of one", () => {
    for (const { name, statement } of reads) {
      expectWithinBudget(name, statement);
    }
  });

  test("a rule of the person's own that lists more values than one read carries is refused before it is sent", () => {
    /*
     * A rule sends each value it lists as a parameter: the one read whose
     * parameters grow with what a person writes. It is refused with what
     * to do, at its save and before any run (assertDetectionReadFits).
     */
    const users: string = Array.from(
      { length: 1200 },
      (_value: unknown, index: number): string => {
        return `      - user${index}`;
      },
    ).join("\n");
    const [rule] = sigmaRulesOf(
      SigmaRuleSetParser.parse(
        `title: Listed users\ndetection:\n  s:\n    principalUser:\n${users}\n  condition: s\n`,
      ),
    );
    const statement: Statement = SigmaClickhouseCompiler.compile(rule!);

    expect(Object.keys(statement.query_params).length).toBeGreaterThan(
      MAX_DETECTION_READ_PARAMETERS,
    );
    expect(MAX_DETECTION_READ_PARAMETERS).toBeLessThan(
      CLICKHOUSE_MAX_REQUEST_FIELDS,
    );
    expect(() => {
      assertDetectionReadFits(statement);
    }).toThrow(BadDataException);
  });
});
