import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallAcknowledgementTimeoutUtil, {
  OnCallAcknowledgementTimeoutStop,
  OnCallPageAgainOutcome,
  OnCallPageAgainResult,
} from "../../../../Server/Utils/OnCall/OnCallAcknowledgementTimeout";
import ObjectID from "../../../../Types/ObjectID";
import { ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE } from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import {
  OnCallOpenPage,
  OnCallPageRecordType,
  OnCallPassOnOutcome,
  OnCallPassOnRefusal,
} from "../../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import OnCallPagePassOn from "../../../../Server/Utils/OnCall/OnCallPagePassOn";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import AcknowledgementTimeoutWorld, {
  ACKNOWLEDGED,
  CREATED,
  DASHBOARD_URL,
  INVESTIGATING,
  RESOLVED,
  SCHEDULE_ID,
} from "./AcknowledgementTimeoutWorld";
import { ANA, BOB, CARL, DANA, RUN_ID, START } from "./PassOnWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AN ACKNOWLEDGEMENT TIMEOUT, END TO END (issue #5123).
 *
 * "Once an incident or alert is acknowledged, every on-call policy stops
 * paging for it, permanently. If the responder acks and then gets pulled
 * away, falls back asleep, or forgets, the incident can sit in Acknowledged
 * indefinitely with nobody being reminded."
 *
 * These run the real code - the clock (OnCallAcknowledgementTimeout), the
 * worker's page again, the run it starts (startPageAgain), the escalation
 * rules paging their people, the run moving on, a person answering or
 * escalating a page - in an in-memory world (AcknowledgementTimeoutWorld),
 * and read what the policy did: who it paged again, when, and what the
 * incident's feed and its runs say.
 *
 * The policy, Payments, pages Ana at Level 1, waits 30 minutes, then Carl
 * at Level 2. Its acknowledgement timeout is 30 minutes. It is 03:00 UTC.
 */

let world: AcknowledgementTimeoutWorld;

const LEVEL_WAIT_IN_MINUTES: number = 30;

