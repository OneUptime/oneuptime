import { LoaderConfig } from "./Config";

/*
 * Normalisation for the config fields the ARTIFACT acts on but the loader
 * stub does not validate.
 *
 * The loader lives under a hard byte budget, so its validateConfig only
 * spends bytes on fields the loader itself gates on; everything else rides
 * through as the unvalidated LoaderConfig.raw passthrough. This module is
 * the other half of that bargain: every read below must survive a hostile
 * or absent value, and every default is the feature-OFF one — no origins,
 * no budgets, not targeted. A cached stub from before the passthrough
 * existed hands us a config with no `raw` at all, and that must mean
 * "these features are off", never a crash.
 *
 * Bundled into the recorder artifact only. The loader must never import
 * this file — SourceHygiene.test.ts pins the stub's module list.
 */

export interface ExtendedReplayConfig {
  /* Origins that may receive an injected traceparent. Empty = never. */
  tracePropagationOrigins: Array<string>;

  /* Performance budgets in milliseconds; 0 disables each trigger. */
  lcpBudgetMs: number;
  longTaskBudgetMs: number;
  slowRequestBudgetMs: number;

  /* This boot matched a "record this user's next session" target. */
  isTargeted: boolean;
}

export function readExtendedConfig(
  config: LoaderConfig | null | undefined,
): ExtendedReplayConfig {
  /*
   * Prefer the raw body; fall back to the config object itself so a test
   * (or a future loader that does validate these) can also feed us.
   */
  const source: Record<string, unknown> =
    config && config.raw && typeof config.raw === "object"
      ? config.raw
      : ((config || {}) as unknown as Record<string, unknown>);

  return {
    tracePropagationOrigins: readStringArray(source["tracePropagationOrigins"]),
    lcpBudgetMs: readBudgetMs(source["lcpBudgetMs"]),
    longTaskBudgetMs: readBudgetMs(source["longTaskBudgetMs"]),
    slowRequestBudgetMs: readBudgetMs(source["slowRequestBudgetMs"]),
    isTargeted: source["isTargeted"] === true,
  };
}

/*
 * A budget is a positive finite number of milliseconds or it is off.
 * Negative, NaN, Infinity and non-numbers all normalise to 0 (disabled)
 * rather than to something a comparison could misread as "always fire".
 */
function readBudgetMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value;
}

function readStringArray(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry: unknown): entry is string => {
    return typeof entry === "string" && entry.length > 0;
  });
}
