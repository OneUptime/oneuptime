import "./CodeEditor.css";
import {
  EditorState,
  IndentUnit,
  LineColumn,
  TextEdit,
  applyTextEdit,
  backspace,
  countLines,
  detectIndentUnit,
  getLineColumn,
  indent,
  indentLines,
  lineEndOf,
  lineStartOf,
  newLine,
  outdent,
  spacesIndent,
  toggleLineComment,
  typeCharacter,
} from "./CodeEditorCommands";
import { escapeHtml, highlightCode } from "./CodeEditorHighlight";
import { CodeLanguage, getCodeLanguage } from "./CodeEditorLanguages";
import Icon from "../Icon/Icon";
import CodeType from "../../../Types/Code/CodeType";
import {
  JsonSyntaxCheckResult,
  checkJsonSyntax,
  describeJsonSyntaxError,
  findJsonSyntaxError,
  formatJson,
} from "../../../Types/Code/JsonSyntax";
import {
  YamlSyntaxCheckResult,
  checkYamlSyntax,
  describeYamlSyntaxError,
} from "../../../Types/Code/YamlSyntax";
import IconProp from "../../../Types/Icon/IconProp";
import {
  PluralTemplate,
  translatableTerm,
  Translator,
  translationKey,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  type: CodeType;
  /** The controlled value. Wins over `initialValue` whenever it is set. */
  value?: string | undefined;
  /** Seeds an editor that is not given `value`. */
  initialValue?: undefined | string;
  onChange?: undefined | ((value: string) => void);
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  onClick?: undefined | (() => void);
  /** Shown dimmed in the empty editor. Never becomes document text. */
  placeholder?: undefined | string;
  /**
   * Sample code for an empty editor: shown dimmed and highlighted in place of
   * the document, and offered by an "Insert example" button.
   */
  example?: string | undefined;
  /** One short line of guidance in the toolbar. */
  hint?: string | undefined;
  error?: string | undefined;
  readOnly?: boolean | undefined;
  className?: undefined | string;
  dataTestId?: string | undefined;
  tabIndex?: number | undefined;
  /** Id of the textarea, for a <label htmlFor>. */
  id?: string | undefined;
  /** The line number gutter. On for everything but wrapped prose. */
  showLineNumbers?: boolean | undefined;
  disableSpellCheck?: boolean | undefined;
  ariaLabelledby?: string | undefined;
  /** Ids of the elements describing this control (hint, status, error). */
  ariaDescribedby?: string | undefined;
  /**
   * Marks the control invalid to assistive technology. Implied by `error`;
   * for a caller that reports the problem somewhere else.
   */
  ariaInvalid?: boolean | undefined;
  /**
   * A fixed CSS height for the text area. Without it the editor grows with
   * its content from `minLines` up to `maxHeight`, then scrolls.
   */
  height?: string | undefined;
  minLines?: number | undefined;
  maxHeight?: string | undefined;
  /** JSON only: the field is read with JSON5, so judge it by JSON5's rules. */
  allowJSON5?: boolean | undefined;
  /**
   * More buttons for the toolbar, handed what they need to put text in the
   * document - the workflow builder's "Insert value" is one.
   */
  toolbarActions?: ((editor: CodeEditorActions) => ReactNode) | undefined;
}

/**
 * What a toolbar action can do with the document. The selection is the one
 * the textarea had before the action's button took the focus: a textarea
 * keeps it while it is not focused.
 */
export interface CodeEditorActions {
  getText: () => string;
  getSelection: () => { start: number; end: number };
  /**
   * Put text in place of the selection, as one step on the browser's undo
   * stack, and leave the caret after it.
   */
  insertText: (text: string) => void;
  focus: () => void;
}

/*
 * These two have to match .ou-code-editor's --ou-code-line-height and
 * --ou-code-padding-y in CodeEditor.css: the gutter's click target and the
 * current-line band are placed with them.
 */
export const CODE_EDITOR_LINE_HEIGHT_PX: number = 20;
export const CODE_EDITOR_PADDING_Y_PX: number = 10;
export const CODE_EDITOR_PADDING_X_PX: number = 12;

// Columns a tab advances to, as `tab-size` in CodeEditor.css draws it.
const TAB_SIZE: number = 4;

// Characters in the hidden run the character width is measured from.
const MEASURE_LENGTH: number = 32;

export const CODE_EDITOR_DEFAULT_MIN_LINES: number = 5;
export const CODE_EDITOR_DEFAULT_MAX_HEIGHT: string = "min(60vh, 30rem)";

/** How long the document sits still before it is checked again. */
export const CODE_EDITOR_VALIDATION_DEBOUNCE_MS: number = 250;

const FALLBACK_INDENT: IndentUnit = spacesIndent(2);

