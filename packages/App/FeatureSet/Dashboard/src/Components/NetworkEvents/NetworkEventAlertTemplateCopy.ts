import IconProp from "Common/Types/Icon/IconProp";
import { NetworkEventAlertTemplateId } from "Common/Types/NetworkEvent/NetworkEventAlertTemplates";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of each featured network event alert
 * (NetworkEventAlertTemplates in Common holds what it does): the card on
 * the Events page, and the name and alert text of the monitor it creates.
 * Wrapped in translationKey() so the extractor finds them; looked up where
 * they are shown, in the reader's language.
 *
 * An alert's title does not name the device or the interface: the alert
 * is one of a group, and its group ("Interface: Gi0/1, Device: Core
 * Switch") is added to the title when the alert is raised.
 */

export interface NetworkEventAlertTemplateCopy {
  // The card's title: what goes wrong, in a few words.
  title: string;
  // One or two sentences: when it tells you, and when it stops.
  description: string;
  // The monitor's name, and the title of the alert it raises.
  monitorName: string;
  // The monitor's description: what it watches.
  monitorDescription: string;
  // What the alert says.
  alertDescription: string;
  icon: IconProp;
  // The card's icon tile and icon colours.
  iconTileClassName: string;
  iconClassName: string;
}

const CRITICAL_TILE: string = "bg-red-50";
const CRITICAL_ICON: string = "text-red-600";
const WARNING_TILE: string = "bg-amber-50";
const WARNING_ICON: string = "text-amber-600";

export const NETWORK_EVENT_ALERT_TEMPLATE_COPY: Record<
  NetworkEventAlertTemplateId,
  NetworkEventAlertTemplateCopy
> = {
  [NetworkEventAlertTemplateId.VpnTunnelDown]: {
    title: translationKey("A VPN tunnel goes down"),
    description: translationKey(
      "When a firewall or router reports a site-to-site tunnel down. One alert per tunnel, closed when the tunnel comes back up.",
    ),
    monitorName: translationKey("VPN tunnel down"),
    monitorDescription: translationKey(
      "Alerts you when a device reports a site-to-site VPN tunnel down, once per device and tunnel. The alert closes when the device reports the tunnel up again.",
    ),
    alertDescription: translationKey(
      "A device reported that this VPN tunnel went down.",
    ),
    icon: IconProp.Lock,
    iconTileClassName: CRITICAL_TILE,
    iconClassName: CRITICAL_ICON,
  },
  [NetworkEventAlertTemplateId.HaFailover]: {
    title: translationKey("A firewall or switch fails over"),
    description: translationKey(
      "When a high-availability pair, cluster or stack reports that another unit took over.",
    ),
    monitorName: translationKey("High availability failover"),
    monitorDescription: translationKey(
      "Alerts you when a high-availability pair, cluster or stack reports a failover, once per device.",
    ),
    alertDescription: translationKey(
      "A device reported that another unit of its high-availability pair, cluster or stack took over.",
    ),
    icon: IconProp.Refresh,
    iconTileClassName: CRITICAL_TILE,
    iconClassName: CRITICAL_ICON,
  },
  [NetworkEventAlertTemplateId.WanGatewayDown]: {
    title: translationKey("A WAN link goes down"),
    description: translationKey(
      "When a firewall reports a gateway or WAN link down. One alert per gateway, closed when it comes back up.",
    ),
    monitorName: translationKey("WAN link down"),
    monitorDescription: translationKey(
      "Alerts you when a device reports a gateway or WAN link down, once per device and gateway. The alert closes when the device reports it up again.",
    ),
    alertDescription: translationKey(
      "A device reported that this gateway or WAN link went down.",
    ),
    icon: IconProp.Globe,
    iconTileClassName: CRITICAL_TILE,
    iconClassName: CRITICAL_ICON,
  },
  [NetworkEventAlertTemplateId.RoutingNeighborDown]: {
    title: translationKey("A routing neighbor goes down"),
    description: translationKey(
      "When a router reports a BGP, OSPF, EIGRP or IS-IS neighbor down. One alert per neighbor, closed when it comes back.",
    ),
    monitorName: translationKey("Routing neighbor down"),
    monitorDescription: translationKey(
      "Alerts you when a router reports a BGP, OSPF, EIGRP or IS-IS neighbor down, once per device and neighbor. The alert closes when the router reports the neighbor back.",
    ),
    alertDescription: translationKey(
      "A router reported that it lost this routing neighbor.",
    ),
    icon: IconProp.ArrowCircleRight,
    iconTileClassName: CRITICAL_TILE,
    iconClassName: CRITICAL_ICON,
  },
  [NetworkEventAlertTemplateId.DeviceReboot]: {
    title: translationKey("A device restarts"),
    description: translationKey(
      "When a device reports that it rebooted or started up.",
    ),
    monitorName: translationKey("Device restarted"),
    monitorDescription: translationKey(
      "Alerts you when a device reports that it rebooted or started up, once per device.",
    ),
    alertDescription: translationKey(
      "A device reported that it rebooted or started up.",
    ),
    icon: IconProp.Power,
    iconTileClassName: WARNING_TILE,
    iconClassName: WARNING_ICON,
  },
  [NetworkEventAlertTemplateId.HardwareFailure]: {
    title: translationKey("Hardware fails"),
    description: translationKey(
      "When a device reports a failed fan or power supply, or that it is running too hot. One alert per component, closed when the device reports it working again.",
    ),
    monitorName: translationKey("Hardware failure"),
    monitorDescription: translationKey(
      "Alerts you when a device reports a failed fan or power supply, or that it is running too hot, once per device and component. The alert closes when the device reports the component working again. A temperature alert stays open until you close it.",
    ),
    alertDescription: translationKey("A device reported a hardware problem."),
    icon: IconProp.Cog,
    iconTileClassName: CRITICAL_TILE,
    iconClassName: CRITICAL_ICON,
  },
  [NetworkEventAlertTemplateId.InterfaceDown]: {
    title: translationKey("An interface goes down"),
    description: translationKey(
      "When a device reports a link down. One alert per interface, closed when the link comes back up. Busy on access switches: narrow it to the ports you care about before you save.",
    ),
    monitorName: translationKey("Interface down"),
    monitorDescription: translationKey(
      "Alerts you when a device reports a link down, once per device and interface. The alert closes when the device reports the link up again.",
    ),
    alertDescription: translationKey(
      "A device reported that this link went down.",
    ),
    icon: IconProp.Signal,
    iconTileClassName: WARNING_TILE,
    iconClassName: WARNING_ICON,
  },
  [NetworkEventAlertTemplateId.FailedLogins]: {
    title: translationKey("Someone keeps failing to sign in"),
    description: translationKey(
      "When a device reports more than 10 failed sign-ins in 5 minutes.",
    ),
    monitorName: translationKey("Repeated failed sign-ins"),
    monitorDescription: translationKey(
      "Alerts you when a device reports more than 10 failed sign-ins in 5 minutes, once per device.",
    ),
    alertDescription: translationKey(
      "A device reported more than 10 failed sign-ins in the last 5 minutes.",
    ),
    icon: IconProp.ShieldCheck,
    iconTileClassName: WARNING_TILE,
    iconClassName: WARNING_ICON,
  },
};
