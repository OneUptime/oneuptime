import {
  AutoImportRuleRunResult,
  MAX_AUTO_IMPORT_RUN_PASSES,
  RuleRunResultUtil,
} from "../../Types/NetworkAutomation/RuleRunResult";

/*
 * Driving one press of "Run Rule" over several capped server passes.
 *
 * A real auto-import run is bounded server-side — the engine's per-run device
 * and monitor caps — so a rule that meets a /16 can never become one
 * unbounded API request. Until OneUptime issue #3642 that bound was the
 * operator's problem to notice and work around: a 909-device estate imported
 * 500, stopped, and finishing it meant reading the cap line at the end of the
 * report and pressing the button again. What the report reads like was only
 * half of that bug; the other half was that one press did not finish the job.
 *
 * A pass resumes from the previous pass's writes — devices are idempotent per
 * (project, address) and monitors per (device, template) — so chaining never
 * repeats work, and stopping half way is safe. That makes this a plain loop
 * with three exits: the run said it is done, it made no progress (so another
 * identical pass would not either), or the chain hit its own ceiling and the
 * operator gets a report saying exactly what is left.
 *
 * Pure and renderer-free so the behaviour is unit-testable without mounting a
 * modal — the same reason RuleRunResultUtil's wording lives in Types.
 */

export interface AutoImportRunChainOptions {
  /*
   * Performs one server pass. Returns null when the pass FAILED: the chain
   * stops and answers with whatever earlier passes achieved, because a
   * failure on pass three does not undo the 1,000 devices passes one and two
   * imported. The caller reports the error itself, where it has the response.
   */
  runPass: () => Promise<AutoImportRuleRunResult | null>;
  /*
   * A dry run writes nothing, so a second pass would evaluate the identical
   * estate and answer identically. It stays one pass and reports what it
   * would have left over.
   */
  isDryRun: boolean;
  // Called after each truncated pass with the merged result so far.
  onProgress?: ((progress: AutoImportRuleRunResult) => void) | undefined;
  /*
   * Checked between passes. A modal the operator closed must not keep
   * importing behind them.
   */
  isCancelled?: (() => boolean) | undefined;
  // Overridable for tests; defaults to MAX_AUTO_IMPORT_RUN_PASSES.
  maxPasses?: number | undefined;
}

export interface AutoImportRunChainOutcome {
  /*
   * Every pass merged into one report, or null when the first pass failed
   * and there is nothing to show.
   */
  result: AutoImportRuleRunResult | null;
  // How many passes actually ran and answered.
  passCount: number;
  // True when isCancelled ended the chain rather than the work finishing.
  wasCancelled: boolean;
}

export default class AutoImportRunChain {
  public static async run(
    options: AutoImportRunChainOptions,
  ): Promise<AutoImportRunChainOutcome> {
    const passes: Array<AutoImportRuleRunResult> = [];

    const maxPasses: number = options.isDryRun
      ? 1
      : options.maxPasses || MAX_AUTO_IMPORT_RUN_PASSES;

    const isCancelled: () => boolean = (): boolean => {
      return Boolean(options.isCancelled && options.isCancelled());
    };

    for (let pass: number = 0; pass < maxPasses; pass++) {
      const passResult: AutoImportRuleRunResult | null =
        await options.runPass();

      /*
       * Record what came back BEFORE honouring the cancel: a pass that
       * already ran already wrote its devices and monitors, and dropping its
       * result would under-report real work the operator now has to
       * reconcile by hand.
       */
      if (passResult) {
        passes.push(passResult);
      }

      if (isCancelled()) {
        return {
          result: passes.length > 0 ? merge(passes) : null,
          passCount: passes.length,
          wasCancelled: true,
        };
      }

      // The pass failed. Keep what the earlier ones did and stop.
      if (!passResult) {
        break;
      }

      if (!passResult.isTruncated) {
        break;
      }

      /*
       * Truncated with nothing to show for it: every attempt in this pass
       * failed, or a concurrent sweep had already spent the caps. Another
       * identical pass would fail identically, so stop and let the report
       * say what is left rather than looping on a wall.
       */
      if (passResult.devicesCreated === 0 && passResult.monitorsCreated === 0) {
        break;
      }

      if (options.onProgress) {
        options.onProgress(merge(passes));
      }
    }

    return {
      result: passes.length > 0 ? merge(passes) : null,
      passCount: passes.length,
      wasCancelled: false,
    };
  }
}

function merge(
  passes: Array<AutoImportRuleRunResult>,
): AutoImportRuleRunResult {
  return RuleRunResultUtil.mergeAutoImportRunPasses(passes);
}
