import CriteriaFilterUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import {
  getMonitorThisProbeRoute,
  MONITOR_THIS_PROBE_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/MonitorThisProbe";
import Route from "../../../Types/API/Route";
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
 * The criteria form of a Probe Status monitor: it counts the probes the
 * monitor watches, connected and disconnected, so it offers those two
 * checks and the whole-number comparisons - and nothing that would never
 * match. "A probe is down" is the rule nearly everyone writes, so it is
 * what a new filter starts on.
 */

const PROBE_STATUS_CHECK_ONS: Array<CheckOn> = [
  CheckOn.DisconnectedProbes,
  CheckOn.ConnectedProbes,
];

function values(options: Array<DropdownOption>): Array<string> {
  return options.map((option: DropdownOption) => {
    return option.value.toString();
  });
}

describe("a Probe Status monitor's criteria form", () => {
  test("offers the two probe counts, Disconnected Probes first, and nothing else", () => {
    expect(
      values(
        CriteriaFilterUtil.getCheckOnOptionsByMonitorType(
          MonitorType.ProbeStatus,
        ),
      ),
    ).toEqual(PROBE_STATUS_CHECK_ONS);
  });

  test("no other monitor type offers a probe count", () => {
    for (const monitorType of Object.values(MonitorType)) {
      if (monitorType === MonitorType.ProbeStatus) {
        continue;
      }

      const offered: Array<string> = values(
        CriteriaFilterUtil.getCheckOnOptionsByMonitorType(monitorType),
      );

      expect({
        monitorType,
        offersProbeCounts: PROBE_STATUS_CHECK_ONS.some((checkOn: CheckOn) => {
          return offered.includes(checkOn);
        }),
      }).toEqual({ monitorType, offersProbeCounts: false });
    }
  });

  test.each(PROBE_STATUS_CHECK_ONS)(
    "%s compares a whole number, Greater Than first",
    (checkOn: CheckOn) => {
      expect(
        values(CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(checkOn)),
      ).toEqual([
        FilterType.GreaterThan,
        FilterType.GreaterThanOrEqualTo,
        FilterType.LessThan,
        FilterType.LessThanOrEqualTo,
        FilterType.EqualTo,
        FilterType.NotEqualTo,
      ]);
    },
  );

  test("a new filter starts on 'Disconnected Probes is greater than'", () => {
    const filter: CriteriaFilter = CriteriaFilterUtil.getDefaultCriteriaFilter(
      MonitorType.ProbeStatus,
    );

    expect(filter.checkOn).toBe(CheckOn.DisconnectedProbes);
    expect(filter.filterType).toBe(FilterType.GreaterThan);
  });

  test("the threshold box suggests the rule people write", () => {
    expect(
      CriteriaFilterUtil.getFilterTypePlaceholderValueByCheckOn({
        monitorType: MonitorType.ProbeStatus,
        checkOn: CheckOn.DisconnectedProbes,
      }),
    ).toBe("0");
    expect(
      CriteriaFilterUtil.getFilterTypePlaceholderValueByCheckOn({
        monitorType: MonitorType.ProbeStatus,
        checkOn: CheckOn.ConnectedProbes,
      }),
    ).toBe("1");
  });

  test("a rule reads as the count it compares, with no unit", () => {
    const text: string = CriteriaFilterUtil.translateFilterToText(
      {
        checkOn: CheckOn.DisconnectedProbes,
        filterType: FilterType.GreaterThan,
        value: 0,
      },
      FilterCondition.Any,
    );

    expect(text).toContain("Disconnected Probes");
    expect(text).toContain("0");
    expect(text).not.toContain("0ms");
    expect(text).not.toContain("0%");
  });

  test("each count takes a value", () => {
    for (const checkOn of PROBE_STATUS_CHECK_ONS) {
      expect(
        CommonCriteriaFilterUtil.hasValueField({
          checkOn: checkOn,
          filterType: FilterType.GreaterThan,
        }),
      ).toBe(true);
    }
  });

  test("a probe count switched to another monitor type is dropped, not kept as a rule that never matches", () => {
    expect(
      CriteriaFilterUtil.repairCriteriaFilterForMonitorType({
        criteriaFilter: {
          checkOn: CheckOn.DisconnectedProbes,
          filterType: FilterType.GreaterThan,
          value: "0",
        },
        monitorType: MonitorType.Ping,
      }),
    ).toBeNull();
  });

  test("a probe count stays as it is on a Probe Status monitor", () => {
    const filter: CriteriaFilter = {
      checkOn: CheckOn.ConnectedProbes,
      filterType: FilterType.LessThan,
      value: "2",
    };

    expect(
      CriteriaFilterUtil.repairCriteriaFilterForMonitorType({
        criteriaFilter: filter,
        monitorType: MonitorType.ProbeStatus,
      }),
    ).toBe(filter);
  });
});

/*
 * The counts are recorded every minute, so a rule can wait: "Disconnected
 * Probes is greater than 0, all values over 5 minutes" is a hold-down on top
 * of the three minutes a probe takes to be called disconnected.
 */
describe("probe counts over a period of time", () => {
  test.each(PROBE_STATUS_CHECK_ONS)(
    "%s can be judged over time",
    (checkOn: CheckOn) => {
      expect(CommonCriteriaFilterUtil.isEvaluateOverTimeFilter(checkOn)).toBe(
        true,
      );
    },
  );

  test("they are counts, not true/false series", () => {
    for (const checkOn of PROBE_STATUS_CHECK_ONS) {
      expect(CommonCriteriaFilterUtil.isBooleanSeries(checkOn)).toBe(false);
    }
  });

  test("a window can ask that every value, or any value, crossed the line", () => {
    const types: Array<EvaluateOverTimeType> =
      CommonCriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter({
        checkOn: CheckOn.DisconnectedProbes,
        filterType: FilterType.GreaterThan,
        value: 0,
      });

    expect(types).toContain(EvaluateOverTimeType.AllValues);
    expect(types).toContain(EvaluateOverTimeType.AnyValue);
  });
});

describe("Monitor this probe", () => {
  test("opens Create Monitor on a Probe Status monitor watching that probe", () => {
    const route: Route = getMonitorThisProbeRoute(
      "7b000000-0000-4000-8000-000000000001",
    );

    expect(route.toString()).toContain("/monitors/create?");
    expect(route.toString()).toContain("monitorType=Probe%20Status");
    expect(route.toString()).toContain(
      "watchProbeId=7b000000-0000-4000-8000-000000000001",
    );
  });

  test("is called what it does", () => {
    expect(MONITOR_THIS_PROBE_TITLE).toBe("Monitor this probe");
  });
});
