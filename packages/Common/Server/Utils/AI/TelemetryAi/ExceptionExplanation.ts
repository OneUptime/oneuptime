import ChangeEvent from "../../../../Models/AnalyticsModels/ChangeEvent";
import ExceptionInstance from "../../../../Models/AnalyticsModels/ExceptionInstance";
import Log from "../../../../Models/AnalyticsModels/Log";
import Span from "../../../../Models/AnalyticsModels/Span";
import Service from "../../../../Models/DatabaseModels/Service";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { ExceptionAIExplanation } from "../../../../Types/Telemetry/ExceptionAIExplanation";
import { getOccurrenceFingerprintQuery } from "../../../../Types/Telemetry/ExceptionGroupFingerprints";
import {
  ChangeEventFields,
  readChangeEventFields,
} from "../../../../Utils/Telemetry/ChangeEventFields";
import Semaphore, { SemaphoreMutex } from "../../../Infrastructure/Semaphore";
import AIService, {
  AILogRequest,
  AILogResponse,
  INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
} from "../../../Services/AIService";
import ChangeEventService from "../../../Services/ChangeEventService";
import ExceptionInstanceService from "../../../Services/ExceptionInstanceService";
import LogService from "../../../Services/LogService";
import ServiceService from "../../../Services/ServiceService";
import SpanService from "../../../Services/SpanService";
import TelemetryExceptionService from "../../../Services/TelemetryExceptionService";
import logger from "../../Logger";
import AiContextReader from "../AiContext/AiContextReader";
import { withAiContext } from "../AiContext/AiContextPrompt";
import {
  buildExceptionExplanationPrompt,
  EXCEPTION_EXPLANATION_SYSTEM_PROMPT,
  ExceptionExplanationEvidence,
  ExplanationChange,
  ExplanationLog,
  ExplanationSpan,
  MAX_PROMPT_CHANGES,
  MAX_PROMPT_LOG_LENGTH,
  MAX_PROMPT_LOGS,
  MAX_PROMPT_SPANS,
  parseExceptionExplanationResponse,
  pickExplanationSpanAttributes,
} from "./ExceptionExplanationPrompt";

/*
 * EXPLAIN ONE EXCEPTION WITH ONEUPTIME AI.
 *
 * A person opening an exception wants three answers before anything else:
 * what happened, why, and what to change. OneUptime AI writes them from
 * what OneUptime already holds about the exception:
 *
 *   - the exception group: its type, message and stack trace, when it was
 *     first and last seen and in which releases, how often, whether it was
 *     handled, and whether it came back after it was resolved;
 *   - its latest occurrence - its own, or one of an exception merged into
 *     it - and the trace that occurrence happened in: the spans of the
 *     request around it, which failed, and how long they took;
 *   - the logs written in that trace;
 *   - the deploys and changes of its service around the time it started.
 *
 * Everything is read as the person asking: their read scope over each
 * signal applies, and a signal they may not read is simply left out. Every
 * source is best effort, so an explanation is still written from the stack
 * trace alone. What reaches the model is cut and scrubbed, and the answer is
 * checked, by ExceptionExplanationPrompt.
 *
 * The call goes through AIService.executeWithLogging: the project's Enable AI
 * switch, its credits, daily limits, billing and the AI log are the ones every
 * OneUptime AI feature honours. The explanation is kept on the exception, so
 * the next person reads it without paying for it again.
 */

export const EXCEPTION_EXPLANATION_FEATURE: string = "ExceptionExplanation";

// How long before the exception was first seen a deploy may have caused it.
export const CHANGE_LOOKBACK_MS: number = 3 * 24 * 60 * 60 * 1000;

export interface ExceptionExplanationResult {
  explanation: ExceptionAIExplanation;
  generatedAt: Date;
}

