import crypto from "crypto";
import { EncryptionSecret } from "../../EnvironmentConfig";
import ObjectID from "../../../Types/ObjectID";
import { SESSION_REPLAY_MAX_USER_REF_LENGTH } from "../../../Types/Rum/SessionReplay";

/*
 * "Whose session is this?"
 *
 * A page that has an end-user reference hands it to the recorder
 * (data-oneuptime-user-ref, or the init global). When the application has
 * identity capture switched on, the recorder puts that reference on the
 * chunk envelope's meta, and this module turns it into the two columns the
 * session header carries:
 *
 *   identifiedUserKey    HMAC(EncryptionSecret, "<projectId>:<userRef>")
 *   identifiedUserLabel  the reference itself, behind its own column ACL
 *
 * The key is what makes a reference SEARCHABLE and ERASABLE without storing
 * it in a lookup-friendly form: a support engineer filtering by user, and a
 * right-to-erasure request naming one, both resolve to the same digest. The
 * label is what makes a session READABLE - "jane@example.com" rather than a
 * 64-character hash - and is why it sits behind a narrower ACL than the rest
 * of the session metadata.
 *
 * Scoped by project and NOT by application, deliberately. A project-wide
 * erasure request (ProcessSessionErasureRequests filters on projectId with
 * the application clause optional) has to be able to reach every session for
 * that person, including ones recorded by sibling applications. An
 * application-scoped digest would make that request silently under-delete,
 * which is the failure mode with legal consequences.
 *
 * Deliberately NOT reusing SessionReplayTargeting.buildTargetKey: that one
 * is application-scoped and prefixed for a Redis keyspace. Both are HMACs of
 * a user reference, and conflating them would tie an erasure lookup to the
 * shape of a Redis key.
 */

export interface SessionReplayUserKeyInput {
  projectId: ObjectID;
  userRef: string;
}

export default class SessionReplayIdentity {
  /*
   * Usable when non-empty and within the shared cap. The cap matters on both
   * sides of the comparison: the recorder slices the reference to the same
   * length before sending it, so anything longer could never match a stored
   * key anyway, and hashing an unbounded string here would be the only
   * unbounded work on this path.
   */
  public static isUsableUserRef(userRef: unknown): userRef is string {
    return (
      typeof userRef === "string" &&
      userRef.trim().length > 0 &&
      userRef.length <= SESSION_REPLAY_MAX_USER_REF_LENGTH
    );
  }

  /*
   * The project scope lives in the KEY, not in the message.
   *
   * HMAC takes arbitrary key material, so deriving a per-project key from
   * the instance secret and the project id gives real domain separation:
   * two projects cannot produce the same digest for the same person even
   * if one of them learns the other's project id, which prefixing the
   * message only achieves by convention. It is also what makes the
   * "per-project" wording on the identity columns literally true.
   *
   * The reference is trimmed but NOT lower-cased. End-user references are
   * opaque to us - "U-1000" and "u-1000" may well be two different
   * customers in the host application's own database - so folding case here
   * would merge two people's recordings under one key, and an erasure for
   * one would delete the other's. Targeting lower-cases the APPLICATION
   * identifier for the same reason in reverse: that one is ours and is
   * case-insensitive.
   *
   * A slow KDF (bcrypt / scrypt / argon2) is deliberately NOT used and
   * would not help. This is a keyed pseudonym, not a stored password: it
   * has to be DETERMINISTIC so the session filter and a right-to-erasure
   * request months later resolve the same digest, and those algorithms are
   * salted per invocation. What defends the digest is the key - without
   * EncryptionSecret an attacker holding the column cannot test candidate
   * references at all, at any work factor.
   */
  public static buildUserKey(data: SessionReplayUserKeyInput): string {
    const projectKey: string = `${EncryptionSecret.toString()}:${data.projectId.toString()}`;

    return crypto
      .createHmac("sha256", projectKey)
      .update(data.userRef.trim())
      .digest("hex");
  }

  /*
   * The label as stored. Trimmed and capped to the same length the recorder
   * enforces, so the column can never hold something the wire could not have
   * carried.
   */
  public static buildUserLabel(userRef: string): string {
    return userRef.trim().slice(0, SESSION_REPLAY_MAX_USER_REF_LENGTH);
  }
}
