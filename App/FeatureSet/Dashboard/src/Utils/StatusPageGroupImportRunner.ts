import {
  ExistingStatusPageGroup,
  ParsedStatusPageGroupRow,
  SkippedStatusPageGroupRow,
  StatusPageGroupImportPlan,
  planStatusPageGroupImport,
} from "./StatusPageGroupCsv";

/*
 * The create-loop behind the Status Page > Groups CSV import, kept react-free
 * and transport-free for the same reason StatusPageGroupCsv is: it must never
 * import Common/UI/Config (it touches window at module load), so the node-env
 * jest suite in App/Tests/Dashboard can drive the whole ordering / parent-
 * resolution / partial-failure story without a renderer.
 *
 * The caller supplies `createGroup`, which is the only part that talks to the
 * API. It reports its own outcome rather than throwing, so error phrasing
 * (API.getFriendlyMessage) stays in the UI layer where it belongs.
 */

export type StatusPageGroupImportRowStatus = "created" | "failed" | "skipped";

export interface StatusPageGroupImportRowResult {
  // 1-based line in the CSV this result belongs to.
  line: number;
  name: string;
  status: StatusPageGroupImportRowStatus;
  // Empty for a created row; the reason otherwise.
  message: string;
}

export interface StatusPageGroupImportProgress {
  // Every result so far, in the order they were decided.
  results: Array<StatusPageGroupImportRowResult>;
  createdCount: number;
  // Rows the plan intends to create — skipped rows are not counted.
  totalToCreate: number;
}

export interface StatusPageGroupImportSummary
  extends StatusPageGroupImportProgress {
  failedCount: number;
  skippedCount: number;
}

/*
 * Outcome of creating one group. A failure is a value, not an exception, so
 * one bad row never aborts the run and the message can be formatted by
 * whoever owns the transport.
 */
export type StatusPageGroupCreateResult =
  | { created: true; statusPageGroupId: string | undefined }
  | { created: false; errorMessage: string };

export type CreateStatusPageGroupFunction = (
  row: ParsedStatusPageGroupRow,
  // The id of the already-created parent, or undefined for a top level group.
  parentStatusPageGroupId: string | undefined,
) => Promise<StatusPageGroupCreateResult>;

export interface RunStatusPageGroupImportOptions {
  rows: Array<ParsedStatusPageGroupRow>;
  /*
   * Groups already on this status page. Read for parent resolution, for the
   * "already exists" skip and for the nesting-depth check; never mutated —
   * the run works on its own copies.
   */
  existingGroups: Array<ExistingStatusPageGroup>;
  createGroup: CreateStatusPageGroupFunction;
  // Called after the skip pass and after every attempted row.
  onProgress?: ((progress: StatusPageGroupImportProgress) => void) | undefined;
}

function summarize(
  results: Array<StatusPageGroupImportRowResult>,
  totalToCreate: number,
): StatusPageGroupImportSummary {
  let createdCount: number = 0;
  let failedCount: number = 0;
  let skippedCount: number = 0;

  for (const result of results) {
    if (result.status === "created") {
      createdCount++;
    } else if (result.status === "failed") {
      failedCount++;
    } else {
      skippedCount++;
    }
  }

  return {
    results: results,
    createdCount: createdCount,
    failedCount: failedCount,
    skippedCount: skippedCount,
    totalToCreate: totalToCreate,
  };
}

/*
 * Create every parsed row, parents before children.
 *
 * planStatusPageGroupImport groups the rows into dependency-ordered batches,
 * so by the time a child is attempted its parent's id is already in the
 * name->id map (either it was there to begin with, or an earlier batch created
 * it). A row whose parent failed to create has no id to point at, so it is
 * skipped rather than created as an accidental top level group — a group that
 * silently jumps to the root of the status page is far worse than a reported
 * skip.
 */
export async function runStatusPageGroupImport(
  options: RunStatusPageGroupImportOptions,
): Promise<StatusPageGroupImportSummary> {
  const groupIdByName: Map<string, string> = new Map<string, string>();
  for (const group of options.existingGroups) {
    groupIdByName.set(group.name, group.id);
  }

  const plan: StatusPageGroupImportPlan = planStatusPageGroupImport(
    options.rows,
    options.existingGroups,
  );

  const results: Array<StatusPageGroupImportRowResult> = [];

  const totalToCreate: number = plan.batches.reduce(
    (sum: number, batch: Array<ParsedStatusPageGroupRow>): number => {
      return sum + batch.length;
    },
    0,
  );

  let createdCount: number = 0;

  const reportProgress: () => void = (): void => {
    options.onProgress?.({
      // A copy per tick so a React consumer sees a new array identity.
      results: [...results],
      createdCount: createdCount,
      totalToCreate: totalToCreate,
    });
  };

  for (const skipped of plan.skipped as Array<SkippedStatusPageGroupRow>) {
    results.push({
      line: skipped.row.line,
      name: skipped.row.name,
      status: "skipped",
      message: skipped.reason,
    });
  }

  /*
   * Report once before the first create so the caller can render the
   * up-front skips and the total alongside a zeroed progress bar.
   */
  reportProgress();

  for (const batch of plan.batches) {
    for (const row of batch) {
      let parentStatusPageGroupId: string | undefined = undefined;

      if (row.parentName !== "") {
        parentStatusPageGroupId = groupIdByName.get(row.parentName);

        if (!parentStatusPageGroupId) {
          results.push({
            line: row.line,
            name: row.name,
            status: "skipped",
            message: `Parent group "${row.parentName}" could not be created.`,
          });
          reportProgress();
          continue;
        }
      }

      let outcome: StatusPageGroupCreateResult;

      try {
        outcome = await options.createGroup(row, parentStatusPageGroupId);
      } catch (err) {
        /*
         * createGroup is contracted to report failures as values, but a
         * genuinely unexpected throw must still land on the row rather than
         * abort every row after it.
         */
        outcome = {
          created: false,
          errorMessage:
            err instanceof Error && err.message
              ? err.message
              : "Something went wrong while creating this group.",
        };
      }

      if (outcome.created) {
        if (outcome.statusPageGroupId) {
          groupIdByName.set(row.name, outcome.statusPageGroupId);
        }
        createdCount++;
        results.push({
          line: row.line,
          name: row.name,
          status: "created",
          message: "",
        });
      } else {
        results.push({
          line: row.line,
          name: row.name,
          status: "failed",
          message: outcome.errorMessage,
        });
      }

      reportProgress();
    }
  }

  return summarize(results, totalToCreate);
}