beforeEach(() => {
  world = new AcknowledgementTimeoutWorld();
  world.install();
  world.addRule({ order: 1, users: [ANA] });
  world.addRule({ order: 2, users: [CARL] });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function pagedAgain(
  results: Array<OnCallPageAgainResult>,
): Array<OnCallPageAgainResult> {
  return results.filter((result: OnCallPageAgainResult) => {
    return result.outcome === OnCallPageAgainOutcome.PagedAgain;
  });
}

function only<T>(items: Array<T>): T {
  expect(items).toHaveLength(1);
  return items[0]!;
}

// The run a page again started, from the worker's answer.
function pageAgainRun(
  results: Array<OnCallPageAgainResult>,
): OnCallDutyPolicyExecutionLog {
  const result: OnCallPageAgainResult = only(pagedAgain(results));
  return world.runById(result.pageAgainRunId!);
}

function minutesAfterStart(at: Date): number {
  return (at.getTime() - START.getTime()) / (60 * 1000);
}

describe("a policy that never set its acknowledgement timeout", () => {
  test("stops paging for good when its page is answered, as every policy always has", async () => {
    world.policy.acknowledgementTimeoutInMinutes = null;
    await world.startRun();

    world.advance(5);
    await world.answerPage(ANA, RUN_ID);

    expect(world.incident!.stateId.toString()).toBe(ACKNOWLEDGED.toString());
    expect(world.runningClocks()).toEqual([]);

    for (let minute: number = 0; minute < 6 * 60; minute += 15) {
      world.advance(15);
      expect(await world.pageAgainTick()).toEqual([]);
    }

    expect(world.pagesAgain()).toEqual([]);
    expect(world.runs).toHaveLength(1);
  });

  test("starts no clock when the incident is acknowledged in the Dashboard", async () => {
    world.policy.acknowledgementTimeoutInMinutes = null;
    await world.startRun();

    world.advance(5);
    await world.acknowledgeInDashboard(DANA);

    expect(world.runningClocks()).toEqual([]);
    expect(world.clockWrites).toEqual([]);
  });
});

describe("acknowledged and not resolved in time: the policy pages again", () => {
  test("30 minutes after the incident was acknowledged in the Dashboard, not a tick sooner", async () => {
    await world.startRun();

    world.advance(5);
    await world.acknowledgeInDashboard(DANA);

    expect(world.runningClocks()).toEqual([
      { runId: RUN_ID.toString(), startedAt: new Date(world.clock) },
    ]);

    // The first run ends: the incident is acknowledged.
    world.advance(1);
    await world.escalationTick();
    expect(world.runById(RUN_ID).status).toBe(OnCallDutyPolicyStatus.Completed);

    // 03:06 to 03:34: nothing.
    for (let minute: number = 6; minute < 35; minute++) {
      const results: Array<OnCallPageAgainResult> = await world.pageAgainTick();
      expect(pagedAgain(results)).toEqual([]);
      world.advance(1);
    }

    expect(minutesAfterStart(world.clock)).toBe(35);

    const run: OnCallDutyPolicyExecutionLog = pageAgainRun(
      await world.pageAgainTick(),
    );

    expect(run.pageAgainNumber).toBe(1);
    expect(run.triggeredByIncidentId!.toString()).toBe(
      world.runById(RUN_ID).triggeredByIncidentId!.toString(),
    );
    expect(world.pagesAgain()).toHaveLength(1);
  });

  test("pages whoever acknowledged it first, then the escalation rule that was paging", async () => {
    await world.startRun();

    world.advance(5);
    await world.acknowledgeInDashboard(DANA);
    world.advance(LEVEL_WAIT_IN_MINUTES);

    const run: OnCallDutyPolicyExecutionLog = pageAgainRun(
      await world.pageAgainTick(),
    );

    expect(world.pagedIn(run.id!)).toEqual(["Dana Kim", "Ana Lopez"]);
    expect(run.lastExecutedEscalationRuleOrder).toBe(1);
  });

  test("leaves the incident acknowledged: no state is written, nothing moves back", async () => {
    await world.startRun();

    world.advance(5);
    await world.acknowledgeInDashboard(DANA);
    const statesBefore: number = world.stateRows.length;

    world.advance(LEVEL_WAIT_IN_MINUTES);
    pageAgainRun(await world.pageAgainTick());

    expect(world.incident!.stateId.toString()).toBe(ACKNOWLEDGED.toString());
    expect(world.stateRows).toHaveLength(statesBefore);
  });

  test("says so in the incident's feed, naming who acknowledged it", async () => {
    await world.startRun();

    world.advance(5);
    await world.acknowledgeInDashboard(DANA);
    world.advance(LEVEL_WAIT_IN_MINUTES);
    pageAgainRun(await world.pageAgainTick());

    const policyLink: string = `[Payments](${DASHBOARD_URL}/`;

    const entry: string | undefined = world.feed
      .map((item: { markdown: string }) => {
        return item.markdown;
      })
      .find((markdown: string) => {
        return markdown.includes("is paging again");
      });

    expect(entry).toBeDefined();
    expect(entry!.startsWith(`On-call policy **${policyLink}`)).toBe(true);
    expect(entry).toContain(
      "is paging again (1 of 5): the incident is still not resolved 30 minutes after **[Dana Kim](",
    );
    expect(entry!.endsWith(")** acknowledged it.")).toBe(true);
  });

  test("its run says why it pages while it pages", async () => {
    await world.startRun();

    world.advance(5);
    await world.acknowledgeInDashboard(DANA);
    world.advance(LEVEL_WAIT_IN_MINUTES);

    const run: OnCallDutyPolicyExecutionLog = pageAgainRun(
      await world.pageAgainTick(),
    );

    expect(run.status).toBe(OnCallDutyPolicyStatus.Executing);
    expect(run.statusMessage).toBe(
      "Paging again (1 of 5): still not resolved 30 minutes after it was acknowledged.",
    );
  });

  test("pages the person who answered their page, when that is how it was acknowledged", async () => {
    await world.startRun();

    world.advance(5);
    await world.answerPage(ANA, RUN_ID);
    world.advance(LEVEL_WAIT_IN_MINUTES);

    const run: OnCallDutyPolicyExecutionLog = pageAgainRun(
      await world.pageAgainTick(),
    );

    // Ana acknowledged and is on Level 1: paged once.
    expect(world.pagedIn(run.id!)).toEqual(["Ana Lopez"]);
  });

  test("pages the rule's people alone when nobody acknowledged it by name", async () => {
    await world.startRun();

    world.advance(5);
    // Through the API: no person on the state change.
    await world.changeState(ACKNOWLEDGED, null);
    world.advance(LEVEL_WAIT_IN_MINUTES);

    const run: OnCallDutyPolicyExecutionLog = pageAgainRun(
      await world.pageAgainTick(),
    );

    expect(world.pagedIn(run.id!)).toEqual(["Ana Lopez"]);
    expect(
      world.feed.some((item: { markdown: string }) => {
        return item.markdown.includes("30 minutes after it was acknowledged.");
      }),
    ).toBe(true);
  });
});

describe("whoever is on call NOW", () => {
  test("a rotation that changed hands since: its new person is paged, not the old one", async () => {
    const level1: string = world.rules[0]!.id!.toString();
    world.ruleUsers[level1] = [];
    world.ruleSchedules[level1] = [SCHEDULE_ID];
    world.onCallInSchedule = BOB;

    await world.startRun();
    expect(world.pagedIn(RUN_ID)).toEqual(["Bob Smith"]);

    world.advance(5);
    await world.answerPage(BOB, RUN_ID);

    // The rotation hands over to Carl at 03:20.
    world.advance(15);
    world.onCallInSchedule = CARL;
    world.advance(LEVEL_WAIT_IN_MINUTES - 15);

    const run: OnCallDutyPolicyExecutionLog = pageAgainRun(
      await world.pageAgainTick(),
    );

    // Bob acknowledged it: paged first. Carl is on call now.
    expect(world.pagedIn(run.id!)).toEqual(["Bob Smith", "Carl Diaz"]);
  });

  test("nobody on call in the schedule now: the person who acknowledged is still paged", async () => {
    const level1: string = world.rules[0]!.id!.toString();
    world.ruleUsers[level1] = [];
    world.ruleSchedules[level1] = [SCHEDULE_ID];
    world.onCallInSchedule = BOB;

    await world.startRun();
    world.advance(5);
    await world.answerPage(BOB, RUN_ID);

    world.onCallInSchedule = null;
    world.advance(LEVEL_WAIT_IN_MINUTES);

    const run: OnCallDutyPolicyExecutionLog = pageAgainRun(
      await world.pageAgainTick(),
    );

    expect(world.pagedIn(run.id!)).toEqual(["Bob Smith"]);
  });
});

describe("the escalation rule a page again starts at", () => {
  test("the rule that was paging when it was acknowledged: Level 2 after Level 1 went unanswered", async () => {
    await world.startRun();

    world.advance(LEVEL_WAIT_IN_MINUTES);
    await world.escalationTick();
    expect(world.pagedIn(RUN_ID)).toEqual(["Ana Lopez", "Carl Diaz"]);

    world.advance(2);
    await world.answerPage(CARL, RUN_ID);
    world.advance(LEVEL_WAIT_IN_MINUTES);

    const run: OnCallDutyPolicyExecutionLog = pageAgainRun(
      await world.pageAgainTick(),
    );

    // Carl acknowledged, at Level 2: Level 1 is not paged again.
    expect(world.pagedIn(run.id!)).toEqual(["Carl Diaz"]);
    expect(run.lastExecutedEscalationRuleOrder).toBe(2);
  });

  test("the policy's first rule when that rule was deleted since", async () => {
    await world.startRun();

    world.advance(LEVEL_WAIT_IN_MINUTES);
    await world.escalationTick();
    world.advance(2);
    await world.answerPage(CARL, RUN_ID);

    // Level 2 is deleted.
    world.rules.splice(1, 1);
    world.advance(LEVEL_WAIT_IN_MINUTES);

    const run: OnCallDutyPolicyExecutionLog = pageAgainRun(
      await world.pageAgainTick(),
    );

    expect(world.pagedIn(run.id!)).toEqual(["Carl Diaz", "Ana Lopez"]);
    expect(run.lastExecutedEscalationRuleOrder).toBe(1);
  });

  test("a page again nobody answers escalates as the first run did, then ends", async () => {
    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);
    world.advance(LEVEL_WAIT_IN_MINUTES);

    const run: OnCallDutyPolicyExecutionLog = pageAgainRun(
      await world.pageAgainTick(),
    );

    // The page again's Level 1 wait runs out: Level 2.
    world.advance(LEVEL_WAIT_IN_MINUTES);
    await world.escalationTick();
    expect(world.pagedIn(run.id!)).toEqual([
      "Dana Kim",
      "Ana Lopez",
      "Carl Diaz",
    ]);

    // And Level 2's: every rule went unanswered.
    world.advance(LEVEL_WAIT_IN_MINUTES);
    await world.escalationTick();

    const ended: OnCallDutyPolicyExecutionLog = world.runById(run.id!);
    expect(ended.status).toBe(OnCallDutyPolicyStatus.Completed);
    expect(ended.statusMessage).toBe(
      ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
    );

    // Nobody acknowledged it, so no clock starts: nobody is paged again.
    expect(world.runningClocks()).toEqual([]);
    world.advance(4 * 60);
    expect(pagedAgain(await world.pageAgainTick())).toEqual([]);
  });

  test("is not ended because its incident is acknowledged: it was all along", async () => {
    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);
    world.advance(LEVEL_WAIT_IN_MINUTES);

    const run: OnCallDutyPolicyExecutionLog = pageAgainRun(
      await world.pageAgainTick(),
    );

    world.advance(1);
    await world.escalationTick();

    expect(world.runById(run.id!).status).toBe(
      OnCallDutyPolicyStatus.Executing,
    );
  });
});

