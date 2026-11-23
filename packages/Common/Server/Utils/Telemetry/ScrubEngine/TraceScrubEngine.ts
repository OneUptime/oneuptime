import { JSONObject } from "../../../../Types/JSON";
import {
  LlmTeamAttributeKeys,
  LlmUserEmailAttributeKeys,
  LlmUserIdAttributeKeys,
} from "../../../../Types/Telemetry/LlmConventions";
import { getScrubRulesOfRecord } from "../../../../Types/Telemetry/ScrubRuleScope";
import TraceScrubAction from "../../../../Types/Trace/TraceScrubAction";
import TraceScrubField from "../../../../Types/Trace/TraceScrubField";
import TraceScrubPatternType from "../../../../Types/Trace/TraceScrubPatternType";
import { copyOwnValues } from "../../../../Utils/LookupTable";
import { correlationIdAttributeKeys } from "../../../../Utils/Telemetry/CorrelationIdAttributes";
import ScrubJsonKeysUtil, {
  ScrubJsonKeysRule,
} from "../../../../Utils/Telemetry/ScrubJsonKeys";
import ScrubJsonTextUtil, {
  ScrubJsonTexts,
} from "../../../../Utils/Telemetry/ScrubJsonText";
import ScrubNestedValuesUtil, {
  ScrubNestedValuesAllowance,
} from "../../../../Utils/Telemetry/ScrubNestedValues";
import PatternWorkScope from "../../PatternWorkScope";
import ScrubAction, { ScrubHashedAddressRecorder } from "../ScrubAction";
import {
  CompiledScrubRule,
  isNamedKeysRule,
  isSensitiveKeysRule,
  ScrubEngineRule,
} from "./CompiledScrubRule";
import { countScrubbedValues, ScrubValueTally } from "./ScrubValueTally";

/*
 * A SPAN ROW - AND AN EXCEPTION COPIED FROM ITS EVENT - AS A PROJECT'S
 * SCRUB RULES LEAVE IT: THE ONE ENGINE FOR TRACES.
 *
 * Ingest (App/FeatureSet/Telemetry/Services/TraceScrubRuleService, which
 * loads and caches each project's rules) and Data Security's proof of a
 * rule on a finding's records (DataSecurity/Telemetry/TelemetryScrubProof,
 * #10366) run every trace rule here, so what is proven is what ingest does.
 *
 * A rule reads the parts its fields-to-scrub name - the span's name, its
 * attributes and its links', its events (their names under All), its
 * status message under All - and, since #10366:
 *
 *  - a Named Attributes rule hides the whole value of each attribute it
 *    names, by key or dotted prefix: a span's and its links' attributes
 *    under Attributes, its events' under Events, both under All - and the
 *    identity columns copied out of an attribute it names;
 *  - a pattern rule that names attributes looks for its matches in their
 *    values alone, its name and status message still as its fields say.
 *
 * Every value a rule changes in a span is counted, by rule, with the span's
 * service and version (ScrubValueTally), unless the caller counts nothing
 * (a proof's copies). An exception, a copy of its span's event, counts
 * nothing: its span counted it.
 */

export interface TraceScrubOptions {
  // Count the values each rule changed: ingest does, a proof does not.
  countValues?: boolean | undefined;
}

// What an exception copies out of its span's exception event.
export interface ExceptionContent {
  message: string;
  stackTrace: string;
  // The event's exception.type, when the caller stores it.
  exceptionType?: string | undefined;
  attributes: JSONObject;
}

/*
 * The denormalized identity columns on the Span row, and the attributes
 * each is copied from (Common/Server/Utils/Telemetry/LlmSpan.ts). The copy
 * is made BEFORE scrubbing runs, so without the pass in scrubSpan below
 * they would sail straight past every scrub rule: a project could have an
 * Email redaction rule that visibly redacts "user.email" inside the
 * attributes map while the identical address sits in the clear in
 * llmUserEmail, indexed and queryable.
 */
