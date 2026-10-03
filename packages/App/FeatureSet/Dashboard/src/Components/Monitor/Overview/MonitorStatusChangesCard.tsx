import PageMap from "../../../Utils/PageMap";
import { getEventDurationText } from "../../../Utils/EventDuration";
import { OverviewSection } from "../../../Utils/OverviewSection";
import RelativeTime from "../../EpisodeView/RelativeTime";
import LiveDuration from "../../EventView/LiveDuration";
import SloOverviewActionLink from "../../Slo/SloOverviewActionLink";
import { getMonitorPageRoute } from "./MonitorOverviewLinks";
import MonitorStatusDot from "./MonitorStatusDot";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import CurrentlyActiveIndicator from "Common/UI/Components/StateTimeline/CurrentlyActiveIndicator";
import MonitorStatusHistoryUtil, {
  MonitorStatusChangeRow,
} from "Common/Utils/Monitor/MonitorStatusHistoryUtil";
import React, { FunctionComponent, ReactElement } from "react";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps {
  monitorId: ObjectID;
  // The newest few timeline rows, newest first.
  statusRows: OverviewSection<Array<MonitorStatusTimeline>>;
}

/*
 * The last few times this monitor changed status, newest first, with how
 * long each lasted. Only the newest open row is ongoing - marked "Currently
 * Active", as on the full status timeline, with a duration that keeps
 * counting: an older row the reconciler has not closed yet is capped at the
 * start of the next one.
 */
const MonitorStatusChangesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const rows: Array<MonitorStatusTimeline> | null = props.statusRows.value;

  type GetTimeLineFunction = (row: MonitorStatusChangeRow) => ReactElement;

  // How long the status held, and when it started, as one sentence.
  const getTimeLine: GetTimeLineFunction = (
    row: MonitorStatusChangeRow,
  ): ReactElement => {
    const startedAt: ReactElement = <RelativeTime date={row.startsAt} />;

    if (row.isOngoing) {
      return (
        <TranslatedSentence
          template="for {{duration}} · started {{time}}"
          slots={{
            duration: <LiveDuration startDate={row.startsAt} />,
            time: startedAt,
          }}
        />
      );
    }

    if (row.endsAt) {
      return (
        <TranslatedSentence
          template="for {{duration}} · started {{time}}"
          values={{
            duration: getEventDurationText(row.startsAt, row.endsAt),
          }}
          slots={{ time: startedAt }}
        />
      );
    }

    return (
      <TranslatedSentence
        template="started {{time}}"
        slots={{ time: startedAt }}
      />
    );
  };

  type GetBodyFunction = () => ReactElement;

  const getBody: GetBodyFunction = (): ReactElement => {
    if (!rows) {
      if (props.statusRows.status === "forbidden") {
        return (
          <p className="text-sm text-gray-500">
            {translator.translateText(
              "Status history is hidden: you need permission to read the status timeline.",
            )}
          </p>
        );
      }

      if (props.statusRows.status === "error") {
        return (
          <p className="text-sm text-red-700">
            {translator.translateTemplate(
              "Couldn't load status history. {{error}}",
              { error: props.statusRows.error || "" },
            )}
          </p>
        );
      }

      return (
        <div
          role="status"
          aria-label={translator.translateText("Loading status changes")}
          className="space-y-2 animate-pulse"
        >
          <div className="h-4 w-5/6 rounded bg-gray-100"></div>
          <div className="h-4 w-2/3 rounded bg-gray-100"></div>
        </div>
      );
    }

    const changeRows: Array<MonitorStatusChangeRow> =
      MonitorStatusHistoryUtil.getStatusChangeRows(rows);

    return (
      <div>
        {changeRows.length === 0 ? (
          <p className="text-sm text-gray-500">
            {translator.translateText("No status recorded yet.")}
          </p>
        ) : (
          <ul
            aria-label={translator.translateText("Recent status changes")}
            className="divide-y divide-gray-100"
          >
            {changeRows.map((row: MonitorStatusChangeRow) => {
              return (
                <li
                  key={row.id}
                  data-testid="monitor-status-change-row"
                  className="py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <MonitorStatusDot color={row.statusColor} />
                    <span className="text-sm font-medium text-gray-900">
                      {row.statusName}
                    </span>
                    {row.isOngoing ? <CurrentlyActiveIndicator /> : <></>}
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {getTimeLine(row)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {props.statusRows.refreshError ? (
          <p className="mt-2 text-xs text-gray-500">
            {translator.translateTemplate(
              "Couldn't refresh status history. {{error}}",
              { error: props.statusRows.refreshError || "" },
            )}
          </p>
        ) : (
          <></>
        )}
        <div className="mt-3 border-t border-gray-100 pt-3">
          <SloOverviewActionLink
            variant="text"
            title="Full status timeline"
            to={getMonitorPageRoute({
              pageMap: PageMap.MONITOR_VIEW_STATUS_TIMELINE,
              monitorId: props.monitorId,
            })}
          />
        </div>
      </div>
    );
  };

  return (
    <Card
      title="Recent status changes"
      description="The last five times this monitor changed status."
      headerLayout="stacked"
    >
      {getBody()}
    </Card>
  );
};

export default MonitorStatusChangesCard;
