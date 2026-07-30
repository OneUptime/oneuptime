import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import EventLoop from "Common/Server/Utils/EventLoop";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import crypto from "crypto";
import LogScrubRuleService from "./LogScrubRuleService";

/*
 * Server-side second net over a decoded rrweb event tree.
 *
 * Masking happens at capture, in the browser, before compression - that is
 * the primary control and this is not a substitute for it. This exists
 * because the primary control can be misconfigured (an unmasked selector, a
 * customer running an older pinned recorder, a masking regression) and
 * because a recording, unlike a span, cannot be re-derived after the fact.
 *
 * It reuses the RULE VOCABULARY of the log scrubber - the same LogScrubRule
 * rows, the same pattern types, the same actions - but NOT its walker. The
 * existing walker cannot be reused for two concrete reasons:
 *
 *   - it `continue`s on any non-string attribute value, and
 *   - it never recurses.
 *
 * An rrweb event stream is a deep tree: text sits in `textContent` on node
 * objects nested arbitrarily deep inside a FullSnapshot, in `text` on
 * incremental mutations, in `attributes` maps, and in `styleSheetRule`
 * payloads. A flat one-level pass over a `{string: string}` map would walk
 * straight past all of it.
 *
 * Because the tree is unbounded and attacker-influenceable (it is authored
 * by a customer's end users), the walker is depth-capped, node-capped, and
 * yields to the event loop periodically. Without the yield a single large
 * snapshot pins the worker's event loop long enough for the Kubernetes
 * liveness probe handler never to be scheduled, and the pod is restarted.
 */

/*
 * Structurally identical to the (unexported) CompiledRule in
 * LogScrubRuleService, so the array that method returns assigns to this
 * without a cast. Loading is delegated there deliberately: the pattern
 * table, the custom-regex compilation and the 60s cache all stay in one
 * place, and only the walker and the action application are new here.
 */
export interface CompiledScrubRule {
  rule: LogScrubRule;
  regex: RegExp;
}

/*
 * Depth ceiling. A legitimate DOM snapshot nests deeply but nowhere near
 * this; anything past it is either pathological markup or an attempt to
 * blow the stack, and in both cases the honest response is to stop
 * descending rather than to recurse and crash the worker.
 */
const MAX_DEPTH: number = 64;

/*
 * Node ceiling per chunk. A 256KB pre-compression chunk holds a few
 * thousand nodes; a large FullSnapshot can hold tens of thousands. Past this
 * we stop scrubbing and report it, so the caller can drop the chunk rather
 * than store a partially-scrubbed recording.
 */
const MAX_NODES: number = 250_000;

/* Yield roughly every 2,000 nodes visited. */
const YIELD_EVERY_NODES: number = 2000;

/*
 * Strings longer than this are not regex-scanned. A 2MB inlined stylesheet
 * matched against a dozen global regexes is a real CPU hazard, and
 * stylesheets are not where user text lives. Reported as a skip rather than
 * being silently ignored.
 */
const MAX_SCANNED_STRING_LENGTH: number = 64 * 1024;

export interface SessionReplayScrubResult {
  /*
   * True when the whole tree was walked within the caps. False means the
   * caller must DROP the chunk: a tree we could not finish scrubbing may
   * still contain unredacted content, and storing it would defeat the point
   * of having a second net.
   */
  isComplete: boolean;

  nodesVisited: number;
  stringsScrubbed: number;
  skippedOversizedStrings: number;
  truncatedAtDepth: boolean;
}

export default class SessionReplayScrubService {
  /*
   * Load the project's scrub rules.
   *
   * Deliberately does NOT catch. OtelLogsIngestService and
   * OtelTracesIngestService both swallow this failure and continue with an
   * empty rule array; for replay that would mean writing an unscrubbed
   * recording because Postgres was briefly unreachable. The caller must
   * treat a throw as "drop the chunk".
   */
  public static async loadRules(
    projectId: ObjectID,
  ): Promise<Array<CompiledScrubRule>> {
    return await LogScrubRuleService.loadScrubRules(projectId);
  }

