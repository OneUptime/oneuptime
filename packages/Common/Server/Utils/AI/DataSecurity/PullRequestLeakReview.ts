import crypto from "crypto";
import { AILogResponse } from "../../../Services/AIService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  PatchLine,
  PatchLineKind,
  readPatchLines,
} from "../../CodeRepository/ProductionReview/SensitiveData/SensitiveDataPatch";
import {
  ProductionReviewLeakJSON,
  ProductionReviewSensitiveDataJSON,
  PUBLIC_STORE_CHECK_IDS,
  SENSITIVE_DATA_LIMITS,
  SensitiveDataAiNoteCode,
  SensitiveDataLeakKind,
} from "../../../../Types/CodeRepository/ProductionReviewSensitiveData";
import ObjectID from "../../../../Types/ObjectID";
import DataSecurityAiCall from "./DataSecurityAiCall";
import {
  AiPullRequestCandidate,
  AiPullRequestFileDiff,
  buildPullRequestReviewPrompt,
  DataSecurityAiPrompt,
  MAX_CANDIDATE_LINES,
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
 * ONEUPTIME AI'S READ OF A PULL REQUEST'S SENSITIVE DATA (#10376).
 *
 * The rules of a production review's Sensitive data section find their
 * points alone (ProductionReviewSensitiveData); they cannot tell a value
 * hashed three lines up from one that is not, or a test helper from a
 * service's code. So OneUptime AI reads the points beside the diff, in one
 * constrained call, and for each says whether it is a leak, in words the
 * author can act on, with the change that fixes it - and the order to show
 * them in. What it may not do:
 *
 *   - add a point: an answer about a point it was not given is dropped,
 *     as ProductionReviewAI drops a point with no fact under it;
 *   - drop a point the repository's check fails on: the diff is written
 *     by the pull request's author, and nothing written in it may talk a
 *     failing check into passing. Such a point is worded, never left out;
 *   - see what production holds: its prompt is built by
 *     DataSecurityAiInput from what the diff shows, and asked through
 *     DataSecurityAiCall, which keeps nothing of it in the AI Logs.
 *
 * Bounded as every production review read is: one call, no retries, a
 * deadline, and the read only when the points or the diff changed since
 * the last one (getInputHash). It never throws: the section stands on its
 * rules without it.
 */

export const PULL_REQUEST_LEAK_REVIEW_TIMEOUT_MS: number = 90 * 1000;
export const PULL_REQUEST_LEAK_REVIEW_DEADLINE_MS: number = 2 * 60 * 1000;
export const PULL_REQUEST_LEAK_REVIEW_MAX_TOKENS: number = 1500;

// The id each candidate is told by: L1, L2...
const CANDIDATE_ID_PREFIX: string = "L";

export const PULL_REQUEST_LEAK_REVIEW_INSTRUCTIONS: string = [
  "You are OneUptime's data security reviewer of a pull request. OneUptime's rules read its diff and found the candidates in the data: places where the change may write sensitive data to telemetry (a log, a span, a metric's label, a prompt sent to an AI provider), leave a data store open (public, unencrypted, without backups), or add a column that holds sensitive data. Read each candidate beside the diff and say which are real leaks, in words the pull request's author can act on.",
  "For each candidate answer keep: true when it is a leak, false when it is not. It is not a leak when the diff shows the value is hashed, masked or redacted before it is written, when the name only names a field and the value written is something else, when the code is only an example or a test, or when the store is plainly meant to be public and holds nothing sensitive. When in doubt, keep it.",
  "A candidate with mayDrop false must be kept: the repository's check fails on it, and only OneUptime's rules decide that.",
  `text: one or two plain sentences, at most ${SENSITIVE_DATA_LIMITS.maxTextLength - 100} characters, saying what the change does and why it matters. Put names of code (functions, variables, keys, columns, settings) in backticks. No other Markdown, no links, no headings, no @-mentions, no ids such as L1.`,
  `fix: one sentence, at most ${SENSITIVE_DATA_LIMITS.maxFixLength - 50} characters: the change that fixes it - leave the value out, write a hash of it, pass it through a redaction helper the diff already uses, or the safe value of the setting.`,
  `replacement, when the fix is a change to the candidate's own line: that line as it would read fixed, keeping its indentation, as a list of at most ${SENSITIVE_DATA_LIMITS.maxSuggestionLines} lines - an empty list removes the line. Leave replacement out when the fix is not a change to that line.`,
  "List the candidates you keep first, the most harmful first, then the ones you do not keep.",
  "Never answer about a candidate that is not listed, never invent one, and never copy into your answer text from the diff that looks like a secret.",
  'Answer with JSON only, exactly: {"candidates": [{"id": "L1", "keep": true, "text": "...", "fix": "...", "replacement": ["..."]}]}',
].join("\n");

// The answer, read strictly (StrictAnswer).
const ANSWER_SHAPE: StrictObject<{
  candidates: StrictList<
    StrictObject<{
      id: StrictText;
      keep: ReturnType<typeof StrictAnswer.flag>;
      text: StrictOptional<StrictText>;
      fix: StrictOptional<StrictText>;
      replacement: StrictOptional<StrictList<StrictText>>;
    }>
  >;
}> = StrictAnswer.object({
  candidates: StrictAnswer.list(
    StrictAnswer.object({
      id: StrictAnswer.text({
        maxLength: 10,
        whenTooLong: "refuse",
        isOneLine: true,
      }),
      keep: StrictAnswer.flag(),
      text: StrictAnswer.optional(
        StrictAnswer.text({
          maxLength: SENSITIVE_DATA_LIMITS.maxTextLength,
          isOneLine: true,
        }),
      ),
      fix: StrictAnswer.optional(
        StrictAnswer.text({
          maxLength: SENSITIVE_DATA_LIMITS.maxFixLength,
          isOneLine: true,
        }),
      ),
      replacement: StrictAnswer.optional(
        StrictAnswer.list(
          StrictAnswer.text({
            maxLength: SENSITIVE_DATA_LIMITS.maxSuggestionLineLength,
            whenTooLong: "refuse",
          }),
          {
            maxItems: SENSITIVE_DATA_LIMITS.maxSuggestionLines,
            whenItemIsWrong: "refuse",
          },
        ),
      ),
    }),
    {
      maxItems: SENSITIVE_DATA_LIMITS.maxCandidatesForAi * 2,
      whenItemIsWrong: "skip",
    },
  ),
});

type Answer = StrictValue<typeof ANSWER_SHAPE>;

// OneUptime AI's word on one candidate, held to what it was given.
export interface PullRequestLeakReading {
  key: string;
  keep: boolean;
  text: string | null;
  fix: string | null;
  replacement: Array<string> | null;
}

// A file's diff, as the review read it from its host.
export interface PullRequestLeakFile {
  path: string;
  patch: string | null;
}

export interface PullRequestLeakReviewResult {
  section: ProductionReviewSensitiveDataJSON;
  note?: SensitiveDataAiNoteCode | undefined;
}

// A text with no line break and nothing a fence could close on.
function isSafeSuggestionLine(line: string): boolean {
  return !line.includes("```") && !line.includes("\n") && !line.includes("\r");
}

export default class PullRequestLeakReview {
  // The points OneUptime AI reads: the first maxCandidatesForAi of them.
  public static getReadPoints(
    section: ProductionReviewSensitiveDataJSON,
  ): Array<ProductionReviewLeakJSON> {
    return section.points.slice(0, SENSITIVE_DATA_LIMITS.maxCandidatesForAi);
  }

  /*
   * The lines around a point's own, as its file's patch has them after the
   * change: two before, the line, two after.
   */
  public static linesAround(
    patch: string | null,
    line: number,
  ): Array<string> {
    const lines: Array<PatchLine> = readPatchLines(patch).filter(
      (each: PatchLine): boolean => {
        return each.kind !== PatchLineKind.Removed;
      },
    );
    const at: number = lines.findIndex((each: PatchLine): boolean => {
      return each.newLine === line;
    });

    if (at < 0) {
      return [];
    }

    const half: number = Math.floor(MAX_CANDIDATE_LINES / 2);

    return lines
      .slice(Math.max(0, at - half), at + half + 1)
      .filter((each: PatchLine): boolean => {
        return each.hunk === lines[at]!.hunk;
      })
      .map((each: PatchLine): string => {
        return each.text;
      });
  }

  /*
   * Whether a point fails the check as the diff alone says: a known store's
   * sensitivity decides it for the review, never for what OneUptime AI is
   * told - a point on a public resource fails the check, as the rule says,
   * whatever store it is.
   */
  public static failsCheckByTheDiff(
    point: ProductionReviewLeakJSON,
    isFailOn: boolean,
  ): boolean {
    if (point.kind === SensitiveDataLeakKind.Infrastructure && point.production?.store) {
      return isFailOn && PUBLIC_STORE_CHECK_IDS.includes(point.checkId);
    }

    return point.failsCheck;
  }

  /*
   * The points as OneUptime AI is told them, each by its id: what the diff
   * shows of each, never what production knows - its sensitivity is the
   * diff's own (toLeakPoint), and whether it may be left out is the diff's
   * too.
   */
  public static toCandidates(data: {
    points: Array<ProductionReviewLeakJSON>;
    files: Array<PullRequestLeakFile>;
    isFailOn: boolean;
  }): Array<AiPullRequestCandidate> {
    return data.points.map(
      (point: ProductionReviewLeakJSON, index: number): AiPullRequestCandidate => {
        const file: PullRequestLeakFile | undefined = data.files.find(
          (each: PullRequestLeakFile): boolean => {
            return each.path === point.path;
          },
        );

        return {
          id: `${CANDIDATE_ID_PREFIX}${index + 1}`,
          kind: point.kind,
          checkId: point.checkId,
          file: point.path,
          line: point.line,
          subject: point.subject,
          where: point.where,
          value: point.value,
          dataTypes: point.dataTypeNames,
          sensitivity: point.sensitivity,
          sentence: point.text,
          fix: point.fix,
          mayDrop: !PullRequestLeakReview.failsCheckByTheDiff(
            point,
            data.isFailOn,
          ),
          lines: PullRequestLeakReview.linesAround(
            file?.patch || null,
            point.line,
          ),
        };
      },
    );
  }

  // The diffs of the files the points are in, in the order the points name them.
  public static toFileDiffs(data: {
    points: Array<ProductionReviewLeakJSON>;
    files: Array<PullRequestLeakFile>;
  }): Array<AiPullRequestFileDiff> {
    const diffs: Array<AiPullRequestFileDiff> = [];

    for (const point of data.points) {
      if (
        diffs.some((diff: AiPullRequestFileDiff): boolean => {
          return diff.path === point.path;
        })
      ) {
        continue;
      }

      const file: PullRequestLeakFile | undefined = data.files.find(
        (each: PullRequestLeakFile): boolean => {
          return each.path === point.path;
        },
      );

      if (file?.patch) {
        diffs.push({ path: file.path, patch: file.patch });
      }
    }

    return diffs;
  }

  public static buildPrompt(data: {
    pullRequestTitle: string;
    points: Array<ProductionReviewLeakJSON>;
    files: Array<PullRequestLeakFile>;
    isFailOn: boolean;
  }): DataSecurityAiPrompt {
    return buildPullRequestReviewPrompt({
      instructions: PULL_REQUEST_LEAK_REVIEW_INSTRUCTIONS,
      pullRequestTitle: data.pullRequestTitle,
      candidates: PullRequestLeakReview.toCandidates(data),
      files: PullRequestLeakReview.toFileDiffs(data),
    });
  }

  /*
   * What an answer says of each point it was given, in the answer's order,
   * by the point's key - or null for an answer that cannot be read. An
   * answer about a point it was not given is dropped, and so is one that
   * would drop a point the check fails on: that point is kept.
   */
  public static readAnswer(
    content: string | null | undefined,
    points: Array<ProductionReviewLeakJSON>,
  ): Array<PullRequestLeakReading> | null {
    const answer: Answer | null = readStrictAnswer(content, ANSWER_SHAPE);

    if (!answer) {
      return null;
    }

    const readings: Array<PullRequestLeakReading> = [];
    const seen: Set<string> = new Set<string>();

    for (const item of answer.candidates) {
      const id: string = item.id.trim().toUpperCase();

      if (!id.startsWith(CANDIDATE_ID_PREFIX)) {
        continue;
      }

      const index: number = Number(id.slice(CANDIDATE_ID_PREFIX.length)) - 1;
      const point: ProductionReviewLeakJSON | undefined = Number.isSafeInteger(
        index,
      )
        ? points[index]
        : undefined;

      if (!point || seen.has(point.key)) {
        continue;
      }

      seen.add(point.key);

      const replacement: Array<string> | null =
        item.replacement !== undefined &&
        item.replacement.every(isSafeSuggestionLine)
          ? item.replacement
          : null;

      readings.push({
        key: point.key,
        keep: item.keep || point.failsCheck,
        text: item.text && item.text.length >= 10 ? item.text : null,
        fix: item.fix && item.fix.length >= 10 ? item.fix : null,
        replacement,
      });
    }

    return readings;
  }

  /*
   * The section as OneUptime AI read it: the points it kept, in its order
   * and its words - each one it said nothing of kept, after them, in the
   * rules' words - and how many it left out.
   */
  public static apply(
    section: ProductionReviewSensitiveDataJSON,
    readings: Array<PullRequestLeakReading>,
    files: Array<PullRequestLeakFile> = [],
  ): ProductionReviewSensitiveDataJSON {
    const byKey: Map<string, PullRequestLeakReading> = new Map<
      string,
      PullRequestLeakReading
    >();

    for (const reading of readings) {
      byKey.set(reading.key, reading);
    }

    const read: Array<ProductionReviewLeakJSON> =
      PullRequestLeakReview.getReadPoints(section);
    const kept: Array<ProductionReviewLeakJSON> = [];
    let droppedCount: number = 0;

    // The ones it kept, in its order.
    for (const reading of readings) {
      const point: ProductionReviewLeakJSON | undefined = read.find(
        (each: ProductionReviewLeakJSON): boolean => {
          return each.key === reading.key;
        },
      );

      if (!point) {
        continue;
      }

      if (!reading.keep) {
        droppedCount++;
        continue;
      }

      const file: PullRequestLeakFile | undefined = files.find(
        (each: PullRequestLeakFile): boolean => {
          return each.path === point.path;
        },
      );

      kept.push(
        PullRequestLeakReview.worded(
          point,
          reading,
          PullRequestLeakReview.lineAt(file?.patch || null, point.line),
        ),
      );
    }

    // The ones it said nothing of: the rules' own words.
    for (const point of section.points) {
      if (!byKey.has(point.key)) {
        kept.push(point);
      }
    }

    // What fails the check stays first, whatever order the answer gave.
    const ordered: Array<ProductionReviewLeakJSON> = [
      ...kept.filter((point: ProductionReviewLeakJSON): boolean => {
        return point.failsCheck;
      }),
      ...kept.filter((point: ProductionReviewLeakJSON): boolean => {
        return !point.failsCheck;
      }),
    ];

    return {
      ...section,
      points: ordered,
      droppedCount: section.droppedCount + droppedCount,
      isAiRead: true,
    };
  }

  // A point's own line, as its file's patch has it after the change, or null.
  public static lineAt(patch: string | null, line: number): string | null {
    const found: PatchLine | undefined = readPatchLines(patch).find(
      (each: PatchLine): boolean => {
        return each.kind === PatchLineKind.Added && each.newLine === line;
      },
    );

    return found ? found.text : null;
  }

  /*
   * A point in OneUptime AI's words, with its suggested change: a change
   * to the point's own line, which the patch must show, that is not the
   * line as it is.
   */
  private static worded(
    point: ProductionReviewLeakJSON,
    reading: PullRequestLeakReading,
    lineText: string | null,
  ): ProductionReviewLeakJSON {
    const worded: ProductionReviewLeakJSON = {
      ...point,
      text: reading.text || point.text,
      fix: reading.fix || point.fix,
      isAiWorded: Boolean(reading.text || reading.fix),
    };

    const original: Array<string> =
      point.suggestion?.original || (lineText !== null ? [lineText] : []);

    if (
      reading.replacement !== null &&
      original.length > 0 &&
      reading.replacement.join("\n") !== original.join("\n")
    ) {
      worded.suggestion = {
        startLine: point.line,
        endLine: point.suggestion?.endLine || point.line,
        original,
        replacement: reading.replacement,
        isByAi: true,
      };
    }

    return worded;
  }

  /*
   * What a read answers, as one value: the points it is given - which,
   * not how they are worded - and the diff of their files. A review asked
   * again of the same change keeps the read it had.
   */
  public static getInputHash(data: {
    pullRequestTitle: string;
    points: Array<ProductionReviewLeakJSON>;
    files: Array<PullRequestLeakFile>;
  }): string {
    const points: Array<ProductionReviewLeakJSON> = data.points.slice(
      0,
      SENSITIVE_DATA_LIMITS.maxCandidatesForAi,
    );
    const hash: crypto.Hash = crypto
      .createHash("sha256")
      .update(data.pullRequestTitle)
      .update("\n");

    for (const point of points) {
      hash
        .update(`${point.key}|${point.line}|${point.failsCheck}`)
        .update("\n");
    }

    for (const diff of PullRequestLeakReview.toFileDiffs({
      points,
      files: data.files,
    })) {
      hash.update(diff.path).update("\n").update(diff.patch).update("\n");
    }

    return hash.digest("hex");
  }

  /*
   * One read: the section as OneUptime AI read it, or as the rules left it
   * and why. Never throws.
   */
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
    pullRequestTitle: string;
    section: ProductionReviewSensitiveDataJSON;
    files: Array<PullRequestLeakFile>;
    // The repository's pick for its production reviews, when it has one.
    pickedLlmProviderId?: ObjectID | undefined;
  }): Promise<PullRequestLeakReviewResult> {
    const points: Array<ProductionReviewLeakJSON> =
      PullRequestLeakReview.getReadPoints(data.section);

    if (points.length === 0) {
      return { section: data.section };
    }

    let deadlineTimer: ReturnType<typeof setTimeout> | undefined = undefined;

    try {
      const call: Promise<AILogResponse> = DataSecurityAiCall.ask({
        projectId: data.projectId,
        aiRunId: data.aiRunId,
        // The builder's prompt: the points and their files' diff, never production.
        prompt: buildPullRequestReviewPrompt({
          instructions: PULL_REQUEST_LEAK_REVIEW_INSTRUCTIONS,
          pullRequestTitle: data.pullRequestTitle,
          candidates: PullRequestLeakReview.toCandidates({
            points,
            files: data.files,
            isFailOn: data.section.isFailOn,
          }),
          files: PullRequestLeakReview.toFileDiffs({
            points,
            files: data.files,
          }),
        }),
        maxTokens: PULL_REQUEST_LEAK_REVIEW_MAX_TOKENS,
        temperature: 0,
        requestTimeoutInMs: PULL_REQUEST_LEAK_REVIEW_TIMEOUT_MS,
        requestRetries: 0,
        protectRequestParameters: true,
        rulePickedProviderId: data.pickedLlmProviderId,
      });

      const deadline: Promise<never> = new Promise<never>(
        (_resolve: (value: never) => void, reject: (error: Error) => void) => {
          deadlineTimer = setTimeout(() => {
            reject(
              new Error(
                `The answer took longer than ${PULL_REQUEST_LEAK_REVIEW_DEADLINE_MS / 1000} seconds.`,
              ),
            );
          }, PULL_REQUEST_LEAK_REVIEW_DEADLINE_MS);
        },
      );

      const response: AILogResponse = await Promise.race([call, deadline]);
      const readings: Array<PullRequestLeakReading> | null =
        PullRequestLeakReview.readAnswer(response.content, points);

      if (readings === null) {
        return {
          section: data.section,
          note: SensitiveDataAiNoteCode.Failed,
        };
      }

      return {
        section: PullRequestLeakReview.apply(
          data.section,
          readings,
          data.files,
        ),
      };
    } catch (error) {
      logger.warn(
        `Production review: OneUptime AI's read of the sensitive data of run ${data.aiRunId.toString()} failed: ${error}`,
      );

      return { section: data.section, note: SensitiveDataAiNoteCode.Failed };
    } finally {
      if (deadlineTimer) {
        clearTimeout(deadlineTimer);
      }
    }
  }
}
