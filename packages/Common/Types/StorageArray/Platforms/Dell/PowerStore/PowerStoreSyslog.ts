import { StorageArrayLogAlertTemplateSpec } from "../../../StorageArrayPlatform";

/*
 * DELL POWERSTORE'S ALERTS, AS THE AGENT RECEIVES THEM BY SYSLOG.
 *
 * Dell's exporter reads no alerts, so a PowerStore sends its own: its remote
 * syslog (Settings > Security > Remote Logging) carries an AlertEvent line
 * for every event that raises, updates or clears one of its alerts, and its
 * audit log. The agent's syslog collector
 * (agents/StorageArrayAgent/powerstore-syslog.yaml)
 * reads PowerStore's record - an RFC 3164 line whose message is PowerStore's
 * own header and one RFC 5424 structured-data element,
 * [PowerStore_remote_logging_alert@1139 alert_id="..." alert_state="Active"
 * event_code="0x00307404" ...] - into the flat attributes below, and gives
 * each alert line the severity Dell's Events and Alerts Reference Guide
 * gives its event code (the record has none of its own).
 *
 * An alert is one alert_id from the line that raises it to the line that
 * clears it; the event code changes along the way (a port's alert is raised
 * by 0x00307404, Port link is down, and cleared by 0x00307401, Port state
 * has changed). So each template groups by the alert, opens on the lines
 * of its severity or code, and resolves on that alert's Cleared line, which
 * the collector gives no severity. These names are stored with every line
 * and in every monitor made from a template: never rename one.
 */

export const POWERSTORE_LOG_ATTRIBUTES: {
  messageType: string;
  alertId: string;
  alertState: string;
  alertSeverity: string;
  eventCode: string;
  eventName: string;
  resourceType: string;
  resourceName: string;
  applianceName: string;
} = {
  // AlertEvent for an alert's line; Authentication, Config, ... for audit.
  messageType: "powerstore.message_type",
  alertId: "powerstore.alert.id",
  // Active or Cleared.
  alertState: "powerstore.alert.state",
  // Critical, Major, Minor or Info; none on a Cleared line.
  alertSeverity: "powerstore.alert.severity",
  eventCode: "powerstore.event.code",
  eventName: "powerstore.event.name",
  resourceType: "powerstore.resource.type",
  resourceName: "powerstore.resource.name",
  applianceName: "powerstore.appliance.name",
};

export const POWERSTORE_ALERT_STATE_CLEARED: string = "Cleared";

// PowerStore's event code for "Port link is down." (Major), on a port in use.
export const POWERSTORE_PORT_LINK_DOWN_EVENT_CODE: string = "0x00307404";

// An alert's raise, and its clear, by the attributes both lines carry.
const ONE_ALERT: Array<string> = [
  POWERSTORE_LOG_ATTRIBUTES.resourceName,
  POWERSTORE_LOG_ATTRIBUTES.alertId,
];

const CLEARED: Record<string, string> = {
  [POWERSTORE_LOG_ATTRIBUTES.alertState]: POWERSTORE_ALERT_STATE_CLEARED,
};

/*
 * How far back each check looks for a line that opens an alert. What
 * closes one is its Cleared line, however late it comes.
 */
const WINDOW_SECONDS: number = 3600;

const POWERSTORE_LOG_ALERT_TEMPLATES: Array<StorageArrayLogAlertTemplateSpec> =
  [
    {
      id: "powerstore-critical-alert",
      name: "Critical Array Alert",
      summary:
        "The PowerStore raises a Critical alert: one alert each, until it clears it.",
      description:
        "Alert when the PowerStore raises an alert of Critical severity: a failed drive or node, an appliance out of space, a tier offline. Each of its alerts raises its own, which resolves when the PowerStore clears it. Needs the PowerStore's remote syslog sent to the agent. It is a Logs monitor over the lines the agent's syslog collector reads.",
      category: "Array Alerts",
      severity: "Critical",
      attributes: { [POWERSTORE_LOG_ATTRIBUTES.alertSeverity]: "Critical" },
      groupByAttributes: ONE_ALERT,
      resolvedByAttributes: CLEARED,
      windowSeconds: WINDOW_SECONDS,
      incidentTitle: "[Storage Array] CRITICAL: PowerStore Alert",
      incidentDescription:
        "The PowerStore raised a Critical alert. The alert's object is named under this title; its message, event code, system impact and repair steps are in the root cause and on the array's Logs page. It resolves when the PowerStore clears the alert.",
      criteriaName: "Critical alert raised",
      criteriaDescription:
        "The PowerStore raised a Critical alert it has not cleared since.",
      healthyDescription: "Every Critical alert the PowerStore raised is cleared.",
    },
    {
      id: "powerstore-major-alert",
      name: "Major Array Alert",
      summary:
        "The PowerStore raises a Major alert: one alert each, until it clears it.",
      description:
        "Alert when the PowerStore raises an alert of Major severity: a faulted power supply or fan, a port link down, capacity above 90%, a drive rebuild interrupted. Each of its alerts raises its own, which resolves when the PowerStore clears it. Needs the PowerStore's remote syslog sent to the agent. It is a Logs monitor over the lines the agent's syslog collector reads.",
      category: "Array Alerts",
      severity: "Warning",
      attributes: { [POWERSTORE_LOG_ATTRIBUTES.alertSeverity]: "Major" },
      groupByAttributes: ONE_ALERT,
      resolvedByAttributes: CLEARED,
      windowSeconds: WINDOW_SECONDS,
      incidentTitle: "[Storage Array] PowerStore Major Alert",
      incidentDescription:
        "The PowerStore raised a Major alert. The alert's object is named under this title; its message, event code, system impact and repair steps are in the root cause and on the array's Logs page. It resolves when the PowerStore clears the alert.",
      criteriaName: "Major alert raised",
      criteriaDescription:
        "The PowerStore raised a Major alert it has not cleared since.",
      healthyDescription: "Every Major alert the PowerStore raised is cleared.",
    },
    {
      id: "powerstore-port-link-down",
      name: "Port Link Down",
      summary:
        "A port the PowerStore uses loses its link: one alert per port, until it is back.",
      description:
        "Alert when the PowerStore reports that the link of a Fibre Channel or Ethernet port it uses is down (event 0x00307404, Port link is down). PowerStore raises it only for ports in use, never for a port nothing is cabled to. One alert per port, which resolves when the link is back. Needs the PowerStore's remote syslog sent to the agent. It is a Logs monitor over the lines the agent's syslog collector reads.",
      category: "Array Alerts",
      severity: "Warning",
      attributes: {
        [POWERSTORE_LOG_ATTRIBUTES.eventCode]:
          POWERSTORE_PORT_LINK_DOWN_EVENT_CODE,
      },
      groupByAttributes: ONE_ALERT,
      resolvedByAttributes: CLEARED,
      windowSeconds: WINDOW_SECONDS,
      incidentTitle: "[Storage Array] Port Link Down",
      incidentDescription:
        "A port the PowerStore uses lost its link; the port is named under this title. Check its cable, its SFP and the switch port it connects to, and the hosts that reach the array through it. It resolves when the PowerStore reports the link back.",
      criteriaName: "Port link down",
      criteriaDescription:
        "The PowerStore reported a port link down that has not come back since.",
      healthyDescription: "Every port link the PowerStore reported down is back.",
    },
  ];

export default POWERSTORE_LOG_ALERT_TEMPLATES;
