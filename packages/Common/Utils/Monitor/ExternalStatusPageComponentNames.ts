/*
 * THE COMPONENTS AN EXTERNAL STATUS PAGE MONITOR WATCHES, BY NAME.
 *
 * A monitor of a status page can watch the whole page, or only some of its
 * components (issue #5156: GitHub's Git Operations and Pull Requests, not
 * Copilot). It keeps them as names (MonitorStepExternalStatusPageMonitor's
 * componentNames), and a name picks a page's components this way:
 *
 *   - A name watches the component of exactly that name. Case and white
 *     space do not count: "git  operations" is "Git Operations". A picked
 *     component never takes another along with it - "Workers" on
 *     Cloudflare's page is not "Workers KV", "Copilot" on GitHub's is not
 *     "Copilot AI Model Providers".
 *   - A "*" stands for any text: "*us-east-1*" watches every component
 *     with us-east-1 in its name, "Workers*" every one whose name starts
 *     with Workers.
 *   - An RSS or Atom feed's items have titles, not components: there a name
 *     picks every item whose title holds it somewhere ("Git Operations"
 *     picks "Incident with Git Operations").
 *
 * A monitor saved before it could watch several components had one
 * Component Name Filter, which matched every component whose name
 * contained it. It reads as that name between two stars (fromLegacyName),
 * so it watches exactly what it watched before.
 *
 * Names come from the person (what they picked or typed) and from the page
 * (what it lists, what its incidents name): both are read in loops, never
 * by a pattern, in time in line with their length.
 */

export const EXTERNAL_STATUS_PAGE_COMPONENT_WILDCARD: string = "*";

// The most names a monitor keeps: more than any page's list needs.
export const EXTERNAL_STATUS_PAGE_MAX_COMPONENT_NAMES: number = 500;

// The longest name a monitor keeps.
export const EXTERNAL_STATUS_PAGE_MAX_COMPONENT_NAME_LENGTH: number = 255;

/*
 * How much of a name or a title a comparison reads. A page's names are
 * short; one that sends a name of megabytes is read for this much of it.
 */
export const EXTERNAL_STATUS_PAGE_MAX_COMPARED_LENGTH: number = 1000;

