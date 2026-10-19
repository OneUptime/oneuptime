import {
  RunbookVariableReference,
  RunbookVariableScope,
} from "./RunbookVariableReference";

/*
 * WHY A STEP COULD NOT GET A VARIABLE IT NAMES - and the one sentence that
 * says so, which the step fails with. A step never runs with a reference
 * left where its value should be: a script that runs `rm -rf {{...}}` or
 * signs in with the text of a placeholder does something nobody wrote.
 *
 * Pure, so the server (the claim, which fails the job) and the tests read
 * the same words.
 */
export enum RunbookVariableProblemReason {
  // No variable of that name in that scope.
  Missing = "missing",
  // A {{local.variables.NAME}} where there is no runbook to read it from.
  NoRunbook = "no-runbook",
  // A secret the Runner that took the step is not one of the Runners of.
  NotForThisRunner = "not-for-this-runner",
  // A secret global Runners may not use, on a step a global Runner took.
  NotForGlobalRunners = "not-for-global-runners",
  // A secret with no value stored.
  NoValue = "no-value",
  // A field that takes a secret named a variable that is not one.
  NotSecret = "not-secret",
}

export interface RunbookVariableProblem {
  reference: RunbookVariableReference;
  reason: RunbookVariableProblemReason;
}

// The longest a name is quoted in a message, and how many are listed.
const MAX_NAME_SHOWN: number = 80;
const MAX_LISTED: number = 5;

function quote(reference: RunbookVariableReference): string {
  const name: string =
    reference.name.length > MAX_NAME_SHOWN
      ? `${reference.name.slice(0, MAX_NAME_SHOWN)}…`
      : reference.name;

  return `"${name}"`;
}

function list(references: Array<RunbookVariableReference>): string {
  const shown: Array<string> = references.slice(0, MAX_LISTED).map(quote);
  const more: number = references.length - shown.length;

  return `${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

function isOne(references: Array<RunbookVariableReference>): boolean {
  return references.length === 1;
}

function sentence(
  reason: RunbookVariableProblemReason,
  references: Array<RunbookVariableReference>,
): string {
  const one: boolean = isOne(references);
  const names: string = list(references);

  switch (reason) {
    case RunbookVariableProblemReason.Missing: {
      const globals: Array<RunbookVariableReference> = references.filter(
        (reference: RunbookVariableReference): boolean => {
          return reference.scope === RunbookVariableScope.Global;
        },
      );
      const locals: Array<RunbookVariableReference> = references.filter(
        (reference: RunbookVariableReference): boolean => {
          return reference.scope === RunbookVariableScope.Local;
        },
      );

      const parts: Array<string> = [];

      if (globals.length > 0) {
        parts.push(
          `there is no global variable named ${list(globals)} (Runbooks → Settings → Global Variables)`,
        );
      }

      if (locals.length > 0) {
        parts.push(
          `this runbook has no variable named ${list(locals)} (the runbook's Settings → Variables)`,
        );
      }

      return parts.join("; ");
    }
    case RunbookVariableProblemReason.NoRunbook:
      return `${names} ${one ? "is a runbook's own variable" : "are a runbook's own variables"}, and this step is not part of a runbook run`;
    case RunbookVariableProblemReason.NotForThisRunner:
      return `the secret${one ? "" : "s"} ${names} may not be used on this Runner: add it to the Runners of ${one ? "that variable" : "those variables"}, or pick one of ${one ? "its" : "their"} Runners for the step`;
    case RunbookVariableProblemReason.NotForGlobalRunners:
      return `global Runners may not use the secret${one ? "" : "s"} ${names}: turn on "Global Runners can use it" for ${one ? "it" : "them"}, or pick one of your own Runners for the step`;
    case RunbookVariableProblemReason.NoValue:
      return `the secret${one ? "" : "s"} ${names} ${one ? "has" : "have"} no value: set one`;
    case RunbookVariableProblemReason.NotSecret:
      return `${names} ${one ? "is not a secret variable" : "are not secret variables"}: a key, a password or a kubeconfig must be kept in a secret variable`;
    default: {
      const unhandled: never = reason;
      return unhandled;
    }
  }
}

const REASON_ORDER: Array<RunbookVariableProblemReason> = [
  RunbookVariableProblemReason.Missing,
  RunbookVariableProblemReason.NoRunbook,
  RunbookVariableProblemReason.NotSecret,
  RunbookVariableProblemReason.NoValue,
  RunbookVariableProblemReason.NotForThisRunner,
  RunbookVariableProblemReason.NotForGlobalRunners,
];

/*
 * Why a step was not run, in one message: each kind of problem in a clause
 * of its own, naming the variables (never their values) and what to do.
 */
export function describeRunbookVariableProblems(
  problems: Array<RunbookVariableProblem>,
): string {
  const clauses: Array<string> = [];

  for (const reason of REASON_ORDER) {
    const references: Array<RunbookVariableReference> = problems
      .filter((problem: RunbookVariableProblem): boolean => {
        return problem.reason === reason;
      })
      .map((problem: RunbookVariableProblem): RunbookVariableReference => {
        return problem.reference;
      });

    if (references.length > 0) {
      clauses.push(sentence(reason, references));
    }
  }

  if (clauses.length === 0) {
    return "";
  }

  const text: string = clauses.join("; ");

  return `This step names variables it cannot use, so it was not run: ${text}.`;
}
