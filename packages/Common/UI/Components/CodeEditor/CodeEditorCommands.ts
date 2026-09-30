/*
 * The editing behaviour of CodeEditor, as pure functions of text + selection.
 *
 * Each command reads an EditorState and returns the single TextEdit that
 * carries it out, or null to let the browser do its default thing. The
 * component applies the edit as ONE replacement of [from, to), which is what
 * keeps a whole Tab-indent of twenty lines a single step on the native undo
 * stack. Nothing here touches the DOM, so every rule is unit-tested directly
 * (Tests/UI/Components/CodeEditor/CodeEditorCommands.test.ts).
 */

export interface EditorState {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface TextEdit {
  /** Replace text[from, to) with `insert`. */
  from: number;
  to: number;
  insert: string;
  /** The selection afterwards, in the edited text's offsets. */
  selectionStart: number;
  selectionEnd: number;
}

export interface IndentUnit {
  /** What one level of indentation inserts: "  ", "    " or "\t". */
  text: string;
  /** Its width in columns (a tab counts as one level). */
  size: number;
  usesTabs: boolean;
}

/** What the commands need to know about a language. */
export interface EditingRules {
  /** Opening bracket -> closing bracket, for pairing and indenting. */
  brackets: Record<string, string>;
  /** Quote characters that are typed in pairs. */
  quotes: Array<string>;
  /** "//", "#", "--"; null when the language has no line comments. */
  lineComment: string | null;
  /** Indent after a line ending in ":" (YAML), or a block scalar indicator. */
  indentAfterColon: boolean;
}

export const spacesIndent: (size: number) => IndentUnit = (
  size: number,
): IndentUnit => {
  return { text: " ".repeat(size), size, usesTabs: false };
};

export const TAB_INDENT: IndentUnit = { text: "\t", size: 1, usesTabs: true };

export type ApplyTextEditFunction = (text: string, edit: TextEdit) => string;

export const applyTextEdit: ApplyTextEditFunction = (
  text: string,
  edit: TextEdit,
): string => {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
};

export type LineBoundaryFunction = (text: string, index: number) => number;

/** Offset of the first character of the line holding `index`. */
export const lineStartOf: LineBoundaryFunction = (
  text: string,
  index: number,
): number => {
  return text.lastIndexOf("\n", index - 1) + 1;
};

/** Offset of the line break ending the line holding `index` (or the end). */
export const lineEndOf: LineBoundaryFunction = (
  text: string,
  index: number,
): number => {
  const end: number = text.indexOf("\n", index);

  return end === -1 ? text.length : end;
};

export type CountLinesFunction = (text: string) => number;

export const countLines: CountLinesFunction = (text: string): number => {
  let lines: number = 1;

  for (let index: number = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) {
      lines++;
    }
  }

  return lines;
};

export interface LineColumn {
  /** 1-based. */
  line: number;
  /** 1-based, in characters. */
  column: number;
}

export type GetLineColumnFunction = (text: string, index: number) => LineColumn;

export const getLineColumn: GetLineColumnFunction = (
  text: string,
  index: number,
): LineColumn => {
  const clamped: number = Math.max(0, Math.min(index, text.length));
  const before: string = text.slice(0, clamped);

  return {
    line: countLines(before),
    column: clamped - lineStartOf(text, clamped) + 1,
  };
};

interface LineBlock {
  /** Start of the first line the selection touches. */
  start: number;
  /** End of the last line it touches (before that line's break). */
  end: number;
}

type SelectedLinesFunction = (state: EditorState) => LineBlock;

/*
 * The whole lines a selection covers. A selection that ends at the very start
 * of a line (the usual result of dragging down a block of lines) does not
 * include that line - indenting it would surprise everyone.
 */
const selectedLines: SelectedLinesFunction = (
  state: EditorState,
): LineBlock => {
  const { text, selectionStart, selectionEnd } = state;
  let last: number = selectionEnd;

  if (
    selectionEnd > selectionStart &&
    selectionEnd === lineStartOf(text, selectionEnd)
  ) {
    last = selectionEnd - 1;
  }

  return {
    start: lineStartOf(text, selectionStart),
    end: lineEndOf(text, last),
  };
};

