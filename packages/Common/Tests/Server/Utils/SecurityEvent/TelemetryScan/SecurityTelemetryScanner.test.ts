import { afterEach, describe, expect, jest, test } from "@jest/globals";
import SecurityTelemetrySource from "../../../../../Models/DatabaseModels/SecurityTelemetrySource";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../../Server/Services/OpenTelemetryIngestService";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import SecurityTelemetrySourceService from "../../../../../Server/Services/SecurityTelemetrySourceService";
import SecurityEventDedupe from "../../../../../Server/Utils/SecurityEvent/SecurityEventDedupe";
import SecurityProjectWork, {
  SecurityProjectWorkLease,
} from "../../../../../Server/Utils/SecurityEvent/SecurityProjectWork";
import AuditLogSecurityScan from "../../../../../Server/Utils/SecurityEvent/TelemetryScan/AuditLogSecurityScan";
import FlowSecurityScan from "../../../../../Server/Utils/SecurityEvent/TelemetryScan/FlowSecurityScan";
import RumSecurityScan from "../../../../../Server/Utils/SecurityEvent/TelemetryScan/RumSecurityScan";
import SecurityTelemetryScanner, {
  SECURITY_TELEMETRY_SCAN_PROJECT_WORK,
  SecurityTelemetryScanResult,
  TELEMETRY_SCAN_MAX_BACKLOG_IN_HOURS,
  TELEMETRY_SCAN_MAX_RECORDS_PER_RUN,
  TELEMETRY_SCAN_PAGE_SIZE,
  TELEMETRY_SCAN_PLANS,
} from "../../../../../Server/Utils/SecurityEvent/TelemetryScan/SecurityTelemetryScanner";
import { TelemetryScanWindow } from "../../../../../Server/Utils/SecurityEvent/TelemetryScan/TelemetryScanStatements";
import { TelemetryWindowRead } from "../../../../../Server/Utils/SecurityEvent/TelemetryScan/TelemetryScanTypes";
import TraceSecurityScan from "../../../../../Server/Utils/SecurityEvent/TelemetryScan/TraceSecurityScan";
import ThreatIntelEnricher from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import OneUptimeDate from "../../../../../Types/Date";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../../Types/SecurityEvent/OcsfSeverity";
import {
  SecurityTelemetrySignal,
  SecurityTelemetrySourceKind,
} from "../../../../../Types/SecurityEvent/SecurityTelemetrySource";
import ServiceType from "../../../../../Types/Telemetry/ServiceType";
import { buildTelemetrySecurityEvent } from "../../../../../Utils/SecurityEvent/TelemetryScan/TelemetrySecurityEvent";

/*
 * "Your OneUptime data", end to end with the databases stood in for: which
 * windows a scan reads, how it pages and keeps its place, what it does when
 * it fell far behind or failed, and how what it finds is stored - once,
 * enriched, attributed to its source's own service.
 */

const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-00000000p301",
);
const SOURCE_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-00000000s301",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-00000000e301",
);

function source(
  kind: SecurityTelemetrySourceKind,
  cursor: string,
  lastScanResult?: JSONObject,
): SecurityTelemetrySource {
  const model: SecurityTelemetrySource = new SecurityTelemetrySource();
  model._id = SOURCE_ID.toString();
  model.projectId = PROJECT_ID;
  model.kind = kind;
  model.cursor = cursor;
  model.isEnabled = true;

  if (lastScanResult) {
    model.lastScanResult = lastScanResult;
  }

  return model;
}

function event(eventUid: string): NormalizedSecurityEvent {
  return buildTelemetrySecurityEvent({
    kind: SecurityTelemetrySourceKind.NetworkFlows,
    signal: SecurityTelemetrySignal.PortScan,
    time: new Date("2026-10-27T11:50:00.000Z"),
    eventUid,
    classUid: 4001,
    activityName: "Traffic",
    statusName: "",
    severity: OcsfSeverity.Medium,
    message: "Port scan",
    principalIp: "198.51.100.1",
    attributes: {},
  });
}

