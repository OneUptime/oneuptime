import { afterEach, describe, expect, jest, test } from "@jest/globals";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageGroup from "../../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "../../../../Models/DatabaseModels/StatusPageSubscriber";
import ToolImportRecord from "../../../../Models/DatabaseModels/ToolImportRecord";
import ToolImportApplier from "../../../../Server/Utils/ToolImport/ToolImportApplier";
import {
  buildToolImportPlan,
  ToolImportAccess,
  ToolImportProjectState,
} from "../../../../Server/Utils/ToolImport/ToolImportPlanner";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { getToolImportMonitorMatchKey } from "../../../../Types/ToolImport/ToolImportMonitorBuilder";
import {
  makeToolImportNote,
  ToolImportNoteCode,
} from "../../../../Types/ToolImport/ToolImportNote";
import {
  ToolImportOutcome,
  ToolImportPlan,
  ToolImportPlanItem,
  ToolImportReport,
  ToolImportReportItem,
} from "../../../../Types/ToolImport/ToolImportPlan";
import ToolImportResourceKind, {
  getToolImportItemKey,
} from "../../../../Types/ToolImport/ToolImportResourceKind";
import {
  ImportedMonitor,
  ImportedStatusPage,
  ImportedStatusPageSubscriber,
  ToolImportSnapshot,
} from "../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../Types/ToolImport/ToolImportSource";
import {
  ApplierWorld,
  RecordedCreate,
  RecordedUpdate,
  toUuid,
} from "./ToolImportApplierWorld";
import {
  fullAccess,
  projectState,
  snapshot,
} from "./ToolImportSnapshotFixtures";

