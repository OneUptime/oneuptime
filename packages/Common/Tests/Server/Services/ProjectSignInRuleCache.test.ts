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
import CookieUtil from "../../../Server/Utils/Cookie";
import { ExpressRequest } from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import User from "../../../Models/DatabaseModels/User";
import BadDataException from "../../../Types/Exception/BadDataException";
import SsoAuthorizationException from "../../../Types/Exception/SsoAuthorizationException";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { UserTenantAccessPermission } from "../../../Types/Permission";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { REQUIRED_PROVIDER_CANNOT_SIGN_IN_MESSAGE } from "../../../Server/Utils/SsoRequirementChanges";
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
 * A PROJECT'S SIGN-IN RULE IS KEPT WHOLE.
 *
 * Every request in a project asks ProjectService two things about it: does
 * it require SSO to sign in (requireSsoForLogin), and does that sign-in have
 * to come from one provider it names (requireSsoWithSsoProviderId). Both are
 * read from the project's row by one query, and kept for a minute on each
 * server, so a request does not read the row each time.
 *
 * They are kept as one: neither is ever kept without the other. Kept apart,
 * an update of any project that wrote the provider it requires forgot every
 * project's provider on that server and kept their Require SSO, and the
 * provider was then answered as "none named" without being read - so for
 * the rest of the minute a project that names one provider took a sign-in
 * from any of its providers, or from the server's. Nor is a read that fails
 * an answer: it throws, keeps nothing, and the next question reads again.
 *
 * The rows are held in memory (InMemoryRepository) behind the real
 * ProjectService, and updates run its real update path - hooks, the checks
 * of Require SSO writes under their locks (InMemoryLocks), and the
 * announcement every server forgets its copy by.
 */

