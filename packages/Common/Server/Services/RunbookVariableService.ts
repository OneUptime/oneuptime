import ProjectReferencesService from "./ProjectReferencesService";
import RunnerService from "./RunnerService";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import RunbookVariable from "../../Models/DatabaseModels/RunbookVariable";
import { toStoredBoolean } from "../../Types/Database/BooleanColumnValue";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  RUNBOOK_VARIABLE_NAME_MAX_LENGTH,
  isValidRunbookVariableName,
} from "../../Types/Runbook/RunbookVariableReference";

/*
 * Runbook variables (Models/DatabaseModels/RunbookVariable): what a write
 * may hold.
 *
 *   - A name steps can write: letters, digits, hyphens and underscores, as
 *     {{global.variables.NAME}} reads it, unique among the project's global
 *     variables or the runbook's own - including after a rename.
 *   - A secret's value is in secretValue, never in value, and a secret has
 *     one; a plain variable's value is in value, never in secretValue. A
 *     secret is never made plain, nor a plain variable secret: isSecret is
 *     fixed when the variable is made.
 *   - Only a secret lists the Runners it reaches and whether global Runners
 *     may use it: a plain variable reaches every Runner of its project, so
 *     what a form sends for those is left out of it.
 *   - A secret is never assigned to a kubernetes-agent Runner, whose
 *     identity the project's telemetry ingestion key can mint
 *     (RunnerService.assertNoKubernetesAgentRunners), as a secret never was.
 *
 * Its Runners and its runbook must be the project's own: ProjectReferences
 * checks both.
 */

export const RUNBOOK_VARIABLE_NAME_RULE: string = `A variable's name uses letters, numbers, hyphens (-) and underscores (_) only, up to ${RUNBOOK_VARIABLE_NAME_MAX_LENGTH} characters.`;

function isBlank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "")
  );
}

