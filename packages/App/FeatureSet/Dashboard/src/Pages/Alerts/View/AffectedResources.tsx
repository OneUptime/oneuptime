import ObjectID from "Common/Types/ObjectID";
import Alert from "Common/Models/DatabaseModels/Alert";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Card from "Common/UI/Components/Card/Card";
import SeriesLabelsViewer from "Common/UI/Components/Monitor/SeriesLabelsViewer";
import SeriesDebugCommandsViewer from "Common/UI/Components/Monitor/SeriesDebugCommandsViewer";
import SeriesDebugHints from "Common/Types/Monitor/SeriesContext/SeriesDebugHints";
import SeriesLabelDisplay from "Common/Types/Monitor/SeriesContext/SeriesLabelDisplay";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { JSONObject } from "Common/Types/JSON";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import API from "Common/UI/Utils/API/API";

export interface ComponentProps {
  alertId: ObjectID;
  /*
   * The alert's series labels, when the page has already read them with
   * the rest of the alert (null when it has none). Leave it undefined and
   * the card reads them itself.
   */
  seriesLabels?: JSONObject | null | undefined;
}

type NormalizeLabelsFunction = (
  labels: JSONObject | null | undefined,
) => JSONObject | undefined;

const normalizeSeriesLabels: NormalizeLabelsFunction = (
  labels: JSONObject | null | undefined,
): JSONObject | undefined => {
  if (!labels || Object.keys(labels).length === 0) {
    return undefined;
  }

  return labels;
};

const AlertAffectedResources: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const alertIdString: string = props.alertId.toString();
  const hasSeriesLabelsFromPage: boolean = props.seriesLabels !== undefined;

  const [fetchedSeriesLabels, setFetchedSeriesLabels] = useState<
    JSONObject | undefined
  >(undefined);
  /*
   * The monitor type decides which commands make sense for this series
   * (kubectl vs docker vs df), so it is fetched alongside the labels.
   */
  const [monitorType, setMonitorType] = useState<MonitorType | undefined>(
    undefined,
  );

  const seriesLabels: JSONObject | undefined = hasSeriesLabelsFromPage
    ? normalizeSeriesLabels(props.seriesLabels)
    : fetchedSeriesLabels;

  const fetchSeriesLabels: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const alert: Alert | null = await ModelAPI.getItem({
        modelType: Alert,
        id: props.alertId,
        select: {
          seriesLabels: true,
        },
      });

      setFetchedSeriesLabels(
        normalizeSeriesLabels(alert?.seriesLabels as JSONObject | undefined),
      );
    } catch (err) {
      /*
       * Fetch failure is not worth surfacing - the section simply doesn't
       * render. The main alert detail shows the error state.
       */
      API.getFriendlyMessage(err);
      setFetchedSeriesLabels(undefined);
    }
  };

  /*
   * Deliberately a SEPARATE request from the labels above. The monitor
   * type only decides which suggested commands to show, and reading it
   * crosses into the Monitor model - a role with alert access but no
   * monitor read permission would fail the whole query. Asking for it on
   * its own means that user still gets the Affected Resource table and
   * simply no command suggestions.
   */
  const fetchMonitorType: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const alert: Alert | null = await ModelAPI.getItem({
        modelType: Alert,
        id: props.alertId,
        select: {
          monitor: {
            monitorType: true,
          },
        },
      });

      setMonitorType(alert?.monitor?.monitorType);
    } catch {
      setMonitorType(undefined);
    }
  };

  /*
   * Keyed on the id's string: the page builds a new ObjectID on every render,
   * and keying on that instance re-read the row each time the page did.
   */
  useEffect(() => {
    if (hasSeriesLabelsFromPage) {
      return;
    }

    fetchSeriesLabels().catch(() => {
      // handled inside fetchSeriesLabels
    });
  }, [alertIdString, hasSeriesLabelsFromPage]);

  const hasSeriesLabels: boolean = Boolean(seriesLabels);

  // Most alerts are not per-series, and then there are no commands to pick.
  useEffect(() => {
    if (!hasSeriesLabels) {
      setMonitorType(undefined);
      return;
    }

    fetchMonitorType().catch(() => {
      // handled inside fetchMonitorType
    });
  }, [alertIdString, hasSeriesLabels]);

  if (!seriesLabels) {
    return <Fragment />;
  }

  const hasDisplayLabels: boolean =
    SeriesLabelDisplay.getDisplayLabels(seriesLabels).length > 0;

  const hasDebugCommands: boolean =
    SeriesDebugHints.getDebugCommands({
      monitorType: monitorType,
      seriesLabels: seriesLabels,
    }).length > 0;

  return (
    <Fragment>
      <Card
        title="Affected Resource"
        description="The specific resource (e.g. host, pod, container) that triggered this alert. Present when a metric monitor is grouped by one or more attributes."
      >
        {hasDisplayLabels ? (
          <SeriesLabelsViewer seriesLabels={seriesLabels} />
        ) : (
          <div className="py-2 text-sm text-gray-400">
            No resource labels on this alert.
          </div>
        )}
      </Card>
      {hasDebugCommands ? (
        <Card
          title="Debug commands"
          description="Read-only commands for this exact resource, already filled in. Nothing here changes state."
        >
          <SeriesDebugCommandsViewer
            monitorType={monitorType}
            seriesLabels={seriesLabels}
          />
        </Card>
      ) : (
        <Fragment />
      )}
    </Fragment>
  );
};

export default AlertAffectedResources;
