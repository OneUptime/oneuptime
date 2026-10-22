import SnmpMonitorCriteria from "../../../Server/Utils/Monitor/Criteria/SnmpMonitorCriteria";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CriteriaAlert } from "../../../Types/Monitor/CriteriaAlert";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import { CriteriaIncident } from "../../../Types/Monitor/CriteriaIncident";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance, {
  MonitorCriteriaInstanceType,
} from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import NetworkDeviceAlertPackUtil from "../../../Types/Monitor/SnmpMonitor/NetworkDeviceAlertPack";
import ObjectID from "../../../Types/ObjectID";
import { DEVICE_ADDRESS_MONITOR_TYPES } from "../../../Utils/Monitor/DeviceMonitorTemplateUtil";
import {
  MonitorCriteriaAlertSummary,
  MonitorTemplateAlertSummary,
  PING_ONLY_EVALUATED_CHECKS,
  isCriterionEvaluatedOnPingOnlyDevices,
  summarizeMonitorCriteria,
  summarizeMonitorTemplateAlerts,
} from "../../../Utils/Monitor/MonitorTemplateAlertSummary";
import { describe, expect, test } from "@jest/globals";

/*
 * What a Network Device monitor template raises, read straight from its
 * criteria (issue #4815): the Review dialog's template preview and its
 * outcome summary are drawn from this, so every claim they make - "opens an
 * incident (Critical)", "SNMP devices only", "the devices that answer ping
 * only will raise nothing" - is pinned here against the rules the server
 * evaluates monitors by.
 */

const CRITICAL: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const MAJOR: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OFFLINE: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const NETWORK_TEAM: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const DUTY_MANAGER: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const WARNING_ALERT: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

function filter(checkOn: CheckOn): CriteriaFilter {
  return { checkOn: checkOn, filterType: FilterType.False, value: undefined };
}

function incident(
  severity: ObjectID | undefined,
  onCallPolicyIds: Array<ObjectID> = [],
): CriteriaIncident {
  return {
    id: ObjectID.generate().toString(),
    title: "Device problem",
    description: "",
    incidentSeverityId: severity,
    onCallPolicyIds: onCallPolicyIds,
  };
}

function alert(
  severity: ObjectID | undefined,
  onCallPolicyIds: Array<ObjectID> = [],
): CriteriaAlert {
  return {
    id: ObjectID.generate().toString(),
    title: "Device problem",
    description: "",
    alertSeverityId: severity,
    onCallPolicyIds: onCallPolicyIds,
  };
}

function criterion(
  data: Partial<MonitorCriteriaInstanceType>,
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: ObjectID.generate().toString(),
    name: "",
    description: "",
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [],
    incidents: [],
    alerts: [],
    ...data,
  };
  return instance;
}

function steps(
  ...criteriaPerStep: Array<Array<MonitorCriteriaInstance>>
): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data!.monitorStepsInstanceArray = criteriaPerStep.map(
    (instances: Array<MonitorCriteriaInstance>): MonitorStep => {
      const step: MonitorStep = new MonitorStep();
      const monitorCriteria: MonitorCriteria = new MonitorCriteria();
      monitorCriteria.data = { monitorCriteriaInstanceArray: instances };
      step.data!.monitorCriteria = monitorCriteria;
      return step;
    },
  );
  return monitorSteps;
}

const UNREACHABLE: MonitorCriteriaInstance = criterion({
  name: "Device unreachable",
  filters: [filter(CheckOn.SnmpIsOnline)],
  createIncidents: true,
  incidents: [incident(CRITICAL, [NETWORK_TEAM])],
  changeMonitorStatus: true,
  monitorStatusId: OFFLINE,
});

const INTERFACE_DOWN: MonitorCriteriaInstance = criterion({
  name: "Interface down",
  filters: [filter(CheckOn.SnmpInterfaceIsDown)],
  createAlerts: true,
  alerts: [alert(WARNING_ALERT)],
});

