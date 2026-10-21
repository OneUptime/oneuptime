import { isKnownToBeBelowPlan } from "../../Enterprise/EnterpriseEligibility";
// The column that switches a status page's email reports on: the card's own.
import { REPORT_SWITCH_COLUMN } from "../StatusPage/StatusPageReportsCopy";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import WorkspaceNotificationRule from "Common/Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceNotificationSummary from "Common/Models/DatabaseModels/WorkspaceNotificationSummary";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import PermissionGate, {
  ModelAction,
  PermissionGateOptions,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import {
  getGlobalTranslator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * Whether a "Send Test" button may be pressed: the dashboard's half of the
 * rule every test route asks on the server (Common/Server/API/TestSendAccess).
 * A test asks what sending the same thing for real asks - on OneUptime Cloud
 * the plan the feature is sold on, and permission to create what is tested
 * (for a status page's test report, to switch its reports on).
 *
 * For someone the dashboard knows may not send, the button stays on screen,
 * locked, and its tooltip says in one plain sentence what it takes - the
 * plan first, as the server asks it first. Someone it knows nothing about
 * yet (the permissions or the plan not loaded) keeps the button, and the
 * server decides. A team's block row is never a grant, and a block with no
 * labels takes the permission away (PermissionGate). A master admin is
 * never locked out by a permission.
 */

export interface TestSendLock {
  isLocked: boolean;
  /*
   * Why it is locked, ready for the button's tooltip: a permission sentence
   * in English, which the button translates, or the plan sentence, already
   * in the reader's language.
   */
  tooltip?: string | undefined;
}

// What a Send Test sends through, and what its button says when locked.
export interface TestSendTarget {
  // The plan the feature is sold on, or null when it is on every plan.
  getRequiredPlan: () => PlanType | null;
  // The permission the server asks, read the way the server reads it.
  checkPermission: (
    options?: PermissionGateOptions | undefined,
  ) => PermissionGateResult;
  // Why the button is locked for someone without that permission.
  lockedTooltip: string;
}

// For a plan the project is known to be below.
export const TEST_SEND_PLAN_TOOLTIP: string = translationKey(
  "Sending a test needs the {{planName}} plan.",
);

export const TEST_SEND_LOCKED_TOOLTIPS: {
  notificationRule: string;
  summary: string;
  smtpConfig: string;
  twilioConfig: string;
  statusPageReport: string;
} = {
  notificationRule: translationKey(
    "Sending a test needs permission to create notification rules.",
  ),
  summary: translationKey(
    "Sending a test needs permission to create summaries.",
  ),
  smtpConfig: translationKey(
    "Sending a test needs permission to create SMTP configs.",
  ),
  twilioConfig: translationKey(
    "Sending a test needs permission to create Twilio configs.",
  ),
  statusPageReport: translationKey(
    "Sending a test report needs permission to edit this status page.",
  ),
};

// A test of something the project creates: its create gate and create plan.
const createTarget: (
  getModel: () => DatabaseBaseModel,
  lockedTooltip: string,
) => TestSendTarget = (
  getModel: () => DatabaseBaseModel,
  lockedTooltip: string,
): TestSendTarget => {
  return {
    getRequiredPlan: (): PlanType | null => {
      return getModel().getCreateBillingPlan() || null;
    },
    checkPermission: (
      options?: PermissionGateOptions | undefined,
    ): PermissionGateResult => {
      return PermissionGate.check(getModel(), ModelAction.Create, options);
    },
    lockedTooltip: lockedTooltip,
  };
};

export const TestSendTargets: {
  // Test Rule, and the Send Test of a Slack or Microsoft Teams channel or chat.
  NotificationRule: TestSendTarget;
  // Send Test Now on a Slack or Microsoft Teams summary.
  Summary: TestSendTarget;
  // Send Test Email on a custom SMTP config.
  SmtpConfig: TestSendTarget;
  // Send Test SMS and Send Test Call on a Twilio config.
  TwilioConfig: TestSendTarget;
  // Send Test Report on a status page.
  StatusPageReport: TestSendTarget;
} = {
  NotificationRule: createTarget((): DatabaseBaseModel => {
    return new WorkspaceNotificationRule();
  }, TEST_SEND_LOCKED_TOOLTIPS.notificationRule),
  Summary: createTarget((): DatabaseBaseModel => {
    return new WorkspaceNotificationSummary();
  }, TEST_SEND_LOCKED_TOOLTIPS.summary),
  SmtpConfig: createTarget((): DatabaseBaseModel => {
    return new ProjectSmtpConfig();
  }, TEST_SEND_LOCKED_TOOLTIPS.smtpConfig),
  TwilioConfig: createTarget((): DatabaseBaseModel => {
    return new ProjectCallSMSConfig();
  }, TEST_SEND_LOCKED_TOOLTIPS.twilioConfig),
  /*
   * A report is a setting of its page, switched on rather than created: its
   * test asks what switching reports on asks - editing the page and its
   * Is Report Enabled column, on the plan that column is sold on.
   */
  StatusPageReport: {
    getRequiredPlan: (): PlanType | null => {
      return (
        new StatusPage().getColumnBillingAccessControl(REPORT_SWITCH_COLUMN)
          ?.update || null
      );
    },
    checkPermission: (
      options?: PermissionGateOptions | undefined,
    ): PermissionGateResult => {
      return PermissionGate.checkColumnUpdate(
        new StatusPage(),
        REPORT_SWITCH_COLUMN,
        options,
      );
    },
    lockedTooltip: TEST_SEND_LOCKED_TOOLTIPS.statusPageReport,
  },
};

const NOT_LOCKED: TestSendLock = { isLocked: false };

export const getTestSendLock: (
  target: TestSendTarget,
  options?: PermissionGateOptions | undefined,
) => TestSendLock = (
  target: TestSendTarget,
  options?: PermissionGateOptions | undefined,
): TestSendLock => {
  const requiredPlan: PlanType | null = target.getRequiredPlan();

  if (requiredPlan && isKnownToBeBelowPlan(requiredPlan)) {
    return {
      isLocked: true,
      tooltip: getGlobalTranslator().translateTemplate(TEST_SEND_PLAN_TOOLTIP, {
        planName: requiredPlan,
      }),
    };
  }

  const gate: PermissionGateResult = target.checkPermission(options);

  if (gate.isAllowed) {
    return NOT_LOCKED;
  }

  // Nothing to say means not known yet: the server decides.
  if (!gate.disabledReason) {
    return NOT_LOCKED;
  }

  return {
    isLocked: true,
    tooltip: target.lockedTooltip,
  };
};
