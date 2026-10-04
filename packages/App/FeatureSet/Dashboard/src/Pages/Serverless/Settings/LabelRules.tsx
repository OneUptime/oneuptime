import RuleSettingsPageProps from "../../RuleSettingsPageProps";
import PageMap from "../../../Utils/PageMap";
import RuleViewPageUtil from "../../../Utils/RuleViewPage";
import {
  getLabelRuleActionFields,
  getLabelRuleFormSteps,
} from "../../../Utils/Form/ResourceRuleForm";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelRuleTable from "Common/UI/Components/LabelRule/LabelRuleTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import ServerlessFunctionLabelRule from "Common/Models/DatabaseModels/ServerlessFunctionLabelRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const ServerlessFunctionLabelRulesPage: FunctionComponent<
  RuleSettingsPageProps
> = (props: RuleSettingsPageProps): ReactElement => {
  return (
    <LabelRuleTable<ServerlessFunctionLabelRule>
      modelType={ServerlessFunctionLabelRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(
        props,
        ServerlessFunctionLabelRule,
      )}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.SERVERLESS_SETTINGS_LABEL_RULES,
      )}
      getRuleViewRoute={(rule: ServerlessFunctionLabelRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.SERVERLESS_SETTINGS_LABEL_RULE_VIEW,
          rule,
        );
      }}
      id="serverless-function-label-rules-table"
      name="Settings > Serverless Function Label Rules"
      userPreferencesKey="serverless-function-label-rules-table"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Serverless Function Label Rules",
        description:
          "Auto-attach labels when matching serverless functions are created.",
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
          getElement: (item: ServerlessFunctionLabelRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={getLabelRuleFormSteps<ServerlessFunctionLabelRule>()}
      formFields={[
        {
          field: { matchLabels: true },
          title: "Function Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Only trigger for functions that already have at least one of these labels. Leave empty to skip the filter.",
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
          title: "Function Name",
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
          title: "Function Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        ...getLabelRuleActionFields<ServerlessFunctionLabelRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default ServerlessFunctionLabelRulesPage;
