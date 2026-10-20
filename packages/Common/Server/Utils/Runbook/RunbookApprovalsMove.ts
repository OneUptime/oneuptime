import RunbookService from "../../Services/RunbookService";
import logger from "../Logger";
import { RunbookStep } from "../../../Types/Runbook/RunbookStep";
import {
  StepsWithApprovalsBeforeTheirSteps,
  getStepsWithApprovalsBeforeTheirSteps,
  hasApprovalAfterStep,
} from "../../../Types/Runbook/RunbookStepApproval";

/*
 * EVERY STORED RUNBOOK ASKS FOR ITS APPROVALS BEFORE THE STEP THEY GUARD.
 *
 * A step's approval switch used to mean "pause after this step"; it means
 * "pause before this step" now (RunbookStepApproval). This writes every
 * stored runbook the new way, once, so each runs exactly as it did:
 *
 *   - an approval after step N becomes an approval before step N+1
 *     (requireApprovalBeforeRunning), the step it held back;
 *   - an approval after a step that a Manual step follows is that Manual
 *     step's own stop, which comes before anything after it runs;
 *   - an approval after the last step becomes a Manual step at the end,
 *     "Approve the result": the run waited for someone before it finished
 *     (and the remediation verifier with it), and still does;
 *   - the old flag goes from every step of a runbook it moves, true or
 *     false; nothing else of a step changes, and a step keeps its place.
 *
 * Only runbooks with an approval to move are written: a runbook whose old
 * flags are all false, or only on Manual steps (where they never did
 * anything), stays exactly as it is - everything that reads steps drops
 * those flags anyway - so a Terraform configuration that writes
 * requireApproval = false sees no change.
 *
 * Runs already started are left alone: each holds its own copy of the
 * steps, and the execution loop still stops after a step whose copy asks
 * for an approval after it (RunRunbook), so a run waiting for an approval
 * at the upgrade is approved as before and goes on to the next step.
 *
 * One statement per runbook, a compare-and-set on the steps it read: a
 * runbook saved between the read and the write is left as that save wrote
 * it (a save from the Steps page is in the new shape already, and an API
 * save that still sends the old flag is read the new way wherever steps
 * are read). Written without the runbook's hooks: it changes no credential,
 * no trigger and nothing a person is asked about. Safe to run twice: the
 * second run finds no approval to move. Never throws for one runbook: its
 * failure is logged and the others go on.
 *
 * Run once by the Workers' data migration MoveRunbookApprovalsBeforeTheirSteps,
 * and tested against a migrated Postgres
 * (Tests/Server/Utils/Runbook/RunbookApprovalsMovePostgres.test.ts).
 */

export type RunbookApprovalsQuery = (
  sql: string,
  parameters?: Array<unknown>,
) => Promise<unknown>;

// A runbook whose steps may hold an approval to move, as the driver returns it.
export interface RunbookApprovalStepsRow {
  _id: string;
  steps: unknown;
}

/*
 * The runbooks whose steps name the old flag at all, read as text and
 * filtered there first so no other runbook is read; each one found is read
 * in full below, and only one with an approval to move is written.
 */
export const RUNBOOKS_WITH_OLD_APPROVALS_SQL: string = `SELECT "_id", "steps" FROM "Runbook" WHERE "deletedAt" IS NULL AND "steps" IS NOT NULL AND "steps"::text LIKE '%"requireApproval"%' ORDER BY "_id"`;

/*
 * Writes a runbook's moved steps only while it still holds the steps they
 * were moved from ($3), and says which runbook it wrote.
 */
export const UPDATE_RUNBOOK_APPROVAL_STEPS_SQL: string = `UPDATE "Runbook" SET "steps" = $1::jsonb, "updatedAt" = now(), "version" = "version" + 1 WHERE "_id" = $2 AND "deletedAt" IS NULL AND "steps" = $3::jsonb RETURNING "_id"`;

