import CriteriaFilterUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil as CommonCriteriaFilterUtil,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { describe, expect, test } from "@jest/globals";

/*
 * The criteria form of an NTP monitor: which checks it offers, which
 * conditions each check takes, what a new filter starts on and what the
 * threshold box suggests. A filter on a check this monitor does not have
 * would never match, so every one of these is pinned.
 */

function values(options: Array<DropdownOption>): Array<string> {
  return options.map((option: DropdownOption) => {
    return option.value.toString();
  });
}

const NTP_CHECK_ONS: Array<CheckOn> = [
  CheckOn.NtpIsOnline,
  CheckOn.NtpIsSynchronized,
  CheckOn.NtpStratum,
  CheckOn.NtpClockOffset,
  CheckOn.NtpResponseTime,
  CheckOn.NtpRootDispersion,
];

describe("an NTP monitor's criteria form", () => {
  test("offers the six NTP checks and nothing else", () => {
    expect(
      values(
        CriteriaFilterUtil.getCheckOnOptionsByMonitorType(MonitorType.NTP),
      ),
    ).toEqual(NTP_CHECK_ONS);
  });

  test("no other monitor type offers an NTP check", () => {
    for (const monitorType of Object.values(MonitorType)) {
      if (monitorType === MonitorType.NTP) {
        continue;
      }

      const offered: Array<string> = values(
        CriteriaFilterUtil.getCheckOnOptionsByMonitorType(monitorType),
      );

      for (const checkOn of NTP_CHECK_ONS) {
        expect({ monitorType, offersNtp: offered.includes(checkOn) }).toEqual({
          monitorType,
          offersNtp: false,
        });
      }
    }
  });

  test("an NTP monitor does not offer the generic Is Online check", () => {
    expect(
      values(
        CriteriaFilterUtil.getCheckOnOptionsByMonitorType(MonitorType.NTP),
      ),
    ).not.toContain(CheckOn.IsOnline);
  });

  test.each([CheckOn.NtpIsOnline, CheckOn.NtpIsSynchronized])(
    "%s is True or False",
    (checkOn: CheckOn) => {
      expect(
        values(CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(checkOn)),
      ).toEqual([FilterType.True, FilterType.False]);
    },
  );

  test.each([
    CheckOn.NtpClockOffset,
    CheckOn.NtpResponseTime,
    CheckOn.NtpRootDispersion,
  ])("%s compares a number of milliseconds", (checkOn: CheckOn) => {
    expect(
      [
        ...values(CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(checkOn)),
      ].sort(),
    ).toEqual(
      [
        FilterType.GreaterThan,
        FilterType.LessThan,
        FilterType.GreaterThanOrEqualTo,
        FilterType.LessThanOrEqualTo,
      ].sort(),
    );
  });

  test("NTP Stratum also takes Equal To and Not Equal To, Greater Than first", () => {
    expect(
      values(
        CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(CheckOn.NtpStratum),
      ),
    ).toEqual([
      FilterType.GreaterThan,
      FilterType.GreaterThanOrEqualTo,
      FilterType.LessThan,
      FilterType.LessThanOrEqualTo,
      FilterType.EqualTo,
      FilterType.NotEqualTo,
    ]);
  });

  test("a new filter starts on NTP Is Online / True", () => {
    expect(
      CriteriaFilterUtil.getDefaultCriteriaFilter(MonitorType.NTP),
    ).toEqual({
      checkOn: CheckOn.NtpIsOnline,
      filterType: FilterType.True,
      value: "",
    });
  });

  test("the threshold box suggests a value for each measured check", () => {
    expect(
      [
        CheckOn.NtpClockOffset,
        CheckOn.NtpStratum,
        CheckOn.NtpRootDispersion,
        CheckOn.NtpResponseTime,
      ].map((checkOn: CheckOn) => {
        return CriteriaFilterUtil.getFilterTypePlaceholderValueByCheckOn({
          monitorType: MonitorType.NTP,
          checkOn: checkOn,
        });
      }),
    ).toEqual(["100", "2", "500", "1000"]);
  });

  test("a millisecond threshold reads with its unit", () => {
    const filter: CriteriaFilter = {
      checkOn: CheckOn.NtpClockOffset,
      filterType: FilterType.GreaterThan,
      value: 100,
    };

    expect(
      CriteriaFilterUtil.translateFilterToText(filter, FilterCondition.All),
    ).toContain("100ms");
  });

  test("a stratum threshold has no unit", () => {
    const filter: CriteriaFilter = {
      checkOn: CheckOn.NtpStratum,
      filterType: FilterType.GreaterThan,
      value: 2,
    };

    const text: string = CriteriaFilterUtil.translateFilterToText(
      filter,
      FilterCondition.All,
    );

    expect(text).toContain("2");
    expect(text).not.toContain("2ms");
    expect(text).not.toContain("2%");
  });

  test("a filter switched to another monitor type that has no NTP checks is dropped, not inverted", () => {
    expect(
      CriteriaFilterUtil.repairCriteriaFilterForMonitorType({
        criteriaFilter: {
          checkOn: CheckOn.NtpIsSynchronized,
          filterType: FilterType.False,
          value: undefined,
        },
        monitorType: MonitorType.Ping,
      }),
    ).toBeNull();
  });

  test("an NTP filter stays as it is on an NTP monitor", () => {
    const filter: CriteriaFilter = {
      checkOn: CheckOn.NtpStratum,
      filterType: FilterType.EqualTo,
      value: "1",
    };

    expect(
      CriteriaFilterUtil.repairCriteriaFilterForMonitorType({
        criteriaFilter: filter,
        monitorType: MonitorType.NTP,
      }),
    ).toBe(filter);
  });
});

describe("NTP checks over a period of time", () => {
  test.each(NTP_CHECK_ONS)("%s can be judged over time", (checkOn: CheckOn) => {
    expect(CommonCriteriaFilterUtil.isEvaluateOverTimeFilter(checkOn)).toBe(
      true,
    );
  });

  test("the two true/false checks offer only All Values and Any Value", () => {
    for (const checkOn of [CheckOn.NtpIsOnline, CheckOn.NtpIsSynchronized]) {
      expect(CommonCriteriaFilterUtil.isBooleanSeries(checkOn)).toBe(true);
      expect(
        CommonCriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter({
          checkOn: checkOn,
          filterType: FilterType.True,
          value: undefined,
        }),
      ).toEqual([
        EvaluateOverTimeType.AllValues,
        EvaluateOverTimeType.AnyValue,
      ]);
    }
  });

  test("the measured checks are not true/false series", () => {
    for (const checkOn of [
      CheckOn.NtpStratum,
      CheckOn.NtpClockOffset,
      CheckOn.NtpResponseTime,
      CheckOn.NtpRootDispersion,
    ]) {
      expect(CommonCriteriaFilterUtil.isBooleanSeries(checkOn)).toBe(false);
    }
  });

  test("the true/false checks take no value", () => {
    for (const checkOn of NTP_CHECK_ONS) {
      expect({
        checkOn,
        hasValueField: CommonCriteriaFilterUtil.hasValueField({
          checkOn: checkOn,
          filterType:
            checkOn === CheckOn.NtpIsOnline ||
            checkOn === CheckOn.NtpIsSynchronized
              ? FilterType.True
              : FilterType.GreaterThan,
        }),
      }).toEqual({
        checkOn,
        hasValueField:
          checkOn !== CheckOn.NtpIsOnline &&
          checkOn !== CheckOn.NtpIsSynchronized,
      });
    }
  });
});
