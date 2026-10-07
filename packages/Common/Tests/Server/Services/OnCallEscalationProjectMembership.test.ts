import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import User from "../../../Models/DatabaseModels/User";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService, {
  NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
} from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import logger from "../../../Server/Utils/Logger";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import ObjectID from "../../../Types/ObjectID";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
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
 * An escalation rule pages nobody on the project's behalf who is not a
 * member of the project NOW. The leave cleanup takes a departed person off
 * the rule, the schedules' layers and the overrides; this is the send-time
 * check that keeps any reference it missed - or one written while they were
 * leaving - from paging them through whatever notification methods they had.
 *
 *   - teams page their ACCEPTED members only (a pending invitee is not on
 *     the roster),
 *   - a direct user or a schedule's on-call user who is not a member gets a
 *     Skipped line on the timeline instead of a page,
 *   - an override's substitute who is not a member gets the Skipped line,
 *     and the member the override covers is paged instead of nobody,
 *   - membership is read once for the whole rule, never once per person,
 *   - if membership cannot be read, the rule pages as it did before the
 *     check rather than paging nobody.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const RULE_ID: ObjectID = new ObjectID("eeeeeeee-0000-4000-8000-000000000001");
const POLICY_ID: ObjectID = new ObjectID(
  "dddddddd-0000-4000-8000-000000000001",
);
const EXECUTION_LOG_ID: ObjectID = new ObjectID(
  "cccccccc-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-000000000001",
);
const TEAM_ID: ObjectID = new ObjectID("7eae0000-0000-4000-8000-000000000001");
const SCHEDULE_WITH_LEAVER: ObjectID = new ObjectID(
  "5c4e0000-0000-4000-8000-000000000001",
);
const SCHEDULE_WITH_MEMBER: ObjectID = new ObjectID(
  "5c4e0000-0000-4000-8000-000000000002",
);

const TEAM_MEMBER: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const DIRECT_MEMBER: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000002",
);
const DIRECT_LEAVER: ObjectID = new ObjectID(
  "30000000-0000-4000-8000-000000000003",
);
// A member whose alerts an override routes to somebody who has left.
const OVERRIDDEN_MEMBER: ObjectID = new ObjectID(
  "40000000-0000-4000-8000-000000000004",
);
const SUBSTITUTE_LEAVER: ObjectID = new ObjectID(
  "50000000-0000-4000-8000-000000000005",
);
const ON_CALL_LEAVER: ObjectID = new ObjectID(
  "60000000-0000-4000-8000-000000000006",
);
const ON_CALL_MEMBER: ObjectID = new ObjectID(
  "70000000-0000-4000-8000-000000000007",
);

function user(id: ObjectID): User {
  const row: User = new User();
  row.id = id;
  return row;
}

