import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIChatPageContextType, {
  AIChatPageContext,
} from "../../../../Types/AI/AIChatPageContext";
import { KubernetesClusterAiAccessStatus } from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { ResourceAiAccessStatus } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import AIConversation from "../../../../Models/DatabaseModels/AIConversation";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AIConversationService from "../../../Services/AIConversationService";
import AIRunService from "../../../Services/AIRunService";
import IncidentService from "../../../Services/IncidentService";
import AlertService from "../../../Services/AlertService";
import KubernetesClusterAiAccessService from "../../../Services/KubernetesClusterAiAccessService";
import ResourceAiAccessService from "../../../Services/ResourceAiAccessService";
import ClusterAccessContext from "../ClusterAccess/ClusterAccessContext";
import KubectlInvestigationToolkit from "../ClusterAccess/KubectlInvestigationToolkit";
import ResourceAccessContext from "../ResourceAccess/ResourceAccessContext";
import InfrastructureInvestigationToolkit from "../ResourceAccess/InfrastructureInvestigationToolkit";
import ToolOutputPager, {
  READ_TOOL_OUTPUT_TOOL_NAME,
} from "../Chat/ToolOutputPager";
import { ChatExtraTool } from "../Chat/ChatAgentRunner";
import PostedRootCause from "./PostedRootCause";
import logger from "../../Logger";
import PromptText from "../../../../Utils/AI/PromptText";

/*
 * The shared conversation inside an incident's (or alert's) AI
 * investigation box.
 *
 * The autonomous investigation posts a report; this is where responders
 * talk to OneUptime AI about it — ask follow-up questions ("which pods use
 * the most memory?"), and ask it to act ("acknowledge this", "post a status
 * update"). There is exactly one thread per incident or alert, and everyone
 * who can read the subject reads and writes it, so it is an AIConversation
 * with incidentId / alertId set and no owning user (the personal-chat
 * privacy pin keeps it out of everyone's Ask AI history). The investigation
 * API checks the viewer can read the subject before it touches the thread.
 *
 * Every turn runs the regular chat agent (ChatAgentRunner) in shared-thread
 * mode, primed with what this module builds: the subject, the autonomous
 * investigation's report, which clusters and resources AI can reach — and
 * the same read-only kubectl / infrastructure command tools the
 * investigation had, so a follow-up can open a terminal on the cluster too.
 */

export type InvestigationThreadSubjectType = "incident" | "alert";

export interface InvestigationThreadSubject {
  type: InvestigationThreadSubjectType;
  id: ObjectID;
}

// LlmLog label for thread turns.
export const INVESTIGATION_THREAD_FEATURE: string =
  "AI Investigation Conversation";

// The report is our own output, but a pathological one must not crowd out the thread.
export const MAX_THREAD_REPORT_CHARS: number = 24_000;

export interface InvestigationThreadSubjectDetails {
  // "Incident #42" / "Alert #7" (or just the noun when unnumbered).
  label: string;
  title: string;
  summary: string;
  pageContext: AIChatPageContext;
}

export interface InvestigationThreadLatestInvestigation {
  status: AIRunStatus | null;
  startedAt?: Date | undefined;
  completedAt?: Date | undefined;
  errorMessage?: string | undefined;
  analysisMarkdown: string | null;
  analysisTldr?: string | undefined;
}

export interface InvestigationThreadTurnContext {
  additionalSystemInstructions: string;
  extraTools: Array<ChatExtraTool>;
  pageContext: AIChatPageContext;
  title: string;
}

export default class InvestigationThread {
  public static getSubjectQuery(
    subject: InvestigationThreadSubject,
  ): { incidentId: ObjectID } | { alertId: ObjectID } {
    return subject.type === "incident"
      ? { incidentId: subject.id }
      : { alertId: subject.id };
  }

  // The subject's thread, or null when nobody has asked anything yet.
  public static async findThread(data: {
    projectId: ObjectID;
    subject: InvestigationThreadSubject;
  }): Promise<AIConversation | null> {
    return AIConversationService.findOneBy({
      query: {
        projectId: data.projectId,
        ...this.getSubjectQuery(data.subject),
      },
      select: {
        _id: true,
        title: true,
        llmProviderId: true,
        createdAt: true,
      },
      // The oldest thread wins if a race ever created two.
      sort: { createdAt: SortOrder.Ascending },
      props: { isRoot: true },
    });
  }

