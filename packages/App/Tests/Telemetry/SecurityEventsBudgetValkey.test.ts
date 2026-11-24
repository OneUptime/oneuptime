import SecurityEventsIngestAPI from "../../FeatureSet/Telemetry/API/SecurityEventsIngest";
import Queue from "Common/Server/Infrastructure/Queue";
import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import { expressErrorHandler } from "Common/Server/Utils/StartServer";
import TelemetryIngestAttributionSettings from "Common/Server/Utils/Telemetry/TelemetryIngestAttributionSettings";
import TelemetryIngestionBudgetCounter, {
  TelemetryIngestionBudgetDayCounters,
} from "Common/Server/Utils/Telemetry/TelemetryIngestionBudgetCounter";
import TelemetryIngestionBudgetSettings, {
  TelemetryIngestionBudgetInstanceSettings,
} from "Common/Server/Utils/Telemetry/TelemetryIngestionBudgetSettings";
import TelemetryIngestRefusalRecorder from "Common/Server/Utils/Telemetry/TelemetryIngestRefusalRecorder";
import {
  BodyServer,
  SentRequest,
  sendOverHttp,
  startBodyServer,
} from "Common/Tests/Server/TestingUtils/RequestBodyOverHttp";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import {
  getEmptyTelemetryIngestionBudgetStoredSettings,
  getTelemetryIngestionBudgetDay,
  TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB,
  TELEMETRY_INGESTION_BUDGET_BYTES_PER_MB,
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetStoredSettings,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import zlib from "zlib";

/*
 * SECURITY EVENTS' INGESTION BUDGET, ONCE THE BATCH IS READ AFTER ITS KEY,
 * AGAINST A REAL VALKEY (#10795).
 *
 * What the Usage page and Security Events' own budget banner read of a day -
 * the bytes used, and the bytes and requests a used-up budget dropped, and
 * the requests a rate throttled - is what it was when StartServer read the
 * batch before the key. The same batches go to two projects over HTTP,
 * through StartServer's own middleware, the real router, the real key check
 * and the real budget gate, whose script counts them in Valkey: one
 * project's to the route, read after the key; the other's to the same
 * router mounted where StartServer reads the body before routing, at the
 * same limit, as it read this route on main. The two days are then read
 * back from Valkey, and are one and the same.
 *
 * Security Events' budget is decided in Refuse mode, on the body as it
 * arrived: the body is read between the key and the budget (#10722's
 * pattern for Fluent and syslog). Check mode, counting later, would have
 * added 0 bytes to the dropped of a refused batch.
 *
 * Only Postgres is stood in for: the keys' policies and the budget
 * settings; and the queue, which takes the admitted batches. It needs
 * Valkey or Redis, as the other *Valkey suites do: CI's test-setup.sh
 * starts one on localhost:6310 and `npm test` exports its settings from
 * config.env. Locally:
 *
 *   docker run -d --rm -p 16795:6379 valkey/valkey:9.1-alpine \
 *     valkey-server --requirepass please-change-this-to-random-value
 *   VALKEY_HOST=localhost VALKEY_PORT=16795 \
 *     npx jest Tests/Telemetry/SecurityEventsBudgetValkey.test.ts
 *
 * Every key it writes is of projects and keys made up for it, and is
 * deleted afterwards.
 */

jest.setTimeout(120_000);

const GB: number = TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB;
const MB: number = TELEMETRY_INGESTION_BUDGET_BYTES_PER_MB;

// A day's security events budget the first two batches use up: exact in GB.
const BUDGET_BYTES: number = 512;

const ROUTE: string = "/security-events/v1/ingest";

// Where StartServer reads the body before routing, at the route's limit.
const AS_MAIN_READ_IT_PREFIX: string = "/workflow/as-main-read-it";

const written: Array<string> = [];

const newId: () => ObjectID = (): ObjectID => {
  const id: ObjectID = ObjectID.generate();
  written.push(id.toString());
  return id;
};

interface Sender {
  // The path its batches go to.
  path: string;
  projectId: ObjectID;
  token: string;
}

const policies: Map<string, TelemetryIngestionKeyPolicy> = new Map();

// A project and its key, sending to `path`.
const senderTo: (path: string) => Sender = (path: string): Sender => {
  const sender: Sender = {
    path: path,
    projectId: newId(),
    token: ObjectID.generate().toString(),
  };

  policies.set(sender.token, {
    ingestionKeyId: newId(),
    projectId: sender.projectId,
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
    ingestionBudgets: null,
  });

  return sender;
};

let instance: TelemetryIngestionBudgetInstanceSettings;

const budgetOf: (data: {
  dailyBytes: number;
  bytesPerSecond: number | null;
}) => TelemetryIngestionBudgetStoredSettings = (data: {
  dailyBytes: number;
  bytesPerSecond: number | null;
}): TelemetryIngestionBudgetStoredSettings => {
  const settings: TelemetryIngestionBudgetStoredSettings =
    getEmptyTelemetryIngestionBudgetStoredSettings();

  settings[ProductType.SecurityEvents] = {
    dailyBudgetInGB: data.dailyBytes / GB,
    rateLimitInMBPerSecond:
      data.bytesPerSecond === null ? null : data.bytesPerSecond / MB,
  };

  return settings;
};

const json: (value: unknown) => Buffer = (value: unknown): Buffer => {
  return Buffer.from(JSON.stringify(value));
};

const AT: string = new Date(Date.now() - 60_000).toISOString();

const JSON_TYPE: Record<string, string> = {
  "content-type": "application/json",
};

interface Batch {
  what: string;
  headers: Record<string, string>;
  body: Buffer;
  // What a budget counts it at: its size, once inflated.
  bytes: number;
}

const plain: (what: string, value: unknown) => Batch = (
  what: string,
  value: unknown,
): Batch => {
  const body: Buffer = json(value);

  return { what, headers: JSON_TYPE, body, bytes: body.length };
};

const gzipped: (what: string, value: unknown) => Batch = (
  what: string,
  value: unknown,
): Batch => {
  const body: Buffer = json(value);

  return {
    what,
    headers: { ...JSON_TYPE, "content-encoding": "gzip" },
    body: zlib.gzipSync(body),
    bytes: body.length,
  };
};

const events: (count: number, from: string) => JSONObject = (
  count: number,
  from: string,
): JSONObject => {
  return {
    events: Array.from({ length: count }, (_value: unknown, index: number) => {
      return {
        timestamp: AT,
        severity: "high",
        event_type: "ssh_brute_force",
        message: `${index + 1} failed SSH logins for jürgen from ${from}`,
        username: "jürgen",
        src_ip: from,
      };
    }),
  };
};

// Under the budget, then over it: the second batch is the one that crosses.
const FIRST: Batch = plain("the docs' generic curl", events(1, "203.0.113.7"));
const SECOND: Batch = plain("a batch of two", events(2, "198.51.100.23"));

/*
 * Refused at the budget, before any handler: a gzip one too, whose bytes
 * as main read them - before the key, and handed on as they were - and as
 * read after the key are the same.
 */
const REFUSED: Array<Batch> = [
  plain("a batch once the budget is used up", events(3, "192.0.2.1")),
  gzipped("a gzip batch once the budget is used up", events(4, "192.0.2.2")),
];

const queued: Array<JSONObject> = [];

let server: BodyServer;

const send: (
  sender: Sender,
  batch: Batch,
  token?: string | null,
) => Promise<SentRequest> = (
  sender: Sender,
  batch: Batch,
  token?: string | null,
): Promise<SentRequest> => {
  const key: string | null = token === undefined ? sender.token : token;

  return sendOverHttp(server, {
    path: sender.path,
    headers: {
      ...batch.headers,
      ...(key === null ? {} : { "x-oneuptime-token": key }),
    },
    body: batch.body,
  });
};

const today: () => string = (): string => {
  return getTelemetryIngestionBudgetDay({
    now: new Date(),
    resetTime: instance.resetTime,
    timezone: instance.timezone,
  }).id;
};

// The project's security events day, as the Usage page reads it.
const dayOf: (
  sender: Sender,
) => Promise<TelemetryIngestionBudgetDayCounters> = async (
  sender: Sender,
): Promise<TelemetryIngestionBudgetDayCounters> => {
  const counters: Array<TelemetryIngestionBudgetDayCounters> | null =
    await TelemetryIngestionBudgetCounter.readDayCounters([
      {
        dayId: today(),
        scope: TelemetryIngestionBudgetScope.Project,
        scopeId: sender.projectId.toString(),
        signalSlug: "security-events",
      },
    ]);

  expect(counters).not.toBeNull();

  return counters![0]!;
};

// What a day says, without when it was warned or used up.
const countsOf: (day: TelemetryIngestionBudgetDayCounters) => unknown = (
  day: TelemetryIngestionBudgetDayCounters,
): unknown => {
  return {
    usedBytes: day.usedBytes,
    droppedBytes: day.droppedBytes,
    droppedRequests: day.droppedRequests,
    throttledRequests: day.throttledRequests,
  };
};

beforeAll(async () => {
  await Redis.connect();

  for (const level of ["error", "warn", "info", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined;
    });
  }

  // Postgres: the keys and the budget settings.
  jest
    .spyOn(TelemetryIngestionKeyService, "getPolicyFromSecretKey")
    .mockImplementation(
      async (
        secretKey: string,
      ): Promise<TelemetryIngestionKeyPolicy | null> => {
        return policies.get(secretKey) || null;
      },
    );
  jest
    .spyOn(TelemetryIngestionKeyService, "markUsed")
    .mockResolvedValue(undefined);
  jest
    .spyOn(TelemetryIngestRefusalRecorder, "record")
    .mockImplementation((): void => {
      return undefined;
    });
  jest
    .spyOn(TelemetryIngestionBudgetSettings, "getInstanceSettings")
    .mockImplementation(async () => {
      return instance;
    });
  jest
    .spyOn(TelemetryIngestionBudgetSettings, "getProjectOverrides")
    .mockResolvedValue(null);
  jest
    .spyOn(TelemetryIngestAttributionSettings, "isAttributedProject")
    .mockResolvedValue(false);
  jest
    .spyOn(TelemetryIngestAttributionSettings, "getTeamLabelBudgetProjects")
    .mockResolvedValue(new Set<string>());

  // The queue takes what is admitted, as Redis holds it.
  jest.spyOn(Queue, "addJob").mockImplementation((async (
    _queueName: unknown,
    _jobId: unknown,
    _jobName: unknown,
    data: JSONObject,
  ) => {
    queued.push(data);
    return {};
  }) as never);

  // The App's own express app: importing StartServer mounted its middleware.
  const app: ExpressApplication = Express.getExpressApp();

  app.use(["/telemetry", "/"], SecurityEventsIngestAPI);
  app.use(AS_MAIN_READ_IT_PREFIX, SecurityEventsIngestAPI);
  app.use(expressErrorHandler);

  server = await startBodyServer(app);
});

