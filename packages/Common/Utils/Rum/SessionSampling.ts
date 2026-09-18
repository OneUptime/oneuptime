/*
 * Deterministic session sampling.
 *
 * The decision MUST be a pure function of the session id, computed
 * identically in the browser and at the ingest gate. A per-event or
 * per-chunk random draw (which is what the log drop-filter path does)
 * would shred a single session into an unplayable set of fragments —
 * some chunks kept, some dropped, no full snapshot where the player
 * needs one.
 *
 * This file must stay dependency-free: it is bundled into the browser
 * recorder as well as imported by the server.
 */

/*
 * FNV-1a, 32-bit. Chosen over a cryptographic hash because it is ~20
 * lines, has no platform dependency (no SubtleCrypto, no node:crypto),
 * is synchronous, and distributes hex session ids evenly. Sampling is
 * not a security boundary — see the note on tampering below.
 */
const FNV_OFFSET_BASIS_32: number = 0x811c9dc5;
const FNV_PRIME_32: number = 0x01000193;

/* Resolution of the sample percentage: two decimal places. */
const SAMPLING_BUCKETS: number = 10000;

export default class SessionSampling {
  /*
   * 32-bit FNV-1a hash of a string, returned as an unsigned integer.
   *
   * Math.imul is used for the multiply so the intermediate stays in
   * 32-bit integer space; a plain `*` would overflow into a float and
   * lose the low bits, which is the classic way this hash silently
   * stops distributing.
   */
  public static fnv1a32(value: string): number {
    let hash: number = FNV_OFFSET_BASIS_32;

    for (let i: number = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, FNV_PRIME_32);
    }

    /* Coerce to unsigned 32-bit. */
    return hash >>> 0;
  }

  /*
   * Which of the 10,000 sampling buckets a session falls into.
   * Stable for the lifetime of the session id.
   */
  public static getBucket(sessionId: string): number {
    return SessionSampling.fnv1a32(sessionId) % SAMPLING_BUCKETS;
  }

  /*
   * True when this session is inside the sample.
   *
   * samplePercentage is 0..100 and may carry two decimal places. 0 means
   * nothing is sampled; 100 means everything is. Values outside the range
   * are clamped rather than rejected, because a bad config value must not
   * be able to turn sampling into an exception on the ingest hot path.
   *
   * Note honestly: because the input is a client-generated id, a
   * determined client can regenerate ids until one passes. This function
   * protects against misconfiguration and gives stable, reproducible
   * decisions — it is not an anti-abuse control. The origin allowlist,
   * the rate limiter and the per-project byte budget are.
   */
  public static isSampled(
    sessionId: string,
    samplePercentage: number,
  ): boolean {
    const clamped: number = SessionSampling.clampPercentage(samplePercentage);

    if (clamped <= 0) {
      return false;
    }

    if (clamped >= 100) {
      return true;
    }

    /*
     * Rounded rather than truncated so a percentage like 33.335 maps to
     * the nearer bucket boundary instead of always downward.
     */
    const threshold: number = Math.round(clamped * (SAMPLING_BUCKETS / 100));

    return SessionSampling.getBucket(sessionId) < threshold;
  }

  public static clampPercentage(samplePercentage: number): number {
    if (!Number.isFinite(samplePercentage)) {
      return 0;
    }

    if (samplePercentage < 0) {
      return 0;
    }

    if (samplePercentage > 100) {
      return 100;
    }

    return samplePercentage;
  }
}
