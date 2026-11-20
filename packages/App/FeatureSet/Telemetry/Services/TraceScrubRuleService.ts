import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import PatternWorkScope from "Common/Server/Utils/PatternWorkScope";
import DatabaseService from "Common/Server/Services/DatabaseService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import TraceScrubAction from "Common/Types/Trace/TraceScrubAction";
import TraceScrubPatternType from "Common/Types/Trace/TraceScrubPatternType";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import InMemoryTTLCache from "Common/Server/Infrastructure/InMemoryTTLCache";
import {
  compileScrubRuleCustomRegex,
  ScrubRegExp,
  scrubRegExpFromBuiltIn,
} from "Common/Types/Telemetry/ScrubRule";
import ScrubNestedValuesUtil, {
  ScrubNestedValuesAllowance,
} from "Common/Utils/Telemetry/ScrubNestedValues";
import ScrubJsonTextUtil, {
  ScrubJsonTexts,
} from "Common/Utils/Telemetry/ScrubJsonText";
import ScrubJsonKeysUtil, {
  ScrubJsonKeysRule,
} from "Common/Utils/Telemetry/ScrubJsonKeys";
import ScrubIpAddress from "Common/Utils/Telemetry/ScrubIpAddress";
import ScrubAction from "Common/Server/Utils/Telemetry/ScrubAction";
import { correlationIdAttributeKeys } from "Common/Utils/Telemetry/CorrelationIdAttributes";
import { copyOwnValues, readOwnValue } from "Common/Utils/LookupTable";

interface CompiledRule {
  rule: TraceScrubRule;
  regex: ScrubRegExp;
}

// What an exception copies out of its span's exception event.
export interface ExceptionContent {
  message: string;
  stackTrace: string;
  // The event's exception.type, when the caller stores it.
  exceptionType?: string | undefined;
  attributes: JSONObject;
}

const CACHE_TTL_MS: number = 60 * 1000; // 60 seconds
const MAX_CACHED_PROJECTS: number = 10_000;

const scrubRuleCache: InMemoryTTLCache<Array<CompiledRule>> =
  new InMemoryTTLCache<Array<CompiledRule>>(MAX_CACHED_PROJECTS);

// Built-in PII detection patterns — same set as logs.
const BUILT_IN_PATTERNS: Record<string, RegExp> = {
  /*
   * Each part of the address is length-bounded to the sizes RFC 5321 allows
   * (local part 64, domain 253, final label 63), so finding addresses in a
   * span body or attribute stays in line with its length however long it is -
   * this runs over ingested spans for a project with an email scrub rule.
   */
  [TraceScrubPatternType.Email]:
    /[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,253}\.[a-zA-Z]{2,63}/g,
  [TraceScrubPatternType.CreditCard]: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  [TraceScrubPatternType.SSN]: /\b\d{3}-\d{2}-\d{4}\b/g,
  [TraceScrubPatternType.PhoneNumber]:
    /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  /*
   * IP Address is not here: its matches are what Data Security's own
   * detectors call an IP address - public IPv4 and IPv6 addresses, and
   * documentation ones - and not private, loopback or link-local ones, so
   * 169.254.169.254 in a request's URL stays for Security Events to find
   * (Common/Utils/Telemetry/ScrubIpAddress, #10393).
   */
};

/*
 * Attribute-KEY denylist for the SensitiveKeys pattern. Matched
 * case-insensitively against the attribute key; on a hit the WHOLE value
 * gets the rule's scrub action, whatever the value looks like. Same list
 * as the log engine — keep them in sync.
 */
const SENSITIVE_KEY_REGEX: RegExp =
  /(password|passwd|pwd|secret|token|api[._-]?key|access[._-]?key|private[._-]?key|client[._-]?secret|authorization|auth[._-]?header|cookie|session[._-]?id|credit[._-]?card|card[._-]?number|ssn|csrf|xsrf)/i;