const LLM_IDENTITY_COLUMNS: ReadonlyArray<{
  column: string;
  copiedFrom: ReadonlyArray<string>;
}> = [
  { column: "llmUserId", copiedFrom: LlmUserIdAttributeKeys },
  { column: "llmUserEmail", copiedFrom: LlmUserEmailAttributeKeys },
  { column: "llmTeam", copiedFrom: LlmTeamAttributeKeys },
];

// An attribute map none of whose values was held as text.
const NOTHING_HELD: ReadonlySet<string> = new Set<string>();

/*
 * The event attributes an exception's message, stack trace and type are
 * copied from (OtelTracesIngestService), which the exception keeps apart
 * from its other attributes.
 */
const EXCEPTION_TEXT_KEYS: {
  message: string;
  stackTrace: string;
  exceptionType: string;
} = {
  message: "exception.message",
  stackTrace: "exception.stacktrace",
  exceptionType: "exception.type",
};

// A record's attribute maps held to its bounds, and what they left.
interface HeldAttributeMaps {
  // For each map, the keys whose values were held as text.
  heldAsText: Map<unknown, ReadonlySet<string>>;
  // What the maps' lists and maps left of the record's allowance.
  allowance: ScrubNestedValuesAllowance;
}

export default class TraceScrubEngine {
  /*
   * A pattern rule over one text of a record. A text that is the JSON text
   * of a list or a map - an attribute written as JSON, such as an AI call's
   * messages, or one held as its JSON text - is read with its escapes read
   * and stays JSON: a match is replaced only inside the values it covers
   * (Common/Utils/Telemetry/ScrubJsonText, #8923). `jsonTexts`: the
   * record's, so each such text is parsed once however many rules read it.
   * `recorder`: told each address an IP Address Hash rule hides, when
   * Security Events reads the batch's traces (ScrubAction.applyAndRecord).
   */
  private static scrubString(
    value: string,
    compiled: CompiledScrubRule,
    jsonTexts: ScrubJsonTexts,
    tally: ScrubValueTally,
    recorder?: ScrubHashedAddressRecorder | null | undefined,
  ): string {
    const rule: ScrubEngineRule = compiled.rule;
    const patternType: string = rule.patternType || "";

    // Key-targeted rules never scan free text.
    if (isSensitiveKeysRule(rule) || isNamedKeysRule(rule)) {
      return value;
    }

    const action: string = rule.scrubAction || TraceScrubAction.Redact;

    return ScrubJsonTextUtil.scrubText({
      text: value,
      findMatches: (text: string): Array<[number, number]> => {
        return compiled.regex.matchRanges(text);
      },
      replaceMatch: (match: string): string => {
        tally.add(compiled);

        return ScrubAction.applyAndRecord({
          match: match,
          action: action,
          patternType: patternType,
          projectId: rule.projectId,
          recorder: recorder,
        });
      },
      // A person may have written a custom pattern against stored escapes.
      readsAsWritten: patternType === TraceScrubPatternType.Custom,
      jsonTexts: jsonTexts,
    });
  }

  // What a key-targeted rule leaves of a text it hides, counted.
  private static hideTextOf(
    compiled: CompiledScrubRule,
    tally: ScrubValueTally,
  ): (text: string) => string {
    const action: string = compiled.rule.scrubAction || TraceScrubAction.Redact;
    const patternType: string = compiled.rule.patternType || "";

    return (text: string): string => {
      tally.add(compiled);

      return ScrubAction.apply({
        match: text,
        action: action,
        patternType: patternType,
        projectId: compiled.rule.projectId,
      });
    };
  }

  /*
   * A Sensitive Attribute Keys rule as it reads one record: its key
   * pattern, its action, and `allowance` - what it has left of the record's
   * SCRUB_MAX_NESTED_VALUES_PER_RECORD for the JSON texts its attribute
   * maps hold, read one after the other.
   */
  private static keysRuleOf(
    compiled: CompiledScrubRule,
    allowance: ScrubNestedValuesAllowance,
    jsonTexts: ScrubJsonTexts,
    tally: ScrubValueTally,
  ): ScrubJsonKeysRule {
    return {
      isSensitiveKey: (key: string): boolean => {
        return compiled.regex.test(key);
      },
      hideText: this.hideTextOf(compiled, tally),
      allowance: allowance,
      jsonTexts: jsonTexts,
    };
  }

