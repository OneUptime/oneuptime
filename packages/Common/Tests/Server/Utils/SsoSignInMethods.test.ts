jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
    },
  };
});

import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import GlobalOidcProjectService from "../../../Server/Services/GlobalOidcProjectService";
import GlobalOidcService from "../../../Server/Services/GlobalOidcService";
import GlobalSsoProjectService from "../../../Server/Services/GlobalSsoProjectService";
import GlobalSsoService from "../../../Server/Services/GlobalSsoService";
import ProjectOidcService from "../../../Server/Services/ProjectOidcService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProjectSsoService from "../../../Server/Services/ProjectSsoService";
import logger from "../../../Server/Utils/Logger";
import SsoRequiredSignIn from "../../../Server/Utils/SsoRequiredSignIn";
import SsoSignInMethods from "../../../Server/Utils/SsoSignInMethods";
import { clearGlobalSsoAuthorizationCaches } from "../../../Server/Utils/GlobalSsoAuthorization";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  ProjectSignInMethods,
  SignInMethods,
  SSO_REQUIRED_SIGN_IN_MESSAGE,
  SSO_REQUIRED_SIGN_UP_MESSAGE,
  SsoSignInProvider,
} from "../../../Types/SSO/SignInMethods";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * HOW THE SERVER SIGNS PEOPLE IN, AS ITS SIGN-IN PAGES ARE TOLD, AND WHO A
 * REQUIRED SSO KEEPS OUT.
 *
 * SsoSignInMethods answers the sign-in pages (GET /identity/sign-in-methods
 * and /identity/project-sign-in-methods/:projectId); SsoRequiredSignIn is
 * what every sign-in that is not SSO, and every sign-up, asks first. Both are
 * driven here through the real services - GlobalConfigService's Require SSO
 * for Login, ProjectService's sign-in rule, the providers' own tables and the
 * global providers' attachments - over rows held in memory
 * (InMemoryRepository), so what is asked of each table is what Postgres
 * would be asked.
 */

