import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService, {
  NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
  OnCallRuleExecutionOutcome,
} from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyScheduleService, {
  NextInRotationInSchedule,
  ResolvedShiftSegments,
} from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyTimeLogService from "../../../Server/Services/OnCallDutyPolicyTimeLogService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import OnCallDutyPolicyUserOverrideService from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import logger from "../../../Server/Utils/Logger";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import WorkspaceUserGroupSync from "../../../Server/Utils/Workspace/UserGroups/WorkspaceUserGroupSync";
import URL from "../../../Types/API/URL";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getAwayTimelineMessage } from "../../../Types/OnCallDutyPolicy/AwayTimelineMessage";
import { ALREADY_PAGED_TIMELINE_MESSAGE } from "../../../Types/OnCallDutyPolicy/AlreadyPagedTimelineMessage";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import {
  NEXT_IN_ROTATION_SCHEDULES_KEY,
  NOBODY_NEXT_IN_ROTATION_TIMELINE_MESSAGE,
  readNextInRotationScheduleIds,
} from "../../../Types/OnCallDutyPolicy/NextInRotation";
import { ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE } from "../../../Types/OnCallDutyPolicy/OnCallEmptyLevel";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
import { at } from "../../Types/OnCallDutyPolicy/CalendarFeedTestFixtures";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  FakeDb,
  FakeRow,
  emptyDb,
  installFakeDb,
  makeAttachment,
  makeLayer,
  makeLayerUser,
  makeOverride,
  makeSchedule,
  makeUser,
  matchesQuery,
  oid,
} from "../Utils/OnCall/OnCallResolverTestHarness";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ESCALATE TO THE NEXT PERSON IN THE SAME ROTATION - ON THE SERVER.
 *
 * A customer asked for an escalation path that pages the primary on-call
 * person, then - if they do not acknowledge - the backup, the next person
 * in the SAME rotation, then the wider team. An escalation rule's schedule
 * can now page the next person in its rotation (pageNextInRotation).
 *
 * These run the real services against tables held in memory
 * (OnCallResolverTestHarness): who is next in a schedule
 * (getNextInRotationInSchedule), what an escalation rule that pages them
 * does and writes to the run's timeline (startRuleExecution), a run climbing
 * the ladder level by level, a rule created with the backup in its misc
 * data, and the places that must not treat a "next in rotation" row as a
 * rule the on-call person is on call for: hand-off messages, time logs,
 * "my on-call policies", the roster's policy context and the calendar feeds.
 *
 * The schedule, Payments primary: Alex, Sam and Kim take turns of a day,
 * handing over at 09:00 UTC from Tuesday 3 March 2026 - Alex on Tuesday,
 * Sam on Wednesday, Kim on Thursday, Alex again on Friday. It is noon on
 * Tuesday. Ria is not in the rotation; she is on the Platform team.
 */

const PROJECT: string = "0e400000-0000-4000-8000-000000000001";
const POLICY: string = "0e400000-0000-4000-8000-000000000002";
const OTHER_POLICY: string = "0e400000-0000-4000-8000-000000000003";
const SCHEDULE: string = "0e400000-0000-4000-8000-000000000004";
const LAYER: string = "0e400000-0000-4000-8000-000000000005";
const EXECUTION_LOG: string = "0e400000-0000-4000-8000-000000000007";
const INCIDENT: string = "0e400000-0000-4000-8000-000000000008";
const TEAM: string = "0e400000-0000-4000-8000-000000000009";

// The ladder: the schedule's on-call person, the next in its rotation, the team.
const LEVEL_1: string = "0e400000-0000-4000-8000-000000000011";
const LEVEL_2: string = "0e400000-0000-4000-8000-000000000012";
const LEVEL_3: string = "0e400000-0000-4000-8000-000000000013";

const ALEX: string = "0e400000-0000-4000-8000-0000000000a1";
const SAM: string = "0e400000-0000-4000-8000-0000000000b1";
const KIM: string = "0e400000-0000-4000-8000-0000000000c1";
const RIA: string = "0e400000-0000-4000-8000-0000000000d1";

const NOW: Date = at("2026-03-03T12:00:00Z");
const BACK_ON_FRIDAY: Date = at("2026-03-06T12:00:00Z");

const NAMES: Record<string, string> = {
  [ALEX]: "Alex Kim",
  [SAM]: "Sam Lee",
  [KIM]: "Kim Ito",
  [RIA]: "Ria Das",
};

let db: FakeDb;
let overrideCount: number;
// What the server logged at debug level, in order.
let debugLines: Array<string>;
// How many times somebody's time away was read.
let overrideReads: number;

function setNow(now: Date): void {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(now);
}

// Somebody is away now, until Friday: skipped, or covered by `cover`.
function awayUntilFriday(data: {
  who: string;
  cover?: string | undefined;
  policy?: string | undefined;
  from?: Date | undefined;
  until?: Date | undefined;
}): void {
  overrideCount++;
  db.overrides.push(
    makeOverride({
      id: `0e400000-0000-4000-8000-${String(900 + overrideCount).padStart(12, "0")}`,
      projectId: PROJECT,
      overrideUserId: data.who,
      routeAlertsToUserId: data.cover || null,
      startsAt: data.from || at("2026-03-03T00:00:00Z"),
      endsAt: data.until || BACK_ON_FRIDAY,
      policyId: data.policy,
    }),
  );
}

// A rule's schedule row: whoever is on call, or the next in the rotation.
function attach(data: {
  id: string;
  ruleId: string;
  ruleName?: string | undefined;
  ruleOrder?: number | undefined;
  policyId?: string | undefined;
  pageNextInRotation: boolean;
}): FakeRow {
  const row: FakeRow = {
    ...makeAttachment({
      id: data.id,
      scheduleId: SCHEDULE,
      projectId: PROJECT,
      policyId: data.policyId || POLICY,
      policyName: "Payments",
      ruleId: data.ruleId,
      ruleName: data.ruleName,
      ruleOrder: data.ruleOrder,
    }),
    pageNextInRotation: data.pageNextInRotation,
  };

  db.attachments.push(row);

  return row;
}

