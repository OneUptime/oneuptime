import ObjectID from "../../ObjectID";
import FilterCondition from "../../Filter/FilterCondition";
import { CheckOn, CriteriaFilter, FilterType } from "../CriteriaFilter";
import MonitorCriteriaInstance from "../MonitorCriteriaInstance";
import {
  SnmpTableColumn,
  SnmpTableDefinition,
  SnmpTableKind,
} from "./SnmpTable";
import SnmpTableListUtil from "./SnmpTableListUtil";
import { TRANSCEIVER_RX_DROP_ALERT_DB } from "../../../Utils/NetworkDevice/TransceiverHealthUtil";

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
  /*
   * The device's effective SNMP tables. Every table that declares what a
   * healthy row looks like adds one criteria to the pack, alerting once per
   * unhealthy row - a tunnel down, a fan failed, a fabric neighbour lost.
   */
  tables?: Array<SnmpTableDefinition> | undefined;
}

const PACK: Array<NetworkDeviceAlertPackItem> = [
  {
    name: "Device unreachable",
    description:
      "The device stopped answering ping and SNMP — likely down or unreachable.",
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
  /*
   * An alert, not an incident: the device is still answering ping, so it is
   * not down - but its SNMP walk is failing, which means no interfaces, no
   * inventory and no health OIDs until someone fixes the credentials, the
   * agent or the ACL. Never fires on a device that is only pinged: the
   * criterion is not evaluated at all when no walk ran.
   */
  {
    name: "SNMP walk failing",
    description:
      "The device answers ping but its SNMP walk is failing — check the credentials, the SNMP agent, or an ACL.",
    filters: [
      {
        checkOn: CheckOn.SnmpWalkIsSucceeding,
        filterType: FilterType.False,
        value: undefined,
      },
    ],
    createIncidents: false,
    createAlerts: true,
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
  /*
   * The transceiver items. Alerts, not incidents: a dark optic already takes
   * its interface down, and "Interface down" pages for that - these say why,
   * or warn before it happens. Each raises one alert per port ("*"), and
   * none can fire on a device that reports no optics.
   */
  {
    name: "Transceiver not detected",
    description:
      "An optic (SFP, SFP+, QSFP) that was in a port is no longer detected while the port is still enabled - pulled, failed, or no longer seated.",
    filters: [
      {
        checkOn: CheckOn.SnmpTransceiverNotDetected,
        filterType: FilterType.True,
        value: undefined,
        snmpMonitorOptions: { interfaceName: "*" },
      },
    ],
    createIncidents: false,
    createAlerts: true,
  },
  {
    name: "Transceiver past its alarm threshold",
    description:
      "An optic's temperature, voltage, bias current or transmit or receive power is past the alarm threshold the device itself reports, or the device flags a loss of signal or a transmitter fault.",
    filters: [
      {
        checkOn: CheckOn.SnmpTransceiverPastAlarmThreshold,
        filterType: FilterType.True,
        value: undefined,
        snmpMonitorOptions: { interfaceName: "*" },
      },
    ],
    createIncidents: false,
    createAlerts: true,
  },
  {
    name: "Transceiver RX power dropping",
    description: `An optic receives at least ${TRANSCEIVER_RX_DROP_ALERT_DB} dB less light than on its best day of the last 30 - a dirty connector, a bent fibre or an optic wearing out, usually well before the link drops.`,
    filters: [
      {
        checkOn: CheckOn.SnmpTransceiverRxPowerDrop,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: TRANSCEIVER_RX_DROP_ALERT_DB,
        snmpMonitorOptions: { interfaceName: "*" },
      },
    ],
    createIncidents: false,
    createAlerts: true,
  },
];

/*
 * Tables whose rows are links, sessions or whole access points: a row going
 * unhealthy there is an outage someone should be paged for - a tunnel down,
 * a fabric neighbour lost, an access point gone from its controller and its
 * area without Wi-Fi. Everything else (fans, power supplies, radios) raises
 * an alert.
 */
const INCIDENT_TABLE_KINDS: Array<SnmpTableKind> = [
  SnmpTableKind.VpnTunnel,
  SnmpTableKind.RoutingAdjacency,
  SnmpTableKind.WifiAccessPoint,
];

export default class NetworkDeviceAlertPackUtil {
  public static getPackItems(
    tables?: Array<SnmpTableDefinition> | undefined,
  ): Array<NetworkDeviceAlertPackItem> {
    return [...PACK, ...NetworkDeviceAlertPackUtil.getTableHealthItems(tables)];
  }

  /*
   * One criteria per table that knows what healthy means, firing once per
   * row ("*") so each tunnel or fan alerts and resolves on its own.
   */
  public static getTableHealthItems(
    tables: Array<SnmpTableDefinition> | undefined,
  ): Array<NetworkDeviceAlertPackItem> {
    const items: Array<NetworkDeviceAlertPackItem> = [];

    for (const table of tables || []) {
      const hasHealthyValues: boolean = (table.columns || []).some(
        (column: SnmpTableColumn) => {
          return Boolean(
            column.healthyValues && column.healthyValues.length > 0,
          );
        },
      );

      if (!hasHealthyValues || !table.key) {
        continue;
      }

      const isIncident: boolean = INCIDENT_TABLE_KINDS.includes(
        SnmpTableListUtil.parseKind(table.kind),
      );

      items.push({
        name: `${table.name}: row unhealthy`,
        description: `A row of the ${table.name} table reports a status outside its healthy values. Raised once per row.`,
        filters: [
          {
            checkOn: CheckOn.SnmpTableRowIsUnhealthy,
            filterType: FilterType.True,
            value: undefined,
            snmpMonitorOptions: {
              tableKey: table.key,
              tableRow: "*",
            },
          },
        ],
        createIncidents: isIncident,
        createAlerts: !isIncident,
      });
    }

    return items;
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
    return NetworkDeviceAlertPackUtil.getPackItems(context?.tables).map(
      (item: NetworkDeviceAlertPackItem) => {
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
      },
    );
  }
}
