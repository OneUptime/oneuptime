import {
  ParsedSiteRow,
  SiteImportPlan,
  SkippedSiteRow,
  planSiteImport,
} from "./NetworkSiteCsv";

/*
 * The create-loop behind the Network Sites bulk import, kept react-free and
 * transport-free for the same reason NetworkSiteCsv is: it must never import
 * Common/UI/Config (it touches window at module load), so the node-env jest
 * suite in App/Tests/Dashboard can drive the whole ordering / parent-
 * resolution / partial-failure story without a renderer.
 *
 * The caller supplies `createSite`, which is the only part that talks to the
 * API. It reports its own outcome rather than throwing, so error phrasing
 * (API.getFriendlyMessage) stays in the UI layer where it belongs.
 */

export type SiteImportRowStatus = "created" | "failed" | "skipped";

export interface SiteImportRowResult {
  // 1-based line in the CSV this result belongs to.
  line: number;
  name: string;
  status: SiteImportRowStatus;
  // Empty for a created row; the reason otherwise.
  message: string;
}

export interface SiteImportProgress {
  // Every result so far, in the order they were decided.
  results: Array<SiteImportRowResult>;
  createdCount: number;
  // Rows the plan intends to create — skipped rows are not counted.
  totalToCreate: number;
}

export interface SiteImportSummary extends SiteImportProgress {
  failedCount: number;
  skippedCount: number;
}

/*
 * Outcome of creating one site. A failure is a value, not an exception, so
 * one bad row never aborts the run and the message can be formatted by
 * whoever owns the transport.
 */
export type SiteCreateResult =
  | { created: true; siteId: string | undefined }
  | { created: false; errorMessage: string };

export type CreateSiteFunction = (
  row: ParsedSiteRow,
  // The id of the already-created parent, or undefined for a root site.
  parentSiteId: string | undefined,
) => Promise<SiteCreateResult>;

export interface RunSiteImportOptions {
  rows: Array<ParsedSiteRow>;
  /*
   * Sites that already exist in the project, by name. Read for parent
   * resolution and for the "already exists" skip; never mutated — the run
   * works on its own copy.
   */
  existingSiteIdByName: Map<string, string>;
  createSite: CreateSiteFunction;
  // Called after the skip pass and after every attempted row.
  onProgress?: ((progress: SiteImportProgress) => void) | undefined;
}

function summarize(
  results: Array<SiteImportRowResult>,
  totalToCreate: number,
): SiteImportSummary {
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
 * planSiteImport groups the rows into dependency-ordered batches, so by the
 * time a child is attempted its parent's id is already in the name->id map
 * (either it was there to begin with, or an earlier batch created it). A row
 * whose parent batch-mate failed to create has no id to point at, so it is
 * skipped rather than created as an accidental root — a silently re-parented
 * site is far worse than a reported skip.
 */
export async function runSiteImport(
  options: RunSiteImportOptions,
): Promise<SiteImportSummary> {
  // Copy: the caller's map is an input, not scratch space.
  const siteIdByName: Map<string, string> = new Map<string, string>(
    options.existingSiteIdByName,
  );

  const plan: SiteImportPlan = planSiteImport(
    options.rows,
    Array.from(siteIdByName.keys()),
  );

  const results: Array<SiteImportRowResult> = [];

  const totalToCreate: number = plan.batches.reduce(
    (sum: number, batch: Array<ParsedSiteRow>): number => {
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

  for (const skipped of plan.skipped as Array<SkippedSiteRow>) {
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
      let parentSiteId: string | undefined = undefined;

      if (row.parentName !== "") {
        parentSiteId = siteIdByName.get(row.parentName);

        if (!parentSiteId) {
          results.push({
            line: row.line,
            name: row.name,
            status: "skipped",
            message: `Parent site "${row.parentName}" could not be created.`,
          });
          reportProgress();
          continue;
        }
      }

      let outcome: SiteCreateResult;

      try {
        outcome = await options.createSite(row, parentSiteId);
      } catch (err) {
        /*
         * createSite is contracted to report failures as values, but a
         * genuinely unexpected throw must still land on the row rather than
         * abort every row after it.
         */
        outcome = {
          created: false,
          errorMessage:
            err instanceof Error && err.message
              ? err.message
              : "Something went wrong while creating this site.",
        };
      }

      if (outcome.created) {
        if (outcome.siteId) {
          siteIdByName.set(row.name, outcome.siteId);
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
