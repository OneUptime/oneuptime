/*
 * The alert creation path pulls the native isolated-vm addon through its
 * template renderer (MonitorAlert → MonitorTemplateUtil → VMAPI →
 * VMRunner). Nothing under test here touches the sandbox, and the
 * prebuilt binary cannot always dlopen in the test environment — so stub
 * the module out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AlertService from "../../../../Server/Services/AlertService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import NetworkDeviceOwnerUserService from "../../../../Server/Services/NetworkDeviceOwnerUserService";
import logger from "../../../../Server/Utils/Logger";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
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
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * A GROUPED CRITERIA'S SERIES, EACH LOOKED UP IN ITS OPEN ALERTS ONCE
 * (issue #10108).
 *
 * For every series a criteria matched, the create pass asks whether the
 * criteria already has an alert open for it, and skips the series if so. It
 * searched the whole list of open alerts for each series: 16,250 series
 * times the open alerts, at every evaluation of the #10108 fleet. The open
 * alerts of the criteria are now laid out by series once, keeping the first
 * of each in the order they were read - the one the search met first. And
 * before each series' write the evaluation's lock is checked: a lost lock
 * stops the pass, past the catch that keeps one series' failure from
 * stopping the others.
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

const CRITERIA_ID: string = "criteria-restarted";
const OTHER_CRITERIA_ID: string = "criteria-too-many-tasks";

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
  instance.data!.name = "Container restarted";
  instance.data!.createIncidents = false;
  instance.data!.createAlerts = true;
  instance.data!.alerts = [
    {
      id: "alert-template-1",
      title: "Container restarted",
      description: "A container restarted.",
      alertSeverityId: SEVERITY_ID,
      autoResolveAlert: true,
      onCallPolicyIds: [],
    },
  ];
  return instance;
}

const dataToProcess: ProbeMonitorResponse = {
  projectId: PROJECT_ID,
  monitorId: MONITOR_ID,
  monitoredAt: new Date("2026-11-17T10:04:00.000Z"),
} as unknown as ProbeMonitorResponse;

function seriesMatch(index: number): PerSeriesCriteriaMatch {
  return {
    criteriaMetId: CRITERIA_ID,
    fingerprint: `fp-${index}`,
    labels: { "resource.container.name": `container-${index}` },
    rootCause: `container-${index} restarted`,
  };
}

function openAlert(input: {
  id: number;
  criteriaId?: string | undefined;
  fingerprint?: string | undefined;
}): Alert {
  const alert: Alert = new Alert();
  alert._id = `00000000-0000-4000-8000-${String(input.id).padStart(12, "0")}`;
  alert.title = `Open alert ${input.id}`;
  if (input.criteriaId !== undefined) {
    alert.createdCriteriaId = input.criteriaId;
  }
  if (input.fingerprint !== undefined) {
    alert.seriesFingerprint = input.fingerprint;
  }
  return alert;
}

let createdAlerts: Array<Alert>;

beforeEach(() => {
  mockProjectStates();
  createdAlerts = [];

  jest.spyOn(AlertService, "findBy").mockResolvedValue([]);

  jest
    .spyOn(AlertSeverityService, "findOneBy")
    .mockImplementation(async (): Promise<AlertSeverity | null> => {
      const severity: AlertSeverity = new AlertSeverity();
      severity._id = SEVERITY_ID.toString();
      severity.projectId = PROJECT_ID;
      return severity;
    });

  jest
    .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
    .mockResolvedValue({
      hostIds: [],
      dockerHostIds: [],
      podmanHostIds: [],
      kubernetesClusterIds: [],
      serviceIds: [],
      proxmoxClusterIds: [],
      openStackCloudIds: [],
      vmwareVCenterIds: [],
      cephClusterIds: [],
      dockerSwarmClusterIds: [],
      iotFleetIds: [],
      databaseServerIds: [],
      storageArrayIds: [],
      cloudResourceIds: [],
      networkDeviceIds: [],
    });

  jest
    .spyOn(MonitorResourceContextUtil, "resolveLinkedResourcesForMonitor")
    .mockResolvedValue(MonitorResourceContextUtil.emptyContext());

  jest
    .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
    .mockResolvedValue({ ownerUserIds: [], ownerTeamIds: [] });

  jest
    .spyOn(AlertService, "create")
    .mockImplementation(async (createBy: unknown): Promise<Alert> => {
      const alert: Alert = (createBy as { data: Alert }).data;
      alert._id = ObjectID.generate().toString();
      createdAlerts.push(alert);
      return alert;
    });

  jest
    .spyOn(AlertService, "addOwners")
    .mockResolvedValue(OwnerRuleAssignment.noOwnersAdded());

  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function createPass(input: {
  series: Array<PerSeriesCriteriaMatch>;
  openAlerts: Array<Alert>;
  summary?: MonitorEvaluationSummary | undefined;
  keepEvaluationLock?: (() => Promise<void>) | undefined;
}): Promise<void> {
  await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
    criteriaInstance: criteriaInstance(),
    monitor: monitor(),
    dataToProcess: dataToProcess,
    rootCause: "A container restarted",
    autoResolveCriteriaInstanceIdAlertIdsDictionary: {},
    props: {},
    matchesPerSeries: input.series,
    openAlerts: input.openAlerts,
    evaluationSummary: input.summary,
    keepEvaluationLock: input.keepEvaluationLock,
  });
}

function createdFingerprints(): Array<string> {
  return createdAlerts
    .map((alert: Alert): string => {
      return String(alert.seriesFingerprint);
    })
    .sort();
}

describe("the alert create pass, over a grouped criteria's series", () => {
  it("skips exactly the series this criteria has an alert open for, naming the first one read", async () => {
    const random: SeededRandom = seededRandom(10108);
    const series: Array<PerSeriesCriteriaMatch> = [];
    const openAlerts: Array<Alert> = [];
    let nextId: number = 1;

    for (let index: number = 0; index < 400; index++) {
      series.push(seriesMatch(index));
      const pick: number = random(5);

      if (pick === 0 || pick === 1) {
        // Open for this criteria - now and then twice.
        const copies: number = pick === 0 ? 1 : 2;

        for (let copy: number = 0; copy < copies; copy++) {
          const alert: Alert = openAlert({
            id: nextId++,
            criteriaId: CRITERIA_ID,
            fingerprint: `fp-${index}`,
          });
          openAlerts.push(alert);
        }
      } else if (pick === 2) {
        // Open for another criteria: no reason to skip.
        openAlerts.push(
          openAlert({
            id: nextId++,
            criteriaId: OTHER_CRITERIA_ID,
            fingerprint: `fp-${index}`,
          }),
        );
      }
    }

    // This criteria's alert for the whole monitor blocks no series.
    openAlerts.push(openAlert({ id: nextId++, criteriaId: CRITERIA_ID }));

    // Shuffled, so the first of a series is not always the lower id.
    for (let index: number = openAlerts.length - 1; index > 0; index--) {
      const swapWith: number = random(index + 1);
      [openAlerts[index], openAlerts[swapWith]] = [
        openAlerts[swapWith]!,
        openAlerts[index]!,
      ];
    }

    // What a search of the list for each series met first.
    const firstOpenBySeries: Map<string, string> = new Map();
    for (const alert of openAlerts) {
      if (
        alert.createdCriteriaId === CRITERIA_ID &&
        alert.seriesFingerprint &&
        !firstOpenBySeries.has(alert.seriesFingerprint)
      ) {
        firstOpenBySeries.set(alert.seriesFingerprint, alert.id!.toString());
      }
    }

    const summary: MonitorEvaluationSummary = {
      criteriaResults: [],
      events: [],
    } as unknown as MonitorEvaluationSummary;

    await createPass({ series, openAlerts, summary });

    expect(createdFingerprints()).toEqual(
      series
        .map((match: PerSeriesCriteriaMatch): string => {
          return match.fingerprint;
        })
        .filter((fingerprint: string): boolean => {
          return !firstOpenBySeries.has(fingerprint);
        })
        .sort(),
    );

    const skipped: Map<string, string> = new Map();
    for (const event of summary.events) {
      if (event.type === "alert-skipped" && event.relatedAlertId) {
        skipped.set(event.relatedAlertId, event.relatedAlertId);
      }
    }

    expect(Array.from(skipped.keys()).sort()).toEqual(
      Array.from(firstOpenBySeries.values()).sort(),
    );
  });

  it("an ungrouped criteria's open alert for the whole monitor keeps it from opening another; a series' alert does not", async () => {
    const ungrouped: (openAlerts: Array<Alert>) => Promise<void> = async (
      openAlerts: Array<Alert>,
    ): Promise<void> => {
      await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
        criteriaInstance: criteriaInstance(),
        monitor: monitor(),
        dataToProcess: dataToProcess,
        rootCause: "A container restarted",
        autoResolveCriteriaInstanceIdAlertIdsDictionary: {},
        props: {},
        openAlerts: openAlerts,
      });
    };

    await ungrouped([
      openAlert({ id: 1, criteriaId: CRITERIA_ID, fingerprint: "fp-1" }),
      openAlert({ id: 2, criteriaId: CRITERIA_ID }),
    ]);
    expect(createdAlerts).toEqual([]);

    await ungrouped([
      openAlert({ id: 1, criteriaId: CRITERIA_ID, fingerprint: "fp-1" }),
      openAlert({ id: 3, criteriaId: OTHER_CRITERIA_ID }),
    ]);
    expect(createdAlerts).toHaveLength(1);
    expect(createdAlerts[0]!.seriesFingerprint).toBeFalsy();
  });

  it("checks the evaluation's lock before each series, and stops at the first refusal", async () => {
    let checks: number = 0;

    await expect(
      createPass({
        series: [0, 1, 2, 3, 4, 5].map(seriesMatch),
        openAlerts: [],
        keepEvaluationLock: async (): Promise<void> => {
          checks++;

          if (checks === 4) {
            throw new Error("the evaluation lost its lock");
          }
        },
      }),
    ).rejects.toThrow("the evaluation lost its lock");

    // Three series written; the fourth and later never.
    expect(checks).toBe(4);
    expect(createdFingerprints()).toEqual(["fp-0", "fp-1", "fp-2"]);
  });
});
