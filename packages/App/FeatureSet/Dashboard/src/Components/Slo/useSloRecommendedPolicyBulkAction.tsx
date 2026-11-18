import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveErrorBudgetPolicyTier from "Common/Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  BULK_ITEM_CHANGED,
  BulkActionRunResult,
  BulkItemOutcome,
  bulkItemUnchanged,
} from "Common/UI/Components/BulkUpdate/BulkActionRunner";
import {
  BulkActionButtonSchema,
  BulkActionConfirmControls,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { getSloBulkResultKey } from "Common/Utils/Slo/SloBulkRecommendedBurnRateRules";
import {
  SloBulkRecommendedPolicyResult,
  SloBulkRecommendedPolicyStatus,
  SloBulkRecommendedPolicySummary,
  SloRecommendedPolicyTierCount,
  summarizeSloBulkRecommendedPolicy,
} from "Common/Utils/Slo/SloBulkRecommendedPolicy";
import React, { MutableRefObject, ReactElement, useRef } from "react";
import RecommendedPolicyTiersApi from "../../Pages/Slo/Utils/RecommendedPolicyTiersApi";
import { runSloBulkAdd } from "./SloBulkAddRun";
import SloBulkRecommendedPolicyDetails from "./SloBulkRecommendedPolicyDetails";
import {
  SLO_BULK_RECOMMENDED_POLICY_ALREADY_THERE,
  SLO_BULK_RECOMMENDED_POLICY_NO_ANSWER,
  SLO_BULK_RECOMMENDED_POLICY_OWN_POLICY_REASON,
  SLO_BULK_RECOMMENDED_POLICY_QUESTION,
  SLO_BULK_RECOMMENDED_POLICY_RESULT_LABELS,
  SLO_BULK_RECOMMENDED_POLICY_TITLE,
} from "./SloBulkRecommendedPolicyCopy";
import {
  SLO_BULK_RECOMMENDED_RULES_ADDED_RULE,
  SLO_RECOMMENDED_RULES_MENU_GROUP,
} from "./SloBulkRecommendedRulesCopy";
import { USE_RECOMMENDED_POLICY_TITLE } from "./SloRecommendedPolicyTiersModal";

/*
 * "USE THE RECOMMENDED POLICY" ON THE SLO LIST: THE RECOMMENDED ERROR BUDGET
 * POLICY FOR MANY SLOS AT ONCE (#6358).
 *
 * An SLO with no error budget policy is offered the recommended one on its
 * own Error Budget Policy page, one SLO at a time, and one with part of it
 * the rest (#7351). This offers both for the SLOs the list has selected,
 * every SLO a filter shows included, by the same rule
 * (getSloRecommendedPolicyStanding):
 *
 *   - Bulk Actions > Use the recommended policy, beside Add recommended
 *     rules, locked with the reason for someone who may not create (or
 *     read) SLO error budget policy tiers;
 *   - a confirmation that asks the server first and says how many of the
 *     selected SLOs get which tiers - each tier once, as the tiers do not
 *     scale with a window - and how many already have the recommended
 *     policy, have a policy of their own, or could not be read
 *     (SloBulkRecommendedPolicyDetails). Nothing is added until it is
 *     confirmed, and it cannot be confirmed when there is nothing to add;
 *   - a run that adds what each SLO is missing through the bulk add route,
 *     which takes each SLO through the per-SLO add - its lock, the same
 *     check of what it gets, all of its tiers or none, each created as the
 *     person with its audit log - a batch at a time (runSloBulkAdd);
 *   - a result that says, SLO by SLO, whether tiers were added, it was left
 *     as it was and why, or it was not changed and why - one SLO's refusal
 *     or failure never stops the others - and then what was added, tier by
 *     tier.
 *
 * Offered on the live SLO list only: an archived SLO is not evaluated, so a
 * policy never applies to it, and its page does not offer one either.
 */

// SLOs per request of the run, as Add recommended rules sends them.
export const SLO_BULK_RECOMMENDED_POLICY_BATCH_SIZE: number = 10;

type AddMissingToManyFunction = (
  ids: Array<ObjectID>,
) => Promise<Array<SloBulkRecommendedPolicyResult>>;

/*
 * What happened to one SLO, read from the server's answer for it. Reasons
 * are English: the result translates them where it lists them.
 */
export const getSloRecommendedPolicyOutcome: (
  result: SloBulkRecommendedPolicyResult | undefined,
) => BulkItemOutcome = (
  result: SloBulkRecommendedPolicyResult | undefined,
): BulkItemOutcome => {
  if (!result) {
    throw new BadDataException(SLO_BULK_RECOMMENDED_POLICY_NO_ANSWER);
  }

  if (result.status === SloBulkRecommendedPolicyStatus.Added) {
    return BULK_ITEM_CHANGED;
  }

  if (result.status === SloBulkRecommendedPolicyStatus.NothingMissing) {
    return bulkItemUnchanged(SLO_BULK_RECOMMENDED_POLICY_ALREADY_THERE);
  }

  if (result.status === SloBulkRecommendedPolicyStatus.OwnPolicy) {
    return bulkItemUnchanged(SLO_BULK_RECOMMENDED_POLICY_OWN_POLICY_REASON);
  }

  if (
    result.status === SloBulkRecommendedPolicyStatus.Refused ||
    result.status === SloBulkRecommendedPolicyStatus.Failed
  ) {
    throw new BadDataException(
      result.message || SLO_BULK_RECOMMENDED_POLICY_NO_ANSWER,
    );
  }

  // "Missing" answers what would be added, never what was.
  throw new BadDataException(SLO_BULK_RECOMMENDED_POLICY_NO_ANSWER);
};

export interface RunSloRecommendedPolicyBulkAddOptions {
  actionProps: BulkActionOnClickProps<ServiceLevelObjective>;
  // What the confirmation said of each SLO, by getSloBulkResultKey; null when it said nothing.
  preview: Map<string, SloBulkRecommendedPolicyResult> | null;
  addMissingToMany: AddMissingToManyFunction;
  batchSize?: number | undefined;
  // Told each request's answer, as it comes.
  onResults?:
    | ((results: Array<SloBulkRecommendedPolicyResult>) => void)
    | undefined;
}

/*
 * The run behind the action: every selected SLO through the shared runner,
 * the ones the confirmation said get tiers sent to the bulk add route a
 * batch at a time.
 */
export async function runSloRecommendedPolicyBulkAdd(
  options: RunSloRecommendedPolicyBulkAddOptions,
): Promise<BulkActionRunResult<ServiceLevelObjective>> {
  return await runSloBulkAdd<SloBulkRecommendedPolicyResult>({
    actionProps: options.actionProps,
    preview: options.preview,
    // What the confirmation said of an SLO, unless it said it gets tiers.
    isSettledByPreview: (
      previewed: SloBulkRecommendedPolicyResult,
    ): boolean => {
      return previewed.status !== SloBulkRecommendedPolicyStatus.Missing;
    },
    getOutcome: getSloRecommendedPolicyOutcome,
    addMissingToMany: options.addMissingToMany,
    batchSize: options.batchSize ?? SLO_BULK_RECOMMENDED_POLICY_BATCH_SIZE,
    noAnswerMessage: SLO_BULK_RECOMMENDED_POLICY_NO_ANSWER,
    onResults: options.onResults,
  });
}

type GateActionFunction = (
  action: BulkActionButtonSchema<ServiceLevelObjective>,
  gates: Array<PermissionGateResult>,
) => BulkActionButtonSchema<ServiceLevelObjective>;

/*
 * As every bulk action: a known missing permission locks the action and
 * says which; an unknown answer (the permission snapshot has not landed
 * yet) leaves it alone, and the server refuses what it must.
 */
const gateAction: GateActionFunction = (
  action: BulkActionButtonSchema<ServiceLevelObjective>,
  gates: Array<PermissionGateResult>,
): BulkActionButtonSchema<ServiceLevelObjective> => {
  for (const gate of gates) {
    if (!gate.isAllowed && gate.disabledReason) {
      return {
        ...action,
        disabled: true,
        tooltip: gate.disabledReason,
      };
    }
  }

  return action;
};

export interface UseSloRecommendedPolicyBulkActionOptions {
  // How many SLOs a request adds to: SLO_BULK_RECOMMENDED_POLICY_BATCH_SIZE.
  batchSize?: number | undefined;
}

export default function useSloRecommendedPolicyBulkAction(
  options: UseSloRecommendedPolicyBulkActionOptions = {},
): Array<BulkActionButtonSchema<ServiceLevelObjective>> {
  const translator: Translator = useTranslator();

  // What the open confirmation was told, for the run it starts.
  const previewRef: MutableRefObject<Map<
    string,
    SloBulkRecommendedPolicyResult
  > | null> = useRef<Map<string, SloBulkRecommendedPolicyResult> | null>(null);

  // What the last run's requests answered, for its result.
  const answeredRef: MutableRefObject<Array<SloBulkRecommendedPolicyResult>> =
    useRef<Array<SloBulkRecommendedPolicyResult>>([]);

  // What the run added, tier by tier: drawn last in its result.
  const renderAdded: () => ReactElement | undefined = ():
    | ReactElement
    | undefined => {
    const summary: SloBulkRecommendedPolicySummary =
      summarizeSloBulkRecommendedPolicy(answeredRef.current);

    if (summary.tiers.length === 0) {
      return undefined;
    }

    return (
      <ul
        className="space-y-1 text-sm text-gray-700"
        data-testid="slo-bulk-recommended-policy-added"
      >
        {summary.tiers.map((count: SloRecommendedPolicyTierCount) => {
          return (
            <li key={count.tier.name}>
              {translator.translatePlural(
                SLO_BULK_RECOMMENDED_RULES_ADDED_RULE,
                count.sloCount,
                {
                  rule: count.tier.name,
                  count: translator.formatNumber(count.sloCount),
                },
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  const action: BulkActionButtonSchema<ServiceLevelObjective> = {
    title: USE_RECOMMENDED_POLICY_TITLE,
    icon: IconProp.Scale,
    buttonStyleType: ButtonStyleType.NORMAL,
    // Beside Add recommended rules: the list's two recommended starters.
    menuGroup: SLO_RECOMMENDED_RULES_MENU_GROUP,
    confirmTitle: (items: Array<ServiceLevelObjective>): string => {
      return translator.translatePlural(
        SLO_BULK_RECOMMENDED_POLICY_TITLE,
        items.length,
        { count: translator.formatNumber(items.length) },
      );
    },
    confirmMessage: (): string => {
      return (
        translator.translateText(SLO_BULK_RECOMMENDED_POLICY_QUESTION) ||
        SLO_BULK_RECOMMENDED_POLICY_QUESTION
      );
    },
    confirmDetails: (
      items: Array<ServiceLevelObjective>,
      controls: BulkActionConfirmControls,
    ): ReactElement => {
      return (
        <SloBulkRecommendedPolicyDetails
          items={items}
          controls={controls}
          onPreview={(
            results: Array<SloBulkRecommendedPolicyResult> | null,
          ): void => {
            if (!results) {
              previewRef.current = null;
              return;
            }

            const byKey: Map<string, SloBulkRecommendedPolicyResult> =
              new Map();

            for (const result of results) {
              byKey.set(
                getSloBulkResultKey(result.serviceLevelObjectiveId),
                result,
              );
            }

            previewRef.current = byKey;
          }}
        />
      );
    },
    confirmButtonStyleType: ButtonStyleType.PRIMARY,
    resultLabels: SLO_BULK_RECOMMENDED_POLICY_RESULT_LABELS,
    resultDetails: renderAdded,
    onClick: async (
      actionProps: BulkActionOnClickProps<ServiceLevelObjective>,
    ): Promise<void> => {
      answeredRef.current = [];

      await runSloRecommendedPolicyBulkAdd({
        actionProps: actionProps,
        preview: previewRef.current,
        addMissingToMany: (
          ids: Array<ObjectID>,
        ): Promise<Array<SloBulkRecommendedPolicyResult>> => {
          return RecommendedPolicyTiersApi.addMissingToMany(ids);
        },
        batchSize: options.batchSize,
        onResults: (results: Array<SloBulkRecommendedPolicyResult>): void => {
          answeredRef.current = [...answeredRef.current, ...results];
        },
      });
    },
  };

  return [
    gateAction(action, [
      PermissionGate.check(
        new ServiceLevelObjectiveErrorBudgetPolicyTier(),
        ModelAction.Create,
      ),
      PermissionGate.check(
        new ServiceLevelObjectiveErrorBudgetPolicyTier(),
        ModelAction.Read,
      ),
    ]),
  ];
}
