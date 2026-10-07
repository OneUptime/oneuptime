import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Pill from "Common/UI/Components/Pill/Pill";
import { Gray500, Green } from "Common/Types/BrandColors";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import {
  CLOUD_PROVIDER_LABELS,
  CloudProvider,
  getCloudProviderLabel,
} from "Common/Types/Cloud/CloudPlatform";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import {
  CLOUD_RESOURCE_TYPES,
  CLOUD_SERVICE_MODEL_LABELS,
  CloudResourceTypeDescriptor,
  getCloudResourceTypeDescriptor,
  getCloudResourceTypeLabel,
} from "Common/Types/Cloud/CloudResourceCatalog";
import CloudMonitoringDocumentationCard from "../../Components/Cloud/CloudMonitoringDocumentationCard";

/*
 * Cloud → All Resources: the IaaS and PaaS resources discovered from the
 * metrics a cloud provider's monitoring API publishes about them (Azure
 * Monitor, CloudWatch, Cloud Monitoring), read by an OpenTelemetry
 * Collector (Common/Types/Cloud/CloudMonitoredResource).
 *
 * Every row is ingest's: a resource is matched to its metrics by the
 * provider's own identity, which no form could supply, so there is no
 * create button - connecting an account (the guide below) is how resources
 * get here. Rows can be renamed, labelled, owned and archived like any
 * Cloud row; one the provider stops reporting is archived after a week,
 * and comes back by itself when it reports again.
 */

const PROVIDER_DROPDOWN_OPTIONS: Array<DropdownOption> = Object.values(
  CloudProvider,
).map((provider: CloudProvider): DropdownOption => {
  return { label: CLOUD_PROVIDER_LABELS[provider], value: provider };
});

/*
 * The Type filter: every catalogued type, by its label and provider
 * ("Virtual Machine (Azure)"). A type the catalog does not list is still
 * found through the Name search.
 */
const TYPE_DROPDOWN_OPTIONS: Array<DropdownOption> = CLOUD_RESOURCE_TYPES.map(
  (descriptor: CloudResourceTypeDescriptor): DropdownOption => {
    return {
      label: `${descriptor.label} (${CLOUD_PROVIDER_LABELS[descriptor.provider]})`,
      value: descriptor.type,
    };
  },
).sort((a: DropdownOption, b: DropdownOption): number => {
  return a.label.localeCompare(b.label);
});

