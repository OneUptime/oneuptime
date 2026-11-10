import React, { FunctionComponent, ReactElement } from "react";
import { getDateLocale } from "Common/Types/DateLanguage";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
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
 * that has not begun yet is left empty, not written as 0, and so is every
 * period of a cohort nobody is in: a share of nobody says nothing. The
 * cohort column stays in view while a narrow screen scrolls the periods.
 *
 * Above the cohorts, "All cohorts" (issue #6632) answers the question a
 * team asks most - what share comes back after one week - without reading
 * a whole column: each period's people who came back, summed over the
 * cohorts that have reached it, over those cohorts' people.
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
  // Null: the period has not begun, or nobody is in the cohort.
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
        data.period === ProductAnalyticsRetentionPeriod.Month
          ? "long"
          : "short",
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
  /*
   * The table starts at the first cohort anyone is in: the periods before
   * it - before counting started, or before anyone did the start event -
   * would be rows of nobody.
   */
  const firstWithPeople: number = data.retention.cohorts.findIndex(
    (cohort: ProductAnalyticsRetentionCohortDto): boolean => {
      return cohort.people > 0;
    },
  );

  return data.retention.cohorts
    .slice(Math.max(firstWithPeople, 0))
    .map(
      (
        cohort: ProductAnalyticsRetentionCohortDto,
      ): ProductAnalyticsRetentionRow => {
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
              if (count === null || cohort.people === 0) {
                return null;
              }

              return buildProductAnalyticsRetentionCell({
                count: count,
                people: cohort.people,
                index: index,
                period: data.retention.period,
                translator: translator,
              });
            },
          ),
        };
      },
    );
}

/*
 * One cell: the share of `people` who came back in the index-th period,
 * printed, shaded by it, and said whole for its title and a screen reader.
 */
function buildProductAnalyticsRetentionCell(data: {
  count: number;
  people: number;
  index: number;
  period: ProductAnalyticsRetentionPeriod;
  translator: Translator;
}): ProductAnalyticsRetentionCell {
  const translator: Translator = data.translator;
  const share: number = data.people > 0 ? data.count / data.people : 0;
  const text: string = formatProductAnalyticsShare({
    part: data.count,
    whole: data.people,
    language: translator.language,
  });

  return {
    text: text,
    shade: getProductAnalyticsRetentionShade(share),
    title: translator.translateTemplate(
      "{{column}}: {{count}} of {{people}} came back ({{percent}})",
      {
        column: describeProductAnalyticsRetentionColumn({
          period: data.period,
          index: data.index,
          translator: translator,
        }),
        count: formatProductAnalyticsCount(data.count, translator),
        people: formatProductAnalyticsCount(data.people, translator),
        percent: text,
      },
    ),
  };
}

/* One period of every cohort together: who came back, of the people who could have. */
export interface ProductAnalyticsRetentionAveragePeriod {
  returning: number;
  people: number;
}

export interface ProductAnalyticsRetentionAverage {
  // Everyone in every cohort.
  people: number;
  // For each period: null while no cohort with anyone in it has reached it.
  periods: Array<ProductAnalyticsRetentionAveragePeriod | null>;
}

/*
 * Every cohort as one (issue #6632), weighted by its people: for each
 * period, the people who came back in it, summed over the cohorts whose
 * period has begun, divided by those cohorts' people - so a cohort of 200
 * counts four times one of 50, and a period only the oldest cohorts have
 * reached is theirs alone. A cohort nobody is in is left out, as its row
 * is; so is a cohort's period that has not begun (null). A count that is
 * not a whole number of people at or above 0 counts as nobody.
 */
export function averageProductAnalyticsRetention(
  retention: ProductAnalyticsRetentionDto,
): ProductAnalyticsRetentionAverage {
  const periods: Array<ProductAnalyticsRetentionAveragePeriod | null> = [];
  let people: number = 0;

  for (const cohort of retention.cohorts) {
    if (!isCountOfPeople(cohort.people) || cohort.people === 0) {
      continue;
    }

    people += cohort.people;

    cohort.returning.forEach((count: number | null, index: number): void => {
      while (periods.length <= index) {
        periods.push(null);
      }

      if (count === null) {
        return;
      }

      const period: ProductAnalyticsRetentionAveragePeriod = periods[index] || {
        returning: 0,
        people: 0,
      };

      periods[index] = {
        returning:
          period.returning + (isCountOfPeople(count) ? count : 0),
        people: period.people + cohort.people,
      };
    });
  }

  return { people: people, periods: periods };
}

