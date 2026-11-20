import { describe, expect, test } from "@jest/globals";
import WorkflowsOfDeletedRoles, {
  WorkflowsRunAsInstead,
} from "../../../Server/Utils/Workflow/WorkflowsOfDeletedRoles";
import BadDataException from "../../../Types/Exception/BadDataException";
import {
  getCustomRoleDeleteWorkflowsMessage,
  WORKFLOWS_RUN_AS_INSTEAD_KEY,
  WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY,
  WORKFLOWS_RUN_AS_INSTEAD_UNKNOWN_MESSAGE,
  WorkflowRunAs,
} from "../../../Types/Workflow/WorkflowRunAs";
import {
  CUSTOM_ROLE_DELETE_CHOICES,
  DeleteChoice,
  DeleteChoicesOfTable,
  getDeleteChoiceApiName,
  getDeleteChoiceFieldName,
  getDeleteChoices,
  getTablesWithDeleteChoices,
} from "../../../Utils/DeveloperDocs/DeleteChoices";

/*
 * WHAT A DELETE SAYS BESIDES THE RECORD (#9832): the one copy the API
 * reference, the Terraform provider and the dashboard's Terraform pages
 * say a delete's choices from - held here to what the server reads
 * (WorkflowsOfDeletedRoles.readInstead) and to the words it refuses a
 * delete with, which the provider's hint keys off.
 */

const ROLE_ID: string = "5a0e0000-0000-4000-8000-0000000000aa";

function choiceOf(key: string): DeleteChoice {
  const choice: DeleteChoice | undefined =
    CUSTOM_ROLE_DELETE_CHOICES.choices.find(
      (candidate: DeleteChoice): boolean => {
        return candidate.key === key;
      },
    );

  expect(choice).toBeDefined();

  return choice!;
}

describe("the tables whose delete takes choices", () => {
  test("only a custom role's: what the workflows that run as it run as instead", () => {
    expect(getTablesWithDeleteChoices()).toEqual(["CustomRole"]);
    expect(getDeleteChoices("CustomRole")).toBe(CUSTOM_ROLE_DELETE_CHOICES);
  });

  test("every other table's delete takes none", () => {
    for (const tableName of [
      "Workflow",
      "Team",
      "ApiKey",
      "TeamCustomRole",
      "",
      null,
      undefined,
    ]) {
      expect(getDeleteChoices(tableName)).toBeNull();
    }
  });
});

