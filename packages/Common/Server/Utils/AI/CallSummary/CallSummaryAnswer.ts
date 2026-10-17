import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONArray, JSONObject, JSONValue } from "../../../../Types/JSON";
import {
  CallSummaryAction,
  CallSummaryBasis,
  CallSummaryCitation,
  CallSummaryFinding,
  CallSummaryFindingKind,
  CallSummaryPoint,
  CallSummaryRootCause,
  CallSummaryRootCauseOutcome,
  MAX_CALL_SUMMARY_CITATION_LENGTH,
  MAX_CALL_SUMMARY_CITATIONS,
  MAX_CALL_SUMMARY_OWNER_LENGTH,
  MAX_CALL_SUMMARY_POINT_LENGTH,
  MAX_CALL_SUMMARY_POINTS,
  MAX_CALL_SUMMARY_ROOT_CAUSE_LENGTH,
} from "../../../../Types/VideoCall/CallSummary";
import TranscriptText, {
  TranscriptLine,
} from "../../../../Utils/VideoCall/TranscriptText";

/*
 * ONEUPTIME AI'S ANSWER ABOUT A CALL, READ AND CHECKED.
 *
 * The model answers with a JSON object (CallSummaryPrompt). Nothing it
 * writes is taken on trust:
 *
 *   - It names transcript lines by id ("L12"), and only lines it was given
 *     count; each is copied from the transcript - its time, its speaker,
 *     its words - so a citation shows what was said, never the model's
 *     paraphrase of it.
 *   - A cause with no line that counts is no cause: the call "did not
 *     discuss it enough". A finding called confirmed with no line that
 *     counts is a hypothesis.
 *   - Its words are held to a length and kept as plain text; the dashboard
 *     shows them as text, and the root cause a person accepts quotes them
 *     as text (CallSummaryMarkdown).
 */

export interface CallSummaryPartAnswer {
  rootCause: CallSummaryRootCause;
  findings: Array<CallSummaryFinding>;
  stepsTried: Array<CallSummaryPoint>;
  decisions: Array<CallSummaryPoint>;
  actions: Array<CallSummaryAction>;
  openQuestions: Array<CallSummaryPoint>;
}

// Which lines a citation may name: the part's, numbered in the whole transcript.
export interface CitableLines {
  lines: Array<TranscriptLine>;
  // Allowed line numbers (from 1); all of `lines` when not given.
  allowed?: ReadonlySet<number> | undefined;
}

// "L12", "l12", "12" - the line ids the model may write.
const LINE_ID_PATTERN: RegExp = /^[Ll]?(\d{1,6})$/;

export const UNREADABLE_ANSWER_MESSAGE: string =
  "OneUptime AI's answer about the transcript could not be read. Try again.";

export default class CallSummaryAnswer {
  public static readPart(
    content: string,
    citable: CitableLines,
  ): CallSummaryPartAnswer {
    const json: JSONObject = CallSummaryAnswer.parseObject(content);

    return {
      rootCause: CallSummaryAnswer.readRootCause(json["rootCause"], citable),
      findings: CallSummaryAnswer.readPoints(json["findings"], citable).map(
        (point: ReadPoint): CallSummaryFinding => {
          return {
            text: point.text,
            citations: point.citations,
            kind:
              CallSummaryAnswer.readWord(point.raw["kind"]) === "confirmed" &&
              point.citations.length > 0
                ? CallSummaryFindingKind.Confirmed
                : CallSummaryFindingKind.Hypothesis,
          };
        },
      ),
      stepsTried: CallSummaryAnswer.toPoints(
        CallSummaryAnswer.readPoints(json["stepsTried"], citable),
      ),
      decisions: CallSummaryAnswer.toPoints(
        CallSummaryAnswer.readPoints(json["decisions"], citable),
      ),
      actions: CallSummaryAnswer.readPoints(json["actions"], citable).map(
        (point: ReadPoint): CallSummaryAction => {
          const action: CallSummaryAction = {
            text: point.text,
            citations: point.citations,
          };
          const owner: string = CallSummaryAnswer.readText(
            point.raw["owner"],
            MAX_CALL_SUMMARY_OWNER_LENGTH,
          );

          if (owner) {
            action.owner = owner;
          }

          return action;
        },
      ),
      openQuestions: CallSummaryAnswer.toPoints(
        CallSummaryAnswer.readPoints(json["openQuestions"], citable),
      ),
    };
  }

  // The answer to the parts being weighed together: a cause alone.
  public static readCombined(
    content: string,
    citable: CitableLines,
  ): CallSummaryRootCause {
    const json: JSONObject = CallSummaryAnswer.parseObject(content);

    return CallSummaryAnswer.readRootCause(json["rootCause"] ?? json, citable);
  }

  /*
   * The JSON object in the model's answer: the whole answer, or what sits
   * between its first "{" and last "}" (a model may wrap it in a code fence
   * or a sentence). Anything else is an answer that cannot be read.
   */
  public static parseObject(content: string): JSONObject {
    const text: string = typeof content === "string" ? content : "";
    const start: number = text.indexOf("{");
    const end: number = text.lastIndexOf("}");

    if (start === -1 || end <= start) {
      throw new BadDataException(UNREADABLE_ANSWER_MESSAGE);
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      throw new BadDataException(UNREADABLE_ANSWER_MESSAGE);
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new BadDataException(UNREADABLE_ANSWER_MESSAGE);
    }

    return parsed as JSONObject;
  }

