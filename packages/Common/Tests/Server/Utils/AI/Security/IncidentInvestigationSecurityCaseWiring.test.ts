import AIIncidentInvestigationRunner from "../../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIInvestigationQueue from "../../../../../Server/Utils/AI/SRE/InvestigationQueue";
import IncidentAIContextBuilder, {
  IncidentContextData,
} from "../../../../../Server/Utils/AI/IncidentAIContextBuilder";
import AIMemory from "../../../../../Server/Utils/AI/SRE/AIMemory";
import LinkedInfrastructureContext from "../../../../../Server/Utils/AI/SRE/LinkedInfrastructureContext";
import RecentChangesContext from "../../../../../Server/Utils/AI/SRE/RecentChangesContext";
import SecurityCaseIncidentContext from "../../../../../Server/Utils/AI/Security/SecurityCaseIncidentContext";
import KubernetesClusterAiAccessService from "../../../../../Server/Services/KubernetesClusterAiAccessService";
import ResourceAiAccessService from "../../../../../Server/Services/ResourceAiAccessService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import logger from "../../../../../Server/Utils/Logger";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import Project from "../../../../../Models/DatabaseModels/Project";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * An incident a security case declared is investigated knowing so: its
 * starting context names the case - what was detected, about whom, and
 * OneUptime AI's triage of it - so the investigation can read the attack
 * behind the outage with the security tools. Enrichment only: a read that
 * fails never fails the run.
 */

const projectId: ObjectID = ObjectID.generate();
const aiRunId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();

const SECTION: string =
  '\n## The security case behind this incident\n- CASE-42 (securityCaseId "x") "Cryptominer on web-1"\n';

function sentRequest(executeRun: jest.SpyInstance): InvestigationRequest {
  return (executeRun.mock.calls[0]![0] as { request: InvestigationRequest })
    .request;
}

async function investigateIncident(): Promise<void> {
  const incident: Incident = new Incident(incidentId);
  incident.title = "Checkout is slow";
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

describe("an incident's investigation reads the security case that declared it", () => {
  let executeRun: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {});
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
    jest.spyOn(RecentChangesContext, "read").mockResolvedValue(null);
    jest.spyOn(AIInvestigationQueue, "failOrRequeue").mockResolvedValue("noop");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the case is in the incident's starting context", async () => {
    const read: jest.SpyInstance = jest
      .spyOn(SecurityCaseIncidentContext, "buildContextSectionFor")
      .mockResolvedValue(SECTION);

    await investigateIncident();

    expect(read).toHaveBeenCalledWith({ projectId, incidentId });
    expect(sentRequest(executeRun).contextSummary).toContain(
      "## The security case behind this incident",
    );
  });

  test("an incident no case declared reads as before", async () => {
    jest
      .spyOn(SecurityCaseIncidentContext, "buildContextSectionFor")
      .mockResolvedValue("");

    await investigateIncident();

    expect(sentRequest(executeRun).contextSummary).not.toContain(
      "security case",
    );
  });

  test("a read that fails never fails the investigation", async () => {
    jest
      .spyOn(SecurityCaseIncidentContext, "buildContextSectionFor")
      .mockRejectedValue(new Error("db down"));

    await investigateIncident();

    expect(executeRun).toHaveBeenCalledTimes(1);
  });
});
