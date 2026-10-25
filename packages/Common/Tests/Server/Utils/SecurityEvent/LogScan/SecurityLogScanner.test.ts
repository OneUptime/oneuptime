import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import SecurityLogSource from "../../../../../Models/DatabaseModels/SecurityLogSource";
import LogService, {
  FindSecurityLogCandidatesData,
} from "../../../../../Server/Services/LogService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../../Server/Services/OpenTelemetryIngestService";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import SecurityLogSourceService from "../../../../../Server/Services/SecurityLogSourceService";
import SecurityLogScanner, {
  LOG_SCAN_MAX_BACKLOG_IN_HOURS,
  LOG_SCAN_MAX_LINES_PER_RUN,
  LOG_SCAN_PAGE_SIZE,
  LOG_SCAN_SETTLE_IN_SECONDS,
  LOG_SCAN_WINDOW_IN_SECONDS,
  SECURITY_LOG_SCAN_PROJECT_WORK,
  SECURITY_LOGS_SERVICE_NAME,
  SecurityLogScanResult,
} from "../../../../../Server/Utils/SecurityEvent/LogScan/SecurityLogScanner";
import SecurityProjectWork, {
  SecurityProjectWorkLease,
} from "../../../../../Server/Utils/SecurityEvent/SecurityProjectWork";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import ThreatIntelEnricher from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import OneUptimeDate from "../../../../../Types/Date";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE,
} from "../../../../../Types/SecurityCase/SecurityConnection";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityLogFormat from "../../../../../Types/SecurityEvent/SecurityLogFormat";
import ServiceType from "../../../../../Types/Telemetry/ServiceType";
import {
  SSH_LINES,
  SUDO_LINES,
  WEB_LINES,
} from "../../../../Utils/SecurityEvent/LogParsers/LogParserFixtures";

const NOW: Date = new Date("2026-10-19T12:00:00.000Z");
const UNTIL: Date = new Date(NOW.getTime() - LOG_SCAN_SETTLE_IN_SECONDS * 1000);
const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-00000000p101",
);
const SOURCE_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-00000000s101",
);
const LOGS_SERVICE_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-00000000e101",
);

interface StoredLog {
  id: string;
  arrivedAt: Date;
  body: string;
  attributes?: JSONObject | undefined;
  // The record the log was sent under.
  primaryEntityId?: string | undefined;
  primaryEntityType?: string | undefined;
}

function toClickhouse(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

function logs(
  count: number,
  startAt: Date,
  everySeconds: number,
  body: string,
): Array<StoredLog> {
  const list: Array<StoredLog> = [];

  for (let index: number = 0; index < count; index++) {
    list.push({
      id: `0192f1a0-0000-7000-8000-${String(index).padStart(12, "0")}`,
      arrivedAt: new Date(
        startAt.getTime() + (index + 1) * everySeconds * 1000,
      ),
      body,
    });
  }

  return list;
}

interface Installed {
  reads: Array<FindSecurityLogCandidatesData>;
  inserted: Array<JSONObject>;
  updates: Array<JSONObject>;
  enriched: Array<Array<NormalizedSecurityEvent>>;
  order: Array<string>;
}

// The Log table as the scan reads it: one project, by arrival, a page at a time.
function install(stored: Array<StoredLog>): Installed {
  const installed: Installed = {
    reads: [],
    inserted: [],
    updates: [],
    enriched: [],
    order: [],
  };

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  jest
    .spyOn(LogService, "findSecurityLogCandidates")
    .mockImplementation(
      async (
        data: FindSecurityLogCandidatesData,
      ): Promise<Array<JSONObject>> => {
        installed.reads.push(data);

        const after: number = Math.floor(data.arrivedAfter.getTime() / 1000);
        const until: number = Math.floor(data.arrivedUntil.getTime() / 1000);

        return stored
          .filter((log: StoredLog): boolean => {
            const arrived: number = Math.floor(log.arrivedAt.getTime() / 1000);

            return (
              data.projectId.toString() === PROJECT_ID.toString() &&
              arrived > after &&
              arrived <= until
            );
          })
          .slice(data.offset, data.offset + data.limit)
          .map((log: StoredLog): JSONObject => {
            return {
              _id: log.id,
              time: toClickhouse(log.arrivedAt),
              createdAt: toClickhouse(log.arrivedAt),
              attributes: log.attributes || { "host.name": "web-03" },
              body: log.body,
              primaryEntityId: log.primaryEntityId,
              primaryEntityType: log.primaryEntityType,
            };
          });
      },
    );

  jest.spyOn(OTelIngestService, "telemetryServiceFromName").mockResolvedValue({
    serviceName: SECURITY_LOGS_SERVICE_NAME,
    primaryEntityId: LOGS_SERVICE_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: 15,
    projectRetentionConfig: null,
    projectRetentionInDays: 30,
  } as unknown as TelemetryServiceMetadata);

  jest
    .spyOn(ThreatIntelEnricher, "enrichNormalizedEvents")
    .mockImplementation(
      async (data: {
        events: Array<NormalizedSecurityEvent>;
      }): Promise<{ eventsMatched: number; valuesLookedUp: number }> => {
        installed.order.push("enrich");
        installed.enriched.push(data.events);
        return { eventsMatched: 0, valuesLookedUp: 0 };
      },
    );

  jest
    .spyOn(SecurityEventService, "insertJsonRows")
    .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
      installed.order.push("insert");
      installed.inserted.push(...rows);
    });

  jest
    .spyOn(SecurityLogSourceService, "updateOneById")
    .mockImplementation(async (data: { data: unknown }): Promise<number> => {
      installed.updates.push(data.data as JSONObject);
      return 1;
    });

  return installed;
}

