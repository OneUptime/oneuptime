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
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import SsoManagedSignIn, {
  SsoManagedSignInState,
} from "../../../Server/Utils/SsoManagedSignIn";
import SsoSignInMethods from "../../../Server/Utils/SsoSignInMethods";
import User from "../../../Models/DatabaseModels/User";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import {
  ProjectSignInMethods,
  SsoSignInProvider,
} from "../../../Types/SSO/SignInMethods";
import {
  MAX_LOCAL_SIGN_IN_PROJECT_NAMES,
  MAX_SSO_PROVIDER_NAMES,
  SSO_MANAGED_SIGN_IN_MESSAGE,
  SsoManagedBy,
} from "../../../Types/SSO/SsoManagedSignIn";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import { getJestSpyOn } from "../../Spy";
import {
  managingProject,
  MemberProject,
  MemberProjectsStandIn,
  passwordProject,
  readQueryValues,
  standInMemberProjects,
} from "../TestingUtils/SsoManagedProjects";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHO HAS NO LOCAL SIGN-IN SETTINGS (issues #9688 and #9763), EXACTLY.
 *
 * SsoManagedSignIn answers whether somebody's organization manages how they
 * sign in (Types/SSO/SsoManagedSignIn). Every write of a password, passkey,
 * security key, authenticator app, backup codes or two-factor
 * authentication asks it first, so each case of the definition is pinned
 * here, with only the account's row, the server's rule, the person's
 * projects (Tests/Server/TestingUtils/SsoManagedProjects) and the providers
 * stood in.
 *
 * The server's rule (#9688):
 *
 *   - the rule on, someone who is not a master admin: covered;
 *   - a master admin: never, without either rule even being read - so a
 *     rule that cannot be read never refuses one anything;
 *   - a rule that cannot be read, for anyone else: refused, never "not
 *     required";
 *   - whether someone is a master admin is read from their account, never
 *     taken from what a caller says;
 *   - an account that does not exist: an answer about the account, not a
 *     rule that let it through.
 *
 * The projects' rule (#9763), while the server does not require SSO:
 * covered when every project they belong to - an invitation not accepted yet
 * included - requires SSO and manages sign-in with it. Nobody in no project;
 * one project that does not, of any kind, keeps their settings theirs and is
 * named for it; a project that no longer exists counts for nothing; it is
 * read on every ask, never kept.
 */

const USER_ID: ObjectID = new ObjectID("9a000000-0000-4000-8000-000000000001");

const account: (data: {
  isMasterAdmin?: boolean | undefined;
}) => User = (data: { isMasterAdmin?: boolean | undefined }): User => {
  const user: User = new User();
  user._id = USER_ID.toString();

  if (data.isMasterAdmin !== undefined) {
    user.isMasterAdmin = data.isMasterAdmin;
  }

  return user;
};

const provider: (name: string, type?: SsoProviderType) => SsoSignInProvider = (
  name: string,
  type: SsoProviderType = SsoProviderType.GlobalSSO,
): SsoSignInProvider => {
  return {
    type: type,
    id: "9b000000-0000-4000-8000-000000000001",
    name: name,
    description: "",
  };
};

let findOneById: jest.SpyInstance;
let getRequireSsoForLogin: jest.SpyInstance;
let getInstanceWideProviders: jest.SpyInstance;
let getProjectSignInMethods: jest.SpyInstance;
let memberProjects: MemberProjectsStandIn;

// Each project's providers, as getProjectSignInMethods answers them.
let providersByProject: Map<string, Array<SsoSignInProvider>>;

beforeEach(() => {
  findOneById = getJestSpyOn(UserService, "findOneById").mockResolvedValue(
    account({ isMasterAdmin: false }),
  );
  getRequireSsoForLogin = getJestSpyOn(
    GlobalConfigService,
    "getRequireSsoForLogin",
  ).mockResolvedValue(true);
  getInstanceWideProviders = getJestSpyOn(
    SsoSignInMethods,
    "getInstanceWideProviders",
  ).mockResolvedValue([provider("Okta")]);

  providersByProject = new Map<string, Array<SsoSignInProvider>>();
  getProjectSignInMethods = getJestSpyOn(
    SsoSignInMethods,
    "getProjectSignInMethods",
  ).mockImplementation(
    async (projectId: ObjectID): Promise<ProjectSignInMethods> => {
      return {
        ssoProviders: providersByProject.get(projectId.toString()) || [],
      };
    },
  );

  // In no project, unless a test puts them in some.
  memberProjects = standInMemberProjects([]);

  getJestSpyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The person's projects, with the server not requiring SSO.
const inProjects: (projects: Array<MemberProject>) => void = (
  projects: Array<MemberProject>,
): void => {
  getRequireSsoForLogin.mockResolvedValue(false);
  memberProjects.setProjects(projects);
};

const namesOf: (
  projects: Array<{ id: ObjectID; name: string }>,
) => Array<string> = (
  projects: Array<{ id: ObjectID; name: string }>,
): Array<string> => {
  return projects.map((project: { id: ObjectID; name: string }): string => {
    return project.name;
  });
};

describe("SsoManagedSignIn.isManagedBySso: the server's rule (#9688)", () => {
  test("the server requires SSO, and the person is not a master admin: covered", async () => {
    await expect(SsoManagedSignIn.isManagedBySso(USER_ID)).resolves.toBe(true);
    expect(getRequireSsoForLogin).toHaveBeenCalledTimes(1);
  });

  test("an account with no master-admin flag at all is not a master admin", async () => {
    findOneById.mockResolvedValue(account({}));

    await expect(SsoManagedSignIn.isManagedBySso(USER_ID)).resolves.toBe(true);
  });

  test("the server does not require SSO, and the person is in no project: not covered", async () => {
    getRequireSsoForLogin.mockResolvedValue(false);

    await expect(SsoManagedSignIn.isManagedBySso(USER_ID)).resolves.toBe(false);
    // Their projects were asked about: there were none.
    expect(memberProjects.memberships).toHaveBeenCalledTimes(1);
    expect(memberProjects.projects).not.toHaveBeenCalled();
  });

  test("while the server requires SSO its rule decides, and no project is read", async () => {
    memberProjects.setProjects([passwordProject("Contractors")]);

    await expect(SsoManagedSignIn.getManagedBy(USER_ID)).resolves.toBe(
      SsoManagedBy.Server,
    );
    expect(memberProjects.memberships).not.toHaveBeenCalled();
    expect(memberProjects.projects).not.toHaveBeenCalled();
  });

  test.each([true, false])(
    "a master admin is never covered, neither rule read (server requires SSO: %s)",
    async (isRequired: boolean) => {
      findOneById.mockResolvedValue(account({ isMasterAdmin: true }));
      getRequireSsoForLogin.mockResolvedValue(isRequired);
      memberProjects.setProjects([managingProject("Acme")]);

      await expect(SsoManagedSignIn.isManagedBySso(USER_ID)).resolves.toBe(
        false,
      );
      expect(getRequireSsoForLogin).not.toHaveBeenCalled();
      expect(memberProjects.memberships).not.toHaveBeenCalled();
      expect(memberProjects.projects).not.toHaveBeenCalled();
    },
  );

  test("a rule that cannot be read never keeps a master admin out", async () => {
    findOneById.mockResolvedValue(account({ isMasterAdmin: true }));
    getRequireSsoForLogin.mockRejectedValue(new Error("connection refused"));
    memberProjects.memberships.mockRejectedValue(
      new Error("connection refused"),
    );

    await expect(SsoManagedSignIn.isManagedBySso(USER_ID)).resolves.toBe(false);
  });

  test("a rule that cannot be read is no answer for anyone else: it throws", async () => {
    getRequireSsoForLogin.mockRejectedValue(new Error("connection refused"));

    await expect(SsoManagedSignIn.isManagedBySso(USER_ID)).rejects.toThrow(
      "connection refused",
    );
  });

  test("whether someone is a master admin is read from their own account, as OneUptime", async () => {
    await SsoManagedSignIn.isManagedBySso(USER_ID);

    expect(findOneById).toHaveBeenCalledTimes(1);
    const call: Record<string, unknown> = findOneById.mock
      .calls[0]![0] as Record<string, unknown>;
    expect((call["id"] as ObjectID).toString()).toBe(USER_ID.toString());
    expect(call["select"]).toEqual({ _id: true, isMasterAdmin: true });
    expect(call["props"]).toEqual({ isRoot: true });
  });

  test("an account that does not exist is not found, before either rule is read", async () => {
    findOneById.mockResolvedValue(null);

    await expect(SsoManagedSignIn.isManagedBySso(USER_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(getRequireSsoForLogin).not.toHaveBeenCalled();
    expect(memberProjects.memberships).not.toHaveBeenCalled();
  });
});

describe("SsoManagedSignIn: the projects' rule (#9763)", () => {
  test("every project requires SSO and manages sign-in with it: covered, by the projects", async () => {
    inProjects([managingProject("Acme"), managingProject("Acme Staging")]);

    const state: SsoManagedSignInState =
      await SsoManagedSignIn.getState(USER_ID);

    expect(state.managedBy).toBe(SsoManagedBy.Projects);
    expect(namesOf(state.managingProjects).sort()).toEqual([
      "Acme",
      "Acme Staging",
    ]);
    expect(state.otherProjects).toEqual([]);
    await expect(SsoManagedSignIn.isManagedBySso(USER_ID)).resolves.toBe(true);
  });

  test("one project that does not require SSO keeps their settings theirs, and is named for it", async () => {
    inProjects([managingProject("Acme"), passwordProject("Contractors")]);

    const state: SsoManagedSignInState =
      await SsoManagedSignIn.getState(USER_ID);

    expect(state.managedBy).toBeNull();
    expect(namesOf(state.managingProjects)).toEqual(["Acme"]);
    expect(namesOf(state.otherProjects)).toEqual(["Contractors"]);
  });

  test("a project that requires SSO with Manage Sign-In with SSO off keeps them too: every organization must agree", async () => {
    inProjects([
      managingProject("Acme"),
      {
        ...managingProject("Globex"),
        manageSignInWithSso: false,
      },
    ]);

    const state: SsoManagedSignInState =
      await SsoManagedSignIn.getState(USER_ID);

    expect(state.managedBy).toBeNull();
    expect(namesOf(state.otherProjects)).toEqual(["Globex"]);
  });

  test("the switch on with SSO not required manages nothing", async () => {
    inProjects([
      {
        ...managingProject("Acme"),
        requireSsoForLogin: false,
      },
    ]);

    const state: SsoManagedSignInState =
      await SsoManagedSignIn.getState(USER_ID);

    expect(state.managedBy).toBeNull();
    expect(state.managingProjects).toEqual([]);
    expect(namesOf(state.otherProjects)).toEqual(["Acme"]);
  });

  test("two projects that require SSO through different providers cover them when both manage sign-in", async () => {
    inProjects([managingProject("Acme"), managingProject("Globex")]);

    await expect(SsoManagedSignIn.getManagedBy(USER_ID)).resolves.toBe(
      SsoManagedBy.Projects,
    );
  });

  test("nobody in no project is covered: they would have nowhere to sign in with SSO", async () => {
    inProjects([]);

    const state: SsoManagedSignInState =
      await SsoManagedSignIn.getState(USER_ID);

    expect(state).toEqual({
      managedBy: null,
      managingProjects: [],
      otherProjects: [],
    });
    expect(memberProjects.projects).not.toHaveBeenCalled();
  });

  test("an invitation to a project that does not require SSO gives their settings back before it is accepted", async () => {
    inProjects([
      managingProject("Acme"),
      { ...passwordProject("Contractors"), isPendingInvitation: true },
    ]);

    const state: SsoManagedSignInState =
      await SsoManagedSignIn.getState(USER_ID);

    expect(state.managedBy).toBeNull();
    expect(namesOf(state.otherProjects)).toEqual(["Contractors"]);
  });

  test("an invitation to a project that manages sign-in counts as a project of theirs", async () => {
    inProjects([{ ...managingProject("Acme"), isPendingInvitation: true }]);

    await expect(SsoManagedSignIn.getManagedBy(USER_ID)).resolves.toBe(
      SsoManagedBy.Projects,
    );
  });

  test("a membership whose project no longer exists counts for nothing", async () => {
    inProjects([
      managingProject("Acme"),
      { ...passwordProject("Deleted"), isDeleted: true },
    ]);

    await expect(SsoManagedSignIn.getManagedBy(USER_ID)).resolves.toBe(
      SsoManagedBy.Projects,
    );

    inProjects([{ ...managingProject("Deleted"), isDeleted: true }]);

    await expect(SsoManagedSignIn.getManagedBy(USER_ID)).resolves.toBeNull();
  });

  test("several teams in one project count as one project, read once", async () => {
    const acme: MemberProject = { ...managingProject("Acme"), teamCount: 3 };
    inProjects([acme]);

    const state: SsoManagedSignInState =
      await SsoManagedSignIn.getState(USER_ID);

    expect(state.managingProjects).toHaveLength(1);
    expect(memberProjects.projects).toHaveBeenCalledTimes(1);
    const asked: Array<string> = readQueryValues(
      (
        memberProjects.projects.mock.calls[0]![0] as {
          query: Record<string, unknown>;
        }
      ).query["_id"],
    );
    expect(asked).toEqual([acme.id.toString().toLowerCase()]);
  });

  test("the memberships are read for this person, every kind, as OneUptime", async () => {
    inProjects([managingProject("Acme")]);

    await SsoManagedSignIn.isManagedBySso(USER_ID);

    const call: Record<string, unknown> = memberProjects.memberships.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(String((call["query"] as Record<string, unknown>)["userId"])).toBe(
      USER_ID.toString(),
    );
    // An invitation not accepted yet counts: nothing filters on it.
    expect(call["query"]).not.toHaveProperty("hasAcceptedInvitation");
    expect(call["select"]).toEqual({ _id: true, projectId: true });
    expect(call["props"]).toEqual({ isRoot: true });
    expect(call["skip"]).toBe(0);
    expect(call["limit"]).toBe(LIMIT_MAX);
  });

  test("each project's rule is read from its row, as OneUptime", async () => {
    inProjects([managingProject("Acme")]);

    await SsoManagedSignIn.isManagedBySso(USER_ID);

    const call: Record<string, unknown> = memberProjects.projects.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(call["select"]).toEqual({
      _id: true,
      name: true,
      requireSsoForLogin: true,
      manageSignInWithSso: true,
    });
    expect(call["props"]).toEqual({ isRoot: true });
  });

  test("memberships past the first page are read too: a project on the second page still keeps their settings", async () => {
    // A full first page of one project's teams, then a project that does not manage sign-in.
    inProjects([
      { ...managingProject("Acme"), teamCount: LIMIT_MAX },
      passwordProject("Contractors"),
    ]);

    const state: SsoManagedSignInState =
      await SsoManagedSignIn.getState(USER_ID);

    expect(state.managedBy).toBeNull();
    expect(namesOf(state.otherProjects)).toEqual(["Contractors"]);
    expect(memberProjects.memberships).toHaveBeenCalledTimes(2);
    expect(
      (memberProjects.memberships.mock.calls[1]![0] as { skip: number }).skip,
    ).toBe(LIMIT_MAX);
  });

  test("joining and leaving are read on every ask, never kept", async () => {
    inProjects([managingProject("Acme")]);
    await expect(SsoManagedSignIn.isManagedBySso(USER_ID)).resolves.toBe(true);

    // Invited to a project that keeps its own sign-in: settings back at once.
    memberProjects.setProjects([
      managingProject("Acme"),
      passwordProject("Contractors"),
    ]);
    await expect(SsoManagedSignIn.isManagedBySso(USER_ID)).resolves.toBe(false);

    // Removed from it: covered again at once.
    memberProjects.setProjects([managingProject("Acme")]);
    await expect(SsoManagedSignIn.isManagedBySso(USER_ID)).resolves.toBe(true);

    expect(memberProjects.memberships).toHaveBeenCalledTimes(3);
  });

  test("a project that turns Require SSO off gives their settings back at once", async () => {
    const acme: MemberProject = managingProject("Acme");
    inProjects([acme]);
    await expect(SsoManagedSignIn.isManagedBySso(USER_ID)).resolves.toBe(true);

    memberProjects.setProjects([{ ...acme, requireSsoForLogin: false }]);
    await expect(SsoManagedSignIn.isManagedBySso(USER_ID)).resolves.toBe(false);
  });

  test("memberships that cannot be read refuse: never 'not managed'", async () => {
    getRequireSsoForLogin.mockResolvedValue(false);
    memberProjects.memberships.mockRejectedValue(
      new Error("statement timeout"),
    );

    await expect(SsoManagedSignIn.isManagedBySso(USER_ID)).rejects.toThrow(
      "statement timeout",
    );
    await expect(
      SsoManagedSignIn.assertMayChangeLocalSignIn(USER_ID),
    ).rejects.toThrow("statement timeout");
  });

  test("projects that cannot be read refuse too", async () => {
    inProjects([managingProject("Acme")]);
    memberProjects.projects.mockRejectedValue(new Error("pool exhausted"));

    await expect(SsoManagedSignIn.isManagedBySso(USER_ID)).rejects.toThrow(
      "pool exhausted",
    );
  });
});

describe("SsoManagedSignIn.isManagedBySsoFor: an account whose standing is known", () => {
  test.each([
    [true, false, true],
    [true, true, false],
    [false, false, false],
    [false, true, false],
  ])(
    "server requires SSO: %s, master admin: %s -> covered: %s",
    async (isRequired: boolean, isMasterAdmin: boolean, expected: boolean) => {
      getRequireSsoForLogin.mockResolvedValue(isRequired);

      await expect(
        SsoManagedSignIn.isManagedBySsoFor({
          userId: USER_ID,
          isMasterAdmin,
        }),
      ).resolves.toBe(expected);
      // It is told who the account is: it reads no account itself.
      expect(findOneById).not.toHaveBeenCalled();
    },
  );

  test("reads the projects of the account it is told about", async () => {
    inProjects([managingProject("Acme")]);

    await expect(
      SsoManagedSignIn.isManagedBySsoFor({
        userId: USER_ID,
        isMasterAdmin: false,
      }),
    ).resolves.toBe(true);
    expect(
      String(
        (
          memberProjects.memberships.mock.calls[0]![0] as {
            query: Record<string, unknown>;
          }
        ).query["userId"],
      ),
    ).toBe(USER_ID.toString());
  });

  test("a master admin in projects that manage sign-in is not covered, and nothing is read", async () => {
    inProjects([managingProject("Acme")]);

    await expect(
      SsoManagedSignIn.isManagedBySsoFor({
        userId: USER_ID,
        isMasterAdmin: true,
      }),
    ).resolves.toBe(false);
    expect(memberProjects.memberships).not.toHaveBeenCalled();
  });
});

describe("SsoManagedSignIn.assertMayChangeLocalSignIn and assertMayChangeLocalSignInFor", () => {
  test("refuses a covered person with why, as a refusal and not a failure", async () => {
    const refusal: Promise<void> =
      SsoManagedSignIn.assertMayChangeLocalSignIn(USER_ID);

    await expect(refusal).rejects.toThrow(BadDataException);
    await expect(
      SsoManagedSignIn.assertMayChangeLocalSignIn(USER_ID),
    ).rejects.toThrow(SSO_MANAGED_SIGN_IN_MESSAGE);
  });

  test("refuses someone their projects cover in the same words", async () => {
    inProjects([managingProject("Acme")]);

    await expect(
      SsoManagedSignIn.assertMayChangeLocalSignIn(USER_ID),
    ).rejects.toThrow(new BadDataException(SSO_MANAGED_SIGN_IN_MESSAGE));
    await expect(
      SsoManagedSignIn.assertMayChangeLocalSignInFor({
        userId: USER_ID,
        isMasterAdmin: false,
      }),
    ).rejects.toThrow(new BadDataException(SSO_MANAGED_SIGN_IN_MESSAGE));
  });

  test("lets everyone through while neither rule covers them", async () => {
    inProjects([managingProject("Acme"), passwordProject("Contractors")]);

    await expect(
      SsoManagedSignIn.assertMayChangeLocalSignIn(USER_ID),
    ).resolves.toBeUndefined();
    await expect(
      SsoManagedSignIn.assertMayChangeLocalSignInFor({ userId: USER_ID }),
    ).resolves.toBeUndefined();
  });

  test("lets a master admin through while the server requires SSO", async () => {
    findOneById.mockResolvedValue(account({ isMasterAdmin: true }));

    await expect(
      SsoManagedSignIn.assertMayChangeLocalSignIn(USER_ID),
    ).resolves.toBeUndefined();
    await expect(
      SsoManagedSignIn.assertMayChangeLocalSignInFor({
        userId: USER_ID,
        isMasterAdmin: true,
      }),
    ).resolves.toBeUndefined();
  });

  test("a rule that cannot be read refuses with the read's own error, not the SSO sentence", async () => {
    getRequireSsoForLogin.mockRejectedValue(new Error("statement timeout"));

    await expect(
      SsoManagedSignIn.assertMayChangeLocalSignIn(USER_ID),
    ).rejects.toThrow("statement timeout");
  });
});

describe("SsoManagedSignIn.getSignInManagement: what User Profile is told", () => {
  test("a person the server covers is told so, with the server's providers by name", async () => {
    getInstanceWideProviders.mockResolvedValue([
      provider("Microsoft Entra ID"),
      provider("Okta", SsoProviderType.GlobalOIDC),
    ]);

    await expect(
      SsoManagedSignIn.getSignInManagement(USER_ID),
    ).resolves.toEqual({
      isManagedBySso: true,
      ssoProviderNames: ["Microsoft Entra ID", "Okta"],
      localSignInProjectNames: [],
    });
    expect(getProjectSignInMethods).not.toHaveBeenCalled();
  });

  test("somebody who is not covered is told nothing more, and no provider is read", async () => {
    getRequireSsoForLogin.mockResolvedValue(false);

    await expect(
      SsoManagedSignIn.getSignInManagement(USER_ID),
    ).resolves.toEqual({
      isManagedBySso: false,
      ssoProviderNames: [],
      localSignInProjectNames: [],
    });
    expect(getInstanceWideProviders).not.toHaveBeenCalled();
    expect(getProjectSignInMethods).not.toHaveBeenCalled();
  });

  test("a master admin is not covered, whatever the server requires", async () => {
    findOneById.mockResolvedValue(account({ isMasterAdmin: true }));

    await expect(
      SsoManagedSignIn.getSignInManagement(USER_ID),
    ).resolves.toEqual({
      isManagedBySso: false,
      ssoProviderNames: [],
      localSignInProjectNames: [],
    });
  });

  test("providers that cannot be read leave the profile naming none, never showing the settings", async () => {
    getInstanceWideProviders.mockRejectedValue(new Error("pool exhausted"));

    await expect(
      SsoManagedSignIn.getSignInManagement(USER_ID),
    ).resolves.toEqual({
      isManagedBySso: true,
      ssoProviderNames: [],
      localSignInProjectNames: [],
    });
    expect(logger.error).toHaveBeenCalled();
  });

  test("no provider on names none", async () => {
    getInstanceWideProviders.mockResolvedValue([]);

    await expect(
      SsoManagedSignIn.getSignInManagement(USER_ID),
    ).resolves.toEqual({
      isManagedBySso: true,
      ssoProviderNames: [],
      localSignInProjectNames: [],
    });
  });

  test("a rule that cannot be read is an error to the profile, never a 'not managed'", async () => {
    getRequireSsoForLogin.mockRejectedValue(new Error("connection refused"));

    await expect(SsoManagedSignIn.getSignInManagement(USER_ID)).rejects.toThrow(
      "connection refused",
    );
  });

  test("someone their projects cover is named the providers that sign them in to those projects, each once", async () => {
    const acme: MemberProject = managingProject("Acme");
    const globex: MemberProject = managingProject("Globex");
    inProjects([acme, globex]);
    providersByProject.set(acme.id.toString(), [
      provider("Okta", SsoProviderType.ProjectSSO),
      provider("Company Google", SsoProviderType.GlobalOIDC),
    ]);
    providersByProject.set(globex.id.toString(), [
      provider("Microsoft Entra ID", SsoProviderType.ProjectOIDC),
      provider("okta", SsoProviderType.ProjectSSO),
    ]);

    await expect(
      SsoManagedSignIn.getSignInManagement(USER_ID),
    ).resolves.toEqual({
      isManagedBySso: true,
      ssoProviderNames: ["Okta", "Company Google", "Microsoft Entra ID"],
      localSignInProjectNames: [],
    });
    expect(getInstanceWideProviders).not.toHaveBeenCalled();
  });

  test("someone only some of whose projects manage sign-in is told which projects keep their settings, and the providers of the others", async () => {
    const acme: MemberProject = managingProject("Acme");
    inProjects([
      acme,
      passwordProject("Contractors"),
      { ...managingProject("Globex"), manageSignInWithSso: false },
    ]);
    providersByProject.set(acme.id.toString(), [provider("Okta")]);

    const answer: Awaited<
      ReturnType<typeof SsoManagedSignIn.getSignInManagement>
    > = await SsoManagedSignIn.getSignInManagement(USER_ID);

    expect(answer.isManagedBySso).toBe(false);
    expect(answer.ssoProviderNames).toEqual(["Okta"]);
    expect(answer.localSignInProjectNames.sort()).toEqual([
      "Contractors",
      "Globex",
    ]);
    // Only the projects that manage sign-in are asked for their providers.
    expect(getProjectSignInMethods).toHaveBeenCalledTimes(1);
  });

  test("someone in no project that manages sign-in is told nothing more, whatever their other projects are", async () => {
    inProjects([passwordProject("Contractors")]);

    await expect(
      SsoManagedSignIn.getSignInManagement(USER_ID),
    ).resolves.toEqual({
      isManagedBySso: false,
      ssoProviderNames: [],
      localSignInProjectNames: [],
    });
    expect(getProjectSignInMethods).not.toHaveBeenCalled();
  });

  test("the projects' providers are a courtesy too: a read that fails is logged, names none, and they are still covered", async () => {
    inProjects([managingProject("Acme")]);
    getProjectSignInMethods.mockRejectedValue(new Error("pool exhausted"));

    await expect(
      SsoManagedSignIn.getSignInManagement(USER_ID),
    ).resolves.toEqual({
      isManagedBySso: true,
      ssoProviderNames: [],
      localSignInProjectNames: [],
    });
    expect(logger.error).toHaveBeenCalled();
  });

  test("names at most as many providers as a profile draws, and stops asking projects once it has them", async () => {
    const projects: Array<MemberProject> = [];

    for (let index: number = 0; index < 3; index++) {
      const project: MemberProject = managingProject(`Project ${index}`);
      providersByProject.set(
        project.id.toString(),
        Array.from(
          { length: MAX_SSO_PROVIDER_NAMES },
          (_value: unknown, providerIndex: number): SsoSignInProvider => {
            return provider(`Provider ${index}-${providerIndex}`);
          },
        ),
      );
      projects.push(project);
    }

    inProjects(projects);

    const answer: Awaited<
      ReturnType<typeof SsoManagedSignIn.getSignInManagement>
    > = await SsoManagedSignIn.getSignInManagement(USER_ID);

    expect(answer.ssoProviderNames).toHaveLength(MAX_SSO_PROVIDER_NAMES);
    expect(getProjectSignInMethods).toHaveBeenCalledTimes(1);
  });

  test("asks at most as many projects for their providers as a profile names projects", async () => {
    const projects: Array<MemberProject> = Array.from(
      { length: MAX_LOCAL_SIGN_IN_PROJECT_NAMES + 5 },
      (_value: unknown, index: number): MemberProject => {
        return managingProject(`Project ${index}`);
      },
    );
    inProjects(projects);

    await SsoManagedSignIn.getSignInManagement(USER_ID);

    expect(getProjectSignInMethods).toHaveBeenCalledTimes(
      MAX_LOCAL_SIGN_IN_PROJECT_NAMES,
    );
  });

  test("names at most as many projects that keep their settings as a profile draws", async () => {
    inProjects([
      managingProject("Acme"),
      ...Array.from(
        { length: MAX_LOCAL_SIGN_IN_PROJECT_NAMES + 4 },
        (_value: unknown, index: number): MemberProject => {
          return passwordProject(`Contractors ${index}`);
        },
      ),
    ]);

    const answer: Awaited<
      ReturnType<typeof SsoManagedSignIn.getSignInManagement>
    > = await SsoManagedSignIn.getSignInManagement(USER_ID);

    expect(answer.localSignInProjectNames).toHaveLength(
      MAX_LOCAL_SIGN_IN_PROJECT_NAMES,
    );
  });
});
