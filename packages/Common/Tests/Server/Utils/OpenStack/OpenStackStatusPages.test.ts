import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorGroup from "../../../../Models/DatabaseModels/MonitorGroup";
import MonitorGroupResource from "../../../../Models/DatabaseModels/MonitorGroupResource";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import OpenStackCloud from "../../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackProjectNotice from "../../../../Models/DatabaseModels/OpenStackProjectNotice";
import OpenStackResource from "../../../../Models/DatabaseModels/OpenStackResource";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageGroup from "../../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import MonitorGroupResourceService from "../../../../Server/Services/MonitorGroupResourceService";
import MonitorGroupService from "../../../../Server/Services/MonitorGroupService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import OpenStackCloudCheckService from "../../../../Server/Services/OpenStackCloudCheckService";
import OpenStackCloudService from "../../../../Server/Services/OpenStackCloudService";
import OpenStackProjectNoticeService from "../../../../Server/Services/OpenStackProjectNoticeService";
import OpenStackResourceService from "../../../../Server/Services/OpenStackResourceService";
import ServiceLevelObjectiveService from "../../../../Server/Services/ServiceLevelObjectiveService";
import StatusPageGroupService from "../../../../Server/Services/StatusPageGroupService";
import StatusPageResourceService from "../../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import OpenStackStatusPages from "../../../../Server/Utils/OpenStack/OpenStackStatusPages";
import { getOpenStackTemplateOfMonitors } from "../../../../Server/Utils/OpenStack/OpenStackMonitorDependencies";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { OpenStackResourceKind } from "../../../../Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackStatusPagePlan,
  getOpenStackStatusPagePlanKey,
} from "../../../../Types/OpenStack/OpenStackStatusPagePlan";
import SliType from "../../../../Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "../../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloWindowType from "../../../../Types/ServiceLevelObjective/SloWindowType";

/*
 * ONE STEP, OF ORDINARY ROWS.
 *
 * What is made is what the plan says and nothing else, through each thing's own service with the permissions
 * of whoever asked. A second go reuses what the first made, and a plan that has moved is refused. The services
 * are stood in for, so this says what they are asked for: OpenStackProjectPagePostgres reads a page back.
 */
const PROJECT_ID: ObjectID = ObjectID.generate();
const CLOUD_ID: ObjectID = ObjectID.generate();
const PROPS: { tenantId: ObjectID; userId: ObjectID } = {
  tenantId: PROJECT_ID,
  userId: ObjectID.generate(),
};

function withId<T extends { _id?: string; id?: ObjectID | null }>(model: T): T {
  const id: ObjectID = ObjectID.generate();
  model._id = id.toString();
  model.id = id;
  return model;
}

function apiRow(name: string, regionName: string | null): OpenStackResource {
  const row: OpenStackResource = new OpenStackResource();
  row.name = name;
  if (regionName) {
    row.regionName = regionName;
  }
  return row;
}

interface Made {
  monitors: Array<Monitor>;
  pages: Array<StatusPage>;
  groups: Array<StatusPageGroup>;
  resources: Array<StatusPageResource>;
  monitorGroups: Array<MonitorGroup>;
  monitorGroupResources: Array<MonitorGroupResource>;
  objectives: Array<ServiceLevelObjective>;
  notices: Array<OpenStackProjectNotice>;
  deletedPages: Array<string>;
  propsSeen: Array<unknown>;
}

