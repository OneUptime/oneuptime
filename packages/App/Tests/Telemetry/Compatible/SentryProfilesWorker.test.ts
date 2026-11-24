/*
 * A Sentry profile, all the way to the rows OneUptime's profiles worker
 * writes: the envelope sentry-python sends for a profiled transaction is
 * translated (SentryEnvelope), and the OTLP profile it became runs through
 * the real worker (OtelProfilesIngestService) - its normalization, stack
 * resolution, canonical sample type and trace correlation - down to the
 * profile and sample rows it would insert. Only entity discovery and the
 * fan-in writer are stubbed, as the Pyroscope suite stubs them.
 */

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import ProfileService from "Common/Server/Services/ProfileService";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import OtelProfilesIngestService from "../../../FeatureSet/Telemetry/Services/OtelProfilesIngestService";
import SentryEnvelope, {
  SentryTranslation,
} from "../../../FeatureSet/Telemetry/Utils/Compatible/SentryEnvelope";

type AnyAsyncFunction = (...args: Array<unknown>) => Promise<unknown>;

const PROJECT_ID: ObjectID = ObjectID.generate();
const TRACE_ID: string = "771a43a4192642f0b136d5159a501700";
const ROOT_SPAN_ID: string = "a0cfbde2bdff3adc";
const TRANSACTION_EVENT_ID: string = "9ec79c33ec9942ab8353589fcb2e04dc";
const INTEGER_STRING: RegExp = /^\d+$/;

interface WorkerRows {
  profiles: Array<JSONObject>;
  samples: Array<JSONObject>;
}

let rows: WorkerRows = { profiles: [], samples: [] };

beforeAll(() => {
  const worker: Dictionary<AnyAsyncFunction> =
    OtelProfilesIngestService as unknown as Dictionary<AnyAsyncFunction>;

  for (const method of [
    "autoDiscoverKubernetesCluster",
    "autoDiscoverDockerHost",
    "autoDiscoverPodmanHost",
    "autoDiscoverHost",
    "autoDiscoverServerless",
    "autoDiscoverCloudResource",
    "autoDiscoverRum",
  ]) {
    jest.spyOn(worker, method).mockImplementation(async () => {
      return null;
    });
  }

  jest
    .spyOn(worker, "resolveTelemetryResource")
    .mockImplementation(async (...args: Array<unknown>) => {
      const attributes: Array<JSONObject> = (
        args[0] as { attributes: Array<JSONObject> }
      ).attributes;
      const serviceName: JSONObject | undefined = attributes.find(
        (attribute: JSONObject) => {
          return attribute["key"] === "service.name";
        },
      );

      return {
        serviceName: serviceName
          ? ((serviceName["value"] as JSONObject)["stringValue"] as string)
          : "unknown",
        primaryEntityId: ObjectID.generate(),
        primaryEntityType: ServiceType.OpenTelemetry,
        entityKeys: [],
        dataRententionInDays: 15,
        serviceRetentionConfig: null,
        serviceRetentionInDays: null,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      };
    });

  jest
    .spyOn(
      TelemetryFanInWriter as unknown as Dictionary<AnyAsyncFunction>,
      "submit",
    )
    .mockImplementation(async (...args: Array<unknown>) => {
      const written: Array<JSONObject> = args[1] as Array<JSONObject>;

      if (args[0] === ProfileService) {
        rows.profiles.push(...written);
      } else {
        rows.samples.push(...written);
      }

      return { flushed: Promise.resolve() };
    });
});

beforeEach(() => {
  rows = { profiles: [], samples: [] };
});

const pythonEnvelope: () => Buffer = (): Buffer => {
  const now: number = Date.now() / 1000;
  const items: Array<[JSONObject, JSONObject]> = [
    [
      { type: "transaction" },
      {
        type: "transaction",
        event_id: TRANSACTION_EVENT_ID,
        transaction: "GET /users",
        start_timestamp: now,
        timestamp: now + 0.05,
        platform: "python",
        release: "checkout@1.4.2",
        contexts: {
          trace: { trace_id: TRACE_ID, span_id: ROOT_SPAN_ID },
        },
      },
    ],
    [
      { type: "profile" },
      {
        event_id: "3b2f5dd2f3374e2f8e0e0f2d6c8b1a77",
        platform: "python",
        release: "checkout@1.4.2",
        timestamp: now,
        version: "1",
        transactions: [
          {
            id: TRANSACTION_EVENT_ID,
            name: "GET /users",
            trace_id: TRACE_ID,
            active_thread_id: "1",
          },
        ],
        profile: {
          frames: [
            {
              function: "Database.query",
              filename: "app/db.py",
              lineno: 42,
            },
            { function: "list_users", filename: "app/views.py", lineno: 12 },
          ],
          stacks: [[0, 1]],
          samples: [
            { elapsed_since_start_ns: "0", thread_id: "1", stack_id: 0 },
            { elapsed_since_start_ns: "9900990", thread_id: "1", stack_id: 0 },
            {
              elapsed_since_start_ns: "19801980",
              thread_id: "1",
              stack_id: 0,
            },
          ],
          thread_metadata: { "1": { name: "MainThread" } },
        },
      },
    ],
  ];
  const lines: Array<string> = ["{}"];

  for (const [header, payload] of items) {
    lines.push(JSON.stringify(header), JSON.stringify(payload));
  }

  return Buffer.from(lines.join("\n"));
};

describe("a Sentry profile through OneUptime's profiles worker", () => {
  test("is a wall-time profile of its transaction's trace, each stack a sample row of its frames from the leaf", async () => {
    const translation: SentryTranslation = SentryEnvelope.fromEnvelope(
      SentryEnvelope.parseEnvelope(pythonEnvelope()),
    );

    await OtelProfilesIngestService.processProfilesFromQueue({
      body: JSON.parse(JSON.stringify(translation.profiles)) as JSONObject,
      projectId: PROJECT_ID,
      productType: ProductType.Profiles,
      headers: {},
    } as unknown as TelemetryRequest);

    expect(rows.profiles).toHaveLength(1);

    const profile: JSONObject = rows.profiles[0]!;

    expect(profile["profileType"]).toBe("wall");
    expect(profile["unit"]).toBe("nanoseconds");
    expect(profile["periodType"]).toBe("wall");
    expect(profile["traceId"]).toBe(TRACE_ID);
    expect(profile["spanId"]).toBe(ROOT_SPAN_ID);
    expect(profile["profileId"]).toBe("3b2f5dd2f3374e2f8e0e0f2d6c8b1a77");
    expect(profile["sampleCount"]).toBe(1);
    expect(profile["startTimeUnixNano"]).toMatch(INTEGER_STRING);
    expect(profile["endTimeUnixNano"]).toMatch(INTEGER_STRING);

    expect(rows.samples).toHaveLength(1);

    const sample: JSONObject = rows.samples[0]!;

    expect(sample["stacktrace"]).toEqual([
      "Database.query@app/db.py:42",
      "list_users@app/views.py:12",
    ]);
    expect(sample["frameTypes"]).toEqual(["cpython", "cpython"]);
    // Three samples of 9.9 ms: the wall time they stand for.
    expect(String(sample["value"])).toBe("29702970");
    expect(sample["profileType"]).toBe("wall");
    expect(sample["traceId"]).toBe(TRACE_ID);
    expect(sample["spanId"]).toBe(ROOT_SPAN_ID);
    expect(sample["timeUnixNano"]).toMatch(INTEGER_STRING);
    expect(sample["labels"]).toMatchObject({
      "thread.id": "1",
      "thread.name": "MainThread",
    });
  });
});
