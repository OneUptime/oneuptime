import EmailVerificationToken from "../../../Models/DatabaseModels/EmailVerificationToken";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
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
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import EditionEnforcement from "../../../Server/Utils/EditionEnforcement";
import Errors from "../../../Server/Utils/Errors";
import logger from "../../../Server/Utils/Logger";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Email from "../../../Types/Email";
import EmailMessage from "../../../Types/Email/EmailMessage";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Acceptance is per project, not per team.
 *
 * A person joins a project by accepting an invitation into one of its teams.
 * After that they are in the project, and adding them to another of its teams
 * is the project admins' business - exactly like changing what a team they are
 * already on may do. It used to be another invitation: every membership a
 * project admin created was forced to pending, so a member added to their
 * second, third and fourth team had to go and accept the same project again
 * each time, and until they did those teams' permissions silently did not
 * apply to them.
 *
 * Two halves hold the rule:
 *
 *   - onBeforeCreate creates the membership already accepted when the person
 *     already holds an accepted membership in the project, whoever adds them.
 *     A person who is only invited - however many teams - is not in the
 *     project yet, and keeps getting invitations.
 *   - whenever a membership becomes accepted (they accept one, or one is
 *     created accepted), every invitation still pending for them in that
 *     project is accepted with it (acceptPendingInvitationsInProject), so the
 *     per-team "Project Invitations" list never asks for the same project
 *     twice.
 *
 * What does not change: a project admin still cannot accept an invitation on
 * behalf of somebody who has never joined the project, and every check that
 * comes before the decision (team in this project, permission delegation
 * ceiling, SCIM Push Groups, duplicates) still applies.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "12121212-1212-4121-8121-121212121212",
);
const TEAM_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "34343434-3434-4343-8343-343434343434",
);
const MEMBER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const INVITER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const NEW_USER_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

const MEMBER_EMAIL: Email = new Email("member@company.com");
const PROJECT_NAME: string = "Acme Production";

// A date the server could never have produced for "now".
const FORGED_ACCEPTED_AT: Date = new Date("2001-01-01T00:00:00.000Z");

// Calls a protected/private hook without widening the service's public surface.
function callHook(name: string, ...args: Array<unknown>): Promise<unknown> {
  const hooks: Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  > = TeamMemberService as unknown as Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  >;

  return hooks[name]!.apply(TeamMemberService, args);
}

/* A project admin inviting from the dashboard (Team > Members, Users). */
function projectAdminProps(): DatabaseCommonInteractionProps {
  return {
    userId: INVITER_ID,
    tenantId: PROJECT_ID,
  } as DatabaseCommonInteractionProps;
}

/* A master admin on the Admin Dashboard. */
function masterAdminProps(): DatabaseCommonInteractionProps {
  return {
    isMasterAdmin: true,
    userId: INVITER_ID,
  } as DatabaseCommonInteractionProps;
}

/* SSO, OIDC, SCIM and other internal writes. */
function rootProps(): DatabaseCommonInteractionProps {
  return { isRoot: true } as DatabaseCommonInteractionProps;
}

function addToTeam(data: {
  props: DatabaseCommonInteractionProps;
  userId?: ObjectID | undefined;
  hasAcceptedInvitation?: boolean | undefined;
  invitationAcceptedAt?: Date | undefined;
  email?: string | undefined;
  withoutProjectId?: boolean | undefined;
}): CreateBy<TeamMember> {
  const member: TeamMember = new TeamMember();
  member.teamId = TEAM_ID;

  if (!data.withoutProjectId) {
    member.projectId = PROJECT_ID;
  }

  if (data.userId) {
    member.userId = data.userId;
  }

  if (data.hasAcceptedInvitation !== undefined) {
    member.hasAcceptedInvitation = data.hasAcceptedInvitation;
  }

  if (data.invitationAcceptedAt !== undefined) {
    member.invitationAcceptedAt = data.invitationAcceptedAt;
  }

  const createBy: CreateBy<TeamMember> = {
    data: member,
    props: data.props,
  } as CreateBy<TeamMember>;

  if (data.email) {
    createBy.miscDataProps = { email: data.email };
  }

  return createBy;
}

