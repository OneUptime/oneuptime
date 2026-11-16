/*
 * HOW A SCRUB RULE MASKS A VALUE IT HAS NO SHAPE FOR.
 *
 * A custom pattern's match, or a secret under a key a Sensitive Attribute
 * Keys rule names, set to Mask: its first and last characters are kept and
 * the rest becomes stars - at least three, so a short value does not show
 * how long it is. A value of two characters or fewer is all stars.
 *
 * A character is kept whole. An emoji, and every character past the Basic
 * Multilingual Plane, is two code units - a surrogate pair - and keeping
 * one of them, as the first and last code units used to be kept, left half
 * a character that no text can hold: UTF-8, which the telemetry tables
 * store, cannot write it, and a JSON body it was written into no longer
 * read the same (ScrubJsonText.ts).
 *
 * Shared by the log, trace and session replay scrubbers
 * (App/FeatureSet/Telemetry/Services), so the three mask alike.
 */

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

// The text's first character, a surrogate pair whole.
function firstCharacter(text: string): string {
  return text.length > 1 &&
    isHighSurrogate(text.charCodeAt(0)) &&
    isLowSurrogate(text.charCodeAt(1))
    ? text.slice(0, 2)
    : text.slice(0, 1);
}

// The text's last character, a surrogate pair whole.
function lastCharacter(text: string): string {
  return text.length > 1 &&
    isLowSurrogate(text.charCodeAt(text.length - 1)) &&
    isHighSurrogate(text.charCodeAt(text.length - 2))
    ? text.slice(-2)
    : text.slice(-1);
}

export function maskKeepingEnds(value: string): string {
  const first: string = firstCharacter(value);
  const last: string = lastCharacter(value);

  // Two characters or fewer: keeping both ends would keep all of it.
  if (first.length + last.length >= value.length) {
    return "***";
  }

  return (
    first +
    "*".repeat(Math.max(value.length - first.length - last.length, 3)) +
    last
  );
}
