import PageComponentProps from "../PageComponentProps";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
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
 */

export type LlmUsageSourceKey = "calls" | "providers";

const SOURCES: Array<{ key: LlmUsageSourceKey; label: string; hint: string }> =
  [
    {
      key: "calls",
      label: translationKey("Your AI calls"),
      hint: translationKey("What your apps and coding tools send"),
    },
    {
      key: "providers",
      label: translationKey("Provider accounts"),
      hint: translationKey("What your connected accounts were billed"),
    },
  ];

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
      <div
        role="tablist"
        aria-label={translator.translateText("Usage source")}
        className="inline-flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-white p-1"
        data-testid="llm-usage-source"
      >
        {SOURCES.map(
          (option: {
            key: LlmUsageSourceKey;
            label: string;
            hint: string;
          }): ReactElement => {
            const isActive: boolean = option.key === source;

            return (
              <button
                key={option.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                title={translator.translateText(option.hint) || ""}
                data-testid={`llm-usage-source-${option.key}`}
                onClick={() => {
                  setSource(option.key);
                  Navigation.setQueryString({
                    source: option.key === "providers" ? "providers" : null,
                  });
                }}
                className={
                  isActive
                    ? "rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white"
                    : "rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
                }
              >
                {translator.translateText(option.label)}
              </button>
            );
          },
        )}
      </div>

      {source === "providers" ? <LlmProviderUsage /> : <LlmUsageBreakdown />}
    </div>
  );
};

export default LlmUsagePage;