export default class ExceptionExplainer {
  /*
   * Write OneUptime AI's explanation of an exception the caller may read,
   * keep it on the exception, and return it.
   */
  public static async explain(data: {
    telemetryExceptionId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<ExceptionExplanationResult> {
    const exception: TelemetryException | null =
      await TelemetryExceptionService.findOneById({
        id: data.telemetryExceptionId,
        select: {
          _id: true,
          projectId: true,
          primaryEntityId: true,
          primaryEntityType: true,
          fingerprint: true,
          exceptionType: true,
          message: true,
          stackTrace: true,
          environment: true,
          occuranceCount: true,
          firstSeenAt: true,
          lastSeenAt: true,
          firstSeenInRelease: true,
          lastSeenInRelease: true,
          unhandled: true,
          errorClass: true,
          isResolved: true,
          regressedAt: true,
        },
        props: data.props,
      });

    if (!exception || !exception.projectId) {
      throw new NotFoundException("Exception not found");
    }

    /*
     * The project's AI switch, before any evidence is read or a token is
     * spent (executeWithLogging refuses too; this refuses before the reads).
     */
    await AIService.assertProjectAIEnabled(exception.projectId);

    // One explanation at a time per exception: a double click writes one.
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: data.telemetryExceptionId.toString(),
        namespace: "ExceptionExplainer.explain",
        lockTimeout: INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
      });
    } catch (err) {
      logger.debug(
        `Could not take the explanation lock for exception ${data.telemetryExceptionId.toString()}; writing it anyway: ${err}`,
      );
    }