/* Somebody who has an account and can sign in. */
function registeredUser(id: ObjectID = USER_ID): User {
  const user: User = new User(id);
  user._id = id.toString();
  user.email = MEMBER_EMAIL;
  user.isEmailVerified = true;
  user.password = new HashedString("already-registered", true);

  return user;
}

/*
 * Somebody with a user row and no password: a master admin accepted their
 * first invitation for them, and they have not signed up yet.
 */
function unregisteredUser(id: ObjectID = USER_ID): User {
  const user: User = new User(id);
  user._id = id.toString();
  user.email = MEMBER_EMAIL;

  return user;
}

function membershipRow(data: {
  userId: ObjectID;
  projectId: ObjectID;
  id?: ObjectID | undefined;
}): TeamMember {
  const id: ObjectID = data.id || ObjectID.generate();
  const row: TeamMember = new TeamMember(id);
  row._id = id.toString();
  row.userId = data.userId;
  row.projectId = data.projectId;
  row.teamId = TEAM_ID;
  row.hasAcceptedInvitation = true;
  row.user = registeredUser(data.userId);

  return row;
}

let isMemberSpy: jest.SpyInstance;
let duplicateLookupSpy: jest.SpyInstance;
let sendMailSpy: jest.SpyInstance;
let createTokenSpy: jest.SpyInstance;
let findInviteeSpy: jest.SpyInstance;
let createUserSpy: jest.SpyInstance;
let refreshSpy: jest.SpyInstance;
let addSettingsSpy: jest.SpyInstance;

