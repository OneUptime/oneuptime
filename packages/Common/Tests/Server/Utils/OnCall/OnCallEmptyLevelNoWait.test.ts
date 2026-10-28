import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallEscalationAdvance, {
  OnCallEscalationAdvanceKind,
  OnCallEscalationAdvanceResult,
} from "../../../../Server/Utils/OnCall/OnCallEscalationAdvance";
import ObjectID from "../../../../Types/ObjectID";
import { getAwayTimelineMessage } from "../../../../Types/OnCallDutyPolicy/AwayTimelineMessage";
import { NOBODY_NEXT_IN_ROTATION_TIMELINE_MESSAGE } from "../../../../Types/OnCallDutyPolicy/NextInRotation";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import { ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE } from "../../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import {
  ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
  ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
} from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import {
  ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE,
  ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE,
} from "../../../../Types/OnCallDutyPolicy/OnCallEmptyLevel";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";
import { NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE } from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import { ANA, BOB, CARL, DANA, START } from "./PassOnWorld";
import EmptyLevelWorld, {
  EMPTY_TEAM,
  NO_WAY_TO_REACH_MESSAGE,
  OPTED_OUT_MESSAGE,
  PRIMARY,
  Reach,
  SECONDARY,
  Trigger,
} from "./EmptyLevelWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * "THE ON-CALL POLICY WAITS WHEN AN ESCALATION RULE HAS NO RESPONDERS. WHY
 * WAIT?" - THE ENGINE, END TO END, ON A CLOCK THAT ONLY MOVES WHEN TOLD.
 *
 * The maintainer's alert: on-call policy "sg - irm" paged nobody at Level 1
 * of 2 at 16:20 ("this escalation rule has no responders"), then waited out
 * Level 1's wait and paged Nitin Main at Level 2 only at 16:24. A level that
 * pages nobody has nobody to acknowledge it, so there is nothing to wait
 * for (Types/OnCallDutyPolicy/OnCallEmptyLevel): the run moves on at once.
 *
 * These run the real code - a run started as OneUptime starts one, each
 * escalation rule paging its people, the run moving on - in an in-memory
 * world (EmptyLevelWorld), and read who was paged at which minute: "Bob
 * Smith @ 0" is Bob paged the minute the run started. Each level waits 30
 * minutes unless a test says otherwise. It is 03:00 UTC.
 */

let world: EmptyLevelWorld;

beforeEach(() => {
  world = new EmptyLevelWorld();
  world.install();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function minutes(count: number): Date {
  return new Date(START.getTime() + count * 60 * 1000);
}

describe("the maintainer's policy: Level 1 has no responders, Level 2 pages one person", () => {
  let level1: OnCallDutyPolicyEscalationRule;
  let level2: OnCallDutyPolicyEscalationRule;

  beforeEach(async () => {
    level1 = world.addLevel({ order: 1, escalateAfterInMinutes: 4 });
    level2 = world.addLevel({ order: 2, users: [BOB] });
    await world.startAsOneUptimeDoes();
  });

  test("Level 2 is paged the minute the run starts - not after Level 1's 4 minutes", () => {
    expect(world.sentAt(START)).toEqual(["Bob Smith @ 0"]);
    expect(world.pagedBy(level2)).toEqual(["Bob Smith"]);
  });

  test("Level 1 says, in a line of its own, that it has no responders and the policy moved on at once", () => {
    expect(world.linesAbout(level1)).toEqual([
      {
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        message: ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE,
        person: null,
      },
    ]);
    expect(ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE).toBe(
      "This level has no responders, so the policy moved on at once.",
    );
  });

  test("the run is on Level 2, which started then: its wait is counted from the minute Bob was paged", () => {
    expect(world.currentOrder()).toBe(2);
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Executing);
    expect(world.run.lastEscalationRuleExecutedAt).toEqual(START);
    expect(world.run.executeNextEscalationRuleInMinutes).toBe(30);
  });

  test("the worker's minutes after that change nothing until Level 2's own wait runs out", async () => {
    for (let minute: number = 1; minute < 30; minute++) {
      expect(await world.tick(1)).toBeNull();
    }

    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Executing);

    const ended: OnCallEscalationAdvanceResult | null = await world.tick(1);

    expect(ended?.kind).toBe(OnCallEscalationAdvanceKind.Ended);
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Completed);
    expect(world.run.statusMessage).toBe(
      ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
    );
    expect(world.sentAt(START)).toEqual(["Bob Smith @ 0"]);
  });

  test("one claim moved the run past Level 1, and it was won", () => {
    expect(world.claims).toEqual([{ previous: START, won: true }]);
  });
});

