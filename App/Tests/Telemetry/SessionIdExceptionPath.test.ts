import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import ExceptionUtil, {
  ExceptionFingerprintInput,
  TelemetryExceptionPayload,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import SpanService from "Common/Server/Services/SpanService";
import LogService from "Common/Server/Services/LogService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * Session replay correlation, end to end through the real OTLP walk and
 * row builders: OTLP JSON body -> processTracesFromQueue /
 * processLogsFromQueue -> the real TelemetryFanInWriter -> mocked
 * ClickHouse insertJsonRows, where we read the actual rows back.
 *
 * WHY these tests exist, and why they run end to end rather than poking
 * the row builders directly:
 *
 * 1. `session.id` is set ONCE on the OTLP *resource* by a browser SDK, not
 *    on every span/log/event. TelemetryUtil.getAttributes prefixes every
 *    resource attribute with "resource.", so the key that actually arrives
 *    is "resource.session.id". An implementation that reads only the bare
 *    "session.id" key passes a hand-written unit test and silently
 *    correlates nothing in production. Only walking a real OTLP payload
 *    catches that.
 *
 * 2. ExceptionInstance.attributes is NOT the span's attribute bag. On the
 *    trace path it is the span EVENT attributes with every "exception.*"
 *    key deleted; on the log path it is a hardcoded two-key map that
 *    discards the log's attributes entirely. So `sessionId` on an
 *    exception row can ONLY come from an explicit thread-through, and the
 *    "attributes do not contain session.id" assertions below pin that
 *    down: they prove the value could not have leaked in via the bag.
 *
 * 3. The fingerprint must NOT depend on the session. It is the
 *    (projectId, primaryEntityId, fingerprint) unique-index conflict
 *    target on TelemetryException, so a per-session input would give every
 *    session its own exception group and orphan the resolved / archived /
 *    occuranceCount triage state of every existing one.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "session-correlation-test-service";

const TRACE_ID_HEX: string = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID_HEX: string = "b7ad6b7169203331";

const SESSION_ID: string = "sess_01H8XABCDEF";
const OTHER_SESSION_ID: string = "sess_01H8XZZZZZZ";

const EXCEPTION_MESSAGE: string = "Something broke";
const EXCEPTION_STACK: string =
  "Error: Something broke\n    at handler (app.js:10:5)";

/*
 * Auto-discovery methods on OtelIngestBaseService that hit Postgres.
 * Mirrors TelemetryFanInIngest.test.ts in this directory.
 */
const AUTO_DISCOVERY_METHODS_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverCephCluster",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
];

type OtlpAttribute = { key: string; value: { stringValue: string } };

function stringAttribute(key: string, value: string): OtlpAttribute {
  return { key: key, value: { stringValue: value } };
}

function setupIngestMocks(): void {
  for (const ingestService of [
    OtelTracesIngestService,
    OtelLogsIngestService,
  ]) {
    const service: Record<string, any> = ingestService as unknown as {
      [key: string]: any;
    };

    for (const method of AUTO_DISCOVERY_METHODS_RETURNING_NULL) {
      jest.spyOn(service, method).mockResolvedValue(null);
    }

    jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
      serviceName: SERVICE_NAME,
      primaryEntityId: SERVICE_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      dataRententionInDays: 15,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    });
  }

  jest
    .spyOn(TraceDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as any);
  jest
    .spyOn(TraceScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as any);
  jest
    .spyOn(TracePipelineService, "loadPipelines")
    .mockResolvedValue([] as any);
  jest.spyOn(LogPipelineService, "loadPipelines").mockResolvedValue([] as any);
  jest
    .spyOn(LogDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as any);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as any);
}

function telemetryRequest(body: JSONObject): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: body,
    headers: {},
  } as unknown as TelemetryRequest;
}

function exceptionEvent(): JSONObject {
  const nowNano: string = `${Date.now()}000000`;
  return {
    name: "exception",
    timeUnixNano: nowNano,
    attributes: [
      stringAttribute("exception.message", EXCEPTION_MESSAGE),
      stringAttribute("exception.type", "Error"),
      stringAttribute("exception.stacktrace", EXCEPTION_STACK),
      // A non-exception event attribute, to prove the bag survives at all.
      stringAttribute("event.origin", "window.onerror"),
    ],
  };
}

