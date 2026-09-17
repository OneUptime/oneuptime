import { afterEach, describe, expect, test, beforeEach } from "@jest/globals";

/*
 * The two halves of the `service.name` pin, which is the control that makes a
 * PUBLISHED (Browser) ingestion key survivable.
 *
 * A Browser key is pasted into page source by design, so it must be assumed
 * scraped. The origin allowlist and the per-key rate limit bound how much
 * forged telemetry a thief can write and from where; NEITHER stops them
 * writing it as `service.name: "payments-api"` and poisoning the dashboards,
 * telemetry monitors and alert rules of a backend service that never emitted
 * a byte of it. The pin is what makes forged data self-identifying.
 *
 * It has to be enforced in two places that can drift apart, because the OTLP
 * payload is not decoded at the HTTP edge — the edge only ever sees raw,
 * usually gzipped protobuf bytes it stashes in Redis:
 *
 *   1. ENQUEUE (TelemetryQueueService.addTelemetryIngestJob) must copy the
 *      admitting key's pinnedServiceName onto the job, because that is the
 *      only channel by which the worker can learn it. It must ALSO stay
 *      absent when there is nothing to pin — including for the producers
 *      (gRPC, MQTT, Pyroscope) that hand-build a TelemetryRequest and carry
 *      no policy at all, which must not crash — and it must not become a
 *      precedent for smuggling the ingestion token onto the job alongside it.
 *
 *   2. WORKER (ProcessTelemetry.resolveOtelBody -> applyPinnedServiceName)
 *      must rewrite the decoded body BEFORE any ingest service reads a
 *      service name out of it, for every OTLP signal, and must leave the body
 *      untouched when there is no pin.
 *
 * The load-bearing case in here is the last one: a pin that fails to apply is
 * a labelling failure on ONE key whose abuse is still bounded by the origin
 * allowlist and the rate limit, whereas letting that failure escape would
 * fail the whole BullMQ job — and the retry re-hits the same payload forever,
 * so it is permanent loss of every span in the batch. The pin must never be
 * able to take a batch down with it.
 */

let capturedHandler: ((job: unknown) => Promise<void>) | null = null;

jest.mock("Common/Server/Infrastructure/QueueWorker", () => {
  return {
    __esModule: true,
    default: {
      getWorker: (
        _name: unknown,
        handler: (job: unknown) => Promise<void>,
      ): void => {
        capturedHandler = handler;
      },
    },
  };
});

/*
 * Queue pulls BullMQ / bull-board in at import time and the enqueue-side
 * contract under test is only "what job data is handed to addJob", so the
 * whole module is replaced. QueueName mirrors the real enum so ProcessTelemetry
 * still registers its worker against the Telemetry queue.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn().mockResolvedValue(undefined),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
      MarketingEvent: "MarketingEvent",
    },
  };
});

const processTracesFromQueue: jest.Mock = jest.fn();
jest.mock("../../FeatureSet/Telemetry/Services/OtelTracesIngestService", () => {
  return {
    __esModule: true,
    default: { processTracesFromQueue },
  };
});

const processLogsFromQueue: jest.Mock = jest.fn();
jest.mock("../../FeatureSet/Telemetry/Services/OtelLogsIngestService", () => {
  return {
    __esModule: true,
    default: { processLogsFromQueue },
  };
});

const processMetricsFromQueue: jest.Mock = jest.fn();
jest.mock(
  "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService",
  () => {
    return {
      __esModule: true,
      default: { processMetricsFromQueue },
    };
  },
);

const processProfilesFromQueue: jest.Mock = jest.fn();
jest.mock(
  "../../FeatureSet/Telemetry/Services/OtelProfilesIngestService",
  () => {
    return {
      __esModule: true,
      default: { processProfilesFromQueue },
    };
  },
);

const processSyslogFromQueue: jest.Mock = jest.fn();
jest.mock("../../FeatureSet/Telemetry/Services/SyslogIngestService", () => {
  return {
    __esModule: true,
    default: { processSyslogFromQueue },
  };
});

const processFluentLogsFromQueue: jest.Mock = jest.fn();
jest.mock("../../FeatureSet/Telemetry/Services/FluentLogsIngestService", () => {
  return {
    __esModule: true,
    default: { processFluentLogsFromQueue },
  };
});

/*
 * Serves both halves of this suite: storeBody for the enqueue path (a
 * deterministic in-memory key instead of a Redis SET) and deleteBody for the
 * worker's post-success reclaim, which is how the "the job still succeeded"
 * assertions observe success without inspecting BullMQ.
 */
