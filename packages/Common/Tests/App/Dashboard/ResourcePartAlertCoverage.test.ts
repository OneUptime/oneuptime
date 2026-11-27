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
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import {
  MonitorRecommendationCoverageQuestion,
  getCoverageSearchText,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationCoverageQuestions";
import ObjectID from "../../../Types/ObjectID";
import MonitorRecommendationCoverageApi from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/MonitorRecommendationCoverageApi";
import { answerCoverage } from "./MonitorCoverageServer";
import type { SpyInstance } from "jest-mock";

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

// Which alerts a monitor covers is the server's to say (#11074).
let coverageSpy: SpyInstance<
  typeof MonitorRecommendationCoverageApi.findCoveringMonitors
>;

beforeEach(() => {
  listCalls.length = 0;
  monitorsToReturn = [];
  dismissalsToReturn = [];
  failMonitors = false;
  coverageSpy = jest
    .spyOn(MonitorRecommendationCoverageApi, "findCoveringMonitors")
    .mockImplementation(
      async (
        questions: Array<MonitorRecommendationCoverageQuestion>,
      ): Promise<Map<string, ObjectID>> => {
        if (failMonitors) {
          throw new Error("You do not have permission.");
        }

        return answerCoverage({ questions, monitors: monitorsToReturn });
      },
    ) as unknown as SpyInstance<
    typeof MonitorRecommendationCoverageApi.findCoveringMonitors
  >;
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

  /*
   * A Kubernetes node's page lists Node Image Disk Almost Full only for a node
   * whose images have a disk of their own (#10056): on any other the template
   * reads the root filesystem High Node Disk Usage watches.
   */
  test("a Kubernetes node lists the image disk alert only when its images have a disk of their own", () => {
    const NODE_ALERTS: Array<string> = [
      "k8s-high-disk-usage",
      "k8s-node-image-disk-almost-full",
    ];
    const listed: (hasImageDisk?: boolean) => Array<string> = (
      hasImageDisk?: boolean,
    ): Array<string> => {
      return getResourcePartAlertRecommendations({
        resourceType: MonitorRecommendationResourceType.Kubernetes,
        templateIds: NODE_ALERTS,
        context:
          hasImageDisk === undefined
            ? undefined
            : { kubernetesHasSeparateImageDisk: hasImageDisk },
      }).map((recommendation: MonitorRecommendation): string => {
        return recommendation.templateId;
      });
    };

    expect(listed(true)).toEqual(NODE_ALERTS);
    expect(listed(false)).toEqual(["k8s-high-disk-usage"]);
    expect(listed()).toEqual(["k8s-high-disk-usage"]);
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

  /*
   * #11074: the part's page read the project's first 10,000 monitors of
   * the alerts' types, so a monitor past them never turned an alert on.
   */
  test("the server is asked once, each alert with its own monitor's type - the project's monitors are never read", async () => {
    await statuses();

    expect(
      listCalls.filter((call: ListCall): boolean => {
        return call.modelName === "Monitor";
      }),
    ).toEqual([]);
    expect(coverageSpy).toHaveBeenCalledTimes(1);

    const questions: Array<MonitorRecommendationCoverageQuestion> =
      coverageSpy.mock.calls[0]![0];
    expect(
      questions.map((question: MonitorRecommendationCoverageQuestion) => {
        return question.key;
      }),
    ).toEqual(
      PROXMOX_NODE_ALERT_TEMPLATE_IDS.map((templateId: string): string => {
        return recommendationFor(templateId).recommendationId;
      }),
    );
    expect(
      Array.from(
        new Set<string>(
          questions.map((question: MonitorRecommendationCoverageQuestion) => {
            return question.monitorType;
          }),
        ),
      ).sort(),
    ).toEqual([MonitorType.Logs, MonitorType.Proxmox].sort());
  });

  test("one alert is one question, of its own type, about this cluster", async () => {
    await loadResourcePartAlertCoverage({
      resourceType: MonitorRecommendationResourceType.Proxmox,
      templateIds: ["pve-storage-near-full"],
      resourceId: CLUSTER_ID,
      resourceIdentifier: CLUSTER_NAME,
    });

    const questions: Array<MonitorRecommendationCoverageQuestion> =
      coverageSpy.mock.calls[0]![0];
    expect(questions).toHaveLength(1);
    expect(questions[0]!.monitorType).toBe(MonitorType.Proxmox);
    expect(getCoverageSearchText(questions[0]!.fingerprints[0]!)).toBe(
      CLUSTER_NAME,
    );
  });

  test("a monitor past the project's first 10,000 turns its alert on", async () => {
    monitorsToReturn = [
      ...Array.from({ length: 10050 }, (_: unknown, index: number) => {
        return monitorFor(
          "pve-node-offline",
          `pve-other-${index}`,
          `70000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
        );
      }),
      monitorFor(
        "pve-node-offline",
        CLUSTER_NAME,
        "70000000-0000-4000-8000-0000000fffff",
      ),
    ];

    expect(Object.fromEntries(await statuses())["pve-node-offline"]).toBe(
      RecommendationStatus.Created,
    );
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
    expect(coverageSpy).not.toHaveBeenCalled();
  });

  test("a role that may not read monitors gets the refusal, for the card to stay out of the way", async () => {
    failMonitors = true;

    await expect(statuses()).rejects.toThrow("You do not have permission.");
  });
});
