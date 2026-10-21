import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import RecommendationDismissal from "../../../Models/DatabaseModels/RecommendationDismissal";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "../../../Types/ObjectID";
import RecommendationType from "../../../Types/Recommendation/RecommendationType";

/*
 * Which of the recommended ESXi host alerts are on, for an ESXi host's page
 * (Components/VMware/Host/VMwareHostAlertCoverage): read exactly as the
 * vCenter's Recommendations page reads it - the catalog's Host category,
 * the vCenter's VMware monitors through the same fingerprint diff, and what
 * the team dismissed - so the host page and that page never disagree about
 * an alert being on.
 */

interface ListCall {
  modelName: string;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
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
        select: Record<string, unknown>;
      }): Promise<unknown> => {
        const modelName: string =
          new request.modelType().tableName || "unknown";
        listCalls.push({
          modelName,
          query: request.query,
          select: request.select,
        });
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
  VMWARE_HOST_ALERT_CATEGORY,
  countVMwareHostAlertsOn,
  getVMwareHostAlertRecommendations,
  getVMwareHostAlertsToTurnOn,
  loadVMwareHostAlertCoverage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/Host/VMwareHostAlertCoverage";
import {
  RecommendationStatus,
  RecommendationViewModel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationViewModel";

const VCENTER_ID: ObjectID = new ObjectID(
  "31000000-0000-4000-8000-000000000001",
);
const VCENTER_NAME: string = "vcenter-prod";

function monitorFor(
  templateId: string,
  vcenterName: string,
  monitorId: string,
): Monitor {
  const recommendation: MonitorRecommendation =
    MonitorRecommendationCatalog.getRecommendations(
      MonitorRecommendationResourceType.VMware,
    ).find((candidate: MonitorRecommendation): boolean => {
      return candidate.templateId === templateId;
    })!;

  const zero: ObjectID = ObjectID.getZeroObjectID();
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [
      // Saved as Create on the Recommendations page saves it.
      recommendation.getMonitorStep({
        resourceIdentifier: vcenterName,
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: vcenterName,
      }),
    ],
    defaultMonitorStatusId: zero,
  };

  const monitor: Monitor = new Monitor();
  monitor._id = monitorId;
  monitor.name = `${vcenterName} - ${recommendation.name}`;
  monitor.monitorType = MonitorType.VMware;
  monitor.monitorSteps = monitorSteps;
  return monitor;
}

function dismissal(templateId: string): RecommendationDismissal {
  const model: RecommendationDismissal = new RecommendationDismissal();
  model._id = "71000000-0000-4000-8000-000000000001";
  model.recommendationId = `VMware:${templateId}`;
  model.dismissalReason = "We page on this from vROps.";
  return model;
}

function statuses(
  viewModels: Array<RecommendationViewModel>,
): Record<string, RecommendationStatus> {
  const result: Record<string, RecommendationStatus> = {};
  for (const viewModel of viewModels) {
    result[viewModel.recommendation.templateId] = viewModel.status;
  }
  return result;
}

beforeEach(() => {
  listCalls.length = 0;
  monitorsToReturn = [];
  dismissalsToReturn = [];
  failMonitors = false;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the host alerts", () => {
  test("are the VMware catalog's Host category, in catalog order", () => {
    expect(VMWARE_HOST_ALERT_CATEGORY).toBe("Host");
    expect(
      getVMwareHostAlertRecommendations().map(
        (recommendation: MonitorRecommendation): string => {
          return recommendation.templateId;
        },
      ),
    ).toEqual([
      "vmware-host-cpu-saturation",
      "vmware-host-memory-saturation",
      "vmware-host-disk-latency-high",
      "vmware-host-network-packet-errors",
      "vmware-host-network-packet-drops",
    ]);
  });

  test("each one is a vCenter-wide monitor that groups by the host", () => {
    for (const recommendation of getVMwareHostAlertRecommendations()) {
      expect(recommendation.resourceType).toBe(
        MonitorRecommendationResourceType.VMware,
      );
      const step: string = JSON.stringify(
        recommendation
          .getMonitorStep({
            resourceIdentifier: VCENTER_NAME,
            onlineMonitorStatusId: ObjectID.generate(),
            offlineMonitorStatusId: ObjectID.generate(),
            defaultIncidentSeverityId: ObjectID.generate(),
            defaultAlertSeverityId: ObjectID.generate(),
            monitorName: VCENTER_NAME,
          })
          .toJSON(),
      );
      expect(step).toContain("resource.vcenter.host.name");
      expect(step).toContain(VCENTER_NAME);
    }
  });
});

describe("which are on for this vCenter", () => {
  test("none: every host alert is still to turn on", async () => {
    const viewModels: Array<RecommendationViewModel> =
      await loadVMwareHostAlertCoverage({
        vcenterId: VCENTER_ID,
        vcenterName: VCENTER_NAME,
      });

    expect(viewModels).toHaveLength(5);
    expect(
      viewModels.every((viewModel: RecommendationViewModel): boolean => {
        return viewModel.status === RecommendationStatus.Available;
      }),
    ).toBe(true);
    expect(countVMwareHostAlertsOn(viewModels)).toBe(0);
    expect(getVMwareHostAlertsToTurnOn(viewModels)).toEqual(
      getVMwareHostAlertRecommendations().map(
        (recommendation: MonitorRecommendation): string => {
          return recommendation.recommendationId;
        },
      ),
    );
  });

  test("a monitor created from a host alert covers it, and links to that monitor", async () => {
    monitorsToReturn = [
      monitorFor(
        "vmware-host-cpu-saturation",
        VCENTER_NAME,
        "70000000-0000-4000-8000-000000000001",
      ),
    ];

    const viewModels: Array<RecommendationViewModel> =
      await loadVMwareHostAlertCoverage({
        vcenterId: VCENTER_ID,
        vcenterName: VCENTER_NAME,
      });

    const cpu: RecommendationViewModel = viewModels.find(
      (viewModel: RecommendationViewModel): boolean => {
        return viewModel.recommendation.templateId === "vmware-host-cpu-saturation";
      },
    )!;
    expect(cpu.status).toBe(RecommendationStatus.Created);
    expect(cpu.monitorId?.toString()).toBe(
      "70000000-0000-4000-8000-000000000001",
    );
    expect(countVMwareHostAlertsOn(viewModels)).toBe(1);
    expect(getVMwareHostAlertsToTurnOn(viewModels)).not.toContain(
      "VMware:vmware-host-cpu-saturation",
    );
    expect(getVMwareHostAlertsToTurnOn(viewModels)).toHaveLength(4);
  });

  test("another vCenter's monitor does not cover this vCenter's hosts", async () => {
    monitorsToReturn = [
      monitorFor(
        "vmware-host-cpu-saturation",
        "vcenter-lab",
        "70000000-0000-4000-8000-000000000002",
      ),
    ];

    const viewModels: Array<RecommendationViewModel> =
      await loadVMwareHostAlertCoverage({
        vcenterId: VCENTER_ID,
        vcenterName: VCENTER_NAME,
      });

    expect(countVMwareHostAlertsOn(viewModels)).toBe(0);
  });

  test("a monitor for another resource kind's template covers no host alert", async () => {
    monitorsToReturn = [
      monitorFor(
        "vmware-vm-cpu-saturation",
        VCENTER_NAME,
        "70000000-0000-4000-8000-000000000003",
      ),
    ];

    const viewModels: Array<RecommendationViewModel> =
      await loadVMwareHostAlertCoverage({
        vcenterId: VCENTER_ID,
        vcenterName: VCENTER_NAME,
      });

    expect(countVMwareHostAlertsOn(viewModels)).toBe(0);
  });

  test("a dismissed alert stays dismissed, and Turn on leaves it to the team", async () => {
    dismissalsToReturn = [dismissal("vmware-host-network-packet-drops")];
    monitorsToReturn = [
      monitorFor(
        "vmware-host-memory-saturation",
        VCENTER_NAME,
        "70000000-0000-4000-8000-000000000004",
      ),
    ];

    const viewModels: Array<RecommendationViewModel> =
      await loadVMwareHostAlertCoverage({
        vcenterId: VCENTER_ID,
        vcenterName: VCENTER_NAME,
      });

    expect(statuses(viewModels)).toEqual({
      "vmware-host-cpu-saturation": RecommendationStatus.Available,
      "vmware-host-memory-saturation": RecommendationStatus.Created,
      "vmware-host-disk-latency-high": RecommendationStatus.Available,
      "vmware-host-network-packet-errors": RecommendationStatus.Available,
      "vmware-host-network-packet-drops": RecommendationStatus.Dismissed,
    });
    expect(getVMwareHostAlertsToTurnOn(viewModels)).toEqual([
      "VMware:vmware-host-cpu-saturation",
      "VMware:vmware-host-disk-latency-high",
      "VMware:vmware-host-network-packet-errors",
    ]);
  });

  test("it reads the VMware monitors and this vCenter's monitor dismissals", async () => {
    await loadVMwareHostAlertCoverage({
      vcenterId: VCENTER_ID,
      vcenterName: VCENTER_NAME,
    });

    const monitorCall: ListCall | undefined = listCalls.find(
      (call: ListCall): boolean => {
        return call.modelName === "Monitor";
      },
    );
    expect(monitorCall?.query).toEqual({ monitorType: MonitorType.VMware });
    expect(monitorCall?.select).toEqual({ name: true, monitorSteps: true });

    const dismissalCall: ListCall | undefined = listCalls.find(
      (call: ListCall): boolean => {
        return call.modelName === "RecommendationDismissal";
      },
    );
    expect(dismissalCall?.query).toEqual({
      recommendationType: RecommendationType.Monitor,
      resourceType: MonitorRecommendationResourceType.VMware,
      resourceId: VCENTER_ID,
    });
  });

  test("a role that may not read monitors gets an error, which the card turns into no card", async () => {
    failMonitors = true;

    await expect(
      loadVMwareHostAlertCoverage({
        vcenterId: VCENTER_ID,
        vcenterName: VCENTER_NAME,
      }),
    ).rejects.toThrow("You do not have permission.");
  });
});
