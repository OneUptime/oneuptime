/*
 * THE RUN THAT ENDS A TEXT, TAKEN OFF IN TIME IN LINE WITH THE TEXT'S
 * LENGTH.
 *
 * A pattern for the run that ends a text - /\/+$/ for the slashes that end
 * a URL, /\.+$/ for the dots that end a host name, /[.\s]+$/ for the full
 * stops and white space that end a sentence - is tried from every
 * character of every run of those characters, and each try reads on to the
 * end of its run before it finds that the text goes on. A URL a project
 * saved, or a host name an application reported, with a long run of slashes
 * or dots inside it took time that grows with the square of the run's
 * length.
 *
 * withoutTrailingRun reads the text back from its end once, and takes off
 * exactly what text.replace(/[class]+$/, "") took off: the longest run of
 * the class's characters that ends the text.
 */

export type IsRunCodeFunction = (code: number) => boolean;

export type WithoutTrailingRunFunction = (
  text: string,
  // Whether a UTF-16 code unit is one of the run's characters.
  isRunCode: IsRunCodeFunction,
) => string;

export const withoutTrailingRun: WithoutTrailingRunFunction = (
  text: string,
  isRunCode: IsRunCodeFunction,
): string => {
  let end: number = text.length;

  while (end > 0 && isRunCode(text.charCodeAt(end - 1))) {
    end--;
  }

  return end === text.length ? text : text.slice(0, end);
};

export type CodesOfFunction = (characters: string) => ReadonlySet<number>;

/*
 * The UTF-16 code units of a string, for a run of any of them: what a
 * character class written with those characters matches (without the u
 * flag, a class matches code units).
 */
export const codesOf: CodesOfFunction = (
  characters: string,
): ReadonlySet<number> => {
  const codes: Set<number> = new Set<number>();

  for (let index: number = 0; index < characters.length; index++) {
    codes.add(characters.charCodeAt(index));
  }

  return codes;
};

const SLASH: number = 0x2f;
const DOT: number = 0x2e;

export type WithoutTrailingFunction = (text: string) => string;

// /\/+$/: "https://example.com//" -> "https://example.com".
export const withoutTrailingSlashes: WithoutTrailingFunction = (
  text: string,
): string => {
  return withoutTrailingRun(text, (code: number): boolean => {
    return code === SLASH;
  });
};

// /\.+$/: "example.com." -> "example.com".
export const withoutTrailingDots: WithoutTrailingFunction = (
  text: string,
): string => {
  return withoutTrailingRun(text, (code: number): boolean => {
    return code === DOT;
  });
};
