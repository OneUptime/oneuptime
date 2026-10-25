import PageMap from "../../Utils/PageMap";
import { ARCHIVE_INSTEAD_OF_DELETE } from "../../Components/Archive/ResourceArchiveCopy";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import CloudResourceOwnerTeam from "Common/Models/DatabaseModels/CloudResourceOwnerTeam";
import CloudResourceOwnerUser from "Common/Models/DatabaseModels/CloudResourceOwnerUser";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import useFirstRecordWatch, {
  FirstRecordWatch,
} from "../../Components/Infrastructure/UseFirstRecordWatch";
import {
  FIRST_RUN_GUIDE_DESCRIPTION,
  getFirstRunEmptyState,
  getFirstRunTopContent,
} from "../../Components/Infrastructure/FirstRecordWatch";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import {
  CLOUD_PROVIDER_LABELS,
  CloudProvider,
  MANAGED_CLOUD_PLATFORMS,
  ManagedCloudPlatformDescriptor,
  getCloudProviderLabel,
  getManagedCloudPlatformLabel,
} from "Common/Types/Cloud/CloudPlatform";
import AddResourceGuide from "../../Components/ResourceOnboarding/AddResourceGuide";
import AddResourceModal from "../../Components/ResourceOnboarding/AddResourceModal";
import CLOUD_ENVIRONMENT_ONBOARDING from "../../Components/Cloud/CloudEnvironmentOnboarding";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import CloudFleetSummary from "../../Components/Cloud/CloudFleetSummary";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * Options for the Platform filter. The label carries the raw cloud.platform
 * value in brackets because that string is what the user has to find in
 * their collector's resource attributes to confirm they picked the right
 * one.
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
  const translator: Translator = useTranslator();
  const firstRecordWatch: FirstRecordWatch = useFirstRecordWatch<CloudResource>(
    {
      modelType: CloudResource,
      query: { cloudResourceKind: CloudResourceKind.Environment },
    },
  );
  const [isAddEnvironmentOpen, setIsAddEnvironmentOpen] =
    useState<boolean>(false);
  // Environments connected from the Add dialog show in the list at once.
  const [connectedCount, setConnectedCount] = useState<number>(0);

  const { archiveBulkActions, archiveRowActions } =
    useBulkArchiveActions<CloudResource>({
      modelType: CloudResource,
    });

  /*
   * Labels and owners in Bulk Actions, as on every other resource list:
   * the list shows and filters an environment by them, and they were set
   * one at a time.
   */
  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<CloudResource>({ modelType: CloudResource });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<CloudResource>({
      ownerUserModelType: CloudResourceOwnerUser,
      ownerTeamModelType: CloudResourceOwnerTeam,
      resourceIdField: "cloudResourceId",
    });

  /*
   * The Owner and Labels chips above the table: an environment can be found by the
   * person or the team that owns it - the server answers the Owner chip in
   * the list's own query - and the Owners column shows who that is.
   */
  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    emptyState: facetEmptyState,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<CloudResource>({
    persistKey: "cloud-resources-table",
    ownerUserModelType: CloudResourceOwnerUser,
    ownerTeamModelType: CloudResourceOwnerTeam,
    resourceIdField: "cloudResourceId",
    showLabelsFacet: true,
  });

  if (firstRecordWatch.error) {
    return (
      <ErrorMessage
        message={firstRecordWatch.error}
        onRefreshClick={firstRecordWatch.retry}
      />
    );
  }

  if (firstRecordWatch.isLoading) {
    return <PageLoader isVisible={true} />;
  }

  /*
   * An environment is added by pointing an app's OpenTelemetry at
   * OneUptime with a cloud resource detector (Add Cloud Environment): it
   * registers itself under its platform, account and region when its first
   * data arrives, and the guide's last step says so. There is no form: an
   * environment typed in by hand would only wait for telemetry that
   * nothing sends.
   */
  return (
    <Fragment>
      <CloudFleetSummary refreshToken={firstRecordWatch.count} />
      <ModelTable<CloudResource>
        modelType={CloudResource}
        // Archive in each row's ⋯ menu, as in Bulk Actions.
        actionButtons={[...archiveRowActions]}
        refreshToggle={`${firstRecordWatch.refreshToken}-${connectedCount}`}
        topContent={getFirstRunTopContent({
          topContent: filterBar,
          count: firstRecordWatch.count,
        })}
        emptyState={getFirstRunEmptyState({
          emptyState: facetEmptyState,
          count: firstRecordWatch.count,
        })}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        id="cloud-resources-table"
        userPreferencesKey="cloud-resources-table"
        // The list is of environments: not the model's "No cloud resources yet".
        noItemsMessage="No cloud environments yet."
        query={mergeFiltersIntoQuery({
          isArchived: false,
          /*
           * The resources discovered from cloud monitoring share the table
           * and have a list of their own (MonitoredResources).
           */
          cloudResourceKind: CloudResourceKind.Environment,
        })}
        onFetchSuccess={(data: Array<CloudResource>) => {
          onResourcesFetched(data);
        }}
        isDeleteable={true}
        deleteConfirmationWarning={ARCHIVE_INSTEAD_OF_DELETE}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        bulkActions={{
          buttons: [
            ...labelBulkActions,
            ...ownerBulkActions,
            ...archiveBulkActions,
          ],
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
            "Managed compute environments discovered from OpenTelemetry, one per platform, account and region, such as AWS ECS or Google Cloud Run.",
          buttons: [
            {
              title: CLOUD_ENVIRONMENT_ONBOARDING.addTitle,
              icon: IconProp.Add,
              buttonStyle: ButtonStyleType.NORMAL,
              onClick: () => {
                setIsAddEnvironmentOpen(true);
              },
            },
          ],
        }}
        formFields={[]}
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
                      {translator.translateTemplate("account {{account}}", {
                        account: account,
                      })}
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
                      : translator.translateText("unknown")}
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
          {
            field: {
              _id: true,
            },
            title: "Owners",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: CloudResource): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
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
      {firstRecordWatch.count === 0 && (
        <AddResourceGuide
          onboarding={CLOUD_ENVIRONMENT_ONBOARDING}
          title={CLOUD_ENVIRONMENT_ONBOARDING.firstRunTitle}
          description={FIRST_RUN_GUIDE_DESCRIPTION}
          onConnected={() => {
            // The guide gives way, and the table reads the new environment.
            firstRecordWatch.onRecordCreated();
            setConnectedCount((count: number): number => {
              return count + 1;
            });
          }}
        />
      )}
      {isAddEnvironmentOpen && (
        <AddResourceModal
          onboarding={CLOUD_ENVIRONMENT_ONBOARDING}
          onClose={() => {
            setIsAddEnvironmentOpen(false);
          }}
          onConnected={() => {
            setConnectedCount((count: number): number => {
              return count + 1;
            });
          }}
        />
      )}
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default CloudResources;