describe("one criterion, in plain terms", () => {
  test("an incident it opens: severity, the status it sets, who it pages", () => {
    const summary: MonitorCriteriaAlertSummary = summarizeMonitorCriteria(
      UNREACHABLE,
      0,
    );

    expect(summary).toEqual({
      id: UNREACHABLE.data!.id,
      name: "Device unreachable",
      description: "",
      isEnabled: true,
      raisesIncident: true,
      incidentSeverityIds: [CRITICAL.toString()],
      raisesAlert: false,
      alertSeverityIds: [],
      changesStatus: true,
      monitorStatusId: OFFLINE.toString(),
      onCallPolicyIds: [NETWORK_TEAM.toString()],
      checks: [CheckOn.SnmpIsOnline],
      isEvaluatedOnPingOnlyDevices: true,
    });
  });

  test("the incident switch without an incident opens nothing: incidents are made one per entry", () => {
    const summary: MonitorCriteriaAlertSummary = summarizeMonitorCriteria(
      criterion({
        filters: [filter(CheckOn.SnmpIsOnline)],
        createIncidents: true,
        incidents: [],
      }),
      0,
    );

    expect(summary.raisesIncident).toBe(false);
    expect(summary.incidentSeverityIds).toEqual([]);
  });

  test("entries without the switch open nothing, and page nobody", () => {
    const summary: MonitorCriteriaAlertSummary = summarizeMonitorCriteria(
      criterion({
        filters: [filter(CheckOn.SnmpIsOnline)],
        createIncidents: false,
        incidents: [incident(CRITICAL, [NETWORK_TEAM])],
        createAlerts: false,
        alerts: [alert(WARNING_ALERT, [DUTY_MANAGER])],
      }),
      0,
    );

    expect(summary.raisesIncident).toBe(false);
    expect(summary.raisesAlert).toBe(false);
    expect(summary.onCallPolicyIds).toEqual([]);
  });

  test("severities and on-call policies are named once each, incidents and alerts together", () => {
    const summary: MonitorCriteriaAlertSummary = summarizeMonitorCriteria(
      criterion({
        filters: [filter(CheckOn.SnmpIsOnline)],
        createIncidents: true,
        incidents: [
          incident(CRITICAL, [NETWORK_TEAM]),
          incident(CRITICAL, [NETWORK_TEAM, DUTY_MANAGER]),
          incident(MAJOR),
          incident(undefined),
        ],
        createAlerts: true,
        alerts: [alert(WARNING_ALERT, [DUTY_MANAGER])],
      }),
      0,
    );

    expect(summary.incidentSeverityIds).toEqual([
      CRITICAL.toString(),
      MAJOR.toString(),
    ]);
    expect(summary.alertSeverityIds).toEqual([WARNING_ALERT.toString()]);
    expect(summary.onCallPolicyIds).toEqual([
      NETWORK_TEAM.toString(),
      DUTY_MANAGER.toString(),
    ]);
  });

  test("a status change needs both the switch and a status", () => {
    expect(
      summarizeMonitorCriteria(
        criterion({ changeMonitorStatus: true, monitorStatusId: undefined }),
        0,
      ).changesStatus,
    ).toBe(false);
    const withoutSwitch: MonitorCriteriaAlertSummary = summarizeMonitorCriteria(
      criterion({ changeMonitorStatus: false, monitorStatusId: OFFLINE }),
      0,
    );
    expect(withoutSwitch.changesStatus).toBe(false);
    expect(withoutSwitch.monitorStatusId).toBeUndefined();
  });

  test("only an explicit false switches a criterion off", () => {
    expect(
      summarizeMonitorCriteria(criterion({ isEnabled: undefined }), 0)
        .isEnabled,
    ).toBe(true);
    expect(
      summarizeMonitorCriteria(criterion({ isEnabled: false }), 0).isEnabled,
    ).toBe(false);
  });

  test("names are trimmed, and a criterion with no id is numbered", () => {
    const unnamed: MonitorCriteriaInstance = criterion({
      name: "  Fan failed  ",
      description: " The chassis reports a failed fan. ",
    });
    unnamed.data!.id = "";

    const summary: MonitorCriteriaAlertSummary = summarizeMonitorCriteria(
      unnamed,
      3,
    );

    expect(summary.id).toBe("criteria-3");
    expect(summary.name).toBe("Fan failed");
    expect(summary.description).toBe("The chassis reports a failed fan.");
  });
});

