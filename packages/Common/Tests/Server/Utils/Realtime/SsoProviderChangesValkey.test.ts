import type RealtimeAccessChangesType from "../../../../Server/Utils/Realtime/RealtimeAccessChanges";
import type ProjectSsoProviderChangesType from "../../../../Server/Utils/ProjectSsoProviderChanges";
import type SsoRequirementChangesType from "../../../../Server/Utils/SsoRequirementChanges";
import type CreateBy from "../../../../Server/Types/Database/CreateBy";
import type { OnCreate } from "../../../../Server/Types/Database/Hooks";
import type Project from "../../../../Models/DatabaseModels/Project";
import type ProjectSsoProviderStandingType from "../../../../Server/Utils/ProjectSsoProviderStanding";
import type {
  ProjectSsoProviderStandingValue,
  ProjectSsoProviderType,
} from "../../../../Server/Utils/ProjectSsoProviderStanding";
import type * as GlobalSsoAuthorizationType from "../../../../Server/Utils/GlobalSsoAuthorization";
import type RedisType from "../../../../Server/Infrastructure/Redis";
import type SemaphoreType from "../../../../Server/Infrastructure/Semaphore";
import type { SemaphoreMutex } from "../../../../Server/Infrastructure/Semaphore";
import ObjectID from "../../../../Types/ObjectID";
import SsoProviderType from "../../../../Types/SSO/SsoProviderType";
import getTestRedisConnectionOptions from "../../TestingUtils/Redis/TestRedisOptions";
import { clientTimeout } from "../../TestingUtils/StatementFailures";
import { getJestSpyOn } from "../../../Spy";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { Redis as RedisClient } from "ioredis";

/*
 * TWO SERVERS, ONE VALKEY: a project's SSO provider turned off or deleted on
 * one server ends the live updates its sign-ins hold on the other, and the
 * other stops answering for it from memory.
 *
 * Each "server" is its own copy of the modules involved (jest.isolateModules)
 * with its own Valkey connection, as two app servers have, on the Valkey the
 * Common suites run against (TestRedisOptions; set
 * REALTIME_ACCESS_CHANGES_TEST_REDIS_URL to use another).
 *
 * Server A runs what the provider services run after a write
 * (ProjectSsoProviderChanges.afterUpdate / afterDelete). Server B holds an
 * answer about the provider in its cache, as it does after a request, and
 * the live updates open in the project: on hearing A, it forgets its
 * answers about that project's providers (ProjectService.forgetSignInRules,
 * here the part of it this suite is about) and asks the live updates in the
 * project again (Realtime.recheckSignInRules, here a listener recording the
 * call; Realtime.test runs the real one). Realtime.test and
 * UserAuthorizationProjectSsoProvider.test cover what each server then
 * decides.
 */

/*
 * The services the modules below import. Nothing here reads the database:
 * the decisions are the other suites' subject.
 */
jest.mock("../../../../Server/Services/ProjectService", () => {
  return { __esModule: true, default: { forgetSignInRules: jest.fn() } };
});
jest.mock("../../../../Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      forgetSignInRules: jest.fn(),
      // The server's Require SSO for Login, off: a project created now needs no provider.
      findOneBy: jest.fn(async () => {
        return { requireSsoForLogin: false };
      }),
    },
  };
});
jest.mock("../../../../Server/Services/ProjectSsoService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/ProjectOidcService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/GlobalSsoService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/GlobalOidcService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/GlobalSsoProjectService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/GlobalOidcProjectService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/TeamMemberService", () => {
  return { __esModule: true, default: { forgetTeamIdsForUser: jest.fn() } };
});
jest.mock("../../../../Server/Services/UserService", () => {
  return { __esModule: true, default: { forgetBlockedStatus: jest.fn() } };
});

interface Server {
  changes: typeof RealtimeAccessChangesType;
  providerChanges: typeof ProjectSsoProviderChangesType;
  requirementChanges: typeof SsoRequirementChangesType;
  semaphore: typeof SemaphoreType;
  standing: typeof ProjectSsoProviderStandingType;
  globalSso: typeof GlobalSsoAuthorizationType;
  client: RedisClient;
  // The projects whose live updates this server asked again (undefined: every one).
  rechecked: Array<string | undefined>;
  // The times this server forgot what it knew of the global providers.
  globalForgets: number;
}

