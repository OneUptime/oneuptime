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
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import SsoManagedSignIn from "../../../Server/Utils/SsoManagedSignIn";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import ObjectID from "../../../Types/ObjectID";
import { SsoManagedBy } from "../../../Types/SSO/SsoManagedSignIn";
import { getJestSpyOn } from "../../Spy";
import {
  managingProject,
  MemberProject,
  MemberProjectsStandIn,
  passwordProject,
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
 * WHETHER AN INVITATION LEADS TO SINGLE SIGN-ON (#9819,
 * SsoManagedSignIn.getManagedByOnceIn).
 *
 * An invitation into a project that manages sign-in with SSO used to email
 * "Create your account" and open a sign-up page with a password field, so
 * someone invited only to such a project typed a password and only then
 * learned to sign in with SSO. The invitation email and the page now offer
 * SSO when the person's sign-in would be SSO's once they join - the rule of
 * #9763 with the inviting project among theirs - and are unchanged for
 * anyone who also belongs to a project that does not manage sign-in.
 */

const USER_ID: ObjectID = new ObjectID("9a000000-0000-4000-8000-000000000001");

let memberProjects: MemberProjectsStandIn;
let joining: MemberProject | null;
let getRequireSsoForLogin: jest.SpyInstance;
let findUser: jest.SpyInstance;

function joiningProject(project: MemberProject | null): void {
  joining = project;
}

beforeEach(() => {
  memberProjects = standInMemberProjects([]);
  joining = managingProject("Acme Production");

  getRequireSsoForLogin = getJestSpyOn(
    GlobalConfigService,
    "getRequireSsoForLogin",
  ).mockResolvedValue(false);

  findUser = getJestSpyOn(UserService, "findOneById").mockImplementation(
    async (): Promise<User> => {
      const user: User = new User();
      user._id = USER_ID.toString();
      user.isMasterAdmin = false;
      return user;
    },
  );

  getJestSpyOn(ProjectService, "findOneById").mockImplementation(
    async (): Promise<Project | null> => {
      if (!joining || joining.isDeleted) {
        return null;
      }

      const row: Project = new Project();
      row._id = joining.id.toString();
      row.requireSsoForLogin = joining.requireSsoForLogin;
      row.manageSignInWithSso = joining.manageSignInWithSso;
      return row;
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function ask(data?: {
  userId?: ObjectID | null;
  isMasterAdmin?: boolean | undefined;
}): Promise<SsoManagedBy | null> {
  return await SsoManagedSignIn.getManagedByOnceIn({
    userId: data?.userId === undefined ? USER_ID : data.userId,
    isMasterAdmin: data?.isMasterAdmin,
    joiningProjectId: joining?.id || ObjectID.generate(),
  });
}

describe("an invitation into a project that manages sign-in with SSO", () => {
  test("someone with no account yet: SSO, from the projects' rule", async () => {
    expect(await ask({ userId: null })).toBe(SsoManagedBy.Projects);
    // Nobody to look up.
    expect(findUser).not.toHaveBeenCalled();
    expect(memberProjects.memberships).not.toHaveBeenCalled();
  });

  test("someone in no other project: SSO", async () => {
    expect(await ask()).toBe(SsoManagedBy.Projects);
  });

  test("someone whose every other project manages sign-in too, invitations included: SSO", async () => {
    memberProjects.setProjects([
      managingProject("Acme Staging"),
      { ...managingProject("Acme Labs"), isPendingInvitation: true },
    ]);

    expect(await ask()).toBe(SsoManagedBy.Projects);
  });

  test("the inviting project counted again, as on a resend or a second team: SSO", async () => {
    memberProjects.setProjects([
      { ...joining!, isPendingInvitation: true, teamCount: 2 },
    ]);

    expect(await ask()).toBe(SsoManagedBy.Projects);
  });
});

describe("an invitation that stays the one it always was", () => {
  test.each([
    ["an accepted membership", false],
    ["another invitation", true],
  ])(
    "someone who also has %s in a project that keeps their own sign-in",
    async (_case: string, isPendingInvitation: boolean) => {
      memberProjects.setProjects([
        { ...passwordProject("Side Project"), isPendingInvitation },
      ]);

      // Nobody is sent to an SSO that would not be their only way in.
      expect(await ask()).toBeNull();
    },
  );

  test("a project that requires SSO but does not manage sign-in", async () => {
    joiningProject({
      ...managingProject("Acme"),
      manageSignInWithSso: false,
    });

    expect(await ask({ userId: null })).toBeNull();
  });

  test("a project that does not require SSO", async () => {
    joiningProject(passwordProject("Acme"));

    expect(await ask({ userId: null })).toBeNull();
  });

  test("a project that no longer exists", async () => {
    joiningProject({ ...managingProject("Acme"), isDeleted: true });

    expect(await ask()).toBeNull();
  });

  test("a master admin, without either rule even read - however they are known", async () => {
    expect(await ask({ isMasterAdmin: true })).toBeNull();

    findUser.mockImplementation(async (): Promise<User> => {
      const user: User = new User();
      user._id = USER_ID.toString();
      user.isMasterAdmin = true;
      return user;
    });

    expect(await ask()).toBeNull();
    expect(getRequireSsoForLogin).not.toHaveBeenCalled();
  });
});

describe("a server that requires SSO for everyone", () => {
  test("is SSO for everyone but master admins, whatever the project says", async () => {
    getRequireSsoForLogin.mockResolvedValue(true);
    joiningProject(passwordProject("Acme"));

    expect(await ask()).toBe(SsoManagedBy.Server);
    expect(await ask({ userId: null })).toBe(SsoManagedBy.Server);
    expect(await ask({ isMasterAdmin: true })).toBeNull();
  });
});

describe("read afresh on every ask", () => {
  test("joining a project that keeps its own sign-in turns it off at once", async () => {
    expect(await ask()).toBe(SsoManagedBy.Projects);

    memberProjects.setProjects([passwordProject("Side Project")]);

    expect(await ask()).toBeNull();
  });
});
