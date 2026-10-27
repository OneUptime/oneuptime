import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A worker pod that has just started takes telemetry jobs from BullMQ before
 * the shared Redis client it reads OTLP bodies with is connected. Right after
 * a rollout of the test environment 1,278 body reads failed within a minute;
 * a telemetry job has three attempts, and one that used them all up dropped
 * its batch, leaving spans missing from many traces. readBody now waits a
 * bounded time for the client instead of failing the attempt at once.
 *
 * Real timers with a shortened wait: jest 28's fake timers cannot install on
 * current Node (the read-only `performance` global).
 */

const mockRedisState: {
  client: { getBuffer: jest.Mock } | null;
  connected: boolean;
} = {
  client: null,
  connected: false,
};

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return mockRedisState.client;
      },
      isConnected: (): boolean => {
        return mockRedisState.connected;
      },
    },
  };
});

// Only storeBody makes keys; readBody never does.
jest.mock("Common/Types/ObjectID", () => {
  return {
    __esModule: true,
    default: {
      generate: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "generated";
          },
        };
      },
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      warn: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    },
  };
});

import TelemetryBodyStore, {
  REDIS_READY_WAIT_MS,
} from "../../FeatureSet/Telemetry/Utils/TelemetryBodyStore";

const BODY: Buffer = Buffer.from([0x0a, 0x00, 0xff, 0x10]);
const SHORT_WAIT_MS: number = 1_500;

function connectedClient(): { getBuffer: jest.Mock } {
  return {
    getBuffer: jest.fn(async (): Promise<Buffer> => {
      return BODY;
    }),
  };
}

function after(ms: number, fn: () => void): void {
  setTimeout(fn, ms);
}

describe("TelemetryBodyStore.readBody while Redis is not ready", () => {
  beforeEach(() => {
    TelemetryBodyStore.redisReadyWaitMs = SHORT_WAIT_MS;
    mockRedisState.client = null;
    mockRedisState.connected = false;
  });

  afterEach(() => {
    TelemetryBodyStore.redisReadyWaitMs = REDIS_READY_WAIT_MS;
  });

  test("reads at once when the client is already connected", async () => {
    const client: { getBuffer: jest.Mock } = connectedClient();
    mockRedisState.client = client;
    mockRedisState.connected = true;

    const started: number = Date.now();
    await expect(
      TelemetryBodyStore.readBody("telemetry:body:a"),
    ).resolves.toEqual(BODY);
    expect(Date.now() - started).toBeLessThan(200);
    expect(client.getBuffer).toHaveBeenCalledWith("telemetry:body:a");
  });

  test("waits for a client that connects within the window, then reads the body", async () => {
    const client: { getBuffer: jest.Mock } = connectedClient();
    after(400, () => {
      mockRedisState.client = client;
      mockRedisState.connected = true;
    });

    await expect(
      TelemetryBodyStore.readBody("telemetry:body:b"),
    ).resolves.toEqual(BODY);
    expect(client.getBuffer).toHaveBeenCalledTimes(1);
  });

  test("waits for a client that exists but is still reconnecting", async () => {
    const client: { getBuffer: jest.Mock } = connectedClient();
    mockRedisState.client = client;
    after(400, () => {
      mockRedisState.connected = true;
    });

    await expect(
      TelemetryBodyStore.readBody("telemetry:body:c"),
    ).resolves.toEqual(BODY);
    expect(client.getBuffer).toHaveBeenCalledTimes(1);
  });

  test("still fails the attempt when Redis stays down past the window, so BullMQ retries it", async () => {
    const started: number = Date.now();
    await expect(
      TelemetryBodyStore.readBody("telemetry:body:d"),
    ).rejects.toThrow("Redis not connected; cannot read telemetry body");
    expect(Date.now() - started).toBeGreaterThanOrEqual(SHORT_WAIT_MS - 50);
  });

  test("waits long enough for a pod's Redis connect, not so long that an outage hangs jobs", () => {
    expect(REDIS_READY_WAIT_MS).toBeGreaterThanOrEqual(5_000);
    expect(REDIS_READY_WAIT_MS).toBeLessThanOrEqual(60_000);
  });
});

describe("TelemetryBodyStore.waitForRedis", () => {
  beforeEach(() => {
    mockRedisState.client = null;
    mockRedisState.connected = false;
  });

  test("returns null once the timeout passes without a connection", async () => {
    await expect(TelemetryBodyStore.waitForRedis(600)).resolves.toBeNull();
  });

  test("returns the client as soon as it is connected", async () => {
    const client: { getBuffer: jest.Mock } = connectedClient();
    after(300, () => {
      mockRedisState.client = client;
      mockRedisState.connected = true;
    });

    const started: number = Date.now();
    await expect(TelemetryBodyStore.waitForRedis(10_000)).resolves.toBe(client);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
