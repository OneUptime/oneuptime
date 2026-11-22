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

/*
 * TEAM AND LABEL BUDGETS, AND USAGE AS METRICS, FOR WHAT FLUENT BIT,
 * FLUENTD, SYSLOG AND A HOST SEND - through real ingest, against a real
 * Valkey (#10101, #10102).
 *
 * Each batch goes the whole way a sender's does: the ingest middleware and
 * its budget gate (which counts the batch against the project's day in
 * Valkey), the route's handler, the queue's job - written as Redis would
 * hold it (JSON) - the worker, the ingest service, and the batch's
 * attribution, settled by its Lua script in Valkey. Then what the Usage
 * page reads (TelemetryIngestionBudgetStatusReader), what Security Events
 * reads of it (RefusedTelemetryReader, #10431) and the usage counters are
 * read back from the same Valkey.
 *
 *   - Syslog: the lines of a service its team owns count against the
 *     team's budget; once it is used up they are dropped - the rest of the
 *     batch is stored - what they would have counted comes off the
 *     project's day, and Security Events names the team's budget as what
 *     refused them, with the bytes and requests.
 *   - Fluent Bit and Fluentd: a batch is one service's; once its team's
 *     budget is used up the whole batch is dropped, and taken back off the
 *     project's day.
 *   - A host (#10101): an OTLP batch filed under a host its team owns
 *     counts against the team's budget as a service's does.
 *   - Usage as metrics: Fluent's and syslog's logs are in the usage
 *     counters, at what the request path counted.
 *
 * Only Postgres and ClickHouse are stood in for: the ingestion key's
 * policy, the budget settings, the budget rows, the owners and labels, the
 * service a name files under, and the writer the rows go to. It needs
 * Valkey or Redis, as the other *Valkey suites do: CI's test-setup.sh
 * starts one on localhost:6310 and `npm test` exports its settings from
 * config.env. Locally:
 *
 *   docker run -d --rm -p 16917:6379 valkey/valkey:9.1-alpine
 *   VALKEY_HOST=localhost VALKEY_PORT=16917 \
 *     npx jest Tests/Telemetry/FluentSyslogTeamBudgetsValkey.test.ts
 *
 * Every key it writes is of projects, keys and teams made up for it, and
 * is deleted afterwards.
 */

let mockWorker: ((job: unknown) => Promise<void>) | null = null;
const mockQueuedJobs: Array<Record<string, unknown>> = [];

jest.mock("Common/Server/Infrastructure/QueueWorker", () => {
  return {
    __esModule: true,
    default: {
      getWorker: (
        _name: unknown,
        handler: (job: unknown) => Promise<void>,
      ): void => {
        mockWorker = handler;
      },
    },
  };
});

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: async (
        _queue: unknown,
        jobId: string,
        _name: string,
        data: Record<string, unknown>,
      ): Promise<void> => {
        // As Redis holds it.
        mockQueuedJobs.push({
          id: jobId,
          data: JSON.parse(JSON.stringify(data)),
        });
      },
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

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendCustomResponse: jest.fn(),
    },
  };
});

jest.mock(
  "isolated-vm",
  () => {
    return {
      __esModule: true,
      default: {},
      Isolate: jest.fn(),
      Reference: jest.fn(),
      Callback: jest.fn(),
      ExternalCopy: jest.fn(),
    };
  },
  { virtual: true },
);

