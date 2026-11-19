import crypto from "crypto";

/*
 * The code an authenticator app shows for a setup key, now: RFC 6238 with the
 * values OneUptime issues every enrolment with (Common/Server/Utils/TotpAuth:
 * SHA1, six digits, a 30 second step). A spec that sets up an authenticator
 * app reads the key from the page's "Can't scan the QR code?" panel and
 * enters this, as a person would enter what their app shows.
 */

const BASE32_ALPHABET: string = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// A setup key as base32 writes it (RFC 4648), read into its bytes.
export function base32ToBytes(setupKey: string): Buffer {
  const characters: string = setupKey.replace(/[\s=]/g, "").toUpperCase();
  const bytes: Array<number> = [];
  let bits: number = 0;
  let value: number = 0;

  for (const character of characters) {
    const index: number = BASE32_ALPHABET.indexOf(character);

    if (index < 0) {
      throw new Error(`"${character}" is not a base32 character.`);
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export function totpCode(setupKey: string, at: number = Date.now()): string {
  const counter: Buffer = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));

  const hmac: Buffer = crypto
    .createHmac("sha1", base32ToBytes(setupKey))
    .update(counter)
    .digest();
  const offset: number = hmac[hmac.length - 1]! & 0x0f;
  const binary: number =
    ((hmac[offset]! & 0x7f) << 24) |
    (hmac[offset + 1]! << 16) |
    (hmac[offset + 2]! << 8) |
    hmac[offset + 3]!;

  return String(binary % 1000000).padStart(6, "0");
}