const id: (n: number) => string = (n: number): string => {
  return `5e000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
};

const CONFIG_ID: string = ObjectID.getZeroObjectID().toString();
const PROJECT_ID: string = id(1);
const OTHER_PROJECT_ID: string = id(2);

const OKTA: string = id(11);
const ENTRA_OFF: string = id(12);
const GOOGLE: string = id(13);
const CONTRACTORS: string = id(14);
const PROJECT_SAML: string = id(21);
const PROJECT_OIDC: string = id(22);
const OTHER_PROJECT_SAML: string = id(23);

let config: InMemoryTable;
let globalSaml: InMemoryTable;
let globalOidc: InMemoryTable;
let projectSaml: InMemoryTable;
let projectOidc: InMemoryTable;
let projects: InMemoryTable;

const projectRow: (data: {
  id: string;
  requireSsoWithSsoProviderId?: string | null;
}) => StoredRow = (data: {
  id: string;
  requireSsoWithSsoProviderId?: string | null;
}): StoredRow => {
  return {
    _id: data.id,
    name: "Acme",
    slug: `acme-${data.id}`,
    requireSsoForLogin: true,
    requireSsoWithSsoProviderId: data.requireSsoWithSsoProviderId ?? null,
  };
};

const globalProviderRow: (data: {
  id: string;
  name: string;
  description?: string;
  isEnabled?: boolean;
  restrictToAttachedProjects?: boolean;
}) => StoredRow = (data: {
  id: string;
  name: string;
  description?: string;
  isEnabled?: boolean;
  restrictToAttachedProjects?: boolean;
}): StoredRow => {
  return {
    _id: data.id,
    name: data.name,
    description: data.description ?? `Sign in with ${data.name}`,
    isEnabled: data.isEnabled ?? true,
    restrictToAttachedProjects: Boolean(data.restrictToAttachedProjects),
    // What a sign-in page must never be told.
    signOnURL: "https://idp.example.com/sso",
    publicCertificate: "-----BEGIN CERTIFICATE-----",
    clientSecret: "client-secret",
    signInsEndedAt: null,
  };
};

const projectProviderRow: (data: {
  id: string;
  projectId: string;
  name: string;
  isEnabled?: boolean;
}) => StoredRow = (data: {
  id: string;
  projectId: string;
  name: string;
  isEnabled?: boolean;
}): StoredRow => {
  return {
    _id: data.id,
    projectId: data.projectId,
    name: data.name,
    description: `Sign in with ${data.name}`,
    isEnabled: data.isEnabled ?? true,
    signOnURL: "https://idp.example.com/project",
  };
};

const setServerRule: (requireSsoForLogin: boolean) => void = (
  requireSsoForLogin: boolean,
): void => {
  config.get(CONFIG_ID)!["requireSsoForLogin"] = requireSsoForLogin;
  GlobalConfigService.forgetSignInRules();
};

const kindsAndNames: (providers: Array<SsoSignInProvider>) => Array<string> = (
  providers: Array<SsoSignInProvider>,
): Array<string> => {
  return providers.map((provider: SsoSignInProvider): string => {
    return `${provider.type} ${provider.name}`;
  });
};

beforeEach(() => {
  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  config = useInMemoryTable(GlobalConfigService, [
    { _id: CONFIG_ID, requireSsoForLogin: false },
  ]);
  projects = useInMemoryTable(ProjectService, [
    projectRow({ id: PROJECT_ID }),
    projectRow({ id: OTHER_PROJECT_ID }),
  ]);
  globalSaml = useInMemoryTable(GlobalSsoService, [
    globalProviderRow({ id: OKTA, name: "okta" }),
    globalProviderRow({ id: ENTRA_OFF, name: "Entra ID", isEnabled: false }),
  ]);
  globalOidc = useInMemoryTable(GlobalOidcService, [
    globalProviderRow({
      id: GOOGLE,
      name: "Google Workspace",
      description: "Use your Acme email",
    }),
  ]);
  projectSaml = useInMemoryTable(ProjectSsoService, []);
  projectOidc = useInMemoryTable(ProjectOidcService, []);
  useInMemoryTable(GlobalSsoProjectService, []);
  useInMemoryTable(GlobalOidcProjectService, []);

  GlobalConfigService.forgetSignInRules();
  ProjectService.forgetSignInRules();
  clearGlobalSsoAuthorizationCaches();
});

afterEach(() => {
  GlobalConfigService.forgetSignInRules();
  ProjectService.forgetSignInRules();
  clearGlobalSsoAuthorizationCaches();
  jest.restoreAllMocks();
});

describe("SsoSignInMethods.getSignInMethods", () => {
  test("while SSO is not required: the instance-wide providers that are on, by name, and nothing about projects", async () => {
    projectSaml.rows.push(
      projectProviderRow({
        id: PROJECT_SAML,
        projectId: PROJECT_ID,
        name: "P",
      }),
    );

    const methods: SignInMethods = await SsoSignInMethods.getSignInMethods();

    expect(methods.isSsoRequired).toBe(false);
    // "Google Workspace" before "okta": by name, whatever the case.
    expect(kindsAndNames(methods.ssoProviders)).toEqual([
      `${SsoProviderType.GlobalOIDC} Google Workspace`,
      `${SsoProviderType.GlobalSSO} okta`,
    ]);
    // Never told while SSO is not required, even with a project provider on.
    expect(methods.hasProjectSsoProviders).toBe(false);
    expect(projectSaml.repository.find).not.toHaveBeenCalled();
    expect(projectOidc.repository.find).not.toHaveBeenCalled();
  });

  test("a provider is told by kind, id, name and description - nothing of its settings", async () => {
    const methods: SignInMethods = await SsoSignInMethods.getSignInMethods();

    expect(methods.ssoProviders).toEqual([
      {
        type: SsoProviderType.GlobalOIDC,
        id: GOOGLE,
        name: "Google Workspace",
        description: "Use your Acme email",
      },
      {
        type: SsoProviderType.GlobalSSO,
        id: OKTA,
        name: "okta",
        description: "Sign in with okta",
      },
    ]);
    expect(JSON.stringify(methods)).not.toContain("client-secret");
    expect(JSON.stringify(methods)).not.toContain("CERTIFICATE");
    expect(JSON.stringify(methods)).not.toContain("idp.example.com");
  });

  test("while SSO is required, and no project has a provider of its own", async () => {
    setServerRule(true);

    const methods: SignInMethods = await SsoSignInMethods.getSignInMethods();

    expect(methods.isSsoRequired).toBe(true);
    expect(methods.ssoProviders).toHaveLength(2);
    expect(methods.hasProjectSsoProviders).toBe(false);
  });

  test.each([
    ["a SAML provider", "saml"],
    ["an OpenID Connect provider", "oidc"],
  ])(
    "while SSO is required, and a project has %s of its own that is on",
    async (_name: string, kind: string) => {
      setServerRule(true);
      (kind === "saml" ? projectSaml : projectOidc).rows.push(
        projectProviderRow({
          id: PROJECT_SAML,
          projectId: PROJECT_ID,
          name: "Project IdP",
        }),
      );

      const methods: SignInMethods = await SsoSignInMethods.getSignInMethods();

      expect(methods.hasProjectSsoProviders).toBe(true);
      // Never which, nor whose.
      expect(JSON.stringify(methods)).not.toContain(PROJECT_ID);
      expect(JSON.stringify(methods)).not.toContain("Project IdP");
    },
  );

  test("a project's provider that is off is no way in", async () => {
    setServerRule(true);
    projectSaml.rows.push(
      projectProviderRow({
        id: PROJECT_SAML,
        projectId: PROJECT_ID,
        name: "Off",
        isEnabled: false,
      }),
    );

    const methods: SignInMethods = await SsoSignInMethods.getSignInMethods();

    expect(methods.hasProjectSsoProviders).toBe(false);
  });

  test("no provider anywhere: required, with nothing to sign in with", async () => {
    setServerRule(true);
    globalSaml.rows.length = 0;
    globalOidc.rows.length = 0;

    const methods: SignInMethods = await SsoSignInMethods.getSignInMethods();

    expect(methods).toEqual({
      isSsoRequired: true,
      ssoProviders: [],
      hasProjectSsoProviders: false,
    });
  });

  // A failed read is no answer: the page shows what it shows when nothing is known.
  test("a server rule that cannot be read fails the answer", async () => {
    config.repository.find.mockImplementation(async (): Promise<never> => {
      throw new Error("connection terminated");
    });

    await expect(SsoSignInMethods.getSignInMethods()).rejects.toThrow(
      "connection terminated",
    );
  });
});

describe("SsoSignInMethods.getProjectSignInMethods", () => {
  test("the project's own providers first, then the instance-wide ones that reach it", async () => {
    projectSaml.rows.push(
      projectProviderRow({
        id: PROJECT_SAML,
        projectId: PROJECT_ID,
        name: "Acme SAML",
      }),
      projectProviderRow({
        id: OTHER_PROJECT_SAML,
        projectId: OTHER_PROJECT_ID,
        name: "Globex SAML",
      }),
    );
    projectOidc.rows.push(
      projectProviderRow({
        id: PROJECT_OIDC,
        projectId: PROJECT_ID,
        name: "Acme OIDC",
      }),
    );

    const methods: ProjectSignInMethods =
      await SsoSignInMethods.getProjectSignInMethods(new ObjectID(PROJECT_ID));

    expect(kindsAndNames(methods.ssoProviders)).toEqual([
      `${SsoProviderType.ProjectOIDC} Acme OIDC`,
      `${SsoProviderType.ProjectSSO} Acme SAML`,
      `${SsoProviderType.GlobalOIDC} Google Workspace`,
      `${SsoProviderType.GlobalSSO} okta`,
    ]);
  });

  test("a provider restricted to its attached projects is listed only where it signs people in", async () => {
    globalSaml.rows.push(
      globalProviderRow({
        id: CONTRACTORS,
        name: "Contractors",
        restrictToAttachedProjects: true,
      }),
    );
    useInMemoryTable(GlobalSsoProjectService, [
      {
        _id: id(31),
        globalSsoId: CONTRACTORS,
        projectId: OTHER_PROJECT_ID,
        isEnabled: true,
      },
    ]);

    const here: ProjectSignInMethods =
      await SsoSignInMethods.getProjectSignInMethods(new ObjectID(PROJECT_ID));
    const there: ProjectSignInMethods =
      await SsoSignInMethods.getProjectSignInMethods(
        new ObjectID(OTHER_PROJECT_ID),
      );

    expect(kindsAndNames(here.ssoProviders)).not.toContain(
      `${SsoProviderType.GlobalSSO} Contractors`,
    );
    expect(kindsAndNames(there.ssoProviders)).toContain(
      `${SsoProviderType.GlobalSSO} Contractors`,
    );
  });

  // Any other provider would sign the person in, and the project would still refuse them.
  test("a project that requires one provider lists only that one", async () => {
    projects.get(PROJECT_ID)!["requireSsoWithSsoProviderId"] = GOOGLE;
    ProjectService.forgetSignInRules();
    projectSaml.rows.push(
      projectProviderRow({
        id: PROJECT_SAML,
        projectId: PROJECT_ID,
        name: "Acme SAML",
      }),
    );

    const methods: ProjectSignInMethods =
      await SsoSignInMethods.getProjectSignInMethods(new ObjectID(PROJECT_ID));

    expect(kindsAndNames(methods.ssoProviders)).toEqual([
      `${SsoProviderType.GlobalOIDC} Google Workspace`,
    ]);
  });

  test("lists nothing for a project with no provider that signs people in", async () => {
    globalSaml.rows.length = 0;
    globalOidc.rows.length = 0;

    const methods: ProjectSignInMethods =
      await SsoSignInMethods.getProjectSignInMethods(new ObjectID(PROJECT_ID));

    expect(methods.ssoProviders).toEqual([]);
  });

  test("refuses a project that does not exist", async () => {
    await expect(
      SsoSignInMethods.getProjectSignInMethods(new ObjectID(id(99))),
    ).rejects.toThrow(BadDataException);
  });
});

describe("SsoRequiredSignIn", () => {
  test("refuses nobody while the server does not require SSO", async () => {
    await expect(
      SsoRequiredSignIn.isNonSsoSignInRefused({ isMasterAdmin: false }),
    ).resolves.toBe(false);
    await expect(
      SsoRequiredSignIn.assertNonSsoSignInAllowed({}),
    ).resolves.toBeUndefined();
    await expect(SsoRequiredSignIn.assertSignUpAllowed()).resolves.toBe(
      undefined,
    );
  });

  test("refuses everyone but master admins while it does", async () => {
    setServerRule(true);

    await expect(
      SsoRequiredSignIn.isNonSsoSignInRefused({ isMasterAdmin: false }),
    ).resolves.toBe(true);
    await expect(SsoRequiredSignIn.isNonSsoSignInRefused({})).resolves.toBe(
      true,
    );
    await expect(
      SsoRequiredSignIn.assertNonSsoSignInAllowed({ isMasterAdmin: false }),
    ).rejects.toThrow(SSO_REQUIRED_SIGN_IN_MESSAGE);
    await expect(SsoRequiredSignIn.assertSignUpAllowed()).rejects.toThrow(
      SSO_REQUIRED_SIGN_UP_MESSAGE,
    );
  });

  test("the refusals are BadDataExceptions, as the sign-in routes answer refusals", async () => {
    setServerRule(true);

    await expect(
      SsoRequiredSignIn.assertNonSsoSignInAllowed({ isMasterAdmin: false }),
    ).rejects.toBeInstanceOf(BadDataException);
    await expect(
      SsoRequiredSignIn.assertSignUpAllowed(),
    ).rejects.toBeInstanceOf(BadDataException);
  });

  test("a master admin is never refused, and the rule is not read for one", async () => {
    setServerRule(true);
    config.repository.find.mockClear();

    await expect(
      SsoRequiredSignIn.isNonSsoSignInRefused({ isMasterAdmin: true }),
    ).resolves.toBe(false);
    await expect(
      SsoRequiredSignIn.assertNonSsoSignInAllowed({ isMasterAdmin: true }),
    ).resolves.toBeUndefined();
    expect(config.repository.find).not.toHaveBeenCalled();
  });

  test("a rule that cannot be read refuses everyone but master admins, with the failure", async () => {
    config.repository.find.mockImplementation(async (): Promise<never> => {
      throw new Error("connection terminated");
    });

    await expect(
      SsoRequiredSignIn.assertNonSsoSignInAllowed({ isMasterAdmin: false }),
    ).rejects.toThrow("connection terminated");
    await expect(SsoRequiredSignIn.assertSignUpAllowed()).rejects.toThrow(
      "connection terminated",
    );
    await expect(
      SsoRequiredSignIn.assertNonSsoSignInAllowed({ isMasterAdmin: true }),
    ).resolves.toBeUndefined();
  });

  test("follows the rule as it changes", async () => {
    await expect(SsoRequiredSignIn.isSsoRequired()).resolves.toBe(false);

    setServerRule(true);
    await expect(SsoRequiredSignIn.isSsoRequired()).resolves.toBe(true);

    setServerRule(false);
    await expect(SsoRequiredSignIn.isSsoRequired()).resolves.toBe(false);
  });
});
