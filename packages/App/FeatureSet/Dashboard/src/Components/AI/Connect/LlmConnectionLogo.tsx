import IconProp from "Common/Types/Icon/IconProp";
import {
  LlmConnectionDefinition,
  getLlmConnectionDefinition,
} from "Common/Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "Common/Types/LlmObservability/LlmConnectionProvider";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A connection's mark on the Connect page: the catalog's icon on the
 * provider's colour, so a tile and a row of the list read as the same
 * provider at a glance. A plain mark, not the provider's logo.
 */

const MARK_COLOURS: Record<LlmConnectionProvider, string> = {
  [LlmConnectionProvider.OpenAI]: "bg-gray-900 text-white",
  [LlmConnectionProvider.Anthropic]: "bg-orange-600 text-white",
  [LlmConnectionProvider.AzureOpenAI]: "bg-sky-600 text-white",
  [LlmConnectionProvider.AwsBedrock]: "bg-amber-500 text-white",
  [LlmConnectionProvider.GoogleVertexAI]: "bg-blue-600 text-white",
  [LlmConnectionProvider.ClaudeEnterprise]: "bg-orange-500 text-white",
  [LlmConnectionProvider.Microsoft365Copilot]: "bg-violet-600 text-white",
};

export interface ComponentProps {
  provider: LlmConnectionProvider | string | undefined;
  size?: "sm" | "md" | "lg" | undefined;
}

const LlmConnectionLogo: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const definition: LlmConnectionDefinition | undefined =
    getLlmConnectionDefinition(props.provider);
  const size: "sm" | "md" | "lg" = props.size || "md";
  const box: string =
    size === "lg" ? "h-10 w-10" : size === "sm" ? "h-6 w-6" : "h-8 w-8";
  const glyph: string =
    size === "lg" ? "h-5 w-5" : size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  const colours: string = definition
    ? MARK_COLOURS[definition.provider]
    : "bg-gray-200 text-gray-600";

  return (
    <span
      aria-hidden="true"
      data-testid={`llm-connection-logo-${props.provider || "unknown"}`}
      className={`inline-flex flex-shrink-0 items-center justify-center rounded-lg ${box} ${colours}`}
    >
      <Icon icon={definition?.icon || IconProp.Sparkles} className={glyph} />
    </span>
  );
};

export default LlmConnectionLogo;
