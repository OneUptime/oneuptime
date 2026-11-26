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
import LogService from "Common/Server/Services/LogService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import EventLoop, { EVENT_LOOP_BUDGET_MS } from "Common/Server/Utils/EventLoop";
import { ExpressRequest } from "Common/Server/Utils/Express";
import SyslogDeviceMatcher from "Common/Server/Utils/Syslog/SyslogDeviceMatcher";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";

/*
 * ---------------------------------------------------------------------------
 * THE OTHER LOG SOURCES HAND THE EVENT LOOP BACK BY THE TIME THE WORK TOOK
 * TOO (#6514).
 *
 * Fluentd and syslog sent over HTTP handed the event loop back every 500
 * messages, and the syslog a probe forwards never did, while each message is
 * read by its project's drop filters, scrub rules and pipelines - a Fluentd
 * record can be a map of thousands of values. Each loop now asks the
 * batch's EventLoopBudget before each message, as the OTLP loops do
 * (IngestEventLoopBudget.test.ts).
 *
 * EventLoop.now is a fake clock each message moves, so nothing here reads a
 * wall clock. Only the persistence edges are replaced.
 * ---------------------------------------------------------------------------
 */

type ServiceMethods = Record<string, unknown>;

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const PROBE_ID: ObjectID = ObjectID.generate();

let fakeNow: number;
let handBacksAt: Array<number>;
let messageStartsAt: Array<number>;
let storedRows: Array<JSONObject>;

beforeEach(() => {
  fakeNow = 0;
  handBacksAt = [];
  messageStartsAt = [];
  storedRows = [];

  jest.spyOn(EventLoop, "now").mockImplementation((): number => {
    return fakeNow;
  });
  jest
    .spyOn(EventLoop, "yieldToEventLoop")
    .mockImplementation(async (): Promise<void> => {
      handBacksAt.push(fakeNow);
    });

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
    .mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  SyslogDeviceMatcher.clearCaches();
});

