import CriteriaFilterUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import SnmpMonitorCriteria from "../../../Server/Utils/Monitor/Criteria/SnmpMonitorCriteria";
import { TransceiverReadingKind } from "../../../Types/Monitor/SnmpMonitor/SnmpTransceiver";
import { describe, expect, test } from "@jest/globals";

/*
 * WHY THIS FILE EXISTS
 *
 * The criteria a Network Device monitor can be built from are decided in two
 * places that have no compile-time link to each other: the CheckOn enum plus
 * the server evaluator (SnmpMonitorCriteria), and this dashboard catalog,
 * which filters the enum down to what the form offers per monitor type.
 *
 * Adding a CheckOn to the enum and teaching the evaluator to answer it does
 * NOT make it selectable — the catalog filters it out by omission, silently,
 * with no type error and no failing test. That is exactly how
 * CheckOn.SnmpWalkIsSucceeding shipped server-side while remaining invisible
 * in the form: the alert-pack template could use it, but nobody could pick it
 * by hand.
 *
 * So this file holds the catalog to the evaluator: every SNMP check the
 * server can answer is offered, each with filter types it can actually be
 * compared with, and nothing is offered that the server would ignore.
 */

function values(options: Array<DropdownOption>): Array<string> {
  return options.map((option: DropdownOption): string => {
    return option.value.toString();
  });
}

const NETWORK_DEVICE_CHECK_ONS: Array<string> = values(
  CriteriaFilterUtil.getCheckOnOptionsByMonitorType(MonitorType.NetworkDevice),
);

describe("what a Network Device monitor can be built from", () => {
  /*
   * Written as an exact list rather than a "contains" so that a CheckOn added
   * to the enum for another monitor type cannot leak into this form, and so
   * that removing one is a deliberate edit here.
   */
  test("offers exactly the SNMP checks, and only those", () => {
    expect(NETWORK_DEVICE_CHECK_ONS).toEqual([
      CheckOn.SnmpOidValue,
      CheckOn.SnmpOidExists,
      CheckOn.SnmpResponseTime,
      CheckOn.SnmpIsOnline,
      CheckOn.SnmpWalkIsSucceeding,
      CheckOn.SnmpInterfaceIsDown,
      CheckOn.SnmpTrapReceived,
      CheckOn.SnmpInterfaceUtilizationPercent,
      CheckOn.SnmpInterfaceErrorsPerSecond,
      CheckOn.SnmpTableValue,
      CheckOn.SnmpTableRowCount,
      CheckOn.SnmpTableRowIsUnhealthy,
      CheckOn.SnmpTrapVarbindValue,
      CheckOn.SnmpTransceiverNotDetected,
      CheckOn.SnmpTransceiverPastAlarmThreshold,
      CheckOn.SnmpTransceiverPastWarningThreshold,
      CheckOn.SnmpTransceiverReading,
      CheckOn.SnmpTransceiverRxPowerDrop,
    ]);
  });

  /*
   * THE ASSERTION THIS FILE EXISTS FOR.
   *
   * Reachability and the walk are different questions now. A device is
   * online when it answers ping OR its walk succeeds, so a switch whose SNMP
   * agent has died — wrong community after a config push, an ACL change, the
   * agent simply stopped — keeps answering ping and stays Online, while
   * interfaces, topology and inventory quietly stop arriving. "SNMP Walk Is
   * Succeeding" is the only criterion that catches that, and a catalog that
   * omitted it would leave the failure unalertable by hand.
   */
  test("the walk can be alerted on separately from reachability", () => {
    expect(NETWORK_DEVICE_CHECK_ONS).toContain(CheckOn.SnmpWalkIsSucceeding);
    expect(NETWORK_DEVICE_CHECK_ONS).toContain(CheckOn.SnmpIsOnline);
  });

  /*
   * Both are yes/no questions, so a threshold comparison would be
   * meaningless; offering "Greater Than" on "Is Online" is how a criterion
   * gets built that can never be true.
   */
  test.each([CheckOn.SnmpWalkIsSucceeding, CheckOn.SnmpIsOnline])(
    "%s is compared as true or false and nothing else",
    (checkOn: CheckOn) => {
      expect(
        values(CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(checkOn)),
      ).toEqual([FilterType.True, FilterType.False]);
    },
  );

  /*
   * The other direction: an SNMP check must not appear on a monitor type
   * whose probe never walks anything, or the form would offer a criterion
   * that is never evaluated and so never breaches.
   */
  test.each([MonitorType.Website, MonitorType.Ping, MonitorType.Port])(
    "%s is not offered the SNMP walk check",
    (monitorType: MonitorType) => {
      expect(
        values(CriteriaFilterUtil.getCheckOnOptionsByMonitorType(monitorType)),
      ).not.toContain(CheckOn.SnmpWalkIsSucceeding);
    },
  );
});