  /*
   * Scrub an rrweb event array in place.
   *
   * In place, rather than returning a copy, because the tree is already the
   * only copy the worker holds and duplicating a multi-hundred-KB structure
   * per chunk would double the worker's peak memory for no benefit.
   */
  public static async scrubEvents(
    events: Array<JSONValue>,
    compiledRules: Array<CompiledScrubRule>,
  ): Promise<SessionReplayScrubResult> {
    const state: SessionReplayScrubResult = {
      isComplete: true,
      nodesVisited: 0,
      stringsScrubbed: 0,
      skippedOversizedStrings: 0,
      truncatedAtDepth: false,
    };

    if (compiledRules.length === 0) {
      /*
       * No rules configured is a legitimate state, not a failure: masking
       * at capture is the primary control and most projects will never add
       * a scrub rule. Distinguishing this from "rules could not be loaded"
       * is exactly why loadRules throws instead of returning [].
       */
      return state;
    }

    await this.walkArray(events, compiledRules, 0, state);

    return state;
  }

  private static async walkArray(
    values: Array<JSONValue>,
    compiledRules: Array<CompiledScrubRule>,
    depth: number,
    state: SessionReplayScrubResult,
  ): Promise<void> {
    if (depth > MAX_DEPTH) {
      state.truncatedAtDepth = true;
      state.isComplete = false;
      return;
    }

    for (let index: number = 0; index < values.length; index++) {
      if (!(await this.visitNode(state))) {
        return;
      }

      const value: JSONValue | undefined = values[index];

      if (typeof value === "string") {
        /*
         * Array elements can be user text too: rrweb carries CSS rule text
         * and console arguments as bare string arrays.
         */
        values[index] = this.scrubString(value, compiledRules, state);
        continue;
      }

      if (Array.isArray(value)) {
        await this.walkArray(
          value as Array<JSONValue>,
          compiledRules,
          depth + 1,
          state,
        );
        continue;
      }

      if (value && typeof value === "object") {
        await this.walkObject(
          value as JSONObject,
          compiledRules,
          depth + 1,
          state,
        );
      }
    }
  }

  private static async walkObject(
    node: JSONObject,
    compiledRules: Array<CompiledScrubRule>,
    depth: number,
    state: SessionReplayScrubResult,
  ): Promise<void> {
    if (depth > MAX_DEPTH) {
      state.truncatedAtDepth = true;
      state.isComplete = false;
      return;
    }

    for (const key of Object.keys(node)) {
      if (!(await this.visitNode(state))) {
        return;
      }

      const value: JSONValue | undefined = node[key];

      if (typeof value === "string") {
        node[key] = this.scrubValueForKey(key, value, compiledRules, state);
        continue;
      }

      if (Array.isArray(value)) {
        await this.walkArray(
          value as Array<JSONValue>,
          compiledRules,
          depth + 1,
          state,
        );
        continue;
      }

      if (value && typeof value === "object") {
        await this.walkObject(
          value as JSONObject,
          compiledRules,
          depth + 1,
          state,
        );
      }
    }
  }

  /*
   * Count a visited node, yielding to the event loop periodically and
   * signalling the caller to stop once the node cap is hit.
   */
  private static async visitNode(
    state: SessionReplayScrubResult,
  ): Promise<boolean> {
    state.nodesVisited++;

    if (state.nodesVisited > MAX_NODES) {
      state.isComplete = false;
      return false;
    }

    if (state.nodesVisited % YIELD_EVERY_NODES === 0) {
      await EventLoop.yieldToEventLoop();
    }

    return true;
  }

