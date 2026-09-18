import React, { FunctionComponent, ReactElement } from "react";
import { SearchHelpRow } from "../types";

export interface TelemetrySearchHelpProps {
  rows: Array<SearchHelpRow>;
  combinedExample?: string | undefined;
  onExampleClick?: ((example: string) => void) | undefined;
}

const TelemetrySearchHelp: FunctionComponent<TelemetrySearchHelpProps> = (
  props: TelemetrySearchHelpProps,
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
          {props.rows.map((row: SearchHelpRow) => {
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
                <td className="px-2 py-1.5">
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
          to search
          {props.combinedExample ? (
            <>
              {" "}
              · Combine filters:{" "}
              <code className="font-mono text-[10px] text-gray-500">
                {props.combinedExample}
              </code>
            </>
          ) : null}
        </span>
      </div>
    </div>
  );
};

export default TelemetrySearchHelp;
