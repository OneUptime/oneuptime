import Service from "../../../../Models/DatabaseModels/Service";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import {
  EXCEPTION_DIGEST_WINDOW_HOURS,
  ExceptionAIDigest,
  ExceptionDigestKind,
  MAX_DIGEST_EXCEPTIONS,
} from "../../../../Types/Telemetry/ExceptionAIDigest";
import AIService, {
  AILogRequest,
  AILogResponse,
  INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
} from "../../../Services/AIService";
import ServiceService from "../../../Services/ServiceService";
import TelemetryExceptionService from "../../../Services/TelemetryExceptionService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import AiContextReader from "../AiContext/AiContextReader";
import { withAiContext } from "../AiContext/AiContextPrompt";
import {
  buildExceptionDigestPrompt,
  DigestException,
  EXCEPTION_DIGEST_SYSTEM_PROMPT,
  parseExceptionDigestResponse,
} from "./ExceptionDigestPrompt";

/*
 * SUM UP A DAY'S NEW AND REGRESSED EXCEPTIONS WITH ONEUPTIME AI.
 *
 * The person on call opens Exceptions and wants to know what changed: which
 * exceptions are new since yesterday, which came back after they were
 * resolved, and which of them to look at first. OneUptime AI reads the
 * busiest of them (at most MAX_DIGEST_EXCEPTIONS) and writes a headline and
 * one line per exception (ExceptionDigestPrompt).
 *
 * The exceptions are read as the person asking, so their read scope
 * applies, and so are the services named. With nothing new or regressed,
 * no model is asked and no credit is spent. The call goes through
 * AIService.executeWithLogging: the project's Enable AI switch, its credits,
 * daily limits, billing and the AI log are the ones every OneUptime AI
 * feature honours. The digest is not kept.
 */

export const EXCEPTION_DIGEST_FEATURE: string = "ExceptionDigest";

export interface ExceptionDigestResult {
  // Null when nothing is new or regressed: there was nothing to sum up.
  digest: ExceptionAIDigest | null;
  exceptionCount: number;
  generatedAt: Date;
  windowHours: number;
}

const EXCEPTION_SELECT: {
  [key: string]: true;
} = {
  _id: true,
  primaryEntityId: true,
  primaryEntityType: true,
  exceptionType: true,
  message: true,
  stackTrace: true,
  environment: true,
  occuranceCount: true,
  firstSeenAt: true,
  firstSeenInRelease: true,
  lastSeenInRelease: true,
  regressedAt: true,
  unhandled: true,
};

