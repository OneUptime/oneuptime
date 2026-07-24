import ObjectID from "../../ObjectID";
import FilterCondition from "../../Filter/FilterCondition";
import { CheckOn, CriteriaFilter, FilterType } from "../CriteriaFilter";
import MonitorCriteriaInstance from "../MonitorCriteriaInstance";

/*
 * Prebuilt criteria for Network Device monitors — the alerts most operators
 * want and would otherwise hand-build every time. Applying a pack appends
 * these criteria instances to the monitor; the user still picks severities
 * and on-call policies afterwards.
 */
export interface NetworkDeviceAlertPackItem {
  name: string;
  description: string;
  filters: Array<CriteriaFilter>;
  createIncidents: boolean;
  createAlerts: boolean;
}

export interface NetworkDeviceAlertPackContext {
  // Status to move the monitor to when a pack criteria matches (offline/degraded).
  downMonitorStatusId?: ObjectID | undefined;
}

const PACK: Array<NetworkDeviceAlertPackItem> = [
  {
    name: "Device unreachable",
    description:
      "The device stopped answering SNMP — likely down or unreachable.",
    filters: [
      {
        checkOn: CheckOn.SnmpIsOnline,
        filterType: FilterType.False,
        value: undefined,
      },
    ],
    createIncidents: true,
    createAlerts: false,
  },
  {
    name: "Interface down",
    description:
      "An administratively-enabled interface went operationally down.",
    filters: [
      {
        checkOn: CheckOn.SnmpInterfaceIsDown,
        filterType: FilterType.True,
        value: undefined,
      },
    ],
    createIncidents: true,
    createAlerts: false,
  },
  {
    name: "Interface saturated",
    description:
      "An interface is running above 80% utilization — the link may need an upgrade.",
    filters: [
      {
        checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
        filterType: FilterType.GreaterThan,
        value: 80,
      },
    ],
    createIncidents: false,
    createAlerts: true,
  },
  {
    name: "Interface errors",
    description:
      "An interface is logging errors — usually cabling, optics, or duplex problems.",
    filters: [
      {
        checkOn: CheckOn.SnmpInterfaceErrorsPerSecond,
        filterType: FilterType.GreaterThan,
        value: 1,
      },
    ],
    createIncidents: false,
    createAlerts: true,
  },
];

export default class NetworkDeviceAlertPackUtil {
  public static getPackItems(): Array<NetworkDeviceAlertPackItem> {
    return PACK;
  }

  /*
   * Builds ready-to-append MonitorCriteriaInstances from the pack. Each is
   * enabled; incident-creating items also change the monitor status to the
   * context's down status. Severities and on-call policies are left for the
   * user to fill in.
   */
  public static buildCriteriaInstances(
    context?: NetworkDeviceAlertPackContext,
  ): Array<MonitorCriteriaInstance> {
    return PACK.map((item: NetworkDeviceAlertPackItem) => {
      const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
      instance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: context?.downMonitorStatusId,
        filterCondition: FilterCondition.All,
        filters: item.filters,
        incidents: [],
        alerts: [],
        createAlerts: item.createAlerts,
        createIncidents: item.createIncidents,
        /*
         * Never claim to change monitor status without a status to change
         * to — a caller that passes no context would otherwise produce
         * criteria that "change" the monitor to an undefined status.
         */
        changeMonitorStatus:
          item.createIncidents && Boolean(context?.downMonitorStatusId),
        isEnabled: true,
        name: item.name,
        description: item.description,
      };
      return instance;
    });
  }
}
