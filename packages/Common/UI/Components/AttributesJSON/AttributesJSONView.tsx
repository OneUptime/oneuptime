import React, { FunctionComponent, ReactElement, useMemo } from "react";
import {
  ATTRIBUTES_JSON_FORMATS,
  AttributesJSONFormat,
  stringifyAttributesJSON,
} from "../../../Utils/Telemetry/AttributesJSON";
import {
  ATTRIBUTES_JSON_FORMAT_DESCRIPTIONS,
  ATTRIBUTES_JSON_FORMAT_LABELS,
  useAttributesJSONFormat,
} from "./AttributesJSONPreferences";
import {
  JSON_TOKEN_CLASS_NAMES,
  JSONToken,
  tokenizeJSONLine,
} from "./JSONHighlight";

export interface ComponentProps {
  attributes: unknown;
  // Height cap of the scrolling code area. Default: "max-h-80".
  maxHeightClassName?: string | undefined;
  className?: string | undefined;
  dataTestId?: string | undefined;
}

/*
 * Attributes as syntax-highlighted JSON, in the viewer's chosen shape - the
 * same text "Copy JSON" puts on the clipboard, so what you read is what you
 * paste. Line numbers make a long payload easy to talk about; long values
 * wrap rather than scroll sideways inside a narrow side panel.
 */
const AttributesJSONView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [format, setFormat] = useAttributesJSONFormat();

  const lines: Array<Array<JSONToken>> = useMemo(() => {
    return stringifyAttributesJSON(props.attributes, format)
      .split("\n")
      .map((line: string): Array<JSONToken> => {
        return tokenizeJSONLine(line);
      });
  }, [props.attributes, format]);

  const gutterWidthClass: string = lines.length >= 1000 ? "w-12" : "w-9";

  return (
    <div
      className={`overflow-hidden rounded-lg border border-gray-200 bg-white ${props.className || ""}`}
      data-testid={props.dataTestId}
    >
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 bg-gray-50/80 px-2.5 py-1.5">
        <div
          role="group"
          aria-label="JSON shape"
          className="inline-flex items-center gap-0.5"
        >
          {ATTRIBUTES_JSON_FORMATS.map(
            (itemFormat: AttributesJSONFormat): ReactElement => {
              const isActive: boolean = itemFormat === format;

              return (
                <button
                  key={itemFormat}
                  type="button"
                  aria-pressed={isActive}
                  className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    isActive
                      ? "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200"
                      : "text-gray-400 hover:bg-white hover:text-gray-700"
                  }`}
                  onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                    event.stopPropagation();
                    setFormat(itemFormat);
                  }}
                >
                  {ATTRIBUTES_JSON_FORMAT_LABELS[itemFormat]}
                </button>
              );
            },
          )}
        </div>
        {/* The section header already counts the attributes; say what the shape means. */}
        <span className="min-w-0 truncate text-[10.5px] text-gray-400">
          {ATTRIBUTES_JSON_FORMAT_DESCRIPTIONS[format]}
        </span>
      </div>
      <div
        className={`overflow-auto ${props.maxHeightClassName || "max-h-80"}`}
      >
        <pre
          className="py-2 font-mono text-[12px] leading-5"
          data-json-format={format}
          aria-label={`Attributes as ${format} JSON`}
        >
          <code className="block">
            {lines.map(
              (tokens: Array<JSONToken>, lineIndex: number): ReactElement => {
                return (
                  <div
                    key={lineIndex}
                    className="flex min-w-0 hover:bg-gray-50"
                  >
                    <span
                      aria-hidden="true"
                      className={`flex-none select-none pr-3 text-right text-gray-300 tabular-nums ${gutterWidthClass}`}
                    >
                      {lineIndex + 1}
                    </span>
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-all pr-3">
                      {tokens.map(
                        (
                          token: JSONToken,
                          tokenIndex: number,
                        ): ReactElement => {
                          return (
                            <span
                              key={tokenIndex}
                              className={JSON_TOKEN_CLASS_NAMES[token.kind]}
                            >
                              {token.text}
                            </span>
                          );
                        },
                      )}
                    </span>
                  </div>
                );
              },
            )}
          </code>
        </pre>
      </div>
    </div>
  );
};

export default AttributesJSONView;
