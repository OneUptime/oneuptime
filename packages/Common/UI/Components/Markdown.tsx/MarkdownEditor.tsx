import Icon from "../Icon/Icon";
import KeyboardKey, { KeyboardKeyUtil } from "../KeyboardShortcut/KeyboardKey";
import IconProp from "../../../Types/Icon/IconProp";
import TinyFormDocumentation from "../TinyFormDocumentation/TinyFormDocumentation";
import { FILE_URL } from "../../Config";
import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import CommonURL from "../../../Types/API/URL";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import MimeType from "../../../Types/File/MimeType";
import FileModel from "../../../Models/DatabaseModels/File";
import DOMPurify from "dompurify";
import { htmlToMarkdown, markdownToHtml } from "./MarkdownConverters";
import {
  indentMarkdownLines,
  liftListItems,
  MarkdownListKind,
  MarkdownTextEdit,
  outdentMarkdownLines,
  sinkListItems,
  stripTextListMarkers,
  toggleMarkdownList,
} from "./MarkdownListEditing";
import { clipboardToMarkdown } from "./MarkdownPaste";
import {
  caretAtEndOf,
  deleteSelectionForInsert,
  insertBlocksAtCaret,
  isCaretOnEmptyLine,
} from "./MarkdownVisualEditing";
import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useRef,
  useEffect,
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
}

type EditorMode = "wysiwyg" | "markdown";

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

type MarkdownTextEditor = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
) => MarkdownTextEdit | null;

interface ToolbarButtonProps {
  icon: IconProp;
  title: string;
  onClick: () => void;
  isActive?: boolean;
}

const ToolbarButton: FunctionComponent<ToolbarButtonProps> = ({
  icon,
  title,
  onClick,
  isActive = false,
}: ToolbarButtonProps): ReactElement => {
  return (
    <button
      type="button"
      onMouseDown={(e: React.MouseEvent<HTMLButtonElement>) => {
        /*
         * Prevent toolbar clicks from stealing focus / collapsing the
         * selection in contenteditable mode.
         */
        e.preventDefault();
      }}
      onClick={onClick}
      title={title}
      className={`p-2 rounded-md transition-colors duration-200 ${
        isActive
          ? "bg-indigo-100 text-indigo-700"
          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
      } focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2`}
    >
      <Icon icon={icon} className="h-4 w-4" />
    </button>
  );
};

const MarkdownEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const allowImageUpload: boolean = props.allowImageUpload !== false;
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

  useEffect(() => {
    if (
      props.initialValue !== undefined &&
      props.initialValue !== textRef.current
    ) {
      setText(props.initialValue);
      textRef.current = props.initialValue;
    }
  }, [props.initialValue]);

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
    deleteSelectionForInsert(editable, range);
    const fragment: DocumentFragment = range.createContextualFragment(contents);
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
      const lastNode: Node | null = insertBlocksAtCaret(
        editable,
        range,
        fragment,
      );
      if (lastNode) {
        caret = caretAtEndOf(lastNode);
      }
    }
    if (caret) {
      selection.removeAllRanges();
      selection.addRange(caret);
    }
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
    insertTextInTextarea(markdown);
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
    deleteSelectionForInsert(editable, range);
    const textNode: Text = document.createTextNode(value);
    range.insertNode(textNode);
    const after: Range = document.createRange();
    after.setStartAfter(textNode);
    after.collapse(true);
    selection.removeAllRanges();
    selection.addRange(after);
    syncFromEditable();
  };

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
   * can move.
   */
  const shiftListItemsInEditable: (outdent: boolean) => boolean = (
    outdent: boolean,
  ): boolean => {
    const editable: HTMLDivElement | null = editableRef.current;
    if (!editable) {
      return false;
    }
    const changed: boolean = outdent
      ? liftListItems(editable)
      : sinkListItems(editable);
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
    deleteSelectionForInsert(editable, range);
    range.insertNode(wrapper);
    const newRange: Range = document.createRange();
    newRange.selectNodeContents(wrapper);
    selection.removeAllRanges();
    selection.addRange(newRange);
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
      insertHtmlAtCursorInEditable(
        `<a href="${url.replace(/"/g, "&quot;")}">${url.replace(/</g, "&lt;")}</a>`,
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

      {/* Toolbar */}
      <div className="p-2 bg-gray-50 border border-gray-300 rounded-t-md border-b-0">
        <div className="flex flex-wrap items-center gap-1">
          {/* Text Formatting */}
          <div className="flex items-center gap-1">
            <ToolbarButton
              icon={IconProp.Bold}
              title={`Bold (${KeyboardKeyUtil.getDisplayLabel([
                KeyboardKey.Mod,
                "B",
              ])})`}
              onClick={formatActions.bold}
            />
            <ToolbarButton
              icon={IconProp.Italic}
              title={`Italic (${KeyboardKeyUtil.getDisplayLabel([
                KeyboardKey.Mod,
                "I",
              ])})`}
              onClick={formatActions.italic}
            />
            <ToolbarButton
              icon={IconProp.Underline}
              title="Underline"
              onClick={formatActions.underline}
            />
            <ToolbarButton
              icon={IconProp.Minus}
              title="Strikethrough"
              onClick={formatActions.strikethrough}
            />
          </div>

          <div className="w-px h-6 bg-gray-300" />

          {/* Headings */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onMouseDown={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.preventDefault();
              }}
              onClick={formatActions.heading1}
              title="Heading 1"
              className="px-2 py-2 rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              <span className="text-sm font-bold">H1</span>
            </button>
            <button
              type="button"
              onMouseDown={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.preventDefault();
              }}
              onClick={formatActions.heading2}
              title="Heading 2"
              className="px-2 py-2 rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              <span className="text-sm font-bold">H2</span>
            </button>
            <button
              type="button"
              onMouseDown={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.preventDefault();
              }}
              onClick={formatActions.heading3}
              title="Heading 3"
              className="px-2 py-2 rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              <span className="text-sm font-bold">H3</span>
            </button>
          </div>

          <div className="w-px h-6 bg-gray-300" />

          {/* Lists */}
          <div className="flex items-center gap-1">
            <ToolbarButton
              icon={IconProp.ListBullet}
              title="Bullet List"
              onClick={formatActions.unorderedList}
            />
            <ToolbarButton
              icon={IconProp.List}
              title="Numbered List"
              onClick={formatActions.orderedList}
            />
            <ToolbarButton
              icon={IconProp.Check}
              title="Task List"
              onClick={formatActions.taskList}
            />
            <ToolbarButton
              icon={IconProp.Indent}
              title={`Indent (${KeyboardKeyUtil.getDisplayLabel([
                KeyboardKey.Tab,
              ])})`}
              onClick={formatActions.indent}
            />
            <ToolbarButton
              icon={IconProp.Outdent}
              title={`Outdent (${KeyboardKeyUtil.getDisplayLabel([
                KeyboardKey.Shift,
                KeyboardKey.Tab,
              ])})`}
              onClick={formatActions.outdent}
            />
          </div>

          <div className="w-px h-6 bg-gray-300" />

          {/* Links and Media */}
          <div className="flex items-center gap-1">
            <ToolbarButton
              icon={IconProp.Link}
              title="Link"
              onClick={formatActions.link}
            />
            {allowImageUpload && (
              <ToolbarButton
                icon={IconProp.Image}
                title="Image"
                onClick={formatActions.image}
              />
            )}
            <ToolbarButton
              icon={IconProp.Code}
              title="Code"
              onClick={formatActions.code}
            />
          </div>

          <div className="w-px h-6 bg-gray-300" />

          {/* Advanced */}
          <div className="flex items-center gap-1">
            <ToolbarButton
              icon={IconProp.TableCells}
              title="Table"
              onClick={formatActions.table}
            />
            <button
              type="button"
              onMouseDown={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.preventDefault();
              }}
              onClick={formatActions.horizontalRule}
              title="Horizontal Rule"
              className="p-2 rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              <span className="font-bold text-sm">-</span>
            </button>
            <button
              type="button"
              onMouseDown={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.preventDefault();
              }}
              onClick={formatActions.quote}
              title="Quote"
              className="p-2 rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              <span className="font-bold text-sm">&quot;</span>
            </button>
            <button
              type="button"
              onMouseDown={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.preventDefault();
              }}
              onClick={formatActions.codeBlock}
              title="Code Block"
              className="p-2 rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              <span className="font-mono text-xs font-bold">{"{}"}</span>
            </button>
          </div>

          <div className="w-px h-6 bg-gray-300" />

          {/* Mode Toggle: WYSIWYG <-> Markdown */}
          <div className="flex items-center">
            <button
              type="button"
              onMouseDown={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.preventDefault();
              }}
              onClick={() => {
                setMode((current: EditorMode): EditorMode => {
                  return current === "wysiwyg" ? "markdown" : "wysiwyg";
                });
              }}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors duration-200 ${
                mode === "markdown"
                  ? "bg-indigo-100 text-indigo-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              } focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2`}
              title={
                mode === "wysiwyg"
                  ? "Switch to markdown source"
                  : "Switch to visual editor"
              }
            >
              {mode === "wysiwyg" ? "Markdown" : "Visual"}
            </button>
          </div>
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
              contentEditable
              suppressContentEditableWarning
              spellCheck={props.disableSpellCheck !== true}
              data-placeholder={
                props.placeholder || "Type your content here..."
              }
              tabIndex={props.tabIndex}
              className={wysiwygClassName}
              onInput={syncFromEditable}
              onPaste={handleEditablePaste}
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onKeyDown={handleEditableKeyDown}
              onFocus={() => {
                if (props.onFocus) {
                  props.onFocus();
                }
              }}
              onBlur={() => {
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
              placeholder={props.placeholder || "Type your markdown here..."}
              className={`${className} rounded-t-none min-h-32 ${
                isDraggingOver
                  ? "ring-2 ring-indigo-400 ring-offset-1 border-indigo-400"
                  : ""
              }`}
              value={text}
              spellCheck={props.disableSpellCheck !== true}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                handleChange(e.target.value);
              }}
              onPaste={handleTextareaPaste}
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onFocus={() => {
                if (props.onFocus) {
                  props.onFocus();
                }
              }}
              onBlur={() => {
                if (props.onBlur) {
                  props.onBlur();
                }
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
        <p className="mt-1 text-sm text-red-400">{props.error}</p>
      )}

      {/* Help Text */}
      <TinyFormDocumentation title="Formatting help">
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
