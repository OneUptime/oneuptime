import LabelsElement from "Common/UI/Components/Label/Labels";
import CurrentStatusElement from "../../Components/MonitorGroup/CurrentStatus";
import PageComponentProps from "../PageComponentProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import MonitorGroup from "Common/Models/DatabaseModels/MonitorGroup";
import MonitorGroupOwnerTeam from "Common/Models/DatabaseModels/MonitorGroupOwnerTeam";
import MonitorGroupOwnerUser from "Common/Models/DatabaseModels/MonitorGroupOwnerUser";
import React, { FunctionComponent, ReactElement } from "react";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";

const MonitorGroupPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<MonitorGroup>({ modelType: MonitorGroup });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<MonitorGroup>({
      ownerUserModelType: MonitorGroupOwnerUser,
      ownerTeamModelType: MonitorGroupOwnerTeam,
      resourceIdField: "monitorGroupId",
    });

  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<MonitorGroup>({
    persistKey: "monitor-groups-table",
    ownerUserModelType: MonitorGroupOwnerUser,
    ownerTeamModelType: MonitorGroupOwnerTeam,
    resourceIdField: "monitorGroupId",
    showLabelsFacet: true,
  });

  return (
    <>
      <ModelTable<MonitorGroup>
        modelType={MonitorGroup}
        enableJsonImportExport={true}
        name="Monitor Groups"
        id="monitors-group-table"
        userPreferencesKey="monitor-groups-table"
        topContent={filterBar}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery(undefined)}
        onFetchSuccess={(data: Array<MonitorGroup>) => {
          onResourcesFetched(data);
        }}
        saveFilterProps={{
          tableId: "monitor-groups-table",
        }}
        isDeleteable={false}
        showViewIdButton={true}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        bulkActions={{
          buttons: [...labelBulkActions, ...ownerBulkActions],
        }}
        cardProps={{
          title: "Monitor Groups",
          description: "Here is a list of monitors groups for this project.",
        }}
        noItemsMessage={"No monitor groups found."}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",

            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Monitor Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },

            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description",
          },
        ]}
        viewPageRoute={Navigation.getCurrentRoute()}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Group Name",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Group Name",
            type: FieldType.Text,
          },
          {
            field: {
              _id: true,
            },
            title: "Current Status",
            type: FieldType.Element,
            getElement: (item: MonitorGroup): ReactElement => {
              if (!item["_id"]) {
                throw new BadDataException("Monitor Group ID not found");
              }

              return (
                <CurrentStatusElement
                  monitorGroupId={new ObjectID(item["_id"].toString())}
                />
              );
            },
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

            getElement: (item: MonitorGroup): ReactElement => {
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
            getElement: (item: MonitorGroup): ReactElement => {
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
    </>
  );
};

export default MonitorGroupPage;
