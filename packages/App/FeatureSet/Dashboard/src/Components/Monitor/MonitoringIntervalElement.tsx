import MonitoringInterval from "../../Utils/MonitorIntervalDropdownOptions";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import React, { FunctionComponent, ReactElement } from "react";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps {
  monitoringInterval: string;
}

const MonitoringIntervalElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  if (props.monitoringInterval) {
    return (
      <div>
        {
          MonitoringInterval.find((item: DropdownOption) => {
            return item.value === props.monitoringInterval;
          })?.label
        }
      </div>
    );
  }

  return <div>{translator.translateText("No interval defined")}</div>;
};

export default MonitoringIntervalElement;
