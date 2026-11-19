import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";

/*
 * WHAT A WORKFLOW RUNS AS (#9695).
 *
 * A workflow's steps act in its project as no person
 * (Server/Utils/Workflow/WorkflowPrincipal). What they may do there is the
 * workflow's Run As:
 *
 *   - Default, which every workflow has unless a person chose otherwise: a
 *     Project Admin's permissions, except that a step never changes who has
 *     access to the project, never reads a setting that holds credentials
 *     and never sees a private incident, alert or episode. Whoever may build
 *     a workflow - a Project Member, a Workflow Admin - may build one of
 *     these, as they always could.
 *   - Project Owner: what a Project Owner may do. Its steps may also give
 *     teams permissions and roles, and change who is on a team, held to the
 *     grant ceiling a Project Owner meets.
 *   - Custom Role: exactly what one of the project's custom roles allows -
 *     less than the default, or more, or anything between. Its steps may
 *     change teams and roles only as far as the role lets them, and hand on
 *     only what the role holds.
 *
 * Anything but Default is RAISED, and a raised workflow is held to one rule:
 * its permissions come from someone who holds them - a person, or one of
 * the project's API keys (#9765) - and only such a one changes what it does.
 *
 *   - Only a person or a project API key gives a workflow raised
 *     permissions, and only ones it could give a team itself
 *     (WorkflowRunAsAuthority): a key's own permissions are its ceiling, as
 *     a person's are theirs. They are recorded as having given them.
 *   - Only a person or a key who holds them may change a raised workflow -
 *     its steps, its own variables, its Run As - delete it, archive it, run
 *     it by hand or see the keys that start it. Anyone who may edit it may
 *     turn it off. Whoever saves a change to its steps, its variables or its
 *     Run As gives it its permissions anew: the workflow runs with them only
 *     while they still hold them.
 *   - Every run checks that whoever gave them still does. If the person left
 *     the project or lost the permissions, or the key was deleted, expired
 *     or narrowed, the run does not start.
 *   - A raised workflow reads only its own variables: anyone who may edit
 *     workflow variables may change the project's global ones.
 *   - Another workflow starts a raised one only if its own permissions
 *     include the raised one's.
 *
 * Kept free of server and React code, so the server, the dashboard and the
 * tests read the same values and words.
 */
export enum WorkflowRunAs {
  Default = "Default",
  ProjectOwner = "ProjectOwner",
  CustomRole = "CustomRole",
}

export const WORKFLOW_RUN_AS_VALUES: ReadonlyArray<string> =
  Object.values(WorkflowRunAs);

/*
 * A Run As as stored: the value, or Default for a row with none (a workflow
 * from before Run As existed, or one created without it). Null for a value
 * that is not one of WorkflowRunAs - never written, since the column only
 * takes those, and treated as no Run As anyone may rely on.
 */
export const readWorkflowRunAs: (value: unknown) => WorkflowRunAs | null = (
  value: unknown,
): WorkflowRunAs | null => {
  if (value === undefined || value === null || value === "") {
    return WorkflowRunAs.Default;
  }

  if (
    typeof value === "string" &&
    (WORKFLOW_RUN_AS_VALUES as ReadonlyArray<string>).includes(value)
  ) {
    return value as WorkflowRunAs;
  }

  return null;
};

/*
 * Whether a Run As is raised: anything but Default. A value that cannot be
 * read counts as raised, so nothing that reads it lets it pass as Default.
 */
export const isRaisedWorkflowRunAs: (value: unknown) => boolean = (
  value: unknown,
): boolean => {
  return readWorkflowRunAs(value) !== WorkflowRunAs.Default;
};

// A workflow's Run As, with the custom role's name where it has one.
export interface WorkflowRunAsChoice {
  runAs: WorkflowRunAs;
  customRoleName?: string | null | undefined;
}

// What a workflow runs as, as a sentence names it: "Project Owner".
export const describeWorkflowRunAs: (choice: WorkflowRunAsChoice) => string = (
  choice: WorkflowRunAsChoice,
): string => {
  switch (choice.runAs) {
    case WorkflowRunAs.ProjectOwner:
      return "Project Owner";
    case WorkflowRunAs.CustomRole:
      return choice.customRoleName
        ? `the custom role "${choice.customRoleName}"`
        : "a custom role";
    default:
      return "the default permissions";
  }
};

