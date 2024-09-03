import { Gray500, Green500, Red500, Yellow500 } from "Common/Types/BrandColors";
import CopilotActionStatus from "Common/Types/Copilot/CopilotActionStatus";
import Pill from "Common/UI/Components/Pill/Pill";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  copilotActionStatus: CopilotActionStatus;
}

const CopilotActionStatusElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.copilotActionStatus === CopilotActionStatus.PR_CREATED) {
    return <Pill color={Green500} isMinimal={true} text={"PR Created"} />;
  }

  if (props.copilotActionStatus === CopilotActionStatus.NO_ACTION_REQUIRED) {
    return (
      <Pill color={Green500} isMinimal={true} text={"No Action Required"} />
    );
  }

  if (props.copilotActionStatus === CopilotActionStatus.CANNOT_FIX) {
    return <Pill color={Red500} text={"Cannot Fix"} />;
  }

  if (props.copilotActionStatus === CopilotActionStatus.IN_QUEUE) {
    return <Pill color={Gray500} text={"In Queue"} />;
  }

  if (props.copilotActionStatus === CopilotActionStatus.PROCESSING) {
    return <Pill color={Yellow500} text={"Processing"} />;
  }

  return <></>;
};

export default CopilotActionStatusElement;
