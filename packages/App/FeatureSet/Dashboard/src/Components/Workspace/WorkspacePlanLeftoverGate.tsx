import { PlanLeftoverTitle } from "../Billing/PlanLeftoverCopy";
import PlanLeftoverPage from "../Billing/PlanLeftoverPage";
import PlanLeftoverTable from "../Billing/PlanLeftoverTable";
import WorkspaceNotificationRule from "Common/Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceNotificationSummary from "Common/Models/DatabaseModels/WorkspaceNotificationSummary";
import Includes from "Common/Types/BaseDatabase/Includes";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import WorkspaceNotificationSummaryType from "Common/Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * A product's Slack or Microsoft Teams page (Incidents, Alerts, Scheduled
 * Maintenance, On-Call Duty, Monitors). Notification rules and summaries
 * are sold on the Growth plan, and they keep posting after a project drops
 * below it: a rule posts to its channels, a summary keeps going out. So
 * below the plan the page is the plan note (PlanLeftoverPage) with the
 * page's rules and summaries the project still has under it - a rule can be
 * deleted, a summary turned off or deleted (PlanLeftoverTable). On the plan,
 * and with billing off, the page is what it was.
 */

// The plan notification rules and summaries are sold at.
export const WORKSPACE_RULES_PLAN: PlanType =
  new WorkspaceNotificationRule().getCreateBillingPlan() || PlanType.Growth;

export interface WorkspaceLeftoverProps {
  workspaceType: WorkspaceType;
  // The rules this page lists, by the events they post about.
  eventTypes: Array<NotificationRuleEventType>;
  // The summaries this page lists; none on pages without summaries.
  summaryTypes?: Array<WorkspaceNotificationSummaryType> | undefined;
}

export interface ComponentProps extends WorkspaceLeftoverProps {
  children: ReactNode;
}

// A table id from the page's workspace and events, unique on the page.
export const getWorkspaceLeftoverIdSuffix: (
  props: WorkspaceLeftoverProps,
) => string = (props: WorkspaceLeftoverProps): string => {
  return [props.workspaceType, ...props.eventTypes]
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-");
};

// The page's rules and summaries a project below the plan still has.
export const WorkspaceLeftovers: FunctionComponent<WorkspaceLeftoverProps> = (
  props: WorkspaceLeftoverProps,
): ReactElement => {
  const summaryTypes: Array<WorkspaceNotificationSummaryType> =
    props.summaryTypes || [];
  const idSuffix: string = getWorkspaceLeftoverIdSuffix(props);

  return (
    <>
      <PlanLeftoverTable<WorkspaceNotificationRule>
        modelType={WorkspaceNotificationRule}
        id={`workspace-rules-${idSuffix}`}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          workspaceType: props.workspaceType,
          eventType: new Includes(props.eventTypes),
        }}
        requiredPlan={WORKSPACE_RULES_PLAN}
        title={PlanLeftoverTitle.notificationRules}
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
              eventType: true,
            },
            title: "Event Type",
            type: FieldType.Text,
          },
        ]}
      />
      {summaryTypes.length > 0 ? (
        <PlanLeftoverTable<WorkspaceNotificationSummary>
          modelType={WorkspaceNotificationSummary}
          id={`workspace-summaries-${idSuffix}`}
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
            workspaceType: props.workspaceType,
            summaryType: new Includes(summaryTypes),
          }}
          requiredPlan={WORKSPACE_RULES_PLAN}
          title={PlanLeftoverTitle.summaries}
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
                summaryType: true,
              },
              title: "Summary Type",
              type: FieldType.Text,
            },
          ]}
        />
      ) : (
        <></>
      )}
    </>
  );
};

const WorkspacePlanLeftoverGate: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <PlanLeftoverPage
      requiredPlan={WORKSPACE_RULES_PLAN}
      leftovers={
        <WorkspaceLeftovers
          workspaceType={props.workspaceType}
          eventTypes={props.eventTypes}
          summaryTypes={props.summaryTypes}
        />
      }
    >
      {props.children}
    </PlanLeftoverPage>
  );
};

export default WorkspacePlanLeftoverGate;
