import LabelsElement from "Common/UI/Components/Label/Labels";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyOwnerTeam from "Common/Models/DatabaseModels/IncomingCallPolicyOwnerTeam";
import IncomingCallPolicyOwnerUser from "Common/Models/DatabaseModels/IncomingCallPolicyOwnerUser";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import Phone from "Common/Types/Phone";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners, {
  ResourceFacet,
  buildBooleanFacetQuery,
} from "../../Components/ResourceOwners/useResourceOwners";
import { FilterOperator } from "../../Components/ResourceOwners/FilterChipDropdown";

const IncomingCallPoliciesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<IncomingCallPolicy>({ modelType: IncomingCallPolicy });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<IncomingCallPolicy>({
      ownerUserModelType: IncomingCallPolicyOwnerUser,
      ownerTeamModelType: IncomingCallPolicyOwnerTeam,
      resourceIdField: "incomingCallPolicyId",
    });

  const incomingCallPolicyExtraFacets: Array<ResourceFacet> = [
    {
      key: "isEnabled",
      label: "Enabled",
      icon: IconProp.Power,
      isMultiSelect: false,
      options: [
        { value: "true", label: "Enabled" },
        { value: "false", label: "Disabled" },
      ],
      supportedOperators: ["is", "is_not"],
      toQueryValue: (
        values: Array<string>,
        operator: FilterOperator,
      ): unknown => {
        return buildBooleanFacetQuery(values, operator);
      },
    },
  ];

  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<IncomingCallPolicy>({
    ownerUserModelType: IncomingCallPolicyOwnerUser,
    ownerTeamModelType: IncomingCallPolicyOwnerTeam,
    resourceIdField: "incomingCallPolicyId",
    showLabelsFacet: true,
    extraFacets: incomingCallPolicyExtraFacets,
  });

  return (
    <Fragment>
      <ModelTable<IncomingCallPolicy>
        modelType={IncomingCallPolicy}
        id="incoming-call-policy-table"
        userPreferencesKey="incoming-call-policy-table"
        topContent={filterBar}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery(undefined)}
        onFetchSuccess={(data: Array<IncomingCallPolicy>) => {
          onResourcesFetched(data);
        }}
        saveFilterProps={{
          tableId: "incoming-call-policies-table",
        }}
        isDeleteable={false}
        name="On-Call > Incoming Call Policies"
        showViewIdButton={true}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        bulkActions={{
          buttons: [...labelBulkActions, ...ownerBulkActions],
        }}
        cardProps={{
          title: "Incoming Call Policies",
          description:
            "Configure incoming call routing policies for your on-call teams. Purchase phone numbers and set up escalation rules.",
        }}
        noItemsMessage={"No incoming call policy found."}
        formSteps={[
          {
            title: "Basic Info",
            id: "basic-info",
          },
          {
            title: "Labels",
            id: "labels",
          },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g., Production Support Hotline",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description of this incoming call policy",
          },
          {
            field: {
              labels: true,
            },
            title: "Labels",
            stepId: "labels",
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
              routingPhoneNumber: true,
            },
            title: "Phone Number",
            type: FieldType.Phone,
            getElement: (item: IncomingCallPolicy): ReactElement => {
              if (item.routingPhoneNumber) {
                return (
                  <div className="flex items-center space-x-2">
                    <Icon
                      icon={IconProp.Call}
                      className="h-4 w-4 text-green-500"
                    />
                    <span className="font-mono">
                      {(item.routingPhoneNumber as Phone).toString()}
                    </span>
                  </div>
                );
              }
              return (
                <div className="flex items-center space-x-2">
                  <Icon
                    icon={IconProp.ExclaimationCircle}
                    className="h-4 w-4 text-yellow-500"
                  />
                  <span className="text-yellow-600 font-medium">
                    Setup Needed
                  </span>
                </div>
              );
            },
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: IncomingCallPolicy): ReactElement => {
              if (item.isEnabled) {
                return <Pill text="Enabled" color={Green} />;
              }
              return <Pill text="Disabled" color={Red} />;
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
            getElement: (item: IncomingCallPolicy): ReactElement => {
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
            getElement: (item: IncomingCallPolicy): ReactElement => {
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

export default IncomingCallPoliciesPage;
