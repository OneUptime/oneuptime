import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import { EventLoopBudget } from "Common/Server/Utils/EventLoop";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import LogScrubRuleService from "./LogScrubRuleService";
import PatternWorkScope from "Common/Server/Utils/PatternWorkScope";
import ScrubAction from "Common/Server/Utils/Telemetry/ScrubAction";
import { getScrubRulesOfRecord } from "Common/Types/Telemetry/ScrubRuleScope";

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
  regex: ScrubRegExp;
}

/*
 * Depth ceiling, counted in JSON nesting levels rather than DOM levels.
 *
 * That distinction is why this is 512 and not the 64 it started at: an rrweb
 * serialized node costs TWO levels per DOM element (walkObject(node) ->
 * childNodes array -> walkArray -> child object -> walkObject), so 64 was an
 * effective ceiling of roughly 30 nested elements once the event / data /
 * node preamble is paid for. Tailwind, MUI and Angular component trees
 * routinely exceed that, and exceeding it sets isComplete = false, which
 * makes the caller DROP the chunk - so the old value could silently discard
 * 100% of a customer's recordings from the moment they added their first
 * scrub rule (with zero rules the walk is skipped entirely).
 *
 * The real bound on work is MAX_NODES; this is only a stack guard, and the
 * recursion is awaited so the JS stack is not the constraint.
 */
const MAX_DEPTH: number = 512;

/*
 * Node ceiling per chunk. A 256KB pre-compression chunk holds a few
 * thousand nodes; a large FullSnapshot can hold tens of thousands. Past this
 * we stop scrubbing and report it, so the caller can drop the chunk rather
 * than store a partially-scrubbed recording.
 */
const MAX_NODES: number = 250_000;

/*
 * The event loop is handed back by the time the walk's work took, not
 * every 2,000 nodes: a node's work grows with its text - up to
 * MAX_SCANNED_STRING_LENGTH read by every rule of the project - so 2,000
 * nodes of inlined text held the loop for seconds. One budget for each
 * walk, asked before each node (Common/Server/Utils/EventLoop.ts, #8925).
 */
const walkBudgets: WeakMap<SessionReplayScrubResult, EventLoopBudget> =
  new WeakMap<SessionReplayScrubResult, EventLoopBudget>();

/*
 * Strings longer than this are not regex-scanned. A 2MB inlined stylesheet
 * matched against a dozen global regexes is a real CPU hazard, and
 * stylesheets are not where user text lives. Reported as a skip rather than
 * being silently ignored.
 */
const MAX_SCANNED_STRING_LENGTH: number = 64 * 1024;

/*
 * ---- What is NOT user text, and is therefore never scanned. ----
 *
 * Audit finding ingest-14. The walker used to run every value rule over
 * every string in the tree, and an rrweb tree is mostly NOT text: it is
 * node ids, tag names, class lists, inline styles, SVG path data and
 * base64 image sources. A credit-card or phone rule that happens to match
 * a run of digits in an SVG path or a data: URI rewrote it to "[REDACTED]"
 * and broke the layout on playback, with nothing anywhere explaining why.
 * A SensitiveKeys rule matching "name" or "type" could redact the
 * attribute values the DOM needs to be a DOM at all.
 *
 * So scanning is restricted to text-bearing fields. Two lists:
 *
 *   - NODE_STRUCTURAL_KEYS are keys of rrweb event / node objects whose
 *     values describe the tree (types, ids, positions), never content.
 *   - PLUMBING_ATTRIBUTE_NAMES are DOM attributes inside an `attributes`
 *     map whose values are addresses, styling or geometry. Everything
 *     else in an attributes map IS scanned: value, placeholder, title,
 *     alt, aria-*, data-*, href, content - the places user text sits.
 *
 * Plus one shape rule: a string that is a data: URI is skipped wherever it
 * appears, because its body is encoded bytes and a match inside it is
 * noise that corrupts an image.
 *
 * Every skip is counted (skippedStructuralStrings) rather than silent, for
 * the same reason the oversize skip is.
 */
const NODE_STRUCTURAL_KEYS: ReadonlySet<string> = new Set<string>([
  "type",
  "tagName",
  "id",
  "rootId",
  "parentId",
  "nextId",
  "previousId",
  "timestamp",
  "source",
  "isSVG",
  "isStyle",
  "isShadowHost",
  "isShadow",
  "needBlock",
  "publicId",
  "systemId",
  "style",
  "tag",
  "pointerType",
  "positions",
  "x",
  "y",
  "width",
  "height",
]);

const PLUMBING_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set<string>([
  "src",
  "srcset",
  "style",
  "class",
  "classname",
  "id",
  "name",
  "for",
  "type",
  "rel",
  "width",
  "height",
  "poster",
  "xlink:href",
  "d",
  "points",
  "viewbox",
  "transform",
  "fill",
  "stroke",
  "stroke-width",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "dx",
  "dy",
  "integrity",
  "crossorigin",
  "loading",
  "decoding",
  "sizes",
  "media",
  "charset",
  "lang",
  "dir",
  "tabindex",
  "role",
  "rr_width",
  "rr_height",
  "rr_mediastate",
  "rr_scrollleft",
  "rr_scrolltop",
  "rr_dataurl",
  "rr_open_mode",
]);

const DATA_URI_PREFIX: RegExp = /^data:/i;

