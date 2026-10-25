import ObjectID from "../../../../Types/ObjectID";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import AIChatPageContextType, {
  AIChatPageContext,
} from "../../../../Types/AI/AIChatPageContext";
import { AIResourceType } from "../../../../Types/AI/AIResourceContext";
import { KubernetesClusterAiAccessStatus } from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import {
  LIST_CLUSTER_ACCESS_TOOL_NAME,
  RUN_KUBECTL_TOOL_NAME,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccessToolNames";
import { ResourceAiAccessStatus } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import AiResourceType, {
  isAiResourceType,
} from "../../../../Types/ResourceAiAgent/AiResourceType";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import AlertService from "../../../Services/AlertService";
import IncidentService from "../../../Services/IncidentService";
import KubernetesClusterAiAccessService from "../../../Services/KubernetesClusterAiAccessService";
import ResourceAiAccessService from "../../../Services/ResourceAiAccessService";
import ClusterAccessContext from "../ClusterAccess/ClusterAccessContext";
import KubectlInvestigationToolkit from "../ClusterAccess/KubectlInvestigationToolkit";
import ResourceAccessContext from "../ResourceAccess/ResourceAccessContext";
import InfrastructureInvestigationToolkit from "../ResourceAccess/InfrastructureInvestigationToolkit";
import {
  LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
  RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
} from "../ResourceAccess/ResourceAccessToolNames";
import ToolOutputPager, { READ_TOOL_OUTPUT_TOOL_NAME } from "./ToolOutputPager";
import { ChatExtraTool } from "./ChatAgentRunner";
import logger from "../../Logger";

/*
 * The infrastructure one chat turn may run read-only commands on, and the
 * tools that run them: the kubectl and infrastructure command toolkits an
 * investigation has, bound to the turn's AI run.
 *
 * Two kinds of conversation reach infrastructure:
 *
 *  - the shared thread of an incident's or alert's AI investigation box
 *    (InvestigationThread): the clusters and resources the incident or
 *    alert is linked to;
 *  - a personal Ask AI conversation (buildForPage): the infrastructure its
 *    subject - the page it was asked from, else the subject it kept - is
 *    about. That is the resource or Kubernetes cluster on the page, or the
 *    clusters and resources an incident or alert on the page is linked to.
 *    Issue #5259: on a host's page, with the Host AI agent connected,
 *    "Call 'uptime' command on remote host" was answered "I don't have a
 *    tool that can execute commands on remote hosts" - the commands an
 *    investigation of that host could run were never offered to Ask AI.
 *
 * Either way the commands are the person asking's: they reach only the
 * clusters and resources that person may view (the services'
 * getStatusesViewableBy), and nothing is said about the others beyond that
 * some were left out. An incident or alert the person may not read offers
 * nothing at all, since its links are part of what they may not read. And
 * either way the commands only read: the toolkits refuse anything but the
 * Read tier, and so do the enqueue chokepoint and the agent. A chat never
 * changes infrastructure; changes go through AI remediation, or a person.
 */

/*
 * Told to the model when some of the infrastructure a conversation is
 * about is left out of it because the person asking may not view it: it
 * names none of it, and lets the answer say why a command cannot run for
 * this person.
 */
export const INFRASTRUCTURE_OUT_OF_VIEW_SECTION: string = [
  "# Infrastructure out of view",
  "Some of the infrastructure linked to this conversation is left out of it because the person asking may not view it in OneUptime, so you cannot run commands on it for them. If they ask about it, tell them so, and that someone who may view it can ask instead.",
].join("\n");

// The heading of the instructions a personal conversation gets.
export const PAGE_INFRASTRUCTURE_SECTION_HEADING: string =
  "# Commands on infrastructure";

/*
 * The clusters and resources a conversation is about, with OneUptime AI's
 * access to each (ready or not, and why not).
 */
export interface ChatInfrastructureStatuses {
  clusters: Array<KubernetesClusterAiAccessStatus>;
  resources: Array<ResourceAiAccessStatus>;
}

// What one turn may reach, for the person asking.
export interface ChatInfrastructureTools {
  /*
   * list_cluster_access and run_kubectl, list_infrastructure_access and
   * run_infrastructure_command - for the ready clusters and resources only -
   * and read_tool_output, which reads every toolkit's long outputs, when
   * there is any of them. Never a mutation.
   */
  extraTools: Array<ChatExtraTool>;
  hasClusterAccess: boolean;
  hasInfrastructureAccess: boolean;
  /*
   * Whether a cluster or resource the person may view offers no commands
   * (no agent, an agent offline, investigation off, …): the sections below
   * say why, and what would change it.
   */
  hasInfrastructureWithoutAccess: boolean;
  /*
   * The prompt sections: "# Cluster access" and "# Infrastructure access"
   * (what each viewable cluster and resource offers, or why it offers
   * nothing), and INFRASTRUCTURE_OUT_OF_VIEW_SECTION when some were left
   * out.
   */
  contextSections: Array<string>;
}

// What a personal conversation's turn adds to its tools and its prompt.
export interface ChatPageInfrastructure {
  extraTools: Array<ChatExtraTool>;
  instructions: string;
}

export default class ChatInfrastructureAccess {
  /*
   * The resource AI agent type of a page's resource type, or null for a
   * resource without one (a Kubernetes cluster has its own agent, and
   * storage arrays, serverless functions, cloud environments, IoT fleets
   * and network devices have none). The two enums share their values.
   */
  public static getAiResourceType(
    resourceType: AIResourceType | undefined,
  ): AiResourceType | null {
    return isAiResourceType(resourceType)
      ? (resourceType as unknown as AiResourceType)
      : null;
  }

  /*
   * The clusters and resources a personal conversation's subject is about:
   * the resource or Kubernetes cluster of a resource page, or what an
   * incident or alert is linked to - when the person asking may read that
   * incident or alert. Any other page is about none. Statuses are read as
   * root (they say what OneUptime AI may do, not what the person may see);
   * buildTools decides what the person may view. A lookup that fails
   * throws: the caller decides what that means.
   */
  public static async getStatusesForPage(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    pageContext: AIChatPageContext | undefined;
  }): Promise<ChatInfrastructureStatuses> {
    const none: ChatInfrastructureStatuses = { clusters: [], resources: [] };
    const context: AIChatPageContext | undefined = data.pageContext;

    if (!context?.entityId || !ObjectID.isValidUUID(context.entityId)) {
      return none;
    }

    const entityId: ObjectID = new ObjectID(context.entityId);

    if (context.type === AIChatPageContextType.Resource) {
      if (context.resourceType === AIResourceType.KubernetesCluster) {
        const cluster: KubernetesClusterAiAccessStatus | null =
          await KubernetesClusterAiAccessService.getStatusForCluster({
            clusterId: entityId,
            projectId: data.projectId,
          });

        return { clusters: cluster ? [cluster] : [], resources: [] };
      }

      const resourceType: AiResourceType | null = this.getAiResourceType(
        context.resourceType,
      );

      if (!resourceType) {
        return none;
      }

      const resource: ResourceAiAccessStatus | null =
        await ResourceAiAccessService.getStatusForResource({
          projectId: data.projectId,
          resourceType,
          resourceId: entityId,
        });

      return { clusters: [], resources: resource ? [resource] : [] };
    }

    if (
      context.type !== AIChatPageContextType.Incident &&
      context.type !== AIChatPageContextType.Alert
    ) {
      return none;
    }

    const subject: { incidentId: ObjectID } | { alertId: ObjectID } =
      context.type === AIChatPageContextType.Incident
        ? { incidentId: entityId }
        : { alertId: entityId };

    const isReadable: boolean = await this.canReadSubject({
      projectId: data.projectId,
      props: data.props,
      type: context.type,
      id: entityId,
    });

    if (!isReadable) {
      return none;
    }

    const [clusters, resources]: [
      Array<KubernetesClusterAiAccessStatus>,
      Array<ResourceAiAccessStatus>,
    ] = await Promise.all([
      KubernetesClusterAiAccessService.getStatusesForSubject({
        projectId: data.projectId,
        ...subject,
      }),
      ResourceAiAccessService.getStatusesForSubject({
        projectId: data.projectId,
        ...subject,
      }),
    ]);

    return { clusters, resources };
  }

  /*
   * Whether the person asking may read this incident or alert of the
   * project, as a read of it through the API decides: a page context is
   * whatever the client sent, and an incident's links are part of the
   * incident. Fails closed.
   */
  private static async canReadSubject(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    type: AIChatPageContextType.Incident | AIChatPageContextType.Alert;
    id: ObjectID;
  }): Promise<boolean> {
    const props: DatabaseCommonInteractionProps = {
      ...data.props,
      tenantId: data.projectId,
      isMultiTenantRequest: false,
    };

    const query: { _id: string; projectId: ObjectID } = {
      _id: data.id.toString(),
      projectId: data.projectId,
    };

    try {
      const subject: Incident | Alert | null =
        data.type === AIChatPageContextType.Incident
          ? await IncidentService.findOneBy({
              query,
              select: { _id: true },
              props,
            })
          : await AlertService.findOneBy({
              query,
              select: { _id: true },
              props,
            });

      return Boolean(subject);
    } catch {
      return false;
    }
  }

  /*
   * The command tools and the prompt sections for these clusters and
   * resources, for the person asking: only the ones they may view, each
   * check deciding on its own and failing closed (a check that cannot run
   * throws, and nothing is offered). One output pager serves the turn, so
   * read_tool_output reads every toolkit's long outputs.
   */
  public static async buildTools(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
    props: DatabaseCommonInteractionProps;
    statuses: ChatInfrastructureStatuses;
    // Where the tools are offered, for the log: "the incident thread".
    offeredIn: string;
  }): Promise<ChatInfrastructureTools> {
    const linkedCount: number =
      data.statuses.clusters.length + data.statuses.resources.length;

    const clusters: Array<KubernetesClusterAiAccessStatus> =
      await KubernetesClusterAiAccessService.getStatusesViewableBy({
        props: data.props,
        projectId: data.projectId,
        statuses: data.statuses.clusters,
      });

    const resources: Array<ResourceAiAccessStatus> =
      await ResourceAiAccessService.getStatusesViewableBy({
        props: data.props,
        projectId: data.projectId,
        statuses: data.statuses.resources,
      });

    const isAnyWithheld: boolean =
      clusters.length + resources.length < linkedCount;

    const outputPager: ToolOutputPager = new ToolOutputPager();
    const extraTools: Array<ChatExtraTool> = [];

    const kubectlTools: Array<ChatExtraTool> = new KubectlInvestigationToolkit(
      {
        projectId: data.projectId,
        aiRunId: data.aiRunId,
        clusters,
        outputPager,
      },
    ).buildTools();
    extraTools.push(...kubectlTools);

    let infrastructureTools: Array<ChatExtraTool> = [];

    try {
      infrastructureTools = new InfrastructureInvestigationToolkit({
        projectId: data.projectId,
        aiRunId: data.aiRunId,
        resources,
        outputPager,
      }).buildTools();
      extraTools.push(...infrastructureTools);
    } catch (error) {
      logger.error(
        `AI: could not offer infrastructure commands in ${data.offeredIn}: ${error}`,
      );
    }

    if (extraTools.length > 0) {
      extraTools.push(outputPager.buildReadTool());
    }

    const contextSections: Array<string> = [
      ClusterAccessContext.buildContextSection(clusters).trim(),
      ResourceAccessContext.buildContextSection(resources).trim(),
    ].filter((section: string): boolean => {
      return section.length > 0;
    });

    if (isAnyWithheld) {
      contextSections.push(INFRASTRUCTURE_OUT_OF_VIEW_SECTION);
    }

    return {
      extraTools,
      hasClusterAccess: kubectlTools.length > 0,
      hasInfrastructureAccess: infrastructureTools.length > 0,
      hasInfrastructureWithoutAccess:
        clusters.some((cluster: KubernetesClusterAiAccessStatus): boolean => {
          return !cluster.isInvestigationReady;
        }) ||
        resources.some((resource: ResourceAiAccessStatus): boolean => {
          return !resource.isInvestigationReady;
        }),
      contextSections,
    };
  }

  /*
   * The standing instructions of a personal conversation about
   * infrastructure, or "" when there is nothing to instruct (everything it
   * is about is out of the person's view, which its own section says).
   * Pure - the tests pin its promises: the commands it runs when asked, one
   * program per call, read-only, and what it says when a resource cannot
   * be reached.
   */
  public static buildPageInstructions(data: {
    hasClusterAccess: boolean;
    hasInfrastructureAccess: boolean;
    hasInfrastructureWithoutAccess: boolean;
  }): string {
    const lines: Array<string> = [];

    if (data.hasInfrastructureAccess || data.hasClusterAccess) {
      const ways: Array<string> = [];

      if (data.hasInfrastructureAccess) {
        ways.push(
          `${RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME} on the resources marked READ access below, through each one's AI agent (${LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME} lists them)`,
        );
      }

      if (data.hasClusterAccess) {
        ways.push(
          `${RUN_KUBECTL_TOOL_NAME} on the Kubernetes clusters marked READ access below (${LIST_CLUSTER_ACCESS_TOOL_NAME} lists them)`,
        );
      }

      lines.push(
        `- You can run read-only commands on the infrastructure this conversation is about, the way an on-call engineer opens a terminal on it: ${ways.join(
          ", and ",
        )}. When the user asks you to run a command or to check something on it live (for example "run uptime on this host"), run the command and show what it returned, cited [C#] - never answer from telemetry instead, and never say you have no tool for it.`,
        "- One command per call: a program followed by its arguments, never a shell line (no pipes, redirects, ;, &&, $( ) or sudo). For several commands, make several calls.",
        "- These commands only read. When the answer is a change (restart or stop a service, kill a process, scale, roll back, …), do not try it: give the exact command and what it would change, and say that a person can run it, or that OneUptime AI applies such fixes when it remediates an incident or alert on this resource with fixes turned on. Never claim you changed the infrastructure.",
        `- When a tool output is long you see its first page; read the rest with ${READ_TOOL_OUTPUT_TOOL_NAME} whenever the part you need is further down. Never say something was not in an output you did not fully read.`,
      );
    }

    if (data.hasInfrastructureWithoutAccess) {
      lines.push(
        "- For a resource or cluster marked NO direct access below, you cannot run commands on it. When the user asks for a command there, or for something only a command can answer, say so, with the reason and the next step given below, and answer what you can from OneUptime's own data. Do not bring this up otherwise, and never invent command output.",
      );
    }

    if (lines.length === 0) {
      return "";
    }

    return [PAGE_INFRASTRUCTURE_SECTION_HEADING, ...lines].join("\n");
  }

  /*
   * What a personal conversation's turn may run, for its subject's page:
   * the command tools, and the instructions and access sections its prompt
   * adds. Null when the page is about no infrastructure, as an incident or
   * alert the person asking may not read is. Never throws: a lookup that
   * fails leaves the turn answering from OneUptime's own data, as before.
   */
  public static async buildForPage(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
    props: DatabaseCommonInteractionProps;
    pageContext: AIChatPageContext | undefined;
  }): Promise<ChatPageInfrastructure | null> {
    try {
      const statuses: ChatInfrastructureStatuses =
        await this.getStatusesForPage({
          projectId: data.projectId,
          props: data.props,
          pageContext: data.pageContext,
        });

      if (statuses.clusters.length + statuses.resources.length === 0) {
        return null;
      }

      const tools: ChatInfrastructureTools = await this.buildTools({
        projectId: data.projectId,
        aiRunId: data.aiRunId,
        props: data.props,
        statuses,
        offeredIn: "an Ask AI conversation",
      });

      if (tools.contextSections.length === 0) {
        return null;
      }

      return {
        extraTools: tools.extraTools,
        instructions: [
          this.buildPageInstructions({
            hasClusterAccess: tools.hasClusterAccess,
            hasInfrastructureAccess: tools.hasInfrastructureAccess,
            hasInfrastructureWithoutAccess:
              tools.hasInfrastructureWithoutAccess,
          }),
          ...tools.contextSections,
        ]
          .filter((section: string): boolean => {
            return section.length > 0;
          })
          .join("\n\n"),
      };
    } catch (error) {
      logger.error(
        `AI: could not resolve the infrastructure an Ask AI conversation is about; it answers from OneUptime's data only: ${error}`,
      );

      return null;
    }
  }
}
