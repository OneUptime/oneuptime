import React, { FunctionComponent, ReactElement, ReactNode } from "react";

export interface ExceptionDetailListItem {
  label: string;
  value: ReactNode;
  // Muted secondary line under the value.
  hint?: string | undefined;
  // Spans both columns (long values such as a fingerprint).
  isWide?: boolean | undefined;
  testId: string;
}

export interface ComponentProps {
  items: Array<ExceptionDetailListItem>;
  columns?: 1 | 2 | undefined;
  label?: string | undefined;
}

/*
 * Compact label / value grid for the exception detail cards. Replaces the
 * generic Detail list, whose per-field descriptions tripled the height of a
 * card that holds a handful of short values.
 */
const ExceptionDetailList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const columns: 1 | 2 = props.columns || 2;

  return (
    <dl
      aria-label={props.label}
      className={`grid grid-cols-1 gap-x-8 gap-y-4 ${
        columns === 2 ? "md:grid-cols-2" : ""
      }`}
    >
      {props.items.map((item: ExceptionDetailListItem): ReactElement => {
        return (
          <div
            key={item.testId}
            data-testid={item.testId}
            className={`min-w-0 ${item.isWide && columns === 2 ? "md:col-span-2" : ""}`}
          >
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {item.label}
            </dt>
            <dd className="mt-1 min-w-0 break-words text-sm text-gray-900">
              {item.value}
            </dd>
            {item.hint && (
              <dd
                className="mt-0.5 truncate text-xs text-gray-500"
                title={item.hint}
              >
                {item.hint}
              </dd>
            )}
          </div>
        );
      })}
    </dl>
  );
};

export default ExceptionDetailList;