async function nextInSchedule(
  options: { policy?: string | null | undefined; at?: Date | undefined } = {},
): Promise<{
  onCall: string;
  next: string | null;
  layer: string | null;
} | null> {
  const next: NextInRotationInSchedule | null =
    await OnCallDutyPolicyScheduleService.getNextInRotationInSchedule(
      oid(SCHEDULE),
      {
        onCallDutyPolicyId:
          options.policy === null ? undefined : oid(options.policy || POLICY),
        at: options.at,
      },
    );

  return next
    ? {
        onCall: next.onCallUserId.toString(),
        next: next.nextUserId?.toString() || null,
        layer: next.layerName,
      }
    : null;
}

beforeEach(() => {
  stubProjectDirectory({});

  db = emptyDb();
  overrideCount = 0;

  db.schedules.push(
    makeSchedule({
      id: SCHEDULE,
      projectId: PROJECT,
      name: "Payments primary",
      timezone: "UTC",
    }),
  );
  db.layers.push(
    makeLayer({
      id: LAYER,
      scheduleId: SCHEDULE,
      projectId: PROJECT,
      name: "Weekdays",
      startsAt: at("2026-03-03T09:00:00Z"),
      handOffTime: at("2026-03-03T09:00:00Z"),
    }),
  );

  for (const [index, userId] of [ALEX, SAM, KIM].entries()) {
    db.layerUsers.push(
      makeLayerUser({
        id: `0e400000-0000-4000-8000-00000000010${index}`,
        scheduleId: SCHEDULE,
        layerId: LAYER,
        projectId: PROJECT,
        userId,
        order: index + 1,
      }),
    );
  }

  for (const userId of [ALEX, SAM, KIM, RIA]) {
    db.users.push(
      makeUser({ id: userId, name: NAMES[userId], timezone: "UTC" }),
    );
  }

  installFakeDb(db);
  setNow(NOW);

  // The in-memory table's answer, counted.
  overrideReads = 0;
  jest
    .spyOn(OnCallDutyPolicyUserOverrideService, "findBy")
    .mockImplementation((async (args: {
      query?: Record<string, unknown> | undefined;
    }) => {
      overrideReads++;
      return db.overrides.filter((row: FakeRow): boolean => {
        return matchesQuery(args.query, row);
      });
    }) as never);

  debugLines = [];
  jest.spyOn(logger, "debug").mockImplementation(((message: unknown) => {
    debugLines.push(String(message));
  }) as never);

  for (const level of ["info", "warn"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined as never;
    });
  }

  // Slack user groups and Teams tags that follow a schedule: not here.
  jest
    .spyOn(WorkspaceUserGroupSync, "requestSyncForSchedules")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who is next in the schedule's rotation", () => {
  test("on Alex's day, Sam is next - from the Weekdays layer", async () => {
    expect(await nextInSchedule()).toEqual({
      onCall: ALEX,
      next: SAM,
      layer: "Weekdays",
    });
  });

  test("each day it is the person after whoever is on call, wrapping round to the start", async () => {
    expect(
      (await nextInSchedule({ at: at("2026-03-04T12:00:00Z") }))?.next,
    ).toBe(KIM);
    expect(
      (await nextInSchedule({ at: at("2026-03-05T12:00:00Z") }))?.next,
    ).toBe(ALEX);
    expect(
      (await nextInSchedule({ at: at("2026-03-06T12:00:00Z") }))?.next,
    ).toBe(SAM);
  });

  test("Sam away with nobody named to cover: Sam is passed over, and Kim is next", async () => {
    awayUntilFriday({ who: SAM });

    expect((await nextInSchedule())?.next).toBe(KIM);
  });

  test("Sam away with Ria named to cover: Sam is still passed over - the backup comes from the rotation", async () => {
    awayUntilFriday({ who: SAM, cover: RIA });

    expect(await nextInSchedule()).toEqual({
      onCall: ALEX,
      next: KIM,
      layer: "Weekdays",
    });
  });

  test("a policy's own time away counts only when the schedule is paged through that policy", async () => {
    awayUntilFriday({ who: SAM, policy: POLICY });

    expect((await nextInSchedule({ policy: POLICY }))?.next).toBe(KIM);
    expect((await nextInSchedule({ policy: OTHER_POLICY }))?.next).toBe(SAM);
    expect((await nextInSchedule({ policy: null }))?.next).toBe(SAM);
  });

  test("Alex away: Sam has Alex's turn and is on call, so Kim is next", async () => {
    awayUntilFriday({ who: ALEX });

    expect(await nextInSchedule()).toEqual({
      onCall: SAM,
      next: KIM,
      layer: "Weekdays",
    });
  });

  test("everybody else away: Alex is on call, and nobody is next", async () => {
    awayUntilFriday({ who: SAM });
    awayUntilFriday({ who: KIM });

    expect(await nextInSchedule()).toEqual({
      onCall: ALEX,
      next: null,
      layer: "Weekdays",
    });
  });

  test("everybody away: nobody is on call, so the answer is nobody at all", async () => {
    for (const who of [ALEX, SAM, KIM]) {
      awayUntilFriday({ who });
    }

    expect(await nextInSchedule()).toBeNull();
  });

  test("before the rotation starts: nobody", async () => {
    expect(await nextInSchedule({ at: at("2026-03-02T12:00:00Z") })).toBeNull();
  });

  test("a schedule with no layers: nobody, and nobody's time away is read", async () => {
    db.layers.length = 0;
    db.layerUsers.length = 0;

    expect(await nextInSchedule()).toBeNull();
    expect(overrideReads).toBe(0);
  });

  test("somebody on call: everybody's time away is read once, for the moment asked about", async () => {
    await nextInSchedule();

    expect(overrideReads).toBe(1);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The escalation run
 * ---------------------------------------------------------------------------
 */

interface Page {
  userId: string;
  ruleId: string | null;
  scheduleId: string | null;
  overridedByUserId: string | null;
}

let timeline: Array<OnCallDutyPolicyExecutionLogTimeline>;
let paged: Array<Page>;
let runUpdates: Array<JSONObject>;
let members: Set<string>;
let ruleUsers: Record<string, Array<string>>;
let ruleTeams: Record<string, Array<string>>;
let teamMembers: Record<string, Array<string>>;

const RULE_ORDERS: Record<string, number> = {
  [LEVEL_1]: 1,
  [LEVEL_2]: 2,
  [LEVEL_3]: 3,
};

function installRun(): void {
  timeline = [];
  paged = [];
  runUpdates = [];
  members = new Set<string>([ALEX, SAM, KIM, RIA]);
  ruleUsers = {};
  ruleTeams = {};
  teamMembers = { [TEAM]: [ALEX, SAM, KIM, RIA] };

  jest
    .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneById")
    .mockImplementation((async (data: { id: ObjectID }) => {
      const ruleId: string = data.id.toString();

      return {
        _id: ruleId,
        id: oid(ruleId),
        order: RULE_ORDERS[ruleId] || 1,
        escalateAfterInMinutes: 30,
      } as unknown as OnCallDutyPolicyEscalationRule;
    }) as never);

  jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "updateOneById")
    .mockImplementation((async (data: { data: JSONObject }) => {
      runUpdates.push({ ...data.data });
      return undefined;
    }) as never);
  /*
   * Whether each page of a level went out, read back from the run's
   * timeline once the level has paged.
   */
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

      return timeline.filter((row: OnCallDutyPolicyExecutionLogTimeline) => {
        return ids.includes(row.id?.toString() || "");
      });
    }) as never);

  jest
    .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "create")
    .mockImplementation((async (data: {
      data: OnCallDutyPolicyExecutionLogTimeline;
    }) => {
      timeline.push(data.data);
      data.data.id = oid(
        `0e400000-0000-4000-8000-${String(500 + timeline.length).padStart(12, "0")}`,
      );
      return data.data;
    }) as never);

  jest
    .spyOn(UserNotificationRuleService, "startUserNotificationRulesExecution")
    .mockImplementation((async (
      userId: ObjectID,
      options: {
        onCallPolicyEscalationRuleId?: ObjectID | undefined;
        onCallScheduleId?: ObjectID | undefined;
        overridedByUserId?: ObjectID | undefined;
      },
    ) => {
      paged.push({
        userId: userId.toString(),
        ruleId: options.onCallPolicyEscalationRuleId?.toString() || null,
        scheduleId: options.onCallScheduleId?.toString() || null,
        overridedByUserId: options.overridedByUserId?.toString() || null,
      });
    }) as never);

  jest
    .spyOn(ProjectMembership, "getMemberUserIds")
    .mockImplementation(async () => {
      return new Set<string>(members);
    });

  jest
    .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findBy")
    .mockImplementation((async (data: { query: JSONObject }) => {
      const ruleId: string = String(
        data.query["onCallDutyPolicyEscalationRuleId"],
      );

      return (ruleUsers[ruleId] || []).map((userId: string) => {
        return { userId: oid(userId) };
      });
    }) as never);

  jest
    .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "findBy")
    .mockImplementation((async (data: { query: JSONObject }) => {
      const ruleId: string = String(
        data.query["onCallDutyPolicyEscalationRuleId"],
      );

      return (ruleTeams[ruleId] || []).map((teamId: string) => {
        return { teamId: oid(teamId) };
      });
    }) as never);

  jest.spyOn(TeamMemberService, "getUsersInTeams").mockImplementation((async (
    teamIds: Array<ObjectID>,
  ) => {
    return (teamMembers[teamIds[0]?.toString() || ""] || []).map(
      (userId: string) => {
        return { id: oid(userId) };
      },
    );
  }) as never);
}