  /*
   * Each Sensitive Attribute Keys rule of a record's rules, as it reads the
   * record: every rule within the same bounds, what the record's attribute
   * maps' lists and maps left of its allowance.
   */
  private static keysRulesOf(
    rules: ReadonlyArray<CompiledScrubRule>,
    allowance: ScrubNestedValuesAllowance,
    jsonTexts: ScrubJsonTexts,
    tally: ScrubValueTally,
  ): Map<CompiledScrubRule, ScrubJsonKeysRule> {
    const keysRules: Map<CompiledScrubRule, ScrubJsonKeysRule> = new Map<
      CompiledScrubRule,
      ScrubJsonKeysRule
    >();

    for (const compiled of rules) {
      if (isSensitiveKeysRule(compiled.rule)) {
        keysRules.set(
          compiled,
          this.keysRuleOf(
            compiled,
            { remaining: allowance.remaining },
            jsonTexts,
            tally,
          ),
        );
      }
    }

    return keysRules;
  }

  /*
   * One rule over an attribute map - a span's, an event's, a link's - in
   * place. A text value is scrubbed as it is; a list or a map - OTLP's
   * lists and key-value lists, a scope's attributes - text by text, keeping
   * its shape, with numbers and true or false left alone
   * (Common/Utils/Telemetry/ScrubNestedValues). A sensitive-keys rule hides
   * every text under a key that looks secret: the attribute's own key, a
   * key inside its value, or a key inside a JSON text it holds (`keysRules`:
   * each such rule as it reads the record). A Named Attributes rule hides
   * every text of the values it names; a pattern rule that names attributes
   * reads only their values. `heldAsText`: the keys whose values were too
   * deep or too large to read value by value, and are read as their JSON
   * text. `recorder`: as scrubString's.
   */
  private static scrubAttributesInPlace(data: {
    attributes: JSONObject;
    compiled: CompiledScrubRule;
    heldAsText: ReadonlySet<string>;
    jsonTexts: ScrubJsonTexts;
    keysRules: Map<CompiledScrubRule, ScrubJsonKeysRule>;
    tally: ScrubValueTally;
    correlationIdKeys?: ReadonlySet<string> | undefined;
    recorder?: ScrubHashedAddressRecorder | null | undefined;
  }): void {
    const { attributes, compiled } = data;

    if (isSensitiveKeysRule(compiled.rule)) {
      const rule: ScrubJsonKeysRule =
        data.keysRules.get(compiled) ||
        this.keysRuleOf(
          compiled,
          ScrubNestedValuesUtil.newRecordAllowance(),
          data.jsonTexts,
          data.tally,
        );

      /*
       * Key match → every text of the value gets the action - but for a
       * span's attribute that holds its own session or conversation id,
       * which its column keeps (#8924). A text under no such key is read
       * as the JSON text it may be: an AI call's messages, a request's
       * body (#8993).
       */
      ScrubNestedValuesUtil.hideAttributeTextsUnderSensitiveKeys(
        attributes,
        rule.isSensitiveKey,
        rule.hideText,
        data.heldAsText,
        data.correlationIdKeys,
        (text: string): string => {
          return ScrubJsonKeysUtil.hideUnderSensitiveKeys(text, rule);
        },
      );

      return;
    }

    const isNamedKeys: boolean = isNamedKeysRule(compiled.rule);
    const scrubText: (text: string) => string = isNamedKeys
      ? this.hideTextOf(compiled, data.tally)
      : (text: string): string => {
          return this.scrubString(
            text,
            compiled,
            data.jsonTexts,
            data.tally,
            data.recorder,
          );
        };

    if (!compiled.keys) {
      ScrubNestedValuesUtil.scrubAttributeTexts(attributes, scrubText);
      return;
    }

    // A Named Attributes rule's, or a pattern's only attributes (#10366).
    for (const key of Object.keys(attributes)) {
      if (
        !compiled.keys.matches(key) ||
        (isNamedKeys && data.correlationIdKeys?.has(key))
      ) {
        continue;
      }

      const value: unknown = attributes[key];

      if (typeof value === "string" || ScrubNestedValuesUtil.isNested(value)) {
        attributes[key] = ScrubNestedValuesUtil.scrubTexts(
          value,
          scrubText,
        ) as JSONObject[string];
      }
    }
  }

