import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
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
import { keyForKubernetesCluster } from "Common/Utils/Telemetry/EntityKey";

const KubernetesClusterLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: KubernetesCluster | null = await ModelAPI.getItem({
        modelType: KubernetesCluster,
        id: modelId,
        select: {
          clusterIdentifier: true,
          name: true,
        },
      });

      if (!item?.clusterIdentifier) {
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
        "resource.k8s.cluster.name": cluster?.clusterIdentifier || "",
      },
    };
    return q as Query<Log>;
  }, [cluster?.clusterIdentifier]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cluster?.clusterIdentifier) {
    return <ErrorMessage message="Cluster not found." />;
  }

  return (
    <Card
      title="Cluster Logs"
      description="Live OpenTelemetry logs from all workloads in this Kubernetes cluster. Use the filter bar to scope by severity, trace id, or any resource attribute."
    >
      {/*
       * entityScope is the query scope (contract C4): new rows match via the
       * bloom-indexed `entityKeys` membership column, pre-column rows (no
       * backfill, empty array) via the attribute equality inside the same OR.
       * `logQuery.attributes` stays for the histogram / facet scoping —
       * display behavior is unchanged. Drop the attribute fallback (here and
       * in the logQuery merge) once deploy-date + max retention has passed.
       */}
      <DashboardLogsViewer
        id={`kubernetes-cluster-logs-${modelId.toString()}`}
        logQuery={logQuery}
        entityScope={{
          entityKeys: [
            keyForKubernetesCluster(
              ProjectUtil.getCurrentProjectId()!.toString(),
              cluster.clusterIdentifier!,
            ),
          ],
          attributeKey: "resource.k8s.cluster.name",
          attributeValue: cluster.clusterIdentifier!,
        }}
        showFilters={true}
        enableRealtime={true}
        noLogsMessage="No logs found for this cluster. Make sure your OTel collector forwards logs with the k8s.cluster.name resource attribute."
      />
    </Card>
  );
};

export default KubernetesClusterLogs;