function arrange(data: {
  apis?: Array<OpenStackResource>;
  monitors?: Array<Monitor>;
  check?: { isApiCheckEnabled?: boolean; isLifecycleCheckEnabled?: boolean };
  holdings?: Array<OpenStackResource>;
  projectExists?: boolean;
  existingPageNotice?: boolean;
}): Made {
  const made: Made = {
    monitors: data.monitors || [],
    pages: [],
    groups: [],
    resources: [],
    monitorGroups: [],
    monitorGroupResources: [],
    objectives: [],
    notices: [],
    deletedPages: [],
    propsSeen: [],
  };

  const cloud: OpenStackCloud = new OpenStackCloud();
  cloud.name = "devstack";
  jest.spyOn(OpenStackCloudService, "findOneById").mockResolvedValue(cloud);
  jest
    .spyOn(OpenStackCloudCheckService, "findOneBy")
    .mockResolvedValue((data.check || null) as never);

  jest
    .spyOn(OpenStackResourceService, "findBy")
    .mockImplementation((async (read: { query: { kind: string } }) => {
      if (read.query.kind === OpenStackResourceKind.Api) {
        return (
          data.apis || [
            apiRow("compute", "RegionOne"),
            apiRow("identity", "RegionOne"),
            apiRow("image", "RegionOne"),
          ]
        );
      }
      return (data.holdings || []).filter((row: OpenStackResource) => {
        return row.kind === read.query.kind;
      });
    }) as never);
  jest
    .spyOn(OpenStackResourceService, "findOneBy")
    .mockImplementation((async () => {
      if (data.projectExists === false) {
        return null;
      }
      const project: OpenStackResource = new OpenStackResource();
      project.name = "ou-payments";
      return project;
    }) as never);

  jest.spyOn(MonitorService, "findBy").mockImplementation((async () => {
    return made.monitors.filter((monitor: Monitor) => {
      return monitor.monitorType === MonitorType.OpenStack;
    });
  }) as never);
  jest.spyOn(MonitorService, "create").mockImplementation((async (args: {
    data: Monitor;
    props: unknown;
  }) => {
    made.propsSeen.push(args.props);
    const monitor: Monitor = withId(args.data);
    made.monitors.push(monitor);
    return monitor;
  }) as never);

  const online: MonitorStatus = withId(new MonitorStatus());
  online.isOperationalState = true;
  const offline: MonitorStatus = withId(new MonitorStatus());
  offline.isOfflineState = true;
  jest
    .spyOn(MonitorStatusService, "findBy")
    .mockResolvedValue([online, offline]);
  jest
    .spyOn(IncidentSeverityService, "findOneBy")
    .mockResolvedValue(withId(new IncidentSeverity()));
  jest
    .spyOn(AlertSeverityService, "findOneBy")
    .mockResolvedValue(withId(new AlertSeverity()));

  jest.spyOn(StatusPageService, "create").mockImplementation((async (args: {
    data: StatusPage;
    props: unknown;
  }) => {
    made.propsSeen.push(args.props);
    const page: StatusPage = withId(args.data);
    made.pages.push(page);
    return page;
  }) as never);
  jest
    .spyOn(StatusPageService, "deleteOneById")
    .mockImplementation((async (args: { id: ObjectID }) => {
      made.deletedPages.push(args.id.toString());
    }) as never);
  jest
    .spyOn(StatusPageGroupService, "create")
    .mockImplementation((async (args: { data: StatusPageGroup }) => {
      const group: StatusPageGroup = withId(args.data);
      made.groups.push(group);
      return group;
    }) as never);
  jest
    .spyOn(StatusPageResourceService, "create")
    .mockImplementation((async (args: { data: StatusPageResource }) => {
      const resource: StatusPageResource = withId(args.data);
      made.resources.push(resource);
      return resource;
    }) as never);
  jest
    .spyOn(MonitorGroupService, "findOneBy")
    .mockImplementation((async (args: { query: { name: string } }) => {
      return (
        made.monitorGroups.find((group: MonitorGroup) => {
          return group.name === args.query.name;
        }) || null
      );
    }) as never);
  jest.spyOn(MonitorGroupService, "create").mockImplementation((async (args: {
    data: MonitorGroup;
  }) => {
    const group: MonitorGroup = withId(args.data);
    made.monitorGroups.push(group);
    return group;
  }) as never);
  jest
    .spyOn(MonitorGroupResourceService, "create")
    .mockImplementation((async (args: { data: MonitorGroupResource }) => {
      made.monitorGroupResources.push(args.data);
      return args.data;
    }) as never);
  jest
    .spyOn(ServiceLevelObjectiveService, "findOneBy")
    .mockImplementation((async (args: { query: { name: string } }) => {
      return (
        made.objectives.find((objective: ServiceLevelObjective) => {
          return objective.name === args.query.name;
        }) || null
      );
    }) as never);
  jest
    .spyOn(ServiceLevelObjectiveService, "create")
    .mockImplementation((async (args: { data: ServiceLevelObjective }) => {
      made.objectives.push(args.data);
      return args.data;
    }) as never);
  jest
    .spyOn(OpenStackProjectNoticeService, "findOneBy")
    .mockResolvedValue(
      data.existingPageNotice ? new OpenStackProjectNotice() : null,
    );
  jest
    .spyOn(OpenStackProjectNoticeService, "create")
    .mockImplementation((async (args: { data: OpenStackProjectNotice }) => {
      const notice: OpenStackProjectNotice = withId(args.data);
      made.notices.push(notice);
      return notice;
    }) as never);
  jest
    .spyOn(OpenStackProjectNoticeService, "updateOneById")
    .mockImplementation((async (args: {
      data: Partial<OpenStackProjectNotice>;
    }) => {
      Object.assign(made.notices[made.notices.length - 1]!, args.data);
    }) as never);

  return made;
}

