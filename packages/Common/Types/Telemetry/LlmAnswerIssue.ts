import { LlmCallKind } from "./LlmCallKind";

/*
 * WHAT WENT WRONG WITH AN AI ANSWER - decided once per call, at ingest.
 *
 * "Alert me when the AI answers badly" needs a definition of badly that is
 * cheap enough to compute for every call and reliable enough to page on. A
 * judge model is neither (it costs money per answer and sends customers'
 * conversations to another model), so these are the signals the call itself
 * carries:
 *
 *   failed   the call ended in an error (span status, error.type, or a
 *            finish reason of "error") - the person got no answer;
 *   refused  the model declined: the provider's own refusal / safety finish
 *            reason, a refusal part in the answer, or an answer that opens
 *            with a stock English refusal ("I'm sorry, but I can't ...");
 *   cut_off  the answer stopped at the token limit (finish reason "length",
 *            "max_tokens", "MAX_TOKENS" ...);
 *   empty    a successful answer with no text and no tool call - 0 output
 *            tokens, or recorded content that holds nothing;
 *   flagged  an evaluation of the answer (gen_ai.evaluation.result: a
 *            guardrail, an eval library, the app's own LLM judge, a
 *            thumbs-down) said it was bad.
 *
 * Slow and expensive are deliberately NOT here: what counts as slow or
 * expensive is the customer's threshold, so the AI / LLM monitor takes them
 * as numbers instead of baking one in at ingest.
 *
 * The values are stored in the Span's llmIssues column - never rename one.
 */
export enum LlmAnswerIssue {
  Failed = "failed",
  Refused = "refused",
  CutOff = "cut_off",
  Empty = "empty",
  Flagged = "flagged",
}

export interface LlmAnswerIssueInfo {
  issue: LlmAnswerIssue;
  // A label for a chip or a badge: "Failed", "Cut off".
  title: string;
  // The plural, for counts and filters: "Failed calls".
  pluralTitle: string;
  // One sentence a person reads in a tooltip or a monitor form.
  description: string;
}

const ISSUE_INFO: Record<LlmAnswerIssue, LlmAnswerIssueInfo> = {
  [LlmAnswerIssue.Failed]: {
    issue: LlmAnswerIssue.Failed,
    title: "Failed",
    pluralTitle: "Failed calls",
    description: "The AI call ended in an error, so no answer was delivered.",
  },
  [LlmAnswerIssue.Refused]: {
    issue: LlmAnswerIssue.Refused,
    title: "Refused",
    pluralTitle: "Refusals",
    description:
      "The AI declined to answer, or a safety filter blocked its answer.",
  },
  [LlmAnswerIssue.CutOff]: {
    issue: LlmAnswerIssue.CutOff,
    title: "Cut off",
    pluralTitle: "Cut-off answers",
    description: "The answer stopped because it reached the token limit.",
  },
  [LlmAnswerIssue.Empty]: {
    issue: LlmAnswerIssue.Empty,
    title: "Empty",
    pluralTitle: "Empty answers",
    description: "The AI answered with no text and no tool call.",
  },
  [LlmAnswerIssue.Flagged]: {
    issue: LlmAnswerIssue.Flagged,
    title: "Flagged",
    pluralTitle: "Flagged answers",
    description:
      "An evaluation your app sent (a guardrail, an eval or a thumbs-down) marked the answer as bad.",
  },
};

// The order every list, chip row and form shows the issues in.
const ISSUE_ORDER: Array<LlmAnswerIssue> = [
  LlmAnswerIssue.Failed,
  LlmAnswerIssue.Refused,
  LlmAnswerIssue.CutOff,
  LlmAnswerIssue.Empty,
  LlmAnswerIssue.Flagged,
];

/*
 * Finish reasons, lower-cased, that mean the answer was withheld. Provider
 * spellings: OpenAI "content_filter", Anthropic "refusal", Gemini "SAFETY",
 * "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_SAFETY",
 * Bedrock "guardrail_intervened" / "content_filtered", the Vercel AI SDK
 * "content-filter".
 */
const REFUSAL_FINISH_REASONS: ReadonlySet<string> = new Set<string>([
  "content_filter",
  "content-filter",
  "content_filtered",
  "refusal",
  "safety",
  "prohibited_content",
  "blocklist",
  "spii",
  "recitation",
  "image_safety",
  "guardrail_intervened",
]);

/*
 * Finish reasons that mean the answer hit the token limit: OpenAI and the
 * conventions "length", Anthropic and Bedrock "max_tokens", Gemini
 * "MAX_TOKENS", OpenAI Responses "max_output_tokens", Mistral
 * "model_length".
 */
const CUT_OFF_FINISH_REASONS: ReadonlySet<string> = new Set<string>([
  "length",
  "max_tokens",
  "max_output_tokens",
  "model_length",
  "model_context_window_exceeded",
]);

/*
 * Finish reasons that mean the model asked for a tool: no text is expected,
 * so an answer that carries none is not empty.
 */