function source(
  cursor?: string | undefined,
  lastScanResult?: JSONObject | undefined,
): SecurityLogSource {
  const model: SecurityLogSource = new SecurityLogSource();
  model.id = SOURCE_ID;
  model.projectId = PROJECT_ID;
  model.isEnabled = true;

  if (cursor !== undefined) {
    model.cursor = cursor;
  }

  if (lastScanResult !== undefined) {
    model.lastScanResult = lastScanResult;
  }

  return model;
}

// A lease whose time runs out after `pages` checks: one per page read.
function leaseFor(pages: number): SecurityProjectWorkLease {
  let checks: number = 0;

  return {
    hasTimeLeft: (): boolean => {
      checks++;
      return checks <= pages;
    },
    keep: async (): Promise<boolean> => {
      return true;
    },
  };
}

describe("SecurityLogScanner.scanSource", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("stores each security record in the logs that arrived since the cursor, then moves the cursor", async () => {
    const startAt: Date = OneUptimeDate.addRemoveMinutes(NOW, -3);
    const installed: Installed = install([
      ...logs(3, startAt, 20, SSH_LINES.failedPasswordInvalidUser),
      ...logs(1, startAt, 30, SUDO_LINES.commandRun),
      ...logs(1, startAt, 40, WEB_LINES.sqlInjectionEncoded),
      // A candidate line that holds no record.
      ...logs(1, startAt, 50, "Failed to start nginx.service"),
    ]);

    const result: SecurityLogScanResult = await SecurityLogScanner.scanSource(
      source(startAt.toISOString()),
    );

    expect(result.logsRead).toBe(6);
    expect(result.eventsFound).toBe(5);
    expect(result.byFormat).toEqual({
      [SecurityLogFormat.SshSignIn]: 3,
      [SecurityLogFormat.Sudo]: 1,
      [SecurityLogFormat.WebAttack]: 1,
    });
    expect(result.windows).toBe(1);
    // It reached the present: nothing left part way, nothing skipped.
    expect(result.partialWindowStart).toBe("");
    expect(result.partialWindowProcessed).toBe(0);
    expect(result.skippedBacklog).toBe(false);

    // Attributed to the project's "OneUptime Logs" service.
    expect(installed.inserted).toHaveLength(5);

    for (const row of installed.inserted) {
      expect(row["projectId"]).toBe(PROJECT_ID.toString());
      expect(row["primaryEntityId"]).toBe(LOGS_SERVICE_ID.toString());
    }

    expect(installed.inserted[0]!["className"]).toBe("Authentication");
    expect(installed.inserted[0]!["principalIp"]).toBe("203.0.113.7");

    // Threat intel stamps its matches first, as ingest does.
    expect(installed.order).toEqual(["enrich", "insert"]);

    expect(installed.updates).toHaveLength(1);
    expect(installed.updates[0]!["cursor"]).toBe(UNTIL.toISOString());
    expect(installed.updates[0]!["lastScannedAt"]).toEqual(NOW);
    expect(installed.updates[0]!["lastEventFoundAt"]).toEqual(NOW);
    expect(installed.updates[0]!["lastError"]).toBeNull();
    expect(
      (installed.updates[0]!["lastScanResult"] as JSONObject)["eventsFound"],
    ).toBe(5);
  });

  test("a quiet window stores nothing, and still moves on", async () => {
    const installed: Installed = install([]);

    const result: SecurityLogScanResult = await SecurityLogScanner.scanSource(
      source(OneUptimeDate.addRemoveMinutes(NOW, -2).toISOString()),
    );

    expect(result.eventsFound).toBe(0);
    expect(installed.inserted).toHaveLength(0);
    expect(installed.enriched).toHaveLength(0);
    expect(installed.updates[0]!["cursor"]).toBe(UNTIL.toISOString());
    expect(installed.updates[0]!["lastEventFoundAt"]).toBeUndefined();
  });

  test("reads only its own project's logs", async () => {
    const installed: Installed = install([]);

    await SecurityLogScanner.scanSource(
      source(OneUptimeDate.addRemoveMinutes(NOW, -20).toISOString()),
    );

    expect(installed.reads.length).toBeGreaterThan(0);

    for (const read of installed.reads) {
      expect(read.projectId.toString()).toBe(PROJECT_ID.toString());
    }
  });

  test("catches up window by window, and reads late logs from an hour back", async () => {
    const startAt: Date = OneUptimeDate.addRemoveMinutes(NOW, -30);
    const installed: Installed = install(
      logs(30, startAt, 59, SSH_LINES.failedPasswordRoot),
    );

    const result: SecurityLogScanResult = await SecurityLogScanner.scanSource(
      source(startAt.toISOString()),
    );

    expect(result.windows).toBe(6);
    expect(result.eventsFound).toBe(30);
    expect(installed.inserted).toHaveLength(30);

    const firstRead: FindSecurityLogCandidatesData = installed.reads[0]!;

    expect(firstRead.arrivedAfter.toISOString()).toBe(startAt.toISOString());
    expect(firstRead.happenedAfter.toISOString()).toBe(
      OneUptimeDate.addRemoveMinutes(startAt, -60).toISOString(),
    );
  });

  test("a scan hours behind catches up on every window, skipping none", async () => {
    const fiveHoursBack: Date = OneUptimeDate.addRemoveHours(NOW, -5);
    // One an hour, the last an hour ago.
    const installed: Installed = install(
      logs(4, fiveHoursBack, 60 * 60, SSH_LINES.failedPasswordRoot),
    );

    const result: SecurityLogScanResult = await SecurityLogScanner.scanSource(
      source(fiveHoursBack.toISOString()),
    );

    // Pre-fix a scan more than an hour behind skipped ahead and lost these.
    expect(result.skippedBacklog).toBe(false);
    expect(result.eventsFound).toBe(4);
    expect(result.windows).toBe(
      Math.ceil(
        (UNTIL.getTime() - fiveHoursBack.getTime()) /
          (LOG_SCAN_WINDOW_IN_SECONDS * 1000),
      ),
    );
    expect(installed.reads[0]!.arrivedAfter.toISOString()).toBe(
      fiveHoursBack.toISOString(),
    );
    expect(installed.updates[0]!["cursor"]).toBe(UNTIL.toISOString());
  });

  test("a scan more than a day behind starts again a day back, and names the logs it skipped", async () => {
    const cursor: Date = OneUptimeDate.addRemoveHours(NOW, -30);
    const oldestRead: Date = OneUptimeDate.addRemoveHours(
      NOW,
      -LOG_SCAN_MAX_BACKLOG_IN_HOURS,
    );
    const installed: Installed = install([]);

    const result: SecurityLogScanResult = await SecurityLogScanner.scanSource(
      source(cursor.toISOString()),
    );

    expect(LOG_SCAN_MAX_BACKLOG_IN_HOURS).toBe(24);
    expect(result.skippedBacklog).toBe(true);
    expect(result.skippedFrom).toBe(cursor.toISOString());
    expect(result.skippedTo).toBe(oldestRead.toISOString());
    expect(installed.reads[0]!.arrivedAfter.toISOString()).toBe(
      oldestRead.toISOString(),
    );

    // The source's row keeps what was skipped, for the dashboard to show.
    const stored: JSONObject = installed.updates[0]![
      "lastScanResult"
    ] as JSONObject;
    expect(stored["skippedFrom"]).toBe(cursor.toISOString());
    expect(stored["skippedTo"]).toBe(oldestRead.toISOString());
  });

  test("a source with no cursor starts from now", async () => {
    const installed: Installed = install(
      logs(
        2,
        OneUptimeDate.addRemoveMinutes(NOW, -5),
        60,
        SSH_LINES.invalidUser,
      ),
    );

    await SecurityLogScanner.scanSource(source());

    expect(installed.reads).toHaveLength(0);
    expect(installed.updates[0]!["cursor"]).toBe(UNTIL.toISOString());
  });

  test("a busy window is read to its end, a page at a time", async () => {
    const startAt: Date = OneUptimeDate.addRemoveMinutes(NOW, -3);
    const installed: Installed = install(
      logs(
        LOG_SCAN_PAGE_SIZE * 2 + 500,
        OneUptimeDate.addRemoveSeconds(startAt, 1),
        0.01,
        SSH_LINES.failedPasswordRoot,
      ),
    );

    const result: SecurityLogScanResult = await SecurityLogScanner.scanSource(
      source(startAt.toISOString()),
    );

    // Pre-fix a window stopped at 5,000 lines and the rest were never read.
    expect(result.logsRead).toBe(LOG_SCAN_PAGE_SIZE * 2 + 500);
    expect(result.eventsFound).toBe(LOG_SCAN_PAGE_SIZE * 2 + 500);
    expect(installed.inserted).toHaveLength(LOG_SCAN_PAGE_SIZE * 2 + 500);
    expect(
      installed.reads.map((read: FindSecurityLogCandidatesData): number => {
        return read.offset;
      }),
    ).toEqual([0, LOG_SCAN_PAGE_SIZE, LOG_SCAN_PAGE_SIZE * 2]);
    expect(result.partialWindowStart).toBe("");
    expect(installed.updates[0]!["cursor"]).toBe(UNTIL.toISOString());
  });

  test("a scan that reaches its line budget stops part way through a window, and the next goes on from the line after", async () => {
    const startAt: Date = OneUptimeDate.addRemoveMinutes(NOW, -3);
    const total: number = LOG_SCAN_MAX_LINES_PER_RUN + 1500;
    const installed: Installed = install(
      logs(
        total,
        OneUptimeDate.addRemoveSeconds(startAt, 1),
        0.001,
        "invalid user but no address",
      ),
    );

    const first: SecurityLogScanResult = await SecurityLogScanner.scanSource(
      source(startAt.toISOString()),
    );

    expect(first.logsRead).toBe(LOG_SCAN_MAX_LINES_PER_RUN);
    expect(first.windows).toBe(0);
    expect(first.partialWindowStart).toBe(startAt.toISOString());
    expect(first.partialWindowProcessed).toBe(LOG_SCAN_MAX_LINES_PER_RUN);
    // The cursor stays at the window it stopped in.
    expect(installed.updates[0]!["cursor"]).toBe(startAt.toISOString());

    installed.reads.length = 0;

    const second: SecurityLogScanResult = await SecurityLogScanner.scanSource(
      source(
        installed.updates[0]!["cursor"] as string,
        installed.updates[0]!["lastScanResult"] as JSONObject,
      ),
    );

    // Every line read once across the two scans: none skipped, none twice.
    expect(installed.reads[0]!.offset).toBe(LOG_SCAN_MAX_LINES_PER_RUN);
    expect(second.logsRead).toBe(1500);
    expect(first.logsRead + second.logsRead).toBe(total);
    expect(second.partialWindowStart).toBe("");
    expect(installed.updates[1]!["cursor"]).toBe(UNTIL.toISOString());
  });

  test("a scan that runs out of time stops at a page, and the next goes on from there", async () => {
    const startAt: Date = OneUptimeDate.addRemoveMinutes(NOW, -3);
    const installed: Installed = install(
      logs(
        LOG_SCAN_PAGE_SIZE * 3,
        OneUptimeDate.addRemoveSeconds(startAt, 1),
        0.01,
        SSH_LINES.failedPasswordRoot,
      ),
    );

    const result: SecurityLogScanResult = await SecurityLogScanner.scanSource(
      source(startAt.toISOString()),
      leaseFor(2),
    );

    // The events of the pages it read are stored; the rest wait.
    expect(result.logsRead).toBe(LOG_SCAN_PAGE_SIZE * 2);
    expect(installed.inserted).toHaveLength(LOG_SCAN_PAGE_SIZE * 2);
    expect(result.partialWindowStart).toBe(startAt.toISOString());
    expect(result.partialWindowProcessed).toBe(LOG_SCAN_PAGE_SIZE * 2);
    expect(installed.updates[0]!["cursor"]).toBe(startAt.toISOString());
  });

  test("a scan that loses its project's lease stops after the page in hand", async () => {
    const startAt: Date = OneUptimeDate.addRemoveMinutes(NOW, -3);
    const installed: Installed = install(
      logs(
        LOG_SCAN_PAGE_SIZE * 3,
        OneUptimeDate.addRemoveSeconds(startAt, 1),
        0.01,
        "invalid user but no address",
      ),
    );

    const result: SecurityLogScanResult = await SecurityLogScanner.scanSource(
      source(startAt.toISOString()),
      {
        hasTimeLeft: (): boolean => {
          return true;
        },
        keep: async (): Promise<boolean> => {
          return false;
        },
      },
    );

    expect(installed.reads).toHaveLength(1);
    expect(result.partialWindowStart).toBe(startAt.toISOString());
    expect(result.partialWindowProcessed).toBe(LOG_SCAN_PAGE_SIZE);
  });

  test("a stopping point from another cursor is not resumed", async () => {
    const startAt: Date = OneUptimeDate.addRemoveMinutes(NOW, -3);
    const installed: Installed = install([]);

    await SecurityLogScanner.scanSource(
      source(startAt.toISOString(), {
        partialWindowStart: OneUptimeDate.addRemoveMinutes(
          startAt,
          -5,
        ).toISOString(),
        partialWindowProcessed: 4000,
      }),
    );

    expect(installed.reads[0]!.offset).toBe(0);
  });

  test("an event keeps the time its log line was written and names the record it came from", async () => {
    const startAt: Date = OneUptimeDate.addRemoveMinutes(NOW, -3);
    const stored: Array<StoredLog> = logs(
      1,
      startAt,
      30,
      SSH_LINES.failedPasswordRoot,
    );
    const installed: Installed = install(stored);

    await SecurityLogScanner.scanSource(source(startAt.toISOString()));

    const row: JSONObject = installed.inserted[0]!;

    expect(String(row["time"]).startsWith("2026-10-19 11:57:30")).toBe(true);
    expect(row["eventUid"]).toBe(`log:${stored[0]!.id}`);
    expect((row["attributes"] as JSONObject)["oneuptime.log.id"]).toBe(
      stored[0]!.id,
    );
  });

  test("an event names the record its log was sent under, so Security Events connects it to that host exactly", async () => {
    const startAt: Date = OneUptimeDate.addRemoveMinutes(NOW, -3);
    const hostId: string = "0192f1a0-0000-7000-8000-0000000000aa";
    const stored: Array<StoredLog> = logs(
      2,
      startAt,
      30,
      SSH_LINES.failedPasswordRoot,
    );
    stored[0]!.primaryEntityId = hostId;
    stored[0]!.primaryEntityType = ServiceType.Host;
    const installed: Installed = install(stored);

    await SecurityLogScanner.scanSource(source(startAt.toISOString()));

    const first: JSONObject = installed.inserted[0]![
      "attributes"
    ] as JSONObject;
    const second: JSONObject = installed.inserted[1]![
      "attributes"
    ] as JSONObject;

    expect(first[SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]).toBe(hostId);
    expect(first[SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE]).toBe(ServiceType.Host);
    // A log that names no record connects its event to none.
    expect(second[SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]).toBeUndefined();
  });

  test("a store that fails leaves the cursor where it was", async () => {
    const startAt: Date = OneUptimeDate.addRemoveMinutes(NOW, -3);
    const installed: Installed = install(
      logs(1, startAt, 30, SSH_LINES.failedPasswordRoot),
    );
    jest
      .spyOn(SecurityEventService, "insertJsonRows")
      .mockRejectedValue(new Error("ClickHouse is down"));

    await expect(
      SecurityLogScanner.scanSource(source(startAt.toISOString())),
    ).rejects.toThrow("ClickHouse is down");
    expect(installed.updates).toHaveLength(0);
  });
});

