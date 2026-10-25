import ObjectID from "../../../../../../Types/ObjectID";
import { ExceptionInsightFrameEvidence } from "../../../../../../Types/AI/AIInsightEvidence";
import TelemetryException from "../../../../../../Models/DatabaseModels/TelemetryException";
import {
  ExceptionStackFrameReading,
  getOwnCodeFrames,
} from "../../../../../../Utils/Exceptions/ExceptionInsight";
import TelemetryExceptionService from "../../../../../Services/TelemetryExceptionService";
import QueryHelper from "../../../../../Types/Database/QueryHelper";
import logger from "../../../../Logger";
import { sanitizeStackTrace } from "../../../../Telemetry/ExceptionSanitizer";
import StackTraceParser, {
  ParsedStackTrace,
  StackFrame,
} from "../../../../Telemetry/StackTraceParser";

/*
 * WHERE AN EXCEPTION WAS RAISED IN THE APPLICATION'S OWN CODE - what the
 * exception detectors (NewException, ExceptionSpike) keep on a finding for
 * the Exceptions product's AI section (Utils/Exceptions/ExceptionInsight):
 * how many frames the exception's stack trace has, and the innermost few of
 * the application's own code - not a library's, a framework's or the
 * runtime's (StackTraceParser's inApp). OneUptime AI opens a pull request
 * on its own only for an exception raised in your own code, and the fix
 * that does reads its exception again (ExceptionInsightFix).
 *
 * The stack trace is sanitized before it is read: what is kept is shown on
 * the finding and handed to the investigation.
 */

export interface ExceptionOwnCodeReading {
  // 0 when the exception was recorded without a stack trace.
  stackFrameCount: number;
  ownCodeFrames: Array<ExceptionInsightFrameEvidence>;
}

export default class ExceptionOwnCode {
  // What one stack trace says about the application's own code.
  public static read(
    stackTrace: string | null | undefined,
  ): ExceptionOwnCodeReading {
    const sanitized: string = sanitizeStackTrace(stackTrace || "");

    if (!sanitized.trim()) {
      return { stackFrameCount: 0, ownCodeFrames: [] };
    }

    const parsed: ParsedStackTrace = StackTraceParser.parse(sanitized);

    return {
      stackFrameCount: parsed.frames.length,
      ownCodeFrames: getOwnCodeFrames({
        frames: parsed.frames.map(
          (frame: StackFrame): ExceptionStackFrameReading => {
            return {
              functionName: frame.functionName || "",
              fileName: frame.fileName || "",
              lineNumber: frame.lineNumber || 0,
              inApp: frame.inApp === true,
            };
          },
        ),
        stackTrace: sanitized,
      }),
    };
  }

  /*
   * The same for a few exceptions at once, by their ids: one read of their
   * stack traces. Best-effort - a finding without it is still filed, and
   * says nothing about the code - so it never throws: an exception it could
   * not read is left out of the map.
   */
  public static async readMany(data: {
    projectId: ObjectID;
    telemetryExceptionIds: Array<ObjectID>;
  }): Promise<Map<string, ExceptionOwnCodeReading>> {
    const readings: Map<string, ExceptionOwnCodeReading> = new Map<
      string,
      ExceptionOwnCodeReading
    >();
    const ids: Array<string> = Array.from(
      new Set(
        data.telemetryExceptionIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      ),
    );

    if (ids.length === 0) {
      return readings;
    }

    try {
      const exceptions: Array<TelemetryException> =
        await TelemetryExceptionService.findBy({
          query: {
            projectId: data.projectId,
            _id: QueryHelper.any(ids),
          },
          select: {
            _id: true,
            stackTrace: true,
          },
          limit: ids.length,
          skip: 0,
          props: { isRoot: true },
        });

      for (const exception of exceptions) {
        const id: string | undefined = exception.id?.toString();

        if (id && ids.includes(id)) {
          readings.set(id, ExceptionOwnCode.read(exception.stackTrace));
        }
      }
    } catch (error) {
      logger.debug(
        `AI Insights: could not read the stack traces of project ${data.projectId.toString()}'s exception findings; filing them without where their code is: ${error}`,
      );
    }

    return readings;
  }
}
