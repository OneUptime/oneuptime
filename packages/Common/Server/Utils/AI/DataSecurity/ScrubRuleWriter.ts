import {
  MAX_SCRUB_RULE_WRITER_PLACES,
  ScrubRuleWriterPlace,
  ScrubRuleWriterRule,
  ScrubRuleWriterRuleKind,
} from "../../../../Types/DataSecurity/ScrubRuleWriterPlace";
import { sha256Hex } from "../../../../Types/AutoRemediation/RemediationPlanFingerprint";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  checkScrubRuleCustomRegex,
  SCRUB_RULE_CUSTOM_PATTERN_TYPE,
} from "../../../../Types/Telemetry/ScrubRule";
import {
  MAX_SCRUB_RULE_KEY_LENGTH,
  SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE,
  toComparedScrubRuleKey,
} from "../../../../Types/Telemetry/ScrubRuleKeys";
import AIService from "../../../Services/AIService";
import { ScrubTarget } from "../../../../Types/DataSecurity/TelemetryScrubTarget";
import logger from "../../Logger";
import {
  getFieldsToScrubOfTarget,
  getScrubActionOfCategory,
  ScrubRuleCandidate,
  ScrubRuleSource,
} from "../../DataSecurity/Telemetry/TelemetryScrubPlanner";
import AIInvestigationEngine from "../SRE/AIInvestigationEngine";
import DataSecurityAiCall from "./DataSecurityAiCall";
import {
  buildWriteScrubRulesPrompt,
  DataSecurityAiPrompt,
} from "./DataSecurityAiInput";
import {
  readStrictAnswer,
  StrictAnswer,
  StrictList,
  StrictObject,
  StrictOptional,
  StrictText,
  StrictValue,
} from "./StrictAnswer";

/*
 * THE SCRUB RULES ONEUPTIME AI WRITES FOR WHAT SCRUB IT CANNOT COVER
 * (#10366).
 *
 * Where none of the planner's rules fits a telemetry finding - or none it
 * proved hides the data - OneUptime AI is asked for the narrowest rule it
 * can write: a pattern for the data, or the attribute to hide whole. It is
 * told each place's data type, where it sits, the names of the attributes
 * around it and the shapes of its values (Types/DataSecurity/
 * ScrubRuleWriterPlace), through the one input builder and the one call -
 * never a value, a sample or a record - and its answer is read strictly:
 *
 *  - a pattern must be one a scrub rule can run (checkScrubRuleCustomRegex)
 *    and, for an attribute, is read only in that attribute;
 *  - the attributes to hide must be the place's own key: OneUptime AI may
 *    not widen a rule to other attributes;
 *  - a place it was not asked about, or a rule of neither kind, is left
 *    out.
 *
 * What it writes is a candidate, nothing more: the verifier proves it on
 * the finding's records (DataSecurity/Telemetry/TelemetryScrubProof), as it
 * proves the planner's own, before anything is offered.
 */

export const SCRUB_RULE_WRITER_MAX_TOKENS: number = 2500;
export const SCRUB_RULE_WRITER_TEMPERATURE: number = 0;
export const SCRUB_RULE_WRITER_TIMEOUT_IN_MS: number = 90_000;

// The longest pattern a rule keeps: a custom pattern's limit.
const MAX_PATTERN_LENGTH: number = 500;

export const SCRUB_RULE_WRITER_INSTRUCTIONS: string = [
  "You write scrub rules for OneUptime Data Security. A scrub rule hides sensitive data in a service's logs or traces before they are stored.",
  "Each place in the data is one finding: a data type found at a location of one service's logs or traces, with the names of the attributes beside it and the shapes of its values - every letter written as a (lower case) or A (upper case), every digit as 9, every other character as it is. It never holds a value.",
  'For each place, write the narrowest rule that hides that data type there and nothing else. Answer with one JSON object and nothing else: {"rules":[{"ref":"P1","kind":"pattern","pattern":"\\\\bCUST-\\\\d{6}\\\\b"},{"ref":"P2","kind":"keys","keys":["customer_name"]}]}.',
  'kind "pattern": a JavaScript regular expression without slashes or flags, matched with its case, that matches the data type\'s values as their shapes show them and no other text. Prefer anchors and exact counts: \\\\b, fixed prefixes, {6} rather than +. Use a pattern when the data has a shape of its own.',
  "kind \"keys\": hide the whole value of the place's own attribute, given in key. Use it when the data has no shape a pattern can tell apart, such as a person's name, and only for a place that has a key.",
  "A rule is proven on the records it was written for before anyone relies on it: one that also changes other values there is never used. Leave a place out when you cannot write a rule for it.",
].join("\n");

