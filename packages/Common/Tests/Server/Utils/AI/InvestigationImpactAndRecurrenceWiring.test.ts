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
import AIMemory, {
  PAST_RESOLVED_ALERTS_HEADING,
} from "../../../../Server/Utils/AI/SRE/AIMemory";
import InvestigationImpactContext, {
  InvestigationImpact,
} from "../../../../Server/Utils/AI/SRE/InvestigationImpactContext";
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
import SloStatus from "../../../../Types/ServiceLevelObjective/SloStatus";
import { IMPACT_SECTION_TITLE } from "../../../../Utils/AI/InvestigationReport";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * Contract under test - the runners wire what a report's Impact section and
 * an alert's recurrence read (#5519's follow-up):
 *
 *  - every incident and alert investigation's starting context gets the
 *    "# Impact" block of the SLOs that count it, read for its own record -
 *    enrichment only: a read that fails never fails the run;
 *  - an alert's investigation reads its own past (AIMemory's resolved
 *    alerts with their verified fixes) for its own alert and project, as an
 *    incident's reads past incidents, and its context carries it after the
 *    alert itself.
 */

const projectId: ObjectID = ObjectID.generate();
const aiRunId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();
const SLO_ID: string = "bbbb6666-6666-4666-8666-666666666666";

function impact(subjectKind: "incident" | "alert"): InvestigationImpact {
  return {
    subjectKind,
    hasMonitors: true,
    slos: [
      {
        id: SLO_ID,
        name: "Checkout availability",
        isLinked: false,
        monitorNames: ["Checkout API"],
        targetPercentage: 99.9,
        currentSliPercentage: 99.71,
        errorBudgetRemainingPercentage: 38,
        sloStatus: SloStatus.AtRisk,
        window: "a rolling 30 days",
      },
    ],
    hasMoreSlos: false,
  };
}

const PAST_ALERTS: string = `\n\n${PAST_RESOLVED_ALERTS_HEADING}\nIf the current alert matches one of these, this may be a recurrence.\n\n- **Alert #305 — High CPU on web-1**\n  Fixed by OneUptime AI (verified): ran \`kubectl rollout restart deployment/web -n shop\``;

function sentRequest(executeRun: jest.SpyInstance): InvestigationRequest {
  return (executeRun.mock.calls[0]![0] as { request: InvestigationRequest })
    .request;
}

