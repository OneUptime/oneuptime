import { JSONObject } from "../JSON";

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
 * its permissions come from a person who holds them, and only such a person
 * changes what it does.
 *
 *   - Only a person gives a workflow raised permissions, and only ones they
 *     could give a team themselves (WorkflowRunAsAuthority). They are
 *     recorded as having given them.
 *   - Only a person who holds them may change a raised workflow - its steps,
 *     its own variables, its Run As - delete it, archive it, run it by hand
 *     or see the keys that start it. Anyone who may edit it may turn it off.
 *     A person who saves a change to its steps, its variables or its Run As
 *     gives it its permissions anew: the workflow runs with them only while
 *     that person still holds them.
 *   - Every run checks that the person who gave them still does. If they
 *     left the project or lost the permissions, the run does not start.
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
 * is no person: an API key, or OneUptime acting for nobody in particular.
 */
export const WORKFLOW_RUN_AS_PERSON_ONLY_MESSAGE: string =
  "Only a person can choose what a workflow runs as, or change a workflow that runs with more than the default permissions, because the workflow runs with that person's permissions. API keys can't.";

/*
 * A raised workflow acted on by something that is no person, which may do
 * nothing a person who holds its permissions alone may: the refusal for
 * the act, and why.
 */
export const getWorkflowRunAsPersonOnlyRefusedMessage: (
  refusal: string,
) => string = (refusal: string): string => {
  return `${refusal} ${WORKFLOW_RUN_AS_PERSON_ONLY_MESSAGE}`;
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

// The first line of a raised run's log: what it runs as, and for whom.
export const getWorkflowRunAsRunLogLine: (data: {
  choice: WorkflowRunAsChoice;
  giverName: string;
}) => string = (data: {
  choice: WorkflowRunAsChoice;
  giverName: string;
}): string => {
  return `Running as ${describeWorkflowRunAs(data.choice)}, with the permissions ${data.giverName} gave this workflow.`;
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
