import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import { getInlineSeparator } from "Common/Types/Translator";
import ObjectID from "Common/Types/ObjectID";
import { BulkActionConfirmControls } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import InlineLoadingLine from "Common/UI/Components/Loader/InlineLoadingLine";
import API from "Common/UI/Utils/API/API";
import {
  NameListSummary,
  summarizeNames,
} from "Common/UI/Utils/ModelDisplayName";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  SloBulkRecommendedRulesResult,
  SloBulkRecommendedRulesSummary,
  SloRecommendedRuleCount,
  SloRecommendedRuleVariantCount,
  getSloBulkResultKey,
  summarizeSloBulkRecommendedRules,
} from "Common/Utils/Slo/SloBulkRecommendedBurnRateRules";
import { formatSloBurnRate } from "Common/Utils/Slo/SloWidgetFormat";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import {
  BURN_RATE_RULE_NOTHING_PICKED,
  BurnRateRuleWindowsText,
  formatBurnRateRuleFiresWhen,
  formatBurnRateRuleWindows,
  getNamesOrNothingPicked,
} from "../../Pages/Slo/Utils/BurnRateRuleLines";
import RecommendedBurnRateRulesApi from "../../Pages/Slo/Utils/RecommendedBurnRateRulesApi";
import { formatNameList } from "../AiAccess/AiAccessModes";
import {
  SLO_BULK_RECOMMENDED_RULES_CHECKING,
  SLO_BULK_RECOMMENDED_RULES_CHECK_FAILED,
  SLO_BULK_RECOMMENDED_RULES_COMPLETE,
  SLO_BULK_RECOMMENDED_RULES_HEADLINE,
  SLO_BULK_RECOMMENDED_RULES_MORE_SLOS,
  SLO_BULK_RECOMMENDED_RULES_NAMES_SHOWN,
  SLO_BULK_RECOMMENDED_RULES_NOTHING_TO_ADD,
  SLO_BULK_RECOMMENDED_RULES_REFUSED,
  SLO_BULK_RECOMMENDED_RULES_SLO_COUNT,
} from "./SloBulkRecommendedRulesCopy";

/*
 * WHAT ADD RECOMMENDED RULES WOULD ADD TO THE SELECTED SLOS, said in its
 * confirmation before anything is added (the SLO list's Bulk Actions).
 *
 * The dialog asks the server once for the selection what each SLO is
 * missing (getMissingForMany, the bulk route's preview: the per-SLO answer,
 * scaled to each SLO's own window), and says:
 *
 *   - how many SLOs get the rules they are missing, and then each rule
 *     with how many of them get it - and, where SLOs of different windows
 *     get it scaled differently (Slow leak is 1x over three days on a
 *     30-day window, 1x over 16.8 hours on a 7-day one), each shape with
 *     its threshold, windows, suppression and severity, and the SLOs that
 *     get it, the first few by name;
 *   - how many already have every recommended rule, and are left alone;
 *   - how many could not be read, so nothing is added to them.
 *
 * Its Add waits for the answer, and stays unavailable when there is nothing
 * to add, or when the server could not say what there is: the confirmation
 * is the promise of what will be added, and adds nothing it cannot name.
 * The answer is handed on (onPreview), so the run sends only the SLOs it
 * named.
 */

export const SLO_BULK_RECOMMENDED_RULES_DETAILS_TEST_ID: string =
  "slo-bulk-recommended-rules";

export interface ComponentProps {
  items: Array<ServiceLevelObjective>;
  controls: BulkActionConfirmControls;
  /*
   * What the server said each SLO is missing, once it has: null while it is
   * asked, and when it could not say.
   */
  onPreview: (results: Array<SloBulkRecommendedRulesResult> | null) => void;
}

export const getSloItemId: (item: ServiceLevelObjective) => string = (
  item: ServiceLevelObjective,
): string => {
  const id: unknown = item._id || item.id;

  return id ? id.toString() : "";
};

type Answer =
  | { kind: "asking" }
  | { kind: "answered"; results: Array<SloBulkRecommendedRulesResult> }
  | { kind: "failed"; message: string };

