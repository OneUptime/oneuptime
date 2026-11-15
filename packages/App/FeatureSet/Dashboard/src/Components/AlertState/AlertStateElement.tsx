import AlertState from "Common/Models/DatabaseModels/AlertState";
import React, { FunctionComponent, ReactElement } from "react";
import { Black } from "Common/Types/BrandColors";
import Pill from "Common/UI/Components/Pill/Pill";
import { isRecordNameAsWritten } from "Common/Utils/DefaultRecordNames";
import { StateListType } from "Common/Utils/StateOrder";

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
      isUserContent={isRecordNameAsWritten(
        StateListType.AlertState,
        props.alertState.name,
      )}
    />
  );
};

export default AlertStateElement;
