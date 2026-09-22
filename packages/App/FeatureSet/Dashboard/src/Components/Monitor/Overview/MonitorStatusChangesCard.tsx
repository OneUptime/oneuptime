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
import MonitorStatusHistoryUtil, {
  MonitorStatusChangeRow,
} from "Common/Utils/Monitor/MonitorStatusHistoryUtil";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitorId: ObjectID;
  // The newest few timeline rows, newest first.
  statusRows: OverviewSection<Array<MonitorStatusTimeline>>;
}

/*
 * The last few times this monitor changed status, newest first, with how
 * long each lasted. Only the newest open row is "ongoing": an older row the
 * reconciler has not closed yet is capped at the start of the next one.
 */
const MonitorStatusChangesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const rows: Array<MonitorStatusTimeline> | null = props.statusRows.value;

  type GetDurationFunction = (row: MonitorStatusChangeRow) => ReactElement;

  const getDuration: GetDurationFunction = (
    row: MonitorStatusChangeRow,
  ): ReactElement => {
    if (row.isOngoing) {
      return (
        <>
          {"ongoing, "}
          <LiveDuration startDate={row.startsAt} />
          {" · "}
        </>
      );
    }

    if (row.endsAt) {
      return <>{`for ${getEventDurationText(row.startsAt, row.endsAt)} · `}</>;
    }

    return <></>;
  };

  type GetBodyFunction = () => ReactElement;

  const getBody: GetBodyFunction = (): ReactElement => {
    if (!rows) {
      if (props.statusRows.status === "forbidden") {
        return (
          <p className="text-sm text-gray-500">
            Status history is hidden: you need permission to read the status
            timeline.
          </p>
        );
      }

      if (props.statusRows.status === "error") {
        return (
          <p className="text-sm text-red-700">
            {`Couldn't load status history. ${props.statusRows.error}`}
          </p>
        );
      }

      return (
        <div
          role="status"
          aria-label="Loading status changes"
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
          <p className="text-sm text-gray-500">No status recorded yet.</p>
        ) : (
          <ul
            aria-label="Recent status changes"
            className="divide-y divide-gray-100"
          >
            {changeRows.map((row: MonitorStatusChangeRow) => {
              return (
                <li
                  key={row.id}
                  data-testid="monitor-status-change-row"
                  className="py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <MonitorStatusDot color={row.statusColor} />
                    <span className="text-sm font-medium text-gray-900">
                      {row.statusName}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {getDuration(row)}
                    {"started "}
                    <RelativeTime date={row.startsAt} />
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {props.statusRows.refreshError ? (
          <p className="mt-2 text-xs text-gray-500">
            {`Couldn't refresh status history. ${props.statusRows.refreshError}`}
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