export class Service extends ProjectReferencesService<RunbookVariable> {
  public constructor() {
    super(RunbookVariable);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<RunbookVariable>,
  ): Promise<OnCreate<RunbookVariable>> {
    await super.onBeforeCreate(createBy);

    const data: JSONObject = createBy.data as unknown as JSONObject;

    if (typeof data["name"] === "string") {
      data["name"] = data["name"].trim();
    }

    if (!isValidRunbookVariableName(data["name"])) {
      throw new BadDataException(RUNBOOK_VARIABLE_NAME_RULE);
    }

    const isSecret: boolean = toStoredBoolean(data["isSecret"]) === true;

    if (isSecret) {
      if (!isBlank(data["value"])) {
        throw new BadDataException(
          "A secret variable keeps its value in Secret Value, which is encrypted and never read back, not in Value.",
        );
      }

      if (isBlank(data["secretValue"])) {
        throw new BadDataException("A secret variable needs a value.");
      }

      // Nothing was sent for the plain value; leave the column unwritten.
      delete data["value"];

      await RunnerService.assertNoKubernetesAgentRunners({
        runners: createBy.data.runners,
        assignedWhat: "secret",
      });

      return { createBy, carryForward: [] };
    }

    if (!isBlank(data["secretValue"])) {
      throw new BadDataException(
        "Only a secret variable has a Secret Value. Turn Secret on, or put the value in Value.",
      );
    }

    if (isBlank(data["value"])) {
      throw new BadDataException("A variable needs a value.");
    }

    /*
     * A plain value reaches every Runner of its project, so who may use it
     * is not asked. A form that asks it for secrets sends its answers for
     * a plain variable too; they are left out rather than refused.
     */
    delete data["secretValue"];
    delete data["runners"];
    delete data["isAvailableToGlobalRunners"];

    return { createBy, carryForward: [] };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<RunbookVariable>,
  ): Promise<OnUpdate<RunbookVariable>> {
    await super.onBeforeUpdate(updateBy);

    const data: JSONObject = updateBy.data as unknown as JSONObject;

    await RunnerService.assertNoKubernetesAgentRunners({
      runners: updateBy.data.runners,
      assignedWhat: "secret",
    });

    const isRename: boolean = data["name"] !== undefined;

    if (isRename) {
      if (typeof data["name"] === "string") {
        data["name"] = data["name"].trim();
      }

      if (!isValidRunbookVariableName(data["name"])) {
        throw new BadDataException(RUNBOOK_VARIABLE_NAME_RULE);
      }
    }

    const touchesKind: boolean =
      data["isSecret"] !== undefined ||
      data["value"] !== undefined ||
      data["secretValue"] !== undefined ||
      data["runners"] !== undefined ||
      data["isAvailableToGlobalRunners"] !== undefined;

    if (!isRename && !touchesKind) {
      return { updateBy, carryForward: null };
    }

    /*
     * The rows this update will touch, the update held to them: the rows
     * the caller may write, never another project's, so what is said below
     * about a name or a kind is said only of the caller's own variables.
     */
    const rows: Array<RunbookVariable> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        name: true,
        isSecret: true,
        projectId: true,
        runbookId: true,
      },
    );

    if (touchesKind) {
      this.applyKindRules(data, rows);
    }

    if (isRename) {
      await this.assertNameIsFree(data["name"] as string, rows);
    }

    return { updateBy, carryForward: null };
  }

  /*
   * What a write to the value or the access of these rows may hold, by
   * whether each is a secret.
   */
  private applyKindRules(data: JSONObject, rows: Array<RunbookVariable>): void {
    const secrets: Array<RunbookVariable> = rows.filter(
      (row: RunbookVariable): boolean => {
        return toStoredBoolean(row.isSecret) === true;
      },
    );

    const plain: Array<RunbookVariable> = rows.filter(
      (row: RunbookVariable): boolean => {
        return toStoredBoolean(row.isSecret) !== true;
      },
    );

    if (data["isSecret"] !== undefined && data["isSecret"] !== null) {
      const wantsSecret: boolean = toStoredBoolean(data["isSecret"]) === true;

      const changing: Array<RunbookVariable> = wantsSecret ? plain : secrets;

      if (changing.length > 0) {
        throw new BadDataException(
          `"${changing[0]!.name}" ${
            wantsSecret ? "is not a secret" : "is a secret"
          }, and whether a variable is a secret cannot be changed. Make a new variable with the same name instead: steps name variables by name, so they keep working.`,
        );
      }

      delete data["isSecret"];
    }

    if (data["value"] !== undefined) {
      if (secrets.length > 0 && !isBlank(data["value"])) {
        throw new BadDataException(
          `"${secrets[0]!.name}" is a secret: its value goes in Secret Value, which is encrypted and never read back.`,
        );
      }

      if (plain.length > 0 && isBlank(data["value"])) {
        throw new BadDataException("A variable needs a value.");
      }

      if (plain.length === 0) {
        delete data["value"];
      }
    }

    if (data["secretValue"] !== undefined) {
      if (plain.length > 0 && !isBlank(data["secretValue"])) {
        throw new BadDataException(
          `"${plain[0]!.name}" is not a secret, so it has no Secret Value. Change its Value instead.`,
        );
      }

      /*
       * An empty secret value means "keep the one it has" - an edit form
       * never shows the stored one - so it is left out, never stored.
       */
      if (isBlank(data["secretValue"])) {
        delete data["secretValue"];
      }
    }

    // Only a secret says who may use it: what a form sends for a plain one is left out.
    if (secrets.length === 0) {
      delete data["runners"];
      delete data["isAvailableToGlobalRunners"];
    }
  }

  // A rename keeps names unique among the project's globals or the runbook's own.
  private async assertNameIsFree(
    newName: string,
    rows: Array<RunbookVariable>,
  ): Promise<void> {
    if (rows.length > 1) {
      throw new BadDataException(
        `Cannot rename ${rows.length} runbook variables to "${newName}" at once. Variable names must be unique.`,
      );
    }

    for (const row of rows) {
      // Compared as the unique check compares: a change of case is no clash.
      if (row.name && row.name.toLowerCase() === newName.toLowerCase()) {
        continue;
      }

      if (!row.projectId) {
        throw new BadDataException(
          "This runbook variable cannot be renamed because it is not attached to a project.",
        );
      }

      const clashes: number = (
        await this.countBy({
          query: {
            name: QueryHelper.findWithSameText(newName),
            projectId: row.projectId,
            runbookId: row.runbookId ? row.runbookId : QueryHelper.isNull(),
            _id: QueryHelper.notEquals(row.id as ObjectID),
          },
          props: {
            isRoot: true,
          },
        })
      ).toNumber();

      if (clashes > 0) {
        throw new BadDataException(
          row.runbookId
            ? `This runbook already has a variable named "${newName}". Variable names must be unique within a runbook.`
            : `A global variable named "${newName}" already exists in this project. Global variable names must be unique.`,
        );
      }
    }
  }
}

export default new Service();
