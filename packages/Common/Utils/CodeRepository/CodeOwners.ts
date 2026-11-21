/*
 * WHO OWNS A FILE, AS A REPOSITORY'S CODE OWNERS FILE SAYS (#10374).
 *
 * GitHub reads CODEOWNERS from .github/, the repository's root or docs/,
 * the first it finds; GitLab from the root, docs/ or .gitlab/. Both write
 * one rule a line - a path pattern, then its owners - and read them the
 * same way:
 *
 *   - "#" starts a comment, at the start of a line or after a space; "\#"
 *     is a "#" of the pattern, and "\ " a space of it.
 *   - An owner is a user ("@alice"), a team ("@acme/payments") or an
 *     email address. A pattern with no owners leaves its files unowned.
 *   - The patterns are gitignore's: "*" any text within one folder, "?"
 *     one character, "**" any folders; a pattern starting with "/", or
 *     with a "/" before its end, is read from the repository's root, any
 *     other at any depth; a pattern that names a folder owns everything
 *     in it, and one ending in "/" only a folder.
 *   - The last rule that matches a file decides its owners.
 *
 * GitLab also has sections ("[Documentation] @docs-team", "^[Optional]",
 * "[Backend][2]"): a rule in a section with no owners of its own takes the
 * section's, and each section decides apart - a file is owned by the last
 * matching rule of every section, together.
 *
 * Pure, and with no regular expression built from the file: a pattern is
 * matched folder by folder, character by character, so a file someone
 * wrote can never hold the server.
 */

// Where each host looks for its code owners file, in the order it looks.
export const GITHUB_CODE_OWNERS_PATHS: ReadonlyArray<string> = [
  ".github/CODEOWNERS",
  "CODEOWNERS",
  "docs/CODEOWNERS",
];

export const GITLAB_CODE_OWNERS_PATHS: ReadonlyArray<string> = [
  "CODEOWNERS",
  "docs/CODEOWNERS",
  ".gitlab/CODEOWNERS",
];

// The most of a code owners file read, its rules, and one pattern's length.
export const MAX_CODE_OWNERS_FILE_LENGTH: number = 200_000;
export const MAX_CODE_OWNERS_RULES: number = 5_000;
const MAX_PATTERN_LENGTH: number = 500;
const MAX_OWNERS_PER_RULE: number = 50;
const MAX_PATH_LENGTH: number = 1_000;
// The longest handle or email address an owner is.
const MAX_OWNER_LENGTH: number = 254;

export interface CodeOwnersRule {
  pattern: string;
  owners: Array<string>;
  // The GitLab section the rule is in; "" for none.
  section: string;
  // Its line in the file, from 1.
  line: number;
}

export interface CodeOwnersFile {
  rules: Array<CodeOwnersRule>;
}

/*
 * An owner as the file wrote it: "@user", "@org/team", or an email
 * address. Anything else on the line after the pattern is not an owner.
 */