/*
 * Who holds what a raised workflow runs as, as a sentence names them: who
 * may change it, run it by hand, or give it its permissions again.
 */
export const describeWorkflowRunAsHolders: (
  choice: WorkflowRunAsChoice,
) => string = (choice: WorkflowRunAsChoice): string => {
  if (choice.runAs === WorkflowRunAs.CustomRole) {
    return choice.customRoleName
      ? `people who have every permission in "${choice.customRoleName}"`
      : "people who have every permission in its custom role";
  }

  return "Project Owners";
};

/*
 * THE WORDS. Each says what happened, why, and what to do next, and names
 * the permissions it is about.
 */

// A raised workflow changed, deleted or archived by someone who may not.
export const getWorkflowRunAsChangeRefusedMessage: (
  choice: WorkflowRunAsChoice,
) => string = (choice: WorkflowRunAsChoice): string => {
  return `This workflow runs as ${describeWorkflowRunAs(choice)}, so only ${describeWorkflowRunAsHolders(choice)} can change it. You can still turn it off.`;
};

// A raised workflow run by hand - the whole of it or one step - by someone who may not.
export const getWorkflowRunAsRunRefusedMessage: (
  choice: WorkflowRunAsChoice,
) => string = (choice: WorkflowRunAsChoice): string => {
  return `This workflow runs as ${describeWorkflowRunAs(choice)}, so only ${describeWorkflowRunAsHolders(choice)} can run it by hand.`;
};

// A variable of a raised workflow written by someone who may not change the workflow.
export const getWorkflowRunAsVariableRefusedMessage: (
  choice: WorkflowRunAsChoice,
) => string = (choice: WorkflowRunAsChoice): string => {
  return `This variable belongs to a workflow that runs as ${describeWorkflowRunAs(choice)}, so only ${describeWorkflowRunAsHolders(choice)} can change it.`;
};

/*
 * Raised permissions given, or a raised workflow changed, by something that
 * is neither a person nor one of the project's API keys: a workflow's step,
 * the server's master API key, or OneUptime acting for nobody in particular.
 * Their permissions in the project can't be read again as each run starts.
 */
export const WORKFLOW_RUN_AS_GIVER_ONLY_MESSAGE: string =
  "Only a person, or one of this project's API keys, can choose what a workflow runs as, or change a workflow that runs with more than the default permissions, because the workflow runs with their permissions. A workflow's steps and the master API key can't.";

/*
 * A raised workflow acted on by something that may not give it its
 * permissions (WORKFLOW_RUN_AS_GIVER_ONLY_MESSAGE): the refusal for the act,
 * and why.
 */
export const getWorkflowRunAsGiverOnlyRefusedMessage: (
  refusal: string,
) => string = (refusal: string): string => {
  return `${refusal} ${WORKFLOW_RUN_AS_GIVER_ONLY_MESSAGE}`;
};

/*
 * WHO GAVE A RAISED WORKFLOW ITS PERMISSIONS (#9765): a person, by their
 * name, or one of the project's API keys.
 */
export interface WorkflowRunAsGiverName {
  // The person's name (or email), or the key's name.
  name?: string | null | undefined;
  isApiKey?: boolean | undefined;
}

// Who gave them, as a sentence names them: Jane Doe, or the API key "Terraform".
export const describeWorkflowRunAsGiver: (
  giver: WorkflowRunAsGiverName,
) => string = (giver: WorkflowRunAsGiverName): string => {
  const name: string = (giver.name || "").trim();

  if (giver.isApiKey) {
    return name ? `the API key "${name}"` : "an API key";
  }

  return name || "a person";
};

// Run As Project Owner chosen by someone who is not one.
export const WORKFLOW_RUN_AS_OWNER_REFUSED_MESSAGE: string =
  "Only a Project Owner can let a workflow run as Project Owner. Ask a Project Owner to choose it.";

// Run As a custom role chosen by someone who could not give a team that role.
export const getWorkflowRunAsRoleRefusedMessage: (data: {
  roleName: string;
  // The role's permission the person does not hold, by its title.
  permissionTitle: string;
}) => string = (data: {
  roleName: string;
  permissionTitle: string;
}): string => {
  return `You can't let this workflow run as "${data.roleName}": the role has ${data.permissionTitle}, and your own access doesn't include that permission at the same or a broader scope.`;
};

