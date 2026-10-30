import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import {
  boundedSimilarText,
  MAX_SIMILAR_MESSAGE_LENGTH,
  MAX_SIMILAR_TYPE_LENGTH,
  SimilarException,
} from "../../../Types/Telemetry/SimilarExceptions";
import TelemetryExceptionService from "../../Services/TelemetryExceptionService";
import {
  ExceptionSignatureInput,
  MAX_SIGNATURE_STACK_TRACE_LENGTH,
  rankSimilarExceptions,
  RankedSimilar,
} from "./ExceptionSimilarity";

/*
 * THE EXCEPTIONS OF A PROJECT THAT LOOK LIKE ONE OF ITS EXCEPTIONS.
 *
 * Read as the person asking, so their read scope applies: the exception
 * itself (one they may not read is not found), then the most recently seen
 * exceptions of the same type and of the same service, every status. They
 * are compared in memory (ExceptionSimilarity) and the most similar few are
 * returned, with why. Only so many candidates are read, so a project with
 * thousands of exceptions of one type is looked through from its most
 * recent ones.
 */

// How much of a message and of a stack trace is read of each exception.
export const MESSAGE_HEAD_LENGTH: number = 1000;
export const STACK_TRACE_HEAD_LENGTH: number = 4000;

// The most recently seen exceptions of the same type that are compared.
export const MAX_SAME_TYPE_CANDIDATES: number = 100;
// And of the same service.
export const MAX_SAME_SERVICE_CANDIDATES: number = 50;

export interface SimilarExceptionCandidate extends ExceptionSignatureInput {
  exception: TelemetryException;
}

export interface SimilarExceptionsWithEvidence {
  target: TelemetryException;
  similar: Array<{
    similar: SimilarException;
    exception: TelemetryException;
  }>;
}

/*
 * What is read of each candidate through the caller's permissions: never
 * its message or stack trace, which can be megabytes each - only the
 * first characters of those are read, afterwards, for the candidates the
 * caller may read (readTextHeads).
 */
const CANDIDATE_SELECT: { [key: string]: true } = {
  _id: true,
  // Whether it can be merged into the exception: only within one service.
  primaryEntityId: true,
  exceptionType: true,
  occuranceCount: true,
  lastSeenAt: true,
  isResolved: true,
  isArchived: true,
};

function toCandidate(exception: TelemetryException): SimilarExceptionCandidate {
  return {
    id: exception.id?.toString() || "",
    exceptionType: exception.exceptionType || "",
    message: exception.message || "",
    // Only its top frames are read: cut it here, once.
    stackTrace: (exception.stackTrace || "").slice(
      0,
      MAX_SIGNATURE_STACK_TRACE_LENGTH,
    ),
    exception,
  };
}

export function toSimilarException(
  ranked: RankedSimilar<SimilarExceptionCandidate>,
): SimilarException {
  const exception: TelemetryException = ranked.candidate.exception;

  return {
    telemetryExceptionId: ranked.candidate.id,
    exceptionType: boundedSimilarText(
      exception.exceptionType || "",
      MAX_SIMILAR_TYPE_LENGTH,
    ),
    message: boundedSimilarText(
      (exception.message || "").slice(0, MAX_SIMILAR_MESSAGE_LENGTH * 2),
      MAX_SIMILAR_MESSAGE_LENGTH,
    ),
    occurrenceCount: exception.occuranceCount || 0,
    ...(exception.lastSeenAt
      ? { lastSeenAt: new Date(exception.lastSeenAt).toISOString() }
      : {}),
    isResolved: Boolean(exception.isResolved),
    isArchived: Boolean(exception.isArchived),
    reason: ranked.reason,
  };
}