describe("what can be met on a device that only answers ping", () => {
  test("reachability and traps, never the walk", () => {
    expect([...PING_ONLY_EVALUATED_CHECKS]).toEqual([
      CheckOn.SnmpIsOnline,
      CheckOn.SnmpTrapReceived,
      CheckOn.SnmpTrapVarbindValue,
    ]);
  });

  /*
   * THE LINK THE TYPES DO NOT GIVE. A ping-only device is polled without a
   * walk, and the evaluator returns "not evaluated" for every walk-dependent
   * check on such a poll. The preview's "SNMP devices only" badge and its
   * "will raise nothing" warning must say exactly that - so every SNMP check
   * is either in the ping-only list or walk-dependent on the server, never
   * both and never neither. The evaluator keeps its list private; it is
   * reached through the class, so this breaks the day the list changes.
   */
  test("agrees with the server's evaluator for every SNMP check", () => {
    type IsWalkDependentFunction = (checkOn: CheckOn) => boolean;

    const isWalkDependent: IsWalkDependentFunction = (
      SnmpMonitorCriteria as unknown as {
        isWalkDependentCheckOn: IsWalkDependentFunction;
      }
    ).isWalkDependentCheckOn;

    expect(typeof isWalkDependent).toBe("function");

    const snmpChecks: Array<CheckOn> = Object.entries(CheckOn)
      .filter(([key]: [string, CheckOn]): boolean => {
        return key.startsWith("Snmp");
      })
      .map(([, value]: [string, CheckOn]): CheckOn => {
        return value;
      });

    // A guard against the filter above quietly matching nothing.
    expect(snmpChecks.length).toBeGreaterThan(10);

    for (const check of snmpChecks) {
      expect({
        check: check,
        evaluatedOnPingOnly: PING_ONLY_EVALUATED_CHECKS.includes(check),
      }).toEqual({
        check: check,
        evaluatedOnPingOnly: !isWalkDependent(check),
      });
    }
  });

  test("with All, one walk check keeps the criterion from being met", () => {
    expect(
      isCriterionEvaluatedOnPingOnlyDevices({
        checks: [CheckOn.SnmpIsOnline],
        filterCondition: FilterCondition.All,
      }),
    ).toBe(true);
    expect(
      isCriterionEvaluatedOnPingOnlyDevices({
        checks: [CheckOn.SnmpIsOnline, CheckOn.SnmpResponseTime],
        filterCondition: FilterCondition.All,
      }),
    ).toBe(false);
  });

  test("with Any, one reachability or trap check is enough", () => {
    expect(
      isCriterionEvaluatedOnPingOnlyDevices({
        checks: [CheckOn.SnmpInterfaceIsDown, CheckOn.SnmpIsOnline],
        filterCondition: FilterCondition.Any,
      }),
    ).toBe(true);
    expect(
      isCriterionEvaluatedOnPingOnlyDevices({
        checks: [CheckOn.SnmpInterfaceIsDown, CheckOn.SnmpTrapReceived],
        filterCondition: FilterCondition.Any,
      }),
    ).toBe(true);
    expect(
      isCriterionEvaluatedOnPingOnlyDevices({
        checks: [CheckOn.SnmpInterfaceIsDown, CheckOn.SnmpOidValue],
        filterCondition: FilterCondition.Any,
      }),
    ).toBe(false);
  });

  test("a condition left unset reads as All, as the evaluator's default", () => {
    expect(
      isCriterionEvaluatedOnPingOnlyDevices({
        checks: [CheckOn.SnmpIsOnline, CheckOn.SnmpWalkIsSucceeding],
        filterCondition: undefined,
      }),
    ).toBe(false);
  });

  test("a criterion that checks nothing is never met", () => {
    expect(
      isCriterionEvaluatedOnPingOnlyDevices({
        checks: [],
        filterCondition: FilterCondition.Any,
      }),
    ).toBe(false);
    expect(
      isCriterionEvaluatedOnPingOnlyDevices({
        checks: [undefined],
        filterCondition: FilterCondition.Any,
      }),
    ).toBe(false);
  });
});

