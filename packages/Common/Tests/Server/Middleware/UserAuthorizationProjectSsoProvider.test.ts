import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectOidcService from "../../../Server/Services/ProjectOidcService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProjectSsoService from "../../../Server/Services/ProjectSsoService";
import CookieUtil from "../../../Server/Utils/Cookie";
import { ExpressRequest } from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import ProjectSsoProviderStanding from "../../../Server/Utils/ProjectSsoProviderStanding";
import UserPermissionUtil from "../../../Server/Utils/UserPermission/UserPermission";
import ProjectOidc from "../../../Models/DatabaseModels/ProjectOidc";
import ProjectSso from "../../../Models/DatabaseModels/ProjectSso";
import User from "../../../Models/DatabaseModels/User";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import SsoAuthorizationException from "../../../Types/Exception/SsoAuthorizationException";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { UserTenantAccessPermission } from "../../../Types/Permission";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

type SpyInstance = ReturnType<typeof getJestSpyOn>;

jest.mock("../../../Server/Utils/Logger");

/*
 * A PROJECT'S SSO SIGN-IN COUNTS ONLY WHILE THE PROVIDER THAT GAVE IT IS ON.
 *
 * Signing in with a project's own SAML or OIDC provider leaves a thirty-day
 * token for the project that names the provider. On every request to a
 * project that requires SSO, UserMiddleware asks whether that provider still
 * vouches for it (isProjectScopedSsoSignInAuthorizedForProject): it is still
 * there, still the project's and on, and the sign-in came after it was last
 * turned off. So turning a provider off, or deleting it, ends the sign-ins it
 * gave at the next request, on the API and on live updates alike, and turning
 * it on again does not bring them back. A new certificate or client secret
 * changes none of that.
 *
 * The tokens here are real (CookieUtil signs them, UserMiddleware verifies
 * them). Only the providers' database read is replaced by the rows below, so
 * the services' lookups, the per-server cache and the rule run for real.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const SAML_PROVIDER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const OTHER_SAML_PROVIDER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const OIDC_PROVIDER_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
// A SAML provider of another project.
const OTHER_PROJECTS_PROVIDER_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

// A provider row, as the database holds it.
interface ProviderRow {
  id: ObjectID;
  projectId: ObjectID;
  isEnabled: boolean;
  signInsEndedAt: Date | null;
  // Changing these changes nobody's sign-in.
  certificate: string;
  name: string;
}

let samlRows: Array<ProviderRow> = [];
let oidcRows: Array<ProviderRow> = [];
let samlReads: SpyInstance;
let oidcReads: SpyInstance;

const rowOf: (
  rows: Array<ProviderRow>,
  providerId: ObjectID,
) => ProviderRow = (
  rows: Array<ProviderRow>,
  providerId: ObjectID,
): ProviderRow => {
  const row: ProviderRow | undefined = rows.find((candidate: ProviderRow) => {
    return candidate.id.toString() === providerId.toString();
  });

  if (!row) {
    throw new Error(`No provider ${providerId.toString()} in this test`);
  }

  return row;
};

/*
 * The services' read of one provider (findOneBy with _id and projectId):
 * the row, if it is there and is that project's.
 */
const readFrom: <TModel extends ProjectSso | ProjectOidc>(
  rows: () => Array<ProviderRow>,
  createModel: () => TModel,
) => (findOneBy: unknown) => Promise<TModel | null> = <
  TModel extends ProjectSso | ProjectOidc,
>(
  rows: () => Array<ProviderRow>,
  createModel: () => TModel,
): ((findOneBy: unknown) => Promise<TModel | null>) => {
  return async (findOneBy: unknown): Promise<TModel | null> => {
    const query: Record<string, unknown> = (
      findOneBy as { query: Record<string, unknown> }
    ).query;

    const row: ProviderRow | undefined = rows().find(
      (candidate: ProviderRow): boolean => {
        return (
          candidate.id.toString() === String(query["_id"]) &&
          candidate.projectId.toString() === String(query["projectId"])
        );
      },
    );

    if (!row) {
      return null;
    }

    const model: TModel = createModel();
    model.id = row.id;
    model.isEnabled = row.isEnabled;
    model.signInsEndedAt = row.signInsEndedAt || undefined;
    return model;
  };
};

