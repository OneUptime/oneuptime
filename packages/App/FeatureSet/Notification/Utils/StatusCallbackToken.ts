import crypto from "crypto";

/*
 * Whether a provider's status callback carries the token its URL was given
 * - an SMS's delivery status (API/SMS.ts), a call's outcome (API/Call.ts).
 * Those callbacks are public webhooks: the provider signs in as nobody, so
 * the unguessable per-message token in the URL is all that says the
 * request is the provider's. Compared in constant time.
 */
export function isStatusCallbackTokenValid(
  provided: string,
  expected: string,
): boolean {
  const providedBuffer: Buffer = Buffer.from(provided);
  const expectedBuffer: Buffer = Buffer.from(expected);

  // timingSafeEqual throws on length mismatch, so guard first.
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    providedBuffer as Uint8Array,
    expectedBuffer as Uint8Array,
  );
}