/*
 * EVERY WAY A LEVEL CAN BE EMPTY WHEN IT IS REACHED: Level 1 is empty in
 * one way each, Level 2 pages Bob. Bob is paged as the run starts, and
 * Level 1 says why it paged nobody.
 */
describe("each way a level can be empty, when it is reached", () => {
  interface EmptyWay {
    name: string;
    level1: () => OnCallDutyPolicyEscalationRule;
    // The lines Level 1 wrote, in order: why, then its own.
    lines: Array<{ status: string; message: string; person: string | null }>;
  }

  const SKIPPED: string = OnCallDutyExecutionLogTimelineStatus.Skipped;
  const ERROR: string = OnCallDutyExecutionLogTimelineStatus.Error;
  const LEVEL_PAGED_NOBODY: {
    status: string;
    message: string;
    person: string | null;
  } = {
    status: SKIPPED,
    message: ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE,
    person: null,
  };
  const FRIDAY: Date = new Date("2026-10-23T17:00:00.000Z");

  const ways: Array<EmptyWay> = [
    {
      name: "no person, team or schedule at all",
      level1: () => {
        return world.addLevel({ order: 1 });
      },
      lines: [
        {
          status: SKIPPED,
          message: ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE,
          person: null,
        },
      ],
    },
    {
      name: "a team with no members",
      level1: () => {
        world.teamMembers[EMPTY_TEAM.toString()] = [];
        return world.addLevel({ order: 1, teams: [EMPTY_TEAM] });
      },
      lines: [
        {
          status: SKIPPED,
          message: ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE,
          person: null,
        },
        LEVEL_PAGED_NOBODY,
      ],
    },
    {
      name: "a schedule with nobody on call - a gap between its layers",
      level1: () => {
        world.onCall[PRIMARY.toString()] = null;
        return world.addLevel({
          order: 1,
          schedules: [{ scheduleId: PRIMARY }],
        });
      },
      lines: [
        {
          status: SKIPPED,
          message:
            "Skipped because no active users are found in this schedule.",
          person: null,
        },
        LEVEL_PAGED_NOBODY,
      ],
    },
    {
      name: "two schedules, an override leaving nobody on call in either",
      level1: () => {
        world.onCall[PRIMARY.toString()] = null;
        world.onCall[SECONDARY.toString()] = null;
        return world.addLevel({
          order: 1,
          schedules: [{ scheduleId: PRIMARY }, { scheduleId: SECONDARY }],
        });
      },
      lines: [
        {
          status: SKIPPED,
          message:
            "Skipped because no active users are found in this schedule.",
          person: null,
        },
        {
          status: SKIPPED,
          message:
            "Skipped because no active users are found in this schedule.",
          person: null,
        },
        LEVEL_PAGED_NOBODY,
      ],
    },
    {
      name: "the next person in a rotation, with nobody next",
      level1: () => {
        world.nextInRotation[PRIMARY.toString()] = {
          onCallUserId: DANA,
          nextUserId: null,
          layerName: "Weekdays",
        };
        return world.addLevel({
          order: 1,
          schedules: [{ scheduleId: PRIMARY, nextInRotation: true }],
        });
      },
      lines: [
        {
          status: SKIPPED,
          message: NOBODY_NEXT_IN_ROTATION_TIMELINE_MESSAGE,
          person: null,
        },
        LEVEL_PAGED_NOBODY,
      ],
    },
    {
      name: "everybody it names away, with nobody named to cover",
      level1: () => {
        world.away[ANA.toString()] = FRIDAY;
        world.away[CARL.toString()] = FRIDAY;
        return world.addLevel({ order: 1, users: [ANA, CARL] });
      },
      lines: [
        {
          status: SKIPPED,
          message: getAwayTimelineMessage(FRIDAY),
          person: "Ana Lopez",
        },
        {
          status: SKIPPED,
          message: getAwayTimelineMessage(FRIDAY),
          person: "Carl Diaz",
        },
        LEVEL_PAGED_NOBODY,
      ],
    },
    {
      name: "everybody it names has left the project",
      level1: () => {
        world.members = new Set<string>([BOB.toString()]);
        return world.addLevel({ order: 1, users: [ANA, CARL] });
      },
      lines: [
        {
          status: SKIPPED,
          message: NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
          person: "Ana Lopez",
        },
        {
          status: SKIPPED,
          message: NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
          person: "Carl Diaz",
        },
        LEVEL_PAGED_NOBODY,
      ],
    },
    {
      name: "everybody it pages has no way to be reached at all",
      level1: () => {
        world.reach[ANA.toString()] = Reach.NoWayToReach;
        return world.addLevel({ order: 1, users: [ANA] });
      },
      lines: [
        {
          status: ERROR,
          message: NO_WAY_TO_REACH_MESSAGE,
          person: "Ana Lopez",
        },
        LEVEL_PAGED_NOBODY,
      ],
    },
    {
      name: "everybody it pages opted out of the severity",
      level1: () => {
        world.reach[ANA.toString()] = Reach.OptedOut;
        world.reach[CARL.toString()] = Reach.NoWayToReach;
        return world.addLevel({ order: 1, users: [ANA, CARL] });
      },
      lines: [
        {
          status: SKIPPED,
          message: OPTED_OUT_MESSAGE,
          person: "Ana Lopez",
        },
        {
          status: ERROR,
          message: NO_WAY_TO_REACH_MESSAGE,
          person: "Carl Diaz",
        },
        LEVEL_PAGED_NOBODY,
      ],
    },
    {
      name: "its team's only member has left, and its schedule has a gap",
      level1: () => {
        world.teamMembers[EMPTY_TEAM.toString()] = [DANA];
        world.members = new Set<string>([BOB.toString()]);
        world.onCall[PRIMARY.toString()] = null;
        return world.addLevel({
          order: 1,
          teams: [EMPTY_TEAM],
          schedules: [{ scheduleId: PRIMARY }],
        });
      },
      lines: [
        {
          status: SKIPPED,
          message: NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
          person: "Dana Kim",
        },
        {
          status: SKIPPED,
          message:
            "Skipped because no active users are found in this schedule.",
          person: null,
        },
        LEVEL_PAGED_NOBODY,
      ],
    },
  ];

  describe.each(ways)("$name", (way: EmptyWay) => {
    let level1: OnCallDutyPolicyEscalationRule;
    let level2: OnCallDutyPolicyEscalationRule;

    beforeEach(async () => {
      level1 = way.level1();
      level2 = world.addLevel({ order: 2, users: [BOB] });
      await world.startAsOneUptimeDoes();
    });

    test("the next level is paged the minute the run starts", () => {
      expect(
        world.sentAt(START).filter((page: string): boolean => {
          return page.startsWith("Bob Smith");
        }),
      ).toEqual(["Bob Smith @ 0"]);
      expect(world.pagedBy(level2)).toEqual(["Bob Smith"]);
      expect(world.currentOrder()).toBe(2);
    });

    test("the level says why it paged nobody, then that the policy moved on at once", () => {
      expect(world.linesAbout(level1)).toEqual(way.lines);
    });

    test("the run waits on the next level instead, as long as that level says", () => {
      expect(world.run.lastEscalationRuleExecutedAt).toEqual(START);
      expect(world.run.executeNextEscalationRuleInMinutes).toBe(30);
      expect(world.run.status).toBe(OnCallDutyPolicyStatus.Executing);
    });
  });
});

