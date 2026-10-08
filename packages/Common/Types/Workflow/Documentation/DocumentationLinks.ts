/*
 * Where a step's help points for the full story. Paths on the docs site are
 * the English pages' heading anchors; ComponentDocumentation.test.ts checks
 * every one of them against packages/App/FeatureSet/Docs/Content/en, so a
 * renamed heading fails a test rather than landing people at the top of a
 * page.
 */

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  ComponentDocumentationLink,
  ComponentDocumentationLinkSite,
} from "./ComponentDocumentation";

export type DocsLinkFunction = (
  title: string,
  path: string,
) => ComponentDocumentationLink;

/** A page of OneUptime's docs, by its path under /docs. */
export const docsLink: DocsLinkFunction = (
  title: string,
  path: string,
): ComponentDocumentationLink => {
  return { title: title, site: ComponentDocumentationLinkSite.Docs, path };
};

/** A page anywhere else. */
export const externalLink: DocsLinkFunction = (
  title: string,
  url: string,
): ComponentDocumentationLink => {
  return {
    title: title,
    site: ComponentDocumentationLinkSite.External,
    path: url,
  };
};

export type ModelReferenceLinkFunction = (
  model: BaseModel,
) => ComponentDocumentationLink;

/*
 * The model's page in the API reference, which lists every field with its
 * type and an example.
 */
export const modelReferenceLink: ModelReferenceLinkFunction = (
  model: BaseModel,
): ComponentDocumentationLink => {
  return {
    title: `Every ${model.singularName || "record"} field`,
    site: ComponentDocumentationLinkSite.APIReference,
    path: `/${model.getAPIDocumentationPath()}`,
  };
};

export const WorkflowDocsPaths: {
  readonly triggers: string;
  readonly webhookTrigger: string;
  readonly incomingEmailTrigger: string;
  readonly inboundEmailSetup: string;
  readonly scheduleTrigger: string;
  readonly manualTrigger: string;
  readonly eventTriggers: string;
  readonly api: string;
  readonly ai: string;
  readonly slack: string;
  readonly microsoftTeams: string;
  readonly discord: string;
  readonly telegram: string;
  readonly irc: string;
  readonly email: string;
  readonly customCode: string;
  readonly json: string;
  readonly conditions: string;
  readonly sleep: string;
  readonly log: string;
  readonly executeWorkflow: string;
  readonly records: string;
  readonly componentOutputs: string;
  readonly loops: string;
  readonly globalVariables: string;
  readonly secrets: string;
  readonly aiSafety: string;
  readonly networkAccess: string;
  readonly runsAndLogs: string;
} = {
  triggers: "/workflows/triggers",
  webhookTrigger: "/workflows/triggers#webhook",
  incomingEmailTrigger: "/workflows/triggers#incoming-email",
  inboundEmailSetup: "/self-hosted/sendgrid-inbound-email",
  scheduleTrigger: "/workflows/triggers#schedule",
  manualTrigger: "/workflows/triggers#manual",
  eventTriggers: "/workflows/triggers#oneuptime-event-triggers",
  api: "/workflows/components#api",
  ai: "/workflows/components#generate-text-with-ai",
  slack: "/workflows/components#slack",
  microsoftTeams: "/workflows/components#microsoft-teams",
  discord: "/workflows/components#discord",
  telegram: "/workflows/components#telegram",
  irc: "/workflows/components#irc",
  email: "/workflows/components#email",
  customCode: "/workflows/components#custom-code",
  json: "/workflows/components#json",
  conditions: "/workflows/components#conditions",
  sleep: "/workflows/components#sleep",
  log: "/workflows/components#log",
  executeWorkflow: "/workflows/components#execute-workflow",
  records: "/workflows/components#working-with-records",
  componentOutputs:
    "/workflows/variables#component-outputs-data-from-earlier-blocks",
  loops: "/workflows/variables#looping-over-arrays",
  globalVariables: "/workflows/variables#global-variables",
  secrets: "/workflows/configuration#secrets",
  aiSafety: "/workflows/configuration#ai-components",
  networkAccess: "/workflows/configuration#outbound-network-access",
  runsAndLogs: "/workflows/runs-and-logs",
};
