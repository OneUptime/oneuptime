import crypto from "crypto";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  SCRUB_HASH_TOKEN_HEX_LENGTH,
  SCRUB_HASH_TOKEN_PREFIX,
  SCRUB_HASH_TOKEN_SUFFIX,
} from "../../../Types/Telemetry/ScrubHashTokenFormat";
import ScrubIpAddress from "../../../Utils/Telemetry/ScrubIpAddress";
import { EncryptionSecret } from "../../EnvironmentConfig";

/*
 * THE TOKEN A HASH SCRUB RULE LEAVES IN PLACE OF A VALUE (#10394).
 *
 * A Hash rule used to leave "[HASHED:" and the first 8 hex characters of an
 * unkeyed SHA-256 of the value. That had two faults:
 *
 *  - anyone who could read the telemetry could work it back to the value
 *    for the values people hash: there are about 4.3 billion IPv4
 *    addresses, a billion US Social Security numbers and ten billion North
 *    American phone numbers, and a laptop hashes every one in minutes. With
 *    no key, a value also hashed the same in every project and every
 *    install, which linked one person's records across all of them;
 *  - 8 hex characters are 32 bits, so among 65,536 values two share a hash
 *    about 40% of the time: equal hashes did not prove equal values.
 *
 * Now the token is an HMAC-SHA256 of the value under a key of the project's
 * own, cut to 16 hex characters (64 bits, so a project's values do not
 * collide):
 *
 *   project key = HMAC-SHA256(ENCRYPTION_SECRET, "<label>:<project id>")
 *   token       = "[HASHED:" + hex(HMAC-SHA256(project key, value))[0..16] + "]"
 *
 * No column, no migration: every install and every project hashes
 * differently, and no one without ENCRYPTION_SECRET can hash a guess to
 * compare. The same value still makes the same token within a project, so
 * people can see that forty errors came from one client, and search for it.
 * The "[HASHED:" prefix is kept, so a search for hashed values, and the
 * code that knows one when it reads one (Types/MessageQueue/
 * MessagingTelemetryResolver.ts, Types/DatabaseServer/DatabaseEndpoint.ts),
 * read the new tokens as they read the old.
 *
 * One function for every engine - logs, traces (spans, events and
 * exceptions) and session replays, through Server/Utils/Telemetry/
 * ScrubAction.ts - and for anything else that must name the token a rule
 * left: Security Events' address vault (#10395) finds an address by the
 * token ofIpAddress makes of it.
 *
 * The token is only as secret as ENCRYPTION_SECRET, and changes with it: a
 * value hashed before the secret changed has another token than one hashed
 * after. The key is never logged, returned or stored.
 *
 * How a token is written - for the code that only reads one - is
 * Types/Telemetry/ScrubHashTokenFormat.ts.
 */

/*
 * The label each project's key is derived under, so the key hashes nothing
 * else. Changing it changes every token, as changing the secret does.
 */
const PROJECT_KEY_DERIVATION_LABEL: string = "oneuptime-telemetry-scrub-hash";

/*
 * Each project's key, derived once: a Hash rule runs on every match in
 * every record of the project, and deriving the key per match more than
 * doubles the work (two HMACs instead of one). Bounded, oldest out first;
 * the key of a project read again after it fell out is derived again, the
 * same. Never logged or returned.
 */
const MAX_CACHED_PROJECT_KEYS: number = 10_000;

const projectKeys: Map<string, Buffer> = new Map<string, Buffer>();

// A project's id as its key is derived from it: one spelling of the UUID.
function projectIdText(projectId: ObjectID | string): string {
  const text: string = projectId.toString().trim().toLowerCase();

  if (!text) {
    throw new BadDataException("A scrub token is made for a project.");
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

export default class ScrubHashToken {
  /*
   * The token a Hash rule of `projectId` leaves in place of `value`:
   * "[HASHED:" and 16 hex characters. The same within the project every
   * time, another in every other project and install.
   */
  public static ofValue(data: {
    projectId: ObjectID | string;
    value: string;
  }): string {
    const hex: string = crypto
      .createHmac("sha256", projectKeyOf(data.projectId))
      .update(data.value, "utf8")
      .digest("hex")
      .slice(0, SCRUB_HASH_TOKEN_HEX_LENGTH);

    return `${SCRUB_HASH_TOKEN_PREFIX}${hex}${SCRUB_HASH_TOKEN_SUFFIX}`;
  }

  /*
   * The token an IP Address Hash rule leaves in place of an address: the
   * token of the address in one spelling for every way it is written
   * (ScrubIpAddress.canonicalize), so "::ffff:203.0.113.7" makes the token
   * "203.0.113.7" makes, and "2001:DB8::1" the one "2001:db8::1" makes.
   */
  public static ofIpAddress(data: {
    projectId: ObjectID | string;
    address: string;
  }): string {
    return ScrubHashToken.ofValue({
      projectId: data.projectId,
      value: ScrubIpAddress.canonicalize(data.address),
    });
  }
}