describe("the clock starts again at every new acknowledgement", () => {
  test("answering the page again: 30 minutes later it pages again, the new acknowledger first", async () => {
    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);
    world.advance(LEVEL_WAIT_IN_MINUTES);

    const first: OnCallDutyPolicyExecutionLog = pageAgainRun(
      await world.pageAgainTick(),
    );

    // Ana answers it at 03:40.
    world.advance(5);
    await world.answerPage(ANA, first.id!);

    const answered: OnCallDutyPolicyExecutionLog = world.runById(first.id!);
    expect(answered.status).toBe(OnCallDutyPolicyStatus.Completed);
    expect(answered.acknowledgedByUserId!.toString()).toBe(ANA.toString());
    expect(world.runningClocks()).toEqual([
      { runId: first.id!.toString(), startedAt: new Date(world.clock) },
    ]);

    // 03:40 + 29: nothing; + 30: page again 2.
    world.advance(LEVEL_WAIT_IN_MINUTES - 1);
    expect(pagedAgain(await world.pageAgainTick())).toEqual([]);
    world.advance(1);

    const second: OnCallDutyPolicyExecutionLog = pageAgainRun(
      await world.pageAgainTick(),
    );

    expect(second.pageAgainNumber).toBe(2);
    expect(world.pagedIn(second.id!)).toEqual(["Ana Lopez"]);
    expect(minutesAfterStart(world.clock)).toBe(70);
  });

  test("an answer to an older run's page does not move the clock: the policy's latest run holds it", async () => {
    world.ruleUsers[world.rules[0]!.id!.toString()] = [ANA, BOB];

    await world.startRun();
    world.advance(5);
    await world.answerPage(ANA, RUN_ID);
    world.advance(LEVEL_WAIT_IN_MINUTES);

    const again: OnCallDutyPolicyExecutionLog = pageAgainRun(
      await world.pageAgainTick(),
    );

    // Bob answers his page of the FIRST run, late.
    world.advance(3);
    await world.answerPage(BOB, RUN_ID);

    expect(world.runningClocks()).toEqual([]);
    expect(world.runById(again.id!).status).toBe(
      OnCallDutyPolicyStatus.Executing,
    );
  });

  test("a late answer to a page again nobody answered in time starts the clock on it", async () => {
    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);
    world.advance(LEVEL_WAIT_IN_MINUTES);

    const again: OnCallDutyPolicyExecutionLog = pageAgainRun(
      await world.pageAgainTick(),
    );

    // Nobody answers: Level 1, then Level 2, then the run ends.
    world.advance(LEVEL_WAIT_IN_MINUTES);
    await world.escalationTick();
    world.advance(LEVEL_WAIT_IN_MINUTES);
    await world.escalationTick();
    expect(world.runById(again.id!).status).toBe(
      OnCallDutyPolicyStatus.Completed,
    );

    // Carl answers his page of it ten minutes later.
    world.advance(10);
    await world.answerPage(CARL, again.id!);

    expect(world.runningClocks()).toEqual([
      { runId: again.id!.toString(), startedAt: new Date(world.clock) },
    ]);
  });

  test("moving on to a state after Acknowledged is no new acknowledgement", async () => {
    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);
    const startedAt: Date = new Date(world.clock);

    world.advance(15);
    await world.changeState(INVESTIGATING, DANA);

    expect(world.runningClocks()).toEqual([
      { runId: RUN_ID.toString(), startedAt: startedAt },
    ]);

    world.advance(15);
    expect(only(pagedAgain(await world.pageAgainTick())).pageAgainNumber).toBe(
      1,
    );
  });

  test("a state change back-dated to the past starts the clock from now", async () => {
    await world.startRun();
    world.advance(5);

    // Recorded at 03:05 as acknowledged at 01:00: the clock starts at 03:05.
    world.incident = { stateId: ACKNOWLEDGED };
    world.stateRows.push({
      incidentStateId: ACKNOWLEDGED,
      startsAt: new Date(START.getTime() - 2 * 60 * 60 * 1000),
      createdByUserId: DANA,
    });

    const { default: OnCallAcknowledgementTimeout } = await import(
      "../../../../Server/Utils/OnCall/OnCallAcknowledgementTimeout"
    );

    await OnCallAcknowledgementTimeout.onRecordStateChanged({
      kind: "incident",
      recordId: world.runById(RUN_ID).triggeredByIncidentId!,
      projectId: world.runById(RUN_ID).projectId!,
      stateId: ACKNOWLEDGED,
      previousStateId: CREATED,
    });

    expect(world.runningClocks()).toEqual([
      { runId: RUN_ID.toString(), startedAt: new Date(world.clock) },
    ]);
    expect(pagedAgain(await world.pageAgainTick())).toEqual([]);
  });
});

