import crypto from "crypto";
import {
  CLOUD_STREAM_KEY_SECRET_LENGTH,
  buildCloudStreamKey,
} from "../../../Types/CloudConnection/CloudStream";
import ObjectID from "../../../Types/ObjectID";

/*
 * A connection's stream key: made here, shown once, and kept only as its
 * SHA-256 (CloudConnection.streamKeyHashes). Comparing a key Firehose sent
 * with the stored hashes is timing-safe, and answers false - never a throw
 * - for anything that is not a key and a SHA-256.
 */
export default class CloudStreamKeys {
  public static hash(key: string): string {
    return crypto.createHash("sha256").update(key, "utf8").digest("hex");
  }

  // A new key for the connection, and the hash that is stored of it.
  public static generate(connectionId: ObjectID): {
    key: string;
    hash: string;
  } {
    const key: string = buildCloudStreamKey({
      connectionId: connectionId.toString(),
      secret: crypto
        .randomBytes(CLOUD_STREAM_KEY_SECRET_LENGTH / 2)
        .toString("hex"),
    });

    return { key, hash: CloudStreamKeys.hash(key) };
  }

  public static matchesAny(key: unknown, hashes: Array<string>): boolean {
    if (typeof key !== "string" || key.length === 0) {
      return false;
    }

    const presented: Buffer = Buffer.from(CloudStreamKeys.hash(key), "hex");
    let matched: boolean = false;

    // Every hash is compared, so the time taken says nothing of which matched.
    for (const hash of hashes) {
      if (typeof hash !== "string" || hash.length !== 64) {
        continue;
      }

      const stored: Buffer = Buffer.from(hash, "hex");

      if (
        stored.length === presented.length &&
        crypto.timingSafeEqual(stored, presented)
      ) {
        matched = true;
      }
    }

    return matched;
  }
}
