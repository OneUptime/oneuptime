import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
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
 *     provider's attributes (TerraformSchema.ts);
 *   - the CLI gives the resource's `delete` a flag for each, named for its
 *     key as every flag is for its field (`--workflows-run-as`,
 *     CliCommands.getCliDeleteChoiceFlags, #9949): on `delete`, a flag can
 *     only be what the delete says;
 *   - the MCP server gives the resource's delete tool an input for each,
 *     named by its key (`workflowsRunAs`, MCP's Tools/ToolGenerator).
 *
 * The CLI and the MCP server read what they are given with
 * readDeleteChoices, below, which refuses what the server would before
 * anything is sent, and say how to give the choices when OneUptime refuses
 * a delete that gave none (isRefusedForDeleteChoices, getDeleteChoiceWays).
 *
 * The server reads them in WorkflowsOfDeletedRoles.readInstead, held to
 * these values by Common/Tests/Utils/DeveloperDocs/DeleteChoices.test.ts.
 */

/*
 * A value the record's own field takes that a choice never does, and why:
 * a workflow may run as Project Owner, but never because its role was
 * deleted. A client given one refuses it, saying why, before anything is
 * sent (readDeleteChoices); the server refuses it too.
 */
export interface RefusedDeleteChoiceValue {
  value: string;
  // Why, as the rest of a sentence: "deleting a role never raises what a workflow can do".
  reason: string;
}

export interface DeleteChoice {
  // Its key in the delete's miscDataProps: workflowsRunAs.
  key: string;
  // The values it takes. None for the ID of a record (relatedTableName).
  values?: ReadonlyArray<string> | undefined;
  // Values it never takes that a person may well try, and why.
  refusedValues?: ReadonlyArray<RefusedDeleteChoiceValue> | undefined;
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

// Why a custom role's delete never makes its workflows Project Owner.
const DELETING_NEVER_RAISES: string =
  "deleting a role never raises what a workflow can do";

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
      refusedValues: [
        {
          value: WorkflowRunAs.ProjectOwner,
          reason: DELETING_NEVER_RAISES,
        },
      ],
      describe: (nameOf: (key: string) => string): string => {
        return `What the workflows that run as this custom role run as once it is deleted: "${WorkflowRunAs.Default}", the default permissions, or "${WorkflowRunAs.CustomRole}", another custom role you could give a team, named in ${nameOf(WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY)}. Never Project Owner: ${DELETING_NEVER_RAISES}.`;
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

/*
 * ONE WAY TO SAY WHAT A DELETE NEEDS: a choice's value, and the choices
 * given with it - { workflowsRunAs: "Default" }, or { workflowsRunAs:
 * "CustomRole" } with workflowsRunAsCustomRoleId. A client lists them, in
 * its own words, after OneUptime refuses a delete that gave none.
 */
export interface DeleteChoiceWay {
  key: string;
  value: string;
  // The choices given with this value, and only with it.
  with: ReadonlyArray<DeleteChoice>;
}

// The choices given with a choice's value, and only with it.
function companionsOf(
  choices: DeleteChoicesOfTable,
  key: string,
  value: string,
): Array<DeleteChoice> {
  return choices.choices.filter((choice: DeleteChoice): boolean => {
    return (
      choice.requiredWith?.key === key && choice.requiredWith.value === value
    );
  });
}

// Every way a delete of a record of `tableName` says its choices, in order.
export function getDeleteChoiceWays(
  tableName: string | null | undefined,
): Array<DeleteChoiceWay> {
  const choices: DeleteChoicesOfTable | null = getDeleteChoices(tableName);

  if (!choices) {
    return [];
  }

  return choices.choices
    .filter((choice: DeleteChoice): boolean => {
      return !choice.requiredWith;
    })
    .flatMap((choice: DeleteChoice): Array<DeleteChoiceWay> => {
      return (choice.values || []).map((value: string): DeleteChoiceWay => {
        return {
          key: choice.key,
          value: value,
          with: companionsOf(choices, choice.key, value),
        };
      });
    });
}

/*
 * A CLIENT'S CHOICES, READ AS THE SERVER READS THEM (#9949).
 *
 * The CLI's flags (--workflows-run-as) and the MCP server's delete tool
 * (workflowsRunAs) take a delete's choices as a person or an agent writes
 * them, and send them as the API takes them, in miscDataProps. Both read
 * them here, and what the server would refuse is refused before anything is
 * sent, in words that name each choice the way that client does (nameOf):
 *
 *   - a value is one the choice offers, in any case, with or without its
 *     spaces, dashes and underscores ("custom-role" is "CustomRole");
 *   - a value it never takes says why (refusedValues: Project Owner);
 *   - an ID is an ID, and not the record being deleted;
 *   - a choice that goes with another (requiredWith) is given only while
 *     that one has its value, and always then.
 *
 * A delete given none sends none: the delete it always was.
 */

// A choice a client was given that the delete can't send, said the way the reader fixes it.
export class DeleteChoiceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DeleteChoiceError";
  }
}

export interface DeleteChoicesGiven {
  // The table of the record being deleted: CustomRole.
  tableName: string | null | undefined;
  // What the client was given, by each choice's key; undefined, null or blank when not given.
  given: Readonly<Record<string, unknown>>;
  // The record being deleted, which a choice naming a record of its table may not name.
  deletedId?: string | null | undefined;
  // A choice as the client names it: --workflows-run-as, workflowsRunAs.
  nameOf: (key: string) => string;
}

// An ID, as the messages show one.
const EXAMPLE_ID: string = "6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11";

const NOT_A_LETTER_OR_DIGIT: RegExp = /[^a-z0-9]/g;

// A value as it is compared: "custom-role", "Custom Role" and "CustomRole" alike.
function comparable(value: string): string {
  return value.toLowerCase().replace(NOT_A_LETTER_OR_DIGIT, "");
}

function isGiven(raw: unknown): boolean {
  return !(
    raw === undefined ||
    raw === null ||
    (typeof raw === "string" && raw.trim() === "")
  );
}

// What the client was given, as a message quotes it: "Admin", 5.
function quoted(raw: unknown): string {
  return typeof raw === "string"
    ? JSON.stringify(raw.trim())
    : JSON.stringify(raw) || String(raw);
}

// "Default" or "CustomRole"; "A", "B" or "C".
function listValues(values: ReadonlyArray<string>): string {
  const each: Array<string> = values.map((value: string): string => {
    return `"${value}"`;
  });

  return each.length > 1
    ? `${each.slice(0, -1).join(", ")} or ${each[each.length - 1]}`
    : each.join("");
}

// What a choice may be instead: "Default", or "CustomRole" with --workflows-run-as-custom-role-id.
function waysToChoose(
  choices: DeleteChoicesOfTable,
  choice: DeleteChoice,
  nameOf: (key: string) => string,
): string {
  const ways: Array<string> = (choice.values || []).map(
    (value: string): string => {
      const companions: Array<string> = companionsOf(
        choices,
        choice.key,
        value,
      ).map((companion: DeleteChoice): string => {
        return nameOf(companion.key);
      });

      return companions.length > 0
        ? `"${value}" with ${companions.join(" and ")}`
        : `"${value}"`;
    },
  );

  return ways.length > 1
    ? `${ways.slice(0, -1).join(", ")}, or ${ways[ways.length - 1]}`
    : ways.join("");
}

// The values of a choice other than one: what a choice that goes with it may be set to instead.
function otherValues(choice: DeleteChoice | undefined, value: string): string {
  return listValues(
    (choice?.values || []).filter((each: string): boolean => {
      return each !== value;
    }),
  );
}

function choiceOfKey(
  choices: DeleteChoicesOfTable,
  key: string,
): DeleteChoice | undefined {
  return choices.choices.find((choice: DeleteChoice): boolean => {
    return choice.key === key;
  });
}

// A choice of values: one it offers, as the API takes it.
function readValue(data: {
  choices: DeleteChoicesOfTable;
  choice: DeleteChoice;
  raw: unknown;
  nameOf: (key: string) => string;
}): string {
  const name: string = data.nameOf(data.choice.key);
  const values: ReadonlyArray<string> = data.choice.values || [];
  const written: string | null =
    typeof data.raw === "string" ? comparable(data.raw) : null;

  const offered: string | undefined = values.find((value: string): boolean => {
    return comparable(value) === written;
  });

  if (offered) {
    return offered;
  }

  const refused: RefusedDeleteChoiceValue | undefined = (
    data.choice.refusedValues || []
  ).find((each: RefusedDeleteChoiceValue): boolean => {
    return comparable(each.value) === written;
  });

  if (refused) {
    throw new DeleteChoiceError(
      `${name} can't be ${quoted(data.raw)}: ${refused.reason}. Choose ${waysToChoose(data.choices, data.choice, data.nameOf)}.`,
    );
  }

  throw new DeleteChoiceError(
    `${name} takes ${listValues(values)}, and ${quoted(data.raw)} is ${values.length === 2 ? "neither" : "none of them"}.`,
  );
}

// A choice that names a record: its ID, and not the record being deleted.
function readId(data: {
  choices: DeleteChoicesOfTable;
  choice: DeleteChoice;
  raw: unknown;
  given: DeleteChoicesGiven;
}): string {
  const name: string = data.given.nameOf(data.choice.key);
  const id: string = typeof data.raw === "string" ? data.raw.trim() : "";

  if (!ObjectID.isValidUUID(id)) {
    throw new DeleteChoiceError(
      `${name} takes an ID, such as ${EXAMPLE_ID}, and ${quoted(data.raw)} is not one.`,
    );
  }

  const deletedId: string = (data.given.deletedId || "").trim().toLowerCase();

  if (
    data.choice.relatedTableName === data.given.tableName &&
    deletedId &&
    id.toLowerCase() === deletedId
  ) {
    const requiredWith: DeleteChoice["requiredWith"] = data.choice.requiredWith;
    const instead: string = requiredWith
      ? otherValues(
          choiceOfKey(data.choices, requiredWith.key),
          requiredWith.value,
        )
      : "";

    throw new DeleteChoiceError(
      `${name} names the ${data.choices.noun} being deleted. Name another ${data.choices.noun}${
        requiredWith && instead
          ? `, or set ${data.given.nameOf(requiredWith.key)} to ${instead}`
          : ""
      }.`,
    );
  }

  return id;
}

/*
 * The delete's miscDataProps for what a client was given: each choice as
 * the API takes it, and nothing for a choice not given - so {} for a
 * delete given none, which then sends no body. Throws a DeleteChoiceError,
 * before anything is sent, for what the server would refuse.
 */
export function readDeleteChoices(given: DeleteChoicesGiven): JSONObject {
  const choices: DeleteChoicesOfTable | null = getDeleteChoices(
    given.tableName,
  );
  const miscDataProps: JSONObject = {};

  if (!choices) {
    return miscDataProps;
  }

  for (const choice of choices.choices) {
    const raw: unknown = given.given[choice.key];

    if (!isGiven(raw)) {
      continue;
    }

    if (choice.values) {
      miscDataProps[choice.key] = readValue({
        choices,
        choice,
        raw,
        nameOf: given.nameOf,
      });
    } else if (choice.relatedTableName) {
      miscDataProps[choice.key] = readId({ choices, choice, raw, given });
    } else {
      miscDataProps[choice.key] = String(raw).trim();
    }
  }

  // A choice that goes with another: only with its value, and always then.
  for (const choice of choices.choices) {
    const requiredWith: DeleteChoice["requiredWith"] = choice.requiredWith;

    if (!requiredWith) {
      continue;
    }

    const name: string = given.nameOf(choice.key);
    const other: string = given.nameOf(requiredWith.key);
    const otherValue: unknown = miscDataProps[requiredWith.key];
    const isThisGiven: boolean = miscDataProps[choice.key] !== undefined;
    const isOtherTheValue: boolean = otherValue === requiredWith.value;

    if (isThisGiven && !isOtherTheValue) {
      throw new DeleteChoiceError(
        `${name} goes with ${other} set to "${requiredWith.value}", and ${other} ${
          otherValue === undefined ? "isn't given" : `is ${quoted(otherValue)}`
        }. Set ${other} to "${requiredWith.value}", or leave ${name} out.`,
      );
    }

    if (!isThisGiven && isOtherTheValue) {
      const instead: string = otherValues(
        choiceOfKey(choices, requiredWith.key),
        requiredWith.value,
      );

      throw new DeleteChoiceError(
        `${other} is "${requiredWith.value}", which needs ${name} too. Add ${name}${
          instead ? `, or set ${other} to ${instead}` : ""
        }.`,
      );
    }
  }

  return miscDataProps;
}

/*
 * Whether OneUptime refused a delete for the choices it needs, which the
 * delete did not give: the refusal names a choice as the API takes it
 * (miscDataProps.workflowsRunAs, getCustomRoleDeleteWorkflowsMessage), and
 * nothing was sent. A client then says how to give them in its own words,
 * as the Terraform provider's deleteChoicesHint does; a delete that sent a
 * choice was refused for something the refusal's own words say.
 */
export function isRefusedForDeleteChoices(data: {
  tableName: string | null | undefined;
  // The refusal's words, as the client has them.
  refusal: string;
  // The miscDataProps the delete sent.
  sent: JSONObject | null | undefined;
}): boolean {
  const choices: DeleteChoicesOfTable | null = getDeleteChoices(data.tableName);

  if (!choices || (data.sent && Object.keys(data.sent).length > 0)) {
    return false;
  }

  return choices.choices.some((choice: DeleteChoice): boolean => {
    return data.refusal.includes(getDeleteChoiceApiName(choice.key));
  });
}
