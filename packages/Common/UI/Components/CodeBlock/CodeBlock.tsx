import "highlight.js/styles/a11y-dark.css";
import React, { FunctionComponent, ReactElement, useMemo, useRef } from "react";
/*
 * Trimmed highlight.js instance — lib/core plus only the languages CodeBlock
 * callers actually pass (see the audit in LanguageRegistry.ts). Replaces
 * react-highlight, which imported all 194 grammars (~1.5MB) eagerly.
 */
import hljs, { resolveRegisteredLanguage } from "./LanguageRegistry";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import Clipboard from "../../Utils/Clipboard";
import { Translator } from "../../Utils/TranslateTemplate";
import useClipboardCopy, { ClipboardCopy } from "../../Utils/UseClipboardCopy";
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

/*
 * The copy button says "Copied!" (a green tick) only once the code is on the
 * clipboard. It used to say so whatever happened, and on a page served over
 * plain http - where the browser has no clipboard API - the click threw
 * instead (issue #5132). When the browser refuses, it says "Copy failed" (a
 * red alert) and selects the code, to copy by hand.
 */
const CodeBlock: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const clipboard: ClipboardCopy = useClipboardCopy();
  const copied: boolean = clipboard.isCopied;
  const failed: boolean = clipboard.isFailed;
  const codeRef: React.RefObject<HTMLElement> = useRef<HTMLElement>(null);

  const handleCopy: () => Promise<void> = async (): Promise<void> => {
    if (typeof props.code !== "string") {
      return;
    }

    const hasCopied: boolean = await clipboard.copy(props.code);

    if (!hasCopied) {
      Clipboard.selectForManualCopy(codeRef.current);
    }
  };

  let copyTitle: string =
    translator.translateText("Copy to clipboard") || "Copy to clipboard";

  if (copied) {
    copyTitle = translator.translateText("Copied!") || "Copied!";
  } else if (failed) {
    copyTitle = translator.translateText("Copy failed") || "Copy failed";
  }

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

  /*
   * Code reads left to right on every page (Theme.css lays a <pre> out so
   * on a right-to-left one), and so does its block: on a Persian page the
   * copy button's right-2 would otherwise mean the start of the line and
   * cover the first characters of the code.
   */
  return (
    <div className="relative group" dir="ltr">
      {showCopyButton && typeof props.code === "string" && (
        <button
          onClick={() => {
            void handleCopy();
          }}
          className={`absolute top-2 right-2 p-2 rounded-md bg-gray-700 hover:bg-gray-600 transition-all hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100 z-10 ${
            failed
              ? "text-red-300 hover:text-red-200 opacity-100"
              : copied
                ? "text-green-400 opacity-100"
                : "text-gray-300 hover:text-white opacity-70"
          }`}
          title={copyTitle}
          aria-label={copyTitle}
          data-testid="code-block-copy-button"
          data-copy-state={clipboard.status}
          type="button"
        >
          <Icon
            icon={
              copied ? IconProp.Check : failed ? IconProp.Alert : IconProp.Copy
            }
            className="h-4 w-4"
          />
        </button>
      )}
      {showCopyButton && typeof props.code === "string" ? (
        // What the copy did, said to a screen reader.
        <span className="sr-only" role="status">
          {copied || failed ? copyTitle : ""}
        </span>
      ) : (
        <></>
      )}
      <div
        className="overflow-auto rounded-lg border border-gray-700"
        style={{ maxHeight: maxHeight }}
      >
        <pre>
          {highlightedHtml !== null ? (
            <code
              ref={codeRef}
              className={codeClassName}
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          ) : (
            <code ref={codeRef} className={codeClassName}>
              {props.code}
            </code>
          )}
        </pre>
      </div>
    </div>
  );
};

export default CodeBlock;