function isCountOfPeople(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/*
 * The cohorts with anyone in them: the "All cohorts" row is drawn once
 * there are two, as one would only say again what its own row says.
 */
export const RETENTION_AVERAGE_MIN_COHORTS: number = 2;

export const ALL_COHORTS: string = translationKey("All cohorts");

/*
 * The "All cohorts" row over the cohorts' rows, or null when fewer than
 * RETENTION_AVERAGE_MIN_COHORTS cohorts have anyone in them. Its cells read
 * like a cohort's - the same shades and the same sentence, of the people of
 * the cohorts that reached the period ("Week 3: 20 of 200 came back").
 */
export function buildProductAnalyticsRetentionAverageRow(data: {
  retention: ProductAnalyticsRetentionDto;
  translator: Translator;
}): ProductAnalyticsRetentionRow | null {
  const cohortsWithPeople: number = data.retention.cohorts.filter(
    (cohort: ProductAnalyticsRetentionCohortDto): boolean => {
      return isCountOfPeople(cohort.people) && cohort.people > 0;
    },
  ).length;

  if (cohortsWithPeople < RETENTION_AVERAGE_MIN_COHORTS) {
    return null;
  }

  const average: ProductAnalyticsRetentionAverage =
    averageProductAnalyticsRetention(data.retention);

  return {
    key: "all-cohorts",
    cohort: data.translator.translateText(ALL_COHORTS) || ALL_COHORTS,
    people: formatProductAnalyticsCount(average.people, data.translator),
    cells: average.periods.map(
      (
        period: ProductAnalyticsRetentionAveragePeriod | null,
        index: number,
      ): ProductAnalyticsRetentionCell | null => {
        if (!period || period.people === 0) {
          return null;
        }

        return buildProductAnalyticsRetentionCell({
          count: period.returning,
          people: period.people,
          index: index,
          period: data.retention.period,
          translator: data.translator,
        });
      },
    ),
  };
}

/* Light text on the cells shaded past half, dark text on the rest. */
export const RETENTION_LIGHT_TEXT_SHADE: number = 0.5;

/*
 * The cohort column holds its place at the table's start edge - the left,
 * or the right on a page read right to left - while the periods scroll
 * under it, on the card's own background.
 */
export const RETENTION_COHORT_COLUMN_CLASS_NAME: string =
  "sticky start-0 z-10 bg-white";

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
  const averageRow: ProductAnalyticsRetentionRow | null =
    buildProductAnalyticsRetentionAverageRow({
      retention: props.retention,
      translator: translator,
    });
  const columns: number = [...(averageRow ? [averageRow] : []), ...rows].reduce(
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

  /*
   * A row: its cohort (or "All cohorts", bold, its test ids its own), its
   * people, and a cell a period - shaded, or empty while the period has
   * not begun.
   */
  const renderRow: (
    row: ProductAnalyticsRetentionRow,
    isAverage: boolean,
  ) => ReactElement = (
    row: ProductAnalyticsRetentionRow,
    isAverage: boolean,
  ): ReactElement => {
    const testId: string = isAverage
      ? `${props.dataTestId}-average`
      : props.dataTestId;

    return (
      <tr key={row.key} data-testid={`${testId}-row`}>
        <th
          scope="row"
          className={`${RETENTION_COHORT_COLUMN_CLASS_NAME} whitespace-nowrap px-2 py-1.5 text-start text-gray-900 ${
            isAverage ? "font-semibold" : "font-medium"
          }`}
        >
          {row.cohort}
        </th>
        <td
          className={`whitespace-nowrap px-2 py-1.5 text-end tabular-nums ${
            isAverage ? "font-semibold text-gray-900" : "text-gray-700"
          }`}
        >
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
                data-testid={`${testId}-empty`}
              />
            );
          }

          return (
            <td
              key={index}
              className={`min-w-[3.5rem] rounded px-2 py-1.5 text-center tabular-nums ${
                isAverage ? "font-semibold " : ""
              }${
                cell.shade >= RETENTION_LIGHT_TEXT_SHADE
                  ? "text-white"
                  : "text-gray-900"
              }`}
              style={{
                backgroundColor:
                  cell.shade > 0 ? `rgb(79 70 229 / ${cell.shade})` : undefined,
              }}
              title={cell.title}
              aria-label={cell.title}
              data-testid={`${testId}-cell`}
            >
              {cell.text}
            </td>
          );
        })}
      </tr>
    );
  };

  return (
    <div className="overflow-x-auto" data-testid={props.dataTestId}>
      <table className="min-w-full border-separate border-spacing-0.5 text-sm">
        <thead>
          <tr>
            <th
              scope="col"
              className={`${RETENTION_COHORT_COLUMN_CLASS_NAME} whitespace-nowrap px-2 py-1.5 text-start text-xs font-medium uppercase tracking-wider text-gray-500`}
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
        {averageRow ? (
          /*
           * Its own group above the cohorts', a little apart from them: it
           * reads as what the cohorts add up to, not as one more of them.
           */
          <tbody>
            {renderRow(averageRow, true)}
            <tr aria-hidden="true">
              <td colSpan={columns + 2} className="h-1.5 p-0" />
            </tr>
          </tbody>
        ) : (
          <></>
        )}
        <tbody>
          {rows.map((row: ProductAnalyticsRetentionRow): ReactElement => {
            return renderRow(row, false);
          })}
        </tbody>
      </table>
    </div>
  );
};

export default ProductAnalyticsRetentionTable;