describe("an escalation rule pages project members only", () => {
  let timeline: Array<OnCallDutyPolicyExecutionLogTimeline>;
  let paged: Array<string>;
  let membershipReads: Array<Array<string>>;
  let members: Set<string>;
  let usersInTeams: SpyInstance<typeof TeamMemberService.getUsersInTeams>;

  async function runRule(): Promise<void> {
    await OnCallDutyPolicyEscalationRuleService.startRuleExecution(RULE_ID, {
      projectId: PROJECT_ID,
      triggeredByIncidentId: INCIDENT_ID,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
      onCallPolicyExecutionLogId: EXECUTION_LOG_ID,
      onCallPolicyId: POLICY_ID,
    });
  }

  function skippedAsNonMembers(): Array<OnCallDutyPolicyExecutionLogTimeline> {
    return timeline.filter((row: OnCallDutyPolicyExecutionLogTimeline) => {
      return row.statusMessage === NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE;
    });
  }

  beforeEach(() => {
    timeline = [];
    paged = [];
    membershipReads = [];
    members = new Set<string>([
      TEAM_MEMBER.toString(),
      DIRECT_MEMBER.toString(),
      OVERRIDDEN_MEMBER.toString(),
      ON_CALL_MEMBER.toString(),
    ]);

    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneById")
      .mockResolvedValue({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        order: 1,
        escalateAfterInMinutes: 10,
      } as unknown as OnCallDutyPolicyEscalationRule);
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue({ scheduleGapRetryCount: 0 } as never);

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "findBy")
      .mockResolvedValue([{ teamId: TEAM_ID }] as never);
    usersInTeams = jest
      .spyOn(TeamMemberService, "getUsersInTeams")
      .mockResolvedValue([user(TEAM_MEMBER)]);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findBy")
      .mockResolvedValue([
        { userId: DIRECT_MEMBER },
        { userId: DIRECT_LEAVER },
        { userId: OVERRIDDEN_MEMBER },
      ] as never);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
      .mockResolvedValue([
        { onCallDutyPolicyScheduleId: SCHEDULE_WITH_LEAVER },
        { onCallDutyPolicyScheduleId: SCHEDULE_WITH_MEMBER },
      ] as never);
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "getCurrentUserIdInSchedule")
      .mockImplementation(async (scheduleId: ObjectID) => {
        return scheduleId.toString() === SCHEDULE_WITH_LEAVER.toString()
          ? ON_CALL_LEAVER
          : ON_CALL_MEMBER;
      });
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "getRouteAlertToUserId")
      .mockImplementation(async (data: { userId: ObjectID }) => {
        return data.userId.toString() === OVERRIDDEN_MEMBER.toString()
          ? SUBSTITUTE_LEAVER
          : null;
      });

    jest
      .spyOn(ProjectMembership, "getMemberUserIds")
      .mockImplementation(
        async (data: {
          projectId: ObjectID;
          userIds: Array<ObjectID | string>;
        }): Promise<Set<string>> => {
          const asked: Array<string> = data.userIds.map(
            (userId: ObjectID | string): string => {
              return userId.toString();
            },
          );

          membershipReads.push(asked);

          return new Set<string>(
            asked.filter((userId: string): boolean => {
              return members.has(userId);
            }),
          );
        },
      );

    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "create")
      .mockImplementation((async (data: {
        data: OnCallDutyPolicyExecutionLogTimeline;
      }) => {
        data.data.id = ObjectID.generate();
        timeline.push(data.data);
        return data.data;
      }) as never);
    jest
      .spyOn(UserNotificationRuleService, "startUserNotificationRulesExecution")
      .mockImplementation((async (userId: ObjectID) => {
        paged.push(userId.toString());
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("members are paged; a direct user, an override's substitute and an on-call user who left are not", async () => {
    await runRule();

    // The member whose override routes to somebody who left is paged themselves.
    expect(paged).toEqual([
      TEAM_MEMBER.toString(),
      DIRECT_MEMBER.toString(),
      OVERRIDDEN_MEMBER.toString(),
      ON_CALL_MEMBER.toString(),
    ]);

    const skipped: Array<OnCallDutyPolicyExecutionLogTimeline> =
      skippedAsNonMembers();

    expect(
      skipped.map((row: OnCallDutyPolicyExecutionLogTimeline) => {
        return {
          status: row.status,
          alertSentToUserId: row.alertSentToUserId?.toString(),
          overridedByUserId: row.overridedByUserId?.toString(),
          onCallDutyScheduleId: row.onCallDutyScheduleId?.toString(),
        };
      }),
    ).toEqual([
      {
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        alertSentToUserId: DIRECT_LEAVER.toString(),
        overridedByUserId: undefined,
        onCallDutyScheduleId: undefined,
      },
      // The substitute who left is skipped; the member they covered is paged.
      {
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        alertSentToUserId: SUBSTITUTE_LEAVER.toString(),
        overridedByUserId: OVERRIDDEN_MEMBER.toString(),
        onCallDutyScheduleId: undefined,
      },
      {
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        alertSentToUserId: ON_CALL_LEAVER.toString(),
        overridedByUserId: undefined,
        onCallDutyScheduleId: SCHEDULE_WITH_LEAVER.toString(),
      },
    ]);

    // Paged as themselves, not on anybody's behalf.
    const coveredRow: OnCallDutyPolicyExecutionLogTimeline | undefined =
      timeline.find((row: OnCallDutyPolicyExecutionLogTimeline) => {
        return (
          row.status === OnCallDutyExecutionLogTimelineStatus.Executing &&
          row.alertSentToUserId?.toString() === OVERRIDDEN_MEMBER.toString()
        );
      });

    expect(coveredRow).toBeDefined();
    expect(coveredRow?.overridedByUserId).toBeUndefined();
    expect(paged).not.toContain(SUBSTITUTE_LEAVER.toString());
  });

  test("an override whose substitute and covered member have both left pages nobody for them", async () => {
    members.delete(OVERRIDDEN_MEMBER.toString());

    await runRule();

    expect(paged).not.toContain(OVERRIDDEN_MEMBER.toString());
    expect(paged).not.toContain(SUBSTITUTE_LEAVER.toString());
    expect(
      skippedAsNonMembers().some(
        (row: OnCallDutyPolicyExecutionLogTimeline) => {
          return (
            row.alertSentToUserId?.toString() === SUBSTITUTE_LEAVER.toString()
          );
        },
      ),
    ).toBe(true);
  });

  test("membership is read once for every recipient of the rule and the people their overrides cover", async () => {
    await runRule();

    expect(membershipReads).toHaveLength(1);
    expect(Array.from(new Set<string>(membershipReads[0])).sort()).toEqual(
      [
        TEAM_MEMBER.toString(),
        DIRECT_MEMBER.toString(),
        DIRECT_LEAVER.toString(),
        SUBSTITUTE_LEAVER.toString(),
        OVERRIDDEN_MEMBER.toString(),
        ON_CALL_LEAVER.toString(),
        ON_CALL_MEMBER.toString(),
      ].sort(),
    );
  });

  test("membership that cannot be read pages the rule's recipients as before, rather than nobody", async () => {
    (
      ProjectMembership.getMemberUserIds as unknown as {
        mockRejectedValue: (error: Error) => void;
      }
    ).mockRejectedValue(new Error("database unavailable"));

    await runRule();

    expect(paged).toEqual([
      TEAM_MEMBER.toString(),
      DIRECT_MEMBER.toString(),
      DIRECT_LEAVER.toString(),
      SUBSTITUTE_LEAVER.toString(),
      ON_CALL_LEAVER.toString(),
      ON_CALL_MEMBER.toString(),
    ]);
    expect(skippedAsNonMembers()).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });

  test("a team pages its accepted members only", async () => {
    await runRule();

    expect(usersInTeams).toHaveBeenCalledTimes(1);
    expect(usersInTeams.mock.calls[0]![0]).toEqual([TEAM_ID]);
    expect(usersInTeams.mock.calls[0]![1]).toEqual({ acceptedOnly: true });
  });

  test("a team member who left is skipped like anybody else", async () => {
    members.delete(TEAM_MEMBER.toString());

    await runRule();

    expect(paged).not.toContain(TEAM_MEMBER.toString());

    const teamRow: OnCallDutyPolicyExecutionLogTimeline | undefined =
      skippedAsNonMembers().find(
        (row: OnCallDutyPolicyExecutionLogTimeline) => {
          return row.alertSentToUserId?.toString() === TEAM_MEMBER.toString();
        },
      );

    expect(teamRow?.userBelongsToTeamId?.toString()).toBe(TEAM_ID.toString());
  });

  test("nobody left to page: the rule says it reached no one", async () => {
    members.clear();

    await runRule();

    expect(paged).toEqual([]);
    expect(skippedAsNonMembers()).toHaveLength(6);
    expect(
      timeline.some((row: OnCallDutyPolicyExecutionLogTimeline) => {
        return row.statusMessage === "Skipped because no users in this rule.";
      }),
    ).toBe(true);
  });
});
