import NetworkDeviceAlertPackUtil, {
  NetworkDeviceAlertPackItem,
} from "../../../Types/Monitor/SnmpMonitor/NetworkDeviceAlertPack";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import ObjectID from "../../../Types/ObjectID";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { TRANSCEIVER_RX_DROP_ALERT_DB } from "../../../Utils/NetworkDevice/TransceiverHealthUtil";

function packItem(name: string): NetworkDeviceAlertPackItem {
  const item: NetworkDeviceAlertPackItem | undefined =
    NetworkDeviceAlertPackUtil.getPackItems().find(
      (candidate: NetworkDeviceAlertPackItem) => {
        return candidate.name === name;
      },
    );

  expect(item).toBeDefined();

  return item!;
}

describe("NetworkDeviceAlertPackUtil.getPackItems", () => {
  test("every pack item has a name, a description and at least one filter", () => {
    const items: Array<NetworkDeviceAlertPackItem> =
      NetworkDeviceAlertPackUtil.getPackItems();

    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      expect(item.name).toBeTruthy();
      expect(item.description).toBeTruthy();
      expect(item.filters.length).toBeGreaterThan(0);
    }
  });

  /*
   * Ping-first polling. "Device unreachable" is about the DEVICE (ping or
   * SNMP, the top-level isOnline); the walk failing on a device that still
   * answers ping is a separate, lesser condition with its own item.
   */
  describe("ping-first polling", () => {
    test("the unreachable item is about ping AND SNMP, raises an incident, and reads device reachability", () => {
      const item: NetworkDeviceAlertPackItem = packItem("Device unreachable");

      expect(item.description).toContain("ping and SNMP");
      expect(item.filters).toEqual([
        {
          checkOn: CheckOn.SnmpIsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
      ]);
      expect(item.createIncidents).toBe(true);
      expect(item.createAlerts).toBe(false);
    });

    test("an 'SNMP walk failing' item alerts (never incidents) on the walk CheckOn", () => {
      const item: NetworkDeviceAlertPackItem = packItem("SNMP walk failing");

      expect(item.filters).toEqual([
        {
          checkOn: CheckOn.SnmpWalkIsSucceeding,
          filterType: FilterType.False,
          value: undefined,
        },
      ]);
      expect(item.createAlerts).toBe(true);
      expect(item.createIncidents).toBe(false);
    });

    test("no other item reads the walk verdict as if it were reachability", () => {
      for (const item of NetworkDeviceAlertPackUtil.getPackItems()) {
        for (const filter of item.filters) {
          if (filter.checkOn === CheckOn.SnmpWalkIsSucceeding) {
            expect(item.name).toBe("SNMP walk failing");
          }
        }
      }
    });
  });
});

/*
 * The transceiver items: alerts, never incidents (a dark optic already takes
 * its interface down, and "Interface down" pages for that), one per port.
 */
describe("NetworkDeviceAlertPackUtil - transceiver items", () => {
  test("an optic no longer detected, per port", () => {
    const item: NetworkDeviceAlertPackItem = packItem(
      "Transceiver not detected",
    );

    expect(item.filters).toEqual([
      {
        checkOn: CheckOn.SnmpTransceiverNotDetected,
        filterType: FilterType.True,
        value: undefined,
        snmpMonitorOptions: { interfaceName: "*" },
      },
    ]);
    expect(item.description).toContain("still enabled");
  });

  test("an optic past the alarm threshold the device reports, per port", () => {
    const item: NetworkDeviceAlertPackItem = packItem(
      "Transceiver past its alarm threshold",
    );

    expect(item.filters).toEqual([
      {
        checkOn: CheckOn.SnmpTransceiverPastAlarmThreshold,
        filterType: FilterType.True,
        value: undefined,
        snmpMonitorOptions: { interfaceName: "*" },
      },
    ]);
  });

  test(`received power ${TRANSCEIVER_RX_DROP_ALERT_DB} dB or more below its best recent day, per port`, () => {
    const item: NetworkDeviceAlertPackItem = packItem(
      "Transceiver RX power dropping",
    );

    expect(item.filters).toEqual([
      {
        checkOn: CheckOn.SnmpTransceiverRxPowerDrop,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: TRANSCEIVER_RX_DROP_ALERT_DB,
        snmpMonitorOptions: { interfaceName: "*" },
      },
    ]);
    expect(item.description).toContain(
      `${TRANSCEIVER_RX_DROP_ALERT_DB} dB less light`,
    );
  });

  test("every transceiver item alerts and never raises an incident", () => {
    const transceiverItems: Array<NetworkDeviceAlertPackItem> =
      NetworkDeviceAlertPackUtil.getPackItems().filter(
        (item: NetworkDeviceAlertPackItem) => {
          return item.name.startsWith("Transceiver");
        },
      );

    expect(transceiverItems).toHaveLength(3);

    for (const item of transceiverItems) {
      expect(item.createAlerts).toBe(true);
      expect(item.createIncidents).toBe(false);
    }
  });

  test("a transceiver criteria never changes the monitor's status", () => {
    const instances: Array<MonitorCriteriaInstance> =
      NetworkDeviceAlertPackUtil.buildCriteriaInstances({
        downMonitorStatusId: ObjectID.generate(),
      });

    for (const instance of instances) {
      if (instance.data?.name.startsWith("Transceiver")) {
        expect(instance.data.changeMonitorStatus).toBe(false);
      }
    }
  });
});

