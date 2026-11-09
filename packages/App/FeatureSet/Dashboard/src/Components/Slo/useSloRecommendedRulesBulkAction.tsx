import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  BULK_ITEM_CHANGED,
  BulkActionRunResult,
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
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
import {
  SloBulkRecommendedRulesResult,
  SloBulkRecommendedRulesStatus,
  SloBulkRecommendedRulesSummary,
  SloRecommendedRuleCount,
  getSloBulkResultKey,
  summarizeSloBulkRecommendedRules,
} from "Common/Utils/Slo/SloBulkRecommendedBurnRateRules";
import React, { MutableRefObject, ReactElement, useRef } from "react";
import RecommendedBurnRateRulesApi from "../../Pages/Slo/Utils/RecommendedBurnRateRulesApi";
import SloBulkRecommendedRulesDetails, {
  getSloItemId,
} from "./SloBulkRecommendedRulesDetails";
import {
  SLO_ADD_RECOMMENDED_RULES_ACTION_TITLE,
  SLO_BULK_RECOMMENDED_RULES_ADDED_RULE,
  SLO_BULK_RECOMMENDED_RULES_ALREADY_THERE,
  SLO_BULK_RECOMMENDED_RULES_NO_ANSWER,
  SLO_BULK_RECOMMENDED_RULES_QUESTION,
  SLO_BULK_RECOMMENDED_RULES_RESULT_LABELS,
  SLO_BULK_RECOMMENDED_RULES_TITLE,
  SLO_RECOMMENDED_RULES_MENU_GROUP,
} from "./SloBulkRecommendedRulesCopy";
import SloRecommendedRulesBatches from "./SloRecommendedRulesBatches";

/*
 * "ADD RECOMMENDED RULES" ON THE SLO LIST: THE RECOMMENDED BURN RATE RULES
 * FOR MANY SLOS AT ONCE.
 *
 * An SLO created before Slow leak existed is offered it on its own Burn
 * Rate Rules page, one SLO at a time. This offers it - and Fast burn and
 * Slow burn, to an SLO that lost one - for the SLOs the list has selected,
 * every SLO a filter shows included:
 *
 *   - Bulk Actions > Add recommended rules, locked with the reason for
 *     someone who may not create (or read) SLO burn rate rules;
 *   - a confirmation that asks the server first and says how many of the
 *     selected SLOs get which rules, scaled to each one's window
 *     (SloBulkRecommendedRulesDetails) - nothing is added until it is
 *     confirmed, and it cannot be confirmed when there is nothing to add;
 *   - a run that adds what each SLO is missing through the bulk add route,
 *     which takes each SLO through the per-SLO add - its lock, the same
 *     check of what is missing, each rule created as the person, with its
 *     feed item and audit log. The SLOs go a batch at a time
 *     (SLO_BULK_RECOMMENDED_RULES_BATCH_SIZE), so the progress dialog moves
 *     as each batch answers and Stop is heard between them;
 *   - a result that says, SLO by SLO, whether rules were added, it already
 *     had every rule, or it was not changed and why - one SLO's refusal or
 *     failure never stops the others - and then what was added, rule by
 *     rule.
 *
 * The run sends only what the confirmation said it would: an SLO it found
 * has every rule, or could not read, is reported as it said, with no
 * request. An SLO it did not hear about is sent, for the server to decide.
 *
 * Offered on the live SLO list only. An archived SLO is not evaluated, so
 * its rules never fire, and its Burn Rate Rules page does not offer them
 * either; the Archived page offers Unarchive alone.
 */

/*
 * The SLOs one request of the run adds to: the server takes up to
 * SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS, one after another, and
 * ten keep each request to a second or two.
 */
export const SLO_BULK_RECOMMENDED_RULES_BATCH_SIZE: number = 10;

type AddMissingToManyFunction = (
  ids: Array<ObjectID>,
) => Promise<Array<SloBulkRecommendedRulesResult>>;

/*
 * What happened to one SLO, read from the server's answer for it. Reasons
 * are English: the result translates them where it lists them.
 */
