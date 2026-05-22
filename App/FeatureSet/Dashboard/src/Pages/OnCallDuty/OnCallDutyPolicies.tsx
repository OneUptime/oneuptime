import LabelsElement from "Common/UI/Components/Label/Labels";
import PageComponentProps from "../PageComponentProps";
import URL from "Common/Types/API/URL";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyOwnerTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyOwnerTeam";
import OnCallDutyPolicyOwnerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyOwnerUser";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import ResourceFiltersLayout from "../../Components/ResourceOwners/ResourceFiltersLayout";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";

const OnCallDutyPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<OnCallDutyPolicy>({ modelType: OnCallDutyPolicy });

  const {
    ownersByResourceId,
    isLoadingOwners,
    onResourcesFetched,
    facetPanel,
    mergeFiltersIntoQuery,
  } = useResourceOwners<OnCallDutyPolicy>({
    ownerUserModelType: OnCallDutyPolicyOwnerUser,
    ownerTeamModelType: OnCallDutyPolicyOwnerTeam,
    resourceIdField: "onCallDutyPolicyId",
    showLabelsFacet: true,
  });

  return (
    <Fragment>
      <ResourceFiltersLayout facetPanel={facetPanel}>
        <ModelTable<OnCallDutyPolicy>
          modelType={OnCallDutyPolicy}
          id="on-call-duty-table"
          userPreferencesKey="on-call-duty-table"
          query={mergeFiltersIntoQuery(undefined)}
          onFetchSuccess={(data: Array<OnCallDutyPolicy>) => {
            onResourcesFetched(data);
          }}
          saveFilterProps={{
            tableId: "on-call-policies-table",
          }}
          isDeleteable={false}
          name="On-Call > Policies"
          showViewIdButton={true}
          isEditable={false}
          isCreateable={true}
          isViewable={true}
          bulkActions={{
            buttons: [...labelBulkActions],
          }}
          cardProps={{
            title: "On-Call Duty Policies",
            description:
              "Here is a list of on-call-duty policies for this project.",
          }}
          videoLink={URL.fromString("https://youtu.be/HzhKmCryYdc")}
          noItemsMessage={"No on-call policy found."}
          formFields={[
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "On-Call Duty Name",
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
            {
              field: {
                labels: true,
              },
              title: "Labels ",
              description:
                "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
              fieldType: FormFieldSchemaType.MultiSelectDropdown,
              dropdownModal: {
                type: Label,
                labelField: "name",
                valueField: "_id",
              },
              required: false,
              placeholder: "Labels",
            },
          ]}
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
              type: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              noValueMessage: "-",
              title: "Description",
              type: FieldType.LongText,
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

              getElement: (item: OnCallDutyPolicy): ReactElement => {
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
              getElement: (item: OnCallDutyPolicy): ReactElement => {
                const id: string | undefined = item.id?.toString();
                return (
                  <OwnersCell
                    owners={id ? ownersByResourceId[id] : undefined}
                    isLoading={isLoadingOwners}
                  />
                );
              },
            },
          ]}
        />
      </ResourceFiltersLayout>
      {labelBulkActionModals}
    </Fragment>
  );
};

export default OnCallDutyPage;
