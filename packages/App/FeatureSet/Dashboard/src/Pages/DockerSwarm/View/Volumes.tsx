import PageComponentProps from "../../PageComponentProps";
import { EMPTY_VALUE_MARK } from "Common/Types/EmptyValueMark";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ResourceTable, {
  InfrastructureResource,
} from "../../../Components/Infrastructure/ResourceTable";
import { fetchDockerSwarmInventoryResources } from "../Utils/DockerSwarmResourceUtils";
import {
  DOCKER_SWARM_VOLUME_DISK_COLUMNS,
  getDockerSwarmVolumeSizeColumn,
  withDockerSwarmVolumeStorage,
} from "../Utils/DockerSwarmVolumeStorage";
import DockerSwarmResource from "Common/Models/DatabaseModels/DockerSwarmResource";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";

const DockerSwarmClusterVolumes: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const translator: Translator = useTranslator();

  const [resources, setResources] = useState<Array<InfrastructureResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      /*
       * Postgres inventory read (DockerSwarmResource, kind=Volume).
       * Volumes are node-local, so the table groups by node.
       */
      const volumeList: Array<InfrastructureResource> =
        await fetchDockerSwarmInventoryResources({
          dockerSwarmClusterId: modelId,
          kind: "Volume",
          // Its size, and how full the disk it lives on is (#9648).
          transform: (
            resource: InfrastructureResource,
            row: DockerSwarmResource,
          ): void => {
            withDockerSwarmVolumeStorage(resource, row.attributes);
          },
        });

      setResources(volumeList);
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
    return <PageSkeleton shape="table" />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <ResourceTable
      onRefreshClick={() => {
        fetchData().catch(() => {});
      }}
      title="Volumes"
      description="Volumes reported by nodes in this swarm."
      resources={resources}
      showGroupColumn={true}
      groupColumnTitle="Node"
      showStatus={false}
      showResourceMetrics={false}
      tableIdPrefix="docker-swarm"
      emptyMessage="No volumes reported yet. Make sure the Docker Swarm agent is sending metrics."
      storageUsageColumns={DOCKER_SWARM_VOLUME_DISK_COLUMNS}
      columns={[
        getDockerSwarmVolumeSizeColumn(translator.language),
        {
          title: "Driver",
          key: "driver",
          getValue: (resource: InfrastructureResource): string => {
            return resource.additionalAttributes["driver"] || EMPTY_VALUE_MARK;
          },
        },
        {
          title: "Mountpoint",
          key: "mountpoint",
          getValue: (resource: InfrastructureResource): string => {
            return (
              resource.additionalAttributes["mountpoint"] || EMPTY_VALUE_MARK
            );
          },
        },
      ]}
    />
  );
};

export default DockerSwarmClusterVolumes;
