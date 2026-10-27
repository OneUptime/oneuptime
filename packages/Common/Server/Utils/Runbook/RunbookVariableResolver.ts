import RunbookVariableService from "../../Services/RunbookVariableService";
import QueryHelper from "../../Types/Database/QueryHelper";
import RunbookVariable from "../../../Models/DatabaseModels/RunbookVariable";
import Runner from "../../../Models/DatabaseModels/Runner";
import { toStoredBoolean } from "../../../Types/Database/BooleanColumnValue";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import {
  RunbookVariableProblem,
  RunbookVariableProblemReason,
} from "../../../Types/Runbook/RunbookVariableProblems";
import {
  RunbookVariableReference,
  RunbookVariableScope,
  getRunbookVariableReferenceKey,
  replaceRunbookVariableReferences,
} from "../../../Types/Runbook/RunbookVariableReference";

/*
 * THE VARIABLES A RUNBOOK STEP NAMES, READ FOR THE ONE WHO RUNS IT.
 *
 * The one place a secret runbook variable is decrypted for a step, and the
 * one rule for who may have it:
 *
 *   - only the variables the step names, of the step's own project - a
 *     global one ({{global.variables.NAME}}) or one of the step's own
 *     runbook ({{local.variables.NAME}}); a step of another project or
 *     another runbook can never name its way to them;
 *   - a plain value reaches any Runner that takes the step;
 *   - a secret reaches only a Runner of the project it lists (runners), or
 *     a global Runner when it lets global Runners use it
 *     (isAvailableToGlobalRunners);
 *   - an HTTP request step, which OneUptime sends itself from its own
 *     servers - no Runner is involved - gets every variable it names, a
 *     secret too (Types/Runbook/HttpStepVariables);
 *   - a variable the step cannot have is a problem, never a value: the
 *     caller fails the step and names it (RunbookVariableProblems).
 *
 * Read per claim, so a value changed a moment ago reaches the next run, and
 * the job row only ever holds the references.
 */

// Who a step's variables are read for.
export type RunbookVariableAccess =
  // One of the project's own Runners took the step.
  | { kind: "project-runner"; runnerId: ObjectID }
  // A global Runner took it: one OneUptime runs for every project.
  | { kind: "global-runner" }
  /*
   * The server itself: to check a step before it is sent anywhere, to know
   * what to redact from what a step printed, or to send an HTTP request
   * step, which OneUptime sends itself. Values only on request.
   */
  | { kind: "server" };

export interface ResolvedRunbookVariable {
  reference: RunbookVariableReference;
  isSecret: boolean;
  // Empty unless the values were asked for.
  value: string;
}

export interface RunbookVariableResolution {
  // The variables the step may have, by getRunbookVariableReferenceKey.
  variables: Map<string, ResolvedRunbookVariable>;
  // The ones it may not, and why.
  problems: Array<RunbookVariableProblem>;
  // The secret values handed over, for redaction.
  secretValues: Array<string>;
}

export default class RunbookVariableResolver {
  public static async resolve(data: {
    projectId: ObjectID;
    // The runbook the step belongs to; null when there is none.
    runbookId: ObjectID | null;
    references: Array<RunbookVariableReference>;
    access: RunbookVariableAccess;
    // Whether to read (and so decrypt) the values; existence is always read.
    includeValues: boolean;
  }): Promise<RunbookVariableResolution> {
    const resolution: RunbookVariableResolution = {
      variables: new Map<string, ResolvedRunbookVariable>(),
      problems: [],
      secretValues: [],
    };

    if (data.references.length === 0) {
      return resolution;
    }

    const globalNames: Array<string> = [];
    const localNames: Array<string> = [];

    for (const reference of data.references) {
      if (reference.scope === RunbookVariableScope.Local) {
        if (!data.runbookId) {
          resolution.problems.push({
            reference,
            reason: RunbookVariableProblemReason.NoRunbook,
          });
          continue;
        }

        localNames.push(reference.name);
      } else {
        globalNames.push(reference.name);
      }
    }

    const found: Map<string, RunbookVariable> = new Map<
      string,
      RunbookVariable
    >();

    const loadScope: (
      scope: RunbookVariableScope,
      names: Array<string>,
    ) => Promise<void> = async (
      scope: RunbookVariableScope,
      names: Array<string>,
    ): Promise<void> => {
      if (names.length === 0) {
        return;
      }

      const rows: Array<RunbookVariable> = await RunbookVariableService.findBy({
        query: {
          projectId: data.projectId,
          runbookId:
            scope === RunbookVariableScope.Local
              ? (data.runbookId as ObjectID)
              : QueryHelper.isNull(),
          name: QueryHelper.any(names),
        },
        select: {
          _id: true,
          name: true,
          isSecret: true,
          isAvailableToGlobalRunners: true,
          runners: {
            _id: true,
          },
          ...(data.includeValues ? { value: true, secretValue: true } : {}),
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const row of rows) {
        // Names are matched as written: the query compares them exactly.
        if (row.name && names.includes(row.name)) {
          found.set(
            getRunbookVariableReferenceKey({ scope, name: row.name }),
            row,
          );
        }
      }
    };

    await loadScope(RunbookVariableScope.Global, globalNames);
    await loadScope(RunbookVariableScope.Local, localNames);

    for (const reference of data.references) {
      if (reference.scope === RunbookVariableScope.Local && !data.runbookId) {
        continue;
      }

      const key: string = getRunbookVariableReferenceKey(reference);
      const row: RunbookVariable | undefined = found.get(key);

      if (!row) {
        resolution.problems.push({
          reference,
          reason: RunbookVariableProblemReason.Missing,
        });
        continue;
      }

      const isSecret: boolean = toStoredBoolean(row.isSecret) === true;

      if (isSecret) {
        const refusal: RunbookVariableProblemReason | null =
          RunbookVariableResolver.getSecretRefusal({
            row,
            access: data.access,
          });

        if (refusal) {
          resolution.problems.push({ reference, reason: refusal });
          continue;
        }
      }

      const value: string = data.includeValues
        ? String((isSecret ? row.secretValue : row.value) ?? "")
        : "";

      if (data.includeValues && isSecret && !value) {
        resolution.problems.push({
          reference,
          reason: RunbookVariableProblemReason.NoValue,
        });
        continue;
      }

      resolution.variables.set(key, { reference, isSecret, value });

      if (isSecret && value) {
        resolution.secretValues.push(value);
      }
    }

    return resolution;
  }

  // Whether this access may have this secret, or why not.
  public static getSecretRefusal(data: {
    row: RunbookVariable;
    access: RunbookVariableAccess;
  }): RunbookVariableProblemReason | null {
    if (data.access.kind === "server") {
      return null;
    }

    if (data.access.kind === "global-runner") {
      return toStoredBoolean(data.row.isAvailableToGlobalRunners) === true
        ? null
        : RunbookVariableProblemReason.NotForGlobalRunners;
    }

    const runnerId: string = data.access.runnerId.toString();

    const isAssigned: boolean = (data.row.runners || []).some(
      (runner: Runner): boolean => {
        return runner?._id?.toString() === runnerId;
      },
    );

    return isAssigned ? null : RunbookVariableProblemReason.NotForThisRunner;
  }

  /*
   * `text` with every reference the resolution holds a value for filled in;
   * any other placeholder stays as written.
   */
  public static fill(
    text: string,
    resolution: RunbookVariableResolution,
  ): string {
    return replaceRunbookVariableReferences(
      text,
      (reference: RunbookVariableReference): string | undefined => {
        return resolution.variables.get(
          getRunbookVariableReferenceKey(reference),
        )?.value;
      },
    );
  }
}
