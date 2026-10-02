import Icon from "../Icon/Icon";
import KeyboardKey, { KeyboardKeyUtil } from "../KeyboardShortcut/KeyboardKey";
import IconProp from "../../../Types/Icon/IconProp";
import TinyFormDocumentation from "../TinyFormDocumentation/TinyFormDocumentation";
import { FILE_URL } from "../../Config";
import API from "../../Utils/API/API";
import useTranslateValue from "../../Utils/Translation";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import CommonURL from "../../../Types/API/URL";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import MimeType from "../../../Types/File/MimeType";
import FileModel from "../../../Models/DatabaseModels/File";
import DOMPurify from "dompurify";
import { htmlToMarkdown, markdownToHtml } from "./MarkdownConverters";
import {
  indentMarkdownLines,
  isInFencedCodeBlock,
  liftListItems,
  MarkdownListKind,
  MarkdownTextEdit,
  outdentMarkdownLines,
  sinkListItems,
  stripTextListMarkers,
  toggleMarkdownList,
} from "./MarkdownListEditing";
import MarkdownEditorHistory from "./MarkdownEditorHistory";
import { clipboardToMarkdown } from "./MarkdownPaste";
import {
  deleteSelectionForInsert,
  insertBlocksAtCaret,
  isCaretOnEmptyLine,
  moveCaretIntoEmptyListAhead,
} from "./MarkdownVisualEditing";
import {
  MarkdownToolbarLayout,
  fitMarkdownToolbar,
  getFullToolbarLayout,
  isSameToolbarLayout,
} from "./MarkdownToolbarLayout";
import MoreMenu from "../MoreMenu/MoreMenu";
import MoreMenuItem from "../MoreMenu/MoreMenuItem";
import InsertTemplateVariableButton from "../TemplateVariables/InsertTemplateVariableButton";
import TemplateVariableMenu, {
  TemplateVariableMenuHandle,
} from "../TemplateVariables/TemplateVariableMenu";
import TemplateVariablePopup, {
  TemplateVariablePopupMode,
} from "../TemplateVariables/TemplateVariablePopup";
import TemplateVariablesCopy from "../TemplateVariables/TemplateVariablesCopy";
import TemplateVariablesList from "../TemplateVariables/TemplateVariablesList";
import useTemplateVariableTyping, {
  TemplateVariableTyping,
} from "../TemplateVariables/useTemplateVariableTyping";
import {
  TemplateVariable,
  TemplateVariableGroups,
  TemplateVariableTrigger,
  countTemplateVariables,
  filterTemplateVariableGroups,
  findTemplateVariableTrigger,
  formatTemplateVariable,
  hasTemplateVariables,
} from "../../../Types/Template/TemplateVariable";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useState,
  useRef,
  useEffect,
  useId,
  useLayoutEffect,
} from "react";

export interface ComponentProps {
  initialValue?: undefined | string;
  placeholder?: undefined | string;
  className?: undefined | string;
  onChange?: undefined | ((value: string) => void);
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  tabIndex?: number | undefined;
  error?: string | undefined;
  // Default: false (spell check enabled). Set to true to disable spell check.
  disableSpellCheck?: boolean | undefined;
  dataTestId?: string | undefined;
  ariaLabelledby?: string | undefined;
  /*
   * Default: true. Inline images upload to the File API, which needs a
   * signed-in user, so a form open to anyone (no OneUptime account) sets
   * this to false: the Image button is hidden and pasted or dropped image
   * files are ignored rather than failing to upload.
   */
  allowImageUpload?: boolean | undefined;
  /*
   * The template variables this text can use - a note template's
   * {{incident.title}}, an SLA reminder's {{elapsedTime}}. With any, the
   * toolbar has an Insert variable button, typing "{{" opens them under the
   * cursor, and the Template variables list sits collapsed under the editor;
   * each puts the variable where the cursor is, in either view.
   */
  templateVariables?: TemplateVariableGroups | undefined;
  // What the variables are filled with: the first line of the open list.
  templateVariablesDescription?: string | ReactElement | undefined;
  // More for the open list, after the variables (a panel of the field's own).
  templateVariablesFooter?: ReactNode | undefined;
}

type EditorMode = "wysiwyg" | "markdown";

// The visual editor's "{{" being typed: in which text node, and where.
interface EditableVariableTrigger {
  node: Text;
  trigger: TemplateVariableTrigger;
  rect: DOMRect;
}

// Keys that move the cursor without changing the text.
const CARET_KEYS: Array<string> = [
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
];

// A rectangle with nothing in it: no layout, or a cursor on an empty line.
const isEmptyRect: (rect: DOMRect | null | undefined) => boolean = (
  rect: DOMRect | null | undefined,
): boolean => {
  return !rect || (rect.width === 0 && rect.height === 0);
};

const MAX_IMAGE_SIZE_BYTES: number = 10 * 1024 * 1024; // 10MB

const IMAGE_MIME_BY_EXTENSION: { [key: string]: MimeType } = {
  png: MimeType.png,
  jpg: MimeType.jpg,
  jpeg: MimeType.jpeg,
  svg: MimeType.svg,
  gif: MimeType.gif,
  webp: MimeType.webp,
};

const resolveImageMimeType: (file: File) => MimeType = (
  file: File,
): MimeType => {
  const direct: string | undefined = file.type || undefined;
  if (direct && Object.values(MimeType).includes(direct as MimeType)) {
    return direct as MimeType;
  }
  const ext: string | undefined = file.name.split(".").pop()?.toLowerCase();
  if (ext && IMAGE_MIME_BY_EXTENSION[ext]) {
    return IMAGE_MIME_BY_EXTENSION[ext] as MimeType;
  }
  return MimeType.png;
};

const isImageFile: (file: File) => boolean = (file: File): boolean => {
  if (file.type && file.type.startsWith("image/")) {
    return true;
  }
  const ext: string | undefined = file.name.split(".").pop()?.toLowerCase();
  return Boolean(ext && IMAGE_MIME_BY_EXTENSION[ext]);
};

const sanitizeHtml: (html: string) => string = (html: string): string => {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["target"],
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|mailto|tel|ftp|data|placeholder|oneuptime-uploading):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
};

const RE_SINGLE_PARAGRAPH: RegExp = /^<p>([\s\S]*)<\/p>$/;
const RE_LINE_BREAKS: RegExp = /\r\n?/g;
const RE_SHOWN_CHARACTER: RegExp = /\S/;
const RE_BLANKS_AT_END: RegExp = /[ \t]*$/;
const RE_BLANKS_AT_START: RegExp = /^[ \t]*/;
// A list item's line, up to its marker: its indentation is group 1.
const RE_LIST_ITEM_LINE: RegExp = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$)/;
// A list item's line holding nothing but its marker (and a task's box).
const RE_BARE_LIST_MARKER_LINE: RegExp =
  /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+\[[ xX]\])?[ \t]*$/;
const RE_STARTS_WITH_LIST_ITEM: RegExp = /^(?:[-*+]|\d{1,9}[.)])[ \t]/;

/*
 * The inside of `html` when it is exactly one paragraph -- which is what
 * markdownToHtml makes of a word, a sentence or an image -- and null for
 * anything else.
 */
const singleParagraphContents: (html: string) => string | null = (
  html: string,
): string | null => {
  const inner: string | undefined = html.match(RE_SINGLE_PARAGRAPH)?.[1];
  if (inner === undefined || inner.includes("</p>")) {
    return null;
  }
  return inner;
};

/*
 * Markdown made of blocks -- a fenced code block, a list, a heading, more
 * than one paragraph -- pasted into the middle of a line of the markdown
 * source goes on lines of its own, with a blank line between it and the
 * text either side of it on that line: the split the visual editor makes
 * for a block. Put in the middle of the line as it was, a code block's
 * closing fence had the rest of the line after it, which made it an opening
 * fence instead -- the block never closed, and everything after it in the
 * note rendered as code. The spaces at the split go, as in the visual
 * editor. Returns the text to insert, having widened the textarea's
 * selection over those spaces.
 */
const onLinesOfItsOwn: (
  textarea: HTMLTextAreaElement,
  markdown: string,
) => string = (textarea: HTMLTextAreaElement, markdown: string): string => {
  if (
    !RE_SHOWN_CHARACTER.test(markdown) ||
    singleParagraphContents(markdownToHtml(markdown)) !== null
  ) {
    return markdown;
  }
  const value: string = textarea.value;
  const start: number = textarea.selectionStart;
  const end: number = textarea.selectionEnd;
  const lineStart: number = value.lastIndexOf("\n", start - 1) + 1;
  const lineEndAt: number = value.indexOf("\n", end);
  const lineEnd: number = lineEndAt === -1 ? value.length : lineEndAt;
  const before: string = value.slice(lineStart, start);
  const after: string = value.slice(end, lineEnd);
  const textBefore: boolean = RE_SHOWN_CHARACTER.test(before);
  const textAfter: boolean = RE_SHOWN_CHARACTER.test(after);
  if (!textBefore && !textAfter) {
    return markdown;
  }
  const spacesBefore: number = textBefore
    ? (before.match(RE_BLANKS_AT_END)?.[0] || "").length
    : 0;
  const spacesAfter: number = textAfter
    ? (after.match(RE_BLANKS_AT_START)?.[0] || "").length
    : 0;
  const itemLine: RegExpMatchArray | null = before.match(RE_LIST_ITEM_LINE);
  if (itemLine && RE_STARTS_WITH_LIST_ITEM.test(markdown)) {
    /*
     * A list pasted on the line of a list item joins that item's list, as
     * in the visual editor: its items go on the lines after the item, at
     * its indentation -- or in its place when the caret sits after nothing
     * but its marker, a "- " typed to start the list. After a blank line
     * they were a list of their own; after the bare marker, a list nested
     * in an empty item: "- - a", two bullets.
     */
    const indent: string = itemLine[1] || "";
    const items: string = markdown
      .split("\n")
      .map((line: string): string => {
        return line ? `${indent}${line}` : line;
      })
      .join("\n");
    if (RE_BARE_LIST_MARKER_LINE.test(before)) {
      /*
       * Only the item's marker (and task box) is before the caret. An empty
       * item is replaced by the pasted items; an item with text keeps its
       * own marker and task box, and the pasted items go in before it, as in
       * the visual editor. Deciding on what is before the caret alone turned
       * "- [x] |rolled back deploy" into a paragraph: the marker and the tick
       * went, and the item's text was left on a line of its own.
       */
      textarea.setSelectionRange(lineStart, end + spacesAfter);
      return textAfter ? `${items}\n${before}` : items;
    }
    textarea.setSelectionRange(start - spacesBefore, end + spacesAfter);
    return `\n${items}${textAfter ? "\n\n" : ""}`;
  }
  textarea.setSelectionRange(start - spacesBefore, end + spacesAfter);
  return `${textBefore ? "\n\n" : ""}${markdown}${textAfter ? "\n\n" : ""}`;
};

const RE_MARKUP: RegExp = /<[a-z!/]/i;

