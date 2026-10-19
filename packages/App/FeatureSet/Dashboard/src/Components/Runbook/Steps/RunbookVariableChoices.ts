import IsNull from "Common/Types/BaseDatabase/IsNull";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import {
  RunbookVariableReference,
  RunbookVariableScope,
  findRunbookVariableReferencesIn,
  formatRunbookVariableReference,
  getRunbookVariableReferenceKey,
  parseSingleRunbookVariableReference,
} from "Common/Types/Runbook/RunbookVariableReference";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import RunbookVariable from "Common/Models/DatabaseModels/RunbookVariable";
import Runner from "Common/Models/DatabaseModels/Runner";

/*
 * THE VARIABLES A RUNBOOK'S STEPS CAN NAME, as the step editor offers them:
 * the project's global variables and the runbook's own, each with whether
 * it is a secret and which Runners may use it - never a value. Read once
 * when the Steps page opens, and again when the person comes back to it
 * from a tab where they added one.
 *
 * React-free, so App's tests read the same rules the picker draws.
 */

export interface RunbookVariableChoice {
  scope: RunbookVariableScope;
  name: string;
  // How a step names it: {{global.variables.NAME}}.
  reference: string;
  isSecret: boolean;
  // A secret's Runners; empty for a plain value, which every Runner gets.
  runnerIds: Array<string>;
  isAvailableToGlobalRunners: boolean;
}

export interface RunbookVariableChoices {
  variables: Array<RunbookVariableChoice>;
  /*
   * Whether they could be read: someone who may not read runbook variables
   * gets none, and the picker says why rather than "none yet".
   */
  isReadable: boolean;
}

export const NO_RUNBOOK_VARIABLE_CHOICES: RunbookVariableChoices = {
  variables: [],
  isReadable: true,
};

function toChoice(
  scope: RunbookVariableScope,
  row: RunbookVariable,
): RunbookVariableChoice | null {
  const name: string = row.name || "";

  if (!name) {
    return null;
  }

  return {
    scope,
    name,
    reference: formatRunbookVariableReference({ scope, name }),
    isSecret: Boolean(row.isSecret),
    runnerIds: (row.runners || [])
      .map((runner: Runner): string => {
        return runner?._id?.toString() || "";
      })
      .filter(Boolean),
    isAvailableToGlobalRunners: Boolean(row.isAvailableToGlobalRunners),
  };
}

export default class RunbookVariableChoicesLoader {
  public static async load(data: {
    projectId: ObjectID;
    runbookId: ObjectID;
  }): Promise<RunbookVariableChoices> {
    try {
      const [globals, locals]: [
        ListResult<RunbookVariable>,
        ListResult<RunbookVariable>,
      ] = await Promise.all([
        RunbookVariableChoicesLoader.loadScope({
          projectId: data.projectId,
          runbookId: null,
        }),
        RunbookVariableChoicesLoader.loadScope({
          projectId: data.projectId,
          runbookId: data.runbookId,
        }),
      ]);

      const variables: Array<RunbookVariableChoice> = [
        ...globals.data.map((row: RunbookVariable) => {
          return toChoice(RunbookVariableScope.Global, row);
        }),
        ...locals.data.map((row: RunbookVariable) => {
          return toChoice(RunbookVariableScope.Local, row);
        }),
      ].filter((choice: RunbookVariableChoice | null) => {
        return choice !== null;
      }) as Array<RunbookVariableChoice>;

      return { variables, isReadable: true };
    } catch {
      return { variables: [], isReadable: false };
    }
  }

  private static loadScope(data: {
    projectId: ObjectID;
    runbookId: ObjectID | null;
  }): Promise<ListResult<RunbookVariable>> {
    return ModelAPI.getList<RunbookVariable>({
      modelType: RunbookVariable,
      query: {
        projectId: data.projectId,
        runbookId: data.runbookId ? data.runbookId : new IsNull(),
      },
      select: {
        _id: true,
        name: true,
        isSecret: true,
        isAvailableToGlobalRunners: true,
        runners: {
          _id: true,
        },
      },
      sort: { name: SortOrder.Ascending },
      limit: LIMIT_MAX,
      skip: 0,
    });
  }
}

// The secrets a field that signs in or holds a kubeconfig can name.
export function getSecretVariableChoices(
  choices: RunbookVariableChoices,
): Array<RunbookVariableChoice> {
  return choices.variables.filter((choice: RunbookVariableChoice) => {
    return choice.isSecret;
  });
}

// The variable a stored reference names, or undefined.
export function findVariableChoice(
  choices: RunbookVariableChoices,
  reference: string,
): RunbookVariableChoice | undefined {
  const parsed: RunbookVariableReference | null =
    parseSingleRunbookVariableReference(reference);

  if (!parsed) {
    return undefined;
  }

  const key: string = getRunbookVariableReferenceKey(parsed);

  return choices.variables.find((choice: RunbookVariableChoice) => {
    return (
      getRunbookVariableReferenceKey({
        scope: choice.scope,
        name: choice.name,
      }) === key
    );
  });
}

/*
 * The variables `texts` name that are not the project's - a typo, or one
 * deleted since - each once, as references: what the step would fail with.
 * None when the variables could not be read.
 */
export function getUnknownVariableReferences(
  choices: RunbookVariableChoices,
  texts: Array<string>,
): Array<string> {
  if (!choices.isReadable) {
    return [];
  }

  const known: Set<string> = new Set<string>(
    choices.variables.map((choice: RunbookVariableChoice): string => {
      return getRunbookVariableReferenceKey({
        scope: choice.scope,
        name: choice.name,
      });
    }),
  );

  return findRunbookVariableReferencesIn(texts)
    .filter((reference: RunbookVariableReference): boolean => {
      return !known.has(getRunbookVariableReferenceKey(reference));
    })
    .map((reference: RunbookVariableReference): string => {
      return formatRunbookVariableReference(reference);
    });
}

export enum VariableUseProblem {
  // Names no variable of the project (deleted, renamed, or never there).
  Unknown = "unknown",
  // Names a plain value where a secret belongs.
  NotSecret = "not-secret",
  // A secret the step's Runner is not one of the Runners of.
  NotForRunner = "not-for-runner",
}

/*
 * What is wrong with a field that names a secret, as the step stands: the
 * same things the server fails the step for when it runs. Null when nothing
 * is, when the field is empty, or when the variables could not be read (the
 * page cannot tell).
 */
export function getVariableUseProblem(data: {
  choices: RunbookVariableChoices;
  reference: string;
  // The step's own Runner; empty when it has none yet.
  runnerId: string;
}): VariableUseProblem | null {
  if (!data.reference.trim() || !data.choices.isReadable) {
    return null;
  }

  const choice: RunbookVariableChoice | undefined = findVariableChoice(
    data.choices,
    data.reference,
  );

  if (!choice) {
    return VariableUseProblem.Unknown;
  }

  if (!choice.isSecret) {
    return VariableUseProblem.NotSecret;
  }

  if (data.runnerId && !choice.runnerIds.includes(data.runnerId)) {
    return VariableUseProblem.NotForRunner;
  }

  return null;
}
