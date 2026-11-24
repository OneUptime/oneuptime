/*
 * A small YAML writer for the Kubernetes manifests the dashboard's Developer
 * pages write (Developer > Crossplane), as Hcl.ts is for their Terraform.
 *
 * A manifest is built as a tree (maps, lists, scalars) and printed the way
 * Kubernetes' own docs write YAML: two spaces per level, a list's items
 * indented under their key, a `# comment` after a value where it names the
 * record an ID points at.
 *
 * Strings are written so that the API server reads back exactly the value
 * that was given. That matters more than looks here: a manifest that takes
 * over a record is applied to it, and a value that comes back one character
 * different - "on" read as a boolean, a description's trailing line break
 * dropped - is a change the provider would then make to the real record.
 * kubectl reads YAML 1.1 (sigs.k8s.io/yaml), where "yes", "on" and "y" are
 * booleans, and most editors YAML 1.2: a string either could read as
 * anything but itself is quoted.
 */

export type YamlScalar = string | number | boolean | null;

export type YamlNode = YamlScalarNode | YamlMapNode | YamlListNode;

export interface YamlScalarNode {
  kind: "scalar";
  value: YamlScalar;
}

export interface YamlMapEntry {
  kind: "entry";
  key: string;
  value: YamlNode;
  /*
   * A `# comment` at the end of the line: the name of the record an ID
   * stands for. Written after a value that fits on its key's line.
   */
  comment?: string | undefined;
}

// A line of its own in a map, before the entry it is about.
export interface YamlCommentLine {
  kind: "comment";
  text: string;
}

export interface YamlMapNode {
  kind: "map";
  entries: Array<YamlMapEntry | YamlCommentLine>;
}

export interface YamlListItem {
  value: YamlNode;
  // A `# comment` after the item, as after a map entry.
  comment?: string | undefined;
}

export interface YamlListNode {
  kind: "list";
  items: Array<YamlListItem>;
  /*
   * Written on one line, `["Observe"]`, as Crossplane's docs write a
   * management policy: only for a list of scalars.
   */
  flow?: boolean | undefined;
}

// A document of a multi-document file, and the comment lines above it.
export interface YamlDocument {
  comments?: Array<string> | undefined;
  body: YamlNode;
}

export const Yaml: {
  string: (value: string) => YamlScalarNode;
  number: (value: number) => YamlScalarNode;
  bool: (value: boolean) => YamlScalarNode;
  null: () => YamlScalarNode;
  scalar: (value: YamlScalar) => YamlScalarNode;
  map: (entries: Array<YamlMapEntry | YamlCommentLine>) => YamlMapNode;
  entry: (
    key: string,
    value: YamlNode,
    comment?: string | undefined,
  ) => YamlMapEntry;
  comment: (text: string) => YamlCommentLine;
  list: (items: Array<YamlNode | YamlListItem>) => YamlListNode;
  flowList: (items: Array<YamlScalar>) => YamlListNode;
} = {
  string: (value: string): YamlScalarNode => {
    return { kind: "scalar", value };
  },
  number: (value: number): YamlScalarNode => {
    return { kind: "scalar", value };
  },
  bool: (value: boolean): YamlScalarNode => {
    return { kind: "scalar", value };
  },
  null: (): YamlScalarNode => {
    return { kind: "scalar", value: null };
  },
  scalar: (value: YamlScalar): YamlScalarNode => {
    return { kind: "scalar", value };
  },
  map: (entries: Array<YamlMapEntry | YamlCommentLine>): YamlMapNode => {
    return { kind: "map", entries };
  },
  entry: (
    key: string,
    value: YamlNode,
    comment?: string | undefined,
  ): YamlMapEntry => {
    return comment
      ? { kind: "entry", key, value, comment }
      : { kind: "entry", key, value };
  },
  comment: (text: string): YamlCommentLine => {
    return { kind: "comment", text };
  },
  list: (items: Array<YamlNode | YamlListItem>): YamlListNode => {
    return {
      kind: "list",
      items: items.map((item: YamlNode | YamlListItem): YamlListItem => {
        return "kind" in item ? { value: item } : item;
      }),
    };
  },
  flowList: (items: Array<YamlScalar>): YamlListNode => {
    return {
      kind: "list",
      flow: true,
      items: items.map((value: YamlScalar): YamlListItem => {
        return { value: { kind: "scalar", value } };
      }),
    };
  },
};

