import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  monitorId: ObjectID;
  refreshToggle?: string | undefined;
}

// The banner's message for a monitor, or "" when it is being monitored.
export const getDisabledMessage: (monitor: Monitor | null) => string = (
  monitor: Monitor | null,
): string => {
  if (!monitor || monitor.monitorType === MonitorType.Manual) {
    return "";
  }

  if (monitor.disableActiveMonitoring) {
    return "We are not monitoring this monitor since it is disabled. To enable active monitoring, please go to Settings.";
  }

  if (monitor.disableActiveMonitoringBecauseOfManualIncident) {
    return "We are not monitoring this monitor since it is disabled because of an active incident. To enable active monitoring, please resolve the incident.";
  }

  if (monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent) {
    return "We are not monitoring this monitor since it is disabled because of an ongoing scheduled maintenance event. To enable active monitoring, please resolve the scheduled maintenance event.";
  }

  return "";
};

const DisabledWarning: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [message, setMessage] = useState<string>("");
  const monitorIdString: string = props.monitorId.toString();

  useEffect(() => {
    let cancelled: boolean = false;

    /*
     * Start every read from "not disabled": the banner used to be set and
     * never cleared, so it stayed up after the monitor was re-enabled, and
     * a banner for the previous monitor showed on the next one.
     */
    setMessage("");

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const monitor: Monitor | null = await ModelAPI.getItem({
          modelType: Monitor,
          id: props.monitorId,
          select: {
            disableActiveMonitoring: true,
            disableActiveMonitoringBecauseOfManualIncident: true,
            disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
            monitorType: true,
          },
        });

        if (!cancelled) {
          setMessage(getDisabledMessage(monitor));
        }
      } catch {
        /*
         * A warning banner is not worth an error of its own: the page it
         * sits on reports its own failures. Show nothing rather than leave
         * an unhandled rejection behind.
         */
        if (!cancelled) {
          setMessage("");
        }
      }
    };

    load().catch(() => {
      // load() handles its own failures.
    });

    return () => {
      cancelled = true;
    };
  }, [monitorIdString, props.refreshToggle]);

  if (!message) {
    return <></>;
  }

  return (
    <Alert
      type={AlertType.DANGER}
      strongTitle="This monitor is disabled"
      title={message}
    />
  );
};

export default DisabledWarning;
