import type RealtimeAccessChangesType from "../../../../Server/Utils/Realtime/RealtimeAccessChanges";
import type ProjectSsoProviderChangesType from "../../../../Server/Utils/ProjectSsoProviderChanges";
import type ProjectSsoProviderStandingType from "../../../../Server/Utils/ProjectSsoProviderStanding";
import type {
  ProjectSsoProviderStandingValue,
  ProjectSsoProviderType,
} from "../../../../Server/Utils/ProjectSsoProviderStanding";
import type * as GlobalSsoAuthorizationType from "../../../../Server/Utils/GlobalSsoAuthorization";
import type RedisType from "../../../../Server/Infrastructure/Redis";
import type { SemaphoreMutex } from "../../../../Server/Infrastructure/Semaphore";
import ObjectID from "../../../../Types/ObjectID";
import SsoProviderType from "../../../../Types/SSO/SsoProviderType";
import getTestRedisConnectionOptions from "../../TestingUtils/Redis/TestRedisOptions";
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
  return { __esModule: true, default: { forgetSignInRules: jest.fn() } };
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
    const standing: typeof ProjectSsoProviderStandingType =
      require("../../../../Server/Utils/ProjectSsoProviderStanding").default;
    const globalSso: typeof GlobalSsoAuthorizationType = require("../../../../Server/Utils/GlobalSsoAuthorization");
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

    const client: RedisClient = connection();

    getJestSpyOn(redis, "getClient").mockReturnValue(client);
    getJestSpyOn(redis, "isConnected").mockReturnValue(true);

    const created: Server = {
      changes,
      providerChanges,
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
});
