import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TeamMemberCustomField";
import ObjectID from "../../Types/ObjectID";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnUpdate } from "../Types/Database/Hooks";
import {
  applyCustomFieldOptionEdit,
  CustomFieldOptionEditCarryForward,
  prepareCustomFieldOptionEdit,
} from "../Utils/CustomField/CustomFieldOptionEditHooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * A team member custom field that is a dropdown can have its options renamed after
 * records hold them: the write says which options it renames, and the values
 * that held them are moved on every record, template, saved view and form
 * template (CustomFieldOptionEditHooks, issue #4564).
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const optionEdit: CustomFieldOptionEditCarryForward | null =
      await prepareCustomFieldOptionEdit({
        definitionModelType: Model,
        definitionService: this,
        updateBy: updateBy,
      });

    return { updateBy, carryForward: optionEdit };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    await applyCustomFieldOptionEdit({
      definitionModelType: Model,
      definitionService: this,
      carryForward:
        (onUpdate.carryForward as CustomFieldOptionEditCarryForward | null) ||
        null,
      updatedItemIds: updatedItemIds,
    });

    return onUpdate;
  }
}
export default new Service();
