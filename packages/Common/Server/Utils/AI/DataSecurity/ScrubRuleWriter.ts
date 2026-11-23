import {
  MAX_SCRUB_RULE_WRITER_PLACES,
  ScrubRuleWriterPlace,
  ScrubRuleWriterRule,
  ScrubRuleWriterRuleKind,
} from "../../../../Types/DataSecurity/ScrubRuleWriterPlace";
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

  const placeOf: Map<string, ScrubRuleWriterPlace> = new Map<
    string,
    ScrubRuleWriterPlace
  >();

  for (const place of data.places) {
    placeOf.set(place.ref, place);
  }

  const rules: Array<ScrubRuleWriterRule> = [];
  const seen: Set<string> = new Set<string>();

  for (const rule of answer.rules) {
    const place: ScrubRuleWriterPlace | undefined = placeOf.get(rule.ref);
    const seenKey: string = `${rule.ref}|${rule.kind}`;

    if (!place || seen.has(seenKey)) {
      continue;
    }

    if (rule.kind === ScrubRuleWriterRuleKind.Pattern) {
      const pattern: string = (rule.pattern || "").trim();

      if (!pattern || checkScrubRuleCustomRegex(pattern) !== null) {
        continue;
      }

      seen.add(seenKey);
      rules.push({
        ref: rule.ref,
        kind: ScrubRuleWriterRuleKind.Pattern,
        pattern,
      });
      continue;
    }

    // The place's own key, and no other: OneUptime AI never widens a rule.
    const own: string = place.attributeKey
      ? toComparedScrubRuleKey(place.attributeKey)
      : "";

    if (
      !own ||
      !(rule.keys || []).some((key: string): boolean => {
        return toComparedScrubRuleKey(key) === own;
      })
    ) {
      continue;
    }

    seen.add(seenKey);
    rules.push({
      ref: rule.ref,
      kind: ScrubRuleWriterRuleKind.Keys,
      keys: [place.attributeKey!],
    });
  }

  return rules;
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
