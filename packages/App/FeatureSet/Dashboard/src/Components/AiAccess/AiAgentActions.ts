import IconProp from "Common/Types/Icon/IconProp";
import { PermissionGateResult } from "Common/UI/Utils/PermissionGate";

/*
 * What the AI agent card offers to do with the agent, shared by a
 * Kubernetes cluster's AI agent page (Pages/Kubernetes/View/AI/Agent.tsx)
 * and every other resource's (Components/ResourceAiAgent/
 * ResourceAiAgentPage.tsx).
 *
 * "We can have both of these buttons, like "Test Connection" and "Reset
 * Agent," in a more button style with three dots. Please do this for all
 * the other resources in the project."
 *
 * The card's header keeps the agent's status in sight and puts these in one
 * ⋯ beside it (AiAgentActionsMenu), in this order:
 *
 *   Test connection         once there is something to test. Locked, with
 *                           the permission it needs, for a user who may not
 *                           run it; left out while the permission snapshot
 *                           has not landed, when there is nothing honest to
 *                           say. Locked while a test runs: it runs once.
 *   Switch to the AI agent  a Kubernetes cluster bound to a Runner outside
 *                           the chart, while its AI agent is online, for
 *                           the people who may loosen AI access.
 *   Reset agent             once an agent registered, for the people who may
 *                           loosen AI access. Asks before it resets.
 *
 * Switching and resetting are locked while another page action is in
 * flight. The card leaves the ⋯ out when none of them is offered.
 */

export type AiAgentActionId =
  | "test_connection"
  | "switch_to_agent"
  | "reset_agent";

export interface AiAgentAction {
  id: AiAgentActionId;
  // English; the menu translates it.
  text: string;
  icon: IconProp;
  isDisabled: boolean;
  /*
   * Why the action is locked, when the user can do something about it (a
   * permission they lack): shown on hover and read out with the item. A
   * lock that only lasts while something runs has none.
   */
  disabledReason: string | undefined;
  dataTestId: string;
  onClick: () => void;
}

export interface AiAgentActionsInput {
  testConnection: {
    /*
     * There is something to test: a registered agent, or - on a cluster -
     * any Runner AI reaches it through.
     */
    hasTarget: boolean;
    // The test's own permission gate (edit access to the resource).
    gate: PermissionGateResult;
    // What the locked item says it needs.
    permissionRequirement: string;
    isRunning: boolean;
    onRun: () => void;
  };
  // Kubernetes only: move a cluster's advanced Runner binding to its agent.
  switchToAgent?:
    | {
        isOffered: boolean;
        onClick: () => void;
      }
    | undefined;
  resetAgent: {
    isOffered: boolean;
    onClick: () => void;
  };
  // A page action (a reset, a switch, a gap's one-click fix) is in flight.
  isActing: boolean;
}

export const AI_AGENT_TEST_CONNECTION_TEST_ID: string = "ai-agent-test-button";
export const AI_AGENT_SWITCH_TO_AGENT_TEST_ID: string =
  "ai-agent-switch-button";
export const AI_AGENT_RESET_AGENT_TEST_ID: string = "ai-agent-reset-button";

export function getAiAgentActions(
  input: AiAgentActionsInput,
): Array<AiAgentAction> {
  const actions: Array<AiAgentAction> = [];
  const test: AiAgentActionsInput["testConnection"] = input.testConnection;

  if (test.hasTarget && (test.gate.isAllowed || test.gate.disabledReason)) {
    actions.push({
      id: "test_connection",
      text: "Test connection",
      icon: IconProp.Play,
      isDisabled: test.isRunning || !test.gate.isAllowed,
      disabledReason: test.gate.isAllowed
        ? undefined
        : test.permissionRequirement,
      dataTestId: AI_AGENT_TEST_CONNECTION_TEST_ID,
      onClick: (): void => {
        if (!test.gate.isAllowed || test.isRunning) {
          return;
        }
        test.onRun();
      },
    });
  }

  if (input.switchToAgent?.isOffered) {
    const onSwitch: () => void = input.switchToAgent.onClick;

    actions.push({
      id: "switch_to_agent",
      text: "Switch to the AI agent",
      icon: IconProp.ArrowCircleRight,
      isDisabled: input.isActing,
      disabledReason: undefined,
      dataTestId: AI_AGENT_SWITCH_TO_AGENT_TEST_ID,
      onClick: (): void => {
        if (input.isActing) {
          return;
        }
        onSwitch();
      },
    });
  }

  if (input.resetAgent.isOffered) {
    const onReset: () => void = input.resetAgent.onClick;

    actions.push({
      id: "reset_agent",
      text: "Reset agent",
      icon: IconProp.Refresh,
      isDisabled: input.isActing,
      disabledReason: undefined,
      dataTestId: AI_AGENT_RESET_AGENT_TEST_ID,
      onClick: (): void => {
        if (input.isActing) {
          return;
        }
        onReset();
      },
    });
  }

  return actions;
}
