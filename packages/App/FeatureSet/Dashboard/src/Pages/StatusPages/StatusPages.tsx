import LabelsElement from "Common/UI/Components/Label/Labels";
import PageComponentProps from "../PageComponentProps";
import URL from "Common/Types/API/URL";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { getStatusPageCreateFormFields } from "../../Components/StatusPage/StatusPageCreateForm";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import {
  STATUS_PAGE_ARCHIVE_COPY,
  ARCHIVE_INSTEAD_OF_DELETE,
} from "../../Components/Archive/ResourceArchiveCopy";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageCustomField from "Common/Models/DatabaseModels/StatusPageCustomField";
import useCustomFieldFacets from "../../Components/CustomFields/useCustomFieldFacets";
import StatusPageOwnerTeam from "Common/Models/DatabaseModels/StatusPageOwnerTeam";
import StatusPageOwnerUser from "Common/Models/DatabaseModels/StatusPageOwnerUser";
import { JSONObject } from "Common/Types/JSON";
import { ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY } from "Common/Utils/StatusPage/HistoryChartBarColors";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import StatusPageElement from "../../Components/StatusPage/StatusPageElement";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";

const StatusPages: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<StatusPage>({ modelType: StatusPage });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<StatusPage>({
      ownerUserModelType: StatusPageOwnerUser,
      ownerTeamModelType: StatusPageOwnerTeam,
      resourceIdField: "statusPageId",
    });

  // Archived status pages leave this list; they are on the Archived page.
  const { archiveBulkActions, archiveRowActions } =
    useBulkArchiveActions<StatusPage>({
      modelType: StatusPage,
      singularName: STATUS_PAGE_ARCHIVE_COPY.singularName,
      pluralName: STATUS_PAGE_ARCHIVE_COPY.pluralName,
      archiveConfirmMessage: STATUS_PAGE_ARCHIVE_COPY.bulkArchiveConfirmMessage,
      unarchiveConfirmMessage:
        STATUS_PAGE_ARCHIVE_COPY.bulkUnarchiveConfirmMessage,
    });

  /*
   * One chip per custom field this project has defined. They arrive a render
   * or two late (the definitions are fetched), which is what
   * `areFacetsLoading` below tells the bar.
   */
  const { facets: customFieldFacets, isLoading: areCustomFieldFacetsLoading } =
    useCustomFieldFacets({ customFieldsModelType: StatusPageCustomField });

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
    persistKey: "all-status-pages-table",
    ownerUserModelType: StatusPageOwnerUser,
    ownerTeamModelType: StatusPageOwnerTeam,
    resourceIdField: "statusPageId",
    showLabelsFacet: true,
    extraFacets: customFieldFacets,
    areFacetsLoading: areCustomFieldFacetsLoading,
  });

  /*
   * The name, with the description and the labels under More fields
   * (StatusPageCreateForm.ts). Built once, not on every render.
   */
  const createFormFields: Array<ModelField<StatusPage>> = useMemo((): Array<
    ModelField<StatusPage>
  > => {
    return getStatusPageCreateFormFields();
  }, []);

  return (
    <div>
      <ModelTable<StatusPage>
        topContent={filterBar}
        emptyState={facetEmptyState}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({ isArchived: false })}
        onFetchSuccess={(data: Array<StatusPage>) => {
          onResourcesFetched(data);
        }}
        modelType={StatusPage}
        // Archive in each row's ⋯ menu, as in Bulk Actions.
        actionButtons={[...archiveRowActions]}
        /*
         * A new page starts with the recommended bar color rules: its uptime
         * history grades a day by how long it was down, in colors people
         * with red-green color blindness can tell apart, rather than
         * painting a whole day in the Offline color for a minute of it
         * (issue #486). Only a create that asks gets them.
         */
        onBeforeCreate={(
          item: StatusPage,
          miscDataProps: JSONObject,
        ): Promise<StatusPage> => {
          miscDataProps[ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY] = true;
          return Promise.resolve(item);
        }}
        onCreateSuccess={(
          item: StatusPage,
          modalType?: ModalType,
        ): Promise<StatusPage> => {
          /*
           * A new status page opens on its Overview, which starts with its
           * next step: it shows visitors nothing until monitors are added.
           */
          if (modalType === ModalType.Create && item._id) {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
                { modelId: new ObjectID(item._id.toString()) },
              ),
            );
          }

          return Promise.resolve(item);
        }}
        enableJsonImportExport={true}
        id="status-page-table"
        userPreferencesKey="status-page-table"
        customFieldsModelType={StatusPageCustomField}
        isDeleteable={true}
        deleteConfirmationWarning={ARCHIVE_INSTEAD_OF_DELETE}
        isEditable={false}
        isCreateable={true}
        bulkActions={{
          buttons: [
            ...labelBulkActions,
            ...ownerBulkActions,
            ...archiveBulkActions,
          ],
        }}
        name="Status Pages"
        isViewable={true}
        cardProps={{
          title: "Status Pages",
          description:
            "Status pages show your customers what is working and what is not — live monitor status, incidents and scheduled maintenance, on a page you can make public or private.",
        }}
        videoLink={URL.fromString("https://youtu.be/F6BNipy5VCk")}
        showViewIdButton={true}
        formFields={createFormFields}
        saveFilterProps={{
          tableId: "all-status-pages-table",
        }}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              _id: true,
            },
            title: "Status Page ID",
            type: FieldType.ObjectID,
          },
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
            getElement: (item: StatusPage): ReactElement => {
              return <StatusPageElement statusPage={item} />;
            },
          },
          {
            field: {
              description: true,
            },
            // An empty description is the table's quiet dash, like every cell.
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
        ]}
      />
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </div>
  );
};

export default StatusPages;
