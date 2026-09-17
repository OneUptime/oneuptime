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
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import {
  CLOUD_PROVIDER_LABELS,
  CloudProvider,
  MANAGED_CLOUD_PLATFORMS,
  ManagedCloudPlatformDescriptor,
  buildCloudEnvironmentKey,
  buildCloudEnvironmentName,
  getCloudProviderForPlatform,
  getCloudProviderLabel,
  getManagedCloudPlatformLabel,
} from "Common/Types/Cloud/CloudPlatform";
import CloudDocumentationCard from "../../Components/Cloud/CloudDocumentationCard";
import CloudFleetSummary from "../../Components/Cloud/CloudFleetSummary";

/*
 * Picker options for the create form and the Platform filter. The label
 * carries the raw cloud.platform value in brackets because that string is
 * what the user has to find in their collector's resource attributes to
 * confirm they picked the right one.
 */
const PLATFORM_DROPDOWN_OPTIONS: Array<DropdownOption> =
  MANAGED_CLOUD_PLATFORMS.map(
    (descriptor: ManagedCloudPlatformDescriptor): DropdownOption => {
      return {
        label: `${descriptor.productName} (${descriptor.platform})`,
        value: descriptor.platform,
      };
    },
  );

const PROVIDER_DROPDOWN_OPTIONS: Array<DropdownOption> = Object.values(
  CloudProvider,
).map((provider: CloudProvider): DropdownOption => {
  return { label: CLOUD_PROVIDER_LABELS[provider], value: provider };
});

