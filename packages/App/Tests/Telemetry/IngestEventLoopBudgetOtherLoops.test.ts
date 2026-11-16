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

import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import OtelProfilesIngestService from "../../FeatureSet/Telemetry/Services/OtelProfilesIngestService";
import PyroscopeIngestService from "../../FeatureSet/Telemetry/Services/PyroscopeIngestService";
import SecurityEventsIngestService from "../../FeatureSet/Telemetry/Services/SecurityEventsIngestService";
import SessionReplayScrubService from "../../FeatureSet/Telemetry/Services/SessionReplayScrubService";
import { decodeFirehoseRecords } from "../../FeatureSet/Telemetry/Utils/AwsFirehose/FirehoseRecords";
import { shapeStreamedMetrics } from "../../FeatureSet/Telemetry/Utils/AwsFirehose/CloudWatchMetricStream";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import EventLoop, { EVENT_LOOP_BUDGET_MS } from "Common/Server/Utils/EventLoop";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import ThreatIntelEnricher from "Common/Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  CloudMonitoredResource,
  resolveCloudMonitoredResource,
} from "Common/Types/Cloud/CloudMonitoredResource";
import SecurityEventNormalizer from "Common/Utils/SecurityEvent/SecurityEventNormalizer";
import fs from "fs";
import path from "path";
import protobuf from "protobufjs";

const AN_INDEX: RegExp = /^\d+$/;
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const A_YIELD: RegExp = /EventLoop\.yieldToEventLoop\(\)/;

// The push Grafana Alloy's pyroscope.write sends, from ingest's own proto.
const PUSH_REQUEST: protobuf.Type = protobuf
  .loadSync(
    path.resolve(
      __dirname,
      "../../FeatureSet/Telemetry/ProtoFiles/pyroscope/push.proto",
    ),
  )
  .lookupType("push.v1.PushRequest");

/*
 * ---------------------------------------------------------------------------
 * THE REST OF INGEST HANDS THE EVENT LOOP BACK BY THE TIME THE WORK TOOK
 * (#8925, a follow-up of #6514).
 *
 * #6514 moved the OTLP log, trace and metric loops, Fluentd and syslog to
 * one EventLoopBudget per batch (IngestEventLoopBudget.test.ts and
 * IngestEventLoopBudgetLogSources.test.ts). These loops still handed the
 * event loop back by count - or before every item - whatever an item cost:
 *
 *   - OTLP profiles: every 25 resources, 50 scopes, 100 profiles, 200
 *     samples;
 *   - Pyroscope pushes: before every sample;
 *   - security events: every 500 events, normalized and again written;
 *   - cloud resource discovery: every 25 resources;
 *   - the session replay scrub walk: every 2,000 nodes, each one a text up
 *     to 64 KB read by every scrub rule of the project;
 *   - Firehose deliveries: every 50 records of up to a megabyte;
 *   - CloudWatch metric streams: every 2,000 datapoints.
 *
 * Each now asks its batch's budget before each item. EventLoop.now is a
 * fake clock each item's work moves, so nothing here reads a wall clock,
 * and only the persistence edges are replaced. (The screen of real-time
 * detection rules, in Common, is held to the same in
 * RealTimeDetections.test.ts.)
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();

const SERVICE_METADATA: TelemetryServiceMetadata = {
  serviceName: "checkout",
  primaryEntityId: SERVICE_ID,
  primaryEntityType: ServiceType.OpenTelemetry,
  entityKeys: [],
  dataRententionInDays: 15,
  serviceRetentionConfig: null,
  serviceRetentionInDays: null,
  projectRetentionConfig: null,
  projectRetentionInDays: 15,
} as unknown as TelemetryServiceMetadata;

type Methods = Record<string, (...args: Array<unknown>) => unknown>;

let fakeNow: number;
let handBacksAt: Array<number>;
let itemsDone: number;

beforeEach(() => {
  fakeNow = 0;
  handBacksAt = [];
  itemsDone = 0;

  jest.spyOn(EventLoop, "now").mockImplementation((): number => {
    return fakeNow;
  });
  jest
    .spyOn(EventLoop, "yieldToEventLoop")
    .mockImplementation(async (): Promise<void> => {
      handBacksAt.push(fakeNow);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// One item's work, done: `ms` on the fake clock.
function work(ms: number): void {
  itemsDone++;
  fakeNow += ms;
}

// A step each item takes once, still run as it is, that costs `ms`.
function eachItemTakes(owner: unknown, method: string, ms: number): void {
  const methods: Methods = owner as unknown as Methods;
  const real: (...args: Array<unknown>) => unknown =
    methods[method]!.bind(owner);

  jest.spyOn(methods as never, method as never).mockImplementation(((
    ...args: Array<unknown>
  ): unknown => {
    work(ms);
    return real(...args);
  }) as never);
}

function longestStretch(): number {
  let longest: number = 0;
  let from: number = 0;

  for (const at of handBacksAt) {
    longest = Math.max(longest, at - from);
    from = at;
  }

  return Math.max(longest, fakeNow - from);
}

/*
 * ---------------------------------------------------------------------------
 * The loops, each with its persistence edges replaced and one step per item
 * moving the clock.
 * ---------------------------------------------------------------------------
 */
