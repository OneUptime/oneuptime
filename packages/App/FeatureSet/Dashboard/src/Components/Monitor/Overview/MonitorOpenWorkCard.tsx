import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { OverviewSection } from "../../../Utils/OverviewSection";
import RelativeTime from "../../EpisodeView/RelativeTime";
import SloOverviewActionLink from "../../Slo/SloOverviewActionLink";
import SloOverviewEmptyState from "../../Slo/SloOverviewEmptyState";
import { getMonitorPageRoute } from "./MonitorOverviewLinks";
import {
  MonitorOpenWork,
  MonitorOpenWorkRow,
  MonitorOpenWorkSide,
} from "./MonitorOverviewTypes";
import MonitorStatusDot from "./MonitorStatusDot";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";

export interface ComponentProps {
  monitorId: ObjectID;
  openWork: MonitorOpenWork;
}

// The newest open records listed under the counts.
export const MONITOR_OPEN_WORK_MAX_ROWS: number = 5;

type OpenWorkSideState = "loading" | "known" | "forbidden" | "error";

const getSideState: (
  section: OverviewSection<MonitorOpenWorkSide>,
) => OpenWorkSideState = (
  section: OverviewSection<MonitorOpenWorkSide>,
): OpenWorkSideState => {
  if (section.value) {
    return "known";
  }

  if (section.status === "forbidden") {
    return "forbidden";
  }

  if (section.status === "error") {
    return "error";
  }

  return "loading";
};

/*
 * Both sides' newest rows in one list, newest first. A side that could not
 * be read contributes nothing, and says so in the footer instead.
 */
export const mergeOpenWorkRows: (
  openWork: MonitorOpenWork,
) => Array<MonitorOpenWorkRow> = (
  openWork: MonitorOpenWork,
): Array<MonitorOpenWorkRow> => {
  const rows: Array<MonitorOpenWorkRow> = [
    ...(openWork.incidents.value?.rows || []),
    ...(openWork.alerts.value?.rows || []),
  ];

  rows.sort((a: MonitorOpenWorkRow, b: MonitorOpenWorkRow) => {
    return (b.startedAt?.getTime() || 0) - (a.startedAt?.getTime() || 0);
  });

  return rows.slice(0, MONITOR_OPEN_WORK_MAX_ROWS);
};

/*
 * "What is on fire here right now": unresolved incidents and alerts on this
 * monitor, as counts that link to the full lists and the newest few by
 * name. A count that could not be read is "—", never 0, and "Nothing open"
 * is only said when both sides were read and both are empty.
 */
const MonitorOpenWorkCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const incidents: OverviewSection<MonitorOpenWorkSide> =
    props.openWork.incidents;
  const alerts: OverviewSection<MonitorOpenWorkSide> = props.openWork.alerts;
  const incidentsState: OpenWorkSideState = getSideState(incidents);
  const alertsState: OpenWorkSideState = getSideState(alerts);

  const incidentsRoute: Route = getMonitorPageRoute({
    pageMap: PageMap.MONITOR_VIEW_INCIDENTS,
    monitorId: props.monitorId,
  });
  const alertsRoute: Route = getMonitorPageRoute({
    pageMap: PageMap.MONITOR_VIEW_ALERTS,
    monitorId: props.monitorId,
  });

  type GetCountTileFunction = (data: {
    label: string;
    section: OverviewSection<MonitorOpenWorkSide>;
    state: OpenWorkSideState;
    to: Route;
    activeClassName: string;
    testId: string;
  }) => ReactElement;

  const getCountTile: GetCountTileFunction = (data: {
    label: string;
    section: OverviewSection<MonitorOpenWorkSide>;
    state: OpenWorkSideState;
    to: Route;
    activeClassName: string;
    testId: string;
  }): ReactElement => {
    let count: ReactElement = (
      <span
        data-testid={data.testId}
        className="mt-0.5 block h-8 w-10 animate-pulse rounded bg-gray-200"
      />
    );

    if (data.state === "known" && data.section.value) {
      const value: number = data.section.value.count;

      count = (
        <span
          data-testid={data.testId}
          className={`mt-0.5 block text-2xl font-semibold tabular-nums ${
            value > 0 ? data.activeClassName : "text-gray-900"
          }`}
        >
          {translator.formatNumber(value)}
        </span>
      );
    } else if (data.state === "forbidden" || data.state === "error") {
      count = (
        <span
          data-testid={data.testId}
          className="mt-0.5 block text-2xl font-semibold tabular-nums text-gray-400"
        >
          —
        </span>
      );
    }

    return (
      <Link
        to={data.to}
        className="block rounded-lg border border-gray-200 px-3 py-2.5 hover:bg-gray-50"
      >
        <span className="block text-xs font-medium uppercase tracking-wide text-gray-500">
          {translator.translateText(data.label) || data.label}
        </span>
        {count}
      </Link>
    );
  };

  type GetRowFunction = (row: MonitorOpenWorkRow) => ReactElement;

  const getRow: GetRowFunction = (row: MonitorOpenWorkRow): ReactElement => {
    const to: Route = RouteUtil.populateRouteParams(
      RouteMap[
        row.kind === "Incident" ? PageMap.INCIDENT_VIEW : PageMap.ALERT_VIEW
      ] as Route,
      { modelId: new ObjectID(row.id) },
    );

    // The kind in the reader's words: "حادثة", "Warnung".
    const metaParts: Array<string> = [
      translator.translateText(row.kind) || row.kind,
    ];

    /*
     * The severity in words, next to its kind. The dot beside the title is
     * hidden from assistive technology and a colour alone tells nobody who
     * cannot see it, or cannot hover it, which incident is the critical one.
     */
    if (row.severityName) {
      metaParts.push(row.severityName);
    }

    if (row.stateName) {
      metaParts.push(row.stateName);
    }

    return (
      <li key={row.key} data-testid="monitor-open-work-row" className="py-2.5">
        <div className="flex items-start gap-2">
          <span
            className="mt-1.5 inline-flex"
            title={row.severityName || undefined}
          >
            <MonitorStatusDot color={row.severityColor} />
          </span>
          <div className="min-w-0">
            <Link
              to={to}
              className="break-words text-sm font-medium text-gray-900 hover:underline"
            >
              {row.title}
            </Link>
            <p className="mt-0.5 text-xs text-gray-500">
              {/*
               * Each fact its own isolate, set apart the reader's way: the
               * severity and state are the project's own names, often
               * English on an Arabic page, and joined into one string two
               * English names read as one English run - the state stood
               * before the severity for a right-to-left reader.
               */}
              {metaParts.map((part: string, index: number): ReactElement => {
                return (
                  <Fragment key={index}>
                    {index > 0 ? <InlineSeparator /> : <></>}
                    <IsolatedText text={part} />
                  </Fragment>
                );
              })}
              {row.startedAt ? <InlineSeparator /> : null}
              {row.startedAt ? <RelativeTime date={row.startedAt} /> : <></>}
            </p>
          </div>
        </div>
      </li>
    );
  };

  type GetBodyFunction = () => ReactElement;

  const getBody: GetBodyFunction = (): ReactElement => {
    if (incidentsState === "forbidden" && alertsState === "forbidden") {
      return (
        <SloOverviewEmptyState
          dataTestId="monitor-open-work-no-access"
          icon={IconProp.Lock}
          title="No access"
          description="You need incident or alert access to see what's open here."
        />
      );
    }

    const rows: Array<MonitorOpenWorkRow> = mergeOpenWorkRows(props.openWork);
    const isBothKnownZero: boolean =
      incidentsState === "known" &&
      alertsState === "known" &&
      incidents.value?.count === 0 &&
      alerts.value?.count === 0;
    const isLoading: boolean =
      incidentsState === "loading" || alertsState === "loading";

    // Each note: its key in the list, and what it says.
    const notes: Array<{ key: string; content: ReactElement | string }> = [];

    /*
     * An error is the hook's own sentence or the server's: ErrorSentence
     * looks it up in the reader's language, and says an error nobody
     * explained (a gateway's 502, a server failure with its reference) the
     * way the rest of the page does, the reference with its copy button
     * (#7307).
     */
    const addErrorNote: (data: {
      key: string;
      template: string;
      error: string | undefined | null;
    }) => void = (data: {
      key: string;
      template: string;
      error: string | undefined | null;
    }): void => {
      notes.push({
        key: data.key,
        content: <ErrorSentence template={data.template} error={data.error} />,
      });
    };

    if (incidentsState === "forbidden") {
      notes.push({
        key: "incidents-hidden",
        content: translator.translateTemplate(
          "Incidents are hidden: you need permission to read incidents.",
        ),
      });
    } else if (incidentsState === "error") {
      addErrorNote({
        key: "incidents-error",
        template: translationKey("Couldn't load incidents. {{error}}"),
        error: incidents.error,
      });
    } else if (incidents.refreshError) {
      addErrorNote({
        key: "incidents-refresh-error",
        template: translationKey("Couldn't refresh incidents. {{error}}"),
        error: incidents.refreshError,
      });
    }

    if (alertsState === "forbidden") {
      notes.push({
        key: "alerts-hidden",
        content: translator.translateTemplate(
          "Alerts are hidden: you need permission to read alerts.",
        ),
      });
    } else if (alertsState === "error") {
      addErrorNote({
        key: "alerts-error",
        template: translationKey("Couldn't load alerts. {{error}}"),
        error: alerts.error,
      });
    } else if (alerts.refreshError) {
      addErrorNote({
        key: "alerts-refresh-error",
        template: translationKey("Couldn't refresh alerts. {{error}}"),
        error: alerts.refreshError,
      });
    }

    let list: ReactElement = <></>;

    if (isBothKnownZero) {
      list = (
        <SloOverviewEmptyState
          dataTestId="monitor-open-work-empty"
          icon={IconProp.CheckCircle}
          tone="good"
          title="Nothing open"
          description="No unresolved incidents or alerts on this monitor."
        />
      );
    } else if (rows.length > 0) {
      list = (
        <ul
          aria-label={translator.translateText("Open incidents and alerts")}
          className="mt-4 divide-y divide-gray-100"
        >
          {rows.map((row: MonitorOpenWorkRow) => {
            return getRow(row);
          })}
        </ul>
      );
    } else if (isLoading) {
      list = (
        <div
          role="status"
          aria-label={translator.translateText(
            "Loading open incidents and alerts",
          )}
          className="mt-4 space-y-2 animate-pulse"
        >
          <div className="h-4 w-5/6 rounded bg-gray-100"></div>
          <div className="h-4 w-2/3 rounded bg-gray-100"></div>
        </div>
      );
    }

    return (
      <div>
        <div className="grid grid-cols-2 gap-3">
          {getCountTile({
            label: "Incidents",
            section: incidents,
            state: incidentsState,
            to: incidentsRoute,
            activeClassName: "text-red-700",
            testId: "monitor-open-incident-count",
          })}
          {getCountTile({
            label: "Alerts",
            section: alerts,
            state: alertsState,
            to: alertsRoute,
            activeClassName: "text-amber-700",
            testId: "monitor-open-alert-count",
          })}
        </div>

        {list}

        <div
          data-testid="monitor-open-work-footer"
          className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-500"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <SloOverviewActionLink
              variant="text"
              title="All incidents"
              to={incidentsRoute}
            />
            <SloOverviewActionLink
              variant="text"
              title="All alerts"
              to={alertsRoute}
            />
          </div>
          {notes.map(
            (note: {
              key: string;
              content: ReactElement | string;
            }): ReactElement => {
              return (
                <p
                  key={note.key}
                  className="mt-2"
                  data-testid={`monitor-open-work-note-${note.key}`}
                >
                  {note.content}
                </p>
              );
            },
          )}
        </div>
      </div>
    );
  };

  return (
    <Card
      title="Open incidents & alerts"
      description="Unresolved incidents and alerts on this monitor."
      headerLayout="stacked"
    >
      {getBody()}
    </Card>
  );
};

export default MonitorOpenWorkCard;
