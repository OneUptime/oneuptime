import PageComponentProps from "../../PageComponentProps";
import useInventoryItem, {
  UseInventoryItemResult,
} from "../../../Components/Inventory/useInventoryItem";
import TracesViewer from "../../../Components/Traces/TracesViewer";
import LogsViewer from "../../../Components/Logs/LogsViewer";
import MetricsViewer from "../../../Components/Metrics/MetricsViewer";
import ExceptionsTable from "../../../Components/Exceptions/ExceptionsTable";
import ProfileTable from "../../../Components/Profiles/ProfileTable";
import {
  applyTimeCursorChange,
  createDefaultTimeCursorState,
  EXCEPTIONS_TIME_CURSOR_HINT,
  PROFILES_TIME_CURSOR_HINT,
  SharedTelemetryTimeCursorState,
  SharedTelemetryViewerWindows,
  toViewerWindows,
} from "../../../Utils/SharedTelemetryTimeCursor";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import Profile from "Common/Models/AnalyticsModels/Profile";
import ObjectID from "Common/Types/ObjectID";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useMemo,
  useState,
} from "react";

/*
 * Every signal that belongs to this item.
 *
 * Membership is read through `entityKeys` rather than through the signal's
 * primary owner, which is the whole point of the entity model's read path: a
 * span owned by the `checkout` service but executed on this pod belongs to
 * both, and asking "what ran on this pod" has to return it. A primary-owner
 * query would return nothing at all for a pod.
 *
 * All tabs share one time cursor (the picker in the header). Each embedded
 * viewer receives it as a controlled window and lifts its own user-initiated
 * window changes (histogram drag-zoom, its own picker) back up — so a
 * five-minute window isolated in Logs is exactly what Traces opens on.
 * Exceptions are lifetime aggregates and cannot follow it; Profiles follow
 * only once the user has actually made a selection, keeping the tab's
 * unbounded default.
 */

const InventoryItemTelemetry: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const { item, isLoading, error }: UseInventoryItemResult =
    useInventoryItem(modelId);

  const [timeCursor, setTimeCursor] = useState<SharedTelemetryTimeCursorState>(
    createDefaultTimeCursorState,
  );

  /*
   * One handler for the header picker and for every viewer's lift.
   * applyTimeCursorChange returns the same state object for a value that did
   * not move, so an echoed lift bails out of the re-render entirely.
   */
  const handleTimeCursorChange: (next: RangeStartAndEndDateTime) => void =
    useCallback((next: RangeStartAndEndDateTime): void => {
      setTimeCursor(
        (
          previous: SharedTelemetryTimeCursorState,
        ): SharedTelemetryTimeCursorState => {
          return applyTimeCursorChange(previous, next);
        },
      );
    }, []);

  const viewerWindows: SharedTelemetryViewerWindows = useMemo(() => {
    return toViewerWindows(timeCursor);
  }, [timeCursor]);

  const entityKey: string = item?.entityKey || "";

  /*
   * Stable identities: the viewers' fetch effects and query memos key on
   * these props, so rebuilding them inline would refetch the mounted tab on
   * every cursor change even when its own window did not move.
   */
  const entityKeysFilter: Array<string> = useMemo(() => {
    return [entityKey];
  }, [entityKey]);

  const logsQuery: Query<Log> = useMemo(() => {
    return {
      entityKeys: new Includes([entityKey]),
    } as Query<Log>;
  }, [entityKey]);

  const profileQuery: Query<Profile> | undefined = useMemo(() => {
    if (!viewerWindows.profilesCapturedWindow) {
      return undefined;
    }
    return {
      startTime: viewerWindows.profilesCapturedWindow,
    } as Query<Profile>;
  }, [viewerWindows.profilesCapturedWindow]);

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!item?.entityKey) {
    return <ErrorMessage message="This inventory item could not be found." />;
  }

  return (
    <Fragment>
      <Card
        title="Telemetry"
        description="Everything that mentions this item — including signals another item owns, such as a service's span that happened to run here. The time range applies across every tab."
        rightElement={
          <TelemetryTimeRangePicker
            value={timeCursor.range}
            onChange={handleTimeCursorChange}
          />
        }
      />
      <Tabs
        onTabChange={() => {
          // no-op: each tab self-fetches on render
        }}
        tabs={
          [
            {
              name: "Traces",
              children: (
                <TracesViewer
                  entityKeysFilter={entityKeysFilter}
                  timeRangeOverride={viewerWindows.viewerTimeRange}
                  onTimeRangeChange={handleTimeCursorChange}
                  disableUrlSync={true}
                />
              ),
            },
            {
              name: "Logs",
              children: (
                <LogsViewer
                  id="inventory-item-logs"
                  logQuery={logsQuery}
                  timeRangeOverride={viewerWindows.viewerTimeRange}
                  onTimeRangeChange={handleTimeCursorChange}
                />
              ),
            },
            {
              name: "Metrics",
              children: (
                <MetricsViewer
                  entityKeysFilter={entityKeysFilter}
                  timeRangeOverride={viewerWindows.viewerTimeRange}
                  onTimeRangeChange={handleTimeCursorChange}
                  disableUrlSync={true}
                />
              ),
            },
            {
              name: "Exceptions",
              children: (
                <Fragment>
                  <p className="mb-3 text-xs text-gray-500">
                    {EXCEPTIONS_TIME_CURSOR_HINT}
                  </p>
                  <ExceptionsTable
                    query={{}}
                    title="Exceptions"
                    description="Exception groups whose instances belong to this item."
                    entityKeys={entityKeysFilter}
                  />
                </Fragment>
              ),
            },
            {
              name: "Profiles",
              children: (
                <Fragment>
                  {profileQuery && (
                    <p className="mb-3 text-xs text-gray-500">
                      {PROFILES_TIME_CURSOR_HINT}
                    </p>
                  )}
                  <ProfileTable
                    entityKeys={entityKeysFilter}
                    profileQuery={profileQuery}
                  />
                </Fragment>
              ),
            },
          ] as Array<Tab>
        }
      />
    </Fragment>
  );
};

export default InventoryItemTelemetry;
