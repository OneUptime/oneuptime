/*
 * A mobile app's crashes and ANRs, end to end through the real OTLP walk:
 * OTLP JSON -> processLogsFromQueue -> the log row, the exception row and the
 * exception group upsert.
 *
 * OpenTelemetry Android reports both as log records that are events -
 * `app.crash` and `device.anr`, in the record's event name field - never
 * as spans. A crash sets no exception.escaped, and only that made a
 * log-derived exception unhandled, so every crash was filed as handled; an
 * ANR carries the main thread's stack and nothing else, so it was an
 * exception with no type and no message. Only walking a real payload shows
 * that the event name reaches the extractor: it travels in the record's own
 * field, and log ingest stamps it onto the `event.name` attribute
 * (LogEventName) before anything reads it.
 */
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import ExceptionUtil, {
  TelemetryExceptionPayload,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import LogService from "Common/Server/Services/LogService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import {
  ANR_EXCEPTION_MESSAGE,
  ANR_EXCEPTION_TYPE,
} from "Common/Utils/Telemetry/MobileAppFaults";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const PROJECT_ID: ObjectID = ObjectID.generate();
const RUM_APPLICATION_ID: ObjectID = ObjectID.generate();
const APP_NAME: string = "kiosk-ordering";

const CRASH_STACK: string = [
  "java.lang.IllegalStateException: Printer not connected",
  "\tat com.example.kiosk.ReceiptPrinter.print(ReceiptPrinter.kt:42)",
  "\tat com.example.kiosk.CheckoutActivity.onPaid(CheckoutActivity.kt:118)",
].join("\n");

const MAIN_THREAD_STACK: string = [
  "\tat java.lang.Thread.sleep(Native Method)",
  "\tat com.example.kiosk.PaymentTerminal.waitForCard(PaymentTerminal.kt:77)",
  "\tat com.example.kiosk.CheckoutActivity.onPay(CheckoutActivity.kt:96)",
].join("\n");

// Auto-discovery methods on OtelIngestBaseService that hit Postgres.
const AUTO_DISCOVERY_METHODS_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverCephCluster",
  "autoDiscoverStorageArray",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

type OtlpAttribute = { key: string; value: JSONObject };

function stringAttribute(key: string, value: string): OtlpAttribute {
  return { key: key, value: { stringValue: value } };
}

function intAttribute(key: string, value: number): OtlpAttribute {
  return { key: key, value: { intValue: String(value) } };
}

function setupIngestMocks(): void {
  const service: Record<string, any> = OtelLogsIngestService as unknown as {
    [key: string]: any;
  };

  for (const method of AUTO_DISCOVERY_METHODS_RETURNING_NULL) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }

  // The app's telemetry is its RUM application's.
  jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
    serviceName: APP_NAME,
    primaryEntityId: RUM_APPLICATION_ID,
    primaryEntityType: ServiceType.RealUserMonitor,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  });

  jest.spyOn(LogPipelineService, "loadPipelines").mockResolvedValue([] as any);
  jest
    .spyOn(LogDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as any);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as any);
}

/*
 * One log record as OpenTelemetry Android exports it: the event's name in
 * the record's own field (OTLP/JSON spells it eventName), its attributes,
 * no body and no severity. `eventNameAsAttribute` sends the name the older
 * way, as an `event.name` attribute.
 */
function logsRequest(data: {
  eventName?: string;
  eventNameAsAttribute?: string;
  attributes: Array<OtlpAttribute>;
  severityNumber?: number;
  body?: string;
}): TelemetryRequest {
  const record: JSONObject = {
    timeUnixNano: `${Date.now()}000000`,
    attributes: [
      ...data.attributes,
      ...(data.eventNameAsAttribute
        ? [stringAttribute("event.name", data.eventNameAsAttribute)]
        : []),
    ],
  };

  if (data.eventName) {
    record["eventName"] = data.eventName;
  }

  if (data.severityNumber !== undefined) {
    record["severityNumber"] = data.severityNumber;
  }

  if (data.body !== undefined) {
    record["body"] = { stringValue: data.body };
  }

  return {
    projectId: PROJECT_ID,
    headers: {},
    body: {
      resourceLogs: [
        {
          resource: {
            attributes: [
              stringAttribute("service.name", APP_NAME),
              stringAttribute("device.model.identifier", "Elo-i3-15"),
              stringAttribute("device.manufacturer", "Elo Touch Solutions"),
              stringAttribute("os.name", "Android"),
              stringAttribute("os.version", "13"),
              stringAttribute("session.id", "7a1d2c3b4e5f60718293a4b5c6d7e8f9"),
            ],
          },
          scopeLogs: [
            {
              scope: { name: "io.opentelemetry.crash" },
              logRecords: [record],
            },
          ],
        },
      ],
    },
  } as unknown as TelemetryRequest;
}

