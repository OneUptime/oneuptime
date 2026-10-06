import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Card from "Common/UI/Components/Card/Card";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { getCloudProviderLabel } from "Common/Types/Cloud/CloudPlatform";
import {
  CLOUD_RESOURCE_CATEGORY_LABELS,
  CLOUD_SERVICE_MODEL_LABELS,
  CloudResourceTypeDescriptor,
  getCloudResourceTypeDescriptor,
  getCloudResourceTypeLabel,
} from "Common/Types/Cloud/CloudResourceCatalog";
import ResourceOverview, {
  ResourceOverviewChip,
  ResourceOverviewDetailRow,
  ResourceOverviewQuickLink,
} from "../../../Components/TelemetryResource/ResourceOverview";
import MetricsViewer from "../../../Components/Metrics/MetricsViewer";
import {
  getCloudMonitoredResourceAttributeDisplayKeys,
  getCloudMonitoredResourceAttributeFilters,
} from "../Utils/CloudMonitoredResourceScope";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * The Overview of a Cloud Resource discovered from cloud monitoring: what
 * the provider says it is - its type, service model, region, account and
 * the provider's own id - and every metric the provider reports about it,
 * each one a click away from the explorer and from "Create monitor from
 * this view".
 *
 * There are no golden-metric tiles: a resource is any of a hundred types,
 * each with its own metrics, and the list below is what this one reports.
 */

// The monitoring API a provider's resources are discovered from.
const MONITORING_SOURCE_BY_PROVIDER: Readonly<Record<string, string>> = {
  azure: "Azure Monitor",
  aws: "Amazon CloudWatch",
  gcp: "Google Cloud Monitoring",
};

const CloudMonitoredResourceOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const translator: Translator = useTranslator();

  const [cloudResource, setCloudResource] = useState<CloudResource | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchModel: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: CloudResource | null = await ModelAPI.getItem({
        modelType: CloudResource,
        id: modelId,
        select: {
          name: true,
          description: true,
          cloudResourceKind: true,
          cloudResourceType: true,
          providerResourceId: true,
          cloudProvider: true,
          cloudRegion: true,
          cloudAccountId: true,
          cloudResourceGroup: true,
          telemetryAttributes: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
          createdAt: true,
          labels: {
            name: true,
            color: true,
          },
        },
      });

      if (!item) {
        setError("Cloud resource not found.");
      } else {
        setCloudResource(item);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchModel().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  const attributeFilters: Record<string, string> = useMemo(() => {
    return getCloudMonitoredResourceAttributeFilters(cloudResource);
  }, [cloudResource?.cloudResourceKind, cloudResource?.telemetryAttributes]);

  const attributeFilterDisplayKeys: Record<string, string> = useMemo(() => {
    return getCloudMonitoredResourceAttributeDisplayKeys(attributeFilters);
  }, [attributeFilters]);

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
  const provider: string = (r.cloudProvider as string) || "";
  const type: string = (r.cloudResourceType as string) || "";
  const typeLabel: string = getCloudResourceTypeLabel(provider, type);
  const descriptor: CloudResourceTypeDescriptor | null =
    getCloudResourceTypeDescriptor(provider, type);
  const isReporting: boolean = r.otelCollectorStatus === "connected";

  const chips: Array<ResourceOverviewChip> = [];
  if (provider) {
    chips.push({
      icon: IconProp.Cloud,
      label: getCloudProviderLabel(provider),
    });
  }
  if (descriptor) {
    chips.push({
      icon: IconProp.SquareStack,
      label: CLOUD_SERVICE_MODEL_LABELS[descriptor.serviceModel],
    });
  }
  if (r.cloudRegion) {
    chips.push({ icon: IconProp.Globe, label: String(r.cloudRegion) });
  }
  if (r.cloudResourceGroup) {
    chips.push({ icon: IconProp.Folder, label: String(r.cloudResourceGroup) });
  }

  const populate: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, { modelId });
  };

  const quickLinks: Array<ResourceOverviewQuickLink> = [
    {
      title: "Metrics",
      description: "Every metric the provider reports about this resource",
      to: populate(PageMap.CLOUD_RESOURCE_VIEW_METRICS),
      icon: IconProp.ChartBar,
    },
    {
      title: "Owners",
      description: "Who is responsible for this resource",
      to: populate(PageMap.CLOUD_RESOURCE_VIEW_OWNERS),
      icon: IconProp.Team,
    },
    {
      title: "Documentation",
      description: "How resources are discovered from your cloud account",
      to: populate(PageMap.CLOUD_RESOURCE_VIEW_DOCUMENTATION),
      icon: IconProp.Book,
    },
  ];

  const detailRows: Array<ResourceOverviewDetailRow> = [
    { label: "Cloud Provider", value: getCloudProviderLabel(provider) },
    { label: "Resource Type", value: type, mono: true },
    {
      label: "Service Model",
      value: descriptor
        ? CLOUD_SERVICE_MODEL_LABELS[descriptor.serviceModel]
        : undefined,
    },
    {
      label: "Category",
      value: descriptor
        ? CLOUD_RESOURCE_CATEGORY_LABELS[descriptor.category]
        : undefined,
    },
    { label: "Cloud Region", value: r.cloudRegion },
    { label: "Cloud Account ID", value: r.cloudAccountId },
    { label: "Resource Group", value: r.cloudResourceGroup },
    {
      label: "Provider Resource ID",
      value: r.providerResourceId,
      mono: true,
    },
    {
      label: "Discovered From",
      value: MONITORING_SOURCE_BY_PROVIDER[provider],
    },
  ];

  return (
    <>
      <ResourceOverview
        icon={IconProp.Cloud}
        title={(r.name as string) || typeLabel || "Cloud Resource"}
        identifier={typeLabel}
        identifierLabel="type"
        status={r.otelCollectorStatus}
        statusLabel={isReporting ? "Reporting" : "Not reporting"}
        statusTone={isReporting ? "positive" : "neutral"}
        statusDescription="Reporting while its provider has sent a metric about it within the last hour. A quiet resource can skip an hour, and one silent for a week is archived until it reports again."
        lastSeenAt={r.lastSeenAt}
        description={r.description as string}
        chips={chips}
        tiles={[]}
        quickLinks={quickLinks}
        detailRows={detailRows}
        settingsRoute={populate(PageMap.CLOUD_RESOURCE_VIEW_SETTINGS)}
        labels={r.labels}
      />

      <div className="mt-6">
        <Card
          title="Metrics"
          description="Everything the provider reports about this resource. Open a metric to chart it, then choose Create monitor from this view to alert on it."
        >
          {Object.keys(attributeFilters).length > 0 ? (
            <MetricsViewer
              attributeFilters={attributeFilters}
              attributeFilterDisplayKeys={attributeFilterDisplayKeys}
              disableUrlSync={true}
            />
          ) : (
            <p className="text-sm text-gray-500">
              {translator.translateText(
                "No metric attributes are recorded for this resource yet. They are recorded with the next metrics its provider reports about it.",
              )}
            </p>
          )}
        </Card>
      </div>
    </>
  );
};

export default CloudMonitoredResourceOverview;
