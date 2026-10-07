import ObjectID from "Common/Types/ObjectID";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import FetchMonitorStatuses from "../MonitorStatus/FetchMonitorStatuses";
import { getMonitorStatusIdFromFormValue } from "./ScheduledMaintenanceMonitorStatus";

export interface ComponentProps {
  // The status as the Edit form holds it: an id, or nothing.
  monitorStatus: unknown;
}

/*
 * Change Monitor Status to on the Affected Resources Edit of a scheduled
 * maintenance event that has started: the status the event holds, shown
 * read-only, as a monitor's status is drawn (without the pulse of a live
 * one). The field's description says why it cannot be changed. With no
 * status, what that means: the monitors keep theirs.
 */
const StartedEventMonitorStatus: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const monitorStatusId: string | null = getMonitorStatusIdFromFormValue(
    props.monitorStatus,
  );

  if (!monitorStatusId) {
    return (
      <p
        className="text-sm text-gray-700"
        data-testid="started-event-monitor-status"
      >
        {translator.translateText("Monitors keep their status.")}
      </p>
    );
  }

  return (
    <div data-testid="started-event-monitor-status">
      <FetchMonitorStatuses
        monitorStatusIds={[new ObjectID(monitorStatusId)]}
        shouldAnimate={false}
      />
    </div>
  );
};

export default StartedEventMonitorStatus;