export const SCRUB_RULE_WRITER_ANSWER_SHAPE: StrictObject<{
  rules: StrictList<
    StrictObject<{
      ref: StrictText;
      kind: StrictText;
      pattern: StrictOptional<StrictText>;
      keys: StrictOptional<StrictList<StrictText>>;
    }>
  >;
}> = StrictAnswer.object({
  rules: StrictAnswer.list(
    StrictAnswer.object({
      ref: StrictAnswer.text({
        maxLength: 10,
        isOneLine: true,
        whenTooLong: "refuse",
      }),
      kind: StrictAnswer.text({
        maxLength: 10,
        isOneLine: true,
        oneOf: [ScrubRuleWriterRuleKind.Pattern, ScrubRuleWriterRuleKind.Keys],
      }),
      pattern: StrictAnswer.optional(
        StrictAnswer.text({
          maxLength: MAX_PATTERN_LENGTH,
          whenTooLong: "refuse",
        }),
      ),
      keys: StrictAnswer.optional(
        StrictAnswer.list(
          StrictAnswer.text({
            maxLength: MAX_SCRUB_RULE_KEY_LENGTH,
            isOneLine: true,
            whenTooLong: "refuse",
          }),
          { maxItems: 5 },
        ),
      ),
    }),
    { maxItems: MAX_SCRUB_RULE_WRITER_PLACES * 2 },
  ),
});

export type ScrubRuleWriterStrictAnswer = StrictValue<
  typeof SCRUB_RULE_WRITER_ANSWER_SHAPE
>;

// Why OneUptime AI wrote nothing, as Why AI did not act's detail codes.
export const SCRUB_RULE_WRITER_NOTHING: {
  noPlace: "no-place-to-write-for";
  noProvider: "no-llm-provider";
  noCredits: "no-ai-credits";
  dailyLimit: "ai-daily-limit-reached";
  callFailed: "could-not-ask";
  unreadable: "answer-not-read";
} = {
  noPlace: "no-place-to-write-for",
  noProvider: "no-llm-provider",
  noCredits: "no-ai-credits",
  dailyLimit: "ai-daily-limit-reached",
  callFailed: "could-not-ask",
  unreadable: "answer-not-read",
};

export type ScrubRuleWriterOutcome =
  | { kind: "written"; rules: Array<ScrubRuleWriterRule> }
  | { kind: "nothing"; detail: string };

// The prompt for the places, built by the one input builder.
export function buildScrubRuleWriterPrompt(
  places: ReadonlyArray<ScrubRuleWriterPlace>,
): DataSecurityAiPrompt {
  return buildWriteScrubRulesPrompt({
    instructions: SCRUB_RULE_WRITER_INSTRUCTIONS,
    places,
  });
}

// One rule of an answer, or of an answer kept from before: its kind and what it holds.
interface WrittenRule {
  kind: string;
  pattern?: string | null | undefined;
  keys?: ReadonlyArray<string> | null | undefined;
}

/*
 * The rules a place keeps of what OneUptime AI wrote for it: a pattern a
 * scrub rule can run, or the place's own key and no other - OneUptime AI
 * never widens a rule - and one rule of each kind at most.
 */
function keepRulesOfPlace(
  place: ScrubRuleWriterPlace,
  written: ReadonlyArray<WrittenRule>,
): Array<ScrubRuleWriterRule> {
  const rules: Array<ScrubRuleWriterRule> = [];
  const seen: Set<string> = new Set<string>();

  for (const rule of written) {
    if (seen.has(rule.kind)) {
      continue;
    }

    if (rule.kind === ScrubRuleWriterRuleKind.Pattern) {
      const pattern: string = (rule.pattern || "").trim();

      if (!pattern || checkScrubRuleCustomRegex(pattern) !== null) {
        continue;
      }

      seen.add(rule.kind);
      rules.push({
        ref: place.ref,
        kind: ScrubRuleWriterRuleKind.Pattern,
        pattern,
      });
      continue;
    }

    if (rule.kind !== ScrubRuleWriterRuleKind.Keys) {
      continue;
    }

    const own: string = place.attributeKey
      ? toComparedScrubRuleKey(place.attributeKey)
      : "";

    if (
      !own ||
      !(rule.keys || []).some((key: string): boolean => {
        return typeof key === "string" && toComparedScrubRuleKey(key) === own;
      })
    ) {
      continue;
    }

    seen.add(rule.kind);
    rules.push({
      ref: place.ref,
      kind: ScrubRuleWriterRuleKind.Keys,
      keys: [place.attributeKey!],
    });
  }

  return rules;
}

