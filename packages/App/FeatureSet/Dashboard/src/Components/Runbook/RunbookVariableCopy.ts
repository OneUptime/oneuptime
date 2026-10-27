import {
  RunbookVariableScope,
  formatRunbookVariableReference,
} from "Common/Types/Runbook/RunbookVariableReference";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS AND RULES OF THE RUNBOOK VARIABLES PAGES.
 *
 * Two pages list variables: Runbooks > Settings > Global Variables, the
 * project's own, which every runbook can use, and a runbook's Settings >
 * Variables, that runbook's own (RunbookVariablesTable draws both). The
 * maintainer asked for them "just like we have workflow variables. Both
 * global variables and local variables", with the runbook secrets merged in
 * and the credentials page gone. So a variable is a plain value or a secret,
 * and an SSH key, a password or a kubeconfig is a secret variable.
 *
 * React-free on purpose: App's tests read these without the page.
 */

export const GLOBAL_VARIABLES_TITLE: string =
  translationKey("Global Variables");

/*
 * A card's description says, once, how a step writes one of its variables
 * ({{reference}}: {{global.variables.NAME}} or {{local.variables.NAME}}),
 * rather than every row repeating it: each row's copy button copies its
 * own.
 */
export const GLOBAL_VARIABLES_DESCRIPTION: string = translationKey(
  "Values every runbook in this project can use: hosts and URLs, or secrets such as SSH keys, passwords, tokens and kubeconfigs. Write one in a step as {{reference}}.",
);

export const RUNBOOK_VARIABLES_TITLE: string = translationKey("Variables");

export const RUNBOOK_VARIABLES_DESCRIPTION: string = translationKey(
  "Values only this runbook's steps can use, beside the project's global variables. Write one in a step as {{reference}}.",
);

export const GLOBAL_VARIABLES_EMPTY: string = translationKey(
  "No global variables yet. Add the hosts, keys, passwords and kubeconfigs your steps use.",
);

export const RUNBOOK_VARIABLES_EMPTY: string = translationKey(
  "No variables of this runbook's own yet. Global variables work here too.",
);

/*
 * The same two, for someone who may read variables but not create them - a
 * Runbook Admin, who picks them in the steps it writes: told who adds them,
 * not to add one.
 */
export const GLOBAL_VARIABLES_EMPTY_READ_ONLY: string = translationKey(
  "No global variables yet. A project owner or admin adds the hosts, keys, passwords and kubeconfigs steps use.",
);

export const RUNBOOK_VARIABLES_EMPTY_READ_ONLY: string = translationKey(
  "No variables of this runbook's own yet. A project owner or admin adds them, and global variables work here too.",
);

/*
 * A step's secret picker with nothing to pick, said to whoever may add a
 * variable and to whoever may not.
 */
export const NO_SECRET_VARIABLES_ADD_ONE_TEMPLATE: string = translationKey(
  "No secret variables yet. Add one under {{location}}, then pick it here.",
);

export const NO_SECRET_VARIABLES_ASK_TEMPLATE: string = translationKey(
  "No secret variables yet. Ask a project owner or admin to add one under {{location}}, then pick it here.",
);

/*
 * A secret the step's Runner may not use: to whoever may change the
 * variable, add the Runner to it; to whoever may not, pick one of its
 * Runners, or ask.
 */
export const NOT_FOR_RUNNER_EDIT_TEMPLATE: string = translationKey(
  "The Runner picked above may not use {{name}}, so the step will fail when it runs. Add the Runner to the variable's Runners under {{location}}.",
);

export const NOT_FOR_RUNNER_ASK_TEMPLATE: string = translationKey(
  "The Runner picked above may not use {{name}}, so the step will fail when it runs. Pick one of the variable's Runners for this step, or ask a project owner or admin to add this Runner to it under {{location}}.",
);

// The form's steps: what the variable is, then who may use a secret.
export const VARIABLE_STEP_TITLE: string = translationKey("Variable");
export const ACCESS_STEP_TITLE: string = translationKey("Who can use it");

export const NAME_DESCRIPTION: string = translationKey(
  "Letters, numbers, hyphens and underscores. Steps use the variable by this name.",
);

export const SECRET_TITLE: string = translationKey("Secret");

export const SECRET_DESCRIPTION: string = translationKey(
  "Encrypted, never shown again, and hidden in what steps print.",
);

export const VALUE_TITLE: string = translationKey("Value");

export const VALUE_DESCRIPTION: string = translationKey(
  "What a step gets where it names this variable.",
);

export const SECRET_VALUE_TITLE: string = translationKey("Secret Value");

export const SECRET_VALUE_DESCRIPTION: string = translationKey(
  "Encrypted. It can never be read back: replace it to change it.",
);

export const SECRET_VALUE_PLACEHOLDER: string = translationKey(
  "A password, a token, a private key or a kubeconfig",
);

export const GLOBAL_RUNNERS_CAN_USE_TITLE: string = translationKey(
  "Global Runners can use it",
);

export const GLOBAL_RUNNERS_CAN_USE_DESCRIPTION: string = translationKey(
  "Steps of this project that run on a global Runner get this secret. Steps of other projects never do.",
);

export const YOUR_RUNNERS_TITLE: string = translationKey(
  "Your Runners that can use it",
);

export const YOUR_RUNNERS_DESCRIPTION: string = translationKey(
  "The Runners you installed that get this secret.",
);

export const REPLACE_VALUE_TITLE: string = translationKey("Replace Value");

// The Replace Value dialog's title: which variable it replaces.
export const REPLACE_VALUE_OF_TITLE: string = translationKey(
  "Replace the value of {{name}}",
);

export const REPLACE_VALUE_DESCRIPTION: string = translationKey(
  "The new value is encrypted, and the old one is gone for good. Steps get the new one the next time they run.",
);

// The Replace Value dialog's one field.
export const NEW_VALUE_TITLE: string = translationKey("New Value");

// A row's copy button, beside the name: it copies {{reference}}.
export const COPY_REFERENCE_TITLE: string =
  translationKey("Copy {{reference}}");

// What a plain variable's Runners column says: it reaches every Runner.
export const EVERY_RUNNER_TEXT: string = translationKey("Every Runner");

// The Value column of a secret: it is never shown.
export const SECRET_VALUE_HIDDEN_TEXT: string = translationKey("Secret");

// Under a Runners column, the global Runners of a secret that lets them.
export const GLOBAL_RUNNERS_TEXT: string = translationKey("Global Runners");

// How a step names this variable: {{global.variables.NAME}}.
export function getVariableReferenceText(data: {
  name: string;
  isGlobal: boolean;
}): string {
  return formatRunbookVariableReference({
    scope: data.isGlobal
      ? RunbookVariableScope.Global
      : RunbookVariableScope.Local,
    name: data.name,
  });
}

// The longest a plain value is shown in the list before it is cut.
export const VALUE_SHOWN_MAX_LENGTH: number = 60;

// A plain value as the list shows it: one line, cut when long.
export function getValueShown(value: string | null | undefined): string {
  const firstLine: string = (value || "").split("\n")[0] || "";
  const isCut: boolean =
    firstLine.length > VALUE_SHOWN_MAX_LENGTH ||
    (value || "").indexOf("\n") !== -1;

  return `${firstLine.slice(0, VALUE_SHOWN_MAX_LENGTH)}${isCut ? "…" : ""}`;
}
