import SloStatus, {
  SLO_UNMEASURED_STATUSES,
  isSloUnmeasuredStatus,
} from "../../../Types/ServiceLevelObjective/SloStatus";
import { describe, expect, test } from "@jest/globals";

/*
 * The statuses an evaluation that measured nothing gives an SLO. The worker
 * re-enters the budget math from them as from Healthy, burn rate rules
 * cannot fire in them, and their feed item says what stops while they last:
 * each reads this one list, so a status of the worker's guards added later
 * (Waiting, #9354) is treated alike everywhere.
 */
describe("SLO statuses that measure nothing", () => {
  test("are the worker's three guard statuses", () => {
    expect([...SLO_UNMEASURED_STATUSES]).toEqual([
      SloStatus.Waiting,
      SloStatus.Misconfigured,
      SloStatus.Paused,
    ]);
  });

  test.each([SloStatus.Waiting, SloStatus.Misconfigured, SloStatus.Paused])(
    "%s measures nothing",
    (status: SloStatus) => {
      expect(isSloUnmeasuredStatus(status)).toBe(true);
    },
  );

  test.each([SloStatus.Healthy, SloStatus.AtRisk, SloStatus.BudgetExhausted])(
    "%s is measured",
    (status: SloStatus) => {
      expect(isSloUnmeasuredStatus(status)).toBe(false);
    },
  );

  test("an unset or unknown status is not taken for one that measures nothing", () => {
    expect(isSloUnmeasuredStatus(undefined)).toBe(false);
    expect(isSloUnmeasuredStatus(null)).toBe(false);
    expect(isSloUnmeasuredStatus("")).toBe(false);
    expect(isSloUnmeasuredStatus("waiting")).toBe(false);
    expect(isSloUnmeasuredStatus("Degraded")).toBe(false);
  });

  test("Waiting is listed between the measured statuses and Misconfigured, as the Status chip offers it", () => {
    expect(Object.values(SloStatus)).toEqual([
      "Healthy",
      "At Risk",
      "Budget Exhausted",
      "Waiting",
      "Misconfigured",
      "Paused",
    ]);
  });
});
