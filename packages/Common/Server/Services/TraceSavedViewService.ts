import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TraceSavedView";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import ObjectID from "../../Types/ObjectID";
import ProjectDefaultRow from "../Utils/Database/ProjectDefaultRow";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A project's first saved view becomes its default when the create does
   * not say. The view only takes the default from the project's other views
   * once it is saved (onCreateSuccess), so a create that is refused or fails
   * leaves the project's default where it was.
   */
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (createBy.data.isDefault === undefined && createBy.data.projectId) {
      const existingDefaultView: Model | null = await this.findOneBy({
        query: {
          projectId: createBy.data.projectId,
          isDefault: true,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

      createBy.data.isDefault = !existingDefaultView;
    }

    return { createBy, carryForward: null };
  }

  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    await ProjectDefaultRow.afterCreate({
      service: this,
      defaultColumn: "isDefault",
      createdItem: createdItem,
    });

    return createdItem;
  }

  // A view an update made the default takes it from the project's others.
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    await ProjectDefaultRow.afterUpdate({
      service: this,
      defaultColumn: "isDefault",
      updatedData: onUpdate.updateBy.data,
      updatedItemIds: updatedItemIds,
    });

    return onUpdate;
  }
}

export default new Service();
