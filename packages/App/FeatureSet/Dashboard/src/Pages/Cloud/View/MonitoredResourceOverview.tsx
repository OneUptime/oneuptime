import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
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
  isInventoryOnlyCloudResourceType,
} from "Common/Types/Cloud/CloudResourceCatalog";
import ResourceOverview, {
  ResourceOverviewChip,
  ResourceOverviewDetailRow,
} from "../../../Components/TelemetryResource/ResourceOverview";
import MetricsViewer from "../../../Components/Metrics/MetricsViewer";
import {
  getCloudMonitoredResourceAttributeDisplayKeys,
  getCloudMonitoredResourceAttributeFilters,
} from "../Utils/CloudMonitoredResourceScope";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import AppLink from "../../../Components/AppLink/AppLink";
import ResourceActivityCards from "../../../Components/ResourceActivity/ResourceActivityCards";
import CloudResourceInventoryCards from "../../../Components/Cloud/CloudResourceInventoryCards";

/*
 * The Overview of a Cloud Resource - one a cloud connection lists from its
 * account's inventory, or one discovered from cloud monitoring: what the
 * provider says it is - its type, service model, region, account and the
 * provider's own id - its open incidents and alerts, what its inventory
 * says (what it is connected to, its endpoints, tags and settings), and
 * every metric the provider reports about it, each one a click away from
 * the explorer and from "Create monitor from this view".
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

// The inventory a cloud connection lists an account's resources from.
const INVENTORY_SOURCE_BY_PROVIDER: Readonly<Record<string, string>> = {
  azure: "Azure Resource Graph",
  aws: "AWS Cloud Control",
  gcp: "Google Cloud Asset Inventory",
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
          _id: true,
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
          cloudTags: true,
          cloudProperties: true,
          cloudRelationships: true,
          cloudEndpoints: true,
          inventoriedAt: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
          createdAt: true,
          cloudConnectionId: true,
          cloudConnection: {
            name: true,
          },
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

  // A chart opened from here draws this resource's incidents, alerts and changes.
  const eventScope: Record<string, string> = useMemo(() => {
    return { cloudResourceId: modelId.toString() };
  }, [modelId.toString()]);

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
  const hasNoMetrics: boolean =
    isInventoryOnlyCloudResourceType(provider, type) &&
    Object.keys(attributeFilters).length === 0;

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

  /*
   * Words in the page's own type, the cloud's ids and names in mono: a
   * reader tells "AWS" and "Networking" from the strings to copy.
   */
  const detailRows: Array<ResourceOverviewDetailRow> = [
    {
      label: "Cloud Provider",
      value: getCloudProviderLabel(provider),
      mono: false,
    },
    { label: "Resource Type", value: type, mono: true },
    {
      label: "Service Model",
      value: descriptor
        ? CLOUD_SERVICE_MODEL_LABELS[descriptor.serviceModel]
        : undefined,
      mono: false,
    },
    {
      label: "Category",
      value: descriptor
        ? CLOUD_RESOURCE_CATEGORY_LABELS[descriptor.category]
        : undefined,
      mono: false,
    },
    { label: "Cloud Region", value: r.cloudRegion, mono: true },
    { label: "Cloud Account ID", value: r.cloudAccountId, mono: true },
    { label: "Resource Group", value: r.cloudResourceGroup, mono: true },
    {
      label: "Provider Resource ID",
      value: r.providerResourceId,
      mono: true,
    },
    {
      label: "Discovered From",
      value: Object.keys(attributeFilters).length
        ? MONITORING_SOURCE_BY_PROVIDER[provider]
        : undefined,
      mono: false,
    },
    {
      label: "Listed By",
      value: r.inventoriedAt
        ? INVENTORY_SOURCE_BY_PROVIDER[provider]
        : undefined,
      mono: false,
    },
    {
      label: "Last Listed",
      value: r.inventoriedAt
        ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            r.inventoriedAt,
          )
        : undefined,
      mono: false,
    },
    /*
     * The cloud connection that reads it (Cloud > Connect), when one does:
     * where to look when it stops reporting.
     */
    {
      label: "Cloud Connection",
      mono: false,
      value: r.cloudConnectionId ? r.cloudConnection?.name || "" : undefined,
      element: r.cloudConnectionId ? (
        <AppLink
          to={RouteUtil.populateRouteParams(
            RouteMap[PageMap.CLOUD_CONNECT] as Route,
          )}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          <span>
            {r.cloudConnection?.name || translator.translateText("Connect")}
          </span>
        </AppLink>
      ) : undefined,
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
        statusDescription="Reporting while its cloud connection listed it, or its provider sent a metric about it, within the last hour. One its account no longer lists, or silent for a week, is archived."
        lastSeenAt={r.lastSeenAt}
        description={r.description as string}
        chips={chips}
        tiles={[]}
        detailRows={detailRows}
        detailsDescription="What its cloud says it is, where it is, and how OneUptime reads it."
        recordId={modelId.toString()}
        settingsRoute={populate(PageMap.CLOUD_RESOURCE_VIEW_SETTINGS)}
        labels={r.labels}
      />

      <div className="mt-6">
        <ResourceActivityCards
          modelId={modelId}
          resourceQueryKey="cloudResources"
          incidentsRoute={populate(PageMap.CLOUD_RESOURCE_VIEW_INCIDENTS)}
          alertsRoute={populate(PageMap.CLOUD_RESOURCE_VIEW_ALERTS)}
        />
      </div>

      <CloudResourceInventoryCards resource={r} />

      {/*
       * A network (a VPC) publishes no metrics of its own: no card saying
       * they will come.
       */}
      {hasNoMetrics ? (
        <></>
      ) : (
        <div className="mt-6">
          <Card
            title="Metrics"
            description="Everything the provider reports about this resource. Open a metric to chart it, then choose Create monitor from this view to alert on it."
          >
            {Object.keys(attributeFilters).length > 0 ? (
              <MetricsViewer
                attributeFilters={attributeFilters}
                attributeFilterDisplayKeys={attributeFilterDisplayKeys}
                eventScope={eventScope}
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
      )}
    </>
  );
};

export default CloudMonitoredResourceOverview;
