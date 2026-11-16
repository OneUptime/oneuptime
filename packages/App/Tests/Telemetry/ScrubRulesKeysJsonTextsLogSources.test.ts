import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

import FluentLogsIngestService from "../../FeatureSet/Telemetry/Services/FluentLogsIngestService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import ProbeSyslogIngestService from "../../FeatureSet/Telemetry/Services/ProbeSyslogIngestService";
import SyslogIngestService from "../../FeatureSet/Telemetry/Services/SyslogIngestService";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import LogService from "Common/Server/Services/LogService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import { ExpressRequest } from "Common/Server/Utils/Express";
import SyslogDeviceMatcher from "Common/Server/Utils/Syslog/SyslogDeviceMatcher";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import ServiceType from "Common/Types/Telemetry/ServiceType";

/*
 * ---------------------------------------------------------------------------
 * A SENSITIVE ATTRIBUTE KEYS RULE READS THE JSON TEXTS FLUENTD AND SYSLOG
 * RECORDS HOLD IN STRINGS (#8993).
 *
 * The other log sources a project's scrub rules run over, end to end from
 * the batch each one posts to the rows written: Fluentd (a record's string
 * field written as JSON, its array fields, which ingest stores as their
 * JSON text, a `log` line that is JSON, and a nested record ingest writes
 * as the body's JSON text), syslog posted over HTTP and the syslog a probe
 * forwards (a message whose text is JSON holding a JSON text of its own).
 * Only the persistence edges are replaced.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const PROBE_ID: ObjectID = ObjectID.generate();

let storedRows: Array<JSONObject>;

function keysRule(): never {
  const rule: LogScrubRule = new LogScrubRule();
  rule.name = "secrets";
  rule.patternType = "sensitiveKeys";
  rule.scrubAction = "redact";

  const regex: ScrubRegExp | null = (
    LogScrubRuleService as unknown as {
      getRegexForPattern: (patternType: string) => ScrubRegExp | null;
    }
  ).getRegexForPattern("sensitiveKeys");

  expect(regex).not.toBeNull();

  return [{ rule: rule, regex: regex }] as never;
}

beforeEach(() => {
  storedRows = [];

  jest
    .spyOn(OTelIngestService, "telemetryServiceFromName")
    .mockImplementation((async (data: {
      serviceName: string;
    }): Promise<TelemetryServiceMetadata> => {
      return {
        serviceName: data.serviceName,
        primaryEntityId: SERVICE_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        dataRententionInDays: 15,
        serviceRetentionConfig: null,
        serviceRetentionInDays: null,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      } as unknown as TelemetryServiceMetadata;
    }) as never);
  jest.spyOn(TelemetryFanInWriter, "submit").mockImplementation((async (
    _target: unknown,
    rows: Array<JSONObject>,
  ): Promise<{ flushed: Promise<void> }> => {
    storedRows.push(...rows);
    return { flushed: Promise.resolve() };
  }) as never);
  jest
    .spyOn(LogPipelineService, "loadPipelines")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LogDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    .mockResolvedValue(keysRule());
});

afterEach(() => {
  jest.restoreAllMocks();
  SyslogDeviceMatcher.clearCaches();
});

function attributesOf(row: JSONObject): JSONObject {
  return row["attributes"] as JSONObject;
}

// The application's JSON line, a number JSON.parse cannot keep in it.
const APP_LINE: string =
  '{"level":"info","token":"tok-2","msg":"paid","order":12345678901234567890}';
const APP_LINE_HIDDEN: string =
  '{"level":"info","token":"[REDACTED]","msg":"paid","order":12345678901234567890}';

describe("Fluentd", () => {
  async function ingest(entries: Array<JSONObject>): Promise<void> {
    await FluentLogsIngestService.processFluentLogsFromQueue({
      projectId: PROJECT_ID,
      body: { entries: entries },
      headers: { "x-oneuptime-service-name": "checkout" },
    } as unknown as ExpressRequest);
  }

  test("a field written as JSON, and an array field ingest stores as its JSON text: the secret inside each is hidden", async () => {
    await ingest([
      {
        message: "login requested",
        request: { body: '{"username":"ada","password":"hunter2"}' },
        credentials: [{ token: "tok-1", scope: "read" }],
        level: "info",
      },
    ]);

    expect(storedRows).toHaveLength(1);

    const attributes: JSONObject = attributesOf(storedRows[0]!);

    expect(storedRows[0]!["body"]).toBe("login requested");
    expect(attributes["fluentd.request.body"]).toBe(
      '{"username":"ada","password":"[REDACTED]"}',
    );
    expect(attributes["fluentd.credentials"]).toBe(
      '[{"token":"[REDACTED]","scope":"read"}]',
    );
    expect(JSON.stringify(storedRows)).not.toContain("hunter2");
    expect(JSON.stringify(storedRows)).not.toContain("tok-1");
  });

  test("a docker record's log line that is JSON: the body is read key by key, every other character kept", async () => {
    await ingest([{ log: APP_LINE + "\n", stream: "stdout" }]);

    expect(storedRows[0]!["body"]).toBe(APP_LINE_HIDDEN + "\n");
    expect(attributesOf(storedRows[0]!)["fluentd.stream"]).toBe("stdout");
  });

  test("a record whose message is a map: the JSON text of its `log` field, inside the body, is read too", async () => {
    await ingest([
      { message: { log: '{"password":"p-4"}', stream: "stdout" } },
      // No body field: the whole record is the body's JSON text.
      { event: "login", payload: '{"api_key":"k-3","user":"ada"}' },
    ]);

    expect(storedRows).toHaveLength(2);
    expect(JSON.parse(storedRows[0]!["body"] as string)).toEqual({
      log: '{"password":"[REDACTED]"}',
      stream: "stdout",
    });
    expect(JSON.parse(storedRows[1]!["body"] as string)).toEqual({
      event: "login",
      payload: '{"api_key":"[REDACTED]","user":"ada"}',
    });
    expect(attributesOf(storedRows[1]!)["fluentd.payload"]).toBe(
      '{"api_key":"[REDACTED]","user":"ada"}',
    );
  });

  test("a field that names no secret, or only looks like JSON, is stored as sent", async () => {
    await ingest([
      {
        message: "{token} expired",
        note: '{ "event": "password_reset" }',
        template: "[password] for {user}",
      },
    ]);

    const attributes: JSONObject = attributesOf(storedRows[0]!);

    expect(storedRows[0]!["body"]).toBe("{token} expired");
    expect(attributes["fluentd.note"]).toBe('{ "event": "password_reset" }');
    expect(attributes["fluentd.template"]).toBe("[password] for {user}");
  });
});

// A message whose text is JSON, holding a JSON text of its own.
const SYSLOG_MESSAGE: string =
  '{"event":"login","request":"{\\"username\\":\\"ada\\",\\"password\\":\\"p-5\\"}","order":12345678901234567890}';
const SYSLOG_MESSAGE_HIDDEN: string =
  '{"event":"login","request":"{\\"username\\":\\"ada\\",\\"password\\":\\"[REDACTED]\\"}","order":12345678901234567890}';
const SYSLOG_LINE: string = `<165>1 2026-11-16T10:11:12.003Z web-01 checkout 4711 ID47 - ${SYSLOG_MESSAGE}`;

describe("syslog posted over HTTP", () => {
  test("a message whose text is JSON: the secret in the JSON text it holds is hidden in the body", async () => {
    jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([] as never);

    await SyslogIngestService.processSyslogFromQueue({
      projectId: PROJECT_ID,
      body: { messages: [SYSLOG_LINE] },
      headers: {},
      query: {},
    } as unknown as ExpressRequest);

    expect(storedRows).toHaveLength(1);
    expect(storedRows[0]!["body"]).toBe(SYSLOG_MESSAGE_HIDDEN);
  });
});

describe("the syslog a probe forwards", () => {
  test("a message whose text is JSON: the secret in the JSON text it holds is hidden in the body", async () => {
    const rows: Array<JSONObject> = [];

    jest
      .spyOn(SyslogDeviceMatcher, "getProbe")
      .mockResolvedValue({ id: PROBE_ID, projectId: PROJECT_ID } as never);
    jest.spyOn(SyslogDeviceMatcher, "attribute").mockResolvedValue({
      devices: [],
      unmatchedProjectId: PROJECT_ID,
    } as never);
    jest.spyOn(LogService, "insertJsonRows").mockImplementation((async (
      inserted: Array<JSONObject>,
    ) => {
      rows.push(...inserted);
    }) as never);

    await ProbeSyslogIngestService.processSyslogMessages(PROBE_ID, [
      {
        sourceIpAddress: "10.0.0.9",
        facility: 20,
        severity: 5,
        message: SYSLOG_LINE,
        receivedAt: "2026-11-16T10:12:00.000Z",
        raw: SYSLOG_LINE,
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!["body"]).toBe(SYSLOG_MESSAGE_HIDDEN);
  });
});