export const getSloRecommendedRulesOutcome: (
  result: SloBulkRecommendedRulesResult | undefined,
) => BulkItemOutcome = (
  result: SloBulkRecommendedRulesResult | undefined,
): BulkItemOutcome => {
  if (!result) {
    throw new BadDataException(SLO_BULK_RECOMMENDED_RULES_NO_ANSWER);
  }

  if (result.status === SloBulkRecommendedRulesStatus.Added) {
    return BULK_ITEM_CHANGED;
  }

  if (result.status === SloBulkRecommendedRulesStatus.NothingMissing) {
    return bulkItemUnchanged(SLO_BULK_RECOMMENDED_RULES_ALREADY_THERE);
  }

  if (
    result.status === SloBulkRecommendedRulesStatus.Refused ||
    result.status === SloBulkRecommendedRulesStatus.Failed
  ) {
    throw new BadDataException(
      result.message || SLO_BULK_RECOMMENDED_RULES_NO_ANSWER,
    );
  }

  // "Missing" answers what would be added, never what was.
  throw new BadDataException(SLO_BULK_RECOMMENDED_RULES_NO_ANSWER);
};

export interface RunSloRecommendedRulesBulkAddOptions {
  actionProps: BulkActionOnClickProps<ServiceLevelObjective>;
  // What the confirmation said of each SLO, by getSloBulkResultKey; null when it said nothing.
  preview: Map<string, SloBulkRecommendedRulesResult> | null;
  addMissingToMany: AddMissingToManyFunction;
  batchSize?: number | undefined;
  // Told each request's answer, as it comes.
  onResults?:
    | ((results: Array<SloBulkRecommendedRulesResult>) => void)
    | undefined;
}

/*
 * The run behind the action: every selected SLO through the shared runner
 * (runBulkAction), the ones the confirmation said are missing a rule sent
 * to the bulk add route a batch at a time.
 */