  /*
   * The subject's thread, created on the first question. Two responders
   * asking at the same moment can both create one; whoever created a
   * thread that is not the oldest deletes it again and joins the oldest,
   * so the subject always ends up with exactly one.
   */
  public static async findOrCreateThread(data: {
    projectId: ObjectID;
    subject: InvestigationThreadSubject;
    title: string;
  }): Promise<AIConversation> {
    const existing: AIConversation | null = await this.findThread(data);

    if (existing) {
      return existing;
    }

    const conversation: AIConversation = new AIConversation();
    conversation.projectId = data.projectId;
    conversation.title = data.title.substring(0, 90);

    if (data.subject.type === "incident") {
      conversation.incidentId = data.subject.id;
    } else {
      conversation.alertId = data.subject.id;
    }

    const created: AIConversation = await AIConversationService.create({
      data: conversation,
      props: { isRoot: true },
    });

    const oldest: AIConversation | null = await this.findThread(data);

    if (oldest && oldest.id?.toString() !== created.id?.toString()) {
      await AIConversationService.deleteOneById({
        id: created.id!,
        props: { isRoot: true },
      }).catch((error: unknown) => {
        logger.error(
          `AI: could not remove a duplicate investigation thread ${created.id?.toString()}: ${error}`,
        );
      });

      return oldest;
    }

    return created;
  }

  // What the thread is about, read as root (the caller checked access).
  public static async getSubjectDetails(data: {
    projectId: ObjectID;
    subject: InvestigationThreadSubject;
  }): Promise<InvestigationThreadSubjectDetails> {
    if (data.subject.type === "incident") {
      const incident: Incident | null = await IncidentService.findOneById({
        id: data.subject.id,
        select: {
          _id: true,
          title: true,
          description: true,
          incidentNumber: true,
          incidentNumberWithPrefix: true,
          createdAt: true,
          declaredAt: true,
          rootCause: true,
          incidentSeverity: { name: true },
          currentIncidentState: { name: true },
          monitors: { name: true },
          labels: { name: true },
        },
        props: { isRoot: true },
      });

      return this.describeIncident(incident, data.subject.id);
    }

    const alert: Alert | null = await AlertService.findOneById({
      id: data.subject.id,
      select: {
        _id: true,
        title: true,
        description: true,
        alertNumber: true,
        createdAt: true,
        rootCause: true,
        alertSeverity: { name: true },
        currentAlertState: { name: true },
        monitor: { name: true },
        labels: { name: true },
      },
      props: { isRoot: true },
    });

    return this.describeAlert(alert, data.subject.id);
  }

  public static describeIncident(
    incident: Incident | null,
    incidentId: ObjectID,
  ): InvestigationThreadSubjectDetails {
    const number: string =
      incident?.incidentNumberWithPrefix ||
      (incident?.incidentNumber !== undefined &&
      incident?.incidentNumber !== null
        ? `#${incident.incidentNumber}`
        : "");
    const label: string = number ? `Incident ${number}` : "Incident";
    const title: string = incident?.title || "Untitled incident";

    const lines: Array<string> = [
      `# ${label}: ${title}`,
      `incidentId: ${incidentId.toString()}`,
    ];

    /*
     * Sent with every turn: free text goes in through PromptText.field, so a
     * screenshot embedded in the description is a short note, not hundreds
     * of kilobytes of base64, and no field crowds out the thread.
     */
    if (incident?.description) {
      lines.push(`Description: ${PromptText.field(incident.description)}`);
    }

    lines.push(`Severity: ${incident?.incidentSeverity?.name || "N/A"}`);
    lines.push(
      `Current state: ${incident?.currentIncidentState?.name || "N/A"}`,
    );

    const declaredAt: Date | undefined =
      incident?.declaredAt || incident?.createdAt;

    if (declaredAt) {
      lines.push(
        `Declared at: ${OneUptimeDate.getDateAsFormattedString(declaredAt)}`,
      );
    }

    const monitors: string = (incident?.monitors || [])
      .map((monitor: { name?: string }): string => {
        return monitor.name || "";
      })
      .filter(Boolean)
      .join(", ");

    if (monitors) {
      lines.push(`Affected monitors: ${monitors}`);
    }

    const labels: string = (incident?.labels || [])
      .map((item: { name?: string }): string => {
        return item.name || "";
      })
      .filter(Boolean)
      .join(", ");

    if (labels) {
      lines.push(`Labels: ${labels}`);
    }

    if (incident?.rootCause) {
      lines.push(
        `Root cause (as recorded by responders): ${PromptText.field(incident.rootCause)}`,
      );
    }

    return {
      label,
      title,
      summary: lines.join("\n"),
      pageContext: {
        type: AIChatPageContextType.Incident,
        entityId: incidentId.toString(),
        entityTitle: `${number ? `${number} ` : ""}${title}`.substring(0, 200),
      },
    };
  }

