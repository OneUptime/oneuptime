import { FILE_URL } from "../../Config";
import Icon from "../Icon/Icon";
import Image from "../Image/Image";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import URL from "../../../Types/API/URL";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import AIAgent from "../../../Models/DatabaseModels/AIAgent";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  aiAgent?: AIAgent | JSONObject | undefined | null;
  suffix?: string | undefined;
}

const AIAgentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let aiAgent: JSONObject | null | undefined = null;

  if (props.aiAgent instanceof AIAgent) {
    aiAgent = BaseModel.toJSONObject(props.aiAgent, AIAgent);
  } else {
    aiAgent = props.aiAgent;
  }

  if (!aiAgent) {
    return (
      <div className="flex">
        <div className="bold" data-testid="ai-agent-not-found">
          No AI agent found.
        </div>
      </div>
    );
  }

  return (
    <div className="flex">
      <div>
        {props.aiAgent?.iconFileId && (
          <Image
            className="h-6 w-6 rounded-full"
            data-testid="ai-agent-image"
            imageUrl={URL.fromString(FILE_URL.toString()).addRoute(
              "/image/" + props.aiAgent?.iconFileId.toString(),
            )}
            alt={aiAgent["name"]?.toString() || "AI Agent"}
          />
        )}
        {!props.aiAgent?.iconFileId && (
          <Icon
            data-testid="ai-agent-icon"
            icon={IconProp.Automation}
            className="text-gray-400 group-hover:text-gray-500 flex-shrink-0 -ml-0.5 mt-0.5 h-6 w-6"
          />
        )}
      </div>
      <div className="mt-1 mr-1 ml-3">
        <div>
          <span data-testid="ai-agent-name">{`${
            (aiAgent["name"]?.toString() as string) || ""
          } ${props.suffix || ""}`}</span>{" "}
        </div>
      </div>
    </div>
  );
};

export default AIAgentElement;
