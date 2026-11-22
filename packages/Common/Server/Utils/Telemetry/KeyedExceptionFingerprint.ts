import crypto from "crypto";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { EncryptionSecret } from "../../EnvironmentConfig";

/*
 * THE FINGERPRINT OF AN EXCEPTION A SCRUB RULE HID PART OF (#10434).
 *
 * An exception is grouped by a fingerprint of what it said as it arrived,
 * before the scrub rules, so a rule added later neither splits it into a new
 * exception nor sets off New Exception again (App's Telemetry/Utils/
 * Exception.ts, getOccurrenceFingerprints). Everyone who can read the
 * exception reads that fingerprint, beside the text the rules left. An
 * unkeyed SHA-256 of the text as it arrived would give away what a rule
 * hid: whoever reads "card [REDACTED] declined" and its fingerprint can hash
 * "card 4111-1111-1111-NNNN declined" for every guess - ten thousand for four
 * digits, a billion for a Social Security number, minutes on a laptop - and
 * see which one matches. The normalizer takes emails, IP addresses and long
 * numbers out of what is hashed, but not a card written in groups, a Social
 * Security or phone number, a name or a custom pattern's match.
 *
 * So a new exception whose text a rule changed is grouped under this one
 * instead: an HMAC-SHA256 of the text grouping v2 hashes (Exception
 * Grouping.getExceptionGroupingText), under a key of the project's own,
 * derived from the installation's ENCRYPTION_SECRET as a Hash rule's is
 * (ScrubHashToken, #10394):
 *
 *   project key = HMAC-SHA256(ENCRYPTION_SECRET, "<label>:<project id>")
 *   fingerprint = hex(HMAC-SHA256(project key, grouping v2 text))
 *
 * 64 lowercase hex characters, the shape of every other fingerprint. The
 * same exception has the same fingerprint every time, so its occurrences
 * still group, and no one without the secret can hash a guess to compare.
 *
 * It is only as secret as ENCRYPTION_SECRET, and changes with it: an
 * exception grouped under it before the secret changed is not found by the
 * occurrences after, which make an exception of their own - as an episode a
 * private record opened is not found (Rules/EpisodeGroupingKey.ts), and as
 * every Hash token changes. On an installation still running a secret that
 * ships in the repository it is no more secret than that. The key is never
 * logged, returned or stored.
 */

/*
 * The label each project's key is derived under, so the key hashes nothing
 * else - not a Hash rule's tokens, which have their own. Changing it changes
 * every keyed fingerprint, and so the group of every exception made under
 * one, as changing the secret does.
 */
const PROJECT_KEY_DERIVATION_LABEL: string = "oneuptime-exception-fingerprint";

/*
 * Each project's key, derived once: every exception occurrence asks for one.
 * Bounded, oldest out first; a key derived again is the same. Never logged
 * or returned.
 */
const MAX_CACHED_PROJECT_KEYS: number = 10_000;

const projectKeys: Map<string, Buffer> = new Map<string, Buffer>();

// A project's id as its key is derived from it: one spelling of the UUID.
function projectIdText(projectId: ObjectID | string): string {
  const text: string = projectId.toString().trim().toLowerCase();

  if (!text) {
    throw new BadDataException(
      "A keyed exception fingerprint is made for a project.",
    );
  }

  return text;
}

function projectKeyOf(projectId: ObjectID | string): Buffer {
  const id: string = projectIdText(projectId);
  const cached: Buffer | undefined = projectKeys.get(id);

  if (cached) {
    return cached;
  }

  const key: Buffer = crypto
    .createHmac("sha256", EncryptionSecret.toString())
    .update(`${PROJECT_KEY_DERIVATION_LABEL}:${id}`)
    .digest();

  if (projectKeys.size >= MAX_CACHED_PROJECT_KEYS) {
    const oldest: string | undefined = projectKeys.keys().next().value;

    if (oldest !== undefined) {
      projectKeys.delete(oldest);
    }
  }

  projectKeys.set(id, key);

  return key;
}

export default class KeyedExceptionFingerprint {
  /*
   * The keyed fingerprint of an exception's grouping text in `projectId`:
   * 64 lowercase hex characters, the same for the same text every time,
   * another in every other project and installation.
   */
  public static ofGroupingText(data: {
    projectId: ObjectID | string;
    text: string;
  }): string {
    return crypto
      .createHmac("sha256", projectKeyOf(data.projectId))
      .update(data.text, "utf8")
      .digest("hex");
  }
}
