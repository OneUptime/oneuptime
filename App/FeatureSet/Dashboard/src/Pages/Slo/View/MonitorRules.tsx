import PageComponentProps from "../../PageComponentProps";
import SloNoticeBanner from "../../../Components/Slo/SloNoticeBanner";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Green, Red } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Label from "Common/Models/DatabaseModels/Label";
import ServiceLevelObjectiveMonitorRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * The "### Match Criteria" section is load-bearing: the rule-criteria table
 * configuration rewrites that heading's body to describe the condition
 * builder that replaces the three legacy fields below.
 */
const monitorRuleDocumentation: string = `
### How SLO Monitor Rules Work

A monitor rule decides which monitors this SLO measures, so you do not have to pick every monitor by hand. Describe the monitors once - "every monitor labelled Production", "every monitor whose name starts with api-" - and every monitor that matches is attached to this SLO, now and as monitors are created or change.

An SLO can have as many rules as you like. A monitor is attached while **any** enabled rule matches it, and detached once none does.

### Match Criteria

A monitor has to pass **all** the criteria you fill in. Criteria you leave empty are skipped.

- **Monitor Labels** - matches a monitor carrying *any one* of the labels you select.
- **Monitor Name Pattern** - matched against the monitor name.
- **Monitor Description Pattern** - matched against the monitor description.

Patterns take either syntax: a case-insensitive regular expression (\`^api-.*\`) or a \`*\` wildcard (\`*checkout*\`). A pattern that is neither - \`api-(01\` - is rejected when you save, rather than silently matching nothing.

At least one criterion is required. Use \`.*\` as the name pattern if you really do want every monitor in the project.

### When Rules Run

- When you create, edit, enable, disable or delete a rule, this SLO's monitors are re-evaluated immediately.
- When a monitor is created, or its labels, name or description change, every rule on every SLO in the project is re-evaluated for it.
- Rules keep the monitor list current even while the SLO is disabled or archived, so it resumes with the right monitors.

### What Rules Own

Rules only ever detach monitors a rule attached. A monitor you attached by hand is never adopted by a rule when it happens to match, and never detached when it stops matching or when a rule is deleted.

Disabling or deleting a rule detaches the monitors only that rule matched. Monitors another enabled rule still matches stay attached.

### Adding Monitors By Hand

While at least one rule is enabled, this SLO's monitors are managed by its rules: monitors cannot be added by hand, and monitors a rule attached cannot be removed by hand. Monitors attached by hand before the rules were enabled can still be removed. Disable every rule to go back to picking monitors yourself.

Every attach and detach is recorded on the SLO's Feed.
`;

const SloMonitorRules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is <sloId>/monitor-rules, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <SloNoticeBanner sloId={modelId} />
      <ModelTable<ServiceLevelObjectiveMonitorRule>
        modelType={ServiceLevelObjectiveMonitorRule}
        id="slo-monitor-rules-table"
        name="SLO > Monitor Rules"
        userPreferencesKey="slo-monitor-rules-table"
        saveFilterProps={{
          tableId: "slo-monitor-rules-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        showRefreshButton={true}
        createEditModalWidth={ModalWidth.Large}
        query={{
          serviceLevelObjectiveId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: ServiceLevelObjectiveMonitorRule,
        ): Promise<ServiceLevelObjectiveMonitorRule> => {
          item.serviceLevelObjectiveId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Monitor Rules",
          description:
            "Attach monitors to this SLO by matching them, instead of picking each one by hand. Every monitor an enabled rule matches is attached, and detached again once no enabled rule matches it. While any rule is enabled, the rules manage this SLO's monitors.",
          buttons: [
            {
              title: "View Monitors",
              buttonStyle: ButtonStyleType.NORMAL,
              icon: IconProp.AltGlobe,
              onClick: () => {
                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.SLO_VIEW_MONITORS] as Route,
                    { modelId: modelId },
                  ),
                );
              },
            },
          ],
        }}
        helpContent={{
          title: "How SLO Monitor Rules Work",
          description:
            "Match monitors by label or pattern and attach them to this SLO automatically.",
          markdown: monitorRuleDocumentation,
        }}
        noItemsMessage="No monitor rules on this SLO. Its monitors are picked by hand on the Monitors page - create a rule to attach matching monitors automatically instead."
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        selectMoreFields={{ isEnabled: true }}
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
              isEnabled: true,
            },
            title: "Enabled",
            type: FieldType.Boolean,
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
              isEnabled: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (
              item: ServiceLevelObjectiveMonitorRule,
            ): ReactElement => {
              return item.isEnabled ? (
                <Pill color={Green} text="Enabled" size={PillSize.Small} />
              ) : (
                <Pill color={Red} text="Disabled" size={PillSize.Small} />
              );
            },
          },
        ]}
        formSteps={[
          { title: "Basic Info", id: "basic-info" },
          { title: "Match Criteria", id: "match-criteria" },
        ]}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Every production API monitor",
            validation: { minLength: 2 },
          },
          {
            field: { description: true },
            title: "Description",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Why these monitors belong to this SLO.",
          },
          {
            field: { isEnabled: true },
            title: "Enabled",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: true,
            description:
              "Turning a rule off detaches the monitors only this rule attached. Monitors you attached by hand, or that another enabled rule matches, are left alone.",
          },
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
            placeholder: "Select Monitor Labels (optional)",
          },
          {
            field: { monitorNamePattern: true },
            title: "Monitor Name Pattern",
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
            title: "Monitor Description Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "customer facing|tier-1",
          },
        ]}
        viewPageRoute={Navigation.getCurrentRoute()}
      />
    </Fragment>
  );
};

export default SloMonitorRules;
