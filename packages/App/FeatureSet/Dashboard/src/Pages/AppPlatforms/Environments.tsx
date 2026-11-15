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
import { Gray500, Green, Red } from "Common/Types/BrandColors";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import useFirstRecordWatch, {
  FirstRecordWatch,
} from "../../Components/Infrastructure/UseFirstRecordWatch";
import {
  getFirstRunEmptyState,
  getFirstRunTopContent,
} from "../../Components/Infrastructure/FirstRecordWatch";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import {
  MANAGED_CLOUD_PLATFORMS,
  ManagedCloudPlatformDescriptor,
  getManagedCloudPlatformLabel,
} from "Common/Types/Cloud/CloudPlatform";
import AddResourceModal from "../../Components/ResourceOnboarding/AddResourceModal";
import CLOUD_ENVIRONMENT_ONBOARDING from "../../Components/Cloud/CloudEnvironmentOnboarding";
import { getCloudProviderOptions } from "../../Components/Cloud/CloudProviderOptions";
import ResourceShowcaseCard from "../../Components/ResourceShowcase/ResourceShowcaseCard";
import CLOUD_ENVIRONMENT_SHOWCASE from "../../Components/Cloud/CloudEnvironmentShowcase";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  APP_PLATFORMS_ENVIRONMENTS_TABLE_ID,
  getEnvironmentsCloudAccountFacet,
} from "../../Components/AppPlatforms/AppPlatformsAccountFacet";
import { fetchEnvironmentCloudAccountOptions } from "../../Components/AppPlatforms/AppPlatformsAccountOptions";

/*
 * Options for the Platform filter. The label carries the raw cloud.platform
 * value in brackets because that string is what the user has to find in
 * their collector's resource attributes to confirm they picked the right
 * one. The clouds' product names and their values, as written in every
 * language (DropdownOption.isUserContent).
 */
const PLATFORM_DROPDOWN_OPTIONS: Array<DropdownOption> =
  MANAGED_CLOUD_PLATFORMS.map(
    (descriptor: ManagedCloudPlatformDescriptor): DropdownOption => {
      return {
        label: `${descriptor.productName} (${descriptor.platform})`,
        value: descriptor.platform,
        isUserContent: true,
      };
    },
  );

const PROVIDER_DROPDOWN_OPTIONS: Array<DropdownOption> =
  getCloudProviderOptions();

/*
 * App Platforms > All Environments: one row per platform, account and
 * region an app reported from. How they are doing together - how many are
 * reporting, how many instances are live - is on the product's Overview.
 */
const AppPlatformEnvironments: FunctionComponent<
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
   * The Owner, Labels and Cloud Account chips above the table: an
   * environment can be found by the person or the team that owns it - the
   * server answers the Owner chip in the list's own query - and the Owners
   * column shows who that is; or by the account it runs in, which is how
   * Cloud's Overview links here to the environments of the accounts it
   * reads (AppPlatformsAccountFacet).
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
    persistKey: APP_PLATFORMS_ENVIRONMENTS_TABLE_ID,
    ownerUserModelType: CloudResourceOwnerUser,
    ownerTeamModelType: CloudResourceOwnerTeam,
    resourceIdField: "cloudResourceId",
    showLabelsFacet: true,
    extraFacets: [
      getEnvironmentsCloudAccountFacet(fetchEnvironmentCloudAccountOptions),
    ],
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
        id={APP_PLATFORMS_ENVIRONMENTS_TABLE_ID}
        userPreferencesKey={APP_PLATFORMS_ENVIRONMENTS_TABLE_ID}
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
        // The model's nouns are Cloud's (cloud resources): these are environments.
        singularName="Cloud Environment"
        pluralName="Cloud Environments"
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
            /*
             * The name alone: ingest names an environment after its
             * platform, region and account ("AWS ECS · us-east-1 ·
             * 123456789012"), so a line of its account under it, and its
             * region beside the platform, only said them again - and at
             * 1280 beside the side menu pushed Last Seen behind the row's
             * buttons. The account stays a filter.
             */
            getElement: (item: CloudResource): ReactElement => {
              const name: string = (item.name as string) || "";
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW] as Route,
                {
                  modelId: new ObjectID(item._id as string),
                },
              );
              return (
                <div className="min-w-0">
                  <AppLink
                    to={route}
                    className="break-words text-sm font-medium text-gray-900 hover:underline"
                  >
                    {name || "—"}
                  </AppLink>
                </div>
              );
            },
          },
          /*
           * The platform says whose it is ("AWS ECS", "Azure App Service"),
           * so the list has no Provider column of its own: at 1280 it pushed
           * Status under the row's buttons. The Provider filter stays.
           */
          {
            field: {
              cloudPlatform: true,
            },
            title: "Platform",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: CloudResource): ReactElement => {
              const platform: string = (item.cloudPlatform as string) || "";
              if (!platform) {
                return (
                  <span className="text-sm text-gray-400">
                    {translator.translateText("unknown")}
                  </span>
                );
              }
              return (
                <span className="text-sm text-gray-700">
                  {getManagedCloudPlatformLabel(platform)}
                </span>
              );
            },
          },
          {
            field: {
              otelCollectorStatus: true,
            },
            title: "Status",
            type: FieldType.Element,
            /*
             * One that has never sent anything is Waiting, in grey, as its
             * platform reads on the Overview: nothing broke yet.
             */
            getElement: (item: CloudResource): ReactElement => {
              const isConnected: boolean =
                item.otelCollectorStatus === "connected";
              const isWaiting: boolean = !isConnected && !item.lastSeenAt;
              return (
                <Pill
                  text={
                    isConnected
                      ? "Connected"
                      : isWaiting
                        ? "Waiting"
                        : "Disconnected"
                  }
                  color={isConnected ? Green : isWaiting ? Gray500 : Red}
                  tooltip={
                    isWaiting
                      ? translator.translateText("Waiting for its first data")
                      : undefined
                  }
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
            // Under the name, with the owners, where the list folds.
            hideBelowLargeScreen: true,
            foldInto: "name",
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
            // Under the name, where the list folds (Labels).
            hideBelowLargeScreen: true,
            foldInto: "name",
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
                RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW] as Route,
                {
                  modelId: item._id,
                },
              ).toString(),
            ),
          );
        }}
      />
      {firstRecordWatch.count === 0 && (
        <ResourceShowcaseCard
          showcase={CLOUD_ENVIRONMENT_SHOWCASE}
          addButton={{
            title: CLOUD_ENVIRONMENT_ONBOARDING.addTitle,
            onClick: () => {
              setIsAddEnvironmentOpen(true);
            },
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
            // The showcase gives way, and the table reads the new environment.
            firstRecordWatch.onRecordCreated();
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

export default AppPlatformEnvironments;