export async function runSloRecommendedRulesBulkAdd(
  options: RunSloRecommendedRulesBulkAddOptions,
): Promise<BulkActionRunResult<ServiceLevelObjective>> {
  const batchSize: number = Math.max(
    1,
    Math.floor(options.batchSize ?? SLO_BULK_RECOMMENDED_RULES_BATCH_SIZE) || 1,
  );

  // What the confirmation said of an SLO, unless it said it is missing a rule.
  const settledByPreview: (
    key: string,
  ) => SloBulkRecommendedRulesResult | undefined = (
    key: string,
  ): SloBulkRecommendedRulesResult | undefined => {
    const previewed: SloBulkRecommendedRulesResult | undefined =
      options.preview?.get(key);

    return previewed &&
      previewed.status !== SloBulkRecommendedRulesStatus.Missing
      ? previewed
      : undefined;
  };

  const keysToSend: Array<string> = [];

  for (const item of options.actionProps.items) {
    const id: string = getSloItemId(item);

    if (id && !settledByPreview(getSloBulkResultKey(id))) {
      keysToSend.push(getSloBulkResultKey(id));
    }
  }

  const batches: SloRecommendedRulesBatches<SloBulkRecommendedRulesResult> =
    new SloRecommendedRulesBatches<SloBulkRecommendedRulesResult>({
      ids: keysToSend,
      batchSize: batchSize,
      send: async (
        keys: Array<string>,
      ): Promise<Map<string, SloBulkRecommendedRulesResult>> => {
        const results: Array<SloBulkRecommendedRulesResult> =
          await options.addMissingToMany(
            keys.map((key: string): ObjectID => {
              return new ObjectID(key);
            }),
          );

        options.onResults?.(results);

        const byKey: Map<string, SloBulkRecommendedRulesResult> = new Map();

        for (const result of results) {
          byKey.set(
            getSloBulkResultKey(result.serviceLevelObjectiveId),
            result,
          );
        }

        return byKey;
      },
    });

  const onStop: () => void = (): void => {
    batches.onStop();
  };

  options.actionProps.stopSignal?.addEventListener("abort", onStop);

  try {
    return await runBulkAction<ServiceLevelObjective>({
      actionProps: options.actionProps,
      // A batch's SLOs run together, each waiting for the batch's answer.
      concurrency: batchSize,
      step: async (item: ServiceLevelObjective): Promise<BulkItemOutcome> => {
        const id: string = getSloItemId(item);

        if (!id) {
          throw new BadDataException(SLO_BULK_RECOMMENDED_RULES_NO_ANSWER);
        }

        const key: string = getSloBulkResultKey(id);
        const settled: SloBulkRecommendedRulesResult | undefined =
          settledByPreview(key);

        if (settled) {
          return getSloRecommendedRulesOutcome(settled);
        }

        return getSloRecommendedRulesOutcome(await batches.run(key));
      },
    });
  } finally {
    options.actionProps.stopSignal?.removeEventListener("abort", onStop);
  }
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

export interface UseSloRecommendedRulesBulkActionOptions {
  // How many SLOs a request adds to: SLO_BULK_RECOMMENDED_RULES_BATCH_SIZE.
  batchSize?: number | undefined;
}

export default function useSloRecommendedRulesBulkAction(
  options: UseSloRecommendedRulesBulkActionOptions = {},
): Array<BulkActionButtonSchema<ServiceLevelObjective>> {
  const translator: Translator = useTranslator();

  // What the open confirmation was told, for the run it starts.
  const previewRef: MutableRefObject<Map<
    string,
    SloBulkRecommendedRulesResult
  > | null> = useRef<Map<string, SloBulkRecommendedRulesResult> | null>(null);

  // What the last run's requests answered, for its result.
  const answeredRef: MutableRefObject<Array<SloBulkRecommendedRulesResult>> =
    useRef<Array<SloBulkRecommendedRulesResult>>([]);

  // What the run added, rule by rule: drawn last in its result.
  const renderAdded: () => ReactElement | undefined = ():
    | ReactElement
    | undefined => {
    const summary: SloBulkRecommendedRulesSummary =
      summarizeSloBulkRecommendedRules(answeredRef.current);

    if (summary.rules.length === 0) {
      return undefined;
    }

    return (
      <ul
        className="space-y-1 text-sm text-gray-700"
        data-testid="slo-bulk-recommended-rules-added"
      >
        {summary.rules.map((rule: SloRecommendedRuleCount) => {
          return (
            <li key={rule.name}>
              {translator.translatePlural(
                SLO_BULK_RECOMMENDED_RULES_ADDED_RULE,
                rule.sloCount,
                {
                  rule: rule.name,
                  count: translator.formatNumber(rule.sloCount),
                },
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  const action: BulkActionButtonSchema<ServiceLevelObjective> = {
    title: SLO_ADD_RECOMMENDED_RULES_ACTION_TITLE,
    icon: IconProp.LightBulb,
    buttonStyleType: ButtonStyleType.NORMAL,
    menuGroup: SLO_RECOMMENDED_RULES_MENU_GROUP,
    confirmTitle: (items: Array<ServiceLevelObjective>): string => {
      return translator.translatePlural(
        SLO_BULK_RECOMMENDED_RULES_TITLE,
        items.length,
        { count: translator.formatNumber(items.length) },
      );
    },
    confirmMessage: (): string => {
      return (
        translator.translateText(SLO_BULK_RECOMMENDED_RULES_QUESTION) ||
        SLO_BULK_RECOMMENDED_RULES_QUESTION
      );
    },
    confirmDetails: (
      items: Array<ServiceLevelObjective>,
      controls: BulkActionConfirmControls,
    ): ReactElement => {
      return (
        <SloBulkRecommendedRulesDetails
          items={items}
          controls={controls}
          onPreview={(
            results: Array<SloBulkRecommendedRulesResult> | null,
          ): void => {
            if (!results) {
              previewRef.current = null;
              return;
            }

            const byKey: Map<string, SloBulkRecommendedRulesResult> = new Map();

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
    resultLabels: SLO_BULK_RECOMMENDED_RULES_RESULT_LABELS,
    resultDetails: renderAdded,
    onClick: async (
      actionProps: BulkActionOnClickProps<ServiceLevelObjective>,
    ): Promise<void> => {
      answeredRef.current = [];

      await runSloRecommendedRulesBulkAdd({
        actionProps: actionProps,
        preview: previewRef.current,
        addMissingToMany: (
          ids: Array<ObjectID>,
        ): Promise<Array<SloBulkRecommendedRulesResult>> => {
          return RecommendedBurnRateRulesApi.addMissingToMany(ids);
        },
        batchSize: options.batchSize,
        onResults: (results: Array<SloBulkRecommendedRulesResult>): void => {
          answeredRef.current = [...answeredRef.current, ...results];
        },
      });
    },
  };

  return [
    gateAction(action, [
      PermissionGate.check(
        new ServiceLevelObjectiveBurnRateRule(),
        ModelAction.Create,
      ),
      PermissionGate.check(
        new ServiceLevelObjectiveBurnRateRule(),
        ModelAction.Read,
      ),
    ]),
  ];
}
