import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import {
  getArchivedAtFilter,
  getArchivedColumns,
} from "../../Components/Archive/ArchivedColumns";
import { STATUS_PAGE_ARCHIVE_COPY } from "../../Components/Archive/ResourceArchiveCopy";
import StatusPageElement from "../../Components/StatusPage/StatusPageElement";
import Label from "Common/Models/DatabaseModels/Label";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
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
  const { unarchiveBulkActions } = useBulkArchiveActions<StatusPage>({
    modelType: StatusPage,
    singularName: STATUS_PAGE_ARCHIVE_COPY.singularName,
    pluralName: STATUS_PAGE_ARCHIVE_COPY.pluralName,
    archiveConfirmMessage: STATUS_PAGE_ARCHIVE_COPY.bulkArchiveConfirmMessage,
    unarchiveConfirmMessage:
      STATUS_PAGE_ARCHIVE_COPY.bulkUnarchiveConfirmMessage,
  });

  return (
    <Fragment>
      <ModelTable<StatusPage>
        modelType={StatusPage}
        id={STATUS_PAGES_ARCHIVED_TABLE_ID}
        userPreferencesKey={STATUS_PAGES_ARCHIVED_TABLE_ID}
        query={{
          isArchived: true,
        }}
        isDeleteable={false}
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
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            filterEntityType: Label,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
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