const INDENT: string = "  ";

// Longest comment written after a value: a record's name, cut down.
const MAX_TRAILING_COMMENT_LENGTH: number = 60;

/*
 * Lines of at least this many make a multi-line string read better as a
 * literal block (`|`) than as one quoted line full of `\n`, as Hcl.ts
 * writes a heredoc.
 */
const MIN_LINES_FOR_BLOCK: number = 3;

/*
 * Words a plain scalar would be read as something other than a string by:
 * YAML 1.1's booleans and nulls, which kubectl reads, and YAML 1.2's.
 * Compared in lower case: "Yes" and "OFF" are booleans too.
 */
const SPECIAL_WORDS: ReadonlySet<string> = new Set<string>([
  "y",
  "yes",
  "n",
  "no",
  "true",
  "false",
  "on",
  "off",
  "null",
]);

// A letter, an underscore or a slash: no number, indicator or quote.
const STARTS_PLAIN: RegExp = /^[\p{L}_/]/u;
// `key: value` or ` # comment` inside a value.
const STARTS_MAPPING_OR_COMMENT: RegExp = /:\s|\s#/;
const STARTS_WITH_WHITESPACE: RegExp = /^\s/;
const WHITESPACE: RegExp = /\s/;

const UUID: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Characters no plain scalar may hold, and every quoted string escapes.
const CONTROL_CHARACTERS: RegExp =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001F\u007F-\u009F\u2028\u2029\uFEFF]/;

/*
 * Whether a string can be written as it is, unquoted, and read back as that
 * same string by YAML 1.1 and 1.2 alike. Deliberately narrow: it starts
 * with a letter, an underscore or a slash, so it is never a number, a date,
 * an anchor, a tag, an alias or a flow collection; it holds no `: ` or
 * ` #`, which would start a mapping or a comment; and it is no word YAML
 * reads as a boolean or a null. Anything else is quoted.
 */
export function isPlainYamlString(value: string): boolean {
  if (value.length === 0 || value !== value.trim()) {
    return false;
  }

  /*
   * A record's ID: no number, date or time has letters and four hyphens in
   * it, so YAML reads it as the string it is.
   */
  if (UUID.test(value)) {
    return true;
  }

  if (!STARTS_PLAIN.test(value)) {
    return false;
  }

  if (CONTROL_CHARACTERS.test(value)) {
    return false;
  }

  if (STARTS_MAPPING_OR_COMMENT.test(value) || value.endsWith(":")) {
    return false;
  }

  return !SPECIAL_WORDS.has(value.toLowerCase());
}

/*
 * A double-quoted YAML string: JSON's escapes, which YAML's double quotes
 * take as they are, and an escape for each character YAML would read as a
 * line break (U+0085, U+2028, U+2029) or drop (a byte order mark).
 */
export function quoteYamlString(value: string): string {
  let quoted: string = '"';

  for (const character of value) {
    const code: number = character.codePointAt(0) as number;

    if (character === "\\") {
      quoted += "\\\\";
    } else if (character === '"') {
      quoted += '\\"';
    } else if (character === "\n") {
      quoted += "\\n";
    } else if (character === "\t") {
      quoted += "\\t";
    } else if (character === "\r") {
      quoted += "\\r";
    } else if (CONTROL_CHARACTERS.test(character)) {
      quoted += `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`;
    } else {
      quoted += character;
    }
  }

  return `${quoted}"`;
}

/*
 * The lines of a multi-line string written as a literal block, or null when
 * one would not read back exactly: too few lines to be worth it, a control
 * character or a carriage return, a first line that starts with a space
 * (which would set the block's indentation), a line that ends in
 * whitespace or holds nothing else, or more than one line break at the end.
 */
