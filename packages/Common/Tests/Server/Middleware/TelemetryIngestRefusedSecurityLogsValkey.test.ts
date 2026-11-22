import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Redis, { ClientType } from "../../../Server/Infrastructure/Redis";
import TelemetryIngest from "../../../Server/Middleware/TelemetryIngest";
import TelemetryIngestionKeyService from "../../../Server/Services/TelemetryIngestionKeyService";
import TelemetryIngestionTeamLabelBudgetService from "../../../Server/Services/TelemetryIngestionTeamLabelBudgetService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import RefusedTelemetryReader from "../../../Server/Utils/SecurityEvent/RefusedTelemetryReader";
import TelemetryIngestRefusalRecorder from "../../../Server/Utils/Telemetry/TelemetryIngestRefusalRecorder";
import TelemetryIngestionBudgetSettings, {
  TelemetryIngestionBudgetInstanceSettings,
} from "../../../Server/Utils/Telemetry/TelemetryIngestionBudgetSettings";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../Types/ObjectID";
import {
  TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB,
  TELEMETRY_INGESTION_BUDGET_COLUMNS,
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetStoredSettings,
  getEmptyTelemetryIngestionBudgetStoredSettings,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestionKeyPolicy from "../../../Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import TelemetryIngestSurface from "../../../Types/Telemetry/TelemetryIngestSurface";
import {
  RefusedTelemetry,
  RefusedTelemetryKind,
  RefusedTelemetryRecord,
} from "../../../Utils/SecurityEvent/RefusedTelemetry";
import SecurityLogParser from "../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import { NO_TRUSTED_PROXIES } from "../../../Utils/SecurityEvent/ClientAddressTrust";

/*
 * WHAT HAPPENS TO A SECURITY-RELEVANT LOG LINE SENT AFTER THE PROJECT'S LOGS
 * BUDGET IS USED UP - through real ingest (#10431).
 *
 * The decision: a used-up budget refuses a security-relevant line like any
 * other. It is not kept, and not sampled, for Security Events. Instead
 * Security Events reads the budget's own counters and says what it could
 * not see - from when, whose budget, how much - and the way to keep
 * security logs flowing through a flood is the one ingest already has: an
 * ingestion key of their own, with the noisy sender's key given a budget of
 * its own, so the flood uses up that key's budget and not the project's.
 * Why not keep or sample them (the pull request says it in full):
 *
 *   - Telling a security record from any other means decoding the batch:
 *     the cost a refusal is there to avoid, at the moment a flood makes it
 *     largest, and a flood of attack-shaped lines would decode for free.
 *   - The flood is itself security-relevant (failed sign-ins, a scanner's
 *     requests): a reserve for such lines is used up by the same flood, and
 *     a sample breaks the counts the rules fire on (a brute force is N
 *     failures in M minutes).
 *   - The budget is an instance admin's: keeping part of what it refuses
 *     would overrule them without asking, against "fail toward a person".
 *
 * Nothing is mocked between the ingest middleware, the budget gate, its Lua
 * script and Valkey, nor between Security Events' reader, the budget status
 * reader and Valkey: only what Postgres would answer (the key's policy, the
 * budget settings, the keys and team budgets the status lists) is stood in
 * for. It needs Valkey or Redis, as the other *Valkey suites do: CI's
 * test-setup.sh starts one on localhost:6310 and `npm test` exports its
 * settings from config.env. Locally:
 *
 *   docker run -d --rm -p 16917:6379 valkey/valkey:9.1-alpine
 *   VALKEY_HOST=localhost VALKEY_PORT=16917 \
 *     npx jest Tests/Server/Middleware/TelemetryIngestRefusedSecurityLogsValkey.test.ts
 *
 * Every key it writes is of projects and keys made up for it, and deleted
 * afterwards.
 */

jest.setTimeout(60_000);

// What a brute force writes: an SSH sign-in that failed.
const FAILED_SIGN_IN: string =
  "Nov 20 14:05:01 web-03 sshd[4120]: Failed password for root from 203.0.113.7 port 52144 ssh2";
const ORDINARY_LINE: string = "GET /health 200 0.4ms";

const written: Array<string> = [];

// A made-up project, with its key, and the patterns of every key it writes.
const newProject: () => { projectId: ObjectID; keyId: ObjectID } = (): {
  projectId: ObjectID;
  keyId: ObjectID;
} => {
  const projectId: ObjectID = ObjectID.generate();
  const keyId: ObjectID = ObjectID.generate();

  written.push(`*${projectId.toString()}*`, `*${keyId.toString()}*`);

  return { projectId, keyId };
};

const policyOf: (data: {
  projectId: ObjectID;
  keyId: ObjectID;
  logsBudgetInGB?: number | undefined;
}) => TelemetryIngestionKeyPolicy = (data: {
  projectId: ObjectID;
  keyId: ObjectID;
  logsBudgetInGB?: number | undefined;
}): TelemetryIngestionKeyPolicy => {
  const budgets: TelemetryIngestionBudgetStoredSettings | null =
    data.logsBudgetInGB === undefined ? null : logsBudget(data.logsBudgetInGB);

  return {
    ingestionKeyId: data.keyId,
    projectId: data.projectId,
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
    ingestionBudgets: budgets,
  } as unknown as TelemetryIngestionKeyPolicy;
};

const logsBudget: (
  gigabytes: number,
) => TelemetryIngestionBudgetStoredSettings = (
  gigabytes: number,
): TelemetryIngestionBudgetStoredSettings => {
  const settings: TelemetryIngestionBudgetStoredSettings =
    getEmptyTelemetryIngestionBudgetStoredSettings();
  settings[ProductType.Logs] = {
    dailyBudgetInGB: gigabytes,
    rateLimitInMBPerSecond: null,
  };
  return settings;
};

// A number of bytes as a daily budget in GB.
const gigabytesOf: (bytes: number) => number = (bytes: number): number => {
  return bytes / TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB;
};

// An OTLP/HTTP JSON export of log lines, as a collector sends it.
const exportOf: (lines: Array<string>) => Buffer = (
  lines: Array<string>,
): Buffer => {
  return Buffer.from(
    JSON.stringify({
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "web" } },
            ],
          },
          scopeLogs: [
            {
              logRecords: lines.map((line: string) => {
                return {
                  timeUnixNano: "1763647501000000000",
                  body: { stringValue: line },
                };
              }),
            },
          ],
        },
      ],
    }),
  );
};

