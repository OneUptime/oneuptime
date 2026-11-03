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
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import AppLink from "../../../Components/AppLink/AppLink";
import ResourceActivityCards from "../../../Components/ResourceActivity/ResourceActivityCards";
import CloudResourceInventoryCards from "../../../Components/Cloud/CloudResourceInventoryCards";
import ResourceSecurityCard from "../../../Components/SecurityConnections/ResourceSecurityCard";
import { SecurityConnectionKind } from "Common/Types/SecurityCase/SecurityConnection";
import {
  CloudHealthAssessment,
  CloudHealthState,
  assessCloudResourceHealth,
  readCloudResourceReadings,
} from "Common/Types/Cloud/CloudResourceHealth";
import {
  CloudHeadlineTile,
  getCloudHeadlineTiles,
} from "../../../Components/Cloud/CloudHeadlineTiles";
import {
  CLOUD_RESOURCE_ATTENTION_CURRENT,
  getCloudResourceOwnAttentionItems,
} from "../../../Components/Cloud/CloudResourceAttention";
import NeedsAttentionCard from "../../../Components/ResourcePart/NeedsAttentionCard";
import CloudResourceCostCard from "../../../Components/Cloud/CloudResourceCostCard";
import ProjectUtil from "Common/UI/Utils/Project";
import { ResourceOverviewTile } from "../../../Components/TelemetryResource/ResourceOverview";

/*
 * The Overview of a Cloud Resource - one a cloud connection lists from its
 * account's inventory, or one discovered from cloud monitoring: what the
 * provider says it is - its type, service model, region, account and the
 * provider's own id - its open incidents and alerts, what its inventory
 * says (what it is connected to, its endpoints, tags and settings), and
 * every metric the provider reports about it, each one a click away from
 * the explorer and from "Create monitor from this view".
 *
 * Its health leads: the hero's pill says how it is by its type's rules
 * (CloudResourceHealth) - Healthy, Degraded, Unhealthy, Reporting or Not
 * reporting - "This resource" under it says why when it needs attention,
 * and for the common types the tiles show the few numbers people read
 * first (CloudHeadlineTiles), all from what the last read kept on the
 * resource. A type with no headline numbers has no tiles: the Metrics card
 * lists everything it reports.
 */

/*
 * What the hero's pill says it is judged by, in each state: on hover, so a
 * "Reporting" never reads as an all-clear the rules did not give.
 */
export const CLOUD_RESOURCE_STATUS_DESCRIPTIONS: Record<
  CloudHealthState,
  string
> = {
  healthy: translationKey(
    "Its cloud connection's last read found nothing wrong in its key metrics.",
  ),
  degraded: translationKey(
    "Its key metrics show something that needs a look. The reasons are below.",
  ),
  unhealthy: translationKey(
    "Its key metrics show it broken, or about to be. The reasons are below.",
  ),
  reporting: translationKey(
    "Reporting while its cloud connection listed it, or its provider sent a metric about it, within the last hour. No rule judges its type, or no key metric was read lately.",
  ),
  "not-reporting": translationKey(
    "Not listed by its cloud connection, and no metric about it, for over an hour. One its account no longer lists, or silent for a week, is archived.",
  ),
};

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
          cloudReadings: true,
          cloudReadingsAt: true,
          healthSeverity: true,
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
  const now: Date = OneUptimeDate.getCurrentDate();
  const health: CloudHealthAssessment = assessCloudResourceHealth(r, { now });
  const headlineTiles: Array<ResourceOverviewTile> = getCloudHeadlineTiles({
    provider,
    type,
    readings: readCloudResourceReadings(r.cloudReadings),
    hasFreshReadings: health.hasFreshReadings && health.isReporting,
    translator,
  }).map((tile: CloudHeadlineTile): ResourceOverviewTile => {
    return {
      title: tile.title,
      value: tile.value,
      sublabel: tile.sublabel,
      percent: tile.percent,
      icon: tile.icon,
      iconColor: tile.iconColor,
    };
  });
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
    /*
     * The category in the reader's language: one of the product's own
     * words ("Databases and caches"), which read English on every page.
     */
    {
      label: "Category",
      value: descriptor
        ? translator.translateText(
            CLOUD_RESOURCE_CATEGORY_LABELS[descriptor.category],
          ) || CLOUD_RESOURCE_CATEGORY_LABELS[descriptor.category]
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
        statusLabel={health.status.text}
        statusTone={health.tone}
        statusDescription={
          translator.translateText(
            CLOUD_RESOURCE_STATUS_DESCRIPTIONS[health.state],
          ) || CLOUD_RESOURCE_STATUS_DESCRIPTIONS[health.state]
        }
        lastSeenAt={r.lastSeenAt}
        description={r.description as string}
        chips={chips}
        tiles={headlineTiles}
        detailRows={detailRows}
        detailsDescription={translationKey(
          "What its cloud says it is, where it is, and how OneUptime reads it.",
        )}
        recordId={modelId.toString()}
        settingsRoute={populate(PageMap.CLOUD_RESOURCE_VIEW_SETTINGS)}
        labels={r.labels}
      />

      {/*
       * Why it needs attention, when it does: "This resource" and its
       * reasons, the same rows the Overview's Needs attention lists.
       */}
      <NeedsAttentionCard
        testId="cloud-resource-attention"
        items={getCloudResourceOwnAttentionItems({ resource: r, now })}
        current={CLOUD_RESOURCE_ATTENTION_CURRENT}
        showKind={false}
      />

      {/*
       * What it costs and how it could cost less, when its cloud says:
       * nothing is drawn for a resource with neither.
       */}
      {ProjectUtil.getCurrentProjectId() && r.providerResourceId ? (
        <CloudResourceCostCard
          projectId={ProjectUtil.getCurrentProjectId()!}
          resourceRecordId={modelId}
          provider={provider}
          providerResourceId={r.providerResourceId}
        />
      ) : (
        <></>
      )}

      <div className="mt-6">
        <ResourceActivityCards
          modelId={modelId}
          resourceQueryKey="cloudResources"
          incidentsRoute={populate(PageMap.CLOUD_RESOURCE_VIEW_INCIDENTS)}
          alertsRoute={populate(PageMap.CLOUD_RESOURCE_VIEW_ALERTS)}
        />
        {/*
         * What Security Events found about it this week, for whoever may
         * read it (Components/SecurityConnections).
         */}
        <ResourceSecurityCard
          kind={SecurityConnectionKind.CloudResource}
          modelId={modelId}
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
