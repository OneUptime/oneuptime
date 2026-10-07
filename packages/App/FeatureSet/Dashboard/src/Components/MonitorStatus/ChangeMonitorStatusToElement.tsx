import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import MonitorStatusElement from "./MonitorStatusElement";

export interface ComponentProps {
  monitorStatus?: MonitorStatus | undefined;
}

/*
 * The status a Change Monitor Status to picks, as an Affected Resources card
 * shows it - a template's, or a scheduled maintenance event's: drawn as a
 * monitor's status is, without the pulse of a live one, since it names the
 * status monitors change to rather than one a monitor is in. With none
 * picked, what that means for the monitors.
 */
const ChangeMonitorStatusToElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.monitorStatus) {
    return <p>{translator.translateText("Monitors keep their status.")}</p>;
  }

  return (
    <MonitorStatusElement
      monitorStatus={props.monitorStatus}
      shouldAnimate={false}
    />
  );
};

export default ChangeMonitorStatusToElement;
