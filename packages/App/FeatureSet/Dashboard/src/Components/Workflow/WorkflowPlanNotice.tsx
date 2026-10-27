import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { doesPlanRunWorkflows } from "Common/Types/Workflow/WorkflowPlan";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { BILLING_ENABLED } from "Common/UI/Config";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WORKFLOWS DO NOT RUN ON THIS PROJECT'S PLAN: said where workflows are
 * built and listed, before the first run is refused.
 *
 * On OneUptime Cloud the Free plan runs no workflows (WorkflowPlan): every
 * run is refused, Run Workflow's included, and recorded as Execution
 * Exceeded Current Plan. A Free project could still build workflows, turn
 * them on and wait for them, with nothing on the Builder saying none would
 * ever run - the Workflows page shows how many runs are left only on the
 * plans that have some. So the Builder and the Workflows page say it, with
 * the one way out: the Billing page.
 *
 * Fails open, like the other plan notices (AIPlanGate): billing off, as on
 * every self-hosted install, or a plan the server does not describe, shows
 * nothing - the server has the last word.
 */

export const WORKFLOW_PLAN_NOTICE_TEST_ID: string = "workflow-plan-notice";

export const WorkflowPlanNoticeCopy: {
  title: string;
  body: string;
  upgrade: string;
} = {
  title: translationKey("Workflows do not run on this project's plan"),
  body: translationKey(
    "This project is on the {{plan}} plan, so nothing starts a workflow, not even Run Workflow. {{upgradeLink}} to run workflows.",
  ),
  upgrade: translationKey("Upgrade to the Growth plan or above"),
};

// Whether the project's plan runs workflows; true when it cannot be told.
export function doesCurrentPlanRunWorkflows(): boolean {
  if (!BILLING_ENABLED) {
    return true;
  }

  return doesPlanRunWorkflows(ProjectUtil.getCurrentPlan());
}

export interface ComponentProps {
  className?: string | undefined;
}

const WorkflowPlanNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (doesCurrentPlanRunWorkflows()) {
    return <></>;
  }

  const plan: PlanType | null = ProjectUtil.getCurrentPlan();

  const billingRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SETTINGS_BILLING] as Route,
  );

  return (
    <Alert
      type={AlertType.WARNING}
      strongTitle={WorkflowPlanNoticeCopy.title}
      className={props.className}
      dataTestId={WORKFLOW_PLAN_NOTICE_TEST_ID}
      title={
        <span>
          <TranslatedSentence
            template={WorkflowPlanNoticeCopy.body}
            values={{ plan: plan || "" }}
            slots={{
              upgradeLink: (
                <Link
                  to={billingRoute}
                  className="underline"
                  dataTestId={`${WORKFLOW_PLAN_NOTICE_TEST_ID}-upgrade`}
                >
                  {translator.translateText(WorkflowPlanNoticeCopy.upgrade)}
                </Link>
              ),
            }}
          />
        </span>
      }
    />
  );
};

export default WorkflowPlanNotice;