  /*
   * Before the rules read a record's attribute maps: a list or map too
   * deep, or too large, for them to read value by value is held as its
   * JSON text - as the Span table stores an attribute's list or map - so
   * every rule reads the same value, in time in line with its length. The
   * maps share the record's allowance, in the order given. Returns, for
   * each map, the keys whose values it held as text, and what the maps
   * left of the allowance: the JSON texts they hold are read within it.
   */
  private static holdOversizedValuesAsText(
    attributeMaps: Array<unknown>,
  ): HeldAttributeMaps {
    const allowance: ScrubNestedValuesAllowance =
      ScrubNestedValuesUtil.newRecordAllowance();
    const heldAsText: Map<unknown, ReadonlySet<string>> = new Map<
      unknown,
      ReadonlySet<string>
    >();

    for (const attributes of attributeMaps) {
      if (attributes && typeof attributes === "object") {
        heldAsText.set(
          attributes,
          ScrubNestedValuesUtil.holdOversizedValuesAsText(
            attributes as JSONObject,
            allowance,
          ),
        );
      }
    }

    return { heldAsText: heldAsText, allowance: allowance };
  }

  // The attribute maps of a row's events or links.
  private static attributeMapsOf(entries: unknown): Array<unknown> {
    if (!Array.isArray(entries)) {
      return [];
    }

    return entries.map((entry: unknown): unknown => {
      return entry && typeof entry === "object"
        ? (entry as JSONObject)["attributes"]
        : undefined;
    });
  }

  /*
   * A denormalized identity column, as a rule leaves it: a pattern rule
   * reads it as the value it is (only when it names an attribute the
   * column was copied from, for one that names attributes); a Named
   * Attributes rule hides it whole when it names one of those attributes.
   * A Sensitive Attribute Keys rule leaves it: the column's name is no key.
   */
  private static scrubIdentityColumn(data: {
    spanRow: JSONObject;
    column: string;
    copiedFrom: ReadonlyArray<string>;
    compiled: CompiledScrubRule;
    jsonTexts: ScrubJsonTexts;
    tally: ScrubValueTally;
    recorder?: ScrubHashedAddressRecorder | null | undefined;
  }): void {
    const value: unknown = data.spanRow[data.column];

    if (typeof value !== "string" || isSensitiveKeysRule(data.compiled.rule)) {
      return;
    }

    const isNamedByRule: boolean = data.copiedFrom.some(
      (key: string): boolean => {
        return Boolean(data.compiled.keys?.matches(key));
      },
    );

    if (isNamedKeysRule(data.compiled.rule)) {
      if (isNamedByRule && value) {
        data.spanRow[data.column] = this.hideTextOf(
          data.compiled,
          data.tally,
        )(value);
      }

      return;
    }

    if (data.compiled.keys && !isNamedByRule) {
      return;
    }

    data.spanRow[data.column] = this.scrubString(
      value,
      data.compiled,
      data.jsonTexts,
      data.tally,
      data.recorder,
    );
  }