describe("pages again once for each time the timeout runs out", () => {
  test("two ticks at the same moment - two worker replicas - page again once", async () => {
    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);
    world.advance(LEVEL_WAIT_IN_MINUTES);

    const [one, two]: [
      Array<OnCallPageAgainResult>,
      Array<OnCallPageAgainResult>,
    ] = await Promise.all([world.pageAgainTick(), world.pageAgainTick()]);

    const outcomes: Array<OnCallPageAgainOutcome> = [...one, ...two]
      .map((result: OnCallPageAgainResult) => {
        return result.outcome;
      })
      .sort();

    expect(outcomes).toEqual(
      [
        OnCallPageAgainOutcome.PagedAgain,
        OnCallPageAgainOutcome.TakenElsewhere,
      ].sort(),
    );
    expect(world.pagesAgain()).toHaveLength(1);
  });

  test("the ticks after it page nobody until somebody acknowledges again", async () => {
    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);
    world.advance(LEVEL_WAIT_IN_MINUTES);
    pageAgainRun(await world.pageAgainTick());

    for (let minute: number = 0; minute < 120; minute++) {
      world.advance(1);
      expect(pagedAgain(await world.pageAgainTick())).toEqual([]);
    }

    expect(world.pagesAgain()).toHaveLength(1);
  });

  test("a clock started again in the moment the worker read it is left to run", async () => {
    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);
    world.advance(LEVEL_WAIT_IN_MINUTES);

    // The worker read the run with the clock as it was...
    const stale: OnCallDutyPolicyExecutionLog = Object.assign(
      Object.create(Object.getPrototypeOf(world.runById(RUN_ID))),
      world.runById(RUN_ID),
    ) as OnCallDutyPolicyExecutionLog;

    // ...and a new acknowledgement started it again before it claimed it.
    world.runById(RUN_ID).acknowledgementTimeoutStartedAt = new Date(
      world.clock,
    );

    const { default: OnCallAcknowledgementTimeout } = await import(
      "../../../../Server/Utils/OnCall/OnCallAcknowledgementTimeout"
    );

    const result: OnCallPageAgainResult =
      await OnCallAcknowledgementTimeout.pageAgainIfDue({
        run: stale,
        now: new Date(world.clock),
      });

    expect(result.outcome).toBe(OnCallPageAgainOutcome.TakenElsewhere);
    expect(world.pagesAgain()).toEqual([]);
    expect(world.runningClocks()).toHaveLength(1);
  });
});