const CloudMonitoredResources: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string>("");

  const { archiveBulkActions } = useBulkArchiveActions<CloudResource>({
    modelType: CloudResource,
  });

  useEffect(() => {
    ModelAPI.count({
      modelType: CloudResource,
      query: { cloudResourceKind: CloudResourceKind.Resource },
    })
      .then(setCount)
      .catch((err: Error) => {
        setError(API.getFriendlyMessage(err));
      });
  }, []);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (count === null) {
    return <PageLoader isVisible={true} />;
  }

  return (
    <Fragment>
      <ModelTable<CloudResource>
        modelType={CloudResource}
        id="cloud-monitored-resources-table"
        userPreferencesKey="cloud-monitored-resources-table"
        query={{
          isArchived: false,
          cloudResourceKind: CloudResourceKind.Resource,
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        bulkActions={{
          buttons: [...archiveBulkActions],
        }}
        showRefreshButton={true}
        showViewIdButton={true}
        name="Cloud Resources"
        searchableFields={["name", "description"]}
        selectMoreFields={{
          cloudResourceType: true,
          cloudProvider: true,
          cloudRegion: true,
          cloudAccountId: true,
          cloudResourceGroup: true,
        }}
        cardProps={{
          title: "Cloud Resources",
          description:
            "IaaS and PaaS resources discovered from the metrics your cloud provider publishes about them: Azure Monitor, Amazon CloudWatch and Google Cloud Monitoring, read by an OpenTelemetry Collector. Virtual machines, load balancers, buckets, managed databases, caches and queues each get their own page.",
        }}
        noItemsMessage="No cloud resources discovered yet."
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              cloudProvider: true,
            },
            title: "Provider",
            type: FieldType.Dropdown,
            filterDropdownOptions: PROVIDER_DROPDOWN_OPTIONS,
          },
          {
            field: {
              cloudResourceType: true,
            },
            title: "Type",
            type: FieldType.Dropdown,
            filterDropdownOptions: TYPE_DROPDOWN_OPTIONS,
          },
          {
            field: {
              cloudRegion: true,
            },
            title: "Region",
            type: FieldType.Text,
          },
          {
            field: {
              cloudAccountId: true,
            },
            title: "Account",
            type: FieldType.Text,
          },
          {
            field: {
              cloudResourceGroup: true,
            },
            title: "Resource Group",
            type: FieldType.Text,
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen",
            type: FieldType.Date,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: CloudResource): ReactElement => {
              const name: string = (item.name as string) || "";
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.CLOUD_RESOURCE_VIEW] as Route,
                {
                  modelId: new ObjectID(item._id as string),
                },
              );
              const typeLabel: string = getCloudResourceTypeLabel(
                item.cloudProvider as string | undefined,
                item.cloudResourceType as string | undefined,
              );
              return (
                <div className="min-w-0">
                  <AppLink
                    to={route}
                    className="text-sm font-medium text-gray-900 truncate hover:underline"
                  >
                    {name || "—"}
                  </AppLink>
                  {typeLabel && (
                    <div className="text-xs text-gray-500 truncate">
                      {typeLabel}
                    </div>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              cloudProvider: true,
            },
            title: "Provider",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: CloudResource): ReactElement => {
              const provider: string = getCloudProviderLabel(
                (item.cloudProvider as string) || "",
              );
              const descriptor: CloudResourceTypeDescriptor | null =
                getCloudResourceTypeDescriptor(
                  item.cloudProvider as string | undefined,
                  item.cloudResourceType as string | undefined,
                );
              return (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <span>{provider || "—"}</span>
                  {descriptor && (
                    <Pill
                      text={CLOUD_SERVICE_MODEL_LABELS[descriptor.serviceModel]}
                      color={Gray500}
                    />
                  )}
                </div>
              );
            },
          },
          {
            field: {
              cloudRegion: true,
            },
            title: "Location",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: CloudResource): ReactElement => {
              const region: string = (item.cloudRegion as string) || "";
              const place: string =
                (item.cloudResourceGroup as string) ||
                (item.cloudAccountId as string) ||
                "";
              if (!region && !place) {
                return <span className="text-sm text-gray-400">—</span>;
              }
              return (
                <div className="min-w-0">
                  <div className="text-sm text-gray-700 truncate">
                    {region || "—"}
                  </div>
                  {place && (
                    <div className="text-xs text-gray-500 font-mono truncate">
                      {place}
                    </div>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              otelCollectorStatus: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: CloudResource): ReactElement => {
              const isReporting: boolean =
                item.otelCollectorStatus === "connected";
              return (
                <Pill
                  text={isReporting ? "Reporting" : "Not reporting"}
                  color={isReporting ? Green : Gray500}
                />
              );
            },
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen",
            type: FieldType.DateTime,
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            hideOnMobile: true,
            getElement: (item: CloudResource): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ]}
        onViewPage={(item: CloudResource): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.CLOUD_RESOURCE_VIEW] as Route,
                {
                  modelId: item._id,
                },
              ).toString(),
            ),
          );
        }}
      />
      {count === 0 && (
        <CloudMonitoringDocumentationCard
          title="Discover your cloud resources"
          description="No cloud resources discovered yet. Run an OpenTelemetry Collector with read-only access to your cloud's monitoring API, using the guide below: every resource it reports on appears here, with its metrics."
        />
      )}
    </Fragment>
  );
};

export default CloudMonitoredResources;
