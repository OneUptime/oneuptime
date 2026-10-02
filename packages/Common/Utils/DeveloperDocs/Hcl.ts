/*
 * A small HCL writer for the configuration the dashboard's Developer pages
 * generate (Terraform > copy this resource as code).
 *
 * The configuration is built as a tree (blocks, attributes, expressions) and
 * printed the way `terraform fmt` prints it: two-space indentation, and the
 * `=` of consecutive one-line attributes lined up. A multi-line value (a list
 * of objects, `jsonencode({...})`, a heredoc) is never padded and ends the
 * run of aligned lines, exactly as `terraform fmt` does it.
 *
 * Strings are written so that Terraform reads back exactly the value that was
 * given, byte for byte. That matters more than looks here: the generated
 * resource is meant to be imported, and a value that comes back one character
 * different (an escaped `${`, a heredoc's extra trailing newline) is a change
 * `terraform plan` would then try to apply to the real resource.
 */

export type HclExpression =
  | HclStringExpression
  | HclNumberExpression
  | HclBoolExpression
  | HclNullExpression
  | HclRawExpression
  | HclTupleExpression
  | HclObjectExpression
  | HclCallExpression;

export interface HclStringExpression {
  kind: "string";
  value: string;
}

export interface HclNumberExpression {
  kind: "number";
  value: number;
}

export interface HclBoolExpression {
  kind: "bool";
  value: boolean;
}

export interface HclNullExpression {
  kind: "null";
}

// Code written as is: a reference such as `var.api_key` or `oneuptime_label.x.id`.
export interface HclRawExpression {
  kind: "raw";
  code: string;
}

export interface HclTupleItem {
  value: HclExpression;
  // A `# comment` after the item's comma.
  comment?: string | undefined;
}

export interface HclTupleExpression {
  kind: "tuple";
  items: Array<HclTupleItem>;
}

export interface HclObjectAttribute {
  key: string;
  value: HclExpression;
}

export interface HclObjectExpression {
  kind: "object";
  attributes: Array<HclObjectAttribute>;
}

export interface HclCallExpression {
  kind: "call";
  name: string;
  args: Array<HclExpression>;
}

export type HclBodyItem =
  | HclAttributeItem
  | HclBlockItem
  | HclCommentItem
  | HclBlankItem;

export interface HclAttributeItem {
  kind: "attribute";
  name: string;
  value: HclExpression;
}

export interface HclBlockItem {
  kind: "block";
  type: string;
  labels: Array<string>;
  body: Array<HclBodyItem>;
}

export interface HclCommentItem {
  kind: "comment";
  text: string;
}

export interface HclBlankItem {
  kind: "blank";
}

/*
 * A printed line. `raw` lines are a heredoc's body and closing marker: they
 * are written exactly as they are, at the start of the line, because any
 * indentation added to them would become part of the string.
 */
interface PrintedLine {
  text: string;
  raw?: boolean | undefined;
}

const INDENT: string = "  ";

// Lists of plain values longer than this are written one item per line.
const MAX_INLINE_TUPLE_LENGTH: number = 80;

/*
 * Words that mean something else when written as a bare object key (`true`,
 * `null`) or that start a `for` expression (`{ for ... }`). Keys spelled like
 * these are quoted.
 */
const HCL_RESERVED_WORDS: ReadonlyArray<string> = [
  "true",
  "false",
  "null",
  "for",
  "in",
  "if",
  "else",
  "endif",
  "endfor",
];

const HCL_IDENTIFIER: RegExp = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/*
 * Lines of at least this many make a multi-line string read better as a
 * heredoc than as one long quoted line full of `\n`.
 */
const MIN_LINES_FOR_HEREDOC: number = 3;

// Characters other than tab and newline that a heredoc cannot hold as-is.
const CONTROL_CHARACTER_OTHER_THAN_TAB_OR_NEWLINE: RegExp =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B-\u001F\u007F]/;