interface Replacement {
  /** Offset in the ORIGINAL text. */
  at: number;
  remove: number;
  insert: string;
}

type MapPositionFunction = (
  position: number,
  replacements: Array<Replacement>,
  stickBefore: boolean,
) => number;

/*
 * Where `position` lands once `replacements` (sorted, non-overlapping) are
 * made. A position inside removed text moves to where it was removed from;
 * a position exactly at a pure insertion stays before the inserted text only
 * when `stickBefore` - which is how a selection starting at column 0 grows to
 * take in the indentation just added to its first line.
 */
const mapPosition: MapPositionFunction = (
  position: number,
  replacements: Array<Replacement>,
  stickBefore: boolean,
): number => {
  let delta: number = 0;

  for (const replacement of replacements) {
    if (position < replacement.at) {
      break;
    }

    if (position === replacement.at && replacement.remove === 0) {
      if (!stickBefore) {
        delta += replacement.insert.length;
      }

      continue;
    }

    if (position < replacement.at + replacement.remove) {
      return replacement.at + delta;
    }

    delta += replacement.insert.length - replacement.remove;
  }

  return position + delta;
};

type EditLinesFunction = (
  state: EditorState,
  block: LineBlock,
  replacements: Array<Replacement>,
) => TextEdit | null;

/** One TextEdit covering the block, with the selection carried through it. */
const editLines: EditLinesFunction = (
  state: EditorState,
  block: LineBlock,
  replacements: Array<Replacement>,
): TextEdit | null => {
  if (replacements.length === 0) {
    return null;
  }

  let insert: string = "";
  let cursor: number = block.start;

  for (const replacement of replacements) {
    insert += state.text.slice(cursor, replacement.at) + replacement.insert;
    cursor = replacement.at + replacement.remove;
  }

  insert += state.text.slice(cursor, block.end);

  const isRange: boolean = state.selectionStart !== state.selectionEnd;

  return {
    from: block.start,
    to: block.end,
    insert,
    selectionStart: mapPosition(state.selectionStart, replacements, isRange),
    selectionEnd: mapPosition(state.selectionEnd, replacements, false),
  };
};

type ForEachLineFunction = (
  text: string,
  block: LineBlock,
  visit: (lineStart: number, line: string) => void,
) => void;

const forEachLine: ForEachLineFunction = (
  text: string,
  block: LineBlock,
  visit: (lineStart: number, line: string) => void,
): void => {
  let lineStart: number = block.start;

  for (;;) {
    const lineEnd: number = lineEndOf(text, lineStart);

    visit(lineStart, text.slice(lineStart, lineEnd));

    if (lineEnd >= block.end) {
      return;
    }

    lineStart = lineEnd + 1;
  }
};

export type IndentLinesFunction = (
  state: EditorState,
  unit: IndentUnit,
) => TextEdit | null;

/** Indent every line the selection touches by one level. Blank lines stay blank. */
export const indentLines: IndentLinesFunction = (
  state: EditorState,
  unit: IndentUnit,
): TextEdit | null => {
  const block: LineBlock = selectedLines(state);
  const replacements: Array<Replacement> = [];

  forEachLine(state.text, block, (lineStart: number, line: string) => {
    if (line.length > 0) {
      replacements.push({ at: lineStart, remove: 0, insert: unit.text });
    }
  });

  return editLines(state, block, replacements);
};

export type IndentFunction = (
  state: EditorState,
  unit: IndentUnit,
) => TextEdit | null;

/**
 * Tab. With a caret, or a selection inside one line that is not the whole
 * line, it types indentation (to the next tab stop, when indenting with
 * spaces). A selection over several lines indents those lines instead.
 */
export const indent: IndentFunction = (
  state: EditorState,
  unit: IndentUnit,
): TextEdit | null => {
  const { text, selectionStart, selectionEnd } = state;
  const lineStart: number = lineStartOf(text, selectionStart);
  const inOneLine: boolean = !text
    .slice(selectionStart, selectionEnd)
    .includes("\n");
  const coversWholeLine: boolean =
    selectionStart === lineStart &&
    selectionEnd === lineEndOf(text, selectionStart) &&
    selectionEnd > selectionStart;

  if (inOneLine && !coversWholeLine) {
    const column: number = selectionStart - lineStart;
    const insert: string = unit.usesTabs
      ? "\t"
      : " ".repeat(unit.size - (column % unit.size));

    return {
      from: selectionStart,
      to: selectionEnd,
      insert,
      selectionStart: selectionStart + insert.length,
      selectionEnd: selectionStart + insert.length,
    };
  }

  return indentLines(state, unit);
};