// Whether a UTF-16 code unit is white space as a name is read.
const isWhiteSpaceCode: (code: number) => boolean = (code: number): boolean => {
  return (
    code === 0x20 || // space
    (code >= 0x09 && code <= 0x0d) || // tab, line breaks
    code === 0xa0 || // no-break space
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
};

export default class ExternalStatusPageComponentNames {
  /*
   * A name as two names are compared: lower case, without white space at
   * either end, each run of it inside one space, and at most
   * EXTERNAL_STATUS_PAGE_MAX_COMPARED_LENGTH long.
   */
  public static comparable(text: string): string {
    const limited: string =
      text.length > EXTERNAL_STATUS_PAGE_MAX_COMPARED_LENGTH
        ? text.slice(0, EXTERNAL_STATUS_PAGE_MAX_COMPARED_LENGTH)
        : text;

    let result: string = "";
    let pendingSpace: boolean = false;

    for (let index: number = 0; index < limited.length; index++) {
      const code: number = limited.charCodeAt(index);

      if (isWhiteSpaceCode(code)) {
        pendingSpace = result.length > 0;
        continue;
      }

      if (pendingSpace) {
        result += " ";
        pendingSpace = false;
      }

      result += limited.charAt(index);
    }

    return result.toLowerCase();
  }

  // A name with a "*" in it: it stands for any text.
  public static isPattern(name: string): boolean {
    return name.includes(EXTERNAL_STATUS_PAGE_COMPONENT_WILDCARD);
  }

  /*
   * The names a monitor keeps, from whatever was stored or typed: each
   * trimmed and at most EXTERNAL_STATUS_PAGE_MAX_COMPONENT_NAME_LENGTH
   * long, none empty, each once (as names compare, the first spelling
   * kept), at most EXTERNAL_STATUS_PAGE_MAX_COMPONENT_NAMES of them.
   * Anything but a list of names is no names.
   */
  public static normalize(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }

    const names: Array<string> = [];
    const seen: Set<string> = new Set();

    for (const item of value) {
      if (typeof item !== "string") {
        continue;
      }

      const name: string = item
        .trim()
        .slice(0, EXTERNAL_STATUS_PAGE_MAX_COMPONENT_NAME_LENGTH)
        .trim();
      const key: string = ExternalStatusPageComponentNames.comparable(name);

      if (ExternalStatusPageComponentNames.isOnlyWildcards(key)) {
        /*
         * Nothing, or stars alone, which pick every component: that is the
         * whole page, which no names at all already say.
         */
        continue;
      }

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      names.push(name);

      if (names.length >= EXTERNAL_STATUS_PAGE_MAX_COMPONENT_NAMES) {
        break;
      }
    }

    return names;
  }

  /*
   * Whether a name the monitor keeps picks a component of this name: the
   * same name, or one its stars match.
   */
  public static matchesComponent(name: string, componentName: string): boolean {
    const pattern: string = ExternalStatusPageComponentNames.comparable(name);

    if (!pattern) {
      return false;
    }

    return ExternalStatusPageComponentNames.wildcardMatches(
      pattern,
      ExternalStatusPageComponentNames.comparable(componentName),
    );
  }

  /*
   * Whether any of the names picks a component of this name: each name read
   * once for every component a page lists, each component's name once.
   */
  public static picker(
    names: Array<string>,
  ): (componentName: string) => boolean {
    // Names without a star are looked up; only patterns are matched.
    const exact: Set<string> = new Set();
    const patterns: Array<string> = [];

    for (const name of names) {
      const pattern: string = ExternalStatusPageComponentNames.comparable(name);

      if (!pattern) {
        continue;
      }

      if (ExternalStatusPageComponentNames.isPattern(pattern)) {
        patterns.push(pattern);
      } else {
        exact.add(pattern);
      }
    }

    return (componentName: string): boolean => {
      const text: string =
        ExternalStatusPageComponentNames.comparable(componentName);

      return (
        exact.has(text) ||
        patterns.some((pattern: string): boolean => {
          return ExternalStatusPageComponentNames.wildcardMatches(
            pattern,
            text,
          );
        })
      );
    };
  }

  /*
   * The names that pick none of these components: a typo, or a component
   * the page renamed or removed.
   */
  public static unmatched(
    names: Array<string>,
    componentNames: Array<string>,
  ): Array<string> {
    const texts: Array<string> = componentNames.map(
      (componentName: string): string => {
        return ExternalStatusPageComponentNames.comparable(componentName);
      },
    );
    const known: Set<string> = new Set(texts);

    return names.filter((name: string): boolean => {
      const pattern: string = ExternalStatusPageComponentNames.comparable(name);

      if (!pattern) {
        return true;
      }

      if (!ExternalStatusPageComponentNames.isPattern(pattern)) {
        return !known.has(pattern);
      }

      return !texts.some((text: string): boolean => {
        return ExternalStatusPageComponentNames.wildcardMatches(pattern, text);
      });
    });
  }

  /*
   * Whether a name the monitor keeps is somewhere in a feed item's title,
   * its stars matching any text.
   */
  public static isFoundIn(name: string, text: string): boolean {
    const pattern: string = ExternalStatusPageComponentNames.comparable(name);

    if (!pattern) {
      return false;
    }

    return ExternalStatusPageComponentNames.wildcardMatches(
      `${EXTERNAL_STATUS_PAGE_COMPONENT_WILDCARD}${pattern}${EXTERNAL_STATUS_PAGE_COMPONENT_WILDCARD}`,
      ExternalStatusPageComponentNames.comparable(text),
    );
  }

  /*
   * The names of a monitor saved with one Component Name Filter, which
   * matched every component whose name contained it: that name between
   * stars, which matches the same components.
   */
  public static fromLegacyName(componentName: unknown): Array<string> {
    if (typeof componentName !== "string" || !componentName.trim()) {
      return [];
    }

    return ExternalStatusPageComponentNames.normalize([
      `${EXTERNAL_STATUS_PAGE_COMPONENT_WILDCARD}${componentName.trim()}${EXTERNAL_STATUS_PAGE_COMPONENT_WILDCARD}`,
    ]);
  }

  /*
   * The one filter a probe that has not been upgraded understands, for these
   * names: it matches every component whose name contains it. One name
   * gives its longest run of text between stars - never fewer components
   * than the name picks, only as many or more. Two or more names have none:
   * such a probe watches the whole page (or group) until it is upgraded,
   * rather than one of the names alone.
   */
  public static toLegacyName(names: Array<string>): string | undefined {
    if (names.length !== 1) {
      return undefined;
    }

    let longest: string = "";

    for (const part of (names[0] as string).split(
      EXTERNAL_STATUS_PAGE_COMPONENT_WILDCARD,
    )) {
      const trimmed: string = part.trim();

      if (trimmed.length > longest.length) {
        longest = trimmed;
      }
    }

    return longest || undefined;
  }

  // Whether a comparable name is empty, or stars and nothing else.
  private static isOnlyWildcards(name: string): boolean {
    for (let index: number = 0; index < name.length; index++) {
      if (name.charAt(index) !== EXTERNAL_STATUS_PAGE_COMPONENT_WILDCARD) {
        return false;
      }
    }

    return true;
  }

  /*
   * Whether a pattern of text and stars matches the whole of a text, both
   * already comparable. The first piece must start the text, the last end
   * it, and each piece between is found after the one before: for patterns
   * whose only wildcard is "*", taking each piece where it is first found
   * is never wrong.
   */
  private static wildcardMatches(pattern: string, text: string): boolean {
    const pieces: Array<string> = pattern.split(
      EXTERNAL_STATUS_PAGE_COMPONENT_WILDCARD,
    );

    if (pieces.length === 1) {
      return pattern === text;
    }

    const first: string = pieces[0] as string;
    const last: string = pieces[pieces.length - 1] as string;

    if (!text.startsWith(first)) {
      return false;
    }

    let position: number = first.length;

    for (let index: number = 1; index < pieces.length - 1; index++) {
      const piece: string = pieces[index] as string;

      if (!piece) {
        continue;
      }

      const found: number = text.indexOf(piece, position);

      if (found === -1) {
        return false;
      }

      position = found + piece.length;
    }

    return text.length - last.length >= position && text.endsWith(last);
  }
}