beforeEach(() => {
  queued.length = 0;
  instance = {
    budgets: budgetOf({ dailyBytes: BUDGET_BYTES, bytesPerSecond: null }),
    warningPercent: 80,
    resetTime: "00:00",
    timezone: "UTC",
  };
});

afterAll(async () => {
  await server.close();

  const client: ClientType | null = Redis.getClient();

  if (client) {
    for (const id of written) {
      const keys: Array<string> = await client.keys(`*${id}*`);

      if (keys.length > 0) {
        await client.del(...keys);
      }
    }

    // The budgets' active sets list what this suite counted: taken out.
    for (const key of await client.keys("telemetry:budget:active:*")) {
      const ours: Array<string> = (await client.smembers(key)).filter(
        (member: string) => {
          return written.some((id: string) => {
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
  jest.restoreAllMocks();
});

describe("a project's security events day, read after the key and as main read it", () => {
  test("the batches count their exact size; once the budget is used up each is refused 403 and its own bytes are dropped; a request with no key, or a wrong one, counts nothing - the same either way", async () => {
    // The budget is crossed by the second batch, and used up after it.
    expect(FIRST.bytes).toBeLessThan(BUDGET_BYTES);
    expect(FIRST.bytes + SECOND.bytes).toBeGreaterThanOrEqual(BUDGET_BYTES);

    const days: Array<unknown> = [];
    const answers: Array<Array<number | null>> = [];

    for (const path of [ROUTE, `${AS_MAIN_READ_IT_PREFIX}${ROUTE}`]) {
      const sender: Sender = senderTo(path);
      const statuses: Array<number | null> = [];

      queued.length = 0;

      for (const batch of [FIRST, SECOND]) {
        statuses.push((await send(sender, batch)).answer.status);
      }

      // Nothing counted for a request without the right key.
      statuses.push((await send(sender, REFUSED[0]!, null)).answer.status);
      statuses.push(
        (await send(sender, REFUSED[0]!, ObjectID.generate().toString())).answer
          .status,
      );

      expect({ path, day: countsOf(await dayOf(sender)) }).toEqual({
        path,
        day: {
          usedBytes: FIRST.bytes + SECOND.bytes,
          droppedBytes: 0,
          droppedRequests: 0,
          throttledRequests: 0,
        },
      });

      for (const batch of REFUSED) {
        statuses.push((await send(sender, batch)).answer.status);
      }

      // The two admitted batches were queued; nothing after them.
      expect(queued).toHaveLength(2);

      days.push(countsOf(await dayOf(sender)));
      answers.push(statuses);
    }

    expect(answers).toEqual([
      [200, 200, 401, 401, 403, 403],
      [200, 200, 401, 401, 403, 403],
    ]);
    // Each refused batch is dropped at its own size, gzip at its inflated one.
    expect(days).toEqual([
      {
        usedBytes: FIRST.bytes + SECOND.bytes,
        droppedBytes: REFUSED[0]!.bytes + REFUSED[1]!.bytes,
        droppedRequests: 2,
        throttledRequests: 0,
      },
      {
        usedBytes: FIRST.bytes + SECOND.bytes,
        droppedBytes: REFUSED[0]!.bytes + REFUSED[1]!.bytes,
        droppedRequests: 2,
        throttledRequests: 0,
      },
    ]);
  });

  test("a gzip batch admitted is counted at its size once inflated, the same either way", async () => {
    const batch: Batch = gzipped(
      "Fluent Bit's records, with compress gzip",
      events(2, "198.51.100.24"),
    );

    expect(batch.body.length).not.toBe(batch.bytes);

    const days: Array<unknown> = [];
    const answers: Array<number | null> = [];

    for (const path of [ROUTE, `${AS_MAIN_READ_IT_PREFIX}${ROUTE}`]) {
      const sender: Sender = senderTo(path);

      answers.push((await send(sender, batch)).answer.status);
      days.push(countsOf(await dayOf(sender)));
    }

    /*
     * Read after the key, it is the events it carries (200). As main read
     * it, it is its bytes, which hold no events (400): main stored one event
     * of them. The budget, before either, counted it alike.
     */
    expect(answers).toEqual([200, 400]);
    expect(days).toEqual([
      {
        usedBytes: batch.bytes,
        droppedBytes: 0,
        droppedRequests: 0,
        throttledRequests: 0,
      },
      {
        usedBytes: batch.bytes,
        droppedBytes: 0,
        droppedRequests: 0,
        throttledRequests: 0,
      },
    ]);
  });

  test("a rate throttles the batch after one that used a second of it, 429, counting a throttled request and no bytes - the same either way", async () => {
    // A second's worth of rate is less than a batch.
    instance = {
      ...instance,
      budgets: budgetOf({ dailyBytes: GB, bytesPerSecond: 64 }),
    };

    expect(FIRST.bytes).toBeGreaterThan(64);

    const days: Array<unknown> = [];
    const answers: Array<Array<number | null>> = [];

    for (const path of [ROUTE, `${AS_MAIN_READ_IT_PREFIX}${ROUTE}`]) {
      const sender: Sender = senderTo(path);
      const statuses: Array<number | null> = [];

      for (const batch of [FIRST, FIRST]) {
        statuses.push((await send(sender, batch)).answer.status);
      }

      days.push(countsOf(await dayOf(sender)));
      answers.push(statuses);
    }

    expect(answers).toEqual([
      [200, 429],
      [200, 429],
    ]);
    expect(days).toEqual([
      {
        usedBytes: FIRST.bytes,
        droppedBytes: 0,
        droppedRequests: 0,
        throttledRequests: 1,
      },
      {
        usedBytes: FIRST.bytes,
        droppedBytes: 0,
        droppedRequests: 0,
        throttledRequests: 1,
      },
    ]);
  });
});