    try {
      const evidence: ExceptionExplanationEvidence =
        await ExceptionExplainer.gatherEvidence(exception, data.props);

      const request: AILogRequest = {
        projectId: exception.projectId,
        feature: EXCEPTION_EXPLANATION_FEATURE,
        messages: [
          {
            role: "system",
            content: withAiContext(
              EXCEPTION_EXPLANATION_SYSTEM_PROMPT,
              await AiContextReader.read({ projectId: exception.projectId }),
            ),
          },
          { role: "user", content: buildExceptionExplanationPrompt(evidence) },
        ],
        maxTokens: 1800,
        temperature: 0.2,
        /*
         * The browser waits on this request: one attempt, bounded below the
         * proxy's budget (INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS).
         */
        requestTimeoutInMs: INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
        requestRetries: 0,
        /*
         * The prompt holds telemetry whose read scope is narrower than the
         * AI log's readers': keep no previews of it.
         */
        storeContentPreviews: false,
      };

      if (data.props.userId) {
        request.userId = data.props.userId;
      }

      const response: AILogResponse =
        await AIService.executeWithLogging(request);

      const explanation: ExceptionAIExplanation | null =
        parseExceptionExplanationResponse(
          response.content,
          exception.stackTrace || "",
        );

      if (!explanation) {
        throw new BadDataException(
          "OneUptime AI did not return an explanation. Please try again.",
        );
      }

      const generatedAt: Date = OneUptimeDate.getCurrentDate();

      await TelemetryExceptionService.updateOneById({
        id: data.telemetryExceptionId,
        data: {
          aiExplanation: explanation,
          aiExplanationGeneratedAt: generatedAt,
        },
        props: { isRoot: true },
      });

      return { explanation, generatedAt };
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (err) {
          logger.debug(`Could not release the explanation lock: ${err}`);
        }
      }
    }
  }

  /*
   * What the explanation is written from, each source read as the caller and
   * best effort: one they may not read, or that fails, is left out.
   */
  public static async gatherEvidence(
    exception: TelemetryException,
    props: DatabaseCommonInteractionProps,
  ): Promise<ExceptionExplanationEvidence> {
    const projectId: ObjectID = exception.projectId!;

    const [latest, resourceName, changes] = await Promise.all([
      ExceptionExplainer.readLatestOccurrence(exception, props),
      ExceptionExplainer.readResourceName(exception, props),
      ExceptionExplainer.readChanges(exception, props),
    ]);

    const traceId: string = latest?.traceId?.toString() || "";

    const [trace, logs] = traceId
      ? await Promise.all([
          ExceptionExplainer.readSpans({
            projectId,
            traceId,
            exceptionSpanId: latest?.spanId?.toString() || "",
            props,
          }),
          ExceptionExplainer.readLogs({ projectId, traceId, props }),
        ])
      : [{ spans: [], exceptionSpanAttributes: {} }, []];

    return {
      exceptionType: exception.exceptionType || "",
      message: exception.message || "",
      stackTrace: exception.stackTrace || "",
      resourceName: resourceName || undefined,
      resourceType: exception.primaryEntityType || undefined,
      environment: exception.environment || undefined,
      occurrenceCount: exception.occuranceCount || 0,
      firstSeenAt: exception.firstSeenAt || undefined,
      lastSeenAt: exception.lastSeenAt || undefined,
      firstSeenInRelease: exception.firstSeenInRelease || undefined,
      lastSeenInRelease: exception.lastSeenInRelease || undefined,
      unhandled: Boolean(exception.unhandled),
      errorClass: exception.errorClass || undefined,
      isResolved: Boolean(exception.isResolved),
      regressedAt: exception.regressedAt || undefined,
      latestOccurrence: latest
        ? {
            time: latest.time || undefined,
            release: latest.release || undefined,
            environment: latest.environment || undefined,
            spanName: latest.spanName || undefined,
            spanAttributes: trace.exceptionSpanAttributes,
          }
        : undefined,
      spans: trace.spans,
      logs,
      changes,
    };
  }

  /*
   * The latest of its occurrences and of those of the exceptions merged
   * into it, which count on it (TelemetryExceptionService
   * .getGroupFingerprints), as its page shows the latest.
   */
  private static async readLatestOccurrence(
    exception: TelemetryException,
    props: DatabaseCommonInteractionProps,
  ): Promise<ExceptionInstance | null> {
    if (!exception.fingerprint) {
      return null;
    }

    try {
      const fingerprints: Array<string> =
        await TelemetryExceptionService.getGroupFingerprintsOf({
          projectId: exception.projectId!,
          exception: {
            id: exception.id?.toString() || exception._id?.toString() || "",
            fingerprint: exception.fingerprint,
          },
        });

      const rows: Array<ExceptionInstance> =
        await ExceptionInstanceService.findBy({
          query: {
            projectId: exception.projectId!,
            fingerprint: getOccurrenceFingerprintQuery(fingerprints),
            ...(exception.primaryEntityId
              ? { primaryEntityId: exception.primaryEntityId }
              : {}),
          },
          select: {
            time: true,
            traceId: true,
            spanId: true,
            spanName: true,
            release: true,
            environment: true,
          },
          sort: { time: SortOrder.Descending },
          limit: 1,
          skip: 0,
          props,
        });

      return rows[0] || null;
    } catch (err) {
      logger.debug(`Explanation: could not read the latest occurrence: ${err}`);
      return null;
    }
  }

  private static async readResourceName(
    exception: TelemetryException,
    props: DatabaseCommonInteractionProps,
  ): Promise<string | null> {
    if (
      !exception.primaryEntityId ||
      (exception.primaryEntityType &&
        exception.primaryEntityType !== ServiceType.OpenTelemetry)
    ) {
      return null;
    }

    try {
      const service: Service | null = await ServiceService.findOneById({
        id: exception.primaryEntityId,
        select: { name: true },
        props,
      });

      return service?.name?.toString() || null;
    } catch (err) {
      logger.debug(`Explanation: could not read the service: ${err}`);
      return null;
    }
  }

  private static async readSpans(data: {
    projectId: ObjectID;
    traceId: string;
    exceptionSpanId: string;
    props: DatabaseCommonInteractionProps;
  }): Promise<{
    spans: Array<ExplanationSpan>;
    exceptionSpanAttributes: Dictionary<string>;
  }> {
    try {
      const rows: Array<Span> = await SpanService.findBy({
        query: { projectId: data.projectId, traceId: data.traceId },
        select: {
          spanId: true,
          name: true,
          kind: true,
          statusCode: true,
          durationUnixNano: true,
          startTime: true,
        },
        sort: { startTime: SortOrder.Ascending },
        limit: MAX_PROMPT_SPANS,
        skip: 0,
        props: data.props,
      });

      let exceptionSpanAttributes: Dictionary<string> = {};

      if (data.exceptionSpanId) {
        const exceptionSpan: Span | null = await SpanService.findOneBy({
          query: {
            projectId: data.projectId,
            traceId: data.traceId,
            spanId: data.exceptionSpanId,
          },
          select: { attributes: true },
          props: data.props,
        });

        exceptionSpanAttributes = pickExplanationSpanAttributes(
          (exceptionSpan?.attributes as Dictionary<unknown>) || {},
        );
      }

      return {
        spans: rows.map((row: Span): ExplanationSpan => {
          const duration: number = Number(row.durationUnixNano);

          return {
            name: row.name || "",
            kind: row.kind ? String(row.kind) : "",
            statusCode:
              row.statusCode === undefined ? undefined : Number(row.statusCode),
            durationMs: Number.isFinite(duration)
              ? duration / 1_000_000
              : undefined,
            isExceptionSpan:
              Boolean(data.exceptionSpanId) &&
              row.spanId?.toString() === data.exceptionSpanId,
          };
        }),
        exceptionSpanAttributes,
      };
    } catch (err) {
      logger.debug(`Explanation: could not read the trace: ${err}`);
      return { spans: [], exceptionSpanAttributes: {} };
    }
  }

  private static async readLogs(data: {
    projectId: ObjectID;
    traceId: string;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<ExplanationLog>> {
    try {
      const rows: Array<Log> = await LogService.findBy({
        query: { projectId: data.projectId, traceId: data.traceId },
        select: { time: true, severityText: true, body: true },
        sort: { time: SortOrder.Ascending },
        limit: MAX_PROMPT_LOGS,
        skip: 0,
        props: data.props,
      });

      return rows.map((row: Log): ExplanationLog => {
        return {
          time: row.time || undefined,
          severity: row.severityText ? String(row.severityText) : "",
          // Cut here already: a log body can be megabytes on one line.
          body: (typeof row.body === "string" ? row.body : "").slice(
            0,
            MAX_PROMPT_LOG_LENGTH,
          ),
        };
      });
    } catch (err) {
      logger.debug(`Explanation: could not read the logs: ${err}`);
      return [];
    }
  }

  private static async readChanges(
    exception: TelemetryException,
    props: DatabaseCommonInteractionProps,
  ): Promise<Array<ExplanationChange>> {
    const now: Date = OneUptimeDate.getCurrentDate();
    const firstSeen: Date = exception.firstSeenAt
      ? new Date(exception.firstSeenAt)
      : now;
    const isService: boolean =
      Boolean(exception.primaryEntityId) &&
      (!exception.primaryEntityType ||
        exception.primaryEntityType === ServiceType.OpenTelemetry);

    try {
      const rows: Array<ChangeEvent> = await ChangeEventService.findBy({
        query: {
          projectId: exception.projectId!,
          time: new InBetween(
            new Date(firstSeen.getTime() - CHANGE_LOOKBACK_MS),
            now,
          ),
          ...(isService ? { primaryEntityId: exception.primaryEntityId } : {}),
        } as never,
        select: {
          time: true,
          eventType: true,
          title: true,
          attributes: true,
        } as never,
        sort: { time: SortOrder.Descending } as never,
        limit: MAX_PROMPT_CHANGES,
        skip: 0,
        props,
      });

      return rows
        .map((row: ChangeEvent): ExplanationChange => {
          const fields: ChangeEventFields = readChangeEventFields(
            (row.attributes as Dictionary<unknown>) || {},
          );

          return {
            time: new Date(row.time!),
            eventType: row.eventType ? String(row.eventType) : "",
            title: row.title ? String(row.title) : "",
            version: fields.version,
            commitSha: fields.commitSha,
          };
        })
        .sort((a: ExplanationChange, b: ExplanationChange): number => {
          return a.time.getTime() - b.time.getTime();
        });
    } catch (err) {
      logger.debug(`Explanation: could not read the changes: ${err}`);
      return [];
    }
  }
}
