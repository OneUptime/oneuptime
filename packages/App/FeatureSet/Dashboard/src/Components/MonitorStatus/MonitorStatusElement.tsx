import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import { Black } from "Common/Types/BrandColors";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitorStatus: MonitorStatus;
  shouldAnimate: boolean;
}

const MonitorStatusElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Statusbubble
      shouldAnimate={props.shouldAnimate}
      color={props.monitorStatus.color || Black}
      text={props.monitorStatus.name || "Unknown"}
    />
  );
};

export default MonitorStatusElement;
