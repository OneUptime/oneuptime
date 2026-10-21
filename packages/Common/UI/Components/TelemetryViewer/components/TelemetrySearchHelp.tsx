import React, { FunctionComponent, ReactElement } from "react";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import TranslatedSentence from "../../TranslatedSentence/TranslatedSentence";
import { SearchHelpRow } from "../types";

export interface TelemetrySearchHelpProps {
  rows: Array<SearchHelpRow>;
  combinedExample?: string | undefined;
  onExampleClick?: ((example: string) => void) | undefined;
  /*
   * Where the panel hangs from its search box. An explorer's search is the
   * first control of its toolbar, so the panel opens from its left edge
   * (the default); a search at the right of a table's header opens it from
   * its right edge, and never wider than the screen.
   */
  align?: "left" | "right" | undefined;
  dataTestId?: string | undefined;
}

/*
 * Below md a search fills its line, and the panel is exactly as wide as the
 * search it hangs from: hung 36rem wide from one edge it ran past the
 * other edge of a phone's screen, and its rows were cut off there.
 */
export const TELEMETRY_SEARCH_HELP_PLACEMENT_CLASS_NAMES: Record<
  "left" | "right",
  string
> = {
  left: "absolute left-0 top-full z-50 mt-1 w-[36rem] max-md:right-0 max-md:w-auto",
  right:
    "absolute right-0 top-full z-50 mt-1 w-[36rem] max-w-[calc(100vw-2rem)] max-md:left-0 max-md:w-auto max-md:max-w-none",
};

/*
 * A row of the panel: from sm up a table row of three columns - the token,
 * what it does, an example. Below sm, where the three squeezed what a token
 * does to a word or two a line, the token and its example share the first
 * line (the example ending in "..." where it has to) and what it does runs
 * under both.
 */
export const TELEMETRY_SEARCH_HELP_ROW_CLASS_NAME: string =
  "cursor-pointer transition-colors hover:bg-gray-50 max-sm:grid max-sm:grid-cols-[auto_minmax(0,1fr)] max-sm:gap-x-3 max-sm:px-3 max-sm:py-2";

export const TELEMETRY_SEARCH_HELP_SYNTAX_CELL_CLASS_NAME: string =
  "whitespace-nowrap py-1.5 pl-3 pr-2 max-sm:p-0";

/*
 * Never one word left on a line of its own ("Visited a page whose address
 * starts with / this").
 */
export const TELEMETRY_SEARCH_HELP_DESCRIPTION_CELL_CLASS_NAME: string =
  "text-pretty px-2 py-1.5 max-sm:col-span-2 max-sm:row-start-2 max-sm:p-0 max-sm:pt-0.5";

export const TELEMETRY_SEARCH_HELP_EXAMPLE_CELL_CLASS_NAME: string =
  "whitespace-nowrap py-1.5 pl-2 pr-3 text-right max-sm:col-start-2 max-sm:row-start-1 max-sm:min-w-0 max-sm:truncate max-sm:p-0";

const TelemetrySearchHelp: FunctionComponent<TelemetrySearchHelpProps> = (
  props: TelemetrySearchHelpProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  return (
    <div
      data-testid={props.dataTestId}
      className={`${
        TELEMETRY_SEARCH_HELP_PLACEMENT_CLASS_NAMES[props.align || "left"]
      } overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg`}
    >
      <div className="border-b border-gray-100 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          {translator.translateText("Search syntax")}
        </span>
      </div>

      <table className="w-full max-sm:block">
        <tbody className="max-sm:block">
          {props.rows.map((row: SearchHelpRow) => {
            return (
              <tr
                key={row.syntax}
                className={TELEMETRY_SEARCH_HELP_ROW_CLASS_NAME}
                onMouseDown={(e: React.MouseEvent) => {
                  e.preventDefault();
                  if (props.onExampleClick) {
                    props.onExampleClick(row.example);
                  }
                }}
              >
                <td className={TELEMETRY_SEARCH_HELP_SYNTAX_CELL_CLASS_NAME}>
                  <code className="font-mono text-xs text-indigo-600">
                    {translator.translateText(row.syntax)}
                  </code>
                </td>
                <td
                  className={TELEMETRY_SEARCH_HELP_DESCRIPTION_CELL_CLASS_NAME}
                >
                  <span className="text-xs text-gray-500">
                    {translator.translateText(row.description)}
                  </span>
                </td>
                <td className={TELEMETRY_SEARCH_HELP_EXAMPLE_CELL_CLASS_NAME}>
                  <code className="font-mono text-[11px] text-gray-400">
                    {row.example}
                  </code>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="border-t border-gray-100 px-3 py-1.5">
        <span className="text-[10px] text-gray-400">
          <TranslatedSentence
            template={
              props.combinedExample
                ? "Press {{key}} to search · Combine filters: {{example}}"
                : "Press {{key}} to search"
            }
            slots={{
              key: (
                <kbd className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-mono text-[10px]">
                  Enter
                </kbd>
              ),
              ...(props.combinedExample
                ? {
                    example: (
                      <code className="font-mono text-[10px] text-gray-500">
                        {props.combinedExample}
                      </code>
                    ),
                  }
                : {}),
            }}
          />
        </span>
      </div>
    </div>
  );
};

export default TelemetrySearchHelp;
