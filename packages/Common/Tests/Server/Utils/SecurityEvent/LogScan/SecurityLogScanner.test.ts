import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import SecurityLogSource from "../../../../../Models/DatabaseModels/SecurityLogSource";
import Semaphore from "../../../../../Server/Infrastructure/Semaphore";
import LogService, {
  FindSecurityLogCandidatesData,
} from "../../../../../Server/Services/LogService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../../Server/Services/OpenTelemetryIngestService";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import SecurityLogSourceService from "../../../../../Server/Services/SecurityLogSourceService";
import SecurityLogScanner, {
  LOG_SCAN_MAX_BACKLOG_IN_MINUTES,
  LOG_SCAN_MAX_LINES_PER_WINDOW,
  LOG_SCAN_SETTLE_IN_SECONDS,
  SECURITY_LOGS_SERVICE_NAME,
  SecurityLogScanResult,
} from "../../../../../Server/Utils/SecurityEvent/LogScan/SecurityLogScanner";
import ThreatIntelEnricher from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import OneUptimeDate from "../../../../../Types/Date";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
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

function source(cursor?: string | undefined): SecurityLogSource {
  const model: SecurityLogSource = new SecurityLogSource();
  model.id = SOURCE_ID;
  model.projectId = PROJECT_ID;
  model.isEnabled = true;

  if (cursor !== undefined) {
    model.cursor = cursor;
  }

  return model;
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
    expect(result.truncated).toBe(false);

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

  test("a scan more than an hour behind starts again an hour back, and says so", async () => {
    const installed: Installed = install([]);

    const result: SecurityLogScanResult = await SecurityLogScanner.scanSource(
      source(OneUptimeDate.addRemoveHours(NOW, -5).toISOString()),
    );

    expect(result.skippedBacklog).toBe(true);
    expect(installed.reads[0]!.arrivedAfter.toISOString()).toBe(
      OneUptimeDate.addRemoveMinutes(
        NOW,
        -LOG_SCAN_MAX_BACKLOG_IN_MINUTES,
      ).toISOString(),
    );
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

  test("a window with more candidate lines than one scan reads is cut, and says so", async () => {
    const startAt: Date = OneUptimeDate.addRemoveMinutes(NOW, -3);
    const installed: Installed = install(
      logs(
        LOG_SCAN_MAX_LINES_PER_WINDOW + 20,
        OneUptimeDate.addRemoveSeconds(startAt, 1),
        0.01,
        "invalid user but no address",
      ),
    );

    const result: SecurityLogScanResult = await SecurityLogScanner.scanSource(
      source(startAt.toISOString()),
    );

    expect(result.truncated).toBe(true);
    expect(result.logsRead).toBe(LOG_SCAN_MAX_LINES_PER_WINDOW);
    expect(installed.inserted).toHaveLength(0);
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

describe("SecurityLogScanner.scanAllEnabled", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("scans each enabled source under its project's lock, and records a failure on it", async () => {
    const installed: Installed = install([]);
    jest
      .spyOn(LogService, "findSecurityLogCandidates")
      .mockRejectedValue(new Error("Log table unreachable"));
    const lock: SpyInstance<typeof Semaphore.lock> = jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({} as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);

    // A cursor a minute back, so there is a window to read.
    jest
      .spyOn(SecurityLogSourceService, "findBy")
      .mockResolvedValue([
        source(OneUptimeDate.addRemoveMinutes(NOW, -1).toISOString()),
      ] as never);

    await SecurityLogScanner.scanAllEnabled();

    expect(lock).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: "SecurityLogScan",
        key: PROJECT_ID.toString(),
        acquireAttemptsLimit: 1,
      }),
    );
    expect(installed.updates[0]!["lastError"]).toBe("Log table unreachable");
  });

  test("a project another worker is scanning is left to it", async () => {
    install([]);
    jest
      .spyOn(SecurityLogSourceService, "findBy")
      .mockResolvedValue([source(UNTIL.toISOString())] as never);
    jest.spyOn(Semaphore, "lock").mockRejectedValue(new Error("locked"));
    const scan: SpyInstance<typeof SecurityLogScanner.scanSource> = jest.spyOn(
      SecurityLogScanner,
      "scanSource",
    );

    await SecurityLogScanner.scanAllEnabled();

    expect(scan).not.toHaveBeenCalled();
  });
});
