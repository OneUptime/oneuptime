import ProfileMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/ProfileMonitorCriteria";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import ProfileMonitorResponse from "../../../../../Types/Monitor/ProfileMonitor/ProfileMonitorResponse";
import DataToProcess from "../../../../../Server/Utils/Monitor/DataToProcess";
import ObjectID from "../../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * ProfileMonitorCriteria is the ProfileCount analogue of LogMonitorCriteria /
 * ExceptionMonitorCriteria: it only understands CheckOn.ProfileCount, coerces
 * the criteria value into a number, defaults a missing profileCount to 0, and
 * defers the actual numeric comparison to CompareCriteria.compareCriteriaNumbers.
 * Everything else falls through to null. These tests exercise each of those
 * branches directly through the public static method.
 */
function buildResponse(profileCount: number | undefined): DataToProcess {
  const response: Partial<ProfileMonitorResponse> = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    profileCount: profileCount as number,
    profileQuery: {},
  };
  return response as DataToProcess;
}

function evaluate(
  profileCount: number | undefined,
  criteriaFilter: CriteriaFilter,
): Promise<string | null> {
  return ProfileMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: buildResponse(profileCount),
    criteriaFilter,
  });
}

describe("ProfileMonitorCriteria.isMonitorInstanceCriteriaFilterMet", () => {
  describe("ProfileCount GreaterThan", () => {
    test("count above threshold → met with a descriptive message", async () => {
      const result: string | null = await evaluate(10, {
        checkOn: CheckOn.ProfileCount,
        filterType: FilterType.GreaterThan,
        value: 5,
      });
      expect(result).toBeTruthy();
      expect(result).toContain("Profile Count");
      expect(result).toContain("greater than");
    });

    test("count equal to threshold → not met (strict comparison)", async () => {
      expect(
        await evaluate(5, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.GreaterThan,
          value: 5,
        }),
      ).toBeNull();
    });

    test("count below threshold → not met", async () => {
      expect(
        await evaluate(2, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.GreaterThan,
          value: 5,
        }),
      ).toBeNull();
    });
  });

  describe("ProfileCount LessThan", () => {
    test("count below threshold → met", async () => {
      expect(
        await evaluate(2, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.LessThan,
          value: 5,
        }),
      ).toBeTruthy();
    });

    test("count equal to threshold → not met", async () => {
      expect(
        await evaluate(5, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.LessThan,
          value: 5,
        }),
      ).toBeNull();
    });

    test("count above threshold → not met", async () => {
      expect(
        await evaluate(9, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.LessThan,
          value: 5,
        }),
      ).toBeNull();
    });
  });

  describe("ProfileCount EqualTo (the default no-profiles offline criteria)", () => {
    test("zero profiles equal to 0 → met (monitor goes offline)", async () => {
      const result: string | null = await evaluate(0, {
        checkOn: CheckOn.ProfileCount,
        filterType: FilterType.EqualTo,
        value: 0,
      });
      expect(result).toBeTruthy();
      expect(result).toContain("equal to 0");
    });

    test("some profiles equal to 0 → not met", async () => {
      expect(
        await evaluate(7, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.EqualTo,
          value: 0,
        }),
      ).toBeNull();
    });

    test("matching non-zero count → met", async () => {
      expect(
        await evaluate(42, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.EqualTo,
          value: 42,
        }),
      ).toBeTruthy();
    });
  });

  describe("ProfileCount NotEqualTo", () => {
    test("different count → met", async () => {
      expect(
        await evaluate(4, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.NotEqualTo,
          value: 0,
        }),
      ).toBeTruthy();
    });

    test("same count → not met", async () => {
      expect(
        await evaluate(4, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.NotEqualTo,
          value: 4,
        }),
      ).toBeNull();
    });
  });

  describe("ProfileCount boundary comparators", () => {
    test("GreaterThanOrEqualTo → met exactly at the boundary", async () => {
      expect(
        await evaluate(5, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.GreaterThanOrEqualTo,
          value: 5,
        }),
      ).toBeTruthy();
    });

    test("GreaterThanOrEqualTo → not met just below the boundary", async () => {
      expect(
        await evaluate(4, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.GreaterThanOrEqualTo,
          value: 5,
        }),
      ).toBeNull();
    });

    test("LessThanOrEqualTo → met exactly at the boundary", async () => {
      expect(
        await evaluate(5, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.LessThanOrEqualTo,
          value: 5,
        }),
      ).toBeTruthy();
    });

    test("LessThanOrEqualTo → not met just above the boundary", async () => {
      expect(
        await evaluate(6, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.LessThanOrEqualTo,
          value: 5,
        }),
      ).toBeNull();
    });
  });

  /*
   * The exact production shape of a "profile presence" alert: criteria
   * "Profile Count >= 1" flips the monitor Offline the moment a matching
   * profile is ingested. Mirrors the log-presence offline criteria and keeps
   * the count-based criteria in lock-step.
   */
  describe("profile-presence offline criteria (Profile Count >= 1)", () => {
    const offlineCriteria: CriteriaFilter = {
      checkOn: CheckOn.ProfileCount,
      filterType: FilterType.GreaterThanOrEqualTo,
      value: 1,
    };

    test("one matching profile → met (monitor goes offline)", async () => {
      const result: string | null = await evaluate(1, offlineCriteria);
      expect(result).toBeTruthy();
      expect(result).toContain("Profile Count");
    });

    test("many matching profiles → met", async () => {
      expect(await evaluate(6718284, offlineCriteria)).toBeTruthy();
    });

    test("zero matching profiles → not met (monitor stays operational)", async () => {
      expect(await evaluate(0, offlineCriteria)).toBeNull();
    });
  });

  describe("value coercion and defaulting", () => {
    test("a missing profileCount is defaulted to 0", async () => {
      /*
       * undefined profileCount → 0 via the `|| 0` fallback, so "equal to 0"
       * is met and "greater than 0" is not.
       */
      expect(
        await evaluate(undefined, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.EqualTo,
          value: 0,
        }),
      ).toBeTruthy();
      expect(
        await evaluate(undefined, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.GreaterThan,
          value: 0,
        }),
      ).toBeNull();
    });

    test("a string threshold is coerced to a number", async () => {
      expect(
        await evaluate(10, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.GreaterThan,
          value: "5",
        }),
      ).toBeTruthy();
    });

    test("a decimal string threshold is truncated by parseInt", async () => {
      /*
       * convertToNumber runs parseInt on strings, so "5.9" becomes 5. A count
       * of 6 is therefore greater than the truncated threshold, while a count
       * of 5 (equal to the truncated value) is not.
       */
      expect(
        await evaluate(6, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.GreaterThan,
          value: "5.9",
        }),
      ).toBeTruthy();
      expect(
        await evaluate(5, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.GreaterThan,
          value: "5.9",
        }),
      ).toBeNull();
    });

    test("a numeric decimal threshold is preserved (no parseInt)", async () => {
      /*
       * A numeric (non-string) value is passed through unchanged, so the
       * fractional part of 2.5 still participates in the comparison.
       */
      expect(
        await evaluate(3, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.GreaterThan,
          value: 2.5,
        }),
      ).toBeTruthy();
      expect(
        await evaluate(2, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.GreaterThan,
          value: 2.5,
        }),
      ).toBeNull();
    });

    test("a non-numeric string threshold makes the criterion inert (null)", async () => {
      /*
       * parseInt("abc") is NaN, which convertToNumber normalizes to null;
       * compareCriteriaNumbers then bails out with null rather than firing a
       * broken comparison against NaN.
       */
      expect(
        await evaluate(100, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.GreaterThan,
          value: "not-a-number",
        }),
      ).toBeNull();
    });

    test("an undefined threshold value makes the criterion inert (null)", async () => {
      expect(
        await evaluate(100, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.GreaterThan,
          value: undefined,
        }),
      ).toBeNull();
    });
  });

  describe("unhandled configurations return null", () => {
    test("a non-ProfileCount checkOn is not handled", async () => {
      expect(
        await evaluate(100, {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.GreaterThan,
          value: 0,
        }),
      ).toBeNull();
    });

    test("a string-only filterType (Contains) has no numeric handler", async () => {
      expect(
        await evaluate(5, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.Contains,
          value: 5,
        }),
      ).toBeNull();
    });

    test("an empty-check filterType (IsEmpty) has no numeric handler", async () => {
      expect(
        await evaluate(5, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.IsEmpty,
          value: 5,
        }),
      ).toBeNull();
    });

    test("a boolean filterType (True) has no numeric handler", async () => {
      expect(
        await evaluate(5, {
          checkOn: CheckOn.ProfileCount,
          filterType: FilterType.True,
          value: 5,
        }),
      ).toBeNull();
    });

    test("an undefined filterType is not handled", async () => {
      expect(
        await evaluate(5, {
          checkOn: CheckOn.ProfileCount,
          filterType: undefined,
          value: 5,
        }),
      ).toBeNull();
    });
  });
});