// Run As Custom Role with no role.
export const WORKFLOW_RUN_AS_ROLE_MISSING_MESSAGE: string =
  "Pick the custom role this workflow runs as.";

// A custom role that is not one of the project's.
export const WORKFLOW_RUN_AS_ROLE_NOT_FOUND_MESSAGE: string =
  "That custom role isn't one of this project's. Pick one of the project's custom roles.";

// A Run As that is not one of WorkflowRunAs.
export const WORKFLOW_RUN_AS_UNKNOWN_MESSAGE: string = `Run As is one of: ${WORKFLOW_RUN_AS_VALUES.join(", ")}.`;

/*
 * A raised workflow whose steps name the project's global variables, which
 * anyone who may edit workflow variables may change.
 */
export const getWorkflowRunAsGlobalVariablesRefusedMessage: (data: {
  choice: WorkflowRunAsChoice;
  variableNames: ReadonlyArray<string>;
}) => string = (data: {
  choice: WorkflowRunAsChoice;
  variableNames: ReadonlyArray<string>;
}): string => {
  // A graph that names them other than one by one names no variable here.
  const names: Array<string> = data.variableNames.filter(
    (name: string): boolean => {
      return Boolean(name);
    },
  );
  const named: string =
    names.length > 0
      ? ` (${names
          .map((name: string): string => {
            return `{{global.variables.${name}}}`;
          })
          .join(", ")})`
      : "";

  return `A workflow that runs as ${describeWorkflowRunAs(data.choice)} can't use the project's global variables${named}, because anyone who can edit workflow variables can change them. Add the values it needs as this workflow's own variables and use {{local.variables...}} instead.`;
};

/*
 * WHY A RUN OF A RAISED WORKFLOW DID NOT START. Each ends with what to do:
 * someone who holds the permissions gives them again, which makes them the
 * person the workflow runs for.
 */
const giveAgain: (choice: WorkflowRunAsChoice) => string = (
  choice: WorkflowRunAsChoice,
): string => {
  return `One of the ${describeWorkflowRunAsHolders(choice)} needs to open the workflow's Settings and choose Run As again.`;
};

// Nobody is recorded as having given the permissions, or they left OneUptime.
export const getWorkflowRunAsGiverGoneMessage: (
  choice: WorkflowRunAsChoice,
) => string = (choice: WorkflowRunAsChoice): string => {
  return `This workflow didn't run: it runs as ${describeWorkflowRunAs(choice)}, and the person who gave it those permissions is no longer in this project. ${giveAgain(choice)}`;
};

// The person who gave them is no longer a member of the project.
export const getWorkflowRunAsGiverLeftMessage: (data: {
  choice: WorkflowRunAsChoice;
  giverName: string;
}) => string = (data: {
  choice: WorkflowRunAsChoice;
  giverName: string;
}): string => {
  return `This workflow didn't run: it runs as ${describeWorkflowRunAs(data.choice)}, which ${data.giverName} gave it, and ${data.giverName} is no longer in this project. ${giveAgain(data.choice)}`;
};

/*
 * The person who gave them could not give them now: they lost the
 * permission, the custom role holds one they don't, or their account is
 * turned off.
 */
export const getWorkflowRunAsGiverLostMessage: (data: {
  choice: WorkflowRunAsChoice;
  giverName: string;
  // The permission their own access lacks, by its title; none for a turned-off account.
  missingPermissionTitle?: string | undefined;
}) => string = (data: {
  choice: WorkflowRunAsChoice;
  giverName: string;
  missingPermissionTitle?: string | undefined;
}): string => {
  const what: string = describeWorkflowRunAs(data.choice);
  const name: string = data.giverName;

  let why: string = `${name}'s account is turned off`;

  if (data.missingPermissionTitle) {
    why =
      data.choice.runAs === WorkflowRunAs.CustomRole
        ? `${name} can't give that role any more: it has ${data.missingPermissionTitle}, which ${name}'s own access doesn't include`
        : `${name} is no longer a Project Owner of this project`;
  }

  return `This workflow didn't run: it runs as ${what}, which ${name} gave it, and ${why}. ${giveAgain(data.choice)}`;
};

/*
 * THE SAME, WHEN AN API KEY GAVE THEM (#9765): every run reads the key
 * again, as it is in the project now.
 */

