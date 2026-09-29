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

const DockerSwarmClusterNodeDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Route shape: .../docker-swarm/:modelId/nodes/:subModelId — subModelId
   * is the percent-encoded externalId ("node/<id>"), not a DB id.
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
          kind: "Node",
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
  const nodeName: string = row
    ? displayNameForResource(row)
    : externalId.replace(/^node\//, "");

  // Build overview summary fields from the inventory row.
  const summaryFields: Array<SummaryField> = [
    { title: "Node Hostname", value: nodeName },
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

    if (row.role) {
      summaryFields.push({ title: "Role", value: row.role });
    }

    const availability: string = attributeString(row, "availability");
    if (availability) {
      summaryFields.push({ title: "Availability", value: availability });
    }

    const managerStatus: string = attributeString(row, "managerStatus");
    if (managerStatus) {
      summaryFields.push({ title: "Manager Status", value: managerStatus });
    }

    const engineVersion: string = attributeString(row, "engineVersion");
    if (engineVersion) {
      summaryFields.push({ title: "Engine Version", value: engineVersion });
    }

    const addr: string = attributeString(row, "addr");
    if (addr) {
      summaryFields.push({ title: "Address", value: addr });
    }

    if (row.latestCpuPercent !== null && row.latestCpuPercent !== undefined) {
      summaryFields.push({
        title: "CPU",
        value: formatPercent(Number(row.latestCpuPercent)),
      });
    }

    if (row.latestMemoryBytes !== null && row.latestMemoryBytes !== undefined) {
      summaryFields.push({
        title: "Memory",
        value: formatBytes(Number(row.latestMemoryBytes)),
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
          emptyMessage="Node details not reported yet. Make sure the Docker Swarm agent is sending metrics."
        />
      ),
    },
  ];

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default DockerSwarmClusterNodeDetail;