/*
 * The denormalized identity columns on the Span row.
 *
 * These are plain string columns that ingest COPIES out of the span
 * attributes (user.email -> llmUserEmail, and so on — see
 * Common/Server/Utils/Telemetry/LlmSpan.ts). The copy is made BEFORE
 * scrubbing runs, so without the pass in scrubSpan below they would sail
 * straight past every scrub rule: a project could have an Email redaction
 * rule that visibly redacts "user.email" inside the attributes map while the
 * identical address sits in the clear in llmUserEmail, indexed and queryable.
 * That is not a cosmetic gap — it is a rule the customer configured, believes
 * is in force, and which would be silently ineffective on the one column most
 * likely to hold PII.
 *
 * The array is the key list rather than a per-column special case so adding
 * another denormalized identity column is a one-line change here.
 */
const LLM_IDENTITY_COLUMN_KEYS: Array<string> = [
  "llmUserId",
  "llmUserEmail",
  "llmTeam",
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

export class TraceScrubRuleService {
  public static async loadScrubRules(
    projectId: ObjectID,
  ): Promise<Array<CompiledRule>> {
    const cacheKey: string = projectId.toString();
    const cached: Array<CompiledRule> | undefined =
      scrubRuleCache.get(cacheKey);

    // Empty arrays are truthy — zero-rule projects stay negatively cached.
    if (cached) {
      return cached;
    }

    const service: DatabaseService<TraceScrubRule> =
      new DatabaseService<TraceScrubRule>(TraceScrubRule);

    const rules: Array<TraceScrubRule> = await service.findBy({
      query: {
        projectId: projectId,
        isEnabled: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      sort: {
        sortOrder: SortOrder.Ascending,
      },
      select: {
        _id: true,
        // A Hash rule hashes with its project's own key (ScrubHashToken).
        projectId: true,
        name: true,
        patternType: true,
        customRegex: true,
        scrubAction: true,
        fieldsToScrub: true,
        sortOrder: true,
      },
      props: {
        isRoot: true,
      },
    });

    const compiledPatterns: Array<CompiledRule> = [];

    for (const rule of rules) {
      const regex: ScrubRegExp | null = this.getRegexForPattern(
        rule.patternType as string,
        rule.customRegex as string | undefined,
      );

      if (regex) {
        compiledPatterns.push({ rule, regex });
      }
    }

    scrubRuleCache.set(cacheKey, compiledPatterns, CACHE_TTL_MS);

    return compiledPatterns;
  }

  private static getRegexForPattern(
    patternType: string,
    customRegex?: string,
  ): ScrubRegExp | null {
    if (patternType === TraceScrubPatternType.Custom) {
      /*
       * Null for a pattern that is empty or does not compile: the rule
       * scrubs nothing. The API refuses to save such a rule, and the rules
       * table flags the ones saved before it did - all three judge the
       * pattern with Common/Types/Telemetry/ScrubRule, so they cannot
       * disagree on what ingest does with it.
       */
      return compileScrubRuleCustomRegex(customRegex);
    }

    /*
     * SensitiveKeys compiles to the KEY regex — it is matched against
     * attribute keys (not values) by scrubAttributesInPlace, and skipped
     * entirely by scrubString.
     */
    if (patternType === TraceScrubPatternType.SensitiveKeys) {
      return scrubRegExpFromBuiltIn(SENSITIVE_KEY_REGEX);
    }

    // What Data Security calls an IP address, found by its own detectors.
    if (patternType === TraceScrubPatternType.IPAddress) {
      return ScrubIpAddress.toScrubRegExp();
    }

    // The saved rule's own word: a pattern type no table lists matches nothing.
    const builtIn: RegExp | undefined = readOwnValue(
      BUILT_IN_PATTERNS,
      patternType,
    );
    if (builtIn) {
      return scrubRegExpFromBuiltIn(builtIn);
    }

    return null;
  }

  /*
   * What a rule leaves of a match: one answer for the log, trace and session
   * replay scrubbers (Common/Server/Utils/Telemetry/ScrubAction). A Hash rule
   * makes its project's token (ScrubHashToken, #10394).
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

  /*
   * The pattern rules over one text of a record. A text that is the JSON
   * text of a list or a map - an attribute written as JSON, such as an AI
   * call's messages, or one held as its JSON text - is read with its
   * escapes read and stays JSON: a match is replaced only inside the values
   * it covers (Common/Utils/Telemetry/ScrubJsonText, #8923). `jsonTexts`:
   * the record's, so each such text is parsed once however many rules read
   * it.
   */
  private static scrubString(
    value: string,
    compiledRules: Array<CompiledRule>,
    jsonTexts: ScrubJsonTexts,
  ): string {
    let result: string = value;

    for (const { rule, regex } of compiledRules) {
      const patternType: string = (rule.patternType as string) || "";

      // Key-targeted rules never scan free text.
      if (patternType === TraceScrubPatternType.SensitiveKeys) {
        continue;
      }

      const action: string =
        (rule.scrubAction as string) || TraceScrubAction.Redact;

      result = ScrubJsonTextUtil.scrubText({
        text: result,
        findMatches: (text: string): Array<[number, number]> => {
          return regex.matchRanges(text);
        },
        replaceMatch: (match: string): string => {
          return this.applyScrubAction(
            match,
            action,
            patternType,
            rule.projectId,
          );
        },
        // A person may have written a custom pattern against stored escapes.
        readsAsWritten: patternType === TraceScrubPatternType.Custom,
        jsonTexts: jsonTexts,
      });
    }

    return result;
  }

  /*
   * A Sensitive Attribute Keys rule as it reads one record: its key
   * pattern, its action, and `allowance` - what it has left of the record's
   * SCRUB_MAX_NESTED_VALUES_PER_RECORD for the JSON texts its attribute
   * maps hold, read one after the other.
   */
  private static keysRuleOf(
    compiled: CompiledRule,
    allowance: ScrubNestedValuesAllowance,
    jsonTexts: ScrubJsonTexts,
  ): ScrubJsonKeysRule {
    const action: string =
      (compiled.rule.scrubAction as string) || TraceScrubAction.Redact;

    return {
      isSensitiveKey: (key: string): boolean => {
        return compiled.regex.test(key);
      },
      hideText: (text: string): string => {
        return this.applyScrubAction(
          text,
          action,
          TraceScrubPatternType.SensitiveKeys,
          compiled.rule.projectId,
        );
      },
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
    rules: Array<CompiledRule>,
    allowance: ScrubNestedValuesAllowance,
    jsonTexts: ScrubJsonTexts,
  ): Map<CompiledRule, ScrubJsonKeysRule> {
    const keysRules: Map<CompiledRule, ScrubJsonKeysRule> = new Map<
      CompiledRule,
      ScrubJsonKeysRule
    >();

    for (const compiled of rules) {
      if (
        (compiled.rule.patternType as string) ===
        TraceScrubPatternType.SensitiveKeys
      ) {
        keysRules.set(
          compiled,
          this.keysRuleOf(
            compiled,
            { remaining: allowance.remaining },
            jsonTexts,
          ),
        );
      }
    }

    return keysRules;
  }

  /*
   * The rules over an attribute map - a span's, an event's, a link's - in
   * place. A text value is scrubbed as it is; a list or a map - OTLP's
   * lists and key-value lists, a scope's attributes - text by text, keeping
   * its shape, with numbers and true or false left alone
   * (Common/Utils/Telemetry/ScrubNestedValues). A sensitive-keys rule hides
   * every text under a key that looks secret: the attribute's own key, a
   * key inside its value, or a key inside a JSON text it holds
   * (`keysRules`: each such rule as it reads the record). `heldAsText`: the
   * keys whose values were too deep or too large to read value by value,
   * and are read as their JSON text.
   */
  private static scrubAttributesInPlace(
    attributes: JSONObject,
    rules: Array<CompiledRule>,
    heldAsText: ReadonlySet<string>,
    jsonTexts: ScrubJsonTexts,
    keysRules: Map<CompiledRule, ScrubJsonKeysRule>,
    correlationIdKeys?: ReadonlySet<string> | undefined,
  ): void {
    for (const compiled of rules) {
      const isKeyTargeted: boolean =
        (compiled.rule.patternType as string) ===
        TraceScrubPatternType.SensitiveKeys;

      if (isKeyTargeted) {
        const rule: ScrubJsonKeysRule =
          keysRules.get(compiled) ||
          this.keysRuleOf(
            compiled,
            ScrubNestedValuesUtil.newRecordAllowance(),
            jsonTexts,
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
          heldAsText,
          correlationIdKeys,
          (text: string): string => {
            return ScrubJsonKeysUtil.hideUnderSensitiveKeys(text, rule);
          },
        );

        continue;
      }

      const singleRule: Array<CompiledRule> = [compiled];

      ScrubNestedValuesUtil.scrubAttributeTexts(
        attributes,
        (text: string): string => {
          return this.scrubString(text, singleRule, jsonTexts);
        },
      );
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
   * row's exception.message (#8993).
   */
  public static scrubExceptionContent(
    content: ExceptionContent,
    compiledRules: Array<CompiledRule>,
  ): ExceptionContent {
    if (compiledRules.length === 0) {
      return content;
    }

    /*
     * The record's texts add their share to the batch's work allowance when
     * the first of these patterns is asked about it
     * (Common/Server/Utils/PatternWorkScope.ts).
     */
    PatternWorkScope.handOverRecord(content);

    const applicableRules: Array<CompiledRule> = compiledRules.filter(
      (compiled: CompiledRule): boolean => {
        // SensitiveKeys always applies to attribute content (see scrubSpan).
        if (
          (compiled.rule.patternType as string) ===
          TraceScrubPatternType.SensitiveKeys
        ) {
          return true;
        }

        const fieldsToScrub: string =
          (compiled.rule.fieldsToScrub as string) || TraceScrubField.All;
        return (
          fieldsToScrub === TraceScrubField.All ||
          fieldsToScrub === TraceScrubField.Events
        );
      },
    );

    if (applicableRules.length === 0) {
      return content;
    }

    // Copied with every key, one named __proto__ too.
    const attributes: JSONObject = copyOwnValues(content.attributes);
    const held: HeldAttributeMaps = this.holdOversizedValuesAsText([
      attributes,
    ]);
    const heldAsText: ReadonlySet<string> =
      held.heldAsText.get(attributes) || NOTHING_HELD;
    const jsonTexts: ScrubJsonTexts = new ScrubJsonTexts();
    const keysRules: Map<CompiledRule, ScrubJsonKeysRule> = this.keysRulesOf(
      applicableRules,
      held.allowance,
      jsonTexts,
    );

    this.scrubAttributesInPlace(
      attributes,
      applicableRules,
      heldAsText,
      jsonTexts,
      keysRules,
    );

    // The texts the exception keeps apart, under the keys they came from.
    const texts: JSONObject = {
      [EXCEPTION_TEXT_KEYS.message]: content.message,
      [EXCEPTION_TEXT_KEYS.stackTrace]: content.stackTrace,
    };

    if (typeof content.exceptionType === "string") {
      texts[EXCEPTION_TEXT_KEYS.exceptionType] = content.exceptionType;
    }

    this.scrubAttributesInPlace(
      texts,
      applicableRules,
      NOTHING_HELD,
      jsonTexts,
      keysRules,
    );

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

  public static scrubSpan(
    spanRow: JSONObject,
    compiledRules: Array<CompiledRule>,
  ): JSONObject {
    if (compiledRules.length === 0) {
      return spanRow;
    }

    /*
     * The record's texts add their share to the batch's work allowance when
     * the first of these patterns is asked about it
     * (Common/Server/Utils/PatternWorkScope.ts).
     */
    PatternWorkScope.handOverRecord(spanRow);

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
    const keysRules: Map<CompiledRule, ScrubJsonKeysRule> = this.keysRulesOf(
      compiledRules,
      held.allowance,
      jsonTexts,
    );

    /*
     * The span's own attributes that hold its session id or, on an AI call,
     * its conversation id - the values its sessionId and llmConversationId
     * columns store: correlation ids, which a Sensitive Attribute Keys rule
     * keeps where the columns keep them
     * (Common/Utils/Telemetry/CorrelationIdAttributes, #8924). An event's
     * or a link's attributes are read as before. Read before any rule
     * changes them.
     */
    const correlationIdKeys: ReadonlySet<string> =
      correlationIdAttributeKeys(spanRow);

    /*
     * Each rule's `fieldsToScrub` is per-rule (name vs attributes
     * vs events vs all), so we still have to dispatch per rule.
     * The old implementation did
     * `compiledRules.filter(cr => cr.rule === rule)` inside the
     * outer loop, which made the loop O(N^2) over the rule count.
     * Reuse a one-element scratch array instead.
     */
    const singleRule: Array<CompiledRule> = new Array<CompiledRule>(1);

    for (const compiled of compiledRules) {
      singleRule[0] = compiled;

      /*
       * SensitiveKeys is key-targeted, so it can only ever act on
       * attributes (span, event and link) — a rule saved with a name-only scope
       * would otherwise be a silent no-op while looking active in the
       * rules table. Treat it as All (the name pass skips key-targeted
       * rules inside scrubString anyway).
       */
      const isSensitiveKeysRule: boolean =
        (compiled.rule.patternType as string) ===
        TraceScrubPatternType.SensitiveKeys;

      const fieldsToScrub: string = isSensitiveKeysRule
        ? TraceScrubField.All
        : (compiled.rule.fieldsToScrub as string) || TraceScrubField.All;
      const scrubAll: boolean = fieldsToScrub === TraceScrubField.All;

      // Span name.
      if (
        (scrubAll || fieldsToScrub === TraceScrubField.Name) &&
        typeof spanRow["name"] === "string"
      ) {
        spanRow["name"] = this.scrubString(
          spanRow["name"] as string,
          singleRule,
          jsonTexts,
        );
      }

      /*
       * The status message: free text a span sets on itself, which often
       * repeats the error it failed with - an address, a token in a URL.
       * No scope but All names it (it is not the name, nor an attribute,
       * nor an event), so All reaches it, as All reaches every text a span
       * stores (#6513). A Sensitive Attribute Keys rule reads no free
       * text: scrubString skips it. Most spans set none - an empty text,
       * which no rule can match - and cost no rule a question.
       */
      if (
        scrubAll &&
        typeof spanRow["statusMessage"] === "string" &&
        spanRow["statusMessage"] !== ""
      ) {
        spanRow["statusMessage"] = this.scrubString(
          spanRow["statusMessage"] as string,
          singleRule,
          jsonTexts,
        );
      }

      // Span attributes.
      if (
        (scrubAll || fieldsToScrub === TraceScrubField.Attributes) &&
        spanRow["attributes"] &&
        typeof spanRow["attributes"] === "object"
      ) {
        this.scrubAttributesInPlace(
          spanRow["attributes"] as JSONObject,
          singleRule,
          heldIn(spanRow["attributes"]),
          jsonTexts,
          keysRules,
          correlationIdKeys,
        );
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
       *
       * scrubString (not scrubAttributesInPlace) is the right helper: these
       * are bare values, and their ClickHouse column names are not the
       * attribute keys a SensitiveKeys rule matches against. SensitiveKeys
       * rules are already forced to scrubAll above, and scrubString skips
       * key-targeted rules internally, so such a rule correctly leaves the
       * values alone here while still redacting the source attribute.
       */
      if (scrubAll || fieldsToScrub === TraceScrubField.Attributes) {
        for (const columnKey of LLM_IDENTITY_COLUMN_KEYS) {
          if (typeof spanRow[columnKey] === "string") {
            spanRow[columnKey] = this.scrubString(
              spanRow[columnKey] as string,
              singleRule,
              jsonTexts,
            );
          }
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
            this.scrubAttributesInPlace(
              attributes as JSONObject,
              singleRule,
              heldIn(attributes),
              jsonTexts,
              keysRules,
            );
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
              singleRule,
              jsonTexts,
            );
          }

          if (event["attributes"]) {
            this.scrubAttributesInPlace(
              event["attributes"] as JSONObject,
              singleRule,
              heldIn(event["attributes"]),
              jsonTexts,
              keysRules,
            );
          }
        }
      }
    }

    return spanRow;
  }
}

export default TraceScrubRuleService;