function literalBlockLines(
  value: string,
): { header: string; lines: Array<string> } | null {
  if (
    !value.includes("\n") ||
    CONTROL_CHARACTERS.test(value.replace(/\n/g, ""))
  ) {
    return null;
  }

  const trailing: string = value.match(/\n*$/)?.[0] || "";
  const content: string = value.slice(0, value.length - trailing.length);
  const lines: Array<string> = content.split("\n");

  if (lines.length < MIN_LINES_FOR_BLOCK) {
    return null;
  }

  if (!lines[0] || STARTS_WITH_WHITESPACE.test(lines[0])) {
    return null;
  }

  if (
    lines.some((line: string): boolean => {
      return line !== line.trimEnd() || (line.length > 0 && !line.trim());
    })
  ) {
    return null;
  }

  /*
   * Strip ("|-") or keep its one line break ("|"). More than one stays
   * quoted: a block keeps them as empty lines at the end of the manifest,
   * where copying it, or a code block's own trimming, would drop them.
   */
  if (trailing.length > 1) {
    return null;
  }

  return { header: trailing.length === 0 ? "|-" : "|", lines };
}

function formatScalar(value: YamlScalar): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? String(value)
      : quoteYamlString(String(value));
  }

  return isPlainYamlString(value) ? value : quoteYamlString(value);
}

function formatKey(key: string): string {
  return isPlainYamlString(key) ? key : quoteYamlString(key);
}

/*
 * Text for a `# comment` at the end of a line. Comments carry names people
 * typed (a label called "prod", a monitor called "API"), and a line break in
 * one would end the comment and turn the rest of the name into YAML, so
 * every run of whitespace or control characters becomes one space. Long
 * names are cut short.
 */
export function toYamlTrailingComment(text: string): string {
  const flattened: string = Array.from(text)
    .map((character: string): string => {
      return CONTROL_CHARACTERS.test(character) || WHITESPACE.test(character)
        ? " "
        : character;
    })
    .join("")
    .replace(/ +/g, " ")
    .trim();

  if (flattened.length <= MAX_TRAILING_COMMENT_LENGTH) {
    return flattened;
  }

  return `${flattened.slice(0, MAX_TRAILING_COMMENT_LENGTH - 1).trimEnd()}…`;
}

function withComment(line: string, comment: string | undefined): string {
  const text: string = comment ? toYamlTrailingComment(comment) : "";

  return text ? `${line} # ${text}` : line;
}

// One `# ...` line per line of a comment, at the given indentation.
function commentLines(text: string, indent: string): Array<string> {
  return text.split("\n").map((line: string): string => {
    const flattened: string = line
      .replace(new RegExp(CONTROL_CHARACTERS.source, "g"), " ")
      .trimEnd();

    return flattened ? `${indent}# ${flattened}` : `${indent}#`;
  });
}

function isEmptyCollection(node: YamlNode): boolean {
  return (
    (node.kind === "map" &&
      !node.entries.some((entry: YamlMapEntry | YamlCommentLine): boolean => {
        return entry.kind === "entry";
      })) ||
    (node.kind === "list" && node.items.length === 0)
  );
}

function flowList(node: YamlListNode): string {
  return `[${node.items
    .map((item: YamlListItem): string => {
      if (item.value.kind !== "scalar") {
        throw new Error("A flow list holds scalars only.");
      }

      const value: YamlScalar = item.value.value;

      return typeof value === "string"
        ? quoteYamlString(value)
        : formatScalar(value);
    })
    .join(", ")}]`;
}

/*
 * What follows `key:` (or `-`) on its own line: a scalar, an empty map or
 * list, a flow list. Null for a value that takes the lines below it.
 */
function inlineValue(node: YamlNode): string | null {
  if (node.kind === "scalar") {
    if (typeof node.value === "string" && literalBlockLines(node.value)) {
      return null;
    }

    return formatScalar(node.value);
  }

  if (node.kind === "map" && isEmptyCollection(node)) {
    return "{}";
  }

  if (node.kind === "list") {
    if (node.items.length === 0) {
      return "[]";
    }

    if (node.flow) {
      return flowList(node);
    }
  }

  return null;
}