  public static describeAlert(
    alert: Alert | null,
    alertId: ObjectID,
  ): InvestigationThreadSubjectDetails {
    const number: string =
      alert?.alertNumber !== undefined && alert?.alertNumber !== null
        ? `#${alert.alertNumber}`
        : "";
    const label: string = number ? `Alert ${number}` : "Alert";
    const title: string = alert?.title || "Untitled alert";

    const lines: Array<string> = [
      `# ${label}: ${title}`,
      `alertId: ${alertId.toString()}`,
    ];

    if (alert?.description) {
      lines.push(`Description: ${PromptText.field(alert.description)}`);
    }

    lines.push(`Severity: ${alert?.alertSeverity?.name || "N/A"}`);
    lines.push(`Current state: ${alert?.currentAlertState?.name || "N/A"}`);

    if (alert?.createdAt) {
      lines.push(
        `Created at: ${OneUptimeDate.getDateAsFormattedString(alert.createdAt)}`,
      );
    }

    if (alert?.monitor?.name) {
      lines.push(`Monitor: ${alert.monitor.name}`);
    }

    const labels: string = (alert?.labels || [])
      .map((item: { name?: string }): string => {
        return item.name || "";
      })
      .filter(Boolean)
      .join(", ");

    if (labels) {
      lines.push(`Labels: ${labels}`);
    }

    if (alert?.rootCause) {
      lines.push(
        `Root cause (as recorded by responders): ${PromptText.field(alert.rootCause)}`,
      );
    }

    return {
      label,
      title,
      summary: lines.join("\n"),
      pageContext: {
        type: AIChatPageContextType.Alert,
        entityId: alertId.toString(),
        entityTitle: `${number ? `${number} ` : ""}${title}`.substring(0, 200),
      },
    };
  }