export interface RunbookApprovalsMoveSummary {
  // Runbooks written with their approvals moved.
  runbooksMoved: number;
  // Approvals after a step moved before the next one (or into a Manual step's stop).
  approvalsMoved: number;
  // Approvals after the last step that became a Manual step at the end.
  approvalStepsAdded: number;
  // Runbooks saved by someone between the read and the write: left as saved.
  runbooksChangedMeanwhile: number;
  // Runbooks whose steps could not be read or written (logged).
  runbooksFailed: number;
}

export default class RunbookApprovalsMove {
  public static async moveAll(
    query: RunbookApprovalsQuery = RunbookApprovalsMove.defaultQuery(),
  ): Promise<RunbookApprovalsMoveSummary> {
    const summary: RunbookApprovalsMoveSummary = {
      runbooksMoved: 0,
      approvalsMoved: 0,
      approvalStepsAdded: 0,
      runbooksChangedMeanwhile: 0,
      runbooksFailed: 0,
    };

    // A failure to read the runbooks is not swallowed: nothing was moved.
    const runbooks: Array<RunbookApprovalStepsRow> =
      readRows<RunbookApprovalStepsRow>(
        await query(RUNBOOKS_WITH_OLD_APPROVALS_SQL),
      );

    for (const runbook of runbooks) {
      try {
        await RunbookApprovalsMove.moveRunbook({ runbook, query, summary });
      } catch (err) {
        summary.runbooksFailed++;
        logger.error(
          `RunbookApprovalsMove: the approvals of runbook ${String(runbook._id)} could not be moved before their steps:`,
        );
        logger.error(err);
      }
    }

    return summary;
  }

  public static async moveRunbook(data: {
    runbook: RunbookApprovalStepsRow;
    query: RunbookApprovalsQuery;
    summary: RunbookApprovalsMoveSummary;
  }): Promise<void> {
    const steps: Array<RunbookStep> | null = readSteps(data.runbook.steps);

    if (!steps) {
      return;
    }

    const moved: StepsWithApprovalsBeforeTheirSteps =
      getStepsWithApprovalsBeforeTheirSteps(steps);

    if (!moved.isMoved) {
      return;
    }

    const written: unknown = await data.query(
      UPDATE_RUNBOOK_APPROVAL_STEPS_SQL,
      [
        JSON.stringify(moved.steps),
        String(data.runbook._id),
        JSON.stringify(steps),
      ],
    );

    if (readUpdatedCount(written) === 0) {
      data.summary.runbooksChangedMeanwhile++;
      return;
    }

    data.summary.runbooksMoved++;
    data.summary.approvalsMoved += steps.filter(
      (step: RunbookStep): boolean => {
        return hasApprovalAfterStep(step);
      },
    ).length;
    data.summary.approvalStepsAdded += moved.steps.length - steps.length;
  }

  private static defaultQuery(): RunbookApprovalsQuery {
    return async (
      sql: string,
      parameters?: Array<unknown>,
    ): Promise<unknown> => {
      return await RunbookService.getRepository().manager.query(
        sql,
        parameters,
      );
    };
  }
}

function readRows<T>(rows: unknown): Array<T> {
  return Array.isArray(rows) ? (rows as Array<T>) : [];
}

// A runbook's steps as the driver hands them over: parsed, or JSON text.
function readSteps(value: unknown): Array<RunbookStep> | null {
  let steps: unknown = value;

  if (typeof steps === "string") {
    try {
      steps = JSON.parse(steps);
    } catch {
      return null;
    }
  }

  return Array.isArray(steps) ? (steps as Array<RunbookStep>) : null;
}

/*
 * How many rows an UPDATE ... RETURNING wrote: the Postgres driver behind
 * TypeORM answers an UPDATE with [rows, count], a plain driver with the rows.
 */
export function readUpdatedCount(result: unknown): number {
  if (!Array.isArray(result)) {
    return 0;
  }

  if (
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === "number"
  ) {
    return result[1];
  }

  return result.length;
}
