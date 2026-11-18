import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import ObjectID from "../../../Types/ObjectID";
import {
  SLO_BULK_ADD_FAILED_MESSAGE,
  SLO_BULK_NO_IDS_MESSAGE,
  SLO_BULK_TOO_MANY_MESSAGE,
  SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS,
  getSloBulkResultKey,
} from "../../../Utils/Slo/SloBulkRecommendedBurnRateRules";

/*
 * A BULK ACTION OF THE SLO LIST, ON THE SERVER.
 *
 * The SLO list's Bulk Actions ask the server about many SLOs at once - Add
 * recommended rules (#6310) and Use the recommended policy (#6358) - each
 * with the same request: between one and
 * SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS SLO ids, answered SLO by SLO
 * in the order named. What their services share is here: the SLOs a request
 * names, and how a failure of one SLO is told apart from a refusal.
 */

/*
 * The answers that mean the caller may not - the SLO is not one they may
 * read, or they may not create what is added, or the plan does not allow
 * it - rather than that something broke.
 */
const SLO_BULK_REFUSAL_CODES: ReadonlyArray<ExceptionCode> = [
  ExceptionCode.NotFoundException,
  ExceptionCode.NotAuthorizedException,
  ExceptionCode.NotAuthenticatedException,
  ExceptionCode.ForbiddenException,
  ExceptionCode.PaymentRequiredException,
];

export function isSloBulkRefusal(error: unknown): boolean {
  return (
    error instanceof Exception && SLO_BULK_REFUSAL_CODES.includes(error.code)
  );
}

/*
 * Why an SLO was not added to, in OneUptime's own words: an exception's own
 * sentence, or `fallback` for a failure that is not OneUptime's - the
 * database, the network - which the server logs rather than hands on.
 */
export function getSloBulkErrorMessage(
  error: unknown,
  fallback: string = SLO_BULK_ADD_FAILED_MESSAGE,
): string {
  if (error instanceof Exception && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

/*
 * The SLOs a bulk request names, each once, in the order first named:
 * between one and SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS of them.
 */
export function getSloBulkIds(ids: ReadonlyArray<ObjectID>): Array<ObjectID> {
  const unique: Array<ObjectID> = [];
  const seen: Set<string> = new Set<string>();

  for (const id of ids) {
    const key: string = getSloBulkResultKey(id.toString());

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(id);
  }

  if (unique.length === 0) {
    throw new BadDataException(SLO_BULK_NO_IDS_MESSAGE);
  }

  if (unique.length > SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS) {
    throw new BadDataException(SLO_BULK_TOO_MANY_MESSAGE);
  }

  return unique;
}
