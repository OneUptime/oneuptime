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
import StorageArrayLabelRule from "Common/Models/DatabaseModels/StorageArrayLabelRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const storageArrayLabelDocumentation: string = `
### How Storage Array Label Rules Work

Storage Array Label Rules attach labels to a storage array automatically when it matches your criteria — so you don't have to remember to tag new storage arrays.

### Match Criteria

A rule matches a storage array only when **all** specified criteria pass. Empty criteria are skipped.

- **Storage Array Labels** (prerequisite) — any-of
- **Name / Description Pattern** — case-insensitive regex

### Action

When a rule matches, every label listed in \`Labels to Add\` is attached to the storage array. Already-attached labels are not duplicated. Multiple matching rules all fire — the union of their labels ends up attached.
`;

const StorageArrayLabelRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <LabelRuleTable<StorageArrayLabelRule>
      modelType={StorageArrayLabelRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, StorageArrayLabelRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.STORAGE_ARRAYS_SETTINGS_LABEL_RULES,
      )}
      getRuleViewRoute={(rule: StorageArrayLabelRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.STORAGE_ARRAYS_SETTINGS_LABEL_RULE_VIEW,
          rule,
        );
      }}
      id="storageArray-label-rules-table"
      name="Settings > Storage Array Label Rules"
      userPreferencesKey="storageArray-label-rules-table"
      saveFilterProps={{
        tableId: "storage-array-label-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Storage Array Label Rules",
        description:
          "Auto-attach labels when matching storage arrays are created.",
      }}
      helpContent={{
        title: "How Storage Array Label Rules Work",
        description: "Match storage arrays and attach labels automatically.",
        markdown: storageArrayLabelDocumentation,
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
          getElement: (item: StorageArrayLabelRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={getLabelRuleFormSteps<StorageArrayLabelRule>()}
      formFields={[
        {
          field: { storageArrayLabels: true },
          title: "Storage Array Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Only trigger for storage arrays that already have at least one of these labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Storage Array Labels (optional)",
        },
        {
          field: { storageArrayNamePattern: true },
          title: "Storage Array Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the storage array name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "prod-.*",
        },
        {
          field: { storageArrayDescriptionPattern: true },
          title: "Storage Array Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        ...getLabelRuleActionFields<StorageArrayLabelRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default StorageArrayLabelRulesPage;
