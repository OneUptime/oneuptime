import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import React, {
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

/*
 * Insights placeholder. The curated cross-cluster MetricView presets that
 * the Proxmox product ships are built around pve-exporter's metric names
 * and have no Docker Swarm equivalent yet, so rather than invent metric
 * names we point users at the per-cluster Metrics explorer (which is wired
 * to this cluster's docker.swarm.cluster.name scope) for now.
 */
const DockerSwarmClusterInsights: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<DockerSwarmCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchCluster: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: DockerSwarmCluster | null = await ModelAPI.getItem({
        modelType: DockerSwarmCluster,
        id: modelId,
        select: {
          name: true,
        },
      });
      setCluster(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchCluster().catch((err: Error) => {
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

  const metricsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_METRICS] as Route,
    { modelId: modelId },
  );

  return (
    <Card
      title="Insights"
      description="Curated dashboards for this Docker Swarm cluster."
    >
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <Icon icon={IconProp.LightBulb} className="h-8 w-8 text-gray-300" />
        <div className="text-sm text-gray-600">
          Curated insight dashboards for Docker Swarm are coming soon.
        </div>
        <div className="max-w-md text-xs text-gray-400">
          In the meantime, explore every metric ingested with this
          cluster&apos;s docker.swarm.cluster.name resource attribute in the
          Metrics tab.
        </div>
        <button
          type="button"
          onClick={() => {
            Navigation.navigate(metricsRoute);
          }}
          className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          <Icon icon={IconProp.Graph} className="h-3.5 w-3.5 text-gray-500" />
          Go to Metrics
        </button>
      </div>
    </Card>
  );
};

export default DockerSwarmClusterInsights;