/*
 * Callers hand us `any` through Form's currentValues, so a non-string can
 * still reach a prop typed as string. Line breaks are normalised because a
 * textarea's value always reads back with "\n": keeping "\r\n" here would
 * put the highlighted layer one character per line out of step with it.
 */
type ToEditorTextFunction = (value: string | undefined) => string;

export const toEditorText: ToEditorTextFunction = (
  value: string | undefined,
): string => {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    return JSON.stringify(value, null, 4);
  }

  return value.replace(/\r\n?/g, "\n");
};

type SetNativeValueFunction = (
  textarea: HTMLTextAreaElement,
  value: string,
) => void;

/*
 * Through the prototype's setter, not `textarea.value =`: React watches the
 * instance property to know what it last rendered, and a write through it
 * would make the input event below look like no change at all.
 */
const setNativeValue: SetNativeValueFunction = (
  textarea: HTMLTextAreaElement,
  value: string,
): void => {
  const descriptor: PropertyDescriptor | undefined =
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), "value");

  if (descriptor?.set) {
    descriptor.set.call(textarea, value);
  } else {
    textarea.value = value;
  }
};

export type ApplyEditToTextareaFunction = (
  textarea: HTMLTextAreaElement,
  edit: TextEdit,
) => void;

/**
 * Make `edit` in the textarea the way typing would, so it lands on the
 * browser's own undo stack as one step. execCommand is deprecated but is
 * still the only way to do that, in every browser; where it is missing
 * (jsdom) or declines, the value is written directly and an input event
 * fired, which keeps React in step at the cost of that one undo entry.
 */
