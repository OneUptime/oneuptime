import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

export interface ResourceListColumn {
  label: string;
  widthPct: string;
  alignRight?: boolean;
}

export interface DashboardResourceListBaseProps {
  title?: string | undefined;
  pluralLabel: string;
  columns: Array<ResourceListColumn>;
  count: number;
  isLoading: boolean;
  error: string | null;
  isEmpty: boolean;
  emptyMessage: string;
  emptyIcon: IconProp;
  children: ReactNode;
}

const DashboardResourceListBase: FunctionComponent<
  DashboardResourceListBaseProps
> = (props: DashboardResourceListBaseProps): ReactElement => {
  if (props.isLoading && props.count === 0) {
    return (
      <div className="h-full flex flex-col animate-pulse">
        <div className="h-3 w-24 bg-gray-100 rounded mb-3"></div>
        <div className="flex-1 space-y-2">
          <div className="flex gap-4">
            {props.columns.map((c: ResourceListColumn, i: number) => {
              return (
                <div
                  key={i}
                  className="h-3 bg-gray-100 rounded"
                  style={{ width: c.widthPct }}
                ></div>
              );
            })}
          </div>
          {Array.from({ length: 5 }).map((_: unknown, i: number) => {
            return (
              <div
                key={i}
                className="flex gap-4"
                style={{ opacity: 1 - i * 0.15 }}
              >
                {props.columns.map((c: ResourceListColumn, j: number) => {
                  return (
                    <div
                      key={j}
                      className="h-3 bg-gray-50 rounded"
                      style={{ width: c.widthPct }}
                    ></div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (props.error) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-2">
        <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center">
          <div className="h-5 w-5 text-gray-300">
            <Icon icon={props.emptyIcon} />
          </div>
        </div>
        <p className="text-xs text-gray-400 text-center max-w-48">
          {props.error}
        </p>
      </div>
    );
  }

  return (
    <div
      className="h-full overflow-auto flex flex-col"
      style={{
        opacity: props.isLoading ? 0.5 : 1,
        transition: "opacity 0.2s ease-in-out",
      }}
    >
      {props.title && (
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            {props.title}
          </span>
          <span className="text-xs text-gray-300 tabular-nums">
            {props.count} {props.pluralLabel}
          </span>
        </div>
      )}
      <div className="flex-1 overflow-auto rounded-md border border-gray-100">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-gray-400 uppercase bg-gray-50/80 sticky top-0 border-b border-gray-100">
            <tr>
              {props.columns.map((c: ResourceListColumn, i: number) => {
                return (
                  <th
                    key={i}
                    className={`px-3 py-2.5 font-medium tracking-wider${
                      c.alignRight ? " text-right" : ""
                    }`}
                    style={{ width: c.widthPct }}
                  >
                    {c.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {props.isEmpty ? (
              <tr>
                <td
                  colSpan={props.columns.length}
                  className="px-4 py-8 text-center text-gray-400 text-sm"
                >
                  {props.emptyMessage}
                </td>
              </tr>
            ) : (
              props.children
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DashboardResourceListBase;