describe("a level that reached somebody waits, as every level always did", () => {
  test("one person who cannot be reached and one who can: the level waits for the one who can", async () => {
    world.reach[ANA.toString()] = Reach.NoWayToReach;
    const level1: OnCallDutyPolicyEscalationRule = world.addLevel({
      order: 1,
      users: [ANA, CARL],
    });
    world.addLevel({ order: 2, users: [BOB] });

    await world.startAsOneUptimeDoes();

    expect(world.sentAt(START)).toEqual(["Ana Lopez @ 0", "Carl Diaz @ 0"]);
    expect(world.currentOrder()).toBe(1);
    expect(
      world.linesAbout(level1).map((line: { message: string }) => {
        return line.message;
      }),
    ).not.toContain(ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE);

    expect(await world.tick(29)).toBeNull();
    expect(world.sentAt(START)).not.toContain("Bob Smith @ 29");

    await world.tick(1);
    expect(world.sentAt(START)).toEqual([
      "Ana Lopez @ 0",
      "Carl Diaz @ 0",
      "Bob Smith @ 30",
    ]);
  });

  test("somebody on call in its schedule: the level waits its own minutes - not one less", async () => {
    world.onCall[PRIMARY.toString()] = { userId: DANA, coveredUserId: null };
    world.addLevel({
      order: 1,
      escalateAfterInMinutes: 7,
      schedules: [{ scheduleId: PRIMARY }],
    });
    world.addLevel({ order: 2, users: [BOB] });

    await world.startAsOneUptimeDoes();

    expect(await world.tick(6)).toBeNull();
    expect(world.sentAt(START)).toEqual(["Dana Kim @ 0"]);

    await world.tick(1);
    expect(world.sentAt(START)).toEqual(["Dana Kim @ 0", "Bob Smith @ 7"]);
  });

  test("a page still on its way - their own rules send it later - is a page that reached them", async () => {
    world.addLevel({ order: 1, users: [ANA] });
    world.addLevel({ order: 2, users: [BOB] });

    await world.startAsOneUptimeDoes();

    // Ana's line says her page is being sent: she may well still take it.
    expect(world.stepsOf(ANA)).toEqual([
      {
        status: OnCallDutyExecutionLogTimelineStatus.Executing,
        message: "Sending notification to user.",
      },
    ]);
    expect(world.currentOrder()).toBe(1);
    expect(world.pagedNames()).toEqual(["Ana Lopez"]);
  });
});

