import crypto from "crypto";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";

/*
 * COPIES OF ONE STORE'S DATA IN ANOTHER, FOUND WITHOUT KEEPING THE DATA.
 *
 * A customer table copied into an analytics bucket, an export left in a
 * shared drive: the copy holds the same values as the original. To see
 * that without keeping either side's values, every scan sketches the
 * values it found of each data type as a b-bit MinHash: 128 slots, each the
 * smallest of one hash function over the set's values, of which only the
 * low 16 bits are kept. Two sketches agree on a slot about as often as the
 * two sets overlap (their Jaccard similarity), so comparing sketches
 * estimates how much of one set is in the other.
 *
 * The values are hashed with HMAC-SHA256 under a key of the project's own
 * (ContentScanOptions.fingerprintKey), so a sketch says nothing to anyone
 * without the key - a known value cannot be tested against it - and two
 * projects' sketches can never be compared. 16 bits of a minimum is all
 * that leaves the scan: no value, and no hash of one, can be read back.
 */

export const FINGERPRINT_SLOTS: number = 128;

// How many bits of each slot's minimum are kept.
export const FINGERPRINT_BITS: number = 16;

const SLOT_MASK: number = 0xffff;

// The chance two different values' minima agree on 16 bits anyway: 2^-16.
const CHANCE_AGREEMENT: number = 1 / 65536;

// The most data types one accumulator sketches.
export const MAX_FINGERPRINTED_DATA_TYPES: number = 100;

// The most characters of one value hashed: a value is never a document.
const MAX_FINGERPRINTED_VALUE_LENGTH: number = 4096;

const NO_MINIMUM: number = 0xffffffff;

/*
 * Two seeds per slot, fixed: derived from the slot's number, so every
 * scanner of every release sketches with the same 128 hash functions and
 * their sketches compare.
 */
function makeSlotSeeds(): { first: Uint32Array; second: Uint32Array } {
  const first: Uint32Array = new Uint32Array(FINGERPRINT_SLOTS);
  const second: Uint32Array = new Uint32Array(FINGERPRINT_SLOTS);

  for (let slot: number = 0; slot < FINGERPRINT_SLOTS; slot++) {
    const digest: Buffer = crypto
      .createHash("sha256")
      .update(`oneuptime-data-security-fingerprint-slot-${slot}`)
      .digest();

    first[slot] = digest.readUInt32LE(0);
    second[slot] = digest.readUInt32LE(4);
  }

  return { first, second };
}

const SLOT_SEEDS: { first: Uint32Array; second: Uint32Array } = makeSlotSeeds();

// MurmurHash3's finalizer: a bijection of 32-bit words that mixes every bit.
function mix32(value: number): number {
  let mixed: number = value >>> 0;

  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x85ebca6b);
  mixed ^= mixed >>> 13;
  mixed = Math.imul(mixed, 0xc2b2ae35);
  mixed ^= mixed >>> 16;

  return mixed >>> 0;
}

/*
 * The form a value is sketched in, so the same value read from a CSV and
 * from a database column agrees: the detector's normalized form, trimmed
 * and lower-cased.
 */
export function normalizeFingerprintValue(value: string): string {
  return value.slice(0, MAX_FINGERPRINTED_VALUE_LENGTH).trim().toLowerCase();
}

/*
 * A project's fingerprint key, from a secret only the server holds: the
 * same for every scan of the project, different for every project.
 */
export function deriveFingerprintKey(secret: string, scope: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`oneuptime-data-security-fingerprint:${scope}`)
    .digest("hex");
}

// Lowers each slot's minimum with one value.
function addToSketch(sketch: Uint32Array, key: string, value: string): void {
  const digest: Buffer = crypto
    .createHmac("sha256", key)
    .update(normalizeFingerprintValue(value))
    .digest();
  const low: number = digest.readUInt32LE(0);
  const high: number = digest.readUInt32LE(4);

  for (let slot: number = 0; slot < FINGERPRINT_SLOTS; slot++) {
    const hash: number = mix32(
      ((low ^ SLOT_SEEDS.first[slot]!) +
        Math.imul(high ^ SLOT_SEEDS.second[slot]!, 0x9e3779b1)) >>>
        0,
    );

    if (hash < sketch[slot]!) {
      sketch[slot] = hash;
    }
  }
}

