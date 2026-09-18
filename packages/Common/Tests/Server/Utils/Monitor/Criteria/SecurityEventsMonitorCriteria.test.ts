import SecurityEventsMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/SecurityEventsMonitorCriteria";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import SecurityEventsMonitorResponse from "../../../../../Types/Monitor/SecurityEventsMonitor/SecurityEventsMonitorResponse";
import DataToProcess from "../../../../../Server/Utils/Monitor/DataToProcess";
import ObjectID from "../../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * SecurityEventsMonitorCriteria is what turns the securityEventCount the
 * worker produces into an online/offline verdict. It only understands
 * CheckOn.SecurityEventCount — the sole check the Security Events criteria
 * UI offers — and defers the numeric comparison to CompareCriteria.
 */
function buildResponse(securityEventCount: number | undefined): DataToProcess {
  const response: Partial<SecurityEventsMonitorResponse> = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    securityEventCount: securityEventCount as number,
    securityEventQuery: {},
  };
  return response as DataToProcess;
}

function evaluate(
  securityEventCount: number | undefined,
  criteriaFilter: CriteriaFilter,
): Promise<string | null> {
  return SecurityEventsMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: buildResponse(securityEventCount),
    criteriaFilter,
  });
}

describe("SecurityEventsMonitorCriteria.isMonitorInstanceCriteriaFilterMet", () => {
  describe("SecurityEventCount GreaterThan", () => {
    test("count above threshold → met", async () => {
      const result: string | null = await evaluate(5, {
        checkOn: CheckOn.SecurityEventCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      });
      expect(result).toBeTruthy();
      expect(result).toContain("Security Event Count");
    });

    test("count equal to threshold → not met", async () => {
      expect(
        await evaluate(3, {
          checkOn: CheckOn.SecurityEventCount,
          filterType: FilterType.GreaterThan,
          value: 3,
        }),
      ).toBeNull();
    });

    test("count below threshold → not met", async () => {
      expect(
        await evaluate(0, {
          checkOn: CheckOn.SecurityEventCount,
          filterType: FilterType.GreaterThan,
          value: 0,
        }),
      ).toBeNull();
    });
  });

  describe("SecurityEventCount LessThan", () => {
    test("count below threshold → met", async () => {
      expect(
        await evaluate(2, {
          checkOn: CheckOn.SecurityEventCount,
          filterType: FilterType.LessThan,
          value: 5,
        }),
      ).toBeTruthy();
    });

    test("count at threshold → not met", async () => {
      expect(
        await evaluate(5, {
          checkOn: CheckOn.SecurityEventCount,
          filterType: FilterType.LessThan,
          value: 5,
        }),
      ).toBeNull();
    });
  });

  describe("SecurityEventCount EqualTo", () => {
    test("zero events equal to 0 → met", async () => {
      expect(
        await evaluate(0, {
          checkOn: CheckOn.SecurityEventCount,
          filterType: FilterType.EqualTo,
          value: 0,
        }),
      ).toBeTruthy();
    });

    test("some events not equal to 0 → not met", async () => {
      expect(
        await evaluate(7, {
          checkOn: CheckOn.SecurityEventCount,
          filterType: FilterType.EqualTo,
          value: 0,
        }),
      ).toBeNull();
    });
  });

  describe("edge cases", () => {
    test("a missing securityEventCount is treated as 0", async () => {
      // undefined securityEventCount → 0; "equal to 0" is therefore met.
      expect(
        await evaluate(undefined, {
          checkOn: CheckOn.SecurityEventCount,
          filterType: FilterType.EqualTo,
          value: 0,
        }),
      ).toBeTruthy();
    });

    test("a string threshold is coerced to a number", async () => {
      expect(
        await evaluate(10, {
          checkOn: CheckOn.SecurityEventCount,
          filterType: FilterType.GreaterThan,
          value: "5",
        }),
      ).toBeTruthy();
    });

    test("a non-SecurityEventCount checkOn returns null (unhandled)", async () => {
      expect(
        await evaluate(100, {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.GreaterThan,
          value: 0,
        }),
      ).toBeNull();
    });
  });
});
