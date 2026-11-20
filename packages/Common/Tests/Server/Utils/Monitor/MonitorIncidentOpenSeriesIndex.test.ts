/*
 * The incident creation path pulls the native isolated-vm addon through its
 * template renderer. Nothing under test here touches the sandbox, and the
 * prebuilt binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

jest.mock("../../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import IncidentService from "../../../../Server/Services/IncidentService";
import NetworkDeviceOwnerUserService from "../../../../Server/Services/NetworkDeviceOwnerUserService";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorResourceContextUtil from "../../../../Server/Utils/Monitor/MonitorResourceContext";
import OwnerRuleAssignment from "../../../../Server/Utils/Rules/OwnerRuleAssignment";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { PerSeriesCriteriaMatch } from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { mockProjectStates } from "../../TestingUtils/Services/ProjectStatesHelper";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * A GROUPED CRITERIA'S SERIES, EACH LOOKED UP IN ITS OPEN INCIDENTS ONCE
 * (issue #10108).
 *
 * As for alerts (MonitorAlertOpenSeriesIndex): the create pass searched
 * every open incident for each series a criteria matched. The criteria's
 * open incidents are now laid out by series once, each series' in the order
 * they were read, and the series' own are searched for one from the same
 * template (or from a template that had no id), as the whole list was. A
 * lost lock stops the pass before the next series' write.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const CRITERIA_ID: string = "criteria-too-many-tasks";
const OTHER_CRITERIA_ID: string = "criteria-restarted";
const TEMPLATE_ID: string = "template-too-many-tasks";
const OTHER_TEMPLATE_ID: string = "template-retired";

const dataToProcess: ProbeMonitorResponse = {
  projectId: PROJECT_ID,
  monitorId: MONITOR_ID,
  monitoredAt: new Date("2026-11-17T10:04:00.000Z"),
} as unknown as ProbeMonitorResponse;

function monitor(): Monitor {
  const model: Monitor = new Monitor();
  model._id = MONITOR_ID.toString();
  model.projectId = PROJECT_ID;
  model.monitorType = MonitorType.Metrics;
  model.name = "Containers by host";
  return model;
}

function criteriaInstance(): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = CRITERIA_ID;
  instance.data!.name = "Too many tasks";
  instance.data!.createIncidents = true;
  instance.data!.incidents = [
    {
      id: TEMPLATE_ID,
      title: "Too many tasks",
      description: "A container runs too many tasks.",
      incidentSeverityId: SEVERITY_ID,
      autoResolveIncident: true,
    },
  ];
  return instance;
}

function seriesMatch(index: number): PerSeriesCriteriaMatch {
  return {
    criteriaMetId: CRITERIA_ID,
    fingerprint: `fp-${index}`,
    labels: { "resource.container.name": `container-${index}` },
    rootCause: `container-${index} runs too many tasks`,
  };
}

function openIncident(input: {
  id: number;
  criteriaId: string;
  templateId?: string | undefined;
  fingerprint?: string | undefined;
}): Incident {
  const incident: Incident = new Incident();
  incident._id = `00000000-0000-4000-8000-${String(input.id).padStart(12, "0")}`;
  incident.createdCriteriaId = input.criteriaId;
  if (input.templateId !== undefined) {
    incident.createdIncidentTemplateId = input.templateId;
  }
  if (input.fingerprint !== undefined) {
    incident.seriesFingerprint = input.fingerprint;
  }
  return incident;
}

// What the search of the whole list before #10108 met first for a series.
function scannedOpenIncident(input: {
  openIncidents: Array<Incident>;
  seriesFingerprint: string | undefined;
}): Incident | undefined {
  return input.openIncidents.find((incident: Incident) => {
    return (
      (incident.createdCriteriaId || undefined) === CRITERIA_ID &&
      (!incident.createdIncidentTemplateId ||
        incident.createdIncidentTemplateId === TEMPLATE_ID) &&
      (incident.seriesFingerprint || undefined) === input.seriesFingerprint
    );
  });
}

let created: Array<Incident>;

beforeEach(() => {
  mockProjectStates();
  created = [];

  jest.spyOn(IncidentService, "findBy").mockResolvedValue([]);
  jest
    .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
    .mockResolvedValue(true);
  jest
    .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
    .mockResolvedValue(MonitorResourceContextUtil.emptyContext());
  jest
    .spyOn(MonitorResourceContextUtil, "resolveLinkedResourcesForMonitor")
    .mockResolvedValue(MonitorResourceContextUtil.emptyContext());
  jest
    .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
    .mockResolvedValue({ ownerUserIds: [], ownerTeamIds: [] });
  jest
    .spyOn(IncidentService, "create")
    .mockImplementation(async (createBy: unknown): Promise<Incident> => {
      const incident: Incident = (createBy as { data: Incident }).data;
      incident._id = ObjectID.generate().toString();
      created.push(incident);
      return incident;
    });
  jest
    .spyOn(IncidentService, "addOwners")
    .mockResolvedValue(OwnerRuleAssignment.noOwnersAdded());
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function createPass(input: {
  series: Array<PerSeriesCriteriaMatch>;
  openIncidents: Array<Incident>;
  summary?: MonitorEvaluationSummary | undefined;
  keepEvaluationLock?: (() => Promise<void>) | undefined;
}): Promise<void> {
  await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
    criteriaInstance: criteriaInstance(),
    monitor: monitor(),
    dataToProcess: dataToProcess,
    rootCause: "A container runs too many tasks",
    autoResolveCriteriaInstanceIdIncidentIdsDictionary: {},
    evaluationSummary: input.summary,
    openIncidents: input.openIncidents,
    matchesPerSeries: input.series,
    keepEvaluationLock: input.keepEvaluationLock,
    props: {},
  });
}

function createdFingerprints(): Array<string> {
  return created
    .map((incident: Incident): string => {
      return String(incident.seriesFingerprint);
    })
    .sort();
}

describe("the incident create pass, over a grouped criteria's series", () => {
  it("opens an incident for exactly the series the search of every open incident found none for", async () => {
    const random: SeededRandom = seededRandom(10108);
    const series: Array<PerSeriesCriteriaMatch> = [];
    const openIncidents: Array<Incident> = [];
    let nextId: number = 1;

    for (let index: number = 0; index < 300; index++) {
      series.push(seriesMatch(index));
      const fingerprint: string = `fp-${index}`;

      switch (random(7)) {
        case 0:
          // From this criteria's template: blocks.
          openIncidents.push(
            openIncident({
              id: nextId++,
              criteriaId: CRITERIA_ID,
              templateId: TEMPLATE_ID,
              fingerprint,
            }),
          );
          break;
        case 1:
          // From a template that had no id: blocks, as before.
          openIncidents.push(
            openIncident({
              id: nextId++,
              criteriaId: CRITERIA_ID,
              fingerprint,
            }),
          );
          break;
        case 2:
          // From another template of this criteria: does not block.
          openIncidents.push(
            openIncident({
              id: nextId++,
              criteriaId: CRITERIA_ID,
              templateId: OTHER_TEMPLATE_ID,
              fingerprint,
            }),
          );
          break;
        case 3:
          // Another template's first, then this template's: blocks.
          openIncidents.push(
            openIncident({
              id: nextId++,
              criteriaId: CRITERIA_ID,
              templateId: OTHER_TEMPLATE_ID,
              fingerprint,
            }),
            openIncident({
              id: nextId++,
              criteriaId: CRITERIA_ID,
              templateId: TEMPLATE_ID,
              fingerprint,
            }),
          );
          break;
        case 4:
          // Another criteria's: does not block.
          openIncidents.push(
            openIncident({
              id: nextId++,
              criteriaId: OTHER_CRITERIA_ID,
              templateId: TEMPLATE_ID,
              fingerprint,
            }),
          );
          break;
        default:
          break;
      }
    }

    // This criteria's incident for the whole monitor blocks no series.
    openIncidents.push(
      openIncident({
        id: nextId++,
        criteriaId: CRITERIA_ID,
        templateId: TEMPLATE_ID,
      }),
    );

    const summary: MonitorEvaluationSummary = {
      evaluatedAt: new Date("2026-11-17T10:04:00.000Z"),
      criteriaResults: [],
      events: [],
    };

    await createPass({ series, openIncidents, summary });

    const expectedCreated: Array<string> = [];
    const expectedSkippedFor: Array<string> = [];

    for (const match of series) {
      const open: Incident | undefined = scannedOpenIncident({
        openIncidents,
        seriesFingerprint: match.fingerprint,
      });

      if (open) {
        expectedSkippedFor.push(open.id!.toString());
      } else {
        expectedCreated.push(match.fingerprint);
      }
    }

    expect(createdFingerprints()).toEqual(expectedCreated.sort());
    expect(expectedCreated.length).toBeGreaterThan(50);
    expect(expectedSkippedFor.length).toBeGreaterThan(50);

    // Each skip names the incident the search met first.
    expect(
      summary.events
        .filter((event: MonitorEvaluationSummary["events"][number]) => {
          return event.type === "incident-skipped" && event.relatedIncidentId;
        })
        .map((event: MonitorEvaluationSummary["events"][number]): string => {
          return String(event.relatedIncidentId);
        })
        .sort(),
    ).toEqual(expectedSkippedFor.sort());
  });

  it("checks the evaluation's lock before each series, and stops at the first refusal", async () => {
    let checks: number = 0;

    await expect(
      createPass({
        series: [0, 1, 2, 3, 4].map(seriesMatch),
        openIncidents: [],
        keepEvaluationLock: async (): Promise<void> => {
          checks++;

          if (checks === 3) {
            throw new Error("the evaluation lost its lock");
          }
        },
      }),
    ).rejects.toThrow("the evaluation lost its lock");

    expect(checks).toBe(3);
    expect(createdFingerprints()).toEqual(["fp-0", "fp-1"]);
  });
});
