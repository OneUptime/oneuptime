import { describe, expect, test } from "@jest/globals";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import NetworkDeviceAlertPackUtil from "../../../Types/Monitor/SnmpMonitor/NetworkDeviceAlertPack";

/*
 * "Alert on it" on a device's SNMP Walk page (issue #5184) opens a Network
 * Device monitor with one criteria on the OID the walk found: this is that
 * criteria. It must be a criteria the evaluator reads (SNMP OID Value on
 * snmpMonitorOptions.oid, in the canonical spelling it compares with), an
 * alert rather than a page, and leave the monitor's status alone.
 */

function build(
  overrides: Partial<{
    oid: string;
    name: string;
    filterType: FilterType;
    value: string | number | undefined;
    checkOn: CheckOn.SnmpOidValue | CheckOn.SnmpOidRatePerSecond | undefined;
    description: string | undefined;
  }> = {},
): MonitorCriteriaInstance {
  return NetworkDeviceAlertPackUtil.buildOidValueCriteriaInstance({
    oid: "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1",
    name: "CPU 5-min %",
    filterType: FilterType.GreaterThan,
    value: 80,
    ...overrides,
  });
}

describe("the criteria Alert on it starts a monitor with", () => {
  test("checks the OID's value against the condition and threshold given", () => {
    const filters: Array<CriteriaFilter> = build().data!.filters;

    expect(filters).toEqual([
      {
        checkOn: CheckOn.SnmpOidValue,
        filterType: FilterType.GreaterThan,
        value: 80,
        snmpMonitorOptions: { oid: "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1" },
      },
    ]);
  });

  test("stores the OID as the evaluator compares it, without a leading dot", () => {
    expect(
      build({ oid: ".1.3.6.1.2.1.1.3.0" }).data!.filters[0]!.snmpMonitorOptions
        ?.oid,
    ).toBe("1.3.6.1.2.1.1.3.0");
  });

  test("raises an alert, not an incident, and leaves the monitor's status alone", () => {
    const data: NonNullable<MonitorCriteriaInstance["data"]> = build().data!;

    expect(data.createAlerts).toBe(true);
    expect(data.createIncidents).toBe(false);
    expect(data.changeMonitorStatus).toBe(false);
    expect(data.monitorStatusId).toBeUndefined();
    expect(data.isEnabled).toBe(true);
    expect(data.filterCondition).toBe(FilterCondition.All);
    expect(data.incidents).toEqual([]);
    expect(data.alerts).toEqual([]);
  });

  test("is named after the value, and says what it watches", () => {
    const data: NonNullable<MonitorCriteriaInstance["data"]> = build().data!;

    expect(data.name).toBe("CPU 5-min %");
    expect(data.description).toBe(
      "The value the device reports for CPU 5-min % (1.3.6.1.4.1.9.9.109.1.1.1.1.8.1).",
    );
  });

  test("an OID with no name is described by the OID alone", () => {
    const oid: string = "1.3.6.1.4.1.99999.1.0";

    expect(build({ oid: oid, name: oid }).data!.description).toBe(
      `The value the device reports for ${oid}.`,
    );
  });

  test("a threshold left out stays out, for the person to set", () => {
    expect(build({ value: undefined }).data!.filters[0]!.value).toBeUndefined();
  });

  test("every criteria it builds has an id of its own", () => {
    expect(build().data!.id).not.toBe(build().data!.id);
  });

  /*
   * Issue #5215: a counter only grows, so a threshold on its raw value
   * stays crossed until the device restarts. Alert on it starts a counter
   * on its rate instead, and says so in the criteria's description.
   */
  test("a counter is checked by how fast it grows, with the words that say so", () => {
    const data: NonNullable<MonitorCriteriaInstance["data"]> = build({
      oid: "1.3.6.1.2.1.2.2.1.14.3",
      name: "ifInErrors.3",
      checkOn: CheckOn.SnmpOidRatePerSecond,
      value: undefined,
      description:
        "How fast the counter ifInErrors.3 (1.3.6.1.2.1.2.2.1.14.3) grows, per second, between polls.",
    }).data!;

    expect(data.filters).toEqual([
      {
        checkOn: CheckOn.SnmpOidRatePerSecond,
        filterType: FilterType.GreaterThan,
        value: undefined,
        snmpMonitorOptions: { oid: "1.3.6.1.2.1.2.2.1.14.3" },
      },
    ]);
    expect(data.description).toBe(
      "How fast the counter ifInErrors.3 (1.3.6.1.2.1.2.2.1.14.3) grows, per second, between polls.",
    );
    // Still an alert that leaves the monitor's status alone.
    expect(data.createAlerts).toBe(true);
    expect(data.changeMonitorStatus).toBe(false);
  });

  test("left out, the check is the OID's value and the description says so", () => {
    const data: NonNullable<MonitorCriteriaInstance["data"]> = build({
      checkOn: undefined,
      description: undefined,
    }).data!;

    expect(data.filters[0]!.checkOn).toBe(CheckOn.SnmpOidValue);
    expect(data.description).toBe(
      "The value the device reports for CPU 5-min % (1.3.6.1.4.1.9.9.109.1.1.1.1.8.1).",
    );
  });
});
