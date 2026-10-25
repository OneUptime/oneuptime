import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import LabelsElement from "Common/UI/Components/Label/Labels";
import AppLink from "../../Components/AppLink/AppLink";
import PageComponentProps from "../PageComponentProps";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import ProxmoxClusterOwnerTeam from "Common/Models/DatabaseModels/ProxmoxClusterOwnerTeam";
import ProxmoxClusterOwnerUser from "Common/Models/DatabaseModels/ProxmoxClusterOwnerUser";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";
import User from "Common/Models/DatabaseModels/User";
import UserElement from "../../Components/User/User";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ProxmoxArchivedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { unarchiveBulkActions, unarchiveRowActions } =
    useBulkArchiveActions<ProxmoxCluster>({
      modelType: ProxmoxCluster,
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
  } = useResourceOwners<ProxmoxCluster>({
    persistKey: "proxmox-archived-table",
    ownerUserModelType: ProxmoxClusterOwnerUser,
    ownerTeamModelType: ProxmoxClusterOwnerTeam,
    resourceIdField: "proxmoxClusterId",
    showLabelsFacet: true,
  });

  return (
    <Fragment>
      <ModelTable<ProxmoxCluster>
        modelType={ProxmoxCluster}
        // Unarchive in each row's ⋯ menu, as in Bulk Actions.
        actionButtons={[...unarchiveRowActions]}
        id="proxmox-archived-table"
        userPreferencesKey="proxmox-archived-table"
        topContent={filterBar}
        emptyState={facetEmptyState}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({
          isArchived: true,
        })}
        onFetchSuccess={(data: Array<ProxmoxCluster>) => {
          onResourcesFetched(data);
        }}
        isDeleteable={true}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        bulkActions={{
          buttons: [...unarchiveBulkActions],
        }}
        name="Archived Proxmox Clusters"
        cardProps={{
          title: "Archived Proxmox Clusters",
          description:
            "Clusters you have archived. They are hidden from the main list but keep collecting telemetry. Select clusters to unarchive them.",
        }}
        showViewIdButton={true}
        noItemsMessage={"No archived clusters."}
        showRefreshButton={true}
        /*
         * View opens the resource's own page. The default view route (this
         * list's URL + /<id>) would be ".../archived/<id>", which no route
         * matches, so the user would land on a blank page.
         */
        onViewPage={(item: ProxmoxCluster): Promise<Route> => {
          return Promise.resolve(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROXMOX_CLUSTER_VIEW] as Route,
              {
                modelId: new ObjectID(item._id as string),
              },
            ),
          );
        }}
        searchableFields={["name", "description"]}
        filters={[]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: ProxmoxCluster): ReactElement => {
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.PROXMOX_CLUSTER_VIEW] as Route,
                {
                  modelId: new ObjectID(item._id as string),
                },
              );
              return (
                <AppLink
                  to={route}
                  className="text-sm font-medium text-gray-900 hover:underline"
                >
                  {(item.name as string) || "—"}
                </AppLink>
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
            getElement: (item: ProxmoxCluster): ReactElement => {
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
            getElement: (item: ProxmoxCluster): ReactElement => {
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
            getElement: (item: ProxmoxCluster): ReactElement => {
              if (!item["archivedByUser"]) {
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

export default ProxmoxArchivedPage;
