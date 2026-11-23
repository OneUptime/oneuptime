import { JSONObject } from "../../../../Types/JSON";
import LogScrubAction from "../../../../Types/Log/LogScrubAction";
import LogScrubPatternType from "../../../../Types/Log/LogScrubPatternType";
import { getScrubRulesOfRecord } from "../../../../Types/Telemetry/ScrubRuleScope";
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
 * A LOG ROW AS A PROJECT'S SCRUB RULES LEAVE IT - THE ONE ENGINE FOR LOGS.
 *
 * Ingest (App/FeatureSet/Telemetry/Services/LogScrubRuleService, which
 * loads and caches each project's rules) and Data Security's proof of a
 * rule on a finding's records (DataSecurity/Telemetry/TelemetryScrubProof,
 * #10366) run every log rule here, so what is proven is what ingest does.
 *
 * Each rule reads the parts its fields-to-scrub name - the body, the
 * attributes, both - as it always has: a pattern rule finds its matches in
 * a text (kept JSON when the text is the JSON text of a list or a map,
 * #8923), a Sensitive Attribute Keys rule hides every text under a key
 * that looks secret (the attributes', a structured body's, a JSON text's
 * an attribute holds, #8993), and since #10366:
 *
 *  - a Named Attributes rule hides the whole value of each attribute it
 *    names, by key or dotted prefix, and nothing under any other key;
 *  - a pattern rule that names attributes looks for its matches in their
 *    values alone - the body still as its fields say.
 *
 * Every value a rule changes is counted, by rule, with the record's
 * service and version (ScrubValueTally), unless the caller counts nothing
 * (a proof's copies).
 */

export interface LogScrubOptions {
  // Count the values each rule changed: ingest does, a proof does not.
  countValues?: boolean | undefined;
}

export default class LogScrubEngine {
  /*
   * The pattern rules over one text of a record. A text that is the JSON
   * text of a list or a map - a structured body, a JSON log line, an
   * attribute written as JSON or held as its JSON text - is read with its
   * escapes read and stays JSON: a match is replaced only inside the values
   * it covers (Common/Utils/Telemetry/ScrubJsonText, #8923). `jsonTexts`:
   * the record's, so each such text is parsed once however many rules read
   * it. `recorder`: told each address an IP Address Hash rule hides, when
   * Security Events reads the batch's logs (ScrubAction.applyAndRecord).
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

    const action: string = rule.scrubAction || LogScrubAction.Redact;

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
      readsAsWritten: patternType === LogScrubPatternType.Custom,
      jsonTexts: jsonTexts,
    });
  }

  // What a key-targeted rule leaves of a text it hides, counted.
  private static hideTextOf(
    compiled: CompiledScrubRule,
    tally: ScrubValueTally,
  ): (text: string) => string {
    const action: string = compiled.rule.scrubAction || LogScrubAction.Redact;
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
   * SCRUB_MAX_NESTED_VALUES_PER_RECORD for the JSON texts it reads, the
   * body's and those the attributes hold, one after the other.
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
   * One rule over a log's attribute values, in place. A text value is
   * scrubbed as it is; a list or a map - OTLP's lists and key-value lists,
   * a scope's attributes - text by text, keeping its shape, with numbers
   * and true or false left alone (Common/Utils/Telemetry/ScrubNestedValues).
   * A sensitive-keys rule hides every text under a key that looks secret:
   * the attribute's own key, a key inside its value, or a key inside a JSON
   * text it holds (`keysRule`: the rule as it reads this record). A Named
   * Attributes rule hides every text of the values it names; a pattern
   * rule that names attributes reads only their values. `heldAsText`: the
   * keys whose values were too deep or too large to read value by value,
   * and are read as their JSON text. `recorder`: as scrubString's.
   */
  private static scrubAttributes(data: {
    attributes: JSONObject;
    compiled: CompiledScrubRule;
    heldAsText: ReadonlySet<string>;
    jsonTexts: ScrubJsonTexts;
    correlationIdKeys: ReadonlySet<string>;
    keysRule: ScrubJsonKeysRule | undefined;
    tally: ScrubValueTally;
    recorder?: ScrubHashedAddressRecorder | null | undefined;
  }): void {
    const { attributes, compiled } = data;

    if (isSensitiveKeysRule(compiled.rule)) {
      const rule: ScrubJsonKeysRule =
        data.keysRule ||
        this.keysRuleOf(
          compiled,
          ScrubNestedValuesUtil.newRecordAllowance(),
          data.jsonTexts,
          data.tally,
        );

      /*
       * Key match → every text of the value gets the action - but for the
       * attribute that holds the log's own session id, which its sessionId
       * column keeps (#8924). A text under no such key is read as the JSON
       * text it may be: `http.request.body` = {"password": ...} (#8993).
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

    if (isNamedKeysRule(compiled.rule)) {
      const hideText: (text: string) => string = this.hideTextOf(
        compiled,
        data.tally,
      );

      // The whole value of each attribute it names - the record's own session id aside (#8924).
      for (const key of Object.keys(attributes)) {
        if (data.correlationIdKeys.has(key) || !compiled.keys?.matches(key)) {
          continue;
        }

        const value: unknown = attributes[key];

        if (
          typeof value === "string" ||
          ScrubNestedValuesUtil.isNested(value)
        ) {
          attributes[key] = ScrubNestedValuesUtil.scrubTexts(
            value,
            hideText,
          ) as JSONObject[string];
        }
      }

      return;
    }

    const scrubText: (text: string) => string = (text: string): string => {
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

    // Only in the attributes it names (#10366).
    for (const key of Object.keys(attributes)) {
      if (!compiled.keys.matches(key)) {
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
   * A body that is the JSON text of a list or a map - one sent as a map or
   * a list (an OTLP key-value list or list, a Fluentd record's map), which
   * ingest stores as its JSON text, or one written as JSON - read key by key
   * by each Sensitive Attribute Keys rule, as an attribute's list or map
   * is: every text under a key that looks secret is hidden, a password
   * inside an OTLP {key, value} pair too (#6513), and so is one under a key
   * inside a JSON text a string of the body holds - a Fluentd/docker `log`
   * field holding the application's JSON line (#8993). Pattern rules read
   * the body as the text it is, as they always have.
   *
   * Within the record's bounds (Common/Utils/Telemetry/ScrubJsonKeys): the
   * body's values count against what the record's attributes left of
   * SCRUB_MAX_NESTED_VALUES_PER_RECORD, and a part of the body past the
   * bounds is read as its JSON text, hidden whole when that text names a
   * secret - it fails closed, as a held attribute value does - and kept as
   * it is when it names none. So a Kubernetes object, whose managed fields
   * run past 32 levels, keeps the rest of its body.
   *
   * The body keeps the form it is stored in: the JSON text it came as, with
   * only the hidden texts changed - its numbers, spaces and escapes as they
   * were written - and the very text it was when nothing is hidden.
   */
  private static hideSecretsInStructuredBody(
    body: string,
    keysRules: Array<ScrubJsonKeysRule>,
  ): string {
    let scrubbed: string = body;

    for (const rule of keysRules) {
      scrubbed = ScrubJsonKeysUtil.hideUnderSensitiveKeys(scrubbed, rule);
    }

    return scrubbed;
  }

  /*
   * A log row as the project's rules leave it, in place. `recorder`: told
   * each address an IP Address Hash rule hides and the token it leaves, for
   * Security Events' address vault - passed by ingest only for a batch whose
   * logs Security Events reads (SecurityAddressVaultWriter.startBatch,
   * #10395). The row is scrubbed the same with it or without it.
   *
   * Only the rules that apply to the row's service run: a rule that names
   * a service scrubs that service's logs alone (Types/Telemetry/
   * ScrubRuleScope, #10433), whichever route the line came in by.
   */
  public static scrubLog<TRule extends ScrubEngineRule>(
    logRow: JSONObject,
    projectRules: Array<CompiledScrubRule<TRule>>,
    recorder?: ScrubHashedAddressRecorder | null | undefined,
    options?: LogScrubOptions | undefined,
  ): JSONObject {
    const compiledRules: Array<CompiledScrubRule<TRule>> =
      getScrubRulesOfRecord(projectRules, logRow["primaryEntityId"]);

    if (compiledRules.length === 0) {
      return logRow;
    }

    /*
     * The record's texts add their share to the batch's work allowance when
     * the first of these patterns is asked about it
     * (Common/Server/Utils/PatternWorkScope.ts).
     */
    PatternWorkScope.handOverRecord(logRow);

    // What each rule changed in this record, counted once it is scrubbed.
    const tally: ScrubValueTally = new ScrubValueTally();

    // One for the record: its attributes, then its body.
    const allowance: ScrubNestedValuesAllowance =
      ScrubNestedValuesUtil.newRecordAllowance();

    // Which of the record's texts are JSON, worked out once for every rule.
    const jsonTexts: ScrubJsonTexts = new ScrubJsonTexts();

    /*
     * The attributes that hold the log's own session id - the value its
     * sessionId column stores, the id session replay files it under: a
     * correlation id, which a key-targeted rule keeps where the column keeps
     * it (Common/Utils/Telemetry/CorrelationIdAttributes, #8924). Read
     * before any rule changes them.
     */
    const correlationIdKeys: ReadonlySet<string> =
      correlationIdAttributeKeys(logRow);

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
    const keyRules: Array<CompiledScrubRule<TRule>> = compiledRules.filter(
      (compiled: CompiledScrubRule<TRule>): boolean => {
        return isSensitiveKeysRule(compiled.rule);
      },
    );

    /*
     * Each of them reads the record's JSON texts - its body, then the JSON
     * texts its attributes hold (#8993) - within what the attributes' lists
     * and maps left of the record's allowance: every rule within the same
     * bounds.
     */
    const keysRulesOfRecord: Map<
      CompiledScrubRule<TRule>,
      ScrubJsonKeysRule
    > = new Map<CompiledScrubRule<TRule>, ScrubJsonKeysRule>();

    for (const compiled of keyRules) {
      keysRulesOfRecord.set(
        compiled,
        this.keysRuleOf(
          compiled,
          { remaining: allowance.remaining },
          jsonTexts,
          tally,
        ),
      );
    }

    if (keyRules.length > 0 && typeof logRow["body"] === "string") {
      logRow["body"] = this.hideSecretsInStructuredBody(
        logRow["body"] as string,
        Array.from(keysRulesOfRecord.values()),
      );
    }

    /*
     * Each rule's `fieldsToScrub` can be "body", "attributes", or
     * "both" — so each rule honours its own scope.
     */
    for (const compiled of compiledRules) {
      /*
       * A key-targeted rule acts on the values under keys: an attribute's,
       * and - for Sensitive Attribute Keys - those of a structured body,
       * which it read above whatever its scope says. A rule saved with a
       * body-only scope would otherwise be a silent no-op while looking
       * active in the rules table: such a rule always scrubs attributes.
       */
      const isKeyTargeted: boolean =
        isSensitiveKeysRule(compiled.rule) || isNamedKeysRule(compiled.rule);

      const fieldsToScrub: string = isKeyTargeted
        ? "attributes"
        : compiled.rule.fieldsToScrub || "both";

      // Scrub body - kept JSON when it is the JSON text of a list or a map.
      if (
        (fieldsToScrub === "body" || fieldsToScrub === "both") &&
        typeof logRow["body"] === "string"
      ) {
        logRow["body"] = this.scrubString(
          logRow["body"] as string,
          compiled,
          jsonTexts,
          tally,
          recorder,
        );
      }

      // Scrub attributes - the text inside lists and maps included.
      if (
        (fieldsToScrub === "attributes" || fieldsToScrub === "both") &&
        logRow["attributes"] &&
        typeof logRow["attributes"] === "object"
      ) {
        this.scrubAttributes({
          attributes: logRow["attributes"] as JSONObject,
          compiled,
          heldAsText,
          jsonTexts,
          correlationIdKeys,
          keysRule: keysRulesOfRecord.get(compiled),
          tally,
          recorder,
        });
      }
    }

    if (options?.countValues !== false) {
      countScrubbedValues({
        tally,
        signal: "log",
        projectId: compiledRules[0]?.rule.projectId,
        record: logRow,
      });
    }

    return logRow;
  }
}
