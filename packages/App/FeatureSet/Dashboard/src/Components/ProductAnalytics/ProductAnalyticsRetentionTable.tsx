import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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

/*
 * A cohort's first day ("2026-03-02") in the reader's language: "Mar 2,
 * 2026", "March 2026" - or "Mar 2", "March" without its year (withYear
 * false), where the table has said the year another way.
 */
export function describeProductAnalyticsCohort(data: {
  start: string;
  period: ProductAnalyticsRetentionPeriod;
  language: string;
  withYear?: boolean | undefined;
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
      ...(data.withYear === false ? {} : { year: "numeric" }),
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

/* The year it is at `now` in a time zone ("2026"); the UTC year when the zone is not one. */
function getYearInTimeZone(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone,
      year: "numeric",
    }).format(now);
  } catch {
    return String(now.getUTCFullYear());
  }
}

/*
 * Whether a compact table leaves its cohorts' year out: only when every
 * cohort it draws starts in the year it is now, in the read's own time
 * zone. A table across New Year keeps it, and so does one of a past year,
 * where "Oct 5" alone would read as this October.
 */
export function canLeaveOutProductAnalyticsCohortYear(data: {
  cohorts: ReadonlyArray<ProductAnalyticsRetentionCohortDto>;
  timeZone: string;
  now: Date;
}): boolean {
  const year: string = getYearInTimeZone(data.now, data.timeZone);

  return (
    data.cohorts.length > 0 &&
    data.cohorts.every(
      (cohort: ProductAnalyticsRetentionCohortDto): boolean => {
        return cohort.start.split("-")[0] === year;
      },
    )
  );
}