describe("NetworkDeviceAlertPackUtil.buildCriteriaInstances", () => {
  test("builds one enabled instance per pack item with unique ids", () => {
    const instances: Array<MonitorCriteriaInstance> =
      NetworkDeviceAlertPackUtil.buildCriteriaInstances();

    expect(instances.length).toBe(
      NetworkDeviceAlertPackUtil.getPackItems().length,
    );

    const ids: Set<string> = new Set<string>();
    for (const instance of instances) {
      expect(instance.data?.isEnabled).toBe(true);
      expect(instance.data?.id).toBeTruthy();
      ids.add(instance.data!.id);
    }
    expect(ids.size).toBe(instances.length);
  });

  test("with a downMonitorStatusId context, incident-creating criteria carry that status id", () => {
    const downStatusId: ObjectID = ObjectID.generate();

    const instances: Array<MonitorCriteriaInstance> =
      NetworkDeviceAlertPackUtil.buildCriteriaInstances({
        downMonitorStatusId: downStatusId,
      });

    for (const instance of instances) {
      expect(instance.data?.monitorStatusId?.toString()).toBe(
        downStatusId.toString(),
      );

      /*
       * changeMonitorStatus must never be true while the target status id
       * is missing — that combination produces a criteria that "changes"
       * the monitor to no status at all.
       */
      if (instance.data?.changeMonitorStatus) {
        expect(instance.data?.monitorStatusId).toBeTruthy();
      }
    }
  });

  test("without context, no instance claims to change monitor status to an undefined id", () => {
    const instances: Array<MonitorCriteriaInstance> =
      NetworkDeviceAlertPackUtil.buildCriteriaInstances();

    for (const instance of instances) {
      expect(instance.data?.monitorStatusId).toBeUndefined();
      /*
       * Legacy call sites (no context) still exist in principle; the pack
       * must not produce a status change pointing at nothing.
       */
      expect(instance.data?.changeMonitorStatus).toBe(false);
    }
  });

  test("only incident-creating pack items request a monitor status change", () => {
    const downStatusId: ObjectID = ObjectID.generate();
    const items: Array<NetworkDeviceAlertPackItem> =
      NetworkDeviceAlertPackUtil.getPackItems();
    const instances: Array<MonitorCriteriaInstance> =
      NetworkDeviceAlertPackUtil.buildCriteriaInstances({
        downMonitorStatusId: downStatusId,
      });

    for (let i: number = 0; i < items.length; i++) {
      expect(instances[i]!.data?.createIncidents).toBe(
        items[i]!.createIncidents,
      );
      expect(instances[i]!.data?.createAlerts).toBe(items[i]!.createAlerts);
      expect(instances[i]!.data?.changeMonitorStatus).toBe(
        items[i]!.createIncidents,
      );
    }
  });
  /*
   * Regression: every item was built with `incidents: []` and `alerts: []`.
   * The incident form gave an empty list no row to fill in and saving
   * checked nothing in it, so "Device unreachable" and "Interface down"
   * changed the monitor's status and paged nobody.
   */
  test("an incident-creating item declares one incident, an alert-raising item one alert, both titled after the item", () => {
    const items: Array<NetworkDeviceAlertPackItem> =
      NetworkDeviceAlertPackUtil.getPackItems();
    const instances: Array<MonitorCriteriaInstance> =
      NetworkDeviceAlertPackUtil.buildCriteriaInstances({
        downMonitorStatusId: ObjectID.generate(),
      });

    expect(
      items.some((item: NetworkDeviceAlertPackItem) => {
        return item.createIncidents;
      }),
    ).toBe(true);

    for (let i: number = 0; i < items.length; i++) {
      const data: MonitorCriteriaInstance["data"] = instances[i]!.data!;

      expect(data.incidents).toHaveLength(items[i]!.createIncidents ? 1 : 0);
      expect(data.alerts).toHaveLength(items[i]!.createAlerts ? 1 : 0);

      for (const incident of data.incidents) {
        expect(incident.title).toBe(items[i]!.name);
        expect(incident.autoResolveIncident).toBe(true);
      }

      for (const alert of data.alerts) {
        expect(alert.title).toBe(items[i]!.name);
        expect(alert.autoResolveAlert).toBe(true);
      }
    }
  });

  test("the severities the caller names are the ones the incidents and alerts start on; none named, the form asks for them", () => {
    const incidentSeverityId: ObjectID = ObjectID.generate();
    const alertSeverityId: ObjectID = ObjectID.generate();

    const withSeverities: Array<MonitorCriteriaInstance> =
      NetworkDeviceAlertPackUtil.buildCriteriaInstances({
        incidentSeverityId: incidentSeverityId,
        alertSeverityId: alertSeverityId,
      });

    for (const instance of withSeverities) {
      for (const incident of instance.data!.incidents) {
        expect(incident.incidentSeverityId).toBe(incidentSeverityId);
      }
      for (const alert of instance.data!.alerts) {
        expect(alert.alertSeverityId).toBe(alertSeverityId);
      }
    }

    const unreachable: MonitorCriteriaInstance =
      NetworkDeviceAlertPackUtil.buildCriteriaInstances().find(
        (instance: MonitorCriteriaInstance) => {
          return instance.data?.name === "Device unreachable";
        },
      )!;

    expect(
      MonitorCriteriaInstance.getValidationError(
        unreachable,
        MonitorType.NetworkDevice,
      ),
    ).toBe('Incident severity is required for criteria "Device unreachable"');
  });
});
