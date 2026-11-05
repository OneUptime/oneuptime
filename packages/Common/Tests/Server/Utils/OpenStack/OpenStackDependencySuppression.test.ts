import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import OpenStackDependencySuppression, {
  OPENSTACK_DEPENDENCY_SETTLE_MINUTES,
  isOpenStackCloudMonitor,
} from "../../../../Server/Utils/OpenStack/OpenStackDependencySuppression";
import { JSONObject } from "../../../../Types/JSON";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import { getAllOpenStackLogAlertTemplates } from "../../../../Types/Monitor/OpenStackLogAlertTemplates";
import ObjectID from "../../../../Types/ObjectID";
import MonitorDependencyRule, {
  DependencySuppressionResult,
} from "../../../../Utils/Monitor/MonitorDependencyRule";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What a cloud's parent monitor really speaks for: its own region, and for a few minutes after
 * it comes back. What the rest of the product does with a parent is unchanged, and any other
 * monitor costs no query.
 */

const REGION: string = "openstack.region.name";
const PARENT_ID: string = "11111111-1111-4111-8111-111111111111";

const SUPPRESSED: DependencySuppressionResult = {
  isSuppressed: true,
  suppressingParents: [
    { monitorId: PARENT_ID, monitorName: "RabbitMQ Down", statusName: "Offline" },
  ],
};

const NOT_SUPPRESSED: DependencySuppressionResult = {
  isSuppressed: false,
  suppressingParents: [],
};

function childMonitor(monitorType: MonitorType = MonitorType.OpenStack): Monitor {
  const parent: Monitor = new Monitor();
  parent.id = new ObjectID(PARENT_ID);

  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.projectId = ObjectID.generate();
  monitor.monitorType = monitorType;
  monitor.dependsOnMonitors = [parent];

  return monitor;
}

function incidentAbout(labels: JSONObject | undefined): Incident {
  const incident: Incident = new Incident();
  if (labels) {
    incident.seriesLabels = labels;
  }
  return incident;
}