describe("every level empty", () => {
  let levels: Array<OnCallDutyPolicyEscalationRule>;

  beforeEach(async () => {
    world.repeatsAllowed = 3;
    world.onCall[PRIMARY.toString()] = null;
    levels = [
      world.addLevel({ order: 1 }),
      world.addLevel({ order: 2, schedules: [{ scheduleId: PRIMARY }] }),
      world.addLevel({ order: 3, teams: [EMPTY_TEAM] }),
    ];
    world.teamMembers[EMPTY_TEAM.toString()] = [];

    await world.startAsOneUptimeDoes();
  });

  test("the run stops the minute it starts, having paged nobody", () => {
    expect(world.pagedNames()).toEqual([]);
    expect(world.run.status).toBe(
      OnCallDutyPolicyStatus.CompletedWithNoNotifications,
    );
  });

  test("it says who should fix the policy: its owners", () => {
    expect(world.run.statusMessage).toBe(
      ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
    );
    expect(world.run.statusMessage).toContain(
      "This policy's owners should add responders to its escalation rules, or check who is on call in its schedules.",
    );
  });

  test("an empty pass is not repeated - not at once, and not with waits - though repeats are left", async () => {
    expect(world.run.onCallPolicyExecutionRepeatCount).toBe(1);

    // Each level said so once: one pass, three lines of their own.
    expect(
      world.steps.filter((step: OnCallDutyPolicyExecutionLogTimeline) => {
        return (
          step.statusMessage === ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE ||
          step.statusMessage === ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE
        );
      }),
    ).toHaveLength(3);

    // Hours later, the worker finds nothing to do: the run is over.
    expect(await world.tick(30)).toBeNull();
    expect(await world.tick(240)).toBeNull();
    expect(world.run.onCallPolicyExecutionRepeatCount).toBe(1);
  });

  test("each level says why, in its own line: no responders, nobody on call, an empty team", () => {
    expect(
      levels.map((level: OnCallDutyPolicyEscalationRule) => {
        return world.linesAbout(level).map((line: { message: string }) => {
          return line.message;
        });
      }),
    ).toEqual([
      [ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE],
      [
        "Skipped because no active users are found in this schedule.",
        ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE,
      ],
      [
        ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE,
        ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE,
      ],
    ]);
  });

  test("the run moved through its levels in order, claiming each move once", () => {
    // Past Level 1, past Level 2, and past Level 3 to find no level after it.
    expect(
      world.claims.map((claim: { won: boolean }) => {
        return claim.won;
      }),
    ).toEqual([true, true, true]);
    expect(world.runStatuses).toEqual([
      OnCallDutyPolicyStatus.Started,
      OnCallDutyPolicyStatus.Executing,
      OnCallDutyPolicyStatus.CompletedWithNoNotifications,
    ]);
  });
});

