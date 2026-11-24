import { SCRUB_HASH_TOKEN_PATTERN } from "../Telemetry/ScrubHashTokenFormat";

/*
 * ERASING ONE PERSON FROM SECURITY EVENTS' USER VAULT (#10908).
 *
 * Security Events' user vault keeps the user behind each token a Hash scrub
 * rule leaves where Security Events reads a user (Models/AnalyticsModels/
 * SecurityUserVault, #10632), for 30 days after the user was last seen. A
 * team that gets an erasure request (GDPR Article 17) for someone whose id
 * its rules hash files an erasure request (Models/DatabaseModels/
 * SecurityUserErasureRequest): a user id, an email address, or the token
 * itself. From that moment the vault refuses the person's tokens - ingest
 * never keeps them again and no scan names them, even when a later event
 * carries one - and the erasure worker deletes the person's rows, puts the
 * token back in the events the vault named, and takes the person out of
 * the cases, detections, entity risk and proposals Security Events made
 * from them (Server/Utils/SecurityEvent/UserVault/SecurityUserErasure).
 *
 * Here: what both the server and the browser need to know about a request -
 * its states, how long what it takes may be, and which spellings of what a
 * person typed it erases. React-free and server-free, so a plain test pins
 * them and the Dashboard's form checks what the server will.
 */

export enum SecurityUserErasureRequestStatus {
  // Filed: the vault refuses the person's tokens, and the worker has not started.
  Pending = "Pending",
  /*
   * Started: the person is out of Postgres, and ClickHouse has been told to
   * delete their rows and put the token back in their events. The worker
   * checks on the next runs that ClickHouse did.
   */
  InProgress = "InProgress",
  // Checked: nothing the request reaches names the person any more.
  Completed = "Completed",
  // It could not finish, after every retry; the project's owners were told.
  Failed = "Failed",
}

export const SECURITY_USER_ERASURE_REQUEST_STATUSES: ReadonlyArray<SecurityUserErasureRequestStatus> =
  Object.values(SecurityUserErasureRequestStatus);

// A request that is over, one way or the other: nothing more is done to it.
export function isSecurityUserErasureRequestFinished(
  status: SecurityUserErasureRequestStatus | string | undefined,
): boolean {
  return (
    status === SecurityUserErasureRequestStatus.Completed ||
    status === SecurityUserErasureRequestStatus.Failed
  );
}

/*
 * The longest user a request takes: the user vault never keeps a longer one
 * (SecurityUserVaultService's MAX_USER_VAULT_USER_LENGTH, which a test
 * holds equal to this), so a longer one names nobody it holds.
 */
export const SECURITY_USER_ERASURE_MAX_USER_LENGTH: number = 512;

/*
 * The longest reference a request keeps: a ticket number, a case id - the
 * team's own name for the request, never the person's.
 */
export const SECURITY_USER_ERASURE_MAX_REFERENCE_LENGTH: number = 100;

// An email address, as a person would type one: something, an @, a domain with a dot.
const EMAIL_ADDRESS: RegExp = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailAddress(text: string): boolean {
  return EMAIL_ADDRESS.test((text || "").trim());
}

/*
 * Whether what a person typed is a token a Hash rule makes today,
 * "[HASHED:" and 16 lowercase hex characters, copied from an event or a
 * log line: the request erases that token, and needs nothing hashed.
 */
export function isErasureToken(text: string): boolean {
  return SCRUB_HASH_TOKEN_PATTERN.test((text || "").trim());
}

/*
 * The spellings of what a person typed that a request erases, each of
 * which a Hash rule would have made a token of its own:
 *
 *   - exactly as typed, its spaces at either end aside;
 *   - and, for an email address, in lower case too. An email address is
 *     the same mailbox whatever the case, and the logs that hash it
 *     usually hold it in lower case, whatever case the person writes it
 *     in on their request. A user id is not: "Alice" and "alice" can be
 *     two accounts, so it is erased only as typed.
 *
 * None for a token (the request erases the token itself), for nothing, or
 * for a user longer than the vault keeps.
 */
export function getErasureSpellings(user: string): Array<string> {
  const typed: string = (user || "").trim();

  if (
    !typed ||
    typed.length > SECURITY_USER_ERASURE_MAX_USER_LENGTH ||
    isErasureToken(typed)
  ) {
    return [];
  }

  const spellings: Array<string> = [typed];

  if (isEmailAddress(typed) && typed.toLowerCase() !== typed) {
    spellings.push(typed.toLowerCase());
  }

  return spellings;
}

/*
 * Why what a person typed cannot be erased, as the form and the server say
 * it, or null when it can. English keys: the Dashboard translates them.
 */
export function getErasureUserProblem(user: string | undefined): string | null {
  const typed: string = (user || "").trim();

  if (!typed) {
    return "Enter the user ID, email address or token of the person to erase.";
  }

  if (typed.length > SECURITY_USER_ERASURE_MAX_USER_LENGTH) {
    return "That is longer than any user Security Events keeps. Enter the user ID or email address as your logs hold it.";
  }

  return null;
}