describe("for a parent that is down now", () => {
  let incidents: jest.SpiedFunction<never>;

  beforeEach(() => {
    incidents = jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([] as never) as unknown as jest.SpiedFunction<never>;
    jest
      .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
      .mockResolvedValue([ObjectID.generate()] as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a RabbitMQ gone in one region holds back that region's workers and no other's", async () => {
    incidents.mockResolvedValue([
      incidentAbout({ [REGION]: "RegionOne" }),
    ] as never);

    const suppression: DependencySuppressionResult =
      await OpenStackDependencySuppression.forEvaluation({
        monitor: childMonitor(),
        suppression: SUPPRESSED,
      });

    expect(suppression.isSuppressed).toBe(true);
    expect(suppression.suppressingParents).toEqual(
      SUPPRESSED.suppressingParents,
    );
    expect(MonitorDependencyRule.isWholeMonitorSuppressed(suppression)).toBe(
      false,
    );
    expect(
      MonitorDependencyRule.isSeriesSuppressed({
        suppression,
        labels: { [REGION]: "RegionOne", hostname: "compute-1" },
      }),
    ).toBe(true);
    expect(
      MonitorDependencyRule.isSeriesSuppressed({
        suppression,
        labels: { [REGION]: "RegionTwo", hostname: "compute-1" },
      }),
    ).toBe(false);
  });

  test("a series with no region is the whole cloud's, and waits", async () => {
    incidents.mockResolvedValue([
      incidentAbout({ [REGION]: "RegionOne" }),
    ] as never);

    const suppression: DependencySuppressionResult =
      await OpenStackDependencySuppression.forEvaluation({
        monitor: childMonitor(),
        suppression: SUPPRESSED,
      });

    expect(
      MonitorDependencyRule.isSeriesSuppressed({
        suppression,
        labels: { hostname: "compute-1" },
      }),
    ).toBe(true);
    // A check not split into series has nothing to narrow by.
    expect(
      MonitorDependencyRule.isSeriesSuppressed({
        suppression,
        labels: undefined,
      }),
    ).toBe(true);
  });

  test("two regions down hold back both", async () => {
    incidents.mockResolvedValue([
      incidentAbout({ [REGION]: "RegionOne" }),
      incidentAbout({ [REGION]: "RegionTwo" }),
    ] as never);

    const suppression: DependencySuppressionResult =
      await OpenStackDependencySuppression.forEvaluation({
        monitor: childMonitor(),
        suppression: SUPPRESSED,
      });

    for (const region of ["RegionOne", "RegionTwo"]) {
      expect(
        MonitorDependencyRule.isSeriesSuppressed({
          suppression,
          labels: { [REGION]: region },
        }),
      ).toBe(true);
    }
  });

  test("with no open incident to say where, it speaks for the whole monitor, as a parent does", async () => {
    const suppression: DependencySuppressionResult =
      await OpenStackDependencySuppression.forEvaluation({
        monitor: childMonitor(),
        suppression: SUPPRESSED,
      });

    expect(suppression).toBe(SUPPRESSED);
    expect(MonitorDependencyRule.isWholeMonitorSuppressed(suppression)).toBe(
      true,
    );
  });

  test("an incident about no region in particular speaks for all of them", async () => {
    incidents.mockResolvedValue([
      incidentAbout({ [REGION]: "RegionOne" }),
      incidentAbout(undefined),
    ] as never);

    expect(
      await OpenStackDependencySuppression.forEvaluation({
        monitor: childMonitor(),
        suppression: SUPPRESSED,
      }),
    ).toBe(SUPPRESSED);
  });

  test("a failed read leaves the product's own answer", async () => {
    incidents.mockRejectedValue(new Error("no database") as never);

    expect(
      await OpenStackDependencySuppression.forEvaluation({
        monitor: childMonitor(),
        suppression: SUPPRESSED,
      }),
    ).toBe(SUPPRESSED);
  });
});

describe("for a parent that has just come back", () => {
  let timelines: jest.SpiedFunction<never>;

  function timelineOf(data: {
    isOfflineState: boolean;
    name?: string;
  }): MonitorStatusTimeline {
    const status: MonitorStatus = new MonitorStatus();
    status.name = data.name || "Offline";
    status.isOfflineState = data.isOfflineState;

    const parent: Monitor = new Monitor();
    parent.name = "RabbitMQ Down";

    const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
    timeline.monitorId = new ObjectID(PARENT_ID);
    timeline.monitorStatus = status;
    timeline.monitor = parent;
    return timeline;
  }

  beforeEach(() => {
    timelines = jest
      .spyOn(MonitorStatusTimelineService, "findBy")
      .mockResolvedValue([] as never) as unknown as jest.SpiedFunction<never>;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("it goes on holding back the monitor for as long as a worker's series takes to catch up", async () => {
    timelines.mockResolvedValue([timelineOf({ isOfflineState: true })] as never);

    const suppression: DependencySuppressionResult =
      await OpenStackDependencySuppression.forEvaluation({
        monitor: childMonitor(),
        suppression: NOT_SUPPRESSED,
      });

    expect(suppression.isSuppressed).toBe(true);
    expect(suppression.suppressingParents).toEqual([
      {
        monitorId: PARENT_ID,
        monitorName: "RabbitMQ Down",
        statusName: "Offline until moments ago",
      },
    ]);
    expect(MonitorDependencyRule.isWholeMonitorSuppressed(suppression)).toBe(
      true,
    );
  });

  test("it asks only for what ended since the settling time began", async () => {
    await OpenStackDependencySuppression.forEvaluation({
      monitor: childMonitor(),
      suppression: NOT_SUPPRESSED,
    });

    const query: { endsAt: { value: Date }; monitorId: unknown } = (
      timelines.mock.calls as unknown as Array<
        [{ query: { endsAt: { value: Date }; monitorId: unknown } }]
      >
    )[0]![0].query;
    const minutesAgo: number =
      (Date.now() - new Date(query.endsAt.value).getTime()) / 60000;

    expect(minutesAgo).toBeGreaterThan(OPENSTACK_DEPENDENCY_SETTLE_MINUTES - 1);
    expect(minutesAgo).toBeLessThan(OPENSTACK_DEPENDENCY_SETTLE_MINUTES + 1);
  });

  test("a status that was not an outage holds nothing back", async () => {
    timelines.mockResolvedValue([
      timelineOf({ isOfflineState: false, name: "Degraded" }),
    ] as never);

    expect(
      await OpenStackDependencySuppression.forEvaluation({
        monitor: childMonitor(),
        suppression: NOT_SUPPRESSED,
      }),
    ).toBe(NOT_SUPPRESSED);
  });

  test("nothing ended lately, so nothing is held back", async () => {
    expect(
      await OpenStackDependencySuppression.forEvaluation({
        monitor: childMonitor(),
        suppression: NOT_SUPPRESSED,
      }),
    ).toBe(NOT_SUPPRESSED);
  });

  test("a failed read leaves the product's own answer", async () => {
    timelines.mockRejectedValue(new Error("no database") as never);

    expect(
      await OpenStackDependencySuppression.forEvaluation({
        monitor: childMonitor(),
        suppression: NOT_SUPPRESSED,
      }),
    ).toBe(NOT_SUPPRESSED);
  });
});

describe("any other monitor", () => {
  let incidents: jest.SpiedFunction<never>;
  let timelines: jest.SpiedFunction<never>;

  beforeEach(() => {
    incidents = jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([] as never) as unknown as jest.SpiedFunction<never>;
    timelines = jest
      .spyOn(MonitorStatusTimelineService, "findBy")
      .mockResolvedValue([] as never) as unknown as jest.SpiedFunction<never>;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("costs no query, and its answer is the product's", async () => {
    for (const suppression of [SUPPRESSED, NOT_SUPPRESSED]) {
      expect(
        await OpenStackDependencySuppression.forEvaluation({
          monitor: childMonitor(MonitorType.Website),
          suppression,
        }),
      ).toBe(suppression);
    }

    expect(incidents).not.toHaveBeenCalled();
    expect(timelines).not.toHaveBeenCalled();
  });

  test("a monitor on a cloud with nothing to wait for costs none either", async () => {
    const monitor: Monitor = childMonitor();
    monitor.dependsOnMonitors = [];

    expect(
      await OpenStackDependencySuppression.forEvaluation({
        monitor,
        suppression: NOT_SUPPRESSED,
      }),
    ).toBe(NOT_SUPPRESSED);
    expect(timelines).not.toHaveBeenCalled();
  });

  test("a Logs monitor counts only when it reads a cloud's logs", () => {
    const step: MonitorStep = getAllOpenStackLogAlertTemplates()[0]!.getMonitorStep(
      {
        cloudIdentifier: "production",
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: "production",
      },
    );
    const monitorSteps: MonitorSteps = new MonitorSteps();
    monitorSteps.data = {
      monitorStepsInstanceArray: [step],
      defaultMonitorStatusId: ObjectID.generate(),
    };

    const onCloud: Monitor = childMonitor(MonitorType.Logs);
    onCloud.monitorSteps = monitorSteps;

    expect(isOpenStackCloudMonitor(onCloud)).toBe(true);
    expect(isOpenStackCloudMonitor(childMonitor(MonitorType.Logs))).toBe(false);
  });
});
