import Icon from "../Icon/Icon";
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
    range.deleteContents();
    const fragment: DocumentFragment = range.createContextualFragment(html);
    const lastNode: ChildNode | null = fragment.lastChild;
    range.insertNode(fragment);
    if (lastNode) {
      const newRange: Range = document.createRange();
      newRange.setStartAfter(lastNode);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);
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

  const handleTextareaPaste: (
    e: React.ClipboardEvent<HTMLTextAreaElement>,
  ) => void = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const images: Array<File> = extractImagesFromClipboard(
      e.clipboardData?.items || null,
    );
    if (images.length === 0) {
      return;
    }
    e.preventDefault();
    void handleImageFiles(images);
  };

  const handleEditablePaste: (
    e: React.ClipboardEvent<HTMLDivElement>,
  ) => void = (e: React.ClipboardEvent<HTMLDivElement>): void => {
    const images: Array<File> = extractImagesFromClipboard(
      e.clipboardData?.items || null,
    );
    if (images.length > 0) {
      e.preventDefault();
      void handleImageFiles(images);
      return;
    }
    /*
     * Force plain-text paste so users don't import arbitrary styled HTML
     * (which our markdown serializer can't faithfully round-trip).
     */
    const plain: string | undefined = e.clipboardData?.getData("text/plain");
    if (plain !== undefined) {
      e.preventDefault();
      const html: string = sanitizeHtml(markdownToHtml(plain));
      insertHtmlAtCursorInEditable(html);
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
    const fileList: FileList | null = e.dataTransfer?.files || null;
    if (!fileList || fileList.length === 0) {
      return;
    }
    const files: Array<File> = Array.from(fileList);
    void handleImageFiles(files);
  };

  const handleImageButtonClick: () => void = (): void => {
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

  // WYSIWYG-mode toolbar helpers (operate on the contenteditable DOM).
  const execEditable: (command: string, value?: string) => void = (
    command: string,
    value?: string,
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
    syncFromEditable();
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
    range.deleteContents();
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

  const insertWysiwygCodeBlock: () => void = (): void => {
    insertHtmlAtCursorInEditable("<pre><code>code block</code></pre><p></p>");
  };

  const insertWysiwygTable: () => void = (): void => {
    const html: string =
      "<table><thead><tr><th>Header 1</th><th>Header 2</th><th>Header 3</th></tr></thead>" +
      "<tbody>" +
      "<tr><td>Cell 1</td><td>Cell 2</td><td>Cell 3</td></tr>" +
      "<tr><td>Cell 4</td><td>Cell 5</td><td>Cell 6</td></tr>" +
      "</tbody></table><p></p>";
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
        return execEditable("insertUnorderedList");
      }
      return insertAtLineStart("- ");
    },
    orderedList: () => {
      if (mode === "wysiwyg") {
        return execEditable("insertOrderedList");
      }
      return insertAtLineStart("1. ");
    },
    taskList: () => {
      if (mode === "wysiwyg") {
        return insertWysiwygTaskList();
      }
      return insertAtLineStart("- [ ] ");
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
        .oneuptime-wysiwyg ol { list-style-type: decimal; }
        .oneuptime-wysiwyg ul.task-list, .oneuptime-wysiwyg ul.task-list li { list-style: none; margin-left: 0; }
        .oneuptime-wysiwyg ul.task-list li { padding-left: 0; }
        .oneuptime-wysiwyg blockquote { border-left: 3px solid #d1d5db; padding-left: 0.75rem; color: #4b5563; margin: 0.5rem 0; }
        .oneuptime-wysiwyg pre { background: #f3f4f6; border-radius: 0.375rem; padding: 0.75rem; overflow-x: auto; margin: 0.5rem 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.85rem; }
        .oneuptime-wysiwyg code { background: #f3f4f6; padding: 0 0.25rem; border-radius: 0.25rem; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.85em; }
        .oneuptime-wysiwyg pre code { background: transparent; padding: 0; }
        .oneuptime-wysiwyg a { color: #4f46e5; text-decoration: underline; }
        .oneuptime-wysiwyg hr { margin: 1rem 0; border: 0; border-top: 1px solid #e5e7eb; }
        .oneuptime-wysiwyg table { border-collapse: collapse; margin: 0.5rem 0; }
        .oneuptime-wysiwyg th, .oneuptime-wysiwyg td { border: 1px solid #e5e7eb; padding: 0.25rem 0.5rem; }
        .oneuptime-wysiwyg th { background: #f9fafb; font-weight: 600; }
        .oneuptime-wysiwyg img { max-width: 100%; height: auto; }
        .oneuptime-wysiwyg:empty::before { content: attr(data-placeholder); color: #9ca3af; pointer-events: none; }
      `}</style>

      {/* Toolbar */}
      <div className="p-2 bg-gray-50 border border-gray-300 rounded-t-md border-b-0">
        <div className="flex flex-wrap items-center gap-1">
          {/* Text Formatting */}
          <div className="flex items-center gap-1">
            <ToolbarButton
              icon={IconProp.Bold}
              title="Bold (Ctrl+B)"
              onClick={formatActions.bold}
            />
            <ToolbarButton
              icon={IconProp.Italic}
              title="Italic (Ctrl+I)"
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
          </div>

          <div className="w-px h-6 bg-gray-300" />

          {/* Links and Media */}
          <div className="flex items-center gap-1">
            <ToolbarButton
              icon={IconProp.Link}
              title="Link"
              onClick={formatActions.link}
            />
            <ToolbarButton
              icon={IconProp.Image}
              title="Image"
              onClick={formatActions.image}
            />
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
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileInputChange}
        />
        {mode === "wysiwyg" ? (
          <>
            <div
              ref={editableRef}
              role="textbox"
              aria-multiline="true"
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
              onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
              }}
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
            Tip: paste, drag &amp; drop, or click the image button to upload
            screenshots inline.
          </div>
        </>
      </TinyFormDocumentation>
    </div>
  );
};

export default MarkdownEditor;
