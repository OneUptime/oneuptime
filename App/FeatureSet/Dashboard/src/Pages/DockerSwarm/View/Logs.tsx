import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
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
import ProjectUtil from "Common/UI/Utils/Project";
import { keyForDockerSwarmCluster } from "../Utils/DockerSwarmResourceUtils";

const DockerSwarmClusterLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<DockerSwarmCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: DockerSwarmCluster | null = await ModelAPI.getItem({
        modelType: DockerSwarmCluster,
        id: modelId,
        select: {
          name: true,
        },
      });

      if (!item?.name) {
        setError("Cluster not found.");
        setIsLoading(false);
        return;
      }

      setCluster(item);
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
        "resource.docker.swarm.cluster.name": cluster?.name || "",
      },
    };
    return q as Query<Log>;
  }, [cluster?.name]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cluster?.name) {
    return <ErrorMessage message="Cluster not found." />;
  }

  return (
    <Card
      title="Cluster Logs"
      description="OpenTelemetry logs ingested with this cluster's docker.swarm.cluster.name resource attribute. Use the filter bar to scope by severity, trace id, or any resource attribute."
    >
      {/*
       * entityScope is the query scope (contract C4): new rows match via the
       * bloom-indexed `entityKeys` membership column, pre-column rows (no
       * backfill, empty array) via the attribute equality inside the same OR.
       * `logQuery.attributes` stays for the histogram / facet scoping —
       * display behavior is unchanged. Do NOT also AND a separate
       * attributes-equality filter into the query itself — that defeats the
       * OR. Drop the attribute fallback (here and in the logQuery merge)
       * once deploy-date + max retention has passed.
       */}
      <DashboardLogsViewer
        id={`docker-swarm-cluster-logs-${modelId.toString()}`}
        logQuery={logQuery}
        entityScope={{
          entityKeys: [
            keyForDockerSwarmCluster(
              ProjectUtil.getCurrentProjectId()!.toString(),
              cluster.name!,
            ),
          ],
          attributeKey: "resource.docker.swarm.cluster.name",
          attributeValue: cluster.name!,
        }}
        showFilters={true}
        enableRealtime={true}
        noLogsMessage="No logs found. The Docker Swarm agent ships metrics only — logs appear here when you send OpenTelemetry logs stamped with this cluster's docker.swarm.cluster.name resource attribute."
      />
    </Card>
  );
};

export default DockerSwarmClusterLogs;
