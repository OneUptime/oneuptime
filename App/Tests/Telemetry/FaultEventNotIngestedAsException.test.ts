import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import ExceptionUtil, {
  TelemetryExceptionPayload,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import SpanService from "Common/Server/Services/SpanService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import ErrorClass from "Common/Types/Telemetry/ErrorClass";
import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * THE INGEST HALF OF FAULT CLASSIFICATION, end to end through the real OTLP
 * walk and row builders.
 *
 * Trace ingest mints an ExceptionInstance row and a TelemetryException group
 * for every span event literally named "exception", and for nothing else. That
 * name IS the mechanism by which a user error stops becoming an Issue, so it
 * has to be pinned here rather than only on the emit side — an ingest change
 * that started matching on something looser would silently undo the entire
 * design while every emit-side test kept passing.
 *
 * These run the real processTracesFromQueue so the assertions cover the actual
 * OTLP attribute walk, the drop/scrub/pipeline ordering, and the row builders,
 * not a hand-made stand-in.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "fault-classification-test-service";

const TRACE_ID_HEX: string = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID_HEX: string = "b7ad6b7169203331";

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
  const service: Record<string, any> = OtelTracesIngestService as unknown as {
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

  jest
    .spyOn(TraceDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as any);
  jest
    .spyOn(TraceScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as any);
  jest
    .spyOn(TracePipelineService, "loadPipelines")
    .mockResolvedValue([] as any);

  /*
   * All four loaders share one Promise.all, and the catch around it resets
   * EVERY list to empty if any of them rejects. Leaving this one unmocked lets
   * it reach Postgres, fail, and silently disable the pipeline under test —
   * which looks exactly like a broken pipeline rather than a broken mock.
   */
  jest
    .spyOn(LlmModelPriceService, "loadModelPrices")
    .mockResolvedValue([] as any);
}

function tracesRequestWithEvent(event: JSONObject): TelemetryRequest {
  const nowNano: string = `${Date.now()}000000`;

  return {
    projectId: PROJECT_ID,
    headers: {},
    body: {
      resourceSpans: [
        {
          resource: {
            attributes: [stringAttribute("service.name", SERVICE_NAME)],
          },
          scopeSpans: [
            {
              scope: {},
              spans: [
                {
                  traceId: TRACE_ID_HEX,
                  spanId: SPAN_ID_HEX,
                  parentSpanId: "",
                  name: "POST /api/monitor",
                  kind: 2,
                  startTimeUnixNano: nowNano,
                  endTimeUnixNano: nowNano,
                  status: { code: 2 },
                  attributes: [stringAttribute("http.method", "POST")],
                  events: [event],
                  links: [],
                },
              ],
            },
          ],
        },
      ],
    },
  } as unknown as TelemetryRequest;
}

function faultEvent(errorClass: ErrorClass = ErrorClass.UserError): JSONObject {
  return {
    name: "fault",
    timeUnixNano: `${Date.now()}000000`,
    attributes: [
      stringAttribute("error.class", errorClass),
      stringAttribute("error.type", "BadDataException"),
      stringAttribute("error.message", "Name is required"),
      stringAttribute("error.code", "400"),
    ],
  };
}

function exceptionEvent(
  extraAttributes: Array<OtlpAttribute> = [],
): JSONObject {
  return {
    name: "exception",
    timeUnixNano: `${Date.now()}000000`,
    attributes: [
      stringAttribute("exception.message", "Something broke"),
      stringAttribute("exception.type", "ServerException"),
      stringAttribute(
        "exception.stacktrace",
        "Error: Something broke\n    at handler (app.js:10:5)",
      ),
      stringAttribute("exception.code", "23505"),
      stringAttribute("event.origin", "server"),
      ...extraAttributes,
    ],
  };
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

describe("Trace ingest: fault events never become Issues", () => {
  let spanInsertSpy: jest.SpyInstance;
  let exceptionInsertSpy: jest.SpyInstance;
  /*
   * Snapshotted at call time, not read back off spy.mock.calls: the ingest job
   * clears pendingExceptionUpserts in place once the flush resolves, and jest
   * records the array by reference.
   */
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
    spanInsertSpy = jest
      .spyOn(SpanService, "insertJsonRows")
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

  /*
   * THE CORE ASSERTION OF THE WHOLE DESIGN. Rename the event, and no Issue is
   * created — with no ingest change, no schema change and no migration.
   */
  test("a 'fault' event produces no ExceptionInstance row and no TelemetryException group", async () => {
    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequestWithEvent(faultEvent()),
    );

    expect(insertedRows(exceptionInsertSpy)).toHaveLength(0);
    expect(upsertedPayloads).toHaveLength(0);
  });

  /*
   * NOTHING IS DESTROYED. The suppressed failure is still on the span, still
   * queryable, still rendered in the Traces UI Events tab. It just is not an
   * Issue.
   */
  test("the fault event is still stored on the span row, with all its attributes", async () => {
    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequestWithEvent(faultEvent()),
    );

    const spanRow: JSONObject = onlyRow(spanInsertSpy);
    const events: JSONArray = spanRow["events"] as JSONArray;

    expect(events).toHaveLength(1);

    const event: JSONObject = events[0] as JSONObject;
    expect(event["name"]).toBe("fault");

    const attributes: JSONObject = event["attributes"] as JSONObject;
    expect(attributes["error.class"]).toBe(ErrorClass.UserError);
    expect(attributes["error.type"]).toBe("BadDataException");
    expect(attributes["error.message"]).toBe("Name is required");
    expect(attributes["error.code"]).toBe("400");
  });

  test("a span carrying only a fault event is not marked as having an exception", async () => {
    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequestWithEvent(faultEvent()),
    );

    expect(onlyRow(spanInsertSpy)["hasException"]).toBe(false);
  });

  test.each([[ErrorClass.UserError], [ErrorClass.ExpectedDenial]])(
    "a fault event classed %s creates no Issue",
    async (errorClass: ErrorClass) => {
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequestWithEvent(faultEvent(errorClass)),
      );

      expect(insertedRows(exceptionInsertSpy)).toHaveLength(0);
    },
  );

  test("a normal exception event still becomes an Issue", async () => {
    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequestWithEvent(exceptionEvent()),
    );

    expect(insertedRows(exceptionInsertSpy)).toHaveLength(1);
    expect(upsertedPayloads).toHaveLength(1);
    expect(onlyRow(spanInsertSpy)["hasException"]).toBe(true);
  });
});

