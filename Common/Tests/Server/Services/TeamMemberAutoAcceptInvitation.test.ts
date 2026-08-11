import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import MailService from "../../../Server/Services/MailService";
import ProjectSCIMService from "../../../Server/Services/ProjectSCIMService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../Server/Services/UserService";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import EmailMessage from "../../../Types/Email/EmailMessage";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * "Accept the invitation automatically" - the checkbox a master admin gets on
 * the Admin Dashboard invite forms.
 *
 * The rule the service has to hold is narrow and load-bearing: a membership may
 * only be created already accepted by an internal write or by a master admin.
 * A project owner or admin who could do it would be able to pull somebody's
 * account into their project - and into whatever that team's permissions grant
 * - without that person ever agreeing. Acceptance is also what the `Owned`
 * permission scope keys off (TeamMemberService.getTeamIdsForUser filters on
 * hasAcceptedInvitation), so a forged acceptance is a permission grant.
 *
 * The other half is that an auto-accepted member has to be indistinguishable
 * from one who accepted the invitation themselves: same timestamp column, same
 * per-project notification defaults, and an email that does not tell them to go
 * and accept something that is already accepted.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TEAM_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const MEMBER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const INVITER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const MEMBER_EMAIL: Email = new Email("member@company.com");

// A date the server could never have produced for "now".
const FORGED_ACCEPTED_AT: Date = new Date("2001-01-01T00:00:00.000Z");

// Calls a protected/private hook without widening the service's public surface.
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

/* The props a master admin's Admin Dashboard request arrives with. */
function masterAdminProps(): DatabaseCommonInteractionProps {
  return {
    isMasterAdmin: true,
    userId: INVITER_ID,
  } as DatabaseCommonInteractionProps;
}

/* The props a project owner inviting from project settings arrives with. */
function projectUserProps(): DatabaseCommonInteractionProps {
  return {
    userId: INVITER_ID,
    tenantId: PROJECT_ID,
  } as DatabaseCommonInteractionProps;
}

function rootProps(): DatabaseCommonInteractionProps {
  return { isRoot: true } as DatabaseCommonInteractionProps;
}

function memberToCreate(data: {
  hasAcceptedInvitation?: boolean | undefined;
  invitationAcceptedAt?: Date | undefined;
}): TeamMember {
  const member: TeamMember = new TeamMember();
  member.projectId = PROJECT_ID;
  member.teamId = TEAM_ID;
  member.userId = USER_ID;

  if (data.hasAcceptedInvitation !== undefined) {
    member.hasAcceptedInvitation = data.hasAcceptedInvitation;
  }

  if (data.invitationAcceptedAt !== undefined) {
    member.invitationAcceptedAt = data.invitationAcceptedAt;
  }

  return member;
}

function createBy(data: {
  props: DatabaseCommonInteractionProps;
  hasAcceptedInvitation?: boolean | undefined;
  invitationAcceptedAt?: Date | undefined;
  email?: string | undefined;
}): CreateBy<TeamMember> {
  const built: CreateBy<TeamMember> = {
    data: memberToCreate({
      hasAcceptedInvitation: data.hasAcceptedInvitation,
      invitationAcceptedAt: data.invitationAcceptedAt,
    }),
    props: data.props,
  } as CreateBy<TeamMember>;

  if (data.email) {
    built.miscDataProps = { email: data.email };
  }

  return built;
}

function createdMember(hasAcceptedInvitation: boolean): TeamMember {
  const member: TeamMember = new TeamMember(MEMBER_ID);
  member._id = MEMBER_ID.toString();
  member.projectId = PROJECT_ID;
  member.teamId = TEAM_ID;
  member.userId = USER_ID;
  member.hasAcceptedInvitation = hasAcceptedInvitation;

  return member;
}

function verifiedUser(): User {
  const user: User = new User(USER_ID);
  user._id = USER_ID.toString();
  user.email = MEMBER_EMAIL;
  user.isEmailVerified = true;

  return user;
}

let sendMailSpy: jest.SpyInstance;
let addSettingsSpy: jest.SpyInstance;
let addRuleSpy: jest.SpyInstance;
let findUserByIdSpy: jest.SpyInstance;

