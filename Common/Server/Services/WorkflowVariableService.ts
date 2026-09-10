import DatabaseService from "./DatabaseService";
import { OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Typeof from "../../Types/Typeof";
import Model from "../../Models/DatabaseModels/WorkflowVariable";

/*
 * isSecret is declared `string` over a genuinely boolean column, so the value
 * that comes back is `true` from Postgres and can be the string "true" from a
 * request body. Read exactly the way RunWorkflow.getSecretWorkflowVariableValues
 * reads it, so what this service calls secret and what the run logs redact can
 * never disagree.
 */
function isSecretValue(value: unknown): boolean {
  return value === true || value === "true";
}

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
   *
   * Two things this cannot close, both shared with the create-side guard it
   * mirrors: DatabaseService._updateBy skips every hook when props.ignoreHooks
   * is set, and check-then-write is not atomic, so two concurrent renames onto
   * the same free name can still both land. Closing either properly means a
   * unique index on (projectId, workflowId, LOWER(name)), which needs a dedupe
   * migration first because the racy create-side check may already have let
   * duplicates through.
   */
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const rawName: unknown = updateBy.data.name;

    /*
     * Only an update that does not carry the column at all is exempt. An
     * explicitly blank name is still a write to `name` - the column is
     * nullable: false but the empty string satisfies that, and update does not
     * re-run the required check - so two rows blanked in the same scope would
     * both become "" and collide like any other duplicate. Let it through to
     * the lookup rather than treating it as "no rename".
     */
    const isRename: boolean = rawName !== undefined && rawName !== null;

    /*
     * sanitizeUpdateData passes plain objects straight through, so `name` is
     * whatever the request body said it was. Reject a non-string here rather
     * than letting toLowerCase() throw a TypeError, which would surface as a
     * 500 and a stack trace instead of a 400 naming the field.
     */
    if (isRename && typeof rawName !== Typeof.String) {
      throw new BadDataException("Workflow variable name must be text.");
    }

    const newName: string = rawName as string;

    /*
     * Turning the secret flag OFF is the one direction that can expose
     * something. isSecret decides whether RunWorkflow replaces this variable's
     * value with [REDACTED] before a run log is persisted, and content itself
     * is unreadable through the API - so a caller who may write a variable but
     * may not read it could otherwise clear the flag, trigger a run, and read
     * the value out of the log. Marking a variable secret stays freely
     * available; unmarking one does not.
     */
    const isDeclassifying: boolean =
      updateBy.data.isSecret !== undefined &&
      updateBy.data.isSecret !== null &&
      !isSecretValue(updateBy.data.isSecret);

    if (!isRename && !isDeclassifying) {
      return { updateBy, carryForward: null };
    }

    /*
     * Read the rows this update will actually touch. Two things about this
     * query matter.
     *
     * It is scoped to the caller's tenant here rather than relying on the
     * permission layer, because _updateBy runs this hook BEFORE
     * ModelPermission.checkUpdateQueryPermissions - which is what appends the
     * project clause. Reading unscoped-as-root would make this hook answer
     * questions about another project's rows, and its refusal messages say
     * whether a variable is global and whether a name is taken. A caller
     * holding a variable id from a project they cannot see would get an oracle
     * before any authorization ran.
     *
     * isRoot inside that scope is still right: the conflicting row may be one
     * this caller cannot read - read access is label-gated - and a count that
     * cannot see it reports zero and waves the duplicate through.
     */
    const tenantId: ObjectID | undefined = updateBy.props.tenantId;

    const itemsBeingUpdated: Array<Model> = await this.findBy({
      query: tenantId
        ? { ...updateBy.query, projectId: tenantId }
        : updateBy.query,
      select: {
        _id: true,
        name: true,
        isSecret: true,
        projectId: true,
        workflowId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    if (isDeclassifying) {
      for (const item of itemsBeingUpdated) {
        if (isSecretValue(item.isSecret)) {
          throw new BadDataException(
            `"${item.name}" is marked secret, and a secret variable cannot be un-marked. Its value is redacted from workflow run logs, and clearing the flag would publish that value to the logs of every later run. Delete the variable and create it again if it should no longer be secret.`,
          );
        }
      }
    }

    if (!isRename) {
      return { updateBy, carryForward: null };
    }

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

      /*
       * The scope is what makes the lookup mean anything. projectId comes back
       * from the select above and is non-nullable on the table, so its absence
       * means the select or the row is wrong - and a missing projectId would
       * silently drop the clause and count this name across every project on
       * the instance. Refuse rather than answer the wrong question.
       */
      if (!item.projectId) {
        throw new BadDataException(
          "This workflow variable cannot be renamed because it is not attached to a project.",
        );
      }

      const conflictCount: number = (
        await this.countBy({
          query: {
            name: QueryHelper.findWithSameText(newName),
            projectId: item.projectId,
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
          props: updateBy.props,
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
