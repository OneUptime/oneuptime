import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import IncidentService from "../../../../Server/Services/IncidentService";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import AcknowledgementTimeoutWorld, {
  ACKNOWLEDGED,
  CREATED,
} from "./AcknowledgementTimeoutWorld";
import { ANA, DANA, RUN_ID } from "./PassOnWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ANSWERING AN OBSERVER'S PAGE, END TO END (OnCallObserverPage).
 *
 * "There is an org level oversight incident team X that needs to have
 * oversight but not necessarily be managing the incident since team Y is
 * already on it. How can team X be paged but not be added to the response
 * team?"
 *
 * These run the real code - the escalation rule paging its people, the
 * acknowledge hook every way of answering a page reaches
 * (UserOnCallLogTimelineService.acknowledgePage), the acknowledgement
 * timeout's clock - in an in-memory world (AcknowledgementTimeoutWorld), on
 * a run that pages as observers. Answering it says the person has seen it,
 * and nothing more: the incident is not acknowledged, so nobody else's
 * page stops and nobody becomes its Incident Commander, and the policy
 * never pages again for it.
 *
 * The policy, Payments, pages Ana at Level 1, waits 30 minutes, then Carl
 * at Level 2. Its acknowledgement timeout is 30 minutes.
 */

let world: AcknowledgementTimeoutWorld;

beforeEach(() => {
  world = new AcknowledgementTimeoutWorld();
  world.install();
  world.addRule({ order: 1, users: [ANA] });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The world's run, paging as observers.
async function startObserverRun(): Promise<OnCallDutyPolicyExecutionLog> {
  await world.startRun();

  const run: OnCallDutyPolicyExecutionLog = world.runById(RUN_ID);
  run.isObserverPage = true;

  return run;
}

describe("an observer answers their page", () => {
  test("the incident stays as it was: not acknowledged, no state written", async () => {
    const acknowledgeIncident: jest.SpiedFunction<
      typeof IncidentService.acknowledgeIncident
    > = jest.spyOn(
      IncidentService,
      "acknowledgeIncident",
    ) as unknown as jest.SpiedFunction<
      typeof IncidentService.acknowledgeIncident
    >;

    await startObserverRun();

    world.advance(5);
    await world.answerPage(ANA, RUN_ID);

    expect(acknowledgeIncident).not.toHaveBeenCalled();
    expect(world.incident!.stateId.toString()).toBe(CREATED.toString());
    expect(world.stateRows).toEqual([]);
  });

  test("their page, and the run, end: it was answered - with who saw it, and what it did not do", async () => {
    await startObserverRun();

    world.advance(5);
    await world.answerPage(ANA, RUN_ID);

    const run: OnCallDutyPolicyExecutionLog = world.runById(RUN_ID);

    expect(run.status).toBe(OnCallDutyPolicyStatus.Completed);
    expect(run.acknowledgedByUserId?.toString()).toBe(ANA.toString());
    expect(run.statusMessage).toMatch(/^Seen by .+, paged as an observer\./);
    expect(run.statusMessage).toContain(
      "The incident is not acknowledged by this.",
    );
    expect(world.isStillPaging(ANA, RUN_ID)).toBe(false);
  });

  test("no acknowledgement timeout starts, and the policy never pages again for it", async () => {
    await startObserverRun();

    world.advance(5);
    await world.answerPage(ANA, RUN_ID);

    expect(world.runningClocks()).toEqual([]);

    for (let minute: number = 0; minute < 3 * 60; minute += 15) {
      world.advance(15);
      expect(await world.pageAgainTick()).toEqual([]);
    }

    expect(world.pagesAgain()).toEqual([]);
  });
});

describe("the responders acknowledge the incident", () => {
  test("no clock starts on the observers' run: getting it resolved is the responders' work", async () => {
    await startObserverRun();

    world.advance(5);
    await world.acknowledgeInDashboard(DANA);

    expect(world.incident!.stateId.toString()).toBe(ACKNOWLEDGED.toString());
    expect(world.runningClocks()).toEqual([]);

    world.advance(45);
    expect(await world.pageAgainTick()).toEqual([]);
    expect(world.pagesAgain()).toEqual([]);
  });

  test("a responder's run of the same policy, answered, still starts its clock as it always has", async () => {
    await world.startRun();

    world.advance(5);
    await world.answerPage(ANA, RUN_ID);

    expect(world.incident!.stateId.toString()).toBe(ACKNOWLEDGED.toString());
    expect(world.runningClocks().length).toBe(1);
  });
});