describe("Trace ingest: honouring error.class from any emitter", () => {
  let exceptionInsertSpy: jest.SpyInstance;
  let upsertedPayloads: Array<TelemetryExceptionPayload>;

  beforeEach(() => {
    setupIngestMocks();
    jest.spyOn(SpanService, "insertJsonRows").mockResolvedValue(undefined);
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

  /*
   * Forward compatibility for emitters we do not control. A customer's SDK
   * cannot easily rename the exception event its instrumentation produces, but
   * it CAN set one attribute — so an exception event that declares itself
   * non-actionable gets the same treatment.
   */
  test.each([[ErrorClass.UserError], [ErrorClass.ExpectedDenial]])(
    "an exception event declaring %s creates no Issue",
    async (errorClass: ErrorClass) => {
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequestWithEvent(
          exceptionEvent([stringAttribute("error.class", errorClass)]),
        ),
      );

      expect(insertedRows(exceptionInsertSpy)).toHaveLength(0);
      expect(upsertedPayloads).toHaveLength(0);
    },
  );

  /*
   * AN EMITTER MUST NOT BE ABLE TO SILENCE ITSELF BY ACCIDENT. Only the two
   * non-actionable classes are honoured; everything else — including a
   * misspelling, a different case, or a class that means "this IS a bug" —
   * falls through and becomes an Issue.
   */
  test.each([
    ["code-fault", ErrorClass.CodeFault],
    ["infrastructure", ErrorClass.Infrastructure],
    ["unknown", ErrorClass.Unknown],
    ["wrong case", "USER-ERROR"],
    ["misspelled", "user_error"],
    ["nonsense", "definitely-not-a-class"],
    ["empty", ""],
  ])(
    "an exception event declaring %s still creates an Issue",
    async (_name: string, value: string) => {
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequestWithEvent(
          exceptionEvent([stringAttribute("error.class", value)]),
        ),
      );

      expect(insertedRows(exceptionInsertSpy)).toHaveLength(1);
    },
  );
});