beforeEach(() => {
  jest.spyOn(TeamService, "findOneBy").mockResolvedValue(new Team(TEAM_ID));
  jest
    .spyOn(TeamPermissionService, "assertCanGrantTeamPermissions")
    .mockResolvedValue(undefined);
  jest
    .spyOn(ProjectSCIMService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest
    .spyOn(TeamMemberService, "getUniqueTeamMemberCountInProject")
    .mockResolvedValue(1);

  // Not on this team already: the duplicate-invite guard lets it through.
  duplicateLookupSpy = jest
    .spyOn(TeamMemberService, "findOneBy")
    .mockResolvedValue(null);

  /*
   * Already in the project through another team, unless a test says
   * otherwise. That is the case this file is about.
   */
  isMemberSpy = jest
    .spyOn(TeamMemberService, "isUserMemberOfProject")
    .mockResolvedValue(true);

  jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue({ name: PROJECT_NAME } as Project);
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

  findInviteeSpy = jest
    .spyOn(UserService, "findOneBy")
    .mockResolvedValue(registeredUser());
  jest.spyOn(UserService, "findOneById").mockResolvedValue(registeredUser());
  createUserSpy = jest
    .spyOn(UserService, "createByEmail")
    .mockResolvedValue(unregisteredUser(NEW_USER_ID));

  addSettingsSpy = jest
    .spyOn(
      UserNotificationSettingService,
      "addDefaultNotificationSettingsForUser",
    )
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(UserNotificationRuleService, "addDefaultNotificationRuleForUser")
    .mockResolvedValue(undefined as never);

  refreshSpy = jest
    .spyOn(TeamMemberService, "refreshTokens")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(
      TeamMemberService,
      "updateSubscriptionSeatsByUniqueTeamMembersInProject",
    )
    .mockResolvedValue(undefined as never);
  jest.spyOn(ProductAnalytics, "captureForUser").mockReturnValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function sentMail(): EmailMessage {
  expect(sendMailSpy).toHaveBeenCalledTimes(1);

  return sendMailSpy.mock.calls[0]![0] as EmailMessage;
}

describe("TeamMemberService.onBeforeCreate - adding a member of the project to another team", () => {
  test("a project admin adds them straight away: there is nothing for them to accept", async () => {
    /*
     * The bug. This is Users > (user) > Teams > Invite on the dashboard: the
     * row used to be forced to pending, and the person had to accept the
     * project they were already in once more for this team.
     */
    const create: CreateBy<TeamMember> = addToTeam({
      props: projectAdminProps(),
      userId: USER_ID,
    });

    await callHook("onBeforeCreate", create);

    expect(create.data.hasAcceptedInvitation).toBe(true);
  });

  test("it asks whether this person holds an accepted membership in this project", async () => {
    await callHook(
      "onBeforeCreate",
      addToTeam({ props: projectAdminProps(), userId: USER_ID }),
    );

    expect(isMemberSpy).toHaveBeenCalledTimes(1);
    expect(isMemberSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userId: USER_ID,
    });
  });

  test("the project asked about is the request's own when the row does not name one", async () => {
    const create: CreateBy<TeamMember> = addToTeam({
      props: projectAdminProps(),
      userId: USER_ID,
      withoutProjectId: true,
    });

    await callHook("onBeforeCreate", create);

    expect(isMemberSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userId: USER_ID,
    });
    expect(create.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(create.data.hasAcceptedInvitation).toBe(true);
  });

  test("the acceptance is stamped with the server's clock", async () => {
    const before: Date = new Date();
    const create: CreateBy<TeamMember> = addToTeam({
      props: projectAdminProps(),
      userId: USER_ID,
    });

    await callHook("onBeforeCreate", create);

    const after: Date = new Date();
    const stamped: Date = create.data.invitationAcceptedAt!;

    expect(stamped).toBeInstanceOf(Date);
    expect(stamped.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(stamped.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test("a timestamp the request supplies is replaced, not kept", async () => {
    const create: CreateBy<TeamMember> = addToTeam({
      props: projectAdminProps(),
      userId: USER_ID,
      hasAcceptedInvitation: true,
      invitationAcceptedAt: FORGED_ACCEPTED_AT,
    });

    await callHook("onBeforeCreate", create);

    expect(create.data.hasAcceptedInvitation).toBe(true);
    expect(create.data.invitationAcceptedAt).not.toEqual(FORGED_ACCEPTED_AT);
  });

  test("a master admin who leaves auto-accept unticked still adds a member, not invites them", async () => {
    /*
     * The checkbox decides whether a newcomer has to accept. A member of the
     * project is not a newcomer, so there is no invitation to leave pending.
     */
    const create: CreateBy<TeamMember> = addToTeam({
      props: masterAdminProps(),
      userId: USER_ID,
      hasAcceptedInvitation: false,
    });

    await callHook("onBeforeCreate", create);

    expect(create.data.hasAcceptedInvitation).toBe(true);
  });

  test("an internal write that asks for an invitation adds a member all the same", async () => {
    const create: CreateBy<TeamMember> = addToTeam({
      props: rootProps(),
      userId: USER_ID,
      hasAcceptedInvitation: false,
    });

    await callHook("onBeforeCreate", create);

    expect(create.data.hasAcceptedInvitation).toBe(true);
    expect(create.data.invitationAcceptedAt).toBeInstanceOf(Date);
  });

  test("a membership that is being created accepted anyway needs no lookup", async () => {
    const create: CreateBy<TeamMember> = addToTeam({
      props: masterAdminProps(),
      userId: USER_ID,
      hasAcceptedInvitation: true,
    });

    await callHook("onBeforeCreate", create);

    expect(create.data.hasAcceptedInvitation).toBe(true);
    expect(isMemberSpy).not.toHaveBeenCalled();
  });
});

describe("TeamMemberService.onBeforeCreate - adding a member of the project by email", () => {
  test("the address is resolved to its account first, and that account is the one checked", async () => {
    /*
     * The Team > Members and Users invite forms send an email address, not an
     * id. The check has to be about whoever that address belongs to.
     */
    const create: CreateBy<TeamMember> = addToTeam({
      props: projectAdminProps(),
      userId: OTHER_USER_ID,
      email: MEMBER_EMAIL.toString(),
    });

    await callHook("onBeforeCreate", create);

    expect(create.data.userId?.toString()).toBe(USER_ID.toString());
    expect(isMemberSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userId: USER_ID,
    });
    expect(create.data.hasAcceptedInvitation).toBe(true);
  });

  test("the email says they have been added, not invited", async () => {
    await callHook(
      "onBeforeCreate",
      addToTeam({
        props: projectAdminProps(),
        email: MEMBER_EMAIL.toString(),
      }),
    );

    const mail: EmailMessage = sentMail();

    expect(mail.vars["isInvitationAccepted"]).toBe("true");
    expect(mail.subject).toBe(`You have been added to ${PROJECT_NAME}`);
  });

  test("it sends them to sign in, and mints no registration token", async () => {
    await callHook(
      "onBeforeCreate",
      addToTeam({
        props: projectAdminProps(),
        email: MEMBER_EMAIL.toString(),
      }),
    );

    expect(sentMail().vars["isNewUser"]).toBe("false");
    expect(sentMail().vars["registerLink"]).not.toContain("token=");
    expect(createTokenSpy).not.toHaveBeenCalled();
  });

  test("a member who has still not registered is sent to register, with a token", async () => {
    /*
     * A master admin can accept someone's first membership before they ever
     * sign up. Being added to a second team must still give them a way in.
     */
    findInviteeSpy.mockResolvedValue(unregisteredUser());

    await callHook(
      "onBeforeCreate",
      addToTeam({
        props: projectAdminProps(),
        email: MEMBER_EMAIL.toString(),
      }),
    );

    const mail: EmailMessage = sentMail();
    const token: EmailVerificationToken = createTokenSpy.mock.calls[0]![0][
      "data"
    ] as EmailVerificationToken;

    expect(mail.vars["isInvitationAccepted"]).toBe("true");
    expect(mail.vars["isNewUser"]).toBe("true");
    expect(mail.vars["registerLink"]).toContain(token.token!.toString());
  });
});

describe("TeamMemberService.onBeforeCreate - somebody who is not in the project yet is still invited", () => {
  beforeEach(() => {
    isMemberSpy.mockResolvedValue(false);
  });

  test("a project admin's invitation stays pending", async () => {
    const create: CreateBy<TeamMember> = addToTeam({
      props: projectAdminProps(),
      userId: USER_ID,
    });

    await callHook("onBeforeCreate", create);

    expect(create.data.hasAcceptedInvitation).toBe(false);
    expect(create.data.invitationAcceptedAt).toBeUndefined();
  });

  test("a project admin still cannot accept for them", async () => {
    /*
     * The rule the auto-accept guard exists for: a project admin who could
     * accept on behalf of somebody outside the project could pull any account
     * into it. Being a member elsewhere, or nowhere, changes nothing.
     */
    const create: CreateBy<TeamMember> = addToTeam({
      props: projectAdminProps(),
      userId: USER_ID,
      hasAcceptedInvitation: true,
      invitationAcceptedAt: FORGED_ACCEPTED_AT,
    });

    await callHook("onBeforeCreate", create);

    expect(create.data.hasAcceptedInvitation).toBe(false);
    expect(create.data.invitationAcceptedAt).toBeUndefined();
  });

  test("their email still invites them", async () => {
    await callHook(
      "onBeforeCreate",
      addToTeam({
        props: projectAdminProps(),
        email: MEMBER_EMAIL.toString(),
      }),
    );

    const mail: EmailMessage = sentMail();

    expect(mail.vars["isInvitationAccepted"]).toBe("false");
    expect(mail.subject).toBe(`You have been invited to ${PROJECT_NAME}`);
  });

  test("an account the invitation creates is checked as itself, and is invited", async () => {
    findInviteeSpy.mockResolvedValue(null);

    const create: CreateBy<TeamMember> = addToTeam({
      props: projectAdminProps(),
      email: MEMBER_EMAIL.toString(),
    });

    await callHook("onBeforeCreate", create);

    expect(createUserSpy).toHaveBeenCalledTimes(1);
    expect(isMemberSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userId: NEW_USER_ID,
    });
    expect(create.data.hasAcceptedInvitation).toBe(false);
    expect(sentMail().vars["isInvitationAccepted"]).toBe("false");
  });

  test("a master admin's tick still accepts it for them", async () => {
    const create: CreateBy<TeamMember> = addToTeam({
      props: masterAdminProps(),
      userId: USER_ID,
      hasAcceptedInvitation: true,
    });

    await callHook("onBeforeCreate", create);

    expect(create.data.hasAcceptedInvitation).toBe(true);
  });
});

describe("TeamMemberService.onBeforeCreate - only an accepted membership makes somebody a member", () => {
  /*
   * The real isUserMemberOfProject, over a fake count: these pin that the
   * decision is made on ACCEPTED memberships only, so being invited to five
   * teams of a project is still being invited, and nothing else - a pending
   * invitation, another project - can stand in for having joined.
   */
  let countSpy: jest.SpyInstance;

  beforeEach(() => {
    isMemberSpy.mockRestore();
  });

  function countAcceptedMembershipsIn(projectIds: Array<ObjectID>): void {
    countSpy = jest
      .spyOn(TeamMemberService, "countBy")
      .mockImplementation(async (countBy: any): Promise<PositiveNumber> => {
        const query: Record<string, unknown> = countBy.query;

        // A pending invitation is never counted as having joined.
        if (query["hasAcceptedInvitation"] !== true) {
          return new PositiveNumber(1);
        }

        return new PositiveNumber(
          projectIds.some((projectId: ObjectID) => {
            return (
              projectId.toString() ===
              (query["projectId"] as ObjectID).toString()
            );
          })
            ? 1
            : 0,
        );
      });
  }

  test("someone invited to other teams of the project, who never accepted, is still invited", async () => {
    countAcceptedMembershipsIn([]);

    const create: CreateBy<TeamMember> = addToTeam({
      props: projectAdminProps(),
      userId: USER_ID,
    });

    await callHook("onBeforeCreate", create);

    expect(create.data.hasAcceptedInvitation).toBe(false);
    expect(countSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          projectId: PROJECT_ID,
          userId: USER_ID,
          hasAcceptedInvitation: true,
        },
      }),
    );
  });

  test("being a member of a different project does not count", async () => {
    countAcceptedMembershipsIn([OTHER_PROJECT_ID]);

    const create: CreateBy<TeamMember> = addToTeam({
      props: projectAdminProps(),
      userId: USER_ID,
    });

    await callHook("onBeforeCreate", create);

    expect(create.data.hasAcceptedInvitation).toBe(false);
  });

  test("an accepted membership in this project does", async () => {
    countAcceptedMembershipsIn([PROJECT_ID]);

    const create: CreateBy<TeamMember> = addToTeam({
      props: projectAdminProps(),
      userId: USER_ID,
    });

    await callHook("onBeforeCreate", create);

    expect(create.data.hasAcceptedInvitation).toBe(true);
  });
});

describe("TeamMemberService.onBeforeCreate - the checks that come first still apply to members", () => {
  test("a team from another project is refused before membership is looked at", async () => {
    jest.spyOn(TeamService, "findOneBy").mockResolvedValue(null);

    await expect(
      callHook(
        "onBeforeCreate",
        addToTeam({ props: projectAdminProps(), userId: USER_ID }),
      ),
    ).rejects.toBeInstanceOf(BadDataException);

    expect(isMemberSpy).not.toHaveBeenCalled();
  });

  test("the permission delegation ceiling still applies", async () => {
    /*
     * Being a member is not a licence to be added to a team whose permissions
     * the inviter could not grant: auto-accepting must not turn the invite
     * into a way round the ceiling.
     */
    const ceiling: NotAuthorizedException = new NotAuthorizedException(
      "cannot delegate owner",
    );
    jest
      .spyOn(TeamPermissionService, "assertCanGrantTeamPermissions")
      .mockRejectedValue(ceiling);

    await expect(
      callHook(
        "onBeforeCreate",
        addToTeam({ props: projectAdminProps(), userId: USER_ID }),
      ),
    ).rejects.toBe(ceiling);

    expect(isMemberSpy).not.toHaveBeenCalled();
  });

  test("a team managed by SCIM Push Groups is still locked", async () => {
    jest
      .spyOn(EditionEnforcement, "areScimTeamLocksEnforced")
      .mockReturnValue(true);
    jest
      .spyOn(ProjectSCIMService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));

    await expect(
      callHook(
        "onBeforeCreate",
        addToTeam({ props: projectAdminProps(), userId: USER_ID }),
      ),
    ).rejects.toThrow(
      "Cannot invite team members while SCIM Push Groups is enabled for this project",
    );

    expect(isMemberSpy).not.toHaveBeenCalled();
  });

  test("adding them to a team they are already on is still refused", async () => {
    duplicateLookupSpy.mockResolvedValue(
      membershipRow({ userId: USER_ID, projectId: PROJECT_ID, id: MEMBER_ID }),
    );

    await expect(
      callHook(
        "onBeforeCreate",
        addToTeam({ props: projectAdminProps(), userId: USER_ID }),
      ),
    ).rejects.toThrow(Errors.TeamMemberService.ALREADY_INVITED);

    expect(duplicateLookupSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          userId: USER_ID,
          teamId: TEAM_ID,
        },
      }),
    );
  });
});