describe("repeats", () => {
  test("a pass that reached somebody repeats, and its empty level is passed at once each time round", async () => {
    world.repeatsAllowed = 2;
    world.addLevel({ order: 1, users: [ANA], escalateAfterInMinutes: 10 });
    world.addLevel({ order: 2 });

    await world.startAsOneUptimeDoes();
    expect(world.sentAt(START)).toEqual(["Ana Lopez @ 0"]);

    await world.tick(10);
    expect(world.sentAt(START)).toEqual(["Ana Lopez @ 0", "Ana Lopez @ 10"]);
    expect(world.run.onCallPolicyExecutionRepeatCount).toBe(2);

    await world.tick(10);
    expect(world.sentAt(START)).toEqual([
      "Ana Lopez @ 0",
      "Ana Lopez @ 10",
      "Ana Lopez @ 20",
    ]);
    expect(world.run.onCallPolicyExecutionRepeatCount).toBe(3);

    await world.tick(10);
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Completed);
    expect(world.run.statusMessage).toBe(
      ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
    );
    expect(world.pagedNames()).toHaveLength(3);
  });

  test("a repeat that finds every level empty stops there - though repeats are left - and does not loop", async () => {
    world.repeatsAllowed = 3;
    world.onCall[PRIMARY.toString()] = { userId: ANA, coveredUserId: null };
    world.addLevel({
      order: 1,
      escalateAfterInMinutes: 10,
      schedules: [{ scheduleId: PRIMARY }],
    });
    world.addLevel({ order: 2 });

    await world.startAsOneUptimeDoes();
    expect(world.sentAt(START)).toEqual(["Ana Lopez @ 0"]);

    // Ana's shift ends; nobody is on call by the time the policy goes round.
    world.onCall[PRIMARY.toString()] = null;

    await world.tick(10);

    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Completed);
    // Ana was paged, earlier in the run: nobody acknowledged.
    expect(world.run.statusMessage).toBe(
      ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
    );
    expect(world.run.onCallPolicyExecutionRepeatCount).toBe(2);
    expect(world.sentAt(START)).toEqual(["Ana Lopez @ 0"]);
    expect(await world.tick(10)).toBeNull();
  });

  test("an empty first level on every repeat costs no time: the second level is paged the moment each pass begins", async () => {
    world.repeatsAllowed = 1;
    world.addLevel({ order: 1 });
    world.addLevel({ order: 2, users: [BOB], escalateAfterInMinutes: 15 });

    await world.startAsOneUptimeDoes();
    await world.tick(15);
    await world.tick(15);

    expect(world.sentAt(START)).toEqual(["Bob Smith @ 0", "Bob Smith @ 15"]);
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Completed);
  });
});

describe("acknowledged while the run moves past empty levels", () => {
  test("a page acknowledged as the run passes an empty level stops the run there: no later level is paged", async () => {
    world.addLevel({ order: 1, users: [ANA], escalateAfterInMinutes: 5 });
    const level2: OnCallDutyPolicyEscalationRule = world.addLevel({
      order: 2,
    });
    world.addLevel({ order: 3, users: [BOB] });

    await world.startAsOneUptimeDoes();

    /*
     * Ana acknowledges from her page at the moment Level 2 says it paged
     * nobody: her acknowledgement ends the run (UserOnCallLogTimelineService).
     */
    world.onLineWritten = (line: OnCallDutyPolicyExecutionLogTimeline) => {
      if (
        line.onCallDutyPolicyEscalationRuleId?.toString() ===
        level2.id!.toString()
      ) {
        world.run.status = OnCallDutyPolicyStatus.Completed;
      }
    };

    await world.tick(5);

    expect(world.sentAt(START)).toEqual(["Ana Lopez @ 0"]);
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Completed);
  });

  test("a run that ended before it is moved on at once is left: moving on reads it again first", async () => {
    world.addLevel({ order: 1, users: [ANA], escalateAfterInMinutes: 5 });
    world.addLevel({ order: 2 });
    world.addLevel({ order: 3, users: [BOB] });

    await world.startAsOneUptimeDoes();
    world.run.status = OnCallDutyPolicyStatus.Completed;

    expect(
      await OnCallEscalationAdvance.moveOnAtOnce({ runId: world.run.id! }),
    ).toBeNull();
    expect(world.sentAt(START)).toEqual(["Ana Lopez @ 0"]);
  });
});

