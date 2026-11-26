import Label from "../../../../Models/DatabaseModels/Label";
import Team from "../../../../Models/DatabaseModels/Team";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { ALL_DATA_CATEGORIES } from "../../../../Types/DataSecurity/DataCategory";
import { getKnownCloudRegions } from "../../../../Types/DataSecurity/CloudRegionCountry";
import {
  DataSecurityRuleDraft,
  DataSecurityRuleKind,
  getDataSecurityRuleDraftProblem,
} from "../../../../Types/DataSecurity/DataSecurityRuleDraft";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import LinearRegExp from "../../../../Utils/LinearRegExp/LinearRegExp";
import AIService, {
  AILogResponse,
  INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
} from "../../../Services/AIService";
import LabelService from "../../../Services/LabelService";
import TeamService from "../../../Services/TeamService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  AiRuleDraftRetry,
  buildRuleFromSentencePrompt,
  MAX_RULE_DRAFT_NAMES,
  MAX_RULE_SENTENCE_LENGTH,
} from "./DataSecurityAiInput";
import DataSecurityAiCall from "./DataSecurityAiCall";
import {
  readRuleDraftAnswer,
  RULE_FROM_SENTENCE_SYSTEM_PROMPT,
  RuleDraftAnswer,
} from "./RuleDraftPrompt";

/*
 * A DATA SECURITY RULE FROM A SENTENCE (#10378).
 *
 * A person tells Ask AI, or an agent tells the MCP server, a rule in their
 * own words: "EU personal data must stay in the EU". OneUptime AI drafts a
 * residency, owner or label rule from it - the kind the sentence asks for,
 * so the model in the conversation never chooses it before the person sees
 * the draft - through the one Data Security call (DataSecurityAiCall), with
 * the prompt DataSecurityAiInput builds: the sentence, the kinds of data
 * and the regions a rule can name, and the project's labels and teams by
 * name, as the person may read them. Never a store, a finding or a person.
 * Nothing is saved here: the draft is shown with the stores it matches
 * today (DataSecurityRulePreview), and saved only when the person approves
 * it.
 *
 * The draft is held to what a saved rule is held to - a name, a region a
 * cloud names, a country's code, owners or labels for the kinds that take
 * them, patterns that run in linear time - and asked for once more, told
 * why, when it is not. One request (two at most), started by a person and
 * answered while they wait: held to the interactive limits, metered and
 * billed like any other request, inside the project's daily AI limits.
 */

// How much the answer may be.
export const RULE_DRAFT_MAX_COMPLETION_TOKENS: number = 1_500;

// How many times the model may write the draft: once, and once more to fix it.
export const RULE_DRAFT_ATTEMPTS: number = 2;

// The shortest sentence that can ask for a rule.
export const MIN_RULE_SENTENCE_LENGTH: number = 6;

export const RULE_SENTENCE_MISSING_MESSAGE: string =
  "Say the rule in a sentence, such as: EU personal data must stay in the EU.";

export const RULE_SENTENCE_TOO_LONG_MESSAGE: string = `Say the rule in at most ${MAX_RULE_SENTENCE_LENGTH.toLocaleString("en-US")} characters.`;

export const RULE_NO_ANSWER_MESSAGE: string =
  "OneUptime AI did not answer with a rule. Try again, or say it differently.";

export const RULE_UNUSABLE_MESSAGE: string =
  "OneUptime AI could not draft a rule OneUptime can save from that sentence. Say it differently, or write the rule in Data Security's Settings.";

export interface DraftedDataSecurityRule {
  draft: DataSecurityRuleDraft;
  // Why OneUptime AI drafted it so, in a sentence.
  reason: string;
}

export function readRuleSentence(value: unknown): string {
  const sentence: string =
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

  if (sentence.length < MIN_RULE_SENTENCE_LENGTH) {
    throw new BadDataException(RULE_SENTENCE_MISSING_MESSAGE);
  }

  if (sentence.length > MAX_RULE_SENTENCE_LENGTH) {
    throw new BadDataException(RULE_SENTENCE_TOO_LONG_MESSAGE);
  }

  return sentence;
}

/*
 * Why a draft's patterns cannot run where the rule runs them - in linear
 * time, ignoring case - or null when they can.
 */