describe("TeamMemberService.onBeforeCreate - a refused duplicate has no side effects", () => {
  beforeEach(() => {
    duplicateLookupSpy.mockResolvedValue(
      membershipRow({ userId: USER_ID, projectId: PROJECT_ID, id: MEMBER_ID }),
    );
  });

  test("nobody is emailed about a membership that is never created", async () => {
    /*
     * The guard used to run after the email had gone, so inviting somebody to
     * a team they were already on mailed them - "you have been added" for a
     * member - and only then failed.
     */
    await expect(
      callHook(
        "onBeforeCreate",
        addToTeam({
          props: projectAdminProps(),
          email: MEMBER_EMAIL.toString(),
        }),
      ),
    ).rejects.toThrow(Errors.TeamMemberService.ALREADY_INVITED);

    expect(sendMailSpy).not.toHaveBeenCalled();
  });

  test("no registration token is minted for it either", async () => {
    findInviteeSpy.mockResolvedValue(unregisteredUser());

    await expect(
      callHook(
        "onBeforeCreate",
        addToTeam({
          props: projectAdminProps(),
          email: MEMBER_EMAIL.toString(),
        }),
      ),
    ).rejects.toThrow(Errors.TeamMemberService.ALREADY_INVITED);

    expect(createTokenSpy).not.toHaveBeenCalled();
    expect(sendMailSpy).not.toHaveBeenCalled();
  });

  test("and the membership lookup is not even needed", async () => {
    await expect(
      callHook(
        "onBeforeCreate",
        addToTeam({ props: projectAdminProps(), userId: USER_ID }),
      ),
    ).rejects.toThrow(Errors.TeamMemberService.ALREADY_INVITED);

    expect(isMemberSpy).not.toHaveBeenCalled();
  });
});

