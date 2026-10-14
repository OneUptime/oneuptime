import { afterEach, describe, expect, jest, test } from "@jest/globals";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ServiceModel from "../../../../Models/DatabaseModels/Service";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../../Models/DatabaseModels/StatusPageSubscriber";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import ToolImportRecord from "../../../../Models/DatabaseModels/ToolImportRecord";
import User from "../../../../Models/DatabaseModels/User";
import IncidentRoleService from "../../../../Server/Services/IncidentRoleService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import MonitorService from "../../../../Server/Services/MonitorService";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import ServiceService from "../../../../Server/Services/ServiceService";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../../Server/Services/StatusPageSubscriberService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import TeamService from "../../../../Server/Services/TeamService";
import ToolImportRecordService from "../../../../Server/Services/ToolImportRecordService";
import {
  buildToolImportPlan,
  ToolImportExistingRecord,
  ToolImportPreviousRecord,
  ToolImportProjectState,
} from "../../../../Server/Utils/ToolImport/ToolImportPlanner";
import ToolImportProjectStateReader from "../../../../Server/Utils/ToolImport/ToolImportProjectStateReader";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import Email from "../../../../Types/Email";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { TOOL_IMPORT_MAX_RECORDS_PER_KIND } from "../../../../Types/ToolImport/ToolImportLimits";
import {
  buildToolImportMonitor,
  getToolImportMonitorMatchKey,
  ToolImportMonitorDefaults,
} from "../../../../Types/ToolImport/ToolImportMonitorBuilder";
import {
  makeToolImportNote,
  ToolImportNoteCode,
} from "../../../../Types/ToolImport/ToolImportNote";
import {
  ToolImportAction,
  ToolImportPlan,
  ToolImportPlanItem,
} from "../../../../Types/ToolImport/ToolImportPlan";
import ToolImportResourceKind, {
  getToolImportItemKey,
} from "../../../../Types/ToolImport/ToolImportResourceKind";
import { ImportedMonitor } from "../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../Types/ToolImport/ToolImportSource";
import {
  idsNamedBy,
  readAsTheDatabaseWould,
  TableRead,
} from "./ToolImportApplierWorld";
import {
  fullAccess,
  person,
  service,
  snapshot,
} from "./ToolImportSnapshotFixtures";

