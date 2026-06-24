import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Card from "Common/UI/Components/Card/Card";
import DashboardLogsViewer from "../../../Components/Logs/LogsViewer";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";

const IoTFleetLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [fleet, setFleet] = useState<IoTFleet | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: IoTFleet | null = await ModelAPI.getItem({
        modelType: IoTFleet,
        id: modelId,
        select: {
          name: true,
        },
      });

      if (!item?.name) {
        setError("Fleet not found.");
        setIsLoading(false);
        return;
      }

      setFleet(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  const logQuery: Query<Log> = useMemo(() => {
    /*
     * `any` sidesteps a TS2589 deep-instantiation on Query<Log> with
     * inline attribute maps — same workaround the Host/Docker logs pages use.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      attributes: {
        "resource.iot.fleet.name": fleet?.name || "",
      },
    };
    return q as Query<Log>;
  }, [fleet?.name]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!fleet?.name) {
    return <ErrorMessage message="Fleet not found." />;
  }

  return (
    <Card
      title="Fleet Logs"
      description="OpenTelemetry logs ingested with this fleet's iot.fleet.name resource attribute. Use the filter bar to scope by severity, trace id, or any resource attribute."
    >
      {/*
       * `logQuery.attributes` scopes the logs query to this fleet via the
       * `iot.fleet.name` resource attribute that the IoT agent stamps on every
       * telemetry record, and also drives the histogram / facet scoping.
       */}
      <DashboardLogsViewer
        id={`iot-fleet-logs-${modelId.toString()}`}
        logQuery={logQuery}
        showFilters={true}
        enableRealtime={true}
        noLogsMessage="No logs found. The IoT agent ships metrics only — logs appear here when you send OpenTelemetry logs stamped with this fleet's iot.fleet.name resource attribute."
      />
    </Card>
  );
};

export default IoTFleetLogs;
