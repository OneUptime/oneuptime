import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import React, { FunctionComponent, ReactElement } from "react";
import { Black } from "Common/Types/BrandColors";
import Pill from "Common/UI/Components/Pill/Pill";
import { isRecordNameAsWritten } from "Common/Utils/DefaultRecordNames";
import { StateListType } from "Common/Utils/StateOrder";

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
      isUserContent={isRecordNameAsWritten(
        StateListType.AlertSeverity,
        props.alertSeverity.name,
      )}
    />
  );
};

export default AlertSeverityElement;