// The text of `html` when it holds no markup at all, else null.
const textOfMarkupFreeHtml: (html: string) => string | null = (
  html: string,
): string | null => {
  if (RE_MARKUP.test(html)) {
    return null;
  }
  // Only entities to decode; a <template> parses them without running anything.
  const template: HTMLTemplateElement = document.createElement("template");
  template.innerHTML = html;
  return template.content.textContent || "";
};

/*
 * Tab and Shift+Tab without other modifiers indent and outdent list items.
 * A keypress that is still composing (an IME) is left alone.
 */
const isListIndentKey: (event: React.KeyboardEvent<HTMLElement>) => boolean = (
  event: React.KeyboardEvent<HTMLElement>,
): boolean => {
  return (
    event.key === "Tab" &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.nativeEvent.isComposing
  );
};

type HistoryStep = "undo" | "redo";

/*
 * Ctrl+Z (Cmd+Z on a Mac) is undo; Ctrl+Shift+Z, Cmd+Shift+Z and Ctrl+Y are
 * redo. A keypress that is still composing is left alone.
 */
const historyStepOfKey: (
  event: React.KeyboardEvent<HTMLElement>,
) => HistoryStep | null = (
  event: React.KeyboardEvent<HTMLElement>,
): HistoryStep | null => {
  if (
    !(event.ctrlKey || event.metaKey) ||
    event.altKey ||
    event.nativeEvent.isComposing
  ) {
    return null;
  }
  const key: string = event.key.toLowerCase();
  if (key === "z") {
    return event.shiftKey ? "redo" : "undo";
  }
  if (key === "y" && !event.shiftKey) {
    return "redo";
  }
  return null;
};

type MarkdownTextEditor = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
) => MarkdownTextEdit | null;

/*
 * The toolbar's groups of formatting buttons, in order. A divider stands
 * between two groups on the toolbar, and between them in the More
 * formatting menu.
 */
type ToolbarGroup = "text" | "headings" | "lists" | "insert" | "blocks";

const TOOLBAR_GROUPS: ReadonlyArray<ToolbarGroup> = [
  "text",
  "headings",
  "lists",
  "insert",
  "blocks",
];

interface ToolbarAction {
  /*
   * What it does, in English: the button's title (after it, the key that
   * does the same) and the words of its item in the More formatting menu.
   * Looked up in the page's language before it is shown.
   */
  label: string;
  shortcut?: string | undefined;
  group: ToolbarGroup;
  icon?: IconProp | undefined;
  // Written in place of an icon: the H1 of Heading 1, a quote mark.
  glyph?: string | undefined;
  isGlyphMonospace?: boolean | undefined;
  onClick: () => void;
}

/*
 * Every formatting button is the same 32px square (TOOLBAR_BUTTON_PX in
 * MarkdownToolbarLayout), which is how the toolbar knows where its line
 * ends without measuring them. The More formatting button is one too.
 */
const TOOLBAR_BUTTON_CLASS: string =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-600 transition-colors duration-200 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2";

/*
 * The switch's width while it is in the More formatting menu and has never
 * been measured on the line. Generous, so the guess never brings it back
 * onto a line it does not fit.
 */
const ESTIMATED_MODE_TOGGLE_PX: number = 96;

/*
 * Keeps the editor's focus and selection while a toolbar control is
 * pressed: a click on a button would otherwise move the focus to it and,
 * in the visual editor, lose the selection the button is for.
 */
const keepEditorFocus: (event: React.MouseEvent<HTMLElement>) => void = (
  event: React.MouseEvent<HTMLElement>,
): void => {
  event.preventDefault();
};

interface ToolbarButtonProps {
  action: ToolbarAction;
  title: string;
}

const ToolbarButton: FunctionComponent<ToolbarButtonProps> = ({
  action,
  title,
}: ToolbarButtonProps): ReactElement => {
  return (
    <button
      type="button"
      onMouseDown={keepEditorFocus}
      onClick={action.onClick}
      title={title}
      className={TOOLBAR_BUTTON_CLASS}
    >
      {action.icon ? (
        <Icon icon={action.icon} className="h-4 w-4" />
      ) : (
        <span
          className={
            action.isGlyphMonospace
              ? "font-mono text-xs font-bold"
              : "text-sm font-bold"
          }
        >
          {action.glyph}
        </span>
      )}
    </button>
  );
};

const ToolbarDivider: FunctionComponent = (): ReactElement => {
  return <div aria-hidden="true" className="h-6 w-px shrink-0 bg-gray-300" />;
};

const MarkdownEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const allowImageUpload: boolean = props.allowImageUpload !== false;
  /*
   * The error message is tied to the field -- in either mode -- and
   * announced when it appears, as Input's and TextArea's are. It was a bare
   * paragraph: a required description left empty was neither announced nor
   * tied to the editor, so to a screen reader the form did nothing.
   */
  const errorId: string = `markdown-editor-error-${useId()}`;
  /*
   * The words the editor always shows of its own -- an empty field's
   * placeholder and the heading of its formatting help -- are looked up in
   * the page's locale, as FieldLabel's "(Optional)" is: on the public
   * incident form, translated all round, they were the only English left.
   * The English text is the key, and an app whose locale has no entry for
   * it shows the English.
   */
  const { translateString } = useTranslateValue();
  const visualPlaceholder: string =
    props.placeholder ||
    (translateString("Type your content here...") ??
      "Type your content here...");
  const sourcePlaceholder: string =
    props.placeholder ||
    (translateString("Type your markdown here...") ??
      "Type your markdown here...");
  const helpTitle: string =
    translateString("Formatting help") ?? "Formatting help";
  const [text, setText] = useState<string>(props.initialValue || "");
  const [mode, setMode] = useState<EditorMode>("wysiwyg");
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const textareaRef: React.RefObject<HTMLTextAreaElement> =
    useRef<HTMLTextAreaElement>(null);
  const editableRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const fileInputRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);
  /*
   * textRef mirrors `text` synchronously so async upload completion
   * handlers (paste / drop) can swap their placeholders against the
   * latest editor contents — even when several uploads finish in
   * quick succession or the user keeps typing while uploading.
   */
  const textRef: React.MutableRefObject<string> = useRef<string>(
    props.initialValue || "",
  );
  /*
   * The visual editor's own edits -- list moves, inserts made by hand --
   * which the browser's undo stack never hears of (see
   * MarkdownEditorHistory).
   */
  const [history] = useState<MarkdownEditorHistory>(
    (): MarkdownEditorHistory => {
      return new MarkdownEditorHistory();
    },
  );

  /*
   * Template variables. Something to pick is what puts the toolbar button
   * and the "{{" list in; the list under the editor also shows for a group
   * with none yet, which says why (a project with no custom fields).
   */
  const templateVariables: TemplateVariableGroups =
    props.templateVariables || [];
  const canPickVariables: boolean =
    countTemplateVariables(templateVariables) > 0;
  const showsVariablesList: boolean = hasTemplateVariables(templateVariables);
  const variableListboxId: string = `markdown-editor-variables-${useId()}`;
  const variableMenuRef: React.MutableRefObject<TemplateVariableMenuHandle | null> =
    useRef<TemplateVariableMenuHandle | null>(null);
  // The visual editor's "{{" being typed, while its list is open.
  const [editableTrigger, setEditableTrigger] =
    useState<EditableVariableTrigger | null>(null);
  const [editableActiveOptionId, setEditableActiveOptionId] = useState<
    string | undefined
  >(undefined);
  /*
   * Where the cursor last was in the visual editor. A pick made from outside
   * it - the toolbar button's search box takes the focus, the list under the
   * editor may be clicked long after - goes there.
   */
  const savedRangeRef: React.MutableRefObject<Range | null> =
    useRef<Range | null>(null);
  // The source view is a plain textarea: the shared typing support drives it.
  const sourceTyping: TemplateVariableTyping = useTemplateVariableTyping({
    groups: templateVariables,
    getControl: (): HTMLTextAreaElement | null => {
      return textareaRef.current;
    },
    isEnabled: canPickVariables && mode === "markdown",
  });

  const describeVariable: (variable: TemplateVariable) => string = (
    variable: TemplateVariable,
  ): string => {
    return variable.isDescriptionVerbatim
      ? variable.description
      : translateString(variable.description) || variable.description;
  };

  useEffect(() => {
    if (
      props.initialValue !== undefined &&
      props.initialValue !== textRef.current
    ) {
      setText(props.initialValue);
      textRef.current = props.initialValue;
    }
  }, [props.initialValue]);

  // A new editable in each mode: records about the old one's nodes are no use.
  useEffect(() => {
    history.clear();
    // Nor is a list opened for the other view's cursor, or its cursor.
    setEditableTrigger(null);
    setEditableActiveOptionId(undefined);
    savedRangeRef.current = null;
    sourceTyping.close();
  }, [mode]);

  /*
   * Sync markdown -> contenteditable when entering WYSIWYG, when text
   * changes from outside, or after async image-upload swaps. Skip when
   * the editor is focused so we don't disrupt the user's cursor while
   * they're typing.
   */
  useEffect(() => {
    if (mode !== "wysiwyg") {
      return;
    }
    const editable: HTMLDivElement | null = editableRef.current;
    if (!editable) {
      return;
    }
    if (
      typeof document !== "undefined" &&
      document.activeElement === editable
    ) {
      return;
    }
    const html: string = sanitizeHtml(markdownToHtml(text));
    if (editable.innerHTML !== html) {
      editable.innerHTML = html;
      history.clear();
    }
  }, [mode, text]);

  const handleChange: (value: string) => void = (value: string): void => {
    textRef.current = value;
    setText(value);
    if (props.onChange) {
      props.onChange(value);
    }
  };

  // Pull the latest markdown out of the contenteditable DOM and propagate.
  const syncFromEditable: () => void = (): void => {
    const editable: HTMLDivElement | null = editableRef.current;
    if (!editable) {
      return;
    }
    const md: string = htmlToMarkdown(editable.innerHTML);
    if (md !== textRef.current) {
      handleChange(md);
    }
  };

  /*
   * An edit the visual editor makes to its DOM itself, recorded so that
   * Ctrl+Z takes it back. Returns what `edit` returns: whether it changed
   * anything.
   */
  const editEditableByHand: (
    edit: (editable: HTMLDivElement) => boolean,
  ) => boolean = (edit: (editable: HTMLDivElement) => boolean): boolean => {
    const editable: HTMLDivElement | null = editableRef.current;
    if (!editable) {
      return false;
    }
    return history.record(editable, (): boolean => {
      return edit(editable);
    });
  };

  /*
   * Undo or redo of the editor's own edits; false (and nothing done) when
   * the last thing to undo is the browser's -- typing, say -- so the
   * browser does it.
   */
  const stepEditableHistory: (step: HistoryStep) => boolean = (
    step: HistoryStep,
  ): boolean => {
    const editable: HTMLDivElement | null = editableRef.current;
    if (!editable) {
      return false;
    }
    const stepped: boolean =
      step === "undo" ? history.undo(editable) : history.redo(editable);
    if (stepped) {
      syncFromEditable();
    }
    return stepped;
  };

  /*
   * Typing, a paste the browser makes, an execCommand: each is newer
   * history in the browser's own undo stack. The editor's own records wait
   * behind it -- each applies again once the browser's undo has put the
   * editor back as that edit left it -- but what they would redo is gone,
   * as the browser's own redo is. The browser's undo and redo themselves
   * leave both be.
   */
  const handleEditableInput: (
    event: React.FormEvent<HTMLDivElement>,
  ) => void = (event: React.FormEvent<HTMLDivElement>): void => {
    const inputType: string =
      (event.nativeEvent as InputEvent | undefined)?.inputType || "";
    if (inputType !== "historyUndo" && inputType !== "historyRedo") {
      history.clearRedo();
    }
    syncFromEditable();
    updateEditableTrigger(true);
    rememberEditableSelection();
  };

  /*
   * Undo and redo from the browser's Edit menu or context menu arrive with
   * no key press, as a native beforeinput event -- which React's
   * onBeforeInput is not -- so it is listened for on the element itself.
   * The ref keeps the listener on the latest render's handlers.
   */
  const beforeInputRef: React.MutableRefObject<(event: InputEvent) => void> =
    useRef<(event: InputEvent) => void>((): void => {});
  beforeInputRef.current = (event: InputEvent): void => {
    if (
      (event.inputType === "historyUndo" && stepEditableHistory("undo")) ||
      (event.inputType === "historyRedo" && stepEditableHistory("redo"))
    ) {
      event.preventDefault();
    }
  };
  useEffect(() => {
    const editable: HTMLDivElement | null = editableRef.current;
    if (mode !== "wysiwyg" || !editable) {
      return undefined;
    }
    const listener: (event: Event) => void = (event: Event): void => {
      beforeInputRef.current(event as InputEvent);
    };
    editable.addEventListener("beforeinput", listener);
    return () => {
      editable.removeEventListener("beforeinput", listener);
    };
  }, [mode]);

  const insertTextAtCursor: (textToInsert: string) => void = (
    textToInsert: string,
  ): void => {
    const textarea: HTMLTextAreaElement | null = textareaRef.current;
    const currentText: string = textRef.current;
    if (!textarea) {
      handleChange(currentText + textToInsert);
      return;
    }
    const start: number = textarea.selectionStart;
    const end: number = textarea.selectionEnd;
    const newText: string =
      currentText.substring(0, start) +
      textToInsert +
      currentText.substring(end);
    handleChange(newText);
    setTimeout(() => {
      const cursor: number = start + textToInsert.length;
      textarea.setSelectionRange(cursor, cursor);
      textarea.focus();
    }, 0);
  };

  const insertHtmlAtCursorInEditable: (html: string) => void = (
    html: string,
  ): void => {
    const editable: HTMLDivElement | null = editableRef.current;
    if (!editable) {
      return;
    }
    editable.focus();
    const selection: Selection | null = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      editable.innerHTML += html;
      syncFromEditable();
      return;
    }
    const range: Range = selection.getRangeAt(0);
    if (!editable.contains(range.commonAncestorContainer)) {
      // Selection is outside our editor; append.
      editable.innerHTML += html;
      syncFromEditable();
      return;
    }
    // Chromium's caret just before a list it has just made goes into its item.
    if (moveCaretIntoEmptyListAhead(editable, range)) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    /*
     * A single paragraph goes in as its contents, so text pasted into the
     * middle of a line joins that line. Inserted whole, the <p> landed
     * inside the paragraph the caret was in and the serializer wrote it out
     * as three: pasting "big " into "hello world" saved
     * "hello \n\nbig \n\nworld", and an uploading image's placeholder split
     * its line the same way. Straight into the editor itself -- empty, or
     * between two blocks -- the paragraph is kept.
     */
    const contents: string =
      range.startContainer === editable
        ? html
        : singleParagraphContents(html) ?? html;
    /*
     * execCommand puts the insert on the browser's undo stack. Plain words
     * go in with insertText, as if typed. Blocks go in with insertHTML only
     * onto an empty line: anywhere else in a line, Chromium and Safari fold
     * the first block into that line -- a <pre> became a monospace <span> of
     * the paragraph, and a code block pasted after "Run:" saved as
     * "Run:npm install" -- so there the line is split at the caret by hand
     * and the blocks go in between its halves. Words with formatting go in
     * by hand too: Chromium's and Firefox's insertHTML turn the spaces around
     * an inline insert into non-breaking ones, which then ended up in the
     * saved markdown. jsdom has no execCommand and a browser may refuse the
     * command, so the insert by hand is the fallback as well.
     */
    const inline: boolean = contents !== html;
    const plainText: string | null = inline
      ? textOfMarkupFreeHtml(contents)
      : null;
    let command: string | null = null;
    if (plainText !== null) {
      command = "insertText";
    } else if (!inline && isCaretOnEmptyLine(editable, range)) {
      command = "insertHTML";
    }
    if (command && typeof document.execCommand === "function") {
      try {
        if (document.execCommand(command, false, plainText ?? contents)) {
          syncFromEditable();
          return;
        }
      } catch {
        // Fall through to the insert by hand.
      }
    }
    editEditableByHand((): boolean => {
      deleteSelectionForInsert(editable, range);
      const fragment: DocumentFragment =
        range.createContextualFragment(contents);
      let caret: Range | null = null;
      if (inline) {
        const lastNode: ChildNode | null = fragment.lastChild;
        range.insertNode(fragment);
        if (lastNode) {
          caret = document.createRange();
          caret.setStartAfter(lastNode);
          caret.collapse(true);
        }
      } else {
        caret = insertBlocksAtCaret(editable, range, fragment);
      }
      if (caret) {
        selection.removeAllRanges();
        selection.addRange(caret);
      }
      return true;
    });
    syncFromEditable();
  };

  const insertMarkdownAtCursor: (md: string) => void = (md: string): void => {
    if (mode === "markdown") {
      insertTextAtCursor(md);
      return;
    }
    const html: string = sanitizeHtml(markdownToHtml(md));
    insertHtmlAtCursorInEditable(html);
  };

  const replacePlaceholderInText: (
    needle: string,
    replacement: string,
  ) => void = (needle: string, replacement: string): void => {
    const current: string = textRef.current;
    if (current.includes(needle)) {
      handleChange(current.split(needle).join(replacement));
    }
    /*
     * Also fix any matching <img>/anchor in the contenteditable so the
     * visible WYSIWYG view stays in sync without losing cursor.
     */
    if (mode === "wysiwyg") {
      const editable: HTMLDivElement | null = editableRef.current;
      if (editable) {
        const placeholderUrl: RegExpMatchArray | null =
          needle.match(/\(([^)]+)\)\s*$/);
        if (placeholderUrl && placeholderUrl[1]) {
          const url: string = placeholderUrl[1];
          const imgs: NodeListOf<HTMLImageElement> = editable.querySelectorAll(
            `img[src="${url}"]`,
          );
          if (imgs.length > 0) {
            const finalMatch: RegExpMatchArray | null = replacement.match(
              /^!\[([^\]]*)\]\(([^)]+)\)/,
            );
            if (finalMatch) {
              imgs.forEach((img: HTMLImageElement) => {
                img.setAttribute("alt", finalMatch[1] || "");
                img.setAttribute("src", finalMatch[2] || "");
              });
            } else {
              /*
               * Replacement isn't an image (e.g. error text). Replace each img
               * with a text node containing the replacement.
               */
              imgs.forEach((img: HTMLImageElement) => {
                const textNode: Text = document.createTextNode(replacement);
                img.parentNode?.replaceChild(textNode, img);
              });
            }
            syncFromEditable();
          }
        }
      }
    }
  };

  const uploadAndInsertImage: (file: File) => Promise<void> = async (
    file: File,
  ): Promise<void> => {
    const filename: string = file.name || `image-${Date.now()}.png`;
    const token: string = `${Date.now().toString(16)}-${Math.random()
      .toString(16)
      .slice(2)}`;
    const placeholderUrl: string = `oneuptime-uploading-${token}`;
    const placeholderMarkdown: string = `![Uploading ${filename}…](${placeholderUrl})`;

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      insertMarkdownAtCursor(`[Image "${filename}" exceeds the 10MB limit]`);
      return;
    }

    insertMarkdownAtCursor(placeholderMarkdown);

    try {
      const fileModel: FileModel = new FileModel();
      fileModel.name = filename;
      const arrayBuffer: ArrayBuffer = await file.arrayBuffer();
      fileModel.file = Buffer.from(new Uint8Array(arrayBuffer));
      /*
       * Inline-uploaded images start private. They become public only
       * when the parent (e.g. an incident post-mortem) is explicitly
       * published — see IncidentService.onUpdateSuccess for the flip.
       */
      fileModel.isPublic = false;
      fileModel.fileType = resolveImageMimeType(file);

      const result: HTTPResponse<FileModel> = (await ModelAPI.create<FileModel>(
        {
          model: fileModel,
          modelType: FileModel,
          requestOptions: {
            overrideRequestUrl: CommonURL.fromURL(FILE_URL),
          },
        },
      )) as HTTPResponse<FileModel>;

      const saved: FileModel | undefined = result.data as FileModel | undefined;
      const accessToken: string | undefined = saved?.imageAccessToken;
      if (!accessToken) {
        throw new Error(
          "Upload succeeded but no access token was returned for this file.",
        );
      }

      const imageUrl: string = CommonURL.fromURL(FILE_URL)
        .addRoute("/image/access-token/" + accessToken)
        .toString();
      replacePlaceholderInText(
        placeholderMarkdown,
        `![${filename}](${imageUrl})`,
      );
    } catch (err) {
      const errorMessage: string = API.getFriendlyMessage(err);
      replacePlaceholderInText(
        placeholderMarkdown,
        `[Upload failed for "${filename}": ${errorMessage}]`,
      );
    }
  };

  const handleImageFiles: (files: Array<File>) => Promise<void> = async (
    files: Array<File>,
  ): Promise<void> => {
    const images: Array<File> = files.filter(isImageFile);
    if (images.length === 0) {
      return;
    }
    await Promise.all(
      images.map((file: File) => {
        return uploadAndInsertImage(file);
      }),
    );
  };

  const extractImagesFromClipboard: (
    items: DataTransferItemList | null,
  ) => Array<File> = (items: DataTransferItemList | null): Array<File> => {
    if (!items) {
      return [];
    }
    const files: Array<File> = [];
    for (let i: number = 0; i < items.length; i++) {
      const item: DataTransferItem | null = items[i] || null;
      if (!item) {
        continue;
      }
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file: File | null = item.getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }
    return files;
  };

  /*
   * Text for the source textarea. execCommand("insertText") types it the
   * way a native paste would, so Ctrl+Z undoes it; where the browser has no
   * such command (jsdom) it is spliced into the value instead.
   */
  const insertTextInTextarea: (textToInsert: string) => void = (
    textToInsert: string,
  ): void => {
    const textarea: HTMLTextAreaElement | null = textareaRef.current;
    if (textarea && typeof document.execCommand === "function") {
      textarea.focus();
      try {
        if (document.execCommand("insertText", false, textToInsert)) {
          return;
        }
      } catch {
        // Fall back to splicing the value.
      }
    }
    insertTextAtCursor(textToInsert);
  };

  /*
   * Markdown mode. Rich clipboard content (a Word list, a copied note) is
   * converted to markdown source, and a file on the clipboard uploads as
   * before. When the conversion gives back exactly the plain text, the
   * browser's own paste inserts the same thing, so it is left to it.
   */
  const handleTextareaPaste: (
    e: React.ClipboardEvent<HTMLTextAreaElement>,
  ) => void = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const clipboardData: DataTransfer | null = e.clipboardData;
    if (!clipboardData) {
      return;
    }
    /*
     * Inside a fenced code block the text goes in as it is, the browser's
     * own paste (which keeps it on the undo stack) -- as in the visual
     * editor's code blocks. Converted there, a command copied from a docs
     * page came in as its own ``` fence, which closed the block around it,
     * and CLI output had its "1)" and "•" lines rewritten as list items. A
     * clipboard with no text, only an image, still uploads below.
     */
    const textarea: HTMLTextAreaElement = e.currentTarget;
    if (
      clipboardData.getData("text/plain") &&
      isInFencedCodeBlock(textarea.value, textarea.selectionStart)
    ) {
      return;
    }
    const images: Array<File> = allowImageUpload
      ? extractImagesFromClipboard(clipboardData.items || null)
      : [];
    const markdown: string | null = clipboardToMarkdown(clipboardData, {
      hasImageFiles: images.length > 0,
    });
    if (markdown === null) {
      if (images.length > 0) {
        e.preventDefault();
        void handleImageFiles(images);
      }
      return;
    }
    const plain: string = (clipboardData.getData("text/plain") || "").replace(
      RE_LINE_BREAKS,
      "\n",
    );
    if (markdown === plain) {
      return;
    }
    e.preventDefault();
    insertTextInTextarea(onLinesOfItsOwn(textarea, markdown));
  };

  // The code block the caret is in, if it is in one.
  const codeBlockAtSelection: () => HTMLElement | null =
    (): HTMLElement | null => {
      const editable: HTMLDivElement | null = editableRef.current;
      const selection: Selection | null = window.getSelection();
      if (!editable || !selection || selection.rangeCount === 0) {
        return null;
      }
      let node: Node | null = selection.getRangeAt(0).startContainer;
      while (node && node !== editable) {
        if (node.nodeName.toLowerCase() === "pre") {
          return node as HTMLElement;
        }
        node = node.parentNode;
      }
      return null;
    };

  const insertPlainTextInEditable: (value: string) => void = (
    value: string,
  ): void => {
    const editable: HTMLDivElement | null = editableRef.current;
    const selection: Selection | null = window.getSelection();
    if (!editable || !selection || selection.rangeCount === 0) {
      return;
    }
    const range: Range = selection.getRangeAt(0);
    editEditableByHand((): boolean => {
      deleteSelectionForInsert(editable, range);
      const textNode: Text = document.createTextNode(value);
      range.insertNode(textNode);
      const after: Range = document.createRange();
      after.setStartAfter(textNode);
      after.collapse(true);
      selection.removeAllRanges();
      selection.addRange(after);
      return true;
    });
    syncFromEditable();
  };

  // Remembers where the cursor is in the visual editor, when it is in it.
  const rememberEditableSelection: () => void = (): void => {
    const editable: HTMLDivElement | null = editableRef.current;
    const selection: Selection | null =
      typeof window !== "undefined" ? window.getSelection() : null;
    if (!editable || !selection || selection.rangeCount === 0) {
      return;
    }
    const range: Range = selection.getRangeAt(0);
    if (
      editable.contains(range.startContainer) &&
      editable.contains(range.endContainer)
    ) {
      savedRangeRef.current = range.cloneRange();
    }
  };

  // The remembered cursor, while it is still somewhere in the editor.
  const savedEditableRange: () => Range | null = (): Range | null => {
    const editable: HTMLDivElement | null = editableRef.current;
    const saved: Range | null = savedRangeRef.current;
    if (
      !editable ||
      !saved ||
      !editable.contains(saved.startContainer) ||
      !editable.contains(saved.endContainer)
    ) {
      return null;
    }
    return saved;
  };

  const closeEditableTrigger: () => void = (): void => {
    setEditableTrigger(null);
    setEditableActiveOptionId(undefined);
  };

  // Where the "{{" at `start` is on screen, for the list to open under it.
  const rectOfBraces: (node: Text, start: number) => DOMRect | null = (
    node: Text,
    start: number,
  ): DOMRect | null => {
    const range: Range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, Math.min(start + 2, node.data.length));
    const rect: DOMRect | null =
      typeof range.getBoundingClientRect === "function"
        ? range.getBoundingClientRect()
        : null;
    if (!isEmptyRect(rect)) {
      return rect;
    }
    return editableRef.current?.getBoundingClientRect() || null;
  };

  /*
   * The visual editor's cursor after "{{" opens the list of variables under
   * the braces, filtered by what follows them; anywhere else it closes.
   * Typing opens it; moving the cursor only keeps a list that is open (for
   * the braces it was opened for), so clicking into an old "{{" does not.
   */
  const updateEditableTrigger: (isTyping: boolean) => void = (
    isTyping: boolean,
  ): void => {
    if (!canPickVariables) {
      return;
    }
    const editable: HTMLDivElement | null = editableRef.current;
    const selection: Selection | null = window.getSelection();
    const node: Node | null = selection?.anchorNode || null;
    if (
      !editable ||
      !selection ||
      selection.rangeCount === 0 ||
      !selection.isCollapsed ||
      !node ||
      node.nodeType !== Node.TEXT_NODE ||
      !editable.contains(node)
    ) {
      if (editableTrigger) {
        closeEditableTrigger();
      }
      return;
    }
    const textNode: Text = node as Text;
    const trigger: TemplateVariableTrigger | null = findTemplateVariableTrigger(
      textNode.data,
      selection.anchorOffset,
    );
    const sameBraces: boolean = Boolean(
      trigger &&
        editableTrigger &&
        editableTrigger.node === textNode &&
        editableTrigger.trigger.start === trigger.start,
    );
    if (
      !trigger ||
      (!isTyping && !sameBraces) ||
      filterTemplateVariableGroups(
        templateVariables,
        trigger.query,
        describeVariable,
      ).length === 0
    ) {
      if (editableTrigger) {
        closeEditableTrigger();
      }
      return;
    }
    // The list stays where it opened while the rest of the name is typed.
    const rect: DOMRect | null =
      sameBraces && editableTrigger
        ? editableTrigger.rect
        : rectOfBraces(textNode, trigger.start);
    if (!rect) {
      return;
    }
    setEditableTrigger({ node: textNode, trigger: trigger, rect: rect });
  };

  /*
   * Puts {{name}} into the visual editor: over `range` (the braces and what
   * was typed after them), else where the cursor is or last was, else at the
   * end. It goes in as a paste of the same text would, so Ctrl+Z takes it
   * back and the markdown is updated.
   */
  const insertVariableInEditable: (
    variable: TemplateVariable,
    range: Range | null,
  ) => void = (variable: TemplateVariable, range: Range | null): void => {
    const editable: HTMLDivElement | null = editableRef.current;
    if (!editable) {
      return;
    }
    const selection: Selection | null = window.getSelection();
    const current: Range | null =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const isCurrentInEditor: boolean = Boolean(
      current &&
        editable.contains(current.startContainer) &&
        editable.contains(current.endContainer),
    );
    let target: Range | null =
      range || (isCurrentInEditor ? current : null) || savedEditableRange();
    if (!target) {
      // Never in the editor: on a line of its own at the end.
      target = document.createRange();
      target.selectNodeContents(editable);
      target.collapse(false);
    }
    // Focusing an editable that lost its selection puts the cursor at its start.
    const kept: Range = target.cloneRange();
    editable.focus();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(kept);
    }
    insertHtmlAtCursorInEditable(
      sanitizeHtml(markdownToHtml(formatTemplateVariable(variable.name))),
    );
    rememberEditableSelection();
  };

  // A pick from the list the visual editor's "{{" opened.
  const pickEditableVariable: (variable: TemplateVariable) => void = (
    variable: TemplateVariable,
  ): void => {
    const current: EditableVariableTrigger | null = editableTrigger;
    closeEditableTrigger();
    const editable: HTMLDivElement | null = editableRef.current;
    if (!current || !editable || !editable.contains(current.node)) {
      return;
    }
    const data: string = current.node.data;
    // What is typed after the braces now, if the cursor is still after them.
    let end: number = current.trigger.end;
    const selection: Selection | null = window.getSelection();
    if (selection && selection.anchorNode === current.node) {
      const now: TemplateVariableTrigger | null = findTemplateVariableTrigger(
        data,
        selection.anchorOffset,
      );
      if (now && now.start === current.trigger.start) {
        end = now.end;
      }
    }
    const range: Range = document.createRange();
    range.setStart(current.node, Math.min(current.trigger.start, data.length));
    range.setEnd(current.node, Math.min(end, data.length));
    insertVariableInEditable(variable, range);
  };

  // A pick from the toolbar button or the list under the editor.
  const insertVariableAtCursor: (variable: TemplateVariable) => void = (
    variable: TemplateVariable,
  ): void => {
    if (mode === "markdown") {
      sourceTyping.insertAtCursor(variable);
      return;
    }
    closeEditableTrigger();
    insertVariableInEditable(variable, null);
  };

  // Back into the editor, where its cursor was: the toolbar list closed.
  const focusEditor: () => void = (): void => {
    if (mode === "markdown") {
      textareaRef.current?.focus();
      return;
    }
    const editable: HTMLDivElement | null = editableRef.current;
    if (!editable) {
      return;
    }
    const saved: Range | null = savedEditableRange();
    editable.focus();
    const selection: Selection | null = window.getSelection();
    if (saved && selection) {
      selection.removeAllRanges();
      selection.addRange(saved.cloneRange());
    }
  };

  /*
   * Remember the visual editor's cursor wherever it moves, by keys or
   * clicks: a variable picked from a list, or a button picked from the More
   * formatting menu, goes where it was - both take the focus first.
   */
  useEffect(() => {
    if (mode !== "wysiwyg") {
      return undefined;
    }
    const listener: () => void = (): void => {
      rememberEditableSelection();
    };
    document.addEventListener("selectionchange", listener);
    return () => {
      document.removeEventListener("selectionchange", listener);
    };
  }, [mode]);

  /*
   * Visual mode. The browser's own paste would bring the source's markup in
   * with it -- styles, classes, elements markdown cannot hold -- so the paste
   * is always handled here: converted to markdown (the clipboard's HTML
   * first, so a Word or Outlook list keeps its nesting, then its plain text)
   * and rendered back. Image files upload when there is no text to paste.
   * Inside a code block the plain text goes in as it is.
   */
  const handleEditablePaste: (
    e: React.ClipboardEvent<HTMLDivElement>,
  ) => void = (e: React.ClipboardEvent<HTMLDivElement>): void => {
    const clipboardData: DataTransfer | null = e.clipboardData;
    if (!clipboardData) {
      return;
    }
    e.preventDefault();
    if (codeBlockAtSelection()) {
      const plain: string = clipboardData.getData("text/plain") || "";
      if (plain) {
        insertPlainTextInEditable(plain.replace(RE_LINE_BREAKS, "\n"));
      }
      return;
    }
    const images: Array<File> = allowImageUpload
      ? extractImagesFromClipboard(clipboardData.items || null)
      : [];
    const markdown: string | null = clipboardToMarkdown(clipboardData, {
      hasImageFiles: images.length > 0,
    });
    if (markdown !== null) {
      if (markdown) {
        insertMarkdownAtCursor(markdown);
      }
      return;
    }
    if (images.length > 0) {
      void handleImageFiles(images);
    }
  };

  const dragHasFiles: (types: ReadonlyArray<string> | undefined) => boolean = (
    types: ReadonlyArray<string> | undefined,
  ): boolean => {
    if (!types) {
      return false;
    }
    for (let i: number = 0; i < types.length; i++) {
      if (types[i] === "Files") {
        return true;
      }
    }
    return false;
  };

  const handleDragOver: (e: React.DragEvent<HTMLElement>) => void = (
    e: React.DragEvent<HTMLElement>,
  ): void => {
    if (!dragHasFiles(e.dataTransfer?.types as ReadonlyArray<string>)) {
      return;
    }
    e.preventDefault();
    if (!allowImageUpload) {
      /*
       * Refuse the drop outright. Left to itself the browser would drop the
       * file in anyway -- Firefox inlines an image as a data: URL -- or
       * navigate away to it.
       */
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "none";
      }
      return;
    }
    if (!isDraggingOver) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave: (e: React.DragEvent<HTMLElement>) => void = (
    _e: React.DragEvent<HTMLElement>,
  ): void => {
    setIsDraggingOver(false);
  };

  const handleDrop: (e: React.DragEvent<HTMLElement>) => void = (
    e: React.DragEvent<HTMLElement>,
  ): void => {
    if (!dragHasFiles(e.dataTransfer?.types as ReadonlyArray<string>)) {
      return;
    }
    e.preventDefault();
    setIsDraggingOver(false);
    if (!allowImageUpload) {
      return;
    }
    const fileList: FileList | null = e.dataTransfer?.files || null;
    if (!fileList || fileList.length === 0) {
      return;
    }
    const files: Array<File> = Array.from(fileList);
    void handleImageFiles(files);
  };

  const handleImageButtonClick: () => void = (): void => {
    if (!allowImageUpload) {
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileInputChange: (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => void = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const fileList: FileList | null = e.target.files;
    if (!fileList || fileList.length === 0) {
      return;
    }
    const files: Array<File> = Array.from(fileList);
    void handleImageFiles(files);
    // Reset so selecting the same file again still triggers onChange
    e.target.value = "";
  };

  // Markdown-mode toolbar helpers (operate on the textarea string).
  const insertText: (
    before: string,
    after?: string,
    placeholder?: string,
  ) => void = (
    before: string,
    after: string = "",
    placeholder: string = "",
  ): void => {
    const textarea: HTMLTextAreaElement | null = textareaRef.current;
    if (!textarea) {
      return;
    }

    const start: number = textarea.selectionStart;
    const end: number = textarea.selectionEnd;
    const selectedText: string = text.substring(start, end);
    const textToInsert: string = selectedText || placeholder;

    const newText: string =
      text.substring(0, start) +
      before +
      textToInsert +
      after +
      text.substring(end);

    handleChange(newText);

    setTimeout(() => {
      if (selectedText) {
        textarea.setSelectionRange(
          start + before.length,
          start + before.length + textToInsert.length,
        );
      } else {
        textarea.setSelectionRange(
          start + before.length,
          start + before.length + placeholder.length,
        );
      }
      textarea.focus();
    }, 0);
  };

  const insertAtLineStart: (prefix: string) => void = (
    prefix: string,
  ): void => {
    const textarea: HTMLTextAreaElement | null = textareaRef.current;
    if (!textarea) {
      return;
    }

    const start: number = textarea.selectionStart;
    const lineStart: number = text.lastIndexOf("\n", start - 1) + 1;
    const lineEnd: number = text.indexOf("\n", start);
    const actualLineEnd: number = lineEnd === -1 ? text.length : lineEnd;

    const currentLine: string = text.substring(lineStart, actualLineEnd);

    if (prefix.startsWith("#")) {
      const cleanLine: string = currentLine.replace(/^#+\s*/, "");

      if (currentLine.startsWith(prefix)) {
        const newText: string =
          text.substring(0, lineStart) +
          cleanLine +
          text.substring(actualLineEnd);
        handleChange(newText);
        setTimeout(() => {
          textarea.setSelectionRange(
            start - prefix.length,
            start - prefix.length,
          );
          textarea.focus();
        }, 0);
      } else {
        const newText: string =
          text.substring(0, lineStart) +
          prefix +
          cleanLine +
          text.substring(actualLineEnd);
        handleChange(newText);
        setTimeout(() => {
          const adjustment: number =
            prefix.length - (currentLine.length - cleanLine.length);
          textarea.setSelectionRange(start + adjustment, start + adjustment);
          textarea.focus();
        }, 0);
      }
    } else if (currentLine.startsWith(prefix)) {
      const newText: string =
        text.substring(0, lineStart) +
        currentLine.substring(prefix.length) +
        text.substring(actualLineEnd);
      handleChange(newText);
      setTimeout(() => {
        textarea.setSelectionRange(
          start - prefix.length,
          start - prefix.length,
        );
        textarea.focus();
      }, 0);
    } else {
      const newText: string =
        text.substring(0, lineStart) +
        prefix +
        currentLine +
        text.substring(actualLineEnd);
      handleChange(newText);
      setTimeout(() => {
        textarea.setSelectionRange(
          start + prefix.length,
          start + prefix.length,
        );
        textarea.focus();
      }, 0);
    }
  };

  /*
   * Puts an edit into the source textarea, selection included. Only the
   * stretch that changed is replaced, with execCommand("insertText") where
   * the browser has it, so Ctrl+Z undoes an indent like any typing; without
   * it (jsdom) the value is set directly.
   */
  const applyTextareaEdit: (edit: MarkdownTextEdit) => void = (
    edit: MarkdownTextEdit,
  ): void => {
    const textarea: HTMLTextAreaElement | null = textareaRef.current;
    if (!textarea) {
      return;
    }
    const current: string = textarea.value;
    let start: number = 0;
    while (
      start < current.length &&
      start < edit.text.length &&
      current.charAt(start) === edit.text.charAt(start)
    ) {
      start++;
    }
    let oldEnd: number = current.length;
    let newEnd: number = edit.text.length;
    while (
      oldEnd > start &&
      newEnd > start &&
      current.charAt(oldEnd - 1) === edit.text.charAt(newEnd - 1)
    ) {
      oldEnd--;
      newEnd--;
    }
    textarea.focus();
    let applied: boolean = false;
    if (typeof document.execCommand === "function") {
      textarea.setSelectionRange(start, oldEnd);
      try {
        applied = document.execCommand(
          "insertText",
          false,
          edit.text.slice(start, newEnd),
        );
      } catch {
        applied = false;
      }
    }
    if (!applied || textarea.value !== edit.text) {
      textarea.value = edit.text;
    }
    if (textRef.current !== edit.text) {
      handleChange(edit.text);
    }
    textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
  };

  // Runs a source edit on the textarea's text and selection; false if it changed nothing.
  const editTextarea: (editor: MarkdownTextEditor) => boolean = (
    editor: MarkdownTextEditor,
  ): boolean => {
    const textarea: HTMLTextAreaElement | null = textareaRef.current;
    if (!textarea) {
      return false;
    }
    const edit: MarkdownTextEdit | null = editor(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd,
    );
    if (!edit) {
      return false;
    }
    applyTextareaEdit(edit);
    return true;
  };

  const toggleListInTextarea: (kind: MarkdownListKind) => void = (
    kind: MarkdownListKind,
  ): void => {
    editTextarea(
      (source: string, selectionStart: number, selectionEnd: number) => {
        return toggleMarkdownList(source, selectionStart, selectionEnd, kind);
      },
    );
  };

  /*
   * Indent or outdent the list items at the selection in the visual editor;
   * false (and nothing changed) when the selection is not on an item that
   * can move. The items are moved by hand, so the move is recorded for
   * Ctrl+Z: it undid the typing before an indent and left the indent.
   */
  const shiftListItemsInEditable: (outdent: boolean) => boolean = (
    outdent: boolean,
  ): boolean => {
    const changed: boolean = editEditableByHand(
      (editable: HTMLDivElement): boolean => {
        return outdent ? liftListItems(editable) : sinkListItems(editable);
      },
    );
    if (changed) {
      syncFromEditable();
    }
    return changed;
  };

  // WYSIWYG-mode toolbar helpers (operate on the contenteditable DOM).
  const execEditable: (
    command: string,
    value?: string,
    afterCommand?: (editable: HTMLDivElement) => void,
  ) => void = (
    command: string,
    value?: string,
    afterCommand?: (editable: HTMLDivElement) => void,
  ): void => {
    const editable: HTMLDivElement | null = editableRef.current;
    if (!editable) {
      return;
    }
    editable.focus();
    try {
      /*
       * execCommand is deprecated but still implemented in all major
       * browsers and remains the most reliable cross-browser way to
       * apply contenteditable formatting without pulling in a library.
       */
      document.execCommand(command, false, value);
    } catch {
      // Ignore — older command names occasionally throw in some browsers.
    }
    if (afterCommand) {
      afterCommand(editable);
    }
    syncFromEditable();
  };

  /*
   * The list buttons. execCommand turns the selected lines into items but
   * keeps whatever text they started with, so a line pasted from Word as
   * "•\tService down" showed the list's bullet and its own; the leftover
   * markers are stripped from the items it made.
   */
  const makeListInEditable: (command: string) => void = (
    command: string,
  ): void => {
    execEditable(command, undefined, (editable: HTMLDivElement): void => {
      stripTextListMarkers(editable);
    });
  };

  const wrapSelectionInEditable: (
    tagName: string,
    fallbackText: string,
  ) => void = (tagName: string, fallbackText: string): void => {
    const editable: HTMLDivElement | null = editableRef.current;
    if (!editable) {
      return;
    }
    editable.focus();
    const selection: Selection | null = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      insertHtmlAtCursorInEditable(`<${tagName}>${fallbackText}</${tagName}>`);
      return;
    }
    const range: Range = selection.getRangeAt(0);
    const selected: string = selection.toString() || fallbackText;
    const wrapper: HTMLElement = document.createElement(tagName);
    wrapper.textContent = selected;
    editEditableByHand((): boolean => {
      deleteSelectionForInsert(editable, range);
      range.insertNode(wrapper);
      const newRange: Range = document.createRange();
      newRange.selectNodeContents(wrapper);
      selection.removeAllRanges();
      selection.addRange(newRange);
      return true;
    });
    syncFromEditable();
  };

  const insertWysiwygTaskList: () => void = (): void => {
    const editable: HTMLDivElement | null = editableRef.current;
    if (!editable) {
      return;
    }
    editable.focus();
    const html: string =
      '<ul class="task-list"><li class="task-list-item"><input type="checkbox" disabled> Task</li></ul>';
    insertHtmlAtCursorInEditable(html);
  };

  const insertWysiwygLink: () => void = (): void => {
    if (typeof window === "undefined") {
      return;
    }
    const url: string | null = window.prompt("Enter URL", "https://");
    if (!url) {
      return;
    }
    const selection: Selection | null = window.getSelection();
    const hasSelection: boolean = Boolean(
      selection && !selection.isCollapsed && selection.toString().length > 0,
    );
    if (hasSelection) {
      execEditable("createLink", url);
    } else {
      /*
       * Wrapped in a paragraph, so a link put into a line goes in as that
       * line's own inline content (insertHtmlAtCursorInEditable unwraps a
       * single paragraph). A bare <a> was taken for a block: it split the
       * line, and "See " plus the link saved as two paragraphs. Into the
       * empty editor the paragraph goes in whole.
       */
      insertHtmlAtCursorInEditable(
        `<p><a href="${url.replace(/"/g, "&quot;")}">${url.replace(/</g, "&lt;")}</a></p>`,
      );
    }
  };

  /*
   * The Code Block button. As in the markdown source, the new block's
   * placeholder is selected, so what is typed next replaces it inside the
   * block. Left to themselves, browsers put the caret at the end of the
   * placeholder (Chromium, Safari) or on the line below the block (Firefox).
   * The empty line after the block (a <br> keeps it a line a caret can sit
   * on) is where writing carries on below it.
   */
  const insertWysiwygCodeBlock: () => void = (): void => {
    const editable: HTMLDivElement | null = editableRef.current;
    if (!editable) {
      return;
    }
    const existing: Set<Element> = new Set<Element>(
      Array.from(editable.querySelectorAll("pre")),
    );
    insertHtmlAtCursorInEditable(
      "<pre><code>code block</code></pre><p><br></p>",
    );
    const added: Array<Element> = Array.from(
      editable.querySelectorAll("pre"),
    ).filter((pre: Element): boolean => {
      return !existing.has(pre);
    });
    const block: Element | undefined = added[added.length - 1];
    const selection: Selection | null = window.getSelection();
    if (!block || !selection) {
      return;
    }
    const placeholder: Range = document.createRange();
    placeholder.selectNodeContents(block.querySelector("code") || block);
    selection.removeAllRanges();
    selection.addRange(placeholder);
  };

  const insertWysiwygTable: () => void = (): void => {
    const html: string =
      "<table><thead><tr><th>Header 1</th><th>Header 2</th><th>Header 3</th></tr></thead>" +
      "<tbody>" +
      "<tr><td>Cell 1</td><td>Cell 2</td><td>Cell 3</td></tr>" +
      "<tr><td>Cell 4</td><td>Cell 5</td><td>Cell 6</td></tr>" +
      "</tbody></table><p><br></p>";
    insertHtmlAtCursorInEditable(html);
  };

  const formatActions: {
    bold: () => void;
    italic: () => void;
    underline: () => void;
    strikethrough: () => void;
    heading1: () => void;
    heading2: () => void;
    heading3: () => void;
    unorderedList: () => void;
    orderedList: () => void;
    taskList: () => void;
    indent: () => void;
    outdent: () => void;
    link: () => void;
    image: () => void;
    code: () => void;
    codeBlock: () => void;
    quote: () => void;
    horizontalRule: () => void;
    table: () => void;
  } = {
    bold: () => {
      if (mode === "wysiwyg") {
        return execEditable("bold");
      }
      return insertText("**", "**", "bold text");
    },
    italic: () => {
      if (mode === "wysiwyg") {
        return execEditable("italic");
      }
      return insertText("*", "*", "italic text");
    },
    underline: () => {
      if (mode === "wysiwyg") {
        return execEditable("underline");
      }
      return insertText("<u>", "</u>", "underlined text");
    },
    strikethrough: () => {
      if (mode === "wysiwyg") {
        return execEditable("strikeThrough");
      }
      return insertText("~~", "~~", "strikethrough text");
    },
    heading1: () => {
      if (mode === "wysiwyg") {
        return execEditable("formatBlock", "h1");
      }
      return insertAtLineStart("# ");
    },
    heading2: () => {
      if (mode === "wysiwyg") {
        return execEditable("formatBlock", "h2");
      }
      return insertAtLineStart("## ");
    },
    heading3: () => {
      if (mode === "wysiwyg") {
        return execEditable("formatBlock", "h3");
      }
      return insertAtLineStart("### ");
    },
    unorderedList: () => {
      if (mode === "wysiwyg") {
        return makeListInEditable("insertUnorderedList");
      }
      return toggleListInTextarea("bullet");
    },
    orderedList: () => {
      if (mode === "wysiwyg") {
        return makeListInEditable("insertOrderedList");
      }
      return toggleListInTextarea("ordered");
    },
    taskList: () => {
      if (mode === "wysiwyg") {
        return insertWysiwygTaskList();
      }
      return toggleListInTextarea("task");
    },
    indent: () => {
      if (mode === "wysiwyg") {
        editableRef.current?.focus();
        shiftListItemsInEditable(false);
        return;
      }
      editTextarea(indentMarkdownLines);
    },
    outdent: () => {
      if (mode === "wysiwyg") {
        editableRef.current?.focus();
        shiftListItemsInEditable(true);
        return;
      }
      editTextarea(outdentMarkdownLines);
    },
    link: () => {
      if (mode === "wysiwyg") {
        return insertWysiwygLink();
      }
      return insertText("[", "](url)", "link text");
    },
    image: () => {
      return handleImageButtonClick();
    },
    code: () => {
      if (mode === "wysiwyg") {
        return wrapSelectionInEditable("code", "code");
      }
      return insertText("`", "`", "code");
    },
    codeBlock: () => {
      if (mode === "wysiwyg") {
        return insertWysiwygCodeBlock();
      }
      return insertText("```\n", "\n```", "code block");
    },
    quote: () => {
      if (mode === "wysiwyg") {
        return execEditable("formatBlock", "blockquote");
      }
      return insertAtLineStart("> ");
    },
    horizontalRule: () => {
      if (mode === "wysiwyg") {
        return execEditable("insertHorizontalRule");
      }
      return insertText("\n---\n", "", "");
    },
    table: () => {
      if (mode === "wysiwyg") {
        return insertWysiwygTable();
      }
      return insertText(
        "\n| Header 1 | Header 2 | Header 3 |\n|----------|----------|----------|\n| Cell 1   | Cell 2   | Cell 3   |\n| Cell 4   | Cell 5   | Cell 6   |\n",
        "",
        "",
      );
    },
  };

  /*
   * The formatting buttons, in toolbar order. Those that do not fit on the
   * toolbar's one line are items of its More formatting menu instead (see
   * MarkdownToolbarLayout): same order, same words.
   */
  const toolbarActions: Array<ToolbarAction> = [
    {
      label: "Bold",
      shortcut: KeyboardKeyUtil.getDisplayLabel([KeyboardKey.Mod, "B"]),
      group: "text",
      icon: IconProp.Bold,
      onClick: formatActions.bold,
    },
    {
      label: "Italic",
      shortcut: KeyboardKeyUtil.getDisplayLabel([KeyboardKey.Mod, "I"]),
      group: "text",
      icon: IconProp.Italic,
      onClick: formatActions.italic,
    },
    {
      label: "Underline",
      group: "text",
      icon: IconProp.Underline,
      onClick: formatActions.underline,
    },
    {
      label: "Strikethrough",
      group: "text",
      icon: IconProp.Strikethrough,
      onClick: formatActions.strikethrough,
    },
    {
      label: "Heading 1",
      group: "headings",
      glyph: "H1",
      onClick: formatActions.heading1,
    },
    {
      label: "Heading 2",
      group: "headings",
      glyph: "H2",
      onClick: formatActions.heading2,
    },
    {
      label: "Heading 3",
      group: "headings",
      glyph: "H3",
      onClick: formatActions.heading3,
    },
    {
      label: "Bullet List",
      group: "lists",
      icon: IconProp.ListBullet,
      onClick: formatActions.unorderedList,
    },
    {
      label: "Numbered List",
      group: "lists",
      icon: IconProp.List,
      onClick: formatActions.orderedList,
    },
    {
      label: "Task List",
      group: "lists",
      icon: IconProp.Check,
      onClick: formatActions.taskList,
    },
    {
      label: "Indent",
      shortcut: KeyboardKeyUtil.getDisplayLabel([KeyboardKey.Tab]),
      group: "lists",
      icon: IconProp.Indent,
      onClick: formatActions.indent,
    },
    {
      label: "Outdent",
      shortcut: KeyboardKeyUtil.getDisplayLabel([
        KeyboardKey.Shift,
        KeyboardKey.Tab,
      ]),
      group: "lists",
      icon: IconProp.Outdent,
      onClick: formatActions.outdent,
    },
    {
      label: "Link",
      group: "insert",
      icon: IconProp.Link,
      onClick: formatActions.link,
    },
    ...(allowImageUpload
      ? [
          {
            label: "Upload Image",
            group: "insert" as ToolbarGroup,
            icon: IconProp.Image,
            onClick: formatActions.image,
          },
        ]
      : []),
    {
      label: "Code",
      group: "insert",
      icon: IconProp.Code,
      onClick: formatActions.code,
    },
    {
      label: "Table",
      group: "blocks",
      icon: IconProp.TableCells,
      onClick: formatActions.table,
    },
    {
      label: "Horizontal Rule",
      group: "blocks",
      icon: IconProp.Minus,
      onClick: formatActions.horizontalRule,
    },
    {
      label: "Quote",
      group: "blocks",
      glyph: '"',
      onClick: formatActions.quote,
    },
    {
      label: "Code Block",
      group: "blocks",
      glyph: "{}",
      isGlyphMonospace: true,
      onClick: formatActions.codeBlock,
    },
  ];

  const toolbarGroupSizes: Array<number> = TOOLBAR_GROUPS.map(
    (group: ToolbarGroup): number => {
      return toolbarActions.filter((action: ToolbarAction): boolean => {
        return action.group === group;
      }).length;
    },
  );
  const toolbarGroupSizesKey: string = toolbarGroupSizes.join(",");

  const tx: (value: string) => string = (value: string): string => {
    return translateString(value) || value;
  };

  const getToolbarActionTitle: (action: ToolbarAction) => string = (
    action: ToolbarAction,
  ): string => {
    return action.shortcut
      ? `${tx(action.label)} (${action.shortcut})`
      : tx(action.label);
  };

  const moreFormattingLabel: string = tx("More formatting");
  const modeToggleTitle: string =
    mode === "wysiwyg"
      ? tx("Switch to markdown source")
      : tx("Switch to visual editor");

  /*
   * How much of the toolbar is on its line (MarkdownToolbarLayout). Starts
   * with everything, as it is wherever nothing can be measured, and is
   * fitted before the first paint and again whenever the line, the switch
   * or Insert variable changes size: the dialog or the window resized, a
   * font arrived, the switch now reads Visual.
   */
  const toolbarLineRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const modeToggleRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const variableButtonRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  /*
   * The switch as last measured on the line, as each of its two words, for
   * the fitting to use while it is in the menu.
   */
  const modeToggleWidthsRef: React.MutableRefObject<{
    [key in EditorMode]?: number | undefined;
  }> = useRef({});
  const [toolbarLayout, setToolbarLayout] = useState<MarkdownToolbarLayout>(
    (): MarkdownToolbarLayout => {
      return getFullToolbarLayout(toolbarGroupSizes);
    },
  );
  const toolbarLayoutRef: React.MutableRefObject<MarkdownToolbarLayout> =
    useRef<MarkdownToolbarLayout>(toolbarLayout);
  toolbarLayoutRef.current = toolbarLayout;

  const fitToolbar: () => void = (): void => {
    const line: HTMLDivElement | null = toolbarLineRef.current;

    if (!line) {
      return;
    }

    const modeToggleWidths: { [key in EditorMode]?: number | undefined } =
      modeToggleWidthsRef.current;
    const current: MarkdownToolbarLayout = toolbarLayoutRef.current;

    const modeToggleWidth: number = modeToggleRef.current?.offsetWidth || 0;

    if (modeToggleWidth > 0) {
      modeToggleWidths[mode] = modeToggleWidth;
    }

    const next: MarkdownToolbarLayout = fitMarkdownToolbar({
      availableWidth: line.clientWidth,
      groupSizes: toolbarGroupSizes,
      modeToggleWidth:
        modeToggleWidths[mode] ||
        modeToggleWidths[mode === "wysiwyg" ? "markdown" : "wysiwyg"] ||
        ESTIMATED_MODE_TOGGLE_PX,
      // Always on the line, so always measured as it is.
      variableButtonWidth: variableButtonRef.current?.offsetWidth || 0,
    });

    if (!isSameToolbarLayout(current, next)) {
      toolbarLayoutRef.current = next;
      setToolbarLayout(next);
    }
  };

  const fitToolbarRef: React.MutableRefObject<() => void> =
    useRef<() => void>(fitToolbar);
  fitToolbarRef.current = fitToolbar;

  /*
   * Before paint, so the toolbar is never drawn with buttons that do not
   * fit; again after each change of layout, to measure what it put on the
   * line.
   */
  useLayoutEffect(() => {
    fitToolbarRef.current();
  }, [
    mode,
    canPickVariables,
    toolbarGroupSizesKey,
    modeToggleTitle,
    toolbarLayout,
  ]);

  useEffect(() => {
    const line: HTMLDivElement | null = toolbarLineRef.current;

    if (!line || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    /*
     * A frame later, not inside the observer's callback: fitting changes
     * what is on the line, and a size change made inside the callback is
     * reported as a ResizeObserver loop error.
     */
    let frame: number | null = null;
    // Apart from the frame's id, which a frame run at once comes back after.
    let isFitScheduled: boolean = false;

    const observer: ResizeObserver = new ResizeObserver((): void => {
      if (isFitScheduled) {
        return;
      }

      isFitScheduled = true;
      frame = window.requestAnimationFrame((): void => {
        isFitScheduled = false;
        frame = null;
        fitToolbarRef.current();
      });
    });

    observer.observe(line);

    if (modeToggleRef.current) {
      observer.observe(modeToggleRef.current);
    }

    if (variableButtonRef.current) {
      observer.observe(variableButtonRef.current);
    }

    return () => {
      observer.disconnect();

      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [canPickVariables, toolbarLayout.isModeToggleInBar]);

  const visibleToolbarActions: Array<ToolbarAction> = toolbarActions.slice(
    0,
    toolbarLayout.visibleButtonCount,
  );
  const menuToolbarActions: Array<ToolbarAction> = toolbarActions.slice(
    toolbarLayout.visibleButtonCount,
  );

  /*
   * A pick from the More formatting menu: back into the editor first, to
   * where its cursor was - the menu took the focus - then the action, as a
   * click on its button would do it.
   */
  const runFromMoreMenu: (onClick: () => void) => void = (
    onClick: () => void,
  ): void => {
    focusEditor();
    onClick();
  };

  const toggleMode: () => void = (): void => {
    setMode((current: EditorMode): EditorMode => {
      return current === "wysiwyg" ? "markdown" : "wysiwyg";
    });
  };

  const moreMenuItems: Array<ReactElement> = [];

  menuToolbarActions.forEach((action: ToolbarAction, index: number) => {
    const previous: ToolbarAction | undefined = menuToolbarActions[index - 1];

    if (previous && previous.group !== action.group) {
      moreMenuItems.push(
        <div
          key={`separator-${action.label}`}
          role="separator"
          className="mx-3 my-1 border-t border-gray-100"
        />,
      );
    }

    moreMenuItems.push(
      <MoreMenuItem
        key={action.label}
        text={tx(action.label)}
        icon={action.icon}
        iconElement={
          action.icon ? undefined : (
            <span
              className={`${
                action.isGlyphMonospace ? "font-mono " : ""
              }text-xs font-bold leading-none`}
            >
              {action.glyph}
            </span>
          )
        }
        rightElement={
          action.shortcut ? (
            <span className="ml-3 text-xs font-normal text-gray-400">
              {action.shortcut}
            </span>
          ) : undefined
        }
        onClick={() => {
          runFromMoreMenu(action.onClick);
        }}
      />,
    );
  });

  if (!toolbarLayout.isModeToggleInBar) {
    if (moreMenuItems.length > 0) {
      moreMenuItems.push(
        <div
          key="separator-mode"
          role="separator"
          className="mx-3 my-1 border-t border-gray-100"
        />,
      );
    }

    moreMenuItems.push(
      <MoreMenuItem
        key="mode"
        text={modeToggleTitle}
        icon={mode === "wysiwyg" ? IconProp.Code : IconProp.Eye}
        onClick={toggleMode}
      />,
    );
  }

  let className: string = "";
  if (!props.className) {
    className =
      "block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y";
  } else {
    className = props.className;
  }

  if (props.error) {
    className +=
      " border-red-300 pr-10 text-red-900 placeholder-red-300 focus:border-red-500 focus:outline-none focus:ring-red-500";
  }

  const wysiwygClassName: string = `oneuptime-wysiwyg block w-full min-h-32 rounded-md rounded-t-none border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
    props.error
      ? "border-red-300 pr-10 text-red-900 focus:border-red-500 focus:outline-none focus:ring-red-500"
      : ""
  } ${
    isDraggingOver
      ? "ring-2 ring-indigo-400 ring-offset-1 border-indigo-400"
      : ""
  }`;

  const handleEditableKeyDown: (
    e: React.KeyboardEvent<HTMLDivElement>,
  ) => void = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    /*
     * While the list "{{" opened is showing, its keys are its own: the
     * arrows move through it, Enter and Tab pick, and Escape closes the list
     * - not the dialog the editor is in.
     */
    if (editableTrigger) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeEditableTrigger();
        return;
      }
      if (variableMenuRef.current?.handleKeyDown(e)) {
        e.stopPropagation();
        return;
      }
    }
    /*
     * Ctrl+Z right after an edit the editor made itself -- a list move, an
     * insert made by hand -- takes that edit back, and Ctrl+Shift+Z makes
     * it again. Otherwise the key is the browser's, as always.
     */
    const historyStep: HistoryStep | null = historyStepOfKey(e);
    if (historyStep && stepEditableHistory(historyStep)) {
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      switch (e.key) {
        case "b":
          e.preventDefault();
          formatActions.bold();
          break;
        case "i":
          e.preventDefault();
          formatActions.italic();
          break;
        default:
          break;
      }
    }
    /*
     * Tab indents a list item and Shift+Tab outdents it -- but the key is
     * only taken when that actually moved something. On a list's first
     * item, a top-level item, or outside a list, Tab keeps moving focus to
     * the next field (and Shift+Tab to the previous one), so the editor is
     * never a keyboard trap. The event is not stopped either: the note
     * composer handles its own keys where they bubble to.
     */
    if (isListIndentKey(e) && shiftListItemsInEditable(e.shiftKey)) {
      e.preventDefault();
    }
  };

  const handleTextareaKeyDown: (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => void = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // The list "{{" opened takes its keys first, as in the visual editor.
    if (sourceTyping.handleKeyDown(e)) {
      e.stopPropagation();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      switch (e.key) {
        case "b":
          e.preventDefault();
          formatActions.bold();
          break;
        case "i":
          e.preventDefault();
          formatActions.italic();
          break;
      }
    }
    // The same Tab rule as the visual editor's, on the markdown lines.
    if (
      isListIndentKey(e) &&
      editTextarea(e.shiftKey ? outdentMarkdownLines : indentMarkdownLines)
    ) {
      e.preventDefault();
    }
  };

  return (
    <div className="relative" data-testid={props.dataTestId}>
      {/* Inline styles to keep WYSIWYG view visually formatted. */}
      <style>{`
        .oneuptime-wysiwyg h1 { font-size: 1.5rem; font-weight: 700; margin: 0.5rem 0; }
        .oneuptime-wysiwyg h2 { font-size: 1.25rem; font-weight: 700; margin: 0.5rem 0; }
        .oneuptime-wysiwyg h3 { font-size: 1.125rem; font-weight: 600; margin: 0.5rem 0; }
        .oneuptime-wysiwyg p { margin: 0.5rem 0; }
        .oneuptime-wysiwyg ul, .oneuptime-wysiwyg ol { margin: 0.5rem 0 0.5rem 1.5rem; }
        .oneuptime-wysiwyg ul { list-style-type: disc; }
        /* Nested bullets step through circle and square, as MarkdownViewer draws them. */
        .oneuptime-wysiwyg ul ul, .oneuptime-wysiwyg ol ul { list-style-type: circle; }
        .oneuptime-wysiwyg ul ul ul, .oneuptime-wysiwyg ul ol ul, .oneuptime-wysiwyg ol ul ul, .oneuptime-wysiwyg ol ol ul { list-style-type: square; }
        .oneuptime-wysiwyg ol { list-style-type: decimal; }
        .oneuptime-wysiwyg ul.task-list, .oneuptime-wysiwyg ul.task-list li { list-style: none; margin-left: 0; }
        .oneuptime-wysiwyg ul.task-list li { padding-left: 0; }
        .oneuptime-wysiwyg blockquote { border-left: 3px solid var(--ou-border-strong, #d1d5db); padding-left: 0.75rem; color: var(--ou-text-secondary, #4b5563); margin: 0.5rem 0; }
        .oneuptime-wysiwyg pre { background: var(--ou-surface-tertiary, #f3f4f6); border-radius: 0.375rem; padding: 0.75rem; overflow-x: auto; margin: 0.5rem 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.85rem; }
        .oneuptime-wysiwyg code { background: var(--ou-surface-tertiary, #f3f4f6); padding: 0 0.25rem; border-radius: 0.25rem; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.85em; }
        .oneuptime-wysiwyg pre code { background: transparent; padding: 0; }
        .oneuptime-wysiwyg a { color: var(--ou-link, #4f46e5); text-decoration: underline; }
        .oneuptime-wysiwyg hr { margin: 1rem 0; border: 0; border-top: 1px solid var(--ou-border-default, #e5e7eb); }
        .oneuptime-wysiwyg table { border-collapse: collapse; margin: 0.5rem 0; }
        .oneuptime-wysiwyg th, .oneuptime-wysiwyg td { border: 1px solid var(--ou-border-default, #e5e7eb); padding: 0.25rem 0.5rem; }
        .oneuptime-wysiwyg th { background: var(--ou-surface-secondary, #f9fafb); font-weight: 600; }
        .oneuptime-wysiwyg img { max-width: 100%; height: auto; }
        .oneuptime-wysiwyg:empty::before { content: attr(data-placeholder); color: var(--ou-text-subtle, #9ca3af); pointer-events: none; }
      `}</style>

      {/*
       * Toolbar: one line at any width. The formatting buttons that do not
       * fit go, from the end, under More formatting (...); the switch and
       * Insert variable stay (see MarkdownToolbarLayout). Its own width never
       * pushes the form it is in wider - contain: inline-size - since how
       * much of it shows follows the width it is given.
       */}
      <div
        data-testid="markdown-editor-toolbar"
        className="overflow-hidden p-2 bg-gray-50 border border-gray-300 rounded-t-md border-b-0"
        style={{ contain: "inline-size" }}
      >
        <div
          ref={toolbarLineRef}
          data-testid="markdown-editor-toolbar-line"
          className="flex items-center gap-1"
        >
          {visibleToolbarActions.map((action: ToolbarAction, index: number) => {
            const previous: ToolbarAction | undefined =
              visibleToolbarActions[index - 1];

            return (
              <React.Fragment key={action.label}>
                {previous && previous.group !== action.group ? (
                  <ToolbarDivider />
                ) : null}
                <ToolbarButton
                  action={action}
                  title={getToolbarActionTitle(action)}
                />
              </React.Fragment>
            );
          })}

          {toolbarLayout.hasMoreMenu ? (
            <MoreMenu
              isMenuPortaled={true}
              ariaLabel={moreFormattingLabel}
              elementToBeShownInsteadOfButton={
                <button
                  type="button"
                  title={moreFormattingLabel}
                  data-testid="markdown-editor-more-formatting"
                  className={TOOLBAR_BUTTON_CLASS}
                  onMouseDown={(event: React.MouseEvent<HTMLButtonElement>) => {
                    keepEditorFocus(event);
                    rememberEditableSelection();
                  }}
                  onClick={() => {
                    // A keyboard press has no mousedown: remember the cursor here too.
                    rememberEditableSelection();
                  }}
                >
                  <Icon
                    icon={IconProp.EllipsisHorizontal}
                    className="h-4 w-4"
                  />
                </button>
              }
            >
              {moreMenuItems}
            </MoreMenu>
          ) : null}

          {/* Mode Toggle: WYSIWYG <-> Markdown */}
          {toolbarLayout.isModeToggleInBar ? (
            <>
              <ToolbarDivider />
              <button
                ref={modeToggleRef}
                type="button"
                onMouseDown={keepEditorFocus}
                onClick={toggleMode}
                className={`shrink-0 whitespace-nowrap px-3 py-1 rounded-md text-sm font-medium transition-colors duration-200 ${
                  mode === "markdown"
                    ? "bg-indigo-100 text-indigo-700"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                } focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2`}
                title={modeToggleTitle}
              >
                {mode === "wysiwyg" ? "Markdown" : "Visual"}
              </button>
            </>
          ) : null}

          {/*
           * Template variables, at the far end of the toolbar: the list to
           * pick one from, which goes in where the cursor is.
           */}
          {canPickVariables ? (
            <div
              ref={variableButtonRef}
              className="ml-auto flex shrink-0 items-center"
            >
              <InsertTemplateVariableButton
                groups={templateVariables}
                dataTestId="markdown-editor-insert-variable"
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-sm font-medium text-indigo-700 transition-colors duration-200 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                onPressStart={rememberEditableSelection}
                onPick={insertVariableAtCursor}
                onCloseFocus={focusEditor}
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* Editor Area */}
      <div className="relative">
        {allowImageUpload && (
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
          />
        )}
        {mode === "wysiwyg" ? (
          <>
            <div
              ref={editableRef}
              role="textbox"
              aria-multiline="true"
              aria-labelledby={props.ariaLabelledby}
              aria-invalid={props.error ? "true" : undefined}
              aria-describedby={props.error ? errorId : undefined}
              aria-autocomplete={canPickVariables ? "list" : undefined}
              aria-controls={editableTrigger ? variableListboxId : undefined}
              aria-activedescendant={
                editableTrigger ? editableActiveOptionId : undefined
              }
              contentEditable
              suppressContentEditableWarning
              spellCheck={props.disableSpellCheck !== true}
              data-placeholder={visualPlaceholder}
              tabIndex={props.tabIndex}
              className={wysiwygClassName}
              onInput={handleEditableInput}
              onPaste={handleEditablePaste}
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onKeyDown={handleEditableKeyDown}
              onKeyUp={(e: React.KeyboardEvent<HTMLDivElement>) => {
                if (canPickVariables && CARET_KEYS.includes(e.key)) {
                  updateEditableTrigger(false);
                  rememberEditableSelection();
                }
              }}
              onMouseUp={() => {
                if (canPickVariables) {
                  updateEditableTrigger(false);
                  rememberEditableSelection();
                }
              }}
              onFocus={() => {
                if (props.onFocus) {
                  props.onFocus();
                }
              }}
              onBlur={() => {
                closeEditableTrigger();
                if (props.onBlur) {
                  props.onBlur();
                }
              }}
            />
            {isDraggingOver && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-b-md bg-indigo-50/70">
                <span className="rounded-full bg-white px-3 py-1 text-sm font-medium text-indigo-700 shadow-sm">
                  Drop image to upload
                </span>
              </div>
            )}
            {props.error && (
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                <Icon
                  icon={IconProp.ErrorSolid}
                  className="h-5 w-5 text-red-500"
                />
              </div>
            )}
          </>
        ) : (
          <>
            <textarea
              ref={textareaRef}
              autoFocus={false}
              aria-labelledby={props.ariaLabelledby}
              aria-invalid={props.error ? "true" : undefined}
              aria-describedby={props.error ? errorId : undefined}
              placeholder={sourcePlaceholder}
              className={`${className} rounded-t-none min-h-32 ${
                isDraggingOver
                  ? "ring-2 ring-indigo-400 ring-offset-1 border-indigo-400"
                  : ""
              }`}
              value={text}
              spellCheck={props.disableSpellCheck !== true}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                handleChange(e.target.value);
                sourceTyping.handleInput();
              }}
              onPaste={handleTextareaPaste}
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onFocus={() => {
                sourceTyping.handleFocus();
                if (props.onFocus) {
                  props.onFocus();
                }
              }}
              onBlur={() => {
                sourceTyping.handleBlur();
                if (props.onBlur) {
                  props.onBlur();
                }
              }}
              onKeyUp={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                if (CARET_KEYS.includes(e.key)) {
                  sourceTyping.handleCaretMove();
                }
              }}
              onMouseUp={() => {
                sourceTyping.handleCaretMove();
              }}
              onKeyDown={handleTextareaKeyDown}
              tabIndex={props.tabIndex}
              rows={10}
            />
            {isDraggingOver && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-b-md bg-indigo-50/70">
                <span className="rounded-full bg-white px-3 py-1 text-sm font-medium text-indigo-700 shadow-sm">
                  Drop image to upload
                </span>
              </div>
            )}
            {props.error && (
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                <Icon
                  icon={IconProp.ErrorSolid}
                  className="h-5 w-5 text-red-500"
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Error Message */}
      {props.error && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-red-400">
          {props.error}
        </p>
      )}

      {/*
       * The template variables, collapsed under the editor: each one, when
       * clicked, goes in where the cursor is.
       */}
      {showsVariablesList ? (
        <TemplateVariablesList
          groups={templateVariables}
          description={props.templateVariablesDescription}
          onInsert={canPickVariables ? insertVariableAtCursor : undefined}
          supportsTyping={canPickVariables}
          dataTestId="markdown-editor-template-variables"
        >
          {props.templateVariablesFooter}
        </TemplateVariablesList>
      ) : null}

      {/* The list "{{" opened, under the braces (portalled). */}
      {editableTrigger ? (
        <TemplateVariablePopup
          mode={TemplateVariablePopupMode.Inline}
          ariaLabel={
            translateString(TemplateVariablesCopy.listTitle) ||
            TemplateVariablesCopy.listTitle
          }
          dataTestId="template-variable-suggestions"
          positionKey={`${editableTrigger.trigger.start}-${editableTrigger.rect.left}-${editableTrigger.rect.top}`}
          getAnchorRect={(): DOMRect | null => {
            return editableTrigger.rect;
          }}
          isInsideAnchor={(target: Node): boolean => {
            return Boolean(editableRef.current?.contains(target));
          }}
          onClose={closeEditableTrigger}
        >
          <TemplateVariableMenu
            ref={variableMenuRef}
            groups={templateVariables}
            hasSearchBox={false}
            query={editableTrigger.trigger.query}
            listboxId={variableListboxId}
            onActiveOptionChange={setEditableActiveOptionId}
            onPick={pickEditableVariable}
          />
        </TemplateVariablePopup>
      ) : null}
      {sourceTyping.popup}

      {/* Help Text */}
      <TinyFormDocumentation title={helpTitle}>
        <>
          <div>
            Type directly in the visual editor — use the toolbar to format.
          </div>
          <div>
            Switch to <strong>Markdown</strong> to view or edit the raw source.
          </div>
          <div>
            In a list, press{" "}
            <strong>
              {KeyboardKeyUtil.getDisplayLabel([KeyboardKey.Tab])}
            </strong>{" "}
            to indent an item and{" "}
            <strong>
              {KeyboardKeyUtil.getDisplayLabel([
                KeyboardKey.Shift,
                KeyboardKey.Tab,
              ])}
            </strong>{" "}
            to outdent it, or use the Indent and Outdent buttons. Outside a
            list, {KeyboardKeyUtil.getDisplayLabel([KeyboardKey.Tab])} moves to
            the next field.
          </div>
          <div>
            Pasting keeps lists, links and formatting from Word, Outlook, web
            pages and other notes. To paste plain text instead, press{" "}
            <strong>
              {KeyboardKeyUtil.getDisplayLabel([
                KeyboardKey.Mod,
                KeyboardKey.Shift,
                "V",
              ])}
            </strong>
            .
          </div>
          {allowImageUpload && (
            <div>
              Tip: paste, drag &amp; drop, or click the image button to upload
              screenshots inline.
            </div>
          )}
        </>
      </TinyFormDocumentation>
    </div>
  );
};

export default MarkdownEditor;
