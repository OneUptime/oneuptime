import AIIncidentInvestigationRunner from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AIAlertInvestigationRunner from "../../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIInvestigationQueue from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import NetworkTransceiverContext from "../../../../Server/Utils/AI/SRE/NetworkTransceiverContext";
import IncidentAIContextBuilder, {
  IncidentContextData,
} from "../../../../Server/Utils/AI/IncidentAIContextBuilder";
import AlertAIContextBuilder, {
  AlertContextData,
} from "../../../../Server/Utils/AI/AlertAIContextBuilder";
import AIMemory from "../../../../Server/Utils/AI/SRE/AIMemory";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import ProjectService from "../../../../Server/Services/ProjectService";
import ResourceAiAccessService from "../../../../Server/Services/ResourceAiAccessService";
import logger from "../../../../Server/Utils/Logger";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Project from "../../../../Models/DatabaseModels/Project";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * An investigation of an alert or incident raised by a Network Device
 * monitor starts with the optics of the ports it is about - so OneUptime AI
 * sees "the transceiver is no longer detected" or "RX power has fallen for
 * three weeks" without having to think of asking. Enrichment only: a failed
 * read never fails the run.
 */

const projectId: ObjectID = ObjectID.generate();
const aiRunId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();
const monitorId: ObjectID = ObjectID.generate();

const SECTION: string =
  "\n\n## Transceivers (SFP, SFP+, QSFP optics) of the affected network device\n### core-switch-1";

const SERIES_LABELS: JSONObject = {
  interfaceName: "Te1/1/1",
  interfaceAlias: "Uplink to core",
};

function sentRequest(executeRun: jest.SpyInstance): InvestigationRequest {
  return (executeRun.mock.calls[0]![0] as { request: InvestigationRequest })
    .request;
}

async function investigateAlert(): Promise<void> {
  const alert: Alert = new Alert(alertId);
  alert.title = "Transceiver not detected";
  alert.rootCause =
    "Transceiver no longer detected in Te1/1/1 (Uplink to core): it was FS SFP-10GLR-31, serial S1.";
  alert.monitorId = monitorId;
  alert.seriesLabels = SERIES_LABELS;

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
}

async function investigateIncident(): Promise<void> {
  const monitor: Monitor = new Monitor(monitorId);
  monitor.name = "core-switch-1";

  const incident: Incident = new Incident(incidentId);
  incident.title = "Interface Te1/1/1 down on core-switch-1";
  incident.monitors = [monitor];
  incident.seriesLabels = SERIES_LABELS;

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

describe("Investigations start with the affected device's transceivers", () => {
  let executeRun: jest.SpyInstance;
  let buildSection: jest.SpyInstance;
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {
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
    jest.spyOn(AIInvestigationQueue, "failOrRequeue").mockResolvedValue("noop");
    buildSection = jest
      .spyOn(NetworkTransceiverContext, "buildContextSection")
      .mockResolvedValue(SECTION);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an alert hands over its monitor, its port labels and its text", async () => {
    await investigateAlert();

    expect(buildSection).toHaveBeenCalledTimes(1);

    const input: {
      projectId: ObjectID;
      monitorIds: Array<ObjectID>;
      focusText?: string;
      seriesLabels?: JSONObject;
    } = buildSection.mock.calls[0]![0];

    expect(input.projectId).toBe(projectId);
    expect(
      input.monitorIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([monitorId.toString()]);
    expect(input.seriesLabels).toEqual(SERIES_LABELS);
    expect(input.focusText).toContain("Transceiver not detected");
    expect(input.focusText).toContain(
      "Transceiver no longer detected in Te1/1/1",
    );

    expect(sentRequest(executeRun).contextSummary.endsWith(SECTION)).toBe(true);
  });

  test("an incident hands over every monitor it was raised by", async () => {
    await investigateIncident();

    const input: { monitorIds: Array<ObjectID>; seriesLabels?: JSONObject } =
      buildSection.mock.calls[0]![0];

    expect(
      input.monitorIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([monitorId.toString()]);
    expect(input.seriesLabels).toEqual(SERIES_LABELS);
    expect(sentRequest(executeRun).contextSummary).toContain(
      "## Transceivers (SFP, SFP+, QSFP optics)",
    );
  });

  test.each([
    ["alert", investigateAlert],
    ["incident", investigateIncident],
  ])(
    "a failed transceiver read never fails the %s investigation",
    async (_kind: string, investigate: () => Promise<void>) => {
      buildSection.mockRejectedValue(new Error("database is busy"));

      await investigate();

      expect(executeRun).toHaveBeenCalledTimes(1);
      expect(sentRequest(executeRun).contextSummary).not.toContain(
        "## Transceivers",
      );
      expect(
        errorLog.mock.calls.some((call: Array<unknown>) => {
          return String(call[0]).includes("could not read transceivers");
        }),
      ).toBe(true);
    },
  );
});
