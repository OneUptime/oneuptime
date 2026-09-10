import DatabaseService from "./DatabaseService";
import { OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Model from "../../Models/DatabaseModels/WorkflowVariable";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * @UniqueColumnBy(["workflowId", "projectId"]) on `name` is enforced by
   * DatabaseService.checkUniqueColumnBy, which runs on create only - and there
   * is no unique index on WorkflowVariable to catch what it misses. That was
   * harmless while the dashboard offered no way to edit a variable. Now that it
   * does, a rename is the one write that can put two rows with the same name in
   * the same scope, and RunWorkflow.getVariables builds
   * `storageMap.local.variables[variable.name] = variable.content` - a plain
   * dictionary - so the second row would silently overwrite the first and
   * {{local.variables.X}} would resolve to whichever the query happened to
   * return last. Nothing would look broken; the workflow would just quietly run
   * on the wrong value.
   */
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const newName: string | undefined = updateBy.data.name as
      | string
      | undefined;

    if (!newName) {
      // Not a rename. Nothing here to guard.
      return { updateBy, carryForward: null };
    }

    /*
     * Read the rows this update will actually touch. The query is whatever the
     * caller passed - usually a single _id from the dashboard, but the API
     * accepts a broader one - and each row carries its own scope, so the
     * conflict has to be resolved per row rather than once for the update.
     */
    const itemsBeingUpdated: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        _id: true,
        name: true,
        projectId: true,
        workflowId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    /*
     * Renaming two rows to one name is a conflict the database lookup below
     * cannot see: neither collides with anything that exists yet, they collide
     * with each other once both are written.
     */
    if (itemsBeingUpdated.length > 1) {
      throw new BadDataException(
        `Cannot rename ${itemsBeingUpdated.length} workflow variables to "${newName}" at once. Variable names must be unique.`,
      );
    }

    for (const item of itemsBeingUpdated) {
      /*
       * A no-op rename must stay a no-op. Compared case-insensitively because
       * that is how the uniqueness lookup compares, so "TOKEN" -> "token" is a
       * change of casing on the same row and not a collision with itself.
       */
      if (item.name && item.name.toLowerCase() === newName.toLowerCase()) {
        continue;
      }

      const conflictCount: number = (
        await this.countBy({
          query: {
            name: QueryHelper.findWithSameText(newName),
            projectId: item.projectId!,
            /*
             * Global variables are the rows with a null workflowId, and they
             * share a namespace of their own. Querying `workflowId: undefined`
             * would drop the clause entirely and compare a global variable
             * against every workflow-local one in the project.
             */
            workflowId: item.workflowId
              ? item.workflowId
              : QueryHelper.isNull(),
            _id: QueryHelper.notEquals(item.id as ObjectID),
          },
          props: {
            isRoot: true,
          },
        })
      ).toNumber();

      if (conflictCount > 0) {
        throw new BadDataException(
          item.workflowId
            ? `A workflow variable named "${newName}" already exists on this workflow. Variable names must be unique within a workflow.`
            : `A global variable named "${newName}" already exists in this project. Global variable names must be unique.`,
        );
      }
    }

    return { updateBy, carryForward: null };
  }
}
export default new Service();
