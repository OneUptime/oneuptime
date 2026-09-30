import { JSONObject } from "Common/Types/JSON";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";

/*
 * The interval a monitor made on the create page starts with.
 *
 * A monitor that a probe checks cannot be saved without one, and the field
 * used to start empty - one more required decision, on the way to a first
 * monitor, that a new user has no basis for making. Five minutes is also
 * what the page's own prefills (the metric view, the Ping monitor for a
 * network device) already use.
 */
export const DEFAULT_MONITORING_INTERVAL: string = "*/5 * * * *";

/*
 * The create form's starting values with the default interval in them. A
 * prefill that says anything about the interval - a template's, a deep
 * link's, even an empty one - is left exactly as it is.
 */
export const withDefaultMonitoringInterval: (
  initialValues: JSONObject,
) => JSONObject = (initialValues: JSONObject): JSONObject => {
  if (
    Object.prototype.hasOwnProperty.call(initialValues, "monitoringInterval")
  ) {
    return initialValues;
  }

  return {
    ...initialValues,
    monitoringInterval: DEFAULT_MONITORING_INTERVAL,
  };
};

/*
 * Whether a monitor about to be created still carries only the default.
 *
 * The default answers a question the "Probes & Interval" step asks, and only
 * probe-checked types show that step. Every other type (Manual, Incoming
 * Request, Logs, Kubernetes, ...) never asked, and was created with no
 * interval before the default existed - so it must be created that way
 * still, rather than inherit a schedule nobody chose.
 */
export const shouldDropDefaultMonitoringInterval: (data: {
  monitorType: MonitorType | undefined;
  // A prefill (template, deep link) set the interval on purpose.
  isIntervalPrefilled: boolean;
}) => boolean = (data: {
  monitorType: MonitorType | undefined;
  isIntervalPrefilled: boolean;
}): boolean => {
  if (data.isIntervalPrefilled || !data.monitorType) {
    return false;
  }

  return !MonitorTypeHelper.doesMonitorTypeHaveInterval(data.monitorType);
};
