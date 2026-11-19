import EmailVerificationToken from "../../../Models/DatabaseModels/EmailVerificationToken";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import EmailVerificationTokenService from "../../../Server/Services/EmailVerificationTokenService";
import MailService from "../../../Server/Services/MailService";
import ProjectSCIMService from "../../../Server/Services/ProjectSCIMService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import TeamService from "../../../Server/Services/TeamService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import HashedString from "../../../Types/HashedString";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * THE NAME AN INVITATION GIVES (#9745).
 *
 * The invite forms used to ask the server whether an address had an
 * account (POST /team-member/is-user-registered, gone) and offered a Name
 * only when it had none. They now offer it for every address typed
 * (Common/UI/Utils/InviteeName), so the server is what keeps the name to
 * the accounts it is for: the one the invitation creates, and one an
 * earlier invitation created that nobody has claimed yet (no password) and
 * that has no name. A person who has signed up keeps their profile, named
 * or not: no inviter, of any project, writes it. And the invitation goes
 * on alike whichever it is, so the inviter is told nothing about the
 * address.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TEAM_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const INVITER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const INVITEE_EMAIL: Email = new Email("grace@company.com");

let findUserSpy: jest.SpyInstance;
let findUserByIdSpy: jest.SpyInstance;
let createUserSpy: jest.SpyInstance;
let updateUserSpy: jest.SpyInstance;
let sendMailSpy: jest.SpyInstance;

// Calls a protected hook without widening the service's public surface.
function callHook(
  service: unknown,
  name: string,
  ...args: Array<unknown>
): Promise<unknown> {
  const hooks: Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  > = service as Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  >;

  return hooks[name]!.apply(service, args);
}

// An invitation by address, as the invite forms send it.
function inviteBy(name?: string | undefined): CreateBy<TeamMember> {
  const member: TeamMember = new TeamMember();
  member.projectId = PROJECT_ID;
  member.teamId = TEAM_ID;

  return {
    data: member,
    props: {
      userId: INVITER_ID,
      tenantId: PROJECT_ID,
    } as DatabaseCommonInteractionProps,
    miscDataProps: {
      email: INVITEE_EMAIL.toString(),
      ...(name === undefined ? {} : { name: name }),
    },
  } as CreateBy<TeamMember>;
}

// The account at the address, as the hook reads it: its id and password.
function accountAtAddress(data: { hasSignedUp: boolean }): User {
  const user: User = new User(USER_ID);
  user._id = USER_ID.toString();
  user.email = INVITEE_EMAIL;

  if (data.hasSignedUp) {
    user.password = new HashedString("already-signed-up", true);
  }

  return user;
}

// The account's name, as the hook reads it before naming the account.
function withName(name: string | null): User {
  const user: User = new User(USER_ID);
  user._id = USER_ID.toString();

  if (name) {
    user.name = new Name(name);
  }

  return user;
}

// The name the hook wrote onto an existing account, if it wrote one.
function nameWritten(): string | null {
  if (updateUserSpy.mock.calls.length === 0) {
    return null;
  }

  expect(updateUserSpy).toHaveBeenCalledTimes(1);

  const update: { id: ObjectID; data: { name?: Name } } = updateUserSpy.mock
    .calls[0]![0] as { id: ObjectID; data: { name?: Name } };

  expect(update.id.toString()).toBe(USER_ID.toString());

  return update.data.name ? update.data.name.toString() : null;
}

beforeEach(() => {
  stubProjectDirectory({});

  jest.spyOn(TeamService, "findOneBy").mockResolvedValue(new Team(TEAM_ID));
  jest
    .spyOn(TeamPermissionService, "assertCanGrantTeamPermissions")
    .mockResolvedValue(undefined);
  jest
    .spyOn(ProjectSCIMService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));

  // No membership of this team yet, and none of the project.
  jest.spyOn(TeamMemberService, "findOneBy").mockResolvedValue(null);
  jest
    .spyOn(TeamMemberService, "getUniqueTeamMemberCountInProject")
    .mockResolvedValue(0);
  jest
    .spyOn(TeamMemberService, "isUserMemberOfProject")
    .mockResolvedValue(false);

  jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue({ name: "Acme Production" } as Project);
  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.test"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);

  sendMailSpy = jest
    .spyOn(MailService, "sendMail")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(EmailVerificationTokenService, "create")
    .mockResolvedValue(new EmailVerificationToken());

  findUserSpy = jest.spyOn(UserService, "findOneBy").mockResolvedValue(null);
  findUserByIdSpy = jest
    .spyOn(UserService, "findOneById")
    .mockResolvedValue(withName(null));
  createUserSpy = jest
    .spyOn(UserService, "createByEmail")
    .mockResolvedValue(accountAtAddress({ hasSignedUp: false }));
  updateUserSpy = jest
    .spyOn(UserService, "updateOneById")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(
      UserNotificationSettingService,
      "addDefaultNotificationSettingsForUser",
    )
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(UserNotificationRuleService, "addDefaultNotificationRuleForUser")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(TeamMemberService, "refreshTokens")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(
      TeamMemberService,
      "updateSubscriptionSeatsByUniqueTeamMembersInProject",
    )
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an invitation to an address nobody has: the account it creates", () => {
  test("is set up with the name typed, without the spaces around it", async () => {
    await callHook(
      TeamMemberService,
      "onBeforeCreate",
      inviteBy("  Grace Hopper  "),
    );

    expect(createUserSpy).toHaveBeenCalledTimes(1);

    const created: { email: Email; name?: Name } = createUserSpy.mock
      .calls[0]![0] as { email: Email; name?: Name };

    expect(created.email.toString()).toBe(INVITEE_EMAIL.toString());
    expect(created.name?.toString()).toBe("Grace Hopper");
  });

  test.each([
    ["no name", undefined],
    ["an empty name", ""],
    ["a name of spaces", "   "],
  ])(
    "is set up with no name when the form sent %s",
    async (_case: string, name: string | undefined) => {
      await callHook(TeamMemberService, "onBeforeCreate", inviteBy(name));

      expect(createUserSpy).toHaveBeenCalledTimes(1);
      expect(
        (createUserSpy.mock.calls[0]![0] as { name?: Name }).name,
      ).toBeUndefined();
    },
  );

  test("records who invited them, and writes nothing else", async () => {
    await callHook(TeamMemberService, "onBeforeCreate", inviteBy("Grace"));

    expect(
      (
        createUserSpy.mock.calls[0]![0] as { createdByUserId?: ObjectID }
      ).createdByUserId?.toString(),
    ).toBe(INVITER_ID.toString());
    expect(updateUserSpy).not.toHaveBeenCalled();
  });
});

