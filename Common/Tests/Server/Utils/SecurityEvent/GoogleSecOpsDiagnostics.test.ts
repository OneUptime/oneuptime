import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import { generateKeyPairSync } from "crypto";
import GoogleSecOpsConnection from "../../../../Models/DatabaseModels/GoogleSecOpsConnection";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import GoogleSecOpsConnectionService from "../../../../Server/Services/GoogleSecOpsConnectionService";
import OTelIngestService from "../../../../Server/Services/OpenTelemetryIngestService";
import SecurityEventService from "../../../../Server/Services/SecurityEventService";
import GoogleSecOpsClient, {
  FetchAlertsResult,
} from "../../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsClient";
import GoogleSecOpsPoller, {
  GOOGLE_SECOPS_SOURCE_LOCK_NAMESPACE,
} from "../../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsPoller";
import ThreatIntelEnricher from "../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import logger from "../../../../Server/Utils/Logger";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  GoogleSecOpsDiagnosticCheck,
  GoogleSecOpsRunOptions,
  GoogleSecOpsRunResult,
} from "../../../../Types/SecurityEvent/GoogleSecOpsDiagnostics";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import GoogleSecOpsAlertNormalizer from "../../../../Utils/SecurityEvent/GoogleSecOpsAlertNormalizer";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const NOW: Date = new Date("2026-09-10T12:00:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CURSOR: string = "2026-09-10T11:55:00.000Z";
const RANGE: GoogleSecOpsRunOptions = {
  type: "preview",
  startTime: "2026-09-09T00:00:00.000Z",
  endTime: NOW.toISOString(),
};

function connection(): GoogleSecOpsConnection {
  const item: GoogleSecOpsConnection = new GoogleSecOpsConnection();
  item._id = CONNECTION_ID.toString();
  item.projectId = PROJECT_ID;
  item.region = "us";
  item.instanceResourceName = "projects/p/locations/us/instances/i";
  item.serviceAccountJson = "{}";
  item.cursor = CURSOR;
  return item;
}

function detection(id: string = "alert-1"): JSONObject {
  return {
    id,
    detectionTime: "2026-09-09T01:30:00.000Z",
    createdTime: "2026-09-10T04:16:00.000Z",
    detection: [
      {
        ruleName: "Suspicious sign-in",
        alertState: "NOT_ALERTING",
        severity: "HIGH",
      },
    ],
  };
}

function fetched(
  alerts: Array<JSONObject> = [],
  changes: Partial<FetchAlertsResult> = {},
): FetchAlertsResult {
  return {
    alerts,
    complete: true,
    progress: 1,
    truncatedByCount: false,
    truncatedByBytes: false,
    baselineAlertsCount: alerts.length,
    filteredAlertsCount: alerts.length,
    chunkCount: 1,
    ...changes,
  };
}

function client(
  results: Array<FetchAlertsResult> = [fetched([detection()])],
): GoogleSecOpsClient {
  let index: number = 0;
  return {
    testAuthentication: jest.fn(async (): Promise<void> => {}),
    fetchDetectionAlerts: jest.fn(async (): Promise<FetchAlertsResult> => {
      return results[Math.min(index++, results.length - 1)]!;
    }),
  } as unknown as GoogleSecOpsClient;
}

function lastUpdate(): JSONObject {
  const calls: Array<Array<unknown>> = getJestSpyOn(
    GoogleSecOpsConnectionService,
    "updateOneById",
  ).mock.calls;
  return (calls[calls.length - 1]![0] as { data: JSONObject }).data;
}

describe("Google SecOps connection diagnostics and replay", () => {
  beforeEach((): void => {
    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
    getJestSpyOn(Semaphore, "lock").mockResolvedValue({});
    getJestSpyOn(Semaphore, "release").mockResolvedValue(undefined);
    getJestSpyOn(
      GoogleSecOpsConnectionService,
      "updateOneById",
    ).mockResolvedValue(undefined);
    getJestSpyOn(GoogleSecOpsPoller, "findExistingEventUids").mockResolvedValue(
      new Set(),
    );
    getJestSpyOn(SecurityEventService, "insertJsonRows").mockResolvedValue(
      undefined,
    );
    getJestSpyOn(
      OTelIngestService,
      "telemetryServiceFromName",
    ).mockResolvedValue({
      serviceName: "Google SecOps",
      primaryEntityId: PROJECT_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      dataRententionInDays: 15,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    });
    getJestSpyOn(
      ThreatIntelEnricher,
      "enrichNormalizedEvents",
    ).mockResolvedValue({ eventsMatched: 0, valuesLookedUp: 0 });
    getJestSpyOn(logger, "warn").mockImplementation((): void => {});
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test("connection test authenticates and reads one record without changing ingestion state", async (): Promise<void> => {
    const api: GoogleSecOpsClient = client([
      fetched([detection()], {
        truncatedByCount: true,
        baselineAlertsCount: 5,
      }),
    ]);
    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "test" },
        api,
      );
    expect(result.status).toBe("success");
    expect(
      result.checks.map((check: GoogleSecOpsDiagnosticCheck): string => {
        return check.name;
      }),
    ).toEqual([
      "Validate configuration",
      "Authenticate with Google",
      "Read detections from the configured instance",
      "Normalize detections",
    ]);
    expect(api.testAuthentication).toHaveBeenCalledTimes(1);
    expect(api.fetchDetectionAlerts).toHaveBeenCalledWith(
      expect.objectContaining({
        maxAlerts: 1,
        includeNonAlertingDetections: false,
      }),
    );
    expect(result.warnings.join(" ")).toMatch(/at most one/);
    expect(GoogleSecOpsPoller.findExistingEventUids).not.toHaveBeenCalled();
    expect(SecurityEventService.insertJsonRows).not.toHaveBeenCalled();
    expect(OTelIngestService.telemetryServiceFromName).not.toHaveBeenCalled();
    expect(GoogleSecOpsConnectionService.updateOneById).not.toHaveBeenCalled();
    expect(Semaphore.lock).not.toHaveBeenCalled();
  });

  test("a quiet instance still passes its read-permission check", async (): Promise<void> => {
    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "test" },
        client([fetched()]),
      );
    expect(result.status).toBe("success");
    expect(result.fetchedCount).toBe(0);
    expect(result.complete).toBe(true);
  });

  test("authentication failure is redacted and does not call the detections endpoint", async (): Promise<void> => {
    const api: GoogleSecOpsClient = client();
    getJestSpyOn(api, "testAuthentication").mockRejectedValue(
      new Error(
        'Google token exchange failed: {"access_token":"credential-secret"}',
      ),
    );
    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "test" },
        api,
      );
    expect(result.status).toBe("failed");
    expect(result.checks[result.checks.length - 1]?.name).toBe(
      "Authenticate with Google",
    );
    expect(JSON.stringify(result)).not.toContain("credential-secret");
    expect(api.fetchDetectionAlerts).not.toHaveBeenCalled();
    expect(GoogleSecOpsConnectionService.updateOneById).not.toHaveBeenCalled();
  });

  test("successful authentication followed by forbidden read identifies the failed permission check", async (): Promise<void> => {
    const api: GoogleSecOpsClient = client();
    getJestSpyOn(api, "fetchDetectionAlerts").mockRejectedValue(
      new Error(
        "Google SecOps alerts fetch failed (HTTP 403): permission denied",
      ),
    );
    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "test" },
        api,
      );
    expect(result.status).toBe("failed");
    expect(result.checks[1]?.status).toBe("success");
    expect(result.checks[result.checks.length - 1]?.name).toMatch(
      /Read detections/,
    );
    expect(result.error).toContain("403");
  });

  test("an unfinished test response does not claim a complete read", async (): Promise<void> => {
    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "test" },
        client([fetched([], { complete: false })]),
      );
    expect(result.status).toBe("partial");
    expect(result.complete).toBe(false);
  });

  test("preview exposes both source timestamps and explicit non-alerting state without writes", async (): Promise<void> => {
    const item: GoogleSecOpsConnection = connection();
    item.includeNonAlertingDetections = true;
    const api: GoogleSecOpsClient = client();
    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(item, RANGE, api);
    expect(result.samples).toEqual([
      {
        id: "alert-1",
        ruleName: "Suspicious sign-in",
        detectionTime: "2026-09-09T01:30:00.000Z",
        createdTime: "2026-09-10T04:16:00.000Z",
        isAlert: false,
      },
    ]);
    expect(result.includeNonAlertingDetections).toBe(true);
    expect(api.fetchDetectionAlerts).toHaveBeenCalledWith(
      expect.objectContaining({ includeNonAlertingDetections: true }),
    );
    expect(GoogleSecOpsPoller.findExistingEventUids).not.toHaveBeenCalled();
    expect(GoogleSecOpsConnectionService.updateOneById).not.toHaveBeenCalled();
    expect(ThreatIntelEnricher.enrichNormalizedEvents).not.toHaveBeenCalled();
  });

  test("preview bounds displayed samples and excludes raw credentials from source payloads", async (): Promise<void> => {
    const alerts: Array<JSONObject> = Array.from(
      { length: 40 },
      (_value: unknown, index: number): JSONObject => {
        return {
          ...detection(`d-${index}`),
          private_key: "source-private-key",
        };
      },
    );
    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        RANGE,
        client([fetched(alerts)]),
      );
    expect(result.fetchedCount).toBe(40);
    expect(result.samples).toHaveLength(25);
    expect(JSON.stringify(result)).not.toContain("source-private-key");
  });

  test.each([
    ["bad", NOW.toISOString()],
    [NOW.toISOString(), "bad"],
    [NOW.toISOString(), NOW.toISOString()],
    [NOW.toISOString(), "2026-09-09T00:00:00Z"],
    ["2026-09-01T00:00:00Z", NOW.toISOString()],
    ["2026-09-09T00:00:00Z", "2026-09-11T00:00:00Z"],
  ])(
    "rejects invalid or excessive preview range %s to %s",
    async (startTime: string, endTime: string): Promise<void> => {
      const api: GoogleSecOpsClient = client();
      await expect(
        GoogleSecOpsPoller.executeConnection(
          connection(),
          { type: "preview", startTime, endTime },
          api,
        ),
      ).rejects.toThrow(/seven days/);
      expect(api.fetchDetectionAlerts).not.toHaveBeenCalled();
    },
  );

  test("accepts an exact seven day historical range", async (): Promise<void> => {
    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { ...RANGE, startTime: "2026-09-03T12:00:00Z" },
        client([fetched()]),
      );
    expect(result.status).toBe("empty");
  });

  test("complete quiet poll records success and moves the cursor", async (): Promise<void> => {
    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "poll", runId: "run-checkpoint-1" },
        client([fetched()]),
      );
    expect(result.status).toBe("empty");
    expect(result.runId).toBe("run-checkpoint-1");
    expect(lastUpdate()).toMatchObject({
      cursor: NOW.toISOString(),
      lastSuccessfulPollAt: NOW,
      lastPollResult: result,
      lastError: null,
    });
    expect(SecurityEventService.insertJsonRows).not.toHaveBeenCalled();
  });

  test("a partial stream imports received records but holds the entire prior cursor", async (): Promise<void> => {
    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "poll" },
        client([fetched([detection()], { complete: false })]),
      );
    expect(result.status).toBe("partial");
    expect(result.ingestedCount).toBe(1);
    expect(lastUpdate()).not.toHaveProperty("cursor");
    expect(lastUpdate()).not.toHaveProperty("lastSuccessfulPollAt");
    expect(lastUpdate()["lastError"]).toMatch(/complete/);
  });

  test("a partial first poll anchors its window so a delayed retry cannot skip detections", async (): Promise<void> => {
    const item: GoogleSecOpsConnection = connection();
    delete item.cursor;
    const first: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        item,
        { type: "poll" },
        client([fetched([], { complete: false })]),
      );
    item.cursor = String(lastUpdate()["cursor"]);
    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(
      new Date("2026-09-10T14:00:00Z"),
    );
    const retry: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        item,
        { type: "poll" },
        client([fetched()]),
      );
    expect(retry.windowStart).toBe(first.windowStart);
    expect(retry.windowEnd).toBe("2026-09-10T14:00:00.000Z");
  });

  test("a mixed normalization failure preserves retry coverage even after other records import", async (): Promise<void> => {
    const normalize: typeof GoogleSecOpsAlertNormalizer.normalize =
      GoogleSecOpsAlertNormalizer.normalize;
    getJestSpyOn(GoogleSecOpsAlertNormalizer, "normalize").mockImplementation(
      (alert: JSONObject) => {
        if (alert["id"] === "broken") {
          throw new Error("broken data");
        }
        return normalize(alert);
      },
    );
    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "poll" },
        client([fetched([detection("valid"), detection("broken")])]),
      );
    expect(result).toMatchObject({
      status: "partial",
      ingestedCount: 1,
      failedCount: 1,
      complete: false,
    });
    expect(lastUpdate()).not.toHaveProperty("cursor");
  });

  test("unrecognized payloads are reported and cannot make a poll falsely healthy", async (): Promise<void> => {
    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "poll" },
        client([fetched([{ arbitrary: "envelope" }, detection()])]),
      );
    expect(result).toMatchObject({
      status: "partial",
      rejectedCount: 1,
      ingestedCount: 1,
    });
    expect(lastUpdate()).not.toHaveProperty("cursor");
  });

  test("replaying a previously imported alert skips its persisted event uid", async (): Promise<void> => {
    getJestSpyOn(GoogleSecOpsPoller, "findExistingEventUids").mockResolvedValue(
      new Set(["alert-1"]),
    );
    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "poll" },
        client(),
      );
    expect(result).toMatchObject({
      ingestedCount: 0,
      duplicateCount: 1,
      complete: true,
    });
    expect(SecurityEventService.insertJsonRows).not.toHaveBeenCalled();
    expect(OTelIngestService.telemetryServiceFromName).not.toHaveBeenCalled();
    expect(GoogleSecOpsPoller.findExistingEventUids).toHaveBeenCalledWith(
      PROJECT_ID,
      ["alert-1"],
    );
  });

  test("two overlapping polls only insert each alert once", async (): Promise<void> => {
    const persisted: Array<JSONObject> = [];
    getJestSpyOn(
      GoogleSecOpsPoller,
      "findExistingEventUids",
    ).mockImplementation(async (): Promise<Set<string>> => {
      return new Set(
        persisted.map((row: JSONObject): string => {
          return String(row["eventUid"]);
        }),
      );
    });
    getJestSpyOn(SecurityEventService, "insertJsonRows").mockImplementation(
      async (rows: Array<JSONObject>): Promise<void> => {
        persisted.push(...rows);
      },
    );
    const first: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "poll" },
        client(),
      );
    const second: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "poll" },
        client(),
      );
    expect(first.ingestedCount).toBe(1);
    expect(second.duplicateCount).toBe(1);
    expect(persisted).toHaveLength(1);
  });

  test.each(["truncatedByCount", "truncatedByBytes"])(
    "splits %s into contiguous windows and deduplicates parent records",
    async (flag: string): Promise<void> => {
      const api: GoogleSecOpsClient = client([
        fetched([detection("a")], { [flag]: true }),
        fetched([detection("a")]),
        fetched([detection("b")]),
      ]);
      const result: GoogleSecOpsRunResult =
        await GoogleSecOpsPoller.executeConnection(
          connection(),
          { type: "poll" },
          api,
        );
      expect(result).toMatchObject({
        complete: true,
        status: "success",
        fetchedCount: 2,
        ingestedCount: 2,
        requestCount: 3,
      });
      const calls: Array<Array<{ startTime: Date; endTime: Date }>> =
        getJestSpyOn(api, "fetchDetectionAlerts").mock.calls;
      expect(calls[1]![0]!.startTime).toEqual(calls[0]![0]!.startTime);
      expect(calls[1]![0]!.endTime).toEqual(calls[2]![0]!.startTime);
      expect(calls[2]![0]!.endTime).toEqual(calls[0]![0]!.endTime);
      expect(lastUpdate()["cursor"]).toBe(NOW.toISOString());
    },
  );

  test("matched count exceeding returned records triggers recovery without Google's truncation flag", async (): Promise<void> => {
    const api: GoogleSecOpsClient = client([
      fetched([detection("a")], { filteredAlertsCount: 2 }),
      fetched([detection("a")]),
      fetched([detection("b")]),
    ]);
    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(connection(), RANGE, api);
    expect(result).toMatchObject({
      complete: true,
      fetchedCount: 2,
      requestCount: 3,
    });
  });

  test("perpetually truncated responses stop at a fixed budget and hold cursor", async (): Promise<void> => {
    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "poll" },
        client([fetched([detection()], { truncatedByCount: true })]),
      );
    expect(result).toMatchObject({
      status: "partial",
      requestCount: 12,
      ingestedCount: 1,
      complete: false,
    });
    expect(lastUpdate()).not.toHaveProperty("cursor");
    expect(result.warnings.join(" ")).toMatch(/request limit/);
  });

  test("stale cursors process the earliest backlog instead of skipping to yesterday", async (): Promise<void> => {
    const item: GoogleSecOpsConnection = connection();
    item.cursor = "2026-09-01T12:00:00.000Z";
    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        item,
        { type: "poll" },
        client([fetched()]),
      );
    expect(result.windowStart).toBe("2026-09-01T11:59:00.000Z");
    expect(result.windowEnd).toBe("2026-09-02T11:59:00.000Z");
    expect(lastUpdate()["cursor"]).toBe(result.windowEnd);
  });

  test("backfill imports source event timestamps and records a useful event browser range without changing poll state", async (): Promise<void> => {
    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { ...RANGE, type: "backfill" },
        client(),
      );
    expect(result.eventTimeStart).toBe("2026-09-09T01:30:00.000Z");
    expect(result.eventTimeEnd).toBe(result.eventTimeStart);
    expect(lastUpdate()).toEqual({ lastEventIngestedAt: NOW });
    const rows: Array<JSONObject> = getJestSpyOn(
      SecurityEventService,
      "insertJsonRows",
    ).mock.calls[0]![0];
    expect(rows[0]!["attributes"]).toMatchObject({
      "oneuptime.google_secops.connection_id": CONNECTION_ID.toString(),
    });
  });

  test("a failed insert records the failure and never advances cursor or reports imported events", async (): Promise<void> => {
    getJestSpyOn(SecurityEventService, "insertJsonRows").mockRejectedValue(
      new Error("Event storage unavailable"),
    );
    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "poll" },
        client(),
      );
    expect(result).toMatchObject({
      status: "failed",
      complete: false,
      ingestedCount: 0,
    });
    expect(lastUpdate()).not.toHaveProperty("cursor");
    expect(result.error).toMatch(/storage unavailable/);
    expect(Semaphore.release).toHaveBeenCalledTimes(1);
  });

  test("failed duplicate lookup does not insert potentially duplicate records", async (): Promise<void> => {
    getJestSpyOn(GoogleSecOpsPoller, "findExistingEventUids").mockRejectedValue(
      new Error("Read store unavailable"),
    );
    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "poll" },
        client(),
      );
    expect(result.status).toBe("failed");
    expect(SecurityEventService.insertJsonRows).not.toHaveBeenCalled();
    expect(lastUpdate()).not.toHaveProperty("cursor");
  });

  test("poll and backfill share the same project source lock across connections", async (): Promise<void> => {
    const other: GoogleSecOpsConnection = connection();
    other._id = "33333333-3333-4333-8333-333333333333";
    await GoogleSecOpsPoller.executeConnection(
      connection(),
      { type: "poll" },
      client([fetched()]),
    );
    await GoogleSecOpsPoller.executeConnection(
      other,
      { ...RANGE, type: "backfill" },
      client([fetched()]),
    );
    const calls: Array<Array<unknown>> = getJestSpyOn(Semaphore, "lock").mock
      .calls;
    for (const call of calls) {
      expect(call[0]).toMatchObject({
        namespace: GOOGLE_SECOPS_SOURCE_LOCK_NAMESPACE,
        key: PROJECT_ID.toString(),
      });
    }
    expect(Semaphore.release).toHaveBeenCalledTimes(2);
  });

  test("a lock acquisition failure prevents fetch and every write", async (): Promise<void> => {
    getJestSpyOn(Semaphore, "lock").mockRejectedValue(
      new Error("lock unavailable"),
    );
    const api: GoogleSecOpsClient = client();
    await expect(
      GoogleSecOpsPoller.executeConnection(connection(), { type: "poll" }, api),
    ).rejects.toThrow("lock unavailable");
    expect(api.fetchDetectionAlerts).not.toHaveBeenCalled();
    expect(GoogleSecOpsConnectionService.updateOneById).not.toHaveBeenCalled();
    expect(Semaphore.release).not.toHaveBeenCalled();
  });

  test("a lock release error preserves the completed import result", async (): Promise<void> => {
    getJestSpyOn(Semaphore, "release").mockRejectedValue(
      new Error("Redis unavailable"),
    );
    getJestSpyOn(logger, "error").mockImplementation((): void => {});
    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "poll" },
        client(),
      );
    expect(result).toMatchObject({ status: "success", ingestedCount: 1 });
    expect(lastUpdate()["cursor"]).toBe(NOW.toISOString());
  });

  test("concurrent imports from different connections remain serialized through durable insertion", async (): Promise<void> => {
    let held: boolean = false;
    const waiting: Array<() => void> = [];
    getJestSpyOn(Semaphore, "lock").mockImplementation(async () => {
      if (held) {
        await new Promise<void>((resolve: () => void): void => {
          waiting.push(resolve);
        });
      }
      held = true;
      return {};
    });
    getJestSpyOn(Semaphore, "release").mockImplementation(
      async (): Promise<void> => {
        held = false;
        waiting.shift()?.();
      },
    );
    const stored: Set<string> = new Set();
    getJestSpyOn(
      GoogleSecOpsPoller,
      "findExistingEventUids",
    ).mockImplementation(async (): Promise<Set<string>> => {
      return new Set(stored);
    });
    getJestSpyOn(SecurityEventService, "insertJsonRows").mockImplementation(
      async (rows: Array<JSONObject>, options: JSONObject): Promise<void> => {
        expect(held).toBe(true);
        expect(options).toMatchObject({
          clickhouseSettings: { async_insert: 0, insert_distributed_sync: 1 },
        });
        for (const row of rows) {
          stored.add(String(row["eventUid"]));
        }
      },
    );
    const other: GoogleSecOpsConnection = connection();
    other._id = "33333333-3333-4333-8333-333333333333";
    const results: Array<GoogleSecOpsRunResult> = await Promise.all([
      GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "poll" },
        client(),
      ),
      GoogleSecOpsPoller.executeConnection(
        other,
        { ...RANGE, type: "backfill" },
        client(),
      ),
    ]);
    expect(
      results.map((result: GoogleSecOpsRunResult): number => {
        return result.ingestedCount;
      }),
    ).toEqual([1, 0]);
    expect(results[1]!.duplicateCount).toBe(1);
    expect(SecurityEventService.insertJsonRows).toHaveBeenCalledTimes(1);
  });

  test("production reloads the cursor and scope inside the source lock", async (): Promise<void> => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const current: GoogleSecOpsConnection = connection();
    current.serviceAccountJson = JSON.stringify({
      client_email: "test@example.iam.gserviceaccount.com",
      private_key: privateKey,
    });
    current.cursor = "2026-09-10T11:58:00Z";
    current.includeNonAlertingDetections = true;
    getJestSpyOn(
      GoogleSecOpsConnectionService,
      "findOneById",
    ).mockImplementation(async (): Promise<GoogleSecOpsConnection> => {
      expect(Semaphore.lock).toHaveBeenCalledTimes(1);
      return current;
    });
    getJestSpyOn(
      GoogleSecOpsClient.prototype,
      "fetchDetectionAlerts",
    ).mockResolvedValue(fetched());
    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(connection(), {
        type: "poll",
      });
    expect(result.windowStart).toBe("2026-09-10T11:57:00.000Z");
    expect(result.includeNonAlertingDetections).toBe(true);
    expect(Semaphore.release).toHaveBeenCalledTimes(1);
  });
});

