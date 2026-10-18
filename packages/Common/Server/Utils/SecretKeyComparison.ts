import crypto from "crypto";

/*
 * Constant-time equality for secret strings that OneUptime's own components
 * present to prove who they are (a probe's registration key, and the like).
 *
 * A plain `===` on a secret leaks, through how long it takes to fail, how many
 * leading characters a guess got right, so a caller can recover the secret one
 * character at a time. Hashing both sides to a fixed-width digest first means
 * timingSafeEqual always compares equal-length buffers (it throws on a length
 * mismatch) and the comparison time never depends on the secret. The same
 * shape SlackAuthorization and ClusterKeyAuthorization already use.
 */
export default class SecretKeyComparison {
  public static timingSafeEqual(presented: string, expected: string): boolean {
    if (typeof presented !== "string" || typeof expected !== "string") {
      return false;
    }

    return crypto.timingSafeEqual(
      crypto.createHash("sha256").update(presented, "utf8").digest(),
      crypto.createHash("sha256").update(expected, "utf8").digest(),
    );
  }
}
