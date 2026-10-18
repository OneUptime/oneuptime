import "highlight.js/styles/a11y-dark.css";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
/*
 * Trimmed highlight.js instance — lib/core plus only the languages CodeBlock
 * callers actually pass (see the audit in LanguageRegistry.ts). Replaces
 * react-highlight, which imported all 194 grammars (~1.5MB) eagerly.
 */
import hljs, { resolveRegisteredLanguage } from "./LanguageRegistry";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";

export interface ComponentProps {
  code: string | ReactElement;
  language: string;
  maxHeight?: string | undefined;
  showCopyButton?: boolean | undefined;
  /*
   * Wrap a line too long for the box instead of scrolling it sideways, and
   * keep the text clear of the copy button: for a snippet of a line or two
   * that people read whole and copy - an address, an ID, an embed code -
   * not for a program, whose lines read best as written.
   */
  wrapLongLines?: boolean | undefined;
}

/*
 * The code's own font for every token in it. Every frontend's index.ejs
 * draws every element in Inter (`* { font-family: Inter, ... }`), and a
 * rule that matches an element beats the font it would inherit, so
 * highlight.js's token spans - a JSON key, an HTML attribute - were drawn
 * in Inter between the code font's braces and spaces.
 */
export const CODE_BLOCK_TOKEN_FONT_CLASS_NAME: string =
  "[&_*]:[font-family:inherit]";

/*
 * A long line wraps, anywhere it must, and stops short of the copy button.
 * The gutter is important: the highlight theme's own .hljs padding comes
 * after the utilities and would take it back.
 */
export const CODE_BLOCK_WRAP_CLASS_NAME: string =
  "whitespace-pre-wrap break-words";
export const CODE_BLOCK_COPY_BUTTON_GUTTER_CLASS_NAME: string = "!pr-14";

const CodeBlock: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [copied, setCopied] = useState<boolean>(false);

  const handleCopy: () => void = (): void => {
    if (typeof props.code === "string") {
      navigator.clipboard.writeText(props.code).catch(() => {
        /* ignore clipboard errors */
      });
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    }
  };

  const maxHeight: string = props.maxHeight || "500px";
  const showCopyButton: boolean = props.showCopyButton !== false;

  /*
   * react-highlight rendered <pre><code className>…</code></pre> and then ran
   * hljs.highlightBlock over the DOM after mount (reading the language from
   * the `language-*` class and adding the theme's `hljs` class). We keep that
   * exact DOM shape but highlight synchronously: registered language → hljs
   * token markup (hljs.highlight escapes the source before wrapping it in
   * spans, so the HTML is safe to inject); unregistered language or a
   * ReactElement child → plain React-escaped rendering. hljs is never called
   * with an unknown language, so it never logs lookup warnings.
   */
  const registeredLanguage: string | null =
    typeof props.code === "string"
      ? resolveRegisteredLanguage(props.language)
      : null;

  const highlightedHtml: string | null = useMemo((): string | null => {
    if (typeof props.code !== "string" || !registeredLanguage) {
      return null;
    }

    return hljs.highlight(props.code, {
      language: registeredLanguage,
      ignoreIllegals: true,
    }).value;
  }, [props.code, registeredLanguage]);

  /*
   * `hljs` carries the a11y-dark theme background; react-highlight added it
   * post-mount, we add it up front so there is no unstyled first paint.
   */
  const codeClassName: string = [
    `hljs p-4 language-${props.language} text-sm leading-relaxed`,
    CODE_BLOCK_TOKEN_FONT_CLASS_NAME,
    ...(props.wrapLongLines ? [CODE_BLOCK_WRAP_CLASS_NAME] : []),
    ...(props.wrapLongLines && showCopyButton && typeof props.code === "string"
      ? [CODE_BLOCK_COPY_BUTTON_GUTTER_CLASS_NAME]
      : []),
  ].join(" ");

  return (
    <div className="relative group">
      {showCopyButton && typeof props.code === "string" && (
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 p-2 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white transition-all opacity-70 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100 z-10"
          title={translator.translateText(
            copied ? "Copied!" : "Copy to clipboard",
          )}
          aria-label={translator.translateText(
            copied ? "Copied" : "Copy to clipboard",
          )}
          type="button"
        >
          <Icon
            icon={copied ? IconProp.Check : IconProp.Copy}
            className="h-4 w-4"
          />
        </button>
      )}
      <div
        className="overflow-auto rounded-lg border border-gray-700"
        style={{ maxHeight: maxHeight }}
      >
        <pre>
          {highlightedHtml !== null ? (
            <code
              className={codeClassName}
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          ) : (
            <code className={codeClassName}>{props.code}</code>
          )}
        </pre>
      </div>
    </div>
  );
};

export default CodeBlock;
