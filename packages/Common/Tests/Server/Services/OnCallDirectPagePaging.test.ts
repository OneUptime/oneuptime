import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import User from "../../../Models/DatabaseModels/User";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService, {
  AwayOverride,
  NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
  OnCallNotPagedReason,
  OnCallPagingOutcome,
  OnCallRuleExecutionOutcome,
} from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyScheduleService, {
  CurrentOnCallInSchedule,
} from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyUserOverrideService from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import logger from "../../../Server/Utils/Logger";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { getAwayTimelineMessage } from "../../../Types/OnCallDutyPolicy/AwayTimelineMessage";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import {
  ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE,
  ON_CALL_DIRECT_PAGE_NOBODY_TO_PAGE_TIMELINE_MESSAGE,
  OnCallDirectPageTargets,
} from "../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import { ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE } from "../../../Types/OnCallDutyPolicy/OnCallEmptyLevel";
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
 * A DIRECT PAGE PAGES ITS TARGETS AS AN ESCALATION RULE PAGES ITS OWN.
 *
 * OnCallDutyPolicyEscalationRuleService.startDirectPage pages the people, the
 * teams' members and whoever is on call in the schedules a direct page
 * names - with no on-call policy and no escalation rule behind them. What it
 * must do:
 *
 *   - page everybody at once, in the order a rule pages its targets: teams'
 *     members, then people named directly, then schedules' on-call people;
 *   - write a line on the run's timeline for everybody and everything it
 *     paged or could not, naming no policy and no rule;
 *   - hand each person's page to their own notification rules, with the
 *     record it is about and no policy;
 *   - respect user overrides - the global ones only: a cover is paged in
 *     their place, a person skipped is not paged and the line says until
 *     when;
 *   - page nobody who is not a member of the project, and nobody twice;
 *   - say what it found nobody in - a team with no members, a schedule
 *     with nobody on call - and tell its caller all of it.
 *
 * And an escalation rule still pages exactly as it did: the same lines, the
 * same calls (the last block).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const RUN_ID: ObjectID = new ObjectID("cccccccc-0000-4000-8000-000000000001");
const INCIDENT_ID: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-000000000001",
);
const ALERT_ID: ObjectID = new ObjectID("bbbbbbbb-0000-4000-8000-000000000002");

const TEAM_PLATFORM: ObjectID = new ObjectID(
  "7eae0000-0000-4000-8000-000000000001",
);
const TEAM_EMPTY: ObjectID = new ObjectID(
  "7eae0000-0000-4000-8000-000000000002",
);
const SCHEDULE_PRIMARY: ObjectID = new ObjectID(
  "5c4e0000-0000-4000-8000-000000000001",
);
const SCHEDULE_NOBODY: ObjectID = new ObjectID(
  "5c4e0000-0000-4000-8000-000000000002",
);

const JANE: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000001");
const JOHN: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000002");
const ALEX: ObjectID = new ObjectID("30000000-0000-4000-8000-000000000003");
const SAM: ObjectID = new ObjectID("40000000-0000-4000-8000-000000000004");
const KIM: ObjectID = new ObjectID("50000000-0000-4000-8000-000000000005");
const LEAVER: ObjectID = new ObjectID("60000000-0000-4000-8000-000000000006");

const AWAY_UNTIL: Date = new Date("2026-10-17T09:00:00.000Z");

function user(id: ObjectID): User {
  const row: User = new User();
  row.id = id;
  return row;
}

interface Page {
  userId: string;
  options: Record<string, unknown>;
}

interface TimelineLine {
  status: OnCallDutyExecutionLogTimelineStatus | undefined;
  statusMessage: string | undefined;
  user: string | undefined;
  coveringFor: string | undefined;
  team: string | undefined;
  schedule: string | undefined;
}

