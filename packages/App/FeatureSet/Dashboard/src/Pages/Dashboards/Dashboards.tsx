import LabelsElement from "Common/UI/Components/Label/Labels";
import PageComponentProps from "../PageComponentProps";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import {
  DASHBOARD_ARCHIVE_COPY,
  ARCHIVE_INSTEAD_OF_DELETE,
} from "../../Components/Archive/ResourceArchiveCopy";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import DashboardOwnerTeam from "Common/Models/DatabaseModels/DashboardOwnerTeam";
import DashboardOwnerUser from "Common/Models/DatabaseModels/DashboardOwnerUser";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import DashboardElement from "../../Components/Dashboard/DashboardElement";
import CreateDashboardModal from "../../Components/Dashboard/CreateDashboardModal";
import { getDashboardViewRoute } from "../../Components/Dashboard/DashboardCreateForm";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";
import ObjectID from "Common/Types/ObjectID";

/*
 * Create Dashboard opens Create a dashboard (Components/Dashboard/
 * CreateDashboardModal): how to start - from scratch, or from a template
 * picked the way Create a workflow picks one - then a name, filled in from
 * the template. Create opens the new dashboard.
 */
const Dashboards: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<Dashboard>({ modelType: Dashboard });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<Dashboard>({
      ownerUserModelType: DashboardOwnerUser,
      ownerTeamModelType: DashboardOwnerTeam,
      resourceIdField: "dashboardId",
    });

  // Archived dashboards leave this list; they are on the Archived page.
  const { archiveBulkActions, archiveRowActions } =
    useBulkArchiveActions<Dashboard>({
      modelType: Dashboard,
      singularName: DASHBOARD_ARCHIVE_COPY.singularName,
      pluralName: DASHBOARD_ARCHIVE_COPY.pluralName,
      archiveConfirmMessage: DASHBOARD_ARCHIVE_COPY.bulkArchiveConfirmMessage,
      unarchiveConfirmMessage:
        DASHBOARD_ARCHIVE_COPY.bulkUnarchiveConfirmMessage,
    });

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
    persistKey: "all-dashboards-table",
    ownerUserModelType: DashboardOwnerUser,
    ownerTeamModelType: DashboardOwnerTeam,
    resourceIdField: "dashboardId",
    showLabelsFacet: true,
  });

  return (
    <Fragment>
      {showCreateModal ? (
        <CreateDashboardModal
          onClose={() => {
            setShowCreateModal(false);
          }}
          onCreated={(dashboard: Dashboard) => {
            setShowCreateModal(false);

            /*
             * The new dashboard opens: what the template built, or a blank
             * canvas with its Add Widget button - rather than leaving the
             * user on this list to find the new row.
             */
            if (dashboard._id) {
              Navigation.navigate(
                getDashboardViewRoute(new ObjectID(dashboard._id.toString())),
              );
            }
          }}
        />
      ) : (
        <></>
      )}

      <ModelTable<Dashboard>
        modelType={Dashboard}
        // Archive in each row's ⋯ menu, as in Bulk Actions.
        actionButtons={[...archiveRowActions]}
        enableJsonImportExport={true}
        id="dashboard-table"
        userPreferencesKey="dashboards-table"
        topContent={filterBar}
        emptyState={facetEmptyState}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({ isArchived: false })}
        onFetchSuccess={(data: Array<Dashboard>) => {
          onResourcesFetched(data);
        }}
        isDeleteable={true}
        deleteConfirmationWarning={ARCHIVE_INSTEAD_OF_DELETE}
        isEditable={false}
        isCreateable={true}
        /*
         * The built-in create form is replaced by Create a dashboard, which
         * starts with the template picker, as Workflows does. Going through
         * onCreateClick rather than a cardProps button keeps the permission
         * gating on the create button: cardProps buttons are not gated.
         */
        onCreateClick={() => {
          setShowCreateModal(true);
        }}
        bulkActions={{
          buttons: [
            ...labelBulkActions,
            ...ownerBulkActions,
            ...archiveBulkActions,
          ],
        }}
        name="Dashboards"
        isViewable={true}
        cardProps={{
          title: "Dashboards",
          description:
            "Your own views of metrics, logs, traces, monitors and incidents, arranged the way your team wants them. Start from a template or an empty dashboard.",
        }}
        showViewIdButton={true}
        /*
         * No formFields: this table never draws its own form. Creating goes
         * through Create a dashboard above, and a dashboard's name and
         * description are edited on its own Overview.
         */
        saveFilterProps={{
          tableId: "all-dashboards-table",
        }}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        viewPageRoute={Navigation.getCurrentRoute()}
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
              description: true,
            },
            title: "Description",
            type: FieldType.LongText,
          },
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
        ]}
      />
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default Dashboards;
