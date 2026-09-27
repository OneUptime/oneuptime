import { createPublicKey, verify, KeyObject } from "crypto";

export default class DiscordInteractionSignature {
  public static verify(data: {
    publicKey: string;
    signature: string;
    timestamp: string;
    rawBody: Buffer;
    now?: number;
  }): boolean {
    const publicKeyPattern: RegExp = /^[a-f\d]{64}$/i;
    const signaturePattern: RegExp = /^[a-f\d]{128}$/i;
    const timestampPattern: RegExp = /^\d{1,12}$/;
    if (
      !publicKeyPattern.test(data.publicKey) ||
      !signaturePattern.test(data.signature) ||
      !timestampPattern.test(data.timestamp)
    ) {
      return false;
    }
    // A valid old signature must not become a reusable action credential.
    if (
      Math.abs((data.now ?? Date.now()) - Number(data.timestamp) * 1000) >
      300_000
    ) {
      return false;
    }
    try {
      const key: KeyObject = createPublicKey({
        key: Buffer.concat([
          Buffer.from("302a300506032b6570032100", "hex"),
          Buffer.from(data.publicKey, "hex"),
        ]),
        format: "der",
        type: "spki",
      });
      return verify(
        null,
        Buffer.concat([Buffer.from(data.timestamp), data.rawBody]),
        key,
        Buffer.from(data.signature, "hex"),
      );
    } catch {
      return false;
    }
  }
}
