import AIIncidentInvestigationRunner from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AIAlertInvestigationRunner from "../../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import IncidentAIContextBuilder, {
  IncidentContextData,
} from "../../../../Server/Utils/AI/IncidentAIContextBuilder";
import AlertAIContextBuilder, {
  AlertContextData,
} from "../../../../Server/Utils/AI/AlertAIContextBuilder";
import AIMemory from "../../../../Server/Utils/AI/SRE/AIMemory";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The panel's TL;DR only exists for runs whose runner asked for one. The
 * opt-in is a single boolean on the engine request, and losing it is a silent
 * regression: reports keep publishing, they just quietly stop carrying a
 * summary. These tests pin the wiring for both subject lanes.
 */

const projectId: ObjectID = ObjectID.generate();
const aiRunId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();

function sentRequest(executeRun: jest.SpyInstance): InvestigationRequest {
  return (executeRun.mock.calls[0]![0] as { request: InvestigationRequest })
    .request;
}

describe("Investigation runners request the AI TL;DR", () => {
  let executeRun: jest.SpyInstance;

  beforeEach(() => {
    executeRun = jest
      .spyOn(AIInvestigationEngine, "executeRun")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an incident investigation opts in alongside the code-fix decision", async () => {
    const incident: Incident = new Incident(incidentId);
    incident.title = "Checkout 500s";
    jest
      .spyOn(IncidentAIContextBuilder, "buildIncidentContext")
      .mockResolvedValue({
        incident,
        stateTimeline: [],
        internalNotes: [],
        publicNotes: [],
        workspaceMessages: [],
      } as unknown as IncidentContextData);
    jest
      .spyOn(AIMemory, "getPriorSimilarIncidentsContext")
      .mockResolvedValue("");

    await AIIncidentInvestigationRunner.executeInvestigation({
      aiRunId,
      projectId,
      incidentId,
      attemptCount: 1,
    });

    expect(executeRun).toHaveBeenCalledTimes(1);
    expect(sentRequest(executeRun).persistAnalysisTldr).toBe(true);
    expect(sentRequest(executeRun).persistCodeFixRecommendation).toBe(true);
    expect(sentRequest(executeRun).incidentId).toEqual(incidentId);
  });

  test("an alert investigation opts in too", async () => {
    const alert: Alert = new Alert(alertId);
    alert.title = "Error rate above threshold";
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

    expect(executeRun).toHaveBeenCalledTimes(1);
    expect(sentRequest(executeRun).persistAnalysisTldr).toBe(true);
    expect(sentRequest(executeRun).persistCodeFixRecommendation).toBe(true);
    expect(sentRequest(executeRun).alertId).toEqual(alertId);
  });
});
