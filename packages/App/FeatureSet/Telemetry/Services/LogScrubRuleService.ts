import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import DatabaseService from "Common/Server/Services/DatabaseService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import crypto from "crypto";
import InMemoryTTLCache from "Common/Server/Infrastructure/InMemoryTTLCache";
import PatternWorkScope from "Common/Server/Utils/PatternWorkScope";
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
import { maskKeepingEnds } from "Common/Utils/Telemetry/ScrubMask";
import { readOwnValue } from "Common/Utils/LookupTable";

interface CompiledRule {
  rule: LogScrubRule;
  regex: ScrubRegExp;
}

const CACHE_TTL_MS: number = 60 * 1000; // 60 seconds
const MAX_CACHED_PROJECTS: number = 10_000;

const scrubRuleCache: InMemoryTTLCache<Array<CompiledRule>> =
  new InMemoryTTLCache<Array<CompiledRule>>(MAX_CACHED_PROJECTS);

// Built-in PII detection patterns
const BUILT_IN_PATTERNS: Record<string, RegExp> = {
  /*
   * Each part of the address is length-bounded to the sizes RFC 5321 allows
   * (local part 64, domain 253, final label 63), so finding addresses in a
   * log body stays in line with the body's length however long it is - this
   * runs over every ingested log body for a project with an email scrub rule.
   */
  [LogScrubPatternType.Email]:
    /[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,253}\.[a-zA-Z]{2,63}/g,
  [LogScrubPatternType.CreditCard]: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  [LogScrubPatternType.SSN]: /\b\d{3}-\d{2}-\d{4}\b/g,
  [LogScrubPatternType.PhoneNumber]:
    /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  [LogScrubPatternType.IPAddress]: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
};

/*
 * Attribute-KEY denylist for the SensitiveKeys pattern. Value-regex rules
 * miss secrets that don't look like anything (a random password, an opaque
 * token) — but the attribute key names them. Matched case-insensitively
 * against the attribute key, and the keys inside a list or map value or a
 * structured body; on a hit the WHOLE value gets the rule's scrub action,
 * whatever the value looks like. Same list as the trace engine — keep them
 * in sync.
 */
const SENSITIVE_KEY_REGEX: RegExp =
  /(password|passwd|pwd|secret|token|api[._-]?key|access[._-]?key|private[._-]?key|client[._-]?secret|authorization|auth[._-]?header|cookie|session[._-]?id|credit[._-]?card|card[._-]?number|ssn|csrf|xsrf)/i;

export class LogScrubRuleService {
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

    const service: DatabaseService<LogScrubRule> =
      new DatabaseService<LogScrubRule>(LogScrubRule);