interface Sent {
  status: number | null;
  body: unknown;
  passedOn: boolean;
}

// One request through the real OTLP/HTTP logs ingest guard.
const send: (data: {
  token: string;
  body: Buffer;
}) => Promise<Sent> = async (data: {
  token: string;
  body: Buffer;
}): Promise<Sent> => {
  const sent: Sent = { status: null, body: undefined, passedOn: false };
  const req: ExpressRequest = {
    headers: {
      "x-oneuptime-token": data.token,
      "content-type": "application/json",
    },
    body: data.body,
    id: "refused-security-logs",
  } as unknown as ExpressRequest;
  const res: Record<string, unknown> = {
    headersSent: false,
    setHeader: (): void => {
      return undefined;
    },
    status: (code: number): Record<string, unknown> => {
      sent.status = code;
      return res;
    },
    send: (body: unknown): Record<string, unknown> => {
      sent.body = body;
      return res;
    },
    json: (body: unknown): Record<string, unknown> => {
      sent.body = body;
      return res;
    },
  };

  await TelemetryIngest.forSurface(TelemetryIngestSurface.OtelLogs)(
    req,
    res as unknown as ExpressResponse,
    ((err?: unknown): void => {
      sent.passedOn = err === undefined;
    }) as unknown as NextFunction,
  );

  return sent;
};

// The instance's defaults, and each project's overrides, as Postgres holds them.
let instanceBudgets: TelemetryIngestionBudgetStoredSettings;
const policies: Map<string, TelemetryIngestionKeyPolicy> = new Map();
// The project's keys with budgets of their own, as the status reader lists them.
let budgetedKeys: Array<TelemetryIngestionKey> = [];

beforeAll(async () => {
  await Redis.connect();
});

