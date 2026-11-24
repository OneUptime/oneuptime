import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  SCRUBBED_USER_ROLES,
  ScrubbedUserRole,
  nameHashedEventUser,
  readEventUserOfRole,
} from "../../../../Utils/SecurityEvent/ScrubbedUser";
import SecurityUserVaultService from "../../../Services/SecurityUserVaultService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { readHashTokens } from "./HashedUserPairs";
import SecurityUserErasedTokens, {
  ErasedTokens,
  isTokenErased,
} from "./SecurityUserErasedTokens";

/*
 * SECURITY EVENTS' HALF OF THE USER VAULT (#10632): the scans name the
 * user behind a Hash rule's token, as the address vault's lookup names an
 * address (AddressVault/SecurityAddressVaultLookup.ts, #10395).
 *
 * Since #10435 a Hash token stays the event's user (ScrubbedUser): a
 * per-account rule still counts per account, but no response can act on
 * it, and a responder sees "[HASHED:3f9a...]" with no way to find who it
 * is. Here, before a page of events is stored - after the request
 * follow-up, so a user its trace brought is named too - the page's user
 * tokens are looked up in the vault, in one query
 * (SecurityUserVaultService.findUsersOfTokens). A token the vault holds
 * names the event's user, as if the record had held it
 * (ScrubbedUser.nameHashedEventUser):
 *
 *   - principalUser or targetUser, which every rule, case, playbook, the
 *     Response Plan, entity risk and watchlists read as they always have;
 *     so a case about a hashed account names the account, and a playbook
 *     can act on it with the same protections as any other target (the
 *     project's protected entities, approvals, the entity rule);
 *   - the request's user, an observable in the token's place;
 *   - and the marker that said a scrub rule hid it is cleared, with what
 *     the rule left kept beside it (oneuptime.<role>_user_hashed_as), so
 *     the logs and traces that hold only the token can still be searched.
 *
 * A user with the token inside it ("auth0|[HASHED:3f9a...]") is named with
 * the token's user in its place; one with two tokens is named only when
 * the vault knows both. A token the vault does not hold - older than its
 * 30 days, hashed before tokens had a key (#10394), never written because
 * the write failed or Security Events was not reading then - leaves the
 * event as it was: its user is the token, which no playbook ever offers to
 * act on (SecurityEntity's getEntityAsActionable). So does a lookup that
 * fails: it is logged, and the events are stored as they were.
 *
 * The vault only ever holds what a Hash rule hashed where Security Events
 * reads a user (UserVault/HashedUserPairs), and a token here is only ever
 * read from the event's own user, which the record would have named
 * unscrubbed: the vault names nothing the record did not say.
 *
 * A person erased from the vault on request (#10908) is never named again:
 * a user holding any token of the project's erasure requests is left as
 * the rule left it, even when a later event carries the token and even if
 * the vault still held a row for it (SecurityUserErasedTokens).
 *
 * Only Security Events' scans call this (SecurityUserVaultGuard.test.ts).
 */

// A user to name, and which event's user of which role it is.
interface PendingUser {
  event: NormalizedSecurityEvent;
  role: ScrubbedUserRole;
  // The user as stored: what the rule left.
  hashed: string;
  tokens: Array<string>;
}

/*
 * The user `hashed` names once each token in it is replaced by the user
 * the vault holds behind it, or null when the vault does not hold every
 * one of them.
 */
export function nameHashedUser(
  hashed: string,
  users: ReadonlyMap<string, string>,
): string | null {
  const tokens: Array<string> = readHashTokens(hashed);

  if (tokens.length === 0) {
    return null;
  }

  let named: string = hashed;

  for (const token of tokens) {
    const user: string | undefined = users.get(token);

    if (!user) {
      return null;
    }

    named = named.split(token).join(user);
  }

  return named.trim() || null;
}

export default class SecurityUserVaultLookup {
  /*
   * Each user of a page's events a Hash rule hid - who acted, and who was
   * acted on - named by the user the vault holds behind its token, in
   * place. One lookup a page; never throws. Returns how many users it
   * named.
   */
  @CaptureSpan()
  public static async nameHashedUsers(data: {
    projectId: ObjectID;
    events: Array<NormalizedSecurityEvent>;
  }): Promise<number> {
    const pending: Array<PendingUser> = [];

    for (const event of data.events) {
      for (const role of SCRUBBED_USER_ROLES) {
        const hashed: string = readEventUserOfRole(event, role);
        const tokens: Array<string> = readHashTokens(hashed);

        if (tokens.length > 0) {
          pending.push({ event, role, hashed, tokens });
        }
      }
    }

    if (pending.length === 0) {
      return 0;
    }

    /*
     * A person erased from the vault on request (#10908) is never named
     * again, whatever the vault holds: a user with an erased token in it
     * stays as the rule left it. When the erased tokens cannot be read,
     * nobody is named.
     */
    const erased: ErasedTokens = await SecurityUserErasedTokens.getErasedTokens(
      data.projectId,
    );

    if (erased === null) {
      return 0;
    }

    const nameable: Array<PendingUser> = pending.filter(
      (item: PendingUser): boolean => {
        return !item.tokens.some((token: string): boolean => {
          return isTokenErased(token, erased);
        });
      },
    );

    if (nameable.length === 0) {
      return 0;
    }

    let users: Map<string, string>;

    try {
      users = await SecurityUserVaultService.findUsersOfTokens({
        projectId: data.projectId,
        tokens: nameable.flatMap((item: PendingUser): Array<string> => {
          return item.tokens;
        }),
      });
    } catch (error) {
      logger.warn(
        `SecurityUserVaultLookup: could not look up the hashed users of project ${data.projectId.toString()}'s events; they are stored with the tokens.`,
      );
      logger.warn(error);
      return 0;
    }

    let named: number = 0;

    for (const item of nameable) {
      const user: string | null = nameHashedUser(item.hashed, users);

      if (!user) {
        continue;
      }

      nameHashedEventUser(item.event, {
        role: item.role,
        hashed: item.hashed,
        named: user,
      });
      named++;
    }

    return named;
  }
}
