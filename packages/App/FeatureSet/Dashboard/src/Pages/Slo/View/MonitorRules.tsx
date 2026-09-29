import RuleSettingsPageProps from "../../RuleSettingsPageProps";
import getSloMonitorRuleFormFields from "./SloMonitorRuleFormFields";
import SloNoticeBanner from "../../../Components/Slo/SloNoticeBanner";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import RuleViewPageUtil from "../../../Utils/RuleViewPage";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Green, Red } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ServiceLevelObjectiveMonitorRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import RuleTable from "Common/UI/Components/RuleRun/RuleTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * The "### Match Criteria" section is load-bearing: the rule-criteria table
 * configuration rewrites that heading's body to describe the condition
 * builder that replaces the individual match fields.
 */
const monitorRuleDocumentation: string = `
### How SLO Monitor Rules Work

A monitor rule decides which monitors this SLO measures, so you do not have to pick every monitor by hand. Describe the monitors once - "every monitor labelled Production", "every monitor whose name starts with api-" - and every monitor that matches is attached to this SLO, now and as monitors are created or change.

An SLO can have as many rules as you like. A monitor is attached while **any** enabled rule matches it, and detached once none does.

### Match Criteria

Add conditions and choose **Match all** to require every condition, or **Match any** to require at least one condition.

- **Monitor Labels** - matches a monitor carrying *any one* of the labels you select.
- **Monitor Type** - use **Equals** or **Does not equal** to include or exclude a monitor type.
- **Monitor Name** - compare the monitor name using a text operator.
- **Monitor Description** - compare the monitor description using a text operator.

The **Matches pattern** and **Does not match pattern** operators take either syntax: a case-insensitive regular expression (\`^api-.*\`) or a \`*\` wildcard (\`*checkout*\`). A pattern that is neither - \`api-(01\` - is rejected when you save, rather than silently matching nothing.

At least one criterion is required. Use \`.*\` as the name pattern if you really do want every monitor in the project.

### When Rules Run

- When you create, edit, enable, disable or delete a rule, this SLO's monitors are re-evaluated immediately.
- When a monitor is created, or its labels, type, name or description change, every rule on every SLO in the project is re-evaluated for it.
- Rules keep the monitor list current even while the SLO is disabled or archived, so it resumes with the right monitors.

### What Rules Own

Rules only ever detach monitors a rule attached. A monitor you attached by hand is never adopted by a rule when it happens to match, and never detached when it stops matching or when a rule is deleted.

Disabling or deleting a rule detaches the monitors only that rule matched. Monitors another enabled rule still matches stay attached.

### Adding Monitors By Hand

While at least one rule is enabled, this SLO's monitors are managed by its rules: monitors cannot be added by hand, and monitors a rule attached cannot be removed by hand. Monitors attached by hand before the rules were enabled can still be removed. Disable every rule to go back to picking monitors yourself.

Every attach and detach is recorded on the SLO's Feed.
`;

const SloMonitorRules: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  const viewRuleId: ObjectID | undefined = RuleViewPageUtil.getViewRuleId(
    props,
    ServiceLevelObjectiveMonitorRule,
  );

  /*
   * The SLO is the route's model id: <sloId>/monitor-rules. On a rule's view
   * page (<sloId>/monitor-rules/<ruleId>) the rule id is the last URL segment,
   * so the SLO id is the one before it.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(
    props.ruleViewModelType ? 2 : 1,
  );

  return (
    <Fragment>
      <SloNoticeBanner sloId={modelId} />
      <RuleTable<ServiceLevelObjectiveMonitorRule>
        modelType={ServiceLevelObjectiveMonitorRule}
        viewRuleId={viewRuleId}
        listRoute={RuleViewPageUtil.getListRoute(
          PageMap.SLO_VIEW_MONITOR_RULES,
          modelId,
        )}
        getRuleViewRoute={(rule: ServiceLevelObjectiveMonitorRule): Route => {
          return RuleViewPageUtil.getRuleViewRoute(
            PageMap.SLO_VIEW_MONITOR_RULE_VIEW,
            rule,
            modelId,
          );
        }}
        id="slo-monitor-rules-table"
        name="SLO > Monitor Rules"
        userPreferencesKey="slo-monitor-rules-table"
        saveFilterProps={{
          tableId: "slo-monitor-rules-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
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
            "Match monitors by label, type, name or description and attach them to this SLO automatically.",
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
        formFields={getSloMonitorRuleFormFields()}
      />
    </Fragment>
  );
};

export default SloMonitorRules;
