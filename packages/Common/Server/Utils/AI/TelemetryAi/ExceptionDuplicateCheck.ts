import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import {
  DuplicateVerdict,
  SimilarException,
} from "../../../../Types/Telemetry/SimilarExceptions";
import AIService, {
  AILogRequest,
  AILogResponse,
  INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
} from "../../../Services/AIService";
import SimilarExceptionsReader, {
  SimilarExceptionsWithEvidence,
} from "../../Telemetry/SimilarExceptionsReader";
import AiContextReader from "../AiContext/AiContextReader";
import { withAiContext } from "../AiContext/AiContextPrompt";
import {
  buildExceptionDuplicateCheckPrompt,
  DuplicateCheckException,
  EXCEPTION_DUPLICATE_CHECK_SYSTEM_PROMPT,
  parseExceptionDuplicateCheckResponse,
} from "./ExceptionDuplicateCheckPrompt";

/*
 * ARE THESE THE SAME BUG? ONEUPTIME AI DECIDES FOR AN EXCEPTION'S SIMILAR
 * EXCEPTIONS.
 *
 * The similar exceptions are found as the person asking
 * (SimilarExceptionsReader), and OneUptime AI reads their types, messages
 * and top frames next to the exception's and says, for each, whether it is
 * a duplicate, related or different, and why (ExceptionDuplicateCheckPrompt).
 * With none similar, no model is asked. The project's AI switch is asked
 * after the person's own reads, and the call goes through
 * AIService.executeWithLogging: Enable AI, credits, daily limits, billing
 * and the AI log apply. The verdicts are not kept.
 */

export const EXCEPTION_DUPLICATE_CHECK_FEATURE: string =
  "ExceptionDuplicateCheck";

export interface ExceptionDuplicateCheckResult {
  similar: Array<SimilarException>;
  verdicts: Array<DuplicateVerdict>;
  generatedAt: Date;
}

function toCheckException(
  exception: TelemetryException,
): DuplicateCheckException {
  return {
    telemetryExceptionId: exception.id?.toString() || "",
    exceptionType: exception.exceptionType || "",
    message: exception.message || "",
    stackTrace: exception.stackTrace || "",
    occurrenceCount: exception.occuranceCount || 0,
    isResolved: Boolean(exception.isResolved),
    isArchived: Boolean(exception.isArchived),
  };
}

export default class ExceptionDuplicateChecker {
  public static async check(data: {
    telemetryExceptionId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<ExceptionDuplicateCheckResult> {
    const found: SimilarExceptionsWithEvidence =
      await SimilarExceptionsReader.findWithEvidence(data);

    const similar: Array<SimilarException> = found.similar.map(
      (entry: { similar: SimilarException }): SimilarException => {
        return entry.similar;
      },
    );

    if (similar.length === 0) {
      return {
        similar,
        verdicts: [],
        generatedAt: OneUptimeDate.getCurrentDate(),
      };
    }

    const projectId: ObjectID = found.target.projectId!;

    // After the person's own reads: see ExceptionDigester.
    await AIService.assertProjectAIEnabled(projectId);

    const candidates: Array<DuplicateCheckException> = found.similar.map(
      (entry: { exception: TelemetryException }): DuplicateCheckException => {
        return toCheckException(entry.exception);
      },
    );

    const request: AILogRequest = {
      projectId,
      feature: EXCEPTION_DUPLICATE_CHECK_FEATURE,
      messages: [
        {
          role: "system",
          content: withAiContext(
            EXCEPTION_DUPLICATE_CHECK_SYSTEM_PROMPT,
            await AiContextReader.read({ projectId }),
          ),
        },
        {
          role: "user",
          content: buildExceptionDuplicateCheckPrompt({
            target: toCheckException(found.target),
            candidates,
          }),
        },
      ],
      maxTokens: 1000,
      temperature: 0.1,
      requestTimeoutInMs: INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
      requestRetries: 0,
      storeContentPreviews: false,
    };

    if (data.props.userId) {
      request.userId = data.props.userId;
    }

    const response: AILogResponse = await AIService.executeWithLogging(request);

    const verdicts: Array<DuplicateVerdict> | null =
      parseExceptionDuplicateCheckResponse(response.content, candidates);

    if (!verdicts) {
      throw new BadDataException(
        "OneUptime AI did not return an answer. Please try again.",
      );
    }

    return {
      similar,
      verdicts,
      generatedAt: OneUptimeDate.getCurrentDate(),
    };
  }
}
