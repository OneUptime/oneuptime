/*
 * The "How to use" help for any workflow step.
 *
 * Every built-in step has its own entry below. The table is typed as a full
 * Record over ComponentID, so a new step does not compile until it has help:
 * the help is part of making a step, not something to come back to. The
 * generated database steps get theirs from DatabaseDocumentation.ts.
 */

import ComponentMetadata, { NodeDataProp } from "../Component";
import ComponentID from "../ComponentID";
import { getAIGenerateTextDocumentation } from "./AIDocumentation";
import {
  getApiDeleteDocumentation,
  getApiGetDocumentation,
  getApiPatchDocumentation,
  getApiPostDocumentation,
  getApiPutDocumentation,
} from "./APIDocumentation";
import ComponentDocumentation from "./ComponentDocumentation";
import { getDatabaseDocumentation } from "./DatabaseDocumentation";
import {
  ComponentDocumentationBuilder,
  ComponentDocumentationContext,
} from "./DocumentationContext";
import {
  getDiscordDocumentation,
  getMicrosoftTeamsDocumentation,
  getSendEmailDocumentation,
  getSlackDocumentation,
  getTelegramDocumentation,
} from "./MessagingDocumentation";
import {
  getManualDocumentation,
  getScheduleDocumentation,
  getWebhookDocumentation,
} from "./TriggerDocumentation";
import {
  getExecuteWorkflowDocumentation,
  getIfElseDocumentation,
  getJavaScriptDocumentation,
  getJsonToTextDocumentation,
  getLogDocumentation,
  getMergeJsonDocumentation,
  getSleepDocumentation,
  getTextToJsonDocumentation,
} from "./UtilityDocumentation";

export const BUILT_IN_COMPONENT_DOCUMENTATION: Record<
  ComponentID,
  ComponentDocumentationBuilder
> = {
  [ComponentID.Webhook]: getWebhookDocumentation,
  [ComponentID.Schedule]: getScheduleDocumentation,
  [ComponentID.Manual]: getManualDocumentation,
  [ComponentID.Log]: getLogDocumentation,
  [ComponentID.SlackSendMessageToChannel]: getSlackDocumentation,
  [ComponentID.MicrosoftTeamsSendMessageToChannel]:
    getMicrosoftTeamsDocumentation,
  [ComponentID.DiscordSendMessageToChannel]: getDiscordDocumentation,
  [ComponentID.TelegramSendMessageToChat]: getTelegramDocumentation,
  [ComponentID.JavaScriptCode]: getJavaScriptDocumentation,
  [ComponentID.JsonToText]: getJsonToTextDocumentation,
  [ComponentID.TextToJson]: getTextToJsonDocumentation,
  [ComponentID.MergeJson]: getMergeJsonDocumentation,
  [ComponentID.ApiGet]: getApiGetDocumentation,
  [ComponentID.ApiPut]: getApiPutDocumentation,
  [ComponentID.ApiPost]: getApiPostDocumentation,
  [ComponentID.ApiDelete]: getApiDeleteDocumentation,
  [ComponentID.ApiPatch]: getApiPatchDocumentation,
  [ComponentID.SendEmail]: getSendEmailDocumentation,
  [ComponentID.IfElse]: getIfElseDocumentation,
  [ComponentID.WorkflowRun]: getExecuteWorkflowDocumentation,
  [ComponentID.Sleep]: getSleepDocumentation,
  [ComponentID.AIGenerateText]: getAIGenerateTextDocumentation,
};

export type GetComponentDocumentationFunction = (data: {
  metadata: ComponentMetadata;
  /** The step's identifier, as it stands in the dialog. */
  stepId: string;
  /** Every step in the workflow, so examples can use the real ones. */
  graphComponents?: Array<NodeDataProp> | undefined;
}) => ComponentDocumentation | null;

/**
 * The step's help, or null for a step that has none - which only a step
 * this table does not know about can be.
 */
export const getComponentDocumentation: GetComponentDocumentationFunction =
  (data: {
    metadata: ComponentMetadata;
    stepId: string;
    graphComponents?: Array<NodeDataProp> | undefined;
  }): ComponentDocumentation | null => {
    const context: ComponentDocumentationContext = {
      metadata: data.metadata,
      stepId: data.stepId,
      graphComponents: data.graphComponents || [],
    };

    if (data.metadata.tableName) {
      return getDatabaseDocumentation(context);
    }

    const builder: ComponentDocumentationBuilder | undefined =
      BUILT_IN_COMPONENT_DOCUMENTATION[data.metadata.id as ComponentID];

    return builder ? builder(context) : null;
  };

export default getComponentDocumentation;