const CloudResources: FunctionComponent<
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
      query: {},
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
      <CloudFleetSummary refreshToken={count} />
      <ModelTable<CloudResource>
        modelType={CloudResource}
        id="cloud-resources-table"
        userPreferencesKey="cloud-resources-table"
        query={{
          isArchived: false,
        }}
        onBeforeCreate={(
          item: CloudResource,
          _miscDataProps: JSONObject,
        ): Promise<CloudResource> => {
          /*
           * Ingest looks an environment up by its key
           * ("platform|account|region"), never by name, so a hand-made
           * environment only ever receives telemetry if the key here is
           * built the same way ingest builds it. Provider and the default
           * name derive from the same identity for the same reason: what
           * the user creates must be indistinguishable from what
           * auto-discovery would have created.
           */
          const platform: string = String(item.cloudPlatform || "").trim();
          const accountId: string = String(item.cloudAccountId || "").trim();
          const region: string = String(item.cloudRegion || "").trim();

          item.cloudPlatform = platform;
          /*
           * Optional columns are omitted rather than set to undefined: the
           * Dashboard compiles with exactOptionalPropertyTypes, and the
           * serializer drops absent keys either way.
           */
          if (accountId) {
            item.cloudAccountId = accountId;
          } else {
            delete item.cloudAccountId;
          }
          if (region) {
            item.cloudRegion = region;
          } else {
            delete item.cloudRegion;
          }
          item.resourceIdentifier = buildCloudEnvironmentKey({
            platform,
            accountId,
            region,
          });

          const provider: CloudProvider | null =
            getCloudProviderForPlatform(platform);
          if (provider) {
            item.cloudProvider = provider;
          }

          item.name =
            String(item.name || "").trim() ||
            buildCloudEnvironmentName({ platform, accountId, region });

          return Promise.resolve(item);
        }}
        onCreateSuccess={(item: CloudResource): Promise<CloudResource> => {
          setCount((currentCount: number | null): number => {
            return (currentCount || 0) + 1;
          });
          return Promise.resolve(item);
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        bulkActions={{
          buttons: [...archiveBulkActions],
        }}
        showRefreshButton={true}
        showViewIdButton={true}
        name="Cloud Environments"
        searchableFields={["name", "description"]}
        selectMoreFields={{
          cloudPlatform: true,
          cloudProvider: true,
          cloudRegion: true,
          cloudAccountId: true,
        }}
        cardProps={{
          title: "Cloud Environments",
          description:
            "Managed cloud compute environments auto-discovered from OpenTelemetry — one per cloud.platform + account + region (AWS ECS/Fargate, GCP Cloud Run, Azure Container Apps, Elastic Beanstalk, App Runner). Per-service breakdown lives under Services.",
        }}
        formFields={[
          {
            field: {
              cloudPlatform: true,
            },
            title: "Cloud Platform",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: PLATFORM_DROPDOWN_OPTIONS,
            required: true,
            placeholder: "Select a platform",
            description:
              "The managed compute platform this environment runs on. Must equal the cloud.platform resource attribute your collector reports, or telemetry will never be matched to this environment.",
          },
          {
            field: {
              cloudAccountId: true,
            },
            title: "Cloud Account ID",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "123456789012",
            description:
              "AWS account id, GCP project id or Azure subscription id — exactly as the cloud.account.id resource attribute reports it. Leave blank if your collector does not report one.",
          },
          {
            field: {
              cloudRegion: true,
            },
            title: "Cloud Region",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "us-east-1",
            description:
              "The cloud.region resource attribute, e.g. us-east-1, europe-west1 or eastus. Leave blank if your collector does not report one.",
          },
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "AWS ECS · us-east-1 · 123456789012",
            description:
              "A friendly name for this environment. Auto-discovered environments are named platform · region · account; following the same form keeps the list easy to scan.",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Production ECS cluster for the checkout stack",
          },
          {
            field: {
              labels: true,
            },
            title: "Labels",
            description:
              "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Labels",
          },
        ]}
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
              cloudPlatform: true,
            },
            title: "Cloud Platform",
            type: FieldType.Dropdown,
            filterDropdownOptions: PLATFORM_DROPDOWN_OPTIONS,
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
              cloudRegion: true,
            },
            title: "Cloud Region",
            type: FieldType.Text,
          },
          {
            field: {
              cloudAccountId: true,
            },
            title: "Cloud Account",
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
              const account: string = (item.cloudAccountId as string) || "";
              const name: string = (item.name as string) || "";
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.CLOUD_RESOURCE_VIEW] as Route,
                {
                  modelId: new ObjectID(item._id as string),
                },
              );
              return (
                <div className="min-w-0">
                  <AppLink
                    to={route}
                    className="text-sm font-medium text-gray-900 truncate hover:underline"
                  >
                    {name || "—"}
                  </AppLink>
                  {account && (
                    <div className="text-xs text-gray-500 font-mono truncate">
                      account {account}
                    </div>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              cloudPlatform: true,
            },
            title: "Platform",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: CloudResource): ReactElement => {
              const platform: string = (item.cloudPlatform as string) || "";
              const region: string = (item.cloudRegion as string) || "";
              if (!platform && !region) {
                return <span className="text-sm text-gray-400">—</span>;
              }
              return (
                <div className="text-sm text-gray-700">
                  <span>
                    {platform
                      ? getManagedCloudPlatformLabel(platform)
                      : "unknown"}
                  </span>
                  {region && (
                    <span className="ml-1.5 text-xs text-gray-500 font-mono">
                      {region}
                    </span>
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
              if (!provider) {
                return <span className="text-sm text-gray-400">—</span>;
              }
              return <span className="text-sm text-gray-700">{provider}</span>;
            },
          },
          {
            field: {
              otelCollectorStatus: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: CloudResource): ReactElement => {
              const isConnected: boolean =
                item.otelCollectorStatus === "connected";
              return (
                <Pill
                  text={isConnected ? "Connected" : "Disconnected"}
                  color={isConnected ? Green : Red}
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
        <CloudDocumentationCard
          title="Getting Started with Cloud Environments"
          description="No cloud environments connected yet. Point your OpenTelemetry Collector at OneUptime with a cloud resource detector using the guide below — managed compute appears here automatically once the first telemetry arrives."
        />
      )}
    </Fragment>
  );
};

export default CloudResources;
