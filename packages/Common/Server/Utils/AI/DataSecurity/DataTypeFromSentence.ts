import {
  DATA_TYPE_CATALOG,
  DataTypeInfo,
} from "../../../../Types/DataSecurity/DataTypeCatalog";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import {
  checkDataTypeDraft,
  DataTypeDraft,
  DataTypeDraftProblem,
} from "../../../../Utils/DataSecurity/DataTypeProposal";
import { isValueShape } from "../../../../Utils/DataSecurity/UnplacedFields";
import AIService, {
  AILogResponse,
  INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
} from "../../../Services/AIService";
import DataSecurityRunner from "../../DataSecurity/DataSecurityRunner";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  AiDataTypeDraftRetry,
  buildDescribeDataTypePrompt,
  MAX_DATA_TYPE_EXAMPLE_SHAPES,
  MAX_DATA_TYPE_SENTENCE_LENGTH,
} from "./DataSecurityAiInput";
import DataSecurityAiCall from "./DataSecurityAiCall";
import {
  DataTypeDraftAnswer,
  DESCRIBE_DATA_TYPE_SYSTEM_PROMPT,
  DRAFT_PROBLEM_WORDS,
  readDataTypeDraftAnswer,
} from "./DataTypeDraftPrompt";

/*
 * DESCRIBE IT: A DATA TYPE FROM A SENTENCE (#10371).
 *
 * On the data type form, a person writes what their data looks like - "our
 * employee IDs look like EMP-123456, sometimes without the dash" - and,
 * if they like, a few examples. The examples stay in their browser: Test It
 * runs them there, and only their shapes (EMP-123456 is AAA-999999) come
 * here with the sentence. OneUptime AI drafts the data type from them
 * (buildDescribeDataTypePrompt), and the draft fills the form. Nothing is
 * saved here: the form saves, through the same checks as a type written
 * by hand.
 *
 * The draft is held to what a saved type is held to (checkDataTypeDraft) -
 * a pattern that compiles, runs in linear time, matches no empty text and
 * finds no plain word - and asked for once more, told why, when it is not.
 * A request that sends anything but shapes as its examples is refused: a
 * value never reaches the model.
 *
 * One request (two at most), started by a person and answered while they
 * wait, so it is held to the interactive limits: one attempt per call,
 * within the proxy's budget, metered and billed like any other request,
 * inside the project's daily AI limits and not the autonomous budget.
 */

// How much the answer may be.
export const DESCRIBE_DATA_TYPE_MAX_COMPLETION_TOKENS: number = 1_500;

// How many times the model may write the draft: once, and once more to fix it.
export const DESCRIBE_DATA_TYPE_ATTEMPTS: number = 2;

// The shortest sentence that can describe anything.
export const MIN_DESCRIBE_SENTENCE_LENGTH: number = 3;

export const DESCRIBE_SENTENCE_MISSING_MESSAGE: string =
  "Describe the data type in a sentence, such as: our employee IDs look like EMP-123456, sometimes without the dash.";

export const DESCRIBE_SENTENCE_TOO_LONG_MESSAGE: string = `Describe the data type in at most ${MAX_DATA_TYPE_SENTENCE_LENGTH.toLocaleString("en-US")} characters.`;

export const DESCRIBE_EXAMPLES_NOT_SHAPES_MESSAGE: string =
  "Only the shapes of your examples are sent, such as AAA-999999 for EMP-123456. Reload the page and try again.";

export const DESCRIBE_NO_ANSWER_MESSAGE: string =
  "OneUptime AI did not answer with a data type. Try again, or describe it differently.";

export const DESCRIBE_UNUSABLE_MESSAGE: string =
  "OneUptime AI could not write a pattern OneUptime can run for that description. Describe it differently, or write the pattern yourself.";

// Why the first draft could not be used, when its name or category could not.
const UNUSABLE_DRAFT_WORDS: string =
  "its category, sensitivity or checksum is not one of those listed, or it has no name or pattern";

export interface DescribedDataType {
  draft: DataTypeDraft;
  // Why OneUptime AI drafted it so, in a sentence.
  reason: string;
}

/*
 * The examples' shapes the browser sent, each read again as a shape, at
 * most MAX_DATA_TYPE_EXAMPLE_SHAPES: a value that is not a shape - an
 * example sent as itself - refuses the request.
 */