describe("an invitation to an account an earlier invitation created, never claimed", () => {
  beforeEach(() => {
    findUserSpy.mockResolvedValue(accountAtAddress({ hasSignedUp: false }));
  });

  test("names it, when it has no name yet", async () => {
    findUserByIdSpy.mockResolvedValue(withName(null));

    await callHook(TeamMemberService, "onBeforeCreate", inviteBy("Grace"));

    expect(nameWritten()).toBe("Grace");
    expect(createUserSpy).not.toHaveBeenCalled();
  });

  test("keeps the name another inviter gave it", async () => {
    findUserByIdSpy.mockResolvedValue(withName("Grace Hopper"));

    await callHook(
      TeamMemberService,
      "onBeforeCreate",
      inviteBy("Someone Else"),
    );

    expect(nameWritten()).toBeNull();
  });

  test("reads and writes nothing for an invitation with no name", async () => {
    await callHook(TeamMemberService, "onBeforeCreate", inviteBy());

    expect(findUserByIdSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ select: { name: true } }),
    );
    expect(nameWritten()).toBeNull();
  });
});

describe("an invitation to someone who has signed up: their profile is theirs", () => {
  beforeEach(() => {
    findUserSpy.mockResolvedValue(accountAtAddress({ hasSignedUp: true }));
  });

  test("never names a signed-up account, even one with no name (the regression)", async () => {
    /*
     * Before #9745 a name typed for an address was written onto any
     * account that had none - an account that signed in with SSO and no
     * name claim, say - by an inviter of any project. With the Name field
     * offered for every address, that would have been any inviter's to do.
     */
    findUserByIdSpy.mockResolvedValue(withName(null));

    await callHook(
      TeamMemberService,
      "onBeforeCreate",
      inviteBy("Not Their Name"),
    );

    expect(nameWritten()).toBeNull();
    expect(findUserByIdSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ select: { name: true } }),
    );
  });

  test("never renames one that has a name", async () => {
    findUserByIdSpy.mockResolvedValue(withName("Grace Hopper"));

    await callHook(TeamMemberService, "onBeforeCreate", inviteBy("Grace"));

    expect(nameWritten()).toBeNull();
    expect(createUserSpy).not.toHaveBeenCalled();
  });
});

describe("the invitation goes on alike, whoever the address belongs to", () => {
  /*
   * Whatever the server does with the name, the inviter's request ends the
   * same way: the membership is made for the account at the address, and
   * the invitation email goes to the address. Nothing in what the hook
   * hands on says whether the account existed, was named, or kept its name.
   */
  test.each([
    ["nobody", null],
    [
      "an unclaimed invitation",
      (): User => {
        return accountAtAddress({ hasSignedUp: false });
      },
    ],
    [
      "someone signed up",
      (): User => {
        return accountAtAddress({ hasSignedUp: true });
      },
    ],
  ])(
    "an address that belongs to %s: one membership for the account, one email",
    async (_case: string, account: (() => User) | null) => {
      findUserSpy.mockResolvedValue(account ? account() : null);

      const result: { createBy: CreateBy<TeamMember>; carryForward: null } =
        (await callHook(
          TeamMemberService,
          "onBeforeCreate",
          inviteBy("Grace"),
        )) as { createBy: CreateBy<TeamMember>; carryForward: null };

      expect(result.carryForward).toBeNull();
      expect(result.createBy.data.userId?.toString()).toBe(USER_ID.toString());
      expect(result.createBy.data.hasAcceptedInvitation).toBe(false);

      // Not waited for, but asked for before the hook returns.
      expect(sendMailSpy).toHaveBeenCalledTimes(1);
      expect(
        (
          sendMailSpy.mock.calls[0]![0] as { toEmail: Email }
        ).toEmail.toString(),
      ).toBe(INVITEE_EMAIL.toString());
    },
  );
});