beforeEach(() => {
  RefusedTelemetryReader.clearCache();
  policies.clear();
  budgetedKeys = [];
  instanceBudgets = getEmptyTelemetryIngestionBudgetStoredSettings();

  const settings: () => TelemetryIngestionBudgetInstanceSettings =
    (): TelemetryIngestionBudgetInstanceSettings => {
      return {
        budgets: instanceBudgets,
        warningPercent: 80,
        resetTime: "00:00",
        timezone: "UTC",
      };
    };

  jest
    .spyOn(TelemetryIngestionBudgetSettings, "getInstanceSettings")
    .mockImplementation(async () => {
      return settings();
    });
  jest
    .spyOn(TelemetryIngestionBudgetSettings, "getProjectOverrides")
    .mockResolvedValue(null);
  jest
    .spyOn(TelemetryIngestionKeyService, "getPolicyFromSecretKey")
    .mockImplementation((async (token: string) => {
      return policies.get(token) || null;
    }) as never);
  jest
    .spyOn(TelemetryIngestionKeyService, "findBy")
    .mockImplementation((async () => {
      return budgetedKeys;
    }) as never);
  jest
    .spyOn(TelemetryIngestionTeamLabelBudgetService, "findBy")
    .mockResolvedValue([]);
  // Counted per key in Postgres (#6378): not what this suite is about.
  jest
    .spyOn(TelemetryIngestRefusalRecorder, "record")
    .mockImplementation((): void => {
      return undefined;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  const client: ClientType | null = Redis.getClient();

  if (client) {
    for (const pattern of written) {
      const keys: Array<string> = await client.keys(pattern);

      if (keys.length > 0) {
        await client.del(...keys);
      }
    }
  }

  await Redis.disconnect();
});

describe("a security-relevant line sent after the logs budget is used up, through real ingest", () => {
  test("the line is a security record Security Events would have read", () => {
    // So what follows is about a line that matters, not one it would skip.
    expect(
      SecurityLogParser.parse({
        trustedProxies: NO_TRUSTED_PROXIES,
        body: FAILED_SIGN_IN,
        attributes: {},
        time: new Date("2026-11-20T14:05:01.000Z"),
      }),
    ).toEqual([
      expect.objectContaining({
        className: "Authentication",
        statusName: "Failure",
        principalIp: "203.0.113.7",
      }),
    ]);
  });

  test("is refused like any other - not kept, not sampled - and Security Events says what it missed, from when and how much", async () => {
    const { projectId, keyId } = newProject();
    const token: string = ObjectID.generate().toString();

    policies.set(token, policyOf({ projectId, keyId }));

    // A budget the attack's first batch uses up.
    const firstBatch: Buffer = exportOf([ORDINARY_LINE, FAILED_SIGN_IN]);
    instanceBudgets = logsBudget(gigabytesOf(firstBatch.length));

    // Before the attack, Security Events reads the counters once: nothing refused.
    const before: RefusedTelemetryRecord = await RefusedTelemetryReader.observe(
      {
        projectId,
        signal: ProductType.Logs,
        lastScanResult: null,
        now: new Date(),
      },
    );
    expect(before.refusals).toEqual([]);

    // The batch that crosses the line is stored.
    expect(await send({ token, body: firstBatch })).toEqual(
      expect.objectContaining({ passedOn: true, status: null }),
    );

    // Every line after it - each a failed sign-in - is refused.
    const refusedBodies: Array<Buffer> = [];

    for (let attempt: number = 0; attempt < 20; attempt++) {
      const body: Buffer = exportOf([FAILED_SIGN_IN]);
      refusedBodies.push(body);

      const sent: Sent = await send({ token, body });

      // Not handed on: nothing is queued, stored or scanned of it.
      expect(sent.passedOn).toBe(false);
      expect(sent.status).toBe(403);
    }

    // The sender is told why, in the words the budget docs quote.
    const refused: Sent = await send({
      token,
      body: exportOf([FAILED_SIGN_IN]),
    });
    refusedBodies.push(exportOf([FAILED_SIGN_IN]));
    expect(JSON.stringify(refused.body)).toContain(
      "daily logs ingestion budget",
    );

    // Security Events reads the same counters, and says it.
    RefusedTelemetryReader.clearCache();
    const after: RefusedTelemetryRecord = await RefusedTelemetryReader.observe({
      projectId,
      signal: ProductType.Logs,
      lastScanResult: {
        refusedTelemetryObservation: before.observation as never,
      },
      now: new Date(),
    });

    expect(after.refusals).toHaveLength(1);

    const refusal: RefusedTelemetry = after.refusals[0]!;

    expect(refusal).toEqual(
      expect.objectContaining({
        signal: ProductType.Logs,
        kind: RefusedTelemetryKind.BudgetUsedUp,
        scope: TelemetryIngestionBudgetScope.Project,
        scopeId: projectId.toString(),
        to: null,
        refusedRequests: refusedBodies.length,
        refusedBytes: refusedBodies.reduce(
          (total: number, body: Buffer): number => {
            return total + body.length;
          },
          0,
        ),
      }),
    );
    // From the moment the budget's own counter stamped the first refusal.
    expect(Date.parse(refusal.from)).toBeGreaterThan(Date.now() - 60_000);
    expect(Date.parse(refusal.from)).toBeLessThanOrEqual(Date.now());
  });

  test("an ingestion key of their own keeps security logs flowing while the noisy sender's key is over its own budget", async () => {
    const { projectId, keyId: noisyKeyId } = newProject();
    const securityKeyId: ObjectID = ObjectID.generate();
    written.push(`*${securityKeyId.toString()}*`);

    const noisyToken: string = ObjectID.generate().toString();
    const securityToken: string = ObjectID.generate().toString();
    const flood: Buffer = exportOf(
      Array.from({ length: 20 }, (): string => {
        return FAILED_SIGN_IN;
      }),
    );

    // The project has room for a day; the noisy sender's key, for one batch.
    instanceBudgets = logsBudget(gigabytesOf(flood.length * 100));
    policies.set(
      noisyToken,
      policyOf({
        projectId,
        keyId: noisyKeyId,
        logsBudgetInGB: gigabytesOf(flood.length),
      }),
    );
    policies.set(securityToken, policyOf({ projectId, keyId: securityKeyId }));

    const noisyKey: TelemetryIngestionKey = new TelemetryIngestionKey();
    noisyKey.id = noisyKeyId;
    noisyKey.name = "Edge collector";
    (noisyKey as unknown as Record<string, unknown>)[
      TELEMETRY_INGESTION_BUDGET_COLUMNS[ProductType.Logs].dailyBudgetInGB
    ] = gigabytesOf(flood.length);
    budgetedKeys = [noisyKey];

    const before: RefusedTelemetryRecord = await RefusedTelemetryReader.observe(
      {
        projectId,
        signal: ProductType.Logs,
        lastScanResult: null,
        now: new Date(),
      },
    );

    // The flood uses up the noisy key's own budget...
    expect((await send({ token: noisyToken, body: flood })).passedOn).toBe(
      true,
    );
    expect((await send({ token: noisyToken, body: flood })).status).toBe(403);

    // ...and the security logs sent with their own key still get in.
    const securityLine: Sent = await send({
      token: securityToken,
      body: exportOf([FAILED_SIGN_IN]),
    });
    expect(securityLine.passedOn).toBe(true);

    // Security Events names whose budget refused what.
    RefusedTelemetryReader.clearCache();
    const after: RefusedTelemetryRecord = await RefusedTelemetryReader.observe({
      projectId,
      signal: ProductType.Logs,
      lastScanResult: {
        refusedTelemetryObservation: before.observation as never,
      },
      now: new Date(),
    });

    expect(after.refusals).toEqual([
      expect.objectContaining({
        kind: RefusedTelemetryKind.BudgetUsedUp,
        scope: TelemetryIngestionBudgetScope.IngestionKey,
        scopeId: noisyKeyId.toString(),
        scopeName: "Edge collector",
        refusedRequests: 1,
        refusedBytes: flood.length,
        to: null,
      }),
    ]);
  });
});
