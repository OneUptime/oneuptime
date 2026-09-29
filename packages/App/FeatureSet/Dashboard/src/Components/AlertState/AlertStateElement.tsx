import AlertState from "Common/Models/DatabaseModels/AlertState";
import React, { FunctionComponent, ReactElement } from "react";
import { Black } from "Common/Types/BrandColors";
import Pill from "Common/UI/Components/Pill/Pill";

export interface ComponentProps {
  alertState: AlertState;
}

const AlertStateElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Pill
      color={props.alertState.color || Black}
      text={props.alertState.name || "Unknown"}
    />
  );
};

export default AlertStateElement;
