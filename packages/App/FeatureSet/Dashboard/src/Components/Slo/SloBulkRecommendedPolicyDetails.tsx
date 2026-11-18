import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { BulkActionConfirmControls } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { isUnexplainedErrorMessage } from "Common/UI/Components/ErrorMessage/ErrorExplanation";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import InlineLoadingLine from "Common/UI/Components/Loader/InlineLoadingLine";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import API from "Common/UI/Utils/API/API";
import { sayErrorMessage } from "Common/UI/Utils/ErrorInSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  SloBulkRecommendedPolicyResult,
  SloBulkRecommendedPolicySummary,
  SloRecommendedPolicyTierCount,
  summarizeSloBulkRecommendedPolicy,
} from "Common/Utils/Slo/SloBulkRecommendedPolicy";
import { formatSloPolicyTierThreshold } from "Common/Utils/Slo/SloErrorBudgetPolicy";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import RecommendedPolicyTiersApi from "../../Pages/Slo/Utils/RecommendedPolicyTiersApi";
import {
  SLO_BULK_RECOMMENDED_RULES_NOTHING_TO_ADD,
  SLO_BULK_RECOMMENDED_RULES_REFUSED,
  SLO_BULK_RECOMMENDED_RULES_SLO_COUNT,
} from "./SloBulkRecommendedRulesCopy";
import {
  SLO_BULK_RECOMMENDED_POLICY_CHECKING,
  SLO_BULK_RECOMMENDED_POLICY_CHECK_FAILED,
  SLO_BULK_RECOMMENDED_POLICY_COMPLETE,
  SLO_BULK_RECOMMENDED_POLICY_HEADLINE,
  SLO_BULK_RECOMMENDED_POLICY_OWN_POLICY,
} from "./SloBulkRecommendedPolicyCopy";
import { getSloItemId } from "./SloBulkRecommendedRulesDetails";
import { POLICY_TIER_BUDGET_LEFT_TEMPLATE } from "./SloPolicyTier";
import {
  RECOMMENDED_POLICY_FREEZE_NOTE,
  RECOMMENDED_TIER_FREEZES_DEPLOYMENTS_TEXT,
} from "./SloRecommendedPolicyTiersModal";

/*
 * WHAT USE THE RECOMMENDED POLICY WOULD ADD TO THE SELECTED SLOS, said in
 * its confirmation before anything is added (the SLO list's Bulk Actions,
 * #6358).
 *
 * The dialog asks the server once for the selection what each SLO would get
 * (getMissingForMany, the bulk route's preview: the Error Budget Policy
 * page's rule for each SLO), and says:
 *
 *   - how many SLOs get the recommended tiers they are missing, and then
 *     each recommended tier once - the tiers do not scale with an SLO's
 *     window - with the budget left it applies at, whether it freezes
 *     deployments, and how many of the SLOs get it;
 *   - how many already have the recommended policy, and how many have a
 *     policy of their own, both left as they are;
 *   - how many could not be read, so nothing is added to them.
 *
 * Its button waits for the answer, and stays unavailable when there is
 * nothing to add, or when the server could not say what there is. The
 * answer is handed on (onPreview), so the run sends only the SLOs it named.
 */

export const SLO_BULK_RECOMMENDED_POLICY_DETAILS_TEST_ID: string =
  "slo-bulk-recommended-policy";

export interface ComponentProps {
  items: Array<ServiceLevelObjective>;
  controls: BulkActionConfirmControls;
  /*
   * What the server said each SLO would get, once it has: null while it is
   * asked, and when it could not say.
   */
  onPreview: (results: Array<SloBulkRecommendedPolicyResult> | null) => void;
}

type Answer =
  | { kind: "asking" }
  | { kind: "answered"; results: Array<SloBulkRecommendedPolicyResult> }
  | { kind: "failed"; message: string };

