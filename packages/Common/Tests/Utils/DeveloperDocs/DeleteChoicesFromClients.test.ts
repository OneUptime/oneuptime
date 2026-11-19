import { describe, expect, test } from "@jest/globals";
import WorkflowsOfDeletedRoles from "../../../Server/Utils/Workflow/WorkflowsOfDeletedRoles";
import { JSONObject } from "../../../Types/JSON";
import {
  getCustomRoleDeleteWorkflowEditRefusedMessage,
  getCustomRoleDeleteWorkflowsMessage,
  WORKFLOWS_RUN_AS_INSTEAD_KEY,
  WORKFLOWS_RUN_AS_INSTEAD_ROLE_DELETED_MESSAGE,
  WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY,
  WorkflowRunAs,
} from "../../../Types/Workflow/WorkflowRunAs";
import {
  CUSTOM_ROLE_DELETE_CHOICES,
  DeleteChoice,
  DeleteChoiceError,
  DeleteChoiceWay,
  getDeleteChoiceWays,
  isRefusedForDeleteChoices,
  readDeleteChoices,
} from "../../../Utils/DeveloperDocs/DeleteChoices";

/*
 * A DELETE'S CHOICES AS A CLIENT IS GIVEN THEM (#9949).
 *
 * The CLI's flags and the MCP server's delete tool take what the
 * workflows that run as a deleted custom role run as instead, as a person
 * or an agent writes it, and send it as the API takes it. Both read it with
 * readDeleteChoices: what it sends is what the server reads
 * (WorkflowsOfDeletedRoles.readInstead), what the server would refuse is
 * refused before anything is sent, in the client's own names for the
 * choices, and a delete given none sends none, as it always did.
 */

const ROLE_ID: string = "5a0e0000-0000-4000-8000-0000000000aa";
const OTHER_ROLE_ID: string = "5a0e0000-0000-4000-8000-0000000000bb";

