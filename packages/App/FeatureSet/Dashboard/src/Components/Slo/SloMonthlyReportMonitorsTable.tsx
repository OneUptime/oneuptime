import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Table from "Common/UI/Components/Table/Table";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import Column from "Common/UI/Components/Table/Types/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  SloJudgedFigures,
  SloMonthlyReport,
  SloMonthlyReportMonitor,
  SloMonthlyReportRow,
} from "Common/Utils/Slo/SloMonthlyReport";
import React, { FunctionComponent, ReactElement } from "react";
import {
  SLO_MONTH_VERDICT_TEXT,
  SLO_MONTH_VERDICT_TEXT_CLASS,
  formatSloMonthlyReportSli,
  getSloReportMonthName,
} from "./SloMonthlyReportText";

// Where a person's widths for these columns are kept (Table's ColumnResize).
export const SLO_MONTHLY_REPORT_MONITORS_TABLE_KEY: string =
  "slo-monthly-report-monitors-table";

export const SLO_MONTHLY_REPORT_MONITORS_TABLE_ID: string =
  "slo-monthly-report-monitors";

export interface ComponentProps {
  report: SloMonthlyReport;
  // The months to draw, as their places in the report: those with data.
  monthIndexes: Array<number>;
}

/*
 * Each monitor of the SLO on its own, a row each, worst total first: its
 * SLI in every month and over the period, green at or above the SLO's
 * target and red below it - so the monitor that cost the SLO a month is
 * the one on top, in that month's column. A monitor with no data in a month
 * (not created yet, or not monitored) shows the quiet dash there.
 */
const SloMonthlyReportMonitorsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const report: SloMonthlyReport = props.report;

  const getFiguresElement: (
    figures: SloJudgedFigures | undefined,
    isTotal: boolean,
  ) => ReactElement = (
    figures: SloJudgedFigures | undefined,
    isTotal: boolean,
  ): ReactElement => {
    const text: string | null = figures
      ? formatSloMonthlyReportSli(figures.sliPercentage, translator)
      : null;

    if (!figures || text === null) {
      return <TableEmptyValue isSmall={true} />;
    }

    return (
      <span
        className={`tabular-nums ${SLO_MONTH_VERDICT_TEXT_CLASS[figures.verdict]} ${isTotal ? "font-semibold" : "font-medium"}`}
        title={translator.translateText(
          SLO_MONTH_VERDICT_TEXT[figures.verdict],
        )}
        data-testid="slo-monthly-report-monitor-sli"
      >
        {text}
      </span>
    );
  };

  const columns: Array<Column<SloMonthlyReportMonitor>> = [
    {
      id: "monitor",
      key: "name",
      title: "Monitor",
      type: FieldType.Element,
      disableSort: true,
      getElement: (monitor: SloMonthlyReportMonitor): ReactElement => {
        return (
          <bdi
            className="font-medium text-gray-900"
            data-testid="slo-monthly-report-monitor-name"
          >
            {monitor.name}
          </bdi>
        );
      },
    },
    ...props.monthIndexes.map(
      (monthIndex: number): Column<SloMonthlyReportMonitor> => {
        const month: SloMonthlyReportRow = report.months[monthIndex]!;

        return {
          id: `month-${monthIndex}`,
          key: "monitorId",
          // A month's name is a date, already in the reader's words.
          title: getSloReportMonthName({
            monthStart: month.monthStart,
            timezone: report.timezone,
            isShort: true,
          }),
          type: FieldType.Element,
          disableSort: true,
          getElement: (monitor: SloMonthlyReportMonitor): ReactElement => {
            return getFiguresElement(monitor.months[monthIndex], false);
          },
        };
      },
    ),
    {
      id: "total",
      key: "monitorId",
      title: "Total",
      type: FieldType.Element,
      disableSort: true,
      getElement: (monitor: SloMonthlyReportMonitor): ReactElement => {
        return getFiguresElement(monitor.total, true);
      },
    },
  ];

  return (
    <Table<SloMonthlyReportMonitor>
      id={SLO_MONTHLY_REPORT_MONITORS_TABLE_ID}
      columnWidthsKey={SLO_MONTHLY_REPORT_MONITORS_TABLE_KEY}
      data={report.monitors}
      columns={columns}
      singularLabel="Monitor"
      pluralLabel="Monitors"
      currentPageNumber={1}
      totalItemsCount={report.monitors.length}
      itemsOnPage={report.monitors.length || 1}
      disablePagination={true}
      error=""
      isLoading={false}
      onNavigateToPage={(): void => {
        // Every monitor is on the one page.
      }}
      sortOrder={SortOrder.Ascending}
      sortBy={null}
      onSortChanged={(): void => {
        // The monitors keep the report's order: worst total first.
      }}
    />
  );
};

export default SloMonthlyReportMonitorsTable;