async function planKey(): Promise<string> {
  return getOpenStackStatusPagePlanKey(
    await OpenStackStatusPages.readPlan({
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
    }),
  );
}

async function make(
  key?: string,
): Promise<{ statusPageId: string; monitorsMade: number }> {
  return await OpenStackStatusPages.makeStatusPage({
    projectId: PROJECT_ID,
    openStackCloudId: CLOUD_ID,
    planKey: key ?? (await planKey()),
    isPublic: false,
    props: PROPS as never,
  });
}

function stepOf(monitor: Monitor): MonitorStep {
  return monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!;
}

describe("making a cloud's status page", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("makes what the plan said: a private page, a group per region, a row per service", async () => {
    const made: Made = arrange({});

    const result: { statusPageId: string; monitorsMade: number } = await make();

    expect(result.monitorsMade).toBe(4);
    expect(made.pages).toHaveLength(1);
    expect(made.pages[0]!.name).toBe("devstack status");
    expect(made.pages[0]!.isPublicStatusPage).toBe(false);
    expect(
      made.groups.map((group: StatusPageGroup) => {
        return group.name;
      }),
    ).toEqual(["RegionOne"]);
    expect(
      made.resources.map((resource: StatusPageResource) => {
        return resource.displayName;
      }),
    ).toEqual(["Compute", "Images", "Identity"]);
    expect(result.statusPageId).toBe(made.pages[0]!.id!.toString());
  });

  test("everything is made with the permissions of whoever asked", async () => {
    const made: Made = arrange({});

    await make();

    expect(made.propsSeen.length).toBeGreaterThan(0);
    for (const props of made.propsSeen) {
      expect(props).toBe(PROPS);
    }
  });

  test("a row with one monitor is that monitor, and one with several is a group reading its worst", async () => {
    const made: Made = arrange({});

    await make();

    const compute: StatusPageResource = made.resources.find(
      (resource: StatusPageResource) => {
        return resource.displayName === "Compute";
      },
    )!;
    const images: StatusPageResource = made.resources.find(
      (resource: StatusPageResource) => {
        return resource.displayName === "Images";
      },
    )!;

    expect(compute.monitorGroupId).toBeDefined();
    expect(compute.monitorId).toBeUndefined();
    expect(made.monitorGroups[0]!.name).toBe("devstack - Compute (RegionOne)");
    expect(made.monitorGroupResources).toHaveLength(2);
    expect(images.monitorId).toBeDefined();
    expect(images.monitorGroupId).toBeUndefined();
  });

  test("each monitor reads its own region, under the name the plan gave it", async () => {
    const made: Made = arrange({});

    await make();

    for (const monitor of made.monitors) {
      expect(monitor.monitorType).toBe(MonitorType.OpenStack);
      expect(monitor.name).toContain("(RegionOne)");
      expect(stepOf(monitor).data!.openstackMonitor!.resourceFilters).toEqual({
        regionName: "RegionOne",
      });
      expect(stepOf(monitor).data!.openstackMonitor!.cloudIdentifier).toBe(
        "devstack",
      );
    }
  });

  test("what it made is what it reuses next time: a second page makes no monitor, and no second group", async () => {
    const made: Made = arrange({});

    await make();
    expect(made.monitors).toHaveLength(4);

    const plan: OpenStackStatusPagePlan = await OpenStackStatusPages.readPlan({
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
    });
    expect(plan.monitorsToMake).toBe(0);
    expect(plan.monitorsReused).toBe(4);

    const second: { monitorsMade: number } = await make();

    expect(second.monitorsMade).toBe(0);
    expect(made.monitors).toHaveLength(4);
    expect(made.monitorGroups).toHaveLength(1);
    expect(made.pages).toHaveLength(2);
  });

  test("a monitor Recommendations knows as covering a template still does, with its region on it", async () => {
    const made: Made = arrange({});

    await make();

    for (const monitor of made.monitors) {
      expect(
        Array.from(
          getOpenStackTemplateOfMonitors({
            cloud: "devstack",
            monitors: [monitor],
          }).keys(),
        ),
      ).toHaveLength(1);
    }
  });

  test("a plan that has moved since it was read is refused, and makes nothing", async () => {
    const made: Made = arrange({});
    const key: string = await planKey();

    jest
      .spyOn(OpenStackResourceService, "findBy")
      .mockResolvedValue([apiRow("compute", "RegionOne")] as never);

    await expect(make(key)).rejects.toThrow("changed since you looked");
    expect(made.pages).toEqual([]);
    expect(made.monitors).toEqual([]);
  });

  test("no key at all is refused", async () => {
    const made: Made = arrange({});

    await expect(
      OpenStackStatusPages.makeStatusPage({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        planKey: undefined,
        isPublic: true,
        props: PROPS as never,
      }),
    ).rejects.toThrow("changed since you looked");
    expect(made.pages).toEqual([]);
  });

  test("a cloud with nothing to show makes nothing", async () => {
    const made: Made = arrange({ apis: [] });

    await expect(make()).rejects.toThrow("nothing to put on a page");
    expect(made.pages).toEqual([]);
  });

  test("a failure part way takes the page back, and leaves the monitors to be reused", async () => {
    const made: Made = arrange({});
    jest
      .spyOn(StatusPageResourceService, "create")
      .mockRejectedValue(new Error("no"));

    await expect(make()).rejects.toThrow("no");

    expect(made.deletedPages).toEqual([made.pages[0]!.id!.toString()]);
    expect(made.monitors.length).toBeGreaterThan(0);
  });

  test("beside a whole-cloud monitor on a cloud of two regions, the regional ones open nothing, so one failure stays one incident", async () => {
    const made: Made = arrange({
      apis: [apiRow("identity", "RegionOne"), apiRow("identity", "RegionTwo")],
    });

    // One whole-cloud monitor first, as Recommendations makes one.
    await OpenStackStatusPages.makeStatusPage({
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
      planKey: await planKey(),
      isPublic: false,
      props: PROPS as never,
    });

    const regional: Array<Monitor> = [...made.monitors];
    made.monitors.length = 0;

    const wholeCloud: Monitor = regional[0]!;
    stepOf(wholeCloud).data!.openstackMonitor!.resourceFilters = {};
    made.monitors.push(wholeCloud);

    await make();

    const added: Array<Monitor> = made.monitors.filter((monitor: Monitor) => {
      return monitor !== wholeCloud;
    });
    expect(added).toHaveLength(2);

    for (const monitor of added) {
      for (const instance of stepOf(monitor).data!.monitorCriteria!.data!
        .monitorCriteriaInstanceArray) {
        expect(instance.data!.createIncidents).toBe(false);
        expect(instance.data!.createAlerts).toBe(false);
      }
    }
  });
});

