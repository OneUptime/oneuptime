import {
  WORKFLOWS_RUN_AS_INSTEAD_KEY,
  WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY,
  WorkflowRunAs,
} from "../../Types/Workflow/WorkflowRunAs";

/*
 * WHAT A DELETE SAYS BESIDES THE RECORD: ITS CHOICES.
 *
 * Most deletes name the record and nothing else. A few also say what
 * becomes of something that depends on it, in the body of the DELETE
 * (`miscDataProps`, the server's DeleteOneBy.miscDataProps): a custom role
 * that workflows run as is deleted only by a delete that says what they run
 * as instead (WorkflowsOfDeletedRoles, #9767), and refused otherwise, naming
 * them.
 *
 * Every client OneUptime publishes says them from this one copy:
 *
 *   - the API reference documents them on the DELETE
 *     (Common/Server/Utils/OpenAPI.ts);
 *   - the Terraform and OpenTofu provider gives the resource an attribute
 *     for each (Scripts/TerraformProvider, #9832): `workflowsRunAs` is
 *     `workflows_run_as_on_delete`, sent with the delete. A delete takes
 *     what the resource's state holds, so it is set, and applied, before
 *     the destroy; setting it changes nothing else;
 *   - the dashboard's Developer > Terraform pages know them as the
 *     provider's attributes (TerraformSchema.ts).
 *
 * The server reads them in WorkflowsOfDeletedRoles.readInstead, held to
 * these values by Common/Tests/Utils/DeveloperDocs/DeleteChoices.test.ts.
 */

export interface DeleteChoice {
  // Its key in the delete's miscDataProps: workflowsRunAs.
  key: string;
  // The values it takes. None for the ID of a record (relatedTableName).
  values?: ReadonlyArray<string> | undefined;
  // The table of the record an ID names: CustomRole.
  relatedTableName?: string | undefined;
  /*
   * Another choice of the same delete it goes with: given only while that
   * one is set to `value`, and needed then.
   */
  requiredWith?: { key: string; value: string } | undefined;
  /*
   * What it is, in a sentence or two, each other choice named the way the
   * reader names it (`nameOf`): the API by its key, Terraform by its
   * attribute.
   */
  describe: (nameOf: (key: string) => string) => string;
}

export interface DeleteChoicesOfTable {
  // The record in a sentence's middle: "custom role".
  noun: string;
  // Why a delete of it says more than the record, in a sentence.
  whenNeeded: string;
  choices: ReadonlyArray<DeleteChoice>;
}

/*
 * A CUSTOM ROLE THAT WORKFLOWS RUN AS. Deleted, it would leave them running
 * nothing, so its delete says what they run as instead: the default
 * permissions, or another custom role the deleter could give a team. Never
 * Project Owner: deleting a role never raises what a workflow can do.
 */
export const CUSTOM_ROLE_DELETE_CHOICES: DeleteChoicesOfTable = {
  noun: "custom role",
  whenNeeded:
    "OneUptime deletes a custom role that workflows run as only when the delete says what they run as instead, and refuses one that does not, naming the workflows.",
  choices: [
    {
      key: WORKFLOWS_RUN_AS_INSTEAD_KEY,
      values: [WorkflowRunAs.Default, WorkflowRunAs.CustomRole],
      describe: (nameOf: (key: string) => string): string => {
        return `What the workflows that run as this custom role run as once it is deleted: "${WorkflowRunAs.Default}", the default permissions, or "${WorkflowRunAs.CustomRole}", another custom role you could give a team, named in ${nameOf(WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY)}. Never Project Owner: deleting a role never raises what a workflow can do.`;
      },
    },
    {
      key: WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY,
      relatedTableName: "CustomRole",
      requiredWith: {
        key: WORKFLOWS_RUN_AS_INSTEAD_KEY,
        value: WorkflowRunAs.CustomRole,
      },
      describe: (nameOf: (key: string) => string): string => {
        return `The ID of the other custom role the workflows run as, when ${nameOf(WORKFLOWS_RUN_AS_INSTEAD_KEY)} is "${WorkflowRunAs.CustomRole}": one you could give a team, and not the role being deleted.`;
      },
    },
  ],
};

// The tables whose delete takes choices, by table name.
const DELETE_CHOICES_BY_TABLE: Readonly<Record<string, DeleteChoicesOfTable>> =
  {
    CustomRole: CUSTOM_ROLE_DELETE_CHOICES,
  };

// The choices a delete of a record of `tableName` takes; null for most tables.
export function getDeleteChoices(
  tableName: string | null | undefined,
): DeleteChoicesOfTable | null {
  if (!tableName) {
    return null;
  }

  return DELETE_CHOICES_BY_TABLE[tableName] || null;
}

// Every table whose delete takes choices.
export function getTablesWithDeleteChoices(): Array<string> {
  return Object.keys(DELETE_CHOICES_BY_TABLE);
}

/*
 * A client's name for a choice beside the record's own fields: its key and
 * "OnDelete" (workflowsRunAsOnDelete; in Terraform
 * workflows_run_as_on_delete), so it reads as what the delete sends and
 * never as a field of the record.
 */
export function getDeleteChoiceFieldName(key: string): string {
  return `${key}OnDelete`;
}

// The API's name for a choice, in a sentence: miscDataProps.workflowsRunAs.
export function getDeleteChoiceApiName(key: string): string {
  return `miscDataProps.${key}`;
}