export const applyEditToTextarea: ApplyEditToTextareaFunction = (
  textarea: HTMLTextAreaElement,
  edit: TextEdit,
): void => {
  const expected: string = applyTextEdit(textarea.value, edit);

  if (edit.from !== edit.to || edit.insert !== "") {
    textarea.setSelectionRange(edit.from, edit.to);

    let applied: boolean = false;

    try {
      if (typeof document.execCommand === "function") {
        applied =
          edit.insert === ""
            ? document.execCommand("delete", false)
            : document.execCommand("insertText", false, edit.insert);
      }
    } catch {
      applied = false;
    }

    if (!applied || textarea.value !== expected) {
      setNativeValue(textarea, expected);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
};

interface SelectionShape {
  start: number;
  end: number;
  /** The end the caret is on. */
  active: number;
}

interface GutterSegment {
  text: string;
  className?: string | undefined;
}

type BuildGutterFunction = (
  lineCount: number,
  marks: Map<number, string>,
) => Array<GutterSegment>;

/*
 * The gutter is one run of text - "1\n2\n3..." - so a long document costs
 * a handful of nodes, not one per line. Only the lines that look different
 * (the current line, a line with a syntax error) are split out.
 */
const buildGutter: BuildGutterFunction = (
  lineCount: number,
  marks: Map<number, string>,
): Array<GutterSegment> => {
  const segments: Array<GutterSegment> = [];
  let buffer: string = "";

  for (let line: number = 1; line <= lineCount; line++) {
    const className: string | undefined = marks.get(line);
    const separator: string = line < lineCount ? "\n" : "";

    if (className) {
      if (buffer) {
        segments.push({ text: buffer });
      }

      segments.push({ text: String(line), className });
      buffer = separator;
      continue;
    }

    buffer += String(line) + separator;
  }

  if (buffer) {
    segments.push({ text: buffer });
  }

  return segments;
};

const MODIFIER_KEYS: Array<string> = ["Shift", "Control", "Alt", "Meta"];

/*
 * Heard on the way in, through aria-describedby: Tab indents here, so the way
 * out has to be announced rather than discovered.
 */
export const CODE_EDITOR_KEYS_HINT: string = translationKey(
  "Tab inserts indentation. To move focus out of the editor, press Escape, then Tab.",
);

// The status bar of a document that parses: "Valid JSON · 12 lines".
export const VALID_DOCUMENT_STATUS: PluralTemplate = {
  one: "Valid {{language}} · {{count}} line",
  other: "Valid {{language}} · {{count}} lines",
};

// The cursor's place, with how much is selected when anything is.
export const CURSOR_POSITION_TEMPLATE: string = translationKey(
  "Ln {{line}}, Col {{column}}",
);

export const CURSOR_POSITION_WITH_SELECTION: PluralTemplate = {
  one: "Ln {{line}}, Col {{column}} ({{count}} selected)",
  other: "Ln {{line}}, Col {{column}} ({{count}} selected)",
};

type StatusTone = "error" | "valid" | "invalid" | "neutral";

interface StatusShape {
  tone: StatusTone;
  icon: IconProp;
  // English, or the caller's own words; looked up when it is shown.
  message: string;
  // A valid document's line count: the status is then VALID_DOCUMENT_STATUS.
  lineCount?: number | undefined;
}

/*
 * Light-theme values, one step darker than the obvious choice so the 12px
 * status text clears 4.5:1 on bg-gray-50. Theme.css remaps these classes
 * under html.dark.
 */
const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  error: "text-red-700",
  invalid: "text-amber-700",
  valid: "text-green-700",
  neutral: "text-gray-500",
};

const TOOLBAR_BUTTON_CLASS: string =
  "inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40";

/**
 * A code editor for form fields: a native textarea over a highlighted copy
 * of its text, with line numbers, auto-indentation, bracket pairing, a
 * status bar that says whether JSON or YAML parses (and where it does not),
 * and Format / Copy actions. It renders on the first paint, has no runtime
 * to download, and edits with the browser's own caret, selection, undo and
 * find - which is also what makes it work with a phone keyboard and a screen
 * reader.
 */
const CodeEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const language: CodeLanguage = getCodeLanguage(props.type);
  const readOnly: boolean = Boolean(props.readOnly);
  const placeholder: string | undefined = translator.translateText(
    props.placeholder,
  );

  const [text, setText] = useState<string>(() => {
    return toEditorText(props.value ?? props.initialValue);
  });

  // The latest text, for effects that must not re-run on every keystroke.
  const textRef: React.MutableRefObject<string> = useRef<string>(text);

  /*
   * Checked on a timer, so a half-typed line is not judged the instant it is
   * typed and a long document is not re-parsed on every keystroke.
   */
  const [checkedText, setCheckedText] = useState<string>(text);

  const [selection, setSelection] = useState<SelectionShape>({
    start: 0,
    end: 0,
    active: 0,
  });
  const [isFocused, setIsFocused] = useState<boolean>(false);

  /*
   * Tab indents, so it cannot also move focus - a keyboard trap unless there
   * is a way out (WCAG 2.1.2). Escape releases the next Tab to the browser.
   */
  const [tabMovesFocus, setTabMovesFocus] = useState<boolean>(false);
  const tabMovesFocusRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const [copied, setCopied] = useState<boolean>(false);
  const copyResetTimer: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);

  const textareaRef: React.MutableRefObject<HTMLTextAreaElement | null> =
    useRef<HTMLTextAreaElement | null>(null);
  const scrollerRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const gutterRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const measureRef: React.MutableRefObject<HTMLSpanElement | null> =
    useRef<HTMLSpanElement | null>(null);

  const instanceId: string = useId();
  const keysHintId: string = `${instanceId}-code-keys`;
  const statusId: string = `${instanceId}-code-status`;
  const hintId: string = `${instanceId}-code-hint`;

  /*
   * `value` is the controlled prop; `initialValue` only seeds an editor that
   * is not given one. Seeded on the first render above and kept in step in
   * one effect: two effects, one per prop, ran in declaration order on mount
   * and the `initialValue` one blanked an editor that was only given `value`.
   */
  useEffect(() => {
    const next: string = toEditorText(
      props.value === undefined ? props.initialValue : props.value,
    );

    if (next === textRef.current) {
      return;
    }

    // Replaced from outside (a sample inserted, a record loaded): judge it now.
    textRef.current = next;
    setText(next);
    setCheckedText(next);
  }, [props.value, props.initialValue]);

  useEffect(() => {
    if (!language.validator) {
      return undefined;
    }

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      setCheckedText(text);
    }, CODE_EDITOR_VALIDATION_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [text, language.validator]);

  useEffect(() => {
    return () => {
      if (copyResetTimer.current) {
        clearTimeout(copyResetTimer.current);
      }
    };
  }, []);

  const indentUnit: IndentUnit = useMemo(() => {
    return detectIndentUnit(text, FALLBACK_INDENT, language.allowTabs);
  }, [text, language.allowTabs]);

  const syntax: JsonSyntaxCheckResult | YamlSyntaxCheckResult | null =
    useMemo(() => {
      if (language.validator === "json") {
        return checkJsonSyntax(checkedText, { allowJSON5: props.allowJSON5 });
      }

      if (language.validator === "yaml") {
        return checkYamlSyntax(checkedText);
      }

      return null;
    }, [checkedText, language.validator, props.allowJSON5]);

  // Format rewrites only strict JSON, placeholders and all, never JSON5.
  const canFormat: boolean = useMemo(() => {
    return (
      language.canFormat &&
      !readOnly &&
      checkedText.trim() !== "" &&
      findJsonSyntaxError(checkedText) === null
    );
  }, [language.canFormat, readOnly, checkedText]);

  const highlightedHtml: string = useMemo(() => {
    return highlightCode(text, language.grammar, {
      showTabs: language.showTabs,
    });
  }, [text, language.grammar, language.showTabs]);

  const example: string = (props.example || "")
    .replace(/^\s*\n/, "")
    .replace(/\s+$/, "");

  const ghostHtml: string | null = useMemo(() => {
    if (text !== "") {
      return null;
    }

    if (placeholder) {
      return `<span class="ou-code-editor__placeholder">${escapeHtml(
        placeholder,
      )}</span>`;
    }

    if (example) {
      return `<span class="ou-code-editor__example">${highlightCode(
        example,
        language.grammar,
      )}</span>`;
    }

    return null;
  }, [text, placeholder, example, language.grammar]);

  const lineCount: number = useMemo(() => {
    return countLines(text);
  }, [text]);

  const cursor: LineColumn = getLineColumn(text, selection.active);
  const selectedCharacters: number = Math.abs(selection.end - selection.start);

  const errorLine: number | null =
    syntax &&
    !syntax.isValid &&
    syntax.line !== null &&
    syntax.line <= lineCount
      ? syntax.line
      : null;

  const showGutter: boolean = language.wrap
    ? false
    : props.showLineNumbers !== false;

  const showActiveLine: boolean =
    isFocused && !readOnly && selectedCharacters === 0;

  const gutterSegments: Array<GutterSegment> = useMemo(() => {
    const marks: Map<number, string> = new Map<number, string>();

    if (showActiveLine) {
      marks.set(cursor.line, "ou-code-editor__gutter-active");
    }

    if (errorLine !== null) {
      marks.set(errorLine, "ou-code-editor__gutter-error");
    }

    return buildGutter(lineCount, marks);
  }, [lineCount, showActiveLine, cursor.line, errorLine]);

  /*
   * Keep the caret in view. The textarea never scrolls - it is exactly as
   * big as its text - so the scroller around it has to, and browsers do not
   * agree on doing that for a caret inside a textarea: Firefox leaves the
   * end of the document off-screen after Ctrl+End, and Chromium parks a
   * caret at column 1 underneath the sticky line numbers. Lines have a fixed
   * height and the font is monospaced, so where the caret is is arithmetic.
   * (Wrapped prose is left to the browser: a wrapped line has no fixed row.)
   */
  useLayoutEffect(() => {
    const scroller: HTMLDivElement | null = scrollerRef.current;
    const textarea: HTMLTextAreaElement | null = textareaRef.current;

    if (!isFocused || language.wrap || !scroller || !textarea) {
      return;
    }

    const value: string = textarea.value;
    const position: number = Math.min(selection.active, value.length);
    const line: number = getLineColumn(value, position).line;

    const top: number =
      CODE_EDITOR_PADDING_Y_PX + (line - 1) * CODE_EDITOR_LINE_HEIGHT_PX;
    const bottom: number = top + CODE_EDITOR_LINE_HEIGHT_PX;

    if (top < scroller.scrollTop) {
      scroller.scrollTop = Math.max(0, top - CODE_EDITOR_PADDING_Y_PX);
    } else if (bottom > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop =
        bottom + CODE_EDITOR_PADDING_Y_PX - scroller.clientHeight;
    }

    const characterWidth: number =
      (measureRef.current?.getBoundingClientRect().width || 0) / MEASURE_LENGTH;

    if (characterWidth <= 0) {
      return;
    }

    let columns: number = 0;

    for (const character of value.slice(
      lineStartOf(value, position),
      position,
    )) {
      columns =
        character === "\t"
          ? columns + TAB_SIZE - (columns % TAB_SIZE)
          : columns + 1;
    }

    const gutterWidth: number = gutterRef.current?.offsetWidth || 0;
    const margin: number = 2 * characterWidth;
    const x: number =
      gutterWidth + CODE_EDITOR_PADDING_X_PX + columns * characterWidth;

    if (x < scroller.scrollLeft + gutterWidth + CODE_EDITOR_PADDING_X_PX) {
      scroller.scrollLeft = Math.max(
        0,
        x - gutterWidth - CODE_EDITOR_PADDING_X_PX - margin,
      );
    } else if (x + margin > scroller.scrollLeft + scroller.clientWidth) {
      scroller.scrollLeft = x + margin - scroller.clientWidth;
    }
  }, [selection, text, isFocused, language.wrap]);

  type CaptureSelectionFunction = () => void;

  const captureSelection: CaptureSelectionFunction = (): void => {
    const textarea: HTMLTextAreaElement | null = textareaRef.current;

    if (!textarea) {
      return;
    }

    const start: number = textarea.selectionStart;
    const end: number = textarea.selectionEnd;
    const active: number =
      textarea.selectionDirection === "backward" ? start : end;

    setSelection((previous: SelectionShape) => {
      if (
        previous.start === start &&
        previous.end === end &&
        previous.active === active
      ) {
        return previous;
      }

      return { start, end, active };
    });
  };

  type SetTabMovesFocusFunction = (value: boolean) => void;

  const setTabRelease: SetTabMovesFocusFunction = (value: boolean): void => {
    tabMovesFocusRef.current = value;
    setTabMovesFocus(value);
  };

  type RunEditFunction = (edit: TextEdit | null) => void;

  const runEdit: RunEditFunction = (edit: TextEdit | null): void => {
    const textarea: HTMLTextAreaElement | null = textareaRef.current;

    if (!edit || !textarea) {
      return;
    }

    applyEditToTextarea(textarea, edit);
    captureSelection();
  };

  type ReadStateFunction = () => EditorState;

  const readState: ReadStateFunction = (): EditorState => {
    const textarea: HTMLTextAreaElement = textareaRef.current!;

    return {
      text: textarea.value,
      selectionStart: textarea.selectionStart,
      selectionEnd: textarea.selectionEnd,
    };
  };

  type ReplaceDocumentFunction = (replacement: string) => void;

  // Through the textarea, so Undo brings the previous document back.
  const replaceDocument: ReplaceDocumentFunction = (
    replacement: string,
  ): void => {
    const textarea: HTMLTextAreaElement | null = textareaRef.current;

    if (!textarea || replacement === textarea.value) {
      return;
    }

    textarea.focus();
    runEdit({
      from: 0,
      to: textarea.value.length,
      insert: replacement,
      selectionStart: 0,
      selectionEnd: 0,
    });

    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = 0;
      scrollerRef.current.scrollLeft = 0;
    }
  };

  type HandleFormatFunction = () => void;

  const handleFormat: HandleFormatFunction = (): void => {
    const formatted: string | null = formatJson(
      textareaRef.current?.value ?? text,
      indentUnit.text,
    );

    if (formatted !== null) {
      replaceDocument(formatted);
    }
  };

  type HandleCopyFunction = () => void;

  const handleCopy: HandleCopyFunction = (): void => {
    const textarea: HTMLTextAreaElement | null = textareaRef.current;
    const content: string = textarea?.value ?? text;
    const clipboard: Clipboard | undefined =
      typeof navigator !== "undefined" ? navigator.clipboard : undefined;

    if (clipboard && typeof clipboard.writeText === "function") {
      void Promise.resolve(clipboard.writeText(content)).catch(() => {
        /* A denied clipboard permission is not worth an error state. */
      });
    } else if (textarea && typeof document.execCommand === "function") {
      // No async clipboard outside a secure context (plain-HTTP installs).
      const { selectionStart, selectionEnd } = textarea;

      textarea.focus();
      textarea.select();

      try {
        document.execCommand("copy");
      } catch {
        /* Nothing more to try. */
      }

      textarea.setSelectionRange(selectionStart, selectionEnd);
    } else {
      return;
    }

    setCopied(true);

    if (copyResetTimer.current) {
      clearTimeout(copyResetTimer.current);
    }

    copyResetTimer.current = setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  type HandleKeyDownFunction = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => void;

  const handleKeyDown: HandleKeyDownFunction = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ): void => {
    // Leave composition (IME input) entirely to the browser.
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      return;
    }

    const key: string = event.key;
    const command: boolean = event.ctrlKey || event.metaKey;

    if (key === "Escape") {
      /*
       * Only the first Escape is ours. A second one is left alone, so a
       * dialog around the editor still closes on Escape, Escape.
       */
      if (!readOnly && !tabMovesFocusRef.current) {
        event.preventDefault();
        setTabRelease(true);
      }

      return;
    }

    if (key === "Tab") {
      if (readOnly || tabMovesFocusRef.current || command || event.altKey) {
        return;
      }

      event.preventDefault();
      runEdit(
        event.shiftKey
          ? outdent(readState(), indentUnit)
          : indent(readState(), indentUnit),
      );
      return;
    }

    if (!MODIFIER_KEYS.includes(key) && tabMovesFocusRef.current) {
      setTabRelease(false);
    }

    if (readOnly) {
      return;
    }

    if (key === "Enter" && !command && !event.altKey) {
      event.preventDefault();
      runEdit(newLine(readState(), indentUnit, language.rules));
      return;
    }

    if (key === "Backspace" && !command && !event.altKey) {
      const edit: TextEdit | null = backspace(
        readState(),
        indentUnit,
        language.rules,
      );

      if (edit) {
        event.preventDefault();
        runEdit(edit);
      }

      return;
    }

    if (command && !event.altKey && (key === "/" || event.code === "Slash")) {
      const edit: TextEdit | null = toggleLineComment(
        readState(),
        language.rules,
      );

      if (edit) {
        event.preventDefault();
        runEdit(edit);
      }

      return;
    }

    if (
      command &&
      !event.altKey &&
      !event.shiftKey &&
      (key === "]" || key === "[")
    ) {
      event.preventDefault();
      runEdit(
        key === "]"
          ? indentLines(readState(), indentUnit)
          : outdent(readState(), indentUnit),
      );
      return;
    }

    // Shift+Alt+F, as in VS Code. By code: Alt changes the key on a Mac.
    if (event.shiftKey && event.altKey && !command && event.code === "KeyF") {
      if (canFormat) {
        event.preventDefault();
        handleFormat();
      }

      return;
    }

    /*
     * A printable character. Ctrl+Alt is AltGr on Windows, which is how a
     * German keyboard types a bracket, so only Ctrl or Cmd alone is a
     * shortcut.
     */
    const isShortcut: boolean =
      event.metaKey || (event.ctrlKey && !event.altKey);

    if (key.length === 1 && !isShortcut) {
      const edit: TextEdit | null = typeCharacter(
        readState(),
        key,
        language.rules,
      );

      if (edit) {
        event.preventDefault();
        runEdit(edit);
      }
    }
  };

  type HandleGutterMouseDownFunction = (
    event: React.MouseEvent<HTMLDivElement>,
  ) => void;

  // A click on a line number selects that line, as in every other editor.
  const handleGutterMouseDown: HandleGutterMouseDownFunction = (
    event: React.MouseEvent<HTMLDivElement>,
  ): void => {
    const textarea: HTMLTextAreaElement | null = textareaRef.current;

    if (!textarea || event.button !== 0) {
      return;
    }

    event.preventDefault();

    const bounds: DOMRect = event.currentTarget.getBoundingClientRect();
    const line: number = Math.min(
      lineCount,
      Math.max(
        1,
        Math.floor(
          (event.clientY - bounds.top - CODE_EDITOR_PADDING_Y_PX) /
            CODE_EDITOR_LINE_HEIGHT_PX,
        ) + 1,
      ),
    );

    const value: string = textarea.value;
    let start: number = 0;

    for (let current: number = 1; current < line; current++) {
      start = value.indexOf("\n", start) + 1;
    }

    const end: number = lineEndOf(value, start);

    textarea.focus();
    textarea.setSelectionRange(start, end < value.length ? end + 1 : end);
    captureSelection();
  };

  const status: StatusShape | null = useMemo(() => {
    // Only once the check has caught up: a half-typed line is not an error yet.
    const settled: boolean = !language.validator || checkedText === text;

    if (props.error && settled) {
      return { tone: "error", icon: IconProp.Error, message: props.error };
    }

    if (!syntax) {
      return null;
    }

    if (checkedText.trim() === "") {
      return {
        tone: "neutral",
        icon: IconProp.Info,
        message: "Nothing entered yet.",
      };
    }

    // Nobody parsed it, so nothing may be claimed about it.
    if (syntax.wasSkipped) {
      return {
        tone: "neutral",
        icon: IconProp.Info,
        message: "Contains template expressions — syntax not checked.",
      };
    }

    if (syntax.isValid) {
      const lines: number = countLines(checkedText);

      return {
        tone: "valid",
        icon: IconProp.CheckCircle,
        message: "",
        lineCount: lines,
      };
    }

    return {
      tone: "invalid",
      icon: IconProp.Alert,
      message:
        language.validator === "json"
          ? describeJsonSyntaxError(syntax as JsonSyntaxCheckResult)
          : describeYamlSyntaxError(syntax as YamlSyntaxCheckResult),
    };
  }, [props.error, syntax, checkedText, text, language]);

  const isEmpty: boolean = text === "";
  const showExampleButton: boolean = Boolean(example) && isEmpty && !readOnly;

  const spellCheck: boolean = language.spellCheckFollowsCaller
    ? !props.disableSpellCheck
    : false;

  const actions: CodeEditorActions = {
    getText: (): string => {
      return textareaRef.current?.value ?? textRef.current;
    },
    getSelection: (): { start: number; end: number } => {
      const textarea: HTMLTextAreaElement | null = textareaRef.current;

      if (!textarea) {
        return { start: textRef.current.length, end: textRef.current.length };
      }

      return {
        start: Math.min(textarea.selectionStart, textarea.selectionEnd),
        end: Math.max(textarea.selectionStart, textarea.selectionEnd),
      };
    },
    insertText: (insert: string): void => {
      const textarea: HTMLTextAreaElement | null = textareaRef.current;

      if (!textarea || readOnly) {
        return;
      }

      const from: number = Math.min(
        textarea.selectionStart,
        textarea.selectionEnd,
      );
      const to: number = Math.max(
        textarea.selectionStart,
        textarea.selectionEnd,
      );

      textarea.focus();
      applyEditToTextarea(textarea, {
        from: from,
        to: to,
        insert: insert,
        selectionStart: from + insert.length,
        selectionEnd: from + insert.length,
      });
    },
    focus: (): void => {
      textareaRef.current?.focus();
    },
  };

  const describedBy: string =
    [
      props.ariaDescribedby,
      props.hint ? hintId : null,
      readOnly ? null : keysHintId,
      status ? statusId : null,
    ]
      .filter(Boolean)
      .join(" ") || "";

  const rootClassName: string = [
    "ou-code-editor overflow-hidden rounded-md border bg-white shadow-sm transition-shadow",
    props.error
      ? "border-red-300 focus-within:border-red-500 focus-within:ring-1 focus-within:ring-red-500"
      : "border-gray-300 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500",
    language.wrap ? "ou-code-editor--wrap" : "",
    readOnly ? "ou-code-editor--readonly" : "",
    props.className || "",
  ]
    .filter(Boolean)
    .join(" ");

  const minHeight: number =
    (props.minLines ?? CODE_EDITOR_DEFAULT_MIN_LINES) *
      CODE_EDITOR_LINE_HEIGHT_PX +
    2 * CODE_EDITOR_PADDING_Y_PX;

  const scrollerStyle: React.CSSProperties = props.height
    ? { height: props.height }
    : { maxHeight: props.maxHeight || CODE_EDITOR_DEFAULT_MAX_HEIGHT };

  return (
    <div
      className={rootClassName}
      data-testid={props.dataTestId}
      data-code-type={props.type}
      onClick={props.onClick}
    >
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 py-1 pl-3 pr-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            data-testid="code-editor-language"
            className="inline-flex shrink-0 items-center rounded border border-indigo-100 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700"
          >
            {translator.translateText(language.label)}
          </span>
          {readOnly && (
            <span
              data-testid="code-editor-read-only"
              className="inline-flex shrink-0 items-center gap-1 text-xs text-gray-500"
            >
              <Icon icon={IconProp.Lock} className="h-3 w-3" />
              {translator.translateText("Read-only")}
            </span>
          )}
          {props.hint && (
            <span
              id={hintId}
              data-testid="code-editor-hint"
              className="truncate text-xs text-gray-500"
            >
              {translator.translateText(props.hint)}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {props.toolbarActions && !readOnly && props.toolbarActions(actions)}
          {showExampleButton && (
            <button
              type="button"
              data-testid="code-editor-example-button"
              className={TOOLBAR_BUTTON_CLASS}
              onClick={() => {
                replaceDocument(example);
              }}
            >
              <Icon icon={IconProp.Code} className="h-3.5 w-3.5" />
              {translator.translateText("Insert example")}
            </button>
          )}
          {language.canFormat && !readOnly && (
            <button
              type="button"
              data-testid="code-editor-format-button"
              title={translator.translateText(
                canFormat
                  ? "Format the document (Shift+Alt+F)"
                  : "Format is available once the document is valid JSON",
              )}
              disabled={!canFormat}
              className={TOOLBAR_BUTTON_CLASS}
              onClick={handleFormat}
            >
              <Icon icon={IconProp.Indent} className="h-3.5 w-3.5" />
              {translator.translateText("Format")}
            </button>
          )}
          <button
            type="button"
            data-testid="code-editor-copy-button"
            aria-label={translator.translateTemplate(
              copied
                ? "{{language}} copied to clipboard"
                : "Copy {{language}} to clipboard",
              { language: translatableTerm(language.label) },
            )}
            disabled={isEmpty}
            className={TOOLBAR_BUTTON_CLASS}
            onClick={handleCopy}
          >
            <Icon
              icon={copied ? IconProp.Check : IconProp.Copy}
              className="h-3.5 w-3.5"
            />
            {translator.translateText(copied ? "Copied" : "Copy")}
          </button>
        </div>
      </div>

      <div
        ref={scrollerRef}
        data-testid="code-editor-scroller"
        className="ou-code-editor__scroller"
        style={scrollerStyle}
      >
        <div className="ou-code-editor__content">
          {showGutter && (
            <div
              ref={gutterRef}
              aria-hidden="true"
              data-testid="code-editor-gutter"
              className="ou-code-editor__gutter"
              style={{
                minWidth: `calc(${String(lineCount).length + 1}ch + 22px)`,
              }}
              onMouseDown={handleGutterMouseDown}
            >
              {gutterSegments.map((segment: GutterSegment, index: number) => {
                return segment.className ? (
                  <span key={index} className={segment.className}>
                    {segment.text}
                  </span>
                ) : (
                  <React.Fragment key={index}>{segment.text}</React.Fragment>
                );
              })}
            </div>
          )}

          <div className="ou-code-editor__code" style={{ minHeight }}>
            <span
              ref={measureRef}
              aria-hidden="true"
              className="ou-code-editor__measure"
            >
              {"0".repeat(MEASURE_LENGTH)}
            </span>
            {showActiveLine && !language.wrap && (
              <div
                aria-hidden="true"
                data-testid="code-editor-active-line"
                className="ou-code-editor__active-line"
                style={{
                  top:
                    CODE_EDITOR_PADDING_Y_PX +
                    (cursor.line - 1) * CODE_EDITOR_LINE_HEIGHT_PX,
                }}
              />
            )}

            {/*
             * A div, not a <pre>: the HTML parser drops a newline straight
             * after <pre>, and one character missing here shifts every line
             * under the textarea.
             */}
            <div
              aria-hidden="true"
              data-testid="code-editor-highlight"
              className="ou-code-editor__layer ou-code-editor__highlight"
              dangerouslySetInnerHTML={{
                /*
                 * The trailing newline gives a document that ends in one the
                 * empty last line the textarea shows; a final line break on
                 * its own draws nothing.
                 */
                __html: (ghostHtml ?? highlightedHtml) + "\n",
              }}
            />

            <textarea
              ref={textareaRef}
              id={props.id}
              data-testid="code-editor-input"
              className="ou-code-editor__layer ou-code-editor__input"
              value={text}
              readOnly={readOnly}
              tabIndex={props.tabIndex}
              placeholder={placeholder}
              wrap={language.wrap ? "soft" : "off"}
              spellCheck={spellCheck}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              data-gramm="false"
              data-gramm_editor="false"
              data-enable-grammarly="false"
              /*
               * A fallback name only: aria-label outranks a <label for> as
               * well as aria-labelledby, so it would hide either one.
               */
              aria-label={
                props.ariaLabelledby || props.id
                  ? undefined
                  : translator.translateTemplate("{{language}} editor", {
                      language: translatableTerm(language.label),
                    })
              }
              aria-labelledby={props.ariaLabelledby}
              aria-describedby={describedBy || undefined}
              aria-invalid={props.ariaInvalid || props.error ? true : undefined}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                const next: string = event.target.value;

                textRef.current = next;
                setText(next);
                captureSelection();

                if (props.onChange) {
                  props.onChange(next);
                }
              }}
              onKeyDown={handleKeyDown}
              onSelect={captureSelection}
              onKeyUp={captureSelection}
              onMouseUp={captureSelection}
              onFocus={() => {
                setIsFocused(true);
                setTabRelease(false);
                captureSelection();

                if (props.onFocus) {
                  props.onFocus();
                }
              }}
              onBlur={() => {
                setIsFocused(false);
                setTabRelease(false);

                if (props.onBlur) {
                  props.onBlur();
                }
              }}
              onScroll={(event: React.UIEvent<HTMLTextAreaElement>) => {
                /*
                 * The textarea is always exactly as big as its text, and the
                 * scroller around it does the scrolling. Should it ever scroll
                 * itself, its glyphs would slide off the colours under them.
                 */
                const target: HTMLTextAreaElement = event.currentTarget;

                if (target.scrollTop !== 0 || target.scrollLeft !== 0) {
                  target.scrollTop = 0;
                  target.scrollLeft = 0;
                }
              }}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-3 py-1 text-xs">
        <div
          id={statusId}
          data-testid="code-editor-status"
          role="status"
          aria-live="polite"
          className={`flex min-w-0 items-center gap-1.5 ${
            status ? STATUS_TONE_CLASS[status.tone] : "text-gray-500"
          }`}
        >
          {status && (
            <>
              <Icon icon={status.icon} className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 break-words">
                {status.lineCount !== undefined
                  ? translator.translatePlural(
                      VALID_DOCUMENT_STATUS,
                      status.lineCount,
                      { language: translatableTerm(language.label) },
                    )
                  : translator.translateText(status.message)}
              </span>
            </>
          )}
        </div>

        <div
          data-testid="code-editor-cursor"
          className="flex shrink-0 items-center gap-2 tabular-nums text-gray-500"
        >
          {tabMovesFocus && isFocused && (
            <span
              data-testid="code-editor-tab-released"
              className="rounded border border-gray-200 bg-white px-1.5 text-gray-600"
            >
              {translator.translateText("Tab moves focus")}
            </span>
          )}
          <span>
            {selectedCharacters > 0
              ? translator.translatePlural(
                  CURSOR_POSITION_WITH_SELECTION,
                  selectedCharacters,
                  { line: cursor.line, column: cursor.column },
                )
              : translator.translateTemplate(CURSOR_POSITION_TEMPLATE, {
                  line: cursor.line,
                  column: cursor.column,
                })}
          </span>
        </div>
      </div>

      {!readOnly && (
        <span id={keysHintId} className="sr-only">
          {translator.translateText(CODE_EDITOR_KEYS_HINT)}
        </span>
      )}

      {/*
       * The copy button's own name changes, but a button name is not a live
       * region - nothing would speak the confirmation. This does.
       */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied
          ? translator.translateTemplate("{{language}} copied to clipboard", {
              language: translatableTerm(language.label),
            })
          : ""}
      </span>
    </div>
  );
};

export default CodeEditor;
