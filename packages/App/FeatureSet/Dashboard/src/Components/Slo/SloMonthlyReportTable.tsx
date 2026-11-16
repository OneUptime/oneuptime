import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { translationKey } from "Common/Types/Translator";
import StatusBadge from "Common/UI/Components/StatusBadge/StatusBadge";
import Table from "Common/UI/Components/Table/Table";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import Column from "Common/UI/Components/Table/Types/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { formatDurationCompactInLanguage } from "Common/Utils/Slo/SloDuration";
import {
  SloJudgedFigures,
  SloMonthlyReport,
  SloMonthlyReportRow,
  SloMonthlyReportUnit,
} from "Common/Utils/Slo/SloMonthlyReport";
import { getBadRequestKind } from "Common/Utils/Slo/SloRequestSli";
import React, { FunctionComponent, ReactElement } from "react";
import {
  SLO_MONTH_VERDICT_BADGE_TYPE,
  SLO_MONTH_VERDICT_TEXT,
  formatSloBudgetUsed,
  formatSloMonthlyReportSli,
  getSloBudgetUsedBarClassName,
  getSloReportMonthName,
} from "./SloMonthlyReportText";

// Where a person's widths for these columns are kept (Table's ColumnResize).
export const SLO_MONTHLY_REPORT_TABLE_KEY: string = "slo-monthly-report-table";

export const SLO_MONTHLY_REPORT_TABLE_ID: string = "slo-monthly-report";

export const SLO_MONTHLY_REPORT_TOTAL_ROW_TEST_ID: string =
  "slo-monthly-report-total-row";

// One row of the table: a month, or the period's total, drawn last.
export interface SloMonthlyReportTableRow {
  id: string;
  isTotal: boolean;
  // Null for the total.
  monthStart: Date | null;
  isMonthToDate: boolean;
  figures: SloJudgedFigures;
}

export const getSloMonthlyReportTableRows: (
  report: SloMonthlyReport,
) => Array<SloMonthlyReportTableRow> = (
  report: SloMonthlyReport,
): Array<SloMonthlyReportTableRow> => {
  const rows: Array<SloMonthlyReportTableRow> = report.months.map(
    (row: SloMonthlyReportRow): SloMonthlyReportTableRow => {
      return {
        id: row.monthStart.toISOString(),
        isTotal: false,
        monthStart: row.monthStart,
        isMonthToDate: row.isMonthToDate,
        figures: row,
      };
    },
  );

  rows.push({
    id: "total",
    isTotal: true,
    monthStart: null,
    isMonthToDate: report.total.includesMonthToDate,
    figures: report.total,
  });

  return rows;
};

export interface ComponentProps {
  report: SloMonthlyReport;
  // The rows to draw: the months with data, and the total.
  rows: Array<SloMonthlyReportTableRow>;
}

/*
 * An SLO's months, oldest first, and the period's total last - the table a
 * monthly SLO report is read as: each month's SLI, what counted against it
 * (downtime, or failed or slow requests), the share of its error budget it
 * used, and whether it met the target. Drawn by the product's table, so it
 * reads, sizes its columns and folds on a phone as every other list does:
 * where the card is narrow, the downtime and the budget go under the month.
 */
const SloMonthlyReportTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const report: SloMonthlyReport = props.report;
  // A request SLO counts requests, a Metric SLO its metric's events.
  const isRequests: boolean = report.unit === SloMonthlyReportUnit.Requests;
  const isEvents: boolean = report.unit === SloMonthlyReportUnit.Events;
  const isCounted: boolean = isRequests || isEvents;
  const isSlowRequests: boolean =
    isRequests && getBadRequestKind(report.sliType) === "slow";

  const getMonthElement: (row: SloMonthlyReportTableRow) => ReactElement = (
    row: SloMonthlyReportTableRow,
  ): ReactElement => {
    if (row.isTotal || !row.monthStart) {
      return (
        <span className="font-semibold text-gray-900">
          {translator.translateText("Total")}
        </span>
      );
    }

    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-900">
          {getSloReportMonthName({
            monthStart: row.monthStart,
            timezone: report.timezone,
          })}
        </span>
        {row.isMonthToDate ? (
          <span
            className="inline-flex items-center rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600"
            data-testid="slo-monthly-report-so-far"
          >
            {translator.translateText("So far")}
          </span>
        ) : (
          <></>
        )}
      </span>
    );
  };

  const getSliElement: (row: SloMonthlyReportTableRow) => ReactElement = (
    row: SloMonthlyReportTableRow,
  ): ReactElement => {
    const text: string | null = formatSloMonthlyReportSli(
      row.figures.sliPercentage,
      translator,
    );

    if (text === null) {
      return <TableEmptyValue />;
    }

    return (
      <span
        className={`tabular-nums text-gray-900 ${row.isTotal ? "font-semibold" : "font-medium"}`}
        data-testid="slo-monthly-report-sli"
      >
        {text}
      </span>
    );
  };

  const getBadElement: (row: SloMonthlyReportTableRow) => ReactElement = (
    row: SloMonthlyReportTableRow,
  ): ReactElement => {
    if (row.figures.sliPercentage === null) {
      return <TableEmptyValue />;
    }

    return (
      <span className="tabular-nums text-gray-700">
        {isCounted
          ? translator.formatNumber(Math.round(row.figures.bad))
          : formatDurationCompactInLanguage(
              row.figures.bad,
              translator.language,
            )}
      </span>
    );
  };

  const getBudgetElement: (row: SloMonthlyReportTableRow) => ReactElement = (
    row: SloMonthlyReportTableRow,
  ): ReactElement => {
    const used: number | null = row.figures.errorBudgetUsedPercentage;
    const text: string | null = formatSloBudgetUsed(used, translator);

    if (used === null || text === null) {
      return <TableEmptyValue />;
    }

    const width: number = Math.min(100, Math.max(0, used));

    return (
      <span className="inline-flex items-center gap-3">
        <span
          className="inline-block h-1.5 w-20 rounded-full bg-gray-100"
          aria-hidden="true"
        >
          <span
            className={`block h-1.5 rounded-full ${getSloBudgetUsedBarClassName(used)}`}
            style={{ width: `${width}%` }}
          />
        </span>
        <span className="text-xs tabular-nums text-gray-600">{text}</span>
      </span>
    );
  };

  const columns: Array<Column<SloMonthlyReportTableRow>> = [
    {
      id: "month",
      key: "id",
      title: "Month",
      type: FieldType.Element,
      disableSort: true,
      getElement: getMonthElement,
    },
    {
      id: "sli",
      key: "id",
      title: "SLI",
      type: FieldType.Element,
      disableSort: true,
      headerTooltip: isRequests
        ? translationKey(
            "The share of the month's requests that were good, as this SLO counts them.",
          )
        : isEvents
          ? translationKey(
              "The share of the month's events of this SLO's metric that were good.",
            )
          : translationKey(
              "The share of the month this SLO's monitors were up, counting only the time they were monitored.",
            ),
      getElement: getSliElement,
    },
  ];

  if (isCounted) {
    columns.push({
      id: "requests",
      key: "id",
      title: isEvents ? "Events" : "Requests",
      type: FieldType.Element,
      disableSort: true,
      hideBelowLargeScreen: true,
      foldInto: "month",
      showTitleWhenFolded: true,
      getElement: (row: SloMonthlyReportTableRow): ReactElement => {
        if (row.figures.sliPercentage === null) {
          return <TableEmptyValue />;
        }

        return (
          <span className="tabular-nums text-gray-700">
            {translator.formatNumber(Math.round(row.figures.total))}
          </span>
        );
      },
    });
  }

  columns.push(
    {
      id: "bad",
      key: "id",
      title: isEvents
        ? "Bad Events"
        : isRequests
          ? isSlowRequests
            ? "Slow Requests"
            : "Failed Requests"
          : "Downtime",
      type: FieldType.Element,
      disableSort: true,
      hideBelowLargeScreen: true,
      foldInto: "month",
      showTitleWhenFolded: true,
      getElement: getBadElement,
    },
    {
      id: "budget",
      key: "id",
      title: "Error Budget Used",
      type: FieldType.Element,
      disableSort: true,
      headerTooltip: translationKey(
        "The share of the month's error budget it used: the downtime or bad requests its target allows. Over 100% means the month missed its target.",
      ),
      hideBelowLargeScreen: true,
      foldInto: "month",
      showTitleWhenFolded: true,
      getElement: getBudgetElement,
    },
    {
      id: "verdict",
      key: "id",
      title: "Result",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: SloMonthlyReportTableRow): ReactElement => {
        return (
          <span data-testid="slo-monthly-report-verdict">
            <StatusBadge
              text={SLO_MONTH_VERDICT_TEXT[row.figures.verdict]}
              type={SLO_MONTH_VERDICT_BADGE_TYPE[row.figures.verdict]}
            />
          </span>
        );
      },
    },
  );

  return (
    <Table<SloMonthlyReportTableRow>
      id={SLO_MONTHLY_REPORT_TABLE_ID}
      columnWidthsKey={SLO_MONTHLY_REPORT_TABLE_KEY}
      data={props.rows}
      columns={columns}
      singularLabel="Month"
      pluralLabel="Months"
      currentPageNumber={1}
      totalItemsCount={props.rows.length}
      itemsOnPage={props.rows.length || 1}
      disablePagination={true}
      error=""
      isLoading={false}
      getRowProps={(
        row: SloMonthlyReportTableRow,
      ): React.HTMLAttributes<HTMLElement> => {
        if (!row.isTotal) {
          return {};
        }

        return {
          className: "bg-gray-50",
          ...({
            "data-testid": SLO_MONTHLY_REPORT_TOTAL_ROW_TEST_ID,
          } as React.HTMLAttributes<HTMLElement>),
        };
      }}
      onNavigateToPage={(): void => {
        // Every month is on the one page.
      }}
      sortOrder={SortOrder.Ascending}
      sortBy={null}
      onSortChanged={(): void => {
        // The months keep their order, oldest first, and the total last.
      }}
    />
  );
};

export default SloMonthlyReportTable;