export const Hcl: {
  string: (value: string) => HclStringExpression;
  number: (value: number) => HclNumberExpression;
  bool: (value: boolean) => HclBoolExpression;
  null: () => HclNullExpression;
  raw: (code: string) => HclRawExpression;
  tuple: (items: Array<HclExpression | HclTupleItem>) => HclTupleExpression;
  object: (attributes: Array<HclObjectAttribute>) => HclObjectExpression;
  call: (name: string, args: Array<HclExpression>) => HclCallExpression;
  attribute: (name: string, value: HclExpression) => HclAttributeItem;
  block: (
    type: string,
    labels: Array<string>,
    body: Array<HclBodyItem>,
  ) => HclBlockItem;
  comment: (text: string) => HclCommentItem;
  blank: () => HclBlankItem;
} = {
  string: (value: string): HclStringExpression => {
    return { kind: "string", value };
  },
  number: (value: number): HclNumberExpression => {
    return { kind: "number", value };
  },
  bool: (value: boolean): HclBoolExpression => {
    return { kind: "bool", value };
  },
  null: (): HclNullExpression => {
    return { kind: "null" };
  },
  raw: (code: string): HclRawExpression => {
    return { kind: "raw", code };
  },
  tuple: (items: Array<HclExpression | HclTupleItem>): HclTupleExpression => {
    return {
      kind: "tuple",
      items: items.map((item: HclExpression | HclTupleItem): HclTupleItem => {
        return "kind" in item ? { value: item } : item;
      }),
    };
  },
  object: (attributes: Array<HclObjectAttribute>): HclObjectExpression => {
    return { kind: "object", attributes };
  },
  call: (name: string, args: Array<HclExpression>): HclCallExpression => {
    return { kind: "call", name, args };
  },
  attribute: (name: string, value: HclExpression): HclAttributeItem => {
    return { kind: "attribute", name, value };
  },
  block: (
    type: string,
    labels: Array<string>,
    body: Array<HclBodyItem>,
  ): HclBlockItem => {
    return { kind: "block", type, labels, body };
  },
  comment: (text: string): HclCommentItem => {
    return { kind: "comment", text };
  },
  blank: (): HclBlankItem => {
    return { kind: "blank" };
  },
};

/*
 * The body of a quoted HCL string: Terraform reads it back as exactly
 * `value`.
 *
 * Besides the usual JSON-like escapes, `${` and `%{` are doubled: inside a
 * quoted string they start an interpolation or a template directive, so a
 * monitor description that mentions `${var}` would otherwise be evaluated
 * (and fail) instead of being kept as text.
 */