describe("a whole template", () => {
  test("every criterion of every step, in evaluation order", () => {
    const summary: MonitorTemplateAlertSummary = summarizeMonitorTemplateAlerts(
      steps([UNREACHABLE], [INTERFACE_DOWN]),
    );

    expect(
      summary.criteria.map((item: MonitorCriteriaAlertSummary): string => {
        return item.name;
      }),
    ).toEqual(["Device unreachable", "Interface down"]);
    expect(summary.raisesIncidents).toBe(true);
    expect(summary.raisesAlerts).toBe(true);
    // The incident reads reachability; the alert reads the walk.
    expect(summary.raisesIncidentsOnPingOnlyDevices).toBe(true);
    expect(summary.raisesAlertsOnPingOnlyDevices).toBe(false);
  });

  test("a switched-off criterion is listed but raises nothing", () => {
    const off: MonitorCriteriaInstance = criterion({
      ...UNREACHABLE.data!,
      id: ObjectID.generate().toString(),
      isEnabled: false,
    });

    const summary: MonitorTemplateAlertSummary = summarizeMonitorTemplateAlerts(
      steps([off]),
    );

    expect(summary.criteria).toHaveLength(1);
    expect(summary.raisesIncidents).toBe(false);
    expect(summary.raisesIncidentsOnPingOnlyDevices).toBe(false);
  });

  test("a template of walk checks raises nothing on a ping-only device", () => {
    const summary: MonitorTemplateAlertSummary = summarizeMonitorTemplateAlerts(
      steps([
        INTERFACE_DOWN,
        criterion({
          filters: [filter(CheckOn.SnmpWalkIsSucceeding)],
          createIncidents: true,
          incidents: [incident(MAJOR)],
        }),
      ]),
    );

    expect(summary.raisesIncidents).toBe(true);
    expect(summary.raisesIncidentsOnPingOnlyDevices).toBe(false);
    expect(summary.raisesAlertsOnPingOnlyDevices).toBe(false);
  });

  test("read the same from the template's stored JSON", () => {
    const json: ReturnType<MonitorSteps["toJSON"]> = steps(
      [UNREACHABLE],
      [INTERFACE_DOWN],
    ).toJSON();

    const summary: MonitorTemplateAlertSummary =
      summarizeMonitorTemplateAlerts(json);

    expect(summary.criteria).toHaveLength(2);
    expect(summary.criteria[0]!.incidentSeverityIds).toEqual([
      CRITICAL.toString(),
    ]);
    expect(summary.criteria[0]!.monitorStatusId).toBe(OFFLINE.toString());
    expect(summary.raisesAlerts).toBe(true);
  });

  test("steps that cannot be read raise nothing anyone can name", () => {
    for (const value of [
      undefined,
      null,
      { _type: "NotMonitorSteps" },
      { _type: "MonitorSteps" },
    ]) {
      expect(summarizeMonitorTemplateAlerts(value as never)).toEqual({
        criteria: [],
        raisesIncidents: false,
        raisesAlerts: false,
        raisesIncidentsOnPingOnlyDevices: false,
        raisesAlertsOnPingOnlyDevices: false,
      });
    }
  });

  /*
   * The recommended template is built from the network device alert pack.
   * Every pack item that reads the walk is shown as SNMP-only; the one that
   * reads reachability is what a ping-only device can raise.
   */
  test("the alert pack: only 'Device unreachable' can fire on a ping-only device", () => {
    const pack: Array<MonitorCriteriaInstance> =
      NetworkDeviceAlertPackUtil.buildCriteriaInstances({
        downMonitorStatusId: OFFLINE,
      });

    // As the recommended template fills them in: an entry for each switch.
    for (const instance of pack) {
      if (instance.data!.createIncidents) {
        instance.data!.incidents = [incident(CRITICAL)];
      }

      if (instance.data!.createAlerts) {
        instance.data!.alerts = [alert(WARNING_ALERT)];
      }
    }

    const summary: MonitorTemplateAlertSummary = summarizeMonitorTemplateAlerts(
      steps(pack),
    );

    const pingOnly: Array<string> = summary.criteria
      .filter((item: MonitorCriteriaAlertSummary): boolean => {
        return item.isEvaluatedOnPingOnlyDevices;
      })
      .map((item: MonitorCriteriaAlertSummary): string => {
        return item.name;
      });

    expect(pingOnly).toEqual(["Device unreachable"]);
    expect(summary.raisesIncidentsOnPingOnlyDevices).toBe(true);
    expect(summary.raisesAlertsOnPingOnlyDevices).toBe(false);
  });
});