/*
 * `spanAttributes` deliberately defaults to EMPTY: the resource-attribute
 * case is the one that matters, and a span-level session.id would mask a
 * broken resource-attribute read.
 */
function tracesRequest(data: {
  resourceAttributes: Array<OtlpAttribute>;
  spanAttributes?: Array<OtlpAttribute>;
}): TelemetryRequest {
  const nowNano: string = `${Date.now()}000000`;

  return telemetryRequest({
    resourceSpans: [
      {
        resource: {
          attributes: [
            stringAttribute("service.name", SERVICE_NAME),
            ...data.resourceAttributes,
          ],
        },
        scopeSpans: [
          {
            scope: {},
            spans: [
              {
                traceId: TRACE_ID_HEX,
                spanId: SPAN_ID_HEX,
                parentSpanId: "",
                name: "GET /checkout",
                kind: 2,
                startTimeUnixNano: nowNano,
                endTimeUnixNano: nowNano,
                status: { code: 2 },
                attributes: [
                  stringAttribute("http.method", "GET"),
                  ...(data.spanAttributes || []),
                ],
                events: [exceptionEvent()],
                links: [],
              },
            ],
          },
        ],
      },
    ],
  });
}

function logsRequest(data: {
  resourceAttributes: Array<OtlpAttribute>;
  logAttributes?: Array<OtlpAttribute>;
}): TelemetryRequest {
  return telemetryRequest({
    resourceLogs: [
      {
        resource: {
          attributes: [
            stringAttribute("service.name", SERVICE_NAME),
            ...data.resourceAttributes,
          ],
        },
        scopeLogs: [
          {
            scope: {},
            logRecords: [
              {
                timeUnixNano: `${Date.now()}000000`,
                severityNumber: 17,
                body: { stringValue: EXCEPTION_MESSAGE },
                attributes: [
                  /*
                   * Explicit OTel exception.* attributes so
                   * LogExceptionExtractor path A fires deterministically
                   * (no reliance on the body heuristic).
                   */
                  stringAttribute("exception.message", EXCEPTION_MESSAGE),
                  stringAttribute("exception.type", "Error"),
                  stringAttribute("exception.stacktrace", EXCEPTION_STACK),
                  ...(data.logAttributes || []),
                ],
              },
            ],
          },
        ],
      },
    ],
  });
}

function insertedRows(spy: jest.SpyInstance): Array<JSONObject> {
  const rows: Array<JSONObject> = [];
  for (const call of spy.mock.calls) {
    for (const row of call[0] as Array<JSONObject>) {
      rows.push(row);
    }
  }
  return rows;
}

