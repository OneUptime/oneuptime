/*
 * A PATH IN A SENTENCE READ FROM THE LEFT, SET APART.
 *
 * A path reads from the left on every page, its "/" first, and the Arabic
 * or Persian words in it still read from the right (RFC 3987's
 * bidirectional IRIs, as a browser's address bar draws them). A path with
 * a letter of a script read from the right is set apart, left to right,
 * in a Unicode isolate (LRI ... PDI); a path in letters read from the left
 * comes back as it is.
 *
 * This is Types/ReadingDirection's isSetApartInSentence(path,
 * LEFT_TO_RIGHT), wrapped in Types/CodeInSentence's LEFT_TO_RIGHT_ISOLATE,
 * written out here because a module in Common/{Utils,Types}/Rum imports
 * nothing from the rest of Common: the browser recorder inlines these
 * modules into the page it is served to, and its SourceHygiene test holds
 * every one of them to that. Tests/Utils/Rum/PathInSentence.test.ts holds
 * this copy to ReadingDirection's rule, code point by code point.
 */

// Types/CodeInSentence's LEFT_TO_RIGHT_ISOLATE (LRI).
export const PATH_LEFT_TO_RIGHT_ISOLATE: string = String.fromCharCode(0x2066);

// Types/ReadingDirection's POP_DIRECTIONAL_ISOLATE (PDI).
export const PATH_POP_DIRECTIONAL_ISOLATE: string = String.fromCharCode(0x2069);

/*
 * Types/ReadingDirection's TEXT_DIRECTION_SCAN_LENGTH: only the start of a
 * path is read.
 */
export const PATH_DIRECTION_SCAN_LENGTH: number = 4096;

/*
 * A letter of a script written from right to left, by the scripts that use
 * it: Types/ReadingDirection's RIGHT_TO_LEFT_LETTER_REGEX, which says why
 * script extensions decide it, and only for a letter.
 */
const RIGHT_TO_LEFT_LETTER_REGEX: RegExp =
  /(?=\p{L})[\p{Script_Extensions=Arabic}\p{Script_Extensions=Hebrew}\p{Script_Extensions=Syriac}\p{Script_Extensions=Thaana}\p{Script_Extensions=Nko}\p{Script_Extensions=Adlam}\p{Script_Extensions=Hanifi_Rohingya}\p{Script_Extensions=Mandaic}\p{Script_Extensions=Samaritan}]/u;

export function isPathSetApartInSentence(path: string): boolean {
  return RIGHT_TO_LEFT_LETTER_REGEX.test(
    path.slice(0, PATH_DIRECTION_SCAN_LENGTH),
  );
}

export function setPathApartInSentence(path: string): string {
  return isPathSetApartInSentence(path)
    ? `${PATH_LEFT_TO_RIGHT_ISOLATE}${path}${PATH_POP_DIRECTIONAL_ISOLATE}`
    : path;
}
