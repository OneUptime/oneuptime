/*
 * Sampling decision shared by the log and trace drop-filter engines.
 *
 * This used to be `filter.samplePercentage || 50` duplicated in two
 * services, which had three separate problems:
 *
 *   1. `samplePercentage` is nullable with no default and the form field
 *      was optional, so an UNSET percentage silently became "throw away
 *      half of every matching record" — while the view page rendered the
 *      same unset value as "0% kept".
 *   2. A stored `0` was indistinguishable from unset, so it also kept 50%.
 *   3. The two copies could drift.
 *
 * The fix is to fail SAFE: a percentage we cannot honour makes the filter a
 * no-op rather than a data shredder. Callers that want "discard everything
 * matching" have an explicit `drop` action for that.
 *
 * Note on the `0` case specifically. A literal reading of `0` is "keep 0%",
 * i.e. drop every matching record — but `0` NEVER meant that in any shipped
 * version (it kept half), so honouring it now would start deleting data
 * that used to survive. Treating it as misconfigured is strictly less
 * destructive than both the old behaviour and the literal reading, and
 * save-time validation (Common/Server/Utils/DropFilterValidation.ts) stops
 * new rows from getting there at all.
 */

// Keep everything: the fail-safe value for a percentage we can't honour.
export const KEEP_ALL_PERCENTAGE: number = 100;

/*
 * The range a human is allowed to save. Enforced at the API boundary by
 * Common/Server/Utils/DropFilterValidation.ts and mirrored in the dashboard
 * form; kept here so the validator, the form and the engine cannot drift
 * apart on what counts as a usable percentage.
 */
export const MIN_SAMPLE_PERCENTAGE: number = 1;
export const MAX_SAMPLE_PERCENTAGE: number = 99;

/*
 * Whether a stored value is one the engine will actually sample on. The
 * dashboard uses this to render "not configured" instead of the "0% kept"
 * it used to show for an unset percentage — a display that directly
 * contradicted the engine's old behaviour of keeping half.
 */
export function isSamplePercentageConfigured(
  samplePercentage: number | undefined | null,
): boolean {
  return resolveSamplePercentage(samplePercentage) < KEEP_ALL_PERCENTAGE;
}

/*
 * Normalize a stored `samplePercentage` into a percentage-to-KEEP.
 *
 * Anything that is not a finite number in the exclusive range (0, 100) is
 * misconfigured and resolves to "keep everything".
 */
export function resolveSamplePercentage(
  samplePercentage: number | undefined | null,
): number {
  if (
    typeof samplePercentage !== "number" ||
    !Number.isFinite(samplePercentage)
  ) {
    return KEEP_ALL_PERCENTAGE;
  }

  if (samplePercentage <= 0 || samplePercentage >= KEEP_ALL_PERCENTAGE) {
    return KEEP_ALL_PERCENTAGE;
  }

  return samplePercentage;
}

/*
 * True when a sample-action filter should discard this record.
 *
 * `random` is injectable so the decision is testable without stubbing
 * global Math.random. It is only consulted when the percentage actually
 * calls for sampling, so a keep-everything filter costs no entropy.
 */
export function shouldDropBySampling(
  samplePercentage: number | undefined | null,
  random: () => number = Math.random,
): boolean {
  const keepPercentage: number = resolveSamplePercentage(samplePercentage);

  if (keepPercentage >= KEEP_ALL_PERCENTAGE) {
    return false;
  }

  return random() * 100 >= keepPercentage;
}