const TOOL_FINISH_REASONS: ReadonlySet<string> = new Set<string>([
  "tool_calls",
  "tool_call",
  "tool-calls",
  "tool_use",
  "function_call",
]);

/*
 * The openings of a stock English refusal, matched against the first
 * characters of an answer only (never searched for inside it, so an answer
 * that quotes one later is not a refusal). Kept to sentences that do not
 * open a real answer: "I'm sorry, but I can't" is the model saying it will
 * not or cannot help, whether a policy or missing data stopped it - either
 * way the person did not get what they asked for. Answers in other languages
 * are caught only by the provider's own refusal signals above.
 */
export const LLM_REFUSAL_OPENINGS: ReadonlyArray<string> = [
  "i'm sorry, but i can't",
  "i'm sorry, but i cannot",
  "i am sorry, but i can't",
  "i am sorry, but i cannot",
  "sorry, but i can't",
  "sorry, but i cannot",
  "i'm sorry, i can't help",
  "i'm sorry, i cannot help",
  "i'm sorry, i can't assist",
  "i'm sorry, i cannot assist",
  "i can't help with that",
  "i cannot help with that",
  "i can't help with this",
  "i cannot help with this",
  "i can't assist with that",
  "i cannot assist with that",
  "i can't assist with this",
  "i cannot assist with this",
  "i'm unable to help with that",
  "i am unable to help with that",
  "i'm unable to assist with that",
  "i am unable to assist with that",
  "i'm not able to help with that",
  "i won't be able to help with that",
  "i must decline",
  "i can't comply",
  "i cannot comply",
  "as an ai language model, i can't",
  "as an ai language model, i cannot",
];

// How much of an answer the refusal check reads.
export const LLM_REFUSAL_OPENING_LENGTH: number = 160;

/*
 * Evaluation labels (gen_ai.evaluation.score.label, lower-cased, spaces and
 * hyphens as underscores) that say an answer was bad. Only labels that mean
 * the same under every evaluator are here: a bare "true" or "false" depends
 * on the question the evaluator asked ("hallucinated?" vs "correct?"), and a
 * score without a label has no agreed direction or scale, so neither flags
 * an answer.
 */
const FAILING_EVALUATION_LABELS: ReadonlySet<string> = new Set<string>([
  "fail",
  "failed",
  "failure",
  "failing",
  "incorrect",
  "not_correct",
  "wrong",
  "not_relevant",
  "irrelevant",
  "unhelpful",
  "not_helpful",
  "bad",
  "poor",
  "negative",
  "thumbs_down",
  "toxic",
  "harmful",
  "unsafe",
  "hallucinated",
  "hallucination",
  "not_grounded",
  "ungrounded",
  "unfaithful",
  "not_faithful",
  "inaccurate",
  "rejected",
  "blocked",
]);

// One evaluation of an answer, as read off its span.
export interface LlmEvaluationResult {
  name: string;
  label: string;
  score: number | null;
  explanation: string;
}

// What an answer's content looked like, as far as the checks need to know.
export interface LlmAnswerContentSummary {
  // Whether the instrumentation recorded the answer's content at all.
  recorded: boolean;
  hasText: boolean;
  hasToolCall: boolean;
  hasMedia: boolean;
  hasRefusal: boolean;
  // The first characters of the answer's text, for the refusal check.
  leadingText: string;
}

export interface LlmAnswerIssueInput {
  kind: LlmCallKind;
  // Span status Error.
  statusIsError: boolean;
  // error.type, "" when absent.
  errorType: string;
  // Lower-cased finish reasons, every choice's.
  finishReasons: Array<string>;
  // Output tokens as reported; null when the instrumentation reported none.
  outputTokens: number | null;
  answer: LlmAnswerContentSummary;
  evaluations: Array<LlmEvaluationResult>;
}

export class LlmAnswerIssueUtil {
  public static getInfo(issue: LlmAnswerIssue): LlmAnswerIssueInfo {
    return ISSUE_INFO[issue];
  }

  public static getAllIssues(): Array<LlmAnswerIssue> {
    return [...ISSUE_ORDER];
  }

  public static getAllInfo(): Array<LlmAnswerIssueInfo> {
    return ISSUE_ORDER.map((issue: LlmAnswerIssue): LlmAnswerIssueInfo => {
      return ISSUE_INFO[issue];
    });
  }

  /*
   * A stored or posted list read back: known values only, each once, in
   * display order. Anything else is dropped, never guessed.
   */
  public static fromValues(values: unknown): Array<LlmAnswerIssue> {
    if (!Array.isArray(values)) {
      return [];
    }

    const present: Set<string> = new Set<string>(
      values
        .filter((value: unknown): value is string => {
          return typeof value === "string";
        })
        .map((value: string): string => {
          return value.trim();
        }),
    );

    return ISSUE_ORDER.filter((issue: LlmAnswerIssue): boolean => {
      return present.has(issue);
    });
  }

  public static isRefusalFinishReason(reason: string): boolean {
    return REFUSAL_FINISH_REASONS.has(reason.trim().toLowerCase());
  }

