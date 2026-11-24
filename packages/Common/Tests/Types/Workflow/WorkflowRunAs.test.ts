import ObjectID from "../../../Types/ObjectID";
import {
  WORKFLOW_RUN_AS_AUDIT_COLUMNS,
  WORKFLOW_RUN_AS_GIVER_ONLY_MESSAGE,
  WORKFLOW_RUN_AS_OWNER_REFUSED_MESSAGE,
  WORKFLOW_RUN_AS_ROLE_DELETED_MESSAGE,
  WORKFLOW_RUN_AS_UNKNOWN_MESSAGE,
  WORKFLOW_RUN_AS_VALUES,
  WorkflowRunAs,
  describeWorkflowRunAs,
  describeWorkflowRunAsGiver,
  describeWorkflowRunAsHolders,
  findGlobalVariableReferences,
  getWorkflowRunAsAuditColumns,
  getWorkflowRunAsChangeRefusedMessage,
  getWorkflowRunAsChildRefusedMessage,
  getWorkflowRunAsGiverGoneMessage,
  getWorkflowRunAsGiverLeftMessage,
  getWorkflowRunAsGiverLostMessage,
  getWorkflowRunAsGiverOnlyRefusedMessage,
  getWorkflowRunAsGlobalVariablesRefusedMessage,
  getWorkflowRunAsKeyExpiredMessage,
  getWorkflowRunAsKeyGoneMessage,
  getWorkflowRunAsKeyLostMessage,
  getWorkflowRunAsRoleRefusedMessage,
  getWorkflowRunAsRunLogLine,
  getWorkflowRunAsRunRefusedMessage,
  getWorkflowRunAsVariableRefusedMessage,
  isRaisedWorkflowRunAs,
  readWorkflowRunAs,
} from "../../../Types/Workflow/WorkflowRunAs";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A WORKFLOW RUNS AS (#9695), as the server, the dashboard and the
 * tests read it: the values, how a stored one is read, and the words every
 * refusal says - each naming what the workflow runs as, why, and who can
 * put it right.
 */

describe("the values", () => {
  test("are Default, Project Owner and a custom role, Default first", () => {
    expect(WORKFLOW_RUN_AS_VALUES).toEqual([
      "Default",
      "ProjectOwner",
      "CustomRole",
    ]);
  });

  test("a stored one reads as itself", () => {
    for (const value of WORKFLOW_RUN_AS_VALUES) {
      expect(readWorkflowRunAs(value)).toBe(value);
    }
  });

  test("none at all reads as Default: every workflow from before Run As", () => {
    expect(readWorkflowRunAs(undefined)).toBe(WorkflowRunAs.Default);
    expect(readWorkflowRunAs(null)).toBe(WorkflowRunAs.Default);
    expect(readWorkflowRunAs("")).toBe(WorkflowRunAs.Default);
  });

  test("anything else cannot be read: not a lower-case spelling, not a role's name, not another type", () => {
    for (const value of [
      "projectowner",
      "PROJECTOWNER",
      "ProjectAdmin",
      "Owner",
      " Default",
      1,
      true,
      {},
      [],
    ]) {
      expect(readWorkflowRunAs(value)).toBeNull();
    }
  });

  test("raised is anything but Default, and one that cannot be read counts as raised", () => {
    expect(isRaisedWorkflowRunAs(WorkflowRunAs.Default)).toBe(false);
    expect(isRaisedWorkflowRunAs(undefined)).toBe(false);
    expect(isRaisedWorkflowRunAs(WorkflowRunAs.ProjectOwner)).toBe(true);
    expect(isRaisedWorkflowRunAs(WorkflowRunAs.CustomRole)).toBe(true);
    expect(isRaisedWorkflowRunAs("ProjectAdmin")).toBe(true);
  });

  test("the refusal for a value that is none of them lists them", () => {
    expect(WORKFLOW_RUN_AS_UNKNOWN_MESSAGE).toBe(
      "Run As is one of: Default, ProjectOwner, CustomRole.",
    );
  });
});

describe("what a workflow runs as, as a sentence names it", () => {
  test("Default, Project Owner and a custom role by its name", () => {
    expect(describeWorkflowRunAs({ runAs: WorkflowRunAs.Default })).toBe(
      "the default permissions",
    );
    expect(describeWorkflowRunAs({ runAs: WorkflowRunAs.ProjectOwner })).toBe(
      "Project Owner",
    );
    expect(
      describeWorkflowRunAs({
        runAs: WorkflowRunAs.CustomRole,
        customRoleName: "Team Provisioner",
      }),
    ).toBe('the custom role "Team Provisioner"');
    expect(describeWorkflowRunAs({ runAs: WorkflowRunAs.CustomRole })).toBe(
      "a custom role",
    );
  });

  test("who holds it", () => {
    expect(
      describeWorkflowRunAsHolders({ runAs: WorkflowRunAs.ProjectOwner }),
    ).toBe("Project Owners");
    expect(
      describeWorkflowRunAsHolders({
        runAs: WorkflowRunAs.CustomRole,
        customRoleName: "Team Provisioner",
      }),
    ).toBe('people who have every permission in "Team Provisioner"');
  });
});

describe("the refusals", () => {
  const owner: { runAs: WorkflowRunAs } = { runAs: WorkflowRunAs.ProjectOwner };
  const role: { runAs: WorkflowRunAs; customRoleName: string } = {
    runAs: WorkflowRunAs.CustomRole,
    customRoleName: "Team Provisioner",
  };

  test("a change by someone who doesn't hold it says who may, and that turning it off is still theirs", () => {
    expect(getWorkflowRunAsChangeRefusedMessage(owner)).toBe(
      "This workflow runs as Project Owner, so only Project Owners can change it. You can still turn it off.",
    );
    expect(getWorkflowRunAsChangeRefusedMessage(role)).toBe(
      'This workflow runs as the custom role "Team Provisioner", so only people who have every permission in "Team Provisioner" can change it. You can still turn it off.',
    );
  });

  test("a run by hand, and a variable, say the same of themselves", () => {
    expect(getWorkflowRunAsRunRefusedMessage(owner)).toBe(
      "This workflow runs as Project Owner, so only Project Owners can run it by hand.",
    );
    expect(getWorkflowRunAsVariableRefusedMessage(owner)).toBe(
      "This variable belongs to a workflow that runs as Project Owner, so only Project Owners can change it.",
    );
  });

  test("choosing it without holding it names what is missing", () => {
    expect(WORKFLOW_RUN_AS_OWNER_REFUSED_MESSAGE).toContain(
      "Only a Project Owner can let a workflow run as Project Owner.",
    );
    expect(
      getWorkflowRunAsRoleRefusedMessage({
        roleName: "Team Provisioner",
        permissionTitle: "Incident Admin",
      }),
    ).toBe(
      `You can't let this workflow run as "Team Provisioner": the role has Incident Admin, and your own access doesn't include that permission at the same or a broader scope.`,
    );
    expect(WORKFLOW_RUN_AS_GIVER_ONLY_MESSAGE).toBe(
      "Only a person, or one of this project's API keys, can choose what a workflow runs as, or change a workflow that runs with more than the default permissions, because the workflow runs with their permissions. A workflow's steps and the master API key can't.",
    );
    expect(
      getWorkflowRunAsGiverOnlyRefusedMessage(
        getWorkflowRunAsChangeRefusedMessage(owner),
      ),
    ).toBe(
      `This workflow runs as Project Owner, so only Project Owners can change it. You can still turn it off. ${WORKFLOW_RUN_AS_GIVER_ONLY_MESSAGE}`,
    );
  });

  test("a graph naming global variables names each, and what to use instead", () => {
    expect(
      getWorkflowRunAsGlobalVariablesRefusedMessage({
        choice: owner,
        variableNames: ["TEAM_ID", "", "SLACK_URL"],
      }),
    ).toBe(
      "A workflow that runs as Project Owner can't use the project's global variables ({{global.variables.TEAM_ID}}, {{global.variables.SLACK_URL}}), because anyone who can edit workflow variables can change them. Add the values it needs as this workflow's own variables and use {{local.variables...}} instead.",
    );
    // A graph that names them only as a whole lists none.
    expect(
      getWorkflowRunAsGlobalVariablesRefusedMessage({
        choice: owner,
        variableNames: [""],
      }),
    ).toContain("can't use the project's global variables, because");
  });

  test("a run that does not start says why, and who can give the permissions again", () => {
    expect(getWorkflowRunAsGiverGoneMessage(owner)).toBe(
      "This workflow didn't run: it runs as Project Owner, and the person who gave it those permissions is no longer in this project. One of the Project Owners needs to open the workflow's Settings and choose Run As again.",
    );
    expect(
      getWorkflowRunAsGiverLeftMessage({
        choice: owner,
        giverName: "Jane Doe",
      }),
    ).toBe(
      "This workflow didn't run: it runs as Project Owner, which Jane Doe gave it, and Jane Doe is no longer in this project. One of the Project Owners needs to open the workflow's Settings and choose Run As again.",
    );
    expect(
      getWorkflowRunAsGiverLostMessage({
        choice: owner,
        giverName: "Jane Doe",
        missingPermissionTitle: "Project Owner",
      }),
    ).toBe(
      "This workflow didn't run: it runs as Project Owner, which Jane Doe gave it, and Jane Doe is no longer a Project Owner of this project. One of the Project Owners needs to open the workflow's Settings and choose Run As again.",
    );
    expect(
      getWorkflowRunAsGiverLostMessage({
        choice: role,
        giverName: "Jane Doe",
        missingPermissionTitle: "Incident Admin",
      }),
    ).toBe(
      `This workflow didn't run: it runs as the custom role "Team Provisioner", which Jane Doe gave it, and Jane Doe can't give that role any more: it has Incident Admin, which Jane Doe's own access doesn't include. One of the people who have every permission in "Team Provisioner" needs to open the workflow's Settings and choose Run As again.`,
    );
    expect(
      getWorkflowRunAsGiverLostMessage({
        choice: owner,
        giverName: "Jane Doe",
      }),
    ).toContain("and Jane Doe's account is turned off.");
    expect(WORKFLOW_RUN_AS_ROLE_DELETED_MESSAGE).toContain(
      "the custom role it runs as was deleted",
    );
  });

  test("another workflow that may not start it is told which, and what would", () => {
    expect(
      getWorkflowRunAsChildRefusedMessage({
        childName: "Onboard teams",
        childChoice: owner,
      }),
    ).toBe(
      `"Onboard teams" runs as Project Owner, which this workflow's own permissions don't include, so this workflow can't start it. Start it from a workflow that runs with the same permissions or more.`,
    );
  });

  test("a raised run's log says what it runs as, and whose permissions", () => {
    expect(
      getWorkflowRunAsRunLogLine({ choice: role, giverName: "Jane Doe" }),
    ).toBe(
      'Running as the custom role "Team Provisioner", with the permissions Jane Doe gave this workflow.',
    );
    expect(
      getWorkflowRunAsRunLogLine({
        choice: owner,
        giverName: "Terraform",
        isGivenByApiKey: true,
      }),
    ).toBe(
      'Running as Project Owner, with the permissions the API key "Terraform" gave this workflow.',
    );
    expect(
      getWorkflowRunAsRunLogLine({
        choice: owner,
        giverName: "",
        isGivenByApiKey: true,
      }),
    ).toBe(
      "Running as Project Owner, with the permissions an API key gave this workflow.",
    );
    expect(getWorkflowRunAsRunLogLine({ choice: owner, giverName: "" })).toBe(
      "Running as Project Owner, with the permissions a person gave this workflow.",
    );
  });

  test("whoever gave them is named as a sentence names them: a person, or an API key", () => {
    expect(describeWorkflowRunAsGiver({ name: "Jane Doe" })).toBe("Jane Doe");
    expect(
      describeWorkflowRunAsGiver({ name: " Terraform ", isApiKey: true }),
    ).toBe('the API key "Terraform"');
    expect(describeWorkflowRunAsGiver({ name: null, isApiKey: true })).toBe(
      "an API key",
    );
  });

  test("a run an API key gave its permissions to, that does not start, says why: the key deleted, expired or narrowed", () => {
    expect(getWorkflowRunAsKeyGoneMessage(owner)).toBe(
      "This workflow didn't run: it runs as Project Owner, and the API key that gave it those permissions was deleted. One of the Project Owners needs to open the workflow's Settings and choose Run As again.",
    );
    expect(
      getWorkflowRunAsKeyExpiredMessage({ choice: role, keyName: "Terraform" }),
    ).toBe(
      `This workflow didn't run: it runs as the custom role "Team Provisioner", which the API key "Terraform" gave it, and that key has expired. One of the people who have every permission in "Team Provisioner" needs to open the workflow's Settings and choose Run As again.`,
    );
    expect(
      getWorkflowRunAsKeyLostMessage({
        choice: owner,
        keyName: "Terraform",
        missingPermissionTitle: "Project Owner",
      }),
    ).toBe(
      `This workflow didn't run: it runs as Project Owner, which the API key "Terraform" gave it, and that key no longer has Project Owner. One of the Project Owners needs to open the workflow's Settings and choose Run As again.`,
    );
    expect(
      getWorkflowRunAsKeyLostMessage({
        choice: role,
        keyName: "Terraform",
        missingPermissionTitle: "Incident Admin",
      }),
    ).toBe(
      `This workflow didn't run: it runs as the custom role "Team Provisioner", which the API key "Terraform" gave it, and that key can't give that role any more: it has Incident Admin, which the key's own permissions don't include. One of the people who have every permission in "Team Provisioner" needs to open the workflow's Settings and choose Run As again.`,
    );
  });

  test("every refusal is a sentence: a capital first, a full stop last", () => {
    const sentences: Array<string> = [
      getWorkflowRunAsChangeRefusedMessage(owner),
      getWorkflowRunAsRunRefusedMessage(role),
      getWorkflowRunAsVariableRefusedMessage(role),
      WORKFLOW_RUN_AS_OWNER_REFUSED_MESSAGE,
      WORKFLOW_RUN_AS_GIVER_ONLY_MESSAGE,
      WORKFLOW_RUN_AS_ROLE_DELETED_MESSAGE,
      WORKFLOW_RUN_AS_UNKNOWN_MESSAGE,
      getWorkflowRunAsGiverGoneMessage(role),
      getWorkflowRunAsChildRefusedMessage({ childChoice: role }),
      getWorkflowRunAsKeyGoneMessage(role),
      getWorkflowRunAsKeyExpiredMessage({ choice: owner, keyName: "K" }),
      getWorkflowRunAsKeyLostMessage({
        choice: role,
        keyName: "K",
        missingPermissionTitle: "Incident Admin",
      }),
    ];

    for (const sentence of sentences) {
      expect(sentence).toMatch(/^[A-Z"]/);
      expect(sentence).toMatch(/\.$/);
    }
  });
});

describe("the global variables a graph names", () => {
  test("by name, in the order first met, once each", () => {
    expect(
      findGlobalVariableReferences({
        nodes: [
          {
            data: {
              arguments: {
                url: "https://example.com/{{global.variables.BASE}}/teams",
                json: '{"teamId":"{{global.variables.TEAM_ID}}","x":"{{global.variables.BASE}}"}',
              },
            },
          },
        ],
      }),
    ).toEqual(["BASE", "TEAM_ID"]);
  });

  test("local variables and other references are no global variables", () => {
    expect(
      findGlobalVariableReferences({
        nodes: [
          {
            data: {
              arguments: {
                teamId: "{{local.variables.TEAM_ID}}",
                body: "{{local.components.webhook-1.returnValues.body}}",
              },
            },
          },
        ],
      }),
    ).toEqual([]);
  });

  test("named any other way - with spaces, as a whole, in a loop - is still found", () => {
    expect(
      findGlobalVariableReferences({
        a: "{{ global.variables.SPACED }}",
      }),
    ).toEqual(["SPACED"]);
    expect(findGlobalVariableReferences({ a: "{{global.variables}}" })).toEqual(
      [""],
    );
    expect(
      findGlobalVariableReferences({
        a: "{{#each global.variables.ITEMS}}{{this}}{{/each}}",
      }),
    ).toEqual(["ITEMS"]);
  });

  test("no graph names none", () => {
    expect(findGlobalVariableReferences(undefined)).toEqual([]);
    expect(findGlobalVariableReferences(null)).toEqual([]);
    expect(findGlobalVariableReferences({})).toEqual([]);
  });
});

describe("what a step ran as, for the audit log (#9766)", () => {
  const PERSON_ID: ObjectID = new ObjectID(
    "96660000-0000-4000-8000-0000000000a1",
  );
  const KEY_ID: ObjectID = new ObjectID("96660000-0000-4000-8000-0000000000b1");

  test("the columns, in the order the audit log and its export write them", () => {
    expect([...WORKFLOW_RUN_AS_AUDIT_COLUMNS]).toEqual([
      "workflowRunAs",
      "workflowRunAsCustomRoleName",
      "workflowRunAsGiverUserId",
      "workflowRunAsGiverApiKeyId",
      "workflowRunAsGiverName",
    ]);
  });

  test("Default says only that: nobody's permissions, and no role", () => {
    expect(
      getWorkflowRunAsAuditColumns({
        runAs: WorkflowRunAs.Default,
        customRoleName: "Ignored",
        givenByUserId: PERSON_ID,
        givenByName: "Jane Doe",
      }),
    ).toEqual({ workflowRunAs: WorkflowRunAs.Default });
  });

  test("Project Owner, with the person who gave it", () => {
    expect(
      getWorkflowRunAsAuditColumns({
        runAs: WorkflowRunAs.ProjectOwner,
        customRoleName: "Ignored",
        givenByUserId: PERSON_ID,
        givenByName: " Jane Doe ",
      }),
    ).toEqual({
      workflowRunAs: WorkflowRunAs.ProjectOwner,
      workflowRunAsGiverUserId: PERSON_ID,
      workflowRunAsGiverName: "Jane Doe",
    });
  });

  test("a custom role by its name, with the API key that gave it, a key winning over a person", () => {
    expect(
      getWorkflowRunAsAuditColumns({
        runAs: WorkflowRunAs.CustomRole,
        customRoleName: "Team Provisioner",
        givenByUserId: PERSON_ID,
        givenByApiKeyId: KEY_ID,
        givenByName: "Terraform",
      }),
    ).toEqual({
      workflowRunAs: WorkflowRunAs.CustomRole,
      workflowRunAsCustomRoleName: "Team Provisioner",
      workflowRunAsGiverApiKeyId: KEY_ID,
      workflowRunAsGiverName: "Terraform",
    });
  });

  test("none for nothing, or for a Run As that is none of the values; blank names left out", () => {
    expect(getWorkflowRunAsAuditColumns(undefined)).toBeNull();
    expect(getWorkflowRunAsAuditColumns(null)).toBeNull();
    expect(
      getWorkflowRunAsAuditColumns({
        runAs: "Root" as unknown as WorkflowRunAs,
      }),
    ).toBeNull();
    expect(
      getWorkflowRunAsAuditColumns({
        runAs: WorkflowRunAs.CustomRole,
        customRoleName: "  ",
        givenByName: "",
      }),
    ).toEqual({ workflowRunAs: WorkflowRunAs.CustomRole });
  });
});