/*
 * The lines a value takes under `key:` or `- `, at `indent`, with what goes
 * on the key's own line after the colon (a block's header, a comment).
 */
function blockValue(
  node: YamlNode,
  indent: string,
): { header: string; lines: Array<string> } {
  if (node.kind === "scalar") {
    const block: { header: string; lines: Array<string> } | null =
      literalBlockLines(String(node.value));

    if (!block) {
      throw new Error("Only a multi-line string is written as a block.");
    }

    return {
      header: block.header,
      lines: block.lines.map((line: string): string => {
        return line ? `${indent}${line}` : "";
      }),
    };
  }

  if (node.kind === "map") {
    return { header: "", lines: printMap(node, indent) };
  }

  return { header: "", lines: printList(node, indent) };
}

function printMap(node: YamlMapNode, indent: string): Array<string> {
  const lines: Array<string> = [];

  for (const entry of node.entries) {
    if (entry.kind === "comment") {
      lines.push(...commentLines(entry.text, indent));
      continue;
    }

    const key: string = `${indent}${formatKey(entry.key)}:`;
    const inline: string | null = inlineValue(entry.value);

    if (inline !== null) {
      lines.push(withComment(`${key} ${inline}`, entry.comment));

      // A map with no entries still says what its comments say, under it.
      if (entry.value.kind === "map") {
        for (const inner of entry.value.entries) {
          if (inner.kind === "comment") {
            lines.push(...commentLines(inner.text, `${indent}${INDENT}`));
          }
        }
      }

      continue;
    }

    const block: { header: string; lines: Array<string> } = blockValue(
      entry.value,
      `${indent}${INDENT}`,
    );

    lines.push(
      withComment(block.header ? `${key} ${block.header}` : key, entry.comment),
      ...block.lines,
    );
  }

  return lines;
}

/*
 * A list's items, `- ` at `indent`. An item that is a map starts on the
 * dash's line, the rest of it lined up under its first key.
 */
function printList(node: YamlListNode, indent: string): Array<string> {
  if (node.flow) {
    return [`${indent}${flowList(node)}`];
  }

  const lines: Array<string> = [];

  for (const item of node.items) {
    const inline: string | null = inlineValue(item.value);

    if (inline !== null) {
      lines.push(withComment(`${indent}- ${inline}`, item.comment));
      continue;
    }

    const block: { header: string; lines: Array<string> } = blockValue(
      item.value,
      `${indent}${INDENT}`,
    );

    if (item.value.kind === "map" && !item.comment) {
      const [first, ...rest] = block.lines;
      lines.push(
        `${indent}- ${(first || "").slice(indent.length + INDENT.length)}`,
      );
      lines.push(...rest);
      continue;
    }

    lines.push(
      withComment(
        block.header ? `${indent}- ${block.header}` : `${indent}-`,
        item.comment,
      ),
      ...block.lines,
    );
  }

  return lines;
}

// A document's lines: its comments, then its body.
function printDocument(document: YamlDocument): Array<string> {
  const lines: Array<string> = [];

  for (const comment of document.comments || []) {
    lines.push(...commentLines(comment, ""));
  }

  const inline: string | null = inlineValue(document.body);

  if (inline !== null) {
    lines.push(inline);
  } else if (document.body.kind === "map") {
    lines.push(...printMap(document.body, ""));
  } else {
    lines.push(...blockValue(document.body, "").lines);
  }

  return lines;
}

// One YAML document, ending in a line break.
export function printYaml(node: YamlNode | YamlDocument): string {
  return printYamlDocuments([node]);
}

/*
 * Several documents in one file, separated by `---` lines, as
 * `kubectl apply -f` reads them.
 */
export function printYamlDocuments(
  documents: Array<YamlNode | YamlDocument>,
): string {
  return `${documents
    .map((document: YamlNode | YamlDocument): string => {
      return printDocument(
        "body" in document ? document : { body: document },
      ).join("\n");
    })
    .join("\n---\n")}\n`;
}