describe("making objectives by region and service", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("one per row, of the uptime of its monitors, and a check's only once that check is on", async () => {
    const made: Made = arrange({
      check: { isLifecycleCheckEnabled: true },
    });

    const result: { objectivesMade: number } =
      await OpenStackStatusPages.makeObjectives({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        planKey: await planKey(),
        props: PROPS as never,
      });

    expect(result.objectivesMade).toBe(3);
    const compute: ServiceLevelObjective = made.objectives.find(
      (objective: ServiceLevelObjective) => {
        return objective.name === "devstack - Compute (RegionOne)";
      },
    )!;

    expect(compute.sliType).toBe(SliType.MonitorUptime);
    expect(compute.multiMonitorMode).toBe(SloMultiMonitorMode.AnyDown);
    expect(compute.windowType).toBe(SloWindowType.Rolling);
    expect(compute.windowDays).toBe(30);
    expect(compute.targetPercentage).toBe(99.9);
    // The API, the workers and the boot check.
    expect(compute.monitors).toHaveLength(3);
    expect(
      made.monitors.some((monitor: Monitor) => {
        return (monitor.name || "").includes("Instance Boot Failing");
      }),
    ).toBe(true);
  });

  test("with no check on, it reads only the service's own monitors", async () => {
    const made: Made = arrange({});

    await OpenStackStatusPages.makeObjectives({
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
      planKey: await planKey(),
      props: PROPS as never,
    });

    expect(
      made.monitors.some((monitor: Monitor) => {
        return (monitor.name || "").includes("Instance Boot Failing");
      }),
    ).toBe(false);
  });

  test("making them again leaves them as they are", async () => {
    const made: Made = arrange({});

    await OpenStackStatusPages.makeObjectives({
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
      planKey: await planKey(),
      props: PROPS as never,
    });
    const again: { objectivesMade: number; objectivesLeft: number } =
      await OpenStackStatusPages.makeObjectives({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        planKey: await planKey(),
        props: PROPS as never,
      });

    expect(again.objectivesMade).toBe(0);
    expect(again.objectivesLeft).toBe(3);
    expect(made.objectives).toHaveLength(3);
  });
});

