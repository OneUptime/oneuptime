import React, { FunctionComponent, ReactElement } from "react";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Navigation from "Common/UI/Utils/Navigation";
import { monitorRoute } from "../../Pages/VMware/Utils";

interface ComponentProps {
  sourceIdentifier?: string | undefined;
  resourceIdentifier?: string | undefined;
  resourceType?: string | undefined;
}
const VMwareCreateMonitorButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const gate: PermissionGateResult = PermissionGate.check(
    new Monitor(),
    ModelAction.Create,
  );
  if (!gate.isAllowed && !gate.disabledReason) {
    return <></>;
  }
  return (
    <Button
      title="Create VMware monitor"
      buttonStyle={ButtonStyleType.PRIMARY}
      disabled={!gate.isAllowed}
      tooltip={gate.disabledReason}
      onClick={() => {
        Navigation.navigate(
          monitorRoute(
            props.sourceIdentifier,
            props.resourceIdentifier,
            props.resourceType,
          ),
        );
      }}
    />
  );
};
export default VMwareCreateMonitorButton;
