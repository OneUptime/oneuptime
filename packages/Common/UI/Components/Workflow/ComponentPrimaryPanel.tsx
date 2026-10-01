import IncomingEmailTriggerPanel from "./IncomingEmailTriggerPanel";
import ManualTriggerPanel from "./ManualTriggerPanel";
import WebhookTriggerPanel from "./WebhookTriggerPanel";
import { getIncomingEmailSecretKeyResetGate } from "./WorkflowIncomingEmailSecretKey";
import {
  getWebhookSecretKeyResetGate,
  isWebhookSecretKeyTheWorkflowId,
} from "./WorkflowWebhookSecretKey";
import { DOCS_URL, INBOUND_EMAIL_DOMAIN, WORKFLOW_URL } from "../../Config";
import { PermissionGateResult } from "../../Utils/PermissionGate";
import ObjectID from "../../../Types/ObjectID";
import { NodeDataProp } from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import { WorkflowDocsPaths } from "../../../Types/Workflow/Documentation/DocumentationLinks";
import IncomingEmailTrigger from "../../../Types/Workflow/IncomingEmailTrigger";
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
  /*
   * The same three for the Incoming Email trigger's address, which is built
   * from the workflow's incoming email secret key
   * (WorkflowIncomingEmailSecretKey). The reset also creates the first key of
   * a workflow that has none.
   */
  incomingEmailSecretKey?: string | undefined;
  canSeeIncomingEmailSecretKey?: boolean | undefined;
  onResetIncomingEmailSecretKey?: (() => Promise<void>) | undefined;
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
 * The Incoming Email trigger has no settings either: it is opened for its
 * email address, which is shown, copied and reset the way the Webhook
 * trigger's URL is.
 *
 * Every other step opens on its settings, so this returns null for it. A new
 * trigger whose address is the point of it adds a case here.
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
          onResetUrl={offersReset ? context.onResetWebhookSecretKey : undefined}
          resetDisabledReason={
            offersReset && !resetGate.isAllowed
              ? resetGate.disabledReason
              : undefined
          }
        />
      );
    }
    case ComponentID.IncomingEmail: {
      // Empty when this server receives no email; the panel then says so.
      const inboundDomain: string = INBOUND_EMAIL_DOMAIN || "";
      const canSeeAddress: boolean =
        context.canSeeIncomingEmailSecretKey !== false;
      const secretKey: string = canSeeAddress
        ? context.incomingEmailSecretKey || ""
        : "";

      const resetGate: PermissionGateResult =
        getIncomingEmailSecretKeyResetGate();
      /*
       * Offered when the user may reset the address, and shown disabled -
       * with the permission that is missing - when they may not. Only with
       * canSeeIncomingEmailSecretKey: without it an empty key could mean
       * "hidden" rather than "none", and creating one would replace the real
       * one.
       */
      const offersReset: boolean = Boolean(
        context.onResetIncomingEmailSecretKey &&
          context.canSeeIncomingEmailSecretKey === true &&
          (resetGate.isAllowed || resetGate.disabledReason),
      );

      return (
        <IncomingEmailTriggerPanel
          inboundDomain={inboundDomain}
          address={IncomingEmailTrigger.getAddress({
            secretKey: secretKey,
            inboundDomain: inboundDomain,
          })}
          canSeeAddress={canSeeAddress}
          onResetAddress={
            offersReset ? context.onResetIncomingEmailSecretKey : undefined
          }
          resetDisabledReason={
            offersReset && !resetGate.isAllowed
              ? resetGate.disabledReason
              : undefined
          }
          setupGuideUrl={`${DOCS_URL.toString()}${WorkflowDocsPaths.inboundEmailSetup}`}
        />
      );
    }
    case ComponentID.Manual:
      return <ManualTriggerPanel />;
    default:
      return null;
  }
};