import "../../FeatureSet/Telemetry/Jobs/TelemetryIngest/ProcessTelemetry";
import FluentLogsIngestService from "../../FeatureSet/Telemetry/Services/FluentLogsIngestService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import SyslogIngestService from "../../FeatureSet/Telemetry/Services/SyslogIngestService";
import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import TelemetryIngest from "Common/Server/Middleware/TelemetryIngest";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import ProjectService from "Common/Server/Services/ProjectService";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import TelemetryIngestionTeamLabelBudgetService from "Common/Server/Services/TelemetryIngestionTeamLabelBudgetService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import RefusedTelemetryReader from "Common/Server/Utils/SecurityEvent/RefusedTelemetryReader";
import SyslogDeviceMatcher from "Common/Server/Utils/Syslog/SyslogDeviceMatcher";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import TelemetryIngestAttribution, {
  shareTelemetryIngestBytes,
} from "Common/Server/Utils/Telemetry/TelemetryIngestAttribution";
import TelemetryIngestAttributionCounter, {
  TelemetryUsageCounterEntry,
} from "Common/Server/Utils/Telemetry/TelemetryIngestAttributionCounter";
import TelemetryIngestAttributionSettings, {
  TelemetryIngestOwnerKind,
} from "Common/Server/Utils/Telemetry/TelemetryIngestAttributionSettings";
import TelemetryIngestionBudgetCounter, {
  TelemetryIngestionBudgetDayCounters,
} from "Common/Server/Utils/Telemetry/TelemetryIngestionBudgetCounter";
import TelemetryIngestionBudgetSettings, {
  TelemetryIngestionBudgetInstanceSettings,
} from "Common/Server/Utils/Telemetry/TelemetryIngestionBudgetSettings";
import TelemetryIngestRefusalRecorder from "Common/Server/Utils/Telemetry/TelemetryIngestRefusalRecorder";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import {
  getEmptyTelemetryIngestionBudgetStoredSettings,
  getTelemetryIngestionBudgetDay,
  TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB,
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetStoredSettings,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  RefusedTelemetry,
  RefusedTelemetryKind,
  RefusedTelemetryRecord,
} from "Common/Utils/SecurityEvent/RefusedTelemetry";

jest.setTimeout(60_000);

const GB: number = TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB;
// A team's daily logs budget the first batch uses up.
const TEAM_BUDGET_BYTES: number = 40;

const written: Array<string> = [];

const newId: () => ObjectID = (): ObjectID => {
  const id: ObjectID = ObjectID.generate();
  written.push(`*${id.toString()}*`);
  return id;
};

interface World {
  projectId: ObjectID;
  keyId: ObjectID;
  token: string;
  teamId: ObjectID;
  checkoutId: ObjectID;
  cartId: ObjectID;
  hostId: ObjectID;
}

let world: World;
let storedRows: Array<JSONObject> = [];
let budgetRows: Array<Record<string, unknown>> = [];
let usageProjects: Array<ObjectID> = [];

const logsBudgetInGB: (
  bytes: number,
) => TelemetryIngestionBudgetStoredSettings = (
  bytes: number,
): TelemetryIngestionBudgetStoredSettings => {
  const settings: TelemetryIngestionBudgetStoredSettings =
    getEmptyTelemetryIngestionBudgetStoredSettings();
  settings[ProductType.Logs] = {
    dailyBudgetInGB: bytes / GB,
    rateLimitInMBPerSecond: null,
  };
  return settings;
};

const instance: TelemetryIngestionBudgetInstanceSettings = {
  // A project budget in force, so the request path counts each batch.
  budgets: logsBudgetInGB(GB),
  warningPercent: 80,
  resetTime: "00:00",
  timezone: "UTC",
};

const policyOf: (w: World) => TelemetryIngestionKeyPolicy = (
  w: World,
): TelemetryIngestionKeyPolicy => {
  return {
    ingestionKeyId: w.keyId,
    projectId: w.projectId,
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
    ingestionBudgets: null,
  } as unknown as TelemetryIngestionKeyPolicy;
};

// The team's logs budget, as Postgres holds it.
const teamBudget: (w: World) => Record<string, unknown> = (
  w: World,
): Record<string, unknown> => {
  return {
    _id: ObjectID.generate().toString(),
    projectId: w.projectId,
    teamId: w.teamId,
    team: { name: "Payments" },
    logsDailyIngestionBudgetInGB: TEAM_BUDGET_BYTES / GB,
  };
};

const response: () => ExpressResponse = (): ExpressResponse => {
  const res: Record<string, unknown> = {
    headersSent: false,
    setHeader: (): void => {
      return undefined;
    },
    status: (): Record<string, unknown> => {
      return res;
    },
    send: (): Record<string, unknown> => {
      return res;
    },
    json: (): Record<string, unknown> => {
      return res;
    },
  };

  return res as unknown as ExpressResponse;
};

/*
 * One request the whole way: the ingest middleware and its budget gate,
 * then the route's handler, which queues it. Answers the job as Redis
 * holds it.
 */
