import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import {
  getArchivedAtFilter,
  getArchivedColumns,
} from "../../Components/Archive/ArchivedColumns";
import { DASHBOARD_ARCHIVE_COPY } from "../../Components/Archive/ResourceArchiveCopy";
import DashboardElement from "../../Components/Dashboard/DashboardElement";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import DashboardOwnerTeam from "Common/Models/DatabaseModels/DashboardOwnerTeam";
import DashboardOwnerUser from "Common/Models/DatabaseModels/DashboardOwnerUser";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Distinct from the live list's key, so the two tables never share saved
 * column preferences or URL filter state.
 */
export const DASHBOARDS_ARCHIVED_TABLE_ID: string = "dashboards-archived-table";

/**
 * Dashboards that have been archived: hidden from the Dashboards list, and -
 * for public ones - no longer served at their public link, until they are
 * unarchived. Their widgets, branding, domains and public settings are kept,
 * so unarchiving puts a dashboard back exactly as it was.
 */
const DashboardsArchived: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { unarchiveBulkActions, unarchiveRowActions } =
    useBulkArchiveActions<Dashboard>({
      modelType: Dashboard,
      singularName: DASHBOARD_ARCHIVE_COPY.singularName,
      pluralName: DASHBOARD_ARCHIVE_COPY.pluralName,
      archiveConfirmMessage: DASHBOARD_ARCHIVE_COPY.bulkArchiveConfirmMessage,
      unarchiveConfirmMessage:
        DASHBOARD_ARCHIVE_COPY.bulkUnarchiveConfirmMessage,
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
  } = useResourceOwners<Dashboard>({
    persistKey: DASHBOARDS_ARCHIVED_TABLE_ID,
    ownerUserModelType: DashboardOwnerUser,
    ownerTeamModelType: DashboardOwnerTeam,
    resourceIdField: "dashboardId",
    showLabelsFacet: true,
  });

  return (
    <Fragment>
      <ModelTable<Dashboard>
        modelType={Dashboard}
        // Unarchive in each row's ⋯ menu, as in Bulk Actions.
        actionButtons={[...unarchiveRowActions]}
        id={DASHBOARDS_ARCHIVED_TABLE_ID}
        userPreferencesKey={DASHBOARDS_ARCHIVED_TABLE_ID}
        topContent={filterBar}
        emptyState={facetEmptyState}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({
          isArchived: true,
        })}
        onFetchSuccess={(data: Array<Dashboard>) => {
          onResourcesFetched(data);
        }}
        isDeleteable={true}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        showRefreshButton={true}
        showViewIdButton={true}
        bulkActions={{
          buttons: [...unarchiveBulkActions],
        }}
        name={DASHBOARD_ARCHIVE_COPY.archivedPageTitle}
        cardProps={{
          title: DASHBOARD_ARCHIVE_COPY.archivedPageTitle,
          description: DASHBOARD_ARCHIVE_COPY.archivedPageDescription,
        }}
        noItemsMessage={DASHBOARD_ARCHIVE_COPY.noArchivedItemsMessage}
        searchableFields={["name", "description"]}
        sortBy="archivedAt"
        sortOrder={SortOrder.Descending}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          getArchivedAtFilter<Dashboard>(),
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: Dashboard): ReactElement => {
              return <DashboardElement dashboard={item} />;
            },
          },
          {
            field: {
              description: true,
            },
            noValueMessage: "-",
            title: "Description",
            type: FieldType.LongText,
            hideOnMobile: true,
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
            getElement: (item: Dashboard): ReactElement => {
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
            getElement: (item: Dashboard): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
          ...getArchivedColumns<Dashboard>(),
        ]}
        onViewPage={(item: Dashboard): Promise<Route> => {
          // /dashboards/<id>, not this list's URL + /<id>.
          return Promise.resolve(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARD_VIEW] as Route,
              {
                modelId: new ObjectID(item._id as string),
              },
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default DashboardsArchived;