function onlyRow(spy: jest.SpyInstance): JSONObject {
  const rows: Array<JSONObject> = insertedRows(spy);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe("Session replay correlation: sessionId on Span / Log / ExceptionInstance", () => {
  let spanInsertSpy: jest.SpyInstance;
  let logInsertSpy: jest.SpyInstance;
  let exceptionInsertSpy: jest.SpyInstance;
  /*
   * Snapshotted at call time, NOT read back off spy.mock.calls: the ingest
   * job clears `pendingExceptionUpserts` in place once the flush resolves,
   * and jest records the array by reference, so the recorded argument is
   * empty by the time a test inspects it.
   */
  let upsertedPayloads: Array<TelemetryExceptionPayload>;

  beforeAll(() => {
    // Tiny flush window so buffered rows land in ~10ms, as in the fan-in suite.
    TelemetryFanInWriter.configure({
      maxWaitMs: 10,
      maxBatchRows: 50,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 5,
    });
  });

  beforeEach(() => {
    setupIngestMocks();
    spanInsertSpy = jest
      .spyOn(SpanService, "insertJsonRows")
      .mockResolvedValue(undefined);
    logInsertSpy = jest
      .spyOn(LogService, "insertJsonRows")
      .mockResolvedValue(undefined);
    exceptionInsertSpy = jest
      .spyOn(ExceptionInstanceService, "insertJsonRows")
      .mockResolvedValue(undefined);
    upsertedPayloads = [];
    jest
      .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
      .mockImplementation(
        async (exceptions: Array<TelemetryExceptionPayload>): Promise<void> => {
          for (const exception of exceptions) {
            upsertedPayloads.push({ ...exception });
          }
        },
      );
  });

  afterEach(async () => {
    await TelemetryFanInWriter.flushAll();
    jest.restoreAllMocks();
  });

  describe("trace path", () => {
    test("a session.id RESOURCE attribute reaches BOTH the span row and the exception row", async () => {
      /*
       * The highest-value test in this file. A browser SDK sets session.id
       * once on the resource; it arrives prefixed as "resource.session.id"
       * and appears on NO span or event attribute. An implementation that
       * reads only the bare key, or that expects the exception row to pick
       * the value out of its own attribute bag, fails here and only here.
       */
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          resourceAttributes: [stringAttribute("session.id", SESSION_ID)],
        }),
      );

      expect(onlyRow(spanInsertSpy)["sessionId"]).toBe(SESSION_ID);

      const exceptionRow: JSONObject = onlyRow(exceptionInsertSpy);
      expect(exceptionRow["sessionId"]).toBe(SESSION_ID);

      /*
       * Proof the exception row could not have got it from its attributes:
       * the bag is span EVENT attributes minus every exception.* key, so
       * it holds event.origin and nothing session-related.
       */
      const exceptionAttributes: JSONObject = exceptionRow[
        "attributes"
      ] as JSONObject;
      expect(Object.keys(exceptionAttributes)).toContain("event.origin");
      expect(Object.keys(exceptionAttributes)).not.toContain("session.id");
      expect(Object.keys(exceptionAttributes)).not.toContain(
        "resource.session.id",
      );
    });

    test("a span-level session.id attribute also reaches both rows", async () => {
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          resourceAttributes: [],
          spanAttributes: [stringAttribute("session.id", SESSION_ID)],
        }),
      );

      expect(onlyRow(spanInsertSpy)["sessionId"]).toBe(SESSION_ID);
      expect(onlyRow(exceptionInsertSpy)["sessionId"]).toBe(SESSION_ID);
    });

    test("a span-level session.id wins over the resource default", async () => {
      /*
       * spanAttributes is built as {...resourceAttributes, ...span attrs},
       * but the resource copy keeps its "resource." prefix, so both keys
       * coexist. The bare key must be preferred, otherwise a per-page
       * session override could never take effect.
       */
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          resourceAttributes: [stringAttribute("session.id", OTHER_SESSION_ID)],
          spanAttributes: [stringAttribute("session.id", SESSION_ID)],
        }),
      );

      expect(onlyRow(spanInsertSpy)["sessionId"]).toBe(SESSION_ID);
      expect(onlyRow(exceptionInsertSpy)["sessionId"]).toBe(SESSION_ID);
    });

    test("no session in context yields '' on both rows, never null or undefined", async () => {
      /*
       * The column is non-Nullable with a '' type default. A null or a
       * missing key would either be rejected or silently become '' at the
       * ClickHouse boundary; asserting '' here keeps the row shape honest
       * for every backend service that has no browser session at all.
       */
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({ resourceAttributes: [] }),
      );

      const spanRow: JSONObject = onlyRow(spanInsertSpy);
      const exceptionRow: JSONObject = onlyRow(exceptionInsertSpy);

      expect(spanRow["sessionId"]).toBe("");
      expect(exceptionRow["sessionId"]).toBe("");
      expect(spanRow["sessionId"]).not.toBeNull();
      expect(exceptionRow["sessionId"]).not.toBeNull();
    });
  });

  describe("log path", () => {
    test("a session.id RESOURCE attribute reaches BOTH the log row and the log-derived exception row", async () => {
      /*
       * collectExceptionFromLog hardcodes its attribute map to
       * {"exception.source","log.severityText"} and throws the log's own
       * attributes away, so this can only pass via an explicit
       * thread-through off the built log row.
       */
      await OtelLogsIngestService.processLogsFromQueue(
        logsRequest({
          resourceAttributes: [stringAttribute("session.id", SESSION_ID)],
        }),
      );

      expect(onlyRow(logInsertSpy)["sessionId"]).toBe(SESSION_ID);

      const exceptionRow: JSONObject = onlyRow(exceptionInsertSpy);
      expect(exceptionRow["sessionId"]).toBe(SESSION_ID);

      const exceptionAttributes: JSONObject = exceptionRow[
        "attributes"
      ] as JSONObject;
      expect(Object.keys(exceptionAttributes).sort()).toEqual([
        "exception.source",
        "log.severityText",
      ]);
    });

    test("a log-level session.id attribute also reaches both rows", async () => {
      await OtelLogsIngestService.processLogsFromQueue(
        logsRequest({
          resourceAttributes: [],
          logAttributes: [stringAttribute("session.id", SESSION_ID)],
        }),
      );

      expect(onlyRow(logInsertSpy)["sessionId"]).toBe(SESSION_ID);
      expect(onlyRow(exceptionInsertSpy)["sessionId"]).toBe(SESSION_ID);
    });

    test("no session in context yields '' on both rows", async () => {
      await OtelLogsIngestService.processLogsFromQueue(
        logsRequest({ resourceAttributes: [] }),
      );

      expect(onlyRow(logInsertSpy)["sessionId"]).toBe("");
      expect(onlyRow(exceptionInsertSpy)["sessionId"]).toBe("");
    });
  });

  describe("the fingerprint must stay session-independent", () => {
    test("the same exception in two different sessions keeps ONE fingerprint", async () => {
      /*
       * If sessionId ever leaks into ExceptionFingerprintInput, this test
       * fails and the production consequence is severe: the fingerprint is
       * the (projectId, primaryEntityId, fingerprint) unique-index
       * conflict target on TelemetryException, so every existing group
       * would be re-fingerprinted and lose its resolved / archived /
       * occuranceCount triage state.
       */
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          resourceAttributes: [stringAttribute("session.id", SESSION_ID)],
        }),
      );
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          resourceAttributes: [stringAttribute("session.id", OTHER_SESSION_ID)],
        }),
      );

      const exceptionRows: Array<JSONObject> = insertedRows(exceptionInsertSpy);
      expect(exceptionRows).toHaveLength(2);

      // Different sessions...
      expect(
        exceptionRows.map((row: JSONObject): unknown => {
          return row["sessionId"];
        }),
      ).toEqual([SESSION_ID, OTHER_SESSION_ID]);

      // ...one fingerprint.
      expect(exceptionRows[0]!["fingerprint"]).toBe(
        exceptionRows[1]!["fingerprint"],
      );
    });

    test("the Postgres TelemetryException upsert payload carries no sessionId", async () => {
      /*
       * TelemetryException is the per-group triage row. A session is a
       * property of an occurrence, never of the group, so nothing
       * session-shaped may reach this payload.
       */
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          resourceAttributes: [stringAttribute("session.id", SESSION_ID)],
        }),
      );

      expect(upsertedPayloads.length).toBeGreaterThan(0);
      for (const payload of upsertedPayloads) {
        expect(Object.keys(payload)).not.toContain("sessionId");
      }
    });

    test("getFingerprint ignores any stray sessionId handed to it", async () => {
      /*
       * A compile-time guard would be better, but ExceptionFingerprintInput
       * is a plain interface: excess-property checking only fires on object
       * literals, so a future caller spreading an object with sessionId in
       * it would compile. This pins the runtime behaviour instead — the
       * hash is built from an explicit five-field list, so an extra
       * property cannot change it.
       */
      const base: ExceptionFingerprintInput = {
        projectId: PROJECT_ID,
        primaryEntityId: SERVICE_ID,
        message: EXCEPTION_MESSAGE,
        stackTrace: EXCEPTION_STACK,
        exceptionType: "Error",
      };

      const withSession: ExceptionFingerprintInput = {
        ...base,
        ...({ sessionId: SESSION_ID } as Record<string, unknown>),
      };

      expect(ExceptionUtil.getFingerprint(withSession)).toBe(
        ExceptionUtil.getFingerprint(base),
      );
    });
  });
});
