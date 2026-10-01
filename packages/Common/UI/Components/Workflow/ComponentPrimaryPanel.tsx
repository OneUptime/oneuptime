import ManualTriggerPanel from "./ManualTriggerPanel";
import WebhookTriggerPanel from "./WebhookTriggerPanel";
import {
  getWebhookSecretKeyResetGate,
  isWebhookSecretKeyTheWorkflowId,
} from "./WorkflowWebhookSecretKey";
import { WORKFLOW_URL } from "../../Config";
import { PermissionGateResult } from "../../Utils/PermissionGate";
import ObjectID from "../../../Types/ObjectID";
import { NodeDataProp } from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import {
  getWebhookTriggerUrl,
  getWebhookTriggerUrlPrefix,
} from "../../../Types/Workflow/WebhookTrigger";
import React, { ReactElement } from "react";

export interface ComponentPrimaryPanelContext {
  component: NodeDataProp;
  workflowId?: ObjectID | undefined;
  webhookSecretKey?: string | undefined;
  /*
   * Whether the user may read the workflow's webhook secret key - and so
   * whether webhookSecretKey is what the workflow really has. The builder only
   * asks for the key when the user may read it (WorkflowWebhookSecretKey).
   *
   * Left out, a key that was passed is shown as it is.
   */
  canSeeWebhookSecretKey?: boolean | undefined;
  /*
   * Gives the workflow a new webhook secret key and resolves once it is saved;
   * the caller then passes the new key in. Only offered when the caller also
   * says canSeeWebhookSecretKey: without that, an empty key could mean "hidden"
   * rather than "none", and creating one would replace the real one.
   */
  onResetWebhookSecretKey?: (() => Promise<void>) | undefined;
}

export type GetComponentPrimaryPanelFunction = (
  context: ComponentPrimaryPanelContext,
) => ReactElement | null;

/*
 * The section a step's settings dialog opens on, for the steps whose settings
 * are not what someone opens them for. The Webhook trigger has no settings at
 * all - it is opened for its URL, and its URL's secret key is managed there
 * too. The Manual trigger has none either, and the question there is how it
 * gets started.
 *
 * Every other step opens on its settings, so this returns null for it. A new
 * trigger whose address is the point of it (an inbound email address, say)
 * adds a case here.
 */
export const getComponentPrimaryPanel: GetComponentPrimaryPanelFunction = (
  context: ComponentPrimaryPanelContext,
): ReactElement | null => {
  switch (context.component.metadata.id) {
    case ComponentID.Webhook: {
      const workflowServiceUrl: string = WORKFLOW_URL.toString();
      const canSeeUrl: boolean = context.canSeeWebhookSecretKey !== false;
      const secretKey: string = canSeeUrl ? context.webhookSecretKey || "" : "";

      const resetGate: PermissionGateResult = getWebhookSecretKeyResetGate();
      /*
       * Offered when the user may reset the key, and shown disabled - with the
       * permission that is missing - when they may not. Hidden while the
       * permission snapshot has not landed (no reason to give).
       */
      const offersReset: boolean = Boolean(
        context.onResetWebhookSecretKey &&
          context.canSeeWebhookSecretKey === true &&
          (resetGate.isAllowed || resetGate.disabledReason),
      );

      return (
        <WebhookTriggerPanel
          webhookUrl={
            secretKey
              ? getWebhookTriggerUrl({
                  workflowServiceUrl: workflowServiceUrl,
                  secretKey: secretKey,
                })
              : null
          }
          webhookUrlPrefix={getWebhookTriggerUrlPrefix({
            workflowServiceUrl: workflowServiceUrl,
          })}
          canSeeUrl={canSeeUrl}
          isUrlBuiltFromWorkflowId={Boolean(
            secretKey &&
              context.workflowId &&
              isWebhookSecretKeyTheWorkflowId({
                secretKey: secretKey,
                workflowId: context.workflowId,
              }),
          )}
          onResetUrl={
            offersReset ? context.onResetWebhookSecretKey : undefined
          }
          resetDisabledReason={
            offersReset && !resetGate.isAllowed
              ? resetGate.disabledReason
              : undefined
          }
        />
      );
    }
    case ComponentID.Manual:
      return <ManualTriggerPanel />;
    default:
      return null;
  }
};