interface Harness {
  windows: Array<TelemetryScanWindow & { offset: number }>;
  inserted: Array<JSONObject>;
  updates: Array<JSONObject>;
}

/*
 * The databases, stood in for. `reads` answers each window read in turn;
 * past its end every read is empty.
 */
function stand(data: {
  reads?: Array<TelemetryWindowRead>;
  existingUids?: Array<string>;
}): Harness {
  const harness: Harness = { windows: [], inserted: [], updates: [] };
  const reads: Array<TelemetryWindowRead> = [...(data.reads || [])];

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  jest
    .spyOn(SecurityTelemetryScanner, "readWindow")
    .mockImplementation(
      async (input: {
        kind: SecurityTelemetrySourceKind;
        window: TelemetryScanWindow;
        offset: number;
        pageSize: number;
      }): Promise<TelemetryWindowRead> => {
        harness.windows.push({ ...input.window, offset: input.offset });

        return (
          reads.shift() || {
            events: [],
            recordsRead: 0,
            pageRows: 0,
            hasMore: false,
          }
        );
      },
    );

  jest.spyOn(OTelIngestService, "telemetryServiceFromName").mockResolvedValue({
    serviceName: "OneUptime Network Flows",
    primaryEntityId: SERVICE_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: 15,
    projectRetentionConfig: null,
    projectRetentionInDays: 30,
  } as unknown as TelemetryServiceMetadata);

  jest
    .spyOn(SecurityEventDedupe, "findExistingEventUids")
    .mockResolvedValue(new Set(data.existingUids || []));

  jest
    .spyOn(ThreatIntelEnricher, "enrichNormalizedEvents")
    .mockResolvedValue({ eventsMatched: 0, valuesLookedUp: 0 });

  jest.spyOn(SecurityEventService, "insertJsonRows").mockImplementation((async (
    rows: Array<JSONObject>,
  ) => {
    harness.inserted.push(...rows);
  }) as never);

  jest
    .spyOn(SecurityTelemetrySourceService, "updateOneById")
    .mockImplementation((async (input: { data: JSONObject }) => {
      harness.updates.push(input.data);
    }) as never);

  return harness;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which windows a scan reads", () => {
  test("a summing kind reads only whole windows, up to its settle time", async () => {
    const harness: Harness = stand({});
    const plan: { settleInSeconds: number; windowInSeconds: number } =
      TELEMETRY_SCAN_PLANS[SecurityTelemetrySourceKind.NetworkFlows];
    const cursor: Date = new Date(
      NOW.getTime() -
        plan.settleInSeconds * 1000 -
        2.5 * plan.windowInSeconds * 1000,
    );

    const result: SecurityTelemetryScanResult =
      await SecurityTelemetryScanner.scanSource(
        source(SecurityTelemetrySourceKind.NetworkFlows, cursor.toISOString()),
      );

    // Two whole windows; the half window waits for the next scan.
    expect(result.windows).toBe(2);
    expect(harness.windows).toHaveLength(2);
    expect(harness.windows[0]!.arrivedAfter).toEqual(cursor);
    expect(
      harness.windows[0]!.arrivedUntil.getTime() -
        harness.windows[0]!.arrivedAfter.getTime(),
    ).toBe(plan.windowInSeconds * 1000);
    expect(harness.windows[1]!.arrivedAfter).toEqual(
      harness.windows[0]!.arrivedUntil,
    );
    // Data that happened up to an hour before it arrived is still read.
    expect(harness.windows[0]!.happenedAfter).toEqual(
      new Date(cursor.getTime() - 60 * 60 * 1000),
    );
    expect(harness.updates[0]!["cursor"]).toBe(
      harness.windows[1]!.arrivedUntil.toISOString(),
    );
  });

  test("traces read up to the present, a part window included", async () => {
    const harness: Harness = stand({});
    const settle: number =
      TELEMETRY_SCAN_PLANS[SecurityTelemetrySourceKind.Traces].settleInSeconds;
    const cursor: Date = new Date(NOW.getTime() - settle * 1000 - 90 * 1000);

    await SecurityTelemetryScanner.scanSource(
      source(SecurityTelemetrySourceKind.Traces, cursor.toISOString()),
    );

    expect(harness.windows).toHaveLength(1);
    expect(harness.windows[0]!.arrivedUntil).toEqual(
      new Date(NOW.getTime() - settle * 1000),
    );
  });

  test("traces settle longer than the log scan, so it reports a logged request first", () => {
    expect(
      TELEMETRY_SCAN_PLANS[SecurityTelemetrySourceKind.Traces].settleInSeconds,
    ).toBeGreaterThan(15);
  });

  test("a source that fell more than a day behind starts again from there, and says so", async () => {
    const harness: Harness = stand({});
    const cursor: Date = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000);

    const result: SecurityTelemetryScanResult =
      await SecurityTelemetryScanner.scanSource(
        source(SecurityTelemetrySourceKind.AuditLog, cursor.toISOString()),
      );

    expect(result.skippedBacklog).toBe(true);
    expect(result.skippedFrom).toBe(cursor.toISOString());
    expect(result.skippedTo).toBe(
      new Date(
        NOW.getTime() - TELEMETRY_SCAN_MAX_BACKLOG_IN_HOURS * 60 * 60 * 1000,
      ).toISOString(),
    );
    expect(harness.windows[0]!.arrivedAfter.toISOString()).toBe(
      result.skippedTo,
    );
  });
});

