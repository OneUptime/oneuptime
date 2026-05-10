import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import TinyFormDocumentation from "../TinyFormDocumentation/TinyFormDocumentation";
import MarkdownViewer from "./MarkdownViewer";
import { FILE_URL } from "../../Config";
import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import CommonURL from "../../../Types/API/URL";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import MimeType from "../../../Types/File/MimeType";
import FileModel from "../../../Models/DatabaseModels/File";
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
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const textareaRef: React.RefObject<HTMLTextAreaElement> =
    useRef<HTMLTextAreaElement>(null);
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
    if (props.initialValue !== undefined) {
      setText(props.initialValue);
      textRef.current = props.initialValue;
    }
  }, [props.initialValue]);

  const handleChange: (value: string) => void = (value: string): void => {
    textRef.current = value;
    setText(value);
    if (props.onChange) {
      props.onChange(value);
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

  const replacePlaceholderInText: (
    needle: string,
    replacement: string,
  ) => void = (needle: string, replacement: string): void => {
    const current: string = textRef.current;
    if (!current.includes(needle)) {
      return;
    }
    handleChange(current.split(needle).join(replacement));
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
      insertTextAtCursor(`[Image "${filename}" exceeds the 10MB limit]`);
      return;
    }

    insertTextAtCursor(placeholderMarkdown);

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
    e: React.ClipboardEvent<HTMLTextAreaElement>,
  ) => Array<File> = (
    e: React.ClipboardEvent<HTMLTextAreaElement>,
  ): Array<File> => {
    const items: DataTransferItemList | null = e.clipboardData?.items || null;
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

  const handlePaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void = (
    e: React.ClipboardEvent<HTMLTextAreaElement>,
  ): void => {
    const images: Array<File> = extractImagesFromClipboard(e);
    if (images.length === 0) {
      return;
    }
    e.preventDefault();
    void handleImageFiles(images);
  };

  const dragHasFiles: (e: React.DragEvent<HTMLTextAreaElement>) => boolean = (
    e: React.DragEvent<HTMLTextAreaElement>,
  ): boolean => {
    const types: ReadonlyArray<string> | undefined = e.dataTransfer?.types as
      | ReadonlyArray<string>
      | undefined;
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

  const handleDragOver: (e: React.DragEvent<HTMLTextAreaElement>) => void = (
    e: React.DragEvent<HTMLTextAreaElement>,
  ): void => {
    if (!dragHasFiles(e)) {
      return;
    }
    e.preventDefault();
    if (!isDraggingOver) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave: (e: React.DragEvent<HTMLTextAreaElement>) => void = (
    _e: React.DragEvent<HTMLTextAreaElement>,
  ): void => {
    setIsDraggingOver(false);
  };

  const handleDrop: (e: React.DragEvent<HTMLTextAreaElement>) => void = (
    e: React.DragEvent<HTMLTextAreaElement>,
  ): void => {
    if (!dragHasFiles(e)) {
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

    // Set cursor position after insertion
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

    // Special handling for headings - replace existing heading levels
    if (prefix.startsWith("#")) {
      // Remove any existing heading markers
      const cleanLine: string = currentLine.replace(/^#+\s*/, "");

      if (currentLine.startsWith(prefix)) {
        // Same heading level - remove it
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
        // Different heading level or no heading - apply new heading
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
      // Non-heading prefixes (lists, quotes) - remove prefix
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
      // Add prefix
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
      return insertText("**", "**", "bold text");
    },
    italic: () => {
      return insertText("*", "*", "italic text");
    },
    underline: () => {
      return insertText("<u>", "</u>", "underlined text");
    },
    strikethrough: () => {
      return insertText("~~", "~~", "strikethrough text");
    },
    heading1: () => {
      return insertAtLineStart("# ");
    },
    heading2: () => {
      return insertAtLineStart("## ");
    },
    heading3: () => {
      return insertAtLineStart("### ");
    },
    unorderedList: () => {
      return insertAtLineStart("- ");
    },
    orderedList: () => {
      return insertAtLineStart("1. ");
    },
    taskList: () => {
      return insertAtLineStart("- [ ] ");
    },
    link: () => {
      return insertText("[", "](url)", "link text");
    },
    image: () => {
      return handleImageButtonClick();
    },
    code: () => {
      return insertText("`", "`", "code");
    },
    codeBlock: () => {
      return insertText("```\n", "\n```", "code block");
    },
    quote: () => {
      return insertAtLineStart("> ");
    },
    horizontalRule: () => {
      return insertText("\n---\n", "", "");
    },
    table: () => {
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

  const renderPreview: () => ReactElement = (): ReactElement => {
    /*
     * Render the preview using the same MarkdownViewer that renders the
     * final published output, so the preview is guaranteed to match.
     */
    return (
      <div className="p-4 min-h-32 bg-white">
        <MarkdownViewer text={text} />
      </div>
    );
  };

  return (
    <div className="relative" data-testid={props.dataTestId}>
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
              onClick={formatActions.heading1}
              title="Heading 1"
              className="px-2 py-2 rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              <span className="text-sm font-bold">H1</span>
            </button>
            <button
              type="button"
              onClick={formatActions.heading2}
              title="Heading 2"
              className="px-2 py-2 rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              <span className="text-sm font-bold">H2</span>
            </button>
            <button
              type="button"
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
              title="Upload image (you can also paste or drag & drop)"
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
              onClick={formatActions.horizontalRule}
              title="Horizontal Rule"
              className="p-2 rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              <span className="font-bold text-sm">-</span>
            </button>
            <button
              type="button"
              onClick={formatActions.quote}
              title="Quote"
              className="p-2 rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              <span className="font-bold text-sm">&quot;</span>
            </button>
            <button
              type="button"
              onClick={formatActions.codeBlock}
              title="Code Block"
              className="p-2 rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              <span className="font-mono text-xs font-bold">{"{}"}</span>
            </button>
          </div>

          <div className="w-px h-6 bg-gray-300" />

          {/* Preview Toggle */}
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => {
                return setShowPreview(!showPreview);
              }}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors duration-200 ${
                showPreview
                  ? "bg-indigo-100 text-indigo-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              } focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2`}
            >
              {showPreview ? "Write" : "Preview"}
            </button>
          </div>
        </div>
      </div>

      {/* Editor/Preview Area */}
      <div className="relative">
        {showPreview ? (
          <div
            className={`min-h-32 border border-gray-300 bg-white rounded-b-md ${props.error ? "border-red-300" : ""}`}
          >
            {text.trim() ? (
              renderPreview()
            ) : (
              <div className="p-3 text-gray-500 italic">Nothing to preview</div>
            )}
          </div>
        ) : (
          <div className="relative">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />
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
              onPaste={handlePaste}
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
                // Handle keyboard shortcuts
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
          </div>
        )}
      </div>

      {/* Error Message */}
      {props.error && (
        <p className="mt-1 text-sm text-red-400">{props.error}</p>
      )}

      {/* Help Text */}
      <TinyFormDocumentation title="Markdown help">
        <>
          <div>
            <strong>**bold**</strong> or <em>*italic*</em>
          </div>
          <div>
            <code className="bg-gray-100 px-1 rounded">`code`</code> or ```code
            block```
          </div>
          <div># Heading 1, ## Heading 2, ### Heading 3</div>
          <div>- Bullet list or 1. Numbered list</div>
          <div>[Link text](url) or &gt; Quote</div>
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
