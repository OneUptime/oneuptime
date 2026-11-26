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
import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
import XcpNgPoolOwnerTeam from "Common/Models/DatabaseModels/XcpNgPoolOwnerTeam";
import XcpNgPoolOwnerUser from "Common/Models/DatabaseModels/XcpNgPoolOwnerUser";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";
import User from "Common/Models/DatabaseModels/User";
import UserElement from "../../Components/User/User";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";

const XcpNgArchivedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { unarchiveBulkActions, unarchiveRowActions } =
    useBulkArchiveActions<XcpNgPool>({
      modelType: XcpNgPool,
    });

  /*
   * The Owner and Labels chips above the table, as on the live list: an
   * archived pool can be found by the person or the team that owns it - the
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
  } = useResourceOwners<XcpNgPool>({
    persistKey: "xcp-ng-pools-archived-table",
    ownerUserModelType: XcpNgPoolOwnerUser,
    ownerTeamModelType: XcpNgPoolOwnerTeam,
    resourceIdField: "xcpNgPoolId",
    showLabelsFacet: true,
  });

  return (
    <Fragment>
      <ModelTable<XcpNgPool>
        modelType={XcpNgPool}
        // Unarchive in each row's ⋯ menu, as in Bulk Actions.
        actionButtons={[...unarchiveRowActions]}
        id="xcp-ng-pools-archived-table"
        userPreferencesKey="xcp-ng-pools-archived-table"
        topContent={filterBar}
        emptyState={facetEmptyState}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({
          isArchived: true,
        })}
        onFetchSuccess={(data: Array<XcpNgPool>) => {
          onResourcesFetched(data);
        }}
        isDeleteable={true}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        bulkActions={{
          buttons: [...unarchiveBulkActions],
        }}
        name="Archived XCP-ng Pools"
        cardProps={{
          title: "Archived XCP-ng Pools",
          description:
            "Pools you have archived. They are hidden from the main list but keep collecting telemetry. Select pools to unarchive them.",
        }}
        showViewIdButton={true}
        noItemsMessage={"No archived pools."}
        showRefreshButton={true}
        /*
         * View opens the pool's own page. The default view route (this
         * list's URL + /<id>) would be ".../archived/<id>", which no route
         * matches, so the user would land on a blank page.
         */
        onViewPage={(item: XcpNgPool): Promise<Route> => {
          return Promise.resolve(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.XCP_NG_POOL_VIEW] as Route,
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
            getElement: (item: XcpNgPool): ReactElement => {
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.XCP_NG_POOL_VIEW] as Route,
                {
                  modelId: new ObjectID(item._id as string),
                },
              );
              return (
                <AppLink
                  to={route}
                  className="text-sm font-medium text-gray-900 hover:underline"
                >
                  {(item.name as string) || <TableEmptyValue />}
                </AppLink>
              );
            },
          },
          {
            field: {
              xenOrchestraName: true,
            },
            title: "Xen Orchestra",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: XcpNgPool): ReactElement => {
              if (!item.xenOrchestraName) {
                return <TableEmptyValue />;
              }
              return (
                <span className="text-sm text-gray-700">
                  {item.xenOrchestraName}
                </span>
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
            getElement: (item: XcpNgPool): ReactElement => {
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
            getElement: (item: XcpNgPool): ReactElement => {
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
            getElement: (item: XcpNgPool): ReactElement => {
              if (!item["archivedByUser"]) {
                return <TableEmptyValue />;
              }
              return <UserElement user={item["archivedByUser"] as User} />;
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default XcpNgArchivedPage;
