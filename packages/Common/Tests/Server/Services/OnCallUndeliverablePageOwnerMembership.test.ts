import DatabaseConfig from "../../../Server/DatabaseConfig";
import MailService from "../../../Server/Services/MailService";
import { OnCallNotificationAlertingService } from "../../../Server/Services/OnCallNotificationAlertingService";
import OnCallDutyPolicyOwnerTeamService from "../../../Server/Services/OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyOwnerUserService from "../../../Server/Services/OnCallDutyPolicyOwnerUserService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import URL from "../../../Types/API/URL";
import Email from "../../../Types/Email";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyPolicyOwnerTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyOwnerTeam";
import OnCallDutyPolicyOwnerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyOwnerUser";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The "a page to <user> was undeliverable" owner email goes to the on-call policy's
 * owners, and to the project owners only when the policy has none. It is sent straight
 * through MailService, not through the recipients' notification settings, so nothing
 * downstream checks that a recipient belongs to the project.
 *
 * An owner team's roster includes its pending invitations. Mailing that roster sent
 * project-internal mail to people who never joined, and a policy whose owners were all
 * pending invitees counted as having owners, so the fallback to the project owners (and
 * its "nobody to tell" error line) never ran and nobody who could act heard about it.
 * Acceptance is per team row: a member of another team whose invitation to the owner
 * team is still pending does not own the policy either.
 */

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const POLICY_ID: ObjectID = new ObjectID("policy-1");
const OWNER_TEAM: ObjectID = new ObjectID("team-owners");
const OTHER_TEAM: ObjectID = new ObjectID("team-engineering");

const RESPONDER: ObjectID = new ObjectID("user-responder");
const OWNER: ObjectID = new ObjectID("user-owner");
const PENDING_INVITEE: ObjectID = new ObjectID("user-pending-invitee");
// Accepted in engineering, still pending in the owner team.
const PENDING_OWNER: ObjectID = new ObjectID("user-pending-owner");
// A direct owner of the policy who was invited to the project and never accepted.
const PENDING_DIRECT_OWNER: ObjectID = new ObjectID("user-pending-direct");
const DIRECT_OWNER: ObjectID = new ObjectID("user-direct-owner");
const PROJECT_OWNER: ObjectID = new ObjectID("user-project-owner");

const OWNER_SUBJECT: string = "A page in Acme reached nobody";

interface MembershipRow {
  teamId: ObjectID;
  userId: ObjectID;
  hasAcceptedInvitation: boolean;
}

function anyValues(operator: any): Array<string> {
  return Object.values(
    operator.objectLiteralParameters as Record<string, Array<string>>,
  )[0]!.map((value: string): string => {
    return value.toString();
  });
}

function makeUser(userId: ObjectID): User {
  const user: User = new User(userId);
  user.name = userId.toString() as any;
  user.email = new Email(`${userId.toString()}@acme.test`);
  return user;
}

/*
 * One project's TeamMember table, answering both reads the owner lookup makes: a team
 * roster (getUsersInTeams) and a project membership check (filterUsersToProjectMembers).
 * A filter it does not understand fails the test instead of being ignored.
 */
function membershipTable(rows: Array<MembershipRow>): any {
  return jest
    .spyOn(TeamMemberService, "findBy")
    .mockImplementation((findBy: any): any => {
      const query: any = findBy.query;

      for (const key of Object.keys(query)) {
        if (
          !["teamId", "userId", "projectId", "hasAcceptedInvitation"].includes(
            key,
          )
        ) {
          throw new Error(`Unexpected TeamMember filter: ${key}`);
        }
      }

      if (
        query.projectId !== undefined &&
        query.projectId.toString() !== PROJECT_ID.toString()
      ) {
        return Promise.resolve([]);
      }

      return Promise.resolve(
        rows
          .filter((row: MembershipRow): boolean => {
            return (
              (query.teamId === undefined ||
                anyValues(query.teamId).includes(row.teamId.toString())) &&
              (query.userId === undefined ||
                anyValues(query.userId).includes(row.userId.toString())) &&
              (query.hasAcceptedInvitation === undefined ||
                query.hasAcceptedInvitation === row.hasAcceptedInvitation)
            );
          })
          .map((row: MembershipRow): TeamMember => {
            const member: TeamMember = new TeamMember();
            member.projectId = PROJECT_ID;
            member.teamId = row.teamId;
            member.userId = row.userId;
            member.hasAcceptedInvitation = row.hasAcceptedInvitation;
            member.user = makeUser(row.userId);
            return member;
          }),
      );
    });
}

