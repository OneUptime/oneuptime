import AIIncidentInvestigationRunner from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AIAlertInvestigationRunner from "../../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIInvestigationQueue from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import IncidentAIContextBuilder, {
  IncidentContextData,
} from "../../../../Server/Utils/AI/IncidentAIContextBuilder";
import AlertAIContextBuilder, {
  AlertContextData,
} from "../../../../Server/Utils/AI/AlertAIContextBuilder";
import AIMemory from "../../../../Server/Utils/AI/SRE/AIMemory";
import LinkedInfrastructureContext, {
  LinkedInfrastructure,
} from "../../../../Server/Utils/AI/SRE/LinkedInfrastructureContext";
import IncidentFollowUpCheck, {
  FollowUpCheckContext,
} from "../../../../Server/Utils/AI/SRE/IncidentFollowUpCheck";
import RecentChangesContext from "../../../../Server/Utils/AI/SRE/RecentChangesContext";
import RemediationHandoff from "../../../../Server/Utils/AI/SRE/RemediationHandoff";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import ResourceAiAccessService from "../../../../Server/Services/ResourceAiAccessService";
import ProjectService from "../../../../Server/Services/ProjectService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentInternalNoteService from "../../../../Server/Services/IncidentInternalNoteService";
import WorkspaceNotificationRuleService from "../../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceNotificationText from "../../../../Server/Utils/Workspace/WorkspaceNotificationText";
import { ObservabilityAssistantResult } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import logger from "../../../../Server/Utils/Logger";
import { LinkedAffectedResourceType } from "../../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Project from "../../../../Models/DatabaseModels/Project";
import { AIRunEventResultSummary } from "../../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * THE RUNNERS WIRE THE LINKED INFRASTRUCTURE AND THE FOLLOW-UP CHECK
 * (issues #4786, #4787).
 *
 * - Every incident and alert investigation's starting context gets the
 *   "# Linked infrastructure" block, and its activity the line that says
 *   what was read - enrichment only: a read that fails never fails the run.
 * - An incident's follow-up check leads its context with why it runs, says
 *   so first in its activity and on the report's first line, and changes
 *   nothing a first investigation does for the incident: no second
 *   remediation release, no second time-to-RCA metric, no follow-up of its
 *   own.
 * - A first investigation, once settled, releases remediation and THEN
 *   asks whether an alert opened while it read.
 */

const projectId: ObjectID = ObjectID.generate();
const aiRunId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();
const followUpAlertId: ObjectID = ObjectID.generate();
const HOST_ID: string = "77777777-7777-4777-8777-777777777777";
const DECLARED_AT: Date = new Date("2026-10-16T14:30:00.000Z");

function linked(alertCount: number): LinkedInfrastructure {
  return {
    subjectKind: "incident",
    subjectCreatedAt: DECLARED_AT,
    resources: [
      { type: LinkedAffectedResourceType.Host, id: HOST_ID, name: "web-1" },
    ],
    alerts:
      alertCount > 0
        ? [
            {
              id: ObjectID.generate().toString(),
              alertNumber: 41,
              title: "[Host] High CPU Utilization (>80%) - web-1",
              severityName: "Warning",
              stateName: "Created",
              isOpen: true,
              openedAt: new Date(DECLARED_AT.getTime() - 5 * 60 * 1000),
              resources: [
                {
                  type: LinkedAffectedResourceType.Host,
                  id: HOST_ID,
                  name: "web-1",
                },
              ],
            },
          ]
        : [],
    hasMoreAlerts: false,
    windowStart: new Date(DECLARED_AT.getTime() - 30 * 60 * 1000),
    readAt: DECLARED_AT,
  };
}

function followUpContext(): FollowUpCheckContext {
  return {
    incidentCreatedAt: DECLARED_AT,
    alertId: followUpAlertId.toString(),
    alertNumber: 12,
    alertTitle: "[Host] High CPU Utilization (>80%) - web-1",
    alertOpenedAt: new Date(DECLARED_AT.getTime() + 2 * 60 * 1000),
    resources: [
      { type: LinkedAffectedResourceType.Host, id: HOST_ID, name: "web-1" },
    ],
    previousAnalysisAt: new Date(DECLARED_AT.getTime() + 60 * 1000),
  };
}

function sentRequest(executeRun: jest.SpyInstance): InvestigationRequest {
  return (executeRun.mock.calls[0]![0] as { request: InvestigationRequest })
    .request;
}

async function investigateIncident(
  followUpForAlertId?: ObjectID,
): Promise<void> {
  const incident: Incident = new Incident(incidentId);
  incident.title = "Shop is down";
  jest
    .spyOn(IncidentAIContextBuilder, "buildIncidentContext")
    .mockResolvedValue({
      incident,
      stateTimeline: [],
      internalNotes: [],
      publicNotes: [],
      workspaceMessages: [],
    } as unknown as IncidentContextData);
  jest.spyOn(AIMemory, "getPriorSimilarIncidentsContext").mockResolvedValue("");

  await AIIncidentInvestigationRunner.executeInvestigation({
    aiRunId,
    projectId,
    incidentId,
    attemptCount: 1,
    ...(followUpForAlertId ? { followUpForAlertId } : {}),
  });
}

describe("the runners wire the linked infrastructure and the follow-up check", () => {
  let executeRun: jest.SpyInstance;
  let readForIncident: jest.SpyInstance;
  let readContext: jest.SpyInstance;
  let handoff: jest.SpyInstance;
  let onSettledCheck: jest.SpyInstance;
  let order: Array<string>;

  beforeEach(() => {
    order = [];
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(new Project(projectId));
    executeRun = jest
      .spyOn(AIInvestigationEngine, "executeRun")
      .mockResolvedValue(undefined);
    jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusesForSubject")
      .mockResolvedValue([]);
    jest
      .spyOn(ResourceAiAccessService, "getStatusesForSubject")
      .mockResolvedValue([]);
    readForIncident = jest
      .spyOn(LinkedInfrastructureContext, "readForIncident")
      .mockResolvedValue(linked(1));
    jest
      .spyOn(LinkedInfrastructureContext, "readForAlert")
      .mockResolvedValue({ ...linked(1), subjectKind: "alert" });
    readContext = jest
      .spyOn(IncidentFollowUpCheck, "readContext")
      .mockResolvedValue(followUpContext());
    // The recent changes have a wiring test of their own.
    jest.spyOn(RecentChangesContext, "read").mockResolvedValue(null);
    handoff = jest
      .spyOn(RemediationHandoff, "runForSettledInvestigation")
      .mockImplementation(async (): Promise<void> => {
        order.push("remediation");
      });
    onSettledCheck = jest
      .spyOn(IncidentFollowUpCheck, "onInvestigationSettled")
      .mockImplementation(async (): Promise<ObjectID | null> => {
        order.push("follow-up check");
        return null;
      });
    jest.spyOn(AIInvestigationQueue, "failOrRequeue").mockResolvedValue("noop");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an incident investigation's context names its infrastructure and alerts, and its activity says so", async () => {
    await investigateIncident();

    const request: InvestigationRequest = sentRequest(executeRun);

    expect(readForIncident).toHaveBeenCalledWith({ projectId, incidentId });
    expect(request.contextSummary).toContain("# Linked infrastructure");
    expect(request.contextSummary).toContain(
      `- Host "web-1" (resourceType: Host, resourceId: ${HOST_ID})`,
    );
    expect(request.contextSummary).toContain(
      '- Alert #41 "[Host] High CPU Utilization (>80%) - web-1" on Host "web-1": Warning, still open (Created)',
    );
    expect(request.contextNotes).toEqual([
      expect.objectContaining({
        message: "Read 1 open or recent alert on Host web-1",
        linkedInfrastructure: expect.objectContaining({ alertCount: 1 }),
      }),
    ]);
    // A first investigation has no lead and no follow-up context.
    expect(request.reportLead).toBeUndefined();
    expect(readContext).not.toHaveBeenCalled();
  });

  test("an incident linked to no infrastructure gets neither the block nor the line", async () => {
    readForIncident.mockResolvedValue({ ...linked(0), resources: [] });

    await investigateIncident();

    const request: InvestigationRequest = sentRequest(executeRun);

    expect(request.contextSummary).not.toContain("# Linked infrastructure");
    expect(request.contextNotes).toBeUndefined();
  });

  test("a read that fails never fails the run: it investigates without the block", async () => {
    readForIncident.mockRejectedValue(new Error("Database not connected"));

    await investigateIncident();

    expect(executeRun).toHaveBeenCalledTimes(1);
    expect(sentRequest(executeRun).contextSummary).not.toContain(
      "# Linked infrastructure",
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        `could not read the linked infrastructure of incident ${incidentId.toString()}`,
      ),
    );
  });

  test("a follow-up check leads with why it runs, says so first, and puts it on the report's first line", async () => {
    await investigateIncident(followUpAlertId);

    const request: InvestigationRequest = sentRequest(executeRun);

    expect(readContext).toHaveBeenCalledWith({
      projectId,
      incidentId,
      alertId: followUpAlertId,
    });
    expect(
      request.contextSummary.startsWith("# Why you are checking again\n"),
    ).toBe(true);
    expect(request.contextSummary).toContain("# Incident");
    expect(request.contextSummary).toContain("# Linked infrastructure");
    expect(
      (request.contextNotes || []).map(
        (note: AIRunEventResultSummary): string => {
          return note.followUpCheck ? "follow-up" : "linked";
        },
      ),
    ).toEqual(["follow-up", "linked"]);
    expect(request.reportLead?.toString()).toContain("**Checked again**");
  });

  test("a follow-up whose alert can no longer be read runs as a plain investigation", async () => {
    readContext.mockResolvedValue(null);

    await investigateIncident(followUpAlertId);

    const request: InvestigationRequest = sentRequest(executeRun);

    expect(request.contextSummary.startsWith("# Incident")).toBe(true);
    expect(request.reportLead).toBeUndefined();
    expect(request.contextNotes).toHaveLength(1);
  });

  test("a first investigation, settled, releases remediation and then asks whether an alert opened meanwhile", async () => {
    await investigateIncident();

    await sentRequest(executeRun).onSettled!();

    expect(order).toEqual(["remediation", "follow-up check"]);
    expect(handoff).toHaveBeenCalledWith({ projectId, incidentId });
    expect(onSettledCheck).toHaveBeenCalledWith({
      projectId,
      incidentId,
      aiRunId,
    });
  });

  test("a follow-up check, settled, releases nothing and is never followed up", async () => {
    await investigateIncident(followUpAlertId);

    await sentRequest(executeRun).onSettled!();

    expect(handoff).not.toHaveBeenCalled();
    expect(onSettledCheck).not.toHaveBeenCalled();
  });

  test("only the first analysis records the time to root cause", async () => {
    const recordMetric: jest.SpyInstance = jest
      .spyOn(IncidentService, "recordTimeToRootCausePostedMetric")
      .mockResolvedValue(undefined);
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentInternalNoteService, "create")
      .mockResolvedValue(undefined as never);
    const post: (request: InvestigationRequest) => Promise<void> = async (
      request: InvestigationRequest,
    ): Promise<void> => {
      await request.postAnalysis({
        analysisMarkdown: "## 🧠 AI — Automated Root Cause Analysis",
        confidence: {
          confident: true,
          codeFixRecommended: false,
          source: "classification",
        },
        result: {
          contentInMarkdown: "",
          citations: [],
          totalTokens: 0,
          llmCallCount: 0,
          toolCallCount: 0,
        },
      });
    };

    await investigateIncident(followUpAlertId);
    await post(sentRequest(executeRun));
    expect(recordMetric).not.toHaveBeenCalled();

    executeRun.mockClear();
    await investigateIncident();
    await post(sentRequest(executeRun));
    expect(recordMetric).toHaveBeenCalledTimes(1);
  });

  /*
   * A second "🧠 AI — Automated Root Cause Analysis" buzzing a phone reads
   * like the first one again. The follow-up's post says why it was
   * written, in the line the phone shows; a first analysis's post says
   * what it always said.
   */
  test("a follow-up's chat post tells phones why it was written; a first analysis's is unchanged", async () => {
    const createFeedItem: jest.SpyInstance = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentService, "recordTimeToRootCausePostedMetric")
      .mockResolvedValue(undefined);
    jest
      .spyOn(IncidentInternalNoteService, "create")
      .mockResolvedValue(undefined as never);

    const post: (
      request: InvestigationRequest,
      analysisMarkdown: string,
    ) => Promise<void> = async (
      request: InvestigationRequest,
      analysisMarkdown: string,
    ): Promise<void> => {
      await request.postAnalysis({
        analysisMarkdown,
        confidence: {
          confident: true,
          codeFixRecommended: false,
          source: "classification",
        },
        result: {
          contentInMarkdown: "",
          citations: [],
          totalTokens: 0,
          llmCallCount: 0,
          toolCallCount: 0,
        },
      });
    };
    const analysis: string =
      "**Summary** — The host's CPU alert confirms the earlier analysis.";

    await investigateIncident(followUpAlertId);

    const followUp: InvestigationRequest = sentRequest(executeRun);
    const followUpMarkdown: string = AIInvestigationEngine.buildBrandedMarkdown(
      {
        contentInMarkdown: analysis,
        citations: [],
        toolCallCount: 1,
        llmCallCount: 1,
        totalTokens: 10,
      } as unknown as ObservabilityAssistantResult,
      analysis,
      0,
      0,
      followUp.reportLead,
    );

    await post(followUp, followUpMarkdown);

    const followUpNotification: { notificationText?: string } = (
      createFeedItem.mock.calls[0]![0] as {
        workspaceNotification: { notificationText?: string };
      }
    ).workspaceNotification;

    expect(followUpNotification.notificationText).toBe(
      "🧠 AI — Automated Root Cause Analysis: Checked again after alert #12 opened on Host web-1, 2 minutes after this incident was declared: [Host] High CPU Utilization (>80%) - web-1.",
    );
    expect(followUpNotification.notificationText).toBe(
      WorkspaceNotificationText.fromMarkdown(followUpMarkdown, {
        isFirstParagraphAHeadline: true,
      }),
    );

    executeRun.mockClear();
    createFeedItem.mockClear();
    await investigateIncident();
    await post(
      sentRequest(executeRun),
      `## 🧠 AI — Automated Root Cause Analysis\n\n${analysis}`,
    );

    expect(
      Object.keys(
        (
          createFeedItem.mock.calls[0]![0] as {
            workspaceNotification: JSONObject;
          }
        ).workspaceNotification,
      ),
    ).not.toContain("notificationText");
  });

  test("the incident feed hands a post's notification line to the chats", async () => {
    const send: jest.SpyInstance = jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "sendWorkspaceMarkdownNotification",
      )
      .mockResolvedValue(undefined);

    await IncidentFeedService.sendWorkspaceNotification({
      projectId,
      incidentId,
      feedInfoInMarkdown: "## 🧠 AI — Automated Root Cause Analysis",
      workspaceNotification: {
        sendWorkspaceNotification: true,
        notificationText:
          "🧠 AI — Automated Root Cause Analysis: Checked again",
      },
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationText:
          "🧠 AI — Automated Root Cause Analysis: Checked again",
      }),
    );

    send.mockClear();

    await IncidentFeedService.sendWorkspaceNotification({
      projectId,
      incidentId,
      feedInfoInMarkdown: "A note",
      workspaceNotification: { sendWorkspaceNotification: true },
    });

    expect(
      (send.mock.calls[0]![0] as { notificationText?: string })
        .notificationText,
    ).toBeUndefined();
  });

  test("a follow-up whose context cannot be built fails without releasing remediation; a first investigation releases it", async () => {
    (
      AIInvestigationQueue.failOrRequeue as unknown as jest.Mock
    ).mockResolvedValue("finalized");
    jest
      .spyOn(IncidentAIContextBuilder, "buildIncidentContext")
      .mockRejectedValue(new Error("Incident not found"));
    jest
      .spyOn(AIMemory, "getPriorSimilarIncidentsContext")
      .mockResolvedValue("");

    await AIIncidentInvestigationRunner.executeInvestigation({
      aiRunId,
      projectId,
      incidentId,
      attemptCount: 2,
      followUpForAlertId: followUpAlertId,
    });
    expect(handoff).not.toHaveBeenCalled();

    await AIIncidentInvestigationRunner.executeInvestigation({
      aiRunId,
      projectId,
      incidentId,
      attemptCount: 2,
    });
    expect(handoff).toHaveBeenCalledTimes(1);
    expect(executeRun).not.toHaveBeenCalled();
  });

  test("an alert investigation gets the block and the line too, and no follow-up", async () => {
    const alert: Alert = new Alert(alertId);
    alert.title = "[Host] High CPU Utilization (>80%) - web-1";
    jest.spyOn(AlertAIContextBuilder, "buildAlertContext").mockResolvedValue({
      alert,
      stateTimeline: [],
      internalNotes: [],
    } as unknown as AlertContextData);

    await AIAlertInvestigationRunner.executeInvestigation({
      aiRunId,
      projectId,
      alertId,
      attemptCount: 1,
    });

    const request: InvestigationRequest = sentRequest(executeRun);

    expect(LinkedInfrastructureContext.readForAlert).toHaveBeenCalledWith({
      projectId,
      alertId,
    });
    expect(request.contextSummary).toContain("# Linked infrastructure");
    expect(request.contextSummary).toContain("minutes before this alert");
    expect(request.contextNotes).toHaveLength(1);
    expect(request.reportLead).toBeUndefined();
    expect(readContext).not.toHaveBeenCalled();

    await request.onSettled!();
    expect(onSettledCheck).not.toHaveBeenCalled();
  });
});