describe("Google SecOps duplicate lookup database contract", () => {
  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test("binds untrusted identifiers, scopes the source, and reads every replica without partial timeout results", async (): Promise<void> => {
    const statements: Array<Statement> = [];
    getJestSpyOn(SecurityEventService, "executeQuery").mockImplementation(
      async (statement: Statement) => {
        statements.push(statement);
        return {
          json: async () => {
            return {
              data: [{ eventUid: "existing" }, { eventUid: "existing" }],
            };
          },
        };
      },
    );
    const id: string = "id'); DROP TABLE SecurityEvent; --";
    const existing: Set<string> =
      await GoogleSecOpsPoller.findExistingEventUids(PROJECT_ID, [id]);
    expect(existing).toEqual(new Set(["existing"]));
    expect(statements[0]!.query).toMatch(
      /SELECT DISTINCT eventUid FROM clusterAllReplicas/,
    );
    expect(statements[0]!.query).toMatch(/timeout_overflow_mode = 'throw'/);
    expect(statements[0]!.query).toMatch(/skip_unavailable_shards = 0/);
    expect(statements[0]!.query).not.toContain(id);
    const values: Array<unknown> = Object.values(statements[0]!.query_params);
    expect(values).toContain(PROJECT_ID.toString());
    expect(values).toContain("Google");
    expect(values).toContain("Google SecOps");
    expect(values).toContain("SecurityEventItemV1Local");
    expect(values).toContainEqual([id]);
  });

  test("chunks the UID lookup so large backfills cannot build unbounded query parameters", async (): Promise<void> => {
    const queries: Array<Statement> = [];
    getJestSpyOn(SecurityEventService, "executeQuery").mockImplementation(
      async (statement: Statement) => {
        queries.push(statement);
        return {
          json: async () => {
            return { data: [] };
          },
        };
      },
    );
    const ids: Array<string> = Array.from(
      { length: 2501 },
      (_value: unknown, index: number): string => {
        return `id-${index}`;
      },
    );
    await GoogleSecOpsPoller.findExistingEventUids(PROJECT_ID, ids);
    expect(queries).toHaveLength(3);
    expect(
      queries.map((statement: Statement): number => {
        return (
          Object.values(statement.query_params).find(
            Array.isArray,
          ) as Array<string>
        ).length;
      }),
    ).toEqual([1000, 1000, 501]);
  });

  test("an unavailable replica rejects the lookup", async (): Promise<void> => {
    getJestSpyOn(SecurityEventService, "executeQuery").mockRejectedValue(
      new Error("Replica unavailable"),
    );
    await expect(
      GoogleSecOpsPoller.findExistingEventUids(PROJECT_ID, ["a"]),
    ).rejects.toThrow("Replica unavailable");
  });
});
