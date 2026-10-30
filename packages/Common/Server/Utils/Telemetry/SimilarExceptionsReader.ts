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

const CANDIDATE_SELECT: { [key: string]: true } = {
  _id: true,
  exceptionType: true,
  message: true,
  stackTrace: true,
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

    const ranked: Array<RankedSimilar<SimilarExceptionCandidate>> =
      rankSimilarExceptions(
        toCandidate(target),
        [...sameType, ...sameService].map(toCandidate),
      );

    return {
      target,
      similar: ranked.map((entry: RankedSimilar<SimilarExceptionCandidate>) => {
        return {
          similar: toSimilarException(entry),
          exception: entry.candidate.exception,
        };
      }),
    };
  }
}
