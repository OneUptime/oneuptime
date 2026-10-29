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
import LinkedInfrastructureContext from "../../../../Server/Utils/AI/SRE/LinkedInfrastructureContext";
import RecentChangesContext from "../../../../Server/Utils/AI/SRE/RecentChangesContext";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import ResourceAiAccessService from "../../../../Server/Services/ResourceAiAccessService";
import ProjectService from "../../../../Server/Services/ProjectService";
import logger from "../../../../Server/Utils/Logger";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Project from "../../../../Models/DatabaseModels/Project";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE RUNNERS ASK THE ENGINE TO SAY WHEN THE LOGS STOOD IN THE WAY: every
 * incident and alert investigation hands it the record's kind and when it
 * started, where the check for its logs begins. The engine's other users
 * (insight triage, remediation) hand it nothing and are never checked.
 */

const projectId: ObjectID = ObjectID.generate();
const aiRunId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();
const CREATED_AT: Date = new Date("2026-10-29T11:30:00.000Z");

function sentRequest(executeRun: jest.SpyInstance): InvestigationRequest {
  return (executeRun.mock.calls[0]![0] as { request: InvestigationRequest })
    .request;
}

describe("the runners hand the engine their record for the log check", () => {
  let executeRun: jest.SpyInstance;

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
      .mockResolvedValue(null);
    jest
      .spyOn(LinkedInfrastructureContext, "readForAlert")
      .mockResolvedValue(null);
    jest.spyOn(RecentChangesContext, "read").mockResolvedValue(null);
    jest
      .spyOn(AIMemory, "getPriorSimilarIncidentsContext")
      .mockResolvedValue("");
    jest.spyOn(AIInvestigationQueue, "failOrRequeue").mockResolvedValue("noop");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an incident's investigation: the incident and when it was declared", async () => {
    const incident: Incident = new Incident(incidentId);
    incident.title = "Checkout is failing";
    incident.createdAt = CREATED_AT;
    jest
      .spyOn(IncidentAIContextBuilder, "buildIncidentContext")
      .mockResolvedValue({
        incident,
        stateTimeline: [],
        internalNotes: [],
        publicNotes: [],
        workspaceMessages: [],
      } as unknown as IncidentContextData);

    await AIIncidentInvestigationRunner.executeInvestigation({
      aiRunId,
      projectId,
      incidentId,
      attemptCount: 1,
    });

    expect(executeRun).toHaveBeenCalledTimes(1);
    expect(sentRequest(executeRun).logStallSubject).toEqual({
      subjectType: "incident",
      startedAt: CREATED_AT,
    });
  });

  test("an alert's investigation: the alert and when it fired", async () => {
    const alert: Alert = new Alert(alertId);
    alert.title = "Checkout error rate";
    alert.createdAt = CREATED_AT;
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

    expect(executeRun).toHaveBeenCalledTimes(1);
    expect(sentRequest(executeRun).logStallSubject).toEqual({
      subjectType: "alert",
      startedAt: CREATED_AT,
    });
  });
});
