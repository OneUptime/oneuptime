import WorkspaceNotificationRule from "Common/Models/DatabaseModels/WorkspaceNotificationRule";
import PermissionGate, {
  ModelAction,
  PermissionGateOptions,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * "Test Rule" on a Slack or Microsoft Teams notification rule posts a test
 * message into the rule's channels, so the server asks the permission a
 * channel's own Send Test asks: could create a notification rule
 * (WorkspaceNotificationRuleAPI). The rule's row says so rather than lead
 * into that refusal: for someone the dashboard knows may not, the button is
 * locked, and its tooltip says what it takes. Someone it does not know yet -
 * the permissions not loaded - keeps the button, and the server decides.
 */

export const TEST_RULE_LOCKED_TOOLTIP: string = translationKey(
  "Sending a test needs permission to create notification rules.",
);

export interface TestRuleLock {
  isLocked: boolean;
  // Why it is locked, in English: the row's button translates it.
  tooltip?: string | undefined;
}

export const getTestRuleLock: (
  options?: PermissionGateOptions,
) => TestRuleLock = (options?: PermissionGateOptions): TestRuleLock => {
  const gate: PermissionGateResult = PermissionGate.check(
    new WorkspaceNotificationRule(),
    ModelAction.Create,
    options,
  );

  if (gate.isAllowed || !gate.disabledReason) {
    return { isLocked: false };
  }

  return { isLocked: true, tooltip: TEST_RULE_LOCKED_TOOLTIP };
};
