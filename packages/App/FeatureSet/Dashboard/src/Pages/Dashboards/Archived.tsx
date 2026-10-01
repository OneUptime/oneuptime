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
import Label from "Common/Models/DatabaseModels/Label";
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
  const { unarchiveBulkActions } = useBulkArchiveActions<Dashboard>({
    modelType: Dashboard,
    singularName: DASHBOARD_ARCHIVE_COPY.singularName,
    pluralName: DASHBOARD_ARCHIVE_COPY.pluralName,
    archiveConfirmMessage: DASHBOARD_ARCHIVE_COPY.bulkArchiveConfirmMessage,
    unarchiveConfirmMessage: DASHBOARD_ARCHIVE_COPY.bulkUnarchiveConfirmMessage,
  });

  return (
    <Fragment>
      <ModelTable<Dashboard>
        modelType={Dashboard}
        id={DASHBOARDS_ARCHIVED_TABLE_ID}
        userPreferencesKey={DASHBOARDS_ARCHIVED_TABLE_ID}
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
