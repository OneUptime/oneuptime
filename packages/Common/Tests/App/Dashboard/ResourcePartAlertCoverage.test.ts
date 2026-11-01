import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import RecommendationDismissal from "../../../Models/DatabaseModels/RecommendationDismissal";
import Includes from "../../../Types/BaseDatabase/Includes";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "../../../Types/ObjectID";

/*
 * Which of a resource's recommended alerts that watch one kind of part are
 * on (Components/ResourcePart/ResourcePartAlertCoverage), read the way the
 * resource's Recommendations page reads them - the catalog, the resource's
 * monitors through the same fingerprint diff, and what the team dismissed -
 * here for a Proxmox node, whose alerts include one on Proxmox VE's own
 * notifications (a Logs monitor beside the Proxmox ones).
 */

interface ListCall {
  modelName: string;
  query: Record<string, unknown>;
}

const listCalls: Array<ListCall> = [];
let monitorsToReturn: Array<Monitor> = [];
let dismissalsToReturn: Array<RecommendationDismissal> = [];
let failMonitors: boolean = false;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (request: {
        modelType: new () => { tableName?: string };
        query: Record<string, unknown>;
      }): Promise<unknown> => {
        const modelName: string =
          new request.modelType().tableName || "unknown";
        listCalls.push({ modelName, query: request.query });
        if (modelName === "Monitor") {
          if (failMonitors) {
            return Promise.reject(new Error("You do not have permission."));
          }
          return Promise.resolve({
            data: monitorsToReturn,
            count: monitorsToReturn.length,
          });
        }
        if (modelName === "RecommendationDismissal") {
          return Promise.resolve({
            data: dismissalsToReturn,
            count: dismissalsToReturn.length,
          });
        }
        return Promise.resolve({ data: [], count: 0 });
      },
    },
  };
});