export function readExampleShapes(value: unknown): Array<string> {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new BadDataException(DESCRIBE_EXAMPLES_NOT_SHAPES_MESSAGE);
  }

  const shapes: Array<string> = [];

  for (const item of value.slice(0, MAX_DATA_TYPE_EXAMPLE_SHAPES * 5)) {
    if (typeof item !== "string" || !isValueShape(item)) {
      throw new BadDataException(DESCRIBE_EXAMPLES_NOT_SHAPES_MESSAGE);
    }

    if (
      !shapes.includes(item) &&
      shapes.length < MAX_DATA_TYPE_EXAMPLE_SHAPES
    ) {
      shapes.push(item);
    }
  }

  return shapes;
}

export function readDescribeSentence(value: unknown): string {
  const sentence: string = typeof value === "string" ? value.trim() : "";

  if (sentence.length < MIN_DESCRIBE_SENTENCE_LENGTH) {
    throw new BadDataException(DESCRIBE_SENTENCE_MISSING_MESSAGE);
  }

  if (sentence.length > MAX_DATA_TYPE_SENTENCE_LENGTH) {
    throw new BadDataException(DESCRIBE_SENTENCE_TOO_LONG_MESSAGE);
  }

  return sentence;
}

export default class DataTypeFromSentence {
  @CaptureSpan()
  public static async draft(data: {
    projectId: ObjectID;
    userId?: ObjectID | undefined;
    sentence: unknown;
    exampleShapes: unknown;
  }): Promise<DescribedDataType> {
    const sentence: string = readDescribeSentence(data.sentence);
    const exampleShapes: Array<string> = readExampleShapes(data.exampleShapes);

    // The project's AI switch first: the form says where to turn it on.
    await AIService.assertProjectAIEnabled(data.projectId);

    const knownDataTypes: Array<string> = await this.readKnownDataTypes(
      data.projectId,
    );
    let retry: AiDataTypeDraftRetry | undefined = undefined;

    for (
      let attempt: number = 1;
      attempt <= DESCRIBE_DATA_TYPE_ATTEMPTS;
      attempt++
    ) {
      /*
       * Through the one Data Security call: the sentence and the shapes,
       * never an example, and nothing of either in the AI Logs.
       */
      const response: AILogResponse = await DataSecurityAiCall.ask({
        projectId: data.projectId,
        userId: data.userId,
        prompt: buildDescribeDataTypePrompt({
          instructions: DESCRIBE_DATA_TYPE_SYSTEM_PROMPT,
          sentence,
          exampleShapes,
          knownDataTypes,
          retry,
        }),
        temperature: 0,
        maxTokens: DESCRIBE_DATA_TYPE_MAX_COMPLETION_TOKENS,
        // The person waits on the form: one attempt, within the proxy's budget.
        requestTimeoutInMs: INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
        requestRetries: 0,
      });
      const answer: DataTypeDraftAnswer | null = readDataTypeDraftAnswer(
        response.content,
      );

      if (!answer) {
        throw new BadDataException(DESCRIBE_NO_ANSWER_MESSAGE);
      }

      if (answer.kind === "none") {
        throw new BadDataException(
          answer.reason
            ? `OneUptime AI found no data type to draft in that description: ${answer.reason.replace(/[.\s]+$/, "")}. Describe it differently, or write the pattern yourself.`
            : "OneUptime AI found no data type to draft in that description. Describe it differently, or write the pattern yourself.",
        );
      }

      if (answer.kind === "unusable") {
        retry = { pattern: "", problem: UNUSABLE_DRAFT_WORDS };
        continue;
      }

      const problem: DataTypeDraftProblem | null = checkDataTypeDraft(
        answer.draft,
      );

      if (!problem) {
        return { draft: answer.draft, reason: answer.reason };
      }

      retry = {
        pattern: answer.draft.pattern,
        problem: DRAFT_PROBLEM_WORDS[problem],
      };
    }

    throw new BadDataException(DESCRIBE_UNUSABLE_MESSAGE);
  }

  // The data types the project scans for, by name: built-in and its own.
  private static async readKnownDataTypes(
    projectId: ObjectID,
  ): Promise<Array<string>> {
    const names: Array<string> = DATA_TYPE_CATALOG.map(
      (info: DataTypeInfo): string => {
        return info.name;
      },
    );

    try {
      const setup: Awaited<ReturnType<typeof DataSecurityRunner.getScanSetup>> =
        await DataSecurityRunner.getScanSetup(projectId);

      for (const summary of setup.customTypes.values()) {
        names.push(summary.name);
      }
    } catch (error) {
      logger.warn(
        `DataSecurity: could not read project ${projectId.toString()}'s own data types; drafting without them:`,
      );
      logger.warn(error);
    }

    return names;
  }
}
