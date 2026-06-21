import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ResourceTable, {
  InfrastructureResource,
} from "../../../Components/Infrastructure/ResourceTable";
import { fetchDockerSwarmInventoryResources } from "../Utils/DockerSwarmResourceUtils";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";

const DockerSwarmClusterNetworks: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [resources, setResources] = useState<Array<InfrastructureResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      // Postgres inventory read (DockerSwarmResource, kind=Network).
      const networkList: Array<InfrastructureResource> =
        await fetchDockerSwarmInventoryResources({
          dockerSwarmClusterId: modelId,
          kind: "Network",
        });

      setResources(networkList);
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

  return (
    <ResourceTable
      onRefreshClick={() => {
        fetchData().catch(() => {});
      }}
      title="Networks"
      description="Swarm-scoped (overlay) and local networks in this cluster."
      resources={resources}
      showGroupColumn={false}
      showStatus={false}
      showResourceMetrics={false}
      tableIdPrefix="docker-swarm"
      emptyMessage="No networks reported yet. Make sure the Docker Swarm agent is sending metrics."
      columns={[
        {
          title: "Driver",
          key: "driver",
          getValue: (resource: InfrastructureResource): string => {
            return resource.additionalAttributes["driver"] || "-";
          },
        },
        {
          title: "Scope",
          key: "scope",
          getValue: (resource: InfrastructureResource): string => {
            return resource.additionalAttributes["scope"] || "-";
          },
        },
      ]}
    />
  );
};

export default DockerSwarmClusterNetworks;