/*
 * A Ping, IP, Port or NTP template's monitor checks each device's address
 * itself (issue #5145): nothing it checks waits for an SNMP walk, so every
 * check can fire on a device that only answers ping. A Network Device
 * template - named, or left unnamed as every caller before #5145 did - is
 * read as before.
 */
describe("a template whose monitors check each device's address", () => {
  const OFFLINE_CHECK: MonitorCriteriaInstance = criterion({
    name: "Display stops answering",
    filters: [filter(CheckOn.IsOnline)],
    createIncidents: true,
    incidents: [incident(CRITICAL)],
    changeMonitorStatus: true,
    monitorStatusId: OFFLINE,
  });

  const SLOW_CHECK: MonitorCriteriaInstance = criterion({
    name: "Display answers slowly",
    filterCondition: FilterCondition.All,
    filters: [filter(CheckOn.ResponseTime), filter(CheckOn.IsOnline)],
    createAlerts: true,
    alerts: [alert(WARNING_ALERT)],
  });

  test.each([...DEVICE_ADDRESS_MONITOR_TYPES])(
    "%s template: every check fires on a device that answers ping only",
    (monitorType: MonitorType) => {
      const summary: MonitorTemplateAlertSummary =
        summarizeMonitorTemplateAlerts(steps([OFFLINE_CHECK, SLOW_CHECK]), {
          monitorType: monitorType,
        });

      expect(
        summary.criteria.map((item: MonitorCriteriaAlertSummary): boolean => {
          return item.isEvaluatedOnPingOnlyDevices;
        }),
      ).toEqual([true, true]);
      expect(summary.raisesIncidentsOnPingOnlyDevices).toBe(true);
      expect(summary.raisesAlertsOnPingOnlyDevices).toBe(true);
      expect(summary.raisesIncidents).toBe(true);
      expect(summary.raisesAlerts).toBe(true);
    },
  );

  test("the same criteria read as a Network Device template's cannot fire there: they read no walk check it evaluates on ping", () => {
    for (const options of [{ monitorType: MonitorType.NetworkDevice }, {}]) {
      const summary: MonitorTemplateAlertSummary =
        summarizeMonitorTemplateAlerts(
          steps([OFFLINE_CHECK, SLOW_CHECK]),
          options,
        );

      expect(summary.raisesIncidentsOnPingOnlyDevices).toBe(false);
      expect(summary.raisesAlertsOnPingOnlyDevices).toBe(false);
    }
  });

  test("a Network Device template is read exactly as before when its type is named", () => {
    const named: MonitorTemplateAlertSummary = summarizeMonitorTemplateAlerts(
      steps([UNREACHABLE, INTERFACE_DOWN]),
      { monitorType: MonitorType.NetworkDevice },
    );

    expect(named).toEqual(
      summarizeMonitorTemplateAlerts(steps([UNREACHABLE, INTERFACE_DOWN])),
    );
  });

  test("a criterion that checks nothing is never met, whatever the template", () => {
    const summary: MonitorCriteriaAlertSummary = summarizeMonitorCriteria(
      criterion({
        filters: [],
        createIncidents: true,
        incidents: [incident(CRITICAL)],
      }),
      0,
      { monitorType: MonitorType.Ping },
    );

    expect(summary.isEvaluatedOnPingOnlyDevices).toBe(false);
  });

  test("a switched-off check of an address template raises nothing, on any device", () => {
    const summary: MonitorTemplateAlertSummary = summarizeMonitorTemplateAlerts(
      steps([
        criterion({
          ...OFFLINE_CHECK.data!,
          isEnabled: false,
        }),
      ]),
      { monitorType: MonitorType.Port },
    );

    expect(summary.raisesIncidents).toBe(false);
    expect(summary.raisesIncidentsOnPingOnlyDevices).toBe(false);
  });
});
