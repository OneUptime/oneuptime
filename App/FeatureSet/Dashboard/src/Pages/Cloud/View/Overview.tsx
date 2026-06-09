import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import CloudResourceInstance from "Common/Models/DatabaseModels/CloudResourceInstance";
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
import ResourceOverview, {
  ResourceOverviewChip,
  ResourceOverviewDetailRow,
} from "../../../Components/TelemetryResource/ResourceOverview";

const CloudResourceOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [cloudResource, setCloudResource] = useState<CloudResource | null>(
    null,
  );
  const [instanceCount, setInstanceCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: CloudResource | null = await ModelAPI.getItem({
        modelType: CloudResource,
        id: modelId,
        select: {
          name: true,
          description: true,
          resourceIdentifier: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
          cloudPlatform: true,
          cloudProvider: true,
          cloudRegion: true,
          cloudAccountId: true,
          runtimeName: true,
          runtimeVersion: true,
          agentVersion: true,
          labels: { name: true, color: true },
        },
      });

      if (!item?.resourceIdentifier) {
        setError("Cloud resource not found.");
        setIsLoading(false);
        return;
      }

      setCloudResource(item);

      try {
        const count: number = await ModelAPI.count({
          modelType: CloudResourceInstance,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          query: { cloudResourceId: modelId } as any,
        });
        setInstanceCount(count);
      } catch {
        setInstanceCount(0);
      }
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

  if (!cloudResource) {
    return <ErrorMessage message="Cloud resource not found." />;
  }

  const r: CloudResource = cloudResource;
  const runtime: string = [r.runtimeName, r.runtimeVersion]
    .filter((s: string | undefined): boolean => {
      return Boolean(s);
    })
    .join(" ");

  const chips: Array<ResourceOverviewChip> = [];
  if (r.cloudPlatform) {
    chips.push({ icon: IconProp.Cloud, label: String(r.cloudPlatform) });
  }
  if (r.cloudRegion) {
    chips.push({ icon: IconProp.Globe, label: String(r.cloudRegion) });
  }
  if (runtime) {
    chips.push({ icon: IconProp.Code, label: runtime });
  }

  const detailRows: Array<ResourceOverviewDetailRow> = [
    { label: "Resource Identifier (service.name)", value: r.resourceIdentifier },
    { label: "Cloud Platform", value: r.cloudPlatform },
    { label: "Cloud Provider", value: r.cloudProvider },
    { label: "Cloud Region", value: r.cloudRegion },
    { label: "Cloud Account ID", value: r.cloudAccountId },
    { label: "Runtime", value: runtime },
    { label: "Agent Version", value: r.agentVersion },
  ];

  return (
    <ResourceOverview
      icon={IconProp.Cloud}
      title={(r.name as string) || "Cloud Resource"}
      identifier={(r.resourceIdentifier as string) || ""}
      identifierLabel="service.name"
      status={r.otelCollectorStatus}
      lastSeenAt={r.lastSeenAt}
      description={r.description as string}
      chips={chips}
      telemetryAttributeKey="resource.service.name"
      telemetryAttributeValue={(r.resourceIdentifier as string) || ""}
      metricsRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.CLOUD_RESOURCE_VIEW_METRICS] as Route,
        { modelId },
      )}
      logsRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.CLOUD_RESOURCE_VIEW_LOGS] as Route,
        { modelId },
      )}
      tracesRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.CLOUD_RESOURCE_VIEW_TRACES] as Route,
        { modelId },
      )}
      inventoryTile={{
        title: "Instances",
        icon: IconProp.Cube,
        count: instanceCount,
        to: RouteUtil.populateRouteParams(
          RouteMap[PageMap.CLOUD_RESOURCE_VIEW_INSTANCES] as Route,
          { modelId },
        ),
      }}
      detailRows={detailRows}
      labels={r.labels}
    />
  );
};

export default CloudResourceOverview;
