import BadDataException from "../../../../Types/Exception/BadDataException";
import {
  CallSummaryAction,
  CallSummaryBasis,
  CallSummaryCitation,
  CallSummaryFinding,
  CallSummaryPoint,
  CallSummaryRootCause,
  CallSummaryRootCauseOutcome,
  MAX_CALL_SUMMARY_POINTS,
} from "../../../../Types/VideoCall/CallSummary";
import { TranscriptLine } from "../../../../Utils/VideoCall/TranscriptText";
import { LLMMessage } from "../../LLM/LLMService";
import CallSummaryAnswer, { CallSummaryPartAnswer } from "./CallSummaryAnswer";
import CallSummaryPrompt, {
  CALL_SUMMARY_PART_CHARACTERS,
  CallSummaryCauseCandidate,
  CallSummaryIncident,
  TranscriptPart,
} from "./CallSummaryPrompt";

/*
 * READS A CALL'S TRANSCRIPT WITH ONEUPTIME AI.
 *
 * One request to the model per part of the transcript (most calls are one
 * part), one after another, and - only when more than one part pointed at
 * a cause - one more to weigh those causes together. Everything else the
 * parts found is put together in the call's order, each point once.
 *
 * The model is reached through `complete`, so the reading itself is plain
 * code a test drives with answers of its own; IncidentCallSummary hands in
 * AIService, which meters, limits and logs every request like any other AI
 * feature.
 */

export type CallSummaryCompletion = (data: {
  messages: Array<LLMMessage>;
  // Reading one part of the transcript, or weighing the parts' causes.
  purpose: "part" | "combine";
}) => Promise<string>;

export interface CallSummaryContent {
  rootCause: CallSummaryRootCause;
  findings: Array<CallSummaryFinding>;
  stepsTried: Array<CallSummaryPoint>;
  decisions: Array<CallSummaryPoint>;
  actions: Array<CallSummaryAction>;
  openQuestions: Array<CallSummaryPoint>;
  linesRead: number;
  partsRead: number;
}

export default class CallSummaryReader {
  public static async read(data: {
    lines: Array<TranscriptLine>;
    incident: CallSummaryIncident;
    callLabel: string;
    complete: CallSummaryCompletion;
    partCharacters?: number | undefined;
  }): Promise<CallSummaryContent> {
    if (data.lines.length === 0) {
      throw new BadDataException("This call has no transcript to read.");
    }

    const parts: Array<TranscriptPart> = CallSummaryPrompt.splitIntoParts(
      data.lines,
      data.partCharacters || CALL_SUMMARY_PART_CHARACTERS,
    );

    const answers: Array<CallSummaryPartAnswer> = [];

    for (const part of parts) {
      const content: string = await data.complete({
        messages: CallSummaryPrompt.buildPartMessages({
          incident: data.incident,
          callLabel: data.callLabel,
          part,
          totalLines: data.lines.length,
        }),
        purpose: "part",
      });

      answers.push(
        CallSummaryAnswer.readPart(content, {
          lines: data.lines,
          allowed: CallSummaryReader.lineNumbersOf(part),
        }),
      );
    }

    return {
      rootCause: await CallSummaryReader.weighCauses({
        answers,
        lines: data.lines,
        incident: data.incident,
        callLabel: data.callLabel,
        complete: data.complete,
      }),
      findings: CallSummaryReader.joinPoints(
        answers.map((answer: CallSummaryPartAnswer) => {
          return answer.findings;
        }),
      ),
      stepsTried: CallSummaryReader.joinPoints(
        answers.map((answer: CallSummaryPartAnswer) => {
          return answer.stepsTried;
        }),
      ),
      decisions: CallSummaryReader.joinPoints(
        answers.map((answer: CallSummaryPartAnswer) => {
          return answer.decisions;
        }),
      ),
      actions: CallSummaryReader.joinPoints(
        answers.map((answer: CallSummaryPartAnswer) => {
          return answer.actions;
        }),
      ),
      openQuestions: CallSummaryReader.joinPoints(
        answers.map((answer: CallSummaryPartAnswer) => {
          return answer.openQuestions;
        }),
      ),
      linesRead: data.lines.length,
      partsRead: parts.length,
    };
  }

