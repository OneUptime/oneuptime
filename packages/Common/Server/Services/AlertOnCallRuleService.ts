import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/AlertOnCallRule";
import { IsBillingEnabled } from "../EnvironmentConfig";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import OnCallRuleWhenToPageCheck from "../Utils/Rules/OnCallRuleWhenToPageCheck";
import AiFirstResponderRules, {
  AI_FIRST_RESPONDER_RULE_SELECT,
} from "../Utils/AI/FirstResponder/AiFirstResponderRules";
import DeleteBy from "../Types/Database/DeleteBy";
import QueryHelper from "../Types/Database/QueryHelper";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import RuleCriteriaOwnerIds from "../Utils/Rules/RuleCriteriaOwnerIds";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";

// The rule kind whose owner conditions are checked (RuleCriteriaOwnerIds).
const RULE_MODEL_NAME: string = "AlertOnCallRule";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  /*
   * A rule that pages only during working hours has hours that open, in a
   * time zone OneUptime knows, and one that lets OneUptime AI respond first
   * a hold time within its bounds (OnCallRuleWhenToPageCheck): refused
   * before anything the rule names is looked up, the same for every caller.
   */
  protected override async checkCreateBeforeReferences(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    OnCallRuleWhenToPageCheck.checkCreate(createBy, {
      allowsOneUptimeAI: true,
    });
  }

  protected override async checkUpdateBeforeReferences(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    await OnCallRuleWhenToPageCheck.checkUpdate({
      service: this,
      updateBy: updateBy,
      options: { allowsOneUptimeAI: true },
    });
  }

  /*
   * The people and teams an Alert Owner condition names are the project's
   * own (RuleCriteriaOwnerIds), checked after the rule's other references.
   * OneUptime's own writes, as root, name what they found themselves.
   */
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const projectId: ObjectID | undefined =
      createBy.data.projectId || createBy.props.tenantId;

    if (!createBy.props.isRoot && projectId) {
      await RuleCriteriaOwnerIds.check({
        projectId: projectId,
        modelName: RULE_MODEL_NAME,
        criteria: createBy.data.criteria,
      });
    }

    return { createBy: createBy, carryForward: undefined };
  }

  /*
   * Conditions written again: the people and teams they name now are the
   * project's own, but for those each rule named already - one since
   * removed from the project is kept.
   */
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const criteria: unknown = (
      updateBy.data as unknown as Record<string, unknown>
    )["criteria"];

    if (
      !updateBy.props.isRoot &&
      RuleCriteriaOwnerIds.namesOwners({
        modelName: RULE_MODEL_NAME,
        criteria: criteria,
      })
    ) {
      const rules: Array<Model> = await this.findRowsAndHoldUpdateToThem(
        updateBy,
        {
          projectId: true,
          criteria: true,
        },
      );

      for (const rule of rules) {
        if (!rule.projectId) {
          continue;
        }

        await RuleCriteriaOwnerIds.check({
          projectId: rule.projectId,
          modelName: RULE_MODEL_NAME,
          criteria: criteria,
          keptIds: RuleCriteriaOwnerIds.getIdsNamed({
            modelName: RULE_MODEL_NAME,
            criteria: rule.criteria,
          }),
        });
      }
    }

    return { updateBy: updateBy, carryForward: null };
  }

  /*
   * A rule set to another When to Page, or disabled, no longer lets
   * OneUptime AI respond first: the pages AI holds for its policies go to
   * people (AiFirstResponderRules).
   */
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    if (
      updatedItemIds.length > 0 &&
      AiFirstResponderRules.isStoppingHolds(
        onUpdate.updateBy.data as unknown as Record<string, unknown>,
      )
    ) {
      await AiFirstResponderRules.handOffForRules(
        await this.findBy({
          query: { _id: QueryHelper.any(updatedItemIds) },
          select: AI_FIRST_RESPONDER_RULE_SELECT,
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        }),
      );
    }

    return onUpdate;
  }

  /*
   * A deleted rule holds nothing either. Its policies are read while it is
   * there: the rules the delete removes, with the delete held to them
   * (findRowsAndHoldDeleteToThem), so a rule the caller may not delete is
   * never read. The pages AI holds for them go to people once the delete
   * has removed them, below - a delete that is refused or fails pages
   * nobody.
   */
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const rules: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      AI_FIRST_RESPONDER_RULE_SELECT,
    );

    return { deleteBy, carryForward: rules };
  }

  // The rules the delete removed, of those read before it, hand off.
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    await AiFirstResponderRules.handOffForRules(
      Service.getRowsDeleted<Model>({
        rows: (onDelete.carryForward as Array<Model> | null) || [],
        deletedIds: itemIdsBeforeDelete,
      }),
    );

    return onDelete;
  }

  // A hard delete (the retention job's purge) runs no onDeleteSuccess.
  protected override async onHardDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    return await this.onDeleteSuccess(onDelete, itemIdsBeforeDelete);
  }
}

export default new Service();
