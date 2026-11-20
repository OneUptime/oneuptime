/*
 * HOW A HASH SCRUB RULE'S TOKEN IS WRITTEN, FOR THE CODE THAT READS ONE.
 *
 * A Hash rule leaves "[HASHED:", 16 lowercase hex characters and "]" in
 * place of a value: 25 characters, such as "[HASHED:3f9a1c0e7b2d4a68]"
 * (Server/Utils/Telemetry/ScrubHashToken.ts makes them, keyed per project,
 * #10394). Records stored before then hold the old form, 8 hex characters
 * ("[HASHED:8c87b489]"), until they reach their retention.
 *
 * Here, apart from the server code that makes a token, so the code that
 * only needs to know one when it reads one - Security Events naming an
 * address a scrub rule hid (#10397), the resolvers that keep a scrubbed
 * name from becoming a queue or a database host - can, in the browser too.
 */

export const SCRUB_HASH_TOKEN_PREFIX: string = "[HASHED:";
export const SCRUB_HASH_TOKEN_SUFFIX: string = "]";

// How much of the HMAC a token keeps: 16 hex characters, 64 bits.
export const SCRUB_HASH_TOKEN_HEX_LENGTH: number = 16;

// A token a Hash rule makes now: "[HASHED:" and 16 lowercase hex characters.
export const SCRUB_HASH_TOKEN_PATTERN: RegExp = /^\[HASHED:[0-9a-f]{16}\]$/;

// One made before tokens were keyed: 8 lowercase hex characters.
export const LEGACY_SCRUB_HASH_TOKEN_PATTERN: RegExp =
  /^\[HASHED:[0-9a-f]{8}\]$/;

/*
 * Whether a whole text is a token a Hash rule left: today's form or the one
 * made before it. A text a token is only part of ("from [HASHED:...]") is
 * not one.
 */
export function isScrubHashToken(text: string): boolean {
  return (
    SCRUB_HASH_TOKEN_PATTERN.test(text) ||
    LEGACY_SCRUB_HASH_TOKEN_PATTERN.test(text)
  );
}
