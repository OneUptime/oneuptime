import SignUpInvitationUtil from "../../../FeatureSet/Identity/Utils/SignUpInvitation";
import SsoManagedSignIn from "Common/Server/Utils/SsoManagedSignIn";
import SsoSignInMethods from "Common/Server/Utils/SsoSignInMethods";
import { SsoSignInProvider } from "Common/Types/SSO/SignInMethods";
import { SsoManagedBy } from "Common/Types/SSO/SsoManagedSignIn";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserService from "Common/Server/Services/UserService";
import InvitationInviterUtil from "Common/Server/Utils/TeamMember/InvitationInviter";
import UserRegistrationToken from "Common/Server/Utils/UserRegistrationToken";
import Project from "Common/Models/DatabaseModels/Project";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import {
  SignUpInvitation,
  readSignUpInvitationAnswer,
  toSignUpInvitationAnswerJSON,
} from "Common/Types/Accounts/SignUpInvitation";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Email from "Common/Types/Email";
import HashedString from "Common/Types/HashedString";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * THE INVITATION A SIGN-UP LINK IS FOR (#7471, Identity/Utils/
 * SignUpInvitation).
 *
 * The sign-up page an invitation opens says which project invited the
 * person and who, and fills in the name the inviter typed - for the holder
 * of the invited address's registration token alone, the token read and
 * never spent: every other ask is answered with none. Creating the account
 * from that page joins the project it named.
 */

jest.mock("Common/Server/Utils/Logger");

const EMAIL: string = "grace@walk.example";
const TOKEN: string = "73100000-0000-4000-8000-000000000001";
const GRACE_ID: ObjectID = new ObjectID("73200000-0000-4000-8000-000000000001");
const ADA_ID: ObjectID = new ObjectID("73200000-0000-4000-8000-000000000002");
const WALK_CO: ObjectID = new ObjectID("73300000-0000-4000-8000-000000000001");
const ACME: ObjectID = new ObjectID("73300000-0000-4000-8000-000000000002");

function invitedAccount(data?: {
  password?: boolean;
  isBlocked?: boolean;
  name?: string | null;
}): User {
  const user: User = new User();
  user._id = GRACE_ID.toString();
  user.email = new Email(EMAIL);

  if (data?.name !== null) {
    user.name = new Name(data?.name ?? "Grace Member");
  }

  if (data?.password) {
    user.password = new HashedString("already-set", true);
  }

  if (data?.isBlocked) {
    user.isBlocked = true;
  }

  return user;
}

function membership(data: {
  projectId: ObjectID;
  projectName?: string | null;
  isAccepted?: boolean;
  createdBy?: ObjectID | null;
}): TeamMember {
  const member: TeamMember = new TeamMember();
  member._id = ObjectID.generate().toString();
  member.projectId = data.projectId;
  member.hasAcceptedInvitation = Boolean(data.isAccepted);

  if (data.projectName !== null) {
    const project: Project = new Project();
    project._id = data.projectId.toString();
    project.name = data.projectName ?? "Walk Co";
    member.project = project;
  }

  if (data.createdBy !== null) {
    member.createdByUserId = data.createdBy ?? ADA_ID;
  }

  return member;
}

let tokenLiveSpy: SpyInstance<
  typeof UserRegistrationToken.isRegistrationTokenLive
>;
let findUserSpy: SpyInstance<typeof UserService.findOneBy>;
let findMembershipsSpy: SpyInstance<typeof TeamMemberService.findBy>;
let readInviterSpy: SpyInstance<typeof InvitationInviterUtil.readById>;
let managedOnceInSpy: SpyInstance<typeof SsoManagedSignIn.getManagedByOnceIn>;
let projectSignInMethodsSpy: SpyInstance<
  typeof SsoSignInMethods.getProjectSignInMethods
>;

const OKTA: SsoSignInProvider = {
  type: SsoProviderType.ProjectSSO,
  id: "73400000-0000-4000-8000-000000000001",
  name: "Okta",
  description: "",
};

