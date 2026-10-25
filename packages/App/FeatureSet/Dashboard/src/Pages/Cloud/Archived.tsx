import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import CloudResourceOwnerTeam from "Common/Models/DatabaseModels/CloudResourceOwnerTeam";
import CloudResourceOwnerUser from "Common/Models/DatabaseModels/CloudResourceOwnerUser";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";
import User from "Common/Models/DatabaseModels/User";
import UserElement from "../../Components/User/User";
import AppLink from "../../Components/AppLink/AppLink";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { getManagedCloudPlatformLabel } from "Common/Types/Cloud/CloudPlatform";
import { getCloudResourceTypeLabel } from "Common/Types/Cloud/CloudResourceCatalog";
import { isCloudResourceKindResource } from "Common/Types/Cloud/CloudResourceKind";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const CloudArchivedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { unarchiveBulkActions, unarchiveRowActions } =
    useBulkArchiveActions<CloudResource>({
      modelType: CloudResource,
    });

  /*
   * The Owner and Labels chips above the table, as on the live list: an
   * archived one can be found by the person or the team that owns it - the
   * server answers the Owner chip in the list's own query - and the Owners
   * column shows who that is.
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
    persistKey: "cloud-archived-table",
    ownerUserModelType: CloudResourceOwnerUser,
    ownerTeamModelType: CloudResourceOwnerTeam,
    resourceIdField: "cloudResourceId",
    showLabelsFacet: true,
  });

  return (
    <Fragment>
      <ModelTable<CloudResource>
        modelType={CloudResource}
        // Unarchive in each row's ⋯ menu, as in Bulk Actions.
        actionButtons={[...unarchiveRowActions]}
        id="cloud-archived-table"
        userPreferencesKey="cloud-archived-table"
        topContent={filterBar}
        emptyState={facetEmptyState}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({
          isArchived: true,
        })}
        onFetchSuccess={(data: Array<CloudResource>) => {
          onResourcesFetched(data);
        }}
        isDeleteable={true}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        bulkActions={{
          buttons: [...unarchiveBulkActions],
        }}
        name="Archived Cloud Environments and Resources"
        cardProps={{
          title: "Archived Cloud Environments and Resources",
          description:
            "Archived cloud environments and resources: hidden from their lists but still collecting telemetry. Select rows to unarchive them.",
        }}
        showViewIdButton={true}
        noItemsMessage={"No archived cloud environments or resources."}
        showRefreshButton={true}
        /*
         * View opens the resource's own page. The default view route (this
         * list's URL + /<id>) would be ".../archived/<id>", which no route
         * matches, so the user would land on a blank page.
         */
        onViewPage={(item: CloudResource): Promise<Route> => {
          return Promise.resolve(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_RESOURCE_VIEW] as Route,
              {
                modelId: new ObjectID(item._id as string),
              },
            ),
          );
        }}
        searchableFields={["name", "description"]}
        selectMoreFields={{
          cloudAccountId: true,
          cloudPlatform: true,
          cloudRegion: true,
          cloudResourceKind: true,
          cloudResourceType: true,
          cloudProvider: true,
          autoArchivedAt: true,
        }}
        filters={[]}
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
            title: "Platform or Type",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: CloudResource): ReactElement => {
              /*
               * An environment by its platform, a resource discovered from
               * cloud monitoring by its type.
               */
              const platform: string = isCloudResourceKindResource(
                item.cloudResourceKind,
              )
                ? getCloudResourceTypeLabel(
                    item.cloudProvider as string | undefined,
                    item.cloudResourceType as string | undefined,
                  )
                : getManagedCloudPlatformLabel(
                    (item.cloudPlatform as string) || "",
                  );
              const region: string = (item.cloudRegion as string) || "";
              if (!platform && !region) {
                return <span className="text-sm text-gray-400">—</span>;
              }
              return (
                <div className="text-sm text-gray-700">
                  <span>{platform || translator.translateText("unknown")}</span>
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
          {
            field: {
              archivedAt: true,
            },
            title: "Archived At",
            type: FieldType.DateTime,
          },
          {
            field: {
              archivedByUser: {
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            title: "Archived By",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: CloudResource): ReactElement => {
              if (!item["archivedByUser"]) {
                // The sweep archives a resource that stopped reporting.
                if (item.autoArchivedAt) {
                  return (
                    <span className="text-sm text-gray-500">
                      {translator.translateText("Automatically")}
                    </span>
                  );
                }
                return <span className="text-gray-400">—</span>;
              }
              return <UserElement user={item["archivedByUser"] as User} />;
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default CloudArchivedPage;