export function isCodeOwner(token: string): boolean {
  // No handle or address is longer, and a longer token is never read further.
  if (token.length > MAX_OWNER_LENGTH) {
    return false;
  }

  if (token.startsWith("@")) {
    return /^@[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/.test(
      token,
    );
  }

  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(token);
}

// Whether an owner names a team ("@org/team"), not a person.
export function isCodeOwnerTeam(owner: string): boolean {
  return owner.startsWith("@") && owner.includes("/");
}

// The line without its comment: from an unescaped "#" at its start or after a space.
function withoutComment(line: string): string {
  for (let index: number = 0; index < line.length; index++) {
    if (line[index] === "\\") {
      index++;
      continue;
    }

    if (line[index] === "#" && (index === 0 || /\s/.test(line[index - 1]!))) {
      return line.slice(0, index);
    }
  }

  return line;
}

// A line split at its unescaped spaces, each token with its escapes read.
function tokensOf(line: string): Array<string> {
  const tokens: Array<string> = [];
  let current: string = "";

  for (let index: number = 0; index < line.length; index++) {
    const character: string = line[index]!;

    if (character === "\\" && index + 1 < line.length) {
      current += line[index + 1];
      index++;
      continue;
    }

    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

/*
 * A GitLab section's header - "[Name]", "^[Optional]", "[Name][2]" - and
 * its default owners, or null for any other line.
 */
function readSectionHeader(
  line: string,
): { section: string; owners: Array<string> } | null {
  const match: RegExpMatchArray | null = line.match(
    /^\^?\[([^\]\n]{1,200})\](?:\[\d{1,3}\])?(.*)$/,
  );

  if (!match) {
    return null;
  }

  return {
    section: match[1]!.trim().toLowerCase(),
    owners: tokensOf(match[2] || "")
      .filter(isCodeOwner)
      .slice(0, MAX_OWNERS_PER_RULE),
  };
}

// A code owners file's rules, in the order it writes them.
export function parseCodeOwners(text: string): CodeOwnersFile {
  const rules: Array<CodeOwnersRule> = [];
  let section: string = "";
  let sectionOwners: Array<string> = [];
  const lines: Array<string> = text
    .slice(0, MAX_CODE_OWNERS_FILE_LENGTH)
    .split(/\r?\n/);

  for (let index: number = 0; index < lines.length; index++) {
    if (rules.length >= MAX_CODE_OWNERS_RULES) {
      break;
    }

    const line: string = withoutComment(lines[index]!).trim();

    if (!line) {
      continue;
    }

    const header: { section: string; owners: Array<string> } | null =
      readSectionHeader(line);

    if (header) {
      section = header.section;
      sectionOwners = header.owners;
      continue;
    }

    const tokens: Array<string> = tokensOf(line);
    const pattern: string = tokens[0] || "";

    if (!pattern || pattern.length > MAX_PATTERN_LENGTH) {
      continue;
    }

    const owners: Array<string> = tokens
      .slice(1)
      .filter(isCodeOwner)
      .slice(0, MAX_OWNERS_PER_RULE);

    rules.push({
      pattern,
      owners: owners.length > 0 ? owners : [...sectionOwners],
      section,
      line: index + 1,
    });
  }

  return { rules };
}

/*
 * Whether one folder's or file's name matches one part of a pattern: "*"
 * any characters, "?" one, anything else itself. Character by character,
 * remembering what is already known, so a part full of stars is still
 * quick.
 */
export function matchesPatternPart(part: string, name: string): boolean {
  const known: Map<string, boolean> = new Map();

  const matchFrom: (partIndex: number, nameIndex: number) => boolean = (
    partIndex: number,
    nameIndex: number,
  ): boolean => {
    const key: string = `${partIndex}:${nameIndex}`;
    const answer: boolean | undefined = known.get(key);

    if (answer !== undefined) {
      return answer;
    }

    let result: boolean;

    if (partIndex === part.length) {
      result = nameIndex === name.length;
    } else if (part[partIndex] === "*") {
      result =
        matchFrom(partIndex + 1, nameIndex) ||
        (nameIndex < name.length && matchFrom(partIndex, nameIndex + 1));
    } else if (nameIndex < name.length && part[partIndex] === "?") {
      result = matchFrom(partIndex + 1, nameIndex + 1);
    } else {
      result =
        nameIndex < name.length &&
        part[partIndex] === name[nameIndex] &&
        matchFrom(partIndex + 1, nameIndex + 1);
    }

    known.set(key, result);

    return result;
  };

  return matchFrom(0, 0);
}

// Whether a pattern's parts match a path's parts, "**" standing for any folders.
function matchesParts(
  parts: ReadonlyArray<string>,
  names: ReadonlyArray<string>,
): boolean {
  const known: Map<string, boolean> = new Map();

  const matchFrom: (partIndex: number, nameIndex: number) => boolean = (
    partIndex: number,
    nameIndex: number,
  ): boolean => {
    const key: string = `${partIndex}:${nameIndex}`;
    const answer: boolean | undefined = known.get(key);

    if (answer !== undefined) {
      return answer;
    }

    let result: boolean;

    if (partIndex === parts.length) {
      result = nameIndex === names.length;
    } else if (parts[partIndex] === "**") {
      result =
        matchFrom(partIndex + 1, nameIndex) ||
        (nameIndex < names.length && matchFrom(partIndex, nameIndex + 1));
    } else {
      result =
        nameIndex < names.length &&
        matchesPatternPart(parts[partIndex]!, names[nameIndex]!) &&
        matchFrom(partIndex + 1, nameIndex + 1);
    }

    known.set(key, result);

    return result;
  };

  return matchFrom(0, 0);
}

/*
 * Whether a pattern of a code owners file matches a file's path, as both
 * hosts read it (see the module comment).
 */
export function matchesCodeOwnersPattern(
  pattern: string,
  filePath: string,
): boolean {
  const path: string = filePath.trim().replace(/^\/+/, "");

  if (!pattern || !path || path.length > MAX_PATH_LENGTH) {
    return false;
  }

  const onlyFolders: boolean = pattern.endsWith("/");
  const body: string = pattern.replace(/\/+$/, "");
  const isAnchored: boolean = body.startsWith("/") || body.includes("/");
  const trimmed: string = body.replace(/^\/+/, "");

  // "/" or "*" alone: everything.
  if (!trimmed || trimmed === "*" || trimmed === "**") {
    return true;
  }

  const parts: Array<string> = trimmed.split("/").filter((part: string) => {
    return part.length > 0;
  });
  const patternParts: Array<string> = isAnchored ? parts : ["**", ...parts];
  const names: Array<string> = path.split("/").filter((name: string) => {
    return name.length > 0;
  });

  /*
   * The file itself, or a folder it is in: a pattern that names a folder
   * owns everything in it. One ending in "/" names only a folder.
   */
  const longest: number = onlyFolders ? names.length - 1 : names.length;

  for (let length: number = longest; length >= 1; length--) {
    if (matchesParts(patternParts, names.slice(0, length))) {
      return true;
    }
  }

  return false;
}

/*
 * The owners of a file: the last matching rule's, or - where the file has
 * GitLab sections - the last matching rule's of each section, together.
 * Each owner once, as written.
 */
export function getCodeOwnersOfPath(
  file: CodeOwnersFile,
  filePath: string,
): Array<string> {
  const lastBySection: Map<string, CodeOwnersRule> = new Map();

  for (const rule of file.rules) {
    if (matchesCodeOwnersPattern(rule.pattern, filePath)) {
      lastBySection.set(rule.section, rule);
    }
  }

  const owners: Array<string> = [];

  for (const rule of lastBySection.values()) {
    for (const owner of rule.owners) {
      if (!owners.includes(owner)) {
        owners.push(owner);
      }
    }
  }

  return owners;
}