/*
 * OneUptime AI's answer, held to the places it was asked about: a rule
 * for a place it was not asked about, a pattern no scrub rule can run, or
 * keys other than the place's own, is left out - and each place keeps one
 * rule of each kind at most.
 */
export function readScrubRuleWriterAnswer(data: {
  content: string | null | undefined;
  places: ReadonlyArray<ScrubRuleWriterPlace>;
}): Array<ScrubRuleWriterRule> | null {
  const answer: ScrubRuleWriterStrictAnswer | null = readStrictAnswer(
    data.content,
    SCRUB_RULE_WRITER_ANSWER_SHAPE,
  );

  if (!answer) {
    return null;
  }

  const rules: Array<ScrubRuleWriterRule> = [];

  for (const place of data.places) {
    rules.push(
      ...keepRulesOfPlace(
        place,
        answer.rules.filter((rule: { ref: string }): boolean => {
          return rule.ref === place.ref;
        }),
      ),
    );
  }

  return rules;
}

/*
 * WHAT ONEUPTIME AI WAS TOLD OF A PLACE, AND WHAT IT WROTE: ASKED ONCE
 * (#10752).
 *
 * The issue is evaluated again whenever the hourly scan writes new
 * findings into it, and each evaluation planned every place again: a
 * place only OneUptime AI could write a rule for went back to the model
 * with the same data type, location, names and shapes, and the answer was
 * proven again and, nothing having changed, ended in the same proposal -
 * spending the project's AI credits for no new rule. So a place keeps,
 * on its finding, what OneUptime AI was told of it, hashed, and what it
 * wrote: its rules, or none (DataStoreFinding.aiScrubRuleInputHash and
 * aiScrubRules, written by the scrub action). A place told the same again
 * reuses that answer, proven again on the newest records, and makes no
 * model call; a place whose data type, location, neighbours or shapes
 * changed - or whose instructions did - is asked again. A call that
 * failed keeps nothing, so the place is asked next time.
 */

/*
 * What OneUptime AI is told of a place, as one hash: the instructions it
 * is given, the data type (its id, the name the project gives it, its
 * category, whether names or values find it), where it sits, the names
 * beside it and the shapes of its values. Never its reference in a prompt,
 * how many values there were, how long they are or what share each shape
 * has, which change with every read; and the names and shapes as sets, so
 * an order that changed with the counts changes nothing.
 */
export function getScrubRuleWriterInputHash(
  place: ScrubRuleWriterPlace,
): string {
  const uniqueSorted: (items: ReadonlyArray<string>) => Array<string> = (
    items: ReadonlyArray<string>,
  ): Array<string> => {
    return Array.from(new Set(items)).sort();
  };

  return sha256Hex(
    JSON.stringify([
      SCRUB_RULE_WRITER_INSTRUCTIONS,
      place.dataTypeId,
      place.dataTypeName,
      place.category,
      place.foundBy,
      place.signal,
      place.location,
      place.attributeKey || "",
      place.locationKind,
      uniqueSorted(place.neighbours),
      uniqueSorted(
        place.shapes.map((shape: { shape: string }): string => {
          return shape.shape;
        }),
      ),
    ]),
  );
}

// What a finding keeps of OneUptime AI's answer for its place: its rules, none being an answer too.
export function toKeptScrubRuleWriterRules(
  rules: ReadonlyArray<ScrubRuleWriterRule>,
): JSONObject {
  return {
    rules: rules.map((rule: ScrubRuleWriterRule): JSONObject => {
      return rule.kind === ScrubRuleWriterRuleKind.Keys
        ? { kind: rule.kind, keys: [...(rule.keys || [])] }
        : { kind: rule.kind, pattern: rule.pattern || "" };
    }),
  };
}

/*
 * The answer a finding kept for its place, held to the place as a fresh
 * answer is (keepRulesOfPlace) - or null when it kept none, or what it
 * kept is no answer: then OneUptime AI is asked.
 */
export function readKeptScrubRuleWriterRules(
  kept: unknown,
  place: ScrubRuleWriterPlace,
): Array<ScrubRuleWriterRule> | null {
  if (!kept || typeof kept !== "object" || Array.isArray(kept)) {
    return null;
  }

  const rules: unknown = (kept as JSONObject)["rules"];

  if (!Array.isArray(rules)) {
    return null;
  }

  const written: Array<WrittenRule> = [];

  for (const item of rules) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }

    const rule: JSONObject = item as JSONObject;

    if (typeof rule["kind"] !== "string") {
      return null;
    }

    written.push({
      kind: rule["kind"],
      pattern: typeof rule["pattern"] === "string" ? rule["pattern"] : null,
      keys: Array.isArray(rule["keys"])
        ? (rule["keys"] as Array<unknown>).filter(
            (key: unknown): key is string => {
              return typeof key === "string";
            },
          )
        : null,
    });
  }

  return keepRulesOfPlace(place, written);
}