const storeBody: jest.Mock = jest
  .fn()
  .mockResolvedValue("telemetry:body:test-key");
const deleteBody: jest.Mock = jest.fn();
jest.mock("../../FeatureSet/Telemetry/Utils/TelemetryBodyStore", () => {
  return {
    __esModule: true,
    default: { deleteBody, storeBody, readBody: jest.fn() },
  };
});

jest.mock(
  "isolated-vm",
  () => {
    const Isolate: jest.Mock = jest.fn();
    const Reference: jest.Mock = jest.fn();
    const Callback: jest.Mock = jest.fn();
    const ExternalCopy: jest.Mock = jest
      .fn()
      .mockImplementation((value: unknown) => {
        return {
          copyInto: jest.fn(() => {
            return value;
          }),
        };
      });

    return {
      __esModule: true,
      default: { Isolate, Reference, Callback, ExternalCopy },
      Isolate,
      Reference,
      Callback,
      ExternalCopy,
    };
  },
  { virtual: true },
);

// Importing the module registers the worker via the mocked QueueWorker.
import "../../FeatureSet/Telemetry/Jobs/TelemetryIngest/ProcessTelemetry";
import TelemetryQueueService, {
  TelemetryIngestJobData,
  TelemetryType,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import OtelPayloadDecoder from "../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder";
import PinServiceName from "Common/Server/Utils/Telemetry/PinServiceName";
import Queue from "Common/Server/Infrastructure/Queue";
import ObjectID from "Common/Types/ObjectID";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import { JSONObject } from "Common/Types/JSON";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";

const PROJECT_ID: string = "11111111-1111-1111-1111-111111111111";
const BODY_KEY: string = "telemetry:body:pin-test";
const PINNED_SERVICE_NAME: string = "browser-storefront";
const ATTACKER_SERVICE_NAME: string = "payments-api";

function policyWithPin(
  pinnedServiceName: string | null,
): TelemetryIngestionKeyPolicy {
  return {
    ingestionKeyId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    keyType: TelemetryIngestionKeyType.Browser,
    allowedOrigins: ["https://shop.example.com"],
    pinnedServiceName,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
  };
}

function getEnqueuedJobData(callIndex: number = 0): TelemetryIngestJobData {
  const addJobMock: jest.Mock = Queue.addJob as unknown as jest.Mock;
  return addJobMock.mock.calls[callIndex]![3] as TelemetryIngestJobData;
}

/*
 * One OTLP resource block carrying the customer's (or the forger's) own
 * service.name plus an unrelated attribute, so the tests can tell "the pin
 * replaced service.name" apart from "the pin flattened the attribute list".
 */
function resourceBlock(serviceName: string): JSONObject {
  return {
    resource: {
      attributes: [
        { key: "service.name", value: { stringValue: serviceName } },
        { key: "host.name", value: { stringValue: "box-1" } },
      ],
    },
  };
}

function otlpBody(containerKey: string, serviceName: string): JSONObject {
  return {
    [containerKey]: [resourceBlock(serviceName)],
  };
}

/* Every service.name string found on the resources of one OTLP container. */
function serviceNamesIn(body: JSONObject, containerKey: string): Array<string> {
  const container: Array<JSONObject> =
    (body[containerKey] as unknown as Array<JSONObject>) ?? [];

  const names: Array<string> = [];

  for (const block of container) {
    const attributes: Array<JSONObject> =
      ((block["resource"] as JSONObject | undefined)?.[
        "attributes"
      ] as unknown as Array<JSONObject>) ?? [];

    for (const attribute of attributes) {
      if (attribute["key"] === "service.name") {
        names.push((attribute["value"] as JSONObject)["stringValue"] as string);
      }
    }
  }

  return names;
}

function otelJob(
  telemetryType: TelemetryType,
  productType: ProductType,
  pinnedServiceName?: string,
): unknown {
  const data: JSONObject = {
    type: telemetryType,
    projectId: PROJECT_ID,
    bodyKey: BODY_KEY,
    bodyFormat: "json",
    bodyEncoding: "none",
    productType,
    requestHeaders: {},
  };

  if (pinnedServiceName !== undefined) {
    data["pinnedServiceName"] = pinnedServiceName;
  }

  return {
    id: `${telemetryType}-${PROJECT_ID}-1-abc`,
    name: "ProcessTelemetry",
    data,
  };
}

describe("addTelemetryIngestJob — carrying the pin to the worker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storeBody.mockResolvedValue("telemetry:body:test-key");
  });

  test("a key with a pinned service name puts that pin on the job, since the worker has no other way to learn it", async () => {
    const req: TelemetryRequest = {
      projectId: new ObjectID(PROJECT_ID),
      productType: ProductType.Traces,
      ingestionKeyPolicy: policyWithPin(PINNED_SERVICE_NAME),
      headers: { "content-type": "application/x-protobuf" },
      body: Buffer.from([0x0a, 0x03, 0x01, 0x02, 0x03]),
    } as unknown as TelemetryRequest;

    await TelemetryQueueService.addTelemetryIngestJob(
      req,
      TelemetryType.Traces,
    );

    expect(getEnqueuedJobData().pinnedServiceName).toBe(PINNED_SERVICE_NAME);
  });

  test("a pin with surrounding whitespace is normalized at enqueue, so the job carries the exact string the worker will stamp", async () => {
    const req: TelemetryRequest = {
      projectId: new ObjectID(PROJECT_ID),
      productType: ProductType.Logs,
      ingestionKeyPolicy: policyWithPin(`  ${PINNED_SERVICE_NAME}\n`),
      headers: {},
      body: { resourceLogs: [] },
    } as unknown as TelemetryRequest;

    await TelemetryQueueService.addTelemetryIngestJob(req, TelemetryType.Logs);

    expect(getEnqueuedJobData().pinnedServiceName).toBe(PINNED_SERVICE_NAME);
  });

  test("a key with no pin configured leaves the field off the job entirely, rather than shipping a null on every export", async () => {
    const req: TelemetryRequest = {
      projectId: new ObjectID(PROJECT_ID),
      productType: ProductType.Traces,
      ingestionKeyPolicy: policyWithPin(null),
      headers: {},
      body: { resourceSpans: [] },
    } as unknown as TelemetryRequest;

    await TelemetryQueueService.addTelemetryIngestJob(
      req,
      TelemetryType.Traces,
    );

    const jobData: TelemetryIngestJobData = getEnqueuedJobData();

    expect(jobData.pinnedServiceName).toBeUndefined();
    expect(
      Object.prototype.hasOwnProperty.call(jobData, "pinnedServiceName"),
    ).toBe(false);
  });

  test("a producer that hand-builds a TelemetryRequest with no policy at all (gRPC, MQTT, Pyroscope) enqueues without a pin instead of throwing", async () => {
    const req: TelemetryRequest = {
      projectId: new ObjectID(PROJECT_ID),
      productType: ProductType.Traces,
      headers: {},
      body: { resourceSpans: [] },
    } as unknown as TelemetryRequest;

    await expect(
      TelemetryQueueService.addTelemetryIngestJob(req, TelemetryType.Traces),
    ).resolves.toBeUndefined();

    const jobData: TelemetryIngestJobData = getEnqueuedJobData();

    expect(jobData.pinnedServiceName).toBeUndefined();
    expect(
      Object.prototype.hasOwnProperty.call(jobData, "pinnedServiceName"),
    ).toBe(false);
  });

  test("a blank or whitespace-only pin is treated as no pin, so the worker can never stamp an empty service.name", async () => {
    const blankPins: Array<string> = ["", "   ", "\t\n "];

    for (const blankPin of blankPins) {
      jest.clearAllMocks();

      const req: TelemetryRequest = {
        projectId: new ObjectID(PROJECT_ID),
        productType: ProductType.Metrics,
        ingestionKeyPolicy: policyWithPin(blankPin),
        headers: {},
        body: { resourceMetrics: [] },
      } as unknown as TelemetryRequest;

      await TelemetryQueueService.addTelemetryIngestJob(
        req,
        TelemetryType.Metrics,
      );

      const jobData: TelemetryIngestJobData = getEnqueuedJobData();

      expect(
        Object.prototype.hasOwnProperty.call(jobData, "pinnedServiceName"),
      ).toBe(false);
    }
  });

  test("syslog and fluent jobs never carry a pin, because their worker cases apply none — the field would imply an enforcement that does not happen", async () => {
    const nonOtelTypes: Array<TelemetryType> = [
      TelemetryType.Syslog,
      TelemetryType.FluentLogs,
    ];

    for (const nonOtelType of nonOtelTypes) {
      jest.clearAllMocks();

      const req: TelemetryRequest = {
        projectId: new ObjectID(PROJECT_ID),
        ingestionKeyPolicy: policyWithPin(PINNED_SERVICE_NAME),
        headers: {},
        body: { message: "hello" },
      } as unknown as TelemetryRequest;

      await TelemetryQueueService.addTelemetryIngestJob(req, nonOtelType);

      const jobData: TelemetryIngestJobData = getEnqueuedJobData();

      expect(
        Object.prototype.hasOwnProperty.call(jobData, "pinnedServiceName"),
      ).toBe(false);
    }
  });

  test("adding the pin did not open the door to the ingestion token riding along into Redis", async () => {
    /*
     * The job payload is JSON-serialized into Redis per job and surfaces
     * verbatim in failed-job listings, which is why the enqueue path projects
     * the headers down to a whitelist. The pin is safe to store (it is a label
     * the customer typed, already visible on the ingested telemetry); the
     * token is not. This asserts the new field did not become the thin end of
     * a wedge that carries the credential with it.
     */
    const secretToken: string = "super-secret-ingestion-token-value";

    const req: TelemetryRequest = {
      projectId: new ObjectID(PROJECT_ID),
      productType: ProductType.Traces,
      ingestionKeyPolicy: policyWithPin(PINNED_SERVICE_NAME),
      headers: {
        "x-oneuptime-token": secretToken,
        "x-oneuptime-service-name": "checkout-service",
        cookie: "session=abc123",
      },
      body: Buffer.from([0x0a, 0x03, 0x01, 0x02, 0x03]),
    } as unknown as TelemetryRequest;

    await TelemetryQueueService.addTelemetryIngestJob(
      req,
      TelemetryType.Traces,
    );

    const jobData: TelemetryIngestJobData = getEnqueuedJobData();

    expect(jobData.pinnedServiceName).toBe(PINNED_SERVICE_NAME);
    expect(JSON.stringify(jobData)).not.toContain(secretToken);
    expect(jobData.requestHeaders).toEqual({
      "x-oneuptime-service-name": "checkout-service",
    });
  });
});

