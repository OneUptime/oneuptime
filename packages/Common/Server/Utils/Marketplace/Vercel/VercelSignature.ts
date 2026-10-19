import crypto from "crypto";

/*
 * Vercel signs what it delivers - webhooks, and the log drains of a native
 * integration - with an x-vercel-signature header: the HMAC-SHA1 of the raw
 * request body, in lowercase hex, keyed with the integration's client
 * secret (https://vercel.com/docs/webhooks/webhooks-api#securing-webhooks,
 * https://vercel.com/docs/drains/security).
 *
 * The signature is over the bytes as sent, so it is checked before the body
 * is parsed - a parser and a re-serialization would not give the same bytes
 * back - and compared in constant time.
 */

export const VERCEL_SIGNATURE_HEADER: string = "x-vercel-signature";

const SHA1_HEX_PATTERN: RegExp = /^[0-9a-f]{40}$/i;

export default class VercelSignature {
  public static sign(body: Buffer | string, secret: string): string {
    return crypto
      .createHmac("sha1", secret)
      .update(typeof body === "string" ? Buffer.from(body, "utf8") : body)
      .digest("hex");
  }

  public static isValid(data: {
    body: Buffer | string;
    signature: unknown;
    secret: string | null | undefined;
  }): boolean {
    if (
      !data.secret ||
      typeof data.signature !== "string" ||
      !SHA1_HEX_PATTERN.test(data.signature.trim())
    ) {
      return false;
    }

    const expected: Buffer = Buffer.from(
      VercelSignature.sign(data.body, data.secret),
      "hex",
    );
    const received: Buffer = Buffer.from(data.signature.trim(), "hex");

    return (
      expected.length === received.length &&
      crypto.timingSafeEqual(expected, received)
    );
  }
}
