import MonitorStatusElement from "./MonitorStatusElement";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import React, { FunctionComponent, ReactElement } from "react";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps {
  monitorStatuses: Array<MonitorStatus>;
  shouldAnimate: boolean;
}

const MonitorStatusesElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.monitorStatuses || props.monitorStatuses.length === 0) {
    return <p>{translator.translateText("No monitor status attached.")}</p>;
  }

  return (
    <div>
      {props.monitorStatuses.map((monitorStatus: MonitorStatus, i: number) => {
        return (
          <div key={i}>
            <MonitorStatusElement
              shouldAnimate={props.shouldAnimate || false}
              monitorStatus={monitorStatus}
            />
          </div>
        );
      })}
    </div>
  );
};

export default MonitorStatusesElement;
