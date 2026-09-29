import CodeEditor from "./CodeEditor";
import Icon from "../Icon/Icon";
import CodeType from "../../../Types/Code/CodeType";
import IconProp from "../../../Types/Icon/IconProp";
import {
  YamlSyntaxCheckResult,
  checkYamlSyntax,
  describeYamlSyntaxError,
} from "../../../Types/Code/YamlSyntax";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  initialValue?: string | undefined;
  value?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  onBlur?: (() => void) | undefined;
  onFocus?: (() => void) | undefined;
  /** Shown in the header bar as a hint. Never written into the document. */
  placeholder?: string | undefined;
  error?: string | undefined;
  readOnly?: boolean | undefined;
  tabIndex?: number | undefined;
  dataTestId?: string | undefined;
  ariaLabelledby?: string | undefined;
  height?: string | undefined;
  className?: string | undefined;
}

/** How long the document sits still before it is parsed again. */
export const YAML_VALIDATION_DEBOUNCE_MS: number = 250;

const DEFAULT_HINT: string =
  "Indentation is significant — use 2 spaces per level. Tabs are not valid YAML.";

const MAC_PLATFORM_PATTERN: RegExp = /Mac|iPhone|iPad|iPod/i;

type IsMacFunction = () => boolean;

/*
 * Monaco binds toggleTabFocusMode to Ctrl+M everywhere except macOS, where the
 * `mac` override in its keybinding makes it Ctrl+Shift+M. Naming the wrong key
 * turns the keyboard-trap advisory (WCAG 2.1.2) into a false one.
 */
const isMac: IsMacFunction = (): boolean => {
  if (typeof navigator === "undefined") {
    return false;
  }

  const platform: string =
    (navigator as { platform?: string }).platform || navigator.userAgent || "";

  return MAC_PLATFORM_PATTERN.test(platform);
};

/*
 * Callers reach us through Form's currentValues, which is `any`, so a
 * non-string can arrive on a prop typed as string. CodeEditor stringifies for
 * display; we mirror that so the status bar judges the same text the user
 * sees.
 */
type ToTextFunction = (value: string | undefined) => string;

const toText: ToTextFunction = (value: string | undefined): string => {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    return JSON.stringify(value, null, 4);
  }

  return value;
};

type CountLinesFunction = (text: string) => number;

const countLines: CountLinesFunction = (text: string): number => {
  return text.split("\n").length;
};

/**
 * A YAML document editor: Monaco with the YAML grammar and YAML-safe
 * indentation, wrapped in chrome that names the language, copies the document
 * and reports - as you type - whether what is in the box actually parses.
 *
 * Exists because YAML fields used to render the rich-text Markdown editor.
 * That was not only the wrong affordance (a Bold button over a Sigma rule);
 * the Markdown editor round-trips its value through HTML and back, and
 * indentation-sensitive YAML does not survive that intact.
 */
const YamlEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [text, setText] = useState<string>(() => {
    return toText(props.value ?? props.initialValue);
  });

  /*
   * The parse runs on a timer so it does not re-run on every keystroke, and
   * so a half-typed line is not judged the instant it is typed.
   */
  const [checkedText, setCheckedText] = useState<string>(() => {
    return toText(props.value ?? props.initialValue);
  });

  const instanceId: string = useId();
  const hintId: string = `${instanceId}-yaml-hint`;
  const statusId: string = `${instanceId}-yaml-status`;
  const escapeHintId: string = `${instanceId}-yaml-escape`;

  const [copied, setCopied] = useState<boolean>(false);
  const copyResetTimer: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `value` is the controlled prop; `initialValue` only seeds it.
  useEffect(() => {
    setText(
      toText(props.value === undefined ? props.initialValue : props.value),
    );
  }, [props.value, props.initialValue]);

  useEffect(() => {
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      setCheckedText(text);
    }, YAML_VALIDATION_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [text]);

  useEffect(() => {
    return () => {
      if (copyResetTimer.current) {
        clearTimeout(copyResetTimer.current);
      }
    };
  }, []);

  const syntax: YamlSyntaxCheckResult = useMemo(() => {
    return checkYamlSyntax(checkedText);
  }, [checkedText]);

  const isEmpty: boolean = text.trim() === "";

  type HandleCopyFunction = () => void;

  const handleCopy: HandleCopyFunction = (): void => {
    if (
      typeof navigator === "undefined" ||
      !navigator.clipboard ||
      typeof navigator.clipboard.writeText !== "function"
    ) {
      return;
    }

    void Promise.resolve(navigator.clipboard.writeText(text)).catch(() => {
      /* A denied clipboard permission is not worth an error state. */
    });

    setCopied(true);

    if (copyResetTimer.current) {
      clearTimeout(copyResetTimer.current);
    }

    copyResetTimer.current = setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  /*
   * One line, one message, five states. Whichever arm wins, the status bar is
   * the only place the field says anything - the editor below is not given
   * the error, so nothing is printed twice.
   */
  type StatusShape = {
    tone: "error" | "valid" | "invalid" | "empty";
    icon: IconProp;
    message: string;
  };

  const status: StatusShape = useMemo(() => {
    /*
     * The form re-validates synchronously on every keystroke and the field is
     * marked touched from the first one, so props.error arrives undebounced.
     * Deferring to it only once the parse has caught up with the text keeps a
     * red message off a half-typed line - and the moment they agree, the
     * form's sentence wins, because it is the one blocking Save.
     */
    if (props.error && checkedText === text) {
      return {
        tone: "error",
        icon: IconProp.Error,
        message: props.error,
      };
    }

    if (isEmpty) {
      return {
        tone: "empty",
        icon: IconProp.Info,
        message: "Nothing entered yet.",
      };
    }

    /*
     * checkYamlSyntax declines to judge a document whose shape is only known
     * at run time. Saying "Valid YAML" about text nobody parsed would be a
     * claim this component cannot make.
     */
    if (syntax.wasSkipped) {
      return {
        tone: "empty",
        icon: IconProp.Info,
        message: "Contains template expressions — syntax not checked.",
      };
    }

    if (syntax.isValid) {
      const lines: number = countLines(text);

      return {
        tone: "valid",
        icon: IconProp.CheckCircle,
        message: `Valid YAML · ${lines} ${lines === 1 ? "line" : "lines"}`,
      };
    }

    return {
      tone: "invalid",
      icon: IconProp.Alert,
      message: describeYamlSyntaxError(syntax),
    };
  }, [props.error, isEmpty, syntax, text, checkedText]);

  /*
   * Light-theme values only, one step darker than the obvious choice so the
   * 12px status text clears 4.5:1 on bg-gray-50 (WCAG 1.4.3). Dark mode is
   * not written here: Styles/Theme.css remaps these very classes globally
   * under html.dark, at a specificity that beats any dark: variant a
   * component could add - which is why no sibling component uses them.
   */
  const statusToneClassName: string = {
    error: "text-red-700",
    invalid: "text-amber-700",
    valid: "text-green-700",
    empty: "text-gray-500",
  }[status.tone];

  const borderClassName: string = props.error
    ? "border-red-300 focus-within:border-red-500 focus-within:ring-red-500"
    : "border-gray-300 focus-within:border-indigo-500 focus-within:ring-indigo-500";

  const escapeHint: string = isMac()
    ? "Press Control plus Shift plus M to toggle whether the Tab key indents or moves focus out of this editor."
    : "Press Control plus M to toggle whether the Tab key indents or moves focus out of this editor.";

  return (
    <div
      data-testid="yaml-editor"
      className={
        props.className ||
        `overflow-hidden rounded-md border bg-white shadow-sm transition-shadow focus-within:ring-1 ${borderClassName}`
      }
    >
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-3 py-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex shrink-0 items-center rounded border border-indigo-100 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
            YAML
          </span>
          <span
            id={hintId}
            data-testid="yaml-editor-hint"
            className="truncate text-xs text-gray-500"
          >
            {props.placeholder || DEFAULT_HINT}
          </span>
        </div>

        <button
          type="button"
          data-testid="yaml-editor-copy-button"
          aria-label={
            copied ? "YAML copied to clipboard" : "Copy YAML to clipboard"
          }
          disabled={isEmpty}
          onClick={handleCopy}
          className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-500"
        >
          <Icon
            icon={copied ? IconProp.Check : IconProp.Copy}
            className="h-3.5 w-3.5"
          />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {/*
       * Ahead of the editor in reading order, and referenced from Monaco's own
       * input through aria-describedby - Monaco takes Tab to indent, so this
       * is the only way out, and it has to be heard on the way in rather than
       * discovered on the way past.
       */}
      <span id={escapeHintId} className="sr-only">
        {escapeHint}
      </span>

      <CodeEditor
        type={CodeType.YAML}
        ariaLabelledby={props.ariaLabelledby}
        ariaDescribedby={`${escapeHintId} ${hintId} ${statusId}`}
        ariaInvalid={Boolean(props.error)}
        dataTestId={props.dataTestId}
        tabIndex={props.tabIndex}
        readOnly={props.readOnly}
        height={props.height || "22rem"}
        /*
         * The chrome above owns the border, the background and the focus ring,
         * so the editor contributes none of its own. `error` is deliberately
         * not forwarded either - it would paint a second red border and print
         * the message a second time under the box; the status bar below says
         * it once.
         */
        className="block w-full text-sm"
        value={text}
        onChange={(value: string) => {
          setText(value);

          if (props.onChange) {
            props.onChange(value);
          }
        }}
        onBlur={props.onBlur}
        onFocus={props.onFocus}
      />

      <div
        id={statusId}
        data-testid="yaml-editor-status"
        role="status"
        aria-live="polite"
        className={`flex items-center gap-1.5 border-t border-gray-200 bg-gray-50 px-3 py-1.5 text-xs ${statusToneClassName}`}
      >
        <Icon icon={status.icon} className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 break-words">{status.message}</span>
      </div>

      {/*
       * The copy button's own name changes, but a button name is not a live
       * region - nothing would speak the confirmation. This does.
       */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "YAML copied to clipboard" : ""}
      </span>
    </div>
  );
};

export default YamlEditor;
