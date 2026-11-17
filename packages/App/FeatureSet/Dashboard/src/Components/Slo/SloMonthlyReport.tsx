import PageMap from "../../Utils/PageMap";
import TableSkeleton from "Common/UI/Components/Skeleton/TableSkeleton";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SloMonthlyReportMonitorsTable from "./SloMonthlyReportMonitorsTable";
import SloMonthlyReportTable, {
  SloMonthlyReportTableRow,
  getSloMonthlyReportTableRows,
} from "./SloMonthlyReportTable";
import SloOverviewActionLink from "./SloOverviewActionLink";
import SloOverviewEmptyState from "./SloOverviewEmptyState";
import { fetchSloMonthlyReport } from "./SloMonthlyReportApi";
import {
  SLO_MONTHLY_REPORT_MONTHS_QUERY_PARAM,
  SLO_MONTHLY_REPORT_UNAVAILABLE_TEXT,
  SLO_MONTHLY_REPORT_YEAR_QUERY_PARAM,
  SLO_MONTH_VERDICT_TEXT_CLASS,
  SloMonthlyReportPeriodChoice,
  formatSloMonthlyReportSli,
  getSloMonthlyReportPeriodChoices,
  getSloMonthlyReportPeriodSearch,
  getSloMonthlyReportPeriodValue,
  getSloReportMonthName,
  readSloMonthlyReportPeriod,
} from "./SloMonthlyReportText";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import EmptyFigure from "Common/UI/Components/EmptyFigure/EmptyFigure";
import FilterButtons, {
  FilterButtonOption,
} from "Common/UI/Components/FilterButtons/FilterButtons";
import API from "Common/UI/Utils/API/API";
import downloadFile from "Common/UI/Utils/DownloadFile";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  SloMonthlyReport,
  SloMonthlyReportPeriod,
  SloMonthlyReportPeriodKind,
  SloMonthlyReportRow,
  SloMonthlyReportSummary,
  SloMonthlyReportUnavailableReason,
  SloMonthlyReportUnit,
  buildSloMonthlyReportCsv,
  getSloMonthlyReportFilename,
  getSloMonthlyReportSummary,
  isSameSloMonthlyReportPeriod,
} from "Common/Utils/Slo/SloMonthlyReport";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

export interface ComponentProps {
  sloId: ObjectID;
}

export const SLO_MONTHLY_REPORT_PERIOD_TEST_ID: string =
  "slo-monthly-report-period";

/*
 * AN SLO'S MONTHLY REPORT (#5476): how it did each calendar month of the
 * period picked - the last 3, 6, 9 or 12 months, this year or last year -
 * and over the whole period, measured when the page asks
 * (Common/Utils/Slo/SloMonthlyReport says how).
 *
 *   - The first card holds the period picker, the download, three figures
 *     that answer "how did we do?" at a glance (the SLI over the period,
 *     the months that met the target, the worst month) and the table of
 *     months with the total last.
 *   - A second card breaks the SLO down by monitor, when it measures more
 *     than one: which monitor cost which month.
 *
 * The period is kept in the address ("?months=6", "?year=2025"), so a
 * report is shared as a link. Months before the SLO had any data are left
 * out of the table and named in one line above it, rather than drawn as a
 * column of empty rows.
 */
const SloMonthlyReportElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // The day the page was opened: what "this year" and "last year" are.
  const openedAt: Date = useMemo((): Date => {
    return OneUptimeDate.getCurrentDate();
  }, []);

  const [period, setPeriod] = useState<SloMonthlyReportPeriod>(
    (): SloMonthlyReportPeriod => {
      return readSloMonthlyReportPeriod({
        months: Navigation.getQueryStringByName(
          SLO_MONTHLY_REPORT_MONTHS_QUERY_PARAM,
        ),
        year: Navigation.getQueryStringByName(
          SLO_MONTHLY_REPORT_YEAR_QUERY_PARAM,
        ),
        now: openedAt,
      });
    },
  );

  const [report, setReport] = useState<SloMonthlyReport | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [reloadCount, setReloadCount] = useState<number>(0);

  useEffect(() => {
    let isCurrent: boolean = true;

    setIsLoading(true);
    setError("");

    fetchSloMonthlyReport({ sloId: props.sloId, period: period })
      .then((loaded: SloMonthlyReport): void => {
        if (isCurrent) {
          setReport(loaded);
        }
      })
      .catch((err: unknown): void => {
        if (isCurrent) {
          setReport(null);
          setError(API.getFriendlyMessage(err));
        }
      })
      .finally((): void => {
        if (isCurrent) {
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [
    props.sloId.toString(),
    getSloMonthlyReportPeriodValue(period),
    reloadCount,
  ]);

  const choices: Array<SloMonthlyReportPeriodChoice> =
    useMemo((): Array<SloMonthlyReportPeriodChoice> => {
      return getSloMonthlyReportPeriodChoices(openedAt);
    }, [openedAt, translator.language]);

  /*
   * A period from a link that is not one of the buttons ("?months=4") is
   * still drawn as a button of its own, so the picker always says what the
   * report covers.
   */
  const options: Array<FilterButtonOption> = choices.map(
    (choice: SloMonthlyReportPeriodChoice): FilterButtonOption => {
      return { label: choice.label, value: choice.value };
    },
  );

  const hasChoice: boolean = choices.some(
    (choice: SloMonthlyReportPeriodChoice): boolean => {
      return isSameSloMonthlyReportPeriod(choice.period, period);
    },
  );

  if (!hasChoice) {
    options.unshift({
      label:
        period.kind === SloMonthlyReportPeriodKind.Year
          ? OneUptimeDate.getDateAsLocalYearString(
              new Date(Date.UTC(period.year, 6, 1, 12)),
            )
          : translator.translatePlural(
              { one: "{{count}} month", other: "{{count}} months" },
              period.months,
            ),
      value: getSloMonthlyReportPeriodValue(period),
    });
  }

  const onPeriodSelected: (value: string) => void = (value: string): void => {
    const choice: SloMonthlyReportPeriodChoice | undefined = choices.find(
      (candidate: SloMonthlyReportPeriodChoice): boolean => {
        return candidate.value === value;
      },
    );

    if (!choice) {
      return;
    }

    setPeriod(choice.period);
    Navigation.setQueryString(getSloMonthlyReportPeriodSearch(choice.period));
  };

  const canDownload: boolean = Boolean(
    report && !report.unavailableReason && report.months.length > 0,
  );

  const download: () => void = (): void => {
    if (!report) {
      return;
    }

    downloadFile({
      content: buildSloMonthlyReportCsv(report),
      filename: getSloMonthlyReportFilename({
        sloName: report.sloName,
        period: report.period,
      }),
      mimeType: "text/csv;charset=utf-8;",
    });
  };

  const description: string =
    report && report.targetPercentage !== null
      ? translator.translateTemplate(
          "How this SLO did each calendar month against its target of {{target}}. Months run in {{timezone}}.",
          {
            target:
              formatSloMonthlyReportSli(report.targetPercentage, translator) ||
              "",
            timezone: report.timezone,
          },
        )
      : translator.translateText(
          "How this SLO did each calendar month against its target.",
        ) || "How this SLO did each calendar month against its target.";

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <TableSkeleton />;
    }

    if (error) {
      return (
        <ErrorMessage
          message={error}
          whatFailed={translator.translateText(
            "The monthly report could not be loaded.",
          )}
          onRefreshClick={() => {
            setReloadCount((count: number) => {
              return count + 1;
            });
          }}
        />
      );
    }

    if (!report) {
      return <></>;
    }

    if (report.unavailableReason) {
      return getUnavailableState(report.unavailableReason);
    }

    const summary: SloMonthlyReportSummary = getSloMonthlyReportSummary(report);

    if (summary.leadingMonthsWithoutData === report.months.length) {
      return (
        <SloOverviewEmptyState
          icon={IconProp.Calendar}
          title="No data in this period"
          description={
            report.unit === SloMonthlyReportUnit.Requests
              ? "None of this SLO's services served a request that OneUptime counted in these months. Pick a later period, or wait for its services' traces to arrive."
              : report.unit === SloMonthlyReportUnit.Events
                ? "None of this SLO's services sent an event of its metric in these months. Pick a later period, or wait for their metrics to arrive."
                : "This SLO's monitors have no status history in these months. Pick a later period, or wait for its monitors to be checked."
          }
          dataTestId="slo-monthly-report-no-data"
        />
      );
    }

    const firstMonthWithData: SloMonthlyReportRow =
      report.months[summary.leadingMonthsWithoutData]!;

    const rows: Array<SloMonthlyReportTableRow> = getSloMonthlyReportTableRows(
      report,
    ).slice(summary.leadingMonthsWithoutData);

    return (
      <Fragment>
        {getSummary(report, summary)}

        {summary.leadingMonthsWithoutData > 0 ? (
          <p
            className="mt-4 text-sm text-gray-500"
            data-testid="slo-monthly-report-no-data-before"
          >
            {translator.translateTemplate(
              report.unit === SloMonthlyReportUnit.Requests
                ? "No requests were counted before {{month}}, so earlier months are left out."
                : report.unit === SloMonthlyReportUnit.Events
                  ? "No events were counted before {{month}}, so earlier months are left out."
                  : "This SLO's monitors have no status history before {{month}}, so earlier months are left out.",
              {
                month: getSloReportMonthName({
                  monthStart: firstMonthWithData.monthStart,
                  timezone: report.timezone,
                }),
              },
            )}
          </p>
        ) : (
          <></>
        )}

        <div className="mt-4">
          <SloMonthlyReportTable report={report} rows={rows} />
        </div>
      </Fragment>
    );
  };

  const getUnavailableState: (
    reason: SloMonthlyReportUnavailableReason,
  ) => ReactElement = (
    reason: SloMonthlyReportUnavailableReason,
  ): ReactElement => {
    const isMonitorsFix: boolean =
      reason === SloMonthlyReportUnavailableReason.NoMonitors;

    return (
      <SloOverviewEmptyState
        icon={IconProp.Calendar}
        title="Nothing to report yet"
        description={SLO_MONTHLY_REPORT_UNAVAILABLE_TEXT[reason]}
        tone="warning"
        dataTestId="slo-monthly-report-unavailable"
        actions={
          <SloOverviewActionLink
            variant="secondary"
            title={isMonitorsFix ? "Add Monitors" : "Open Settings"}
            icon={isMonitorsFix ? IconProp.AltGlobe : IconProp.Settings}
            to={RouteUtil.populateRouteParams(
              RouteMap[
                isMonitorsFix
                  ? PageMap.SLO_VIEW_MONITORS
                  : PageMap.SLO_VIEW_SETTINGS
              ] as Route,
              { modelId: props.sloId },
            )}
          />
        }
      />
    );
  };

  /*
   * Three figures that answer "how did we do?" before the table is read:
   * the SLI over the whole period against the target, how many of the
   * months that are over met it, and the month that did worst. Drawn as a
   * row of the card, not as cards of their own.
   */
  const getSummary: (
    report: SloMonthlyReport,
    summary: SloMonthlyReportSummary,
  ) => ReactElement = (
    report: SloMonthlyReport,
    summary: SloMonthlyReportSummary,
  ): ReactElement => {
    const totalSli: string | null = formatSloMonthlyReportSli(
      report.total.sliPercentage,
      translator,
    );

    const target: string | null = formatSloMonthlyReportSli(
      report.targetPercentage,
      translator,
    );

    const worstMonth: SloMonthlyReportRow | null = summary.worstMonth;

    return (
      <dl
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
        data-testid="slo-monthly-report-summary"
      >
        <div>
          <dt className="text-sm text-gray-500">
            {report.total.includesMonthToDate
              ? translator.translateText("SLI over the period so far")
              : translator.translateText("SLI over the period")}
          </dt>
          <dd
            className={`mt-1 text-2xl font-semibold tabular-nums ${SLO_MONTH_VERDICT_TEXT_CLASS[report.total.verdict]}`}
            data-testid="slo-monthly-report-total-sli"
          >
            {totalSli || <EmptyFigure />}
          </dd>
          {target ? (
            <dd className="mt-0.5 text-xs text-gray-500">
              {translator.translateTemplate("Target {{target}}", {
                target: target,
              })}
            </dd>
          ) : (
            <></>
          )}
        </div>

        <div>
          <dt className="text-sm text-gray-500">
            {translator.translateText("Months that met the target")}
          </dt>
          <dd
            className="mt-1 text-2xl font-semibold tabular-nums text-gray-900"
            data-testid="slo-monthly-report-months-met"
          >
            {summary.completeMonthCount > 0 ? (
              translator.translateTemplate("{{count}} of {{total}}", {
                count: translator.formatNumber(summary.metMonthCount),
                total: translator.formatNumber(summary.completeMonthCount),
              })
            ) : (
              <EmptyFigure />
            )}
          </dd>
          <dd className="mt-0.5 text-xs text-gray-500">
            {summary.completeMonthCount > 0
              ? translator.translateText("Complete months with data")
              : translator.translateText("No month is over yet")}
          </dd>
        </div>

        <div>
          <dt className="text-sm text-gray-500">
            {translator.translateText("Lowest month")}
          </dt>
          <dd
            className="mt-1 text-2xl font-semibold text-gray-900"
            data-testid="slo-monthly-report-worst-month"
          >
            {worstMonth ? (
              getSloReportMonthName({
                monthStart: worstMonth.monthStart,
                timezone: report.timezone,
              })
            ) : (
              <EmptyFigure />
            )}
          </dd>
          {worstMonth ? (
            <dd
              className={`mt-0.5 text-xs tabular-nums ${SLO_MONTH_VERDICT_TEXT_CLASS[worstMonth.verdict]}`}
            >
              {formatSloMonthlyReportSli(worstMonth.sliPercentage, translator)}
            </dd>
          ) : (
            <></>
          )}
        </div>
      </dl>
    );
  };

  const getMonitorsCard: () => ReactElement = (): ReactElement => {
    if (
      isLoading ||
      error ||
      !report ||
      report.unavailableReason ||
      report.monitors.length < 2
    ) {
      return <></>;
    }

    const summary: SloMonthlyReportSummary = getSloMonthlyReportSummary(report);

    if (summary.leadingMonthsWithoutData === report.months.length) {
      return <></>;
    }

    const monthIndexes: Array<number> = report.months
      .map((_row: SloMonthlyReportRow, index: number): number => {
        return index;
      })
      .slice(summary.leadingMonthsWithoutData);

    return (
      <Card
        title="By Monitor"
        description="Each monitor's own SLI in every month, counting the same statuses as downtime. The monitor that cost the SLO most is first."
      >
        <SloMonthlyReportMonitorsTable
          report={report}
          monthIndexes={monthIndexes}
        />
      </Card>
    );
  };

  return (
    <Fragment>
      <Card
        title="Monthly Report"
        description={description}
        rightElement={
          <FilterButtons
            options={options}
            selectedValue={getSloMonthlyReportPeriodValue(period)}
            onSelect={onPeriodSelected}
            ariaLabel="Period"
            dataTestId={SLO_MONTHLY_REPORT_PERIOD_TEST_ID}
            className="flex-wrap"
          />
        }
        buttons={[
          {
            title: "Download CSV",
            icon: IconProp.Download,
            buttonStyle: ButtonStyleType.NORMAL,
            disabled: !canDownload,
            onClick: download,
          },
        ]}
      >
        {getBody()}
      </Card>

      {getMonitorsCard()}
    </Fragment>
  );
};

export default SloMonthlyReportElement;