export function getRuleDraftPatternProblem(
  draft: DataSecurityRuleDraft,
): string | null {
  if (draft.kind === DataSecurityRuleKind.Residency) {
    return null;
  }

  for (const [field, pattern] of [
    ["nameRegexPattern", draft.nameRegexPattern],
    ["descriptionRegexPattern", draft.descriptionRegexPattern],
    ["cloudTagPattern", draft.cloudTagPattern],
  ] as Array<[string, string]>) {
    if (!pattern) {
      continue;
    }

    try {
      new LinearRegExp(pattern, "i");
    } catch {
      return `${field} ${JSON.stringify(pattern)} is not a regular expression OneUptime can run: it does not compile, or uses a backreference or a lookaround.`;
    }
  }

  return null;
}

export default class RuleFromSentence {
  @CaptureSpan()
  public static async draft(data: {
    projectId: ObjectID;
    userId?: ObjectID | undefined;
    sentence: unknown;
    // The person's: the labels and teams the draft may name, as they may read them.
    props: DatabaseCommonInteractionProps;
  }): Promise<DraftedDataSecurityRule> {
    const sentence: string = readRuleSentence(data.sentence);

    // The project's AI switch first: the answer says where to turn it on.
    await AIService.assertProjectAIEnabled(data.projectId);

    const [labels, teams]: [Array<string>, Array<string>] = await Promise.all([
      this.readNames(data, "labels"),
      this.readNames(data, "teams"),
    ]);
    let retry: AiRuleDraftRetry | undefined = undefined;

    for (let attempt: number = 1; attempt <= RULE_DRAFT_ATTEMPTS; attempt++) {
      /*
       * Through the one Data Security call: the sentence and OneUptime's own
       * catalogs, never a store, and nothing of either in the AI Logs.
       */
      const response: AILogResponse = await DataSecurityAiCall.ask({
        projectId: data.projectId,
        userId: data.userId,
        prompt: buildRuleFromSentencePrompt({
          instructions: RULE_FROM_SENTENCE_SYSTEM_PROMPT,
          sentence,
          dataCategories: ALL_DATA_CATEGORIES,
          regions: getKnownCloudRegions(),
          labels,
          teams,
          retry,
        }),
        temperature: 0,
        maxTokens: RULE_DRAFT_MAX_COMPLETION_TOKENS,
        // The person waits on the answer: one attempt, within the proxy's budget.
        requestTimeoutInMs: INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
        requestRetries: 0,
      });
      const answer: RuleDraftAnswer | null = readRuleDraftAnswer(
        response.content,
      );

      if (!answer) {
        if (attempt < RULE_DRAFT_ATTEMPTS) {
          retry = {
            problem:
              "the answer was not the JSON object asked for, or its kind is not one of the three",
          };
          continue;
        }

        throw new BadDataException(RULE_NO_ANSWER_MESSAGE);
      }

      if (answer.kind === "none") {
        throw new BadDataException(
          answer.reason
            ? `OneUptime AI found no rule to draft in that sentence: ${answer.reason.replace(/[.\s]+$/, "")}. Say it differently, or write the rule in Data Security's Settings.`
            : "OneUptime AI found no rule to draft in that sentence. Say it differently, or write the rule in Data Security's Settings.",
        );
      }

      const problem: string | null =
        getDataSecurityRuleDraftProblem(answer.draft) ||
        getRuleDraftPatternProblem(answer.draft);

      if (!problem) {
        return { draft: answer.draft, reason: answer.reason };
      }

      retry = { problem };
    }

    throw new BadDataException(RULE_UNUSABLE_MESSAGE);
  }

  // The project's labels' or teams' names, as the person may read them; none when they may not.
  private static async readNames(
    data: { projectId: ObjectID; props: DatabaseCommonInteractionProps },
    what: "labels" | "teams",
  ): Promise<Array<string>> {
    try {
      const rows: Array<Label | Team> =
        what === "labels"
          ? await LabelService.findBy({
              query: { projectId: data.projectId },
              select: { _id: true, name: true },
              limit: MAX_RULE_DRAFT_NAMES,
              skip: 0,
              props: data.props,
            })
          : await TeamService.findBy({
              query: { projectId: data.projectId },
              select: { _id: true, name: true },
              limit: MAX_RULE_DRAFT_NAMES,
              skip: 0,
              props: data.props,
            });

      return rows
        .map((row: Label | Team): string => {
          return (row.name || "").trim();
        })
        .filter((name: string): boolean => {
          return name.length > 0;
        });
    } catch (error) {
      logger.debug(
        `DataSecurity: could not read project ${data.projectId.toString()}'s ${what} for a rule's draft; drafting without them: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }
}
