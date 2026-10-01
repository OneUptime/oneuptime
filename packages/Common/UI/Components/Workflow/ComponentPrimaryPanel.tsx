import ManualTriggerPanel from "./ManualTriggerPanel";
import WebhookTriggerPanel from "./WebhookTriggerPanel";
import { WORKFLOW_URL } from "../../Config";
import { NodeDataProp } from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import { getWebhookTriggerUrl } from "../../../Types/Workflow/WebhookTrigger";
import React, { ReactElement } from "react";

export interface ComponentPrimaryPanelContext {
  component: NodeDataProp;
  webhookSecretKey?: string | undefined;
}

export type GetComponentPrimaryPanelFunction = (
  context: ComponentPrimaryPanelContext,
) => ReactElement | null;

/*
 * The section a step's settings dialog opens on, for the steps whose settings
 * are not what someone opens them for. The Webhook trigger has no settings at
 * all - it is opened for its URL. The Manual trigger has none either, and the
 * question there is how it gets started.
 *
 * Every other step opens on its settings, so this returns null for it. A new
 * trigger whose address is the point of it (an inbound email address, say)
 * adds a case here.
 */
export const getComponentPrimaryPanel: GetComponentPrimaryPanelFunction = (
  context: ComponentPrimaryPanelContext,
): ReactElement | null => {
  switch (context.component.metadata.id) {
    case ComponentID.Webhook:
      return (
        <WebhookTriggerPanel
          webhookUrl={
            context.webhookSecretKey
              ? getWebhookTriggerUrl({
                  workflowServiceUrl: WORKFLOW_URL.toString(),
                  secretKey: context.webhookSecretKey,
                })
              : null
          }
        />
      );
    case ComponentID.Manual:
      return <ManualTriggerPanel />;
    default:
      return null;
  }
};
