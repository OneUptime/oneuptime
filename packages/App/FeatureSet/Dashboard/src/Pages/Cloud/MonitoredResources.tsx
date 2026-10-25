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
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Pill from "Common/UI/Components/Pill/Pill";
import { Gray500, Green } from "Common/Types/BrandColors";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import useFirstRecordWatch, {
  FirstRecordWatch,
} from "../../Components/Infrastructure/UseFirstRecordWatch";
import {
  FIRST_RUN_GUIDE_DESCRIPTION,
  getFirstRunTopContent,
} from "../../Components/Infrastructure/FirstRecordWatch";
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
import CloudConnectCallout from "../../Components/Cloud/Connect/CloudConnectCallout";
import CollapsibleSection from "Common/UI/Components/CollapsibleSection/CollapsibleSection";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Cloud → All Resources: the IaaS and PaaS resources discovered from the
 * metrics a cloud provider's monitoring API publishes about them (Azure
 * Monitor, CloudWatch, Cloud Monitoring), read by an OpenTelemetry
 * Collector (Common/Types/Cloud/CloudMonitoredResource).
 *
 * Every row is ingest's or a cloud connection's: a resource is matched to
 * its metrics by the provider's own identity, which no form could supply,
 * so there is no create button - connecting an account (Cloud, Connect,
 * offered below while the list is empty) is how resources get here. Rows can be renamed, labelled, owned and archived like any
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
  const firstRecordWatch: FirstRecordWatch = useFirstRecordWatch<CloudResource>(
    {
      modelType: CloudResource,
      query: { cloudResourceKind: CloudResourceKind.Resource },
    },
  );

  const { archiveBulkActions, archiveRowActions } =
    useBulkArchiveActions<CloudResource>({
      modelType: CloudResource,
    });

  /*
   * Labels and owners in Bulk Actions, as on every other resource list:
   * the list shows and filters a resource by them, and they were set
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
   * The Owner and Labels chips above the table: a resource can be found by the
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
    persistKey: "cloud-monitored-resources-table",
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

  return (
    <Fragment>
      <ModelTable<CloudResource>
        modelType={CloudResource}
        // Archive in each row's ⋯ menu, as in Bulk Actions.
        actionButtons={[...archiveRowActions]}
        refreshToggle={firstRecordWatch.refreshToken}
        id="cloud-monitored-resources-table"
        userPreferencesKey="cloud-monitored-resources-table"
        topContent={getFirstRunTopContent({
          topContent: filterBar,
          count: firstRecordWatch.count,
        })}
        emptyState={facetEmptyState}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({
          isArchived: false,
          cloudResourceKind: CloudResourceKind.Resource,
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
            "Virtual machines, load balancers, buckets, databases and more, from your connected cloud accounts and your cloud's metrics.",
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
      {/*
       * The way in while the list is empty: connect a cloud account (no
       * collector to run), or - folded - send the provider's metrics from
       * an OpenTelemetry Collector of your own.
       */}
      {firstRecordWatch.count === 0 && (
        <div className="space-y-4">
          <CloudConnectCallout />
          <CollapsibleSection
            title="Already run an OpenTelemetry Collector?"
            collapsedDescription={translationKey(
              "Send your cloud's metrics through it instead: the steps for Azure Monitor, CloudWatch and Cloud Monitoring.",
            )}
            defaultCollapsed={true}
          >
            <CloudMonitoringDocumentationCard
              title="Discover your cloud resources"
              description={FIRST_RUN_GUIDE_DESCRIPTION}
            />
          </CollapsibleSection>
        </div>
      )}
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default CloudMonitoredResources;
