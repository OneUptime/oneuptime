import crypto from "crypto";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";
import OldestKeyMap from "../../../Utils/OldestKeyMap";
import { EncryptionSecret } from "../../EnvironmentConfig";

/*
 * THE FINGERPRINT OF WHAT A DETECTION IS ABOUT (#11130).
 *
 * A detection rule names each of its groups by the value it grouped on, and
 * a threat intel feed each of its matches by the indicator's value: the
 * alert or incident a group opens is deduped by
 * "detection-rule:<rule id>:<fingerprint>" (or "threat-intel:<feed id>:..."),
 * the case detection it repeats by the same, and its Detection Finding's
 * eventUid and its firing's name (Types/SecurityCase/SecurityFiringKeys)
 * carry the fingerprint too.
 *
 * The fingerprint used to be the first 16 hex characters of an UNKEYED
 * SHA-256 of "groupValue=<value>" (MetricSeriesFingerprint). For a rule
 * grouped on a user, the value is the user's name as the user vault named
 * them - an email address, a user id - which is easy to guess. So after an
 * erasure had put the token back everywhere the finding said the name,
 * anybody who could read the finding's id or the alert's fingerprint could
 * confirm a guessed email address by hashing it.
 *
 * Now it is keyed, the way a Hash scrub rule's token is
 * (Server/Utils/Telemetry/ScrubHashToken), with a key of the project's own
 * that is derived for this alone:
 *
 *   project key = HMAC-SHA256(ENCRYPTION_SECRET, "<label>:<project id>")
 *   fingerprint = hex(HMAC-SHA256(project key, "groupValue=<value>"))[0..16]
 *
 * (or "indicatorValue=<value>" for a feed), never sixteen digits, as a
 * token never is. No one without ENCRYPTION_SECRET can make one from a
 * guess, every project fingerprints the same value differently, and the
 * same value still makes the same fingerprint in its project, so a rule
 * still opens one alert for each group.
 *
 * The key is not the Hash rule's: a log that happened to hold
 * "groupValue=<value>" would otherwise be hashed by a Hash rule into the very
 * fingerprint of <value>.
 *
 * THE FORM BEFORE IT (legacyOf) is kept as an alias, never written again:
 * what OneUptime opened before the change - an open alert, a case
 * detection, a firing it took - carries it, and every lookup that dedupes by
 * a fingerprint matches it as well, so nothing splits or fires twice
 * across the change. A person's erasure rewrites the ones about them
 * (Server/Utils/SecurityEvent/UserVault).
 *
 * A group of nothing - a rule that does not group - keeps the fingerprint it
 * always had: the value is no one's, and its alerts and cases stay as they
 * are.
 */

export enum DetectionFingerprintKind {
  // What a detection rule grouped on: "detection-rule:<rule id>:<fingerprint>".
  DetectionRule = "detection-rule",
  // The indicator a threat intel feed matched: "threat-intel:<feed id>:<fingerprint>".
  ThreatIntel = "threat-intel",
}

export const DETECTION_FINGERPRINT_KINDS: ReadonlyArray<DetectionFingerprintKind> =
  Object.values(DetectionFingerprintKind);

/*
 * The label the value is fingerprinted under, as MetricSeriesFingerprint's
 * canonical text names it ("groupValue=<value>"): the legacy fingerprint is
 * of exactly this text, and the keyed one is of it too.
 */
const LABEL_OF_KIND: Record<DetectionFingerprintKind, string> = {
  [DetectionFingerprintKind.DetectionRule]: "groupValue",
  [DetectionFingerprintKind.ThreatIntel]: "indicatorValue",
};

/*
 * The label each project's key is derived under, so the key fingerprints
 * nothing else. Changing it changes every fingerprint, and splits every open
 * alert from its next firing: never change it.
 */
const PROJECT_KEY_DERIVATION_LABEL: string =
  "oneuptime-security-detection-fingerprint";

// The fingerprint's length in hex characters: the legacy one's, 64 bits.
export const DETECTION_FINGERPRINT_HEX_LENGTH: number = 16;

