import React, { FunctionComponent, ReactElement } from "react";

export interface LogSearchHelpProps {
  onExampleClick?: ((example: string) => void) | undefined;
}

interface HelpRow {
  syntax: string;
  description: string;
  example: string;
}

const HELP_ROWS: Array<HelpRow> = [
  {
    syntax: "free text",
    description: "Search log messages",
    example: "connection refused",
  },
  {
    syntax: '"quoted phrase"',
    description: "Exact phrase match",
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
    syntax: "span:<id>",
    description: "Filter by span ID",
    example: "span:e1f7f671fe78",
  },
  {
    syntax: "@<attr>:<value>",
    description: "Filter by attribute",
    example: "@http.status_code:500",
  },
  {
    syntax: "-field:value",
    description: "Exclude matching logs",
    example: "-severity:debug",
  },
  {
    syntax: "field:value*",
    description: "Wildcard match",
    example: "service:api-*",
  },
  {
    syntax: "@attr:>N",
    description: "Numeric comparison",
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
          to search · Combine filters:{" "}
          <code className="font-mono text-[10px] text-gray-500">
            severity:error service:api &quot;timeout&quot;
          </code>
        </span>
      </div>
    </div>
  );
};

export default LogSearchHelp;