  // The latest autonomous investigation of the subject and its report.
  public static async getLatestInvestigation(data: {
    projectId: ObjectID;
    subject: InvestigationThreadSubject;
  }): Promise<InvestigationThreadLatestInvestigation> {
    const run: AIRun | null = await AIRunService.findOneBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.Investigation,
        ...(data.subject.type === "incident"
          ? { triggeredByIncidentId: data.subject.id }
          : { triggeredByAlertId: data.subject.id }),
      },
      select: {
        _id: true,
        status: true,
        startedAt: true,
        completedAt: true,
        errorMessage: true,
        analysisTldr: true,
      },
      sort: { createdAt: SortOrder.Descending },
      props: { isRoot: true },
    });

    if (!run) {
      return { status: null, analysisMarkdown: null };
    }

    let analysisMarkdown: string | null = null;

    if (run.status === AIRunStatus.Completed) {
      analysisMarkdown = await PostedRootCause.getForInvestigation({
        ...(data.subject.type === "incident"
          ? { incidentId: data.subject.id }
          : { alertId: data.subject.id }),
        aiRunId: run.id!,
        runCompletedAt: run.completedAt,
      });
    }

    return {
      status: run.status || null,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      errorMessage: run.errorMessage,
      analysisMarkdown,
      analysisTldr: run.analysisTldr,
    };
  }

  // The "# The autonomous investigation" block of the thread prompt.
  public static buildInvestigationSection(
    latest: InvestigationThreadLatestInvestigation,
    subjectNoun: string,
  ): string {
    const lines: Array<string> = ["# The autonomous investigation"];

    if (latest.status === null) {
      lines.push(
        `No autonomous AI investigation has run for this ${subjectNoun}. You are the first to look: investigate from scratch with your tools.`,
      );
      return lines.join("\n");
    }

    if (
      latest.status === AIRunStatus.Queued ||
      latest.status === AIRunStatus.Running
    ) {
      lines.push(
        `OneUptime AI's autonomous investigation of this ${subjectNoun} is still ${
          latest.status === AIRunStatus.Queued ? "queued" : "running"
        }${
          latest.startedAt
            ? ` (started ${OneUptimeDate.getDateAsFormattedString(latest.startedAt)})`
            : ""
        }. Its report is not ready yet — answer from your own queries, and say so if the question is really "what is the root cause" (the report will appear above this conversation when it lands).`,
      );
      return lines.join("\n");
    }

    if (latest.status !== AIRunStatus.Completed) {
      lines.push(
        `The autonomous investigation of this ${subjectNoun} did not finish${
          latest.errorMessage ? ` (${latest.errorMessage})` : ""
        }. Investigate from scratch with your tools.`,
      );
      return lines.join("\n");
    }

    if (!latest.analysisMarkdown) {
      lines.push(
        `The autonomous investigation of this ${subjectNoun} finished without publishing a report. Investigate with your tools.`,
      );
      return lines.join("\n");
    }

    const report: string =
      latest.analysisMarkdown.length > MAX_THREAD_REPORT_CHARS
        ? `${latest.analysisMarkdown.substring(0, MAX_THREAD_REPORT_CHARS)}\n… [the rest of the report is on the ${subjectNoun} timeline]`
        : latest.analysisMarkdown;

    lines.push(
      `OneUptime AI already investigated this ${subjectNoun}${
        latest.completedAt
          ? ` (finished ${OneUptimeDate.getDateAsFormattedString(latest.completedAt)})`
          : ""
      } and posted the report below — the responders are looking at it right above this conversation. Treat it as your own earlier work: build on it, correct it when fresh data disagrees, and do not repeat it back unless asked. Its [C#] markers belong to that run, not to this conversation, so never cite them — cite only results you fetch here.`,
    );
    lines.push("<investigation_report>");
    lines.push(report.replace(/\s?\[C\d+\]/g, ""));
    lines.push("</investigation_report>");

    return lines.join("\n");
  }

  /*
   * The thread's standing instructions. Pure — the tests pin the promises
   * it makes (shared thread, attribution, no budget, act only when asked).
   */
  public static buildThreadInstructions(data: {
    subjectLabel: string;
    subjectTitle: string;
    subjectNoun: string;
    hasClusterAccess: boolean;
    hasInfrastructureAccess: boolean;
  }): string {
    const lines: Array<string> = [
      "# This conversation",
      `You are OneUptime AI, working alongside the responders on ${data.subjectLabel} "${data.subjectTitle}", inside its AI investigation box. This is a SHARED thread: every responder who can see this ${data.subjectNoun} reads it and can ask you questions or ask you to do things. Each question starts with "[Name asks]" — answer that person, and use what others asked earlier in the thread.`,
      "",
      "How to work:",
      "- Lead with the answer, then the evidence. Be conversational and concise: short paragraphs and bullets, no report headings unless someone asks for a report.",
      "- Ground every factual claim in data you fetched in THIS conversation and cite it [C#]. Things change during an incident — when a question is about current state, query it fresh instead of repeating older findings.",
      "- There is no time or query budget. Investigate as deeply as the question needs — run as many queries and commands as it takes — then answer.",
      `- When a tool output is long you see its first page; read the rest with ${READ_TOOL_OUTPUT_TOOL_NAME} whenever the part you need is further down. Never say something was not in an output you did not fully read.`,
      "- When someone asks you to DO something (acknowledge or resolve, post a status update or internal note, change severity, page on-call, run a runbook, start a new investigation, …), use the matching tool, then say exactly what you did. Only act on what a responder clearly asked for; if the request is ambiguous, ask one short clarifying question instead of guessing.",
      "- If you could not do something (no permission, the action was denied, a cluster is unreachable), say so plainly and say what would unblock it.",
    ];

    if (data.hasClusterAccess) {
      lines.push(
        "- You can open a read-only terminal on the linked Kubernetes cluster(s) with run_kubectl: get/describe/logs/events/top/rollout status. Use it the way an on-call engineer would — e.g. `kubectl top pods -A --sort-by=memory`, `kubectl describe node <name>`, `kubectl get events -n <ns> --sort-by=.lastTimestamp`.",
      );
    }

    if (data.hasInfrastructureAccess) {
      lines.push(
        "- You can run read-only commands on the linked infrastructure resources with run_infrastructure_command.",
      );
    }

    if (data.hasClusterAccess || data.hasInfrastructureAccess) {
      lines.push(
        "- Commands here are read-only. When the fix is a change on the infrastructure (restart, scale, roll back, …), give the exact command and what it will change, and tell the responders it can be applied from the cluster's AI remediation (or by them) — never claim you changed infrastructure.",
      );
    }

    return lines.join("\n");
  }

  /*
   * Everything one turn needs besides the conversation itself: the prompt
   * section, the command tools bound to this turn's run, and the page
   * context that tells the base prompt which incident "this" is. Current
   * data every turn, so a responder who asks after the report landed (or
   * after a cluster came online) gets an AI that knows it. Enrichment
   * failures degrade to less context, never a failed turn.
   */
  public static async buildTurnContext(data: {
    projectId: ObjectID;
    subject: InvestigationThreadSubject;
    aiRunId: ObjectID;
  }): Promise<InvestigationThreadTurnContext> {
    const subjectNoun: string = data.subject.type;

    const details: InvestigationThreadSubjectDetails =
      await this.getSubjectDetails(data);

    let latest: InvestigationThreadLatestInvestigation = {
      status: null,
      analysisMarkdown: null,
    };

    try {
      latest = await this.getLatestInvestigation(data);
    } catch (error) {
      logger.error(
        `AI: could not read the latest investigation for ${subjectNoun} ${data.subject.id.toString()}; the thread continues without it: ${error}`,
      );
    }

    const statusQuery: { incidentId?: ObjectID; alertId?: ObjectID } =
      data.subject.type === "incident"
        ? { incidentId: data.subject.id }
        : { alertId: data.subject.id };

    let clusterStatuses: Array<KubernetesClusterAiAccessStatus> = [];

    try {
      clusterStatuses =
        await KubernetesClusterAiAccessService.getStatusesForSubject({
          projectId: data.projectId,
          ...statusQuery,
        });
    } catch (error) {
      logger.error(
        `AI: could not resolve cluster access for the ${subjectNoun} thread; continuing with OneUptime data only: ${error}`,
      );
    }

    let resourceStatuses: Array<ResourceAiAccessStatus> = [];

    try {
      resourceStatuses = await ResourceAiAccessService.getStatusesForSubject({
        projectId: data.projectId,
        ...statusQuery,
      });
    } catch (error) {
      logger.error(
        `AI: could not resolve infrastructure access for the ${subjectNoun} thread; continuing with OneUptime data only: ${error}`,
      );
    }

    // One pager for the turn, so read_tool_output reads every toolkit's output.
    const outputPager: ToolOutputPager = new ToolOutputPager();
    const extraTools: Array<ChatExtraTool> = [];

    const kubectlToolkit: KubectlInvestigationToolkit =
      new KubectlInvestigationToolkit({
        projectId: data.projectId,
        aiRunId: data.aiRunId,
        clusters: clusterStatuses,
        outputPager,
      });
    const kubectlTools: Array<ChatExtraTool> = kubectlToolkit.buildTools();
    extraTools.push(...kubectlTools);

    let infrastructureTools: Array<ChatExtraTool> = [];

    try {
      infrastructureTools = new InfrastructureInvestigationToolkit({
        projectId: data.projectId,
        aiRunId: data.aiRunId,
        resources: resourceStatuses,
        outputPager,
      }).buildTools();
      extraTools.push(...infrastructureTools);
    } catch (error) {
      logger.error(
        `AI: could not offer infrastructure commands in the ${subjectNoun} thread: ${error}`,
      );
    }

    if (extraTools.length > 0) {
      extraTools.push(outputPager.buildReadTool());
    }

    const sections: Array<string> = [
      this.buildThreadInstructions({
        subjectLabel: details.label,
        subjectTitle: details.title,
        subjectNoun,
        hasClusterAccess: kubectlTools.length > 0,
        hasInfrastructureAccess: infrastructureTools.length > 0,
      }),
      details.summary,
      this.buildInvestigationSection(latest, subjectNoun),
    ];

    const clusterSection: string =
      ClusterAccessContext.buildContextSection(clusterStatuses).trim();

    if (clusterSection) {
      sections.push(clusterSection);
    }

    const resourceSection: string =
      ResourceAccessContext.buildContextSection(resourceStatuses).trim();

    if (resourceSection) {
      sections.push(resourceSection);
    }

    return {
      additionalSystemInstructions: sections.join("\n\n"),
      extraTools,
      pageContext: details.pageContext,
      title: `${details.label}: ${details.title}`,
    };
  }
}