describe("SecurityLogScanner.scanProject", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("scans each of the project's enabled sources, and records a failure on it", async () => {
    const installed: Installed = install([]);
    jest
      .spyOn(LogService, "findSecurityLogCandidates")
      .mockRejectedValue(new Error("Log table unreachable"));

    // A cursor a minute back, so there is a window to read.
    const findAll: SpyInstance<typeof SecurityLogSourceService.findAllBy> = jest
      .spyOn(SecurityLogSourceService, "findAllBy")
      .mockResolvedValue([
        source(OneUptimeDate.addRemoveMinutes(NOW, -1).toISOString()),
      ] as never);

    await SecurityLogScanner.scanProject(PROJECT_ID);

    expect(installed.updates[0]!["lastError"]).toBe("Log table unreachable");
    expect(findAll).toHaveBeenCalledWith({
      query: { projectId: PROJECT_ID, isEnabled: true },
      // The cursor, and where the last scan stopped within its window.
      select: {
        _id: true,
        projectId: true,
        cursor: true,
        lastScanResult: true,
      },
      sort: { _id: SortOrder.Ascending },
      props: { isRoot: true },
    });
  });

  test("a turn with no time left scans no further source", async () => {
    install([]);
    jest
      .spyOn(SecurityLogSourceService, "findAllBy")
      .mockResolvedValue([source(UNTIL.toISOString())] as never);
    const scan: SpyInstance<typeof SecurityLogScanner.scanSource> = jest.spyOn(
      SecurityLogScanner,
      "scanSource",
    );

    await SecurityLogScanner.scanProject(PROJECT_ID, leaseFor(0));

    expect(scan).not.toHaveBeenCalled();
  });
});