describe("TeamMemberService.onCreateSuccess - joining accepts the rest of the project's invitations", () => {
  let acceptPendingSpy: jest.SpyInstance;

  beforeEach(() => {
    acceptPendingSpy = jest
      .spyOn(TeamMemberService, "acceptPendingInvitationsInProject")
      .mockResolvedValue(0);
  });

  function onCreate(hasAcceptedInvitation: boolean): {
    onCreate: OnCreate<TeamMember>;
    created: TeamMember;
  } {
    const create: CreateBy<TeamMember> = addToTeam({
      props: masterAdminProps(),
      userId: USER_ID,
      hasAcceptedInvitation: hasAcceptedInvitation,
    });

    const created: TeamMember = new TeamMember(MEMBER_ID);
    created.projectId = PROJECT_ID;
    created.teamId = TEAM_ID;
    created.userId = USER_ID;
    created.hasAcceptedInvitation = hasAcceptedInvitation;

    return {
      onCreate: { createBy: create, carryForward: null },
      created: created,
    };
  }

  test("a membership created accepted accepts the person's other invitations in that project", async () => {
    const { onCreate: hook, created } = onCreate(true);

    await callHook("onCreateSuccess", hook, created);

    expect(acceptPendingSpy).toHaveBeenCalledTimes(1);
    expect(acceptPendingSpy).toHaveBeenCalledWith({
      userId: USER_ID,
      projectId: PROJECT_ID,
    });
  });

  test("before the permissions are refreshed, so the refresh includes those teams", async () => {
    const { onCreate: hook, created } = onCreate(true);

    await callHook("onCreateSuccess", hook, created);

    expect(refreshSpy).toHaveBeenCalledWith(USER_ID, PROJECT_ID);
    expect(acceptPendingSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      refreshSpy.mock.invocationCallOrder[0]!,
    );
  });

  test("the new member still gets their notification defaults", async () => {
    const { onCreate: hook, created } = onCreate(true);

    await callHook("onCreateSuccess", hook, created);

    expect(addSettingsSpy).toHaveBeenCalledWith(USER_ID, PROJECT_ID);
  });

  test("a pending invitation accepts nothing - the person has not joined", async () => {
    const { onCreate: hook, created } = onCreate(false);

    await callHook("onCreateSuccess", hook, created);

    expect(acceptPendingSpy).not.toHaveBeenCalled();
    expect(refreshSpy).toHaveBeenCalledWith(USER_ID, PROJECT_ID);
  });
});

