import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ServerlessFunctionOwnerRule from "Common/Models/DatabaseModels/ServerlessFunctionOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import ProjectUser from "../../../Utils/ProjectUser";
import ProjectUtil from "Common/UI/Utils/Project";

const ServerlessFunctionOwnerRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <ModelTable<ServerlessFunctionOwnerRule>
      modelType={ServerlessFunctionOwnerRule}
      id="serverless-function-owner-rules-table"
      name="Settings > Serverless Function Owner Rules"
      userPreferencesKey="serverless-function-owner-rules-table"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Serverless Function Owner Rules",
        description:
          "Auto-assign owners when matching serverless functions are created.",
      }}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      selectMoreFields={{ isEnabled: true }}
      filters={[
        { field: { name: true }, title: "Name", type: FieldType.Text },
        {
          field: { isEnabled: true },
          title: "Enabled",
          type: FieldType.Boolean,
        },
      ]}
      columns={[
        { field: { name: true }, title: "Name", type: FieldType.Text },
        {
          field: { description: true },
          title: "Description",
          type: FieldType.Text,
        },
        {
          field: { isEnabled: true },
          title: "Status",
          type: FieldType.Boolean,
          getElement: (item: ServerlessFunctionOwnerRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      viewPageRoute={Navigation.getCurrentRoute()}
      formSteps={[
        { title: "Basic Info", id: "basic-info" },
        { title: "Match Criteria", id: "match-criteria", columns: 2 },
        { title: "Owners", id: "owners", columns: 2 },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Assign team to matching functions",
          validation: { minLength: 2 },
        },
        {
          field: { description: true },
          title: "Description",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description: "Enable or disable this rule.",
        },
        {
          field: { notifyOwners: true },
          title: "Notify Owners",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description:
            "Notify owners when they are added by this rule. Disable to add silently.",
        },
        {
          field: { matchLabels: true },
          title: "Match Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter functions by labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Labels (optional)",
        },
        {
          field: { nameRegexPattern: true },
          title: "Name Regex Pattern",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the function name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "payment-.*",
        },
        {
          field: { descriptionRegexPattern: true },
          title: "Description Regex Pattern",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        {
          field: { ownerTeams: true },
          title: "Owner Teams",
          stepId: "owners",
          sectionTitle: "Owners to Assign",
          sectionDescription:
            "When this rule matches, every selected user and team is added as an owner. Already-assigned owners are not duplicated.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Team,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Teams",
        },
        {
          field: { ownerUsers: true },
          title: "Owner Users",
          stepId: "owners",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          fetchDropdownOptions: async () => {
            return await ProjectUser.fetchProjectUsersAsDropdownOptions(
              ProjectUtil.getCurrentProjectId()!,
            );
          },
          required: false,
          placeholder: "Select Users",
        },
      ]}
      showRefreshButton={true}
    />
  );
};

export default ServerlessFunctionOwnerRulesPage;