describe("at most five times for one incident", () => {
  test("the fifth says it is the last, and an answer to it starts no clock", async () => {
    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);

    for (let time: number = 1; time <= 5; time++) {
      world.advance(LEVEL_WAIT_IN_MINUTES);

      const run: OnCallDutyPolicyExecutionLog = pageAgainRun(
        await world.pageAgainTick(),
      );

      expect(run.pageAgainNumber).toBe(time);

      world.advance(2);
      await world.answerPage(ANA, run.id!);
    }

    expect(
      world.feed.some((item: { markdown: string }) => {
        return item.markdown.includes(
          "is paging again (5 of 5, the last time): the incident is still not resolved",
        );
      }),
    ).toBe(true);

    expect(world.runningClocks()).toEqual([]);

    world.advance(24 * 60);
    expect(pagedAgain(await world.pageAgainTick())).toEqual([]);
    expect(world.pagesAgain()).toHaveLength(5);
  });

  test("a clock that somehow runs past the fifth stops without paging", async () => {
    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);

    for (let time: number = 1; time <= 5; time++) {
      world.advance(LEVEL_WAIT_IN_MINUTES);
      const run: OnCallDutyPolicyExecutionLog = pageAgainRun(
        await world.pageAgainTick(),
      );
      world.advance(2);
      await world.answerPage(ANA, run.id!);
    }

    // A clock written by hand on the fifth page again.
    world.latestRun().acknowledgementTimeoutStartedAt = new Date(world.clock);
    world.advance(LEVEL_WAIT_IN_MINUTES);

    const results: Array<OnCallPageAgainResult> = await world.pageAgainTick();

    expect(only(results).outcome).toBe(OnCallPageAgainOutcome.Stopped);
    expect(only(results).stoppedBecause).toBe(
      OnCallAcknowledgementTimeoutStop.NoPagesAgainLeft,
    );
    expect(world.runningClocks()).toEqual([]);
  });
});