describe("Trace ingest: exception row data fidelity", () => {
  let exceptionInsertSpy: jest.SpyInstance;

  beforeEach(() => {
    setupIngestMocks();
    jest.spyOn(SpanService, "insertJsonRows").mockResolvedValue(undefined);
    exceptionInsertSpy = jest
      .spyOn(ExceptionInstanceService, "insertJsonRows")
      .mockResolvedValue(undefined);
    jest
      .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
      .mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await TelemetryFanInWriter.flushAll();
    jest.restoreAllMocks();
  });

  /*
   * ABSENT MEANS UNKNOWN, NOT "HANDLED". The column is Nullable and the logs
   * path already preserves the tri-state; inventing `false` here was
   * affirmatively wrong for span exceptions, which by construction escaped the
   * span that recorded them.
   */
  test("a missing exception.escaped stays null rather than becoming false", async () => {
    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequestWithEvent(exceptionEvent()),
    );

    expect(onlyRow(exceptionInsertSpy)["escaped"]).toBeNull();
  });

  test.each([
    ["true", true],
    ["false", false],
  ])(
    "an explicit exception.escaped=%s is preserved",
    async (value: string, expected: boolean) => {
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequestWithEvent(
          exceptionEvent([stringAttribute("exception.escaped", value)]),
        ),
      );

      expect(onlyRow(exceptionInsertSpy)["escaped"]).toBe(expected);
    },
  );

  /*
   * Only the four keys promoted to their own columns are stripped. Everything
   * else the emitter attached survives, which is what keeps history
   * re-classifiable later — `exception.code` in particular carries the HTTP
   * status or the Postgres SQLSTATE, and used to be discarded for a few bytes.
   */
  test("exception.code survives into the stored attribute bag", async () => {
    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequestWithEvent(exceptionEvent()),
    );

    const attributes: JSONObject = onlyRow(exceptionInsertSpy)[
      "attributes"
    ] as JSONObject;

    expect(attributes["exception.code"]).toBe("23505");
    expect(attributes["event.origin"]).toBe("server");
  });

  test("the four promoted keys are still stripped, since they have their own columns", async () => {
    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequestWithEvent(
        exceptionEvent([stringAttribute("exception.escaped", "true")]),
      ),
    );

    const row: JSONObject = onlyRow(exceptionInsertSpy);
    const attributes: JSONObject = row["attributes"] as JSONObject;

    for (const key of [
      "exception.message",
      "exception.stacktrace",
      "exception.type",
      "exception.escaped",
    ]) {
      expect(attributes[key]).toBeUndefined();
    }

    // ...and they are present as columns instead.
    expect(row["message"]).toBe("Something broke");
    expect(row["exceptionType"]).toBe("ServerException");
  });
});

describe("Trace ingest: the exception row agrees with the span row", () => {
  let spanInsertSpy: jest.SpyInstance;
  let exceptionInsertSpy: jest.SpyInstance;

  beforeEach(() => {
    setupIngestMocks();
    spanInsertSpy = jest
      .spyOn(SpanService, "insertJsonRows")
      .mockResolvedValue(undefined);
    exceptionInsertSpy = jest
      .spyOn(ExceptionInstanceService, "insertJsonRows")
      .mockResolvedValue(undefined);
    jest
      .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
      .mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await TelemetryFanInWriter.flushAll();
    jest.restoreAllMocks();
  });

  /*
   * A project's StatusRemapper processor rewrites the span row's statusCode at
   * ingest — it is the one shipped, user-facing lever for saying "a 404 on
   * this route is not an error". The exception path used to be handed the
   * status parsed from the raw OTLP payload, captured BEFORE finalizeSpanRow,
   * scrub and the pipeline ran, so the span row and the exception row for the
   * same span disagreed and the lever was silently ineffective on Issues.
   *
   * The sibling `sessionId` field two lines below the fix is deliberately read
   * back off the post-pipeline row with a comment saying it is done that way
   * "so the exception row and the span row can never disagree". This is the
   * same invariant.
   */
  test("a pipeline that remaps the span status also moves the exception row", async () => {
    jest
      .spyOn(TracePipelineService, "loadPipelines")
      .mockResolvedValue([{ id: "remapper" }] as any);

    jest
      .spyOn(TracePipelineService, "processSpan")
      .mockImplementation((spanRow: JSONObject): JSONObject => {
        // What a StatusRemapper does: Error -> Ok for this route.
        return { ...spanRow, statusCode: SpanStatus.Ok };
      });

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequestWithEvent(exceptionEvent()),
    );

    expect(onlyRow(spanInsertSpy)["statusCode"]).toBe(SpanStatus.Ok);
    expect(onlyRow(exceptionInsertSpy)["spanStatusCode"]).toBe(SpanStatus.Ok);
  });

  test("with no pipeline configured the exception row keeps the payload status", async () => {
    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequestWithEvent(exceptionEvent()),
    );

    expect(onlyRow(exceptionInsertSpy)["spanStatusCode"]).toBe(
      SpanStatus.Error,
    );
  });

  test("a pipeline that renames the span also moves the exception row's spanName", async () => {
    jest
      .spyOn(TracePipelineService, "loadPipelines")
      .mockResolvedValue([{ id: "renamer" }] as any);

    jest
      .spyOn(TracePipelineService, "processSpan")
      .mockImplementation((spanRow: JSONObject): JSONObject => {
        return { ...spanRow, name: "POST /api/monitor {id}" };
      });

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequestWithEvent(exceptionEvent()),
    );

    expect(onlyRow(exceptionInsertSpy)["spanName"]).toBe(
      "POST /api/monitor {id}",
    );
  });
});