  public static readRootCause(
    value: JSONValue | undefined,
    citable: CitableLines,
  ): CallSummaryRootCause {
    const json: JSONObject =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as JSONObject)
        : {};
    const summary: string = CallSummaryAnswer.readText(
      json["summary"],
      MAX_CALL_SUMMARY_ROOT_CAUSE_LENGTH,
    );
    const citations: Array<CallSummaryCitation> =
      CallSummaryAnswer.readCitations(json["lines"], citable);

    if (
      CallSummaryAnswer.readWord(json["outcome"]) !== "suggested" ||
      !summary ||
      citations.length === 0
    ) {
      return {
        outcome: CallSummaryRootCauseOutcome.NotEnoughDiscussion,
        citations: [],
      };
    }

    return {
      outcome: CallSummaryRootCauseOutcome.Suggested,
      summary,
      basis:
        CallSummaryAnswer.readWord(json["basis"]) === "stated_on_call"
          ? CallSummaryBasis.StatedOnCall
          : CallSummaryBasis.Inferred,
      citations,
    };
  }

  /*
   * The lines a point names, as the transcript has them: each line once,
   * in the order named, at most MAX_CALL_SUMMARY_CITATIONS. A line it was
   * not given is left out.
   */
  public static readCitations(
    value: JSONValue | undefined,
    citable: CitableLines,
  ): Array<CallSummaryCitation> {
    const names: Array<JSONValue> = Array.isArray(value)
      ? (value as JSONArray)
      : typeof value === "string" || typeof value === "number"
        ? [value]
        : [];
    const seen: Set<number> = new Set<number>();
    const citations: Array<CallSummaryCitation> = [];

    for (const name of names) {
      const lineNumber: number | null = CallSummaryAnswer.readLineNumber(name);

      if (
        lineNumber === null ||
        seen.has(lineNumber) ||
        lineNumber > citable.lines.length ||
        (citable.allowed && !citable.allowed.has(lineNumber))
      ) {
        continue;
      }

      seen.add(lineNumber);
      citations.push(
        CallSummaryAnswer.toCitation(
          lineNumber,
          citable.lines[lineNumber - 1]!,
        ),
      );

      if (citations.length >= MAX_CALL_SUMMARY_CITATIONS) {
        break;
      }
    }

    return citations;
  }

  public static toCitation(
    lineNumber: number,
    line: TranscriptLine,
  ): CallSummaryCitation {
    const citation: CallSummaryCitation = {
      line: lineNumber,
      text:
        line.text.length > MAX_CALL_SUMMARY_CITATION_LENGTH
          ? `${line.text.slice(0, MAX_CALL_SUMMARY_CITATION_LENGTH - 1).trimEnd()}…`
          : line.text,
    };

    if (line.offsetInSeconds !== undefined) {
      citation.time = TranscriptText.formatOffset(line.offsetInSeconds);
    }

    if (line.speaker) {
      citation.speaker = line.speaker;
    }

    return citation;
  }

  private static readLineNumber(value: JSONValue): number | null {
    if (typeof value === "number") {
      return Number.isInteger(value) && value >= 1 ? value : null;
    }

    if (typeof value !== "string") {
      return null;
    }

    const match: RegExpExecArray | null = LINE_ID_PATTERN.exec(value.trim());

    if (!match) {
      return null;
    }

    const lineNumber: number = Number(match[1]);

    return lineNumber >= 1 ? lineNumber : null;
  }

  private static readPoints(
    value: JSONValue | undefined,
    citable: CitableLines,
  ): Array<ReadPoint> {
    if (!Array.isArray(value)) {
      return [];
    }

    const points: Array<ReadPoint> = [];
    const seen: Set<string> = new Set<string>();

    for (const item of value as JSONArray) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }

      const raw: JSONObject = item as JSONObject;
      const text: string = CallSummaryAnswer.readText(
        raw["text"],
        MAX_CALL_SUMMARY_POINT_LENGTH,
      );
      const key: string = text.toLowerCase();

      if (!text || seen.has(key)) {
        continue;
      }

      seen.add(key);
      points.push({
        text,
        citations: CallSummaryAnswer.readCitations(raw["lines"], citable),
        raw,
      });

      if (points.length >= MAX_CALL_SUMMARY_POINTS) {
        break;
      }
    }

    return points;
  }

  private static toPoints(points: Array<ReadPoint>): Array<CallSummaryPoint> {
    return points.map((point: ReadPoint): CallSummaryPoint => {
      return { text: point.text, citations: point.citations };
    });
  }

  /*
   * A sentence the model wrote, as plain text on one line: line breaks
   * become spaces, and it is held to `maxLength`.
   */
  public static readText(
    value: JSONValue | undefined,
    maxLength: number,
  ): string {
    if (typeof value !== "string") {
      return "";
    }

    const text: string = value
      .split("\n")
      .map((piece: string): string => {
        return piece.trim();
      })
      .filter((piece: string): boolean => {
        return piece.length > 0;
      })
      .join(" ");

    return text.length > maxLength
      ? `${text.slice(0, maxLength - 1).trimEnd()}…`
      : text;
  }

  // An enum word as the model may write it: "Suggested", "stated on call".
  private static readWord(value: JSONValue | undefined): string {
    return typeof value === "string"
      ? value.trim().toLowerCase().split(" ").join("_").split("-").join("_")
      : "";
  }
}

interface ReadPoint extends CallSummaryPoint {
  raw: JSONObject;
}
