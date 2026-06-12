import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
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

const ProxmoxClusterLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<ProxmoxCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: ProxmoxCluster | null = await ModelAPI.getItem({
        modelType: ProxmoxCluster,
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
     * Using `any` to sidestep a TS2589 "excessively deep type instantiation"
     * error on the Query<Log> generic when inline attribute maps are used.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      attributes: {
        "resource.proxmox.cluster.name": cluster?.name || "",
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

  if (!cluster) {
    return <ErrorMessage message="Cluster not found." />;
  }

  return (
    <Card
      title="Cluster Logs"
      description="OpenTelemetry logs ingested with this cluster's proxmox.cluster.name resource attribute. Use the filter bar to scope by severity, trace id, or any resource attribute."
    >
      <DashboardLogsViewer
        id={`proxmox-cluster-logs-${modelId.toString()}`}
        logQuery={logQuery}
        showFilters={true}
        enableRealtime={true}
        noLogsMessage="No logs found. The Proxmox agent ships metrics only — logs appear here when you send OpenTelemetry logs stamped with this cluster's proxmox.cluster.name resource attribute."
      />
    </Card>
  );
};

export default ProxmoxClusterLogs;