describe("the clock stops", () => {
  test("when the incident is resolved: nobody is paged again", async () => {
    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);

    world.advance(15);
    await world.resolve(DANA);

    expect(world.runningClocks()).toEqual([]);

    world.advance(LEVEL_WAIT_IN_MINUTES * 4);
    expect(await world.pageAgainTick()).toEqual([]);
    expect(world.pagesAgain()).toEqual([]);
  });

  test("when a resolve was missed, at its moment, without paging", async () => {
    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);

    // Resolved without the state timeline's word reaching the clock.
    world.incident = { stateId: RESOLVED };
    world.advance(LEVEL_WAIT_IN_MINUTES);

    const result: OnCallPageAgainResult = only(await world.pageAgainTick());

    expect(result.outcome).toBe(OnCallPageAgainOutcome.Stopped);
    expect(result.stoppedBecause).toBe(
      OnCallAcknowledgementTimeoutStop.RecordResolved,
    );
    expect(world.runningClocks()).toEqual([]);
    expect(world.pagesAgain()).toEqual([]);
  });

  test("when the incident is deleted", async () => {
    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);

    world.incident = null;
    world.advance(LEVEL_WAIT_IN_MINUTES);

    const result: OnCallPageAgainResult = only(await world.pageAgainTick());

    expect(result.stoppedBecause).toBe(
      OnCallAcknowledgementTimeoutStop.RecordGone,
    );
    expect(world.pagesAgain()).toEqual([]);
  });

  test("when the incident is no longer acknowledged", async () => {
    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);

    world.incident = { stateId: CREATED };
    world.advance(LEVEL_WAIT_IN_MINUTES);

    expect(only(await world.pageAgainTick()).stoppedBecause).toBe(
      OnCallAcknowledgementTimeoutStop.RecordNotAcknowledged,
    );
  });

  test("at once when the timeout is turned off midway, before its moment", async () => {
    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);

    world.advance(10);
    world.policy.acknowledgementTimeoutInMinutes = null;

    const result: OnCallPageAgainResult = only(await world.pageAgainTick());

    expect(result.stoppedBecause).toBe(
      OnCallAcknowledgementTimeoutStop.TimeoutOff,
    );
    expect(world.runningClocks()).toEqual([]);

    // Turned on again: no old clock comes back.
    world.policy.acknowledgementTimeoutInMinutes = 30;
    world.advance(LEVEL_WAIT_IN_MINUTES);
    expect(await world.pageAgainTick()).toEqual([]);
  });

  test("when the policy is archived", async () => {
    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);

    world.policy.isArchived = true;
    world.advance(1);

    expect(only(await world.pageAgainTick()).stoppedBecause).toBe(
      OnCallAcknowledgementTimeoutStop.PolicyArchived,
    );
    expect(world.pagesAgain()).toEqual([]);
  });
});

describe("a timeout changed while its clock runs", () => {
  test("longer: pages again at the new moment, not the old one", async () => {
    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);

    world.advance(10);
    world.policy.acknowledgementTimeoutInMinutes = 60;

    world.advance(20);
    expect(pagedAgain(await world.pageAgainTick())).toEqual([]);

    world.advance(29);
    expect(pagedAgain(await world.pageAgainTick())).toEqual([]);

    world.advance(1);
    expect(only(pagedAgain(await world.pageAgainTick())).pageAgainNumber).toBe(
      1,
    );
    expect(minutesAfterStart(world.clock)).toBe(65);
  });

  test("shorter: pages again at the next tick once the new moment has passed", async () => {
    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);

    world.advance(12);
    world.policy.acknowledgementTimeoutInMinutes = 10;

    expect(only(pagedAgain(await world.pageAgainTick())).pageAgainNumber).toBe(
      1,
    );
    expect(
      world.feed.some((item: { markdown: string }) => {
        return item.markdown.includes("still not resolved 10 minutes after");
      }),
    ).toBe(true);
  });
});