// A fingerprint, keyed or legacy: 16 lowercase hex characters.
export const DETECTION_FINGERPRINT_PATTERN: RegExp = /^[0-9a-f]{16}$/;

// Each project's key, derived once and bounded, oldest out first (as ScrubHashToken's).
const MAX_CACHED_PROJECT_KEYS: number = 10_000;

const projectKeys: OldestKeyMap<string, Buffer> = new OldestKeyMap<
  string,
  Buffer
>();

function projectIdText(projectId: ObjectID | string): string {
  const text: string = projectId.toString().trim().toLowerCase();

  if (!text) {
    throw new BadDataException("A detection's fingerprint is made for a project.");
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
    const oldest: string | undefined = projectKeys.oldestKey();

    if (oldest !== undefined) {
      projectKeys.delete(oldest);
    }
  }

  projectKeys.set(id, key);

  return key;
}

const ALL_DIGITS: RegExp = /^[0-9]+$/;

/*
 * The first run of 16 hex characters with a letter among them, as a scrub
 * token keeps (ScrubHashToken): sixteen digits are a card number's shape,
 * which Data Security's scan could take for a card in the stored event.
 */
function fingerprintHexOf(digestHex: string): string {
  for (
    let offset: number = 0;
    offset + DETECTION_FINGERPRINT_HEX_LENGTH <= digestHex.length;
    offset += DETECTION_FINGERPRINT_HEX_LENGTH
  ) {
    const hex: string = digestHex.slice(
      offset,
      offset + DETECTION_FINGERPRINT_HEX_LENGTH,
    );

    if (!ALL_DIGITS.test(hex)) {
      return hex;
    }
  }

  return "f" + digestHex.slice(1, DETECTION_FINGERPRINT_HEX_LENGTH);
}

// A fingerprint and the ones the same group had before (#11130): what a lookup matches.
export interface DetectionFingerprints {
  fingerprint: string;
  // Never written again; matched so what was opened before still dedupes.
  formerFingerprints: Array<string>;
}

export default class DetectionFingerprint {
  /*
   * The fingerprint of `value` in its project: keyed, or - for no value -
   * the one a group of nothing always had.
   */
  public static of(data: {
    projectId: ObjectID | string;
    kind: DetectionFingerprintKind;
    value: string | undefined | null;
  }): string {
    const value: string = data.value || "";

    if (!value) {
      return this.legacyOf({ kind: data.kind, value });
    }

    return fingerprintHexOf(
      crypto
        .createHmac("sha256", projectKeyOf(data.projectId))
        .update(`${LABEL_OF_KIND[data.kind]}=${value}`, "utf8")
        .digest("hex"),
    );
  }

  /*
   * The unkeyed fingerprint OneUptime made before #11130, exactly as
   * MetricSeriesFingerprint made it: matched as an alias, never written.
   */
  public static legacyOf(data: {
    kind: DetectionFingerprintKind;
    value: string | undefined | null;
  }): string {
    return MetricSeriesFingerprint.computeFingerprint({
      [LABEL_OF_KIND[data.kind]]: data.value || "",
    });
  }

  /*
   * Every fingerprint `value` has had in its project, the current one first:
   * keyed, then legacy. One for no value, which never changed.
   */
  public static allOf(data: {
    projectId: ObjectID | string;
    kind: DetectionFingerprintKind;
    value: string | undefined | null;
  }): Array<string> {
    return Array.from(
      new Set<string>([this.of(data), this.legacyOf(data)]),
    );
  }

  /*
   * "<kind>:<source id>:<fingerprint>", with the one the same group had
   * before: a rule's group, or a feed's indicator.
   */
  public static ofSource(data: {
    projectId: ObjectID | string;
    kind: DetectionFingerprintKind;
    sourceId: ObjectID | string;
    value: string | undefined | null;
  }): DetectionFingerprints {
    const prefix: string = `${data.kind}:${data.sourceId.toString()}:`;
    const [current, ...former] = this.allOf(data);

    return {
      fingerprint: `${prefix}${current}`,
      formerFingerprints: former.map((fingerprint: string): string => {
        return `${prefix}${fingerprint}`;
      }),
    };
  }
}