  public static isCutOffFinishReason(reason: string): boolean {
    return CUT_OFF_FINISH_REASONS.has(reason.trim().toLowerCase());
  }

  public static isToolFinishReason(reason: string): boolean {
    return TOOL_FINISH_REASONS.has(reason.trim().toLowerCase());
  }

  /*
   * Whether an answer opens with a stock refusal. Reads only the opening
   * characters with plain string comparisons - an answer can be megabytes
   * long, and no regular expression ever runs over it.
   */
  public static opensWithRefusal(text: string): boolean {
    if (!text) {
      return false;
    }

    const opening: string = LlmAnswerIssueUtil.normalizeOpening(
      text.slice(0, LLM_REFUSAL_OPENING_LENGTH + 64),
    );

    if (!opening) {
      return false;
    }

    return LLM_REFUSAL_OPENINGS.some((refusal: string): boolean => {
      return opening.startsWith(refusal);
    });
  }

  public static isFailingEvaluation(evaluation: LlmEvaluationResult): boolean {
    const label: string = LlmAnswerIssueUtil.normalizeLabel(evaluation.label);

    return label.length > 0 && FAILING_EVALUATION_LABELS.has(label);
  }

  public static getIssues(input: LlmAnswerIssueInput): Array<LlmAnswerIssue> {
    const issues: Set<LlmAnswerIssue> = new Set<LlmAnswerIssue>();

    const finishReasons: Array<string> = input.finishReasons
      .map((reason: string): string => {
        return reason.trim().toLowerCase();
      })
      .filter((reason: string): boolean => {
        return reason.length > 0;
      });

    const failed: boolean =
      input.statusIsError ||
      input.errorType.trim().length > 0 ||
      finishReasons.includes("error");

    if (failed) {
      issues.add(LlmAnswerIssue.Failed);
    }

    /*
     * Refused, cut off and empty judge an ANSWER. A tool run, an embedding
     * or an agent wrapper has no answer of its own to judge; it can still
     * fail, and it can still be flagged by an evaluation.
     */
    if (input.kind === LlmCallKind.Answer) {
      const refused: boolean =
        finishReasons.some((reason: string): boolean => {
          return REFUSAL_FINISH_REASONS.has(reason);
        }) ||
        input.answer.hasRefusal ||
        LlmAnswerIssueUtil.opensWithRefusal(input.answer.leadingText);

      if (refused) {
        issues.add(LlmAnswerIssue.Refused);
      }

      if (
        finishReasons.some((reason: string): boolean => {
          return CUT_OFF_FINISH_REASONS.has(reason);
        })
      ) {
        issues.add(LlmAnswerIssue.CutOff);
      }

      if (!failed && !refused) {
        const askedForTool: boolean = finishReasons.some(
          (reason: string): boolean => {
            return TOOL_FINISH_REASONS.has(reason);
          },
        );

        const recordedNothing: boolean =
          input.answer.recorded &&
          !input.answer.hasText &&
          !input.answer.hasToolCall &&
          !input.answer.hasMedia;

        /*
         * Recorded content outranks the token count: an answer whose text
         * is on the span is not empty even if a buggy SDK reported 0 output
         * tokens. Without content, an explicit 0 is the evidence - a missing
         * count proves nothing.
         */
        const reportedNothing: boolean =
          !input.answer.recorded && input.outputTokens === 0;

        if (!askedForTool && (recordedNothing || reportedNothing)) {
          issues.add(LlmAnswerIssue.Empty);
        }
      }
    }

    if (
      input.evaluations.some((evaluation: LlmEvaluationResult): boolean => {
        return LlmAnswerIssueUtil.isFailingEvaluation(evaluation);
      })
    ) {
      issues.add(LlmAnswerIssue.Flagged);
    }

    return ISSUE_ORDER.filter((issue: LlmAnswerIssue): boolean => {
      return issues.has(issue);
    });
  }

  private static normalizeOpening(text: string): string {
    let normalized: string = "";
    let lastWasSpace: boolean = true;

    for (const character of text.toLowerCase()) {
      // Typographic apostrophes read as the plain one.
      const plain: string =
        character === "’" || character === "‘" ? "'" : character;

      const isSpace: boolean =
        plain === " " ||
        plain === "\n" ||
        plain === "\t" ||
        plain === "\r" ||
        plain === " ";

      if (isSpace) {
        if (!lastWasSpace) {
          normalized += " ";
        }
        lastWasSpace = true;
        continue;
      }

      // Leading quotes and markdown emphasis do not change what was said.
      if (
        normalized.length === 0 &&
        (plain === '"' || plain === "*" || plain === "_" || plain === "'")
      ) {
        continue;
      }

      normalized += plain;
      lastWasSpace = false;
    }

    return normalized;
  }

  private static normalizeLabel(label: string): string {
    let normalized: string = "";

    for (const character of (label || "").trim().toLowerCase()) {
      normalized += character === " " || character === "-" ? "_" : character;
    }

    return normalized;
  }
}
