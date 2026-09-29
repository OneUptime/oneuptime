import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import React, { FunctionComponent, ReactElement } from "react";
import { Black } from "Common/Types/BrandColors";
import Pill from "Common/UI/Components/Pill/Pill";

export interface ComponentProps {
  alertSeverity: AlertSeverity;
}

const AlertSeverityElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Pill
      isMinimal={true}
      color={props.alertSeverity.color || Black}
      text={props.alertSeverity.name || "Unknown"}
    />
  );
};

export default AlertSeverityElement;