function newSketch(): Uint32Array {
  return new Uint32Array(FINGERPRINT_SLOTS).fill(NO_MINIMUM);
}

// The kept bits of a sketch: what a fingerprint is.
function toFingerprint(sketch: Uint32Array): Array<number> {
  const fingerprint: Array<number> = [];

  for (let slot: number = 0; slot < FINGERPRINT_SLOTS; slot++) {
    fingerprint.push(sketch[slot]! & SLOT_MASK);
  }

  return fingerprint;
}

/*
 * The fingerprint of a set of values: 128 numbers of 16 bits, or nothing
 * for no values (or no key: a fingerprint without the project's key could
 * be compared with anyone's).
 */
export function buildFingerprint(
  values: Iterable<string>,
  key: string,
): Array<number> {
  if (!key) {
    return [];
  }

  const sketch: Uint32Array = newSketch();
  let added: number = 0;

  for (const value of values) {
    if (typeof value !== "string" || value.trim().length === 0) {
      continue;
    }

    addToSketch(sketch, key, value);
    added++;
  }

  return added > 0 ? toFingerprint(sketch) : [];
}

export function isFingerprint(value: unknown): value is Array<number> {
  return (
    Array.isArray(value) &&
    value.length === FINGERPRINT_SLOTS &&
    value.every((slot: unknown) => {
      return (
        typeof slot === "number" &&
        Number.isInteger(slot) &&
        slot >= 0 &&
        slot <= SLOT_MASK
      );
    })
  );
}

/*
 * How much two sets overlap, from their fingerprints: 0 for nothing in
 * common, 1 for the same set. The share of agreeing slots, less the share
 * that agree by chance on 16 bits (b-bit MinHash, Li and König 2010), so
 * two unrelated sets read 0 rather than 2^-16.
 */
export function estimateOverlap(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  if (
    a.length === 0 ||
    a.length !== FINGERPRINT_SLOTS ||
    b.length !== FINGERPRINT_SLOTS
  ) {
    return 0;
  }

  let agreeing: number = 0;

  for (let slot: number = 0; slot < FINGERPRINT_SLOTS; slot++) {
    if ((a[slot]! & SLOT_MASK) === (b[slot]! & SLOT_MASK)) {
      agreeing++;
    }
  }

  const share: number = agreeing / FINGERPRINT_SLOTS;
  const estimate: number = (share - CHANCE_AGREEMENT) / (1 - CHANCE_AGREEMENT);

  return Math.min(1, Math.max(0, estimate));
}

/*
 * The fingerprints of one scan, built as it finds values: one sketch per
 * data type, fed only High-confidence matches that are not test values -
 * a Low match is as likely to be something else, and would make two
 * unrelated stores look alike. Only the sketches are kept; each value is
 * hashed into them and dropped.
 */
export class FingerprintAccumulator {
  private readonly key: string;
  private readonly sketches: Map<string, Uint32Array> = new Map();

  public constructor(key: string) {
    this.key = key;
  }

  public add(
    dataTypeId: string,
    value: string,
    confidence: DataConfidence = DataConfidence.High,
  ): void {
    if (
      !this.key ||
      confidence !== DataConfidence.High ||
      typeof value !== "string" ||
      value.trim().length === 0
    ) {
      return;
    }

    let sketch: Uint32Array | undefined = this.sketches.get(dataTypeId);

    if (!sketch) {
      if (this.sketches.size >= MAX_FINGERPRINTED_DATA_TYPES) {
        return;
      }

      sketch = newSketch();
      this.sketches.set(dataTypeId, sketch);
    }

    addToSketch(sketch, this.key, value);
  }

  // A scanner's match: kept when it is High and not a test value.
  public addMatch(match: {
    dataTypeId: string;
    normalized: string;
    confidence: DataConfidence;
    isTestValue: boolean;
  }): void {
    if (match.isTestValue) {
      return;
    }

    this.add(match.dataTypeId, match.normalized, match.confidence);
  }

  public get dataTypeCount(): number {
    return this.sketches.size;
  }

  public getFingerprints(): Record<string, Array<number>> {
    const fingerprints: Record<string, Array<number>> = {};

    for (const [dataTypeId, sketch] of this.sketches) {
      fingerprints[dataTypeId] = toFingerprint(sketch);
    }

    return fingerprints;
  }

  public toJSON(): Record<string, Array<number>> {
    return this.getFingerprints();
  }
}