export type OutdentFunction = (
  state: EditorState,
  unit: IndentUnit,
) => TextEdit | null;

/**
 * Shift+Tab: take one level of indentation off every line the selection
 * touches, snapping to the previous tab stop. Null when there is none.
 */
export const outdent: OutdentFunction = (
  state: EditorState,
  unit: IndentUnit,
): TextEdit | null => {
  const block: LineBlock = selectedLines(state);
  const replacements: Array<Replacement> = [];

  forEachLine(state.text, block, (lineStart: number, line: string) => {
    if (line.startsWith("\t")) {
      replacements.push({ at: lineStart, remove: 1, insert: "" });
      return;
    }

    const spaces: number = (line.match(/^ */) as RegExpMatchArray)[0].length;

    if (spaces === 0) {
      return;
    }

    const size: number = unit.usesTabs ? 4 : unit.size;
    const remainder: number = spaces % size;

    replacements.push({
      at: lineStart,
      remove: Math.min(spaces, remainder === 0 ? size : remainder),
      insert: "",
    });
  });

  return editLines(state, block, replacements);
};

type LastSignificantFunction = (text: string) => string;

const lastSignificant: LastSignificantFunction = (text: string): string => {
  const trimmed: string = text.trimEnd();

  return trimmed[trimmed.length - 1] || "";
};

// `key:`, `key: |`, `key: >-`, `- key:` - the lines YAML nests under.
const YAML_OPENS_BLOCK: RegExp = /(?::|\s[|>][+-]?[0-9]?)\s*$/;

export type NewLineFunction = (
  state: EditorState,
  unit: IndentUnit,
  rules: EditingRules,
) => TextEdit;

/**
 * Enter. The new line keeps the current line's indentation, goes one level
 * deeper after an opening bracket (or a YAML `key:`), and a caret between a
 * bracket pair - `{|}` - puts the closing bracket on a line of its own.
 */
export const newLine: NewLineFunction = (
  state: EditorState,
  unit: IndentUnit,
  rules: EditingRules,
): TextEdit => {
  const { text, selectionStart, selectionEnd } = state;
  const lineStart: number = lineStartOf(text, selectionStart);
  const before: string = text.slice(lineStart, selectionStart);
  let indentation: string = (before.match(/^[ \t]*/) as RegExpMatchArray)[0];
  const opener: string = lastSignificant(before);
  const closer: string | undefined = rules.brackets[opener];

  let deeper: boolean = Boolean(closer);

  if (rules.indentAfterColon) {
    /*
     * Inside a YAML list item the content starts after the "- ", and that is
     * the column its keys line up on: Enter after `- name: web` continues
     * the same item, and after `- env:` goes one level under `env`.
     */
    const listItem: RegExpMatchArray | null = before.match(/^([ \t]*)- /);

    if (listItem) {
      indentation = (listItem[1] as string) + "  ";
    }

    if (
      !deeper &&
      YAML_OPENS_BLOCK.test(before) &&
      !before.trimStart().startsWith("#")
    ) {
      deeper = true;
    }
  }

  const inner: string = deeper ? indentation + unit.text : indentation;
  const after: string = text.slice(selectionEnd, lineEndOf(text, selectionEnd));

  if (closer && after.trimStart().startsWith(closer)) {
    const insert: string = "\n" + inner + "\n" + indentation;
    const caret: number = selectionStart + 1 + inner.length;

    return {
      from: selectionStart,
      // The closer moves to its own line, without the spaces before it.
      to: selectionEnd + (after.length - after.trimStart().length),
      insert,
      selectionStart: caret,
      selectionEnd: caret,
    };
  }

  const insert: string = "\n" + inner;

  return {
    from: selectionStart,
    to: selectionEnd,
    insert,
    selectionStart: selectionStart + insert.length,
    selectionEnd: selectionStart + insert.length,
  };
};

const WORD_CHARACTER: RegExp = /[\p{L}\p{N}_$]/u;