async function runLevel(
  ruleId: string,
  policy: string = POLICY,
): Promise<OnCallRuleExecutionOutcome> {
  return await OnCallDutyPolicyEscalationRuleService.startRuleExecution(
    oid(ruleId),
    {
      projectId: oid(PROJECT),
      triggeredByIncidentId: oid(INCIDENT),
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
      onCallPolicyExecutionLogId: oid(EXECUTION_LOG),
      onCallPolicyId: oid(policy),
    },
  );
}

// The rows of the run's timeline a rule wrote, readable.
function steps(ruleId?: string): Array<{
  status: string;
  userId: string | null;
  scheduleId: string | null;
  isNextInRotation: boolean;
  overridedByUserId: string | null;
  message: string;
}> {
  return timeline
    .filter((row: OnCallDutyPolicyExecutionLogTimeline) => {
      return (
        !ruleId || row.onCallDutyPolicyEscalationRuleId?.toString() === ruleId
      );
    })
    .map((row: OnCallDutyPolicyExecutionLogTimeline) => {
      return {
        status: String(row.status),
        userId: row.alertSentToUserId?.toString() || null,
        scheduleId: row.onCallDutyScheduleId?.toString() || null,
        isNextInRotation: Boolean(row.isNextInRotation),
        overridedByUserId: row.overridedByUserId?.toString() || null,
        message: row.statusMessage || "",
      };
    });
}

function pagedUserIds(ruleId?: string): Array<string> {
  return paged
    .filter((page: Page) => {
      return !ruleId || page.ruleId === ruleId;
    })
    .map((page: Page) => {
      return page.userId;
    });
}

