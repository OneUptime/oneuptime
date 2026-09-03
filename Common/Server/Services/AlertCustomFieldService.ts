import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/AlertCustomField";
import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import { backfillMappedCustomFieldValues } from "../Utils/CustomField/CustomFieldDefinitionMappingHooks";
import {
  validateCustomFieldMappingOnCreate,
  validateCustomFieldMappingOnUpdate,
} from "../Utils/CustomField/CustomFieldMappingValidator";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * An alert custom field can take its value from the same field on the alert's
 * monitor instead of being typed in again (OneUptime/oneuptime#3549). These
 * hooks are the two halves of that configuration being saved: refusing a
 * mapping that could never resolve, and filling in the alerts that already
 * exist once one is saved.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await validateCustomFieldMappingOnCreate({
      definitionModelType: Model,
      createBy: createBy,
    });

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await validateCustomFieldMappingOnUpdate({
      definitionModelType: Model,
      definitionService: this,
      updateBy: updateBy,
    });

    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    backfillMappedCustomFieldValues({
      definitionModelType: Model,
      projectId: createdItem.projectId,
      definitionName: "alert custom field",
    });

    return createdItem;
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    if (updatedItemIds.length > 0) {
      backfillMappedCustomFieldValues({
        definitionModelType: Model,
        projectId: await this.getProjectIdForBackfill(onUpdate, updatedItemIds),
        definitionName: "alert custom field",
      });
    }

    return onUpdate;
  }

  /*
   * `props.tenantId` is set on every dashboard write but not on internal
   * root-scoped ones, so fall back to the row itself rather than skipping the
   * backfill for a mapping that was changed by a script.
   */
  private async getProjectIdForBackfill(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<ObjectID | undefined> {
    const tenantId: ObjectID | undefined = onUpdate.updateBy.props.tenantId as
      | ObjectID
      | undefined;

    if (tenantId) {
      return tenantId;
    }

    const item: Model | null = await this.findOneById({
      id: updatedItemIds[0]!,
      select: { projectId: true },
      props: { isRoot: true },
    });

    return item?.projectId;
  }
}
export default new Service();