import {
  countResourcePartAlertsOn,
  getResourcePartAlertRecommendations,
  getResourcePartAlertsToTurnOn,
  loadResourcePartAlertCoverage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartAlertCoverage";
import {
  RecommendationStatus,
  RecommendationViewModel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationViewModel";
import { PROXMOX_NODE_ALERT_TEMPLATE_IDS } from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/ProxmoxPartFacts";

const CLUSTER_ID: ObjectID = new ObjectID(
  "71000000-0000-4000-8000-000000000001",
);
const CLUSTER_NAME: string = "pve-prod";

function recommendationFor(templateId: string): MonitorRecommendation {
  return MonitorRecommendationCatalog.getRecommendations(
    MonitorRecommendationResourceType.Proxmox,
  ).find((candidate: MonitorRecommendation): boolean => {
    return candidate.templateId === templateId;
  })!;
}

// A monitor saved as Create on the Recommendations page saves it.
function monitorFor(
  templateId: string,
  clusterName: string,
  monitorId: string,
): Monitor {
  const recommendation: MonitorRecommendation = recommendationFor(templateId);
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [
      recommendation.getMonitorStep({
        resourceIdentifier: clusterName,
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: clusterName,
      }),
    ],
    defaultMonitorStatusId: ObjectID.getZeroObjectID(),
  };

  const monitor: Monitor = new Monitor();
  monitor._id = monitorId;
  monitor.name = `${clusterName} - ${recommendation.name}`;
  monitor.monitorType = recommendation.monitorType;
  monitor.monitorSteps = monitorSteps;
  return monitor;
}

function dismissal(templateId: string): RecommendationDismissal {
  const model: RecommendationDismissal = new RecommendationDismissal();
  model._id = "79000000-0000-4000-8000-000000000001";
  model.recommendationId = recommendationFor(templateId).recommendationId;
  model.dismissalReason = "We page on this from another tool.";
  return model;
}

async function statuses(): Promise<Array<[string, RecommendationStatus]>> {
  const viewModels: Array<RecommendationViewModel> =
    await loadResourcePartAlertCoverage({
      resourceType: MonitorRecommendationResourceType.Proxmox,
      templateIds: PROXMOX_NODE_ALERT_TEMPLATE_IDS,
      resourceId: CLUSTER_ID,
      resourceIdentifier: CLUSTER_NAME,
    });
  return viewModels.map(
    (viewModel: RecommendationViewModel): [string, RecommendationStatus] => {
      return [viewModel.recommendation.templateId, viewModel.status];
    },
  );
}

beforeEach(() => {
  listCalls.length = 0;
  monitorsToReturn = [];
  dismissalsToReturn = [];
  failMonitors = false;
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("the recommendations that watch a kind of part", () => {
  test("are the catalog's, in the order the part's page lists them", () => {
    expect(
      getResourcePartAlertRecommendations({
        resourceType: MonitorRecommendationResourceType.Proxmox,
        templateIds: PROXMOX_NODE_ALERT_TEMPLATE_IDS,
      }).map((recommendation: MonitorRecommendation): string => {
        return recommendation.templateId;
      }),
    ).toEqual(PROXMOX_NODE_ALERT_TEMPLATE_IDS);
  });

  test("an id the catalog does not offer is left out, not drawn blank", () => {
    expect(
      getResourcePartAlertRecommendations({
        resourceType: MonitorRecommendationResourceType.Proxmox,
        templateIds: ["pve-node-offline", "no-such-template"],
      }),
    ).toHaveLength(1);
  });
});

describe("which of them are on", () => {
  test("none: every one waits to be turned on", async () => {
    expect(await statuses()).toEqual(
      PROXMOX_NODE_ALERT_TEMPLATE_IDS.map(
        (id: string): [string, RecommendationStatus] => {
          return [id, RecommendationStatus.Available];
        },
      ),
    );
  });

  test("a monitor saved from the Recommendations page turns its alert on, a Logs one too", async () => {
    monitorsToReturn = [
      monitorFor(
        "pve-node-offline",
        CLUSTER_NAME,
        "70000000-0000-4000-8000-000000000001",
      ),
      monitorFor(
        "pve-node-fenced",
        CLUSTER_NAME,
        "70000000-0000-4000-8000-000000000002",
      ),
    ];

    const loaded: Array<[string, RecommendationStatus]> = await statuses();
    expect(Object.fromEntries(loaded)).toEqual(
      expect.objectContaining({
        "pve-node-offline": RecommendationStatus.Created,
        "pve-node-fenced": RecommendationStatus.Created,
        "pve-node-high-cpu": RecommendationStatus.Available,
      }),
    );
  });

  test("a monitor for another cluster does not cover this one", async () => {
    monitorsToReturn = [
      monitorFor(
        "pve-node-offline",
        "pve-dr",
        "70000000-0000-4000-8000-000000000003",
      ),
    ];

    expect(Object.fromEntries(await statuses())["pve-node-offline"]).toBe(
      RecommendationStatus.Available,
    );
  });

  test("a dismissed alert stays dismissed, and is not ticked to turn on", async () => {
    dismissalsToReturn = [dismissal("pve-node-restarted")];

    const viewModels: Array<RecommendationViewModel> =
      await loadResourcePartAlertCoverage({
        resourceType: MonitorRecommendationResourceType.Proxmox,
        templateIds: PROXMOX_NODE_ALERT_TEMPLATE_IDS,
        resourceId: CLUSTER_ID,
        resourceIdentifier: CLUSTER_NAME,
      });

    expect(
      viewModels.find((viewModel: RecommendationViewModel): boolean => {
        return viewModel.recommendation.templateId === "pve-node-restarted";
      })?.status,
    ).toBe(RecommendationStatus.Dismissed);
    expect(getResourcePartAlertsToTurnOn(viewModels)).not.toContain(
      recommendationFor("pve-node-restarted").recommendationId,
    );
    expect(getResourcePartAlertsToTurnOn(viewModels)).toHaveLength(
      PROXMOX_NODE_ALERT_TEMPLATE_IDS.length - 1,
    );
    expect(countResourcePartAlertsOn(viewModels)).toBe(0);
  });

  test("the monitors are read once, of every type the alerts use", async () => {
    await statuses();

    const monitorReads: Array<ListCall> = listCalls.filter(
      (call: ListCall): boolean => {
        return call.modelName === "Monitor";
      },
    );
    expect(monitorReads).toHaveLength(1);
    const monitorType: unknown = monitorReads[0]!.query["monitorType"];
    expect(monitorType).toBeInstanceOf(Includes);
    expect(
      [...((monitorType as Includes).values as Array<string>)].sort(),
    ).toEqual([MonitorType.Logs, MonitorType.Proxmox].sort());
  });

  test("one monitor type is queried as itself", async () => {
    await loadResourcePartAlertCoverage({
      resourceType: MonitorRecommendationResourceType.Proxmox,
      templateIds: ["pve-storage-near-full"],
      resourceId: CLUSTER_ID,
      resourceIdentifier: CLUSTER_NAME,
    });

    const read: ListCall = listCalls.find((call: ListCall): boolean => {
      return call.modelName === "Monitor";
    })!;
    expect(read.query["monitorType"]).toBe(MonitorType.Proxmox);
  });

  test("no recommendation, no read", async () => {
    expect(
      await loadResourcePartAlertCoverage({
        resourceType: MonitorRecommendationResourceType.Proxmox,
        templateIds: [],
        resourceId: CLUSTER_ID,
        resourceIdentifier: CLUSTER_NAME,
      }),
    ).toEqual([]);
    expect(listCalls).toHaveLength(0);
  });

  test("a role that may not read monitors gets the refusal, for the card to stay out of the way", async () => {
    failMonitors = true;

    await expect(statuses()).rejects.toThrow("You do not have permission.");
  });
});
