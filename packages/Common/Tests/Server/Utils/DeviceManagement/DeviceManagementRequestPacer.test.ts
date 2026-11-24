import { describe, expect, test } from "@jest/globals";
import DeviceManagementRequestPacer from "../../../../Server/Utils/DeviceManagement/DeviceManagementRequestPacer";
import { DeviceManagementBudgetSpent } from "../../../../Server/Utils/DeviceManagement/DeviceManagementTypes";

/*
 * The pace and the budget every device management API client shares
 * (Esper's, Intune's, #9837): requests a fixed spacing apart, half the pace
 * after a 429 down to a floor, a budget of requests and a deadline, and a
 * back-off with jitter for a retry the service names no wait for.
 */

function pacerOf(
  overrides: Partial<
    ConstructorParameters<typeof DeviceManagementRequestPacer>[0]
  > = {},
): {
  pacer: DeviceManagementRequestPacer;
  slept: Array<number>;
  clock: { ms: number };
} {
  const clock: { ms: number } = { ms: Date.UTC(2026, 10, 19, 12) };
  const slept: Array<number> = [];

  return {
    clock,
    slept,
    pacer: new DeviceManagementRequestPacer({
      now: (): Date => {
        return new Date(clock.ms);
      },
      sleep: async (milliseconds: number): Promise<void> => {
        slept.push(milliseconds);
        clock.ms += milliseconds;
      },
      random: (): number => {
        return 0.5;
      },
      requestsPerSecond: 5,
      minRequestsPerSecond: 0.5,
      maxBackoffSeconds: 30,
      ...overrides,
    }),
  };
}

describe("DeviceManagementRequestPacer", () => {
  test("starts requests one spacing apart, and counts each", async () => {
    const { pacer, slept } = pacerOf();

    await pacer.takeTurn();
    await pacer.takeTurn();
    await pacer.takeTurn();

    expect(slept).toEqual([200, 200]);
    expect(pacer.getRequestCount()).toBe(3);
  });

  test("halves its pace after a 429, never below the floor", () => {
    const { pacer } = pacerOf();

    pacer.slowDown();
    expect(pacer.getRequestsPerSecond()).toBe(2.5);

    for (let times: number = 0; times < 10; times++) {
      pacer.slowDown();
    }

    expect(pacer.getRequestsPerSecond()).toBe(0.5);
  });

  test("a request past its budget, or past its deadline, ends the read", async () => {
    const byCount: DeviceManagementRequestPacer = pacerOf({
      maxRequests: 1,
    }).pacer;

    expect(byCount.hasBudgetFor(1)).toBe(true);
    await byCount.takeTurn();
    expect(byCount.hasBudgetFor(1)).toBe(false);
    await expect(byCount.takeTurn()).rejects.toBeInstanceOf(
      DeviceManagementBudgetSpent,
    );

    const { pacer, clock } = pacerOf({
      deadlineMs: Date.UTC(2026, 10, 19, 12, 1),
    });
    await pacer.takeTurn();
    clock.ms += 60 * 1000;
    expect(pacer.hasBudgetFor(1)).toBe(false);
    await expect(pacer.takeTurn()).rejects.toBeInstanceOf(
      DeviceManagementBudgetSpent,
    );
  });

  test("backs off 2^n seconds, capped, with up to half of it added or taken", () => {
    expect(pacerOf().pacer.backoffMs(1)).toBe(2000);
    expect(pacerOf().pacer.backoffMs(10)).toBe(30000);
    expect(
      pacerOf({
        random: (): number => {
          return 0;
        },
      }).pacer.backoffMs(2),
    ).toBe(2000);
    expect(
      pacerOf({
        random: (): number => {
          return 1;
        },
      }).pacer.backoffMs(2),
    ).toBe(6000);
  });
});