beforeEach(() => {
  tokenLiveSpy = jest
    .spyOn(UserRegistrationToken, "isRegistrationTokenLive")
    .mockResolvedValue(true);
  findUserSpy = jest
    .spyOn(UserService, "findOneBy")
    .mockResolvedValue(invitedAccount());
  findMembershipsSpy = jest
    .spyOn(TeamMemberService, "findBy")
    .mockResolvedValue([membership({ projectId: WALK_CO })]);
  readInviterSpy = jest
    .spyOn(InvitationInviterUtil, "readById")
    .mockResolvedValue({ name: "Ada Walker", email: "ada@walk.example" });
  managedOnceInSpy = jest
    .spyOn(SsoManagedSignIn, "getManagedByOnceIn")
    .mockResolvedValue(null);
  projectSignInMethodsSpy = jest
    .spyOn(SsoSignInMethods, "getProjectSignInMethods")
    .mockResolvedValue({ ssoProviders: [OKTA] });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const ask: (data?: {
  email?: unknown;
  token?: unknown;
}) => Promise<SignUpInvitation | null> = (data?: {
  email?: unknown;
  token?: unknown;
}): Promise<SignUpInvitation | null> => {
  return SignUpInvitationUtil.read({
    email: data && "email" in data ? data.email : EMAIL,
    token: data && "token" in data ? data.token : TOKEN,
  });
};

describe("what the sign-up page may say", () => {
  test("for the holder of the invited address's token: which project, who invited them and the name typed for them", async () => {
    await expect(ask()).resolves.toEqual({
      projectId: WALK_CO.toString(),
      projectName: "Walk Co",
      inviterName: "Ada Walker",
      name: "Grace Member",
      isAccepted: false,
      ssoSignIn: null,
    });
  });

  test("checks the token against the address asked about, and never spends it", async () => {
    const consumeSpy: SpyInstance<
      typeof UserRegistrationToken.consumeRegistrationToken
    > = jest.spyOn(UserRegistrationToken, "consumeRegistrationToken");

    await ask({ email: ` ${EMAIL.toUpperCase()} ` });

    const checked: { token: ObjectID; email: Email } = tokenLiveSpy.mock
      .calls[0]![0] as { token: ObjectID; email: Email };

    expect(checked.token.toString()).toBe(TOKEN);
    expect(checked.email.toString()).toBe(EMAIL);
    expect(consumeSpy).not.toHaveBeenCalled();
  });

  test("reads the account and its memberships as OneUptime, the newest first", async () => {
    await ask();

    const userRead: { query: { email: Email }; props: unknown } = findUserSpy
      .mock.calls[0]![0] as unknown as {
      query: { email: Email };
      props: unknown;
    };

    expect(userRead.query.email.toString()).toBe(EMAIL);
    expect(userRead.props).toEqual({ isRoot: true });

    const membershipsRead: {
      query: { userId: ObjectID };
      sort: Record<string, unknown>;
      props: unknown;
    } = findMembershipsSpy.mock.calls[0]![0] as unknown as {
      query: { userId: ObjectID };
      sort: Record<string, unknown>;
      props: unknown;
    };

    expect(membershipsRead.query.userId.toString()).toBe(GRACE_ID.toString());
    expect(membershipsRead.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(membershipsRead.props).toEqual({ isRoot: true });
  });

  test("names who made the invitation it shows", async () => {
    await ask();

    expect(readInviterSpy.mock.calls[0]![0]?.toString()).toBe(
      ADA_ID.toString(),
    );
  });

  test("shows the newest invitation still waiting, over a newer one accepted for them", async () => {
    findMembershipsSpy.mockResolvedValue([
      membership({ projectId: ACME, projectName: "Acme", isAccepted: true }),
      membership({ projectId: WALK_CO }),
    ]);

    const invitation: SignUpInvitation | null = await ask();

    expect(invitation?.projectId).toBe(WALK_CO.toString());
    expect(invitation?.isAccepted).toBe(false);
  });

  test("with nothing waiting, shows the membership accepted for them, saying so", async () => {
    findMembershipsSpy.mockResolvedValue([
      membership({ projectId: ACME, projectName: "Acme", isAccepted: true }),
    ]);

    await expect(ask()).resolves.toMatchObject({
      projectId: ACME.toString(),
      projectName: "Acme",
      isAccepted: true,
    });
  });

  test("passes over a membership whose project it cannot name", async () => {
    findMembershipsSpy.mockResolvedValue([
      membership({ projectId: ACME, projectName: null }),
      membership({ projectId: WALK_CO }),
    ]);

    await expect(ask()).resolves.toMatchObject({
      projectId: WALK_CO.toString(),
    });
  });

  test("an invitation nobody made by hand, or whose maker cannot be read, names no inviter", async () => {
    readInviterSpy.mockResolvedValue(null);

    await expect(ask()).resolves.toMatchObject({ inviterName: null });

    readInviterSpy.mockRejectedValue(new Error("The database went away."));

    await expect(ask()).resolves.toMatchObject({
      projectName: "Walk Co",
      inviterName: null,
    });
  });

  test("an account the inviter gave no name leaves the name to them", async () => {
    findUserSpy.mockResolvedValue(invitedAccount({ name: null }));

    await expect(ask()).resolves.toMatchObject({ name: null });
  });
});

describe("what it says to anyone else: nothing, the same for all", () => {
  test.each([
    ["no address", { email: undefined }],
    ["an address that is not one", { email: "grace" }],
    ["an address that is not text", { email: 42 }],
    ["no token", { token: undefined }],
    ["a token that is not one", { token: "not-a-token" }],
    ["a token that is not text", { token: { $ne: null } }],
  ])(
    "%s: none, and nothing is read",
    async (_case: string, data: { email?: unknown; token?: unknown }) => {
      await expect(ask(data)).resolves.toBeNull();
      expect(tokenLiveSpy).not.toHaveBeenCalled();
      expect(findUserSpy).not.toHaveBeenCalled();
    },
  );

  test("a token that is wrong, spent, expired or another address's: none, and no account is read", async () => {
    tokenLiveSpy.mockResolvedValue(false);

    await expect(ask()).resolves.toBeNull();
    expect(findUserSpy).not.toHaveBeenCalled();
    expect(findMembershipsSpy).not.toHaveBeenCalled();
  });

  test.each([
    ["has signed up already", invitedAccount({ password: true })],
    ["is blocked", invitedAccount({ isBlocked: true })],
  ])(
    "an account that %s: none, and its memberships are not read",
    async (_case: string, user: User) => {
      findUserSpy.mockResolvedValue(user);

      await expect(ask()).resolves.toBeNull();
      expect(findMembershipsSpy).not.toHaveBeenCalled();
    },
  );

  test("no account at the address: none", async () => {
    findUserSpy.mockResolvedValue(null);

    await expect(ask()).resolves.toBeNull();
  });

  test("an account with no invitation left: none", async () => {
    findMembershipsSpy.mockResolvedValue([]);

    await expect(ask()).resolves.toBeNull();
  });
});

describe("joining the project the page named, once the token claimed the account", () => {
  let updateSpy: SpyInstance<typeof TeamMemberService.updateBy>;

  beforeEach(() => {
    updateSpy = jest.spyOn(TeamMemberService, "updateBy").mockResolvedValue(2);
  });

  test("accepts every invitation of that project still waiting for them, as OneUptime", async () => {
    const joined: ObjectID | null =
      await SignUpInvitationUtil.acceptForClaimedAccount({
        userId: GRACE_ID,
        projectId: WALK_CO.toString(),
      });

    expect(joined?.toString()).toBe(WALK_CO.toString());

    const update: {
      query: Record<string, unknown>;
      data: Record<string, unknown>;
      props: unknown;
    } = updateSpy.mock.calls[0]![0] as unknown as {
      query: Record<string, unknown>;
      data: Record<string, unknown>;
      props: unknown;
    };

    expect(String(update.query["userId"])).toBe(GRACE_ID.toString());
    expect(String(update.query["projectId"])).toBe(WALK_CO.toString());
    expect(update.query["hasAcceptedInvitation"]).toBe(false);
    expect(update.data["hasAcceptedInvitation"]).toBe(true);
    expect(update.data["invitationAcceptedAt"]).toBeInstanceOf(Date);
    expect(update.props).toEqual({ isRoot: true });
  });

  test("with nothing waiting there, joins nothing", async () => {
    updateSpy.mockResolvedValue(0);

    await expect(
      SignUpInvitationUtil.acceptForClaimedAccount({
        userId: GRACE_ID,
        projectId: WALK_CO.toString(),
      }),
    ).resolves.toBeNull();
  });

  test.each([
    ["no project", undefined],
    ["a project that is not one", "walk-co"],
    ["a project that is not text", { $ne: null }],
  ])(
    "%s named: nothing is accepted",
    async (_case: string, projectId: unknown) => {
      await expect(
        SignUpInvitationUtil.acceptForClaimedAccount({
          userId: GRACE_ID,
          projectId: projectId,
        }),
      ).resolves.toBeNull();
      expect(updateSpy).not.toHaveBeenCalled();
    },
  );

  test("a failure never fails the sign-up: the invitation waits for them instead", async () => {
    updateSpy.mockRejectedValue(new Error("The database went away."));

    await expect(
      SignUpInvitationUtil.acceptForClaimedAccount({
        userId: GRACE_ID,
        projectId: WALK_CO.toString(),
      }),
    ).resolves.toBeNull();
  });
});

describe("the answer, as the route sends it and the page reads it", () => {
  const INVITATION: SignUpInvitation = {
    projectId: WALK_CO.toString(),
    projectName: "Walk Co",
    inviterName: "Ada Walker",
    name: "Grace Member",
    isAccepted: false,
    ssoSignIn: null,
  };

  test("is read back as it was sent", () => {
    expect(
      readSignUpInvitationAnswer(toSignUpInvitationAnswerJSON(INVITATION)),
    ).toEqual(INVITATION);
  });

  test("none is sent as none, and read as none", () => {
    expect(toSignUpInvitationAnswerJSON(null)).toEqual({ invitation: null });
    expect(readSignUpInvitationAnswer({ invitation: null })).toBeNull();
  });

  test.each([
    ["nothing", undefined],
    ["a list", []],
    ["no invitation", {}],
    ["no project", { invitation: { projectName: "Walk Co" } }],
    ["no project name", { invitation: { projectId: WALK_CO.toString() } }],
    [
      "a blank project name",
      { invitation: { projectId: WALK_CO.toString(), projectName: "  " } },
    ],
  ])("of another shape (%s) is none", (_case: string, data: unknown) => {
    expect(readSignUpInvitationAnswer(data)).toBeNull();
  });

  test("reads a missing inviter and name as none, and only true as accepted", () => {
    expect(
      readSignUpInvitationAnswer({
        invitation: {
          projectId: WALK_CO.toString(),
          projectName: " Walk Co ",
          inviterName: 7,
          isAccepted: "yes",
        },
      }),
    ).toEqual({
      projectId: WALK_CO.toString(),
      projectName: "Walk Co",
      inviterName: null,
      name: null,
      isAccepted: false,
      ssoSignIn: null,
    });
  });

  test("an invitation whose sign-in is single sign-on carries its providers there and back (#9819)", () => {
    const withSso: SignUpInvitation = {
      ...INVITATION,
      ssoSignIn: { providers: [OKTA] },
    };

    expect(
      readSignUpInvitationAnswer(toSignUpInvitationAnswerJSON(withSso)),
    ).toEqual(withSso);
  });

  test.each([
    ["no SSO at all (an older server)", undefined, null],
    ["SSO of another shape", "yes", null],
    ["a list", [], null],
    [
      "providers that are not providers",
      { providers: [{ name: "x" }, "y", null] },
      { providers: [] },
    ],
  ])(
    "reads %s as what the page can use",
    (_case: string, ssoSignIn: unknown, expected: unknown) => {
      expect(
        readSignUpInvitationAnswer({
          invitation: {
            projectId: WALK_CO.toString(),
            projectName: "Walk Co",
            ...(ssoSignIn === undefined ? {} : { ssoSignIn: ssoSignIn }),
          },
        })?.ssoSignIn,
      ).toEqual(expected);
    },
  );
});

describe("an invitation whose person signs in with single sign-on (#9819)", () => {
  test("when SSO would manage their sign-in once they join, the page is given the project's providers", async () => {
    managedOnceInSpy.mockResolvedValue(SsoManagedBy.Projects);

    const invitation: SignUpInvitation | null = await ask();

    expect(invitation?.ssoSignIn).toEqual({ providers: [OKTA] });
    expect(managedOnceInSpy).toHaveBeenCalledWith({
      userId: GRACE_ID,
      isMasterAdmin: false,
      joiningProjectId: WALK_CO,
    });
    expect(String(projectSignInMethodsSpy.mock.calls[0]![0])).toBe(
      WALK_CO.toString(),
    );
  });

  test("a project with no provider turned on yet: SSO all the same, with none to offer", async () => {
    managedOnceInSpy.mockResolvedValue(SsoManagedBy.Projects);
    projectSignInMethodsSpy.mockResolvedValue({ ssoProviders: [] });

    expect((await ask())?.ssoSignIn).toEqual({ providers: [] });
  });

  test("someone who also belongs to a project that keeps their own sign-in: the sign-up page it always was", async () => {
    managedOnceInSpy.mockResolvedValue(null);

    expect((await ask())?.ssoSignIn).toBeNull();
    expect(projectSignInMethodsSpy).not.toHaveBeenCalled();
  });

  test("a server that requires SSO for everyone is the page's own to offer, not this", async () => {
    managedOnceInSpy.mockResolvedValue(SsoManagedBy.Server);

    expect((await ask())?.ssoSignIn).toBeNull();
  });

  test("a rule or providers that cannot be read leave the plain sign-up page, never an error", async () => {
    managedOnceInSpy.mockRejectedValue(new Error("database down"));

    await expect(ask()).resolves.toMatchObject({ ssoSignIn: null });

    managedOnceInSpy.mockResolvedValue(SsoManagedBy.Projects);
    projectSignInMethodsSpy.mockRejectedValue(new Error("database down"));

    await expect(ask()).resolves.toMatchObject({ ssoSignIn: null });
  });

  test("the name the page starts with is the one typed with this invitation (#9823)", async () => {
    const typed: TeamMember = membership({ projectId: WALK_CO });
    typed.inviteeName = "Grace (typed for Walk Co)";
    findMembershipsSpy.mockResolvedValue([typed]);

    expect((await ask())?.name).toBe("Grace (typed for Walk Co)");
  });
});
