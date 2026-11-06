import crypto from "crypto";
import {
  CLOUD_AI_AGENT_KEY_SECRET_LENGTH,
  CloudAiAgentKeyMatch,
  buildCloudAiAgentKey,
} from "../../../Types/CloudConnection/CloudAiAgentKey";
import ObjectID from "../../../Types/ObjectID";

/*
 * A Cloud AI agent's key (Types/CloudConnection/CloudAiAgentKey): made here,
 * shown once, and kept only as its SHA-256 (CloudAccount.aiAgentKeys).
 * Comparing a presented key with the stored hashes is timing-safe, compares
 * every one of them whichever matches, and answers null - never a throw -
 * for anything that is not a key and a SHA-256.
 */
export default class CloudAiAgentKeyHashing {
  public static hash(key: string): string {
    return crypto.createHash("sha256").update(key, "utf8").digest("hex");
  }

  // A new key for the account, and the hash that is kept of it.
  public static generate(cloudAccountId: ObjectID): {
    key: string;
    hash: string;
  } {
    const key: string = buildCloudAiAgentKey({
      cloudAccountId: cloudAccountId.toString(),
      secret: crypto
        .randomBytes(CLOUD_AI_AGENT_KEY_SECRET_LENGTH / 2)
        .toString("hex"),
    });

    return { key, hash: CloudAiAgentKeyHashing.hash(key) };
  }

  /*
   * Which of the hashes the key is, or null. Every hash is compared, so the
   * time taken says nothing of which one matched, or whether one did.
   */
  public static findMatch(
    key: unknown,
    hashes: Array<{ hash: string; match: CloudAiAgentKeyMatch }>,
  ): { hash: string; match: CloudAiAgentKeyMatch } | null {
    if (typeof key !== "string" || key.length === 0) {
      return null;
    }

    const presented: Buffer = Buffer.from(
      CloudAiAgentKeyHashing.hash(key.trim()),
      "hex",
    );
    let matched: { hash: string; match: CloudAiAgentKeyMatch } | null = null;

    for (const entry of hashes) {
      if (typeof entry.hash !== "string" || entry.hash.length !== 64) {
        continue;
      }

      const stored: Buffer = Buffer.from(entry.hash, "hex");

      if (
        stored.length === presented.length &&
        crypto.timingSafeEqual(stored, presented) &&
        !matched
      ) {
        matched = entry;
      }
    }

    return matched;
  }
}