describe("the catalog agrees with the server evaluator", () => {
  /*
   * The link the type system does not give us. Every walk-dependent check
   * the evaluator knows about — the ones it returns null for when a poll ran
   * no walk — has to be selectable, or the server can answer a question the
   * form cannot ask.
   *
   * isWalkDependentCheckOn is private on the evaluator because nothing in
   * production needs it; it is reached here through the class object so that
   * this test breaks when the evaluator's list grows, which is precisely the
   * moment the catalog needs updating.
   */
  test("every walk-dependent check the evaluator knows is offered in the form", () => {
    type IsWalkDependentFunction = (checkOn: CheckOn) => boolean;

    const isWalkDependent: IsWalkDependentFunction = (
      SnmpMonitorCriteria as unknown as {
        isWalkDependentCheckOn: IsWalkDependentFunction;
      }
    ).isWalkDependentCheckOn;

    expect(typeof isWalkDependent).toBe("function");

    const walkDependent: Array<CheckOn> = Object.values(CheckOn).filter(
      (checkOn: CheckOn): boolean => {
        return isWalkDependent(checkOn);
      },
    );

    // A guard against the reflection above silently matching nothing.
    expect(walkDependent.length).toBeGreaterThan(3);

    for (const checkOn of walkDependent) {
      expect({ checkOn: checkOn, offered: true }).toEqual({
        checkOn: checkOn,
        offered: NETWORK_DEVICE_CHECK_ONS.includes(checkOn),
      });
    }
  });

  /*
   * ...and reachability is NOT walk-dependent, which is the whole point of
   * separating the two. If it ever became walk-dependent, a ping-only device
   * would stop being evaluated for reachability at all and would sit at its
   * last verdict forever.
   */
  test("reachability is not walk-dependent", () => {
    type IsWalkDependentFunction = (checkOn: CheckOn) => boolean;

    const isWalkDependent: IsWalkDependentFunction = (
      SnmpMonitorCriteria as unknown as {
        isWalkDependentCheckOn: IsWalkDependentFunction;
      }
    ).isWalkDependentCheckOn;

    expect(isWalkDependent(CheckOn.SnmpIsOnline)).toBe(false);
    expect(isWalkDependent(CheckOn.SnmpWalkIsSucceeding)).toBe(true);
  });
});

