import React, { FunctionComponent, ReactElement } from "react";
import { getDateLocale } from "Common/Types/DateLanguage";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  ProductAnalyticsRetentionCohortDto,
  ProductAnalyticsRetentionDto,
  ProductAnalyticsRetentionPeriod,
} from "Common/Types/Rum/ProductAnalyticsEventReads";
import {
  formatProductAnalyticsCount,
  formatProductAnalyticsShare,
} from "./ProductAnalyticsFormat";
import {
  describeProductAnalyticsRetentionColumn,
  getProductAnalyticsRetentionShade,
} from "./ProductAnalyticsEventsFormat";

/*
 * Retention as a table of cohorts (issue #6444, part two): one row for the
 * people who first did the start event in a day, week or month, and one
 * column for each period after it - how many of them did the return event
 * then, as a share of the cohort, printed in the cell and shaded by it so
 * a glance down a column finds where people stop coming back. A period
 * that has not begun yet is left empty, not written as 0.
 */

export interface ProductAnalyticsRetentionCell {
  text: string;
  // The cell's whole sentence, for its title and a screen reader.
  title: string;
  shade: number;
}

export interface ProductAnalyticsRetentionRow {
  key: string;
  cohort: string;
  people: string;
  // Null: the period has not begun.
  cells: Array<ProductAnalyticsRetentionCell | null>;
}

/* A cohort's first day ("2026-03-02") in the reader's language: "Mar 2, 2026", "March 2026". */
export function describeProductAnalyticsCohort(data: {
  start: string;
  period: ProductAnalyticsRetentionPeriod;
  language: string;
}): string {
  const [year, month, day]: Array<number> = data.start
    .split("-")
    .map((part: string): number => {
      return Number(part);
    });

  if (!year || !month || !day) {
    return data.start;
  }

  try {
    return new Intl.DateTimeFormat(getDateLocale(data.language), {
      timeZone: "UTC",
      year: "numeric",
      month:
        data.period === ProductAnalyticsRetentionPeriod.Month ? "long" : "short",
      ...(data.period === ProductAnalyticsRetentionPeriod.Month
        ? {}
        : { day: "numeric" }),
    }).format(new Date(Date.UTC(year, month - 1, day)));
  } catch {
    return data.start;
  }
}

export function buildProductAnalyticsRetentionRows(data: {
  retention: ProductAnalyticsRetentionDto;
  translator: Translator;
}): Array<ProductAnalyticsRetentionRow> {
  const translator: Translator = data.translator;

  return data.retention.cohorts.map(
    (cohort: ProductAnalyticsRetentionCohortDto): ProductAnalyticsRetentionRow => {
      const label: string = describeProductAnalyticsCohort({
        start: cohort.start,
        period: data.retention.period,
        language: translator.language,
      });

      return {
        key: cohort.start,
        cohort: label,
        people: formatProductAnalyticsCount(cohort.people, translator),
        cells: cohort.returning.map(
          (
            count: number | null,
            index: number,
          ): ProductAnalyticsRetentionCell | null => {
            if (count === null) {
              return null;
            }

            const share: number = cohort.people > 0 ? count / cohort.people : 0;
            const text: string = formatProductAnalyticsShare({
              part: count,
              whole: cohort.people,
              language: translator.language,
            });

            return {
              text: text,
              shade: getProductAnalyticsRetentionShade(share),
              title: translator.translateTemplate(
                "{{column}}: {{count}} of {{people}} came back ({{percent}})",
                {
                  column: describeProductAnalyticsRetentionColumn({
                    period: data.retention.period,
                    index: index,
                    translator: translator,
                  }),
                  count: formatProductAnalyticsCount(count, translator),
                  people: formatProductAnalyticsCount(
                    cohort.people,
                    translator,
                  ),
                  percent: text,
                },
              ),
            };
          },
        ),
      };
    },
  );
}

/* Light text on the cells shaded past half, dark text on the rest. */
export const RETENTION_LIGHT_TEXT_SHADE: number = 0.5;

const ProductAnalyticsRetentionTable: FunctionComponent<{
  retention: ProductAnalyticsRetentionDto;
  dataTestId: string;
}> = (props: {
  retention: ProductAnalyticsRetentionDto;
  dataTestId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const rows: Array<ProductAnalyticsRetentionRow> =
    buildProductAnalyticsRetentionRows({
      retention: props.retention,
      translator: translator,
    });
  const columns: number = rows.reduce(
    (most: number, row: ProductAnalyticsRetentionRow): number => {
      return Math.max(most, row.cells.length);
    },
    0,
  );
  const columnIndexes: Array<number> = Array.from(
    { length: columns },
    (_value: unknown, index: number): number => {
      return index;
    },
  );

  return (
    <div className="overflow-x-auto" data-testid={props.dataTestId}>
      <table className="min-w-full border-separate border-spacing-0.5 text-sm">
        <thead>
          <tr>
            <th
              scope="col"
              className="whitespace-nowrap px-2 py-1.5 text-start text-xs font-medium uppercase tracking-wider text-gray-500"
            >
              {translator.translateText("Cohort")}
            </th>
            <th
              scope="col"
              className="whitespace-nowrap px-2 py-1.5 text-end text-xs font-medium uppercase tracking-wider text-gray-500"
            >
              {translator.translateText("People")}
            </th>
            {columnIndexes.map((index: number): ReactElement => {
              return (
                <th
                  key={index}
                  scope="col"
                  className="whitespace-nowrap px-2 py-1.5 text-center text-xs font-medium uppercase tracking-wider text-gray-500"
                >
                  {describeProductAnalyticsRetentionColumn({
                    period: props.retention.period,
                    index: index,
                    translator: translator,
                  })}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row: ProductAnalyticsRetentionRow): ReactElement => {
            return (
              <tr key={row.key} data-testid={`${props.dataTestId}-row`}>
                <th
                  scope="row"
                  className="whitespace-nowrap px-2 py-1.5 text-start font-medium text-gray-900"
                >
                  {row.cohort}
                </th>
                <td className="whitespace-nowrap px-2 py-1.5 text-end tabular-nums text-gray-700">
                  {row.people}
                </td>
                {columnIndexes.map((index: number): ReactElement => {
                  const cell: ProductAnalyticsRetentionCell | null | undefined =
                    row.cells[index];

                  if (!cell) {
                    return (
                      <td
                        key={index}
                        className="px-2 py-1.5"
                        data-testid={`${props.dataTestId}-empty`}
                      />
                    );
                  }

                  return (
                    <td
                      key={index}
                      className={`min-w-[3.5rem] rounded px-2 py-1.5 text-center tabular-nums ${
                        cell.shade >= RETENTION_LIGHT_TEXT_SHADE
                          ? "text-white"
                          : "text-gray-900"
                      }`}
                      style={{
                        backgroundColor:
                          cell.shade > 0
                            ? `rgb(79 70 229 / ${cell.shade})`
                            : undefined,
                      }}
                      title={cell.title}
                      aria-label={cell.title}
                      data-testid={`${props.dataTestId}-cell`}
                    >
                      {cell.text}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default ProductAnalyticsRetentionTable;