export function escapeHclString(value: string): string {
  let escaped: string = "";

  for (let index: number = 0; index < value.length; index++) {
    const character: string = value.charAt(index);
    const next: string = value.charAt(index + 1);

    if (character === "\\") {
      escaped += "\\\\";
    } else if (character === '"') {
      escaped += '\\"';
    } else if (character === "\n") {
      escaped += "\\n";
    } else if (character === "\r") {
      escaped += "\\r";
    } else if (character === "\t") {
      escaped += "\\t";
    } else if ((character === "$" || character === "%") && next === "{") {
      escaped += character + character;
    } else if (character.charCodeAt(0) < 0x20 || character === "\u007F") {
      escaped += `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
    } else {
      escaped += character;
    }
  }

  return escaped;
}

export function quoteHclString(value: string): string {
  return `"${escapeHclString(value)}"`;
}

// The text of a heredoc line: only template sequences need escaping there.
function escapeHeredocLine(line: string): string {
  return line.replace(/([$%])\{/g, "$1$1{");
}

/*
 * Whether a string is written as a heredoc: several lines of plain text. A
 * carriage return or another control character keeps it a quoted string,
 * where it can be escaped (a heredoc holds its body literally).
 */
export function shouldUseHeredoc(value: string): boolean {
  if (value.includes("\r")) {
    return false;
  }

  if (CONTROL_CHARACTER_OTHER_THAN_TAB_OR_NEWLINE.test(value)) {
    return false;
  }

  return value.split("\n").length >= MIN_LINES_FOR_HEREDOC;
}

// A heredoc marker that no line of the string is equal to.
function getHeredocDelimiter(lines: Array<string>): string {
  const taken: Set<string> = new Set<string>(
    lines.map((line: string): string => {
      return line.trim();
    }),
  );
  let delimiter: string = "EOT";
  let suffix: number = 1;

  while (taken.has(delimiter)) {
    delimiter = `EOT${suffix}`;
    suffix++;
  }

  return delimiter;
}

/*
 * A multi-line string as a heredoc, written so Terraform reads back exactly
 * `value`.
 *
 * A heredoc always ends with a newline. When the value has one, its last line
 * is the heredoc's; when it does not, the heredoc is wrapped in chomp(), which
 * removes that one newline (the value has no carriage returns, see
 * shouldUseHeredoc, and chomp() only ever removes newlines). The marker is
 * the plain `<<EOT`, not the indented `<<-EOT`: `<<-` strips the indentation
 * the lines share, which would also eat indentation that belongs to the value
 * (a CSS rule, a script).
 */
function printHeredoc(value: string): Array<PrintedLine> {
  const endsWithNewline: boolean = value.endsWith("\n");
  const body: string = endsWithNewline ? value.slice(0, -1) : value;
  const lines: Array<string> = body.split("\n");
  const delimiter: string = getHeredocDelimiter(lines);

  const printed: Array<PrintedLine> = [
    { text: endsWithNewline ? `<<${delimiter}` : `chomp(<<${delimiter}` },
    ...lines.map((line: string): PrintedLine => {
      return { text: escapeHeredocLine(line), raw: true };
    }),
    { text: delimiter, raw: true },
  ];

  if (!endsWithNewline) {
    printed.push({ text: ")" });
  }

  return printed;
}

export function formatHclNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "null";
  }

  return String(value);
}

export function formatHclObjectKey(key: string): string {
  if (HCL_IDENTIFIER.test(key) && !HCL_RESERVED_WORDS.includes(key)) {
    return key;
  }

  return quoteHclString(key);
}

function indentLines(
  lines: Array<PrintedLine>,
  depth: number,
): Array<PrintedLine> {
  const prefix: string = INDENT.repeat(depth);

  return lines.map((line: PrintedLine): PrintedLine => {
    if (line.raw || line.text.length === 0) {
      return line;
    }

    return { text: `${prefix}${line.text}` };
  });
}

function isSingleLine(lines: Array<PrintedLine>): boolean {
  return lines.length === 1;
}

// Appends `suffix` to the last printed line (`,` after a list item, `)` after an argument).
function appendToLastLine(
  lines: Array<PrintedLine>,
  suffix: string,
): Array<PrintedLine> {
  const last: PrintedLine | undefined = lines[lines.length - 1];

  if (!last) {
    return lines;
  }

  /*
   * A heredoc's closing marker must stay alone on its line, so whatever
   * follows it goes on a line of its own.
   */
  if (last.raw) {
    return [...lines, { text: suffix }];
  }

  return [...lines.slice(0, -1), { ...last, text: `${last.text}${suffix}` }];
}

// Prefixes the first printed line (`name = `, `jsonencode(`).
function prependToFirstLine(
  lines: Array<PrintedLine>,
  prefix: string,
): Array<PrintedLine> {
  const first: PrintedLine | undefined = lines[0];

  if (!first) {
    return [{ text: prefix }];
  }

  return [{ ...first, text: `${prefix}${first.text}` }, ...lines.slice(1)];
}

function isScalar(expression: HclExpression): boolean {
  return (
    expression.kind === "string" ||
    expression.kind === "number" ||
    expression.kind === "bool" ||
    expression.kind === "null" ||
    expression.kind === "raw"
  );
}

function printTuple(tuple: HclTupleExpression): Array<PrintedLine> {
  if (tuple.items.length === 0) {
    return [{ text: "[]" }];
  }

  const hasComments: boolean = tuple.items.some(
    (item: HclTupleItem): boolean => {
      return Boolean(item.comment);
    },
  );

  const allScalar: boolean = tuple.items.every(
    (item: HclTupleItem): boolean => {
      return isScalar(item.value);
    },
  );

  if (allScalar && !hasComments) {
    const printedItems: Array<Array<PrintedLine>> = tuple.items.map(
      (item: HclTupleItem): Array<PrintedLine> => {
        return printExpression(item.value);
      },
    );

    if (printedItems.every(isSingleLine)) {
      const inline: string = `[${printedItems
        .map((lines: Array<PrintedLine>): string => {
          return lines[0]?.text || "";
        })
        .join(", ")}]`;

      if (inline.length <= MAX_INLINE_TUPLE_LENGTH) {
        return [{ text: inline }];
      }
    }
  }

  const lines: Array<PrintedLine> = [{ text: "[" }];

  for (const item of tuple.items) {
    let itemLines: Array<PrintedLine> = appendToLastLine(
      printExpression(item.value),
      ",",
    );

    if (item.comment) {
      itemLines = appendToLastLine(itemLines, ` # ${item.comment}`);
    }

    lines.push(...indentLines(itemLines, 1));
  }

  lines.push({ text: "]" });

  return lines;
}

/*
 * Lines of `name = value` pairs, `=` aligned the way `terraform fmt` aligns
 * them: across each run of consecutive one-line values. A value spanning
 * several lines is written with a single space before its `=` and ends the
 * run.
 */
interface PrintedAssignment {
  name: string;
  lines: Array<PrintedLine>;
}

function printAssignments(
  assignments: Array<{ name: string; value: HclExpression }>,
): Array<PrintedLine> {
  const printed: Array<PrintedAssignment> = assignments.map(
    (assignment: { name: string; value: HclExpression }): PrintedAssignment => {
      return {
        name: assignment.name,
        lines: printExpression(assignment.value),
      };
    },
  );

  const output: Array<PrintedLine> = [];
  let index: number = 0;

  while (index < printed.length) {
    const current: PrintedAssignment = printed[index] as PrintedAssignment;

    if (!isSingleLine(current.lines)) {
      output.push(...prependToFirstLine(current.lines, `${current.name} = `));
      index++;
      continue;
    }

    // A run of one-line values: pad every name to the longest one.
    let runEnd: number = index;

    while (
      runEnd < printed.length &&
      isSingleLine((printed[runEnd] as PrintedAssignment).lines)
    ) {
      runEnd++;
    }

    const run: Array<PrintedAssignment> = printed.slice(index, runEnd);

    const width: number = Math.max(
      ...run.map((item: PrintedAssignment): number => {
        return item.name.length;
      }),
    );

    for (const item of run) {
      output.push({
        text: `${item.name.padEnd(width)} = ${item.lines[0]?.text || ""}`,
      });
    }

    index = runEnd;
  }

  return output;
}

function printObject(object: HclObjectExpression): Array<PrintedLine> {
  if (object.attributes.length === 0) {
    return [{ text: "{}" }];
  }

  return [
    { text: "{" },
    ...indentLines(
      printAssignments(
        object.attributes.map(
          (
            attribute: HclObjectAttribute,
          ): { name: string; value: HclExpression } => {
            return {
              name: formatHclObjectKey(attribute.key),
              value: attribute.value,
            };
          },
        ),
      ),
      1,
    ),
    { text: "}" },
  ];
}

function printCall(call: HclCallExpression): Array<PrintedLine> {
  const printedArgs: Array<Array<PrintedLine>> = call.args.map(printExpression);

  if (printedArgs.every(isSingleLine)) {
    return [
      {
        text: `${call.name}(${printedArgs
          .map((lines: Array<PrintedLine>): string => {
            return lines[0]?.text || "";
          })
          .join(", ")})`,
      },
    ];
  }

  // One multi-line argument: `jsonencode({` ... `})`.
  if (printedArgs.length === 1 && printedArgs[0]) {
    return appendToLastLine(
      prependToFirstLine(printedArgs[0], `${call.name}(`),
      ")",
    );
  }

  const lines: Array<PrintedLine> = [{ text: `${call.name}(` }];

  printedArgs.forEach((argLines: Array<PrintedLine>, argIndex: number) => {
    const isLastArg: boolean = argIndex === printedArgs.length - 1;
    lines.push(
      ...indentLines(isLastArg ? argLines : appendToLastLine(argLines, ","), 1),
    );
  });

  lines.push({ text: ")" });

  return lines;
}

function printExpression(expression: HclExpression): Array<PrintedLine> {
  switch (expression.kind) {
    case "string":
      if (shouldUseHeredoc(expression.value)) {
        return printHeredoc(expression.value);
      }
      return [{ text: quoteHclString(expression.value) }];
    case "number":
      return [{ text: formatHclNumber(expression.value) }];
    case "bool":
      return [{ text: expression.value ? "true" : "false" }];
    case "null":
      return [{ text: "null" }];
    case "raw":
      return [{ text: expression.code }];
    case "tuple":
      return printTuple(expression);
    case "object":
      return printObject(expression);
    case "call":
      return printCall(expression);
  }
}

function printBody(items: Array<HclBodyItem>): Array<PrintedLine> {
  const output: Array<PrintedLine> = [];
  let pendingAssignments: Array<{ name: string; value: HclExpression }> = [];

  const flushAssignments: () => void = (): void => {
    if (pendingAssignments.length > 0) {
      output.push(...printAssignments(pendingAssignments));
      pendingAssignments = [];
    }
  };

  for (const item of items) {
    if (item.kind === "attribute") {
      pendingAssignments.push({ name: item.name, value: item.value });
      continue;
    }

    flushAssignments();

    if (item.kind === "blank") {
      output.push({ text: "" });
    } else if (item.kind === "comment") {
      for (const line of item.text.split("\n")) {
        output.push({ text: line.length > 0 ? `# ${line}` : "#" });
      }
    } else {
      output.push(...printBlock(item));
    }
  }

  flushAssignments();

  return output;
}

function printBlock(block: HclBlockItem): Array<PrintedLine> {
  const header: string = [
    block.type,
    ...block.labels.map((label: string): string => {
      return quoteHclString(label);
    }),
  ].join(" ");

  if (block.body.length === 0) {
    return [{ text: `${header} {}` }];
  }

  return [
    { text: `${header} {` },
    ...indentLines(printBody(block.body), 1),
    { text: "}" },
  ];
}

function joinLines(lines: Array<PrintedLine>): string {
  return lines
    .map((line: PrintedLine): string => {
      return line.text;
    })
    .join("\n");
}

// One expression as HCL source, as it would appear on the right of an `=`.
export function printHclExpression(expression: HclExpression): string {
  return joinLines(printExpression(expression));
}

/*
 * A configuration file: top-level blocks and comments, with exactly what the
 * caller put between them (use Hcl.blank() to separate blocks). Ends with a
 * newline, as `terraform fmt` leaves files.
 */
export function printHclDocument(items: Array<HclBodyItem>): string {
  return `${joinLines(printBody(items))}\n`;
}
