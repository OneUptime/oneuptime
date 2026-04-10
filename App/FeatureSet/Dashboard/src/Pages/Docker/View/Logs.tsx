import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
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

const DockerHostLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [host, setHost] = useState<DockerHost | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: DockerHost | null = await ModelAPI.getItem({
        modelType: DockerHost,
        id: modelId,
        select: {
          hostIdentifier: true,
          name: true,
        },
      });

      if (!item?.hostIdentifier) {
        setError("Host not found.");
        setIsLoading(false);
        return;
      }

      setHost(item);
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
     * Using `any` to sidestep a TS2589 "excessively deep type instantiation"
     * error on the Query<Log> generic when inline attribute maps are used.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      attributes: {
        "resource.host.name": host?.hostIdentifier || "",
        "resource.container.runtime": "docker",
      },
    };
    return q as Query<Log>;
  }, [host?.hostIdentifier]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!host) {
    return <ErrorMessage message="Host not found." />;
  }

  return (
    <Card
      title="Container Logs"
      description="Live OpenTelemetry logs from all containers on this Docker host. Use the filter bar to scope by severity, trace id, or any resource attribute."
    >
      <DashboardLogsViewer
        id={`docker-host-logs-${modelId.toString()}`}
        logQuery={logQuery}
        showFilters={true}
        enableRealtime={true}
        noLogsMessage="No container logs found. Make sure the Docker agent's filelog receiver is configured and the collector is running."
      />
    </Card>
  );
};

export default DockerHostLogs;