describe("a page again can be escalated, like any page", () => {
  test("its person passes it to the next level at once, though the incident is acknowledged", async () => {
    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);
    world.advance(LEVEL_WAIT_IN_MINUTES);

    world.ruleUsers[world.rules[0]!.id!.toString()] = [ANA];
    const run: OnCallDutyPolicyExecutionLog = pageAgainRun(
      await world.pageAgainTick(),
    );

    // Dana and Ana are paged; both escalate.
    const fromDana: OnCallPassOnOutcome = (await world.escalate(DANA, run.id!))
      .result!.outcome;
    expect(fromDana).toBe(OnCallPassOnOutcome.OthersStillPaged);

    const answer: {
      passedOn: boolean;
      result?: { outcome: OnCallPassOnOutcome } | undefined;
    } = await world.escalate(ANA, run.id!);

    expect(answer.passedOn).toBe(true);
    expect(answer.result!.outcome).toBe(OnCallPassOnOutcome.NextRulePaged);
    expect(world.pagedIn(run.id!)).toEqual([
      "Dana Kim",
      "Ana Lopez",
      "Carl Diaz",
    ]);
  });

  test("once somebody answered it, it is taken: nothing to escalate", async () => {
    world.ruleUsers[world.rules[0]!.id!.toString()] = [ANA, BOB];

    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);
    world.advance(LEVEL_WAIT_IN_MINUTES);

    const run: OnCallDutyPolicyExecutionLog = pageAgainRun(
      await world.pageAgainTick(),
    );

    await world.answerPage(ANA, run.id!);

    const answer: {
      passedOn: boolean;
      refusal?: OnCallPassOnRefusal | undefined;
    } = await world.escalate(BOB, run.id!);

    expect(answer.passedOn).toBe(false);
    expect(answer.refusal).toBe(OnCallPassOnRefusal.RecordAcknowledged);
  });

  test("once its incident is resolved, it is taken too", async () => {
    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);
    world.advance(LEVEL_WAIT_IN_MINUTES);

    const run: OnCallDutyPolicyExecutionLog = pageAgainRun(
      await world.pageAgainTick(),
    );

    world.incident = { stateId: RESOLVED };

    expect((await world.escalate(ANA, run.id!)).refusal).toBe(
      OnCallPassOnRefusal.RecordAcknowledged,
    );
  });

  test("the first run's page is still taken once the incident is acknowledged, as before", async () => {
    world.ruleUsers[world.rules[0]!.id!.toString()] = [ANA, BOB];

    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);

    expect((await world.escalate(BOB, RUN_ID)).refusal).toBe(
      OnCallPassOnRefusal.RecordAcknowledged,
    );
  });
});

describe("one clock per incident and policy", () => {
  test("a policy run twice for the incident keeps its clock on its latest run", async () => {
    await world.startRun();

    // The policy is run again by hand for the same incident.
    world.advance(2);
    const again: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();
    again.id = new ObjectID("0f500000-0000-4000-8000-0000000000f9");
    again.projectId = world.runById(RUN_ID).projectId!;
    again.onCallDutyPolicyId = world.runById(RUN_ID).onCallDutyPolicyId!;
    again.triggeredByIncidentId = world.runById(RUN_ID).triggeredByIncidentId!;
    again.status = OnCallDutyPolicyStatus.Executing;
    again.createdAt = new Date(world.clock);
    world.addRunRow(again);

    world.advance(3);
    await world.acknowledgeInDashboard(DANA);

    expect(world.runningClocks()).toEqual([
      { runId: again.id!.toString(), startedAt: new Date(world.clock) },
    ]);

    world.advance(LEVEL_WAIT_IN_MINUTES);
    expect(pagedAgain(await world.pageAgainTick())).toHaveLength(1);
  });
});

/*
 * A page again's record was acknowledged all along, so the record's own
 * Acknowledge is gone from its page: the person paged again acknowledges
 * their page from the Dashboard instead (acknowledgePagesAgainForRecord),
 * and the record's header knows which of their open pages is a page again.
 */
