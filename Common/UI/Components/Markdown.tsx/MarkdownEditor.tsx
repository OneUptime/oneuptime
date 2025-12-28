import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
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
  const textareaRef: React.RefObject<HTMLTextAreaElement> =
    useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (props.initialValue !== undefined) {
      setText(props.initialValue);
    }
  }, [props.initialValue]);

  const handleChange: (value: string) => void = (value: string): void => {
    setText(value);
    if (props.onChange) {
      props.onChange(value);
    }
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
      return insertText("![", "](image-url)", "alt text");
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
      "block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none";
  } else {
    className = props.className;
  }

  if (props.error) {
    className +=
      " border-red-300 pr-10 text-red-900 placeholder-red-300 focus:border-red-500 focus:outline-none focus:ring-red-500";
  }

  const renderPreview: () => ReactElement = (): ReactElement => {
    // Enhanced markdown preview with proper code block handling
    let htmlContent: string = text;

    // Handle code blocks first (before inline code)
    htmlContent = htmlContent.replace(
      /```([^`]*?)```/g,
      (_match: string, code: string) => {
        const escapedCode: string = code
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
        return `<pre class="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto mb-4"><code class="text-sm font-mono whitespace-pre">${escapedCode}</code></pre>`;
      },
    );

    // Handle inline code (after code blocks to avoid conflicts)
    htmlContent = htmlContent.replace(
      /`([^`]+)`/g,
      '<code class="bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded text-sm font-mono">$1</code>',
    );

    // Handle other markdown elements
    htmlContent = htmlContent
      .replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em class="italic">$1</em>')
      .replace(/<u>(.*?)<\/u>/g, '<u class="underline">$1</u>')
      .replace(/~~(.*?)~~/g, '<s class="line-through">$1</s>')
      .replace(
        /^# (.*$)/gm,
        '<h1 class="text-3xl font-bold mb-4 mt-6 first:mt-0">$1</h1>',
      )
      .replace(
        /^## (.*$)/gm,
        '<h2 class="text-2xl font-bold mb-3 mt-5 first:mt-0">$1</h2>',
      )
      .replace(
        /^### (.*$)/gm,
        '<h3 class="text-xl font-bold mb-2 mt-4 first:mt-0">$1</h3>',
      )
      .replace(
        /^#### (.*$)/gm,
        '<h4 class="text-lg font-bold mb-2 mt-3 first:mt-0">$1</h4>',
      )
      .replace(
        /^- \[ \] (.*$)/gm,
        '<li class="ml-6 mb-1 flex items-center"><input type="checkbox" class="mr-2" disabled> $1</li>',
      )
      .replace(
        /^- \[x\] (.*$)/gm,
        '<li class="ml-6 mb-1 flex items-center"><input type="checkbox" class="mr-2" checked disabled> $1</li>',
      )
      .replace(
        /^- (.*$)/gm,
        '<li class="ml-6 mb-1 list-disc list-inside">$1</li>',
      )
      .replace(
        /^\d+\. (.*$)/gm,
        '<li class="ml-6 mb-1 list-decimal list-inside">$1</li>',
      )
      .replace(
        /^> (.*$)/gm,
        '<blockquote class="border-l-4 border-blue-400 pl-4 py-2 mb-4 bg-blue-50 italic text-gray-700">$1</blockquote>',
      )
      .replace(/^---$/gm, '<hr class="border-t-2 border-gray-300 my-6">')
      .replace(
        /!\[([^\]]*)\]\(([^)]+)\)/g,
        '<img src="$2" alt="$1" class="max-w-full h-auto rounded-lg shadow-sm my-4">',
      )
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" class="text-blue-600 hover:text-blue-800 underline font-medium" target="_blank" rel="noopener noreferrer">$1</a>',
      );

    // Handle tables
    htmlContent = htmlContent.replace(
      /^\|(.+)\|\n\|(-+\|)+\n((?:\|.+\|\n?)*)/gm,
      (
        _match: string,
        headerRow: string,
        _separatorRow: string,
        bodyRows: string,
      ) => {
        const headers: string = headerRow
          .split("|")
          .filter((cell: string) => {
            return cell.trim();
          })
          .map((cell: string) => {
            return `<th class="px-4 py-2 bg-gray-50 font-semibold text-left border-b border-gray-300">${cell.trim()}</th>`;
          })
          .join("");

        const rows: string = bodyRows
          .split("\n")
          .filter((row: string) => {
            return row.trim();
          })
          .map((row: string) => {
            const cells: string = row
              .split("|")
              .filter((cell: string) => {
                return cell.trim();
              })
              .map((cell: string) => {
                return `<td class="px-4 py-2 border-b border-gray-200">${cell.trim()}</td>`;
              })
              .join("");
            return `<tr>${cells}</tr>`;
          })
          .join("");

        return `<table class="w-full border-collapse border border-gray-300 my-4 rounded-lg overflow-hidden"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
      },
    );

    // Handle line breaks (convert \n to <br> but avoid double breaks)
    htmlContent = htmlContent
      .replace(/\n\n/g, '</p><p class="mb-4">')
      .replace(/\n/g, "<br>");

    // Wrap in paragraphs if there's content
    if (htmlContent.trim()) {
      htmlContent = `<p class="mb-4">${htmlContent}</p>`;
    }

    return (
      <div className="p-4 min-h-32 bg-white prose prose-sm max-w-none">
        <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
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
            <textarea
              ref={textareaRef}
              autoFocus={false}
              placeholder={props.placeholder || "Type your markdown here..."}
              className={`${className} rounded-t-none min-h-32`}
              value={text}
              spellCheck={props.disableSpellCheck !== true}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                handleChange(e.target.value);
              }}
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
              rows={6}
            />
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
      <div className="mt-2 text-xs text-gray-500">
        <details className="cursor-pointer">
          <summary className="hover:text-gray-700">Markdown help</summary>
          <div className="mt-2 space-y-1">
            <div>
              <strong>**bold**</strong> or <em>*italic*</em>
            </div>
            <div>
              <code className="bg-gray-100 px-1 rounded">`code`</code> or
              ```code block```
            </div>
            <div># Heading 1, ## Heading 2, ### Heading 3</div>
            <div>- Bullet list or 1. Numbered list</div>
            <div>[Link text](url) or &gt; Quote</div>
          </div>
        </details>
      </div>
    </div>
  );
};

export default MarkdownEditor;