    const rules: Array<LogScrubRule> = await service.findBy({
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

    // Pre-compile regex patterns for performance
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
    if (patternType === LogScrubPatternType.Custom) {
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
     * attribute keys (not values) by the attribute scrub loop, and
     * skipped entirely by scrubString.
     */
    if (patternType === LogScrubPatternType.SensitiveKeys) {
      return scrubRegExpFromBuiltIn(SENSITIVE_KEY_REGEX);
    }

    /*
     * The saved rule's own word: a pattern type no table lists matches
     * nothing (a plain read answered "constructor" with a function).
     */
    const builtIn: RegExp | undefined = readOwnValue(
      BUILT_IN_PATTERNS,
      patternType,
    );
    if (builtIn) {
      // An instance of its own, so lastIndex is independent per use.
      return scrubRegExpFromBuiltIn(builtIn);
    }

    return null;
  }

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
        // Show last 4 digits only
        const digits: string = value.replace(/[-\s]/g, "");
        if (digits.length >= 4) {
          return "****-****-****-" + digits.substring(digits.length - 4);
        }
        return "****-****-****-****";
      }

      case LogScrubPatternType.SSN:
        return "***-**-" + value.substring(value.length - 4);

      case LogScrubPatternType.PhoneNumber: {
        // Show last 4 digits only
        const phoneDigits: string = value.replace(/[^0-9]/g, "");
        if (phoneDigits.length >= 4) {
          return "***-***-" + phoneDigits.substring(phoneDigits.length - 4);
        }
        return "***-***-****";
      }

      case LogScrubPatternType.IPAddress:
        return "***.***.***.***";

      default:
        // First and last characters kept, whole (Common/Utils/Telemetry/ScrubMask).
        return maskKeepingEnds(value);
    }
  }

  /*
   * The pattern rules over one text of a record. A text that is the JSON
   * text of a list or a map - a structured body, a JSON log line, an
   * attribute written as JSON or held as its JSON text - is read with its
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
      if (patternType === LogScrubPatternType.SensitiveKeys) {
        continue;
      }

      const action: string =
        (rule.scrubAction as string) || LogScrubAction.Redact;

      result = ScrubJsonTextUtil.scrubText({
        text: result,
        findMatches: (text: string): Array<[number, number]> => {
          return regex.matchRanges(text);
        },
        replaceMatch: (match: string): string => {
          return this.applyScrubAction(match, action, patternType);
        },
        // A person may have written a custom pattern against stored escapes.
        readsAsWritten: patternType === LogScrubPatternType.Custom,
        jsonTexts: jsonTexts,
      });
    }

    return result;
  }

  /*
   * One rule over a log's attribute values, in place. A text value is
   * scrubbed as it is; a list or a map - OTLP's lists and key-value lists,
   * a scope's attributes - text by text, keeping its shape, with numbers
   * and true or false left alone (Common/Utils/Telemetry/ScrubNestedValues).
   * A sensitive-keys rule hides every text under a key that looks secret:
   * the attribute's own key, or a key inside its value. `heldAsText`: the
   * keys whose values were too deep or too large to read value by value,
   * and are read as their JSON text.
   */
  private static scrubAttributes(
    attributes: JSONObject,
    compiled: CompiledRule,
    heldAsText: ReadonlySet<string>,
    jsonTexts: ScrubJsonTexts,
  ): void {
    const patternType: string = (compiled.rule.patternType as string) || "";

    if (patternType === LogScrubPatternType.SensitiveKeys) {
      const action: string =
        (compiled.rule.scrubAction as string) || LogScrubAction.Redact;

      // Key match → every text of the value gets the action.
      ScrubNestedValuesUtil.hideAttributeTextsUnderSensitiveKeys(
        attributes,
        (key: string): boolean => {
          return compiled.regex.test(key);
        },
        (text: string): string => {
          return this.applyScrubAction(
            text,
            action,
            LogScrubPatternType.SensitiveKeys,
          );
        },
        heldAsText,
      );

      return;
    }

    const singleRule: Array<CompiledRule> = [compiled];

    ScrubNestedValuesUtil.scrubAttributeTexts(
      attributes,
      (text: string): string => {
        return this.scrubString(text, singleRule, jsonTexts);
      },
    );
  }

  /*
   * A body that is the JSON text of a list or a map - one sent as a map or
   * a list (an OTLP key-value list or list, a Fluentd record's map), which
   * ingest stores as its JSON text, or one written as JSON - read key by key
   * by each Sensitive Attribute Keys rule, as an attribute's list or map
   * is: every text under a key that looks secret is hidden, a password
   * inside an OTLP {key, value} pair too (#6513). Pattern rules read the
   * body as the text it is, as they always have.
   *
   * Within the record's bounds (Common/Utils/Telemetry/ScrubNestedValues):
   * the body's values count against what the record's attributes left of
   * SCRUB_MAX_NESTED_VALUES_PER_RECORD, and a part of the body past the
   * bounds is read as its JSON text, hidden whole when that text names a
   * secret - it fails closed, as a held attribute value does - and kept as
   * it is when it names none. So a Kubernetes object, whose managed fields
   * run past 32 levels, keeps the rest of its body.
   *
   * The body keeps the form it is stored in: the JSON text it came as, with
   * only the hidden texts changed, and the very text it was when nothing
   * is hidden.
   */
  private static hideSecretsInStructuredBody(
    body: string,
    keyRules: Array<CompiledRule>,
    allowance: ScrubNestedValuesAllowance,
    jsonTexts: ScrubJsonTexts,
  ): string {
    /*
     * A key is written in the JSON text as it is, but for an escape - JSON
     * escapes none of the letters a secret key is named by - so a text with
     * no escape that names no secret anywhere holds no such key, and is not
     * read further: most bodies.
     */
    if (
      body.indexOf("\\") === -1 &&
      !keyRules.some((compiled: CompiledRule): boolean => {
        return compiled.regex.test(body);
      })
    ) {
      return body;
    }

    const parsed: unknown = ScrubNestedValuesUtil.readJsonListOrMap(body);

    if (parsed === null) {
      // Plain text, which only pattern rules read.
      return body;
    }

    let value: unknown = parsed;

    for (const compiled of keyRules) {
      const action: string =
        (compiled.rule.scrubAction as string) || LogScrubAction.Redact;

      // Each rule reads the body within the same bounds.
      value = ScrubNestedValuesUtil.hideTextsUnderSensitiveKeysWithinBounds(
        value,
        (key: string): boolean => {
          return compiled.regex.test(key);
        },
        (text: string): string => {
          return this.applyScrubAction(
            text,
            action,
            LogScrubPatternType.SensitiveKeys,
          );
        },
        { remaining: allowance.remaining },
      );
    }

    const scrubbed: string = value === parsed ? body : JSON.stringify(value);

    // The pattern rules after this read it as JSON without parsing it again.
    jsonTexts.rememberJson(scrubbed);

    return scrubbed;
  }

  public static scrubLog(
    logRow: JSONObject,
    compiledRules: Array<CompiledRule>,
  ): JSONObject {
    if (compiledRules.length === 0) {
      return logRow;
    }

    /*
     * The record's texts add their share to the batch's work allowance when
     * the first of these patterns is asked about it
     * (Common/Server/Utils/PatternWorkScope.ts).
     */
    PatternWorkScope.handOverRecord(logRow);

    // One for the record: its attributes, then its body.
    const allowance: ScrubNestedValuesAllowance =
      ScrubNestedValuesUtil.newRecordAllowance();

    // Which of the record's texts are JSON, worked out once for every rule.
    const jsonTexts: ScrubJsonTexts = new ScrubJsonTexts();

    /*
     * A list or map too deep, or too large, for the rules to read value by
     * value is held as its JSON text first - as the Log table stores it -
     * so every rule reads the same value, in time in line with its length.
     */
    const heldAsText: ReadonlySet<string> =
      logRow["attributes"] && typeof logRow["attributes"] === "object"
        ? ScrubNestedValuesUtil.holdOversizedValuesAsText(
            logRow["attributes"] as JSONObject,
            allowance,
          )
        : new Set<string>();

    /*
     * The Sensitive Attribute Keys rules read the keys of a structured
     * body before any rule changes its text, so they read the keys as they
     * came, whatever the order of the list. A pattern rule keeps the body
     * JSON (#8923), so the keys it leaves are read the same either way.
     */
    const keyRules: Array<CompiledRule> = compiledRules.filter(
      (compiled: CompiledRule): boolean => {
        return (
          (compiled.rule.patternType as string) ===
          LogScrubPatternType.SensitiveKeys
        );
      },
    );

    if (keyRules.length > 0 && typeof logRow["body"] === "string") {
      logRow["body"] = this.hideSecretsInStructuredBody(
        logRow["body"] as string,
        keyRules,
        allowance,
        jsonTexts,
      );
    }

    /*
     * Each rule's `fieldsToScrub` can be "body", "attributes", or
     * "both" — so we cannot just call scrubString once across the
     * full ruleset, we have to honour each rule's scope. The old
     * implementation did `compiledRules.filter(cr => cr.rule === rule)`
     * inside this loop, which made the loop O(N^2) over the rule
     * count. We now keep a one-element scratch array per rule and
     * reuse it across the body / attributes scrubs.
     */
    const singleRule: Array<CompiledRule> = new Array<CompiledRule>(1);

    for (const compiled of compiledRules) {
      singleRule[0] = compiled;

      /*
       * SensitiveKeys is key-targeted, so it acts on the values under keys:
       * an attribute's, and those of a structured body, which it read
       * above whatever its scope says - a rule saved with a body-only
       * scope would otherwise be a silent no-op while looking active in
       * the rules table. Force the attributes scope for it regardless of
       * the stored value: the body's text holds no key to read.
       */
      const isSensitiveKeysRule: boolean =
        (compiled.rule.patternType as string) ===
        LogScrubPatternType.SensitiveKeys;

      const fieldsToScrub: string = isSensitiveKeysRule
        ? "attributes"
        : (compiled.rule.fieldsToScrub as string) || "both";

      // Scrub body - kept JSON when it is the JSON text of a list or a map.
      if (
        (fieldsToScrub === "body" || fieldsToScrub === "both") &&
        typeof logRow["body"] === "string"
      ) {
        logRow["body"] = this.scrubString(
          logRow["body"] as string,
          singleRule,
          jsonTexts,
        );
      }

      // Scrub attributes - the text inside lists and maps included.
      if (
        (fieldsToScrub === "attributes" || fieldsToScrub === "both") &&
        logRow["attributes"] &&
        typeof logRow["attributes"] === "object"
      ) {
        this.scrubAttributes(
          logRow["attributes"] as JSONObject,
          compiled,
          heldAsText,
          jsonTexts,
        );
      }
    }

    return logRow;
  }
}

export default LogScrubRuleService;