describe("TeamMemberService.onUpdateSuccess - accepting one invitation accepts the project", () => {
  let acceptPendingSpy: jest.SpyInstance;
  let rowsSpy: jest.SpyInstance;

  beforeEach(() => {
    acceptPendingSpy = jest
      .spyOn(TeamMemberService, "acceptPendingInvitationsInProject")
      .mockResolvedValue(0);
    rowsSpy = jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue([
        membershipRow({ userId: USER_ID, projectId: PROJECT_ID }),
      ]);
  });

  function onUpdate(data: Record<string, unknown>): OnUpdate<TeamMember> {
    return {
      updateBy: {
        query: { _id: MEMBER_ID.toString() },
        data: data,
        props: { userId: USER_ID },
        limit: 1,
        skip: 0,
      } as unknown as UpdateBy<TeamMember>,
      carryForward: null,
    };
  }

  test("accepting an invitation to one team accepts the person's other invitations in that project", async () => {
    /*
     * The per-team "Project Invitations" page accepts one row at a time.
     * Accepting the first of a project's rows used to leave the rest pending,
     * so the same project had to be accepted once per team.
     */
    await callHook(
      "onUpdateSuccess",
      onUpdate({ hasAcceptedInvitation: true }),
      [MEMBER_ID],
    );

    expect(acceptPendingSpy).toHaveBeenCalledTimes(1);
    expect(acceptPendingSpy).toHaveBeenCalledWith({
      userId: USER_ID,
      projectId: PROJECT_ID,
    });
  });

  test("before the permissions are refreshed, so the refresh includes those teams", async () => {
    await callHook(
      "onUpdateSuccess",
      onUpdate({ hasAcceptedInvitation: true }),
      [MEMBER_ID],
    );

    expect(acceptPendingSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      refreshSpy.mock.invocationCallOrder[0]!,
    );
  });

  test("several invitations of one project accepted together are handled in one pass", async () => {
    /*
     * The welcome page's invitation card, and SSO confirming a sign-in,
     * accept every membership of the project in one go.
     */
    rowsSpy.mockResolvedValue([
      membershipRow({ userId: USER_ID, projectId: PROJECT_ID }),
      membershipRow({ userId: USER_ID, projectId: PROJECT_ID }),
      membershipRow({ userId: USER_ID, projectId: PROJECT_ID }),
    ]);

    await callHook(
      "onUpdateSuccess",
      onUpdate({ hasAcceptedInvitation: true }),
      [MEMBER_ID, ObjectID.generate(), ObjectID.generate()],
    );

    expect(acceptPendingSpy).toHaveBeenCalledTimes(1);
  });

  test("each person in each project is handled on their own", async () => {
    rowsSpy.mockResolvedValue([
      membershipRow({ userId: USER_ID, projectId: PROJECT_ID }),
      membershipRow({ userId: USER_ID, projectId: OTHER_PROJECT_ID }),
      membershipRow({ userId: OTHER_USER_ID, projectId: PROJECT_ID }),
    ]);

    await callHook(
      "onUpdateSuccess",
      onUpdate({ hasAcceptedInvitation: true }),
      [MEMBER_ID, ObjectID.generate(), ObjectID.generate()],
    );

    expect(acceptPendingSpy).toHaveBeenCalledTimes(3);
    expect(acceptPendingSpy).toHaveBeenCalledWith({
      userId: USER_ID,
      projectId: PROJECT_ID,
    });
    expect(acceptPendingSpy).toHaveBeenCalledWith({
      userId: USER_ID,
      projectId: OTHER_PROJECT_ID,
    });
    expect(acceptPendingSpy).toHaveBeenCalledWith({
      userId: OTHER_USER_ID,
      projectId: PROJECT_ID,
    });
  });

  test("an update that is not an acceptance accepts nothing", async () => {
    await callHook("onUpdateSuccess", onUpdate({ teamId: TEAM_ID }), [
      MEMBER_ID,
    ]);

    expect(acceptPendingSpy).not.toHaveBeenCalled();
    expect(refreshSpy).toHaveBeenCalledWith(USER_ID, PROJECT_ID);
  });

  test("the person still gets their notification defaults", async () => {
    await callHook(
      "onUpdateSuccess",
      onUpdate({ hasAcceptedInvitation: true }),
      [MEMBER_ID],
    );

    expect(addSettingsSpy).toHaveBeenCalledWith(USER_ID, PROJECT_ID);
  });
});

