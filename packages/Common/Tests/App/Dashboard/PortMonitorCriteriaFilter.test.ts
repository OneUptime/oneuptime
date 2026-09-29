import CriteriaFilterUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { describe, expect, test } from "@jest/globals";

function values(options: Array<DropdownOption>): Array<string> {
  return options.map((option: DropdownOption) => {
    return option.value.toString();
  });
}

describe("Dashboard Port timing criteria", () => {
  test("offers DNS and TCP phase thresholds for Port monitors", () => {
    expect(
      values(
        CriteriaFilterUtil.getCheckOnOptionsByMonitorType(MonitorType.Port),
      ),
    ).toEqual([
      CheckOn.ResponseTime,
      CheckOn.PortDnsLookupTime,
      CheckOn.PortTcpConnectTime,
      CheckOn.IsOnline,
      CheckOn.IsRequestTimeout,
    ]);
  });

  test("labels the persisted response-time criterion as total connection time", () => {
    const responseTimeOption: DropdownOption | undefined =
      CriteriaFilterUtil.getCheckOnOptionsByMonitorType(MonitorType.Port).find(
        (option: DropdownOption) => {
          return option.value === CheckOn.ResponseTime;
        },
      );

    expect(responseTimeOption).toEqual({
      label: "Total Connection Time (DNS + TCP) (in ms)",
      value: CheckOn.ResponseTime,
    });
  });

  test("does not expose Port phase thresholds on Website monitors", () => {
    const websiteOptions: Array<string> = values(
      CriteriaFilterUtil.getCheckOnOptionsByMonitorType(MonitorType.Website),
    );

    expect(websiteOptions).not.toContain(CheckOn.PortDnsLookupTime);
    expect(websiteOptions).not.toContain(CheckOn.PortTcpConnectTime);
  });

  test.each([CheckOn.PortDnsLookupTime, CheckOn.PortTcpConnectTime])(
    "%s supports numeric threshold comparisons",
    (checkOn: CheckOn) => {
      expect(
        values(CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(checkOn)),
      ).toEqual([
        FilterType.GreaterThan,
        FilterType.LessThan,
        FilterType.GreaterThanOrEqualTo,
        FilterType.LessThanOrEqualTo,
      ]);
    },
  );

  test.each([CheckOn.PortDnsLookupTime, CheckOn.PortTcpConnectTime])(
    "%s gets a millisecond threshold placeholder",
    (checkOn: CheckOn) => {
      expect(
        CriteriaFilterUtil.getFilterTypePlaceholderValueByCheckOn({
          monitorType: MonitorType.Port,
          checkOn: checkOn,
        }),
      ).toBe("1000");
    },
  );

  test("renders the threshold with a millisecond suffix", () => {
    const filter: CriteriaFilter = {
      checkOn: CheckOn.PortTcpConnectTime,
      filterType: FilterType.GreaterThan,
      value: 125,
    };

    expect(
      CriteriaFilterUtil.translateFilterToText(filter, FilterCondition.All),
    ).toContain("125ms");
  });
});