export default class ExceptionDigester {
  public static async digest(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<ExceptionDigestResult> {
    const now: Date = OneUptimeDate.getCurrentDate();
    const since: Date = OneUptimeDate.addRemoveHours(
      now,
      -EXCEPTION_DIGEST_WINDOW_HOURS,
    );

    const exceptions: Array<DigestException> =
      await ExceptionDigester.readExceptions({
        projectId: data.projectId,
        since,
        props: data.props,
      });

    if (exceptions.length === 0) {
      return {
        digest: null,
        exceptionCount: 0,
        generatedAt: now,
        windowHours: EXCEPTION_DIGEST_WINDOW_HOURS,
      };
    }

    /*
     * The project's AI switch, before a token is spent (executeWithLogging
     * refuses too). Asked after the reads on purpose: they are the caller's
     * own, so someone who may not read the project's exceptions is refused
     * by them and learns nothing about the project's AI from this route.
     */
    await AIService.assertProjectAIEnabled(data.projectId);

    const request: AILogRequest = {
      projectId: data.projectId,
      feature: EXCEPTION_DIGEST_FEATURE,
      messages: [
        {
          role: "system",
          content: withAiContext(
            EXCEPTION_DIGEST_SYSTEM_PROMPT,
            await AiContextReader.read({ projectId: data.projectId }),
          ),
        },
        { role: "user", content: buildExceptionDigestPrompt(exceptions) },
      ],
      maxTokens: 1500,
      temperature: 0.2,
      // The browser waits on this request: one attempt, bounded.
      requestTimeoutInMs: INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
      requestRetries: 0,
      /*
       * The prompt holds telemetry whose read scope is narrower than the AI
       * log's readers': keep no previews of it.
       */
      storeContentPreviews: false,
    };

    if (data.props.userId) {
      request.userId = data.props.userId;
    }

    const response: AILogResponse = await AIService.executeWithLogging(request);

    const digest: ExceptionAIDigest | null = parseExceptionDigestResponse(
      response.content,
      exceptions,
    );

    if (!digest) {
      throw new BadDataException(
        "OneUptime AI did not return a summary. Please try again.",
      );
    }

    return {
      digest,
      exceptionCount: exceptions.length,
      generatedAt: OneUptimeDate.getCurrentDate(),
      windowHours: EXCEPTION_DIGEST_WINDOW_HOURS,
    };
  }

  /*
   * The open exceptions first seen since `since`, and the open ones that
   * came back since then, as the caller may read them: regressed ones
   * first, then the busiest, at most MAX_DIGEST_EXCEPTIONS.
   */
  public static async readExceptions(data: {
    projectId: ObjectID;
    since: Date;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<DigestException>> {
    const open: {
      projectId: ObjectID;
      isResolved: boolean;
      isArchived: boolean;
    } = {
      projectId: data.projectId,
      isResolved: false,
      isArchived: false,
    };

    const [regressed, fresh] = await Promise.all([
      TelemetryExceptionService.findBy({
        query: {
          ...open,
          regressedAt: QueryHelper.greaterThanEqualTo(data.since),
        },
        select: EXCEPTION_SELECT,
        sort: { occuranceCount: SortOrder.Descending },
        limit: MAX_DIGEST_EXCEPTIONS,
        skip: 0,
        props: data.props,
      }),
      TelemetryExceptionService.findBy({
        query: {
          ...open,
          firstSeenAt: QueryHelper.greaterThanEqualTo(data.since),
        },
        select: EXCEPTION_SELECT,
        sort: { occuranceCount: SortOrder.Descending },
        limit: MAX_DIGEST_EXCEPTIONS,
        skip: 0,
        props: data.props,
      }),
    ]);

    const seen: Set<string> = new Set<string>();
    const picked: Array<{
      exception: TelemetryException;
      kind: ExceptionDigestKind;
    }> = [];

    for (const [rows, kind] of [
      [regressed, ExceptionDigestKind.Regressed],
      [fresh, ExceptionDigestKind.New],
    ] as Array<[Array<TelemetryException>, ExceptionDigestKind]>) {
      for (const exception of rows) {
        const id: string = exception.id?.toString() || "";

        if (!id || seen.has(id) || picked.length >= MAX_DIGEST_EXCEPTIONS) {
          continue;
        }

        seen.add(id);
        picked.push({ exception, kind });
      }
    }

    const names: Map<string, string> = await ExceptionDigester.readServiceNames(
      picked.map((entry: { exception: TelemetryException }) => {
        return entry.exception;
      }),
      data.props,
    );

    return picked.map(
      (entry: {
        exception: TelemetryException;
        kind: ExceptionDigestKind;
      }): DigestException => {
        const exception: TelemetryException = entry.exception;

        return {
          telemetryExceptionId: exception.id!.toString(),
          kind: entry.kind,
          exceptionType: exception.exceptionType || "",
          message: exception.message || "",
          stackTrace: exception.stackTrace || "",
          resourceName:
            names.get(exception.primaryEntityId?.toString() || "") || undefined,
          environment: exception.environment || undefined,
          occurrenceCount: exception.occuranceCount || 0,
          firstSeenAt: exception.firstSeenAt || undefined,
          regressedAt: exception.regressedAt || undefined,
          release:
            (entry.kind === ExceptionDigestKind.Regressed
              ? exception.lastSeenInRelease
              : exception.firstSeenInRelease) || undefined,
          unhandled: Boolean(exception.unhandled),
        };
      },
    );
  }

  // The services the exceptions happened in, as the caller may read them.
  private static async readServiceNames(
    exceptions: Array<TelemetryException>,
    props: DatabaseCommonInteractionProps,
  ): Promise<Map<string, string>> {
    const names: Map<string, string> = new Map<string, string>();
    const ids: Array<string> = Array.from(
      new Set(
        exceptions
          .filter((exception: TelemetryException): boolean => {
            return (
              Boolean(exception.primaryEntityId) &&
              (!exception.primaryEntityType ||
                exception.primaryEntityType === ServiceType.OpenTelemetry)
            );
          })
          .map((exception: TelemetryException): string => {
            return exception.primaryEntityId!.toString();
          }),
      ),
    );

    if (ids.length === 0) {
      return names;
    }

    try {
      const services: Array<Service> = await ServiceService.findBy({
        query: {
          _id: QueryHelper.any(ids),
        },
        select: { _id: true, name: true },
        limit: ids.length,
        skip: 0,
        props,
      });

      for (const service of services) {
        if (service.id && service.name) {
          names.set(service.id.toString(), service.name.toString());
        }
      }
    } catch (err) {
      logger.debug(`Digest: could not read the services: ${err}`);
    }

    return names;
  }
}
