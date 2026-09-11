import SecurityEventConnection from "../../../../../Models/DatabaseModels/SecurityEventConnection";
import Semaphore, {
  SemaphoreLockTimeoutError,
} from "../../../../../Server/Infrastructure/Semaphore";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../../Server/Services/OpenTelemetryIngestService";
import SecurityEventConnectionService from "../../../../../Server/Services/SecurityEventConnectionService";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import SecurityEventConnectionPoller, {
  SECURITY_EVENT_CONNECTION_LOCK_NAMESPACE,
  SECURITY_EVENT_CONNECTION_POLL_CONCURRENCY,
  SECURITY_EVENT_CONNECTION_POLL_DEADLINE_MS,
  SECURITY_EVENT_CONNECTION_SWEEP_LOCK_NAMESPACE,
  SECURITY_EVENT_CONNECTION_SWEEP_START_BUDGET_MS,
} from "../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionPoller";
import LIMIT_MAX from "../../../../../Types/Database/LimitMax";
import {
  SecurityEventConnectorClient,
  SecurityEventConnectorFetchResult,
} from "../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import ThreatIntelEnricher from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import SecurityEventConnectorResult from "../../../../../Types/SecurityEvent/SecurityEventConnectorResult";
import SecurityEventConnectorType from "../../../../../Types/SecurityEvent/SecurityEventConnectorType";
import ServiceType from "../../../../../Types/Telemetry/ServiceType";
import { getJestSpyOn } from "../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const NOW: Date = new Date("2026-09-11T12:00:00.000Z");

type FetchInput = Parameters<SecurityEventConnectorClient["fetchEvents"]>[0];

interface ClientResult {
  client: SecurityEventConnectorClient;
  calls: Array<FetchInput>;
}

function connection(
  id: string = CONNECTION_ID.toString(),
): SecurityEventConnection {
  const item: SecurityEventConnection = new SecurityEventConnection();
  item._id = id;
  item.projectId = PROJECT_ID;
  item.name = "Production Security Hub";
  item.provider = SecurityEventConnectorType.AwsSecurityHub;
  item.configuration = { region: "us-east-1" };
  item.credentialJson = JSON.stringify({
    accessKeyId: "AKIATEST",
    secretAccessKey: "test-secret",
  });
  item.sourceGeneration = 1;
  item.pollIntervalInMinutes = 5;
  item.isEnabled = true;
  item.version = 7;
  return item;
}

function mockConnectionDetails(
  connections: Array<SecurityEventConnection>,
): void {
  const connectionsById: Map<string, SecurityEventConnection> = new Map(
    connections.map(
      (item: SecurityEventConnection): [string, SecurityEventConnection] => {
        return [item.id!.toString(), item];
      },
    ),
  );
  getJestSpyOn(SecurityEventConnectionService, "findOneBy").mockImplementation(
    async (data: {
      query: { _id?: unknown };
    }): Promise<SecurityEventConnection | null> => {
      return connectionsById.get(String(data.query._id)) || null;
    },
  );
}

async function waitForCallCount(
  mock: { mock: { calls: Array<Array<unknown>> } },
  expected: number,
  remainingAttempts: number = 25,
): Promise<void> {
  if (mock.mock.calls.length >= expected) {
    return;
  }
  if (remainingAttempts === 0) {
    throw new Error(
      `Expected ${expected} calls but observed ${mock.mock.calls.length}.`,
    );
  }
  await Promise.resolve();
  await waitForCallCount(mock, expected, remainingAttempts - 1);
}

function finding(
  id: string = "finding-1",
  updatedAt: string = "2026-09-11T11:59:00Z",
): JSONObject {
  return {
    SchemaVersion: "2018-10-08",
    Id: id,
    ProductArn: "arn:aws:securityhub:us-east-1::product/aws/guardduty",
    GeneratorId: "guardduty-test",
    Title: "Suspicious network activity",
    UpdatedAt: updatedAt,
    Severity: { Label: "HIGH" },
  };
}

function metadata(): TelemetryServiceMetadata {
  return {
    serviceName: "AWS Security Hub",
    primaryEntityId: new ObjectID("33333333-3333-4333-8333-333333333333"),
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  };
}

function clientResult(
  overrides: Partial<SecurityEventConnectorFetchResult> = {},
): ClientResult {
  const calls: Array<FetchInput> = [];
  const client: SecurityEventConnectorClient = {
    fetchEvents: (
      window: FetchInput,
    ): Promise<SecurityEventConnectorFetchResult> => {
      calls.push(window);
      return Promise.resolve({
        events: [],
        complete: true,
        requestCount: 1,
        warnings: [],
        ...overrides,
      });
    },
  };
  return { client, calls };
}

function updateData(index: number = 0): JSONObject {
  const updateMock: jest.Mock =
    SecurityEventConnectionService.updatePollingCheckpointIfUnchanged as unknown as jest.Mock;
  return (updateMock.mock.calls[index]![0] as { checkpoint: JSONObject })
    .checkpoint;
}

function storedCursor(index: number = 0): Record<string, unknown> {
  return JSON.parse(String(updateData(index)["cursor"])) as Record<
    string,
    unknown
  >;
}

