/*
 * WHERE A DETECTION'S FINGERPRINT STANDS (#11130).
 *
 * The fingerprint of what a detection is about - the value a rule grouped
 * on, the indicator a feed matched (Server/Utils/SecurityEvent/
 * DetectionFingerprint) - is carried by three kinds of text, in places of
 * their own between ":":
 *
 *   - a source's fingerprint, which its alert, incident and case detection
 *     are deduped by:
 *       detection-rule:<rule id>:<fingerprint>
 *       threat-intel:<feed id>:<fingerprint>
 *   - a Detection Finding's eventUid, which its case detection points at:
 *       detection:<rule id>:detection-rule:<rule id>:<fingerprint>:run:<ms>:<ms | each>:<fingerprint>
 *       detection:<rule id>:detection-rule:<rule id>:<fingerprint>:<nanoseconds>
 *       threat-intel:<feed id>:threat-intel:<feed id>:<fingerprint>:<nanoseconds>
 *     (a scheduled run's firing names its finding; any other finding is
 *     named by when it was written);
 *   - a firing's name, which its case detection and the risk it added keep:
 *       run:<ms>:<ms | each>:<fingerprint>
 *
 * Here, pure: where the fingerprint is in each, counted from 1 as
 * ClickHouse counts, and the text with another in its place. An erasure
 * rewrites a person's in Postgres with these, and its ClickHouse statement
 * (SecurityUserErasureFindings) does to a finding's eventUid exactly what
 * rewriteFindingUid does. Anything else - an overflow's fingerprint, a
 * connected product's event id - has no place, and is left as it is.
 */

// The two sources whose fingerprints are of a value: a rule's group, a feed's indicator.
export enum DetectionFingerprintSource {
  DetectionRule = "detection-rule",
  ThreatIntel = "threat-intel",
}

// The separator between a fingerprinted text's places.
export const DETECTION_FINGERPRINT_TEXT_SEPARATOR: string = ":";

// A fingerprint, keyed or as it was before (#11130): 16 lowercase hex characters.
const FINGERPRINT: RegExp = /^[0-9a-f]{16}$/;

const DIGITS: RegExp = /^[0-9]+$/;

// The id a finding's eventUid starts with, for each source.
const FINDING_UID_HEAD: Record<DetectionFingerprintSource, string> = {
  [DetectionFingerprintSource.DetectionRule]: "detection",
  [DetectionFingerprintSource.ThreatIntel]: "threat-intel",
};

const FIRING_KEY_HEAD: string = "run";

// Where a text keeps the fingerprint, and whose fingerprint it is.
export interface DetectionFingerprintPlaces {
  source: DetectionFingerprintSource;
  // Counted from 1, as ClickHouse's arrays count.
  positions: Array<number>;
  // What stands there now (each place holds the same fingerprint).
  fingerprint: string;
}

function partsOf(text: string): Array<string> {
  return text.split(DETECTION_FINGERPRINT_TEXT_SEPARATOR);
}

function isFingerprint(part: string | undefined): boolean {
  return typeof part === "string" && FINGERPRINT.test(part);
}

function sourceOfName(name: string | undefined): DetectionFingerprintSource | null {
  return name === DetectionFingerprintSource.DetectionRule ||
    name === DetectionFingerprintSource.ThreatIntel
    ? name
    : null;
}

/*
 * Where a source's fingerprint ("detection-rule:<rule id>:<fingerprint>")
 * keeps the fingerprint of its value. Null for anything else: an
 * overflow's, an entity's risk, a connected product's.
 */
export function getSourceFingerprintPlaces(
  text: string | undefined | null,
): DetectionFingerprintPlaces | null {
  if (typeof text !== "string") {
    return null;
  }

  const parts: Array<string> = partsOf(text);
  const source: DetectionFingerprintSource | null = sourceOfName(parts[0]);

  if (!source || parts.length !== 3 || !parts[1] || !isFingerprint(parts[2])) {
    return null;
  }

  return { source, positions: [3], fingerprint: parts[2]! };
}

/*
 * Where a Detection Finding's eventUid keeps the fingerprint: its source's
 * fingerprint, and - for a scheduled run's firing - the firing's name.
 * Null for an id of any other shape.
 */
export function getFindingUidPlaces(
  eventUid: string | undefined | null,
): DetectionFingerprintPlaces | null {
  if (typeof eventUid !== "string") {
    return null;
  }

  const parts: Array<string> = partsOf(eventUid);
  const source: DetectionFingerprintSource | null = sourceOfName(parts[2]);

  if (
    !source ||
    parts[0] !== FINDING_UID_HEAD[source] ||
    !parts[1] ||
    parts[1] !== parts[3] ||
    !isFingerprint(parts[4])
  ) {
    return null;
  }

  // Named by when it was written.
  if (parts.length === 6 && DIGITS.test(parts[5]!)) {
    return { source, positions: [5], fingerprint: parts[4]! };
  }

  // A scheduled run's firing: its name carries the same fingerprint.
  if (
    source === DetectionFingerprintSource.DetectionRule &&
    parts.length === 9 &&
    parts[5] === FIRING_KEY_HEAD &&
    DIGITS.test(parts[6]!) &&
    (parts[7] === "each" || DIGITS.test(parts[7]!)) &&
    parts[8] === parts[4]
  ) {
    return { source, positions: [5, 9], fingerprint: parts[4]! };
  }

  return null;
}

/*
 * Where a firing's name ("run:<ms>:<ms | each>:<fingerprint>") keeps the
 * fingerprint of its group. Null for an overflow's firing, and anything
 * else. A firing is always a detection rule's.
 */
export function getFiringKeyPlaces(
  firingKey: string | undefined | null,
): DetectionFingerprintPlaces | null {
  if (typeof firingKey !== "string") {
    return null;
  }

  const parts: Array<string> = partsOf(firingKey);

  if (
    parts.length !== 4 ||
    parts[0] !== FIRING_KEY_HEAD ||
    !DIGITS.test(parts[1]!) ||
    !(parts[2] === "each" || DIGITS.test(parts[2]!)) ||
    !isFingerprint(parts[3])
  ) {
    return null;
  }

  return {
    source: DetectionFingerprintSource.DetectionRule,
    positions: [4],
    fingerprint: parts[3]!,
  };
}

// The text with `fingerprint` at `places`: the rest of it as it was.
export function putFingerprintAt(data: {
  text: string;
  places: DetectionFingerprintPlaces;
  fingerprint: string;
}): string {
  return partsOf(data.text)
    .map((part: string, index: number): string => {
      return data.places.positions.includes(index + 1)
        ? data.fingerprint
        : part;
    })
    .join(DETECTION_FINGERPRINT_TEXT_SEPARATOR);
}

/*
 * A text with `fingerprint` in the place it keeps one, using `placesOf`
 * to find it; the text as it was when it has none.
 */
export function rewriteFingerprintIn(data: {
  text: string;
  placesOf: (text: string) => DetectionFingerprintPlaces | null;
  fingerprint: string;
}): string {
  const places: DetectionFingerprintPlaces | null = data.placesOf(data.text);

  return places
    ? putFingerprintAt({
        text: data.text,
        places,
        fingerprint: data.fingerprint,
      })
    : data.text;
}
