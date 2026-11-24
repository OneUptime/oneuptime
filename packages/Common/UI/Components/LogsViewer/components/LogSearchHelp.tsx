import React, { FunctionComponent, ReactElement, RefObject } from "react";
import { Translator, translationKey } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import TranslatedSentence from "../../TranslatedSentence/TranslatedSentence";
import LayeredPopover from "../../Tooltip/LayeredPopover";
import {
  TELEMETRY_SEARCH_HELP_DESCRIPTION_CELL_CLASS_NAME,
  TELEMETRY_SEARCH_HELP_EXAMPLE_CELL_CLASS_NAME,
  TELEMETRY_SEARCH_HELP_ROW_CLASS_NAME,
  TELEMETRY_SEARCH_HELP_SYNTAX_CELL_CLASS_NAME,
  TELEMETRY_SEARCH_HELP_WIDTH_CLASS_NAME,
} from "../../TelemetryViewer/components/TelemetrySearchHelp";

export interface LogSearchHelpProps {
  /*
   * The search box the panel hangs from: it is drawn on the tooltip layer
   * against it (LayeredPopover), so a drawer or a card the search sits in
   * never cuts it off (#9909).
   */
  anchorRef: RefObject<HTMLElement | null>;
  // The panel's id, for the search's aria-owns.
  id?: string | undefined;
  onExampleClick?: ((example: string) => void) | undefined;
}

// The panel, for tests that read it.
export const LOG_SEARCH_HELP_TEST_ID: string = "log-search-help";

interface HelpRow {
  syntax: string;
  description: string;
  example: string;
}

/*
 * The syntax table. Every row here is honoured by the shared search grammar
 * in Common/Types/Telemetry/TelemetrySearchQuery — the help used to advertise
 * a wildcard row whose own example ("service:api-*") matched nothing, so the
 * rule is that a row is only listed once its behaviour is pinned by a test.
 */
const HELP_ROWS: Array<HelpRow> = [
  {
    syntax: translationKey("free text"),
    description: "Search log messages",
    example: "connection refused",
  },
  {
    syntax: '"quoted phrase"',
    description: "Keep spaces together",
    example: '"out of memory"',
  },
  {
    syntax: "severity:<level>",
    description: "Filter by log level",
    example: "severity:error",
  },
  {
    syntax: "service:<name>",
    description: "Filter by service",
    example: "service:api",
  },
  {
    syntax: "trace:<id>",
    description: "Filter by trace ID",
    example: "trace:abc123def456",
  },
  {
    syntax: "@<attr>:<value>",
    description: "Filter by attribute",
    example: "@http.status_code:500",
  },
  {
    syntax: "@<attr>:<value>*",
    description: "Wildcard — * is any text, ? is one character",
    example: "@platform.team:a*",
  },
  {
    syntax: "@<attr>:*",
    description: "Attribute is present",
    example: "@user.id:*",
  },
  {
    syntax: "@<attr>:~<text>",
    description: "Attribute contains",
    example: "@url.host:~internal",
  },
  {
    syntax: "-<filter>",
    description: "Exclude — works with every filter above",
    example: "-@platform.team:a*",
  },
  {
    syntax: "@<attr>:(a OR b)",
    description: "Any of these values",
    example: "@http.method:(GET OR POST)",
  },
  {
    syntax: "@<attr>:>N",
    description: "Numeric comparison (also >=, <, <=)",
    example: "@duration:>1000",
  },
];

/*
 * The logs search's syntax panel, dropped down while the search is empty:
 * the popup of a field (LayeredPopover's isFieldPopup), so the focus, the
 * keys and a press stay the search's, as they were while the panel was
 * drawn in place. As the explorers' panel is (TelemetrySearchHelp), it is
 * 36rem from md up and as wide as its search below that, and below sm each
 * row puts the token and its example on one line and what it does under
 * both: hung 36rem wide in place, it ran past a phone's screen.
 */
const LogSearchHelp: FunctionComponent<LogSearchHelpProps> = (
  props: LogSearchHelpProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  return (
    <LayeredPopover anchorRef={props.anchorRef} isFieldPopup={true}>
      <div
        id={props.id}
        data-testid={LOG_SEARCH_HELP_TEST_ID}
        className={`${TELEMETRY_SEARCH_HELP_WIDTH_CLASS_NAME} overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg`}
      >
        <div className="border-b border-gray-100 px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            {translator.translateText("Search syntax")}
          </span>
        </div>

        <table className="w-full max-sm:block">
          <tbody className="max-sm:block">
            {HELP_ROWS.map((row: HelpRow) => {
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
                    className={
                      TELEMETRY_SEARCH_HELP_DESCRIPTION_CELL_CLASS_NAME
                    }
                  >
                    <span className="text-xs text-gray-500">
                      {translator.translateText(row.description)}
                    </span>
                  </td>
                  <td className={TELEMETRY_SEARCH_HELP_EXAMPLE_CELL_CLASS_NAME}>
                    <code className="font-mono text-xs text-gray-500">
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
              template="Press {{key}} to search · Filters combine with AND · {{example}} · Use {{escape}} for a literal asterisk"
              slots={{
                key: (
                  <kbd className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-mono text-xs">
                    Enter
                  </kbd>
                ),
                example: (
                  <code className="font-mono text-xs text-gray-500">
                    severity:error service:api &quot;timeout&quot;
                  </code>
                ),
                escape: <code className="font-mono text-xs">\*</code>,
              }}
            />
          </span>
        </div>
      </div>
    </LayeredPopover>
  );
};

export default LogSearchHelp;