const id: (n: number) => string = (n: number): string => {
  return `5b000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
};

// Acme requires SSO from its own SAML provider; it has an OIDC provider too.
const ACME: string = id(1);
const ACME_SAML: string = id(11);
const ACME_OIDC: string = id(12);

/*
 * Beta and Gamma are other projects of the same server, with providers of
 * their own. Gamma requires SSO from any of its providers.
 */
const BETA: string = id(2);
const BETA_OIDC: string = id(21);
const GAMMA: string = id(3);
const GAMMA_SAML: string = id(31);

const MEMBER_ID: ObjectID = new ObjectID(id(100));

const CONFIG_ID: string = ObjectID.getZeroObjectID().toString();

let projects: InMemoryTable;

// How many times each project's row was read.
const rowReads: Map<string, number> = new Map();

// What the next read of the project table fails with, when it fails.
let nextProjectReadFails: Error | null = null;

const projectRow: (
  projectId: string,
  rule: { requireSsoForLogin: boolean; requiredProviderId: string | null },
) => StoredRow = (
  projectId: string,
  rule: { requireSsoForLogin: boolean; requiredProviderId: string | null },
): StoredRow => {
  return {
    _id: projectId,
    name: `Project ${projectId.slice(-2)}`,
    slug: `project-${projectId}`,
    requireSsoForLogin: rule.requireSsoForLogin,
    requireSsoWithSsoProviderId: rule.requiredProviderId
      ? new ObjectID(rule.requiredProviderId)
      : null,
    paymentProviderCustomerId: "cus_test",
    smsOrCallCurrentBalanceInUSDCents: 0,
    enableAutoRechargeSmsOrCallBalance: false,
    autoRechargeSmsOrCallByBalanceInUSD: 20,
    autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 10,
  };
};

const providerRow: (providerId: string, projectId: string) => StoredRow = (
  providerId: string,
  projectId: string,
): StoredRow => {
  return {
    _id: providerId,
    projectId: new ObjectID(projectId),
    isEnabled: true,
    name: "Okta",
    signInsEndedAt: null,
  };
};

// The id a where clause asks for, whichever way the read names it.
const idAskedFor: (where: unknown) => string | null = (
  where: unknown,
): string | null => {
  const clause: unknown = Array.isArray(where) ? where[0] : where;
  const asked: unknown =
    clause && typeof clause === "object"
      ? (clause as Record<string, unknown>)["_id"]
      : null;

  return typeof asked === "string" ? asked.toLowerCase() : null;
};

// Writes the project's rule, as its owner saves it, through the real update path.
const saveRule: (
  projectId: string,
  data: Record<string, unknown>,
) => Promise<void> = async (
  projectId: string,
  data: Record<string, unknown>,
): Promise<void> => {
  await ProjectService.updateOneById({
    id: new ObjectID(projectId),
    data: data as never,
    props: { isRoot: true },
  });
};

const pinnedProviderOf: (projectId: string) => Promise<string | null> = async (
  projectId: string,
): Promise<string | null> => {
  const providerId: ObjectID | null =
    await ProjectService.getRequireSsoWithSsoProviderId(
      new ObjectID(projectId),
    );

  return providerId ? providerId.toString().toLowerCase() : null;
};

// A request of the member's session, with a sign-in from one of Acme's own providers.
const requestSignedInWith: (
  providerId: string,
  providerType: SsoProviderType,
) => ExpressRequest = (
  providerId: string,
  providerType: SsoProviderType,
): ExpressRequest => {
  const user: User = new User();
  user.id = MEMBER_ID;
  user.email = new Email("member@example.com");
  user.name = new Name("Member");

  return {
    headers: {},
    cookies: {
      [CookieUtil.getUserSSOKey(new ObjectID(ACME))]: CookieUtil.getSSOToken({
        user: user,
        projectId: new ObjectID(ACME),
        ssoProviderId: new ObjectID(providerId),
        ssoProviderType: providerType,
      }),
    },
    userAuthorization: { isMasterAdmin: false },
  } as unknown as ExpressRequest;
};

const openAcme: (request: ExpressRequest) => Promise<string> = async (
  request: ExpressRequest,
): Promise<string> => {
  try {
    await UserMiddleware.getUserTenantAccessPermissionWithTenantId({
      req: request,
      tenantId: new ObjectID(ACME),
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
  rowReads.clear();
  nextProjectReadFails = null;

  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  new InMemoryLocks().install();

  projects = useInMemoryTable(ProjectService, [
    projectRow(ACME, {
      requireSsoForLogin: true,
      requiredProviderId: ACME_SAML,
    }),
    projectRow(BETA, { requireSsoForLogin: false, requiredProviderId: null }),
    projectRow(GAMMA, { requireSsoForLogin: true, requiredProviderId: null }),
  ]);
  useInMemoryTable(ProjectSsoService, [
    providerRow(ACME_SAML, ACME),
    providerRow(GAMMA_SAML, GAMMA),
  ]);
  useInMemoryTable(ProjectOidcService, [
    providerRow(ACME_OIDC, ACME),
    providerRow(BETA_OIDC, BETA),
  ]);
  useInMemoryTable(GlobalSsoService, []);
  useInMemoryTable(GlobalOidcService, []);
  useInMemoryTable(GlobalSsoProjectService, []);
  useInMemoryTable(GlobalOidcProjectService, []);
  useInMemoryTable(GlobalConfigService, [
    { _id: CONFIG_ID, requireSsoForLogin: false },
  ]);

  // Every read of a project's row is counted, and fails when the test says so.
  const read: (...args: Array<unknown>) => unknown =
    projects.repository.find.getMockImplementation()!;

  projects.repository.find.mockImplementation(
    async (...args: Array<unknown>): Promise<unknown> => {
      const asked: string | null = idAskedFor(
        (args[0] as { where?: unknown } | undefined)?.where,
      );

      if (asked) {
        rowReads.set(asked, (rowReads.get(asked) || 0) + 1);
      }

      if (nextProjectReadFails) {
        const failure: Error = nextProjectReadFails;
        nextProjectReadFails = null;
        throw failure;
      }

      return await read(...args);
    },
  );

  // The member's permissions in Acme, and Acme is not blocked.
  getJestSpyOn(
    AccessTokenService,
    "getUserTenantAccessPermission",
  ).mockResolvedValue({
    projectId: new ObjectID(ACME),
    permissions: [],
  } as unknown as UserTenantAccessPermission);
  getJestSpyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);

  const auditLogService: {
    recordUpdate: () => Promise<void>;
  } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    require("../../../Server/Services/AuditLogService").default;
  getJestSpyOn(auditLogService, "recordUpdate").mockResolvedValue(undefined);

  // Each test starts as a server whose minute has run out.
  ProjectService.forgetSignInRules();
  GlobalConfigService.forgetSignInRules();
});

afterEach(() => {
  ProjectService.forgetSignInRules();
  GlobalConfigService.forgetSignInRules();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("a project's sign-in rule, as a server keeps it", () => {
  test("one read of the project's row answers both questions, and is kept for the minute", async () => {
    await expect(
      ProjectService.getRequireSsoForLogin(new ObjectID(ACME)),
    ).resolves.toBe(true);
    await expect(pinnedProviderOf(ACME)).resolves.toBe(ACME_SAML);

    await expect(
      ProjectService.getRequireSsoForLogin(new ObjectID(ACME)),
    ).resolves.toBe(true);
    await expect(pinnedProviderOf(ACME)).resolves.toBe(ACME_SAML);

    expect(rowReads.get(ACME)).toBe(1);
  });

  test("asked for the provider first, the row is read once, and whether SSO is required comes with it", async () => {
    await expect(pinnedProviderOf(ACME)).resolves.toBe(ACME_SAML);
    await expect(
      ProjectService.getRequireSsoForLogin(new ObjectID(ACME)),
    ).resolves.toBe(true);

    expect(rowReads.get(ACME)).toBe(1);
  });

  test("a project that names no provider answers null, from its row", async () => {
    await expect(pinnedProviderOf(BETA)).resolves.toBeNull();
    await expect(
      ProjectService.getRequireSsoForLogin(new ObjectID(BETA)),
    ).resolves.toBe(false);

    expect(rowReads.get(BETA)).toBe(1);
  });

  test("a project that does not exist throws, and is not kept: asked again, it is looked for again", async () => {
    const missing: ObjectID = new ObjectID(id(99));

    for (let attempt: number = 0; attempt < 2; attempt++) {
      await expect(
        ProjectService.getRequireSsoForLogin(missing),
      ).rejects.toThrow(new BadDataException("Project not found"));
      await expect(
        ProjectService.getRequireSsoWithSsoProviderId(missing),
      ).rejects.toThrow(new BadDataException("Project not found"));
    }

    expect(rowReads.get(id(99).toLowerCase())).toBe(4);
  });

  test("a read that fails throws for either question, and keeps nothing: the next question reads again", async () => {
    nextProjectReadFails = clientTimeout();

    await expect(pinnedProviderOf(ACME)).rejects.toThrow("Query read timeout");

    nextProjectReadFails = clientTimeout();

    await expect(
      ProjectService.getRequireSsoForLogin(new ObjectID(ACME)),
    ).rejects.toThrow("Query read timeout");

    // The database answers again: the rule as it is, never a guess.
    await expect(pinnedProviderOf(ACME)).resolves.toBe(ACME_SAML);
    await expect(
      ProjectService.getRequireSsoForLogin(new ObjectID(ACME)),
    ).resolves.toBe(true);

    expect(rowReads.get(ACME)).toBe(3);
  });

  test("forgetting one project's rule reads that project's row again, and only its", async () => {
    await pinnedProviderOf(ACME);
    await pinnedProviderOf(BETA);

    ProjectService.forgetSignInRules(new ObjectID(ACME));

    await expect(pinnedProviderOf(ACME)).resolves.toBe(ACME_SAML);
    await expect(pinnedProviderOf(BETA)).resolves.toBeNull();

    expect(rowReads.get(ACME)).toBe(2);
    expect(rowReads.get(BETA)).toBe(1);
  });

  test("forgetting every project's rule reads each row again", async () => {
    await pinnedProviderOf(ACME);
    await pinnedProviderOf(BETA);

    ProjectService.forgetSignInRules();

    await expect(pinnedProviderOf(ACME)).resolves.toBe(ACME_SAML);
    await expect(
      ProjectService.getRequireSsoForLogin(new ObjectID(BETA)),
    ).resolves.toBe(false);

    expect(rowReads.get(ACME)).toBe(2);
    expect(rowReads.get(BETA)).toBe(2);
  });
});

describe("an update of another project leaves this project's pinned provider in force", () => {
  /*
   * Acme's rule is kept on this server - it requires SSO, from its own SAML
   * provider - when another project's owner saves Beta's rule.
   */
  const KEPT_THEN_ANOTHER_SAVES: Array<{
    name: string;
    projectId: string;
    data: Record<string, unknown>;
  }> = [
    {
      name: "Beta's owner names the provider Beta requires",
      projectId: BETA,
      data: {
        requireSsoForLogin: true,
        requireSsoWithSsoProviderId: new ObjectID(BETA_OIDC),
      },
    },
    {
      name: "Beta's owner names the provider Beta requires, and nothing else",
      projectId: BETA,
      data: { requireSsoWithSsoProviderId: new ObjectID(BETA_OIDC) },
    },
    {
      name: "Gamma's owner saves Gamma's rule naming no provider",
      projectId: GAMMA,
      data: { requireSsoWithSsoProviderId: null },
    },
    {
      name: "Beta's owner turns Require SSO for Login on",
      projectId: BETA,
      data: { requireSsoForLogin: true },
    },
  ];

  // The save, through the real update path; it is written.
  const save: (change: {
    projectId: string;
    data: Record<string, unknown>;
  }) => Promise<void> = async (change: {
    projectId: string;
    data: Record<string, unknown>;
  }): Promise<void> => {
    const writesBefore: number = projects.updates.length;

    await saveRule(change.projectId, change.data);

    const written: Array<{ id: string; set: StoredRow }> = projects.updates
      .slice(writesBefore)
      .filter((update: { id: string; set: StoredRow }): boolean => {
        return update.id.toLowerCase() === change.projectId;
      });

    expect(written.length).toBeGreaterThan(0);

    for (const column of Object.keys(change.data)) {
      expect(
        written.some((update: { id: string; set: StoredRow }): boolean => {
          return column in update.set;
        }),
      ).toBe(true);
    }
  };

  test.each(KEPT_THEN_ANOTHER_SAVES)(
    "$name: Acme still answers the provider it names",
    async (change: { projectId: string; data: Record<string, unknown> }) => {
      await expect(
        ProjectService.getRequireSsoForLogin(new ObjectID(ACME)),
      ).resolves.toBe(true);
      await expect(pinnedProviderOf(ACME)).resolves.toBe(ACME_SAML);

      await save(change);

      await expect(pinnedProviderOf(ACME)).resolves.toBe(ACME_SAML);
      await expect(
        ProjectService.getRequireSsoForLogin(new ObjectID(ACME)),
      ).resolves.toBe(true);
    },
  );

  test.each(KEPT_THEN_ANOTHER_SAVES)(
    "$name: a sign-in from Acme's other provider still does not open Acme, and one from the provider it names does",
    async (change: { projectId: string; data: Record<string, unknown> }) => {
      const otherProvider: ExpressRequest = requestSignedInWith(
        ACME_OIDC,
        SsoProviderType.ProjectOIDC,
      );
      const namedProvider: ExpressRequest = requestSignedInWith(
        ACME_SAML,
        SsoProviderType.ProjectSSO,
      );

      await expect(openAcme(otherProvider)).resolves.toBe(
        "asked to sign in with SSO",
      );
      await expect(openAcme(namedProvider)).resolves.toBe("opened");

      await save(change);

      await expect(openAcme(otherProvider)).resolves.toBe(
        "asked to sign in with SSO",
      );
      await expect(openAcme(namedProvider)).resolves.toBe("opened");
    },
  );

  test("a save of another project that is refused - it names a provider that cannot sign anyone in to it - leaves Acme's pinned provider in force too", async () => {
    await expect(pinnedProviderOf(ACME)).resolves.toBe(ACME_SAML);

    const writesBefore: number = projects.updates.length;

    await expect(
      saveRule(GAMMA, {
        requireSsoWithSsoProviderId: new ObjectID(ACME_SAML),
      }),
    ).rejects.toThrow(REQUIRED_PROVIDER_CANNOT_SIGN_IN_MESSAGE);

    expect(projects.updates.length).toBe(writesBefore);

    await expect(pinnedProviderOf(ACME)).resolves.toBe(ACME_SAML);
    await expect(
      openAcme(requestSignedInWith(ACME_OIDC, SsoProviderType.ProjectOIDC)),
    ).resolves.toBe("asked to sign in with SSO");
  });

  test("Acme's own owner naming another of its providers is answered at once", async () => {
    await expect(pinnedProviderOf(ACME)).resolves.toBe(ACME_SAML);

    await save({
      projectId: ACME,
      data: { requireSsoWithSsoProviderId: new ObjectID(ACME_OIDC) },
    });

    await expect(pinnedProviderOf(ACME)).resolves.toBe(ACME_OIDC);
    await expect(
      openAcme(requestSignedInWith(ACME_SAML, SsoProviderType.ProjectSSO)),
    ).resolves.toBe("asked to sign in with SSO");
    await expect(
      openAcme(requestSignedInWith(ACME_OIDC, SsoProviderType.ProjectOIDC)),
    ).resolves.toBe("opened");
  });
});
