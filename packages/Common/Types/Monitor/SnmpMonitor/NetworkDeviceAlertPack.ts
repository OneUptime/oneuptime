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
import SnmpOidListUtil from "./SnmpOidListUtil";
import { TRANSCEIVER_RX_DROP_ALERT_DB } from "../../../Utils/NetworkDevice/TransceiverHealthUtil";
import { FibreChannelCounter } from "./SnmpFibreChannel";
import {
  RMON_FALLING_ALARM_TRAP_OIDS,
  RMON_RISING_ALARM_TRAP_OIDS,
} from "../../../Utils/NetworkEvent/RmonAlarmTrap";

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
  /*
   * How the filters combine: All, unless the item lists several trap OIDs
   * any one of which is the event (FilterCondition.Any).
   */
  filterCondition?: FilterCondition | undefined;
  /*
   * The incident's or alert's title, when it should say more than the
   * criteria's name: "Port monitor: {{trapAlarmCounter}} on
   * {{trapInterface}}" names the counter and the interface a trap is about.
   */
  title?: string | undefined;
  /*
   * A problem with a device that is up (issue #11071): met, the monitor is
   * up - the context's upMonitorStatusId. Without it, the first criteria to
   * match decides the status and this one changes none, so a device that
   * was down for one poll and came back with the problem still there kept
   * the down status for as long as the problem lasted.
   */
  keepsDeviceUp?: boolean | undefined;
}

