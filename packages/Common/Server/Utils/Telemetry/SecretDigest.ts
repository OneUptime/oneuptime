import { createHash, timingSafeEqual } from "crypto";

/*
 * A DIGEST OF A UUID SECRET, FOR WHAT HAS TO REMEMBER WHICH SECRET IT WAS
 * GIVEN, OR WHAT A SECRET IS, WITHOUT KEEPING THE SECRET.
 *
 * A telemetry sender proves it holds a secret once - an MQTT session at
 * CONNECT, which then publishes for days or weeks - and a cache in front of
 * Postgres keeps what each secret opens. Keeping the secret itself in either
 * would leave every live credential in the heap, where a heap snapshot, a
 * core file or a debugger reads it. So they keep this digest instead: an
 * ingestion key's (TelemetryIngestionKeySecretDigest, issue #8147) and an IoT
 * device credential's (IoTDeviceCredentialService, issue #8371).
 *
 * The secret is a UUID, so it is normalised first: Postgres compares uuid
 * values without regard to case, and a secret presented in capitals must
 * match the one stored, as it does in the database.
 */
export default class SecretDigest {
  public static of(secret: string): string {
    return createHash("sha256")
      .update(secret.trim().toLowerCase())
      .digest("hex");
  }

  // Whether two digests are the same, in constant time.
  public static matches(digest: string, otherDigest: string): boolean {
    const digestBuffer: Buffer = Buffer.from(digest, "utf8");
    const otherDigestBuffer: Buffer = Buffer.from(otherDigest, "utf8");

    if (digestBuffer.length !== otherDigestBuffer.length) {
      return false;
    }

    return timingSafeEqual(
      digestBuffer as unknown as NodeJS.ArrayBufferView,
      otherDigestBuffer as unknown as NodeJS.ArrayBufferView,
    );
  }
}
