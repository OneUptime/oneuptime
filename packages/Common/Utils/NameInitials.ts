/*
 * The letters an avatar draws for a name it has no picture for: the first
 * letter of the name's first word and of its last ("Ada Byron Lovelace" is
 * AL), or the first letter of a name of one word ("Platform" is P), in
 * capitals.
 *
 * A word is a run of letters, marks and digits, so a bracket, a dash, a
 * dot, a symbol or an emoji never becomes an initial - a team named
 * "Security Operations Center (EMEA)" was "S(" - and a name with no letter
 * or digit in it at all is "?". What a name says in brackets is left out
 * while the rest has a word: a region after a team's name, or someone's
 * pronouns after theirs, is not part of who they are - that team is SC,
 * "Maya Chen (she/her)" is MC. A name that is all brackets, "(EMEA)", is
 * read as it is.
 *
 * An address (no space in it, an @ after its first character) is read by
 * the part before its @, so someone known only by their email,
 * jane.doe@acme-commerce.example, is JD - not the J of an address read as
 * one word.
 *
 * Each initial is one whole letter: a word starts with a letter or a digit,
 * never with a mark that only changes the letter before it, and an accent
 * typed as a letter and a mark is joined to its letter first (Unicode NFC),
 * so a name in any script - Ünal Öz, Devanagari, Arabic, Chinese - comes
 * out as two letters a font can draw, as many characters as a Latin name's.
 * Persian and the Indic scripts join a word's parts with a zero-width
 * non-joiner or joiner, which keeps them one word here too.
 *
 * React-free, so every frontend, the server and the tests read it.
 */

// What a name with no letter or digit in it is drawn as.
export const NAME_INITIALS_FALLBACK: string = "?";

/*
 * One word: a letter or a digit, then any letters, marks, digits, the
 * zero-width non-joiner and joiner, and apostrophes - straight or curly -
 * so O'Brien is one word: "Conan O'Brien" is CO, never the CB of a surname
 * read from its "Brien". One repeat of one class after a start that class
 * also holds, so a match takes time in line with the name.
 */
const NAME_WORD_REGEX: RegExp =
  /[\p{L}\p{N}][\p{L}\p{M}\p{N}\u{200C}\u{200D}'\u{2019}]*/gu;

/*
 * What a name says in brackets - round, square or curly, in the Latin or
 * the full-width forms: an opening bracket, anything but a bracket, and a
 * closing one. The repeat holds no bracket at all, so it can never run on
 * past the next bracket and a match takes time in line with the name. A
 * bracket inside a bracket is not taken apart: its letters are words like
 * any others.
 */
const NAME_BRACKETED_REGEX: RegExp =
  /[([{\u{FF08}\u{FF3B}\u{FF5B}\u{3010}][^()[\]{}\u{FF08}\u{FF09}\u{FF3B}\u{FF3D}\u{FF5B}\u{FF5D}\u{3010}\u{3011}]*[)\]}\u{FF09}\u{FF3D}\u{FF5D}\u{3011}]/gu;

const WHITESPACE_REGEX: RegExp = /\s/u;

// The part of a name its initials are read from: an address's local part.
export const getNameForInitials: (name: string) => string = (
  name: string,
): string => {
  const text: string = name.trim();
  const atIndex: number = text.indexOf("@");

  if (atIndex > 0 && !WHITESPACE_REGEX.test(text)) {
    return text.slice(0, atIndex);
  }

  return text;
};

// The words a name's initials are read from: the ones outside brackets, while there are any.
export const getNameWordsForInitials: (name: string) => Array<string> = (
  name: string,
): Array<string> => {
  const text: string = getNameForInitials(name);
  const outsideBrackets: Array<string> =
    text.replace(NAME_BRACKETED_REGEX, " ").match(NAME_WORD_REGEX) || [];

  if (outsideBrackets.length > 0) {
    return outsideBrackets;
  }

  return text.match(NAME_WORD_REGEX) || [];
};

// A word's first letter, in capitals: one character.
const getWordInitial: (word: string) => string = (word: string): string => {
  const letter: string = Array.from(word.normalize("NFC"))[0] || "";

  // "ß" is "SS" in capitals: one letter stands for the word, all the same.
  return Array.from(letter.toUpperCase())[0] || letter;
};

export const getNameInitials: (name: string | null | undefined) => string = (
  name: string | null | undefined,
): string => {
  const words: Array<string> = getNameWordsForInitials(name || "");

  if (words.length === 0) {
    return NAME_INITIALS_FALLBACK;
  }

  const first: string = getWordInitial(words[0] as string);

  if (words.length === 1) {
    return first;
  }

  return first + getWordInitial(words[words.length - 1] as string);
};

export default getNameInitials;
