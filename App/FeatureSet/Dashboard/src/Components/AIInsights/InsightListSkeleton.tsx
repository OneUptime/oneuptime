import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  rowCount: number;
}

/*
 * Placeholder rows in the real row geometry. A centered spinner made the
 * whole list jump into place on every filter change; this keeps the page
 * height and the column rhythm steady while the request is in flight.
 *
 * The breakpoint gates here must stay in step with InsightListItem and the
 * list's column header — all three switch to the column layout at xl.
 */
const InsightListSkeleton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const rows: Array<number> = Array.from(
    { length: props.rowCount },
    (_value: unknown, index: number) => {
      return index;
    },
  );

  return (
    <ul className="divide-y divide-gray-100" aria-hidden="true">
      {rows.map((row: number) => {
        return (
          <li key={row}>
            <div className="flex animate-pulse items-center gap-4 px-4 py-3.5">
              <div className="h-10 w-10 flex-shrink-0 rounded-lg bg-gray-100" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3.5 w-2/5 rounded bg-gray-100" />
                <div className="h-3 w-1/4 rounded bg-gray-100" />
              </div>
              <div className="hidden w-32 flex-shrink-0 xl:block">
                <div className="h-5 w-24 rounded-full bg-gray-100" />
              </div>
              <div className="hidden w-24 flex-shrink-0 xl:block">
                <div className="ml-auto h-3.5 w-8 rounded bg-gray-100" />
              </div>
              <div className="hidden w-36 flex-shrink-0 xl:block">
                <div className="ml-auto h-3.5 w-20 rounded bg-gray-100" />
              </div>
              <div className="hidden w-5 flex-shrink-0 xl:block" />
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export default InsightListSkeleton;