interface WalkContext {
  /*
   * True while walking the `attributes` map of a serialized node or an
   * attribute mutation, where keys are DOM attribute names and the
   * plumbing list applies instead of the structural one.
   */
  isAttributeMap: boolean;
}

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
  /*
   * Strings deliberately left unscanned because they are tree plumbing
   * (ids, class lists, SVG geometry, data: URIs), not user text.
   */
  skippedStructuralStrings: number;
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
   *
   * Only the rules that apply to the replay's RUM application: a rule that
   * names a service scrubs that service's logs alone, and a replay is no
   * service's (Types/Telemetry/ScrubRuleScope, #10433).
   */
  public static async loadRules(
    projectId: ObjectID,
    rumApplicationId?: ObjectID | string | null | undefined,
  ): Promise<Array<CompiledScrubRule>> {
    return getScrubRulesOfRecord(
      await LogScrubRuleService.loadScrubRules(projectId),
      rumApplicationId,
    );
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
      skippedStructuralStrings: 0,
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

    walkBudgets.set(state, new EventLoopBudget());

    await this.walkArray(events, compiledRules, 0, state, {
      isAttributeMap: false,
    });

    return state;
  }

  private static async walkArray(
    values: Array<JSONValue>,
    compiledRules: Array<CompiledScrubRule>,
    depth: number,
    state: SessionReplayScrubResult,
    context: WalkContext,
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
        if (this.isDataUri(value)) {
          state.skippedStructuralStrings++;
          continue;
        }

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
          context,
        );
        continue;
      }

      if (value && typeof value === "object") {
        await this.walkObject(
          value as JSONObject,
          compiledRules,
          depth + 1,
          state,
          /*
           * An array of objects under `attributes` (an attribute mutation
           * list) holds mutation records, not attribute maps; the map is
           * the `attributes` key INSIDE each record.
           */
          { isAttributeMap: false },
        );
      }
    }
  }

  private static async walkObject(
    node: JSONObject,
    compiledRules: Array<CompiledScrubRule>,
    depth: number,
    state: SessionReplayScrubResult,
    context: WalkContext,
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

      if (this.isStructuralKey(key, context)) {
        /*
         * Skipped WHOLE, subtree included: a `style` attribute mutation
         * arrives as an object of CSS properties, and none of it is text
         * a person typed.
         */
        if (typeof value === "string") {
          state.skippedStructuralStrings++;
        }

        continue;
      }

      if (typeof value === "string") {
        if (this.isDataUri(value)) {
          state.skippedStructuralStrings++;
          continue;
        }

        node[key] = this.scrubValueForKey(key, value, compiledRules, state);
        continue;
      }

      if (Array.isArray(value)) {
        await this.walkArray(
          value as Array<JSONValue>,
          compiledRules,
          depth + 1,
          state,
          { isAttributeMap: false },
        );
        continue;
      }

      if (value && typeof value === "object") {
        await this.walkObject(
          value as JSONObject,
          compiledRules,
          depth + 1,
          state,
          { isAttributeMap: key === "attributes" },
        );
      }
    }
  }

  private static isStructuralKey(key: string, context: WalkContext): boolean {
    if (context.isAttributeMap) {
      return PLUMBING_ATTRIBUTE_NAMES.has(key.toLowerCase());
    }

    return NODE_STRUCTURAL_KEYS.has(key);
  }

  private static isDataUri(value: string): boolean {
    return value.length > 5 && DATA_URI_PREFIX.test(value.substring(0, 5));
  }

  /*
   * Count a visited node, handing the event loop back once the walk's work
   * since the last time took its budget, and signalling the caller to stop
   * once the node cap is hit.
   */
  private static async visitNode(
    state: SessionReplayScrubResult,
  ): Promise<boolean> {
    state.nodesVisited++;

    if (state.nodesVisited > MAX_NODES) {
      state.isComplete = false;
      return false;
    }

    const eventLoopBudget: EventLoopBudget | undefined = walkBudgets.get(state);

    if (eventLoopBudget !== undefined && eventLoopBudget.isSpent()) {
      await eventLoopBudget.handBack();
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

      if (compiled.regex.test(key)) {
        state.stringsScrubbed++;

        return this.applyScrubAction(
          result,
          (compiled.rule.scrubAction as string) || LogScrubAction.Redact,
          LogScrubPatternType.SensitiveKeys,
          compiled.rule.projectId,
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

    /*
     * The text adds its share to the batch's work allowance when the first
     * rule is asked about it (Common/Server/Utils/PatternWorkScope.ts); the
     * rules after it read what the ones before left, which adds nothing.
     */
    PatternWorkScope.handOverRecord(value);

    let result: string = value;

    for (const compiled of compiledRules) {
      const patternType: string = (compiled.rule.patternType as string) || "";

      /* Key-targeted rules never scan free text - there is no key here. */
      if (patternType === LogScrubPatternType.SensitiveKeys) {
        continue;
      }

      const action: string =
        (compiled.rule.scrubAction as string) || LogScrubAction.Redact;

      const replaced: string = compiled.regex.replace(
        result,
        (match: string): string => {
          return this.applyScrubAction(
            match,
            action,
            patternType,
            compiled.rule.projectId,
          );
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
   * customer's rules mean the same thing wherever they are applied: the log,
   * trace and session replay scrubbers all ask the one module
   * (Common/Server/Utils/Telemetry/ScrubAction). A Hash rule makes its
   * project's token there (ScrubHashToken, #10394), as a log rule does -
   * the same rule hashes a value alike in a recording and in a log line.
   */
  private static applyScrubAction(
    match: string,
    action: string,
    patternType: string,
    projectId?: ObjectID | string | null | undefined,
  ): string {
    return ScrubAction.apply({
      match: match,
      action: action,
      patternType: patternType,
      projectId: projectId,
    });
  }
}