function crashAttributes(): Array<OtlpAttribute> {
  return [
    stringAttribute("exception.type", "java.lang.IllegalStateException"),
    stringAttribute("exception.message", "Printer not connected"),
    stringAttribute("exception.stacktrace", CRASH_STACK),
    intAttribute("thread.id", 2),
    stringAttribute("thread.name", "main"),
  ];
}

// What a test reads off a spy: the arguments of each call.
type CallRecorder = { mock: { calls: Array<Array<unknown>> } };

function insertedRows(spy: CallRecorder): Array<JSONObject> {
  const rows: Array<JSONObject> = [];
  for (const call of spy.mock.calls) {
    for (const row of call[0] as Array<JSONObject>) {
      rows.push(row);
    }
  }
  return rows;
}

function onlyRow(spy: CallRecorder): JSONObject {
  const rows: Array<JSONObject> = insertedRows(spy);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe("A mobile app's crashes and ANRs reach Exceptions as unhandled", () => {
  let logInsertSpy: CallRecorder;
  let exceptionInsertSpy: CallRecorder;
  let upsertedPayloads: Array<TelemetryExceptionPayload>;

  beforeAll(() => {
    TelemetryFanInWriter.configure({
      maxWaitMs: 10,
      maxBatchRows: 50,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 5,
    });
  });

  beforeEach(() => {
    setupIngestMocks();
    logInsertSpy = jest
      .spyOn(LogService, "insertJsonRows")
      .mockResolvedValue(undefined) as unknown as CallRecorder;
    exceptionInsertSpy = jest
      .spyOn(ExceptionInstanceService, "insertJsonRows")
      .mockResolvedValue(undefined) as unknown as CallRecorder;
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

  async function ingest(request: TelemetryRequest): Promise<void> {
    await OtelLogsIngestService.processLogsFromQueue(request);
    await TelemetryFanInWriter.flushAll();
  }

  describe("a crash (app.crash)", () => {
    test("is an unhandled exception with what was thrown, filed under the app", async () => {
      await ingest(
        logsRequest({
          eventName: "app.crash",
          attributes: crashAttributes(),
        }),
      );

      const row: JSONObject = onlyRow(exceptionInsertSpy);
      expect(row["exceptionType"]).toBe("java.lang.IllegalStateException");
      expect(row["message"]).toBe("Printer not connected");
      expect(row["stackTrace"]).toBe(CRASH_STACK);
      expect(row["escaped"]).toBe(true);
      expect(row["primaryEntityId"]).toBe(RUM_APPLICATION_ID.toString());
      expect(row["primaryEntityType"]).toBe(ServiceType.RealUserMonitor);
      // The session the crash ended, for its replay and its other signals.
      expect(row["sessionId"]).toBe("7a1d2c3b4e5f60718293a4b5c6d7e8f9");

      expect(upsertedPayloads).toHaveLength(1);
      expect(upsertedPayloads[0]!.unhandled).toBe(true);
      expect(upsertedPayloads[0]!.exceptionType).toBe(
        "java.lang.IllegalStateException",
      );
    });

    test("the occurrence says it was a crash", async () => {
      await ingest(
        logsRequest({
          eventName: "app.crash",
          attributes: crashAttributes(),
        }),
      );

      expect(onlyRow(exceptionInsertSpy)["attributes"]).toEqual({
        "exception.source": "log",
        "log.severityText": "Unspecified",
        "event.name": "app.crash",
      });
    });

    test("the log record stays searchable by its event name", async () => {
      await ingest(
        logsRequest({
          eventName: "app.crash",
          attributes: crashAttributes(),
        }),
      );

      const log: JSONObject = onlyRow(logInsertSpy);
      expect((log["attributes"] as JSONObject)["event.name"]).toBe("app.crash");
    });

    test("a release before 1.5.0, which named it device.crash, is read the same", async () => {
      await ingest(
        logsRequest({
          eventName: "device.crash",
          attributes: crashAttributes(),
        }),
      );

      const row: JSONObject = onlyRow(exceptionInsertSpy);
      expect(row["escaped"]).toBe(true);
      expect((row["attributes"] as JSONObject)["event.name"]).toBe(
        "device.crash",
      );
      expect(upsertedPayloads[0]!.unhandled).toBe(true);
    });

    test("a release that sent the name as an event.name attribute (0.10 and older) is read the same", async () => {
      await ingest(
        logsRequest({
          eventNameAsAttribute: "device.crash",
          attributes: crashAttributes(),
        }),
      );

      expect(onlyRow(exceptionInsertSpy)["escaped"]).toBe(true);
      expect(upsertedPayloads[0]!.unhandled).toBe(true);
    });
  });

  describe("an ANR (device.anr)", () => {
    test("is an unhandled exception named ANR, with the main thread's stack", async () => {
      await ingest(
        logsRequest({
          eventName: "device.anr",
          attributes: [
            stringAttribute("exception.stacktrace", MAIN_THREAD_STACK),
          ],
        }),
      );

      const row: JSONObject = onlyRow(exceptionInsertSpy);
      expect(row["exceptionType"]).toBe(ANR_EXCEPTION_TYPE);
      expect(row["message"]).toBe(ANR_EXCEPTION_MESSAGE);
      expect(row["stackTrace"]).toBe(MAIN_THREAD_STACK);
      expect(row["escaped"]).toBe(true);
      expect((row["attributes"] as JSONObject)["event.name"]).toBe(
        "device.anr",
      );

      expect(upsertedPayloads).toHaveLength(1);
      expect(upsertedPayloads[0]!.unhandled).toBe(true);
      expect(upsertedPayloads[0]!.exceptionType).toBe(ANR_EXCEPTION_TYPE);
      expect(upsertedPayloads[0]!.message).toBe(ANR_EXCEPTION_MESSAGE);
    });

    test("two ANRs blocked in the same place are one exception", async () => {
      await ingest(
        logsRequest({
          eventName: "device.anr",
          attributes: [
            stringAttribute("exception.stacktrace", MAIN_THREAD_STACK),
          ],
        }),
      );
      await ingest(
        logsRequest({
          eventName: "device.anr",
          attributes: [
            stringAttribute("exception.stacktrace", MAIN_THREAD_STACK),
          ],
        }),
      );

      const rows: Array<JSONObject> = insertedRows(exceptionInsertSpy);
      expect(rows).toHaveLength(2);
      expect(rows[0]!["fingerprint"]).toBe(rows[1]!["fingerprint"]);
    });
  });

  describe("what is not a crash or an ANR is as it was", () => {
    test("a log with exception attributes and no fault event stays handled", async () => {
      await ingest(
        logsRequest({ attributes: crashAttributes(), severityNumber: 17 }),
      );

      const row: JSONObject = onlyRow(exceptionInsertSpy);
      expect(row["escaped"]).toBeNull();
      expect(row["attributes"]).toEqual({
        "exception.source": "log",
        "log.severityText": "Error",
      });
      expect(upsertedPayloads[0]!.unhandled).toBe(false);
    });

    test("another event with no exception in it makes no exception", async () => {
      await ingest(
        logsRequest({
          eventName: "network.change",
          attributes: [stringAttribute("network.status", "lost")],
        }),
      );

      expect(insertedRows(exceptionInsertSpy)).toHaveLength(0);
      expect(upsertedPayloads).toHaveLength(0);
      expect(insertedRows(logInsertSpy)).toHaveLength(1);
    });
  });
});