export function buildProductAnalyticsRetentionRows(data: {
  retention: ProductAnalyticsRetentionDto;
  translator: Translator;
  /*
   * Drawn compact (a dashboard widget): the cohorts' year is left out when
   * every one is in this year (canLeaveOutProductAnalyticsCohortYear).
   */
  isCompact?: boolean | undefined;
  // The time "this year" is read at; now when left out.
  now?: Date | undefined;
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
  const cohorts: Array<ProductAnalyticsRetentionCohortDto> =
    data.retention.cohorts.slice(Math.max(firstWithPeople, 0));
  const withYear: boolean = !(
    data.isCompact &&
    canLeaveOutProductAnalyticsCohortYear({
      cohorts: cohorts,
      timeZone: data.retention.timeZone,
      now: data.now || new Date(),
    })
  );

  return cohorts.map(
    (
      cohort: ProductAnalyticsRetentionCohortDto,
    ): ProductAnalyticsRetentionRow => {
      const label: string = describeProductAnalyticsCohort({
        start: cohort.start,
        period: data.retention.period,
        language: translator.language,
        withYear: withYear,
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
        returning: period.returning + (isCountOfPeople(count) ? count : 0),
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

/* The table's type and spacing: a page's, or a dashboard widget's. */
export interface ProductAnalyticsRetentionTableDensity {
  table: string;
  // Cohort, People and each period over its column.
  header: string;
  // A row's cohort and its people.
  label: string;
  // A period's cell, shaded or empty.
  cell: string;
}

export const RETENTION_TABLE_DENSITY: Readonly<
  Record<"page" | "compact", ProductAnalyticsRetentionTableDensity>
> = {
  page: {
    table: "text-sm",
    header: "px-2 py-1.5 text-xs tracking-wider",
    label: "px-2 py-1.5",
    cell: "min-w-[3.5rem] px-2 py-1.5",
  },
  /*
   * A widget's, as the board's other tables are set (text-xs cells under
   * 11px headings): a column the width of its share, so the default
   * widget - eight units, 521px beside the side menu at 1280 - holds a
   * month's six weeks and All cohorts without a sideways scroll, where the
   * page's spacing cut the sixth week.
   */
  compact: {
    table: "text-xs",
    header: "px-1.5 py-1 text-[11px] tracking-wide",
    label: "px-1.5 py-1",
    cell: "min-w-[2.75rem] px-1.5 py-1",
  },
};

/*
 * How many of a table's periods fit in a width (issue #6721): all when the
 * whole table does, else the most of them, from the first, that fit beside
 * the cohort and people columns - never fewer than one, so a narrow widget
 * still shows a period and scrolls rather than showing none. The widths are
 * the table's as drawn with every period (readProductAnalyticsRetention-
 * TableWidths): each column's, and the space the table keeps around each
 * cell (its border-spacing), before the first, between and after the last.
 */
export function countProductAnalyticsRetentionPeriodsThatFit(data: {
  widthInPx: number;
  // The cohort and the people columns.
  labelColumnsInPx: ReadonlyArray<number>;
  // Each period's column, first to last.
  periodColumnsInPx: ReadonlyArray<number>;
  spacingInPx: number;
}): number {
  const periods: number = data.periodColumnsInPx.length;

  // Nothing to measure against: every period, as the page draws them.
  if (!Number.isFinite(data.widthInPx) || data.widthInPx <= 0) {
    return periods;
  }

  // A fraction of a pixel of rounding is no reason to leave a period out.
  const roomInPx: number = data.widthInPx + 0.01;
  let usedInPx: number = data.spacingInPx;

  for (const width of data.labelColumnsInPx) {
    usedInPx += width + data.spacingInPx;
  }

  let fit: number = 0;

  for (const width of data.periodColumnsInPx) {
    usedInPx += width + data.spacingInPx;

    if (usedInPx > roomInPx) {
      break;
    }

    fit += 1;
  }

  return Math.min(periods, Math.max(fit, 1));
}

/* The widths of a table as drawn: each column's (its heading's) and the spacing around its cells. */
export interface ProductAnalyticsRetentionTableWidths {
  columnsInPx: Array<number>;
  spacingInPx: number;
}

export function readProductAnalyticsRetentionTableWidths(
  table: HTMLTableElement,
): ProductAnalyticsRetentionTableWidths {
  const headings: Array<HTMLTableCellElement> = Array.from(
    table.tHead?.rows[0]?.cells || [],
  );
  const columnsInPx: Array<number> = headings.map(
    (heading: HTMLTableCellElement): number => {
      return heading.getBoundingClientRect().width;
    },
  );
  const cellsInPx: number = columnsInPx.reduce(
    (total: number, width: number): number => {
      return total + width;
    },
    0,
  );
  // What the table is wider than its columns: the spacing, once more than there are columns.
  const spacingInPx: number =
    columnsInPx.length > 0
      ? Math.max(
          0,
          (table.getBoundingClientRect().width - cellsInPx) /
            (columnsInPx.length + 1),
        )
      : 0;

  return { columnsInPx: columnsInPx, spacingInPx: spacingInPx };
}

export interface ProductAnalyticsRetentionTableProps {
  retention: ProductAnalyticsRetentionDto;
  dataTestId: string;
  // A dashboard widget's: compact, the cohorts' year left out when it is this year's.
  isCompact?: boolean | undefined;
  /*
   * A dashboard widget's width for the table (issue #6721): the periods
   * that do not fit in it are left out from the last, rather than scrolled
   * to sideways, and renderPeriodsLeftOut says how many under the table.
   * Left out, as on the page, every period is drawn and the table scrolls.
   */
  fitToWidthInPx?: number | undefined;
  renderPeriodsLeftOut?: ((leftOut: number) => ReactNode) | undefined;
}

interface RetentionTableFit {
  // What it was measured for: the width and everything drawn.
  key: string;
  periods: number;
}

interface RetentionTableSize {
  widthInPx: number;
  heightInPx: number;
}

/*
 * How often a fitted table is measured again for a change of its drawn
 * size alone - its styles or a font arriving after it was measured, a
 * scrollbar taking from its box - before its width or its rows change:
 * enough for each, never a loop with a layout that moves each time the
 * table is drawn.
 */
export const RETENTION_TABLE_MAX_REMEASURES: number = 3;

const ProductAnalyticsRetentionTable: FunctionComponent<
  ProductAnalyticsRetentionTableProps
> = (props: ProductAnalyticsRetentionTableProps): ReactElement => {
  const translator: Translator = useTranslator();
  const tableRef: React.RefObject<HTMLTableElement> =
    useRef<HTMLTableElement>(null);
  const boxRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<RetentionTableFit | null>(null);
  // How often the table was measured again for a change of its drawn size alone.
  const [remeasures, setRemeasures] = useState<number>(0);
  // The fitted table's size as first drawn; null while it is measured.
  const drawnSizeRef: React.MutableRefObject<RetentionTableSize | null> =
    useRef<RetentionTableSize | null>(null);
  // The width and rows last measured for, and how often since for its drawn size alone.
  const remeasuredRef: React.MutableRefObject<{
    contentKey: string;
    count: number;
  }> = useRef<{ contentKey: string; count: number }>({
    contentKey: "",
    count: 0,
  });
  const isFittedToWidth: boolean = props.fitToWidthInPx !== undefined;
  const density: ProductAnalyticsRetentionTableDensity =
    RETENTION_TABLE_DENSITY[props.isCompact ? "compact" : "page"];
  const rows: Array<ProductAnalyticsRetentionRow> =
    buildProductAnalyticsRetentionRows({
      retention: props.retention,
      translator: translator,
      isCompact: props.isCompact,
    });
  const averageRow: ProductAnalyticsRetentionRow | null =
    buildProductAnalyticsRetentionAverageRow({
      retention: props.retention,
      translator: translator,
    });
  const drawnRows: Array<ProductAnalyticsRetentionRow> = [
    ...(averageRow ? [averageRow] : []),
    ...rows,
  ];
  const columns: number = drawnRows.reduce(
    (most: number, row: ProductAnalyticsRetentionRow): number => {
      return Math.max(most, row.cells.length);
    },
    0,
  );
  const headings: Array<string> = Array.from(
    { length: columns },
    (_value: unknown, index: number): string => {
      return describeProductAnalyticsRetentionColumn({
        period: props.retention.period,
        index: index,
        translator: translator,
      });
    },
  );

  /*
   * Fitted to a width: measured once with every period drawn at its own
   * width (w-max), before the browser paints, then drawn with the periods
   * that fit - again whenever the width or anything drawn changes (a
   * refresh, the language), so a widget made wider gets its periods back,
   * and whenever the table drawn fitted changes size by itself: measured
   * before the page's styles for its classes or its font were in, its
   * columns were not the widths they are drawn at.
   */
  const contentKey: string =
    props.fitToWidthInPx === undefined
      ? ""
      : JSON.stringify([
          props.fitToWidthInPx,
          headings,
          drawnRows.map((row: ProductAnalyticsRetentionRow): Array<string> => {
            return [
              row.cohort,
              row.people,
              ...row.cells.map(
                (cell: ProductAnalyticsRetentionCell | null): string => {
                  return cell?.text || "";
                },
              ),
            ];
          }),
        ]);
  const fitKey: string = contentKey === "" ? "" : `${remeasures}:${contentKey}`;
  const isMeasuring: boolean = fitKey !== "" && fit?.key !== fitKey;
  const shownColumns: number =
    fitKey !== "" && fit && fit.key === fitKey
      ? Math.min(fit.periods, columns)
      : columns;
  const leftOut: number = columns - shownColumns;
  const columnIndexes: Array<number> = Array.from(
    { length: shownColumns },
    (_value: unknown, index: number): number => {
      return index;
    },
  );

  useLayoutEffect(() => {
    const table: HTMLTableElement | null = tableRef.current;

    if (!table || props.fitToWidthInPx === undefined) {
      return;
    }

    if (remeasuredRef.current.contentKey !== contentKey) {
      remeasuredRef.current = { contentKey: contentKey, count: 0 };
    }

    if (!isMeasuring) {
      // The size it is first drawn at, fitted: a change of it measures again.
      drawnSizeRef.current = drawnSizeRef.current || {
        widthInPx: table.offsetWidth,
        heightInPx: table.offsetHeight,
      };
      return;
    }

    drawnSizeRef.current = null;

    const widths: ProductAnalyticsRetentionTableWidths =
      readProductAnalyticsRetentionTableWidths(table);
    /*
     * The widget's own width; or its box's, where that is less - a
     * scrollbar the widget shows down its side takes from it.
     */
    const boxWidthInPx: number = boxRef.current?.clientWidth || 0;
    const widthInPx: number =
      boxWidthInPx > 0
        ? Math.min(props.fitToWidthInPx, boxWidthInPx)
        : props.fitToWidthInPx;

    setFit({
      key: fitKey,
      periods: countProductAnalyticsRetentionPeriodsThatFit({
        widthInPx: widthInPx,
        labelColumnsInPx: widths.columnsInPx.slice(0, 2),
        periodColumnsInPx: widths.columnsInPx.slice(2),
        spacingInPx: widths.spacingInPx,
      }),
    });
  });

  /*
   * A fitted table that changes size with nothing of it changed was
   * measured at widths it is not drawn at: the styles for its classes,
   * written by the page as they first appear, came after it was measured
   * (the first widget of a board drew eleven weeks in room for six), or
   * its font did, or a scrollbar took from its box. Measured again - and
   * again once a font comes in, which can make it narrower without a
   * change of size to see.
   */
  useEffect(() => {
    const table: HTMLTableElement | null = tableRef.current;

    if (!isFittedToWidth || !table) {
      return;
    }

    const measureAgain: () => void = (): void => {
      if (
        !drawnSizeRef.current ||
        remeasuredRef.current.count >= RETENTION_TABLE_MAX_REMEASURES
      ) {
        return;
      }

      remeasuredRef.current.count += 1;
      drawnSizeRef.current = null;
      setRemeasures((count: number): number => {
        return count + 1;
      });
    };

    const observer: ResizeObserver | null =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((): void => {
            const drawn: RetentionTableSize | null = drawnSizeRef.current;

            if (
              drawn &&
              (Math.abs(table.offsetWidth - drawn.widthInPx) >= 1 ||
                Math.abs(table.offsetHeight - drawn.heightInPx) >= 1)
            ) {
              measureAgain();
            }
          });

    observer?.observe(table);

    const fonts: FontFaceSet | undefined =
      typeof document === "undefined" ? undefined : document.fonts;

    fonts?.addEventListener?.("loadingdone", measureAgain);

    return () => {
      observer?.disconnect();
      fonts?.removeEventListener?.("loadingdone", measureAgain);
    };
  }, [isFittedToWidth]);

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
          className={`${RETENTION_COHORT_COLUMN_CLASS_NAME} whitespace-nowrap ${density.label} text-start text-gray-900 ${
            isAverage ? "font-semibold" : "font-medium"
          }`}
        >
          {row.cohort}
        </th>
        <td
          className={`whitespace-nowrap ${density.label} text-end tabular-nums ${
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
                className={density.label}
                data-testid={`${testId}-empty`}
              />
            );
          }

          return (
            <td
              key={index}
              className={`${density.cell} rounded text-center tabular-nums ${
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
    <>
      <div
        ref={boxRef}
        className="overflow-x-auto"
        data-testid={props.dataTestId}
      >
        <table
          ref={tableRef}
          className={`${
            isMeasuring ? "w-max" : "min-w-full"
          } border-separate border-spacing-0.5 ${density.table}`}
        >
          <thead>
            <tr>
              <th
                scope="col"
                className={`${RETENTION_COHORT_COLUMN_CLASS_NAME} whitespace-nowrap ${density.header} text-start font-medium uppercase text-gray-500`}
              >
                {translator.translateText("Cohort")}
              </th>
              <th
                scope="col"
                className={`whitespace-nowrap ${density.header} text-end font-medium uppercase text-gray-500`}
              >
                {translator.translateText("People")}
              </th>
              {columnIndexes.map((index: number): ReactElement => {
                return (
                  <th
                    key={index}
                    scope="col"
                    className={`whitespace-nowrap ${density.header} text-center font-medium uppercase text-gray-500`}
                  >
                    {headings[index]}
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
                <td colSpan={shownColumns + 2} className="h-1.5 p-0" />
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
      {leftOut > 0 && props.renderPeriodsLeftOut ? (
        props.renderPeriodsLeftOut(leftOut)
      ) : (
        <></>
      )}
    </>
  );
};

export default ProductAnalyticsRetentionTable;