  /*
   * Scrub exception content extracted from a span's exception event.
   * Exception message / stack trace / type / attributes are copies of the
   * span-event attributes, so the rules that apply are the ones scoped
   * to Events (or All) — keeping the ExceptionInstance copy consistent
   * with the scrubbed event attributes stored on the Span row. The type
   * (exception.type) is scrubbed as the message is: the Span row's copy of
   * it always was, and the exception's was stored as it came (#6513).
   *
   * So the message, stack trace and type are read as the event attributes
   * they were copied from, rule by rule in the same order: a Sensitive
   * Attribute Keys rule reads the keys of a message written as JSON
   * (`{"error": "declined", "card_number": ...}`), as it does in the Span
   * row's exception.message (#8993), and a Named Attributes rule that
   * names exception.message hides the message whole.
   *
   * `primaryEntityId`: the service of the span it was copied from, whose
   * rules scrub it as they scrub the span (Types/Telemetry/ScrubRuleScope,
   * #10433). Left out, only the rules that name no service run.
   */
  public static scrubExceptionContent<TRule extends ScrubEngineRule>(
    content: ExceptionContent,
    projectRules: Array<CompiledScrubRule<TRule>>,
    primaryEntityId?: unknown,
  ): ExceptionContent {
    const compiledRules: Array<CompiledScrubRule<TRule>> =
      getScrubRulesOfRecord(projectRules, primaryEntityId);

    if (compiledRules.length === 0) {
      return content;
    }

    /*
     * The record's texts add their share to the batch's work allowance when
     * the first of these patterns is asked about it
     * (Common/Server/Utils/PatternWorkScope.ts).
     */
    PatternWorkScope.handOverRecord(content);

    const applicableRules: Array<CompiledScrubRule<TRule>> =
      compiledRules.filter((compiled: CompiledScrubRule<TRule>): boolean => {
        // SensitiveKeys always applies to attribute content (see scrubSpan).
        if (isSensitiveKeysRule(compiled.rule)) {
          return true;
        }

        const fieldsToScrub: string =
          compiled.rule.fieldsToScrub || TraceScrubField.All;
        return (
          fieldsToScrub === TraceScrubField.All ||
          fieldsToScrub === TraceScrubField.Events
        );
      });

    if (applicableRules.length === 0) {
      return content;
    }

    // An exception is its span's event: what changed is counted on the span.
    const tally: ScrubValueTally = new ScrubValueTally();
    // Copied with every key, one named __proto__ too.
    const attributes: JSONObject = copyOwnValues(content.attributes);
    const held: HeldAttributeMaps = this.holdOversizedValuesAsText([
      attributes,
    ]);
    const heldAsText: ReadonlySet<string> =
      held.heldAsText.get(attributes) || NOTHING_HELD;
    const jsonTexts: ScrubJsonTexts = new ScrubJsonTexts();
    const keysRules: Map<CompiledScrubRule, ScrubJsonKeysRule> =
      this.keysRulesOf(applicableRules, held.allowance, jsonTexts, tally);

    for (const compiled of applicableRules) {
      this.scrubAttributesInPlace({
        attributes,
        compiled,
        heldAsText,
        jsonTexts,
        keysRules,
        tally,
      });
    }

    // The texts the exception keeps apart, under the keys they came from.
    const texts: JSONObject = {
      [EXCEPTION_TEXT_KEYS.message]: content.message,
      [EXCEPTION_TEXT_KEYS.stackTrace]: content.stackTrace,
    };

    if (typeof content.exceptionType === "string") {
      texts[EXCEPTION_TEXT_KEYS.exceptionType] = content.exceptionType;
    }

    for (const compiled of applicableRules) {
      this.scrubAttributesInPlace({
        attributes: texts,
        compiled,
        heldAsText: NOTHING_HELD,
        jsonTexts,
        keysRules,
        tally,
      });
    }

    return {
      message: texts[EXCEPTION_TEXT_KEYS.message] as string,
      stackTrace: texts[EXCEPTION_TEXT_KEYS.stackTrace] as string,
      ...(typeof content.exceptionType === "string"
        ? {
            exceptionType: texts[EXCEPTION_TEXT_KEYS.exceptionType] as string,
          }
        : {}),
      attributes: attributes,
    };
  }