const send: (data: {
  surface: TelemetryIngestSurface;
  body: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  handler: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void>;
}) => Promise<Record<string, unknown>> = async (data: {
  surface: TelemetryIngestSurface;
  body: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  handler: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void>;
}): Promise<Record<string, unknown>> => {
  const req: Record<string, unknown> = {
    headers: { "x-oneuptime-token": world.token, ...(data.headers || {}) },
    body: data.body,
    query: {},
    id: "team-budgets-through-real-ingest",
    ...(data.rawBody !== undefined ? { rawBody: data.rawBody } : {}),
  };
  let passedOn: boolean = false;
  let failed: unknown = undefined;

  await TelemetryIngest.forSurface(data.surface)(
    req as unknown as ExpressRequest,
    response(),
    ((err?: unknown): void => {
      passedOn = err === undefined;
      failed = err;
    }) as unknown as NextFunction,
  );

  expect({ passedOn, failed }).toEqual({ passedOn: true, failed: undefined });

  const queuedBefore: number = mockQueuedJobs.length;

  await data.handler(req as unknown as ExpressRequest, response(), ((
    err?: unknown,
  ): void => {
    failed = err;
  }) as unknown as NextFunction);

  expect(failed).toBe(undefined);
  expect(mockQueuedJobs.length).toBe(queuedBefore + 1);

  return mockQueuedJobs[mockQueuedJobs.length - 1]!;
};

// The worker's turn at a queued job, its first attempt.
const work: (job: Record<string, unknown>) => Promise<void> = async (
  job: Record<string, unknown>,
): Promise<void> => {
  await mockWorker!({
    id: job["id"],
    name: "ProcessTelemetry",
    data: job["data"],
    attemptsMade: 0,
  });
};

const sendSyslog: (lines: Array<string>) => Promise<Record<string, unknown>> = (
  lines: Array<string>,
): Promise<Record<string, unknown>> => {
  return send({
    surface: TelemetryIngestSurface.Syslog,
    body: lines.join("\n"),
    handler: (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      return SyslogIngestService.ingestSyslog(req, res, next);
    },
  });
};

const sendFluent: (
  entries: Array<JSONObject>,
) => Promise<Record<string, unknown>> = (
  entries: Array<JSONObject>,
): Promise<Record<string, unknown>> => {
  const rawBody: string = JSON.stringify(entries);

  return send({
    surface: TelemetryIngestSurface.Fluent,
    body: JSON.parse(rawBody),
    rawBody: rawBody,
    headers: { "x-oneuptime-service-name": "checkout" },
    handler: (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      return FluentLogsIngestService.ingestFluentLogs(req, res, next);
    },
  });
};

const today: () => string = (): string => {
  return getTelemetryIngestionBudgetDay({
    now: new Date(),
    resetTime: instance.resetTime,
    timezone: instance.timezone,
  }).id;
};

const readDays: (
  scopes: Array<{ scope: TelemetryIngestionBudgetScope; scopeId: ObjectID }>,
) => Promise<Array<TelemetryIngestionBudgetDayCounters>> = async (
  scopes: Array<{ scope: TelemetryIngestionBudgetScope; scopeId: ObjectID }>,
): Promise<Array<TelemetryIngestionBudgetDayCounters>> => {
  const counters: Array<TelemetryIngestionBudgetDayCounters> | null =
    await TelemetryIngestionBudgetCounter.readDayCounters(
      scopes.map(
        (scope: {
          scope: TelemetryIngestionBudgetScope;
          scopeId: ObjectID;
        }) => {
          return {
            dayId: today(),
            scope: scope.scope,
            scopeId: scope.scopeId.toString(),
            signalSlug: "logs",
          };
        },
      ),
    );

  return counters!;
};

const teamAndProjectDays: () => Promise<{
  team: TelemetryIngestionBudgetDayCounters;
  project: TelemetryIngestionBudgetDayCounters;
}> = async (): Promise<{
  team: TelemetryIngestionBudgetDayCounters;
  project: TelemetryIngestionBudgetDayCounters;
}> => {
  const [team, project]: Array<TelemetryIngestionBudgetDayCounters> =
    await readDays([
      { scope: TelemetryIngestionBudgetScope.Team, scopeId: world.teamId },
      {
        scope: TelemetryIngestionBudgetScope.Project,
        scopeId: world.projectId,
      },
    ]);

  return { team: team!, project: project! };
};

