/*
 * TEXT A REGULAR EXPRESSION MATCHES AS IT IS WRITTEN.
 *
 * Code that builds a pattern out of text - a secret to redact, a variable's
 * name in a template, a value a person typed - escapes the text first, so
 * that every character in it means itself. Escaping only some of them (the
 * dots, say) leaves the rest read as syntax: a "\" in the text escapes
 * whatever follows it, a "(" or a "[" breaks the pattern, and a "*" repeats
 * the character before it.
 *
 * This escapes every character a pattern reads as syntax outside a character
 * class, and nothing else:
 *
 *   \ ^ $ . * + ? ( ) [ ] { } |
 *
 * Each of them may be escaped with or without the u flag (the u flag refuses
 * an escaped letter, digit or "-"), so the result means the same text either
 * way. Place it outside a character class.
 *
 * One replace over the text: time linear in its length.
 */

const REGEXP_SYNTAX_CHARACTER_PATTERN: RegExp = /[\\^$.*+?()[\]{}|]/g;

export type EscapeRegExpFunction = (text: string) => string;

export const escapeRegExp: EscapeRegExpFunction = (text: string): string => {
  return String(text).replace(REGEXP_SYNTAX_CHARACTER_PATTERN, "\\$&");
};

export default escapeRegExp;