/*
 * An uptime and status page import, with OneUptime's services stood in for
 * (ApplierWorld.withMonitoring): the monitors it makes - their type,
 * steps, pace, paused or not - the status page with its groups and the
 * monitors it shows, and subscribers, who come over only with the person's
 * word, confirmed, sent nothing, following what they followed. All made
 * with the person's props, and nothing announced by email.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const RUN_ID: ObjectID = ObjectID.generate();

const PERSON_PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: ObjectID.generate(),
};

function monitor(
  sourceId: string,
  overrides: Partial<ImportedMonitor> = {},
): ImportedMonitor {
  return {
    sourceId: sourceId,
    name: `Site ${sourceId}`,
    sourceType: "http",
    monitorType: MonitorType.Website,
    destination: `https://${sourceId}.example.com`,
    intervalSeconds: 300,
    isPaused: false,
    notes: [],
    ...overrides,
  };
}

const PAGE: ImportedStatusPage = {
  sourceId: "page",
  name: "Acme status",
  description: "For the team",
  pageTitle: "Acme",
  pageDescription: "How Acme is doing",
  isPublic: true,
  historyDays: 365,
  allowsEmailSubscribers: true,
  allowsSubscribersToChooseResources: true,
  isHiddenFromSearchEngines: true,
  groups: [
    { key: "web", name: "Website", description: "What visitors see" },
    { key: "back", name: "Back office" },
  ],
  resources: [
    {
      key: "r-home",
      monitorSourceId: "home",
      groupKey: "web",
      displayName: "Home page",
      displayDescription: "The front page",
      showUptimePercent: true,
      showStatusHistoryChart: false,
    },
    {
      key: "r-desk",
      monitorSourceId: "desk",
      displayName: "Support desk",
      showUptimePercent: false,
      showStatusHistoryChart: true,
    },
    {
      key: "r-udp",
      monitorSourceId: "udp",
      groupKey: "back",
      displayName: "Syslog",
      showUptimePercent: true,
      showStatusHistoryChart: true,
    },
    {
      key: "r-orders",
      monitorSourceId: "orders",
      groupKey: "back",
      displayName: "Orders",
      showUptimePercent: true,
      showStatusHistoryChart: true,
    },
  ],
  notes: [],
};

function subscriber(
  sourceId: string,
  resourceKeys: Array<string> = [],
): ImportedStatusPageSubscriber {
  return {
    sourceId: sourceId,
    email: `${sourceId}@example.com`,
    statusPageSourceId: "page",
    resourceKeys: resourceKeys,
    notes: [],
  };
}

function account(
  overrides: Partial<ToolImportSnapshot> = {},
): ToolImportSnapshot {
  return snapshot({
    source: ToolImportSource.UptimeRobot,
    monitors: [
      monitor("home", { destination: "https://example.com" }),
      monitor("orders", {
        monitorType: MonitorType.API,
        destination: "https://api.example.com/orders",
        isPaused: true,
        intervalSeconds: 60,
      }),
      monitor("backup", {
        sourceType: "heartbeat",
        monitorType: MonitorType.IncomingRequest,
        destination: undefined,
        intervalSeconds: 86400,
        heartbeatTimeoutSeconds: 90000,
      }),
      monitor("desk", {
        name: "Support desk",
        description: "Set by hand",
        sourceType: "component",
        monitorType: MonitorType.Manual,
        destination: undefined,
        intervalSeconds: undefined,
      }),
      monitor("udp", {
        name: "Syslog",
        sourceType: "UDP",
        monitorType: null,
        destination: "logs.example.com",
      }),
    ],
    statusPages: [PAGE],
    statusPageSubscribers: [
      subscriber("ann"),
      subscriber("bob", ["r-home", "r-orders"]),
      // Follows a part that does not come over: the whole page instead.
      subscriber("carol", ["r-home", "r-udp"]),
    ],
    ...overrides,
  });
}

interface Run {
  report: ToolImportReport;
  plan: ToolImportPlan;
}

async function runImport(data: {
  snapshot?: ToolImportSnapshot;
  state?: ToolImportProjectState;
  access?: ToolImportAccess;
  // Every selectable item by default, paused monitors and subscribers too.
  selectedKeys?: (plan: ToolImportPlan) => Array<string>;
  subscribersConsent?: boolean;
  canLetSubscribersChooseResources?: boolean;
  canCreateStatusPageGroups?: boolean;
}): Promise<Run> {
  const read: ToolImportSnapshot = data.snapshot || account();
  const plan: ToolImportPlan = buildToolImportPlan({
    snapshot: read,
    state: data.state || projectState(),
    access: data.access || fullAccess(),
  });

  const selected: Array<string> = data.selectedKeys
    ? data.selectedKeys(plan)
    : plan.items
        .filter((item: ToolImportPlanItem) => {
          return item.isSelectable;
        })
        .map((item: ToolImportPlanItem) => {
          return item.key;
        });

  const report: ToolImportReport = await ToolImportApplier.apply({
    runId: RUN_ID,
    projectId: PROJECT_ID,
    source: ToolImportSource.UptimeRobot,
    snapshot: read,
    plan: plan,
    selection: {
      selectedKeys: selected,
      inviteTeamId: null,
      subscribersConsent: data.subscribersConsent ?? true,
    },
    props: PERSON_PROPS,
    isLimitedToOneLevelPerPolicy: false,
    canLetSubscribersChooseResources: data.canLetSubscribersChooseResources,
    canCreateStatusPageGroups: data.canCreateStatusPageGroups,
    now: new Date("2026-10-08T12:00:00Z"),
  });

  return { report, plan };
}

function outcomeOf(
  report: ToolImportReport,
  kind: ToolImportResourceKind,
  sourceId: string,
): ToolImportReportItem {
  const key: string = getToolImportItemKey(kind, sourceId);
  const found: ToolImportReportItem | undefined = report.items.find(
    (item: ToolImportReportItem) => {
      return item.key === key;
    },
  );

  if (!found) {
    throw new Error(`No report item ${key}`);
  }

  return found;
}

function monitorNamed(world: ApplierWorld, name: string): Monitor {
  const found: Monitor | undefined = world
    .dataOf<Monitor>("Monitor")
    .find((candidate: Monitor) => {
      return candidate.name === name;
    });

  if (!found) {
    throw new Error(`No monitor ${name} was created.`);
  }

  return found;
}

function stepOf(created: Monitor): MonitorStep {
  return created.monitorSteps!.data!.monitorStepsInstanceArray[0]!;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ToolImportApplier: monitors", () => {
  test("each monitor is made as the person, with its steps and pace; a check OneUptime has no monitor for is not attempted", async () => {
    const world: ApplierWorld = new ApplierWorld().withMonitoring();
    const { report } = await runImport({});

    expect(
      world.dataOf<Monitor>("Monitor").map((created: Monitor) => {
        return [created.name, created.monitorType, created.monitoringInterval];
      }),
    ).toEqual([
      ["Site home", MonitorType.Website, "*/5 * * * *"],
      ["Site orders", MonitorType.API, "* * * * *"],
      ["Site backup", MonitorType.IncomingRequest, undefined],
      ["Support desk", MonitorType.Manual, undefined],
    ]);

    for (const create of world.createsOf("Monitor")) {
      expect(create.props).toBe(PERSON_PROPS);
      expect((create.data as Monitor).projectId?.toString()).toBe(
        PROJECT_ID.toString(),
      );
    }

    const home: Monitor = monitorNamed(world, "Site home");
    expect(stepOf(home).data!.monitorDestination?.toString()).toBe(
      "https://example.com/",
    );
    expect(monitorNamed(world, "Support desk").monitorSteps).toBeUndefined();
    expect(monitorNamed(world, "Support desk").description).toBe("Set by hand");

    expect(
      outcomeOf(report, ToolImportResourceKind.Monitor, "home"),
    ).toMatchObject({
      outcome: ToolImportOutcome.Created,
      recordIds: [home.id!.toString()],
    });
    expect(
      outcomeOf(report, ToolImportResourceKind.Monitor, "udp"),
    ).toMatchObject({
      outcome: ToolImportOutcome.Skipped,
      reason: makeToolImportNote(ToolImportNoteCode.MonitorTypeNotSupported, {
        type: "UDP",
      }),
    });
  });

  test("a monitor paused in the tool comes over paused; the rest are on", async () => {
    const world: ApplierWorld = new ApplierWorld().withMonitoring();
    await runImport({});

    expect(monitorNamed(world, "Site orders").disableActiveMonitoring).toBe(
      true,
    );
    expect(
      monitorNamed(world, "Site home").disableActiveMonitoring,
    ).toBeUndefined();
  });

  test("no probes are named: a monitor gets the project's default probes, as the Create Monitor form gives", async () => {
    const world: ApplierWorld = new ApplierWorld().withMonitoring();
    await runImport({});

    const home: Monitor = monitorNamed(world, "Site home");
    expect(
      (home as unknown as Record<string, unknown>)["monitorProbes"],
    ).toBeUndefined();
  });

  test("criteria use the project's own statuses and severities, read once for every monitor", async () => {
    const world: ApplierWorld = new ApplierWorld().withMonitoring();
    await runImport({});

    expect(world.reads).toEqual([
      "MonitorStatus",
      "IncidentSeverity",
      "AlertSeverity",
    ]);

    const json: string = JSON.stringify(
      monitorNamed(world, "Site home").monitorSteps!.toJSON(),
    );
    expect(json).toContain(toUuid("status-operational"));
    expect(json).toContain(toUuid("status-offline"));
    expect(json).toContain(toUuid("incident-critical"));
    expect(json).toContain(toUuid("alert-critical"));
  });

  test("what the import makes is marked announced: owners get the report, not an email per monitor or page", async () => {
    const world: ApplierWorld = new ApplierWorld().withMonitoring();
    await runImport({});

    const monitorIds: Array<string> = world
      .dataOf<Monitor>("Monitor")
      .map((created: Monitor) => {
        return created.id!.toString();
      });
    const pageId: string = world
      .dataOf<StatusPage>("StatusPage")[0]!
      .id!.toString();

    const announced: Array<RecordedUpdate> = world.updates.filter(
      (update: RecordedUpdate) => {
        return update.service === "Monitor" || update.service === "StatusPage";
      },
    );

    expect(
      announced.map((update: RecordedUpdate) => {
        return [update.service, update.id, update.data];
      }),
    ).toEqual([
      ...monitorIds.map((id: string) => {
        return ["Monitor", id, { isOwnerNotifiedOfResourceCreation: true }];
      }),
      ["StatusPage", pageId, { isOwnerNotifiedOfResourceCreation: true }],
    ]);

    const owners: Array<RecordedUpdate> = world.updates.filter(
      (update: RecordedUpdate) => {
        return update.service.endsWith("OwnerUser");
      },
    );

    expect(owners).toHaveLength(monitorIds.length + 1);

    for (const owner of owners) {
      expect(owner.data).toEqual({ isOwnerNotified: true });
      // Marking is OneUptime's own bookkeeping, not the person's change.
      expect(owner.props.isRoot).toBe(true);
    }
  });

  test("a project without an offline status says so on each monitor, and the import carries on", async () => {
    const world: ApplierWorld = new ApplierWorld().withMonitoring();
    world.statuses = world.statuses.filter(
      (status: { isOfflineState?: boolean }) => {
        return !status.isOfflineState;
      },
    );

    const { report } = await runImport({
      snapshot: account({ statusPageSubscribers: [] }),
    });

    expect(
      outcomeOf(report, ToolImportResourceKind.Monitor, "home"),
    ).toMatchObject({
      outcome: ToolImportOutcome.Failed,
      error:
        "The project needs an operational and an offline monitor status, an incident severity and an alert severity before monitors can be made.",
    });
    expect(world.createsOf("Monitor")).toHaveLength(0);
    // The page still comes, without the monitors it could not show.
    expect(
      outcomeOf(report, ToolImportResourceKind.StatusPage, "page").outcome,
    ).toBe(ToolImportOutcome.Created);
  });

  test("a monitor OneUptime refuses fails alone, with OneUptime's answer", async () => {
    const world: ApplierWorld = new ApplierWorld()
      .withMonitoring()
      .refuse("Monitor", (data: unknown) => {
        return (data as Monitor).name === "Site home"
          ? new BadDataException("Monitor limit reached.")
          : null;
      });

    const { report } = await runImport({});

    expect(
      outcomeOf(report, ToolImportResourceKind.Monitor, "home"),
    ).toMatchObject({
      outcome: ToolImportOutcome.Failed,
      error: "Monitor limit reached.",
    });
    expect(
      outcomeOf(report, ToolImportResourceKind.Monitor, "orders").outcome,
    ).toBe(ToolImportOutcome.Created);
    expect(world.createsOf("Monitor")).toHaveLength(3);
  });

  test("a monitor the project already has is used, not made again", async () => {
    const world: ApplierWorld = new ApplierWorld().withMonitoring();
    const existingId: string = ObjectID.generate().toString();

    const { report } = await runImport({
      state: projectState({
        existingMonitors: [
          {
            id: existingId,
            name: "Site home",
            monitorType: MonitorType.Website,
            addressKey: getToolImportMonitorMatchKey({
              monitorType: MonitorType.Website,
              destination: "https://example.com",
            }),
          },
        ],
      }),
    });

    expect(
      world.dataOf<Monitor>("Monitor").map((created: Monitor) => {
        return created.name;
      }),
    ).not.toContain("Site home");
    expect(
      outcomeOf(report, ToolImportResourceKind.Monitor, "home"),
    ).toMatchObject({
      outcome: ToolImportOutcome.Matched,
      recordIds: [existingId],
    });

    // The page shows the project's own monitor.
    const homeResource: StatusPageResource = world
      .dataOf<StatusPageResource>("StatusPageResource")
      .find((resource: StatusPageResource) => {
        return resource.displayName === "Home page";
      })!;
    expect(homeResource.monitorId?.toString()).toBe(existingId);
  });

  test("an earlier import's monitors are found by the tool's id and never made twice", async () => {
    const first: ApplierWorld = new ApplierWorld().withMonitoring();
    await runImport({
      snapshot: account({ statusPages: [], statusPageSubscribers: [] }),
    });
    const made: number = first.createsOf("Monitor").length;
    jest.restoreAllMocks();

    const second: ApplierWorld = new ApplierWorld().withMonitoring();
    second.records = first.records;

    const { report } = await runImport({
      snapshot: account({ statusPages: [], statusPageSubscribers: [] }),
      state: projectState({
        previousRecords: first.records.map((record: ToolImportRecord) => {
          return {
            kind: record.kind as ToolImportResourceKind,
            sourceId: record.sourceId!,
            recordId: record.recordId!.toString(),
            isComplete: Boolean(record.isComplete),
            stillExists: true,
          };
        }),
      }),
    });

    expect(made).toBe(4);
    expect(second.createsOf("Monitor")).toHaveLength(0);
    expect(
      outcomeOf(report, ToolImportResourceKind.Monitor, "home").outcome,
    ).toBe(ToolImportOutcome.AlreadyImported);
  });
});

