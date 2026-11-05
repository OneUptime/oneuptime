import { afterEach, describe, expect, jest, test } from "@jest/globals";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import OpenStackCloud from "../../../../Models/DatabaseModels/OpenStackCloud";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import OpenStackCloudService from "../../../../Server/Services/OpenStackCloudService";
import OpenStackResourceService from "../../../../Server/Services/OpenStackResourceService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../../Server/Services/ScheduledMaintenanceStateService";
import MonitorMaintenanceSuppression, {
  MonitorMaintenanceSuppressionResult,
} from "../../../../Server/Utils/Monitor/MonitorMaintenanceSuppression";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import { getOpenStackAlertTemplateById } from "../../../../Types/Monitor/OpenStackAlertTemplates";
import ObjectID from "../../../../Types/ObjectID";
import { OpenStackMaintenancePartKind } from "../../../../Types/OpenStack/OpenStackMaintenancePart";
import { PerSeriesCriteriaMatch } from "../../../../Types/Probe/ProbeApiIngestResponse";

/*
 * WHAT MAINTENANCE KEEPS QUIET ON A CLOUD, FROM THE EVENT TO THE SERIES.
 *
 * A template groups by region, host and binary, so its series never say which cloud they are of: only the
 * monitor's own step does. This goes through the real read of the events in progress and the real
 * decision, with the database reads stood in for.
 */
const PROJECT_ID: ObjectID = ObjectID.generate();
const CLOUD_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_CLOUD_ID: string = "22222222-2222-4222-8222-222222222222";
const CLOUD_NAME: string = "devstack";
const REGION: string = "openstack.region.name";

function monitorOf(cloudName: string = CLOUD_NAME): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = MonitorType.OpenStack;

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [
      getOpenStackAlertTemplateById(
        "openstack-compute-service-down",
      )!.getMonitorStep({
        cloudIdentifier: cloudName,
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: "Compute Service Down",
      }),
    ],
    defaultMonitorStatusId: ObjectID.generate(),
  };
  monitor.monitorSteps = steps;

  return monitor;
}

function seriesOn(host: string, region: string = "RegionOne"): PerSeriesCriteriaMatch {
  return {
    fingerprint: `${region}/${host}`,
    labels: { [REGION]: region, hostname: host, service: "nova-compute" },
  } as unknown as PerSeriesCriteriaMatch;
}

function eventInProgress(overrides: Partial<ScheduledMaintenance>): void {
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  Object.assign(event, overrides);

  jest
    .spyOn(
      ScheduledMaintenanceStateService,
      "getInProgressScheduledMaintenanceStateIds",
    )
    .mockResolvedValue([ObjectID.generate()]);
  jest.spyOn(ScheduledMaintenanceService, "findBy").mockResolvedValue([event]);
  jest
    .spyOn(OpenStackCloudService, "findBy")
    .mockResolvedValue([cloudOf(CLOUD_ID, CLOUD_NAME)]);
}

function cloudOf(id: string, name: string): OpenStackCloud {
  const cloud: OpenStackCloud = new OpenStackCloud();
  cloud._id = id;
  cloud.name = name;
  return cloud;
}

function cloudOn(event: ScheduledMaintenance, id: string, name: string): void {
  event.openStackClouds = [cloudOf(id, name)];
}

async function suppressedAmong(
  monitor: Monitor,
  series: Array<PerSeriesCriteriaMatch>,
): Promise<Array<string>> {
  const result: MonitorMaintenanceSuppressionResult =
    await MonitorMaintenanceSuppression.getMaintenanceSuppression({
      monitor,
      matchesPerSeries: series,
    });

  return Array.from(result.suppressedSeriesFingerprints).sort();
}

describe("an event on a host of an OpenStack cloud", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const onHost: () => void = (): void => {
    eventInProgress({
      openStackParts: [
        {
          openStackCloudId: CLOUD_ID,
          kind: OpenStackMaintenancePartKind.Hypervisor,
          name: "compute-01.example.internal",
          regionName: "RegionOne",
        },
      ],
    });
  };

  test("keeps that host quiet and every other host paging", async () => {
    onHost();

    expect(
      await suppressedAmong(monitorOf(), [
        seriesOn("compute-01"),
        seriesOn("compute-02"),
      ]),
    ).toEqual(["RegionOne/compute-01"]);
  });

  test("says nothing of another region's host of the same name", async () => {
    onHost();

    expect(
      await suppressedAmong(monitorOf(), [seriesOn("compute-01", "RegionTwo")]),
    ).toEqual([]);
  });

  test("says nothing of another cloud's host of the same name", async () => {
    onHost();

    expect(
      await suppressedAmong(monitorOf("another-cloud"), [
        seriesOn("compute-01"),
      ]),
    ).toEqual([]);
  });

  test("says nothing of a monitor of anything but OpenStack", async () => {
    onHost();
    const monitor: Monitor = monitorOf();
    monitor.monitorType = MonitorType.Metrics;

    expect(await suppressedAmong(monitor, [seriesOn("compute-01")])).toEqual(
      [],
    );
  });

  test("linked to the cloud so it lists there, it is still only that host", async () => {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event.openStackParts = [
      {
        openStackCloudId: CLOUD_ID,
        kind: OpenStackMaintenancePartKind.Hypervisor,
        name: "compute-01",
        regionName: "RegionOne",
      },
    ];
    cloudOn(event, CLOUD_ID, CLOUD_NAME);
    eventInProgress(event);

    expect(
      await suppressedAmong(monitorOf(), [
        seriesOn("compute-01"),
        seriesOn("compute-02"),
      ]),
    ).toEqual(["RegionOne/compute-01"]);
  });

  test("a part of another project's cloud quiets nothing", async () => {
    eventInProgress({
      openStackParts: [
        {
          openStackCloudId: OTHER_CLOUD_ID,
          kind: OpenStackMaintenancePartKind.Hypervisor,
          name: "compute-01",
          regionName: "RegionOne",
        },
      ],
    });
    // The read is by this project, and that cloud isn't in it.
    jest.spyOn(OpenStackCloudService, "findBy").mockResolvedValue([]);

    expect(await suppressedAmong(monitorOf(), [seriesOn("compute-01")])).toEqual(
      [],
    );
  });

  test("a read that fails quiets nothing, and pages", async () => {
    onHost();
    jest
      .spyOn(OpenStackCloudService, "findBy")
      .mockRejectedValue(new Error("the database went away"));

    expect(await suppressedAmong(monitorOf(), [seriesOn("compute-01")])).toEqual(
      [],
    );
  });
});