describe("the SNMP table and trap content checks", () => {
  test("Table Row Is Unhealthy is a yes/no question", () => {
    expect(
      values(
        CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(
          CheckOn.SnmpTableRowIsUnhealthy,
        ),
      ),
    ).toEqual([FilterType.True, FilterType.False]);
  });

  /*
   * A table cell or a varbind can be a number or text, and the evaluator
   * (SnmpTableCriteria) compares both - so both kinds of comparison are
   * offered, and nothing that only makes sense for a series (anomaly) is.
   */
  test.each([CheckOn.SnmpTableValue, CheckOn.SnmpTrapVarbindValue])(
    "%s offers number and text comparisons",
    (checkOn: CheckOn) => {
      const offered: Array<string> = values(
        CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(checkOn),
      );

      for (const filterType of [
        FilterType.EqualTo,
        FilterType.NotEqualTo,
        FilterType.GreaterThan,
        FilterType.LessThanOrEqualTo,
        FilterType.Contains,
        FilterType.NotContains,
        FilterType.IsEmpty,
      ]) {
        expect(offered).toContain(filterType);
      }

      expect(offered).not.toContain(FilterType.AnomalouslyHigh);
      expect(offered).not.toContain(FilterType.True);
    },
  );

  test("Table Row Count only compares numbers", () => {
    const offered: Array<string> = values(
      CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(
        CheckOn.SnmpTableRowCount,
      ),
    );

    expect(offered).toContain(FilterType.LessThan);
    expect(offered).toContain(FilterType.EqualTo);
    expect(offered).not.toContain(FilterType.Contains);
    expect(offered).not.toContain(FilterType.True);
  });

  test("a table criteria says which table and which rows it covers", () => {
    const text: string = CriteriaFilterUtil.translateFilterToText({
      checkOn: CheckOn.SnmpTableValue,
      filterType: FilterType.NotEqualTo,
      value: "1",
      snmpMonitorOptions: { tableKey: "ipsec_tunnels", tableRow: "*" },
    });

    expect(text).toContain("in SNMP table ipsec_tunnels");
    expect(text).toContain("for each row");
  });
});

describe("the transceiver checks", () => {
  test.each([
    CheckOn.SnmpTransceiverNotDetected,
    CheckOn.SnmpTransceiverPastAlarmThreshold,
    CheckOn.SnmpTransceiverPastWarningThreshold,
  ])("%s is a yes/no question", (checkOn: CheckOn) => {
    expect(
      values(CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(checkOn)),
    ).toEqual([FilterType.True, FilterType.False]);
  });

  test.each([CheckOn.SnmpTransceiverReading, CheckOn.SnmpTransceiverRxPowerDrop])(
    "%s only compares numbers, above or below",
    (checkOn: CheckOn) => {
      const offered: Array<string> = values(
        CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(checkOn),
      );

      expect([...offered].sort()).toEqual(
        [
          FilterType.GreaterThan,
          FilterType.LessThan,
          FilterType.GreaterThanOrEqualTo,
          FilterType.LessThanOrEqualTo,
        ].sort(),
      );
    },
  );

  test("the value placeholders are an RX power and a drop in dB", () => {
    expect(
      CriteriaFilterUtil.getFilterTypePlaceholderValueByCheckOn({
        monitorType: MonitorType.NetworkDevice,
        checkOn: CheckOn.SnmpTransceiverReading,
      }),
    ).toBe("-14");
    expect(
      CriteriaFilterUtil.getFilterTypePlaceholderValueByCheckOn({
        monitorType: MonitorType.NetworkDevice,
        checkOn: CheckOn.SnmpTransceiverRxPowerDrop,
      }),
    ).toBe("2");
  });

  test("a reading criteria says which reading, which ports and in what unit", () => {
    expect(
      CriteriaFilterUtil.translateFilterToText({
        checkOn: CheckOn.SnmpTransceiverReading,
        filterType: FilterType.LessThan,
        value: "-14",
        snmpMonitorOptions: {
          interfaceName: "*",
          transceiverReading: TransceiverReadingKind.RxPower,
        },
      }),
    ).toContain(
      '"SNMP Transceiver Reading" (RX Power) on interface * is less than -14 dBm',
    );

    expect(
      CriteriaFilterUtil.translateFilterToText({
        checkOn: CheckOn.SnmpTransceiverReading,
        filterType: FilterType.GreaterThan,
        value: "70",
        snmpMonitorOptions: {
          transceiverReading: TransceiverReadingKind.Temperature,
        },
      }),
    ).toContain('"SNMP Transceiver Reading" (Temperature) is greater than 70 °C');
  });

  test("a reading that is not one of the five is not named", () => {
    const text: string = CriteriaFilterUtil.translateFilterToText({
      checkOn: CheckOn.SnmpTransceiverReading,
      filterType: FilterType.LessThan,
      value: "-14",
      snmpMonitorOptions: { transceiverReading: "wavelength" },
    });

    expect(text).toContain('"SNMP Transceiver Reading" is less than -14 ');
    expect(text).not.toContain("(");
  });
});