const buildUser: () => User = (): User => {
  const user: User = new User();
  user.id = USER_ID;
  user.name = new Name("Project SSO User");
  user.email = new Email("project-sso@oneuptime.com");
  return user;
};

// A real project SSO token, as the project's SAML or OIDC sign-in sets it.
const signIn: (data: {
  providerId: ObjectID;
  providerType: SsoProviderType;
  projectId?: ObjectID;
}) => string = (data: {
  providerId: ObjectID;
  providerType: SsoProviderType;
  projectId?: ObjectID;
}): string => {
  return CookieUtil.getSSOToken({
    user: buildUser(),
    projectId: data.projectId || PROJECT_ID,
    ssoProviderId: data.providerId,
    ssoProviderType: data.providerType,
  });
};

const samlSignIn: () => string = (): string => {
  return signIn({
    providerId: SAML_PROVIDER_ID,
    providerType: SsoProviderType.ProjectSSO,
  });
};

const oidcSignIn: () => string = (): string => {
  return signIn({
    providerId: OIDC_PROVIDER_ID,
    providerType: SsoProviderType.ProjectOIDC,
  });
};

// When a token was given, in milliseconds (its `iat`, whole seconds).
const issuedAtMsOf: (token: string) => number = (token: string): number => {
  return (JSONWebToken.decodeJsonPayload(token)["iat"] as number) * 1000;
};

// A request carrying project SSO tokens, as a browser sends its cookies.
const requestWith: (
  tokens: Array<{ projectId: ObjectID; token: string }>,
) => ExpressRequest = (
  tokens: Array<{ projectId: ObjectID; token: string }>,
): ExpressRequest => {
  const cookies: Dictionary<string> = {};

  for (const entry of tokens) {
    cookies[CookieUtil.getUserSSOKey(entry.projectId)] = entry.token;
  }

  return { cookies: cookies, headers: {} } as unknown as ExpressRequest;
};

const isSatisfied: (
  token: string,
  data?: { projectId?: ObjectID; requiredSsoProviderId?: ObjectID },
) => Promise<boolean> = (
  token: string,
  data?: { projectId?: ObjectID; requiredSsoProviderId?: ObjectID },
): Promise<boolean> => {
  const projectId: ObjectID = data?.projectId || PROJECT_ID;

  return UserMiddleware.isSsoSatisfiedForProject({
    req: requestWith([{ projectId: projectId, token: token }]),
    projectId: projectId,
    userId: USER_ID,
    requiredSsoProviderId: data?.requiredSsoProviderId,
  });
};

/*
 * What every server does when a provider is turned off, turned on or deleted
 * (ProjectSsoProviderChanges announces it; RealtimeAccessChanges has each
 * server call ProjectService.forgetSignInRules for the project).
 */
const announceProviderChange: (projectId?: ObjectID) => void = (
  projectId?: ObjectID,
): void => {
  ProjectService.forgetSignInRules(projectId || PROJECT_ID);
};

const turnOff: (row: ProviderRow, atMs: number) => void = (
  row: ProviderRow,
  atMs: number,
): void => {
  row.isEnabled = false;
  row.signInsEndedAt = new Date(atMs);
  announceProviderChange(row.projectId);
};

const turnOn: (row: ProviderRow) => void = (row: ProviderRow): void => {
  row.isEnabled = true;
  announceProviderChange(row.projectId);
};

beforeEach(() => {
  ProjectSsoProviderStanding.forget();

  samlRows = [
    {
      id: SAML_PROVIDER_ID,
      projectId: PROJECT_ID,
      isEnabled: true,
      signInsEndedAt: null,
      certificate: "certificate-1",
      name: "Okta",
    },
    {
      id: OTHER_SAML_PROVIDER_ID,
      projectId: PROJECT_ID,
      isEnabled: true,
      signInsEndedAt: null,
      certificate: "certificate-2",
      name: "Azure AD",
    },
    {
      id: OTHER_PROJECTS_PROVIDER_ID,
      projectId: OTHER_PROJECT_ID,
      isEnabled: true,
      signInsEndedAt: null,
      certificate: "certificate-3",
      name: "Another project's Okta",
    },
  ];
  oidcRows = [
    {
      id: OIDC_PROVIDER_ID,
      projectId: PROJECT_ID,
      isEnabled: true,
      signInsEndedAt: null,
      certificate: "client-secret-1",
      name: "Google",
    },
  ];

  samlReads = getJestSpyOn(ProjectSsoService, "findOneBy").mockImplementation(
    readFrom(
      (): Array<ProviderRow> => {
        return samlRows;
      },
      (): ProjectSso => {
        return new ProjectSso();
      },
    ) as never,
  );
  oidcReads = getJestSpyOn(
    ProjectOidcService,
    "findOneBy",
  ).mockImplementation(
    readFrom(
      (): Array<ProviderRow> => {
        return oidcRows;
      },
      (): ProjectOidc => {
        return new ProjectOidc();
      },
    ) as never,
  );
});