describe("TeamMemberService.acceptPendingInvitationsInProject", () => {
  let updateSpy: jest.SpyInstance;

  beforeEach(() => {
    updateSpy = jest.spyOn(TeamMemberService, "updateBy").mockResolvedValue(2);
  });

  function lastUpdate(): UpdateBy<TeamMember> {
    expect(updateSpy).toHaveBeenCalledTimes(1);

    return updateSpy.mock.calls[0]![0] as UpdateBy<TeamMember>;
  }

  test("accepts only this person's still-pending invitations, and only in this project", async () => {
    await TeamMemberService.acceptPendingInvitationsInProject({
      userId: USER_ID,
      projectId: PROJECT_ID,
    });

    expect(lastUpdate().query).toEqual({
      userId: USER_ID,
      projectId: PROJECT_ID,
      hasAcceptedInvitation: false,
    });
  });

  test("marks them accepted, stamped with the server's clock", async () => {
    const before: Date = new Date();

    await TeamMemberService.acceptPendingInvitationsInProject({
      userId: USER_ID,
      projectId: PROJECT_ID,
    });

    const after: Date = new Date();
    const data: TeamMember = lastUpdate().data as TeamMember;

    expect(data.hasAcceptedInvitation).toBe(true);
    expect(data.invitationAcceptedAt).toBeInstanceOf(Date);
    expect(data.invitationAcceptedAt!.getTime()).toBeGreaterThanOrEqual(
      before.getTime(),
    );
    expect(data.invitationAcceptedAt!.getTime()).toBeLessThanOrEqual(
      after.getTime(),
    );
  });

  test("writes as root, without re-running the hooks its callers are already in", async () => {
    /*
     * Its callers are TeamMemberService's own success hooks, which refresh
     * this person's permissions in this project and add their notification
     * defaults right after. Running the hooks again would repeat all of that
     * once more per row.
     */
    await TeamMemberService.acceptPendingInvitationsInProject({
      userId: USER_ID,
      projectId: PROJECT_ID,
    });

    expect(lastUpdate().props).toEqual({ isRoot: true, ignoreHooks: true });
  });

  test("reaches every team of the project", async () => {
    await TeamMemberService.acceptPendingInvitationsInProject({
      userId: USER_ID,
      projectId: PROJECT_ID,
    });

    expect(lastUpdate().limit).toBe(LIMIT_PER_PROJECT);
    expect(lastUpdate().skip).toBe(0);
  });

  test("reports how many invitations it accepted", async () => {
    await expect(
      TeamMemberService.acceptPendingInvitationsInProject({
        userId: USER_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBe(2);

    updateSpy.mockResolvedValue(0);

    await expect(
      TeamMemberService.acceptPendingInvitationsInProject({
        userId: USER_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBe(0);
  });

  test("a failure is logged rather than thrown into the write that triggered it", async () => {
    /*
     * By the time this runs the membership that triggered it is committed.
     * Failing now would report "accept failed" for somebody who is in; an
     * invitation left pending can still be accepted by hand.
     */
    const failure: Error = new Error("postgres is down");
    updateSpy.mockRejectedValue(failure);
    const errorSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined as never;
      });

    await expect(
      TeamMemberService.acceptPendingInvitationsInProject({
        userId: USER_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBe(0);

    expect(errorSpy).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({
        projectId: PROJECT_ID.toString(),
        userId: USER_ID.toString(),
      }),
    );
  });
});