  /*
   * The call's cause: none when no part pointed at one, the one part's when
   * one did, and the model's weighing of them when several did - or, when
   * that answer cannot be read, the latest part's: later in a call is where
   * responders settle what earlier parts guessed.
   */
  private static async weighCauses(data: {
    answers: Array<CallSummaryPartAnswer>;
    lines: Array<TranscriptLine>;
    incident: CallSummaryIncident;
    callLabel: string;
    complete: CallSummaryCompletion;
  }): Promise<CallSummaryRootCause> {
    const suggested: Array<{
      partIndex: number;
      rootCause: CallSummaryRootCause;
    }> = [];

    data.answers.forEach(
      (answer: CallSummaryPartAnswer, partIndex: number): void => {
        if (
          answer.rootCause.outcome === CallSummaryRootCauseOutcome.Suggested
        ) {
          suggested.push({ partIndex, rootCause: answer.rootCause });
        }
      },
    );

    if (suggested.length === 0) {
      return {
        outcome: CallSummaryRootCauseOutcome.NotEnoughDiscussion,
        citations: [],
      };
    }

    if (suggested.length === 1) {
      return suggested[0]!.rootCause;
    }

    const candidates: Array<CallSummaryCauseCandidate> = suggested.map(
      (entry: {
        partIndex: number;
        rootCause: CallSummaryRootCause;
      }): CallSummaryCauseCandidate => {
        return {
          partIndex: entry.partIndex,
          summary: entry.rootCause.summary || "",
          basis:
            entry.rootCause.basis === CallSummaryBasis.StatedOnCall
              ? "stated on the call"
              : "inferred",
          lineNumbers: entry.rootCause.citations.map(
            (citation: CallSummaryCitation): number => {
              return citation.line;
            },
          ),
        };
      },
    );

    const allowed: Set<number> = new Set<number>(
      candidates.flatMap((candidate: CallSummaryCauseCandidate) => {
        return candidate.lineNumbers;
      }),
    );

    const latest: CallSummaryRootCause =
      suggested[suggested.length - 1]!.rootCause;

    // A request that fails outright is the reading failing: it throws.
    const content: string = await data.complete({
      messages: CallSummaryPrompt.buildCombineMessages({
        incident: data.incident,
        callLabel: data.callLabel,
        candidates,
        lines: data.lines,
      }),
      purpose: "combine",
    });

    try {
      const combined: CallSummaryRootCause = CallSummaryAnswer.readCombined(
        content,
        { lines: data.lines, allowed },
      );

      /*
       * The parts did point at a cause, so "not enough discussion" from the
       * weighing is the weighing failing to pick one: keep the latest.
       */
      return combined.outcome === CallSummaryRootCauseOutcome.Suggested
        ? combined
        : latest;
    } catch {
      return latest;
    }
  }

  // The parts' points in the call's order, each once, at most MAX_CALL_SUMMARY_POINTS.
  public static joinPoints<T extends CallSummaryPoint>(
    lists: Array<Array<T>>,
  ): Array<T> {
    const joined: Array<T> = [];
    const seen: Set<string> = new Set<string>();

    for (const list of lists) {
      for (const point of list) {
        const key: string = point.text.toLowerCase();

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        joined.push(point);

        if (joined.length >= MAX_CALL_SUMMARY_POINTS) {
          return joined;
        }
      }
    }

    return joined;
  }

  private static lineNumbersOf(part: TranscriptPart): Set<number> {
    const numbers: Set<number> = new Set<number>();

    for (let offset: number = 0; offset < part.lines.length; offset++) {
      numbers.add(part.firstLineNumber + offset);
    }

    return numbers;
  }
}