describe("a direct page pages its targets", () => {
  let timeline: Array<OnCallDutyPolicyExecutionLogTimeline>;
  let pages: Array<Page>;
  let members: Set<string>;
  let usersByTeam: Map<string, Array<ObjectID>>;
  let onCallBySchedule: Map<string, CurrentOnCallInSchedule>;
  let awayByUser: Map<string, AwayOverride>;
  let runUpdates: Array<Record<string, unknown>>;
  let awayOverride: SpyInstance<
    typeof OnCallDutyPolicyEscalationRuleService.getAwayOverride
  >;
  let onCallInSchedule: SpyInstance<
    typeof OnCallDutyPolicyScheduleService.getCurrentOnCallInSchedule
  >;
  let membershipRead: SpyInstance<typeof ProjectMembership.getMemberUserIds>;

  function targets(
    data: Partial<OnCallDirectPageTargets>,
  ): OnCallDirectPageTargets {
    return {
      userIds: data.userIds || [],
      teamIds: data.teamIds || [],
      onCallScheduleIds: data.onCallScheduleIds || [],
    };
  }

  async function page(
    data: Partial<OnCallDirectPageTargets>,
    about?: { alert?: boolean },
  ): Promise<OnCallPagingOutcome> {
    return await OnCallDutyPolicyEscalationRuleService.startDirectPage({
      projectId: PROJECT_ID,
      ...(about?.alert
        ? {
            triggeredByAlertId: ALERT_ID,
            userNotificationEventType: UserNotificationEventType.AlertCreated,
          }
        : {
            triggeredByIncidentId: INCIDENT_ID,
            userNotificationEventType:
              UserNotificationEventType.IncidentCreated,
          }),
      onCallPolicyExecutionLogId: RUN_ID,
      targets: targets(data),
    });
  }

  function lines(): Array<TimelineLine> {
    return timeline.map(
      (row: OnCallDutyPolicyExecutionLogTimeline): TimelineLine => {
        return {
          status: row.status,
          statusMessage: row.statusMessage,
          user: row.alertSentToUserId?.toString(),
          coveringFor: row.overridedByUserId?.toString(),
          team: row.userBelongsToTeamId?.toString(),
          schedule: row.onCallDutyScheduleId?.toString(),
        };
      },
    );
  }

  function paged(): Array<string> {
    return pages.map((entry: Page): string => {
      return entry.userId;
    });
  }

  beforeEach(() => {
    timeline = [];
    pages = [];
    runUpdates = [];
    members = new Set<string>(
      [JANE, JOHN, ALEX, SAM, KIM].map((id: ObjectID): string => {
        return id.toString();
      }),
    );
    usersByTeam = new Map<string, Array<ObjectID>>([
      [TEAM_PLATFORM.toString(), [JANE, JOHN]],
      [TEAM_EMPTY.toString(), []],
    ]);
    onCallBySchedule = new Map<string, CurrentOnCallInSchedule>([
      [SCHEDULE_PRIMARY.toString(), { userId: SAM, coveredUserId: null }],
    ]);
    awayByUser = new Map<string, AwayOverride>();

    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "updateOneById")
      .mockImplementation((async (update: {
        data: Record<string, unknown>;
      }) => {
        runUpdates.push(update.data);
      }) as never);

    jest.spyOn(TeamMemberService, "getUsersInTeams").mockImplementation((async (
      teamIds: Array<ObjectID>,
    ) => {
      return (usersByTeam.get(teamIds[0]!.toString()) || []).map(user);
    }) as never);

    onCallInSchedule = jest
      .spyOn(OnCallDutyPolicyScheduleService, "getCurrentOnCallInSchedule")
      .mockImplementation(async (scheduleId: ObjectID) => {
        return onCallBySchedule.get(scheduleId.toString()) || null;
      });

    awayOverride = jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "getAwayOverride")
      .mockImplementation(async (data: { userId: ObjectID }) => {
        return awayByUser.get(data.userId.toString()) || null;
      });

    membershipRead = jest
      .spyOn(ProjectMembership, "getMemberUserIds")
      .mockImplementation(
        async (data: {
          projectId: ObjectID;
          userIds: Array<ObjectID | string>;
        }): Promise<Set<string>> => {
          return new Set<string>(
            data.userIds
              .map((userId: ObjectID | string): string => {
                return userId.toString();
              })
              .filter((userId: string): boolean => {
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
      .mockImplementation((async (
        userId: ObjectID,
        options: Record<string, unknown>,
      ) => {
        pages.push({ userId: userId.toString(), options: options });
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("who is paged", () => {
    test("the people it names, each once, in the order they are named", async () => {
      const outcome: OnCallPagingOutcome = await page({
        userIds: [JOHN, JANE, KIM],
      });

      expect(paged()).toEqual([JOHN, JANE, KIM].map(String));
      expect(outcome.paged).toEqual([
        {
          userId: JOHN,
          coveringForUserId: null,
          teamId: null,
          scheduleId: null,
        },
        {
          userId: JANE,
          coveringForUserId: null,
          teamId: null,
          scheduleId: null,
        },
        {
          userId: KIM,
          coveringForUserId: null,
          teamId: null,
          scheduleId: null,
        },
      ]);
      expect(outcome.notPaged).toEqual([]);
      expect(outcome.hadScheduleGap).toBe(false);
    });

    test("every accepted member of a team it names", async () => {
      const outcome: OnCallPagingOutcome = await page({
        teamIds: [TEAM_PLATFORM],
      });

      expect(paged()).toEqual([JANE, JOHN].map(String));
      expect(TeamMemberService.getUsersInTeams).toHaveBeenCalledWith(
        [TEAM_PLATFORM],
        { acceptedOnly: true },
      );
      expect(outcome.paged).toEqual([
        {
          userId: JANE,
          coveringForUserId: null,
          teamId: TEAM_PLATFORM,
          scheduleId: null,
        },
        {
          userId: JOHN,
          coveringForUserId: null,
          teamId: TEAM_PLATFORM,
          scheduleId: null,
        },
      ]);
    });

    test("whoever is on call right now in a schedule it names", async () => {
      const outcome: OnCallPagingOutcome = await page({
        onCallScheduleIds: [SCHEDULE_PRIMARY],
      });

      expect(paged()).toEqual([SAM.toString()]);
      expect(outcome.paged).toEqual([
        {
          userId: SAM,
          coveringForUserId: null,
          teamId: null,
          scheduleId: SCHEDULE_PRIMARY,
        },
      ]);
    });

    test("teams' members first, then people, then schedules: as a rule pages", async () => {
      await page({
        userIds: [KIM],
        teamIds: [TEAM_PLATFORM],
        onCallScheduleIds: [SCHEDULE_PRIMARY],
      });

      expect(paged()).toEqual([JANE, JOHN, KIM, SAM].map(String));
    });

    test("nobody twice: named directly, in a team and on call, they get one page", async () => {
      onCallBySchedule.set(SCHEDULE_PRIMARY.toString(), {
        userId: JANE,
        coveredUserId: null,
      });

      const outcome: OnCallPagingOutcome = await page({
        userIds: [JANE, JANE],
        teamIds: [TEAM_PLATFORM],
        onCallScheduleIds: [SCHEDULE_PRIMARY],
      });

      expect(paged()).toEqual([JANE, JOHN].map(String));
      expect(
        outcome.paged.map((entry: { userId: ObjectID }): string => {
          return entry.userId.toString();
        }),
      ).toEqual([JANE, JOHN].map(String));

      // Each further time is a line that says so, not a second page.
      expect(
        lines().filter((line: TimelineLine): boolean => {
          return (
            line.statusMessage ===
            "Skipped because notification sent to this user already."
          );
        }),
      ).toHaveLength(3);
      // Not paged again is not "not paged".
      expect(outcome.notPaged).toEqual([]);
    });
  });

  describe("what each page carries", () => {
    test("the incident it is about, the run, and no policy or escalation rule", async () => {
      await page({ userIds: [JANE] });

      expect(pages).toHaveLength(1);
      expect(pages[0]!.options).toEqual({
        userNotificationEventType: UserNotificationEventType.IncidentCreated,
        triggeredByIncidentId: INCIDENT_ID,
        triggeredByAlertId: undefined,
        triggeredByAlertEpisodeId: undefined,
        triggeredByIncidentEpisodeId: undefined,
        onCallPolicyExecutionLogId: RUN_ID,
        onCallPolicyId: undefined,
        onCallPolicyEscalationRuleId: undefined,
        userBelongsToTeamId: undefined,
        onCallDutyPolicyExecutionLogTimelineId: timeline[0]!.id,
        projectId: PROJECT_ID,
        onCallScheduleId: undefined,
        overridedByUserId: undefined,
      });
    });

    test("an alert, for a page about an alert", async () => {
      await page({ userIds: [JANE] }, { alert: true });

      expect(pages[0]!.options["userNotificationEventType"]).toBe(
        UserNotificationEventType.AlertCreated,
      );
      expect(pages[0]!.options["triggeredByAlertId"]).toBe(ALERT_ID);
      expect(pages[0]!.options["triggeredByIncidentId"]).toBeUndefined();
      expect(timeline[0]!.triggeredByAlertId).toBe(ALERT_ID);
      expect(timeline[0]!.triggeredByIncidentId).toBeUndefined();
    });

    test("the team or the schedule the person was paged through", async () => {
      await page({
        teamIds: [TEAM_PLATFORM],
        onCallScheduleIds: [SCHEDULE_PRIMARY],
      });

      expect(pages[0]!.options["userBelongsToTeamId"]).toBe(TEAM_PLATFORM);
      expect(pages[0]!.options["onCallScheduleId"]).toBeUndefined();
      expect(pages[2]!.options["onCallScheduleId"]).toBe(SCHEDULE_PRIMARY);
      expect(pages[2]!.options["userBelongsToTeamId"]).toBeUndefined();
    });
  });

  describe("the run's timeline", () => {
    test("a line for each person paged: the run and the record, no policy, no rule", async () => {
      await page({ userIds: [JANE] });

      expect(timeline).toHaveLength(1);

      const row: OnCallDutyPolicyExecutionLogTimeline = timeline[0]!;

      expect(row.projectId).toBe(PROJECT_ID);
      expect(row.onCallDutyPolicyExecutionLogId).toBe(RUN_ID);
      expect(row.triggeredByIncidentId).toBe(INCIDENT_ID);
      expect(row.userNotificationEventType).toBe(
        UserNotificationEventType.IncidentCreated,
      );
      expect(row.alertSentToUserId).toBe(JANE);
      expect(row.status).toBe(OnCallDutyExecutionLogTimelineStatus.Executing);
      expect(row.statusMessage).toBe("Sending notification to user.");
      // What makes it a direct page's line.
      expect(row.onCallDutyPolicyId).toBeUndefined();
      expect(row.onCallDutyPolicyEscalationRuleId).toBeUndefined();
    });

    test("every line is written as OneUptime", async () => {
      await page({ userIds: [JANE], onCallScheduleIds: [SCHEDULE_NOBODY] });

      const creates: Array<Array<unknown>> = (
        OnCallDutyPolicyExecutionLogTimelineService.create as unknown as {
          mock: { calls: Array<Array<unknown>> };
        }
      ).mock.calls;

      expect(creates.length).toBe(2);

      for (const call of creates) {
        expect((call[0] as { props: unknown }).props).toEqual({ isRoot: true });
      }
    });

    test("when the paging started is recorded on the run before anybody is paged", async () => {
      const order: Array<string> = [];

      (
        OnCallDutyPolicyExecutionLogService.updateOneById as unknown as {
          mockImplementation: (implementation: unknown) => void;
        }
      ).mockImplementation(
        async (update: { data: Record<string, unknown> }) => {
          order.push("run");
          runUpdates.push(update.data);
        },
      );
      (
        UserNotificationRuleService.startUserNotificationRulesExecution as unknown as {
          mockImplementation: (implementation: unknown) => void;
        }
      ).mockImplementation(async () => {
        order.push("page");
      });

      await page({ userIds: [JANE] });

      expect(order).toEqual(["run", "page"]);
      expect(Object.keys(runUpdates[0]!).sort()).toEqual([
        "executeNextEscalationRuleInMinutes",
        "lastEscalationRuleExecutedAt",
      ]);
      expect(runUpdates[0]!["executeNextEscalationRuleInMinutes"]).toBe(0);
      expect(runUpdates[0]!["lastEscalationRuleExecutedAt"]).toBeInstanceOf(
        Date,
      );
      // No rule of any policy is ever named on a direct page's run.
      expect(runUpdates[0]).not.toHaveProperty("lastExecutedEscalationRuleId");
      expect(runUpdates[0]).not.toHaveProperty(
        "lastExecutedEscalationRuleOrder",
      );
    });

    test("a direct page never touches the run's schedule-gap retries", async () => {
      await page({ onCallScheduleIds: [SCHEDULE_NOBODY] });

      for (const update of runUpdates) {
        expect(update).not.toHaveProperty("scheduleGapRetryCount");
        expect(update).not.toHaveProperty("lastExecutedEscalationRuleOrder");
      }
    });
  });

  describe("people who are away", () => {
    test("only the global overrides decide: no policy is asked about", async () => {
      await page({ userIds: [JANE], teamIds: [TEAM_PLATFORM] });

      expect(awayOverride).toHaveBeenCalledTimes(3);

      for (const call of awayOverride.mock.calls) {
        expect(call[0]).toEqual({
          userId: expect.any(ObjectID),
          onCallDutyPolicyId: undefined,
          projectId: PROJECT_ID,
        });
      }
    });

    test("a schedule is read with global overrides only, too", async () => {
      await page({ onCallScheduleIds: [SCHEDULE_PRIMARY] });

      expect(onCallInSchedule).toHaveBeenCalledWith(SCHEDULE_PRIMARY, {
        onCallDutyPolicyId: undefined,
      });
      // The schedule applied its own overrides: no second hop.
      expect(awayOverride).not.toHaveBeenCalled();
    });

    test("whoever covers is paged in their place, and the line says for whom", async () => {
      awayByUser.set(ALEX.toString(), {
        coverUserId: KIM,
        endsAt: AWAY_UNTIL,
      });

      const outcome: OnCallPagingOutcome = await page({ userIds: [ALEX] });

      expect(paged()).toEqual([KIM.toString()]);
      expect(pages[0]!.options["overridedByUserId"]).toBe(ALEX);
      expect(lines()).toEqual([
        {
          status: OnCallDutyExecutionLogTimelineStatus.Executing,
          statusMessage: "Sending notification to user.",
          user: KIM.toString(),
          coveringFor: ALEX.toString(),
          team: undefined,
          schedule: undefined,
        },
      ]);
      expect(outcome.paged).toEqual([
        {
          userId: KIM,
          coveringForUserId: ALEX,
          teamId: null,
          scheduleId: null,
        },
      ]);
    });

    test("somebody skipped - away, nobody named to cover - is not paged, and the line says until when", async () => {
      awayByUser.set(ALEX.toString(), {
        coverUserId: null,
        endsAt: AWAY_UNTIL,
      });

      const outcome: OnCallPagingOutcome = await page({
        userIds: [ALEX, JANE],
      });

      expect(paged()).toEqual([JANE.toString()]);
      expect(lines()[0]).toEqual({
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        statusMessage: getAwayTimelineMessage(AWAY_UNTIL),
        user: ALEX.toString(),
        coveringFor: undefined,
        team: undefined,
        schedule: undefined,
      });
      expect(outcome.notPaged).toEqual([
        {
          reason: OnCallNotPagedReason.Away,
          userId: ALEX,
          teamId: null,
          scheduleId: null,
          awayUntil: AWAY_UNTIL,
        },
      ]);
    });

    test("a team member who is skipped: the line names the team", async () => {
      awayByUser.set(JOHN.toString(), {
        coverUserId: null,
        endsAt: AWAY_UNTIL,
      });

      const outcome: OnCallPagingOutcome = await page({
        teamIds: [TEAM_PLATFORM],
      });

      expect(paged()).toEqual([JANE.toString()]);
      expect(lines()[1]!.team).toBe(TEAM_PLATFORM.toString());
      expect(outcome.notPaged[0]).toMatchObject({
        reason: OnCallNotPagedReason.Away,
        userId: JOHN,
        teamId: TEAM_PLATFORM,
      });
    });

    test("the on-call person covering in a schedule: paged, covering the layer user", async () => {
      onCallBySchedule.set(SCHEDULE_PRIMARY.toString(), {
        userId: KIM,
        coveredUserId: ALEX,
      });

      const outcome: OnCallPagingOutcome = await page({
        onCallScheduleIds: [SCHEDULE_PRIMARY],
      });

      expect(paged()).toEqual([KIM.toString()]);
      expect(outcome.paged).toEqual([
        {
          userId: KIM,
          coveringForUserId: ALEX,
          teamId: null,
          scheduleId: SCHEDULE_PRIMARY,
        },
      ]);
      expect(lines()[0]!.coveringFor).toBe(ALEX.toString());
    });
  });

  describe("people who are not members of the project", () => {
    test("are never paged: the line says so", async () => {
      const outcome: OnCallPagingOutcome = await page({
        userIds: [LEAVER, JANE],
      });

      expect(paged()).toEqual([JANE.toString()]);
      expect(lines()[0]).toEqual({
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        statusMessage: NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
        user: LEAVER.toString(),
        coveringFor: undefined,
        team: undefined,
        schedule: undefined,
      });
      expect(outcome.notPaged).toEqual([
        {
          reason: OnCallNotPagedReason.NotAProjectMember,
          userId: LEAVER,
          teamId: null,
          scheduleId: null,
          awayUntil: null,
        },
      ]);
    });

    test("membership is read once for the whole page, covers and the people they cover included", async () => {
      awayByUser.set(ALEX.toString(), {
        coverUserId: KIM,
        endsAt: AWAY_UNTIL,
      });

      await page({
        userIds: [ALEX],
        teamIds: [TEAM_PLATFORM],
        onCallScheduleIds: [SCHEDULE_PRIMARY],
      });

      expect(membershipRead).toHaveBeenCalledTimes(1);
      expect(membershipRead.mock.calls[0]![0].projectId).toBe(PROJECT_ID);
      expect(
        Array.from(
          new Set<string>(membershipRead.mock.calls[0]![0].userIds.map(String)),
        ).sort(),
      ).toEqual([JANE, JOHN, ALEX, KIM, SAM].map(String).sort());
    });

    test("a cover who left: the member they cover is paged themselves, not nobody", async () => {
      awayByUser.set(ALEX.toString(), {
        coverUserId: LEAVER,
        endsAt: AWAY_UNTIL,
      });

      const outcome: OnCallPagingOutcome = await page({ userIds: [ALEX] });

      expect(paged()).toEqual([ALEX.toString()]);
      expect(pages[0]!.options["overridedByUserId"]).toBeUndefined();
      expect(outcome.paged).toEqual([
        {
          userId: ALEX,
          coveringForUserId: null,
          teamId: null,
          scheduleId: null,
        },
      ]);
      // The cover is still said not to have been paged.
      expect(outcome.notPaged).toEqual([
        {
          reason: OnCallNotPagedReason.NotAProjectMember,
          userId: LEAVER,
          teamId: null,
          scheduleId: null,
          awayUntil: null,
        },
      ]);
    });

    test("membership that cannot be read: the page goes out rather than reaching nobody", async () => {
      membershipRead.mockRejectedValue(new Error("database unavailable"));

      const outcome: OnCallPagingOutcome = await page({
        userIds: [JANE, LEAVER],
      });

      expect(paged()).toEqual([JANE, LEAVER].map(String));
      expect(outcome.notPaged).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        "Could not read project membership for a direct page; paging its recipients without the membership check.",
        expect.objectContaining({ projectId: PROJECT_ID.toString() }),
      );
    });
  });

  describe("targets that reach nobody", () => {
    test("a schedule with nobody on call: a line for it, and the caller is told", async () => {
      const outcome: OnCallPagingOutcome = await page({
        onCallScheduleIds: [SCHEDULE_NOBODY],
      });

      expect(paged()).toEqual([]);
      expect(lines()).toEqual([
        {
          status: OnCallDutyExecutionLogTimelineStatus.Skipped,
          statusMessage:
            "Skipped because no active users are found in this schedule.",
          user: undefined,
          coveringFor: undefined,
          team: undefined,
          schedule: SCHEDULE_NOBODY.toString(),
        },
      ]);
      expect(outcome).toEqual({
        paged: [],
        notPaged: [
          {
            reason: OnCallNotPagedReason.NobodyOnCall,
            userId: null,
            teamId: null,
            scheduleId: SCHEDULE_NOBODY,
            awayUntil: null,
          },
        ],
        hadScheduleGap: true,
      });
    });

    test("a team with no members: a line that names the team", async () => {
      const outcome: OnCallPagingOutcome = await page({
        teamIds: [TEAM_EMPTY],
      });

      expect(paged()).toEqual([]);
      expect(lines()).toEqual([
        {
          status: OnCallDutyExecutionLogTimelineStatus.Skipped,
          statusMessage: ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE,
          user: undefined,
          coveringFor: undefined,
          team: TEAM_EMPTY.toString(),
          schedule: undefined,
        },
      ]);
      expect(outcome.notPaged).toEqual([
        {
          reason: OnCallNotPagedReason.EmptyTeam,
          userId: null,
          teamId: TEAM_EMPTY,
          scheduleId: null,
          awayUntil: null,
        },
      ]);
    });

    test("one target that reaches nobody does not stop the others", async () => {
      const outcome: OnCallPagingOutcome = await page({
        userIds: [KIM],
        teamIds: [TEAM_EMPTY, TEAM_PLATFORM],
        onCallScheduleIds: [SCHEDULE_NOBODY, SCHEDULE_PRIMARY],
      });

      expect(paged()).toEqual([JANE, JOHN, KIM, SAM].map(String));
      expect(
        outcome.notPaged.map((entry: { reason: OnCallNotPagedReason }) => {
          return entry.reason;
        }),
      ).toEqual([
        OnCallNotPagedReason.EmptyTeam,
        OnCallNotPagedReason.NobodyOnCall,
      ]);
      expect(outcome.hadScheduleGap).toBe(true);
    });

    test("nothing to say at all: the timeline still says the page reached nobody", async () => {
      // No target left to page, and so no line that says why.
      const outcome: OnCallPagingOutcome = await page({});

      expect(outcome).toEqual({
        paged: [],
        notPaged: [],
        hadScheduleGap: false,
      });
      expect(lines()).toEqual([
        {
          status: OnCallDutyExecutionLogTimelineStatus.Skipped,
          statusMessage: ON_CALL_DIRECT_PAGE_NOBODY_TO_PAGE_TIMELINE_MESSAGE,
          user: undefined,
          coveringFor: undefined,
          team: undefined,
          schedule: undefined,
        },
      ]);
      expect(timeline[0]!.onCallDutyPolicyId).toBeUndefined();
      expect(timeline[0]!.onCallDutyPolicyEscalationRuleId).toBeUndefined();
    });

    test("a page with lines that say why writes no second, vaguer one", async () => {
      await page({ onCallScheduleIds: [SCHEDULE_NOBODY] });

      expect(
        lines().filter((line: TimelineLine): boolean => {
          return (
            line.statusMessage ===
            ON_CALL_DIRECT_PAGE_NOBODY_TO_PAGE_TIMELINE_MESSAGE
          );
        }),
      ).toEqual([]);
    });
  });

  describe("what a page is about must be named", () => {
    test("a page about an incident names the incident", async () => {
      await expect(
        OnCallDutyPolicyEscalationRuleService.startDirectPage({
          projectId: PROJECT_ID,
          userNotificationEventType: UserNotificationEventType.IncidentCreated,
          onCallPolicyExecutionLogId: RUN_ID,
          targets: targets({ userIds: [JANE] }),
        }),
      ).rejects.toThrow(
        new BadDataException(
          "triggeredByIncidentId is required when userNotificationEventType is IncidentCreated",
        ),
      );

      expect(paged()).toEqual([]);
      expect(timeline).toEqual([]);
      expect(runUpdates).toEqual([]);
    });

    test("a page about an alert names the alert", async () => {
      await expect(
        OnCallDutyPolicyEscalationRuleService.startDirectPage({
          projectId: PROJECT_ID,
          triggeredByIncidentId: INCIDENT_ID,
          userNotificationEventType: UserNotificationEventType.AlertCreated,
          onCallPolicyExecutionLogId: RUN_ID,
          targets: targets({ userIds: [JANE] }),
        }),
      ).rejects.toThrow(
        "triggeredByAlertId is required when userNotificationEventType is AlertCreated",
      );

      expect(paged()).toEqual([]);
    });
  });
});

describe("the user override that decides for a person, with and without a policy", () => {
  const POLICY_ID: ObjectID = new ObjectID(
    "dddddddd-0000-4000-8000-000000000001",
  );
  const OTHER_POLICY_ID: ObjectID = new ObjectID(
    "dddddddd-0000-4000-8000-000000000002",
  );
  const NOW: Date = new Date("2026-10-13T12:00:00.000Z");

  let overrides: Array<OnCallDutyPolicyUserOverride>;
  let read: SpyInstance<typeof OnCallDutyPolicyUserOverrideService.findBy>;

  function override(data: {
    policyId?: ObjectID | undefined;
    coverUserId?: ObjectID | undefined;
    endsAt?: string | undefined;
  }): OnCallDutyPolicyUserOverride {
    const row: OnCallDutyPolicyUserOverride =
      new OnCallDutyPolicyUserOverride();

    row.overrideUserId = ALEX;
    row.startsAt = new Date("2026-10-10T00:00:00.000Z");
    row.endsAt = new Date(data.endsAt || "2026-10-17T09:00:00.000Z");

    if (data.policyId) {
      row.onCallDutyPolicyId = data.policyId;
    }

    if (data.coverUserId) {
      row.routeAlertsToUserId = data.coverUserId;
    }

    return row;
  }

  beforeEach(() => {
    overrides = [];

    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    read = jest
      .spyOn(OnCallDutyPolicyUserOverrideService, "findBy")
      .mockImplementation((async () => {
        return overrides;
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("without a policy, only overrides that name no policy are read", async () => {
    await OnCallDutyPolicyEscalationRuleService.getAwayOverride({
      userId: ALEX,
      projectId: PROJECT_ID,
      at: NOW,
    });

    const query: Record<string, unknown> = read.mock.calls[0]![0]
      .query as Record<string, unknown>;

    expect(query["overrideUserId"]).toBe(ALEX);
    expect(query["projectId"]).toBe(PROJECT_ID);

    // "IS NULL", not "= x OR IS NULL": no policy's own override can match.
    const sql: string = (
      query["onCallDutyPolicyId"] as { getSql: (alias: string) => string }
    ).getSql("policy");

    expect(sql).toBe("(policy IS NULL)");
  });

  test("with a policy, that policy's own overrides and the global ones are read, as before", async () => {
    await OnCallDutyPolicyEscalationRuleService.getAwayOverride({
      userId: ALEX,
      onCallDutyPolicyId: POLICY_ID,
      projectId: PROJECT_ID,
      at: NOW,
    });

    const query: Record<string, unknown> = read.mock.calls[0]![0]
      .query as Record<string, unknown>;

    const sql: string = (
      query["onCallDutyPolicyId"] as { getSql: (alias: string) => string }
    ).getSql("policy");

    expect(sql).toContain("policy IS NULL");
    expect(sql).toContain("policy =");
  });

  test("without a policy, a global skip decides", async () => {
    overrides = [override({})];

    expect(
      await OnCallDutyPolicyEscalationRuleService.getAwayOverride({
        userId: ALEX,
        projectId: PROJECT_ID,
        at: NOW,
      }),
    ).toEqual({ coverUserId: null, endsAt: AWAY_UNTIL });
  });

  test("without a policy, a global cover decides, and beats a global skip", async () => {
    overrides = [override({}), override({ coverUserId: KIM })];

    expect(
      await OnCallDutyPolicyEscalationRuleService.getAwayOverride({
        userId: ALEX,
        projectId: PROJECT_ID,
        at: NOW,
      }),
    ).toEqual({ coverUserId: KIM, endsAt: AWAY_UNTIL });
  });

  test("without a policy, a policy's own override never applies - even if the read handed one back", async () => {
    overrides = [override({ policyId: OTHER_POLICY_ID, coverUserId: KIM })];

    expect(
      await OnCallDutyPolicyEscalationRuleService.getAwayOverride({
        userId: ALEX,
        projectId: PROJECT_ID,
        at: NOW,
      }),
    ).toBeNull();
  });

  test("nobody away: nothing decides", async () => {
    expect(
      await OnCallDutyPolicyEscalationRuleService.getAwayOverride({
        userId: ALEX,
        projectId: PROJECT_ID,
        at: NOW,
      }),
    ).toBeNull();
  });
});

/*
 * An escalation rule pages as it did, with what a level with nobody to page
 * now does (OnCallEmptyLevel): its teams with nobody in them say so, as a
 * direct page's do, and it is passed at once rather than tried again.
 */
describe("an escalation rule still pages exactly as it did", () => {
  const POLICY_ID: ObjectID = new ObjectID(
    "dddddddd-0000-4000-8000-000000000001",
  );
  const RULE_ID: ObjectID = new ObjectID(
    "eeeeeeee-0000-4000-8000-000000000001",
  );

  let timeline: Array<OnCallDutyPolicyExecutionLogTimeline>;
  let pages: Array<Page>;
  let runUpdates: Array<Record<string, unknown>>;
  let usersByTeam: Map<string, Array<ObjectID>>;

  async function runRule(): Promise<void> {
    await OnCallDutyPolicyEscalationRuleService.startRuleExecution(RULE_ID, {
      projectId: PROJECT_ID,
      triggeredByIncidentId: INCIDENT_ID,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
      onCallPolicyExecutionLogId: RUN_ID,
      onCallPolicyId: POLICY_ID,
    });
  }

  beforeEach(() => {
    timeline = [];
    pages = [];
    runUpdates = [];
    usersByTeam = new Map<string, Array<ObjectID>>([
      [TEAM_PLATFORM.toString(), [JANE]],
      [TEAM_EMPTY.toString(), []],
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
        order: 2,
        escalateAfterInMinutes: 10,
      } as unknown as OnCallDutyPolicyEscalationRule);
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "updateOneById")
      .mockImplementation((async (update: {
        data: Record<string, unknown>;
      }) => {
        runUpdates.push(update.data);
      }) as never);
    // Whether each page of the level went out, read back from the timeline.
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
      .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "findBy")
      .mockResolvedValue([
        { teamId: TEAM_EMPTY },
        { teamId: TEAM_PLATFORM },
      ] as never);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findBy")
      .mockResolvedValue([{ userId: KIM }] as never);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
      .mockResolvedValue([
        { onCallDutyPolicyScheduleId: SCHEDULE_PRIMARY },
      ] as never);
    jest.spyOn(TeamMemberService, "getUsersInTeams").mockImplementation((async (
      teamIds: Array<ObjectID>,
    ) => {
      return (usersByTeam.get(teamIds[0]!.toString()) || []).map(user);
    }) as never);
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "getCurrentOnCallInSchedule")
      .mockResolvedValue({ userId: SAM, coveredUserId: null });
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "getAwayOverride")
      .mockResolvedValue(null);
    jest
      .spyOn(ProjectMembership, "getMemberUserIds")
      .mockImplementation(
        async (data: {
          projectId: ObjectID;
          userIds: Array<ObjectID | string>;
        }): Promise<Set<string>> => {
          return new Set<string>(data.userIds.map(String));
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
      .mockImplementation((async (
        userId: ObjectID,
        options: Record<string, unknown>,
      ) => {
        pages.push({ userId: userId.toString(), options: options });
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("its lines and its pages name the policy and the rule", async () => {
    await runRule();

    expect(
      pages.map((entry: Page): string => {
        return entry.userId;
      }),
    ).toEqual([JANE, KIM, SAM].map(String));

    for (const row of timeline) {
      expect(row.onCallDutyPolicyId).toBe(POLICY_ID);
      expect(row.onCallDutyPolicyEscalationRuleId).toBe(RULE_ID);
    }

    for (const entry of pages) {
      expect(entry.options["onCallPolicyId"]).toBe(POLICY_ID);
      expect(entry.options["onCallPolicyEscalationRuleId"]).toBe(RULE_ID);
    }
  });

  test("a team of its with nobody in it says so, as a direct page's does - and nobody is paged through it", async () => {
    await runRule();

    const teamLines: Array<OnCallDutyPolicyExecutionLogTimeline> =
      timeline.filter((row: OnCallDutyPolicyExecutionLogTimeline): boolean => {
        return (
          row.statusMessage === ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE
        );
      });

    expect(teamLines).toHaveLength(1);
    expect(teamLines[0]!.userBelongsToTeamId).toBe(TEAM_EMPTY);
    expect(teamLines[0]!.status).toBe(
      OnCallDutyExecutionLogTimelineStatus.Skipped,
    );
    expect(teamLines[0]!.alertSentToUserId).toBeUndefined();
    expect(teamLines[0]!.onCallDutyPolicyEscalationRuleId).toBe(RULE_ID);
    // The empty team, Jane, Kim and Sam: the others were paged.
    expect(timeline).toHaveLength(4);
  });

  test("the policy's own overrides are asked about, and its schedules read for the policy", async () => {
    await runRule();

    expect(
      OnCallDutyPolicyEscalationRuleService.getAwayOverride,
    ).toHaveBeenCalledWith({
      userId: JANE,
      onCallDutyPolicyId: POLICY_ID,
      projectId: PROJECT_ID,
    });
    expect(
      OnCallDutyPolicyScheduleService.getCurrentOnCallInSchedule,
    ).toHaveBeenCalledWith(SCHEDULE_PRIMARY, { onCallDutyPolicyId: POLICY_ID });
  });

  test("the run records the rule it is on before anybody is paged - and that is all it writes of the run", async () => {
    await runRule();

    expect(runUpdates).toEqual([
      {
        lastEscalationRuleExecutedAt: expect.any(Date),
        lastExecutedEscalationRuleId: RULE_ID,
        lastExecutedEscalationRuleOrder: 2,
        executeNextEscalationRuleInMinutes: 10,
      },
    ]);
  });

  test("a rule that reaches nobody says so in its own words, and is passed at once - a schedule gap is not tried again", async () => {
    usersByTeam.set(TEAM_PLATFORM.toString(), []);
    (
      OnCallDutyPolicyEscalationRuleUserService.findBy as unknown as {
        mockResolvedValue: (value: unknown) => void;
      }
    ).mockResolvedValue([]);
    (
      OnCallDutyPolicyScheduleService.getCurrentOnCallInSchedule as unknown as {
        mockResolvedValue: (value: unknown) => void;
      }
    ).mockResolvedValue(null);

    const outcome: OnCallRuleExecutionOutcome =
      await OnCallDutyPolicyEscalationRuleService.startRuleExecution(RULE_ID, {
        projectId: PROJECT_ID,
        triggeredByIncidentId: INCIDENT_ID,
        userNotificationEventType: UserNotificationEventType.IncidentCreated,
        onCallPolicyExecutionLogId: RUN_ID,
        onCallPolicyId: POLICY_ID,
      });

    expect(
      timeline.map((row: OnCallDutyPolicyExecutionLogTimeline) => {
        return row.statusMessage;
      }),
    ).toEqual([
      ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE,
      ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE,
      "Skipped because no active users are found in this schedule.",
      ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE,
    ]);
    expect(outcome.movesOnAtOnce).toBe(true);
    expect(outcome.hadScheduleGap).toBe(true);
    // Nothing rewinds the run to try the rule again.
    expect(runUpdates).toHaveLength(1);
    expect(runUpdates[0]).toMatchObject({
      lastExecutedEscalationRuleOrder: 2,
    });
  });
});
