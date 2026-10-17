jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
    },
  };
});

import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import GlobalOidcProjectService from "../../../Server/Services/GlobalOidcProjectService";
import GlobalOidcService from "../../../Server/Services/GlobalOidcService";
import GlobalSsoProjectService from "../../../Server/Services/GlobalSsoProjectService";
import GlobalSsoService from "../../../Server/Services/GlobalSsoService";
import ProjectOidcService from "../../../Server/Services/ProjectOidcService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProjectSsoService from "../../../Server/Services/ProjectSsoService";
import { ExpressRequest } from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import RealtimeAccessChanges, {
  RealtimeAccessChangeKind,
} from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import SsoAuthorizationException from "../../../Types/Exception/SsoAuthorizationException";
import ObjectID from "../../../Types/ObjectID";
import { UserTenantAccessPermission } from "../../../Types/Permission";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import InMemoryLocks from "../TestingUtils/InMemoryLocks";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { clientTimeout } from "../TestingUtils/StatementFailures";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * THE SERVER'S REQUIRE SSO FOR LOGIN, AS A SERVER KEEPS IT.
 *
 * Every request in a project that does not require SSO itself asks
 * GlobalConfigService whether the whole server does (Admin Dashboard >
 * Settings > Authentication). The answer is kept for a minute on each
 * server, and read from the settings row when that minute runs out - or when
 * the rule changes: the server that writes it forgets its copy, and tells
 * every other server to forget theirs (RealtimeAccessChanges), so a page
 * signed in with a password is refused at once everywhere once the rule is
 * turned on, and its open live updates are asked again.
 *
 * A read that was on the wire while the rule changed read the row as it was
 * before. It answers the request that made it - that request was asked
 * before the change - but it is never kept: kept, it would put the old rule
 * back on that server for the rest of the minute, and let every session
 * that never signed in with SSO into every project there. Questions asked at
 * once share one read (the minute running out under load, or every open
 * page asked again after a change), and a read that fails is no answer: it
 * fails every question that waited on it, and keeps nothing.
 *
 * The settings row is held in memory (InMemoryRepository) behind the real
 * GlobalConfigService; the rule is written through its real update path -
 * its hooks, the check that every project keeps a way in under the lock on
 * the server's sign-in rules (InMemoryLocks), and the announcement every
 * server forgets its copy by.
 */

