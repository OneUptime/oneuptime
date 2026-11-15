import ProviderLogoOrIcon from "../ProviderLogo/ProviderLogoOrIcon";
import {
  getLlmProviderTypeCopy,
  LlmProviderTypeCopy,
} from "./LlmProviderFormCopy";
import React, { FunctionComponent, ReactElement } from "react";
import TableEmptyValue from "../Table/TableEmptyValue";
import { isDashText } from "../Detail/EmptyValue";

/*
 * An LLM provider's kind, as a list of providers shows it: the provider's
 * logo beside its name, as the form's cards name it ("Azure OpenAI /
 * Microsoft Foundry"). Project Settings > AI > LLM Providers, a provider's
 * own page and the Admin Dashboard's Global LLM Providers draw it the same.
 * A kind this build does not know is its stored value, as written.
 */

export interface ComponentProps {
  llmType: unknown;
  // What a provider without a kind shows.
  emptyText?: string | undefined;
}

const LlmProviderTypeLabel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const copy: LlmProviderTypeCopy | null = getLlmProviderTypeCopy(
    props.llmType,
  );

  if (!copy) {
    if (typeof props.llmType === "string" && props.llmType) {
      return <span>{props.llmType}</span>;
    }

    /*
     * No kind: the provider's own words for that, or the quiet dash every
     * empty value is - not a hyphen a page passes in (#7603).
     */
    if (props.emptyText?.trim() && !isDashText(props.emptyText)) {
      return <span>{props.emptyText}</span>;
    }

    return <TableEmptyValue />;
  }

  return (
    <span className="inline-flex items-center gap-2">
      <ProviderLogoOrIcon
        logo={copy.logo}
        icon={copy.icon}
        isBare={true}
        isDecorative={true}
        iconClassName="h-4 w-4 flex-shrink-0 text-gray-500"
      />
      <span>{copy.title}</span>
    </span>
  );
};

export default LlmProviderTypeLabel;