interface Loop {
  name: string;
  // How many items it handed the loop back after before; null: every one.
  oldItemsPerHandBack: number | null;
  // Sets the loop up so each of its items costs `ms`, and runs `count`.
  run: (count: number, ms: number) => Promise<void>;
}

function profilesRequest(samples: number): JSONObject {
  const sampleList: Array<JSONObject> = [];

  for (let index: number = 0; index < samples; index++) {
    sampleList.push({ value: [1] });
  }

  return {
    resourceProfiles: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "checkout" } },
          ],
        },
        scopeProfiles: [
          {
            profiles: [
              {
                profileId: "AAAAAAAAAAAAAAAAAAAAAA==",
                startTimeUnixNano: "1794218400000000000",
                endTimeUnixNano: "1794218401000000000",
                profile: {
                  stringTable: ["", "cpu", "nanoseconds"],
                  sampleType: [{ type: 1, unit: 2 }],
                  sample: sampleList,
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

function setUpProfilesWorker(): void {
  const worker: Methods = OtelProfilesIngestService as unknown as Methods;

  for (const method of [
    "autoDiscoverKubernetesCluster",
    "autoDiscoverDockerHost",
    "autoDiscoverPodmanHost",
    "autoDiscoverHost",
    "autoDiscoverServerless",
    "autoDiscoverCloudResource",
    "autoDiscoverRum",
  ]) {
    jest
      .spyOn(worker as never, method as never)
      .mockResolvedValue(null as never);
  }

  jest
    .spyOn(worker as never, "resolveTelemetryResource" as never)
    .mockResolvedValue(SERVICE_METADATA as never);
  jest.spyOn(TelemetryFanInWriter, "submit").mockImplementation((async () => {
    return { flushed: Promise.resolve() };
  }) as never);
}

function securityEvents(count: number): Array<JSONObject> {
  const events: Array<JSONObject> = [];

  for (let index: number = 0; index < count; index++) {
    events.push({
      time: "2026-11-16T10:00:00.000Z",
      message: `sign-in ${index}`,
      user: `user${index}`,
    });
  }

  return events;
}

function cloudResources(count: number): Array<CloudMonitoredResource> {
  const subscription: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";
  const resources: Array<CloudMonitoredResource> = [];

  for (let index: number = 0; index < count; index++) {
    const resource: CloudMonitoredResource | null =
      resolveCloudMonitoredResource({
        metricName: "azure_percentage_cpu_average",
        attributes: {
          "resource.azuremonitor.subscription_id": subscription,
          "azuremonitor.resource_id": `/subscriptions/${subscription}/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-${index}`,
          name: `vm-${index}`,
          location: "westeurope",
        },
      });

    expect(resource).not.toBeNull();
    resources.push(resource as CloudMonitoredResource);
  }

  return resources;
}

// A scrub rule whose every reading of a text costs `ms`.
function slowRule(ms: number): never {
  const rule: LogScrubRule = new LogScrubRule();

  rule.name = "slow";
  rule.patternType = "custom";
  rule.scrubAction = "redact";

  const regex: ScrubRegExp = {
    source: "never",
    flags: "g",
    test: (): boolean => {
      work(ms);
      return false;
    },
    replace: (text: string): string => {
      work(ms);
      return text;
    },
    matchRanges: (): Array<[number, number]> => {
      work(ms);
      return [];
    },
  };

  return [{ rule: rule, regex: regex }] as never;
}

// A record or a datapoint whose reading costs `ms`: its first field a getter.
function costing<T extends JSONObject>(value: T, key: string, ms: number): T {
  const stored: unknown = value[key];

  Object.defineProperty(value, key, {
    enumerable: true,
    get: (): unknown => {
      work(ms);
      return stored;
    },
  });

  return value;
}

const LOOPS: Array<Loop> = [
  {
    name: "OTLP profiles, sample by sample",
    oldItemsPerHandBack: 200,
    run: async (count: number, ms: number): Promise<void> => {
      setUpProfilesWorker();
      eachItemTakes(OtelProfilesIngestService, "resolveStackFrames", ms);

      await OtelProfilesIngestService.processProfilesFromQueue({
        body: profilesRequest(count),
        projectId: PROJECT_ID,
        headers: {},
      } as unknown as TelemetryRequest);
    },
  },
  {
    name: "Pyroscope pushes, sample by sample",
    oldItemsPerHandBack: 1,
    run: async (count: number, ms: number): Promise<void> => {
      const pyroscope: Methods = PyroscopeIngestService as unknown as Methods;
      const samples: Array<JSONObject> = [];

      for (let index: number = 0; index < count; index++) {
        samples.push({ rawProfile: Buffer.from([1, 2, 3]), id: `${index}` });
      }

      // A real push: one series of `count` samples, as Alloy sends them.
      const push: Buffer = Buffer.from(
        PUSH_REQUEST.encode(
          PUSH_REQUEST.fromObject({
            series: [
              {
                labels: [{ name: "service_name", value: "checkout" }],
                samples: samples,
              },
            ],
          }),
        ).finish(),
      );

      jest
        .spyOn(pyroscope as never, "extractRawBody" as never)
        .mockReturnValue(push as never);
      jest
        .spyOn(pyroscope as never, "decompressIfNeeded" as never)
        .mockImplementation((async (buffer: Buffer): Promise<Buffer> => {
          return buffer;
        }) as never);
      jest
        .spyOn(pyroscope as never, "parsePprof" as never)
        .mockImplementation(((): JSONObject => {
          work(ms);
          return {};
        }) as never);
      jest
        .spyOn(pyroscope as never, "convertPprofToOTLP" as never)
        .mockReturnValue({ resourceProfiles: [{}] } as never);
      jest
        .spyOn(pyroscope as never, "enqueueOrAnswerUnavailable" as never)
        .mockResolvedValue(true as never);
      jest
        .spyOn(pyroscope as never, "sendPushSuccessResponse" as never)
        .mockReturnValue(undefined as never);

      await PyroscopeIngestService.ingestPyroscopePush(
        {
          projectId: PROJECT_ID,
          headers: {},
          body: Buffer.from([0]),
        } as unknown as ExpressRequest,
        {} as ExpressResponse,
        (error?: unknown): void => {
          if (error) {
            throw error;
          }
        },
      );
    },
  },
  {
    name: "security events, normalized and then written",
    oldItemsPerHandBack: 500,
    run: async (count: number, ms: number): Promise<void> => {
      jest
        .spyOn(ThreatIntelEnricher, "enrichNormalizedEvents")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(OTelIngestService, "telemetryServiceFromName")
        .mockResolvedValue(SERVICE_METADATA);
      jest
        .spyOn(TelemetryFanInWriter, "submit")
        .mockImplementation((async () => {
          return { flushed: Promise.resolve() };
        }) as never);
      // Half of each event's work as it is normalized, half as it is written.
      eachItemTakes(SecurityEventNormalizer, "normalize", ms / 2);
      eachItemTakes(SecurityEventsIngestService, "toDbRow", ms / 2);

      await SecurityEventsIngestService.processSecurityEventsFromQueue({
        projectId: PROJECT_ID,
        body: { events: securityEvents(count) },
        headers: {},
      } as unknown as ExpressRequest);
      itemsDone /= 2;
    },
  },
  {
    name: "cloud resource discovery, resource by resource",
    oldItemsPerHandBack: 25,
    run: async (count: number, ms: number): Promise<void> => {
      const base: Methods = OtelIngestBaseService as unknown as Methods;

      OtelIngestBaseService.clearInProcessMemos();
      jest
        .spyOn(base as never, "getEntityIdFromCaches" as never)
        .mockImplementation((async (): Promise<string> => {
          work(ms);
          return "55555555-5555-4555-8555-555555555555";
        }) as never);
      jest
        .spyOn(base as never, "shouldRunMaintenance" as never)
        .mockResolvedValue(false as never);

      await base["autoDiscoverCloudMonitoredResources"]!({
        projectId: PROJECT_ID,
        resources: cloudResources(count),
      });
    },
  },
  {
    name: "the session replay scrub walk, node by node",
    oldItemsPerHandBack: 2_000,
    run: async (count: number, ms: number): Promise<void> => {
      const texts: Array<JSONValue> = [];

      for (let index: number = 0; index < count; index++) {
        texts.push(`console line ${index}`);
      }

      const result: { isComplete: boolean } =
        await SessionReplayScrubService.scrubEvents(texts, slowRule(ms));

      expect(result.isComplete).toBe(true);
    },
  },
  {
    name: "Firehose deliveries, record by record",
    oldItemsPerHandBack: 50,
    run: async (count: number, ms: number): Promise<void> => {
      // A delivery's records, base64 text: reading each one costs `ms`.
      const record: string = Buffer.from(
        JSON.stringify({ messageType: "CONTROL_MESSAGE" }),
      ).toString("base64");
      const records: Array<string> = new Proxy(
        new Array<string>(count).fill(record),
        {
          get: (target: Array<string>, key: string | symbol): unknown => {
            if (typeof key === "string" && AN_INDEX.test(key)) {
              work(ms);
            }

            return Reflect.get(target, key);
          },
        },
      );

      await decodeFirehoseRecords({
        records: records,
        budget: { remainingBytes: 1_000_000_000 },
      } as never);
    },
  },
  {
    name: "CloudWatch metric streams, datapoint by datapoint",
    oldItemsPerHandBack: 2_000,
    run: async (count: number, ms: number): Promise<void> => {
      const points: Array<JSONObject> = [];

      for (let index: number = 0; index < count; index++) {
        points.push(costing({ attributes: [] }, "attributes", ms));
      }

      await shapeStreamedMetrics({
        resources: [
          {
            resource: { attributes: [] },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: "amazonaws.com/AWS/EC2/CPUUtilization",
                    summary: { dataPoints: points },
                  },
                ],
              },
            ],
          },
        ],
      } as never);
    },
  },
];

describe.each(
  LOOPS.map((loop: Loop): [string, Loop] => {
    return [loop.name, loop];
  }),
)("%s", (_name: string, loop: Loop) => {
  test("items that each take 7 ms: never held longer than the budget and one item", async () => {
    await loop.run(30, 7);

    expect(itemsDone).toBe(30);
    expect(fakeNow).toBe(210);
    expect(longestStretch()).toBeLessThan(EVENT_LOOP_BUDGET_MS + 7);
    // Handed back once every three items, after 21 ms of work each time.
    expect(handBacksAt).toEqual([21, 42, 63, 84, 105, 126, 147, 168, 189]);
  });

  test("small items are handed back no more often than before, and a short batch not at all", async () => {
    await loop.run(3_000, 0.02);

    expect(itemsDone).toBe(3_000);
    // 60 ms of work: handed back every 20 ms.
    expect(handBacksAt.length).toBeLessThanOrEqual(3);

    if (loop.oldItemsPerHandBack !== null) {
      expect(handBacksAt.length).toBeLessThanOrEqual(
        Math.max(Math.ceil(3_000 / loop.oldItemsPerHandBack), 3),
      );
    }

    jest.restoreAllMocks();
    fakeNow = 0;
    handBacksAt = [];
    itemsDone = 0;
    jest.spyOn(EventLoop, "now").mockImplementation((): number => {
      return fakeNow;
    });
    jest
      .spyOn(EventLoop, "yieldToEventLoop")
      .mockImplementation(async (): Promise<void> => {
        handBacksAt.push(fakeNow);
      });

    await loop.run(100, 0.02);

    expect(handBacksAt).toEqual([]);
  });
});

/*
 * A guard: no loop of ingest, nor of the server's security event work,
 * hands the event loop back by count or before every item any more. Each
 * asks an EventLoopBudget (Common/Server/Utils/EventLoop.ts), which yields
 * through yieldToEventLoop itself.
 */
describe("no telemetry loop hands the event loop back by count", () => {
  function sourcesUnder(directory: string): Array<string> {
    const files: Array<string> = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "build") {
          files.push(...sourcesUnder(full));
        }
      } else if (entry.name.endsWith(".ts")) {
        files.push(full);
      }
    }

    return files;
  }

  test("yieldToEventLoop is called by the budget alone", () => {
    const roots: Array<string> = [
      path.join(__dirname, "../../FeatureSet/Telemetry"),
      path.join(__dirname, "../../../Common/Server/Utils/SecurityEvent"),
      path.join(__dirname, "../../../Common/Server/Utils/Telemetry"),
    ];
    const callers: Array<string> = [];

    for (const root of roots) {
      for (const file of sourcesUnder(root)) {
        const code: string = fs
          .readFileSync(file, "utf-8")
          .replace(BLOCK_COMMENT, "");

        if (A_YIELD.test(code)) {
          callers.push(path.relative(path.join(__dirname, "../../.."), file));
        }
      }
    }

    expect(callers).toEqual([]);
  });
});