const id: (n: number) => string = (n: number): string => {
  return `5c000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
};

const CONFIG_ID: string = ObjectID.getZeroObjectID().toString();

// A project that does not require SSO itself, and a member of it.
const PROJECT_ID: string = id(1);
const MEMBER_ID: ObjectID = new ObjectID(id(100));

// The server's Global SSO provider: on, and signing people in to every project.
const GLOBAL_SAML: string = id(21);

let config: InMemoryTable;

// How many times the settings row was read.
let configReads: number = 0;

// What the next read of the settings row fails with, when it fails.
let nextConfigReadFails: Error | null = null;

/*
 * Holds the next read of the settings row once it has read the row, until
 * the test lets it answer: a read that was on the wire while something
 * changed.
 */
let holdNextRead: Promise<void> | null = null;

// Waits, a tick at a time, for something the code under test does without being awaited.
const until: (condition: () => boolean) => Promise<void> = async (
  condition: () => boolean,
): Promise<void> => {
  for (let tick: number = 0; tick < 1000 && !condition(); tick++) {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 1);
    });
  }

  expect(condition()).toBe(true);
};

// A read of the settings row that is held on the wire until `answer` is called.
const holdTheNextRead: () => { answer: () => void } = (): {
  answer: () => void;
} => {
  let answer: () => void = (): void => {
    return undefined;
  };

  holdNextRead = new Promise<void>((resolve: () => void): void => {
    answer = resolve;
  });

  return {
    answer: (): void => {
      answer();
    },
  };
};

const projectRow: (projectId: string) => StoredRow = (
  projectId: string,
): StoredRow => {
  return {
    _id: projectId,
    name: "Acme",
    slug: `acme-${projectId}`,
    requireSsoForLogin: false,
    requireSsoWithSsoProviderId: null,
    paymentProviderCustomerId: "cus_test",
    smsOrCallCurrentBalanceInUSDCents: 0,
    enableAutoRechargeSmsOrCallBalance: false,
    autoRechargeSmsOrCallByBalanceInUSD: 20,
    autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 10,
  };
};

// A server admin writes the server's Require SSO for Login, through the real update path.
const saveServerRule: (requireSsoForLogin: boolean) => Promise<void> = async (
  requireSsoForLogin: boolean,
): Promise<void> => {
  await GlobalConfigService.updateOneById({
    id: new ObjectID(CONFIG_ID),
    data: { requireSsoForLogin } as never,
    props: { isRoot: true },
  });
};

// Another server wrote the rule, and told every server to forget its copy.
const anotherServerChangedTheRule: (requireSsoForLogin: boolean) => void = (
  requireSsoForLogin: boolean,
): void => {
  config.get(CONFIG_ID)!["requireSsoForLogin"] = requireSsoForLogin;

  RealtimeAccessChanges.apply({
    kind: RealtimeAccessChangeKind.SignInRulesChanged,
  });
};

/*
 * A request of the member, signed in with a password - a session and no SSO
 * sign-in - in the project, as every API request asks it.
 */
const openProjectWithAPassword: () => Promise<string> =
  async (): Promise<string> => {
    const request: ExpressRequest = {
      headers: {},
      cookies: {},
      userAuthorization: { isMasterAdmin: false },
    } as unknown as ExpressRequest;

    try {
      await UserMiddleware.getUserTenantAccessPermissionWithTenantId({
        req: request,
        tenantId: new ObjectID(PROJECT_ID),
        userId: MEMBER_ID,
      });

      return "opened";
    } catch (err) {
      if (err instanceof SsoAuthorizationException) {
        return "asked to sign in with SSO";
      }

      throw err;
    }
  };

beforeEach(() => {
  setTestBillingEnabled(false);
  configReads = 0;
  nextConfigReadFails = null;
  holdNextRead = null;

  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  new InMemoryLocks().install();

  config = useInMemoryTable(GlobalConfigService, [
    { _id: CONFIG_ID, requireSsoForLogin: false },
  ]);
  useInMemoryTable(ProjectService, [projectRow(PROJECT_ID)]);
  useInMemoryTable(ProjectSsoService, []);
  useInMemoryTable(ProjectOidcService, []);
  useInMemoryTable(GlobalSsoService, [
    {
      _id: GLOBAL_SAML,
      isEnabled: true,
      restrictToAttachedProjects: false,
      name: "Company IdP",
      signInsEndedAt: null,
    },
  ]);
  useInMemoryTable(GlobalOidcService, []);
  useInMemoryTable(GlobalSsoProjectService, []);
  useInMemoryTable(GlobalOidcProjectService, []);

  // Every read of the settings row is counted, fails when the test says so, and is held when it says so.
  const read: (...args: Array<unknown>) => unknown =
    config.repository.find.getMockImplementation()!;

  config.repository.find.mockImplementation(
    async (...args: Array<unknown>): Promise<unknown> => {
      configReads++;

      if (nextConfigReadFails) {
        const failure: Error = nextConfigReadFails;
        nextConfigReadFails = null;
        throw failure;
      }

      // The row as it is now, answered when the test lets the read answer.
      const rows: Promise<unknown> = read(...args) as Promise<unknown>;

      if (holdNextRead) {
        const hold: Promise<void> = holdNextRead;
        holdNextRead = null;
        await hold;
      }

      return await rows;
    },
  );

  // The member's permissions in the project, which is not blocked.
  getJestSpyOn(
    AccessTokenService,
    "getUserTenantAccessPermission",
  ).mockResolvedValue({
    projectId: new ObjectID(PROJECT_ID),
    permissions: [],
  } as unknown as UserTenantAccessPermission);
  getJestSpyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);

  // Each test starts as a server whose minute has run out.
  GlobalConfigService.forgetSignInRules();
  ProjectService.forgetSignInRules();
});

afterEach(() => {
  GlobalConfigService.forgetSignInRules();
  ProjectService.forgetSignInRules();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("the server's Require SSO for Login, as a server keeps it", () => {
  test("one read of the settings row answers, and is kept for the minute", async () => {
    await expect(GlobalConfigService.getRequireSsoForLogin()).resolves.toBe(
      false,
    );
    await expect(GlobalConfigService.getRequireSsoForLogin()).resolves.toBe(
      false,
    );

    config.get(CONFIG_ID)!["requireSsoForLogin"] = true;
    GlobalConfigService.forgetSignInRules();

    await expect(GlobalConfigService.getRequireSsoForLogin()).resolves.toBe(
      true,
    );
    await expect(GlobalConfigService.getRequireSsoForLogin()).resolves.toBe(
      true,
    );

    expect(configReads).toBe(2);
  });

  test("a server with no settings row does not require SSO, and that is kept too", async () => {
    config.rows.length = 0;

    await expect(GlobalConfigService.getRequireSsoForLogin()).resolves.toBe(
      false,
    );
    await expect(GlobalConfigService.getRequireSsoForLogin()).resolves.toBe(
      false,
    );

    expect(configReads).toBe(1);
  });

  test("a read that fails throws, and keeps nothing: the next question reads again", async () => {
    config.get(CONFIG_ID)!["requireSsoForLogin"] = true;
    nextConfigReadFails = clientTimeout();

    await expect(GlobalConfigService.getRequireSsoForLogin()).rejects.toThrow(
      "Query read timeout",
    );

    // The database answers again: the rule as it is, never a guess.
    await expect(GlobalConfigService.getRequireSsoForLogin()).resolves.toBe(
      true,
    );
    await expect(GlobalConfigService.getRequireSsoForLogin()).resolves.toBe(
      true,
    );

    expect(configReads).toBe(2);
  });

  test("questions asked at once - every open page asked again after a change - read the row once, and share its answer", async () => {
    config.get(CONFIG_ID)!["requireSsoForLogin"] = true;

    const answers: Array<boolean> = await Promise.all(
      Array.from({ length: 25 }, (): Promise<boolean> => {
        return GlobalConfigService.getRequireSsoForLogin();
      }),
    );

    expect(new Set(answers)).toEqual(new Set([true]));
    expect(configReads).toBe(1);
  });

  test("a read that fails fails every question that waited on it, and keeps nothing", async () => {
    nextConfigReadFails = clientTimeout();

    const answers: Array<PromiseSettledResult<boolean>> =
      await Promise.allSettled([
        GlobalConfigService.getRequireSsoForLogin(),
        GlobalConfigService.getRequireSsoForLogin(),
        GlobalConfigService.getRequireSsoForLogin(),
      ]);

    expect(
      answers.map((answer: PromiseSettledResult<boolean>): string => {
        return answer.status;
      }),
    ).toEqual(["rejected", "rejected", "rejected"]);
    expect(configReads).toBe(1);

    await expect(GlobalConfigService.getRequireSsoForLogin()).resolves.toBe(
      false,
    );
    expect(configReads).toBe(2);
  });

  test("a read under way when another server says the rule changed answers its own caller, and is not kept: the next question reads the rule as it is now", async () => {
    const read: { answer: () => void } = holdTheNextRead();

    // A request starts reading the rule, which is off.
    const underWay: Promise<boolean> =
      GlobalConfigService.getRequireSsoForLogin();

    await until((): boolean => {
      return configReads === 1;
    });

    // Meanwhile a server admin turns it on elsewhere, and every server forgets its copy.
    anotherServerChangedTheRule(true);

    read.answer();

    // The read answers its own caller with what it read...
    await expect(underWay).resolves.toBe(false);

    // ...but does not put the old rule back for the minute.
    await expect(GlobalConfigService.getRequireSsoForLogin()).resolves.toBe(
      true,
    );
    expect(configReads).toBe(2);
  });

  test("a read under way when this server writes the rule on answers its own caller, and is not kept", async () => {
    const read: { answer: () => void } = holdTheNextRead();

    const underWay: Promise<boolean> =
      GlobalConfigService.getRequireSsoForLogin();

    await until((): boolean => {
      return configReads === 1;
    });

    // A server admin turns it on here, through the real update path.
    await saveServerRule(true);
    expect(config.get(CONFIG_ID)!["requireSsoForLogin"]).toBe(true);

    read.answer();

    await expect(underWay).resolves.toBe(false);
    await expect(GlobalConfigService.getRequireSsoForLogin()).resolves.toBe(
      true,
    );
  });

  test("a read under way when the rule is turned off is not kept either: people are let back in at once", async () => {
    config.get(CONFIG_ID)!["requireSsoForLogin"] = true;

    const read: { answer: () => void } = holdTheNextRead();

    const underWay: Promise<boolean> =
      GlobalConfigService.getRequireSsoForLogin();

    await until((): boolean => {
      return configReads === 1;
    });

    anotherServerChangedTheRule(false);

    read.answer();

    await expect(underWay).resolves.toBe(true);
    await expect(GlobalConfigService.getRequireSsoForLogin()).resolves.toBe(
      false,
    );
  });

  test("a question asked after the change does not wait on the read that was under way: it reads the rule as it is now", async () => {
    const read: { answer: () => void } = holdTheNextRead();

    const underWay: Promise<boolean> =
      GlobalConfigService.getRequireSsoForLogin();

    await until((): boolean => {
      return configReads === 1;
    });

    anotherServerChangedTheRule(true);

    // Asked while the old read is still on the wire.
    await expect(GlobalConfigService.getRequireSsoForLogin()).resolves.toBe(
      true,
    );
    expect(configReads).toBe(2);

    read.answer();

    await expect(underWay).resolves.toBe(false);

    // The read that answered last is the old one: it does not replace the rule kept since.
    await expect(GlobalConfigService.getRequireSsoForLogin()).resolves.toBe(
      true,
    );
    expect(configReads).toBe(2);
  });
});

describe("a session signed in with a password, while the server's Require SSO for Login is turned on", () => {
  test("a request whose read of the rule was under way at the change is answered by what it read; every request after it is asked to sign in with SSO", async () => {
    const read: { answer: () => void } = holdTheNextRead();

    // A request of the member starts, and reads the server's rule: off.
    const firstRequest: Promise<string> = openProjectWithAPassword();

    await until((): boolean => {
      return configReads === 1;
    });

    // Meanwhile a server admin turns it on here.
    await saveServerRule(true);

    read.answer();

    // The request asked before the change...
    await expect(firstRequest).resolves.toBe("opened");

    // ...and every request after it, at once: the old rule was not kept.
    await expect(openProjectWithAPassword()).resolves.toBe(
      "asked to sign in with SSO",
    );
    await expect(openProjectWithAPassword()).resolves.toBe(
      "asked to sign in with SSO",
    );
  });

  test("the same when another server turned it on", async () => {
    const read: { answer: () => void } = holdTheNextRead();

    const firstRequest: Promise<string> = openProjectWithAPassword();

    await until((): boolean => {
      return configReads === 1;
    });

    anotherServerChangedTheRule(true);

    read.answer();

    await expect(firstRequest).resolves.toBe("opened");
    await expect(openProjectWithAPassword()).resolves.toBe(
      "asked to sign in with SSO",
    );
  });

  test("with no change, the rule read once answers every request for the minute", async () => {
    await expect(openProjectWithAPassword()).resolves.toBe("opened");
    await expect(openProjectWithAPassword()).resolves.toBe("opened");

    expect(configReads).toBe(1);
  });
});