const ONLY_SPACES: RegExp = /^ +$/;

// What may follow a caret for an opening bracket or quote to be paired.
const PAIRS_BEFORE: RegExp = /[\s)\]},;:]/;

export type TypeCharacterFunction = (
  state: EditorState,
  character: string,
  rules: EditingRules,
) => TextEdit | null;

/**
 * A printable character typed over the selection, when it is one the editor
 * handles itself:
 *
 * - an opening bracket or quote over a selection wraps it: `"` over `abc`
 *   gives `"abc"` with `abc` still selected;
 * - an opening bracket gets its closer when nothing but whitespace or
 *   punctuation follows, and a quote when it is not touching a word (so the
 *   apostrophe in "don't" stays single);
 * - typing a closer that is already the next character steps over it.
 *
 * Null means "type it normally".
 */
export const typeCharacter: TypeCharacterFunction = (
  state: EditorState,
  character: string,
  rules: EditingRules,
): TextEdit | null => {
  const { text, selectionStart, selectionEnd } = state;
  const bracketCloser: string | undefined = rules.brackets[character];
  const isQuote: boolean = rules.quotes.includes(character);
  const isCloser: boolean = Object.values(rules.brackets).includes(character);

  if (selectionStart !== selectionEnd) {
    if (!bracketCloser && !isQuote) {
      return null;
    }

    const closer: string = bracketCloser || character;
    const selected: string = text.slice(selectionStart, selectionEnd);

    return {
      from: selectionStart,
      to: selectionEnd,
      insert: character + selected + closer,
      selectionStart: selectionStart + 1,
      selectionEnd: selectionEnd + 1,
    };
  }

  const next: string = text[selectionStart] || "";
  const previous: string = text[selectionStart - 1] || "";

  if ((isCloser || isQuote) && next === character) {
    return {
      from: selectionStart,
      to: selectionStart,
      insert: "",
      selectionStart: selectionStart + 1,
      selectionEnd: selectionStart + 1,
    };
  }

  const followedByBoundary: boolean = next === "" || PAIRS_BEFORE.test(next);

  if (bracketCloser && followedByBoundary) {
    return {
      from: selectionStart,
      to: selectionStart,
      insert: character + bracketCloser,
      selectionStart: selectionStart + 1,
      selectionEnd: selectionStart + 1,
    };
  }

  if (
    isQuote &&
    followedByBoundary &&
    !WORD_CHARACTER.test(previous) &&
    previous !== character
  ) {
    return {
      from: selectionStart,
      to: selectionStart,
      insert: character + character,
      selectionStart: selectionStart + 1,
      selectionEnd: selectionStart + 1,
    };
  }

  return null;
};

export type BackspaceFunction = (
  state: EditorState,
  unit: IndentUnit,
  rules: EditingRules,
) => TextEdit | null;

/**
 * Backspace, when it should delete more than one character:
 *
 * - between an empty pair - `(|)`, `"|"` - both halves go;
 * - in the indentation, when indenting with spaces, back to the previous tab
 *   stop, so spaces feel like the tab stops Tab put there.
 */
export const backspace: BackspaceFunction = (
  state: EditorState,
  unit: IndentUnit,
  rules: EditingRules,
): TextEdit | null => {
  const { text, selectionStart, selectionEnd } = state;

  if (selectionStart !== selectionEnd || selectionStart === 0) {
    return null;
  }

  const previous: string = text[selectionStart - 1] || "";
  const next: string = text[selectionStart] || "";
  const beforePair: string = text[selectionStart - 2] || "";

  const isEmptyBracketPair: boolean =
    Boolean(rules.brackets[previous]) && rules.brackets[previous] === next;
  const isEmptyQuotePair: boolean =
    rules.quotes.includes(previous) &&
    previous === next &&
    !WORD_CHARACTER.test(beforePair) &&
    beforePair !== previous;

  if (isEmptyBracketPair || isEmptyQuotePair) {
    return {
      from: selectionStart - 1,
      to: selectionStart + 1,
      insert: "",
      selectionStart: selectionStart - 1,
      selectionEnd: selectionStart - 1,
    };
  }

  if (unit.usesTabs) {
    return null;
  }

  const lineStart: number = lineStartOf(text, selectionStart);
  const before: string = text.slice(lineStart, selectionStart);

  if (before.length < 2 || !ONLY_SPACES.test(before)) {
    return null;
  }

  const remainder: number = before.length % unit.size;
  const remove: number = remainder === 0 ? unit.size : remainder;

  if (remove <= 1) {
    return null;
  }

  return {
    from: selectionStart - remove,
    to: selectionStart,
    insert: "",
    selectionStart: selectionStart - remove,
    selectionEnd: selectionStart - remove,
  };
};