const redisUrl: string | undefined =
  process.env["REALTIME_ACCESS_CHANGES_TEST_REDIS_URL"];

function connection(): RedisClient {
  return redisUrl
    ? new RedisClient(redisUrl, { lazyConnect: true })
    : new RedisClient(getTestRedisConnectionOptions());
}

async function startServer(): Promise<Server> {
  let server: Server | null = null;

  jest.isolateModules((): void => {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    const redis: typeof RedisType =
      require("../../../../Server/Infrastructure/Redis").default;
    const changes: typeof RealtimeAccessChangesType =
      require("../../../../Server/Utils/Realtime/RealtimeAccessChanges").default;
    const providerChanges: typeof ProjectSsoProviderChangesType =
      require("../../../../Server/Utils/ProjectSsoProviderChanges").default;
    const requirementChanges: typeof SsoRequirementChangesType =
      require("../../../../Server/Utils/SsoRequirementChanges").default;
    const standing: typeof ProjectSsoProviderStandingType =
      require("../../../../Server/Utils/ProjectSsoProviderStanding").default;
    const globalSso: typeof GlobalSsoAuthorizationType = require("../../../../Server/Utils/GlobalSsoAuthorization");
    const semaphore: typeof SemaphoreType =
      require("../../../../Server/Infrastructure/Semaphore").default;
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

    const client: RedisClient = connection();

    getJestSpyOn(redis, "getClient").mockReturnValue(client);
    getJestSpyOn(redis, "isConnected").mockReturnValue(true);

    const created: Server = {
      changes,
      providerChanges,
      requirementChanges,
      semaphore,
      standing,
      globalSso,
      client,
      rechecked: [],
      globalForgets: 0,
    };

    /*
     * This server's ProjectService and GlobalConfigService, as far as a
     * sign-in change goes: they forget this server's answers (the real
     * ProjectService.forgetSignInRules forgets the project's provider
     * answers the same way; UserAuthorizationProjectSsoProvider.test runs
     * it).
     */
    getJestSpyOn(changes, "getProjectService").mockReturnValue({
      forgetSignInRules: (projectId?: ObjectID): void => {
        standing.forget(projectId);
      },
    });
    getJestSpyOn(changes, "getGlobalConfigService").mockReturnValue({
      forgetSignInRules: (): void => {
        created.globalForgets++;
      },
    });

    // What Realtime registers: ask the live updates held here again.
    changes.onSignInRulesChanged((projectId?: string): void => {
      created.rechecked.push(projectId);
    });

    server = created;
  });

  await server!.client.connect();
  await server!.changes.listen();

  return server!;
}

async function eventually(
  condition: () => boolean,
  timeoutMs: number = 5000,
): Promise<boolean> {
  const startedAt: number = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) {
      return true;
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 20);
    });
  }

  return condition();
}

async function pause(ms: number): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
}

// Long enough for a message published now to have reached every server.
async function quietPeriod(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 300);
  });
}

const ON: ProjectSsoProviderStandingValue = {
  isOn: true,
  signInsEndedAtMs: null,
};

/*
 * Whether a server answers about the provider from memory: it asks `load`
 * only when it does not.
 */
async function answersFromMemory(
  server: Server,
  data: {
    projectId: ObjectID;
    providerId: ObjectID;
    providerType: ProjectSsoProviderType;
  },
): Promise<boolean> {
  let loaded: boolean = false;

  await server.standing.get({
    ...data,
    load: async (): Promise<ProjectSsoProviderStandingValue> => {
      loaded = true;
      return ON;
    },
  });

  return !loaded;
}