beforeEach(() => {
  /*
   * The SCIM push-groups guard runs for every non-root create, so it has to
   * answer before anything else in onBeforeCreate is reachable.
   */
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

  findUserByIdSpy = jest
    .spyOn(UserService, "findOneById")
    .mockResolvedValue(verifiedUser());
  jest.spyOn(UserService, "findByEmail").mockResolvedValue(verifiedUser());

  addSettingsSpy = jest
    .spyOn(
      UserNotificationSettingService,
      "addDefaultNotificationSettingsForUser",
    )
    .mockResolvedValue(undefined as never);
  addRuleSpy = jest
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

describe("TeamMemberService.onBeforeCreate - who may create an accepted membership", () => {
  test("a master admin's tick of the checkbox is honoured", async () => {
    const create: CreateBy<TeamMember> = createBy({
      props: masterAdminProps(),
      hasAcceptedInvitation: true,
    });

    await callHook(TeamMemberService, "onBeforeCreate", create);

    expect(create.data.hasAcceptedInvitation).toBe(true);
  });

  test("an internal (isRoot) write may still create an accepted membership", async () => {
    /*
     * SSO, OIDC, SCIM and project creation all create memberships that are
     * accepted on arrival. They must keep working.
     */
    const create: CreateBy<TeamMember> = createBy({
      props: rootProps(),
      hasAcceptedInvitation: true,
    });

    await callHook(TeamMemberService, "onBeforeCreate", create);

    expect(create.data.hasAcceptedInvitation).toBe(true);
  });

  test("a project user asking for one is forced back to invited", async () => {
    /*
     * The whole point of the guard. A project owner inviting from project
     * settings can set this field - the column's create access control allows
     * it - so the service, not the permission layer, is what refuses.
     */
    const create: CreateBy<TeamMember> = createBy({
      props: projectUserProps(),
      hasAcceptedInvitation: true,
    });

    await callHook(TeamMemberService, "onBeforeCreate", create);

    expect(create.data.hasAcceptedInvitation).toBe(false);
  });

  test("a project user's forged acceptance timestamp is dropped too", async () => {
    const create: CreateBy<TeamMember> = createBy({
      props: projectUserProps(),
      hasAcceptedInvitation: true,
      invitationAcceptedAt: FORGED_ACCEPTED_AT,
    });

    await callHook(TeamMemberService, "onBeforeCreate", create);

    expect(create.data.hasAcceptedInvitation).toBe(false);
    expect(create.data.invitationAcceptedAt).toBeUndefined();
  });

  test("a master admin who leaves the checkbox alone still only invites", async () => {
    const create: CreateBy<TeamMember> = createBy({
      props: masterAdminProps(),
    });

    await callHook(TeamMemberService, "onBeforeCreate", create);

    expect(create.data.hasAcceptedInvitation).toBeFalsy();
    expect(create.data.invitationAcceptedAt).toBeUndefined();
  });

  test("a master admin who unticks it invites rather than accepts", async () => {
    const create: CreateBy<TeamMember> = createBy({
      props: masterAdminProps(),
      hasAcceptedInvitation: false,
    });

    await callHook(TeamMemberService, "onBeforeCreate", create);

    expect(create.data.hasAcceptedInvitation).toBe(false);
    expect(create.data.invitationAcceptedAt).toBeUndefined();
  });

  test("the duplicate-invite guard still runs for an auto-accepted invite", async () => {
    /*
     * Auto-accept must not become a way to create a second membership row for
     * the same person on the same team.
     */
    jest
      .spyOn(TeamMemberService, "findOneBy")
      .mockResolvedValue(createdMember(true));

    await expect(
      callHook(
        TeamMemberService,
        "onBeforeCreate",
        createBy({
          props: masterAdminProps(),
          hasAcceptedInvitation: true,
        }),
      ),
    ).rejects.toBeInstanceOf(BadDataException);
  });
});

describe("TeamMemberService.onBeforeCreate - the acceptance timestamp", () => {
  test("an accepted membership is stamped, so no row says Member with no accepted-at date", async () => {
    const before: Date = new Date();

    const create: CreateBy<TeamMember> = createBy({
      props: masterAdminProps(),
      hasAcceptedInvitation: true,
    });

    await callHook(TeamMemberService, "onBeforeCreate", create);

    const after: Date = new Date();
    const stamped: Date = create.data.invitationAcceptedAt!;

    expect(stamped).toBeInstanceOf(Date);
    expect(stamped.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(stamped.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test("the stamp is the server's clock, not a date supplied by the request", async () => {
    const create: CreateBy<TeamMember> = createBy({
      props: masterAdminProps(),
      hasAcceptedInvitation: true,
      invitationAcceptedAt: FORGED_ACCEPTED_AT,
    });

    await callHook(TeamMemberService, "onBeforeCreate", create);

    expect(create.data.invitationAcceptedAt).not.toEqual(FORGED_ACCEPTED_AT);
  });

  test("an accepted-at date on a membership that is only invited is removed", async () => {
    /*
     * The inverse disagreement: a pending row carrying an acceptance date would
     * read as accepted to anything that looks at the date rather than the flag.
     */
    const create: CreateBy<TeamMember> = createBy({
      props: masterAdminProps(),
      hasAcceptedInvitation: false,
      invitationAcceptedAt: FORGED_ACCEPTED_AT,
    });

    await callHook(TeamMemberService, "onBeforeCreate", create);

    expect(create.data.invitationAcceptedAt).toBeUndefined();
  });

  test("an internal write's own timestamp is normalised to the server clock", async () => {
    const create: CreateBy<TeamMember> = createBy({
      props: rootProps(),
      hasAcceptedInvitation: true,
      invitationAcceptedAt: FORGED_ACCEPTED_AT,
    });

    await callHook(TeamMemberService, "onBeforeCreate", create);

    expect(create.data.hasAcceptedInvitation).toBe(true);
    expect(create.data.invitationAcceptedAt).not.toEqual(FORGED_ACCEPTED_AT);
  });
});

describe("TeamMemberService.onBeforeCreate - the email the invitee receives", () => {
  function sentMail(): EmailMessage {
    expect(sendMailSpy).toHaveBeenCalledTimes(1);

    return sendMailSpy.mock.calls[0]![0] as EmailMessage;
  }

  test("an auto-accepted invite says the person has been added, not invited", async () => {
    await callHook(
      TeamMemberService,
      "onBeforeCreate",
      createBy({
        props: masterAdminProps(),
        hasAcceptedInvitation: true,
        email: MEMBER_EMAIL.toString(),
      }),
    );

    const mail: EmailMessage = sentMail();

    expect(mail.vars["isInvitationAccepted"]).toBe("true");
    expect(mail.subject).toBe("You have been added to Acme Production");
  });

  test("an ordinary invite keeps the invitation wording", async () => {
    await callHook(
      TeamMemberService,
      "onBeforeCreate",
      createBy({
        props: masterAdminProps(),
        email: MEMBER_EMAIL.toString(),
      }),
    );

    const mail: EmailMessage = sentMail();

    expect(mail.vars["isInvitationAccepted"]).toBe("false");
    expect(mail.subject).toBe("You have been invited to Acme Production");
  });

  test("a project user's rejected auto-accept does not leak into the email either", async () => {
    /*
     * The email is built after the flag has been forced back to false, so it
     * has to describe what actually happened rather than what was asked for.
     */
    await callHook(
      TeamMemberService,
      "onBeforeCreate",
      createBy({
        props: projectUserProps(),
        hasAcceptedInvitation: true,
        email: MEMBER_EMAIL.toString(),
      }),
    );

    const mail: EmailMessage = sentMail();

    expect(mail.vars["isInvitationAccepted"]).toBe("false");
    expect(mail.subject).toBe("You have been invited to Acme Production");
  });

  test("the template variable is always set, so neither branch of the template is skipped", async () => {
    await callHook(
      TeamMemberService,
      "onBeforeCreate",
      createBy({
        props: rootProps(),
        email: MEMBER_EMAIL.toString(),
      }),
    );

    expect(Object.keys(sentMail().vars)).toContain("isInvitationAccepted");
  });
});

describe("TeamMemberService.onCreateSuccess - an auto-accepted member is a real member", () => {
  function onCreate(hasAcceptedInvitation: boolean): OnCreate<TeamMember> {
    return {
      createBy: createBy({
        props: masterAdminProps(),
        hasAcceptedInvitation: hasAcceptedInvitation,
      }),
      carryForward: null,
    };
  }

  test("the per-project notification defaults are added", async () => {
    /*
     * These are normally added by the accept-invitation update. A membership
     * created already accepted never goes through that update, so without this
     * the member is one who is never notified about anything.
     */
    await callHook(
      TeamMemberService,
      "onCreateSuccess",
      onCreate(true),
      createdMember(true),
    );

    expect(addSettingsSpy).toHaveBeenCalledWith(USER_ID, PROJECT_ID);
    expect(addRuleSpy).toHaveBeenCalledWith(PROJECT_ID, USER_ID, MEMBER_EMAIL);
  });

  test("a pending invitation does not get them - the person has not joined yet", async () => {
    await callHook(
      TeamMemberService,
      "onCreateSuccess",
      onCreate(false),
      createdMember(false),
    );

    expect(addSettingsSpy).not.toHaveBeenCalled();
    expect(addRuleSpy).not.toHaveBeenCalled();
  });

  test("an unverified email is skipped, exactly as the accept path skips it", async () => {
    const unverified: User = verifiedUser();
    unverified.isEmailVerified = false;
    findUserByIdSpy.mockResolvedValue(unverified);

    await callHook(
      TeamMemberService,
      "onCreateSuccess",
      onCreate(true),
      createdMember(true),
    );

    expect(addSettingsSpy).not.toHaveBeenCalled();
    expect(addRuleSpy).not.toHaveBeenCalled();
  });

  test("a user record that has gone missing does not throw", async () => {
    findUserByIdSpy.mockResolvedValue(null);

    await expect(
      callHook(
        TeamMemberService,
        "onCreateSuccess",
        onCreate(true),
        createdMember(true),
      ),
    ).resolves.toBeDefined();

    expect(addSettingsSpy).not.toHaveBeenCalled();
  });

  test("a failure adding the defaults does not fail the invite", async () => {
    /*
     * The membership row is already committed by the time this runs. Throwing
     * would report "invite failed" for a member who exists.
     */
    addSettingsSpy.mockRejectedValue(new Error("postgres is down") as never);

    await expect(
      callHook(
        TeamMemberService,
        "onCreateSuccess",
        onCreate(true),
        createdMember(true),
      ),
    ).resolves.toBeDefined();
  });

  test("the created member is returned unchanged", async () => {
    const created: TeamMember = createdMember(true);

    const returned: unknown = await callHook(
      TeamMemberService,
      "onCreateSuccess",
      onCreate(true),
      created,
    );

    expect(returned).toBe(created);
  });

  test("the activation event reports that the invitation was auto-accepted", async () => {
    const captureSpy: jest.SpyInstance = jest
      .spyOn(ProductAnalytics, "captureForUser")
      .mockReturnValue(undefined);

    await callHook(
      TeamMemberService,
      "onCreateSuccess",
      onCreate(true),
      createdMember(true),
    );

    expect(captureSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "server/team_member_invited",
        properties: expect.objectContaining({
          has_accepted_invitation: true,
        }),
      }),
    );
  });
});

describe("TeamMemberService.onUpdateSuccess - accepting an invitation by hand still works", () => {
  function onUpdate(data: Record<string, unknown>): OnUpdate<TeamMember> {
    return {
      updateBy: {
        query: { _id: MEMBER_ID.toString() },
        data: data,
        props: { isRoot: true },
        limit: 1,
        skip: 0,
      } as unknown as UpdateBy<TeamMember>,
      carryForward: null,
    };
  }

  beforeEach(() => {
    const row: TeamMember = createdMember(true);
    row.user = verifiedUser();

    jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([row]);
  });

  test("accepting adds the same defaults the auto-accept path adds", async () => {
    await callHook(
      TeamMemberService,
      "onUpdateSuccess",
      onUpdate({ hasAcceptedInvitation: true }),
      [MEMBER_ID],
    );

    expect(addSettingsSpy).toHaveBeenCalledWith(USER_ID, PROJECT_ID);
    expect(addRuleSpy).toHaveBeenCalledWith(PROJECT_ID, USER_ID, MEMBER_EMAIL);
  });

  test("an update that is not an acceptance adds nothing", async () => {
    await callHook(
      TeamMemberService,
      "onUpdateSuccess",
      onUpdate({ teamId: TEAM_ID }),
      [MEMBER_ID],
    );

    expect(addSettingsSpy).not.toHaveBeenCalled();
    expect(addRuleSpy).not.toHaveBeenCalled();
  });

  test("the row's own user is used, so accepting costs no extra lookup", async () => {
    await callHook(
      TeamMemberService,
      "onUpdateSuccess",
      onUpdate({ hasAcceptedInvitation: true }),
      [MEMBER_ID],
    );

    expect(findUserByIdSpy).not.toHaveBeenCalled();
  });

  test("an unverified email is still skipped on the accept path", async () => {
    const row: TeamMember = createdMember(true);
    const unverified: User = verifiedUser();
    unverified.isEmailVerified = false;
    row.user = unverified;

    jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([row]);

    await callHook(
      TeamMemberService,
      "onUpdateSuccess",
      onUpdate({ hasAcceptedInvitation: true }),
      [MEMBER_ID],
    );

    expect(addSettingsSpy).not.toHaveBeenCalled();
    expect(addRuleSpy).not.toHaveBeenCalled();
  });

  test("a failure adding the defaults does not fail the acceptance", async () => {
    addRuleSpy.mockRejectedValue(new Error("postgres is down") as never);

    await expect(
      callHook(
        TeamMemberService,
        "onUpdateSuccess",
        onUpdate({ hasAcceptedInvitation: true }),
        [MEMBER_ID],
      ),
    ).resolves.toBeDefined();
  });
});