afterEach(() => {
  ProjectSsoProviderStanding.forget();
  jest.restoreAllMocks();
});

describe("a project SSO sign-in and the provider that gave it", () => {
  test("counts while the provider is on, for SAML and OIDC alike", async () => {
    await expect(isSatisfied(samlSignIn())).resolves.toBe(true);
    await expect(isSatisfied(oidcSignIn())).resolves.toBe(true);

    // Each kind is asked of its own table, for this project.
    expect(samlReads).toHaveBeenCalledTimes(1);
    expect(oidcReads).toHaveBeenCalledTimes(1);

    const samlQuery: Record<string, unknown> = (
      samlReads.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(String(samlQuery["_id"])).toBe(SAML_PROVIDER_ID.toString());
    expect(String(samlQuery["projectId"])).toBe(PROJECT_ID.toString());
  });

  test("turning the provider off ends it at the next request", async () => {
    const token: string = samlSignIn();

    await expect(isSatisfied(token)).resolves.toBe(true);

    turnOff(rowOf(samlRows, SAML_PROVIDER_ID), Date.now());

    await expect(isSatisfied(token)).resolves.toBe(false);
  });

  test("turning an OIDC provider off ends its sign-ins too", async () => {
    const token: string = oidcSignIn();

    await expect(isSatisfied(token)).resolves.toBe(true);

    turnOff(rowOf(oidcRows, OIDC_PROVIDER_ID), Date.now());

    await expect(isSatisfied(token)).resolves.toBe(false);
  });

  test("deleting the provider ends it at the next request", async () => {
    const token: string = samlSignIn();

    await expect(isSatisfied(token)).resolves.toBe(true);

    samlRows = samlRows.filter((row: ProviderRow): boolean => {
      return row.id.toString() !== SAML_PROVIDER_ID.toString();
    });
    announceProviderChange();

    await expect(isSatisfied(token)).resolves.toBe(false);
  });

  test("only the sign-ins of the provider turned off end: another provider's go on", async () => {
    const turnedOff: string = samlSignIn();
    const stillOn: string = signIn({
      providerId: OTHER_SAML_PROVIDER_ID,
      providerType: SsoProviderType.ProjectSSO,
    });

    turnOff(rowOf(samlRows, SAML_PROVIDER_ID), Date.now());

    await expect(isSatisfied(turnedOff)).resolves.toBe(false);
    await expect(isSatisfied(stillOn)).resolves.toBe(true);
    await expect(isSatisfied(oidcSignIn())).resolves.toBe(true);
  });

  test("turning it on again does not bring back the sign-ins it gave before; signing in again does", async () => {
    const before: string = samlSignIn();
    const row: ProviderRow = rowOf(samlRows, SAML_PROVIDER_ID);

    // Turned off a second after the sign-in was given, then on again.
    turnOff(row, issuedAtMsOf(before) + 1000);
    turnOn(row);

    await expect(isSatisfied(before)).resolves.toBe(false);

    /*
     * A sign-in given after it was turned off counts: here the provider was
     * turned off a second before this one was given.
     */
    row.signInsEndedAt = new Date(issuedAtMsOf(before) - 1000);
    announceProviderChange();

    await expect(isSatisfied(before)).resolves.toBe(true);
  });

  test("a sign-in given in the very second the provider was turned off does not count", async () => {
    const token: string = samlSignIn();
    const row: ProviderRow = rowOf(samlRows, SAML_PROVIDER_ID);

    // Issue times are whole seconds, rounded down: this is after the iat.
    turnOff(row, issuedAtMsOf(token) + 999);
    turnOn(row);

    await expect(isSatisfied(token)).resolves.toBe(false);

    row.signInsEndedAt = new Date(issuedAtMsOf(token));
    announceProviderChange();

    await expect(isSatisfied(token)).resolves.toBe(false);
  });

  test("a new certificate or client secret, or a new name, keeps every sign-in it gave", async () => {
    const saml: string = samlSignIn();
    const oidc: string = oidcSignIn();

    await expect(isSatisfied(saml)).resolves.toBe(true);
    await expect(isSatisfied(oidc)).resolves.toBe(true);

    rowOf(samlRows, SAML_PROVIDER_ID).certificate = "certificate-rotated";
    rowOf(samlRows, SAML_PROVIDER_ID).name = "Okta (new tenant)";
    rowOf(oidcRows, OIDC_PROVIDER_ID).certificate = "client-secret-rotated";

    // Even read again from the database, nothing about the sign-in changed.
    ProjectSsoProviderStanding.forget();

    await expect(isSatisfied(saml)).resolves.toBe(true);
    await expect(isSatisfied(oidc)).resolves.toBe(true);
  });

  test("a sign-in naming another project's provider does not count, though that provider is on", async () => {
    const token: string = signIn({
      providerId: OTHER_PROJECTS_PROVIDER_ID,
      providerType: SsoProviderType.ProjectSSO,
    });

    await expect(isSatisfied(token)).resolves.toBe(false);

    // The other project's own sign-in with it counts there.
    await expect(
      isSatisfied(
        signIn({
          providerId: OTHER_PROJECTS_PROVIDER_ID,
          providerType: SsoProviderType.ProjectSSO,
          projectId: OTHER_PROJECT_ID,
        }),
        { projectId: OTHER_PROJECT_ID },
      ),
    ).resolves.toBe(true);
  });

  test("a SAML provider never answers for an OIDC sign-in with its id, nor the other way round", async () => {
    await expect(
      isSatisfied(
        signIn({
          providerId: SAML_PROVIDER_ID,
          providerType: SsoProviderType.ProjectOIDC,
        }),
      ),
    ).resolves.toBe(false);
    await expect(
      isSatisfied(
        signIn({
          providerId: OIDC_PROVIDER_ID,
          providerType: SsoProviderType.ProjectSSO,
        }),
      ),
    ).resolves.toBe(false);
  });

  test("a sign-in that names no provider does not count, and the database is not asked", async () => {
    const token: string = JSONWebToken.signJsonPayload(
      {
        userId: USER_ID.toString(),
        projectId: PROJECT_ID.toString(),
        email: "project-sso@oneuptime.com",
        name: "Project SSO User",
        isMasterAdmin: false,
      },
      30 * 60,
    );

    await expect(isSatisfied(token)).resolves.toBe(false);

    expect(samlReads).not.toHaveBeenCalled();
    expect(oidcReads).not.toHaveBeenCalled();
  });

  test("a sign-in with a provider id that is not an id does not count, and the database is not asked", async () => {
    const token: string = JSONWebToken.signJsonPayload(
      {
        userId: USER_ID.toString(),
        projectId: PROJECT_ID.toString(),
        email: "project-sso@oneuptime.com",
        name: "Project SSO User",
        isMasterAdmin: false,
        ssoProviderId: "not-an-id",
        ssoProviderType: SsoProviderType.ProjectSSO,
      },
      30 * 60,
    );

    await expect(isSatisfied(token)).resolves.toBe(false);

    expect(samlReads).not.toHaveBeenCalled();
  });

  test("a project that requires one provider asks that provider, and refuses once it is off", async () => {
    const token: string = samlSignIn();

    await expect(
      isSatisfied(token, { requiredSsoProviderId: SAML_PROVIDER_ID }),
    ).resolves.toBe(true);

    turnOff(rowOf(samlRows, SAML_PROVIDER_ID), Date.now());

    await expect(
      isSatisfied(token, { requiredSsoProviderId: SAML_PROVIDER_ID }),
    ).resolves.toBe(false);
  });

  test("'could not find out' is an error - never a refusal, never a pass - and is not remembered", async () => {
    samlReads.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(isSatisfied(samlSignIn())).rejects.toThrow(
      "database unavailable",
    );

    // The next request asks again, and is answered.
    await expect(isSatisfied(samlSignIn())).resolves.toBe(true);
  });

  test("the provider is asked once a minute per server, and again as soon as a change is announced", async () => {
    const token: string = samlSignIn();

    await Promise.all([isSatisfied(token), isSatisfied(token)]);
    await isSatisfied(token);

    expect(samlReads).toHaveBeenCalledTimes(1);

    announceProviderChange();
    await isSatisfied(token);

    expect(samlReads).toHaveBeenCalledTimes(2);

    // Another project's change leaves this project's answer alone.
    announceProviderChange(OTHER_PROJECT_ID);
    await isSatisfied(token);

    expect(samlReads).toHaveBeenCalledTimes(2);
  });
});

describe("the API's project access check follows the provider", () => {
  const PERMISSION: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
  } as UserTenantAccessPermission;

  let requireSsoFor: Array<string> = [];

  beforeEach(() => {
    requireSsoFor = [PROJECT_ID.toString()];

    getJestSpyOn(ProjectService, "getRequireSsoForLogin").mockImplementation((async (
      projectId: ObjectID,
    ): Promise<boolean> => {
      return requireSsoFor.includes(projectId.toString());
    }) as never);
    getJestSpyOn(
      ProjectService,
      "getRequireSsoWithSsoProviderId",
    ).mockResolvedValue(null as never);
    getJestSpyOn(GlobalConfigService, "getRequireSsoForLogin").mockResolvedValue(
      false as never,
    );
    getJestSpyOn(
      AccessTokenService,
      "getUserTenantAccessPermission",
    ).mockImplementation((async (
      _userId: ObjectID,
      projectId: ObjectID,
    ): Promise<UserTenantAccessPermission> => {
      return { projectId: projectId } as UserTenantAccessPermission;
    }) as never);
  });

  const access: (token: string) => Promise<UserTenantAccessPermission | null> =
    (token: string): Promise<UserTenantAccessPermission | null> => {
      return UserMiddleware.getUserTenantAccessPermissionWithTenantId({
        req: requestWith([{ projectId: PROJECT_ID, token: token }]),
        tenantId: PROJECT_ID,
        userId: USER_ID,
      });
    };

  test("a request signed in with a provider that is on gets the project", async () => {
    await expect(access(samlSignIn())).resolves.toEqual(PERMISSION);
  });

  test("a request signed in with a provider turned off is refused like one with no SSO sign-in", async () => {
    const token: string = samlSignIn();

    turnOff(rowOf(samlRows, SAML_PROVIDER_ID), Date.now());

    await expect(access(token)).rejects.toThrow(SsoAuthorizationException);
  });

  test("a request signed in with a provider deleted is refused like one with no SSO sign-in", async () => {
    const token: string = oidcSignIn();

    oidcRows = [];
    announceProviderChange();

    await expect(access(token)).rejects.toThrow(SsoAuthorizationException);
  });

  test("a project that does not require SSO never asks the provider", async () => {
    requireSsoFor = [];
    const token: string = samlSignIn();

    turnOff(rowOf(samlRows, SAML_PROVIDER_ID), Date.now());

    await expect(access(token)).resolves.toEqual(PERMISSION);
    expect(samlReads).not.toHaveBeenCalled();
  });

  test("the project list gives a project whose provider was turned off no access, and keeps the others", async () => {
    requireSsoFor = [PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()];

    const noAccess: UserTenantAccessPermission = {
      projectId: PROJECT_ID,
      permissions: [],
    } as unknown as UserTenantAccessPermission;
    getJestSpyOn(
      UserPermissionUtil,
      "getDefaultUserTenantAccessPermission",
    ).mockReturnValue(noAccess as never);

    const thisProject: string = samlSignIn();
    const otherProject: string = signIn({
      providerId: OTHER_PROJECTS_PROVIDER_ID,
      providerType: SsoProviderType.ProjectSSO,
      projectId: OTHER_PROJECT_ID,
    });

    turnOff(rowOf(samlRows, SAML_PROVIDER_ID), Date.now());

    const permissions: Dictionary<UserTenantAccessPermission> | null =
      await UserMiddleware.getUserTenantAccessPermissionForMultiTenant(
        requestWith([
          { projectId: PROJECT_ID, token: thisProject },
          { projectId: OTHER_PROJECT_ID, token: otherProject },
        ]),
        USER_ID,
        [PROJECT_ID, OTHER_PROJECT_ID],
      );

    expect(permissions).toEqual({
      [PROJECT_ID.toString()]: noAccess,
      [OTHER_PROJECT_ID.toString()]: { projectId: OTHER_PROJECT_ID },
    });
  });
});
