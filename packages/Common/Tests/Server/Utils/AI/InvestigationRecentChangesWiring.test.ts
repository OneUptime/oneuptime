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
import RecentChangesContext, {
  ChangeRelation,
  RecentChanges,
} from "../../../../Server/Utils/AI/SRE/RecentChangesContext";
import { ChangeImpactVerdict } from "../../../../Server/Utils/AI/SRE/ChangeImpact";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import ResourceAiAccessService from "../../../../Server/Services/ResourceAiAccessService";
import ProjectService from "../../../../Server/Services/ProjectService";
import logger from "../../../../Server/Utils/Logger";
import { LinkedAffectedResourceType } from "../../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Project from "../../../../Models/DatabaseModels/Project";
import { AIRunEventResultSummary } from "../../../../Types/AI/AIChatTypes";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * THE RUNNERS WIRE THE RECENT CHANGES.
 *
 * Every incident and alert investigation's starting context gets the
 * "# Recent changes" block after the linked infrastructure - read with
 * that infrastructure, so the changes on it come first - and its activity
 * the line that says what was read. Enrichment only: a read that fails
 * never fails the run.
 */

const projectId: ObjectID = ObjectID.generate();
const aiRunId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();
const SERVICE_ID: string = "66666666-6666-4666-8666-666666666666";
const DECLARED_AT: Date = new Date("2026-10-19T10:00:00.000Z");

function linked(kind: "incident" | "alert"): LinkedInfrastructure {
  return {
    subjectKind: kind,
    subjectCreatedAt: DECLARED_AT,
    resources: [
      {
        type: LinkedAffectedResourceType.Service,
        id: SERVICE_ID,
        name: "checkout",
      },
    ],
    alerts: [],
    hasMoreAlerts: false,
    windowStart: new Date(DECLARED_AT.getTime() - 30 * 60 * 1000),
    readAt: DECLARED_AT,
  };
}

function recentChanges(kind: "incident" | "alert"): RecentChanges {
  return {
    subjectKind: kind,
    subjectCreatedAt: DECLARED_AT,
    windowStart: new Date(DECLARED_AT.getTime() - 120 * 60 * 1000),
    windowEnd: new Date(DECLARED_AT.getTime() + 10 * 60 * 1000),
    changes: [
      {
        id: "change-1",
        ids: ["change-1"],
        time: new Date(DECLARED_AT.getTime() - 12 * 60 * 1000),
        eventType: "deployment",
        titles: ["Deploy 2.3.1"],
        serviceId: SERVICE_ID,
        serviceName: "checkout",
        fields: { version: "2.3.1" },
        relation: ChangeRelation.Linked,
        impact: {
          verdict: ChangeImpactVerdict.Suspect,
          reasons: ["span error rate 0.2% → 6.4%"],
          newExceptionTypes: [],
        },
      },
    ],
    hasMoreChanges: false,
  };
}

function sentRequest(executeRun: jest.SpyInstance): InvestigationRequest {
  return (executeRun.mock.calls[0]![0] as { request: InvestigationRequest })
    .request;
}

async function investigateIncident(): Promise<void> {
  const incident: Incident = new Incident(incidentId);
  incident.title = "Checkout is failing";
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
  });
}

async function investigateAlert(): Promise<void> {
  const alert: Alert = new Alert(alertId);
  alert.title = "Checkout error rate";
  jest.spyOn(AlertAIContextBuilder, "buildAlertContext").mockResolvedValue({
    alert,
    stateTimeline: [],
    internalNotes: [],
    workspaceMessages: [],
  } as unknown as AlertContextData);

  await AIAlertInvestigationRunner.executeInvestigation({
    aiRunId,
    projectId,
    alertId,
    attemptCount: 1,
  });
}

describe("the runners wire the recent changes", () => {
  let executeRun: jest.SpyInstance;
  let readChanges: jest.SpyInstance;

  beforeEach(() => {
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
    jest
      .spyOn(LinkedInfrastructureContext, "readForIncident")
      .mockResolvedValue(linked("incident"));
    jest
      .spyOn(LinkedInfrastructureContext, "readForAlert")
      .mockResolvedValue(linked("alert"));
    readChanges = jest
      .spyOn(RecentChangesContext, "read")
      .mockImplementation(
        async (data: { subjectKind: "incident" | "alert" }) => {
          return recentChanges(data.subjectKind);
        },
      );
    jest.spyOn(AIInvestigationQueue, "failOrRequeue").mockResolvedValue("noop");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an incident's context lists its recent changes after its infrastructure, read with that infrastructure", async () => {
    await investigateIncident();

    expect(readChanges).toHaveBeenCalledWith({
      projectId,
      subjectKind: "incident",
      subjectId: incidentId,
      linked: linked("incident"),
    });

    const request: InvestigationRequest = sentRequest(executeRun);
    const summary: string = request.contextSummary;

    expect(summary).toContain("# Recent changes");
    expect(summary.indexOf("# Linked infrastructure")).toBeLessThan(
      summary.indexOf("# Recent changes"),
    );
    expect(summary).toContain(
      '- SUSPECT: 2026-10-19T09:48:00.000Z (12 minutes before this incident) - service "checkout": "Deploy 2.3.1" (version 2.3.1) [changeId: change-1]. In the 30 minutes after it: span error rate 0.2% → 6.4%.',
    );
    expect(
      (request.contextNotes || []).map(
        (note: AIRunEventResultSummary): string => {
          return note.recentChanges ? "changes" : "linked";
        },
      ),
    ).toEqual(["linked", "changes"]);
    expect(request.contextNotes![1]).toEqual(
      expect.objectContaining({
        message: "Found 1 suspect among the recent changes",
        recentChanges: expect.objectContaining({
          changeCount: 1,
          suspectCount: 1,
        }),
      }),
    );
  });

  test("an alert's context lists them too", async () => {
    await investigateAlert();

    expect(readChanges).toHaveBeenCalledWith({
      projectId,
      subjectKind: "alert",
      subjectId: alertId,
      linked: linked("alert"),
    });
    expect(sentRequest(executeRun).contextSummary).toContain(
      "(12 minutes before this alert)",
    );
  });

  test("the changes are still read when the linked infrastructure could not be", async () => {
    jest
      .spyOn(LinkedInfrastructureContext, "readForIncident")
      .mockRejectedValue(new Error("Database not connected"));

    await investigateIncident();

    expect(readChanges).toHaveBeenCalledWith(
      expect.objectContaining({ linked: null }),
    );
    expect(sentRequest(executeRun).contextSummary).toContain(
      "# Recent changes",
    );
  });

  test("a read that fails never fails the run", async () => {
    readChanges.mockRejectedValue(new Error("ClickHouse is down"));

    await investigateIncident();

    expect(executeRun).toHaveBeenCalledTimes(1);
    expect(sentRequest(executeRun).contextSummary).not.toContain(
      "# Recent changes",
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        `could not read the recent changes of incident ${incidentId.toString()}`,
      ),
    );
  });

  test("nothing read, nothing added", async () => {
    readChanges.mockResolvedValue(null);

    await investigateIncident();

    const request: InvestigationRequest = sentRequest(executeRun);
    expect(request.contextSummary).not.toContain("# Recent changes");
    expect(request.contextNotes).toHaveLength(1);
  });
});