function policyOwners(input: {
  users?: Array<ObjectID>;
  teams?: Array<ObjectID>;
}): void {
  jest.spyOn(OnCallDutyPolicyOwnerUserService, "findBy").mockResolvedValue(
    (input.users || []).map((userId: ObjectID): OnCallDutyPolicyOwnerUser => {
      const row: OnCallDutyPolicyOwnerUser = new OnCallDutyPolicyOwnerUser();
      row.onCallDutyPolicyId = POLICY_ID;
      row.user = makeUser(userId);
      return row;
    }) as never,
  );

  jest.spyOn(OnCallDutyPolicyOwnerTeamService, "findBy").mockResolvedValue(
    (input.teams || []).map((teamId: ObjectID): OnCallDutyPolicyOwnerTeam => {
      const row: OnCallDutyPolicyOwnerTeam = new OnCallDutyPolicyOwnerTeam();
      row.onCallDutyPolicyId = POLICY_ID;
      row.teamId = teamId;
      return row;
    }) as never,
  );
}

describe("OnCallNotificationAlertingService - undeliverable page owner email", () => {
  let service: OnCallNotificationAlertingService;
  let sendMailSpy: any;
  let getOwnersSpy: any;
  let sendEmailToProjectOwnersSpy: any;
  let loggerErrorSpy: any;

  // Who received the owner email directly (not the responder's own email).
  function directOwnerRecipients(): Array<string> {
    return sendMailSpy.mock.calls
      .filter((call: any): boolean => {
        return call[0].subject === OWNER_SUBJECT;
      })
      .map((call: any): string => {
        return call[0].toEmail.toString();
      });
  }

  function emailOf(userId: ObjectID): string {
    return `${userId.toString()}@acme.test`;
  }

  async function reportUndeliverablePage(): Promise<void> {
    await service.notifyOfUndeliverablePage({
      projectId: PROJECT_ID,
      userId: RESPONDER,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      severityName: "Sev1",
      onCallDutyPolicyId: POLICY_ID,
      fallbackChannelsUsed: [],
    });
  }

  beforeEach(() => {
    // A fresh instance, so no test inherits another's in-process throttle.
    service = new OnCallNotificationAlertingService();

    const project: Project = new Project(PROJECT_ID);
    project.name = "Acme";
    project.onCallFallbackUsedNotificationSentToOwners = false;

    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(project);
    jest.spyOn(ProjectService, "updateOneById").mockResolvedValue(1);
    jest
      .spyOn(UserService, "findOneById")
      .mockResolvedValue(makeUser(RESPONDER));

    jest
      .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyName")
      .mockResolvedValue("Primary");
    jest
      .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/policy"));
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/dashboard"));

    sendMailSpy = jest
      .spyOn(MailService, "sendMail")
      .mockResolvedValue(undefined as never);

    getOwnersSpy = jest
      .spyOn(ProjectService, "getOwners")
      .mockResolvedValue([makeUser(PROJECT_OWNER)]);

    sendEmailToProjectOwnersSpy = jest
      .spyOn(ProjectService, "sendEmailToProjectOwners")
      .mockResolvedValue(undefined);

    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    loggerErrorSpy = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a pending invitee on a policy owner team is not mailed; the accepted member is", async () => {
    policyOwners({ teams: [OWNER_TEAM] });
    membershipTable([
      { teamId: OWNER_TEAM, userId: OWNER, hasAcceptedInvitation: true },
      {
        teamId: OWNER_TEAM,
        userId: PENDING_INVITEE,
        hasAcceptedInvitation: false,
      },
    ]);

    await reportUndeliverablePage();

    expect(directOwnerRecipients()).toEqual([emailOf(OWNER)]);
    // The policy still has an owner, so the project owners are not mailed as well.
    expect(getOwnersSpy).not.toHaveBeenCalled();
    expect(sendEmailToProjectOwnersSpy).not.toHaveBeenCalled();
  });

  test("the owner team roster is read accepted-only, not filtered after the fact", async () => {
    policyOwners({ teams: [OWNER_TEAM] });
    const read: any = membershipTable([
      { teamId: OWNER_TEAM, userId: OWNER, hasAcceptedInvitation: true },
    ]);

    await reportUndeliverablePage();

    const rosterRead: any = read.mock.calls.find((call: any): boolean => {
      return call[0].query.teamId !== undefined;
    });

    expect(rosterRead).toBeDefined();
    expect(rosterRead[0].query.hasAcceptedInvitation).toBe(true);
    expect(anyValues(rosterRead[0].query.teamId)).toEqual([
      OWNER_TEAM.toString(),
    ]);
  });

  test("a policy whose owners are all pending invitees falls back to the project owners", async () => {
    policyOwners({ users: [PENDING_DIRECT_OWNER], teams: [OWNER_TEAM] });
    membershipTable([
      {
        teamId: OWNER_TEAM,
        userId: PENDING_INVITEE,
        hasAcceptedInvitation: false,
      },
      {
        teamId: OTHER_TEAM,
        userId: PENDING_DIRECT_OWNER,
        hasAcceptedInvitation: false,
      },
    ]);

    await reportUndeliverablePage();

    expect(directOwnerRecipients()).toEqual([]);
    expect(getOwnersSpy).toHaveBeenCalledWith(PROJECT_ID);
    expect(sendEmailToProjectOwnersSpy).toHaveBeenCalledTimes(1);
    expect(sendEmailToProjectOwnersSpy.mock.calls[0]![0]).toBe(PROJECT_ID);
    expect(sendEmailToProjectOwnersSpy.mock.calls[0]![1]).toBe(OWNER_SUBJECT);
  });

  test("a project member whose invitation to the owner team is still pending does not own the policy", async () => {
    policyOwners({ teams: [OWNER_TEAM] });
    membershipTable([
      {
        teamId: OWNER_TEAM,
        userId: PENDING_OWNER,
        hasAcceptedInvitation: false,
      },
      {
        teamId: OTHER_TEAM,
        userId: PENDING_OWNER,
        hasAcceptedInvitation: true,
      },
    ]);

    await reportUndeliverablePage();

    expect(directOwnerRecipients()).toEqual([]);
    expect(sendEmailToProjectOwnersSpy).toHaveBeenCalledTimes(1);
  });

  test("a direct owner who is a project member is mailed; one whose invitation is still pending is not", async () => {
    policyOwners({ users: [DIRECT_OWNER, PENDING_DIRECT_OWNER] });
    membershipTable([
      { teamId: OTHER_TEAM, userId: DIRECT_OWNER, hasAcceptedInvitation: true },
      {
        teamId: OTHER_TEAM,
        userId: PENDING_DIRECT_OWNER,
        hasAcceptedInvitation: false,
      },
    ]);

    await reportUndeliverablePage();

    expect(directOwnerRecipients()).toEqual([emailOf(DIRECT_OWNER)]);
    expect(sendEmailToProjectOwnersSpy).not.toHaveBeenCalled();
  });

  test("all-pending policy owners and no project owners reaches the loud 'nobody to tell' error", async () => {
    policyOwners({ teams: [OWNER_TEAM] });
    membershipTable([
      {
        teamId: OWNER_TEAM,
        userId: PENDING_INVITEE,
        hasAcceptedInvitation: false,
      },
    ]);
    getOwnersSpy.mockResolvedValue([]);

    await reportUndeliverablePage();

    expect(directOwnerRecipients()).toEqual([]);
    expect(sendEmailToProjectOwnersSpy).not.toHaveBeenCalled();
    expect(
      loggerErrorSpy.mock.calls.some((call: any): boolean => {
        return String(call[0]).includes(
          "has no on-call policy owners and no project owners",
        );
      }),
    ).toBe(true);
  });
});
