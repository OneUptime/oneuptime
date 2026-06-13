import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
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
import { keyForCephCluster } from "Common/Utils/Telemetry/EntityKey";

const CephClusterLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<CephCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: CephCluster | null = await ModelAPI.getItem({
        modelType: CephCluster,
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
        "resource.ceph.cluster.name": cluster?.name || "",
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
      description="Live OpenTelemetry logs scoped to this Ceph cluster. Use the filter bar to scope by severity, trace id, or any resource attribute."
    >
      {/*
       * entityScope matches new rows via the bloom-indexed `entityKeys`
       * membership column, with the resource-attribute equality as the
       * fallback inside the same OR — the pattern Kubernetes/View pages use.
       */}
      <DashboardLogsViewer
        id={`ceph-cluster-logs-${modelId.toString()}`}
        logQuery={logQuery}
        entityScope={{
          entityKeys: [
            keyForCephCluster(
              ProjectUtil.getCurrentProjectId()!.toString(),
              cluster.name!,
            ),
          ],
          attributeKey: "resource.ceph.cluster.name",
          attributeValue: cluster.name!,
        }}
        showFilters={true}
        enableRealtime={true}
        noLogsMessage="No logs found for this cluster. The Ceph agent ships metrics only — logs appear here when you forward them with the ceph.cluster.name resource attribute."
      />
    </Card>
  );
};

export default CephClusterLogs;