// A per-message step, still run as it is, that costs `ms` on the fake clock.
function eachMessageTakes(owner: unknown, method: string, ms: number): void {
  const methods: ServiceMethods = owner as ServiceMethods;
  const real: (...args: Array<unknown>) => unknown = (
    methods[method] as (...args: Array<unknown>) => unknown
  ).bind(owner);

  jest.spyOn(methods as never, method as never).mockImplementation(((
    ...args: Array<unknown>
  ): unknown => {
    messageStartsAt.push(fakeNow);
    fakeNow += ms;
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

interface Source {
  name: string;
  // The step each message takes once, at its start.
  owner: unknown;
  method: string;
  // How many messages the source handed the loop back after before.
  oldMessagesPerHandBack: number | null;
  /*
   * When thirty messages of 7 ms each hand the loop back, when that is not
   * once every three of them alone.
   */
  handBacksForSlowMessages?: Array<number> | undefined;
  setup: () => void;
  ingest: (count: number) => Promise<void>;
  stored: () => number;
}

function fluentEntries(count: number): Array<JSONObject> {
  const entries: Array<JSONObject> = [];

  for (let index: number = 0; index < count; index++) {
    entries.push({
      level: "info",
      message: `order-${index} placed`,
      user: `user${index}@example.com`,
    });
  }

  return entries;
}

function syslogLines(count: number): Array<string> {
  const lines: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    lines.push(
      `<165>1 2026-11-16T10:11:${String(index % 60).padStart(2, "0")}.003Z web-01 checkout 4711 ID47 - order-${index} placed`,
    );
  }

  return lines;
}

function probeMessages(count: number): Array<JSONObject> {
  return syslogLines(count).map((line: string): JSONObject => {
    return {
      sourceIpAddress: "10.0.0.9",
      facility: 20,
      severity: 5,
      message: line,
      receivedAt: "2026-11-16T10:12:00.000Z",
      raw: line,
    };
  });
}

let probeRows: number;

const SOURCES: Array<Source> = [
  {
    name: "Fluentd",
    owner: FluentLogsIngestService,
    method: "extractBodyFromEntry",
    oldMessagesPerHandBack: 500,
    setup: (): void => {
      // Nothing more: the services above are all Fluentd ingest reads.
    },
    ingest: async (count: number): Promise<void> => {
      await FluentLogsIngestService.processFluentLogsFromQueue({
        projectId: PROJECT_ID,
        body: { entries: fluentEntries(count) },
        headers: { "x-oneuptime-service-name": "checkout" },
      } as unknown as ExpressRequest);
    },
    stored: (): number => {
      return storedRows.length;
    },
  },
  {
    name: "syslog over HTTP",
    owner: SyslogIngestService,
    method: "resolveServiceName",
    oldMessagesPerHandBack: 500,
    setup: (): void => {
      jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([] as never);
    },
    ingest: async (count: number): Promise<void> => {
      await SyslogIngestService.processSyslogFromQueue({
        projectId: PROJECT_ID,
        body: { messages: syslogLines(count) },
        headers: {},
        query: {},
      } as unknown as ExpressRequest);
    },
    stored: (): number => {
      return storedRows.length;
    },
  },
  {
    name: "syslog a probe forwards",
    owner: ProbeSyslogIngestService,
    method: "deserializeSyslogMessage",
    // It never handed the loop back.
    oldMessagesPerHandBack: null,
    /*
     * Read in two passes (#10716): each message read and matched, then each
     * project's share decided against its budgets, then the rows built -
     * and the second pass asks the same budget before each row, so the
     * 21 ms the first pass ends on are handed back too.
     */
    handBacksForSlowMessages: [21, 42, 63, 84, 105, 126, 147, 168, 189, 210],
    setup: (): void => {
      probeRows = 0;
      jest
        .spyOn(SyslogDeviceMatcher, "getProbe")
        .mockResolvedValue({ id: PROBE_ID, projectId: PROJECT_ID } as never);
      jest.spyOn(SyslogDeviceMatcher, "attribute").mockResolvedValue({
        devices: [],
        unmatchedProjectId: PROJECT_ID,
      } as never);
      jest.spyOn(LogService, "insertJsonRows").mockImplementation((async (
        rows: Array<JSONObject>,
      ) => {
        probeRows += rows.length;
      }) as never);
    },
    ingest: async (count: number): Promise<void> => {
      await ProbeSyslogIngestService.processSyslogMessages(
        PROBE_ID,
        probeMessages(count),
      );
    },
    stored: (): number => {
      return probeRows;
    },
  },
];

describe.each(
  SOURCES.map((source: Source): [string, Source] => {
    return [source.name, source];
  }),
)("%s", (_name: string, source: Source) => {
  test("messages that each take 7 ms: never held longer than the budget and one message", async () => {
    source.setup();
    eachMessageTakes(source.owner, source.method, 7);

    await source.ingest(30);

    expect(source.stored()).toBe(30);
    expect(messageStartsAt).toHaveLength(30);
    // 210 ms of work: before, one stretch (or at most one hand-back at the start).
    expect(fakeNow).toBe(210);
    expect(longestStretch()).toBeLessThan(EVENT_LOOP_BUDGET_MS + 7);
    // Handed back once every three messages: 21 ms each time.
    expect(handBacksAt).toEqual(
      source.handBacksForSlowMessages || [
        21, 42, 63, 84, 105, 126, 147, 168, 189,
      ],
    );
  });

  test("small messages are handed back no more often than before, and a short batch not at all", async () => {
    source.setup();
    eachMessageTakes(source.owner, source.method, 0.02);

    await source.ingest(3_000);

    expect(source.stored()).toBe(3_000);
    // 60 ms of work: handed back every 20 ms.
    expect(handBacksAt).toHaveLength(2);

    if (source.oldMessagesPerHandBack !== null) {
      expect(handBacksAt.length).toBeLessThanOrEqual(
        Math.ceil(3_000 / source.oldMessagesPerHandBack),
      );
    }

    handBacksAt = [];
    fakeNow = 0;
    storedRows = [];
    await source.ingest(500);

    expect(handBacksAt).toEqual([]);
  });
});