export default class SimilarExceptionsReader {
  /*
   * The first MESSAGE_HEAD_LENGTH characters of each exception's message
   * and STACK_TRACE_HEAD_LENGTH of its stack trace, cut by Postgres, so
   * nothing longer leaves the database. Only for ids the caller's own
   * read returned.
   */
  public static async readTextHeads(data: {
    projectId: ObjectID;
    ids: Array<string>;
  }): Promise<Map<string, { message: string; stackTrace: string }>> {
    const heads: Map<string, { message: string; stackTrace: string }> =
      new Map();
    const ids: Array<string> = Array.from(new Set(data.ids)).filter(
      (id: string): boolean => {
        return ObjectID.isValidUUID(id);
      },
    );

    if (ids.length === 0) {
      return heads;
    }

    const rows: Array<{ id: string; message: string; stackTrace: string }> =
      await TelemetryExceptionService.getRepository().manager.query(
        `SELECT "_id"::text AS "id", LEFT(COALESCE("message", ''), $3) AS "message", LEFT(COALESCE("stackTrace", ''), $4) AS "stackTrace" FROM "TelemetryException" WHERE "projectId" = $1 AND "_id" = ANY($2::uuid[])`,
        [
          data.projectId.toString(),
          ids,
          MESSAGE_HEAD_LENGTH,
          STACK_TRACE_HEAD_LENGTH,
        ],
      );

    for (const row of rows || []) {
      heads.set(String(row.id).toLowerCase(), {
        message: String(row.message || ""),
        stackTrace: String(row.stackTrace || ""),
      });
    }

    return heads;
  }

  public static async find(data: {
    telemetryExceptionId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<SimilarException>> {
    const found: SimilarExceptionsWithEvidence =
      await SimilarExceptionsReader.findWithEvidence(data);

    return found.similar.map(
      (entry: { similar: SimilarException }): SimilarException => {
        return entry.similar;
      },
    );
  }

  public static async findWithEvidence(data: {
    telemetryExceptionId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<SimilarExceptionsWithEvidence> {
    const target: TelemetryException | null =
      await TelemetryExceptionService.findOneById({
        id: data.telemetryExceptionId,
        select: {
          ...CANDIDATE_SELECT,
          projectId: true,
          primaryEntityId: true,
          primaryEntityType: true,
        },
        props: data.props,
      });

    if (!target || !target.projectId) {
      throw new NotFoundException("Exception not found");
    }

    const [sameType, sameService] = await Promise.all([
      target.exceptionType
        ? TelemetryExceptionService.findBy({
            query: {
              projectId: target.projectId,
              exceptionType: target.exceptionType,
            },
            select: CANDIDATE_SELECT,
            sort: { lastSeenAt: SortOrder.Descending },
            limit: MAX_SAME_TYPE_CANDIDATES,
            skip: 0,
            props: data.props,
          })
        : Promise.resolve([] as Array<TelemetryException>),
      target.primaryEntityId
        ? TelemetryExceptionService.findBy({
            query: {
              projectId: target.projectId,
              primaryEntityId: target.primaryEntityId,
            },
            select: CANDIDATE_SELECT,
            sort: { lastSeenAt: SortOrder.Descending },
            limit: MAX_SAME_SERVICE_CANDIDATES,
            skip: 0,
            props: data.props,
          })
        : Promise.resolve([] as Array<TelemetryException>),
    ]);

    /*
     * The first characters of each one's message and stack trace - all a
     * comparison reads (ExceptionSimilarity) - for the exceptions the
     * caller was allowed to read above, and only those.
     */
    const exceptions: Array<TelemetryException> = [
      target,
      ...sameType,
      ...sameService,
    ];
    const heads: Map<string, { message: string; stackTrace: string }> =
      await SimilarExceptionsReader.readTextHeads({
        projectId: target.projectId,
        ids: exceptions
          .map((exception: TelemetryException): string => {
            return exception.id?.toString() || "";
          })
          .filter((id: string): boolean => {
            return Boolean(id);
          }),
      });

    for (const exception of exceptions) {
      const head: { message: string; stackTrace: string } | undefined =
        heads.get((exception.id?.toString() || "").toLowerCase());
      exception.message = head?.message || "";
      exception.stackTrace = head?.stackTrace || "";
    }

    const ranked: Array<RankedSimilar<SimilarExceptionCandidate>> =
      rankSimilarExceptions(
        toCandidate(target),
        [...sameType, ...sameService].map(toCandidate),
      );

    return {
      target,
      similar: ranked.map((entry: RankedSimilar<SimilarExceptionCandidate>) => {
        const isSameService: boolean =
          Boolean(target.primaryEntityId) &&
          entry.candidate.exception.primaryEntityId?.toString().toLowerCase() ===
            target.primaryEntityId?.toString().toLowerCase();

        return {
          similar: {
            ...toSimilarException(entry),
            ...(isSameService ? { isSameService: true } : {}),
          },
          exception: entry.candidate.exception,
        };
      }),
    };
  }
}
