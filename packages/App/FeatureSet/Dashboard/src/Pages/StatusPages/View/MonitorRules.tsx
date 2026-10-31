import RuleSettingsPageProps from "../../RuleSettingsPageProps";
import PageMap from "../../../Utils/PageMap";
import RuleViewPageUtil from "../../../Utils/RuleViewPage";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import { Green, Red } from "Common/Types/BrandColors";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import RuleTable from "Common/UI/Components/RuleRun/RuleTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import Label from "Common/Models/DatabaseModels/Label";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageMonitorRule from "Common/Models/DatabaseModels/StatusPageMonitorRule";
import StatusPageGroupTreeUtil from "Common/Utils/StatusPage/GroupTree";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { RULE_NAME_MAX_LENGTH } from "../../../Utils/Form/ResourceRuleForm";
import StatusPageMonitorRuleCopy, {
  followGroupWithRuleName,
  getStatusPageMonitorRuleName,
} from "../../../Components/StatusPage/StatusPageMonitorRuleForm";

const monitorRuleDocumentation: string = `
### How Status Page Monitor Rules Work

A monitor rule adds monitors to this status page for you. Instead of picking every monitor by hand and typing a display name for each, describe the monitors once and every monitor that matches shows up in the group you chose.

### Match Criteria

A monitor has to pass **all** the criteria you fill in. Criteria you leave empty are skipped.

- **Monitor Labels** — matches a monitor carrying *any one* of the labels you select.
- **Monitor Name Pattern** — matched against the monitor name.
- **Monitor Description Pattern** — matched against the monitor description.

Patterns take either syntax, the same as network device rules: a case-insensitive regular expression (\`^api-.*\`) or a \`*\` wildcard (\`*checkout*\`). A pattern that is neither — \`api-(01\` — is rejected when you save, rather than silently matching nothing.

At least one criterion is required. Use \`.*\` as the name pattern if you really do want every monitor in the project.

### When Rules Run

- When you create or edit a rule, it runs immediately against every monitor that already exists.
- When a monitor is created, or its labels, name or description change, every rule on every status page in the project is re-evaluated for it.

### What Rules Own

A rule only ever removes resources it added itself. A monitor you added to this page by hand is never touched — it is not adopted into a rule when it happens to match, and it is not removed when it stops matching or when the rule is deleted.

Disabling or deleting a rule removes the resources that rule added, and leaves everything else alone. A monitor that is already on the page is never added a second time, so rules and manual resources cannot produce duplicates.
`;

/*
 * More fields, folded at the end of the Group step, where the monitors land:
 * how each monitor a rule adds is shown - the same options a monitor added
 * by hand has, at the rule's own defaults (StatusPageMonitorRule turns
 * uptime on, where a hand-added resource leaves it off) - and the rule's
 * description, which most rules leave empty.
 */
const advancedSection: FormFieldCollapsibleSection<StatusPageMonitorRule> =
  getAdvancedFormSection<StatusPageMonitorRule>();

const StatusPageMonitorRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const viewRuleId: ObjectID | undefined = RuleViewPageUtil.getViewRuleId(
    props,
    StatusPageMonitorRule,
  );

  /*
   * The status page is the route's model id. On a rule's view page the rule
   * id is the last URL segment, so the status page id is the one before it.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(
    props.ruleViewModelType ? 2 : 1,
  );

  /*
   * Groups nest, so the picker shows the full path - two groups can easily be
   * called "Region 1000" at different levels. Fetched every time the form
   * opens so a group added a moment ago is immediately selectable.
   */
  const fetchGroupOptions: () => Promise<
    Array<DropdownOption>
  > = async (): Promise<Array<DropdownOption>> => {
    const listResult: ListResult<StatusPageGroup> =
      await ModelAPI.getList<StatusPageGroup>({
        modelType: StatusPageGroup,
        query: {
          statusPageId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          name: true,
          order: true,
          parentStatusPageGroupId: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        requestOptions: {},
      });

    const allGroups: Array<StatusPageGroup> = listResult.data;

    return allGroups.map((group: StatusPageGroup) => {
      const path: Array<string> = StatusPageGroupTreeUtil.getAncestorGroups({
        statusPageGroup: group,
        statusPageGroups: allGroups,
      })
        .reverse()
        .map((ancestor: StatusPageGroup) => {
          return ancestor.name || "";
        });

      return {
        value: group._id?.toString() || "",
        label: [...path, group.name || ""].join(" › "),
      };
    });
  };

  return (
    <Fragment>
      <RuleTable<StatusPageMonitorRule>
        modelType={StatusPageMonitorRule}
        viewRuleId={viewRuleId}
        listRoute={RuleViewPageUtil.getListRoute(
          PageMap.STATUS_PAGE_VIEW_MONITOR_RULES,
          modelId,
        )}
        getRuleViewRoute={(rule: StatusPageMonitorRule): Route => {
          return RuleViewPageUtil.getRuleViewRoute(
            PageMap.STATUS_PAGE_VIEW_MONITOR_RULE_VIEW,
            rule,
            modelId,
          );
        }}
        id="status-page-monitor-rules-table"
        name="Status Page > Monitor Rules"
        /*
         * On a status page's own Monitor Rules page the rows are its monitor
         * rules: "Create Monitor Rule", not "Create Status Page Monitor Rule".
         */
        singularName={StatusPageMonitorRuleCopy.singularName}
        pluralName={StatusPageMonitorRuleCopy.pluralName}
        userPreferencesKey="status-page-monitor-rules-table"
        saveFilterProps={{
          tableId: "status-page-monitor-rules-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        createEditModalWidth={ModalWidth.Large}
        query={{
          statusPageId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: StatusPageMonitorRule,
        ): Promise<StatusPageMonitorRule> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.statusPageId = modelId;
          item.projectId = new ObjectID(props.currentProject._id);
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Monitor Rules",
          description:
            "Add monitors to this status page by matching them, instead of picking each one by hand. Every monitor that matches a rule is added to the group the rule names.",
        }}
        helpContent={{
          title: "How Status Page Monitor Rules Work",
          description:
            "Match monitors by label or pattern and add them to a group automatically.",
          markdown: monitorRuleDocumentation,
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
            field: {
              statusPageGroup: {
                name: true,
              },
            },
            title: "Adds Monitors To",
            type: FieldType.Text,
            getElement: (item: StatusPageMonitorRule): ReactElement => {
              return (
                <span>
                  {item.statusPageGroup?.name ||
                    translator.translateText("Top of page")}
                </span>
              );
            },
          },
          {
            field: { isEnabled: true },
            title: "Status",
            /*
             * An element, not a Boolean: a phone's card leaves out a Boolean
             * that is off, so a disabled rule showed no status at all.
             */
            type: FieldType.Element,
            getElement: (item: StatusPageMonitorRule): ReactElement => {
              return item.isEnabled ? (
                <Pill color={Green} text="Enabled" />
              ) : (
                <Pill color={Red} text="Disabled" />
              );
            },
          },
        ]}
        /*
         * What the rule matches, then where the monitors go - with the name
         * filled in from that, as every other rule form asks
         * (StatusPageMonitorRuleForm.ts).
         */
        formSteps={[
          { title: "Match", id: "match-criteria" },
          { title: "Group", id: "group" },
        ]}
        formFields={[
          {
            field: { monitorLabels: true },
            title: "Monitor Labels",
            stepId: "match-criteria",
            sectionTitle: "Match by Attributes",
            sectionDescription:
              "Match monitors carrying at least one of these labels. Leave empty to skip the label filter.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Monitor Labels",
          },
          {
            field: { monitorNamePattern: true },
            title: "Monitor Name",
            stepId: "match-criteria",
            sectionTitle: "Match by Pattern",
            sectionDescription:
              "Case-insensitive regex (^api-.*) or a * wildcard (*checkout*), matched against the monitor name and description. Use .* to match every monitor.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "^api-.* or *api*",
          },
          {
            field: { monitorDescriptionPattern: true },
            title: "Monitor Description",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "customer facing|tier-1",
          },
          {
            field: { statusPageGroup: true },
            title: StatusPageMonitorRuleCopy.groupFieldTitle,
            description: StatusPageMonitorRuleCopy.groupFieldDescription,
            stepId: "group",
            fieldType: FormFieldSchemaType.Dropdown,
            fetchDropdownOptions: fetchGroupOptions,
            required: false,
            placeholder: StatusPageMonitorRuleCopy.groupPlaceholder,
            // The name follows the group, until somebody types their own.
            onChange: followGroupWithRuleName<StatusPageMonitorRule>(),
          },
          {
            field: { name: true },
            title: "Name",
            description: StatusPageMonitorRuleCopy.nameDescription,
            stepId: "group",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            // A new rule, with no group picked yet, puts its monitors on top.
            defaultValue: getStatusPageMonitorRuleName([]),
            placeholder: StatusPageMonitorRuleCopy.namePlaceholder,
            validation: { minLength: 2, maxLength: RULE_NAME_MAX_LENGTH },
          },
          {
            field: { isEnabled: true },
            title: "Enabled",
            stepId: "group",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: true,
            description: StatusPageMonitorRuleCopy.enabledDescription,
          },
          {
            field: { showCurrentStatus: true },
            title: "Show Current Resource Status",
            stepId: "group",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: true,
            description:
              "Current resource status will be shown beside every monitor this rule adds.",
            collapsibleSection: advancedSection,
          },
          {
            field: { showUptimePercent: true },
            title: "Show Uptime %",
            stepId: "group",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: true,
            description:
              "Show uptime percentage beside every monitor this rule adds.",
            collapsibleSection: advancedSection,
          },
          {
            field: { uptimePercentPrecision: true },
            title: "Select Uptime Precision",
            stepId: "group",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(UptimePrecision),
            showIf: (item: FormValues<StatusPageMonitorRule>): boolean => {
              return Boolean(item.showUptimePercent);
            },
            defaultValue: UptimePrecision.ONE_DECIMAL,
            required: false,
            collapsibleSection: advancedSection,
          },
          {
            field: { showStatusHistoryChart: true },
            title: "Show Status History Chart",
            stepId: "group",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: true,
            description:
              "Show the status history chart for every monitor this rule adds.",
            collapsibleSection: advancedSection,
          },
          {
            field: { description: true },
            title: "Description",
            stepId: "group",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            // "Description of this status page monitor rule" says no more.
            hideColumnDescription: true,
            collapsibleSection: advancedSection,
          },
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default StatusPageMonitorRulesPage;