const SloBulkRecommendedRulesDetails: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [answer, setAnswer] = useState<Answer>({ kind: "asking" });

  const separator: string = getInlineSeparator(translator.language);

  useEffect(() => {
    let cancelled: boolean = false;

    // The dialog's Add waits for what it would add.
    props.controls.setIsSubmitHeld(true);
    props.onPreview(null);

    const ids: Array<ObjectID> = props.items
      .map(getSloItemId)
      .filter((id: string): boolean => {
        return Boolean(id);
      })
      .map((id: string): ObjectID => {
        return new ObjectID(id);
      });

    RecommendedBurnRateRulesApi.getMissingForMany(ids)
      .then((results: Array<SloBulkRecommendedRulesResult>) => {
        if (cancelled) {
          return;
        }

        props.onPreview(results);
        setAnswer({ kind: "answered", results: results });

        // Nothing it could add: its Add stays unavailable.
        props.controls.setIsSubmitHeld(
          summarizeSloBulkRecommendedRules(results).rules.length === 0,
        );
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }

        props.onPreview(null);
        setAnswer({ kind: "failed", message: API.getFriendlyMessage(err) });
        props.controls.setIsSubmitHeld(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (answer.kind === "asking") {
    return (
      <InlineLoadingLine
        text={SLO_BULK_RECOMMENDED_RULES_CHECKING}
        dataTestId={`${SLO_BULK_RECOMMENDED_RULES_DETAILS_TEST_ID}-checking`}
      />
    );
  }

  if (answer.kind === "failed") {
    return (
      <div
        className="space-y-1 text-sm leading-6"
        data-testid={`${SLO_BULK_RECOMMENDED_RULES_DETAILS_TEST_ID}-check-failed`}
      >
        <p className="font-medium text-red-700">
          {translator.translateText(SLO_BULK_RECOMMENDED_RULES_CHECK_FAILED) ||
            SLO_BULK_RECOMMENDED_RULES_CHECK_FAILED}
        </p>
        <p className="text-gray-600">
          <IsolatedText
            text={translator.translateText(answer.message) || answer.message}
          />
        </p>
      </div>
    );
  }

  const summary: SloBulkRecommendedRulesSummary =
    summarizeSloBulkRecommendedRules(answer.results);

  const nameByKey: Map<string, string> = new Map();

  for (const item of props.items) {
    const id: string = getSloItemId(item);

    if (id) {
      nameByKey.set(getSloBulkResultKey(id), item.name?.toString() || "");
    }
  }

  const sloCount: (count: number) => string = (count: number): string => {
    return translator.translatePlural(
      SLO_BULK_RECOMMENDED_RULES_SLO_COUNT,
      count,
      { count: translator.formatNumber(count) },
    );
  };

  // "Checkout, Search, Payments and 7 more": the first few by name.
  const namesOf: (ids: Array<string>) => string = (
    ids: Array<string>,
  ): string => {
    const names: NameListSummary = summarizeNames({
      names: ids.map((id: string): string => {
        return nameByKey.get(getSloBulkResultKey(id)) || "";
      }),
      totalCount: ids.length,
      maxShown: SLO_BULK_RECOMMENDED_RULES_NAMES_SHOWN,
    });

    if (names.shownNames.length === 0) {
      return "";
    }

    return formatNameList(
      names.remainingCount > 0
        ? [
            ...names.shownNames,
            translator.translatePlural(
              SLO_BULK_RECOMMENDED_RULES_MORE_SLOS,
              names.remainingCount,
              { count: translator.formatNumber(names.remainingCount) },
            ),
          ]
        : names.shownNames,
      "and",
      translator,
    );
  };

  const renderVariant: (
    rule: SloRecommendedRuleCount,
    variant: SloRecommendedRuleVariantCount,
    index: number,
  ) => ReactElement = (
    rule: SloRecommendedRuleCount,
    variant: SloRecommendedRuleVariantCount,
    index: number,
  ): ReactElement => {
    // "۴۳۲۰ دقیقه / ۳۶۰ دقیقه" in Persian, as the rules table writes it.
    const windows: BurnRateRuleWindowsText = formatBurnRateRuleWindows(
      variant.rule,
      translator,
    );

    const facts: Array<string> = [
      windows.windows,
      windows.suppression,
      translator.translateTemplate("Alert: {{severity}}", {
        severity: getNamesOrNothingPicked(
          [variant.rule.alertSeverityName || undefined],
          BURN_RATE_RULE_NOTHING_PICKED.severity,
          translator,
        ),
      }),
    ];

    const names: string = namesOf(variant.serviceLevelObjectiveIds);

    return (
      <li
        key={index}
        data-testid={`${SLO_BULK_RECOMMENDED_RULES_DETAILS_TEST_ID}-variant`}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-gray-700">
            {/*
             * The threshold as the rules table and the single SLO's dialog
             * write it: its "×" after its figure in Arabic and Persian too.
             */}
            <span className="font-medium tabular-nums text-gray-900">
              {formatSloBurnRate(variant.rule.burnRateThreshold, translator)}
            </span>
            <span aria-hidden="true" className="text-gray-400">
              {separator}
            </span>
            {formatBurnRateRuleFiresWhen(variant.rule, translator)}
          </span>
          {rule.variants.length > 1 ? (
            <span className="flex-shrink-0 tabular-nums text-gray-500">
              {sloCount(variant.serviceLevelObjectiveIds.length)}
            </span>
          ) : (
            <></>
          )}
        </div>
        <div className="mt-0.5 text-xs text-gray-500">
          {facts.map((fact: string, factIndex: number) => {
            return (
              <React.Fragment key={factIndex}>
                {factIndex > 0 ? (
                  <span aria-hidden="true">{separator}</span>
                ) : (
                  <></>
                )}
                {/* A fact wraps whole: never "Alert:" on one line, its severity on the next. */}
                <span className="whitespace-nowrap">{fact}</span>
              </React.Fragment>
            );
          })}
        </div>
        {names ? (
          <div
            className="mt-0.5 break-words text-xs font-medium text-gray-600"
            data-testid={`${SLO_BULK_RECOMMENDED_RULES_DETAILS_TEST_ID}-variant-slos`}
          >
            {names}
          </div>
        ) : (
          <></>
        )}
      </li>
    );
  };

  return (
    <div
      className="space-y-4 text-sm leading-6"
      data-testid={SLO_BULK_RECOMMENDED_RULES_DETAILS_TEST_ID}
    >
      {summary.rules.length > 0 ? (
        <div className="space-y-2">
          <p
            className="font-medium text-gray-900"
            data-testid={`${SLO_BULK_RECOMMENDED_RULES_DETAILS_TEST_ID}-headline`}
          >
            {translator.translatePlural(
              SLO_BULK_RECOMMENDED_RULES_HEADLINE,
              summary.withRulesSloCount,
              { count: translator.formatNumber(summary.withRulesSloCount) },
            )}
          </p>
          <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
            {summary.rules.map((rule: SloRecommendedRuleCount) => {
              return (
                <li
                  key={rule.name}
                  className="px-4 py-3"
                  data-testid={`${SLO_BULK_RECOMMENDED_RULES_DETAILS_TEST_ID}-rule`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-gray-900">
                      {rule.name}
                    </span>
                    <span className="flex-shrink-0 tabular-nums text-gray-600">
                      {sloCount(rule.sloCount)}
                    </span>
                  </div>
                  <ul className="mt-1.5 space-y-2">
                    {rule.variants.map(
                      (
                        variant: SloRecommendedRuleVariantCount,
                        index: number,
                      ) => {
                        return renderVariant(rule, variant, index);
                      },
                    )}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p
          className="font-medium text-gray-900"
          data-testid={`${SLO_BULK_RECOMMENDED_RULES_DETAILS_TEST_ID}-nothing`}
        >
          {translator.translateText(
            SLO_BULK_RECOMMENDED_RULES_NOTHING_TO_ADD,
          ) || SLO_BULK_RECOMMENDED_RULES_NOTHING_TO_ADD}
        </p>
      )}
      {summary.nothingMissingSloCount > 0 ? (
        <p
          className="text-gray-600"
          data-testid={`${SLO_BULK_RECOMMENDED_RULES_DETAILS_TEST_ID}-complete`}
        >
          {translator.translatePlural(
            SLO_BULK_RECOMMENDED_RULES_COMPLETE,
            summary.nothingMissingSloCount,
            { count: translator.formatNumber(summary.nothingMissingSloCount) },
          )}
        </p>
      ) : (
        <></>
      )}
      {summary.refusedSloCount > 0 ? (
        <p
          className="text-gray-600"
          data-testid={`${SLO_BULK_RECOMMENDED_RULES_DETAILS_TEST_ID}-refused`}
        >
          {translator.translatePlural(
            SLO_BULK_RECOMMENDED_RULES_REFUSED,
            summary.refusedSloCount,
            { count: translator.formatNumber(summary.refusedSloCount) },
          )}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default SloBulkRecommendedRulesDetails;
