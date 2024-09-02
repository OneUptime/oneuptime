import React, { FunctionComponent, ReactElement } from "react";
import CopilotActionType, {
  CopilotActionTypeData,
  CopilotActionTypeUtil,
} from "Common/Types/Copilot/CopilotActionType";

export interface ComponentProps {
  copilotAction: CopilotActionType;
}

const CopilotActionTypeElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const copilotActionTypeData: CopilotActionTypeData =
    CopilotActionTypeUtil.getCopilotActionType(props.copilotAction);

  return (
    <div>
      <p className="font-semibold text-gray-900">
        {copilotActionTypeData.type}
      </p>
      <p>{copilotActionTypeData.description}</p>
    </div>
  );
};

export default CopilotActionTypeElement;