// What the request path counted a queued job at.
const countedBytesOf: (job: Record<string, unknown>) => number = (
  job: Record<string, unknown>,
): number => {
  return Number((job["data"] as JSONObject)["ingestBytes"]);
};

const bodies: () => Array<unknown> = (): Array<unknown> => {
  return storedRows.map((row: JSONObject) => {
    return row["body"];
  });
};

beforeAll(async () => {
  await Redis.connect();
});

beforeEach(() => {
  RefusedTelemetryReader.clearCache();
  TelemetryIngestAttribution.clearState();
  TelemetryIngestAttributionSettings.clearCaches();
  SyslogDeviceMatcher.clearCaches();
  storedRows = [];
  usageProjects = [];

  world = {
    projectId: newId(),
    keyId: newId(),
    token: ObjectID.generate().toString(),
    teamId: newId(),
    checkoutId: ObjectID.generate(),
    cartId: ObjectID.generate(),
    hostId: ObjectID.generate(),
  };
  budgetRows = [teamBudget(world)];

  // Postgres: the key, the budget settings, the budget rows, who owns what.
  jest
    .spyOn(TelemetryIngestionKeyService, "getPolicyFromSecretKey")
    .mockImplementation((async (token: string) => {
      return token === world.token ? policyOf(world) : null;
    }) as never);
  jest
    .spyOn(TelemetryIngestionKeyService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(TelemetryIngestionBudgetSettings, "getInstanceSettings")
    .mockResolvedValue(instance);
  jest
    .spyOn(TelemetryIngestionBudgetSettings, "getProjectOverrides")
    .mockResolvedValue(null);
  jest
    .spyOn(TelemetryIngestRefusalRecorder, "record")
    .mockImplementation((): void => {
      return undefined;
    });
  jest
    .spyOn(TelemetryIngestionTeamLabelBudgetService, "findAllBy")
    .mockImplementation((async (data: { query: Record<string, unknown> }) => {
      return budgetRows.filter((row: Record<string, unknown>) => {
        return (
          !data.query["projectId"] ||
          String(row["projectId"]) === String(data.query["projectId"])
        );
      });
    }) as never);
  jest
    .spyOn(TelemetryIngestionTeamLabelBudgetService, "findBy")
    .mockImplementation((async () => {
      return budgetRows;
    }) as never);
  jest.spyOn(ProjectService, "findAllBy").mockImplementation((async () => {
    return usageProjects.map((id: ObjectID) => {
      return { id: id };
    });
  }) as never);

  // The team owns checkout and the host; nothing carries a label.
  const owned: World = world;

  for (const kind of TelemetryIngestAttributionSettings.getTelemetryOwnerKinds()) {
    jest
      .spyOn(kind.ownerTeamService, "findAllBy")
      .mockImplementation((async () => {
        if (kind.kind === "Service") {
          return [{ serviceId: owned.checkoutId, teamId: owned.teamId }];
        }

        if (kind.kind === "Host") {
          return [{ hostId: owned.hostId, teamId: owned.teamId }];
        }

        return [];
      }) as never);

    if (kind.modelService) {
      jest
        .spyOn(
          kind.modelService as TelemetryIngestOwnerKind["ownerTeamService"],
          "findAllBy",
        )
        .mockResolvedValue([] as never);
    }
  }

  // Which service a name files under.
  jest
    .spyOn(OTelIngestService, "telemetryServiceFromName")
    .mockImplementation((async (data: {
      serviceName: string;
    }): Promise<TelemetryServiceMetadata> => {
      return {
        serviceName: data.serviceName,
        primaryEntityId:
          data.serviceName === "checkout" ? world.checkoutId : world.cartId,
        primaryEntityType: ServiceType.OpenTelemetry,
        dataRententionInDays: 30,
        serviceRetentionConfig: null,
        serviceRetentionInDays: 30,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      };
    }) as never);
  jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([] as never);

  // ClickHouse: the rows go here.
  jest.spyOn(TelemetryFanInWriter, "submit").mockImplementation((async (
    _service: unknown,
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

    // The budgets' active sets list what this suite counted: taken out.
    const ids: Array<string> = written.map((pattern: string) => {
      return pattern.split("*").join("");
    });

    for (const key of await client.keys("telemetry:budget:active:*")) {
      const ours: Array<string> = (await client.smembers(key)).filter(
        (member: string) => {
          return ids.some((id: string) => {
            return member.includes(id);
          });
        },
      );

      if (ours.length > 0) {
        await client.srem(key, ...ours);
      }
    }
  }

  await Redis.disconnect();
});

describe("syslog, through real ingest, against its team's budget", () => {
  test("a service's lines count against its team's budget; once it is used up they are dropped, the rest stored, and what they would have counted comes off the project's day", async () => {
    const lines: (word: string) => Array<string> = (
      word: string,
    ): Array<string> => {
      return [
        `<13>1 2026-11-22T10:00:00Z web-01 checkout - - - ${word} paid`,
        `<13>1 2026-11-22T10:00:01Z web-01 cart - - - ${word} added`,
      ];
    };

    // Before: Security Events reads the counters once, and finds nothing refused.
    const before: RefusedTelemetryRecord = await RefusedTelemetryReader.observe(
      {
        projectId: world.projectId,
        signal: ProductType.Logs,
        lastScanResult: null,
        now: new Date(),
      },
    );
    expect(before.refusals).toEqual([]);

    // The batch that crosses the team's line is stored.
    const first: Record<string, unknown> = await sendSyslog(lines("first"));
    const firstBytes: number = countedBytesOf(first);

    // What the request path counted, before the handler reshaped the body.
    expect(firstBytes).toBe(Buffer.byteLength(lines("first").join("\n")));
    expect((first["data"] as JSONObject)["ingestionBudgetCharge"]).toEqual(
      expect.objectContaining({ countedBytes: firstBytes }),
    );

    await work(first);

    expect(bodies()).toEqual(["first paid", "first added"]);

    const firstShares: Array<number> = shareTelemetryIngestBytes(
      firstBytes,
      [1, 1],
    );
    let days: {
      team: TelemetryIngestionBudgetDayCounters;
      project: TelemetryIngestionBudgetDayCounters;
    } = await teamAndProjectDays();

    // Checkout's line, its share of the batch, is the team's.
    expect(days.team.usedBytes).toBe(firstShares[0]);
    expect(days.team.usedBytes).toBeGreaterThanOrEqual(TEAM_BUDGET_BYTES);
    expect(days.team.droppedBytes).toBe(0);
    expect(days.project.usedBytes).toBe(firstBytes);

    // The next batch: checkout's line is dropped, cart's is stored.
    storedRows = [];
    TelemetryIngestAttribution.clearState();

    const second: Record<string, unknown> = await sendSyslog(lines("second"));
    const secondBytes: number = countedBytesOf(second);

    await work(second);

    expect(bodies()).toEqual(["second added"]);

    // Admitted first, then dropped: cart's share, then checkout's.
    const [, checkoutShare]: Array<number> = shareTelemetryIngestBytes(
      secondBytes,
      [1, 1],
    );

    days = await teamAndProjectDays();

    expect(days.team.usedBytes).toBe(firstShares[0]);
    expect(days.team.droppedBytes).toBe(checkoutShare);
    expect(days.team.droppedRequests).toBe(1);
    expect(days.team.exhaustedAt).not.toBe(null);
    // Not counted against the project: one team's runaway service is its own.
    expect(days.project.usedBytes).toBe(
      firstBytes + secondBytes - checkoutShare!,
    );

    // Security Events names the team's budget as what refused them.
    RefusedTelemetryReader.clearCache();

    const after: RefusedTelemetryRecord = await RefusedTelemetryReader.observe({
      projectId: world.projectId,
      signal: ProductType.Logs,
      lastScanResult: {
        refusedTelemetryObservation: before.observation as never,
      },
      now: new Date(),
    });

    expect(after.refusals).toEqual([
      expect.objectContaining({
        signal: ProductType.Logs,
        kind: RefusedTelemetryKind.BudgetUsedUp,
        scope: TelemetryIngestionBudgetScope.Team,
        scopeId: world.teamId.toString(),
        scopeName: "Payments",
        to: null,
        refusedBytes: checkoutShare,
        refusedRequests: 1,
      }),
    ]);

    const refusal: RefusedTelemetry = after.refusals[0]!;

    // From the moment the team's counter stamped the first drop.
    expect(Date.parse(refusal.from)).toBeGreaterThan(Date.now() - 60_000);
    expect(Date.parse(refusal.from)).toBeLessThanOrEqual(Date.now());
  });
});

describe("Fluent Bit and Fluentd, through real ingest, against their team's budget", () => {
  test("a batch is its service's: once the team's budget is used up the whole batch is dropped, and taken back off the project's day", async () => {
    const entries: (word: string) => Array<JSONObject> = (
      word: string,
    ): Array<JSONObject> => {
      return [
        { message: `${word} paid`, level: "info" },
        { message: `${word} shipped`, level: "info" },
      ];
    };

    const first: Record<string, unknown> = await sendFluent(entries("first"));
    const firstBytes: number = countedBytesOf(first);

    expect(firstBytes).toBe(
      Buffer.byteLength(JSON.stringify(entries("first"))),
    );

    await work(first);

    expect(bodies()).toEqual(["first paid", "first shipped"]);

    let days: {
      team: TelemetryIngestionBudgetDayCounters;
      project: TelemetryIngestionBudgetDayCounters;
    } = await teamAndProjectDays();

    expect(days.team.usedBytes).toBe(firstBytes);
    expect(days.project.usedBytes).toBe(firstBytes);

    storedRows = [];
    TelemetryIngestAttribution.clearState();

    const second: Record<string, unknown> = await sendFluent(entries("second"));
    const secondBytes: number = countedBytesOf(second);

    await work(second);

    expect(storedRows).toEqual([]);

    days = await teamAndProjectDays();

    expect(days.team.usedBytes).toBe(firstBytes);
    expect(days.team.droppedBytes).toBe(secondBytes);
    expect(days.team.droppedRequests).toBe(1);
    expect(days.project.usedBytes).toBe(firstBytes);
  });
});

describe("a host, through real OTLP ingest, against its team's budget (#10101)", () => {
  const AUTO_DISCOVERY_RETURNING_NULL: Array<string> = [
    "autoDiscoverKubernetesCluster",
    "autoDiscoverDockerHost",
    "autoDiscoverPodmanHost",
    "autoDiscoverProxmoxCluster",
    "autoDiscoverOpenStackCloud",
    "autoDiscoverVMwareVCenter",
    "autoDiscoverCephCluster",
    "autoDiscoverStorageArray",
    "autoDiscoverDockerSwarmCluster",
    "autoDiscoverHost",
    "autoDiscoverServerless",
    "autoDiscoverCloudResource",
    "autoDiscoverRum",
    "autoDiscoverDatabaseServer",
  ];

  const exportOf: (bodies: Array<string>) => Buffer = (
    lines: Array<string>,
  ): Buffer => {
    return Buffer.from(
      JSON.stringify({
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: "host.name", value: { stringValue: "web-1" } },
              ],
            },
            scopeLogs: [
              {
                logRecords: lines.map((line: string) => {
                  return {
                    timeUnixNano: "1763805600000000000",
                    severityNumber: 9,
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

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service: Record<string, any> = OtelLogsIngestService as unknown as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [key: string]: any;
    };

    for (const method of AUTO_DISCOVERY_RETURNING_NULL) {
      jest.spyOn(service, method).mockResolvedValue(null);
    }

    // The batch is the host's, as host discovery files it.
    jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
      serviceName: "host/web-1",
      primaryEntityId: world.hostId,
      primaryEntityType: ServiceType.Host,
      dataRententionInDays: 15,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    });
    jest
      .spyOn(service, "submitLogsBuffer")
      .mockImplementation((...args: Array<unknown>): Promise<void> => {
        const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
        storedRows.push(...rows.splice(0, rows.length));
        return Promise.resolve();
      });
    jest
      .spyOn(service, "submitExceptionsBuffer")
      .mockImplementation((...args: Array<unknown>): Promise<void> => {
        (args[0] as Array<JSONObject>).splice(0);
        return Promise.resolve();
      });
  });

  const sendHostLogs: (
    lines: Array<string>,
  ) => Promise<Record<string, unknown>> = (
    lines: Array<string>,
  ): Promise<Record<string, unknown>> => {
    return send({
      surface: TelemetryIngestSurface.OtelLogs,
      body: exportOf(lines),
      headers: { "content-type": "application/json" },
      handler: (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        return OtelLogsIngestService.ingestLogs(req, res, next);
      },
    });
  };

  test("a host the team owns counts against the team's budget as its services do, and is dropped once it is used up", async () => {
    const firstBody: Buffer = exportOf(["disk 91%", "disk 92%"]);
    const first: Record<string, unknown> = await sendHostLogs([
      "disk 91%",
      "disk 92%",
    ]);

    await work(first);

    expect(bodies()).toEqual(["disk 91%", "disk 92%"]);
    expect(
      storedRows.map((row: JSONObject) => {
        return [row["primaryEntityId"], row["primaryEntityType"]];
      }),
    ).toEqual([
      [world.hostId.toString(), ServiceType.Host],
      [world.hostId.toString(), ServiceType.Host],
    ]);

    let days: {
      team: TelemetryIngestionBudgetDayCounters;
      project: TelemetryIngestionBudgetDayCounters;
    } = await teamAndProjectDays();

    expect(days.team.usedBytes).toBe(firstBody.length);
    expect(days.project.usedBytes).toBe(firstBody.length);

    storedRows = [];
    TelemetryIngestAttribution.clearState();

    const secondBody: Buffer = exportOf(["disk 99%"]);
    const second: Record<string, unknown> = await sendHostLogs(["disk 99%"]);

    await work(second);

    expect(storedRows).toEqual([]);

    days = await teamAndProjectDays();

    expect(days.team.droppedBytes).toBe(secondBody.length);
    expect(days.team.droppedRequests).toBe(1);
    expect(days.project.usedBytes).toBe(firstBody.length);
  });
});

describe("usage as metrics, for Fluent's and syslog's logs", () => {
  test("each service's share is in the usage counters, at what the request path counted", async () => {
    budgetRows = [];
    usageProjects = [world.projectId];

    const startedAt: number = Date.now();

    const syslog: Record<string, unknown> = await sendSyslog([
      "<13>1 2026-11-22T10:00:00Z web-01 checkout - - - paid",
      "<13>1 2026-11-22T10:00:01Z web-01 cart - - - added",
      "<13>1 2026-11-22T10:00:02Z web-01 cart - - - removed",
    ]);
    const fluent: Record<string, unknown> = await sendFluent([
      { message: "paid" },
    ]);

    // No team budget: the request path's count rides on the job all the same.
    expect((syslog["data"] as JSONObject)["ingestionBudgetCharge"]).toBe(
      undefined,
    );

    await work(syslog);
    await work(fluent);

    const buckets: Array<string> = Array.from(
      new Set([
        TelemetryIngestAttributionCounter.getUsageBucketId(startedAt),
        TelemetryIngestAttributionCounter.getUsageBucketId(Date.now()),
      ]),
    );
    const totals: Map<string, number> = new Map();

    for (const bucket of buckets) {
      written.push(
        TelemetryIngestAttributionCounter.getUsageKey(
          bucket,
          world.projectId.toString(),
        ),
      );

      const usage: Map<string, Array<TelemetryUsageCounterEntry>> | null =
        await TelemetryIngestAttributionCounter.readUsage(bucket, [
          world.projectId.toString(),
        ]);

      for (const entry of usage!.get(world.projectId.toString()) || []) {
        expect(entry.signalSlug).toBe("logs");
        totals.set(
          entry.resourceName,
          (totals.get(entry.resourceName) || 0) + entry.bytes,
        );
      }

      await TelemetryIngestAttributionCounter.deleteUsage(bucket, [
        world.projectId.toString(),
      ]);
    }

    const syslogShares: Array<number> = shareTelemetryIngestBytes(
      countedBytesOf(syslog),
      [1, 2],
    );

    expect(Object.fromEntries(totals)).toEqual({
      checkout: syslogShares[0]! + countedBytesOf(fluent),
      cart: syslogShares[1],
    });
  });
});
