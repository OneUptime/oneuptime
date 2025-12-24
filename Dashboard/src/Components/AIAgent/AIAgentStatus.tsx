import { Green, Red } from "Common/Types/BrandColors";
import { JSONObject } from "Common/Types/JSON";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import AIAgent, {
  AIAgentConnectionStatus,
} from "Common/Models/DatabaseModels/AIAgent";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  aiAgent: AIAgent | JSONObject;
}

const AIAgentStatusElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (
    props.aiAgent &&
    props.aiAgent["connectionStatus"] === AIAgentConnectionStatus.Connected
  ) {
    return (
      <Statusbubble text={"Connected"} color={Green} shouldAnimate={true} />
    );
  }

  return (
    <Statusbubble text={"Disconnected"} color={Red} shouldAnimate={false} />
  );
};

export default AIAgentStatusElement;
