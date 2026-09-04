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
import EmailMessage from "../../../Types/Email/EmailMessage";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The invitation half of GHSA-qg84-6hrg-mr5g.
 *
 * Inviting somebody creates their User row with no password on it, and /signup
 * used to hand that row to anyone who asked for it by address. The address is
 * not a secret -- corporate ones are guessable by construction -- so the
 * invitation now carries a registration token, and that token is the only thing
 * that can claim the account.
 *
 * Which means the invitation email is the sole delivery channel for it, and the
 * decision of whether to mint one has to key off "has this person registered
 * yet", not "did we just create their row". Those two came apart for anyone
 * invited to a second project before they ever signed up: they had a row, so
 * they were treated as an existing user and sent a sign-in link they could not
 * use, having no password to sign in with.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TEAM_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const INVITER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const MEMBER_EMAIL: Email = new Email("alice@company.com");

let sendMailSpy: jest.SpyInstance;
let createTokenSpy: jest.SpyInstance;
let findUserSpy: jest.SpyInstance;

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

function inviteBy(): CreateBy<TeamMember> {
  const member: TeamMember = new TeamMember();
  member.projectId = PROJECT_ID;
  member.teamId = TEAM_ID;

  return {
    data: member,
    props: {
      userId: INVITER_ID,
      tenantId: PROJECT_ID,
    } as DatabaseCommonInteractionProps,
    miscDataProps: { email: MEMBER_EMAIL.toString() },
  } as CreateBy<TeamMember>;
}

/* Somebody who has an account and can sign in. */
function registeredUser(): User {
  const user: User = new User(USER_ID);
  user._id = USER_ID.toString();
  user.email = MEMBER_EMAIL;
  user.password = new HashedString("already-registered", true);

  return user;
}

/* An invitation that nobody has claimed: a row, and no password on it. */
function unclaimedUser(): User {
  const user: User = new User(USER_ID);
  user._id = USER_ID.toString();
  user.email = MEMBER_EMAIL;

  return user;
}

function sentMail(): EmailMessage {
  expect(sendMailSpy).toHaveBeenCalledTimes(1);

  return sendMailSpy.mock.calls[0]![0] as EmailMessage;
}

function registerLink(): string {
  return sentMail().vars["registerLink"] as string;
}

/* The token actually written to the database for this invitation. */
function persistedToken(): EmailVerificationToken {
  expect(createTokenSpy).toHaveBeenCalledTimes(1);

  return createTokenSpy.mock.calls[0]![0]["data"] as EmailVerificationToken;
}

beforeEach(() => {
  const team: Team = new Team(TEAM_ID);
  jest.spyOn(TeamService, "findOneBy").mockResolvedValue(team);
  jest
    .spyOn(TeamPermissionService, "assertCanGrantTeamPermissions")
    .mockResolvedValue(undefined);

  jest
    .spyOn(ProjectSCIMService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));

  // No existing membership - the duplicate-invite guard at the end of the hook.
  jest.spyOn(TeamMemberService, "findOneBy").mockResolvedValue(null);

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

  createTokenSpy = jest
    .spyOn(EmailVerificationTokenService, "create")
    .mockResolvedValue(new EmailVerificationToken());

  findUserSpy = jest
    .spyOn(UserService, "findOneBy")
    .mockResolvedValue(unclaimedUser());
  jest.spyOn(UserService, "findOneById").mockResolvedValue(unclaimedUser());
  jest.spyOn(UserService, "createByEmail").mockResolvedValue(unclaimedUser());

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

describe("TeamMemberService.onBeforeCreate - inviting somebody with no account yet", () => {
  beforeEach(() => {
    // Nobody by this address: the invite creates the row.
    findUserSpy.mockResolvedValue(null);
  });

  test("mints a registration token bound to the invited address", async () => {
    await callHook(TeamMemberService, "onBeforeCreate", inviteBy());

    const token: EmailVerificationToken = persistedToken();

    expect(token.email!.toString()).toBe(MEMBER_EMAIL.toString());
    expect(token.userId!.toString()).toBe(USER_ID.toString());
  });

  test("puts that same token on the link in the invitation", async () => {
    /*
     * The email is the only place the token is ever published. If the link and
     * the stored row disagreed, every invitation would dead-end.
     */
    await callHook(TeamMemberService, "onBeforeCreate", inviteBy());

    expect(registerLink()).toContain(persistedToken().token!.toString());
  });

  test("sends them to register rather than to sign in", async () => {
    await callHook(TeamMemberService, "onBeforeCreate", inviteBy());

    expect(sentMail().vars["isNewUser"]).toBe("true");
    expect(registerLink()).toContain("/accounts/register");
  });
});

describe("TeamMemberService.onBeforeCreate - inviting somebody who was invited before but never signed up", () => {
  beforeEach(() => {
    // The row exists from an earlier invitation, and still has no password.
    findUserSpy.mockResolvedValue(unclaimedUser());
  });

  test("still treats them as somebody who has to register", async () => {
    /*
     * The regression. Keying off "did we just create the row" called this an
     * existing user and mailed them a sign-in link for an account that has no
     * password.
     */
    await callHook(TeamMemberService, "onBeforeCreate", inviteBy());

    expect(sentMail().vars["isNewUser"]).toBe("true");
  });

  test("mints them a token, because their account is still claimable", async () => {
    await callHook(TeamMemberService, "onBeforeCreate", inviteBy());

    expect(registerLink()).toContain(persistedToken().token!.toString());
  });

  test("does not create a second user row for them", async () => {
    await callHook(TeamMemberService, "onBeforeCreate", inviteBy());

    expect(UserService.createByEmail).not.toHaveBeenCalled();
  });
});

describe("TeamMemberService.onBeforeCreate - inviting somebody who already has an account", () => {
  beforeEach(() => {
    findUserSpy.mockResolvedValue(registeredUser());
  });

  test("sends them to sign in", async () => {
    await callHook(TeamMemberService, "onBeforeCreate", inviteBy());

    expect(sentMail().vars["isNewUser"]).toBe("false");
  });

  test("mints no token, because there is nothing left to claim", async () => {
    /*
     * A registered account cannot be claimed through /signup at all, so a token
     * for it would authorize nothing -- it would just be a spare key sitting in
     * an inbox.
     */
    await callHook(TeamMemberService, "onBeforeCreate", inviteBy());

    expect(createTokenSpy).not.toHaveBeenCalled();
  });

  test("the link it does carry has no token on it", async () => {
    await callHook(TeamMemberService, "onBeforeCreate", inviteBy());

    expect(registerLink()).not.toContain("token=");
  });
});

describe("TeamMemberService.onBeforeCreate - reading the invitee", () => {
  test("asks for the password column, since that is what the decision turns on", async () => {
    /*
     * findByEmail selects only the id. Reading the invitee with it would make
     * `user.password` undefined for everyone, and every invitation would mint a
     * token -- including for accounts that cannot be claimed.
     */
    await callHook(TeamMemberService, "onBeforeCreate", inviteBy());

    const select: Record<string, unknown> = findUserSpy.mock.calls[0]![0][
      "select"
    ] as Record<string, unknown>;

    expect(select["password"]).toBe(true);
  });
});
