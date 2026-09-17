import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import DockerSwarmResourceModel from "Common/Models/DatabaseModels/DockerSwarmResource";
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
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import ResourceOverviewTab, {
  SummaryField,
} from "../../../Components/Infrastructure/ResourceOverviewTab";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import {
  externalIdFromRouteParam,
  fetchDockerSwarmInventoryRow,
  formatBytes,
  formatPercent,
  displayNameForResource,
  displayStatusForResource,
  attributeString,
} from "../Utils/DockerSwarmResourceUtils";
import OneUptimeDate from "Common/Types/Date";

const DockerSwarmClusterTaskDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Route shape: .../docker-swarm/:modelId/tasks/:subModelId — subModelId
   * is the percent-encoded externalId ("task/<id>"), not a DB id.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const externalId: string = externalIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );

  const [cluster, setCluster] = useState<DockerSwarmCluster | null>(null);
  const [row, setRow] = useState<DockerSwarmResourceModel | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingRow, setIsLoadingRow] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
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

    try {
      const inventoryRow: DockerSwarmResourceModel | null =
        await fetchDockerSwarmInventoryRow({
          dockerSwarmClusterId: modelId,
          kind: "Task",
          externalId: externalId,
        });
      setRow(inventoryRow);
    } catch {
      // Graceful degradation — overview tab shows its empty state.
    }
    setIsLoadingRow(false);
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

  const clusterName: string = cluster.name;
  const taskName: string = row
    ? displayNameForResource(row)
    : externalId.replace(/^task\//, "");

  const summaryFields: Array<SummaryField> = [
    { title: "Task", value: taskName },
    { title: "Cluster", value: clusterName },
  ];

  if (row) {
    const status: string = displayStatusForResource(row);
    if (status) {
      summaryFields.push({
        title: "State",
        value: (
          <StatusBadge
            text={status}
            type={
              row.isReady === false
                ? StatusBadgeType.Danger
                : StatusBadgeType.Success
            }
          />
        ),
      });
    }

    if (row.serviceName) {
      summaryFields.push({ title: "Service", value: row.serviceName });
    }

    if (row.nodeHostname) {
      summaryFields.push({ title: "Node", value: row.nodeHostname });
    }

    const slot: string = attributeString(row, "slot");
    if (slot) {
      summaryFields.push({ title: "Slot", value: slot });
    }

    if (row.image) {
      summaryFields.push({ title: "Image", value: row.image });
    }

    if (row.stackName) {
      summaryFields.push({ title: "Stack", value: row.stackName });
    }

    const containerId: string = attributeString(row, "containerId");
    if (containerId) {
      summaryFields.push({ title: "Container ID", value: containerId });
    }

    const message: string = attributeString(row, "message");
    if (message) {
      summaryFields.push({ title: "Message", value: message });
    }

    if (row.latestCpuPercent !== null && row.latestCpuPercent !== undefined) {
      summaryFields.push({
        title: "CPU",
        value: formatPercent(Number(row.latestCpuPercent)),
      });
    }

    if (row.latestMemoryBytes !== null && row.latestMemoryBytes !== undefined) {
      const used: string = formatBytes(Number(row.latestMemoryBytes));
      const limit: string =
        row.maxMemoryBytes !== null && row.maxMemoryBytes !== undefined
          ? ` / ${formatBytes(Number(row.maxMemoryBytes))}`
          : "";
      summaryFields.push({
        title: "Memory",
        value: `${used}${limit}`,
      });
    }

    summaryFields.push({ title: "External ID", value: externalId });

    if (row.lastSeenAt) {
      summaryFields.push({
        title: "Last Seen",
        value: OneUptimeDate.fromNow(new Date(row.lastSeenAt as Date)),
      });
    }
  }

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <ResourceOverviewTab
          summaryFields={row ? summaryFields : []}
          labels={{}}
          annotations={{}}
          isLoading={isLoadingRow}
          emptyMessage="Task details not reported yet. Make sure the Docker Swarm agent is sending metrics."
        />
      ),
    },
  ];

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default DockerSwarmClusterTaskDetail;