describe("a custom role's delete", () => {
  test("says what its workflows run as, by the keys the server reads", () => {
    expect(
      CUSTOM_ROLE_DELETE_CHOICES.choices.map((choice: DeleteChoice) => {
        return choice.key;
      }),
    ).toEqual([
      WORKFLOWS_RUN_AS_INSTEAD_KEY,
      WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY,
    ]);
    expect(WORKFLOWS_RUN_AS_INSTEAD_KEY).toBe("workflowsRunAs");
    expect(WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY).toBe(
      "workflowsRunAsCustomRoleId",
    );
  });

  test("offers Default or another custom role, never Project Owner", () => {
    const runAs: DeleteChoice = choiceOf(WORKFLOWS_RUN_AS_INSTEAD_KEY);

    expect(runAs.values).toEqual([
      WorkflowRunAs.Default,
      WorkflowRunAs.CustomRole,
    ]);
    expect(runAs.values).not.toContain(WorkflowRunAs.ProjectOwner);
    expect(runAs.relatedTableName).toBeUndefined();
    expect(runAs.requiredWith).toBeUndefined();
  });

  test("names the other role by its ID, only with CustomRole and always with it", () => {
    const role: DeleteChoice = choiceOf(WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY);

    expect(role.values).toBeUndefined();
    expect(role.relatedTableName).toBe("CustomRole");
    expect(role.requiredWith).toEqual({
      key: WORKFLOWS_RUN_AS_INSTEAD_KEY,
      value: WorkflowRunAs.CustomRole,
    });
  });

  test("every value it offers is one the server takes", () => {
    const read: (
      misc: Record<string, string>,
    ) => WorkflowsRunAsInstead | null = (
      misc: Record<string, string>,
    ): WorkflowsRunAsInstead | null => {
      return WorkflowsOfDeletedRoles.readInstead(misc);
    };

    expect(read({ [WORKFLOWS_RUN_AS_INSTEAD_KEY]: "Default" })).toEqual({
      runAs: WorkflowRunAs.Default,
    });
    expect(
      read({
        [WORKFLOWS_RUN_AS_INSTEAD_KEY]: "CustomRole",
        [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: ROLE_ID,
      })?.customRoleId?.toString(),
    ).toBe(ROLE_ID);
  });

  test("and the server refuses what it does not offer", () => {
    for (const value of [WorkflowRunAs.ProjectOwner, "Admin", "default"]) {
      expect(() => {
        WorkflowsOfDeletedRoles.readInstead({
          [WORKFLOWS_RUN_AS_INSTEAD_KEY]: value,
        });
      }).toThrow(
        new BadDataException(WORKFLOWS_RUN_AS_INSTEAD_UNKNOWN_MESSAGE),
      );
    }

    // CustomRole needs the role it names.
    expect(() => {
      WorkflowsOfDeletedRoles.readInstead({
        [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.CustomRole,
      });
    }).toThrow(BadDataException);
  });

  test("its refusal names each choice as the API takes it: the provider's hint keys off it", () => {
    const refusal: string = getCustomRoleDeleteWorkflowsMessage({
      roleNames: ["Incident Responder"],
      workflowNames: ["Close stale incidents"],
      workflowCount: 1,
    });

    for (const choice of CUSTOM_ROLE_DELETE_CHOICES.choices) {
      expect(refusal).toContain(getDeleteChoiceApiName(choice.key));
    }
  });

  test("says when a delete needs it, in a sentence", () => {
    expect(CUSTOM_ROLE_DELETE_CHOICES.noun).toBe("custom role");
    expect(CUSTOM_ROLE_DELETE_CHOICES.whenNeeded).toBe(
      "OneUptime deletes a custom role that workflows run as only when the delete says what they run as instead, and refuses one that does not, naming the workflows.",
    );
  });
});

describe("how each client names and describes a choice", () => {
  test("its field is named for the delete, never as a column of the record", () => {
    expect(getDeleteChoiceFieldName("workflowsRunAs")).toBe(
      "workflowsRunAsOnDelete",
    );
    expect(getDeleteChoiceFieldName("workflowsRunAsCustomRoleId")).toBe(
      "workflowsRunAsCustomRoleIdOnDelete",
    );
    expect(getDeleteChoiceApiName("workflowsRunAs")).toBe(
      "miscDataProps.workflowsRunAs",
    );
  });

  test("a description names the other choice the way its reader does", () => {
    const tableChoices: DeleteChoicesOfTable = CUSTOM_ROLE_DELETE_CHOICES;
    const inTerraform: (key: string) => string = (key: string): string => {
      return `\`${key === WORKFLOWS_RUN_AS_INSTEAD_KEY ? "workflows_run_as_on_delete" : "workflows_run_as_custom_role_id_on_delete"}\``;
    };

    expect(tableChoices.choices[0]!.describe(getDeleteChoiceApiName)).toBe(
      'What the workflows that run as this custom role run as once it is deleted: "Default", the default permissions, or "CustomRole", another custom role you could give a team, named in miscDataProps.workflowsRunAsCustomRoleId. Never Project Owner: deleting a role never raises what a workflow can do.',
    );
    expect(tableChoices.choices[1]!.describe(inTerraform)).toBe(
      'The ID of the other custom role the workflows run as, when `workflows_run_as_on_delete` is "CustomRole": one you could give a team, and not the role being deleted.',
    );
  });

  test("every description is a sentence that ends in a full stop", () => {
    for (const choice of CUSTOM_ROLE_DELETE_CHOICES.choices) {
      const description: string = choice.describe(getDeleteChoiceApiName);

      expect(description).toMatch(/^[A-Z]/);
      expect(description.endsWith(".")).toBe(true);
    }
  });
});