const SloBulkRecommendedPolicyDetails: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [answer, setAnswer] = useState<Answer>({ kind: "asking" });

  useEffect(() => {
    let cancelled: boolean = false;

    // The dialog's button waits for what it would add.
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

    RecommendedPolicyTiersApi.getMissingForMany(ids)
      .then((results: Array<SloBulkRecommendedPolicyResult>) => {
        if (cancelled) {
          return;
        }

        props.onPreview(results);
        setAnswer({ kind: "answered", results: results });

        // Nothing it could add: its button stays unavailable.
        props.controls.setIsSubmitHeld(
          summarizeSloBulkRecommendedPolicy(results).tiers.length === 0,
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
        text={SLO_BULK_RECOMMENDED_POLICY_CHECKING}
        dataTestId={`${SLO_BULK_RECOMMENDED_POLICY_DETAILS_TEST_ID}-checking`}
      />
    );
  }

  if (answer.kind === "failed") {
    return (
      <div
        className="space-y-1 text-sm leading-6"
        data-testid={`${SLO_BULK_RECOMMENDED_POLICY_DETAILS_TEST_ID}-check-failed`}
      >
        <p className="font-medium text-red-700">
          {translator.translateText(SLO_BULK_RECOMMENDED_POLICY_CHECK_FAILED) ||
            SLO_BULK_RECOMMENDED_POLICY_CHECK_FAILED}
        </p>
        <p className="text-gray-600">
          {/*
           * An error nobody explained says why and what to do next in the
           * reader's language, with its reference (#7537); any other
           * message reads the way its words are written.
           */}
          {isUnexplainedErrorMessage(answer.message) ? (
            <ErrorInSentence message={answer.message} showWhereToLook={true} />
          ) : (
            <IsolatedText text={sayErrorMessage(answer.message, translator)} />
          )}
        </p>
      </div>
    );
  }

  const summary: SloBulkRecommendedPolicySummary =
    summarizeSloBulkRecommendedPolicy(answer.results);

  const sloCount: (count: number) => string = (count: number): string => {
    return translator.translatePlural(
      SLO_BULK_RECOMMENDED_RULES_SLO_COUNT,
      count,
      { count: translator.formatNumber(count) },
    );
  };

  const isAnyTierFreezing: boolean = summary.tiers.some(
    (count: SloRecommendedPolicyTierCount): boolean => {
      return count.tier.freezesDeployments === true;
    },
  );

  // A count line under the tiers: what is left as it is, and why.
  const renderCountLine: (data: {
    count: number;
    template: { one: string; other: string };
    testId: string;
  }) => ReactElement = (data: {
    count: number;
    template: { one: string; other: string };
    testId: string;
  }): ReactElement => {
    if (data.count === 0) {
      return <></>;
    }

    return (
      <p
        className="text-gray-600"
        data-testid={`${SLO_BULK_RECOMMENDED_POLICY_DETAILS_TEST_ID}-${data.testId}`}
      >
        {translator.translatePlural(data.template, data.count, {
          count: translator.formatNumber(data.count),
        })}
      </p>
    );
  };

  return (
    <div
      className="space-y-4 text-sm leading-6"
      data-testid={SLO_BULK_RECOMMENDED_POLICY_DETAILS_TEST_ID}
    >
      {summary.tiers.length > 0 ? (
        <div className="space-y-2">
          <p
            className="font-medium text-gray-900"
            data-testid={`${SLO_BULK_RECOMMENDED_POLICY_DETAILS_TEST_ID}-headline`}
          >
            {translator.translatePlural(
              SLO_BULK_RECOMMENDED_POLICY_HEADLINE,
              summary.withTiersSloCount,
              { count: translator.formatNumber(summary.withTiersSloCount) },
            )}
          </p>
          {isAnyTierFreezing ? (
            <p
              className="text-gray-600"
              data-testid={`${SLO_BULK_RECOMMENDED_POLICY_DETAILS_TEST_ID}-freeze-note`}
            >
              {translator.translateText(RECOMMENDED_POLICY_FREEZE_NOTE)}
            </p>
          ) : (
            <></>
          )}
          <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
            {summary.tiers.map((count: SloRecommendedPolicyTierCount) => {
              return (
                <li
                  key={count.tier.name}
                  className="px-4 py-3"
                  data-testid={`${SLO_BULK_RECOMMENDED_POLICY_DETAILS_TEST_ID}-tier`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    {/*
                     * OneUptime's own name for the tier, which the tier is
                     * created with: as written, as the single SLO's
                     * confirmation lists it.
                     */}
                    <span className="font-medium text-gray-900">
                      {count.tier.name}
                    </span>
                    <span className="flex-shrink-0 tabular-nums text-gray-600">
                      {sloCount(count.sloCount)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span className="tabular-nums">
                      {translator.translateTemplate(
                        POLICY_TIER_BUDGET_LEFT_TEMPLATE,
                        {
                          threshold: formatSloPolicyTierThreshold(
                            count.tier.thresholdPercentage,
                            translator,
                          ),
                        },
                      )}
                    </span>
                    {count.tier.freezesDeployments ? (
                      <Pill
                        text={RECOMMENDED_TIER_FREEZES_DEPLOYMENTS_TEXT}
                        tone={PillTone.Danger}
                        icon={IconProp.Lock}
                        dataTestId={`${SLO_BULK_RECOMMENDED_POLICY_DETAILS_TEST_ID}-tier-freezes`}
                      />
                    ) : (
                      <></>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p
          className="font-medium text-gray-900"
          data-testid={`${SLO_BULK_RECOMMENDED_POLICY_DETAILS_TEST_ID}-nothing`}
        >
          {translator.translateText(
            SLO_BULK_RECOMMENDED_RULES_NOTHING_TO_ADD,
          ) || SLO_BULK_RECOMMENDED_RULES_NOTHING_TO_ADD}
        </p>
      )}
      {renderCountLine({
        count: summary.nothingMissingSloCount,
        template: SLO_BULK_RECOMMENDED_POLICY_COMPLETE,
        testId: "complete",
      })}
      {renderCountLine({
        count: summary.ownPolicySloCount,
        template: SLO_BULK_RECOMMENDED_POLICY_OWN_POLICY,
        testId: "own-policy",
      })}
      {renderCountLine({
        count: summary.refusedSloCount,
        template: SLO_BULK_RECOMMENDED_RULES_REFUSED,
        testId: "refused",
      })}
    </div>
  );
};

export default SloBulkRecommendedPolicyDetails;