describe("ProcessTelemetry worker — applying the pin before any ingest service sees the body", () => {
  let decodeSpy: jest.SpyInstance;
  let pinSpy: jest.SpyInstance;

  beforeEach(() => {
    processTracesFromQueue.mockReset();
    processLogsFromQueue.mockReset();
    processMetricsFromQueue.mockReset();
    processProfilesFromQueue.mockReset();
    processSyslogFromQueue.mockReset();
    processFluentLogsFromQueue.mockReset();
    deleteBody.mockClear();

    decodeSpy = jest.spyOn(OtelPayloadDecoder, "decodeFromQueue");
    // Left with its real implementation; spied on only to count/inspect calls.
    pinSpy = jest.spyOn(PinServiceName, "pinInPlace");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the worker handler was registered/captured", () => {
    expect(typeof capturedHandler).toBe("function");
  });

  test("a pinned traces job reaches OtelTracesIngestService with the forged service.name already replaced", async () => {
    decodeSpy.mockResolvedValue(
      otlpBody("resourceSpans", ATTACKER_SERVICE_NAME) as never,
    );

    await capturedHandler!(
      otelJob(TelemetryType.Traces, ProductType.Traces, PINNED_SERVICE_NAME),
    );

    expect(processTracesFromQueue).toHaveBeenCalledTimes(1);

    const ingestedBody: JSONObject = (
      processTracesFromQueue.mock.calls[0]![0] as { body: JSONObject }
    ).body;

    expect(serviceNamesIn(ingestedBody, "resourceSpans")).toEqual([
      PINNED_SERVICE_NAME,
    ]);
    expect(JSON.stringify(ingestedBody)).not.toContain(ATTACKER_SERVICE_NAME);

    // Unrelated resource attributes are preserved, not flattened by the pin.
    expect(JSON.stringify(ingestedBody)).toContain("host.name");
  });

  test("a pinned logs job reaches OtelLogsIngestService with the forged service.name already replaced", async () => {
    decodeSpy.mockResolvedValue(
      otlpBody("resourceLogs", ATTACKER_SERVICE_NAME) as never,
    );

    await capturedHandler!(
      otelJob(TelemetryType.Logs, ProductType.Logs, PINNED_SERVICE_NAME),
    );

    expect(processLogsFromQueue).toHaveBeenCalledTimes(1);

    const ingestedBody: JSONObject = (
      processLogsFromQueue.mock.calls[0]![0] as { body: JSONObject }
    ).body;

    expect(serviceNamesIn(ingestedBody, "resourceLogs")).toEqual([
      PINNED_SERVICE_NAME,
    ]);
    expect(JSON.stringify(ingestedBody)).not.toContain(ATTACKER_SERVICE_NAME);
  });

  test("a pinned metrics job reaches OtelMetricsIngestService with the forged service.name already replaced", async () => {
    decodeSpy.mockResolvedValue(
      otlpBody("resourceMetrics", ATTACKER_SERVICE_NAME) as never,
    );

    await capturedHandler!(
      otelJob(TelemetryType.Metrics, ProductType.Metrics, PINNED_SERVICE_NAME),
    );

    expect(processMetricsFromQueue).toHaveBeenCalledTimes(1);

    const ingestedBody: JSONObject = (
      processMetricsFromQueue.mock.calls[0]![0] as { body: JSONObject }
    ).body;

    expect(serviceNamesIn(ingestedBody, "resourceMetrics")).toEqual([
      PINNED_SERVICE_NAME,
    ]);
    expect(JSON.stringify(ingestedBody)).not.toContain(ATTACKER_SERVICE_NAME);
  });

  test("an unpinned job — every key that predates this feature — hands the ingest service the decoded body byte-for-byte unchanged", async () => {
    /*
     * The backwards-compatibility half of the contract. A key with keyType
     * NULL resolves to a policy with no pin, so its jobs carry no
     * pinnedServiceName and their payloads must reach ClickHouse exactly as
     * they did before this shipped — same attributes, same order, same
     * service.name.
     */
    const decodedBody: JSONObject = otlpBody(
      "resourceSpans",
      "legacy-backend-service",
    );
    const untouchedSnapshot: string = JSON.stringify(decodedBody);

    decodeSpy.mockResolvedValue(decodedBody as never);

    await capturedHandler!(otelJob(TelemetryType.Traces, ProductType.Traces));

    expect(processTracesFromQueue).toHaveBeenCalledTimes(1);

    const ingestedBody: JSONObject = (
      processTracesFromQueue.mock.calls[0]![0] as { body: JSONObject }
    ).body;

    expect(JSON.stringify(ingestedBody)).toBe(untouchedSnapshot);
    expect(serviceNamesIn(ingestedBody, "resourceSpans")).toEqual([
      "legacy-backend-service",
    ]);

    // Not even a call into the pin helper — no pin means no work at all.
    expect(pinSpy).not.toHaveBeenCalled();
  });

  test("a failure inside the pin never fails the job, because a BullMQ retry would re-hit the same payload and lose the whole batch forever", async () => {
    decodeSpy.mockResolvedValue(
      otlpBody("resourceSpans", ATTACKER_SERVICE_NAME) as never,
    );

    pinSpy.mockImplementation((): number => {
      throw new TypeError("Cannot read properties of undefined (reading 'x')");
    });

    await expect(
      capturedHandler!(
        otelJob(TelemetryType.Traces, ProductType.Traces, PINNED_SERVICE_NAME),
      ),
    ).resolves.toBeUndefined();

    // The batch is still ingested — a labelling failure must not drop spans.
    expect(processTracesFromQueue).toHaveBeenCalledTimes(1);

    /*
     * The out-of-band body is reclaimed only after the job succeeds, so this
     * is the worker's own signal that it treated the job as successful rather
     * than as a retryable failure.
     */
    expect(deleteBody).toHaveBeenCalledTimes(1);
    expect(deleteBody).toHaveBeenCalledWith(BODY_KEY);
  });

  test("syslog jobs read requestBody directly and are untouched by the pin", async () => {
    const syslogBody: JSONObject = {
      message: "<134>1 2026-08-10T00:00:00Z host app - - - hello",
    };

    await capturedHandler!({
      id: `syslog-${PROJECT_ID}-1-abc`,
      name: "ProcessTelemetry",
      data: {
        type: TelemetryType.Syslog,
        projectId: PROJECT_ID,
        requestBody: syslogBody,
        requestHeaders: {},
        // Present only to prove the worker's syslog case ignores it outright.
        pinnedServiceName: PINNED_SERVICE_NAME,
      },
    });

    expect(processSyslogFromQueue).toHaveBeenCalledTimes(1);
    expect(
      (processSyslogFromQueue.mock.calls[0]![0] as { body: JSONObject }).body,
    ).toEqual(syslogBody);
    expect(pinSpy).not.toHaveBeenCalled();
    expect(decodeSpy).not.toHaveBeenCalled();
  });

  test("fluent-logs jobs read requestBody directly and are untouched by the pin", async () => {
    const fluentBody: JSONObject = { tag: "app.log", entries: [] };

    await capturedHandler!({
      id: `fluentlogs-${PROJECT_ID}-1-abc`,
      name: "ProcessTelemetry",
      data: {
        type: TelemetryType.FluentLogs,
        projectId: PROJECT_ID,
        requestBody: fluentBody,
        requestHeaders: {},
        pinnedServiceName: PINNED_SERVICE_NAME,
      },
    });

    expect(processFluentLogsFromQueue).toHaveBeenCalledTimes(1);
    expect(
      (processFluentLogsFromQueue.mock.calls[0]![0] as { body: JSONObject })
        .body,
    ).toEqual(fluentBody);
    expect(pinSpy).not.toHaveBeenCalled();
    expect(decodeSpy).not.toHaveBeenCalled();
  });

  test("profiles are pinned too, so a pin means the same thing for every signal", async () => {
    /*
     * A Browser key cannot reach the profiles surface at all
     * (BROWSER_ALLOWED_INGEST_SURFACES), so this is not part of containing a
     * scraped credential — only a SERVER key can enqueue a pinned profiles
     * job. It is pinned anyway because the dashboard field promises the pin
     * applies to "everything the key writes", and a promise that is quietly
     * false for one signal is worse than no promise at all.
     */
    const profilesBody: JSONObject = {
      resourceProfiles: [resourceBlock("profiler-app")],
    };

    decodeSpy.mockResolvedValue(profilesBody as never);

    await capturedHandler!(
      otelJob(
        TelemetryType.Profiles,
        ProductType.Profiles,
        PINNED_SERVICE_NAME,
      ),
    );

    expect(processProfilesFromQueue).toHaveBeenCalledTimes(1);

    const ingestedBody: JSONObject = (
      processProfilesFromQueue.mock.calls[0]![0] as { body: JSONObject }
    ).body;

    expect(pinSpy).toHaveBeenCalledTimes(1);
    expect(pinSpy).toHaveReturnedWith(1);
    expect(serviceNamesIn(ingestedBody, "resourceProfiles")).toEqual([
      PINNED_SERVICE_NAME,
    ]);
  });
});