describe("acknowledging a page again from the Dashboard", () => {
  async function pagedAgainAt(): Promise<OnCallDutyPolicyExecutionLog> {
    await world.startRun();
    world.advance(5);
    await world.acknowledgeInDashboard(DANA);
    world.advance(LEVEL_WAIT_IN_MINUTES);

    return pageAgainRun(await world.pageAgainTick());
  }

  test("answers the person's page again: it ends, they are paged no more, and the clock starts again", async () => {
    const run: OnCallDutyPolicyExecutionLog = await pagedAgainAt();

    world.advance(3);

    const acknowledged: number =
      await OnCallAcknowledgementTimeoutUtil.acknowledgePagesAgainForRecord({
        userId: ANA,
        projectId: run.projectId!,
        recordType: OnCallPageRecordType.Incident,
        recordId: run.triggeredByIncidentId!,
      });

    expect(acknowledged).toBe(1);

    const answered: OnCallDutyPolicyExecutionLog = world.runById(run.id!);
    expect(answered.status).toBe(OnCallDutyPolicyStatus.Completed);
    expect(answered.acknowledgedByUserId!.toString()).toBe(ANA.toString());
    expect(world.isStillPaging(ANA, run.id!)).toBe(false);
    expect(world.runningClocks()).toEqual([
      { runId: run.id!.toString(), startedAt: new Date(world.clock) },
    ]);
  });

  test("answers nothing for somebody it is not paging again", async () => {
    const run: OnCallDutyPolicyExecutionLog = await pagedAgainAt();

    expect(
      await OnCallAcknowledgementTimeoutUtil.acknowledgePagesAgainForRecord({
        userId: CARL,
        projectId: run.projectId!,
        recordType: OnCallPageRecordType.Incident,
        recordId: run.triggeredByIncidentId!,
      }),
    ).toBe(0);
    expect(world.runById(run.id!).status).toBe(
      OnCallDutyPolicyStatus.Executing,
    );
  });

  test("answers nothing once the incident is resolved: the page again is over", async () => {
    const run: OnCallDutyPolicyExecutionLog = await pagedAgainAt();

    world.incident = { stateId: RESOLVED };

    expect(
      await OnCallAcknowledgementTimeoutUtil.acknowledgePagesAgainForRecord({
        userId: ANA,
        projectId: run.projectId!,
        recordType: OnCallPageRecordType.Incident,
        recordId: run.triggeredByIncidentId!,
      }),
    ).toBe(0);
    expect(world.runningClocks()).toEqual([]);
  });

  test("never answers a page of the first run: that one is answered by acknowledging the incident", async () => {
    await world.startRun();

    expect(
      await OnCallAcknowledgementTimeoutUtil.acknowledgePagesAgainForRecord({
        userId: ANA,
        projectId: world.runById(RUN_ID).projectId!,
        recordType: OnCallPageRecordType.Incident,
        recordId: world.runById(RUN_ID).triggeredByIncidentId!,
      }),
    ).toBe(0);
    expect(world.runById(RUN_ID).status).toBe(OnCallDutyPolicyStatus.Executing);
    expect(world.incident!.stateId.toString()).toBe(CREATED.toString());
  });

  test("a second answer, from another tab, finds nothing left to answer", async () => {
    const run: OnCallDutyPolicyExecutionLog = await pagedAgainAt();

    const ask: () => Promise<number> = (): Promise<number> => {
      return OnCallAcknowledgementTimeoutUtil.acknowledgePagesAgainForRecord({
        userId: ANA,
        projectId: run.projectId!,
        recordType: OnCallPageRecordType.Incident,
        recordId: run.triggeredByIncidentId!,
      });
    };

    expect(await ask()).toBe(1);
    expect(await ask()).toBe(0);
  });

  test("the record's header learns which open page is a page again", async () => {
    const run: OnCallDutyPolicyExecutionLog = await pagedAgainAt();

    const pages: Array<OnCallOpenPage> =
      await OnCallPagePassOn.getOpenPagesForRecord({
        userId: ANA,
        projectId: run.projectId!,
        recordType: OnCallPageRecordType.Incident,
        recordId: run.triggeredByIncidentId!,
      });

    expect(pages).toHaveLength(1);
    expect(pages[0]!.executionLogId).toBe(run.id!.toString());
    expect(pages[0]!.isPageAgain).toBe(true);
  });

  test("a first run's open page is no page again", async () => {
    world.ruleUsers[world.rules[0]!.id!.toString()] = [ANA];
    await world.startRun();

    const pages: Array<OnCallOpenPage> =
      await OnCallPagePassOn.getOpenPagesForRecord({
        userId: ANA,
        projectId: world.runById(RUN_ID).projectId!,
        recordType: OnCallPageRecordType.Incident,
        recordId: world.runById(RUN_ID).triggeredByIncidentId!,
      });

    expect(pages).toHaveLength(1);
    expect("isPageAgain" in pages[0]!).toBe(false);
  });
});