  /*
   * A span row as the project's rules leave it, in place. `recorder`: told
   * each address an IP Address Hash rule hides and the token it leaves, for
   * Security Events' address vault - passed by ingest only for a batch whose
   * traces Security Events reads (SecurityAddressVaultWriter.startBatch,
   * #10395). The row is scrubbed the same with it or without it. An
   * exception's copy of an event (scrubExceptionContent) tells no recorder:
   * Security Events reads no exception, and the span's own event has told
   * it already.
   *
   * Only the rules that apply to the span's service run: a rule that names
   * a service scrubs that service's spans alone (Types/Telemetry/
   * ScrubRuleScope, #10433).
   */
  public static scrubSpan<TRule extends ScrubEngineRule>(
    spanRow: JSONObject,
    projectRules: Array<CompiledScrubRule<TRule>>,
    recorder?: ScrubHashedAddressRecorder | null | undefined,
    options?: TraceScrubOptions | undefined,
  ): JSONObject {
    const compiledRules: Array<CompiledScrubRule<TRule>> =
      getScrubRulesOfRecord(projectRules, spanRow["primaryEntityId"]);

    if (compiledRules.length === 0) {
      return spanRow;
    }

    /*
     * The record's texts add their share to the batch's work allowance when
     * the first of these patterns is asked about it
     * (Common/Server/Utils/PatternWorkScope.ts).
     */
    PatternWorkScope.handOverRecord(spanRow);

    // What each rule changed in this span, counted once it is scrubbed.
    const tally: ScrubValueTally = new ScrubValueTally();

    const held: HeldAttributeMaps = this.holdOversizedValuesAsText([
      spanRow["attributes"],
      ...this.attributeMapsOf(spanRow["events"]),
      ...this.attributeMapsOf(spanRow["links"]),
    ]);
    const heldIn: (attributes: unknown) => ReadonlySet<string> = (
      attributes: unknown,
    ): ReadonlySet<string> => {
      return held.heldAsText.get(attributes) || NOTHING_HELD;
    };

    // Which of the span's texts are JSON, worked out once for every rule.
    const jsonTexts: ScrubJsonTexts = new ScrubJsonTexts();

    /*
     * Each Sensitive Attribute Keys rule reads the JSON texts the span's,
     * its events' and its links' attributes hold (#8993) within what their
     * lists and maps left of the span's allowance.
     */
    const keysRules: Map<CompiledScrubRule, ScrubJsonKeysRule> =
      this.keysRulesOf(compiledRules, held.allowance, jsonTexts, tally);

    /*
     * The span's own attributes that hold its session id or, on an AI call,
     * its conversation id - the values its sessionId and llmConversationId
     * columns store: correlation ids, which a key-targeted rule keeps where
     * the columns keep them (Common/Utils/Telemetry/CorrelationIdAttributes,
     * #8924). An event's or a link's attributes are read as before. Read
     * before any rule changes them.
     */
    const correlationIdKeys: ReadonlySet<string> =
      correlationIdAttributeKeys(spanRow);

    for (const compiled of compiledRules) {
      /*
       * SensitiveKeys is key-targeted, so it can only ever act on
       * attributes (span, event and link) — a rule saved with a name-only
       * scope would otherwise be a silent no-op while looking active in the
       * rules table. Treat it as All (the name pass skips key-targeted
       * rules inside scrubString anyway). A Named Attributes rule reads the
       * attributes its fields name, All when they name none it can read.
       */
      const isSensitiveKeys: boolean = isSensitiveKeysRule(compiled.rule);
      const isNamedKeys: boolean = isNamedKeysRule(compiled.rule);
      const savedFields: string =
        compiled.rule.fieldsToScrub || TraceScrubField.All;
      const fieldsToScrub: string = isSensitiveKeys
        ? TraceScrubField.All
        : isNamedKeys && savedFields === TraceScrubField.Name
          ? TraceScrubField.All
          : savedFields;
      const scrubAll: boolean = fieldsToScrub === TraceScrubField.All;

      // Span name.
      if (
        (scrubAll || fieldsToScrub === TraceScrubField.Name) &&
        typeof spanRow["name"] === "string"
      ) {
        spanRow["name"] = this.scrubString(
          spanRow["name"] as string,
          compiled,
          jsonTexts,
          tally,
          recorder,
        );
      }

      /*
       * The status message: free text a span sets on itself, which often
       * repeats the error it failed with - an address, a token in a URL.
       * No scope but All names it (it is not the name, nor an attribute,
       * nor an event), so All reaches it, as All reaches every text a span
       * stores (#6513). A key-targeted rule reads no free text: scrubString
       * skips it. Most spans set none - an empty text, which no rule can
       * match - and cost no rule a question.
       */
      if (
        scrubAll &&
        typeof spanRow["statusMessage"] === "string" &&
        spanRow["statusMessage"] !== ""
      ) {
        spanRow["statusMessage"] = this.scrubString(
          spanRow["statusMessage"] as string,
          compiled,
          jsonTexts,
          tally,
          recorder,
        );
      }

      // Span attributes.
      if (
        (scrubAll || fieldsToScrub === TraceScrubField.Attributes) &&
        spanRow["attributes"] &&
        typeof spanRow["attributes"] === "object"
      ) {
        this.scrubAttributesInPlace({
          attributes: spanRow["attributes"] as JSONObject,
          compiled,
          heldAsText: heldIn(spanRow["attributes"]),
          jsonTexts,
          keysRules,
          tally,
          correlationIdKeys,
          recorder,
        });
      }

      /*
       * Denormalized identity columns.
       *
       * Scoped to Attributes (and All) because that is what they honestly
       * are: values COPIED out of the attributes map at ingest, not a
       * separate field a rule author would think to target. A rule scoped to
       * Attributes must therefore reach them, and — just as importantly — a
       * rule scoped to Name must NOT, or a "redact the span name" rule would
       * start quietly deleting chargeback data.
       */
      if (scrubAll || fieldsToScrub === TraceScrubField.Attributes) {
        for (const identity of LLM_IDENTITY_COLUMNS) {
          this.scrubIdentityColumn({
            spanRow,
            column: identity.column,
            copiedFrom: identity.copiedFrom,
            compiled,
            jsonTexts,
            tally,
            recorder,
          });
        }
      }

      /*
       * Span link attributes - walk links[].attributes. A link's
       * attributes are attributes the span carries, about another span it
       * points at, so the rules that scrub the span's attributes scrub them
       * too: Attributes (and All), never Name or Events alone.
       */
      if (
        (scrubAll || fieldsToScrub === TraceScrubField.Attributes) &&
        Array.isArray(spanRow["links"])
      ) {
        for (const attributes of this.attributeMapsOf(spanRow["links"])) {
          if (attributes && typeof attributes === "object") {
            this.scrubAttributesInPlace({
              attributes: attributes as JSONObject,
              compiled,
              heldAsText: heldIn(attributes),
              jsonTexts,
              keysRules,
              tally,
              recorder,
            });
          }
        }
      }

      /*
       * Span events — walk events[].attributes, and under All the event's
       * name too: an instrumentation can name an event with what happened
       * ("Retrying after 10.0.0.12 refused"), and All reaches every text a
       * span stores. Event Attributes Only reads what it says, the
       * attributes (#6513).
       */
      if (
        (scrubAll || fieldsToScrub === TraceScrubField.Events) &&
        Array.isArray(spanRow["events"])
      ) {
        const events: Array<JSONObject> = spanRow[
          "events"
        ] as Array<JSONObject>;

        for (const event of events) {
          if (!event || typeof event !== "object") {
            continue;
          }

          if (scrubAll && typeof event["name"] === "string") {
            event["name"] = this.scrubString(
              event["name"] as string,
              compiled,
              jsonTexts,
              tally,
              recorder,
            );
          }

          if (event["attributes"]) {
            this.scrubAttributesInPlace({
              attributes: event["attributes"] as JSONObject,
              compiled,
              heldAsText: heldIn(event["attributes"]),
              jsonTexts,
              keysRules,
              tally,
              recorder,
            });
          }
        }
      }
    }

    if (options?.countValues !== false) {
      countScrubbedValues({
        tally,
        signal: "trace",
        projectId: compiledRules[0]?.rule.projectId,
        record: spanRow,
      });
    }

    return spanRow;
  }
}