describe("however the run was started", () => {
  test.each([
    [Trigger.Incident, UserNotificationEventType.IncidentCreated],
    [Trigger.Alert, UserNotificationEventType.AlertCreated],
    [Trigger.AlertEpisode, UserNotificationEventType.AlertEpisodeCreated],
    [Trigger.IncidentEpisode, UserNotificationEventType.IncidentEpisodeCreated],
  ])(
    "for an %s: its empty first level passes at once, and the next level is paged about it",
    async (trigger: Trigger, eventType: UserNotificationEventType) => {
      world.addLevel({ order: 1 });
      world.addLevel({ order: 2, users: [BOB] });

      await world.startAsOneUptimeDoes(trigger);

      expect(world.sent).toEqual([
        {
          userId: BOB.toString(),
          ruleId: world.rules[1]!.id!.toString(),
          eventType: eventType,
          at: START,
        },
      ]);
    },
  );

  test("a run that waited for working hours: as it starts, its empty first level passes at once", async () => {
    world.addLevel({ order: 1 });
    world.addLevel({ order: 2, users: [BOB] });

    expect(await world.startWaitingRun()).toBe(true);

    expect(world.sentAt(START)).toEqual(["Bob Smith @ 0"]);
    expect(world.currentOrder()).toBe(2);
    expect(world.run.status).toBe(OnCallDutyPolicyStatus.Executing);
  });

  test("a page again whose level has nobody left - not even whoever acknowledged - passes at once to the next level", async () => {
    world.members = new Set<string>([BOB.toString()]);
    const level1: OnCallDutyPolicyEscalationRule = world.addLevel({
      order: 1,
    });
    world.addLevel({ order: 2, users: [BOB] });

    // Ana acknowledged, and has left the project since.
    await world.startPageAgain({ startAtRule: level1, acknowledgedBy: ANA });

    expect(world.sentAt(START)).toEqual(["Bob Smith @ 0"]);
    expect(world.linesAbout(level1)).toEqual([
      {
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        message: NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
        person: "Ana Lopez",
      },
      {
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        message: ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE,
        person: null,
      },
    ]);
  });

  test("a page again whose acknowledger can be paged waits at that level, as before", async () => {
    const level1: OnCallDutyPolicyEscalationRule = world.addLevel({
      order: 1,
    });
    world.addLevel({ order: 2, users: [BOB] });

    await world.startPageAgain({ startAtRule: level1, acknowledgedBy: ANA });

    expect(world.sentAt(START)).toEqual(["Ana Lopez @ 0"]);
    expect(world.currentOrder()).toBe(1);
  });

  test("a page again that starts at a later, empty level may still go round, to reach the levels before it", async () => {
    world.repeatsAllowed = 1;
    world.members = new Set<string>([BOB.toString()]);
    world.addLevel({ order: 1, users: [BOB] });
    const level2: OnCallDutyPolicyEscalationRule = world.addLevel({
      order: 2,
    });

    await world.startPageAgain({ startAtRule: level2, acknowledgedBy: ANA });

    expect(world.sentAt(START)).toEqual(["Bob Smith @ 0"]);
    expect(world.run.onCallPolicyExecutionRepeatCount).toBe(2);
  });
});

