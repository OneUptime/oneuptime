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
 * (WorkspaceNotificationRuleAPI, CommonAPI.assertCanCreateTable). The rule's
 * row says so rather than lead into that refusal: for someone the dashboard
 * knows may not, the button is locked, and its tooltip says what it takes.
 * Someone it does not know yet - the permissions not loaded - keeps the
 * button, and the server decides.
 *
 * "Could create a rule" is the rule's create gate (PermissionGate.check),
 * which reads the permissions the way the server does: a team's block row is
 * no grant, and a block with no labels on the rule's create list takes it
 * away. A master admin is never blocked.
 */

export const TEST_RULE_LOCKED_TOOLTIP: string = translationKey(
  "Sending a test needs permission to create notification rules.",
);

export interface TestRuleLock {
  isLocked: boolean;
  // Why it is locked, in English: the row's button translates it.
  tooltip?: string | undefined;
}

const LOCKED: TestRuleLock = {
  isLocked: true,
  tooltip: TEST_RULE_LOCKED_TOOLTIP,
};

const NOT_LOCKED: TestRuleLock = { isLocked: false };

export const getTestRuleLock: (
  options?: PermissionGateOptions,
) => TestRuleLock = (options?: PermissionGateOptions): TestRuleLock => {
  const gate: PermissionGateResult = PermissionGate.check(
    new WorkspaceNotificationRule(),
    ModelAction.Create,
    options,
  );

  if (gate.isAllowed) {
    return NOT_LOCKED;
  }

  // Nothing to say means not known yet: the server decides.
  return gate.disabledReason ? LOCKED : NOT_LOCKED;
};