describe("an event on an availability zone", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("comes to the hosts the inventory has in it now", async () => {
    eventInProgress({
      openStackParts: [
        {
          openStackCloudId: CLOUD_ID,
          kind: OpenStackMaintenancePartKind.AvailabilityZone,
          name: "az-east",
          regionName: "RegionOne",
        },
      ],
    });
    const read: ReturnType<typeof jest.spyOn> = jest
      .spyOn(OpenStackResourceService, "findBy")
      .mockResolvedValue([
        { hypervisorName: "compute-01.example.internal" } as never,
        { hypervisorName: "compute-03.example.internal" } as never,
      ]);

    expect(
      await suppressedAmong(monitorOf(), [
        seriesOn("compute-01"),
        seriesOn("compute-02"),
        seriesOn("compute-03"),
      ]),
    ).toEqual(["RegionOne/compute-01", "RegionOne/compute-03"]);

    const query: Record<string, unknown> = (
      read.mock.calls[0] as Array<{ query: Record<string, unknown> }>
    )[0]!.query;
    expect(query["availabilityZone"]).toBe("az-east");
    expect(query["regionName"]).toBe("RegionOne");
    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
  });

  test("a zone with no hosts in the inventory quiets nothing", async () => {
    eventInProgress({
      openStackParts: [
        {
          openStackCloudId: CLOUD_ID,
          kind: OpenStackMaintenancePartKind.AvailabilityZone,
          name: "az-empty",
          regionName: "RegionOne",
        },
      ],
    });
    jest.spyOn(OpenStackResourceService, "findBy").mockResolvedValue([]);

    expect(await suppressedAmong(monitorOf(), [seriesOn("compute-01")])).toEqual(
      [],
    );
  });
});

describe("an event on a whole cloud", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("quiets a template's series, whose labels never say the cloud", async () => {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    cloudOn(event, CLOUD_ID, CLOUD_NAME);
    eventInProgress(event);

    expect(
      await suppressedAmong(monitorOf(), [
        seriesOn("compute-01"),
        seriesOn("compute-02"),
      ]),
    ).toEqual(["RegionOne/compute-01", "RegionOne/compute-02"]);
  });

  test("and nothing of another cloud", async () => {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    cloudOn(event, OTHER_CLOUD_ID, "another-cloud");
    eventInProgress(event);

    expect(await suppressedAmong(monitorOf(), [seriesOn("compute-01")])).toEqual(
      [],
    );
  });
});

describe("whether planned work on a host moves a monitor's status", () => {
  const BREACH: MonitorCriteriaInstance = {
    data: { createIncidents: true, createAlerts: true },
  } as unknown as MonitorCriteriaInstance;
  const HEALTHY: MonitorCriteriaInstance = {
    data: { createIncidents: false, createAlerts: false },
  } as unknown as MonitorCriteriaInstance;

  test.each<[string, Partial<{ type: MonitorType; perSeries: boolean; criteria: MonitorCriteriaInstance; breaching: Array<string>; suppressed: Array<string> }>, boolean]>([
    ["everything breaching is on the host", {}, true],
    ["another host is breaching too", { breaching: ["a", "b"], suppressed: ["a"] }, false],
    ["nothing is breaching", { breaching: [], suppressed: [] }, false],
    ["a criteria that says all is well", { criteria: HEALTHY }, false],
    ["a monitor that isn't per series", { perSeries: false }, false],
    ["a monitor of anything but OpenStack", { type: MonitorType.Metrics }, false],
  ])("%s", (_name, overrides, expected) => {
    const monitor: Monitor = new Monitor();
    monitor.monitorType = overrides.type || MonitorType.OpenStack;

    expect(
      MonitorMaintenanceSuppression.isEveryBreachUnderMaintenance({
        monitor,
        isPerSeriesEvaluation: overrides.perSeries ?? true,
        criteriaInstance: overrides.criteria || BREACH,
        breachingFingerprints: new Set(overrides.breaching || ["a"]),
        suppressedFingerprints: new Set(overrides.suppressed || ["a"]),
      }),
    ).toBe(expected);
  });
});
