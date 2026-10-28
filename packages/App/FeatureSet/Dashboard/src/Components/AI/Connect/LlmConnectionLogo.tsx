import IconProp from "Common/Types/Icon/IconProp";
import {
  LlmConnectionDefinition,
  getLlmConnectionDefinition,
} from "Common/Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "Common/Types/LlmObservability/LlmConnectionProvider";
import { ProviderLogoSize } from "Common/UI/Components/ProviderLogo/ProviderLogoImage";
import ProviderLogoOrIcon from "Common/UI/Components/ProviderLogo/ProviderLogoOrIcon";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A connection's official logo on AI / LLM > Connect (the catalog's logo,
 * drawn by ProviderLogoImage): its tile, its form and its row of the list
 * show the same one, so they read as the same product at a glance. A
 * provider this build does not know is drawn as AI's sparkles. The
 * product's name is always written beside it, so the logo is not read out
 * again.
 */

const TILE_SIZES: Readonly<Record<"sm" | "md" | "lg", ProviderLogoSize>> = {
  sm: 24,
  md: 32,
  lg: 40,
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

  return (
    <span
      data-testid={`llm-connection-logo-${props.provider || "unknown"}`}
      className="inline-flex flex-shrink-0"
    >
      <ProviderLogoOrIcon
        logo={definition?.logo}
        icon={IconProp.Sparkles}
        size={TILE_SIZES[props.size || "md"]}
        isDecorative={true}
      />
    </span>
  );
};

export default LlmConnectionLogo;