/*
 * A rule OneUptime AI wrote, as the planner's candidate for its place: a
 * pattern only in the place's attribute (in a log body for a body), the
 * attribute hidden whole, each with the action of the data's category.
 */
export function toScrubRuleCandidate(data: {
  rule: ScrubRuleWriterRule;
  place: ScrubRuleWriterPlace;
  target: ScrubTarget & { signal: "log" | "trace" };
}): ScrubRuleCandidate {
  const action: string = getScrubActionOfCategory(data.place.category);

  if (data.rule.kind === ScrubRuleWriterRuleKind.Keys) {
    return {
      source: ScrubRuleSource.OneUptimeAi,
      signal: data.target.signal,
      patternType: SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE,
      attributeKeys: [...(data.rule.keys || [])],
      scrubAction: action,
      fieldsToScrub: getFieldsToScrubOfTarget(data.target),
    };
  }

  return {
    source: ScrubRuleSource.OneUptimeAi,
    signal: data.target.signal,
    patternType: SCRUB_RULE_CUSTOM_PATTERN_TYPE,
    customRegex: data.rule.pattern || "",
    ...(data.place.attributeKey
      ? { attributeKeys: [data.place.attributeKey] }
      : {}),
    scrubAction: action,
    fieldsToScrub: getFieldsToScrubOfTarget(data.target),
  };
}

export default class ScrubRuleWriter {
  /*
   * OneUptime AI's rules for the places, on the project's own model - the
   * provider the AI rule picks - within its credits and daily limit. A
   * call that fails, or an answer that cannot be read, writes nothing, and
   * says why.
   */
  public static async write(data: {
    projectId: ObjectID;
    places: ReadonlyArray<ScrubRuleWriterPlace>;
    llmProviderId?: string | undefined;
  }): Promise<ScrubRuleWriterOutcome> {
    const places: Array<ScrubRuleWriterPlace> = data.places.slice(
      0,
      MAX_SCRUB_RULE_WRITER_PLACES,
    );

    if (places.length === 0) {
      return { kind: "nothing", detail: SCRUB_RULE_WRITER_NOTHING.noPlace };
    }

    const pickedProviderId: ObjectID | undefined =
      data.llmProviderId && ObjectID.isValidUUID(data.llmProviderId)
        ? new ObjectID(data.llmProviderId)
        : undefined;
    const blocker: "provider_missing" | "insufficient_ai_balance" | null =
      await AIInvestigationEngine.getProviderOrBalanceReason(
        data.projectId,
        pickedProviderId,
      );

    if (blocker === "provider_missing") {
      return { kind: "nothing", detail: SCRUB_RULE_WRITER_NOTHING.noProvider };
    }

    if (blocker === "insufficient_ai_balance") {
      return { kind: "nothing", detail: SCRUB_RULE_WRITER_NOTHING.noCredits };
    }

    if (
      await AIService.getReachedProjectDailyLimit({ projectId: data.projectId })
    ) {
      return { kind: "nothing", detail: SCRUB_RULE_WRITER_NOTHING.dailyLimit };
    }

    let content: string;

    try {
      const response: { content: string } = await DataSecurityAiCall.ask({
        projectId: data.projectId,
        prompt: buildScrubRuleWriterPrompt(places),
        maxTokens: SCRUB_RULE_WRITER_MAX_TOKENS,
        temperature: SCRUB_RULE_WRITER_TEMPERATURE,
        requestTimeoutInMs: SCRUB_RULE_WRITER_TIMEOUT_IN_MS,
        requestRetries: 0,
        // No person started it: the call's own messages and bounds hold.
        protectRequestParameters: true,
        rulePickedProviderId: data.llmProviderId,
      });

      content = response.content || "";
    } catch (error) {
      logger.info(
        `DataSecurity scrub rules: could not ask OneUptime AI for project ${data.projectId.toString()}: ${error}`,
      );
      return { kind: "nothing", detail: SCRUB_RULE_WRITER_NOTHING.callFailed };
    }

    const rules: Array<ScrubRuleWriterRule> | null = readScrubRuleWriterAnswer({
      content,
      places,
    });

    return rules
      ? { kind: "written", rules }
      : { kind: "nothing", detail: SCRUB_RULE_WRITER_NOTHING.unreadable };
  }
}