describe("an escalation rule that pages the next person in the rotation", () => {
  beforeEach(() => {
    installRun();
  });

  test("pages Sam, and its step names the schedule and says he is next in its rotation", async () => {
    attach({
      id: "0e400000-0000-4000-8000-000000000301",
      ruleId: LEVEL_2,
      pageNextInRotation: true,
    });

    await runLevel(LEVEL_2);

    expect(paged).toEqual([
      {
        userId: SAM,
        ruleId: LEVEL_2,
        scheduleId: SCHEDULE,
        overridedByUserId: null,
      },
    ]);

    expect(steps()).toEqual([
      {
        status: OnCallDutyExecutionLogTimelineStatus.Executing,
        userId: SAM,
        scheduleId: SCHEDULE,
        isNextInRotation: true,
        overridedByUserId: null,
        message: "Sending notification to user.",
      },
    ]);
  });

  test("the same schedule paged both ways on one rule: Alex as on call, then Sam as next", async () => {
    attach({
      id: "0e400000-0000-4000-8000-000000000302",
      ruleId: LEVEL_1,
      pageNextInRotation: false,
    });
    attach({
      id: "0e400000-0000-4000-8000-000000000303",
      ruleId: LEVEL_1,
      pageNextInRotation: true,
    });

    await runLevel(LEVEL_1);

    expect(pagedUserIds()).toEqual([ALEX, SAM]);
    expect(
      steps().map(
        (step: { userId: string | null; isNextInRotation: boolean }) => {
          return [step.userId, step.isNextInRotation];
        },
      ),
    ).toEqual([
      [ALEX, false],
      [SAM, true],
    ]);
  });

  test("Alex away: Sam is on call in Alex's place, and Kim is the next person", async () => {
    awayUntilFriday({ who: ALEX });
    attach({
      id: "0e400000-0000-4000-8000-000000000304",
      ruleId: LEVEL_1,
      pageNextInRotation: false,
    });
    attach({
      id: "0e400000-0000-4000-8000-000000000305",
      ruleId: LEVEL_1,
      pageNextInRotation: true,
    });

    await runLevel(LEVEL_1);

    expect(paged).toEqual([
      {
        userId: SAM,
        ruleId: LEVEL_1,
        scheduleId: SCHEDULE,
        overridedByUserId: ALEX,
      },
      {
        userId: KIM,
        ruleId: LEVEL_1,
        scheduleId: SCHEDULE,
        overridedByUserId: null,
      },
    ]);
  });

  test("nobody next (everybody else away): nobody is paged there, the line says why, and the run moves on at once", async () => {
    awayUntilFriday({ who: SAM });
    awayUntilFriday({ who: KIM });
    attach({
      id: "0e400000-0000-4000-8000-000000000306",
      ruleId: LEVEL_2,
      pageNextInRotation: true,
    });

    const outcome: OnCallRuleExecutionOutcome = await runLevel(LEVEL_2);

    expect(paged).toEqual([]);
    expect(steps()).toEqual([
      {
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        userId: null,
        scheduleId: SCHEDULE,
        isNextInRotation: true,
        overridedByUserId: null,
        message: NOBODY_NEXT_IN_ROTATION_TIMELINE_MESSAGE,
      },
      {
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        userId: null,
        scheduleId: null,
        isNextInRotation: false,
        overridedByUserId: null,
        message: ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE,
      },
    ]);

    // Nobody to wait for: the run moves on now, not after the level's wait.
    expect(outcome.movesOnAtOnce).toBe(true);

    // The rule is recorded on the run, once; nothing rewinds it to try again.
    expect(runUpdates).toHaveLength(1);
    expect(runUpdates[0]).toMatchObject({
      lastExecutedEscalationRuleOrder: 2,
      executeNextEscalationRuleInMinutes: 30,
    });
    expect(runUpdates[0]).not.toHaveProperty("scheduleGapRetryCount");
  });

  test("nobody on call at all: the schedule's gap line, and the level is passed at once rather than tried again", async () => {
    for (const who of [ALEX, SAM, KIM]) {
      awayUntilFriday({ who });
    }
    attach({
      id: "0e400000-0000-4000-8000-000000000307",
      ruleId: LEVEL_2,
      pageNextInRotation: true,
    });

    const outcome: OnCallRuleExecutionOutcome = await runLevel(LEVEL_2);

    expect(paged).toEqual([]);
    expect(steps()).toEqual([
      {
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        userId: null,
        scheduleId: SCHEDULE,
        isNextInRotation: false,
        overridedByUserId: null,
        message: "Skipped because no active users are found in this schedule.",
      },
      {
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        userId: null,
        scheduleId: null,
        isNextInRotation: false,
        overridedByUserId: null,
        message: ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE,
      },
    ]);
    expect(outcome.movesOnAtOnce).toBe(true);
    expect(outcome.hadScheduleGap).toBe(true);

    // No rewind and no retry count: the gap does not hold the run.
    expect(runUpdates).toHaveLength(1);
    expect(runUpdates[0]).toMatchObject({
      lastExecutedEscalationRuleOrder: 2,
    });
    expect(runUpdates[0]).not.toHaveProperty("scheduleGapRetryCount");
  });

  test("the next person paged: the level holds the run for its wait, as every level that reached somebody does", async () => {
    attach({
      id: "0e400000-0000-4000-8000-000000000317",
      ruleId: LEVEL_2,
      pageNextInRotation: true,
    });

    const outcome: OnCallRuleExecutionOutcome = await runLevel(LEVEL_2);

    expect(pagedUserIds()).toEqual([SAM]);
    expect(outcome.movesOnAtOnce).toBe(false);
    expect(
      steps().filter((step: { message: string }): boolean => {
        return step.message === ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE;
      }),
    ).toEqual([]);
  });

  test("Sam named on the rule too: paged once, and the next-in-rotation line says he was paged already", async () => {
    ruleUsers[LEVEL_2] = [SAM];
    attach({
      id: "0e400000-0000-4000-8000-000000000308",
      ruleId: LEVEL_2,
      pageNextInRotation: true,
    });

    await runLevel(LEVEL_2);

    expect(pagedUserIds()).toEqual([SAM]);
    expect(steps()).toEqual([
      {
        status: OnCallDutyExecutionLogTimelineStatus.Executing,
        userId: SAM,
        scheduleId: null,
        isNextInRotation: false,
        overridedByUserId: null,
        message: "Sending notification to user.",
      },
      {
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        userId: SAM,
        scheduleId: SCHEDULE,
        isNextInRotation: true,
        overridedByUserId: null,
        message: ALREADY_PAGED_TIMELINE_MESSAGE,
      },
    ]);
  });

  test("Sam has left the project: he is not paged, the line says why, and nobody else stands in", async () => {
    members.delete(SAM);
    attach({
      id: "0e400000-0000-4000-8000-000000000309",
      ruleId: LEVEL_2,
      pageNextInRotation: true,
    });

    await runLevel(LEVEL_2);

    expect(paged).toEqual([]);
    expect(steps()[0]).toEqual({
      status: OnCallDutyExecutionLogTimelineStatus.Skipped,
      userId: SAM,
      scheduleId: SCHEDULE,
      isNextInRotation: true,
      overridedByUserId: null,
      message: NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
    });
  });

  test("another policy's own time away does not count: paged through this policy, Sam is next", async () => {
    awayUntilFriday({ who: SAM, policy: OTHER_POLICY });
    attach({
      id: "0e400000-0000-4000-8000-000000000310",
      ruleId: LEVEL_2,
      pageNextInRotation: true,
    });

    await runLevel(LEVEL_2);

    expect(pagedUserIds()).toEqual([SAM]);
  });

  test("this policy's own time away counts: Kim is next", async () => {
    awayUntilFriday({ who: SAM, policy: POLICY });
    attach({
      id: "0e400000-0000-4000-8000-000000000311",
      ruleId: LEVEL_2,
      pageNextInRotation: true,
    });

    await runLevel(LEVEL_2);

    expect(pagedUserIds()).toEqual([KIM]);
  });

  test("the server's log says who was paged and why: the next person, after whoever is on call", async () => {
    attach({
      id: "0e400000-0000-4000-8000-000000000312",
      ruleId: LEVEL_2,
      pageNextInRotation: true,
    });

    await runLevel(LEVEL_2);

    expect(debugLines).toContain(
      `Paging ${SAM} as the next person in the rotation of schedule ${SCHEDULE} (layer Weekdays), after ${ALEX}, who is on call.`,
    );
  });

  test("the server's log says why nobody was paged as next", async () => {
    awayUntilFriday({ who: SAM });
    awayUntilFriday({ who: KIM });
    attach({
      id: "0e400000-0000-4000-8000-000000000313",
      ruleId: LEVEL_2,
      pageNextInRotation: true,
    });

    await runLevel(LEVEL_2);

    expect(debugLines).toContain(
      `Nobody is next after ${ALEX} in the rotation of schedule ${SCHEDULE}: it has nobody else in it, or everybody else in it is away.`,
    );
  });
});