describe("two moves landing together", () => {
  test("two worker ticks that read the same run move it past an empty level once, and page the next level once", async () => {
    world.addLevel({ order: 1, users: [ANA], escalateAfterInMinutes: 5 });
    world.addLevel({ order: 2 });
    world.addLevel({ order: 3, users: [BOB] });

    await world.startAsOneUptimeDoes();
    world.clock = minutes(5);

    const read: OnCallDutyPolicyExecutionLog = Object.assign(
      Object.create(Object.getPrototypeOf(world.run)),
      world.run,
    );

    const [first, second]: Array<OnCallEscalationAdvanceResult> =
      await Promise.all([
        OnCallEscalationAdvance.advance({ run: read, now: minutes(5) }),
        OnCallEscalationAdvance.advance({ run: read, now: minutes(5) }),
      ]);

    expect(
      [first!.kind, second!.kind].sort(),
    ).toEqual(
      [
        OnCallEscalationAdvanceKind.NotClaimed,
        OnCallEscalationAdvanceKind.RuleStarted,
      ].sort(),
    );
    expect(world.sentAt(START)).toEqual(["Ana Lopez @ 0", "Bob Smith @ 5"]);
  });
});

describe("when a level's pages cannot be read back", () => {
  test("the level waits, as every level did, rather than moving on from people who may have been reached", async () => {
    world.reach[ANA.toString()] = Reach.NoWayToReach;
    world.addLevel({ order: 1, users: [ANA] });
    world.addLevel({ order: 2, users: [BOB] });

    // The world's own read, kept for every other read of the timeline.
    const read: (data: unknown) => Promise<unknown> = (
      OnCallDutyPolicyExecutionLogTimelineService.findBy as unknown as {
        getMockImplementation: () => (data: unknown) => Promise<unknown>;
      }
    ).getMockImplementation();

    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "findBy")
      .mockImplementation((async (data: { query: Record<string, unknown> }) => {
        if (data.query["_id"]) {
          throw new Error("connection reset");
        }

        return await read(data);
      }) as never);

    await world.startAsOneUptimeDoes();

    expect(world.currentOrder()).toBe(1);
    expect(world.pagedNames()).toEqual(["Ana Lopez"]);
    expect(world.errors.join("\n")).toContain(
      "waiting out the rule as if they did",
    );
  });
});

describe("timing, minute by minute", () => {
  test("three empty levels in a row cost no minute: the fourth is paged as the run starts", async () => {
    world.addLevel({ order: 1, escalateAfterInMinutes: 60 });
    world.addLevel({ order: 2, escalateAfterInMinutes: 60 });
    world.addLevel({ order: 3, escalateAfterInMinutes: 60 });
    world.addLevel({ order: 4, users: [CARL] });

    await world.startAsOneUptimeDoes();

    expect(world.sentAt(START)).toEqual(["Carl Diaz @ 0"]);
    expect(world.currentOrder()).toBe(4);
  });

  test("an empty level between two that page: the third is paged when the first's wait runs out, not the second's after it", async () => {
    world.addLevel({ order: 1, users: [ANA], escalateAfterInMinutes: 5 });
    world.addLevel({ order: 2, escalateAfterInMinutes: 30 });
    world.addLevel({ order: 3, users: [BOB] });

    await world.startAsOneUptimeDoes();
    expect(await world.tick(4)).toBeNull();
    await world.tick(1);

    expect(world.sentAt(START)).toEqual(["Ana Lopez @ 0", "Bob Smith @ 5"]);
    expect(world.currentOrder()).toBe(3);
  });

  test("a level that reached somebody waits its own time exactly: not a minute less, and paged on the minute it runs out", async () => {
    world.addLevel({ order: 1, users: [ANA], escalateAfterInMinutes: 7 });
    world.addLevel({ order: 2, users: [BOB], escalateAfterInMinutes: 3 });
    world.addLevel({ order: 3, users: [CARL] });

    await world.startAsOneUptimeDoes();

    for (let minute: number = 1; minute <= 6; minute++) {
      expect(await world.tick(1)).toBeNull();
    }

    await world.tick(1);
    expect(await world.tick(1)).toBeNull();
    expect(await world.tick(1)).toBeNull();
    await world.tick(1);

    expect(world.sentAt(START)).toEqual([
      "Ana Lopez @ 0",
      "Bob Smith @ 7",
      "Carl Diaz @ 10",
    ]);
  });
});
