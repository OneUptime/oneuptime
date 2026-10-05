import RuleSettingsPageProps from "../../RuleSettingsPageProps";
import PageMap from "../../../Utils/PageMap";
import RuleViewPageUtil from "../../../Utils/RuleViewPage";
import {
  getOwnerRuleActionFields,
  getOwnerRuleFormSteps,
} from "../../../Utils/Form/ResourceRuleForm";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import RuleTable from "Common/UI/Components/RuleRun/RuleTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import StorageArrayOwnerRule from "Common/Models/DatabaseModels/StorageArrayOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const storageArrayOwnerDocumentation: string = `
### How Storage Array Owner Rules Work

Storage Array Owner Rules add owner users and teams to a storage array automatically when it matches your criteria — without anyone having to remember to assign owners.

### Match Criteria

A rule matches a storage array only when **all** specified criteria pass. Empty criteria are skipped.

- **Storage Array Labels** — any-of (M2M)
- **Name / Description Pattern** — case-insensitive regex

### Action

When a rule matches, every user and team listed on the rule is added as an owner. Already-assigned owners are not duplicated. If \`Notify Owners\` is enabled (default), added owners are notified. Multiple matching rules all fire — the union of their owners ends up assigned.
`;

const StorageArrayOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <RuleTable<StorageArrayOwnerRule>
      modelType={StorageArrayOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, StorageArrayOwnerRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.STORAGE_ARRAYS_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: StorageArrayOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.STORAGE_ARRAYS_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="storageArray-owner-rules-table"
      name="Settings > Storage Array Owner Rules"
      userPreferencesKey="storageArray-owner-rules-table"
      saveFilterProps={{
        tableId: "storage-array-owner-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Storage Array Owner Rules",
        description:
          "Auto-assign owner users and teams when matching storage arrays are created.",
      }}
      helpContent={{
        title: "How Storage Array Owner Rules Work",
        description:
          "Match storage arrays and add owner users/teams automatically.",
        markdown: storageArrayOwnerDocumentation,
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
          getElement: (item: StorageArrayOwnerRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<StorageArrayOwnerRule>()}
      formFields={[
        {
          field: { storageArrayLabels: true },
          title: "Storage Array Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter storage arrays by labels. Leave empty to skip the filter.",
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
        ...getOwnerRuleActionFields<StorageArrayOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default StorageArrayOwnerRulesPage;