describe("the runners wire the Impact block and an alert's recurrence", () => {
  let executeRun: jest.SpyInstance;
  let readImpactForIncident: jest.SpyInstance;
  let readImpactForAlert: jest.SpyInstance;
  let pastAlerts: jest.SpyInstance;
  let pastIncidents: jest.SpyInstance;

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
    jest.spyOn(AIInvestigationQueue, "failOrRequeue").mockResolvedValue("noop");

    readImpactForIncident = jest
      .spyOn(InvestigationImpactContext, "readForIncident")
      .mockResolvedValue(impact("incident"));
    readImpactForAlert = jest
      .spyOn(InvestigationImpactContext, "readForAlert")
      .mockResolvedValue(impact("alert"));
    pastAlerts = jest
      .spyOn(AIMemory, "getPriorSimilarAlertsContext")
      .mockResolvedValue(PAST_ALERTS);
    pastIncidents = jest
      .spyOn(AIMemory, "getPriorSimilarIncidentsContext")
      .mockResolvedValue("");

    const incident: Incident = new Incident(incidentId);
    incident.title = "Checkout is down";
    jest
      .spyOn(IncidentAIContextBuilder, "buildIncidentContext")
      .mockResolvedValue({
        incident,
        stateTimeline: [],
        internalNotes: [],
        publicNotes: [],
        workspaceMessages: [],
      } as unknown as IncidentContextData);

    const alert: Alert = new Alert(alertId);
    alert.title = "High CPU on web-1";
    jest.spyOn(AlertAIContextBuilder, "buildAlertContext").mockResolvedValue({
      alert,
      stateTimeline: [],
      internalNotes: [],
    } as unknown as AlertContextData);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function investigateIncident(): Promise<InvestigationRequest> {
    await AIIncidentInvestigationRunner.executeInvestigation({
      aiRunId,
      projectId,
      incidentId,
      attemptCount: 1,
    });

    return sentRequest(executeRun);
  }

  async function investigateAlert(): Promise<InvestigationRequest> {
    await AIAlertInvestigationRunner.executeInvestigation({
      aiRunId,
      projectId,
      alertId,
      attemptCount: 1,
    });

    return sentRequest(executeRun);
  }

  test("an incident's context names the SLOs that count it, read for its own record", async () => {
    const request: InvestigationRequest = await investigateIncident();

    expect(readImpactForIncident).toHaveBeenCalledWith({
      projectId,
      incidentId,
    });
    expect(request.contextSummary).toContain(`\n# ${IMPACT_SECTION_TITLE}\n`);
    expect(request.contextSummary).toContain(
      `- SLO "Checkout availability" (sloId: ${SLO_ID}), counts monitor "Checkout API": At Risk`,
    );
    // After the incident itself.
    expect(request.contextSummary.indexOf("# Incident")).toBeLessThan(
      request.contextSummary.indexOf(`# ${IMPACT_SECTION_TITLE}`),
    );
  });

  test("an alert's context names its SLOs too", async () => {
    const request: InvestigationRequest = await investigateAlert();

    expect(readImpactForAlert).toHaveBeenCalledWith({ projectId, alertId });
    expect(request.contextSummary).toContain(
      "The SLOs that count this alert, as the SLO evaluation last measured them",
    );
  });

  test("an SLO read that fails never fails the run: it investigates without the block", async () => {
    readImpactForIncident.mockRejectedValue(
      new Error("Database not connected"),
    );
    readImpactForAlert.mockRejectedValue(new Error("Database not connected"));

    const incidentRequest: InvestigationRequest = await investigateIncident();

    expect(incidentRequest.contextSummary).not.toContain(
      `# ${IMPACT_SECTION_TITLE}`,
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        `could not read the SLOs that count incident ${incidentId.toString()}`,
      ),
    );

    executeRun.mockClear();

    const alertRequest: InvestigationRequest = await investigateAlert();

    expect(alertRequest.contextSummary).not.toContain(
      `# ${IMPACT_SECTION_TITLE}`,
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        `could not read the SLOs that count alert ${alertId.toString()}`,
      ),
    );
  });

  test("an alert's investigation reads its own past, as an incident's does", async () => {
    const request: InvestigationRequest = await investigateAlert();

    expect(pastAlerts).toHaveBeenCalledWith({
      projectId,
      currentAlertId: alertId,
    });
    expect(pastIncidents).not.toHaveBeenCalled();
    expect(request.contextSummary).toContain(PAST_RESOLVED_ALERTS_HEADING);
    expect(request.contextSummary).toContain(
      "Fixed by OneUptime AI (verified): ran `kubectl rollout restart deployment/web -n shop`",
    );
    // Right after the alert itself, before what it is linked to.
    expect(request.contextSummary.startsWith("# Alert")).toBe(true);
    expect(
      request.contextSummary.indexOf(PAST_RESOLVED_ALERTS_HEADING),
    ).toBeLessThan(request.contextSummary.indexOf(`# ${IMPACT_SECTION_TITLE}`));
  });

  test("an alert with no past adds nothing, and an incident's run never reads alerts' past", async () => {
    pastAlerts.mockResolvedValue("");

    const request: InvestigationRequest = await investigateAlert();

    expect(request.contextSummary).not.toContain(PAST_RESOLVED_ALERTS_HEADING);

    pastAlerts.mockClear();
    executeRun.mockClear();
    await investigateIncident();

    expect(pastAlerts).not.toHaveBeenCalled();
    expect(pastIncidents).toHaveBeenCalledTimes(1);
  });
});
