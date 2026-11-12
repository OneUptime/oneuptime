import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { SloRecommendedBurnRateRuleToAdd } from "Common/Utils/Slo/SloRecommendedBurnRateRules";
import { formatSloBurnRate } from "Common/Utils/Slo/SloWidgetFormat";
import React, { FunctionComponent, ReactElement } from "react";
import {
  BURN_RATE_RULE_NOTHING_PICKED,
  BurnRateRuleWindowsText,
  formatBurnRateRuleFiresWhen,
  formatBurnRateRuleWindows,
  getNamesOrNothingPicked,
} from "../../Pages/Slo/Utils/BurnRateRuleLines";

export interface ComponentProps {
  // What will be added, as the server worked it out for this SLO.
  rules: Array<SloRecommendedBurnRateRuleToAdd>;
  isLoading: boolean;
  error: string;
  onSubmit: () => void;
  onClose: () => void;
}

/*
 * The confirmation of "Add recommended rules": exactly the rules the request
 * adds, scaled to this SLO's window, each as the rules table will show it -
 * its threshold, its windows and re-fire suppression, and the alert severity
 * it raises at - with what it is for, in one line. The table's own wording
 * is reused for each of those, so the row a reader is promised here is the
 * row they then see.
 */
const SloRecommendedBurnRateRulesModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ConfirmModal
      title="Add recommended rules"
      description="These are the recommended burn rate rules this SLO does not have yet, scaled to its compliance window. Edit or delete them like any other rule."
      submitButtonText="Add rules"
      onSubmit={props.onSubmit}
      onClose={props.onClose}
      isLoading={props.isLoading}
      error={props.error || undefined}
      disableSubmitButton={props.rules.length === 0}
    >
      <ul
        data-testid="slo-recommended-burn-rate-rules"
        className="divide-y divide-gray-100 rounded-md border border-gray-200"
      >
        {props.rules.map((rule: SloRecommendedBurnRateRuleToAdd) => {
          // "۶۰ دقیقه / ۵ دقیقه" in Persian, as the rules table writes it.
          const windows: BurnRateRuleWindowsText = formatBurnRateRuleWindows(
            rule,
            translator,
          );

          return (
            <li
              key={rule.name}
              data-testid="slo-recommended-burn-rate-rule"
              className="px-4 py-3"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-gray-900">
                  {rule.name}
                </span>
                {/* The figures the reader's way: "14,4×", "۲" in Persian. */}
                <span className="flex-shrink-0 text-sm tabular-nums text-gray-900">
                  {formatSloBurnRate(rule.burnRateThreshold, translator)}
                </span>
              </div>
              <div className="mt-0.5 text-sm text-gray-600">
                {formatBurnRateRuleFiresWhen(rule, translator)}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {windows.windows}
              </div>
              <div className="text-xs text-gray-500">{windows.suppression}</div>
              <div className="text-xs text-gray-500">
                {translator.translateTemplate("Alert: {{severity}}", {
                  severity: getNamesOrNothingPicked(
                    [rule.alertSeverityName || undefined],
                    BURN_RATE_RULE_NOTHING_PICKED.severity,
                    translator,
                  ),
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </ConfirmModal>
  );
};

export default SloRecommendedBurnRateRulesModal;