export interface NetworkDeviceAlertPackContext {
  // Status to move the monitor to when a pack criteria matches (offline/degraded).
  downMonitorStatusId?: ObjectID | undefined;
  /*
   * The status of a device that is up: what an item that keepsDeviceUp
   * moves the monitor to - the monitor's default status, where it goes when
   * nothing matches. Left out, such an item changes no status, as before.
   */
  upMonitorStatusId?: ObjectID | undefined;
  /*
   * The severity each item's incident or alert starts on. Left out, the
   * item still gets its incident or alert - titled, auto-resolving - and
   * the monitor form asks for the severity before the monitor is saved.
   */
  incidentSeverityId?: ObjectID | undefined;
  alertSeverityId?: ObjectID | undefined;
  /*
   * The device's effective SNMP tables. Every table that declares what a
   * healthy row looks like adds one criteria to the pack, alerting once per
   * unhealthy row - a tunnel down, a fan failed, a fabric neighbour lost.
   */
  tables?: Array<SnmpTableDefinition> | undefined;
  /*
   * The device's vendor template (SnmpVendorTemplateUtil.matchDevice), for
   * the alerts only its platform has: a SAN switch's Fibre Channel errors,
   * credit loss and fabric traps.
   */
  vendorTemplateId?: string | undefined;
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
   *
   * Issue #11071: it reads the ping itself (Device Is Reachable (ICMP)), so
   * a device that answers nothing is down and not also told its SNMP is
   * failing, and it keeps the device up - one SNMP credential problem
   * across a fleet is that many "SNMP walk failing" alerts, never that
   * many devices left Offline after one unreachable poll.
   */
  {
    name: "SNMP walk failing",
    description:
      "The device answers ping but its SNMP walk is failing — check the credentials, the SNMP agent, or an ACL.",
    filters: [
      {
        checkOn: CheckOn.IcmpIsReachable,
        filterType: FilterType.True,
        value: undefined,
      },
      {
        checkOn: CheckOn.SnmpWalkIsSucceeding,
        filterType: FilterType.False,
        value: undefined,
      },
    ],
    createIncidents: false,
    createAlerts: true,
    keepsDeviceUp: true,
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

// --- SAN switches (Brocade Fabric OS, Cisco MDS 9000) ---

/*
 * A Fibre Channel port's errors, raised once per port. Far lower than the
 * one-a-second "Interface errors" it replaces on a SAN switch: on a healthy
 * fabric a port takes no CRC errors at all, and a bad optic or cable shows
 * up as a trickle long before the link drops. A host's port that bounces
 * (the host rebooted) counts a few, so the bar is above one a minute, not 0.
 */
const FIBRE_CHANNEL_ERRORS_PER_SECOND: number = 0.1;

// The item name the SAN packs' own errors item stands in for.
const INTERFACE_ERRORS_ITEM_NAME: string = "Interface errors";

function trapReceived(trapOid: string): CriteriaFilter {
  return {
    checkOn: CheckOn.SnmpTrapReceived,
    filterType: FilterType.EqualTo,
    value: trapOid,
  };
}

function trapVarbind(oid: string, value: string): CriteriaFilter {
  return {
    checkOn: CheckOn.SnmpTrapVarbindValue,
    filterType: FilterType.EqualTo,
    value: value,
    snmpMonitorOptions: { oid: oid },
  };
}

function fibreChannelCounterAbove(
  counter: FibreChannelCounter,
  perSecond: number,
): CriteriaFilter {
  return {
    checkOn: CheckOn.SnmpFibreChannelCounterPerSecond,
    filterType: FilterType.GreaterThan,
    value: perSecond,
    snmpMonitorOptions: { interfaceName: "*", fibreChannelCounter: counter },
  };
}

const FIBRE_CHANNEL_PORT_ERRORS: NetworkDeviceAlertPackItem = {
  name: "Fibre Channel port errors",
  description:
    "A Fibre Channel port is taking errors (CRC errors, invalid transmission words, link failures, loss of sync or of signal) more than once in ten seconds: usually a dirty connector, a damaged cable or a failing optic. Raised once per port.",
  filters: [
    {
      checkOn: CheckOn.SnmpInterfaceErrorsPerSecond,
      filterType: FilterType.GreaterThan,
      value: FIBRE_CHANNEL_ERRORS_PER_SECOND,
      snmpMonitorOptions: { interfaceName: "*" },
    },
  ],
  createIncidents: false,
  createAlerts: true,
};

// Brocade Fabric OS: SW-MIB, HA-MIB and BROCADE-MAPS-MIB traps.
const SW_TRAPS: string = "1.3.6.1.4.1.1588.2.1.1.1.0";

const BROCADE_FOS_ITEMS: Array<NetworkDeviceAlertPackItem> = [
  FIBRE_CHANNEL_PORT_ERRORS,
  {
    name: "Fibre Channel frames discarded",
    description:
      "A port is dropping class 3 frames it could not deliver in time: often a slow-draining device, or a congested inter-switch link. Raised once per port.",
    filters: [
      fibreChannelCounterAbove(
        FibreChannelCounter.Discards,
        FIBRE_CHANNEL_ERRORS_PER_SECOND,
      ),
    ],
    createIncidents: false,
    createAlerts: true,
  },
  {
    name: "Switch not online",
    description:
      "Fabric OS reports the switch offline, testing or faulty (swOperStatus) rather than online.",
    filters: [
      {
        checkOn: CheckOn.SnmpOidValue,
        filterType: FilterType.NotEqualTo,
        value: 1,
        snmpMonitorOptions: { oid: "1.3.6.1.4.1.1588.2.1.1.1.1.7.0" },
      },
    ],
    createIncidents: true,
    createAlerts: false,
  },
  /*
   * swFCPortScn for a port that went offline (swFCPortOpStatus 2) and was
   * an E-port before (swFCPortPrevType 5, which only this trap carries):
   * an inter-switch link down, seconds after it happened.
   */
  {
    name: "Inter-switch link down",
    description:
      "An E-port went offline: the fabric lost an inter-switch link and may have split. From the port state change trap (swFCPortScn) Fabric OS sends.",
    filters: [
      trapReceived(`${SW_TRAPS}.3`),
      trapVarbind("1.3.6.1.4.1.1588.2.1.1.1.6.2.1.4", "2"),
      trapVarbind("1.3.6.1.4.1.1588.2.1.1.1.1.35", "5"),
    ],
    createIncidents: false,
    createAlerts: true,
  },
  {
    name: "Fabric segmented",
    description:
      "An inter-switch link segmented: the switches at its two ends no longer form one fabric (swFabricSegmentTrap).",
    filters: [trapReceived(`${SW_TRAPS}.10`)],
    createIncidents: false,
    createAlerts: true,
  },
  {
    name: "Fabric reconfigured",
    description:
      "The fabric reconfigured: a switch joined or left, or a principal switch was elected again (swFabricReconfigTrap).",
    filters: [trapReceived(`${SW_TRAPS}.9`)],
    createIncidents: false,
    createAlerts: true,
  },
  {
    name: "Zone configuration changed",
    description:
      "The switch's zone database changed (swZoneConfigChangeTrap): check it was a planned change, since zoning decides which hosts reach which storage.",
    filters: [trapReceived(`${SW_TRAPS}.16`)],
    createIncidents: false,
    createAlerts: true,
  },
  {
    name: "MAPS alert",
    description:
      "A MAPS rule on the switch fired (mapsTrapAM): Fabric OS's own monitoring saw a threshold crossed. Fabric OS 9.1 and later report MAPS only this way.",
    filters: [trapReceived("1.3.6.1.4.1.1588.3.1.4.0.1")],
    createIncidents: false,
    createAlerts: true,
  },
  {
    name: "Field-replaceable unit changed",
    description:
      "A blade, power supply, fan or WWN card changed state, or a control processor failed over (fruStatusChanged, cpStatusChanged).",
    filters: [
      trapReceived("1.3.6.1.4.1.1588.2.1.2.2.0.1"),
      trapReceived("1.3.6.1.4.1.1588.2.1.2.2.0.2"),
    ],
    filterCondition: FilterCondition.Any,
    createIncidents: false,
    createAlerts: true,
  },
];

const CISCO_MDS_ITEMS: Array<NetworkDeviceAlertPackItem> = [
  FIBRE_CHANNEL_PORT_ERRORS,
  {
    name: "Credit loss (slow drain)",
    description:
      "An interface reset its link because the attached device stopped returning buffer credit: a slow-draining host or array, which slows every flow behind it. Raised once per interface.",
    filters: [fibreChannelCounterAbove(FibreChannelCounter.CreditLoss, 0)],
    createIncidents: false,
    createAlerts: true,
  },
  {
    name: "Timeout discards (slow drain)",
    description:
      "An interface is dropping frames that waited too long for credit: a slow-draining device downstream. Raised once per interface.",
    filters: [
      fibreChannelCounterAbove(
        FibreChannelCounter.TimeoutDiscards,
        FIBRE_CHANNEL_ERRORS_PER_SECOND,
      ),
    ],
    createIncidents: false,
    createAlerts: true,
  },
  /*
   * An MDS port-monitor policy sends its alerts as RMON alarms: the title
   * says which counter crossed which way, on which interface.
   */
  {
    name: "Port monitor alarm",
    description:
      "A port-monitor policy on the switch saw a counter cross its threshold (an RMON rising or falling alarm), on the interface the title names.",
    title:
      "Port monitor: {{trapAlarmCounter}} {{trapAlarmDirection}} on {{trapInterface}}",
    filters: [
      ...RMON_RISING_ALARM_TRAP_OIDS,
      ...RMON_FALLING_ALARM_TRAP_OIDS,
    ].map((trapOid: string) => {
      return trapReceived(trapOid);
    }),
    filterCondition: FilterCondition.Any,
    createIncidents: false,
    createAlerts: true,
  },
  {
    name: "Link down (trap)",
    description:
      "The switch reported an interface going down (linkDown, cieLinkDown), seconds after it happened rather than at the next poll.",
    title: "Link down: {{trapInterface}}",
    filters: [
      trapReceived("1.3.6.1.6.3.1.1.5.3"),
      trapReceived("1.3.6.1.4.1.9.9.276.0.1"),
    ],
    filterCondition: FilterCondition.Any,
    createIncidents: false,
    createAlerts: true,
  },
  {
    name: "Module, power supply or fan changed",
    description:
      "A module, power supply or fan tray changed state, or a field-replaceable unit was removed (CISCO-ENTITY-FRU-CONTROL-MIB).",
    filters: [
      trapReceived("1.3.6.1.4.1.9.9.117.2.0.1"),
      trapReceived("1.3.6.1.4.1.9.9.117.2.0.2"),
      trapReceived("1.3.6.1.4.1.9.9.117.2.0.4"),
      trapReceived("1.3.6.1.4.1.9.9.117.2.0.6"),
    ],
    filterCondition: FilterCondition.Any,
    createIncidents: false,
    createAlerts: true,
  },
  {
    name: "Zone set activated",
    description:
      "A zone set was activated (zoneActivateNotify): check it was a planned change, since zoning decides which hosts reach which storage.",
    filters: [trapReceived("1.3.6.1.4.1.9.9.294.1.4.0.6")],
    createIncidents: false,
    createAlerts: true,
  },
  {
    name: "Zone merge failed",
    description:
      "Two switches could not merge their zone databases (zoneMergeFailureNotify): the link between them is isolated until the conflict is fixed.",
    filters: [trapReceived("1.3.6.1.4.1.9.9.294.1.4.0.2")],
    createIncidents: false,
    createAlerts: true,
  },
  {
    name: "VSAN changed",
    description:
      "A VSAN changed state, or interfaces moved in or out of one (vsanStatusChange, vsanPortMembershipChange).",
    filters: [
      trapReceived("1.3.6.1.4.1.9.9.282.1.3.0.1"),
      trapReceived("1.3.6.1.4.1.9.9.282.1.3.0.2"),
    ],
    filterCondition: FilterCondition.Any,
    createIncidents: false,
    createAlerts: true,
  },
  {
    name: "Fabric changed",
    description:
      "The fabric changed: a reconfiguration, or a new principal switch (dmFabricChangeNotify, dmNewPrincipalSwitchNotify).",
    filters: [
      trapReceived("1.3.6.1.4.1.9.9.302.1.3.0.3"),
      trapReceived("1.3.6.1.4.1.9.9.302.1.3.0.2"),
    ],
    filterCondition: FilterCondition.Any,
    createIncidents: false,
    createAlerts: true,
  },
];

/*
 * The alerts a vendor's platform adds to the pack, and the general items
 * they stand in for there.
 */
const VENDOR_ALERT_ITEMS: Record<
  string,
  { items: Array<NetworkDeviceAlertPackItem>; replaces: Array<string> }
> = {
  "brocade-fos": {
    items: BROCADE_FOS_ITEMS,
    replaces: [INTERFACE_ERRORS_ITEM_NAME],
  },
  "cisco-mds": {
    items: CISCO_MDS_ITEMS,
    replaces: [INTERFACE_ERRORS_ITEM_NAME],
  },
};

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
    vendorTemplateId?: string | undefined,
  ): Array<NetworkDeviceAlertPackItem> {
    const vendor:
      | { items: Array<NetworkDeviceAlertPackItem>; replaces: Array<string> }
      | undefined =
      NetworkDeviceAlertPackUtil.getVendorAlerts(vendorTemplateId);

    return [
      ...PACK.filter((item: NetworkDeviceAlertPackItem) => {
        return !vendor || !vendor.replaces.includes(item.name);
      }),
      ...(vendor?.items || []),
      ...NetworkDeviceAlertPackUtil.getTableHealthItems(tables),
    ];
  }