describe("paging through a window", () => {
  test("a full page reads the next one, from the row after", async () => {
    const harness: Harness = stand({
      reads: [
        {
          events: [],
          recordsRead: TELEMETRY_SCAN_PAGE_SIZE,
          pageRows: TELEMETRY_SCAN_PAGE_SIZE,
          hasMore: true,
        },
        { events: [], recordsRead: 10, pageRows: 10, hasMore: false },
      ],
    });
    const settle: number =
      TELEMETRY_SCAN_PLANS[SecurityTelemetrySourceKind.Traces].settleInSeconds;

    await SecurityTelemetryScanner.scanSource(
      source(
        SecurityTelemetrySourceKind.Traces,
        new Date(NOW.getTime() - settle * 1000 - 60 * 1000).toISOString(),
      ),
    );

    expect(
      harness.windows.map((window: { offset: number }): number => {
        return window.offset;
      }),
    ).toEqual([0, TELEMETRY_SCAN_PAGE_SIZE]);
  });

  test("a scan out of its budget keeps its place, and the next goes on from it", async () => {
    const settle: number =
      TELEMETRY_SCAN_PLANS[SecurityTelemetrySourceKind.Traces].settleInSeconds;
    const cursor: string = new Date(
      NOW.getTime() - settle * 1000 - 60 * 1000,
    ).toISOString();
    const lease: SecurityProjectWorkLease = {
      hasTimeLeft: (() => {
        let checks: number = 0;

        return (): boolean => {
          checks++;
          return checks <= 1;
        };
      })(),
      keep: async (): Promise<boolean> => {
        return true;
      },
    };

    const first: Harness = stand({
      reads: [
        {
          events: [],
          recordsRead: TELEMETRY_SCAN_PAGE_SIZE,
          pageRows: TELEMETRY_SCAN_PAGE_SIZE,
          hasMore: true,
        },
      ],
    });

    const stopped: SecurityTelemetryScanResult =
      await SecurityTelemetryScanner.scanSource(
        source(SecurityTelemetrySourceKind.Traces, cursor),
        lease,
      );

    expect(stopped.partialWindowStart).toBe(cursor);
    expect(stopped.partialWindowProcessed).toBe(TELEMETRY_SCAN_PAGE_SIZE);
    expect(first.updates[0]!["cursor"]).toBe(cursor);

    jest.restoreAllMocks();

    const second: Harness = stand({});

    await SecurityTelemetryScanner.scanSource(
      source(SecurityTelemetrySourceKind.Traces, cursor, {
        partialWindowStart: cursor,
        partialWindowProcessed: TELEMETRY_SCAN_PAGE_SIZE,
      }),
    );

    expect(second.windows[0]!.offset).toBe(TELEMETRY_SCAN_PAGE_SIZE);
  });

  test("a run reads at most its record budget", () => {
    expect(TELEMETRY_SCAN_MAX_RECORDS_PER_RUN).toBeGreaterThanOrEqual(
      TELEMETRY_SCAN_PAGE_SIZE,
    );
  });
});