describe("project SSO provider changes reach every server through Valkey", () => {
  let serverA: Server;
  let serverB: Server;

  beforeAll(async () => {
    serverA = await startServer();
    serverB = await startServer();
  }, 30_000);

  afterAll(async () => {
    for (const server of [serverA, serverB]) {
      if (!server) {
        continue;
      }

      await server.changes.stopListening();
      server.standing.forget();
      server.client.disconnect();
    }

    jest.restoreAllMocks();
  });

  const reset: () => void = (): void => {
    for (const server of [serverA, serverB]) {
      server.rechecked = [];
      server.globalForgets = 0;
      server.standing.forget();
    }
  };

  test("a provider turned off on one server: the other forgets its answers about the project and asks the project's live updates again", async () => {
    reset();

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const providerId: ObjectID = ObjectID.generate();
    const provider: {
      projectId: ObjectID;
      providerId: ObjectID;
      providerType: ProjectSsoProviderType;
    } = {
      projectId,
      providerId,
      providerType: SsoProviderType.ProjectSSO,
    };
    const otherProjectsProvider: {
      projectId: ObjectID;
      providerId: ObjectID;
      providerType: ProjectSsoProviderType;
    } = {
      projectId: otherProjectId,
      providerId: ObjectID.generate(),
      providerType: SsoProviderType.ProjectOIDC,
    };

    // Server B answered requests about both providers a moment ago.
    await answersFromMemory(serverB, provider);
    await answersFromMemory(serverB, otherProjectsProvider);
    await expect(answersFromMemory(serverB, provider)).resolves.toBe(true);

    // Server A turns the provider off.
    await serverA.providerChanges.afterUpdate({
      write: {
        takenAway: [
          {
            id: providerId.toString(),
            projectId: projectId.toString(),
            isOn: true,
          },
        ],
        turnedOn: [],
      },
      updatedItemIds: [providerId],
    });

    await expect(
      eventually((): boolean => {
        return serverB.rechecked.includes(projectId.toString());
      }),
    ).resolves.toBe(true);

    // B reads the provider again before it answers for it.
    await expect(answersFromMemory(serverB, provider)).resolves.toBe(false);
    // Another project's answers stay.
    await expect(
      answersFromMemory(serverB, otherProjectsProvider),
    ).resolves.toBe(true);
    expect(serverB.rechecked).toEqual([projectId.toString()]);

    // A asked its own live updates again too, once: not again for Valkey's echo.
    await quietPeriod();
    expect(serverA.rechecked).toEqual([projectId.toString()]);
  });

  test("a provider deleted on one server reaches the other the same way", async () => {
    reset();

    const projectId: ObjectID = ObjectID.generate();
    const providerId: ObjectID = ObjectID.generate();
    const provider: {
      projectId: ObjectID;
      providerId: ObjectID;
      providerType: ProjectSsoProviderType;
    } = {
      projectId,
      providerId,
      providerType: SsoProviderType.ProjectOIDC,
    };

    await answersFromMemory(serverB, provider);

    await serverA.providerChanges.afterDelete({
      write: {
        takenAway: [
          {
            id: providerId.toString(),
            projectId: projectId.toString(),
            isOn: true,
          },
        ],
        turnedOn: [],
      },
      deletedItemIds: [providerId],
    });

    await expect(
      eventually((): boolean => {
        return serverB.rechecked.includes(projectId.toString());
      }),
    ).resolves.toBe(true);

    await expect(answersFromMemory(serverB, provider)).resolves.toBe(false);
  });

  test("a write that turned no provider off or on tells no server", async () => {
    reset();

    const projectId: ObjectID = ObjectID.generate();
    const providerId: ObjectID = ObjectID.generate();
    const provider: {
      projectId: ObjectID;
      providerId: ObjectID;
      providerType: ProjectSsoProviderType;
    } = {
      projectId,
      providerId,
      providerType: SsoProviderType.ProjectSSO,
    };

    await answersFromMemory(serverB, provider);

    // A new certificate: the hooks found nothing to announce.
    await serverA.providerChanges.afterUpdate({
      write: null,
      updatedItemIds: [providerId],
    });
    // A write that did not reach the row it named.
    await serverA.providerChanges.afterUpdate({
      write: {
        takenAway: [
          {
            id: providerId.toString(),
            projectId: projectId.toString(),
            isOn: true,
          },
        ],
        turnedOn: [],
      },
      updatedItemIds: [],
    });

    await quietPeriod();

    expect(serverA.rechecked).toEqual([]);
    expect(serverB.rechecked).toEqual([]);
    await expect(answersFromMemory(serverB, provider)).resolves.toBe(true);
  });

  test("a global provider turned off on one server: every server forgets what it knew of the global providers and asks every live update again", async () => {
    reset();

    serverA.globalSso.announceGlobalSignInChange();

    await expect(
      eventually((): boolean => {
        return serverB.rechecked.includes(undefined);
      }),
    ).resolves.toBe(true);

    expect(serverB.globalForgets).toBe(1);
    expect(serverB.rechecked).toEqual([undefined]);

    await quietPeriod();
    expect(serverA.globalForgets).toBe(1);
    expect(serverA.rechecked).toEqual([undefined]);
  });

  /*
   * Every change to who can sign in - a global provider or one of its
   * attachments, Require SSO for Login for a project or the server, a
   * project's provider taken away - is checked and written under the lock
   * on the server's sign-in rules (ProjectSsoProviderChanges.
   * lockSignInChange), held in Valkey: one server's change waits for
   * another's to be written, so neither is checked against what the other
   * is about to change.
   */
  test("a change to who can sign in on one server waits for another server's to be written", async () => {
    const projectId: ObjectID = ObjectID.generate();

    // Server A checks a change to the global providers, and holds the lock.
    const heldByA: Array<SemaphoreMutex> =
      await serverA.providerChanges.lockSignInChange({
        projectIds: [],
        wholeServer: true,
      });
    expect(heldByA).toHaveLength(1);

    // Server B turns Require SSO for Login on for a project meanwhile.
    let heldByB: Array<SemaphoreMutex> | null = null;
    const waitingB: Promise<void> = serverB.providerChanges
      .lockSignInChange({
        projectIds: [projectId.toString()],
        wholeServer: true,
      })
      .then((locks: Array<SemaphoreMutex>): void => {
        heldByB = locks;
      });

    await quietPeriod();
    expect(heldByB).toBeNull();

    // A's change is written and its lock given back: B goes on.
    await serverA.providerChanges.releaseSignInChange(heldByA);
    await waitingB;

    expect(heldByB).toHaveLength(2);

    await serverB.providerChanges.releaseSignInChange(heldByB!);

    // Given back: the next change takes it at once.
    const next: Array<SemaphoreMutex> =
      await serverA.providerChanges.lockSignInChange({
        projectIds: [],
        wholeServer: true,
      });
    expect(next).toHaveLength(1);
    await serverA.providerChanges.releaseSignInChange(next);
  });

  /*
   * A change whose check reads many projects keeps its locks page by page
   * (Semaphore.keepLock, ProjectSsoProviderChanges.keepSignInChange): kept,
   * a lock outlasts its timeout; no longer kept - its holder's write failed
   * half way - it runs out, and another server takes it.
   */
  /*
   * The times leave a second or more either side of every edge, so a busy
   * machine whose timers fire late still sees the same order: the lock is
   * kept before it runs out (2s of 4s), looked at after it would have run
   * out unkept (5s) and before the kept time ends (6s), and taken again
   * after that (7s).
   */
  test("a lock kept by its holder outlasts its timeout; one it stops keeping runs out, and keeping it then answers that it was lost", async () => {
    const lock: {
      key: string;
      namespace: string;
      lockTimeout: number;
      refreshInterval: number;
    } = {
      key: ObjectID.generate().toString(),
      namespace: "SsoProviderChangesValkey.keep",
      lockTimeout: 4000,
      refreshInterval: 0,
    };
    const tryOnce: {
      acquireTimeout: number;
      acquireAttemptsLimit: number;
    } = { acquireTimeout: 50, acquireAttemptsLimit: 1 };

    const heldByA: SemaphoreMutex = await serverA.semaphore.lock(lock);

    await pause(2000);
    await expect(serverA.semaphore.keepLock(heldByA)).resolves.toBe(true);
    await pause(3000);

    // 5s after it was taken, past its own 4s, 3s after it was kept: still A's.
    await expect(
      serverB.semaphore.lock({ ...lock, ...tryOnce }),
    ).rejects.toThrow();

    // A stops keeping it: it runs out, and B takes it.
    await pause(2000);
    const heldByB: SemaphoreMutex = await serverB.semaphore.lock({
      ...lock,
      ...tryOnce,
    });

    await expect(serverA.semaphore.keepLock(heldByA)).resolves.toBe(false);
    await expect(serverB.semaphore.keepLock(heldByB)).resolves.toBe(true);

    await serverB.semaphore.release(heldByB);
  }, 30000);

  test("a sign-in change keeps the lock on the server's rules for another full timeout, and is refused once that lock was lost", async () => {
    const lockKey: string = "mutex:ProjectSsoProviderChanges.keepAWayIn-server";

    const held: Array<SemaphoreMutex> =
      await serverA.providerChanges.lockSignInChange({
        projectIds: [],
        wholeServer: true,
      });

    await serverA.client.pexpire(lockKey, 1000);
    await serverA.providerChanges.keepSignInChange(held);
    expect(await serverA.client.pttl(lockKey)).toBeGreaterThan(9000);

    // Valkey lost it (a restart, an eviction): what the change read may no longer hold.
    await serverA.client.del(lockKey);
    // The busy refusal, in this server's own module copy.
    await expect(
      serverA.providerChanges.keepSignInChange(held),
    ).rejects.toThrow(
      "Another change to who can sign in with SSO is being saved. Try again in a moment.",
    );

    await serverA.providerChanges.releaseSignInChange(held);
  });

  /*
   * Once its check is done, a change keeps its locks alive while it is
   * written (ProjectSsoProviderChanges.holdForWrite) - every
   * WRITE_KEEP_INTERVAL_IN_MS, however long the write takes - until they are
   * given back: it never lands once they could have run out, and no other
   * server's change to who can sign in comes between.
   *
   * The lock is cut short in Valkey right after it is held, as though it
   * were nearly out (4s): the keep 2.5s in sets it back to a full timeout,
   * so 6s in - 2s past the cut - it is still held, with seconds to spare.
   */
  test("a change being written keeps its lock alive in Valkey past the time it would have run out; another server's change waits until it is given back", async () => {
    const lockKey: string = "mutex:ProjectSsoProviderChanges.keepAWayIn-server";

    const held: Array<SemaphoreMutex> =
      await serverA.providerChanges.lockSignInChange({
        projectIds: [],
        wholeServer: true,
      });

    try {
      await serverA.providerChanges.holdForWrite(held);
      expect(serverA.providerChanges.isKeptForWrite(held[0]!)).toBe(true);

      await serverA.client.pexpire(lockKey, 4000);
      await pause(6000);

      expect(await serverA.client.pttl(lockKey)).toBeGreaterThan(5000);

      // Another server's change to who can sign in, meanwhile: it waits.
      let heldByB: Array<SemaphoreMutex> | null = null;
      const waitingB: Promise<void> = serverB.providerChanges
        .lockSignInChange({ projectIds: [], wholeServer: true })
        .then((locks: Array<SemaphoreMutex>): void => {
          heldByB = locks;
        });

      await quietPeriod();
      expect(heldByB).toBeNull();

      // Written: the lock is given back, kept no more, and B goes on.
      await serverA.providerChanges.releaseSignInChange(held);
      expect(serverA.providerChanges.isKeptForWrite(held[0]!)).toBe(false);

      await waitingB;
      expect(heldByB).toHaveLength(1);
      await serverB.providerChanges.releaseSignInChange(heldByB!);
    } finally {
      await serverA.providerChanges.releaseSignInChange(held);
    }
  }, 30000);

  test("a lock Valkey loses while its change is written is kept no more: nothing takes it back for the change", async () => {
    const lockKey: string = "mutex:ProjectSsoProviderChanges.keepAWayIn-server";

    const held: Array<SemaphoreMutex> =
      await serverA.providerChanges.lockSignInChange({
        projectIds: [],
        wholeServer: true,
      });

    try {
      await serverA.providerChanges.holdForWrite(held);

      // Valkey lost it (a restart, an eviction) while the write ran.
      await serverA.client.del(lockKey);
      await pause(4000);

      expect(serverA.providerChanges.isKeptForWrite(held[0]!)).toBe(false);
      expect(await serverA.client.exists(lockKey)).toBe(0);

      // Another server's change takes it at once.
      const next: Array<SemaphoreMutex> =
        await serverB.providerChanges.lockSignInChange({
          projectIds: [],
          wholeServer: true,
        });
      expect(next).toHaveLength(1);
      await serverB.providerChanges.releaseSignInChange(next);
    } finally {
      await serverA.providerChanges.releaseSignInChange(held);
    }
  }, 30000);

  test("a change whose lock Valkey lost before its write, with nothing to check it again with, is refused right before it, and keeps nothing alive", async () => {
    const lockKey: string = "mutex:ProjectSsoProviderChanges.keepAWayIn-server";

    const held: Array<SemaphoreMutex> =
      await serverA.providerChanges.lockSignInChange({
        projectIds: [],
        wholeServer: true,
      });

    try {
      await serverA.client.del(lockKey);

      await expect(serverA.providerChanges.holdForWrite(held)).rejects.toThrow(
        "Another change to who can sign in with SSO is being saved. Try again in a moment.",
      );
      expect(serverA.providerChanges.isKeptForWrite(held[0]!)).toBe(false);
    } finally {
      await serverA.providerChanges.releaseSignInChange(held);
    }
  });

  /*
   * A lock found gone right before the write is taken again in Valkey, and
   * the change checked again under it (its recheck: here, taking the lock
   * the way the change's check does); the change then holds it for its
   * write like any other.
   */
  test("a change whose lock Valkey lost before its write takes it again, is checked again, and holds it for the write; another server's change waits", async () => {
    const lockKey: string = "mutex:ProjectSsoProviderChanges.keepAWayIn-server";

    const held: Array<SemaphoreMutex> =
      await serverA.providerChanges.lockSignInChange({
        projectIds: [],
        wholeServer: true,
      });
    const lost: SemaphoreMutex = held[0]!;
    let rechecks: number = 0;

    try {
      // Valkey lost it (a restart, an eviction) while a slow step ran.
      await serverA.client.del(lockKey);

      await serverA.providerChanges.holdForWrite(
        held,
        async (): Promise<Array<SemaphoreMutex>> => {
          rechecks++;
          return await serverA.providerChanges.lockSignInChange({
            projectIds: [],
            wholeServer: true,
          });
        },
      );

      expect(rechecks).toBe(1);
      // Holding the lock taken again: in Valkey, and kept alive for the write.
      expect(held).toHaveLength(1);
      expect(held[0]).not.toBe(lost);
      expect(serverA.providerChanges.isKeptForWrite(held[0]!)).toBe(true);
      expect(serverA.providerChanges.isKeptForWrite(lost)).toBe(false);
      expect(await serverA.client.exists(lockKey)).toBe(1);
      expect(await serverA.client.pttl(lockKey)).toBeGreaterThan(5000);

      // Another server's change to who can sign in, meanwhile: it waits.
      let heldByB: Array<SemaphoreMutex> | null = null;
      const waitingB: Promise<void> = serverB.providerChanges
        .lockSignInChange({ projectIds: [], wholeServer: true })
        .then((locks: Array<SemaphoreMutex>): void => {
          heldByB = locks;
        });

      await quietPeriod();
      expect(heldByB).toBeNull();

      // Written: given back, and B goes on.
      await serverA.providerChanges.releaseSignInChange(held);
      await waitingB;

      expect(heldByB).toHaveLength(1);
      await serverB.providerChanges.releaseSignInChange(heldByB!);
    } finally {
      await serverA.providerChanges.releaseSignInChange(held);
    }
  }, 30000);

  test("a lock another server's change took in the moment it was lost: the change waits for it to be given back, and is checked again under it", async () => {
    const held: Array<SemaphoreMutex> =
      await serverA.providerChanges.lockSignInChange({
        projectIds: [],
        wholeServer: true,
      });
    let heldByB: Array<SemaphoreMutex> = [];
    const order: Array<string> = [];

    try {
      // Lost, and taken at once by a change on server B.
      await serverA.client.del(
        "mutex:ProjectSsoProviderChanges.keepAWayIn-server",
      );
      heldByB = await serverB.providerChanges.lockSignInChange({
        projectIds: [],
        wholeServer: true,
      });

      const holding: Promise<void> = serverA.providerChanges.holdForWrite(
        held,
        async (): Promise<Array<SemaphoreMutex>> => {
          const locks: Array<SemaphoreMutex> =
            await serverA.providerChanges.lockSignInChange({
              projectIds: [],
              wholeServer: true,
            });
          // Checked again once B's change is written: against what B wrote.
          order.push("A checked again");
          return locks;
        },
      );

      await quietPeriod();
      expect(order).toEqual([]);

      // B's change is written, and its lock given back.
      order.push("B written");
      await serverB.providerChanges.releaseSignInChange(heldByB);
      await holding;

      expect(order).toEqual(["B written", "A checked again"]);
      expect(serverA.providerChanges.isKeptForWrite(held[0]!)).toBe(true);
    } finally {
      await serverB.providerChanges.releaseSignInChange(heldByB);
      await serverA.providerChanges.releaseSignInChange(held);
    }
  }, 30000);

  /*
   * A write whose statement the client stopped waiting for may still be
   * applied by the database: its locks are not given back, and stay kept
   * alive in Valkey until the database would have cancelled it
   * (ProjectSsoProviderChanges.giveBackAfterFailedWrite). The lock is cut
   * short in Valkey as before, and still held 2s past the cut.
   */
  test("a write the database never answered keeps its lock alive in Valkey past the time it would have run out; another server's change waits", async () => {
    const lockKey: string = "mutex:ProjectSsoProviderChanges.keepAWayIn-server";

    const held: Array<SemaphoreMutex> =
      await serverA.providerChanges.lockSignInChange({
        projectIds: [],
        wholeServer: true,
      });

    try {
      await serverA.providerChanges.holdForWrite(held);

      // The client stopped waiting for the statement: the database may still run it.
      await serverA.providerChanges.giveBackAfterFailedWrite(
        held,
        clientTimeout(),
      );

      expect(await serverA.client.exists(lockKey)).toBe(1);
      expect(serverA.providerChanges.isKeptForWrite(held[0]!)).toBe(true);

      await serverA.client.pexpire(lockKey, 4000);
      await pause(6000);

      expect(await serverA.client.pttl(lockKey)).toBeGreaterThan(5000);

      let heldByB: Array<SemaphoreMutex> | null = null;
      const waitingB: Promise<void> = serverB.providerChanges
        .lockSignInChange({ projectIds: [], wholeServer: true })
        .then((locks: Array<SemaphoreMutex>): void => {
          heldByB = locks;
        });

      await quietPeriod();
      expect(heldByB).toBeNull();

      // Here the test gives it back; in the app it runs out once the statement could no longer land.
      await serverA.providerChanges.releaseSignInChange(held);
      await waitingB;

      expect(heldByB).toHaveLength(1);
      await serverB.providerChanges.releaseSignInChange(heldByB!);
    } finally {
      await serverA.providerChanges.releaseSignInChange(held);
    }
  }, 30000);

  /*
   * A project created on one server holds the lock on the server's sign-in
   * rules from its check until it is written (SsoRequirementChanges.
   * beforeProjectCreate / afterProjectCreate): a server turning Require SSO
   * for Login on, or turning a global provider off, at that moment waits,
   * and then reads the new project.
   */
  test("a project created on one server holds the lock on the server's rules until it is written; another server's change to them waits", async () => {
    const createBy: CreateBy<Project> = {
      data: {} as Project,
      props: {},
    };
    // The create's one OnCreate, which DatabaseService hands every hook after onBeforeCreate.
    const create: OnCreate<Project> = {
      createBy: createBy,
      carryForward: null,
    };

    const write: unknown = await serverA.requirementChanges.beforeProjectCreate(
      {
        create: create,
        isCreatorExemptFromServerRule: false,
      },
    );
    expect(write).not.toBeNull();

    // Server B turns the server's Require SSO for Login on meanwhile.
    let heldByB: Array<SemaphoreMutex> | null = null;
    const waitingB: Promise<void> = serverB.providerChanges
      .lockSignInChange({ projectIds: [], wholeServer: true })
      .then((locks: Array<SemaphoreMutex>): void => {
        heldByB = locks;
      });

    await quietPeriod();
    expect(heldByB).toBeNull();

    // The project is written, and its lock given back once: B goes on.
    await serverA.requirementChanges.afterProjectCreate(create);
    await serverA.requirementChanges.afterProjectCreate(create);
    await waitingB;

    expect(heldByB).toHaveLength(1);
    await serverB.providerChanges.releaseSignInChange(heldByB!);
  });

  test("a provider turned on on one server: the other forgets its answers about the project at once, rather than refusing its sign-ins for a minute", async () => {
    reset();

    const projectId: ObjectID = ObjectID.generate();
    const providerId: ObjectID = ObjectID.generate();
    const provider: {
      projectId: ObjectID;
      providerId: ObjectID;
      providerType: ProjectSsoProviderType;
    } = {
      projectId,
      providerId,
      providerType: SsoProviderType.ProjectSSO,
    };

    // Server B answered about the provider while it was off.
    await answersFromMemory(serverB, provider);

    await serverA.providerChanges.afterUpdate({
      write: {
        takenAway: [],
        turnedOn: [
          {
            id: providerId.toString(),
            projectId: projectId.toString(),
            isOn: false,
          },
        ],
      },
      updatedItemIds: [providerId],
    });

    await expect(
      eventually((): boolean => {
        return serverB.rechecked.includes(projectId.toString());
      }),
    ).resolves.toBe(true);

    await expect(answersFromMemory(serverB, provider)).resolves.toBe(false);
  });
});
