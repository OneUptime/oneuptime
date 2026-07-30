import BadDataException from "../../Types/Exception/BadDataException";
import {
  MAX_SAMPLE_PERCENTAGE,
  MIN_SAMPLE_PERCENTAGE,
} from "../../Types/Telemetry/DropFilterSampling";

/*
 * Shared save-time validation for log and trace drop filters.
 *
 * Both drop-filter models have historically accepted configurations the
 * ingest engine could not honour, and both failed silently and
 * destructively:
 *
 *   - A blank `filterQuery` compiles to "match every record", so a drop
 *     filter saved with an empty query discards 100% of a project's
 *     telemetry. Nothing warned, and nothing recorded the drops.
 *
 *   - `samplePercentage` is nullable with no default and the form field is
 *     optional, so `action = "sample"` could be saved with no percentage at
 *     all. The engine then fell back to a hardcoded 50, i.e. "silently
 *     throw away half of it", while the UI rendered the unset value as
 *     "0% kept".
 *
 * Rejecting both at the API boundary is the only place a human is present
 * to read the error. The ingest path additionally fails *safe* on rows that
 * predate this validation (see DropFilterSampling.resolveSamplePercentage
 * and LogDropFilterService.loadDropFilters).
 *
 * Deliberately not validated here: whether `filterQuery` actually parses.
 * The parser lives in the App feature set, which Common must not import,
 * and an unparsable query compiles to "match nothing" — a harmless no-op
 * rather than a data-destroying one.
 */

/*
 * Both LogDropFilterAction and TraceDropFilterAction spell this "sample";
 * comparing the raw string keeps this validator usable from both services
 * without either enum leaking in.
 */
export const SAMPLE_ACTION: string = "sample";

export interface DropFilterCandidate {
  action: string | undefined | null;
  samplePercentage: number | undefined | null;
  filterQuery: string | undefined | null;
}

export interface DropFilterValidationOptions {
  /*
   * "logs" or "spans" — only used to make the error message read like the
   * product surface the user is actually on.
   */
  recordNoun: string;
}

export function validateDropFilterFilterQuery(
  filterQuery: string | undefined | null,
  options: DropFilterValidationOptions,
): void {
  if (
    filterQuery === undefined ||
    filterQuery === null ||
    filterQuery.trim().length === 0
  ) {
    throw new BadDataException(
      `Filter query is required. A drop filter with an empty query matches every record, which would discard all of this project's ${options.recordNoun}. Add a condition, or delete the filter.`,
    );
  }
}

export function validateDropFilterSamplePercentage(
  candidate: DropFilterCandidate,
  options: DropFilterValidationOptions,
): void {
  if (candidate.action !== SAMPLE_ACTION) {
    return;
  }

  const samplePercentage: number | undefined | null =
    candidate.samplePercentage;

  if (
    typeof samplePercentage !== "number" ||
    !Number.isFinite(samplePercentage)
  ) {
    throw new BadDataException(
      `Sample percentage is required when the action is "Sample". Enter the percentage of matching ${options.recordNoun} to keep, between ${MIN_SAMPLE_PERCENTAGE} and ${MAX_SAMPLE_PERCENTAGE}.`,
    );
  }

  if (
    samplePercentage < MIN_SAMPLE_PERCENTAGE ||
    samplePercentage > MAX_SAMPLE_PERCENTAGE
  ) {
    throw new BadDataException(
      `Sample percentage must be between ${MIN_SAMPLE_PERCENTAGE} and ${MAX_SAMPLE_PERCENTAGE}. Use the "Drop" action to discard every matching record, or disable the filter to keep every one.`,
    );
  }
}

/*
 * Validate a fully-resolved candidate row. Callers building this from an
 * update must merge the incoming partial over the stored row first, so a
 * request that flips `action` to "sample" without supplying a percentage is
 * still caught.
 */
export function validateDropFilter(
  candidate: DropFilterCandidate,
  options: DropFilterValidationOptions,
): void {
  validateDropFilterFilterQuery(candidate.filterQuery, options);
  validateDropFilterSamplePercentage(candidate, options);
}

/*
 * `PartialEntity` values may be `() => string` raw SQL expressions rather
 * than literals. We cannot evaluate one here, so an update that sets a
 * validated field to an expression cannot be checked — validating a
 * stringified function would be worse than not validating at all.
 *
 * Nothing in the product writes drop-filter fields this way; the branch
 * exists so the types stay honest and a future caller that does it gets
 * skipped rather than spuriously rejected.
 */
export function isSqlExpressionValue(value: unknown): boolean {
  return typeof value === "function";
}