// The key that gave them was deleted, or is no longer one of the project's.
export const getWorkflowRunAsKeyGoneMessage: (
  choice: WorkflowRunAsChoice,
) => string = (choice: WorkflowRunAsChoice): string => {
  return `This workflow didn't run: it runs as ${describeWorkflowRunAs(choice)}, and the API key that gave it those permissions was deleted. ${giveAgain(choice)}`;
};

// The key that gave them has expired.
export const getWorkflowRunAsKeyExpiredMessage: (data: {
  choice: WorkflowRunAsChoice;
  keyName: string;
}) => string = (data: {
  choice: WorkflowRunAsChoice;
  keyName: string;
}): string => {
  return `This workflow didn't run: it runs as ${describeWorkflowRunAs(data.choice)}, which ${describeWorkflowRunAsGiver({ name: data.keyName, isApiKey: true })} gave it, and that key has expired. ${giveAgain(data.choice)}`;
};

/*
 * The key could not give them now: its permissions were narrowed, or the
 * custom role holds one it doesn't.
 */
export const getWorkflowRunAsKeyLostMessage: (data: {
  choice: WorkflowRunAsChoice;
  keyName: string;
  // The permission the key's own permissions lack, by its title.
  missingPermissionTitle: string;
}) => string = (data: {
  choice: WorkflowRunAsChoice;
  keyName: string;
  missingPermissionTitle: string;
}): string => {
  const why: string =
    data.choice.runAs === WorkflowRunAs.CustomRole
      ? `that key can't give that role any more: it has ${data.missingPermissionTitle}, which the key's own permissions don't include`
      : "that key no longer has Project Owner";

  return `This workflow didn't run: it runs as ${describeWorkflowRunAs(data.choice)}, which ${describeWorkflowRunAsGiver({ name: data.keyName, isApiKey: true })} gave it, and ${why}. ${giveAgain(data.choice)}`;
};

// The custom role it runs as was deleted.
export const WORKFLOW_RUN_AS_ROLE_DELETED_MESSAGE: string =
  "This workflow didn't run: the custom role it runs as was deleted. Open the workflow's Settings and choose what it runs as.";

// A Run As that cannot be read.
export const WORKFLOW_RUN_AS_UNREADABLE_MESSAGE: string =
  "This workflow didn't run: what it runs as can't be read. Open the workflow's Settings and choose what it runs as.";

// Another workflow's Run Workflow step, starting a raised workflow it may not.
export const getWorkflowRunAsChildRefusedMessage: (data: {
  childName?: string | undefined;
  childChoice: WorkflowRunAsChoice;
}) => string = (data: {
  childName?: string | undefined;
  childChoice: WorkflowRunAsChoice;
}): string => {
  const child: string = data.childName
    ? `"${data.childName}"`
    : "The workflow this step starts";

  return `${child} runs as ${describeWorkflowRunAs(data.childChoice)}, which this workflow's own permissions don't include, so this workflow can't start it. Start it from a workflow that runs with the same permissions or more.`;
};

/*
 * The first line of a raised run's log: what it runs as, and whose
 * permissions - a person's, or an API key's.
 */
export const getWorkflowRunAsRunLogLine: (data: {
  choice: WorkflowRunAsChoice;
  giverName: string;
  isGivenByApiKey?: boolean | undefined;
}) => string = (data: {
  choice: WorkflowRunAsChoice;
  giverName: string;
  isGivenByApiKey?: boolean | undefined;
}): string => {
  return `Running as ${describeWorkflowRunAs(data.choice)}, with the permissions ${describeWorkflowRunAsGiver({ name: data.giverName, isApiKey: data.isGivenByApiKey })} gave this workflow.`;
};

/*
 * WHAT A WORKFLOW'S STEP RAN AS, FOR THE AUDIT LOG (#9766). A step acts as
 * no person, so its audit entries name the workflow (workflowId,
 * workflowName); these say what it ran as - Default, Project Owner or a
 * custom role, by the role's name at the time - and, for Project Owner or a
 * role, with whose permissions: the person or the project API key that gave
 * them, by name at the time, as the run checked them when it started.
 *
 * Carried on a step's props for the audit trail only
 * (DatabaseCommonInteractionProps.workflowRunAsAudit, set by
 * WorkflowPrincipal): no permission check reads it. What a step may do is in
 * its permission rows, and whether it may change who has access is
 * workflowRunAs.
 */
