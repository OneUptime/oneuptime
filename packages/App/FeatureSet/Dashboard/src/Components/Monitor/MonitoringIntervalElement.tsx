import { getMonitoringIntervalLabel } from "../../Utils/MonitorIntervalDropdownOptions";
import React, { FunctionComponent, ReactElement } from "react";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps {
  monitoringInterval: string | null | undefined;
}

/*
 * A monitoring interval in words: "Every 5 Minutes", or for a cron the
 * dashboard's list does not have, its schedule ("Every 3 minutes"). It used
 * to show nothing at all for such a cron, so a monitor or template set up
 * through the API read as having no interval.
 */
const MonitoringIntervalElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const label: string | undefined = getMonitoringIntervalLabel(
    props.monitoringInterval,
  );

  if (label) {
    return <div>{translator.translateText(label)}</div>;
  }

  return <div>{translator.translateText("No interval defined")}</div>;
};

export default MonitoringIntervalElement;
