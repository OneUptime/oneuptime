import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/LogSavedView";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import ObjectID from "../../Types/ObjectID";
import ProjectDefaultRow from "../Utils/Database/ProjectDefaultRow";
import { getSavedViewScopeColumnValue } from "../../Utils/Telemetry/SavedViewScope";

/*
 * A saved log view belongs to the page it was saved on, its `scope` (issue
 * #5549): the Logs page's views have none, a Kubernetes cluster's Logs tab's
 * name that cluster. Each page has a default of its own, so the default is
 * taken only from the views of the same page.
 */
const DEFAULT_GROUP_COLUMNS: Array<string> = ["scope"];

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A page's first saved view becomes its default when the create does not
   * say. The view only takes the default from the page's other views once it
   * is saved (onCreateSuccess), so a create that is refused or fails leaves
   * the page's default where it was.
   */
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    /*
     * The Logs page's views, and any scope that is blank, are stored with
     * none: a view made through the API with "" or "explorer" lands on the
     * Logs page rather than on a page nobody shows.
     */
    const scope: string | null = getSavedViewScopeColumnValue(
      createBy.data.scope,
    );

    if (scope) {
      createBy.data.scope = scope;
    } else {
      delete createBy.data.scope;
    }

    if (createBy.data.isDefault === undefined && createBy.data.projectId) {
      const existingDefaultView: Model | null = await this.findOneBy({
        query: {
          projectId: createBy.data.projectId,
          scope: scope === null ? QueryHelper.isNull() : scope,
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
      groupByColumns: DEFAULT_GROUP_COLUMNS,
    });

    return createdItem;
  }

  // A view an update made the default takes it from its page's others.
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    await ProjectDefaultRow.afterUpdate({
      service: this,
      defaultColumn: "isDefault",
      updatedData: onUpdate.updateBy.data,
      updatedItemIds: updatedItemIds,
      groupByColumns: DEFAULT_GROUP_COLUMNS,
    });

    return onUpdate;
  }
}

export default new Service();
