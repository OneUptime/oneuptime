import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import {
  OnCallPageAgainOutcome,
  OnCallPageAgainResult,
} from "../../../../Server/Utils/OnCall/OnCallAcknowledgementTimeout";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import AcknowledgementTimeoutWorld from "./AcknowledgementTimeoutWorld";
import { ANA, CARL, DANA, RUN_ID } from "./PassOnWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A PAGE AGAIN WHOSE RUN COULD NOT BE WRITTEN (issue #8514).
 *
 * Thirty minutes after an incident was acknowledged and not resolved, the
 * policy pages again: the acknowledgement clock is stopped first - a claim,
 * so two ticks page again once - and then the page again's run is written.
 * A database error as it was written left the clock stopped and no run:
 * nobody was paged, and the clock never ran out again, so the person who
 * acknowledged was never reminded.
 *
 * Now the clock is given back when the run was never written, and the next
 * tick pages again. One whose run was written is not: it pages from there.
 *
 * Driven through the real clock (OnCallAcknowledgementTimeout) and
 * startPageAgain over AcknowledgementTimeoutWorld.
 */

type AnyFunction = (...args: Array<any>) => any;

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

// The page again's run is written - after `failures` writes that failed.
function writesFailFirst(failures: number): void {
  const create: AnyFunction = (
    OnCallDutyPolicyExecutionLogService.create as unknown as {
      getMockImplementation: () => AnyFunction;
    }
  ).getMockImplementation();
  let left: number = failures;

  jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "create")
    .mockImplementation((async (...args: Array<unknown>) => {
      if (left > 0) {
        left--;
        throw Object.assign(new Error("Connection terminated unexpectedly"), {
          code: "ECONNRESET",
        });
      }

      return await create(...args);
    }) as never);
}

async function acknowledgedAndLeft(): Promise<void> {
  await world.startRun();

  world.advance(5);
  await world.acknowledgeInDashboard(DANA);

  // The first run ends: the incident is acknowledged.
  world.advance(1);
  await world.escalationTick();

  world.advance(LEVEL_WAIT_IN_MINUTES);
}

describe("a page again whose run could not be written", () => {
  test("REGRESSION: gives its clock back, and the next tick pages again - whoever acknowledged first", async () => {
    await acknowledgedAndLeft();
    writesFailFirst(1);

    const failed: Array<OnCallPageAgainResult> = await world.pageAgainTick();

    expect(pagedAgain(failed)).toEqual([]);
    expect(world.pagesAgain()).toEqual([]);
    // The clock runs again, from when it first started.
    expect(world.runningClocks()).toHaveLength(1);
    expect(world.runningClocks()[0]!.runId).toBe(RUN_ID.toString());

    world.advance(1);
    const results: Array<OnCallPageAgainResult> = await world.pageAgainTick();

    expect(pagedAgain(results)).toHaveLength(1);
    expect(world.pagesAgain()).toHaveLength(1);

    const run: OnCallDutyPolicyExecutionLog = world.runById(
      pagedAgain(results)[0]!.pageAgainRunId!,
    );

    expect(world.pagedIn(run.id!)).toEqual(["Dana Kim", "Ana Lopez"]);
    expect(run.pageAgainNumber).toBe(1);
  });

  test("a run that keeps failing to be written is tried at each tick, and pages again once it is", async () => {
    await acknowledgedAndLeft();
    writesFailFirst(3);

    for (let tick: number = 0; tick < 3; tick++) {
      expect(pagedAgain(await world.pageAgainTick())).toEqual([]);
      world.advance(1);
    }

    expect(pagedAgain(await world.pageAgainTick())).toHaveLength(1);
    expect(world.pagesAgain()).toHaveLength(1);
  });
});

describe("a page again whose run was written", () => {
  test("keeps its clock stopped, and pages from its run: nobody is paged again twice", async () => {
    await acknowledgedAndLeft();

    const run: OnCallDutyPolicyExecutionLog = world.runById(
      pagedAgain(await world.pageAgainTick())[0]!.pageAgainRunId!,
    );

    expect(world.runningClocks()).toEqual([]);

    world.advance(1);
    expect(pagedAgain(await world.pageAgainTick())).toEqual([]);
    expect(world.pagesAgain()).toHaveLength(1);
    expect(world.pagedIn(run.id!)).toEqual(["Dana Kim", "Ana Lopez"]);
    expect(run.status).toBe(OnCallDutyPolicyStatus.Executing);
  });
});