describe("what a scan stores", () => {
  test("each event once, enriched, attributed to its source's service, and counted by signal", async () => {
    const harness: Harness = stand({
      reads: [
        {
          events: [event("a"), event("a"), event("b"), event("known")],
          recordsRead: 3,
          pageRows: 0,
          hasMore: false,
        },
      ],
      existingUids: ["known"],
    });
    const plan: { settleInSeconds: number; windowInSeconds: number } =
      TELEMETRY_SCAN_PLANS[SecurityTelemetrySourceKind.NetworkFlows];

    const result: SecurityTelemetryScanResult =
      await SecurityTelemetryScanner.scanSource(
        source(
          SecurityTelemetrySourceKind.NetworkFlows,
          new Date(
            NOW.getTime() -
              plan.settleInSeconds * 1000 -
              plan.windowInSeconds * 1000,
          ).toISOString(),
        ),
      );

    expect(
      harness.inserted.map((row: JSONObject): unknown => {
        return row["eventUid"];
      }),
    ).toEqual(["a", "b"]);
    expect(harness.inserted[0]!["primaryEntityId"]).toBe(SERVICE_ID.toString());
    expect(result.eventsFound).toBe(2);
    expect(result.bySignal).toEqual({ "port-scan": 2 });
    expect(harness.updates[0]!["lastEventFoundAt"]).toEqual(NOW);
    expect(OTelIngestService.telemetryServiceFromName).toHaveBeenCalledWith({
      serviceName: "OneUptime Network Flows",
      projectId: PROJECT_ID,
    });
    expect(SecurityEventDedupe.findExistingEventUids).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        vendorName: "OneUptime",
        productName: "OneUptime Network Flows",
        ids: ["a", "b", "known"],
      }),
    );
  });

  test("a window that finds nothing stores nothing, and asks for no service", async () => {
    const harness: Harness = stand({});
    const plan: { settleInSeconds: number; windowInSeconds: number } =
      TELEMETRY_SCAN_PLANS[SecurityTelemetrySourceKind.RumSessions];

    await SecurityTelemetryScanner.scanSource(
      source(
        SecurityTelemetrySourceKind.RumSessions,
        new Date(
          NOW.getTime() -
            plan.settleInSeconds * 1000 -
            plan.windowInSeconds * 1000,
        ).toISOString(),
      ),
    );

    expect(harness.inserted).toEqual([]);
    expect(OTelIngestService.telemetryServiceFromName).not.toHaveBeenCalled();
    expect(harness.updates[0]!["lastError"]).toBeNull();
  });

  test("a trace's events are prepared - followed into their requests - before they are stored", async () => {
    stand({
      reads: [
        {
          events: [event("t1")],
          recordsRead: 1,
          pageRows: 1,
          hasMore: false,
        },
      ],
    });
    const prepare: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TraceSecurityScan, "prepareEvents")
      .mockImplementation(
        async (data: {
          events: Array<NormalizedSecurityEvent>;
        }): Promise<Array<NormalizedSecurityEvent>> => {
          return data.events;
        },
      );
    const settle: number =
      TELEMETRY_SCAN_PLANS[SecurityTelemetrySourceKind.Traces].settleInSeconds;

    await SecurityTelemetryScanner.scanSource(
      source(
        SecurityTelemetrySourceKind.Traces,
        new Date(NOW.getTime() - settle * 1000 - 30 * 1000).toISOString(),
      ),
    );

    expect(prepare).toHaveBeenCalledTimes(1);
  });
});

