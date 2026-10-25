import LabelsElement from "Common/UI/Components/Label/Labels";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import RumApplicationOwnerTeam from "Common/Models/DatabaseModels/RumApplicationOwnerTeam";
import RumApplicationOwnerUser from "Common/Models/DatabaseModels/RumApplicationOwnerUser";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";
import User from "Common/Models/DatabaseModels/User";
import UserElement from "../../Components/User/User";
import AppLink from "../../Components/AppLink/AppLink";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const RumArchivedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { unarchiveBulkActions, unarchiveRowActions } =
    useBulkArchiveActions<RumApplication>({
      modelType: RumApplication,
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
  } = useResourceOwners<RumApplication>({
    persistKey: "rum-archived-table",
    ownerUserModelType: RumApplicationOwnerUser,
    ownerTeamModelType: RumApplicationOwnerTeam,
    resourceIdField: "rumApplicationId",
    showLabelsFacet: true,
  });

  return (
    <Fragment>
      <ModelTable<RumApplication>
        modelType={RumApplication}
        // Unarchive in each row's ⋯ menu, as in Bulk Actions.
        actionButtons={[...unarchiveRowActions]}
        id="rum-archived-table"
        userPreferencesKey="rum-archived-table"
        topContent={filterBar}
        emptyState={facetEmptyState}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({
          isArchived: true,
        })}
        onFetchSuccess={(data: Array<RumApplication>) => {
          onResourcesFetched(data);
        }}
        isDeleteable={true}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        bulkActions={{
          buttons: [...unarchiveBulkActions],
        }}
        name="Archived RUM Applications"
        cardProps={{
          title: "Archived RUM Applications",
          description:
            "RUM applications you have archived. They are hidden from the main list but keep collecting telemetry. Select applications to unarchive them.",
        }}
        showViewIdButton={true}
        noItemsMessage={"No archived applications."}
        showRefreshButton={true}
        /*
         * View opens the resource's own page. The default view route (this
         * list's URL + /<id>) would be ".../archived/<id>", which no route
         * matches, so the user would land on a blank page.
         */
        onViewPage={(item: RumApplication): Promise<Route> => {
          return Promise.resolve(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUM_APPLICATION_VIEW] as Route,
              {
                modelId: new ObjectID(item._id as string),
              },
            ),
          );
        }}
        searchableFields={["name", "description"]}
        selectMoreFields={{
          appIdentifier: true,
        }}
        filters={[]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: RumApplication): ReactElement => {
              const id: string = (item.appIdentifier as string) || "";
              const name: string = (item.name as string) || "";
              const showId: boolean = id !== "" && id !== name;
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.RUM_APPLICATION_VIEW] as Route,
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
                  {showId && (
                    <div className="text-xs text-gray-500 font-mono truncate">
                      {id}
                    </div>
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
            getElement: (item: RumApplication): ReactElement => {
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
            getElement: (item: RumApplication): ReactElement => {
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
            getElement: (item: RumApplication): ReactElement => {
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

export default RumArchivedPage;
