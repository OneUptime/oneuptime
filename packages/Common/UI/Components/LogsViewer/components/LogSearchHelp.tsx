import React, { FunctionComponent, ReactElement } from "react";

export interface LogSearchHelpProps {
  onExampleClick?: ((example: string) => void) | undefined;
}

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
    syntax: "free text",
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

const LogSearchHelp: FunctionComponent<LogSearchHelpProps> = (
  props: LogSearchHelpProps,
): ReactElement => {
  return (
    <div className="absolute left-0 top-full z-50 mt-1 w-[36rem] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
      <div className="border-b border-gray-100 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Search syntax
        </span>
      </div>

      <table className="w-full">
        <tbody>
          {HELP_ROWS.map((row: HelpRow) => {
            return (
              <tr
                key={row.syntax}
                className="cursor-pointer transition-colors hover:bg-gray-50"
                onMouseDown={(e: React.MouseEvent) => {
                  e.preventDefault();
                  if (props.onExampleClick) {
                    props.onExampleClick(row.example);
                  }
                }}
              >
                <td className="whitespace-nowrap py-1.5 pl-3 pr-2">
                  <code className="font-mono text-xs text-indigo-600">
                    {row.syntax}
                  </code>
                </td>
                <td className="py-1.5 px-2">
                  <span className="text-xs text-gray-500">
                    {row.description}
                  </span>
                </td>
                <td className="whitespace-nowrap py-1.5 pl-2 pr-3 text-right">
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
          Press{" "}
          <kbd className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-mono text-[10px]">
            Enter
          </kbd>{" "}
          to search · Filters combine with AND ·{" "}
          <code className="font-mono text-[10px] text-gray-500">
            severity:error service:api &quot;timeout&quot;
          </code>{" "}
          · Use <code className="font-mono text-[10px]">\*</code> for a literal
          asterisk
        </span>
      </div>
    </div>
  );
};

export default LogSearchHelp;