export type ToggleLineCommentFunction = (
  state: EditorState,
  rules: EditingRules,
) => TextEdit | null;

/**
 * Ctrl/Cmd+/. Comments out the lines the selection touches - at their shared
 * indentation, so the block still lines up - or, when every non-blank one is
 * already commented, uncomments them. Null for a language with no line
 * comments (JSON).
 */
export const toggleLineComment: ToggleLineCommentFunction = (
  state: EditorState,
  rules: EditingRules,
): TextEdit | null => {
  const token: string | null = rules.lineComment;

  if (!token) {
    return null;
  }

  const block: LineBlock = selectedLines(state);
  const lines: Array<{ start: number; text: string }> = [];

  forEachLine(state.text, block, (lineStart: number, line: string) => {
    lines.push({ start: lineStart, text: line });
  });

  const nonBlank: Array<{ start: number; text: string }> = lines.filter(
    (line: { start: number; text: string }) => {
      return line.text.trim() !== "";
    },
  );

  // A caret on an empty line still gets a comment started for it.
  const targets: Array<{ start: number; text: string }> =
    nonBlank.length > 0 ? nonBlank : lines;

  const leading: (line: string) => number = (line: string): number => {
    return (line.match(/^[ \t]*/) as RegExpMatchArray)[0].length;
  };

  const allCommented: boolean =
    nonBlank.length > 0 &&
    nonBlank.every((line: { start: number; text: string }) => {
      return line.text.slice(leading(line.text)).startsWith(token);
    });

  const replacements: Array<Replacement> = [];

  if (allCommented) {
    for (const line of nonBlank) {
      const at: number = line.start + leading(line.text);
      const withSpace: boolean =
        line.text[leading(line.text) + token.length] === " ";

      replacements.push({
        at,
        remove: token.length + (withSpace ? 1 : 0),
        insert: "",
      });
    }
  } else {
    const column: number = Math.min(
      ...targets.map((line: { start: number; text: string }) => {
        return line.text.trim() === "" ? line.text.length : leading(line.text);
      }),
    );

    for (const line of targets) {
      replacements.push({
        at: line.start + column,
        remove: 0,
        insert: token + " ",
      });
    }
  }

  return editLines(state, block, replacements);
};

export type DetectIndentUnitFunction = (
  text: string,
  fallback: IndentUnit,
  allowTabs: boolean,
) => IndentUnit;

/**
 * The indentation a document already uses, so Tab and Format match it: tabs
 * when most indented lines start with one (and the language allows them),
 * otherwise the step most often seen between a line and a deeper next line,
 * 2 or 4 spaces. Falls back when the document shows no clear habit.
 */
export const detectIndentUnit: DetectIndentUnitFunction = (
  text: string,
  fallback: IndentUnit,
  allowTabs: boolean,
): IndentUnit => {
  let tabLines: number = 0;
  let spaceLines: number = 0;
  let previousWidth: number = 0;
  const steps: Record<number, number> = {};

  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }

    const leading: string = (line.match(/^[ \t]*/) as RegExpMatchArray)[0];

    if (leading.startsWith("\t")) {
      tabLines++;
      continue;
    }

    if (leading.length > 0) {
      spaceLines++;
    }

    const step: number = leading.length - previousWidth;

    if (step > 0) {
      steps[step] = (steps[step] || 0) + 1;
    }

    previousWidth = leading.length;
  }

  if (allowTabs && tabLines > spaceLines) {
    return TAB_INDENT;
  }

  const twos: number = steps[2] || 0;
  const fours: number = steps[4] || 0;

  if (fours > twos) {
    return spacesIndent(4);
  }

  if (twos > 0) {
    return spacesIndent(2);
  }

  return fallback;
};