function insertedUid(index: number): string {
  const insertMock: jest.Mock =
    SecurityEventService.insertJsonRows as unknown as jest.Mock;
  const rows: Array<JSONObject> = insertMock.mock.calls[
    index
  ]![0] as Array<JSONObject>;
  return String(rows[0]?.["eventUid"] || "");
}

describe("SecurityEventConnectionPoller", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    getJestSpyOn(Semaphore, "lock").mockResolvedValue({});
    getJestSpyOn(Semaphore, "release").mockResolvedValue(undefined);
    getJestSpyOn(
      SecurityEventConnectionService,
      "updatePollingCheckpointIfUnchanged",
    ).mockResolvedValue(1 as never);
    getJestSpyOn(
      SecurityEventConnectionPoller,
      "findExistingEventUids",
    ).mockResolvedValue(new Set());
    getJestSpyOn(
      OTelIngestService,
      "telemetryServiceFromName",
    ).mockResolvedValue(metadata() as never);
    getJestSpyOn(
      ThreatIntelEnricher,
      "enrichNormalizedEvents",
    ).mockResolvedValue(undefined);
    getJestSpyOn(SecurityEventService, "insertJsonRows").mockResolvedValue(
      undefined,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("uses a 15-minute first window and advances the cursor after a complete poll", async () => {
    const { client, calls }: ClientResult = clientResult();

    const result: SecurityEventConnectorResult =
      await SecurityEventConnectionPoller.pollConnection(connection(), client);

    expect(calls).toEqual([
      expect.objectContaining({
        startTime: new Date("2026-09-11T11:45:00.000Z"),
        endTime: NOW,
      }),
    ]);
    expect(result.complete).toBe(true);
    expect(updateData()).toMatchObject({
      cursor: NOW.toISOString(),
      lastError: null,
      lastPolledAt: NOW,
      lastSuccessfulPollAt: NOW,
    });
  });

  test("overlaps a saved cursor by one minute and caps catch-up at 24 hours", async () => {
    const item: SecurityEventConnection = connection();
    item.cursor = "2026-09-01T00:00:00.000Z";
    const { client, calls }: ClientResult = clientResult();

    await SecurityEventConnectionPoller.pollConnection(item, client);

    expect(calls[0]).toEqual(
      expect.objectContaining({
        startTime: new Date("2026-08-31T23:59:00.000Z"),
        endTime: new Date("2026-09-01T23:59:00.000Z"),
      }),
    );
  });

  test("holds the poll window when a provider reports truncation", async () => {
    const { client }: ClientResult = clientResult({
      complete: false,
      warnings: ["provider page limit reached"],
    });

    const result: SecurityEventConnectorResult =
      await SecurityEventConnectionPoller.pollConnection(connection(), client);

    expect(result.complete).toBe(false);
    expect(storedCursor()).toMatchObject({
      nextStart: "2026-09-11T11:45:00.000Z",
      endTime: "2026-09-11T11:52:30.000Z",
      attempt: 1,
    });
    expect(String(updateData()["lastError"])).toContain(
      "provider page limit reached",
    );
    expect(updateData()["lastSuccessfulPollAt"]).toBeUndefined();
  });

  test("persists and resumes a provider continuation, then restores overlap", async () => {
    const first: ClientResult = clientResult({
      complete: false,
      continuation: { nextToken: "page-eleven" },
      warnings: ["more pages"],
    });
    await SecurityEventConnectionPoller.pollConnection(
      connection(),
      first.client,
    );
    expect(storedCursor()).toMatchObject({
      nextStart: "2026-09-11T11:45:00.000Z",
      endTime: NOW.toISOString(),
      continuation: { nextToken: "page-eleven" },
    });

    const resumed: SecurityEventConnection = connection();
    resumed.cursor = String(updateData()["cursor"]);
    const second: ClientResult = clientResult();
    await SecurityEventConnectionPoller.pollConnection(resumed, second.client);
    expect(second.calls[0]).toEqual(
      expect.objectContaining({
        startTime: new Date("2026-09-11T11:45:00.000Z"),
        endTime: NOW,
        continuation: { nextToken: "page-eleven" },
      }),
    );
    expect(updateData(1)["cursor"]).toBe(NOW.toISOString());

    const next: SecurityEventConnection = connection();
    next.cursor = String(updateData(1)["cursor"]);
    const third: ClientResult = clientResult();
    await SecurityEventConnectionPoller.pollConnection(next, third.client);
    expect(third.calls[0]?.startTime).toEqual(
      new Date("2026-09-11T11:59:00.000Z"),
    );
  });

  test("narrows a window when a continuation repeatedly stops advancing", async () => {
    const item: SecurityEventConnection = connection();
    item.cursor = JSON.stringify({
      version: 1,
      nextStart: "2026-09-11T11:45:00.000Z",
      endTime: NOW.toISOString(),
      attempt: 2,
      continuation: { nextToken: "stuck" },
    });
    const { client }: ClientResult = clientResult({
      complete: false,
      continuation: { nextToken: "stuck" },
    });

    const result: SecurityEventConnectorResult =
      await SecurityEventConnectionPoller.pollConnection(item, client);

    expect(result.warnings.join(" ")).toContain("stopped advancing");
    expect(storedCursor()).toEqual({
      version: 1,
      nextStart: "2026-09-11T11:45:00.000Z",
      endTime: "2026-09-11T11:52:30.000Z",
      attempt: 3,
    });
  });

  test("narrows a window after the total continuation budget even when tokens keep changing", async () => {
    const item: SecurityEventConnection = connection();
    item.cursor = JSON.stringify({
      version: 1,
      nextStart: "2026-09-11T11:45:00.000Z",
      endTime: NOW.toISOString(),
      continuationCount: 19,
      continuation: { nextToken: "token-a" },
    });
    const { client }: ClientResult = clientResult({
      complete: false,
      continuation: { nextToken: "token-b" },
    });

    const result: SecurityEventConnectorResult =
      await SecurityEventConnectionPoller.pollConnection(item, client);

    expect(result.warnings.join(" ")).toContain("bounded pagination budget");
    expect(storedCursor()).toEqual({
      version: 1,
      nextStart: "2026-09-11T11:45:00.000Z",
      endTime: "2026-09-11T11:52:30.000Z",
      attempt: 1,
    });
  });

  test("writes a gap marker and advances after an irreducible capped window", async () => {
    const item: SecurityEventConnection = connection();
    item.cursor = JSON.stringify({
      version: 1,
      nextStart: "2026-09-11T11:59:59.000Z",
      endTime: NOW.toISOString(),
      attempt: 20,
    });
    const { client }: ClientResult = clientResult({
      complete: false,
      warnings: ["still capped"],
    });

    const result: SecurityEventConnectorResult =
      await SecurityEventConnectionPoller.pollConnection(item, client);

    expect(result).toMatchObject({
      markerCount: 1,
      ingestedCount: 1,
      dataLossPossible: true,
      cursorAdvanced: true,
    });
    expect(storedCursor()).toEqual({
      version: 1,
      nextStart: NOW.toISOString(),
    });
  });

  test("narrows oversized provider responses instead of retrying forever", async () => {
    const client: SecurityEventConnectorClient = {
      fetchEvents: (): Promise<SecurityEventConnectorFetchResult> => {
        return Promise.reject(
          new Error("maxContentLength size of 20971520 exceeded"),
        );
      },
    };

    const result: SecurityEventConnectorResult =
      await SecurityEventConnectionPoller.pollConnection(connection(), client);

    expect(result).toMatchObject({ complete: false, retryScheduled: true });
    expect(result.error).toBeUndefined();
    expect(result.warnings.join(" ")).toContain("transport size");
    expect(storedCursor()["endTime"]).toBe("2026-09-11T11:52:30.000Z");
  });

  test("clears a failed page token and narrows the window after bounded retries", async () => {
    const item: SecurityEventConnection = connection();
    item.cursor = JSON.stringify({
      version: 1,
      nextStart: "2026-09-11T11:45:00.000Z",
      endTime: NOW.toISOString(),
      attempt: 2,
      continuation: { nextToken: "expired" },
    });
    const client: SecurityEventConnectorClient = {
      fetchEvents: (): Promise<SecurityEventConnectorFetchResult> => {
        return Promise.reject(new Error("saved page token expired"));
      },
    };

    await expect(
      SecurityEventConnectionPoller.pollConnection(item, client),
    ).rejects.toThrow("saved page token expired");

    expect(storedCursor()).toEqual({
      version: 1,
      nextStart: "2026-09-11T11:45:00.000Z",
      endTime: "2026-09-11T11:52:30.000Z",
    });
    expect(String(updateData()["lastError"])).toContain(
      "saved page token expired",
    );
  });

  test("writes a durable audit marker for a mismatched payload and advances", async () => {
    const { client }: ClientResult = clientResult({
      events: [{ unrelated: true }],
    });

    const result: SecurityEventConnectorResult =
      await SecurityEventConnectionPoller.pollConnection(connection(), client);

    expect(result).toMatchObject({
      fetchedCount: 1,
      rejectedCount: 1,
      markerCount: 1,
      ingestedCount: 1,
      complete: false,
      cursorAdvanced: true,
    });
    expect(SecurityEventService.insertJsonRows).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ classUid: 0 })]),
      expect.anything(),
    );
    expect(updateData()["cursor"]).toBe(NOW.toISOString());
    expect(String(updateData()["lastError"])).toContain("did not match");
  });

  test("does not count an audit marker when its durable insert fails", async () => {
    getJestSpyOn(SecurityEventService, "insertJsonRows").mockRejectedValueOnce(
      new Error("ClickHouse unavailable"),
    );

    await expect(
      SecurityEventConnectionPoller.pollConnection(
        connection(),
        clientResult({ events: [{ unrelated: true }] }).client,
      ),
    ).rejects.toThrow("ClickHouse unavailable");

    expect(updateData()["lastPollResult"]).toMatchObject({
      markerCount: 0,
      ingestedCount: 0,
      complete: false,
    });
  });

  test("normalizes, enriches, deduplicates, and synchronously inserts fresh events", async () => {
    const findMock: jest.Mock =
      SecurityEventConnectionPoller.findExistingEventUids as unknown as jest.Mock;
    findMock.mockImplementation(
      (_projectId: ObjectID, ids: Array<string>): Promise<Set<string>> => {
        return Promise.resolve(new Set(ids[1] ? [ids[1]] : []));
      },
    );
    const { client }: ClientResult = clientResult({
      events: [finding(), finding(), finding("already-stored")],
    });

    const result: SecurityEventConnectorResult =
      await SecurityEventConnectionPoller.pollConnection(connection(), client);

    expect(result).toMatchObject({
      fetchedCount: 3,
      duplicateCount: 2,
      ingestedCount: 1,
      complete: true,
    });
    expect(ThreatIntelEnricher.enrichNormalizedEvents).toHaveBeenCalledTimes(1);
    expect(SecurityEventService.insertJsonRows).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          eventUid: expect.stringMatching(/^[a-f0-9]{64}$/),
          classUid: 2004,
        }),
      ]),
      { clickhouseSettings: { async_insert: 0, insert_distributed_sync: 1 } },
    );
    expect(updateData()).toMatchObject({ lastEventIngestedAt: NOW });
  });

  test("namespaces IDs by connection, source generation, and revision", async () => {
    await SecurityEventConnectionPoller.pollConnection(
      connection(),
      clientResult({ events: [finding()] }).client,
    );
    await SecurityEventConnectionPoller.pollConnection(
      connection("44444444-4444-4444-8444-444444444444"),
      clientResult({ events: [finding()] }).client,
    );
    await SecurityEventConnectionPoller.pollConnection(
      connection(),
      clientResult({
        events: [finding("finding-1", "2026-09-11T12:00:00Z")],
      }).client,
    );
    const repointed: SecurityEventConnection = connection();
    repointed.sourceGeneration = 2;
    await SecurityEventConnectionPoller.pollConnection(
      repointed,
      clientResult({ events: [finding()] }).client,
    );

    expect(insertedUid(0)).toMatch(/^[a-f0-9]{64}$/);
    expect(insertedUid(1)).not.toBe(insertedUid(0));
    expect(insertedUid(2)).not.toBe(insertedUid(0));
    expect(insertedUid(3)).not.toBe(insertedUid(0));
  });

  test("uses payload content as the revision when a source timestamp is absent", async () => {
    const payload: JSONObject = finding();
    delete payload["UpdatedAt"];
    await SecurityEventConnectionPoller.pollConnection(
      connection(),
      clientResult({ events: [payload] }).client,
    );
    jest.setSystemTime(new Date(NOW.getTime() + 60_000));
    await SecurityEventConnectionPoller.pollConnection(
      connection(),
      clientResult({ events: [payload] }).client,
    );
    await SecurityEventConnectionPoller.pollConnection(
      connection(),
      clientResult({
        events: [{ ...payload, Title: "Changed finding" }],
      }).client,
    );

    expect(insertedUid(1)).toBe(insertedUid(0));
    expect(insertedUid(2)).not.toBe(insertedUid(0));
  });

  test("uses payload content when a source timestamp does not change", async () => {
    const payload: JSONObject = finding();
    await SecurityEventConnectionPoller.pollConnection(
      connection(),
      clientResult({ events: [payload] }).client,
    );
    await SecurityEventConnectionPoller.pollConnection(
      connection(),
      clientResult({
        events: [
          { ...payload, Title: "Changed at the same provider revision" },
        ],
      }).client,
    );

    expect(insertedUid(1)).not.toBe(insertedUid(0));
  });

  test("persists a redacted failure and always releases the connection lock", async () => {
    const client: SecurityEventConnectorClient = {
      fetchEvents: (): Promise<SecurityEventConnectorFetchResult> => {
        return Promise.reject(new Error("Bearer secret-token was rejected"));
      },
    };

    await expect(
      SecurityEventConnectionPoller.pollConnection(connection(), client),
    ).rejects.toThrow();

    expect(updateData()).toMatchObject({
      lastPolledAt: NOW,
    });
    expect(updateData()["lastError"]).toBeTruthy();
    expect(String(updateData()["lastError"])).not.toContain("secret-token");
    expect(Semaphore.lock).toHaveBeenCalledWith({
      namespace: SECURITY_EVENT_CONNECTION_LOCK_NAMESPACE,
      key: CONNECTION_ID.toString(),
      lockTimeout: 15 * 60 * 1000,
      acquireTimeout: 10_000,
      retryInterval: 100,
    });
    expect(Semaphore.release).toHaveBeenCalledTimes(1);
  });

  test("preserves the continuation budget across provider failures", async () => {
    const item: SecurityEventConnection = connection();
    item.cursor = JSON.stringify({
      version: 1,
      nextStart: "2026-09-11T11:45:00.000Z",
      endTime: NOW.toISOString(),
      attempt: 0,
      continuationCount: 19,
      continuation: { nextToken: "page-nineteen" },
    });
    const client: SecurityEventConnectorClient = {
      fetchEvents: (): Promise<SecurityEventConnectorFetchResult> => {
        return Promise.reject(new Error("provider temporarily unavailable"));
      },
    };

    await expect(
      SecurityEventConnectionPoller.pollConnection(item, client),
    ).rejects.toThrow("provider temporarily unavailable");

    expect(storedCursor()).toEqual({
      version: 1,
      nextStart: "2026-09-11T11:45:00.000Z",
      endTime: NOW.toISOString(),
      attempt: 1,
      continuationCount: 19,
      continuation: { nextToken: "page-nineteen" },
    });
  });

  test("aborts a provider request at the per-connection deadline", async () => {
    let observedSignal: AbortSignal | undefined;
    let rejectFetch: ((error: Error) => void) | undefined;
    let releaseFence: (() => void) | undefined;
    const released: Promise<void> = new Promise((resolve: () => void): void => {
      releaseFence = resolve;
    });
    getJestSpyOn(Semaphore, "release").mockImplementation(
      async (): Promise<void> => {
        releaseFence?.();
      },
    );
    const client: SecurityEventConnectorClient = {
      fetchEvents: ({
        signal,
      }: FetchInput): Promise<SecurityEventConnectorFetchResult> => {
        observedSignal = signal;
        return new Promise(
          (
            _resolve: (value: SecurityEventConnectorFetchResult) => void,
            reject: (error: Error) => void,
          ): void => {
            rejectFetch = reject;
          },
        );
      },
    };

    const pending: Promise<SecurityEventConnectorResult> =
      SecurityEventConnectionPoller.pollConnection(connection(), client);
    const assertion: Promise<void> = expect(pending).rejects.toThrow(
      "8-minute polling deadline",
    );
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(SECURITY_EVENT_CONNECTION_POLL_DEADLINE_MS);
    await Promise.resolve();
    await assertion;

    expect(observedSignal?.aborted).toBe(true);
    expect(String(updateData()["lastError"])).toContain(
      "8-minute polling deadline",
    );
    expect(Semaphore.release).not.toHaveBeenCalled();

    rejectFetch?.(new Error("provider stopped after the abort"));
    await released;
    expect(Semaphore.release).toHaveBeenCalledTimes(1);
  });

  test.each([
    JSON.stringify({ version: 2, nextStart: "2026-09-01T00:00:00.000Z" }),
    "2026-09-12T00:00:00.000Z",
    "not-a-cursor",
  ])("holds and reports an invalid cursor: %s", async (cursor: string) => {
    const item: SecurityEventConnection = connection();
    item.cursor = cursor;
    const { client, calls }: ClientResult = clientResult();

    await expect(
      SecurityEventConnectionPoller.pollConnection(item, client),
    ).rejects.toThrow("invalid or future polling cursor");

    expect(calls).toHaveLength(0);
    expect(updateData()["cursor"]).toBeUndefined();
    expect(String(updateData()["lastError"])).toContain(
      "invalid or future polling cursor",
    );
  });

  test("persists invalid provider settings so a bad row does not monopolize due batches", async () => {
    const item: SecurityEventConnection = connection();
    item.configuration = { region: "invalid-region" };
    const { client, calls }: ClientResult = clientResult();

    await expect(
      SecurityEventConnectionPoller.pollConnection(item, client),
    ).rejects.toThrow("AWS region is not valid");

    expect(calls).toHaveLength(0);
    expect(updateData()).toMatchObject({ lastPolledAt: NOW });
    expect(String(updateData()["lastError"])).toContain(
      "AWS region is not valid",
    );
  });

  test("does not overwrite a reset when connection settings change mid-poll", async () => {
    const updateMock: jest.Mock =
      SecurityEventConnectionService.updatePollingCheckpointIfUnchanged as unknown as jest.Mock;
    updateMock.mockResolvedValueOnce(0);

    const result: SecurityEventConnectorResult =
      await SecurityEventConnectionPoller.pollConnection(
        connection(),
        clientResult({ events: [finding()] }).client,
      );

    expect(result).toMatchObject({ complete: false, cursorAdvanced: false });
    expect(result.warnings.join(" ")).toContain("settings changed");
    expect(updateMock).toHaveBeenCalledWith({
      id: CONNECTION_ID,
      expectedVersion: 7,
      checkpoint: expect.any(Object),
    });
  });

  test("deduplicates an inserted event when checkpoint storage is replayed", async () => {
    let stored: boolean = false;
    const findMock: jest.Mock =
      SecurityEventConnectionPoller.findExistingEventUids as unknown as jest.Mock;
    findMock.mockImplementation(
      (_projectId: ObjectID, ids: Array<string>): Promise<Set<string>> => {
        return Promise.resolve(stored ? new Set(ids) : new Set());
      },
    );
    const updateMock: jest.Mock =
      SecurityEventConnectionService.updatePollingCheckpointIfUnchanged as unknown as jest.Mock;
    updateMock.mockRejectedValueOnce(new Error("checkpoint unavailable"));
    const client: SecurityEventConnectorClient = clientResult({
      events: [finding()],
    }).client;

    await expect(
      SecurityEventConnectionPoller.pollConnection(connection(), client),
    ).rejects.toThrow("checkpoint unavailable");
    stored = true;
    const replay: SecurityEventConnectorResult =
      await SecurityEventConnectionPoller.pollConnection(connection(), client);

    expect(replay).toMatchObject({ duplicateCount: 1, ingestedCount: 0 });
    expect(SecurityEventService.insertJsonRows).toHaveBeenCalledTimes(1);
  });

  test("uses a secret-free scheduling query and polls only due connections", async () => {
    const due: SecurityEventConnection = connection();
    const notDue: SecurityEventConnection = connection();
    notDue._id = "44444444-4444-4444-8444-444444444444";
    notDue.lastPolledAt = new Date("2026-09-11T11:58:00.000Z");
    const findBy: jest.SpyInstance = getJestSpyOn(
      SecurityEventConnectionService,
      "findBy",
    ).mockResolvedValue([due, notDue] as never);
    const findOneBy: jest.SpyInstance = getJestSpyOn(
      SecurityEventConnectionService,
      "findOneBy",
    ).mockResolvedValue(due as never);
    const pollSpy: jest.SpyInstance = getJestSpyOn(
      SecurityEventConnectionPoller,
      "pollConnection",
    ).mockResolvedValue({} as never);

    await SecurityEventConnectionPoller.pollAllDueConnections();

    expect(findBy).toHaveBeenCalledWith({
      query: { isEnabled: true },
      select: {
        _id: true,
        pollIntervalInMinutes: true,
        lastPolledAt: true,
        createdAt: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });
    expect(findBy.mock.calls[0]![0].select).not.toHaveProperty(
      "credentialJson",
    );
    expect(findBy.mock.calls[0]![0].select).not.toHaveProperty("cursor");
    expect(findBy.mock.calls[0]![0].select).not.toHaveProperty("configuration");
    expect(findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { _id: due.id!.toString(), isEnabled: true },
        select: expect.objectContaining({
          credentialJson: true,
          cursor: true,
          configuration: true,
        }),
      }),
    );
    expect(pollSpy).toHaveBeenCalledTimes(1);
    expect(pollSpy).toHaveBeenCalledWith(
      due,
      undefined,
      NOW.getTime() + SECURITY_EVENT_CONNECTION_SWEEP_START_BUDGET_MS,
    );
  });

  test("isolates detail-load failures so another due connection still polls", async () => {
    const broken: SecurityEventConnection = connection(
      "00000000-0000-4000-8000-000000000000",
    );
    const healthy: SecurityEventConnection = connection(
      "00000000-0000-4000-8000-000000000001",
    );
    getJestSpyOn(SecurityEventConnectionService, "findBy").mockResolvedValue([
      broken,
      healthy,
    ] as never);
    getJestSpyOn(
      SecurityEventConnectionService,
      "findOneBy",
    ).mockImplementation(
      async (data: {
        query: { _id?: unknown };
      }): Promise<SecurityEventConnection | null> => {
        if (String(data.query._id) === broken.id!.toString()) {
          throw new Error("credential decrypt failed");
        }
        return healthy;
      },
    );
    const pollSpy: jest.SpyInstance = getJestSpyOn(
      SecurityEventConnectionPoller,
      "pollConnection",
    ).mockResolvedValue({} as never);

    await expect(
      SecurityEventConnectionPoller.pollAllDueConnections(),
    ).resolves.toBeUndefined();

    expect(pollSpy).toHaveBeenCalledTimes(1);
    expect(pollSpy).toHaveBeenCalledWith(
      healthy,
      undefined,
      NOW.getTime() + SECURITY_EVENT_CONNECTION_SWEEP_START_BUDGET_MS,
    );
  });

  test("skips connections disabled or no longer due after detail reload", async () => {
    const disabledSummary: SecurityEventConnection = connection(
      "00000000-0000-4000-8000-000000000000",
    );
    const recentlyPolledSummary: SecurityEventConnection = connection(
      "00000000-0000-4000-8000-000000000001",
    );
    const disabled: SecurityEventConnection = connection(
      disabledSummary.id!.toString(),
    );
    disabled.isEnabled = false;
    const recentlyPolled: SecurityEventConnection = connection(
      recentlyPolledSummary.id!.toString(),
    );
    recentlyPolled.lastPolledAt = NOW;
    getJestSpyOn(SecurityEventConnectionService, "findBy").mockResolvedValue([
      disabledSummary,
      recentlyPolledSummary,
    ] as never);
    mockConnectionDetails([disabled, recentlyPolled]);
    const pollSpy: jest.SpyInstance = getJestSpyOn(
      SecurityEventConnectionPoller,
      "pollConnection",
    ).mockResolvedValue({} as never);

    await SecurityEventConnectionPoller.pollAllDueConnections();

    expect(SecurityEventConnectionService.findOneBy).toHaveBeenCalledTimes(2);
    (
      SecurityEventConnectionService.findOneBy as unknown as jest.Mock
    ).mock.calls.forEach(
      (call: Array<{ query: { isEnabled: boolean } }>): void => {
        expect(call[0]!.query.isEnabled).toBe(true);
      },
    );
    expect(pollSpy).not.toHaveBeenCalled();
  });

  test("drains more than one batch while bounding active polls", async () => {
    const due: Array<SecurityEventConnection> = Array.from(
      { length: SECURITY_EVENT_CONNECTION_POLL_CONCURRENCY + 3 },
      (_value: unknown, index: number): SecurityEventConnection => {
        return connection(
          `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        );
      },
    );
    getJestSpyOn(SecurityEventConnectionService, "findBy").mockResolvedValue(
      due as never,
    );
    mockConnectionDetails(due);
    let release: (() => void) | undefined;
    const gate: Promise<void> = new Promise((resolve: () => void): void => {
      release = resolve;
    });
    let active: number = 0;
    let maximumActive: number = 0;
    const pollSpy: jest.SpyInstance = getJestSpyOn(
      SecurityEventConnectionPoller,
      "pollConnection",
    ).mockImplementation(async (): Promise<SecurityEventConnectorResult> => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await gate;
      active--;
      return {} as SecurityEventConnectorResult;
    });

    const sweep: Promise<void> =
      SecurityEventConnectionPoller.pollAllDueConnections();
    try {
      await waitForCallCount(
        pollSpy,
        SECURITY_EVENT_CONNECTION_POLL_CONCURRENCY,
      );
      expect(active).toBe(SECURITY_EVENT_CONNECTION_POLL_CONCURRENCY);
    } finally {
      release?.();
      await sweep;
    }
    expect(maximumActive).toBe(SECURITY_EVENT_CONNECTION_POLL_CONCURRENCY);
    expect(pollSpy).toHaveBeenCalledTimes(due.length);
  });

  test("does not start another connection after the sweep start budget", async () => {
    const due: Array<SecurityEventConnection> = Array.from(
      { length: SECURITY_EVENT_CONNECTION_POLL_CONCURRENCY + 1 },
      (_value: unknown, index: number): SecurityEventConnection => {
        return connection(
          `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        );
      },
    );
    getJestSpyOn(SecurityEventConnectionService, "findBy").mockResolvedValue(
      due as never,
    );
    const findOneBy: jest.SpyInstance = getJestSpyOn(
      SecurityEventConnectionService,
      "findOneBy",
    ).mockImplementation(
      async (data: {
        query: { _id?: unknown };
      }): Promise<SecurityEventConnection | null> => {
        return (
          due.find((item: SecurityEventConnection): boolean => {
            return item.id!.toString() === String(data.query._id);
          }) || null
        );
      },
    );
    let release: (() => void) | undefined;
    const gate: Promise<void> = new Promise((resolve: () => void): void => {
      release = resolve;
    });
    const pollSpy: jest.SpyInstance = getJestSpyOn(
      SecurityEventConnectionPoller,
      "pollConnection",
    ).mockImplementation(async (): Promise<SecurityEventConnectorResult> => {
      await gate;
      return {} as SecurityEventConnectorResult;
    });

    const sweep: Promise<void> =
      SecurityEventConnectionPoller.pollAllDueConnections();
    try {
      await waitForCallCount(
        pollSpy,
        SECURITY_EVENT_CONNECTION_POLL_CONCURRENCY,
      );
      jest.setSystemTime(
        new Date(
          NOW.getTime() + SECURITY_EVENT_CONNECTION_SWEEP_START_BUDGET_MS,
        ),
      );
    } finally {
      release?.();
      await sweep;
    }

    expect(pollSpy).toHaveBeenCalledTimes(
      SECURITY_EVENT_CONNECTION_POLL_CONCURRENCY,
    );
    expect(findOneBy).toHaveBeenCalledTimes(
      SECURITY_EVENT_CONNECTION_POLL_CONCURRENCY,
    );
  });

  test("rechecks the start budget after acquiring the connection lock", async () => {
    const startBefore: number =
      NOW.getTime() + SECURITY_EVENT_CONNECTION_SWEEP_START_BUDGET_MS;
    const { client, calls }: ClientResult = clientResult();
    const lockMock: jest.Mock = Semaphore.lock as unknown as jest.Mock;
    lockMock.mockImplementation(
      async (data: { namespace: string }): Promise<JSONObject> => {
        expect(data.namespace).toBe(SECURITY_EVENT_CONNECTION_LOCK_NAMESPACE);
        jest.setSystemTime(new Date(startBefore));
        return {};
      },
    );

    await expect(
      SecurityEventConnectionPoller.pollConnection(
        connection(),
        client,
        startBefore,
      ),
    ).rejects.toThrow("sweep start budget was exceeded");

    expect(calls).toHaveLength(0);
    expect(Semaphore.release).toHaveBeenCalledTimes(1);
  });

  test("skips an overlapping scheduler sweep instead of selecting the same busy rows", async () => {
    const due: Array<SecurityEventConnection> = Array.from(
      { length: SECURITY_EVENT_CONNECTION_POLL_CONCURRENCY + 2 },
      (_value: unknown, index: number): SecurityEventConnection => {
        return connection(
          `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        );
      },
    );
    getJestSpyOn(SecurityEventConnectionService, "findBy").mockResolvedValue(
      due as never,
    );
    mockConnectionDetails(due);
    let releasePolls: (() => void) | undefined;
    const pollGate: Promise<void> = new Promise((resolve: () => void): void => {
      releasePolls = resolve;
    });
    const pollSpy: jest.SpyInstance = getJestSpyOn(
      SecurityEventConnectionPoller,
      "pollConnection",
    ).mockImplementation(async (): Promise<SecurityEventConnectorResult> => {
      await pollGate;
      return {} as SecurityEventConnectorResult;
    });
    const lockMock: jest.Mock = Semaphore.lock as unknown as jest.Mock;
    let sweepClaims: number = 0;
    lockMock.mockImplementation(
      (data: { namespace: string }): Promise<JSONObject> => {
        if (data.namespace === SECURITY_EVENT_CONNECTION_SWEEP_LOCK_NAMESPACE) {
          sweepClaims++;
          if (sweepClaims > 1) {
            return Promise.reject(
              new SemaphoreLockTimeoutError("sweep already running"),
            );
          }
        }
        return Promise.resolve({});
      },
    );

    const firstSweep: Promise<void> =
      SecurityEventConnectionPoller.pollAllDueConnections();
    try {
      await waitForCallCount(
        pollSpy,
        SECURITY_EVENT_CONNECTION_POLL_CONCURRENCY,
      );
      await SecurityEventConnectionPoller.pollAllDueConnections();
      expect(pollSpy).toHaveBeenCalledTimes(
        SECURITY_EVENT_CONNECTION_POLL_CONCURRENCY,
      );
    } finally {
      releasePolls?.();
      await firstSweep;
    }
    expect(pollSpy).toHaveBeenCalledTimes(due.length);
  });

  test("reports sweep lock backend failures", async () => {
    const lockError: Error = new Error("Redis connection closed");
    const findBy: jest.SpyInstance = getJestSpyOn(
      SecurityEventConnectionService,
      "findBy",
    ).mockResolvedValue([] as never);
    getJestSpyOn(Semaphore, "lock").mockRejectedValueOnce(lockError);

    await expect(
      SecurityEventConnectionPoller.pollAllDueConnections(),
    ).rejects.toBe(lockError);
    expect(findBy).not.toHaveBeenCalled();
  });

  test("pages past the service limit so tail connections remain eligible", async () => {
    const notDue: SecurityEventConnection = connection();
    notDue.lastPolledAt = NOW;
    const due: SecurityEventConnection = connection(
      "99999999-9999-4999-8999-999999999999",
    );
    const findMock: jest.SpyInstance = getJestSpyOn(
      SecurityEventConnectionService,
      "findBy",
    );
    findMock
      .mockResolvedValueOnce(Array(LIMIT_MAX).fill(notDue) as never)
      .mockResolvedValueOnce([due] as never);
    mockConnectionDetails([due]);
    const pollSpy: jest.SpyInstance = getJestSpyOn(
      SecurityEventConnectionPoller,
      "pollConnection",
    ).mockResolvedValue({} as never);

    await SecurityEventConnectionPoller.pollAllDueConnections();

    expect(findMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ skip: LIMIT_MAX }),
    );
    expect(pollSpy).toHaveBeenCalledWith(
      due,
      undefined,
      NOW.getTime() + SECURITY_EVENT_CONNECTION_SWEEP_START_BUDGET_MS,
    );
  });

  test("prioritizes the earliest due time over newly created rows", async () => {
    const overdue: Array<SecurityEventConnection> = Array.from(
      { length: SECURITY_EVENT_CONNECTION_POLL_CONCURRENCY },
      (_value: unknown, index: number): SecurityEventConnection => {
        const item: SecurityEventConnection = connection(
          `99999999-9999-4999-8999-${String(index).padStart(12, "0")}`,
        );
        item.lastPolledAt = new Date("2026-09-11T11:00:00.000Z");
        return item;
      },
    );
    const newRows: Array<SecurityEventConnection> = Array.from(
      { length: SECURITY_EVENT_CONNECTION_POLL_CONCURRENCY },
      (_value: unknown, index: number): SecurityEventConnection => {
        const item: SecurityEventConnection = connection(
          `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        );
        item.createdAt = new Date("2026-09-11T11:59:00.000Z");
        return item;
      },
    );
    getJestSpyOn(SecurityEventConnectionService, "findBy").mockResolvedValue([
      ...newRows,
      ...overdue,
    ] as never);
    mockConnectionDetails([...newRows, ...overdue]);
    let releasePolls: (() => void) | undefined;
    const pollGate: Promise<void> = new Promise((resolve: () => void): void => {
      releasePolls = resolve;
    });
    const pollSpy: jest.SpyInstance = getJestSpyOn(
      SecurityEventConnectionPoller,
      "pollConnection",
    ).mockImplementation(async (): Promise<SecurityEventConnectorResult> => {
      await pollGate;
      return {} as SecurityEventConnectorResult;
    });

    const sweep: Promise<void> =
      SecurityEventConnectionPoller.pollAllDueConnections();
    try {
      await waitForCallCount(
        pollSpy,
        SECURITY_EVENT_CONNECTION_POLL_CONCURRENCY,
      );
      expect(
        pollSpy.mock.calls.map(
          (call: Array<SecurityEventConnection>): SecurityEventConnection => {
            return call[0]!;
          },
        ),
      ).toEqual(overdue);
    } finally {
      releasePolls?.();
      await sweep;
    }
    expect(pollSpy).toHaveBeenCalledTimes(overdue.length + newRows.length);
  });

  test("drains every never-polled row in one sweep", async () => {
    const due: Array<SecurityEventConnection> = Array.from(
      { length: SECURITY_EVENT_CONNECTION_POLL_CONCURRENCY + 3 },
      (_value: unknown, index: number): SecurityEventConnection => {
        return connection(
          `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        );
      },
    );
    getJestSpyOn(SecurityEventConnectionService, "findBy").mockResolvedValue(
      due as never,
    );
    mockConnectionDetails(due);
    const polled: Array<string> = [];
    getJestSpyOn(
      SecurityEventConnectionPoller,
      "pollConnection",
    ).mockImplementation(
      async (
        item: SecurityEventConnection,
      ): Promise<SecurityEventConnectorResult> => {
        polled.push(item.id!.toString());
        item.lastPolledAt = NOW;
        return {} as SecurityEventConnectorResult;
      },
    );

    await SecurityEventConnectionPoller.pollAllDueConnections();

    expect(new Set(polled)).toEqual(
      new Set(
        due.map((item: SecurityEventConnection): string => {
          return item.id!.toString();
        }),
      ),
    );
    expect(polled).toHaveLength(due.length);
  });
});