describe("SecurityLogScanner.enqueueProjectsWithEnabledSources", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("queues each project with an enabled source, read page by page, and scans none itself", async () => {
    const findAll: SpyInstance<typeof SecurityLogSourceService.findAllBy> = jest
      .spyOn(SecurityLogSourceService, "findAllBy")
      .mockResolvedValue([source(), source()] as never);
    const enqueue: SpyInstance<typeof SecurityProjectWork.enqueueProjects> =
      jest.spyOn(SecurityProjectWork, "enqueueProjects").mockResolvedValue(1);
    const scan: SpyInstance<typeof SecurityLogScanner.scanSource> = jest.spyOn(
      SecurityLogScanner,
      "scanSource",
    );

    await expect(
      SecurityLogScanner.enqueueProjectsWithEnabledSources(),
    ).resolves.toBe(1);

    expect(enqueue.mock.calls[0]![0]).toBe(SECURITY_LOG_SCAN_PROJECT_WORK);
    expect(
      (enqueue.mock.calls[0]![1] as Array<ObjectID>).map(
        (projectId: ObjectID): string => {
          return projectId.toString();
        },
      ),
    ).toEqual([PROJECT_ID.toString(), PROJECT_ID.toString()]);
    expect(scan).not.toHaveBeenCalled();
    expect(findAll).toHaveBeenCalledWith({
      query: { isEnabled: true },
      select: { _id: true, projectId: true },
      sort: { _id: SortOrder.Ascending },
      props: { isRoot: true },
    });
  });
});