  /*
   * Apply value-shaped rules to a string, plus key-targeted rules when the
   * property name itself looks sensitive.
   *
   * The key-targeted case is what catches secrets that match no shape - a
   * random password, an opaque bearer token - and in an rrweb tree the
   * property name is genuinely informative: `attributes.value`,
   * `attributes["data-token"]`, `attributes.href` and so on.
   */
  private static scrubValueForKey(
    key: string,
    value: string,
    compiledRules: Array<CompiledScrubRule>,
    state: SessionReplayScrubResult,
  ): string {
    let result: string = value;

    for (const compiled of compiledRules) {
      const patternType: string = (compiled.rule.patternType as string) || "";

      if (patternType !== LogScrubPatternType.SensitiveKeys) {
        continue;
      }

      compiled.regex.lastIndex = 0;

      if (compiled.regex.test(key)) {
        state.stringsScrubbed++;

        return this.applyScrubAction(
          result,
          (compiled.rule.scrubAction as string) || LogScrubAction.Redact,
          LogScrubPatternType.SensitiveKeys,
        );
      }
    }

    result = this.scrubString(result, compiledRules, state);

    return result;
  }

  private static scrubString(
    value: string,
    compiledRules: Array<CompiledScrubRule>,
    state: SessionReplayScrubResult,
  ): string {
    if (!value) {
      return value;
    }

    if (value.length > MAX_SCANNED_STRING_LENGTH) {
      state.skippedOversizedStrings++;
      return value;
    }

    let result: string = value;

    for (const compiled of compiledRules) {
      const patternType: string = (compiled.rule.patternType as string) || "";

      /* Key-targeted rules never scan free text - there is no key here. */
      if (patternType === LogScrubPatternType.SensitiveKeys) {
        continue;
      }

      const action: string =
        (compiled.rule.scrubAction as string) || LogScrubAction.Redact;

      /*
       * The compiled patterns are global, so lastIndex must be reset before
       * every use or a second string is scanned from wherever the previous
       * match ended.
       */
      compiled.regex.lastIndex = 0;

      const replaced: string = result.replace(
        compiled.regex,
        (match: string): string => {
          return this.applyScrubAction(match, action, patternType);
        },
      );

      if (replaced !== result) {
        state.stringsScrubbed++;
        result = replaced;
      }
    }

    return result;
  }

  /*
   * Same three actions and the same output shapes as the log scrubber, so a
   * customer's rules mean the same thing wherever they are applied. Kept
   * local because the log service's version is private; the shapes are
   * pinned by SessionReplayScrubService.test.ts.
   */
  private static applyScrubAction(
    match: string,
    action: string,
    patternType: string,
  ): string {
    switch (action) {
      case LogScrubAction.Redact:
        return "[REDACTED]";

      case LogScrubAction.Hash: {
        const hash: string = crypto
          .createHash("sha256")
          .update(match)
          .digest("hex")
          .substring(0, 8);
        return `[HASHED:${hash}]`;
      }

      case LogScrubAction.Mask:
        return this.maskValue(match, patternType);

      default:
        return "[REDACTED]";
    }
  }

  private static maskValue(value: string, patternType: string): string {
    switch (patternType) {
      case LogScrubPatternType.Email: {
        const atIndex: number = value.indexOf("@");

        if (atIndex > 0) {
          const dotIndex: number = value.lastIndexOf(".");

          if (dotIndex > atIndex) {
            return value[0] + "***@***" + value.substring(dotIndex);
          }
        }

        return "***@***.***";
      }

      case LogScrubPatternType.CreditCard: {
        const digits: string = value.replace(/[-\s]/g, "");

        if (digits.length >= 4) {
          return "****-****-****-" + digits.substring(digits.length - 4);
        }

        return "****-****-****-****";
      }

      case LogScrubPatternType.SSN:
        return "***-**-" + value.substring(value.length - 4);

      case LogScrubPatternType.PhoneNumber: {
        const phoneDigits: string = value.replace(/[^0-9]/g, "");

        if (phoneDigits.length >= 4) {
          return "***-***-" + phoneDigits.substring(phoneDigits.length - 4);
        }

        return "***-***-****";
      }

      case LogScrubPatternType.IPAddress:
        return "***.***.***.***";

      default: {
        if (value.length <= 2) {
          return "***";
        }

        return (
          value[0] +
          "*".repeat(Math.max(value.length - 2, 3)) +
          value[value.length - 1]!
        );
      }
    }
  }
}