  // The alerts a vendor template brings to the pack, if it brings any.
  public static getVendorAlerts(
    vendorTemplateId: string | undefined,
  ):
    | { items: Array<NetworkDeviceAlertPackItem>; replaces: Array<string> }
    | undefined {
    if (!vendorTemplateId) {
      return undefined;
    }

    return Object.prototype.hasOwnProperty.call(
      VENDOR_ALERT_ITEMS,
      vendorTemplateId,
    )
      ? VENDOR_ALERT_ITEMS[vendorTemplateId]
      : undefined;
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
   * One criteria on one OID the device collects: what "Alert on it" on a
   * device's SNMP Walk page starts a monitor with (issue #5184), the OID
   * found by walking the device. An alert, not an incident, and the
   * monitor's status left alone: a value past a threshold is something to
   * look at, not an outage, until the person says otherwise. Severities and
   * on-call policies are theirs to pick, as for the pack.
   */
  public static buildOidValueCriteriaInstance(data: {
    oid: string;
    name: string;
    filterType: FilterType;
    value: string | number | undefined;
    /*
     * SNMP OID Value when left out; SNMP OID Rate (per second) for a
     * counter, which is alerted on by how fast it grows.
     */
    checkOn?: CheckOn.SnmpOidValue | CheckOn.SnmpOidRatePerSecond | undefined;
    // What the criteria watches, when the value alone does not say it.
    description?: string | undefined;
  }): MonitorCriteriaInstance {
    const oid: string = SnmpOidListUtil.normalizeOid(data.oid);
    const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

    instance.data = {
      id: ObjectID.generate().toString(),
      monitorStatusId: undefined,
      filterCondition: FilterCondition.All,
      filters: [
        {
          checkOn: data.checkOn || CheckOn.SnmpOidValue,
          filterType: data.filterType,
          value: data.value,
          snmpMonitorOptions: { oid: oid },
        },
      ],
      incidents: [],
      alerts: [],
      createAlerts: true,
      createIncidents: false,
      changeMonitorStatus: false,
      isEnabled: true,
      name: data.name,
      description:
        data.description ||
        `The value the device reports for ${data.name === oid ? oid : `${data.name} (${oid})`}.`,
    };

    return instance;
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
    return NetworkDeviceAlertPackUtil.getPackItems(
      context?.tables,
      context?.vendorTemplateId,
    ).map((item: NetworkDeviceAlertPackItem) => {
      const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
      const upMonitorStatusId: ObjectID | undefined = item.keepsDeviceUp
        ? context?.upMonitorStatusId
        : undefined;

      instance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: upMonitorStatusId || context?.downMonitorStatusId,
        filterCondition: item.filterCondition || FilterCondition.All,
        // A copy: the pack's filters are shared by every instance built.
        filters: item.filters.map((filter: CriteriaFilter) => {
          return {
            ...filter,
            ...(filter.snmpMonitorOptions
              ? { snmpMonitorOptions: { ...filter.snmpMonitorOptions } }
              : {}),
          };
        }),
        /*
         * One incident for an item that declares incidents, one alert for
         * one that raises alerts. They used to be left empty for the user
         * to fill in, but the form gave an empty list no row to fill in
         * and saving checked nothing in it - so "Device unreachable" and
         * "Interface down" changed the monitor's status and paged nobody.
         */
        incidents: item.createIncidents
          ? [
              {
                id: ObjectID.generate().toString(),
                title: item.title || item.name,
                description: item.description,
                incidentSeverityId: context?.incidentSeverityId,
                autoResolveIncident: true,
                onCallPolicyIds: [],
              },
            ]
          : [],
        alerts: item.createAlerts
          ? [
              {
                id: ObjectID.generate().toString(),
                title: item.title || item.name,
                description: item.description,
                alertSeverityId: context?.alertSeverityId,
                autoResolveAlert: true,
                onCallPolicyIds: [],
              },
            ]
          : [],
        createAlerts: item.createAlerts,
        createIncidents: item.createIncidents,
        /*
         * Never claim to change monitor status without a status to change
         * to — a caller that passes no context would otherwise produce
         * criteria that "change" the monitor to an undefined status.
         */
        changeMonitorStatus: upMonitorStatusId
          ? true
          : item.createIncidents && Boolean(context?.downMonitorStatusId),
        isEnabled: true,
        name: item.name,
        description: item.description,
      };
      return instance;
    });
  }
}
