import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { describe, expect, test } from "@jest/globals";
import CriteriaFilterElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaFilter";
import CriteriaFilterUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import CriteriaNameUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaName";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * SNMP OID Rate (per second) in the monitor form: how fast a counter OID
 * grows, which is what a counter is alerted on - its raw value only grows.
 * It asks for an OID the way SNMP OID Value does, compares a number above or
 * below a threshold, and is named by its OID.
 *
 * Assertions stay on plain DOM text: jest-dom's matchers do not typecheck
 * repo-wide.
 */

const IF_IN_ERRORS: string = "1.3.6.1.2.1.2.2.1.14.3";

function renderFilter(criteriaFilter: CriteriaFilter): {
  onChange: MockFunction;
  container: HTMLElement;
} {
  const onChange: MockFunction = getJestMockFunction();

  const { container } = render(
    <CriteriaFilterElement
      monitorType={MonitorType.NetworkDevice}
      monitorStep={new MonitorStep()}
      value={criteriaFilter}
      onChange={onChange as unknown as (value: CriteriaFilter) => void}
    />,
  );

  return { onChange: onChange, container: container };
}

function lastFilterFrom(onChange: MockFunction): CriteriaFilter {
  expect(onChange.mock.calls.length).toBeGreaterThan(0);

  return onChange.mock.calls[
    onChange.mock.calls.length - 1
  ]![0] as CriteriaFilter;
}

function values(options: Array<DropdownOption>): Array<string> {
  return options.map((option: DropdownOption): string => {
    return option.value.toString();
  });
}

describe("the counter rate criteria in the monitor form", () => {
  test("asks which OID it rates, as SNMP OID Value asks which OID it reads", () => {
    renderFilter({
      checkOn: CheckOn.SnmpOidRatePerSecond,
      filterType: FilterType.GreaterThan,
      value: undefined,
    });

    expect(screen.getAllByText("OID").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Choose the network device for this monitor in the configuration above, and the health OIDs it collects are listed here.",
      ),
    ).not.toBeNull();
  });

  test("keeps a saved OID selected", () => {
    renderFilter({
      checkOn: CheckOn.SnmpOidRatePerSecond,
      filterType: FilterType.GreaterThan,
      value: "1",
      snmpMonitorOptions: { oid: IF_IN_ERRORS },
    });

    expect(screen.getAllByText(IF_IN_ERRORS).length).toBeGreaterThan(0);
  });

  test("other SNMP checks do not ask for an OID", () => {
    renderFilter({
      checkOn: CheckOn.SnmpResponseTime,
      filterType: FilterType.GreaterThan,
      value: "5000",
    });

    expect(
      screen.queryByText(
        "Choose the network device for this monitor in the configuration above, and the health OIDs it collects are listed here.",
      ),
    ).toBeNull();
  });

  test("the threshold box suggests a rate", () => {
    const { container } = renderFilter({
      checkOn: CheckOn.SnmpOidRatePerSecond,
      filterType: FilterType.GreaterThan,
      value: undefined,
    });

    expect(container.querySelector('input[placeholder="100"]')).not.toBeNull();
    expect(
      CriteriaFilterUtil.getFilterTypePlaceholderValueByCheckOn({
        monitorType: MonitorType.NetworkDevice,
        checkOn: CheckOn.SnmpOidRatePerSecond,
      }),
    ).toBe("100");
  });

  test("picking it starts on its first comparison, with no threshold and no OID", async () => {
    const { onChange } = renderFilter({
      checkOn: CheckOn.SnmpOidValue,
      filterType: FilterType.EqualTo,
      value: "3",
      snmpMonitorOptions: { oid: IF_IN_ERRORS },
    });
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    await user.click(screen.getAllByRole("combobox")[0]!);
    await user.click(await screen.findByText(CheckOn.SnmpOidRatePerSecond));

    expect(lastFilterFrom(onChange)).toMatchObject({
      checkOn: CheckOn.SnmpOidRatePerSecond,
      filterType: CriteriaFilterUtil.getDefaultFilterTypeByCheckOn(
        CheckOn.SnmpOidRatePerSecond,
      ),
      value: undefined,
    });
    expect(lastFilterFrom(onChange).snmpMonitorOptions).toBeUndefined();
  });

  test("compares a number above or below a threshold, and nothing else", () => {
    expect(
      values(
        CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(
          CheckOn.SnmpOidRatePerSecond,
        ),
      ).sort(),
    ).toEqual(
      [
        FilterType.GreaterThan,
        FilterType.LessThan,
        FilterType.GreaterThanOrEqualTo,
        FilterType.LessThanOrEqualTo,
      ].sort(),
    );
    expect(
      CriteriaFilterUtil.getDefaultFilterTypeByCheckOn(
        CheckOn.SnmpOidRatePerSecond,
      ),
    ).toBe(FilterType.GreaterThan);
  });

  test("is offered on a Network Device monitor right after the OID checks", () => {
    const offered: Array<string> = values(
      CriteriaFilterUtil.getCheckOnOptionsByMonitorType(
        MonitorType.NetworkDevice,
      ),
    );

    expect(offered.indexOf(CheckOn.SnmpOidRatePerSecond)).toBe(
      offered.indexOf(CheckOn.SnmpOidExists) + 1,
    );

    for (const monitorType of Object.values(MonitorType)) {
      if (monitorType === MonitorType.NetworkDevice) {
        continue;
      }

      expect({
        monitorType,
        offered: values(
          CriteriaFilterUtil.getCheckOnOptionsByMonitorType(monitorType),
        ).includes(CheckOn.SnmpOidRatePerSecond),
      }).toEqual({ monitorType, offered: false });
    }
  });

  test("a criteria on it is named by its OID", () => {
    expect(
      CriteriaNameUtil.describeFilter({
        checkOn: CheckOn.SnmpOidRatePerSecond,
        filterType: FilterType.GreaterThan,
        value: 5,
        snmpMonitorOptions: { oid: IF_IN_ERRORS },
      }),
    ).toBe(`SNMP OID Rate (per second) ${IF_IN_ERRORS} is above 5`);
  });
});