// The CLI's names for the choices, and the MCP server's.
const FLAGS: Record<string, string> = {
  [WORKFLOWS_RUN_AS_INSTEAD_KEY]: "--workflows-run-as",
  [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: "--workflows-run-as-custom-role-id",
};

function flagOf(key: string): string {
  return FLAGS[key] || key;
}

function inputOf(key: string): string {
  return key;
}

function read(
  given: Record<string, unknown>,
  nameOf: (key: string) => string = flagOf,
  tableName: string = "CustomRole",
): JSONObject {
  return readDeleteChoices({
    tableName,
    given,
    deletedId: ROLE_ID,
    nameOf,
  });
}

// The words a reading is refused with, or null when it is not refused.
function refusal(
  given: Record<string, unknown>,
  nameOf: (key: string) => string = flagOf,
): string | null {
  try {
    read(given, nameOf);
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(DeleteChoiceError);
    return (error as Error).message;
  }
}

describe("a delete given no choice", () => {
  test("sends none, so it is the delete it always was", () => {
    expect(read({})).toEqual({});
    expect(
      read({
        [WORKFLOWS_RUN_AS_INSTEAD_KEY]: undefined,
        [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: null,
      }),
    ).toEqual({});
    expect(
      read({
        [WORKFLOWS_RUN_AS_INSTEAD_KEY]: "",
        [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: "   ",
      }),
    ).toEqual({});
  });

  test("a table whose delete takes no choices reads none, whatever it is given", () => {
    for (const tableName of ["Team", "Workflow", "", "Incident"]) {
      expect(
        read(
          {
            id: ROLE_ID,
            [WORKFLOWS_RUN_AS_INSTEAD_KEY]: "ProjectOwner",
            [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: "not an id",
          },
          flagOf,
          tableName,
        ),
      ).toEqual({});
    }
  });

  test("what else a tool is given beside the choices is not one of them", () => {
    expect(read({ id: ROLE_ID, select: ["name"] })).toEqual({});
  });
});

describe("Default", () => {
  test.each([["Default"], ["default"], ["DEFAULT"], ["  Default  "]])(
    "%p is sent as the API takes it",
    (written: string) => {
      expect(read({ [WORKFLOWS_RUN_AS_INSTEAD_KEY]: written })).toEqual({
        [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.Default,
      });
    },
  );
});

describe("another custom role", () => {
  test.each([
    ["CustomRole"],
    ["customrole"],
    ["custom-role"],
    ["custom_role"],
    ["Custom Role"],
    ["CUSTOM-ROLE"],
  ])(
    "%p is sent as the API takes it, with the role's ID",
    (written: string) => {
      expect(
        read({
          [WORKFLOWS_RUN_AS_INSTEAD_KEY]: written,
          [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: OTHER_ROLE_ID,
        }),
      ).toEqual({
        [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.CustomRole,
        [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: OTHER_ROLE_ID,
      });
    },
  );

  test("the ID is sent without the spaces around it", () => {
    expect(
      read({
        [WORKFLOWS_RUN_AS_INSTEAD_KEY]: "CustomRole",
        [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: `  ${OTHER_ROLE_ID}\n`,
      })[WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY],
    ).toBe(OTHER_ROLE_ID);
  });
});

describe("what is sent is what the server reads", () => {
  test("each way of saying it, read back by the server, is what was meant", () => {
    expect(
      WorkflowsOfDeletedRoles.readInstead(
        read({ [WORKFLOWS_RUN_AS_INSTEAD_KEY]: "default" }),
      ),
    ).toEqual({ runAs: WorkflowRunAs.Default });

    expect(
      WorkflowsOfDeletedRoles.readInstead(
        read({
          [WORKFLOWS_RUN_AS_INSTEAD_KEY]: "custom-role",
          [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: OTHER_ROLE_ID,
        }),
      )?.customRoleId?.toString(),
    ).toBe(OTHER_ROLE_ID);

    // Nothing sent: the server asks for it, naming the workflows.
    expect(WorkflowsOfDeletedRoles.readInstead(read({}))).toBeNull();
  });
});

describe("Project Owner", () => {
  test.each([
    ["ProjectOwner"],
    ["projectowner"],
    ["project-owner"],
    ["Project Owner"],
    ["PROJECT_OWNER"],
  ])("%p is refused before anything is sent, saying why", (written: string) => {
    expect(refusal({ [WORKFLOWS_RUN_AS_INSTEAD_KEY]: written })).toBe(
      `--workflows-run-as can't be ${JSON.stringify(written)}: deleting a role never raises what a workflow can do. Choose "Default", or "CustomRole" with --workflows-run-as-custom-role-id.`,
    );
  });

  test("is refused in the MCP tool's names too", () => {
    expect(
      refusal({ [WORKFLOWS_RUN_AS_INSTEAD_KEY]: "ProjectOwner" }, inputOf),
    ).toBe(
      'workflowsRunAs can\'t be "ProjectOwner": deleting a role never raises what a workflow can do. Choose "Default", or "CustomRole" with workflowsRunAsCustomRoleId.',
    );
  });

  test("is refused before a role ID given with it is looked at", () => {
    expect(
      refusal({
        [WORKFLOWS_RUN_AS_INSTEAD_KEY]: "ProjectOwner",
        [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: OTHER_ROLE_ID,
      }),
    ).toContain("deleting a role never raises what a workflow can do");
  });

  test("is the value the choice refuses, with the words its description says", () => {
    const runAs: DeleteChoice = CUSTOM_ROLE_DELETE_CHOICES.choices[0]!;

    expect(runAs.refusedValues).toEqual([
      {
        value: WorkflowRunAs.ProjectOwner,
        reason: "deleting a role never raises what a workflow can do",
      },
    ]);
    expect(runAs.describe(flagOf)).toContain(
      "Never Project Owner: deleting a role never raises what a workflow can do.",
    );
  });

  test("the server refuses it too, whatever a client sends", () => {
    expect(() => {
      WorkflowsOfDeletedRoles.readInstead({
        [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.ProjectOwner,
      });
    }).toThrow();
  });
});

describe("a value it does not take", () => {
  test.each([["Admin"], ["None"], ["Owner"], ["Default Role"], ["--"]])(
    "%p says which values it takes",
    (written: string) => {
      expect(refusal({ [WORKFLOWS_RUN_AS_INSTEAD_KEY]: written })).toBe(
        `--workflows-run-as takes "Default" or "CustomRole", and ${JSON.stringify(written)} is neither.`,
      );
    },
  );

  test.each([
    [5, "5"],
    [true, "true"],
    [{ runAs: "Default" }, '{"runAs":"Default"}'],
    [["Default"], '["Default"]'],
  ])("a value that is not text, %p, too", (written: unknown, shown: string) => {
    expect(refusal({ [WORKFLOWS_RUN_AS_INSTEAD_KEY]: written }, inputOf)).toBe(
      `workflowsRunAs takes "Default" or "CustomRole", and ${shown} is neither.`,
    );
  });
});

describe("the other custom role's ID", () => {
  test.each([["admin"], ["5a0e0000"], ["not-a-uuid-at-all"]])(
    "%p is not an ID",
    (written: string) => {
      expect(
        refusal({
          [WORKFLOWS_RUN_AS_INSTEAD_KEY]: "CustomRole",
          [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: written,
        }),
      ).toBe(
        `--workflows-run-as-custom-role-id takes an ID, such as 6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11, and ${JSON.stringify(written)} is not one.`,
      );
    },
  );

  test("a number is not an ID either", () => {
    expect(
      refusal(
        {
          [WORKFLOWS_RUN_AS_INSTEAD_KEY]: "CustomRole",
          [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: 42,
        },
        inputOf,
      ),
    ).toBe(
      "workflowsRunAsCustomRoleId takes an ID, such as 6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11, and 42 is not one.",
    );
  });

  test("can't be the role being deleted, however its ID is written", () => {
    for (const written of [ROLE_ID, ROLE_ID.toUpperCase(), ` ${ROLE_ID} `]) {
      expect(
        refusal({
          [WORKFLOWS_RUN_AS_INSTEAD_KEY]: "CustomRole",
          [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: written,
        }),
      ).toBe(
        '--workflows-run-as-custom-role-id names the custom role being deleted. Name another custom role, or set --workflows-run-as to "Default".',
      );
    }
  });

  test("the server would refuse the role being deleted too", () => {
    expect(WORKFLOWS_RUN_AS_INSTEAD_ROLE_DELETED_MESSAGE).toBe(
      "The workflows can't run as a custom role that is being deleted. Choose Default or another custom role.",
    );
  });

  test("is not the deleted role when the client does not say which role it deletes", () => {
    expect(
      readDeleteChoices({
        tableName: "CustomRole",
        given: {
          [WORKFLOWS_RUN_AS_INSTEAD_KEY]: "CustomRole",
          [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: ROLE_ID,
        },
        nameOf: flagOf,
      }),
    ).toEqual({
      [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.CustomRole,
      [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: ROLE_ID,
    });
  });
});

describe("the two choices go together", () => {
  test("the role's ID only with CustomRole", () => {
    expect(
      refusal({
        [WORKFLOWS_RUN_AS_INSTEAD_KEY]: "Default",
        [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: OTHER_ROLE_ID,
      }),
    ).toBe(
      '--workflows-run-as-custom-role-id goes with --workflows-run-as set to "CustomRole", and --workflows-run-as is "Default". Set --workflows-run-as to "CustomRole", or leave --workflows-run-as-custom-role-id out.',
    );
  });

  test("the role's ID alone is refused, saying what it goes with", () => {
    expect(
      refusal({ [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: OTHER_ROLE_ID }, inputOf),
    ).toBe(
      'workflowsRunAsCustomRoleId goes with workflowsRunAs set to "CustomRole", and workflowsRunAs isn\'t given. Set workflowsRunAs to "CustomRole", or leave workflowsRunAsCustomRoleId out.',
    );
  });

  test("CustomRole needs the role's ID", () => {
    expect(refusal({ [WORKFLOWS_RUN_AS_INSTEAD_KEY]: "custom-role" })).toBe(
      '--workflows-run-as is "CustomRole", which needs --workflows-run-as-custom-role-id too. Add --workflows-run-as-custom-role-id, or set --workflows-run-as to "Default".',
    );
    expect(
      refusal({
        [WORKFLOWS_RUN_AS_INSTEAD_KEY]: "CustomRole",
        [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: "  ",
      }),
    ).toContain("which needs --workflows-run-as-custom-role-id too");
  });

  test("every refusal is a whole sentence that names nothing it was not given a name for", () => {
    const refusals: Array<string | null> = [
      refusal({ [WORKFLOWS_RUN_AS_INSTEAD_KEY]: "ProjectOwner" }),
      refusal({ [WORKFLOWS_RUN_AS_INSTEAD_KEY]: "Admin" }),
      refusal({ [WORKFLOWS_RUN_AS_INSTEAD_KEY]: "CustomRole" }),
      refusal({ [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: OTHER_ROLE_ID }),
      refusal({
        [WORKFLOWS_RUN_AS_INSTEAD_KEY]: "CustomRole",
        [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: "x",
      }),
      refusal({
        [WORKFLOWS_RUN_AS_INSTEAD_KEY]: "CustomRole",
        [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: ROLE_ID,
      }),
    ];

    for (const message of refusals) {
      expect(message).not.toBeNull();
      expect(message!.endsWith(".")).toBe(true);
      expect(message).not.toMatch(/undefined|null|miscDataProps/);
      // The keys are named only as the client names them.
      expect(message).not.toMatch(/\bworkflowsRunAs\b/);
    }
  });
});

describe("a delete OneUptime refused for the choices it needs", () => {
  const refused: string = getCustomRoleDeleteWorkflowsMessage({
    roleNames: ["Incident Responder"],
    workflowNames: ["Close stale incidents"],
    workflowCount: 1,
  });

  test("is one that sent none, refused in words that name a choice as the API takes it", () => {
    expect(
      isRefusedForDeleteChoices({
        tableName: "CustomRole",
        refusal: refused,
        sent: {},
      }),
    ).toBe(true);
    expect(
      isRefusedForDeleteChoices({
        tableName: "CustomRole",
        refusal: `API error (400): ${refused}`,
        sent: undefined,
      }),
    ).toBe(true);
    expect(
      isRefusedForDeleteChoices({
        tableName: "CustomRole",
        refusal: `API request failed: 400 - ${refused}`,
        sent: null,
      }),
    ).toBe(true);
  });

  test("a delete that sent a choice was refused for what the refusal says", () => {
    expect(
      isRefusedForDeleteChoices({
        tableName: "CustomRole",
        refusal: refused,
        sent: { [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.Default },
      }),
    ).toBe(false);
  });

  test("another refusal is not about them", () => {
    for (const other of [
      WORKFLOWS_RUN_AS_INSTEAD_ROLE_DELETED_MESSAGE,
      getCustomRoleDeleteWorkflowEditRefusedMessage({
        workflowName: "Close stale incidents",
      }),
      "Custom Role not found.",
    ]) {
      expect(
        isRefusedForDeleteChoices({
          tableName: "CustomRole",
          refusal: other,
          sent: {},
        }),
      ).toBe(false);
    }
  });

  test("a table whose delete takes no choices is never refused for them", () => {
    expect(
      isRefusedForDeleteChoices({
        tableName: "Team",
        refusal: refused,
        sent: {},
      }),
    ).toBe(false);
  });
});

describe("the ways to say what a delete needs", () => {
  test("a custom role's: Default, or CustomRole with the other role's ID", () => {
    const ways: Array<DeleteChoiceWay> = getDeleteChoiceWays("CustomRole");

    expect(
      ways.map((way: DeleteChoiceWay) => {
        return {
          key: way.key,
          value: way.value,
          with: way.with.map((choice: DeleteChoice): string => {
            return choice.key;
          }),
        };
      }),
    ).toEqual([
      {
        key: WORKFLOWS_RUN_AS_INSTEAD_KEY,
        value: WorkflowRunAs.Default,
        with: [],
      },
      {
        key: WORKFLOWS_RUN_AS_INSTEAD_KEY,
        value: WorkflowRunAs.CustomRole,
        with: [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY],
      },
    ]);
  });

  test("each way, given to the reader, is a delete the server takes", () => {
    for (const way of getDeleteChoiceWays("CustomRole")) {
      const given: Record<string, unknown> = { [way.key]: way.value };

      for (const companion of way.with) {
        given[companion.key] = OTHER_ROLE_ID;
      }

      expect(WorkflowsOfDeletedRoles.readInstead(read(given))).not.toBeNull();
    }
  });

  test("a table whose delete takes no choices has none", () => {
    for (const tableName of ["Team", "", null, undefined]) {
      expect(getDeleteChoiceWays(tableName)).toEqual([]);
    }
  });
});
