import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import MetricsViewer from "../../../Components/Metrics/MetricsViewer";
import ProjectUtil from "Common/UI/Utils/Project";
import { keyForProxmoxCluster } from "Common/Utils/Telemetry/EntityKey";

const ProxmoxClusterMetrics: FunctionComponent<
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
    <Fragment>
      {/*
       * entityScope is the query scope (contract C4): new rows match via the
       * bloom-indexed `entityKeys` membership column, pre-column rows (no
       * backfill, empty array) via the attribute equality inside the same OR.
       * `attributeFilters` stays for the read-only scope chip and the
       * metric-name / sparkline scoping — display behavior is unchanged.
       * Do NOT also AND a separate attributes-equality filter into the query
       * itself — that defeats the OR. Drop the attribute fallback (here and
       * in the attributeFilters query merge) once deploy-date + max retention
       * has passed.
       */}
      <MetricsViewer
        attributeFilters={{
          "resource.proxmox.cluster.name": cluster.name,
        }}
        attributeFilterDisplayKeys={{
          "resource.proxmox.cluster.name": "Cluster",
        }}
        entityScope={{
          entityKeys: [
            keyForProxmoxCluster(
              ProjectUtil.getCurrentProjectId()!.toString(),
              cluster.name,
            ),
          ],
          attributeKey: "resource.proxmox.cluster.name",
          attributeValue: cluster.name,
        }}
      />
    </Fragment>
  );
};

export default ProxmoxClusterMetrics;
