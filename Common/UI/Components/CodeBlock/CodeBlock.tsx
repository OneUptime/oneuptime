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

export interface ComponentProps {
  code: string | ReactElement;
  language: string;
  maxHeight?: string | undefined;
  showCopyButton?: boolean | undefined;
}

const CodeBlock: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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
  const codeClassName: string = `hljs p-4 language-${props.language} text-sm leading-relaxed`;

  return (
    <div className="relative group">
      {showCopyButton && typeof props.code === "string" && (
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 p-2 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white transition-all opacity-70 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100 z-10"
          title={copied ? "Copied!" : "Copy to clipboard"}
          aria-label={copied ? "Copied" : "Copy to clipboard"}
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