/*
 * What a project holds of the imports before, read whatever its size:
 *
 *  - the status page subscribers earlier imports of a tool brought over that
 *    the project still has: what the next read of the tool reads past, so it
 *    collects the subscribers still to come. Every one counts, however many
 *    imports it took; one deleted in OneUptime since does not, so it is
 *    read, and offered, again;
 *  - every record earlier imports remembered, and every subscriber the
 *    project has (readState), past the most rows one read returns: what the
 *    first import brought over stays already imported, and someone who
 *    already follows a page is that subscriber, after any number of imports;
 *  - every monitor, membership and record of a kind the project has
 *    (readState), past the most rows one read returns: what an import made
 *    among the oldest of them stays already imported, and an imported check,
 *    person or service is the oldest monitor, member or service it already
 *    is - never made, or invited, a second time.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

// What earlier imports remembered: a row for each of `count` subscribers.
function rememberedSubscribers(count: number): Array<ToolImportRecord> {
  return Array.from(
    { length: count },
    (_value: unknown, index: number): ToolImportRecord => {
      const record: ToolImportRecord = new ToolImportRecord();
      record.projectId = PROJECT_ID;
      record.source = ToolImportSource.AtlassianStatuspage;
      record.kind = ToolImportResourceKind.StatusPageSubscriber;
      record.sourceId = `sub-${index}`;
      record.recordId = ObjectID.generate();
      record.isComplete = true;
      return record;
    },
  );
}

interface Reads {
  records: Array<Record<string, unknown>>;
  // The ids each read of subscribers named, and how many it asked for.
  subscribers: Array<{ ids: Set<string> | null; limit: unknown }>;
}

// The remembered rows, and the subscribers the project has (by id).
function serve(data: {
  records: Array<ToolImportRecord>;
  subscriberIds: Array<string>;
}): Reads {
  const reads: Reads = { records: [], subscribers: [] };

  jest.spyOn(ToolImportRecordService, "findAllBy").mockImplementation((async (
    args: Record<string, unknown>,
  ): Promise<Array<ToolImportRecord>> => {
    reads.records.push(args);
    return data.records;
  }) as never);

  jest
    .spyOn(StatusPageSubscriberService, "findBy")
    .mockImplementation((async (args: {
      query: { _id?: unknown };
      limit?: unknown;
    }): Promise<Array<StatusPageSubscriber>> => {
      const ids: Set<string> | null = idsNamedBy(args.query._id);
      reads.subscribers.push({ ids: ids, limit: args.limit });

      return data.subscriberIds
        .filter((id: string): boolean => {
          return !ids || ids.has(id.toLowerCase());
        })
        .map((id: string): StatusPageSubscriber => {
          const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
          subscriber._id = id;
          return subscriber;
        });
    }) as never);

  return reads;
}

async function readImported(): Promise<Set<string>> {
  return await ToolImportProjectStateReader.readImportedSubscriberIds({
    projectId: PROJECT_ID,
    source: ToolImportSource.AtlassianStatuspage,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ToolImportProjectStateReader.readImportedSubscriberIds", () => {
  test("the tool's ids of the subscribers its imports brought over that the project still has", async () => {
    const records: Array<ToolImportRecord> = rememberedSubscribers(3);
    // sub-1 was deleted in OneUptime since.
    const reads: Reads = serve({
      records: records,
      subscriberIds: [
        records[0]!.recordId!.toString(),
        records[2]!.recordId!.toString(),
      ],
    });

    expect([...(await readImported())]).toEqual(["sub-0", "sub-2"]);

    // This tool's subscribers only, and every one of them: no limit.
    expect(reads.records).toHaveLength(1);
    expect(reads.records[0]!["query"]).toEqual({
      projectId: PROJECT_ID,
      source: ToolImportSource.AtlassianStatuspage,
      kind: ToolImportResourceKind.StatusPageSubscriber,
    });
    expect(reads.records[0]).not.toHaveProperty("limit");
    // Looked up by their ids.
    expect(reads.subscribers).toEqual([
      {
        ids: new Set<string>(
          records.map((record: ToolImportRecord): string => {
            return record.recordId!.toString().toLowerCase();
          }),
        ),
        limit: 3,
      },
    ]);
  });

  test("more than one read's worth are looked up a thousand at a time, and all of them count", async () => {
    const records: Array<ToolImportRecord> = rememberedSubscribers(2500);
    const reads: Reads = serve({
      records: records,
      subscriberIds: records.map((record: ToolImportRecord): string => {
        return record.recordId!.toString();
      }),
    });

    expect((await readImported()).size).toBe(2500);
    expect(
      reads.subscribers.map(
        (read: { ids: Set<string> | null; limit: unknown }): unknown => {
          return [read.ids?.size, read.limit];
        },
      ),
    ).toEqual([
      [1000, 1000],
      [1000, 1000],
      [500, 500],
    ]);
  });

  test("with nothing brought over before, no subscriber is read", async () => {
    const reads: Reads = serve({ records: [], subscriberIds: [] });

    expect(await readImported()).toEqual(new Set<string>());
    expect(reads.subscribers).toEqual([]);
  });
});

describe("ToolImportProjectStateReader.readState, past the most rows one read returns", () => {
  const PAGE_ID: ObjectID = ObjectID.generate();
  const MONITOR_ID: ObjectID = ObjectID.generate();
  // Two imports of the page's subscribers, each bringing as many as it reads.
  const IMPORTED: number = 2 * TOOL_IMPORT_MAX_RECORDS_PER_KIND;

  // Every page of a read of every row: a page at a time, in the order of their ids.
  const EVERY_PAGE: Array<unknown> = [
    [0, LIMIT_MAX, { _id: SortOrder.Ascending }],
    [LIMIT_MAX, LIMIT_MAX, { _id: SortOrder.Ascending }],
  ];

  interface StatuspageProject {
    // What the imports remembered, oldest first.
    records: Array<ToolImportRecord>;
    // The page's subscribers, oldest first.
    subscribers: Array<StatusPageSubscriber>;
    // The imported subscriber deleted in OneUptime since.
    deletedSourceId: string;
  }

  // What an import of `source` remembered of one of its items.
  function rememberedRecord(
    kind: ToolImportResourceKind,
    sourceId: string,
    recordId: ObjectID,
    source: ToolImportSource = ToolImportSource.AtlassianStatuspage,
  ): ToolImportRecord {
    const record: ToolImportRecord = new ToolImportRecord();
    record.id = ObjectID.generate();
    record.projectId = PROJECT_ID;
    record.source = source;
    record.kind = kind;
    record.sourceId = sourceId;
    record.recordId = recordId;
    record.isComplete = true;
    return record;
  }

  function pageSubscriber(email: string): StatusPageSubscriber {
    const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
    subscriber.id = ObjectID.generate();
    subscriber.statusPageId = PAGE_ID;
    subscriber.subscriberEmail = new Email(email);
    return subscriber;
  }

  /*
   * A Statuspage page imported once - the page and its component - and
   * its subscribers twice since. Ann followed the page from OneUptime
   * before any import, and a few more did after the imports; one of the
   * subscribers brought over was deleted since.
   */
  function statuspageProject(): StatuspageProject {
    const records: Array<ToolImportRecord> = [
      rememberedRecord(ToolImportResourceKind.StatusPage, "acme", PAGE_ID),
      rememberedRecord(ToolImportResourceKind.Monitor, "web", MONITOR_ID),
    ];
    const subscribers: Array<StatusPageSubscriber> = [
      pageSubscriber("ann@example.com"),
    ];
    const deletedSourceId: string = `sub-${IMPORTED - 1}`;

    for (let index: number = 0; index < IMPORTED; index++) {
      const subscriber: StatusPageSubscriber = pageSubscriber(
        `sub-${index}@example.com`,
      );

      records.push(
        rememberedRecord(
          ToolImportResourceKind.StatusPageSubscriber,
          `sub-${index}`,
          subscriber.id!,
        ),
      );

      if (`sub-${index}` !== deletedSourceId) {
        subscribers.push(subscriber);
      }
    }

    for (let index: number = 0; index < 5; index++) {
      subscribers.push(pageSubscriber(`late-${index}@example.com`));
    }

    return { records, subscribers, deletedSourceId };
  }

  /*
   * A table of the project as its service answers reads of it: `rows`
   * (oldest first) as the database reads them (readAsTheDatabaseWould: a
   * read that stops at its limit misses the oldest). Each read is kept.
   */
  function serveTable<T extends BaseModel>(
    databaseService: unknown,
    rows: Array<T>,
  ): Array<TableRead> {
    const reads: Array<TableRead> = [];

    jest
      .spyOn(
        databaseService as {
          findBy: (args: TableRead) => Promise<Array<T>>;
        },
        "findBy",
      )
      .mockImplementation(async (args: TableRead): Promise<Array<T>> => {
        reads.push(args);
        return readAsTheDatabaseWould(rows, args);
      });

    return reads;
  }

  // Tables the project has nothing in.
  function serveNothingFrom(databaseServices: Array<unknown>): void {
    for (const databaseService of databaseServices) {
      jest
        .spyOn(databaseService as { findBy: () => Promise<[]> }, "findBy")
        .mockImplementation(async (): Promise<[]> => {
          return [];
        });
    }
  }

  // Where each read started, how many rows it asked for, and in what order.
  function pagesOf(reads: Array<TableRead>): Array<unknown> {
    return reads.map((read: TableRead): unknown => {
      return [read.skip, read.limit, read.sort];
    });
  }

  interface ProjectReads {
    records: Array<TableRead>;
    subscribers: Array<TableRead>;
  }

  /*
   * The project as its services answer: the records and the subscribers as
   * the database reads them, and the page and the component renamed in
   * OneUptime since the import, so neither has the tool's name.
   */
  function serveProject(project: StatuspageProject): ProjectReads {
    const reads: ProjectReads = {
      records: serveTable(ToolImportRecordService, project.records),
      subscribers: serveTable(StatusPageSubscriberService, project.subscribers),
    };

    const page: StatusPage = new StatusPage();
    page.id = PAGE_ID;
    page.name = "Acme Status";

    const component: Monitor = new Monitor();
    component.id = MONITOR_ID;
    component.name = "Web application";
    component.monitorType = MonitorType.Manual;

    jest.spyOn(StatusPageService, "findBy").mockImplementation((async () => {
      return [page];
    }) as never);
    jest.spyOn(MonitorService, "findBy").mockImplementation((async () => {
      return [component];
    }) as never);

    serveNothingFrom([
      TeamMemberService,
      IncidentStateService,
      IncidentRoleService,
    ]);

    return reads;
  }

  async function readStateOf(
    source: ToolImportSource,
  ): Promise<ToolImportProjectState> {
    return await ToolImportProjectStateReader.readState({
      projectId: PROJECT_ID,
      source: source,
    });
  }

  function itemOf(
    plan: ToolImportPlan,
    kind: ToolImportResourceKind,
    sourceId: string,
  ): ToolImportPlanItem | undefined {
    return plan.items.find((candidate: ToolImportPlanItem): boolean => {
      return candidate.key === getToolImportItemKey(kind, sourceId);
    });
  }

  test("every record the imports remembered is read, page by page, and every one is known to be there or gone", async () => {
    const project: StatuspageProject = statuspageProject();
    const reads: ProjectReads = serveProject(project);

    expect(project.records.length).toBeGreaterThan(LIMIT_MAX);
    expect(project.subscribers.length).toBeGreaterThan(LIMIT_MAX);

    const state: ToolImportProjectState = await readStateOf(
      ToolImportSource.AtlassianStatuspage,
    );

    expect(state.previousRecords).toHaveLength(project.records.length);
    // The first import's, the oldest of them all.
    expect(state.previousRecords).toEqual(
      expect.arrayContaining([
        {
          kind: ToolImportResourceKind.StatusPage,
          sourceId: "acme",
          recordId: PAGE_ID.toString(),
          isComplete: true,
          stillExists: true,
        },
        {
          kind: ToolImportResourceKind.Monitor,
          sourceId: "web",
          recordId: MONITOR_ID.toString(),
          isComplete: true,
          stillExists: true,
        },
      ]),
    );
    // Each subscriber brought over is there, the oldest too, but the one deleted since.
    expect(
      state.previousRecords
        .filter((record: ToolImportPreviousRecord): boolean => {
          return !record.stillExists;
        })
        .map((record: ToolImportPreviousRecord): string => {
          return record.sourceId;
        }),
    ).toEqual([project.deletedSourceId]);

    // The page's followers, from before the imports to after them.
    const emails: Set<string> | undefined =
      state.subscriberEmailsByStatusPageId?.get(
        PAGE_ID.toString().toLowerCase(),
      );

    expect(emails?.size).toBe(project.subscribers.length);
    expect(emails?.has("ann@example.com")).toBe(true);
    expect(emails?.has("sub-0@example.com")).toBe(true);
    expect(emails?.has("late-4@example.com")).toBe(true);

    // Read a page at a time, in the order of their ids, to the last row.
    expect(pagesOf(reads.records)).toEqual(EVERY_PAGE);
    expect(pagesOf(reads.subscribers)).toEqual(EVERY_PAGE);
  });

  test("imported again, the page and its component are already imported - renamed since, never made twice - and someone who already follows the page is that subscriber", async () => {
    serveProject(statuspageProject());

    const plan: ToolImportPlan = buildToolImportPlan({
      snapshot: snapshot({
        source: ToolImportSource.AtlassianStatuspage,
        monitors: [
          {
            sourceId: "web",
            name: "Web app",
            sourceType: "component",
            monitorType: MonitorType.Manual,
            isPaused: false,
            notes: [],
          },
        ],
        statusPages: [
          {
            sourceId: "acme",
            name: "Acme",
            isPublic: true,
            groups: [],
            resources: [
              {
                key: "web",
                monitorSourceId: "web",
                displayName: "Web app",
                showUptimePercent: true,
                showStatusHistoryChart: true,
              },
            ],
            notes: [],
          },
        ],
        // Read past the ones brought over before: Ann, and someone new.
        statusPageSubscribers: [
          {
            sourceId: "ann",
            email: "ann@example.com",
            statusPageSourceId: "acme",
            resourceKeys: [],
            notes: [],
          },
          {
            sourceId: "bob",
            email: "bob@example.com",
            statusPageSourceId: "acme",
            resourceKeys: [],
            notes: [],
          },
        ],
      }),
      state: await readStateOf(ToolImportSource.AtlassianStatuspage),
      access: fullAccess(),
    });

    expect(
      itemOf(plan, ToolImportResourceKind.StatusPage, "acme"),
    ).toMatchObject({
      action: ToolImportAction.AlreadyImported,
      existingRecordId: PAGE_ID.toString(),
    });
    expect(itemOf(plan, ToolImportResourceKind.Monitor, "web")).toMatchObject({
      action: ToolImportAction.AlreadyImported,
      existingRecordId: MONITOR_ID.toString(),
    });
    // Not offered: subscribing Ann again would be refused.
    expect(
      itemOf(plan, ToolImportResourceKind.StatusPageSubscriber, "ann"),
    ).toMatchObject({
      action: ToolImportAction.Match,
      existingRecordId: PAGE_ID.toString(),
      reason: makeToolImportNote(
        ToolImportNoteCode.SubscriberAlreadySubscribed,
      ),
    });
    expect(
      itemOf(plan, ToolImportResourceKind.StatusPageSubscriber, "bob"),
    ).toMatchObject({ action: ToolImportAction.Create });
  });

  // The statuses and severities a monitor's steps name.
  const MONITOR_DEFAULTS: ToolImportMonitorDefaults = {
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
  };

  // A Pingdom check of a website.
  function websiteCheck(
    sourceId: string,
    name: string,
    url: string,
  ): ImportedMonitor {
    return {
      sourceId: sourceId,
      name: name,
      sourceType: "http",
      monitorType: MonitorType.Website,
      destination: url,
      isPaused: false,
      notes: [],
    };
  }

  const CHECKOUT_CHECK: ImportedMonitor = websiteCheck(
    "checkout",
    "Checkout",
    "https://checkout.example.com",
  );
  const DOCS_CHECK: ImportedMonitor = websiteCheck(
    "docs",
    "Docs",
    "https://docs.example.com",
  );

  // A monitor of the project, called `name`, that checks what `check` does.
  function monitorChecking(check: ImportedMonitor, name: string): Monitor {
    const monitor: Monitor = new Monitor();
    monitor.id = ObjectID.generate();
    monitor.projectId = PROJECT_ID;
    monitor.name = name;
    monitor.monitorType = check.monitorType!;
    monitor.monitorSteps = buildToolImportMonitor({
      monitor: check,
      defaults: MONITOR_DEFAULTS,
    }).monitorSteps;
    return monitor;
  }

  interface PingdomProject {
    // The project's monitors, oldest first.
    monitors: Array<Monitor>;
    // What the import remembered.
    records: Array<ToolImportRecord>;
    // The monitor the import made of the checkout check.
    checkout: Monitor;
    // The monitor someone made in OneUptime of what the docs check checks.
    docs: Monitor;
  }

  /*
   * A Pingdom account imported once. The monitor someone made in OneUptime
   * of what its docs check checks, and the one the import made of its
   * checkout check - renamed in OneUptime since - are the project's
   * oldest: more monitors than one read returns were made after them.
   */
  function pingdomProject(): PingdomProject {
    const docs: Monitor = monitorChecking(DOCS_CHECK, "Docs");
    const checkout: Monitor = monitorChecking(CHECKOUT_CHECK, "Checkout (EU)");
    const monitors: Array<Monitor> = [docs, checkout];

    for (let index: number = 0; index < LIMIT_MAX; index++) {
      const monitor: Monitor = new Monitor();
      monitor.id = ObjectID.generate();
      monitor.projectId = PROJECT_ID;
      monitor.name = `Release ${index}`;
      monitor.monitorType = MonitorType.Manual;
      monitors.push(monitor);
    }

    return {
      monitors: monitors,
      records: [
        rememberedRecord(
          ToolImportResourceKind.Monitor,
          CHECKOUT_CHECK.sourceId,
          checkout.id!,
          ToolImportSource.Pingdom,
        ),
      ],
      checkout: checkout,
      docs: docs,
    };
  }

  // The project as its services answer, and the reads of its monitors.
  function servePingdomProject(project: PingdomProject): Array<TableRead> {
    serveTable(ToolImportRecordService, project.records);
    serveNothingFrom([
      TeamMemberService,
      IncidentStateService,
      IncidentRoleService,
    ]);

    return serveTable(MonitorService, project.monitors);
  }

  test("every monitor is read, page by page, with what it checks: the oldest are there, the one an import made too", async () => {
    const project: PingdomProject = pingdomProject();
    const reads: Array<TableRead> = servePingdomProject(project);

    expect(project.monitors.length).toBeGreaterThan(LIMIT_MAX);

    const state: ToolImportProjectState = await readStateOf(
      ToolImportSource.Pingdom,
    );

    // By name: what tells the import's monitor is still there.
    const named: Array<ToolImportExistingRecord> =
      state.existingByKind.get(ToolImportResourceKind.Monitor) || [];

    expect(named).toHaveLength(project.monitors.length);
    expect(named).toEqual(
      expect.arrayContaining([
        { id: project.docs.id!.toString(), name: "Docs" },
        { id: project.checkout.id!.toString(), name: "Checkout (EU)" },
      ]),
    );
    expect(state.previousRecords).toEqual([
      {
        kind: ToolImportResourceKind.Monitor,
        sourceId: "checkout",
        recordId: project.checkout.id!.toString(),
        isComplete: true,
        stillExists: true,
      },
    ]);

    // With what each checks: what an imported check is matched to.
    expect(state.existingMonitors).toHaveLength(project.monitors.length);
    expect(state.existingMonitors).toEqual(
      expect.arrayContaining([
        {
          id: project.docs.id!.toString(),
          name: "Docs",
          monitorType: MonitorType.Website,
          addressKey: getToolImportMonitorMatchKey(DOCS_CHECK),
        },
        {
          id: project.checkout.id!.toString(),
          name: "Checkout (EU)",
          monitorType: MonitorType.Website,
          addressKey: getToolImportMonitorMatchKey(CHECKOUT_CHECK),
        },
      ]),
    );

    // Both reads - by name, then with what each checks - to the last row.
    expect(pagesOf(reads)).toEqual([...EVERY_PAGE, ...EVERY_PAGE]);
  });

  test("imported again, the monitor the import made is already imported - renamed since, never made twice - and a check is the oldest monitor that already checks what it does", async () => {
    const project: PingdomProject = pingdomProject();
    servePingdomProject(project);

    const plan: ToolImportPlan = buildToolImportPlan({
      snapshot: snapshot({
        source: ToolImportSource.Pingdom,
        monitors: [CHECKOUT_CHECK, DOCS_CHECK],
      }),
      state: await readStateOf(ToolImportSource.Pingdom),
      access: fullAccess(),
    });

    const checkout: ToolImportPlanItem | undefined = itemOf(
      plan,
      ToolImportResourceKind.Monitor,
      "checkout",
    );

    expect(checkout).toMatchObject({
      action: ToolImportAction.AlreadyImported,
      existingRecordId: project.checkout.id!.toString(),
    });
    expect(checkout?.notes).not.toContainEqual(
      makeToolImportNote(ToolImportNoteCode.ImportedBeforeDeletedSince),
    );
    expect(itemOf(plan, ToolImportResourceKind.Monitor, "docs")).toMatchObject({
      action: ToolImportAction.Match,
      existingRecordId: project.docs.id!.toString(),
      reason: makeToolImportNote(ToolImportNoteCode.MonitorAlreadyChecked, {
        name: "Docs",
      }),
    });
  });

  // Someone's membership of the project, with their account's email.
  function membershipOf(email: string): TeamMember {
    const user: User = new User();
    user.id = ObjectID.generate();
    user.email = new Email(email);

    const membership: TeamMember = new TeamMember();
    membership.id = ObjectID.generate();
    membership.projectId = PROJECT_ID;
    membership.userId = user.id!;
    membership.user = user;
    return membership;
  }

  function serviceNamed(name: string): ServiceModel {
    const record: ServiceModel = new ServiceModel();
    record.id = ObjectID.generate();
    record.projectId = PROJECT_ID;
    record.name = name;
    return record;
  }

  interface OpsGenieProject {
    // The project's memberships and services, oldest first.
    memberships: Array<TeamMember>;
    services: Array<ServiceModel>;
    // What the import remembered.
    records: Array<ToolImportRecord>;
    // Ann, whom the import invited, and Bob, a member before it.
    ann: TeamMember;
    bob: TeamMember;
    // The service the import made of the checkout service.
    checkout: ServiceModel;
    // Billing, made in OneUptime before the import.
    billing: ServiceModel;
  }

  /*
   * An Opsgenie account imported once: Ann, invited then, and its checkout
   * service, renamed in OneUptime since. Bob was a member, and Billing a
   * service, before the import. They are the project's oldest memberships
   * and services: more of each than one read returns were made after them.
   */
  function opsGenieProject(): OpsGenieProject {
    const bob: TeamMember = membershipOf("bob@example.com");
    const ann: TeamMember = membershipOf("ann@example.com");
    const billing: ServiceModel = serviceNamed("Billing");
    const checkout: ServiceModel = serviceNamed("Checkout (legacy)");
    const memberships: Array<TeamMember> = [bob, ann];
    const services: Array<ServiceModel> = [billing, checkout];

    for (let index: number = 0; index < LIMIT_MAX; index++) {
      memberships.push(membershipOf(`member-${index}@example.com`));
      services.push(serviceNamed(`Service ${index}`));
    }

    return {
      memberships: memberships,
      services: services,
      records: [
        rememberedRecord(
          ToolImportResourceKind.Person,
          "ann",
          ann.userId!,
          ToolImportSource.OpsGenie,
        ),
        rememberedRecord(
          ToolImportResourceKind.Service,
          "checkout",
          checkout.id!,
          ToolImportSource.OpsGenie,
        ),
      ],
      ann: ann,
      bob: bob,
      checkout: checkout,
      billing: billing,
    };
  }

  interface OpsGenieReads {
    memberships: Array<TableRead>;
    services: Array<TableRead>;
  }

  // The project as its services answer: no teams, schedules or policies.
  function serveOpsGenieProject(project: OpsGenieProject): OpsGenieReads {
    serveTable(ToolImportRecordService, project.records);
    serveNothingFrom([
      TeamService,
      OnCallDutyPolicyScheduleService,
      OnCallDutyPolicyService,
      IncidentStateService,
      IncidentRoleService,
    ]);

    return {
      memberships: serveTable(TeamMemberService, project.memberships),
      services: serveTable(ServiceService, project.services),
    };
  }

  test("every membership is read, page by page, each with its person's email, and every service: the oldest are there, what the import made too", async () => {
    const project: OpsGenieProject = opsGenieProject();
    const reads: OpsGenieReads = serveOpsGenieProject(project);

    expect(project.memberships.length).toBeGreaterThan(LIMIT_MAX);
    expect(project.services.length).toBeGreaterThan(LIMIT_MAX);

    const state: ToolImportProjectState = await readStateOf(
      ToolImportSource.OpsGenie,
    );

    // Everyone, by email.
    expect(state.memberUserIdsByEmail.size).toBe(project.memberships.length);
    expect(state.memberUserIdsByEmail.get("ann@example.com")).toBe(
      project.ann.userId!.toString(),
    );
    expect(state.memberUserIdsByEmail.get("bob@example.com")).toBe(
      project.bob.userId!.toString(),
    );

    // Every service, by name.
    const services: Array<ToolImportExistingRecord> =
      state.existingByKind.get(ToolImportResourceKind.Service) || [];

    expect(services).toHaveLength(project.services.length);
    expect(services).toEqual(
      expect.arrayContaining([
        { id: project.billing.id!.toString(), name: "Billing" },
        { id: project.checkout.id!.toString(), name: "Checkout (legacy)" },
      ]),
    );

    // Ann is still a member, and the service the import made is still there.
    expect(state.previousRecords).toHaveLength(2);
    expect(state.previousRecords).toEqual(
      expect.arrayContaining([
        {
          kind: ToolImportResourceKind.Person,
          sourceId: "ann",
          recordId: project.ann.userId!.toString(),
          isComplete: true,
          stillExists: true,
        },
        {
          kind: ToolImportResourceKind.Service,
          sourceId: "checkout",
          recordId: project.checkout.id!.toString(),
          isComplete: true,
          stillExists: true,
        },
      ]),
    );

    // Read a page at a time, in the order of their ids, to the last row...
    expect(pagesOf(reads.memberships)).toEqual(EVERY_PAGE);
    expect(pagesOf(reads.services)).toEqual(EVERY_PAGE);
    // ...each membership with its person's email.
    expect(
      reads.memberships.map((read: TableRead): unknown => {
        return read.select;
      }),
    ).toEqual([
      { userId: true, user: { email: true } },
      { userId: true, user: { email: true } },
    ]);
  });

  test("imported again, the oldest members are matched, not invited again, the service the import made is already imported - renamed since, never made twice - and the oldest service is matched by its name", async () => {
    const project: OpsGenieProject = opsGenieProject();
    serveOpsGenieProject(project);

    const plan: ToolImportPlan = buildToolImportPlan({
      snapshot: snapshot({
        source: ToolImportSource.OpsGenie,
        people: [person("ann"), person("bob"), person("carol")],
        services: [
          service("checkout", "Checkout"),
          service("billing", "Billing"),
        ],
      }),
      state: await readStateOf(ToolImportSource.OpsGenie),
      access: fullAccess(),
    });

    expect(itemOf(plan, ToolImportResourceKind.Person, "ann")).toMatchObject({
      action: ToolImportAction.Match,
      existingRecordId: project.ann.userId!.toString(),
      reason: makeToolImportNote(ToolImportNoteCode.PersonAlreadyMember),
    });
    expect(itemOf(plan, ToolImportResourceKind.Person, "bob")).toMatchObject({
      action: ToolImportAction.Match,
      existingRecordId: project.bob.userId!.toString(),
      reason: makeToolImportNote(ToolImportNoteCode.PersonAlreadyMember),
    });
    // Someone new is still invited.
    expect(itemOf(plan, ToolImportResourceKind.Person, "carol")).toMatchObject({
      action: ToolImportAction.Invite,
    });

    const checkout: ToolImportPlanItem | undefined = itemOf(
      plan,
      ToolImportResourceKind.Service,
      "checkout",
    );

    expect(checkout).toMatchObject({
      action: ToolImportAction.AlreadyImported,
      existingRecordId: project.checkout.id!.toString(),
    });
    expect(checkout?.notes).not.toContainEqual(
      makeToolImportNote(ToolImportNoteCode.ImportedBeforeDeletedSince),
    );
    expect(
      itemOf(plan, ToolImportResourceKind.Service, "billing"),
    ).toMatchObject({
      action: ToolImportAction.Match,
      existingRecordId: project.billing.id!.toString(),
      reason: makeToolImportNote(ToolImportNoteCode.NameExists, {
        name: "Billing",
      }),
    });
  });
});