describe("a project's turn", () => {
  test("scans each enabled source, and records a failure on the source rather than throwing", async () => {
    const harness: Harness = stand({});
    const settle: number =
      TELEMETRY_SCAN_PLANS[SecurityTelemetrySourceKind.Traces].settleInSeconds;

    jest
      .spyOn(SecurityTelemetryScanner, "readWindow")
      .mockRejectedValue(new Error("ClickHouse is away"));
    jest
      .spyOn(SecurityTelemetrySourceService, "findAllBy")
      .mockResolvedValue([
        source(
          SecurityTelemetrySourceKind.Traces,
          new Date(NOW.getTime() - settle * 1000 - 30 * 1000).toISOString(),
        ),
      ] as never);

    await expect(
      SecurityTelemetryScanner.scanProject(PROJECT_ID),
    ).resolves.toBeUndefined();

    expect(harness.updates).toHaveLength(1);
    expect(String(harness.updates[0]!["lastError"])).toContain(
      "ClickHouse is away",
    );
  });

  test("the cron queues one turn for each project with an enabled source", async () => {
    jest
      .spyOn(SecurityTelemetrySourceService, "findAllBy")
      .mockResolvedValue([
        source(SecurityTelemetrySourceKind.Traces, NOW.toISOString()),
        source(SecurityTelemetrySourceKind.AuditLog, NOW.toISOString()),
      ] as never);
    const enqueue: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityProjectWork, "enqueueProjects")
      .mockResolvedValue(1);

    await SecurityTelemetryScanner.enqueueProjectsWithEnabledSources();

    expect(enqueue).toHaveBeenCalledWith(SECURITY_TELEMETRY_SCAN_PROJECT_WORK, [
      PROJECT_ID,
      PROJECT_ID,
    ]);
    expect(SECURITY_TELEMETRY_SCAN_PROJECT_WORK.jobName).toBe(
      "SecurityEvents:ScanProjectTelemetry",
    );
  });
});

describe("which reader reads a kind", () => {
  test.each([
    [SecurityTelemetrySourceKind.Traces, "trace"],
    [SecurityTelemetrySourceKind.NetworkFlows, "flow"],
    [SecurityTelemetrySourceKind.AuditLog, "audit"],
    [SecurityTelemetrySourceKind.RumSessions, "rum"],
  ])("%s", async (kind: SecurityTelemetrySourceKind, reader: string) => {
    const read: TelemetryWindowRead = {
      events: [],
      recordsRead: 0,
      pageRows: 0,
      hasMore: false,
    };
    const spies: Record<string, ReturnType<typeof jest.spyOn>> = {
      trace: jest
        .spyOn(TraceSecurityScan, "readWindow")
        .mockResolvedValue(read),
      flow: jest.spyOn(FlowSecurityScan, "readWindow").mockResolvedValue(read),
      audit: jest
        .spyOn(AuditLogSecurityScan, "readWindow")
        .mockResolvedValue(read),
      rum: jest.spyOn(RumSecurityScan, "readWindow").mockResolvedValue(read),
    };

    await SecurityTelemetryScanner.readWindow({
      kind,
      window: {
        projectId: PROJECT_ID,
        arrivedAfter: NOW,
        arrivedUntil: NOW,
        happenedAfter: NOW,
      },
      offset: 0,
      pageSize: 10,
    });

    for (const [name, spy] of Object.entries(spies)) {
      expect([name, spy.mock.calls.length]).toEqual([
        name,
        name === reader ? 1 : 0,
      ]);
    }
  });
});
