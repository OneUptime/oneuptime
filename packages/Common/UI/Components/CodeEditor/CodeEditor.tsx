import Editor from "@monaco-editor/react";
import configureMonacoLoader from "./MonacoLoader";
import CodeType from "../../../Types/Code/CodeType";
import MarkdownUtil from "../../Utils/Markdown";
import { Theme, useTheme } from "../../Utils/Theme";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

configureMonacoLoader();

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
  ariaLabelledby?: string | undefined;
  /** Ids of the elements describing this control (hint, status, error). */
  ariaDescribedby?: string | undefined;
  /** Marks the control invalid to assistive technology. */
  ariaInvalid?: boolean | undefined;
  /** CSS height handed to Monaco. Defaults to "30vh". */
  height?: string | undefined;
}

/*
 * Callers hand us `any` through Form's currentValues, so a non-string can
 * still reach a prop typed as string.
 */
function toEditorText(value: string | undefined): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    return JSON.stringify(value, null, 4);
  }

  return value;
}

const CodeEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let className: string = "";

  const [placeholder, setPlaceholder] = useState<string>("");
  const [helpText, setHelpText] = useState<string | ReactElement>("");
  const editorRef: React.MutableRefObject<any> = useRef<any>(null);
  const theme: Theme = useTheme();

  /*
   * `value` is the controlled prop; `initialValue` only seeds an uncontrolled
   * editor. Both used to be synced from their own useEffect, and because
   * effects run in declaration order the `initialValue` one ran last on mount
   * and reset the state to "" - so a caller that passed only `value` mounted
   * an empty editor even though it had text to show. Seed the state on the
   * first render and keep the precedence in a single effect.
   */
  const [value, setValue] = useState<string>(() => {
    return toEditorText(props.value ?? props.initialValue);
  });

  useEffect(() => {
    setValue(
      toEditorText(
        props.value === undefined ? props.initialValue : props.value,
      ),
    );
  }, [props.value, props.initialValue]);

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

      /*
       * Help text, never `setPlaceholder`: whatever setPlaceholder holds is
       * rendered into `defaultValue` below, i.e. it becomes real document
       * text. The JS and CSS arms above get away with it because they wrap
       * the hint in a comment; an unwrapped YAML hint would be content the
       * user can accidentally save, and the server would reject it.
       */
      if (props.type === CodeType.YAML) {
        setHelpText(`${props.placeholder}`);
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

  const isYaml: boolean = props.type === CodeType.YAML;

  type GetInputAreaFunction = (editor: any) => HTMLTextAreaElement | null;

  /*
   * Monaco's real focusable control. The wrapper <div> this component returns
   * has no role, and ARIA forbids naming a role=generic element - so every
   * accessibility attribute has to land here instead.
   */
  const getInputArea: GetInputAreaFunction = (
    editor: any,
  ): HTMLTextAreaElement | null => {
    const domNode: HTMLElement | null = editor?.getDomNode?.() || null;

    if (!domNode) {
      return null;
    }

    return domNode.querySelector("textarea");
  };

  type ApplyAriaFunction = (editor: any) => void;

  const applyAria: ApplyAriaFunction = (editor: any): void => {
    const inputArea: HTMLTextAreaElement | null = getInputArea(editor);

    if (!inputArea) {
      return;
    }

    /*
     * aria-labelledby wins over the aria-label Monaco puts here itself
     * ("Editor content"), so the field's own label names the editor.
     */
    if (props.ariaLabelledby) {
      inputArea.setAttribute("aria-labelledby", props.ariaLabelledby);
    } else {
      inputArea.removeAttribute("aria-labelledby");
    }

    if (props.ariaDescribedby) {
      inputArea.setAttribute("aria-describedby", props.ariaDescribedby);
    } else {
      inputArea.removeAttribute("aria-describedby");
    }

    if (props.ariaInvalid) {
      inputArea.setAttribute("aria-invalid", "true");
    } else {
      inputArea.removeAttribute("aria-invalid");
    }
  };

  type ApplyModelOptionsFunction = (editor: any) => void;

  /*
   * Per-model, not per-editor and emphatically not global: a literal tab is
   * illegal as YAML indentation, and Monaco's model defaults are four spaces
   * with indentation detected from the initial content - so a rule pasted in
   * tab-indented would keep emitting tabs the parser rejects.
   */
  const applyModelOptions: ApplyModelOptionsFunction = (editor: any): void => {
    if (!isYaml) {
      return;
    }

    const model: any = editor?.getModel?.();

    if (!model || typeof model.updateOptions !== "function") {
      return;
    }

    model.updateOptions({ tabSize: 2, insertSpaces: true });
  };

  /*
   * Markdown is prose, so it follows the caller's preference. YAML is code:
   * red squiggles under every key name in a Sigma rule are pure noise, so
   * spell check is off for it regardless of what the caller asked for.
   */
  const shouldSpellCheck: boolean = isYaml ? false : !props.disableSpellCheck;
  const managesSpellCheck: boolean = props.type === CodeType.Markdown || isYaml;

  type ApplySpellCheckFunction = (editor: any) => void;

  const applySpellCheck: ApplySpellCheckFunction = (editor: any): void => {
    if (!editor || !managesSpellCheck) {
      return;
    }

    const domNode: HTMLElement | null = editor.getDomNode();

    if (!domNode) {
      return;
    }

    const textareaElement: HTMLTextAreaElement | null =
      domNode.querySelector("textarea");

    if (textareaElement) {
      textareaElement.spellcheck = shouldSpellCheck;
    }
  };

  // Handle spell check configuration for Monaco Editor
  useEffect(() => {
    applySpellCheck(editorRef.current);
    applyModelOptions(editorRef.current);
    // eslint-disable-next-line
  }, [props.disableSpellCheck, props.type]);

  useEffect(() => {
    applyAria(editorRef.current);
    // eslint-disable-next-line
  }, [props.ariaLabelledby, props.ariaDescribedby, props.ariaInvalid]);

  /*
   * Memoised: @monaco-editor/react calls editor.updateOptions() whenever this
   * object's identity changes, so an inline literal reconfigured the editor on
   * every parent re-render - which for the indentation options below would
   * reset them mid-keystroke.
   */
  const editorOptions: Record<string, unknown> = useMemo(() => {
    return {
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
      /*
       * Long scalars - a URL, a base64 blob, a Sigma `condition:` line - run
       * off the right edge, and with wordWrap off for code there is no other
       * way to reach them. Wrapping YAML instead is not an option: the
       * indentation IS the syntax, and a wrapped line reads as a deeper one.
       */
      scrollbar: {
        horizontal: isYaml ? "auto" : "hidden",
      },
      renderLineHighlight: "all",
      suggestOnTriggerCharacters: false,
      /*
       * In YAML whitespace is the syntax. Rendering it at the boundaries makes
       * the indentation depth countable and, more importantly, makes a literal
       * tab visible - tabs are illegal as YAML indentation and are otherwise
       * indistinguishable from spaces.
       */
      renderWhitespace: isYaml ? "boundary" : "none",
      revealHorizontalRightPadding: 30,
      roundedSelection: true,
      rulers: [],
      scrollBeyondLastColumn: 5,
      // Half a short editor as blank runway is wasted space in a form field.
      scrollBeyondLastLine: !isYaml,
      selectOnLineNumbers: true,
      /*
       * Every YAML parse error - ours and the server's - is reported as a
       * line and column, so the gutter is what makes the message actionable.
       */
      lineNumbers: props.showLineNumbers || isYaml ? "on" : "off",
      selectionClipboard: true,
      selectionHighlight: true,
      showFoldingControls: "mouseover",
      smoothScrolling: false,
      wordBasedSuggestions: "off",
      wordWrap: props.type === CodeType.Markdown ? "on" : "off",
      tabCompletion: "off",
      // The YAML chrome owns the padding, so the editor supplies its own.
      padding: isYaml ? { top: 10, bottom: 10 } : undefined,
      /*
       * tabSize / insertSpaces / detectIndentation deliberately do NOT belong
       * here. They are IGlobalEditorOptions: monaco's standalone editor pipes
       * whatever it is constructed with through updateConfigurationService,
       * which writes every registered `editor.*` key into a PROCESS-WIDE
       * config service - and those three are exactly the ones ModelService
       * reads back, pushing them onto every model on the page. Setting them
       * here would mean the last editor to mount dictates the indentation of
       * all the others. They are applied to this editor's own model instead,
       * in applyModelOptions below.
       */
    };
  }, [
    props.tabIndex,
    props.readOnly,
    props.showLineNumbers,
    props.type,
    isYaml,
  ]);

  return (
    <div
      data-testid={props.dataTestId}
      aria-labelledby={props.ariaLabelledby}
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
        theme={theme === Theme.Dark ? "vs-dark" : "light"}
        defaultLanguage={props.type}
        /*
         * `defaultLanguage` is applied only when the model is created, so a
         * caller that swaps CodeType after mount keeps the old grammar.
         * `language` is the prop that drives setModelLanguage afterwards.
         */
        language={props.type}
        height={props.height || "30vh"}
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
          applySpellCheck(editor);
          applyModelOptions(editor);
          applyAria(editor);
        }}
        defaultValue={value || placeholder || ""}
        className={className}
        options={editorOptions}
      />
      {props.error && (
        <p className="mt-1 text-sm text-red-400">{props.error}</p>
      )}
    </div>
  );
};

export default CodeEditor;
