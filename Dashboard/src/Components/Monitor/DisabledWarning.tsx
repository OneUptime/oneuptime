import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { useAsyncEffect } from "use-async-effect";

export interface ComponentProps {
  monitorId: ObjectID;
  refreshToggle?: boolean | undefined;
}

const DisabledWarning: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isDisabled, setIsDisabled] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [message, setMessage] = useState<string>("");

  useAsyncEffect(async () => {
    setIsLoading(true);

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

    if (monitor?.monitorType === MonitorType.Manual) {
      setIsLoading(false);
      return;
    }

    if (monitor?.disableActiveMonitoring) {
      setIsDisabled(true);
      setMessage(
        "We are not monitoring this monitor since it is disabled. To enable active monitoring, please go to Settings.",
      );
    } else if (monitor?.disableActiveMonitoringBecauseOfManualIncident) {
      setIsDisabled(true);
      setMessage(
        "We are not monitoring this monitor since it is disabled because of an active incident. To enable active monitoring, please resolve the incident.",
      );
    } else if (
      monitor?.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent
    ) {
      setIsDisabled(true);
      setMessage(
        "We are not monitoring this monitor since it is disabled because of an ongoing scheduled maintenance event. To enable active monitoring, please resolve the scheduled maintenance event.",
      );
    }

    setIsLoading(false);
  }, [props.refreshToggle]);

  if (isLoading) {
    return <></>;
  }

  if (isDisabled) {
    return (
      <Alert
        type={AlertType.DANGER}
        strongTitle="This monitor is disabled"
        title={message}
      />
    );
  }

  return <></>;
};

export default DisabledWarning;
