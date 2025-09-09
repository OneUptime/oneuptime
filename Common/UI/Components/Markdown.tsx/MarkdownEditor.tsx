import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import React, { 
  FunctionComponent, 
  ReactElement, 
  useState, 
  useRef, 
  useEffect 
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
  disableSpellCheck?: boolean | undefined;
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
}) => {
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (props.initialValue !== undefined) {
      setText(props.initialValue);
    }
  }, [props.initialValue]);

  const handleChange = (value: string): void => {
    setText(value);
    if (props.onChange) {
      props.onChange(value);
    }
  };

  const insertText = (
    before: string,
    after: string = "",
    placeholder: string = ""
  ): void => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = text.substring(start, end);
    const textToInsert = selectedText || placeholder;
    
    const newText = 
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
          start + before.length + textToInsert.length
        );
      } else {
        textarea.setSelectionRange(
          start + before.length,
          start + before.length + placeholder.length
        );
      }
      textarea.focus();
    }, 0);
  };

  const insertAtLineStart = (prefix: string): void => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = text.indexOf('\n', start);
    const actualLineEnd = lineEnd === -1 ? text.length : lineEnd;
    
    const currentLine = text.substring(lineStart, actualLineEnd);
    
    // Check if line already has the prefix
    if (currentLine.startsWith(prefix)) {
      // Remove prefix
      const newText = 
        text.substring(0, lineStart) + 
        currentLine.substring(prefix.length) + 
        text.substring(actualLineEnd);
      handleChange(newText);
      setTimeout(() => {
        textarea.setSelectionRange(start - prefix.length, start - prefix.length);
        textarea.focus();
      }, 0);
    } else {
      // Add prefix
      const newText = 
        text.substring(0, lineStart) + 
        prefix + 
        currentLine + 
        text.substring(actualLineEnd);
      handleChange(newText);
      setTimeout(() => {
        textarea.setSelectionRange(start + prefix.length, start + prefix.length);
        textarea.focus();
      }, 0);
    }
  };

  const formatActions = {
    bold: () => insertText("**", "**", "bold text"),
    italic: () => insertText("*", "*", "italic text"),
    heading: () => insertAtLineStart("# "),
    unorderedList: () => insertAtLineStart("- "),
    orderedList: () => insertAtLineStart("1. "),
    link: () => insertText("[", "](url)", "link text"),
    code: () => insertText("`", "`", "code"),
    codeBlock: () => insertText("```\n", "\n```", "code block"),
    quote: () => insertAtLineStart("> "),
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

  const renderPreview = (): ReactElement => {
    // Simple markdown preview - you might want to use a proper markdown parser
    const htmlContent = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code class="bg-gray-100 px-1 rounded">$1</code>')
      .replace(/^# (.*$)/gm, '<h1 class="text-2xl font-bold mb-2">$1</h1>')
      .replace(/^## (.*$)/gm, '<h2 class="text-xl font-bold mb-2">$1</h2>')
      .replace(/^### (.*$)/gm, '<h3 class="text-lg font-bold mb-2">$1</h3>')
      .replace(/^\- (.*$)/gm, '<li class="ml-4">• $1</li>')
      .replace(/^\d+\. (.*$)/gm, '<li class="ml-4">$1</li>')
      .replace(/^\> (.*$)/gm, '<blockquote class="border-l-4 border-gray-300 pl-4 italic text-gray-600">$1</blockquote>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-indigo-600 hover:text-indigo-800 underline">$1</a>')
      .replace(/\n/g, '<br>');

    return (
      <div
        className="p-3 prose prose-sm max-w-none"
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
    );
  };

  return (
    <div className="relative">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-2 bg-gray-50 border border-gray-300 rounded-t-md border-b-0">
        <div className="flex items-center space-x-1">
          <div className="flex items-center space-x-1 mr-2">
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
          </div>
          
          <div className="w-px h-6 bg-gray-300 mr-2" />
          
          <div className="flex items-center space-x-1 mr-2">
            <ToolbarButton
              icon={IconProp.Bars3}
              title="Heading"
              onClick={formatActions.heading}
            />
          </div>
          
          <div className="w-px h-6 bg-gray-300 mr-2" />
          
          <div className="flex items-center space-x-1 mr-2">
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
          </div>
          
          <div className="w-px h-6 bg-gray-300 mr-2" />
          
          <div className="flex items-center space-x-1 mr-2">
            <ToolbarButton
              icon={IconProp.Link}
              title="Link"
              onClick={formatActions.link}
            />
            <ToolbarButton
              icon={IconProp.Code}
              title="Code"
              onClick={formatActions.code}
            />
          </div>
          
          <div className="w-px h-6 bg-gray-300 mr-2" />
          
          <div className="flex items-center space-x-1">
            <button
              type="button"
              onClick={formatActions.quote}
              title="Quote"
              className="p-2 rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              <span className="font-bold text-sm">"</span>
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
        </div>
        
        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
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

      {/* Editor/Preview Area */}
      <div className="relative">
        {showPreview ? (
          <div className={`min-h-32 border border-gray-300 bg-white rounded-b-md ${props.error ? 'border-red-300' : ''}`}>
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
              spellCheck={!props.disableSpellCheck}
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
                    case 'b':
                      e.preventDefault();
                      formatActions.bold();
                      break;
                    case 'i':
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
                <Icon icon={IconProp.ErrorSolid} className="h-5 w-5 text-red-500" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Error Message */}
      {props.error && (
        <p className="mt-1 text-sm text-red-400">
          {props.error}
        </p>
      )}

      {/* Help Text */}
      <div className="mt-2 text-xs text-gray-500">
        <details className="cursor-pointer">
          <summary className="hover:text-gray-700">Markdown help</summary>
          <div className="mt-2 space-y-1">
            <div><strong>**bold**</strong> or <em>*italic*</em></div>
            <div><code className="bg-gray-100 px-1 rounded">`code`</code> or ```code block```</div>
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
