import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import {
  getArchivedAtFilter,
  getArchivedColumns,
} from "../../Components/Archive/ArchivedColumns";
import { STATUS_PAGE_ARCHIVE_COPY } from "../../Components/Archive/ResourceArchiveCopy";
import StatusPageElement from "../../Components/StatusPage/StatusPageElement";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageOwnerTeam from "Common/Models/DatabaseModels/StatusPageOwnerTeam";
import StatusPageOwnerUser from "Common/Models/DatabaseModels/StatusPageOwnerUser";
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
export const STATUS_PAGES_ARCHIVED_TABLE_ID: string =
  "status-pages-archived-table";

/**
 * Status pages that have been archived: offline (visitors get "page not
 * found"), sending nothing to their subscribers, and hidden from the Status
 * Pages list until they are unarchived. Their settings, resources and
 * subscribers are all kept, so unarchiving puts a page back exactly as it was.
 */
const StatusPagesArchived: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { unarchiveBulkActions, unarchiveRowActions } =
    useBulkArchiveActions<StatusPage>({
      modelType: StatusPage,
      singularName: STATUS_PAGE_ARCHIVE_COPY.singularName,
      pluralName: STATUS_PAGE_ARCHIVE_COPY.pluralName,
      archiveConfirmMessage: STATUS_PAGE_ARCHIVE_COPY.bulkArchiveConfirmMessage,
      unarchiveConfirmMessage:
        STATUS_PAGE_ARCHIVE_COPY.bulkUnarchiveConfirmMessage,
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
  } = useResourceOwners<StatusPage>({
    persistKey: STATUS_PAGES_ARCHIVED_TABLE_ID,
    ownerUserModelType: StatusPageOwnerUser,
    ownerTeamModelType: StatusPageOwnerTeam,
    resourceIdField: "statusPageId",
    showLabelsFacet: true,
  });

  return (
    <Fragment>
      <ModelTable<StatusPage>
        modelType={StatusPage}
        // Unarchive in each row's ⋯ menu, as in Bulk Actions.
        actionButtons={[...unarchiveRowActions]}
        id={STATUS_PAGES_ARCHIVED_TABLE_ID}
        userPreferencesKey={STATUS_PAGES_ARCHIVED_TABLE_ID}
        topContent={filterBar}
        emptyState={facetEmptyState}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({
          isArchived: true,
        })}
        onFetchSuccess={(data: Array<StatusPage>) => {
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
        name={STATUS_PAGE_ARCHIVE_COPY.archivedPageTitle}
        cardProps={{
          title: STATUS_PAGE_ARCHIVE_COPY.archivedPageTitle,
          description: STATUS_PAGE_ARCHIVE_COPY.archivedPageDescription,
        }}
        noItemsMessage={STATUS_PAGE_ARCHIVE_COPY.noArchivedItemsMessage}
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
          getArchivedAtFilter<StatusPage>(),
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: StatusPage): ReactElement => {
              return <StatusPageElement statusPage={item} />;
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
            getElement: (item: StatusPage): ReactElement => {
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
            getElement: (item: StatusPage): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
          ...getArchivedColumns<StatusPage>(),
        ]}
        onViewPage={(item: StatusPage): Promise<Route> => {
          // /status-pages/<id>, not this list's URL + /<id>.
          return Promise.resolve(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
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

export default StatusPagesArchived;
