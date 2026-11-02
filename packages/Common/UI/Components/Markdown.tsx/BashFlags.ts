/*
 * FLAGS OF SEVERAL WORDS IN A BASH CODE BLOCK
 *
 * Prism's bash grammar colours a flag of one word (--name, -o) as a
 * parameter, but its pattern ends a flag at the first hyphen after a
 * letter, so a flag of several words was left plain: in
 *
 *   oneuptime incident update <id> --incident-severity-id <id> --json
 *
 * --json was coloured and --incident-severity-id was not. Nearly every
 * flag of the OneUptime CLI has several words (the Developer > CLI pages
 * show little else), and so have many other tools' (--create-namespace,
 * --dry-run), so a command came out half coloured.
 *
 * This is Prism's pattern with a flag's words joined by a dot, as before,
 * or by a hyphen. It runs on text somebody else wrote (a note's code
 * block), and takes time in line with it: each repeat starts with a dot or
 * a hyphen, which \w never matches, and a flag starts only at the start of
 * the text or after whitespace, which ends the flag before it.
 */
export const BASH_FLAG_PATTERN: RegExp =
  /(^|\s)-{1,2}(?:\w+:[+-]?)?\w+(?:[.-]\w+)*(?=[=\s]|$)/;

// What a grammar registers on: refractor's Prism.
export interface PrismLanguages {
  languages: Record<string, unknown>;
}

// A grammar as react-syntax-highlighter's prism-light registers it.
export interface PrismLanguageDefinition {
  (prism: PrismLanguages): void;
  displayName?: string | undefined;
  aliases?: Array<string> | undefined;
}

/*
 * Prism's bash, whose flags of several words are parameters too. Its
 * `parameter` token is one object that the commands inside $( ) share, so
 * they are coloured the same way.
 */
export function withFlagsOfSeveralWords(
  bash: PrismLanguageDefinition,
): PrismLanguageDefinition {
  const language: PrismLanguageDefinition = (prism: PrismLanguages): void => {
    bash(prism);

    const grammar: unknown = prism.languages["bash"];
    const parameter: unknown =
      grammar && typeof grammar === "object"
        ? (grammar as Record<string, unknown>)["parameter"]
        : undefined;

    if (parameter && typeof parameter === "object" && "pattern" in parameter) {
      (parameter as { pattern: RegExp }).pattern = BASH_FLAG_PATTERN;
    }
  };

  // refractor registers a grammar by its name and aliases.
  language.displayName = bash.displayName;
  language.aliases = bash.aliases;

  return language;
}
