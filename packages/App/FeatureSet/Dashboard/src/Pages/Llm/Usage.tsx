import PageComponentProps from "../PageComponentProps";
import IconProp from "Common/Types/Icon/IconProp";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ViewSwitch, {
  ViewSwitchOption,
} from "Common/UI/Components/ViewSwitch/ViewSwitch";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import LlmUsageBreakdown from "../../Components/AI/LlmUsageBreakdown";
import LlmProviderUsage from "../../Components/AI/LlmProviderUsage";

/*
 * Usage, from one of two sources, never added together: the AI calls your
 * apps and tools send (spans, and GenAI metrics where there are none), or
 * what your connected provider accounts report - the bill, which already
 * holds those same calls. The source is in the address (?source=providers)
 * so a link opens the view it was copied from.
 *
 * The switch is the product's own view switch (as Month | Week | Day is), with
 * what the picked source is said beside it.
 */

export type LlmUsageSourceKey = "calls" | "providers";

export const LLM_USAGE_SOURCES: ReadonlyArray<
  ViewSwitchOption<LlmUsageSourceKey>
> = [
  {
    value: "calls",
    label: translationKey("Your AI calls"),
    icon: IconProp.Code,
  },
  {
    value: "providers",
    label: translationKey("Provider accounts"),
    icon: IconProp.CreditCard,
  },
];

const SOURCE_HINTS: Record<LlmUsageSourceKey, string> = {
  calls: translationKey("What your apps and coding tools send"),
  providers: translationKey("What your connected accounts were billed"),
};

export function readLlmUsageSource(value: string | null): LlmUsageSourceKey {
  return value === "providers" ? "providers" : "calls";
}

const LlmUsagePage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [source, setSource] = useState<LlmUsageSourceKey>(
    readLlmUsageSource(Navigation.getQueryStringByName("source")),
  );

  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ViewSwitch<LlmUsageSourceKey>
          options={LLM_USAGE_SOURCES}
          value={source}
          ariaLabel={translationKey("Usage source")}
          dataTestId="llm-usage-source"
          onChange={(value: LlmUsageSourceKey) => {
            setSource(value);
            Navigation.setQueryString({
              source: value === "providers" ? "providers" : null,
            });
          }}
        />
        <span
          className="text-sm text-gray-500"
          data-testid="llm-usage-source-description"
        >
          {translator.translateText(SOURCE_HINTS[source])}
        </span>
      </div>

      {source === "providers" ? <LlmProviderUsage /> : <LlmUsageBreakdown />}
    </div>
  );
};

export default LlmUsagePage;
