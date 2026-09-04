import logger from "Common/Server/Utils/Logger";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * RunCron registers a repeatable BullMQ job at import time, so it is
 * stubbed out — the job module is imported here purely for its exported
 * prune loop.
 */
jest.mock("../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

/*
 * An in-memory stand-in for the sorted-set commands the prune uses. The
 * one Redis behaviour that matters most here is modelled faithfully: a
 * sorted set whose last member is removed ceases to EXIST, which is how
 * a normally drained project looks to this job.
 */
class MockRedis {
  public sets: Map<string, Set<string>> = new Map<string, Set<string>>();
  public zsets: Map<string, Map<string, number>> = new Map<
    string,
    Map<string, number>
  >();
  public connected: boolean = true;
  public failingKeys: Set<string> = new Set<string>();

  public reset(): void {
    this.sets = new Map<string, Set<string>>();
    this.zsets = new Map<string, Map<string, number>>();
    this.failingKeys = new Set<string>();
    this.connected = true;
  }

  public zadd(key: string, score: number, member: string): void {
    const zset: Map<string, number> =
      this.zsets.get(key) || new Map<string, number>();
    zset.set(member, score);
    this.zsets.set(key, zset);
  }

  public sadd(key: string, member: string): void {
    const set: Set<string> = this.sets.get(key) || new Set<string>();
    set.add(member);
    this.sets.set(key, set);
  }

  public client(): unknown {
    return {
      smembers: (key: string): Promise<Array<string>> => {
        return Promise.resolve(Array.from(this.sets.get(key) || []));
      },
      srem: (key: string, member: string): Promise<number> => {
        return Promise.resolve(this.sets.get(key)?.delete(member) ? 1 : 0);
      },
      exists: (key: string): Promise<number> => {
        if (this.failingKeys.has(key)) {
          return Promise.reject(new Error("redis exploded"));
        }

        return Promise.resolve(this.zsets.has(key) ? 1 : 0);
      },
      zrangebyscore: (
        key: string,
        _min: string,
        max: number,
        _limitToken: string,
        offset: number,
        count: number,
      ): Promise<Array<string>> => {
        const zset: Map<string, number> | undefined = this.zsets.get(key);

        if (!zset) {
          return Promise.resolve([]);
        }

        const matched: Array<string> = Array.from(zset.entries())
          .filter(([, score]: [string, number]): boolean => {
            return score <= max;
          })
          .sort(([, a]: [string, number], [, b]: [string, number]): number => {
            return a - b;
          })
          .map(([member]: [string, number]): string => {
            return member;
          });

        return Promise.resolve(matched.slice(offset, offset + count));
      },
      zrem: (key: string, members: Array<string>): Promise<number> => {
        const zset: Map<string, number> | undefined = this.zsets.get(key);

        if (!zset) {
          return Promise.resolve(0);
        }

        let removed: number = 0;

        for (const member of members) {
          if (zset.delete(member)) {
            removed++;
          }
        }

        /* Redis drops an emptied sorted set outright. */
        if (zset.size === 0) {
          this.zsets.delete(key);
        }

        return Promise.resolve(removed);
      },
      zcard: (key: string): Promise<number> => {
        return Promise.resolve(this.zsets.get(key)?.size || 0);
      },
    };
  }
}

const mockRedis: MockRedis = new MockRedis();

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return mockRedis.connected ? mockRedis.client() : null;
      },
      isConnected: (): boolean => {
        return mockRedis.connected;
      },
    },
  };
});

import { pruneAbandonedSessionActivity } from "../../FeatureSet/Workers/Jobs/Rum/CleanupStaleResources";
import {
  SESSION_REPLAY_ACTIVE_PROJECTS_KEY,
  SESSION_REPLAY_ACTIVITY_ABANDON_MS,
  getActiveSessionsKey,
} from "../../FeatureSet/Workers/Jobs/Rum/FinalizeSessions";

const projectId: string = "6600000000000000000000a1";
const otherProjectId: string = "6600000000000000000000c3";

type SpiedFn = ReturnType<typeof jest.fn>;

let warn: SpiedFn;

function indexed(): Array<string> {
  return Array.from(
    mockRedis.sets.get(SESSION_REPLAY_ACTIVE_PROJECTS_KEY) || [],
  );
}