describe("ToolImportApplier: status pages", () => {
  test("the page keeps its titles, privacy, history (up to 90 days), subscriptions and search setting", async () => {
    const world: ApplierWorld = new ApplierWorld().withMonitoring();
    await runImport({});

    const page: StatusPage = world.dataOf<StatusPage>("StatusPage")[0]!;

    expect(page.name).toBe("Acme status");
    expect(page.description).toBe("For the team");
    expect(page.pageTitle).toBe("Acme");
    expect(page.pageDescription).toBe("How Acme is doing");
    expect(page.isPublicStatusPage).toBe(true);
    expect(page.showUptimeHistoryInDays).toBe(90);
    expect(page.enableEmailSubscribers).toBe(true);
    expect(page.allowSubscribersToChooseResources).toBe(true);
    expect(page.enableSearchEngineIndexing).toBe(false);
    expect(world.createsOf("StatusPage")[0]!.props).toBe(PERSON_PROPS);
  });

  test("on a plan that does not let visitors choose what they follow, the page comes over without the choice", async () => {
    const world: ApplierWorld = new ApplierWorld().withMonitoring();
    await runImport({ canLetSubscribersChooseResources: false });

    const page: StatusPage = world.dataOf<StatusPage>("StatusPage")[0]!;
    expect(page.allowSubscribersToChooseResources).toBeUndefined();
    // The rest of it is as it was.
    expect(page.enableEmailSubscribers).toBe(true);

    // Subscribers still follow the parts they chose: the team set them.
    const bob: StatusPageSubscriber = world.dataOf<StatusPageSubscriber>(
      "StatusPageSubscriber",
    )[1]!;
    expect(bob.isSubscribedToAllResources).toBe(false);
  });

  test("when the person or the plan may not make groups, the page comes over without them, everything it shows listed on its own", async () => {
    const world: ApplierWorld = new ApplierWorld().withMonitoring();
    const { report } = await runImport({ canCreateStatusPageGroups: false });

    expect(world.createsOf("StatusPageGroup")).toHaveLength(0);
    expect(
      world
        .dataOf<StatusPageResource>("StatusPageResource")
        .map((resource: StatusPageResource) => {
          return [
            resource.displayName,
            resource.statusPageGroupId,
            resource.order,
          ];
        }),
    ).toEqual([
      ["Home page", undefined, 1],
      ["Support desk", undefined, 2],
      ["Orders", undefined, 3],
    ]);
    expect(
      outcomeOf(report, ToolImportResourceKind.StatusPage, "page").outcome,
    ).toBe(ToolImportOutcome.Created);
  });

  test("its groups, in order, then the monitors it shows, in order, each in its group, with its uptime and bars", async () => {
    const world: ApplierWorld = new ApplierWorld().withMonitoring();
    await runImport({});

    const page: StatusPage = world.dataOf<StatusPage>("StatusPage")[0]!;
    const groups: Array<StatusPageGroup> =
      world.dataOf<StatusPageGroup>("StatusPageGroup");

    expect(
      groups.map((group: StatusPageGroup) => {
        return [
          group.name,
          group.order,
          group.description,
          group.statusPageId?.toString(),
        ];
      }),
    ).toEqual([
      ["Website", 1, "What visitors see", page.id!.toString()],
      ["Back office", 2, undefined, page.id!.toString()],
    ]);

    const monitorId: (name: string) => string = (name: string): string => {
      return monitorNamed(world, name).id!.toString();
    };

    expect(
      world
        .dataOf<StatusPageResource>("StatusPageResource")
        .map((resource: StatusPageResource) => {
          return {
            name: resource.displayName,
            description: resource.displayDescription,
            monitorId: resource.monitorId?.toString(),
            groupId: resource.statusPageGroupId?.toString(),
            order: resource.order,
            current: resource.showCurrentStatus,
            uptime: resource.showUptimePercent,
            bars: resource.showStatusHistoryChart,
          };
        }),
    ).toEqual([
      {
        name: "Home page",
        description: "The front page",
        monitorId: monitorId("Site home"),
        groupId: groups[0]!.id!.toString(),
        order: 1,
        current: true,
        uptime: true,
        bars: false,
      },
      {
        name: "Support desk",
        description: undefined,
        monitorId: monitorId("Support desk"),
        groupId: undefined,
        order: 2,
        current: true,
        uptime: false,
        bars: true,
      },
      {
        name: "Orders",
        description: undefined,
        monitorId: monitorId("Site orders"),
        groupId: groups[1]!.id!.toString(),
        order: 3,
        current: true,
        uptime: true,
        bars: true,
      },
    ]);
  });

  test("a monitor that did not come over is said on the page, by its name", async () => {
    new ApplierWorld().withMonitoring();
    const { report } = await runImport({});

    expect(
      outcomeOf(report, ToolImportResourceKind.StatusPage, "page"),
    ).toMatchObject({
      outcome: ToolImportOutcome.Created,
      notes: [
        makeToolImportNote(ToolImportNoteCode.StatusPageMonitorLeftOut, {
          name: "Syslog",
        }),
      ],
    });
  });

  test("a monitor left unticked is left off the page, and said", async () => {
    const world: ApplierWorld = new ApplierWorld().withMonitoring();
    const { report } = await runImport({
      selectedKeys: (plan: ToolImportPlan) => {
        return plan.items
          .filter((item: ToolImportPlanItem) => {
            return (
              item.isSelectable &&
              item.key !==
                getToolImportItemKey(ToolImportResourceKind.Monitor, "orders")
            );
          })
          .map((item: ToolImportPlanItem) => {
            return item.key;
          });
      },
    });

    expect(
      world
        .dataOf<StatusPageResource>("StatusPageResource")
        .map((resource: StatusPageResource) => {
          return resource.displayName;
        }),
    ).toEqual(["Home page", "Support desk"]);
    expect(
      outcomeOf(report, ToolImportResourceKind.StatusPage, "page").notes,
    ).toContainEqual(
      makeToolImportNote(ToolImportNoteCode.StatusPageMonitorLeftOut, {
        name: "Site orders",
      }),
    );
  });

  test("a group OneUptime refuses is said, and its monitors are shown outside any group", async () => {
    const world: ApplierWorld = new ApplierWorld()
      .withMonitoring()
      .refuse("StatusPageGroup", (data: unknown) => {
        return (data as StatusPageGroup).name === "Website"
          ? new BadDataException("Group refused.")
          : null;
      });

    const { report } = await runImport({});

    expect(
      outcomeOf(report, ToolImportResourceKind.StatusPage, "page").notes,
    ).toContainEqual(
      makeToolImportNote(ToolImportNoteCode.PartNotAdded, {
        name: "Website",
        error: "Group refused.",
      }),
    );
    expect(
      world
        .dataOf<StatusPageResource>("StatusPageResource")
        .find((resource: StatusPageResource) => {
          return resource.displayName === "Home page";
        })!.statusPageGroupId,
    ).toBeUndefined();
  });
});