export interface WorkflowRunAsAudit {
  runAs: WorkflowRunAs;
  // The custom role's name when the run started (CustomRole only).
  customRoleName?: string | undefined;
  // The person who gave the permissions, when a person did.
  givenByUserId?: ObjectID | undefined;
  // The project API key that gave them, when a key did.
  givenByApiKeyId?: ObjectID | undefined;
  // The person's name (or email), or the key's name, when the run started.
  givenByName?: string | undefined;
}

/*
 * The audit log's columns for it, as stored and exported, and the values
 * one holds - the Run As as stored, "Default" for a step of a workflow that
 * runs with the default permissions.
 */
export const WORKFLOW_RUN_AS_AUDIT_COLUMNS: ReadonlyArray<
  keyof WorkflowRunAsAuditColumns
> = [
  "workflowRunAs",
  "workflowRunAsCustomRoleName",
  "workflowRunAsGivenByUserId",
  "workflowRunAsGivenByApiKeyId",
  "workflowRunAsGivenByName",
];

// What a workflow's audit entry stores of what it ran as.
export interface WorkflowRunAsAuditColumns {
  workflowRunAs: WorkflowRunAs;
  workflowRunAsCustomRoleName?: string | undefined;
  workflowRunAsGivenByUserId?: ObjectID | undefined;
  workflowRunAsGivenByApiKeyId?: ObjectID | undefined;
  workflowRunAsGivenByName?: string | undefined;
}

/*
 * A step's record of what it ran as, as the audit log's columns hold it -
 * or null for none. Only what it says: a Run As that is no WorkflowRunAs
 * is none; a role's name only beside a custom role; a giver only beside
 * Project Owner or a role, a key's id winning over a person's, as the run
 * asked the key; names trimmed, and empty ones left out.
 */
export const getWorkflowRunAsAuditColumns: (
  audit: WorkflowRunAsAudit | null | undefined,
) => WorkflowRunAsAuditColumns | null = (
  audit: WorkflowRunAsAudit | null | undefined,
): WorkflowRunAsAuditColumns | null => {
  if (!audit) {
    return null;
  }

  const runAs: WorkflowRunAs | null = readWorkflowRunAs(audit.runAs);

  if (!runAs) {
    return null;
  }

  const columns: WorkflowRunAsAuditColumns = { workflowRunAs: runAs };

  if (runAs === WorkflowRunAs.Default) {
    return columns;
  }

  const roleName: string = (audit.customRoleName || "").trim();

  if (runAs === WorkflowRunAs.CustomRole && roleName) {
    columns.workflowRunAsCustomRoleName = roleName;
  }

  if (audit.givenByApiKeyId) {
    columns.workflowRunAsGivenByApiKeyId = audit.givenByApiKeyId;
  } else if (audit.givenByUserId) {
    columns.workflowRunAsGivenByUserId = audit.givenByUserId;
  }

  const givenByName: string = (audit.givenByName || "").trim();

  if (givenByName) {
    columns.workflowRunAsGivenByName = givenByName;
  }

  return columns;
};

/*
 * THE PROJECT'S GLOBAL VARIABLES A GRAPH NAMES: every
 * {{global.variables.<name>}} in its steps' settings, by name, in the order
 * first met. A graph that names them some other way - the whole map, or in a
 * loop - is answered with the bare "global.variables", so it is never taken
 * for a graph that names none. Read from the graph as stored, so whatever a
 * step's settings hold is read.
 */
const GLOBAL_VARIABLE_REFERENCE: RegExp =
  /global\.variables(?:\.([^\s.{}"'\\[\]]+))?/g;

export const findGlobalVariableReferences: (
  graph: JSONObject | null | undefined,
) => Array<string> = (graph: JSONObject | null | undefined): Array<string> => {
  if (!graph) {
    return [];
  }

  let text: string;

  try {
    text = JSON.stringify(graph);
  } catch {
    return [];
  }

  const names: Array<string> = [];

  for (const match of text.matchAll(GLOBAL_VARIABLE_REFERENCE)) {
    const name: string = match[1] || "";

    if (!names.includes(name)) {
      names.push(name);
    }
  }

  return names;
};
