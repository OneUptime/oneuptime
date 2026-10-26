import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IconProp from "../../../Types/Icon/IconProp";
import { RuleRunType } from "../../../Types/Rules/RuleRun";
import RuleRunSummary from "../../../Utils/Rules/RuleRunSummary";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../Utils/PermissionGate";
import RuleRunClient, { RuleRunOutcome } from "../../Utils/Rules/RuleRunClient";
import { ButtonStyleType } from "../Button/Button";
import { runBulkAction } from "../BulkUpdate/BulkActionRunner";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "../BulkUpdate/BulkUpdateForm";

/*
 * "Run Now" in a rule table's bulk actions: every selected rule, one after
 * another, each run to completion before the next starts.
 *
 * Sequential on purpose (concurrency 1 in the shared runner). Two rules
 * running at once over the same resources would race each other's "is this
 * label already attached" reads, and one run at a time is also what keeps a
 * bulk press from multiplying load on the API. The runner still lets the
 * person stop part-way: the rule running finishes, and no other starts.
 *
 * A bulk run never notifies added owners - it has no place to ask - and its
 * confirmation says so.
 */
export function getRunRulesBulkAction<TBaseModel extends BaseModel>(data: {
  ruleType: RuleRunType;
  modelType: { new (): TBaseModel };
}): BulkActionButtonSchema<TBaseModel> {
  // Running a rule is a use of it, gated like editing it; the server re-checks.
  const gate: PermissionGateResult = PermissionGate.check(
    new data.modelType(),
    ModelAction.Update,
  );

  return {
    title: "Run Now",
    icon: IconProp.Play,
    buttonStyleType: ButtonStyleType.NORMAL,
    disabled: !gate.isAllowed,
    tooltip: gate.disabledReason,
    confirmTitle: (items: Array<TBaseModel>): string => {
      return items.length === 1
        ? "Run 1 Rule Now"
        : `Run ${items.length} Rules Now`;
    },
    confirmMessage: (items: Array<TBaseModel>): string => {
      return RuleRunSummary.describeBulkConfirmation({
        ruleType: data.ruleType,
        ruleCount: items.length,
      });
    },
    confirmButtonStyleType: ButtonStyleType.PRIMARY,
    onClick: async (
      props: BulkActionOnClickProps<TBaseModel>,
    ): Promise<void> => {
      if (!gate.isAllowed) {
        return;
      }

      await runBulkAction<TBaseModel>({
        actionProps: props,
        concurrency: 1,
        step: async (item: TBaseModel): Promise<void> => {
          const outcome: RuleRunOutcome = await RuleRunClient.run({
            ruleType: data.ruleType,
            ruleId: item.id?.toString() || item._id?.toString() || "",
            notifyOwners: false,
            headers: ModelAPI.getCommonHeaders(),
          });

          // A run that did not succeed fails its rule, in the run's words.
          if (!outcome.isSuccess) {
            throw new Error(outcome.message);
          }
        },
      });
    },
  };
}

export default getRunRulesBulkAction;
