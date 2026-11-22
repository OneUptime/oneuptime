import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import useMonitorSeriesOpenRecords, {
  MonitorSeriesOpenRecord,
} from "./useMonitorSeriesOpenRecords";
import Route from "Common/Types/API/Route";
import MonitorEvaluationSummary, {
  MonitorEvaluationSeries,
} from "Common/Types/Monitor/MonitorEvaluationSummary";
import { DisplaySeriesLabel } from "Common/Types/Monitor/SeriesContext/SeriesLabelDisplay";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Link from "Common/UI/Components/Link/Link";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import LocalTable from "Common/UI/Components/Table/LocalTable";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import MonitorSeriesTableUtil, {
  MONITOR_SERIES_CARD_DESCRIPTION,
  MONITOR_SERIES_CARD_TITLE,
  MONITOR_SERIES_KEEPS_STATUS,
  MONITOR_SERIES_KEEPS_STATUS_TIP,
  MonitorSeriesTableRow,
} from "Common/Utils/Monitor/MonitorSeriesTableUtil";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitorId: ObjectID;
  // The newest evaluation's summary: a grouped check's carries its series.
  evaluationSummary?: MonitorEvaluationSummary | undefined;
  // Moves when what is open may have changed: the page's polls.
  refreshToken: string;
}

// A row of the card: the series, and what is open for it.
interface SeriesCardRow extends MonitorSeriesTableRow {
  open: Array<MonitorSeriesOpenRecord>;
}

/*
 * SERIES: EACH SERIES A GROUPED MONITOR'S LAST CHECK READ (#10062).
 *
 * A monitor that groups its query by an attribute - a Host monitor on a
 * host with several disks, a metric monitor by host or pod, a Logs or
 * Traces monitor by group - has one status, and nothing on its page said
 * which disks were over the threshold. This lists each series the last
 * check read: what names it, as its incidents and alerts name it, its
 * latest value, the criteria it meets, and its open incident or alert. A
 * series that keeps the monitor's status - one that met a criteria that
 * changed the status, and no criteria that brings it back yet - says so.
 *
 * Drawn only for a check that read series: a monitor that does not group
 * has none. The check keeps a bounded list, the series that keep the status
 * or meet a criteria first, and the card says when it lists a share of
 * them; it pages them ten at a time.
 */
const MonitorSeriesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const series: MonitorEvaluationSeries | null =
    MonitorSeriesTableUtil.getSeries(props.evaluationSummary);

  const rows: Array<MonitorSeriesTableRow> =
    series && props.evaluationSummary
      ? MonitorSeriesTableUtil.getRows({
          summary: props.evaluationSummary,
          translator: translator,
        })
      : [];

  const open: Map<string, Array<MonitorSeriesOpenRecord>> =
    useMonitorSeriesOpenRecords({
      monitorId: props.monitorId,
      fingerprints: rows.map((row: MonitorSeriesTableRow): string => {
        return row.fingerprint;
      }),
      refreshToken: props.refreshToken,
    });

  if (!series || rows.length === 0) {
    return <></>;
  }

  const shareText: string | null = MonitorSeriesTableUtil.getShareText({
    series: series,
    translator: translator,
  });

  const data: Array<SeriesCardRow> = rows.map(
    (row: MonitorSeriesTableRow): SeriesCardRow => {
      return { ...row, open: open.get(row.fingerprint) || [] };
    },
  );

  type GetRecordLinkFunction = (record: MonitorSeriesOpenRecord) => ReactElement;

  const getRecordLink: GetRecordLinkFunction = (
    record: MonitorSeriesOpenRecord,
  ): ReactElement => {
    const to: Route = RouteUtil.populateRouteParams(
      RouteMap[
        record.kind === "Incident" ? PageMap.INCIDENT_VIEW : PageMap.ALERT_VIEW
      ] as Route,
      { modelId: new ObjectID(record.id) },
    );

    return (
      <div key={`${record.kind}-${record.id}`}>
        <Link
          to={to}
          className="text-sm font-medium text-indigo-600 hover:underline"
        >
          {translator.translateTemplate(
            record.kind === "Incident"
              ? "Incident {{number}}"
              : "Alert {{number}}",
            { number: record.number },
          )}
        </Link>
      </div>
    );
  };

  return (
    <div data-testid="monitor-series-card">
      <Card
        title={MONITOR_SERIES_CARD_TITLE}
        description={MONITOR_SERIES_CARD_DESCRIPTION}
      >
        <div>
          {shareText ? (
            <p
              className="mb-3 text-sm text-gray-600"
              data-testid="monitor-series-share"
            >
              {shareText}
            </p>
          ) : (
            <></>
          )}
          <LocalTable<SeriesCardRow>
            id="monitor-series-table"
            data={data}
            singularLabel="Series"
            pluralLabel="Series"
            itemsPerPage={10}
            columns={[
              {
                key: "fingerprint",
                title: "Series",
                type: FieldType.Element,
                disableSort: true,
                wrapContent: true,
                getElement: (row: SeriesCardRow): ReactElement => {
                  return (
                    <div className="min-w-0">
                      {row.labels.length > 0 ? (
                        row.labels.map(
                          (label: DisplaySeriesLabel): ReactElement => {
                            return (
                              <div
                                key={label.key}
                                className="text-sm text-gray-900 break-words"
                              >
                                <span className="text-gray-500">
                                  <IsolatedText text={label.name} />
                                </span>{" "}
                                <span className="font-mono">
                                  <IsolatedText text={label.value} />
                                </span>
                              </div>
                            );
                          },
                        )
                      ) : (
                        <span className="font-mono text-sm text-gray-900">
                          <IsolatedText text={row.fingerprint} />
                        </span>
                      )}
                      {row.isKeepingStatus ? (
                        <div className="mt-1">
                          <Pill
                            text={MONITOR_SERIES_KEEPS_STATUS}
                            tooltip={MONITOR_SERIES_KEEPS_STATUS_TIP}
                            tone={PillTone.Warning}
                          />
                        </div>
                      ) : (
                        <></>
                      )}
                    </div>
                  );
                },
              },
              {
                key: "valueText",
                title: "Latest Value",
                type: FieldType.Element,
                disableSort: true,
                getElement: (row: SeriesCardRow): ReactElement => {
                  return row.valueText ? (
                    <span className="text-sm tabular-nums text-gray-900">
                      <IsolatedText text={row.valueText} />
                    </span>
                  ) : (
                    <TableEmptyValue />
                  );
                },
              },
              {
                key: "criteriaNames",
                title: "Criteria Met",
                type: FieldType.Element,
                disableSort: true,
                wrapContent: true,
                hideBelowLargeScreen: true,
                foldInto: "fingerprint",
                showTitleWhenFolded: true,
                getElement: (row: SeriesCardRow): ReactElement => {
                  if (row.criteriaNames.length === 0) {
                    return <TableEmptyValue />;
                  }

                  return (
                    <div>
                      {row.criteriaNames.map(
                        (name: string, index: number): ReactElement => {
                          return (
                            <div
                              key={`${index}-${name}`}
                              className="text-sm text-gray-700 break-words"
                            >
                              <IsolatedText text={name} />
                            </div>
                          );
                        },
                      )}
                    </div>
                  );
                },
              },
              {
                key: "open",
                title: "Open Incident or Alert",
                type: FieldType.Element,
                disableSort: true,
                hideBelowLargeScreen: true,
                foldInto: "fingerprint",
                showTitleWhenFolded: true,
                getElement: (row: SeriesCardRow): ReactElement => {
                  if (row.open.length === 0) {
                    return <TableEmptyValue />;
                  }

                  return <div>{row.open.map(getRecordLink)}</div>;
                },
              },
            ]}
          />
        </div>
      </Card>
    </div>
  );
};

export default MonitorSeriesCard;