beforeEach(() => {
  mockRedis.reset();
  warn = jest.spyOn(logger, "warn").mockImplementation((() => {
    return undefined;
  }) as never) as unknown as SpiedFn;
  jest.spyOn(logger, "debug").mockImplementation((() => {
    return undefined;
  }) as never);
  jest.spyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Rum:CleanupStaleResources activity prune", () => {
  test("a project whose sorted set drained is dropped from the index WITHOUT the 'unrecoverable' alarm", async () => {
    /*
     * The finalizer ZREMs a project's last member on one run and only
     * prunes the index on a later one; both jobs run every five minutes,
     * so this job routinely sees an indexed project with no key. That is
     * the healthy path, and it used to log that recordings were lost and
     * the finalizer was failing.
     */
    mockRedis.sadd(SESSION_REPLAY_ACTIVE_PROJECTS_KEY, projectId);

    const removed: number = await pruneAbandonedSessionActivity();

    expect(removed).toBe(0);
    expect(indexed()).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  test("entries older than the abandon window are reaped; newer ones are left to the finalizer", async () => {
    const activeKey: string = getActiveSessionsKey(projectId);
    const now: number = Date.now();

    mockRedis.sadd(SESSION_REPLAY_ACTIVE_PROJECTS_KEY, projectId);
    mockRedis.zadd(
      activeKey,
      now - SESSION_REPLAY_ACTIVITY_ABANDON_MS - 60_000,
      "old-session:tab-a",
    );
    mockRedis.zadd(activeKey, now - 30_000, "live-session:tab-a");

    const removed: number = await pruneAbandonedSessionActivity();

    expect(removed).toBe(1);
    expect(Array.from(mockRedis.zsets.get(activeKey)?.keys() || [])).toEqual([
      "live-session:tab-a",
    ]);

    /* The project still has work queued, so it stays indexed. */
    expect(indexed()).toEqual([projectId]);

    /* A real reap IS reported, and the copy says what happens next. */
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("sweep");
    expect(String(warn.mock.calls[0]![0])).not.toContain("unrecoverable");
  });

  test("a project emptied by the reap is dropped from the index", async () => {
    const activeKey: string = getActiveSessionsKey(projectId);

    mockRedis.sadd(SESSION_REPLAY_ACTIVE_PROJECTS_KEY, projectId);
    mockRedis.zadd(
      activeKey,
      Date.now() - SESSION_REPLAY_ACTIVITY_ABANDON_MS - 60_000,
      "old-session:tab-a",
    );

    const removed: number = await pruneAbandonedSessionActivity();

    expect(removed).toBe(1);
    expect(mockRedis.zsets.has(activeKey)).toBe(false);
    expect(indexed()).toEqual([]);
  });

  test("the reap is capped per project so one project cannot monopolise a run", async () => {
    const activeKey: string = getActiveSessionsKey(projectId);
    const abandonedAt: number =
      Date.now() - SESSION_REPLAY_ACTIVITY_ABANDON_MS - 60_000;

    mockRedis.sadd(SESSION_REPLAY_ACTIVE_PROJECTS_KEY, projectId);

    for (let index: number = 0; index < 5_010; index++) {
      mockRedis.zadd(activeKey, abandonedAt - index, `session-${index}:tab`);
    }

    const removed: number = await pruneAbandonedSessionActivity();

    expect(removed).toBe(5_000);
    expect(mockRedis.zsets.get(activeKey)?.size).toBe(10);
    /* Work remains, so the project stays indexed for the next run. */
    expect(indexed()).toEqual([projectId]);
  });

  test("a failure on one project does not stop the others from being pruned", async () => {
    const failingKey: string = getActiveSessionsKey(projectId);
    const healthyKey: string = getActiveSessionsKey(otherProjectId);

    mockRedis.sadd(SESSION_REPLAY_ACTIVE_PROJECTS_KEY, projectId);
    mockRedis.sadd(SESSION_REPLAY_ACTIVE_PROJECTS_KEY, otherProjectId);
    mockRedis.failingKeys.add(failingKey);
    mockRedis.zadd(
      healthyKey,
      Date.now() - SESSION_REPLAY_ACTIVITY_ABANDON_MS - 60_000,
      "old-session:tab-a",
    );

    const removed: number = await pruneAbandonedSessionActivity();

    expect(removed).toBe(1);
    /* The failing project is left indexed to be retried. */
    expect(indexed()).toEqual([projectId]);
  });

  test("the prune is a no-op rather than a throw when Redis is down", async () => {
    mockRedis.connected = false;

    await expect(pruneAbandonedSessionActivity()).resolves.toBe(0);
  });
});
