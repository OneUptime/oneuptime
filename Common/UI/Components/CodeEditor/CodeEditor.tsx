import Editor from "@monaco-editor/react";
import CodeType from "../../../Types/Code/CodeType";
import MarkdownUtil from "../../Utils/Markdown";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  initialValue?: undefined | string;
  onClick?: undefined | (() => void);
  placeholder?: undefined | string;
  className?: undefined | string;
  onChange?: undefined | ((value: string) => void);
  readOnly?: boolean | undefined;
  type: CodeType;
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  dataTestId?: string | undefined;
  tabIndex?: number | undefined;
  error?: string | undefined;
  value?: string | undefined;
  showLineNumbers?: boolean | undefined;
  disableSpellCheck?: boolean | undefined;
}

const CodeEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let className: string = "";

  const [placeholder, setPlaceholder] = useState<string>("");
  const [helpText, setHelpText] = useState<string | ReactElement>("");
  const editorRef: React.MutableRefObject<any> = useRef<any>(null);

  useEffect(() => {
    let value: string | undefined = props.value;

    if (value && typeof value !== "string") {
      value = JSON.stringify(value, null, 4);
    }

    setValue(value || "");
  }, [props.value]);

  useEffect(() => {
    if (props.placeholder) {
      if (props.type === CodeType.Markdown) {
        setHelpText(MarkdownUtil.getMarkdownCheatsheet(props.placeholder));
      }

      if (props.type === CodeType.HTML) {
        setHelpText(`${props.placeholder}. This is in HTML`);
      }

      if (props.type === CodeType.JavaScript) {
        setPlaceholder(
          `/* ${props.placeholder} 
                    
                    
                    This is in JavaScript. 
                    
                    */`,
        );
      }

      if (props.type === CodeType.JSON) {
        setHelpText(`${props.placeholder}`);
      }

      if (props.type === CodeType.CSS) {
        setPlaceholder(`/* ${props.placeholder}. This is in CSS. */`);
      }
    }
  }, [props.placeholder, props.type]);

  if (!props.className) {
    className =
      "block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:text-sm";
  } else {
    className = props.className;
  }

  if (props.error) {
    className =
      "block w-full rounded-md border bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-red-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 sm:text-sm border-red-300 pr-10 text-red-900 placeholder-red-300 focus:border-red-500 focus:outline-none focus:ring-red-500";
  }

  const [value, setValue] = useState<string>("");

  // Handle spell check configuration for Monaco Editor
  useEffect(() => {
    if (editorRef.current && props.type === CodeType.Markdown) {
      const editor: any = editorRef.current;
      const domNode: HTMLElement | null = editor.getDomNode();
      if (domNode) {
        const textareaElement: HTMLTextAreaElement | null =
          domNode.querySelector("textarea");
        if (textareaElement) {
          textareaElement.spellcheck = !props.disableSpellCheck;
        }
      }
    }
  }, [props.disableSpellCheck, props.type]);

  useEffect(() => {
    let initialValue: string | undefined = props.initialValue;

    if (initialValue && typeof initialValue !== "string") {
      initialValue = JSON.stringify(initialValue, null, 4);
    }

    setValue(initialValue || "");
  }, [props.initialValue]);

  return (
    <div
      data-testid={props.dataTestId}
      onClick={() => {
        if (props.onClick) {
          props.onClick();
        }
        if (props.onFocus) {
          props.onFocus();
        }
      }}
    >
      {helpText && (
        <p className="bg-gray-50 text-gray-500 p-3 mt-2 mb-2 rounded text-base text-sm">
          {" "}
          {helpText}{" "}
        </p>
      )}

      <Editor
        defaultLanguage={props.type}
        height="30vh"
        value={value}
        onChange={(code: string | undefined) => {
          if (code === undefined) {
            code = "";
          }

          setValue(code);
          if (props.onBlur) {
            props.onBlur();
          }
          if (props.onChange) {
            props.onChange(code);
          }
        }}
        onMount={(editor: any, _monaco: any) => {
          editorRef.current = editor;

          // Configure spell check for Markdown
          if (props.type === CodeType.Markdown) {
            const domNode: HTMLElement | null = editor.getDomNode();
            if (domNode) {
              const textareaElement: HTMLTextAreaElement | null =
                domNode.querySelector("textarea");
              if (textareaElement) {
                textareaElement.spellcheck = !props.disableSpellCheck;
              }
            }
          }
        }}
        defaultValue={value || placeholder || ""}
        className={className}
        options={{
          acceptSuggestionOnCommitCharacter: false,
          acceptSuggestionOnEnter: "off",
          accessibilitySupport: "auto",
          fontSize: 14,
          automaticLayout: true,
          codeLens: false,
          colorDecorators: true,
          contextmenu: false,
          cursorBlinking: "blink",
          tabIndex: props.tabIndex || 0,
          minimap: { enabled: false },
          cursorStyle: "line",
          disableLayerHinting: false,
          disableMonospaceOptimizations: false,
          dragAndDrop: false,
          fixedOverflowWidgets: false,
          folding: true,
          foldingStrategy: "auto",
          fontLigatures: false,
          formatOnPaste: false,
          formatOnType: false,

          hideCursorInOverviewRuler: false,
          links: true,
          mouseWheelZoom: false,
          multiCursorMergeOverlapping: true,
          multiCursorModifier: "alt",
          overviewRulerBorder: true,
          overviewRulerLanes: 2,
          quickSuggestions: false,
          quickSuggestionsDelay: 100,
          readOnly: props.readOnly || false,
          renderControlCharacters: false,
          scrollbar: {
            horizontal: "hidden",
          },
          renderLineHighlight: "all",
          suggestOnTriggerCharacters: false,
          renderWhitespace: "none",
          revealHorizontalRightPadding: 30,
          roundedSelection: true,
          rulers: [],
          scrollBeyondLastColumn: 5,
          scrollBeyondLastLine: true,
          selectOnLineNumbers: true,
          lineNumbers: props.showLineNumbers ? "on" : "off",
          selectionClipboard: true,
          selectionHighlight: true,
          showFoldingControls: "mouseover",
          smoothScrolling: false,
          wordBasedSuggestions: "off",
          wordWrap: props.type === CodeType.Markdown ? "on" : "off",
          tabCompletion: "off",
        }}
      />
      {props.error && (
        <p className="mt-1 text-sm text-red-400">{props.error}</p>
      )}
    </div>
  );
};

export default CodeEditor;
