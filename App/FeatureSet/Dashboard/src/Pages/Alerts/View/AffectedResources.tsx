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
import MonitorType from "Common/Types/Monitor/MonitorType";
import { JSONObject } from "Common/Types/JSON";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import API from "Common/UI/Utils/API/API";

export interface ComponentProps {
  alertId: ObjectID;
}

const AlertAffectedResources: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [seriesLabels, setSeriesLabels] = useState<JSONObject | undefined>(
    undefined,
  );
  /*
   * The monitor type decides which commands make sense for this series
   * (kubectl vs docker vs df), so it is fetched alongside the labels.
   */
  const [monitorType, setMonitorType] = useState<MonitorType | undefined>(
    undefined,
  );

  const fetchSeriesLabels: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const alert: Alert | null = await ModelAPI.getItem({
        modelType: Alert,
        id: props.alertId,
        select: {
          seriesLabels: true,
        },
      });

      const labels: JSONObject | undefined = alert?.seriesLabels as
        | JSONObject
        | undefined;

      if (!labels || Object.keys(labels).length === 0) {
        setSeriesLabels(undefined);
        return;
      }

      setSeriesLabels(labels);
    } catch (err) {
      API.getFriendlyMessage(err);
      setSeriesLabels(undefined);
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

  useEffect(() => {
    fetchSeriesLabels().catch(() => {
      // handled inside fetchSeriesLabels
    });
    fetchMonitorType().catch(() => {
      // handled inside fetchMonitorType
    });
  }, [props.alertId]);

  if (!seriesLabels) {
    return <Fragment />;
  }

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
        <SeriesLabelsViewer seriesLabels={seriesLabels} />
      </Card>
      {hasDebugCommands ? (
        <Card
          title="Start Here"
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