describe("ToolImportApplier: status page subscribers", () => {
  test("without the person's word, no subscriber comes over, even ticked", async () => {
    const world: ApplierWorld = new ApplierWorld().withMonitoring();
    const { report } = await runImport({ subscribersConsent: false });

    expect(world.createsOf("StatusPageSubscriber")).toHaveLength(0);

    for (const sourceId of ["ann", "bob", "carol"]) {
      expect(
        outcomeOf(
          report,
          ToolImportResourceKind.StatusPageSubscriber,
          sourceId,
        ),
      ).toMatchObject({
        outcome: ToolImportOutcome.Skipped,
        reason: makeToolImportNote(ToolImportNoteCode.SubscriberNotConsented),
      });
    }
  });

  test("with it, each is subscribed to the page, confirmed, sent nothing now, as the person", async () => {
    const world: ApplierWorld = new ApplierWorld().withMonitoring();
    await runImport({});

    const page: StatusPage = world.dataOf<StatusPage>("StatusPage")[0]!;
    const creates: Array<RecordedCreate> = world.createsOf(
      "StatusPageSubscriber",
    );

    expect(creates).toHaveLength(3);

    for (const create of creates) {
      const created: StatusPageSubscriber = create.data as StatusPageSubscriber;

      expect(create.props).toBe(PERSON_PROPS);
      expect(created.statusPageId?.toString()).toBe(page.id!.toString());
      expect(created.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(created.isSubscriptionConfirmed).toBe(true);
      expect(created.sendYouHaveSubscribedMessage).toBe(false);
      expect(created.isSubscribedToAllEventTypes).toBe(true);
    }

    expect(
      creates.map((create: RecordedCreate) => {
        return (
          create.data as StatusPageSubscriber
        ).subscriberEmail?.toString();
      }),
    ).toEqual(["ann@example.com", "bob@example.com", "carol@example.com"]);
  });

  test("one who followed parts of the page follows the same parts; one whose part did not come over follows the whole page, said", async () => {
    const world: ApplierWorld = new ApplierWorld().withMonitoring();
    const { report } = await runImport({});

    const resourceId: (name: string) => string = (name: string): string => {
      return world
        .dataOf<StatusPageResource>("StatusPageResource")
        .find((resource: StatusPageResource) => {
          return resource.displayName === name;
        })!
        .id!.toString();
    };

    const subscribers: Array<StatusPageSubscriber> =
      world.dataOf<StatusPageSubscriber>("StatusPageSubscriber");
    const [ann, bob, carol] = subscribers;

    expect(ann!.isSubscribedToAllResources).toBe(true);
    expect(bob!.isSubscribedToAllResources).toBe(false);
    expect(
      (bob!.statusPageResources || []).map((resource: StatusPageResource) => {
        return resource.id?.toString();
      }),
    ).toEqual([resourceId("Home page"), resourceId("Orders")]);
    expect(carol!.isSubscribedToAllResources).toBe(true);

    expect(
      outcomeOf(report, ToolImportResourceKind.StatusPageSubscriber, "carol")
        .notes,
    ).toEqual([
      makeToolImportNote(ToolImportNoteCode.SubscriberFollowsWholePage),
    ]);
    expect(
      outcomeOf(report, ToolImportResourceKind.StatusPageSubscriber, "ann")
        .notes,
    ).toEqual([]);
  });

  test("subscribers of the project's own page of that name join it, the whole page", async () => {
    const world: ApplierWorld = new ApplierWorld().withMonitoring();
    const existingPageId: string = ObjectID.generate().toString();

    const { report } = await runImport({
      state: projectState({
        existingByKind: new Map([
          [
            ToolImportResourceKind.StatusPage,
            [{ id: existingPageId, name: "Acme status" }],
          ],
        ]),
      }),
    });

    expect(world.createsOf("StatusPage")).toHaveLength(0);
    expect(
      outcomeOf(report, ToolImportResourceKind.StatusPage, "page").outcome,
    ).toBe(ToolImportOutcome.Matched);

    const subscribers: Array<StatusPageSubscriber> =
      world.dataOf<StatusPageSubscriber>("StatusPageSubscriber");

    expect(subscribers).toHaveLength(3);

    for (const created of subscribers) {
      expect(created.statusPageId?.toString()).toBe(existingPageId);
      expect(created.isSubscribedToAllResources).toBe(true);
    }

    expect(
      outcomeOf(report, ToolImportResourceKind.StatusPageSubscriber, "bob")
        .notes,
    ).toEqual([
      makeToolImportNote(ToolImportNoteCode.SubscriberFollowsWholePage),
    ]);
  });

  test("a subscriber whose page was left unticked does not come over", async () => {
    const world: ApplierWorld = new ApplierWorld().withMonitoring();
    const { report } = await runImport({
      selectedKeys: (plan: ToolImportPlan) => {
        return plan.items
          .filter((item: ToolImportPlanItem) => {
            return (
              item.isSelectable &&
              item.kind !== ToolImportResourceKind.StatusPage
            );
          })
          .map((item: ToolImportPlanItem) => {
            return item.key;
          });
      },
    });

    expect(world.createsOf("StatusPageSubscriber")).toHaveLength(0);
    expect(
      outcomeOf(report, ToolImportResourceKind.StatusPageSubscriber, "ann"),
    ).toMatchObject({
      outcome: ToolImportOutcome.Skipped,
      reason: makeToolImportNote(ToolImportNoteCode.SubscriberPageLeftOut),
    });
  });
});
