import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import User from "../../../Models/DatabaseModels/User";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyScheduleService, {
  CurrentOnCallInSchedule,
} from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import logger from "../../../Server/Utils/Logger";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import { ALREADY_PAGED_TIMELINE_MESSAGE } from "../../../Types/OnCallDutyPolicy/AlreadyPagedTimelineMessage";
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

/*
 * A LEVEL PAGES A PERSON ONCE, HOWEVER MANY OF ITS ROWS NAME THEM (#10411).
 *
 * Before the migration that made a rule's responders unique
 * (1809187100000-MakeEscalationRuleRespondersUnique), the same person could
 * be on a rule twice, and the issue said they were paged twice. They were
 * not: a level pages each person once, whichever of its targets name them
 * (OnCallDutyPolicyEscalationRuleService.pageTargets), and writes a Skipped
 * line for each other time. This holds it, for the rows a rule had before
 * the migration soft-deleted the copies - the person twice, a team twice
 * with the same person in it, a schedule twice with them on call - and for
 * what the rule reads once the copies are gone: the person's one row.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10411000-0000-4000-8000-000000000001",
);
const RULE_ID: ObjectID = new ObjectID("10411000-0000-4000-8000-0000000000e1");
const POLICY_ID: ObjectID = new ObjectID(
  "10411000-0000-4000-8000-0000000000d1",
);
const EXECUTION_LOG_ID: ObjectID = new ObjectID(
  "10411000-0000-4000-8000-0000000000f1",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "10411000-0000-4000-8000-0000000000f2",
);
const ANA: ObjectID = new ObjectID("10411000-0000-4000-8000-0000000000a1");
const BO: ObjectID = new ObjectID("10411000-0000-4000-8000-0000000000a2");
const TEAM_ID: ObjectID = new ObjectID("10411000-0000-4000-8000-0000000000b1");
const SCHEDULE_ID: ObjectID = new ObjectID(
  "10411000-0000-4000-8000-0000000000c1",
);

describe("a level whose rows name a person more than once", () => {
  let timeline: Array<OnCallDutyPolicyExecutionLogTimeline>;
  let paged: Array<string>;
  let userRows: Array<{ userId: ObjectID }>;
  let teamRows: Array<{ teamId: ObjectID }>;
  let scheduleRows: Array<{ onCallDutyPolicyScheduleId: ObjectID }>;

  async function pageTheLevel(): Promise<void> {
    await OnCallDutyPolicyEscalationRuleService.startRuleExecution(RULE_ID, {
      projectId: PROJECT_ID,
      triggeredByIncidentId: INCIDENT_ID,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
      onCallPolicyExecutionLogId: EXECUTION_LOG_ID,
      onCallPolicyId: POLICY_ID,
    });
  }

  function alreadyPagedLines(): Array<OnCallDutyPolicyExecutionLogTimeline> {
    return timeline.filter((row: OnCallDutyPolicyExecutionLogTimeline) => {
      return row.statusMessage === ALREADY_PAGED_TIMELINE_MESSAGE;
    });
  }

  beforeEach(() => {
    timeline = [];
    paged = [];
    userRows = [];
    teamRows = [];
    scheduleRows = [];

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
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "findBy")
      .mockImplementation((async (data: {
        query: { _id?: { value?: Array<ObjectID> } };
      }) => {
        const ids: Array<string> = (data.query._id?.value || []).map(
          (id: ObjectID): string => {
            return id.toString();
          },
        );

        return timeline.filter(
          (row: OnCallDutyPolicyExecutionLogTimeline): boolean => {
            return ids.includes(row.id?.toString() || "");
          },
        );
      }) as never);
    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "create")
      .mockImplementation((async (data: {
        data: OnCallDutyPolicyExecutionLogTimeline;
      }) => {
        data.data.id = ObjectID.generate();
        timeline.push(data.data);
        return data.data;
      }) as never);

    // The rule's rows, as the reads of the level find them.
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findBy")
      .mockImplementation((async () => {
        return userRows;
      }) as never);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "findBy")
      .mockImplementation((async () => {
        return teamRows;
      }) as never);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
      .mockImplementation((async () => {
        return scheduleRows;
      }) as never);

    // Ana is the team's one member, and on call in the schedule.
    jest
      .spyOn(TeamMemberService, "getUsersInTeams")
      .mockImplementation((async () => {
        const ana: User = new User();
        ana.id = ANA;
        return [ana];
      }) as never);
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "getCurrentOnCallInSchedule")
      .mockResolvedValue({
        userId: ANA,
        coveredUserId: null,
      } as CurrentOnCallInSchedule);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "getAwayOverride")
      .mockResolvedValue(null);
    jest
      .spyOn(ProjectMembership, "getMemberUserIds")
      .mockResolvedValue(
        new Set<string>([ANA.toString(), BO.toString()]) as never,
      );

    jest
      .spyOn(UserNotificationRuleService, "startUserNotificationRulesExecution")
      .mockImplementation((async (userId: ObjectID) => {
        paged.push(userId.toString());
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the person named twice by the rule, as rows were before the migration, is paged once", async () => {
    userRows = [{ userId: ANA }, { userId: ANA }, { userId: BO }];

    await pageTheLevel();

    expect(paged).toEqual([ANA.toString(), BO.toString()]);

    // The second row is a Skipped line on the run's timeline, not a page.
    const skipped: Array<OnCallDutyPolicyExecutionLogTimeline> =
      alreadyPagedLines();
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.status).toBe(
      OnCallDutyExecutionLogTimelineStatus.Skipped,
    );
    expect(skipped[0]!.alertSentToUserId?.toString()).toBe(ANA.toString());
  });

  test("a team named twice, and a schedule named twice, with the same person in each, page them once", async () => {
    userRows = [{ userId: ANA }];
    teamRows = [{ teamId: TEAM_ID }, { teamId: TEAM_ID }];
    scheduleRows = [
      { onCallDutyPolicyScheduleId: SCHEDULE_ID },
      { onCallDutyPolicyScheduleId: SCHEDULE_ID },
    ];

    await pageTheLevel();

    expect(paged).toEqual([ANA.toString()]);
    // Each further time the level reached her: two team rows, the user row
    // and the two schedule rows, one of them her page.
    expect(alreadyPagedLines()).toHaveLength(4);
  });

  test("once the copies are soft-deleted, the level reads her one row, and pages her once with no Skipped line", async () => {
    userRows = [{ userId: ANA }, { userId: BO }];

    await pageTheLevel();

    expect(paged).toEqual([ANA.toString(), BO.toString()]);
    expect(alreadyPagedLines()).toEqual([]);
  });
});
