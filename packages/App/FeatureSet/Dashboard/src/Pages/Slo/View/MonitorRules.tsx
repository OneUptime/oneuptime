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
A monitor rule picks the monitors this SLO measures, so you do not attach each one by hand. Describe them once, such as every monitor labelled Production, and every monitor that matches is attached, now and as monitors are created or change.

## How Rules Pick Monitors

- A monitor is attached while any enabled rule matches it, and detached once none does.
- Rules run as soon as you create, change, enable, disable or delete one, and whenever a monitor is created or its labels, type, name or description change.
- Rules keep this SLO's monitors up to date while it is disabled or archived, so it comes back measuring the right ones.
- Every monitor a rule attaches or detaches is recorded on the SLO's **Feed**.

## Match Criteria

Add conditions on a monitor's labels, type, name or description, and choose **Match all** or **Match any**. A pattern is a case-insensitive regular expression (\`^api-.*\`) or a \`*\` wildcard (\`*checkout*\`); one that is neither is refused when you save.

## Rules and Monitors Attached by Hand

While any rule is enabled, the rules manage this SLO's monitors: you cannot add monitors by hand, or remove the ones a rule attached. Monitors you attached by hand before are never touched by a rule: not adopted when they match, and not detached when they stop matching.

Disabling or deleting a rule detaches the monitors only that rule matched. Disable every rule to pick monitors yourself again.
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
            "Attach monitors that match a rule instead of picking each by hand. While a rule is enabled, the rules manage this SLO's monitors.",
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