describe("a run that climbs the ladder: the on-call person, then the next person in the rotation, then the team", () => {
  beforeEach(() => {
    installRun();

    attach({
      id: "0e400000-0000-4000-8000-000000000401",
      ruleId: LEVEL_1,
      ruleOrder: 1,
      pageNextInRotation: false,
    });
    attach({
      id: "0e400000-0000-4000-8000-000000000402",
      ruleId: LEVEL_2,
      ruleOrder: 2,
      pageNextInRotation: true,
    });
    ruleTeams[LEVEL_3] = [TEAM];
  });

  test("Level 1 pages Alex, Level 2 Sam, Level 3 the whole team - in that order", async () => {
    await runLevel(LEVEL_1);
    await runLevel(LEVEL_2);
    await runLevel(LEVEL_3);

    expect([
      pagedUserIds(LEVEL_1),
      pagedUserIds(LEVEL_2),
      pagedUserIds(LEVEL_3),
    ]).toEqual([[ALEX], [SAM], [ALEX, SAM, KIM, RIA]]);

    // Only Level 2's page is the next person's.
    expect(
      timeline.map((row: OnCallDutyPolicyExecutionLogTimeline) => {
        return `${row.onCallDutyPolicyEscalationRuleId?.toString() === LEVEL_2 ? "L2" : row.onCallDutyPolicyEscalationRuleId?.toString() === LEVEL_1 ? "L1" : "L3"} ${NAMES[row.alertSentToUserId?.toString() || ""]}${row.isNextInRotation ? " (next in rotation)" : ""}`;
      }),
    ).toEqual([
      "L1 Alex Kim",
      "L2 Sam Lee (next in rotation)",
      "L3 Alex Kim",
      "L3 Sam Lee",
      "L3 Kim Ito",
      "L3 Ria Das",
    ]);
  });

  test("Sam away: Level 2 pages Kim, and the team pages everybody but Sam", async () => {
    awayUntilFriday({ who: SAM });

    await runLevel(LEVEL_1);
    await runLevel(LEVEL_2);
    await runLevel(LEVEL_3);

    expect([
      pagedUserIds(LEVEL_1),
      pagedUserIds(LEVEL_2),
      pagedUserIds(LEVEL_3),
    ]).toEqual([[ALEX], [KIM], [ALEX, KIM, RIA]]);

    expect(steps(LEVEL_3)).toContainEqual({
      status: OnCallDutyExecutionLogTimelineStatus.Skipped,
      userId: SAM,
      scheduleId: null,
      isNextInRotation: false,
      overridedByUserId: null,
      message: getAwayTimelineMessage(BACK_ON_FRIDAY),
    });
  });

  test("the hand-off comes between the levels: the next person is after whoever is on call when the level runs", async () => {
    await runLevel(LEVEL_1);

    // Wednesday, half an hour after Sam took over.
    setNow(at("2026-03-04T09:30:00Z"));
    await runLevel(LEVEL_2);

    expect([pagedUserIds(LEVEL_1), pagedUserIds(LEVEL_2)]).toEqual([
      [ALEX],
      [KIM],
    ]);
  });

  test("a one-person rotation has no backup: Level 2 says nobody was next, and Level 3's team is the next step", async () => {
    db.layerUsers.splice(1);

    await runLevel(LEVEL_1);
    await runLevel(LEVEL_2);
    await runLevel(LEVEL_3);

    expect([
      pagedUserIds(LEVEL_1),
      pagedUserIds(LEVEL_2),
      pagedUserIds(LEVEL_3),
    ]).toEqual([[ALEX], [], [ALEX, SAM, KIM, RIA]]);
    expect(steps(LEVEL_2)[0]!.message).toBe(
      NOBODY_NEXT_IN_ROTATION_TIMELINE_MESSAGE,
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Creating a rule that pages the next person in a rotation
 * ---------------------------------------------------------------------------
 */

type RuleHooks = {
  onBeforeCreate: (
    createBy: CreateBy<OnCallDutyPolicyEscalationRule>,
  ) => Promise<OnCreate<OnCallDutyPolicyEscalationRule>>;
  onCreateSuccess: (
    onCreate: OnCreate<OnCallDutyPolicyEscalationRule>,
    createdItem: OnCallDutyPolicyEscalationRule,
  ) => Promise<OnCallDutyPolicyEscalationRule>;
};

const ruleHooks: RuleHooks =
  OnCallDutyPolicyEscalationRuleService as unknown as RuleHooks;

function newRuleCreate(
  miscDataProps?: JSONObject,
): CreateBy<OnCallDutyPolicyEscalationRule> {
  const rule: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();
  rule.projectId = oid(PROJECT);
  rule.onCallDutyPolicyId = oid(POLICY);
  rule.escalateAfterInMinutes = 30;

  const createBy: CreateBy<OnCallDutyPolicyEscalationRule> = {
    data: rule,
    props: { isRoot: true },
  };

  if (miscDataProps) {
    createBy.miscDataProps = miscDataProps;
  }

  return createBy;
}

describe("a rule created with the next person in a rotation", () => {
  let counted: number;

  beforeEach(() => {
    counted = 0;

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "countBy")
      .mockImplementation((async () => {
        counted++;
        return new PositiveNumber(1);
      }) as never);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "updateOneBy")
      .mockResolvedValue(0 as never);
  });

  test.each([
    ["a string", "0e400000-0000-4000-8000-000000000004"],
    ["a number", 7],
    ["a list holding a number", [7]],
    ["a list holding something that is not an id", ["schedule-1"]],
    ["an object", { id: SCHEDULE }],
  ] as Array<[string, unknown]>)(
    "%s is refused before anything is counted or saved",
    async (_label: string, value: unknown) => {
      await expect(
        ruleHooks.onBeforeCreate(
          newRuleCreate({
            [NEXT_IN_ROTATION_SCHEDULES_KEY]: value as JSONObject,
          }),
        ),
      ).rejects.toThrow(BadDataException);

      expect(counted).toBe(0);
    },
  );

  test("a list of schedule ids passes, and the rule is named and ordered as any other", async () => {
    const result: OnCreate<OnCallDutyPolicyEscalationRule> =
      await ruleHooks.onBeforeCreate(
        newRuleCreate({ [NEXT_IN_ROTATION_SCHEDULES_KEY]: [SCHEDULE] }),
      );

    expect(result.createBy.data.order).toBe(2);
    expect(result.createBy.data.name).toBe("Level 2");
  });

  test("once created, each schedule picked as next in rotation is a row that pages the next person; on-call picks are rows as before", async () => {
    const created: Array<OnCallDutyPolicyEscalationRuleSchedule> = [];
    const createProps: Array<unknown> = [];

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "create")
      .mockImplementation((async (data: {
        data: OnCallDutyPolicyEscalationRuleSchedule;
        props: unknown;
      }) => {
        created.push(data.data);
        createProps.push(data.props);
        return data.data;
      }) as never);

    const OTHER_SCHEDULE: string = "0e400000-0000-4000-8000-0000000000e1";
    const createBy: CreateBy<OnCallDutyPolicyEscalationRule> = newRuleCreate({
      onCallSchedules: [OTHER_SCHEDULE],
      [NEXT_IN_ROTATION_SCHEDULES_KEY]: [SCHEDULE, SCHEDULE.toUpperCase()],
    });

    const rule: OnCallDutyPolicyEscalationRule = createBy.data;
    rule.id = oid(LEVEL_2);
    rule.order = 2;

    await ruleHooks.onCreateSuccess(
      { createBy: createBy, carryForward: null },
      rule,
    );

    expect(
      created.map((row: OnCallDutyPolicyEscalationRuleSchedule) => {
        return {
          schedule: row.onCallDutyPolicyScheduleId?.toString(),
          rule: row.onCallDutyPolicyEscalationRuleId?.toString(),
          policy: row.onCallDutyPolicyId?.toString(),
          next: Boolean(row.pageNextInRotation),
        };
      }),
    ).toEqual([
      { schedule: OTHER_SCHEDULE, rule: LEVEL_2, policy: POLICY, next: false },
      // Picked twice, in two spellings: one row.
      { schedule: SCHEDULE, rule: LEVEL_2, policy: POLICY, next: true },
    ]);

    // As the caller who created the rule.
    expect(createProps).toEqual([createBy.props, createBy.props]);
  });

  test("a rule created with only the next person in a rotation gets that one row", async () => {
    const created: Array<OnCallDutyPolicyEscalationRuleSchedule> = [];

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "create")
      .mockImplementation((async (data: {
        data: OnCallDutyPolicyEscalationRuleSchedule;
      }) => {
        created.push(data.data);
        return data.data;
      }) as never);

    const createBy: CreateBy<OnCallDutyPolicyEscalationRule> = newRuleCreate({
      [NEXT_IN_ROTATION_SCHEDULES_KEY]: [SCHEDULE],
    });
    createBy.data.id = oid(LEVEL_2);
    createBy.data.order = 2;

    await ruleHooks.onCreateSuccess(
      { createBy: createBy, carryForward: null },
      createBy.data,
    );

    expect(created).toHaveLength(1);
    expect(created[0]!.pageNextInRotation).toBe(true);
  });
});

describe("reading the schedules a create asks to page the next person of", () => {
  test("absent, null or empty: none", () => {
    expect(readNextInRotationScheduleIds(undefined)).toEqual([]);
    expect(readNextInRotationScheduleIds(null)).toEqual([]);
    expect(readNextInRotationScheduleIds({})).toEqual([]);
    expect(
      readNextInRotationScheduleIds({ [NEXT_IN_ROTATION_SCHEDULES_KEY]: null }),
    ).toEqual([]);
    expect(
      readNextInRotationScheduleIds({ [NEXT_IN_ROTATION_SCHEDULES_KEY]: [] }),
    ).toEqual([]);
  });

  test("ids as the dashboard, the API and the server send them, each once, lower-cased", () => {
    expect(
      readNextInRotationScheduleIds({
        [NEXT_IN_ROTATION_SCHEDULES_KEY]: [
          SCHEDULE.toUpperCase(),
          new ObjectID(SCHEDULE),
          { _type: "ObjectID", value: SCHEDULE },
          ` ${SCHEDULE} `,
        ],
      } as unknown as JSONObject),
    ).toEqual([SCHEDULE]);
  });

  test("anything else is refused, naming the key", () => {
    expect(() => {
      readNextInRotationScheduleIds({
        [NEXT_IN_ROTATION_SCHEDULES_KEY]: ["not-an-id"],
      });
    }).toThrow(
      `${NEXT_IN_ROTATION_SCHEDULES_KEY} must be a list of on-call schedule ids. "not-an-id" is not one.`,
    );
    expect(() => {
      readNextInRotationScheduleIds({
        [NEXT_IN_ROTATION_SCHEDULES_KEY]: SCHEDULE,
      });
    }).toThrow(
      `${NEXT_IN_ROTATION_SCHEDULES_KEY} must be a list of on-call schedule ids.`,
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * The on-call person is not on call for a rule that pages the next person
 * ---------------------------------------------------------------------------
 */

describe("a rule that pages the next person in the rotation does not put the on-call person on call for it", () => {
  test("a hand-off tells the people on call for the schedule's own rule - and nothing for the next-in-rotation rule", async () => {
    attach({
      id: "0e400000-0000-4000-8000-000000000501",
      ruleId: LEVEL_1,
      ruleName: "Level 1",
      pageNextInRotation: false,
    });
    attach({
      id: "0e400000-0000-4000-8000-000000000502",
      ruleId: LEVEL_2,
      ruleName: "Level 2",
      ruleOrder: 2,
      pageNextInRotation: true,
    });

    // The roster as it was yesterday: Kim on call.
    db.schedules[0]!["currentUserIdOnRoster"] = oid(KIM);
    db.schedules[0]!["rosterStartAt"] = at("2026-03-02T09:00:00Z");
    db.schedules[0]!["rosterHandoffAt"] = at("2026-03-03T09:00:00Z");

    jest.spyOn(Semaphore, "lock").mockRejectedValue(new Error("no lock here"));
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.example/policy"));
    jest.spyOn(UserService, "getTimezoneForUser").mockResolvedValue(null);
    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockImplementation((async (data: { userId: ObjectID }) => {
        return FeedMarkdown.asMarkdown(NAMES[data.userId.toString()] || "");
      }) as never);

    const feed: Array<string> = [];
    jest
      .spyOn(OnCallDutyPolicyFeedService, "createOnCallDutyPolicyFeedItem")
      .mockImplementation((async (data: { feedInfoInMarkdown: string }) => {
        feed.push(data.feedInfoInMarkdown);
      }) as never);

    const timeLogs: Array<{ kind: string; userId: string; ruleId: string }> =
      [];
    jest
      .spyOn(OnCallDutyPolicyTimeLogService, "startTimeLogForUser")
      .mockImplementation((async (data: {
        userId: ObjectID;
        onCallDutyPolicyEscalationRuleId: ObjectID;
      }) => {
        timeLogs.push({
          kind: "start",
          userId: data.userId.toString(),
          ruleId: data.onCallDutyPolicyEscalationRuleId.toString(),
        });
      }) as never);
    jest
      .spyOn(OnCallDutyPolicyTimeLogService, "endTimeLogForUser")
      .mockImplementation((async (data: {
        userId: ObjectID;
        onCallDutyPolicyEscalationRuleId: ObjectID;
      }) => {
        timeLogs.push({
          kind: "end",
          userId: data.userId.toString(),
          ruleId: data.onCallDutyPolicyEscalationRuleId.toString(),
        });
      }) as never);

    const told: Array<{ userId: string; ruleId: string }> = [];
    jest
      .spyOn(UserNotificationSettingService, "sendUserNotification")
      .mockImplementation((async (data: {
        userId: ObjectID;
        onCallPolicyEscalationRuleId?: ObjectID | undefined;
      }) => {
        told.push({
          userId: data.userId.toString(),
          ruleId: data.onCallPolicyEscalationRuleId?.toString() || "",
        });
      }) as never);

    await OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule(
      oid(SCHEDULE),
    );

    /*
     * Kim off, Alex on, Sam next on the roster - for Level 1 only, the rule
     * that pages whoever is on call. Level 2 pages the next person in the
     * rotation, so a hand-off says nothing about it.
     */
    expect(told).toEqual([
      { userId: KIM, ruleId: LEVEL_1 },
      { userId: ALEX, ruleId: LEVEL_1 },
      { userId: SAM, ruleId: LEVEL_1 },
    ]);
    expect(
      timeLogs.every((log: { ruleId: string }) => {
        return log.ruleId === LEVEL_1;
      }),
    ).toBe(true);
    expect(timeLogs.length).toBeGreaterThan(0);
    expect(
      feed.some((entry: string) => {
        return entry.includes("Level 2");
      }),
    ).toBe(false);
  });

  test("'my on-call policies' lists the schedule's own rule, not the next-in-rotation one", async () => {
    attach({
      id: "0e400000-0000-4000-8000-000000000511",
      ruleId: LEVEL_1,
      pageNextInRotation: false,
    });
    attach({
      id: "0e400000-0000-4000-8000-000000000512",
      ruleId: LEVEL_2,
      pageNextInRotation: true,
    });

    jest
      .spyOn(
        OnCallDutyPolicyScheduleService,
        "getOnCallSchedulesWhereUserIsOnCallDuty",
      )
      .mockResolvedValue([{ id: oid(SCHEDULE) }] as never);
    jest.spyOn(TeamService, "getTeamsUserIsAPartOf").mockResolvedValue([]);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "findBy")
      .mockResolvedValue([] as never);

    const result: {
      escalationRulesBySchedule: Array<OnCallDutyPolicyEscalationRuleSchedule>;
    } = await OnCallDutyPolicyService.getOnCallPoliciesWhereUserIsOnCallDuty({
      projectId: oid(PROJECT),
      userId: oid(ALEX),
    });

    expect(
      result.escalationRulesBySchedule.map(
        (row: OnCallDutyPolicyEscalationRuleSchedule) => {
          return row.onCallDutyPolicyEscalationRuleId?.toString();
        },
      ),
    ).toEqual([LEVEL_1]);
  });

  test("the roster follows the policy whose rule pages the on-call person - a next-in-rotation rule of another policy does not change that", async () => {
    attach({
      id: "0e400000-0000-4000-8000-000000000521",
      ruleId: LEVEL_1,
      policyId: POLICY,
      pageNextInRotation: false,
    });

    const getSingleAttachedPolicyId: (
      scheduleId: ObjectID,
    ) => Promise<ObjectID | undefined> = (
      OnCallDutyPolicyScheduleService as unknown as {
        getSingleAttachedPolicyId: (
          scheduleId: ObjectID,
        ) => Promise<ObjectID | undefined>;
      }
    ).getSingleAttachedPolicyId.bind(OnCallDutyPolicyScheduleService);

    expect((await getSingleAttachedPolicyId(oid(SCHEDULE)))?.toString()).toBe(
      POLICY,
    );

    attach({
      id: "0e400000-0000-4000-8000-000000000522",
      ruleId: LEVEL_2,
      policyId: OTHER_POLICY,
      pageNextInRotation: true,
    });

    expect((await getSingleAttachedPolicyId(oid(SCHEDULE)))?.toString()).toBe(
      POLICY,
    );

    // A second policy's rule that does page the on-call person: no single policy.
    attach({
      id: "0e400000-0000-4000-8000-000000000523",
      ruleId: LEVEL_3,
      policyId: OTHER_POLICY,
      pageNextInRotation: false,
    });

    expect(await getSingleAttachedPolicyId(oid(SCHEDULE))).toBeUndefined();
  });

  test("calendar feeds, my shifts and reminders: the shifts are on call for the schedule's own rule only", async () => {
    attach({
      id: "0e400000-0000-4000-8000-000000000531",
      ruleId: LEVEL_1,
      ruleName: "Level 1",
      pageNextInRotation: false,
    });
    attach({
      id: "0e400000-0000-4000-8000-000000000532",
      ruleId: LEVEL_2,
      ruleName: "Level 2",
      ruleOrder: 2,
      pageNextInRotation: true,
    });

    const resolved: ResolvedShiftSegments | null =
      await OnCallDutyPolicyScheduleService.getResolvedShiftSegments({
        scheduleId: oid(SCHEDULE),
        windowStart: at("2026-03-03T00:00:00Z"),
        windowEnd: at("2026-03-06T00:00:00Z"),
      });

    expect(
      (resolved?.attachedPolicies || []).map(
        (policy: { ruleId: string; ruleName: string }) => {
          return policy.ruleName;
        },
      ),
    ).toEqual(["Level 1"]);
  });
});

describe("adding and removing a next-in-rotation schedule on a rule", () => {
  type ScheduleRowHooks = {
    onCreateSuccess: (
      onCreate: OnCreate<OnCallDutyPolicyEscalationRuleSchedule>,
      createdItem: OnCallDutyPolicyEscalationRuleSchedule,
    ) => Promise<OnCallDutyPolicyEscalationRuleSchedule>;
  };

  let feed: Array<string>;
  let told: Array<string>;
  let timeLogsStarted: number;

  beforeEach(() => {
    feed = [];
    told = [];
    timeLogsStarted = 0;

    // The roster's own refresh is the hand-off test's subject, not this one's.
    jest
      .spyOn(
        OnCallDutyPolicyScheduleService,
        "refreshCurrentUserIdAndHandoffTimeInSchedule",
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "propagateShiftConfigChange")
      .mockResolvedValue(undefined);
    jest
      .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.example/policy"));
    jest
      .spyOn(OnCallDutyPolicyFeedService, "createOnCallDutyPolicyFeedItem")
      .mockImplementation((async (data: { feedInfoInMarkdown: string }) => {
        feed.push(data.feedInfoInMarkdown);
      }) as never);
    jest
      .spyOn(UserNotificationSettingService, "sendUserNotification")
      .mockImplementation((async (data: { userId: ObjectID }) => {
        told.push(data.userId.toString());
      }) as never);
    jest
      .spyOn(OnCallDutyPolicyTimeLogService, "startTimeLogForUser")
      .mockImplementation((async () => {
        timeLogsStarted++;
      }) as never);
  });

  async function added(pageNextInRotation: boolean): Promise<void> {
    const row: FakeRow = attach({
      id: "0e400000-0000-4000-8000-000000000601",
      ruleId: LEVEL_2,
      ruleName: "Level 2",
      ruleOrder: 2,
      pageNextInRotation,
    });

    const createdItem: OnCallDutyPolicyEscalationRuleSchedule =
      new OnCallDutyPolicyEscalationRuleSchedule();
    createdItem.id = oid(String(row["_id"]));

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findOneById")
      .mockResolvedValue({
        ...row,
        onCallDutyPolicySchedule: { name: "Payments primary" },
        onCallDutyPolicy: { id: oid(POLICY), name: "Payments" },
        onCallDutyPolicyEscalationRule: {
          id: oid(LEVEL_2),
          name: "Level 2",
          order: 2,
        },
      } as never);

    await (
      OnCallDutyPolicyEscalationRuleScheduleService as unknown as ScheduleRowHooks
    ).onCreateSuccess(
      {
        createBy: { data: createdItem, props: { isRoot: true } },
        carryForward: null,
      },
      createdItem,
    );
  }

  test("added as next in rotation: the feed says so, and Alex (on call) is told nothing and logs no on-call time for it", async () => {
    await added(true);

    expect(feed).toHaveLength(1);
    expect(feed[0]).toContain(
      "Added on-call schedule **Payments primary** (next in rotation) from the",
    );
    expect(told).toEqual([]);
    expect(timeLogsStarted).toBe(0);
  });

  test("added as on call, as before: Alex is told and her on-call time starts", async () => {
    await added(false);

    expect(feed[0]).toContain(
      "Added on-call schedule **Payments primary** from the",
    );
    expect(feed[0]).not.toContain("(next in rotation)");
    expect(told).toEqual([ALEX]);
    expect(timeLogsStarted).toBe(1);
  });
});