describe("making a project's own page", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function holding(
    kind: OpenStackResourceKind,
    regionName: string,
  ): OpenStackResource {
    const row: OpenStackResource = new OpenStackResource();
    row.kind = kind;
    row.regionName = regionName;
    return row;
  }

  async function makePage(): Promise<{ statusPageId: string }> {
    return await OpenStackStatusPages.makeProjectPage({
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
      openStackProjectId: "aaaa",
      props: PROPS as never,
    });
  }

  test("private from its first moment, and only ever shows what is limited to it", async () => {
    const made: Made = arrange({
      holdings: [holding(OpenStackResourceKind.Instance, "RegionOne")],
    });

    await makePage();

    expect(made.pages[0]!.isPublicStatusPage).toBe(false);
    expect(made.pages[0]!.onlyShowScopedIncidents).toBe(true);
    expect(made.pages[0]!.name).toBe("ou-payments status");
  });

  test("its rows are manual monitors of its own, which nothing else is on", async () => {
    const made: Made = arrange({
      holdings: [
        holding(OpenStackResourceKind.Instance, "RegionOne"),
        holding(OpenStackResourceKind.Volume, "RegionTwo"),
      ],
    });

    await makePage();

    expect(
      made.monitors.map((monitor: Monitor) => {
        return [monitor.name, monitor.monitorType];
      }),
    ).toEqual([
      ["ou-payments - Compute (RegionOne)", MonitorType.Manual],
      ["ou-payments - Block Storage (RegionTwo)", MonitorType.Manual],
    ]);
    expect(
      made.groups.map((group: StatusPageGroup) => {
        return group.name;
      }),
    ).toEqual(["RegionOne", "RegionTwo"]);
    expect(
      made.resources.map((resource: StatusPageResource) => {
        return resource.displayName;
      }),
    ).toEqual(["Compute", "Block Storage"]);
    // A status page row with no monitor group: nobody else's monitors come along.
    expect(made.monitorGroups).toEqual([]);
  });

  test("it is on from its first moment, because whoever made it saw who it tells: nobody, until they add someone", async () => {
    const made: Made = arrange({
      holdings: [holding(OpenStackResourceKind.Instance, "RegionOne")],
    });

    await makePage();

    const notice: OpenStackProjectNotice = made.notices[0]!;
    expect(notice.openStackProjectId).toBe("aaaa");
    expect(notice.statusPageId?.toString()).toBe(made.pages[0]!.id!.toString());
    expect(notice.isEnabled).toBe(true);
    expect(notice.previewSeenAt).toBeDefined();
    expect(notice.previewedRecipient).toBe(
      `statusPage:${made.pages[0]!.id!.toString()}`,
    );
    expect(notice.statusPageRows).toEqual([
      {
        regionName: "RegionOne",
        service: "Compute",
        monitorId: made.monitors[0]!.id!.toString(),
      },
    ]);
  });

  test("a project OneUptime doesn't see gets no page", async () => {
    const made: Made = arrange({ projectExists: false });

    await expect(makePage()).rejects.toThrow("does not see this project");
    expect(made.pages).toEqual([]);
  });

  test("a project gets one page", async () => {
    const made: Made = arrange({
      holdings: [holding(OpenStackResourceKind.Instance, "RegionOne")],
      existingPageNotice: true,
    });

    await expect(makePage()).rejects.toThrow("already has its own page");
    expect(made.pages).toEqual([]);
  });

  test("a failure part way takes the page back", async () => {
    const made: Made = arrange({
      holdings: [holding(OpenStackResourceKind.Instance, "RegionOne")],
    });
    jest
      .spyOn(OpenStackProjectNoticeService, "create")
      .mockRejectedValue(new Error("no"));

    await expect(makePage()).rejects.toThrow("no");
    expect(made.deletedPages).toEqual([made.pages[0]!.id!.toString()]);
  });
});
