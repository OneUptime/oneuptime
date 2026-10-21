import { afterEach, describe, expect, jest, test } from "@jest/globals";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageGroup from "../../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "../../../../Models/DatabaseModels/StatusPageSubscriber";
import AtlassianStatuspageAdapter from "../../../../Server/Utils/ToolImport/Adapters/AtlassianStatuspage/AtlassianStatuspageAdapter";
import BetterStackAdapter from "../../../../Server/Utils/ToolImport/Adapters/BetterStack/BetterStackAdapter";
import PingdomAdapter from "../../../../Server/Utils/ToolImport/Adapters/Pingdom/PingdomAdapter";
import StatusCakeAdapter from "../../../../Server/Utils/ToolImport/Adapters/StatusCake/StatusCakeAdapter";
import UptimeKumaAdapter from "../../../../Server/Utils/ToolImport/Adapters/UptimeKuma/UptimeKumaAdapter";
import UptimeRobotAdapter from "../../../../Server/Utils/ToolImport/Adapters/UptimeRobot/UptimeRobotAdapter";
import ToolImportRecord from "../../../../Models/DatabaseModels/ToolImportRecord";
import ToolImportApplier from "../../../../Server/Utils/ToolImport/ToolImportApplier";
import {
  buildToolImportPlan,
  ToolImportPreviousRecord,
  ToolImportProjectState,
} from "../../../../Server/Utils/ToolImport/ToolImportPlanner";
import ToolImportProjectStateReader from "../../../../Server/Utils/ToolImport/ToolImportProjectStateReader";
import {
  ToolImportAdapter,
  ToolImportReadSettings,
} from "../../../../Server/Utils/ToolImport/Types";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { TOOL_IMPORT_MAX_RECORDS_PER_KIND } from "../../../../Types/ToolImport/ToolImportLimits";
import {
  makeToolImportNote,
  ToolImportNoteCode,
} from "../../../../Types/ToolImport/ToolImportNote";
import {
  ToolImportAction,
  ToolImportOutcome,
  ToolImportPlan,
  ToolImportPlanItem,
  ToolImportReport,
  ToolImportReportItem,
  ToolImportSelection,
} from "../../../../Types/ToolImport/ToolImportPlan";
import ToolImportResourceKind, {
  getToolImportItemKey,
} from "../../../../Types/ToolImport/ToolImportResourceKind";
import { ToolImportSnapshot } from "../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../Types/ToolImport/ToolImportSource";
import * as Statuspage from "./AtlassianStatuspageFixtures";
import * as BetterStack from "./BetterStackFixtures";
import * as Pingdom from "./PingdomFixtures";
import * as StatusCake from "./StatusCakeFixtures";
import { ApplierWorld, RecordedCreate } from "./ToolImportApplierWorld";
import { FixtureApi, RecordingSleep } from "./ToolImportFixtureTransport";
import { fullAccess, projectState } from "./ToolImportSnapshotFixtures";
import * as Kuma from "./UptimeKumaFixtures";
import * as UptimeRobot from "./UptimeRobotFixtures";

/*
 * Each uptime and status page tool, from its API (or its file) to
 * OneUptime: the real adapter reads its fixture, the real planner works
 * out the preview, and the real applier imports everything that can be
 * ticked - subscribers too, with the person's word - with OneUptime's
 * services stood in for (ApplierWorld.withMonitoring). Nothing that can
 * be ticked fails: every monitor an adapter offers is one the builder can
 * make, and every page shows the monitors that came over. A Statuspage or
 * Better Stack page with more subscribers than one import reads comes over
 * across imports, each one reading past what the ones before it brought
 * over.
 */

const NOW: number = Date.parse("2026-10-08T12:00:00Z");
const PROJECT_ID: ObjectID = ObjectID.generate();
const RUN_ID: ObjectID = ObjectID.generate();

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: ObjectID.generate(),
};

interface Flow {
  snapshot: ToolImportSnapshot;
  plan: ToolImportPlan;
  report: ToolImportReport;
  world: ApplierWorld;
}

// Everything that can be ticked, subscribers too, with the person's word.
function everythingTicked(plan: ToolImportPlan): ToolImportSelection {
  return {
    selectedKeys: plan.items
      .filter((item: ToolImportPlanItem): boolean => {
        return item.isSelectable;
      })
      .map((item: ToolImportPlanItem): string => {
        return item.key;
      }),
    inviteTeamId: null,
    subscribersConsent: true,
  };
}

async function importSnapshot(snapshot: ToolImportSnapshot): Promise<Flow> {
  const plan: ToolImportPlan = buildToolImportPlan({
    snapshot: snapshot,
    state: projectState(),
    access: fullAccess(),
  });

  const world: ApplierWorld = new ApplierWorld().withMonitoring();

  const report: ToolImportReport = await ToolImportApplier.apply({
    runId: RUN_ID,
    projectId: PROJECT_ID,
    source: snapshot.source,
    snapshot: snapshot,
    plan: plan,
    selection: everythingTicked(plan),
    props: PROPS,
    isLimitedToOneLevelPerPolicy: false,
    now: new Date(NOW),
    onProgress: async (): Promise<void> => {},
  });

  return { snapshot, plan, report, world };
}

async function importAll(data: {
  adapter: ToolImportAdapter;
  settings: ToolImportReadSettings;
  api: FixtureApi;
}): Promise<Flow> {
  const sleep: RecordingSleep = new RecordingSleep({ now: NOW });
  const snapshot: ToolImportSnapshot = await data.adapter.read(data.settings, {
    transport: data.api.transport,
    sleep: sleep.sleep,
    now: (): number => {
      return sleep.clock.now;
    },
    maxRequests: 500,
    deadlineAt: NOW + 15 * 60 * 1000,
  });

  return await importSnapshot(snapshot);
}

// What the imports so far remembered, all of it still in the project.
function stateAfterEarlierImports(world: ApplierWorld): ToolImportProjectState {
  return projectState({
    previousRecords: world.records.map(
      (record: ToolImportRecord): ToolImportPreviousRecord => {
        return {
          kind: record.kind!,
          sourceId: record.sourceId!,
          recordId: record.recordId!.toString(),
          isComplete: record.isComplete !== false,
          stillExists: true,
        };
      },
    ),
  });
}

/*
 * One more import into the project earlier imports left, as a run makes
 * it: the subscribers they brought over are read from what they
 * remembered, the tool is read past them, and the plan is worked out
 * against the project as they left it.
 */
async function readAndImport(data: {
  world: ApplierWorld;
  adapter: ToolImportAdapter;
  settings: ToolImportReadSettings;
  api: FixtureApi;
}): Promise<Flow> {
  const importedSubscriberIds: Set<string> =
    await ToolImportProjectStateReader.readImportedSubscriberIds({
      projectId: PROJECT_ID,
      source: data.settings.source,
    });
  const sleep: RecordingSleep = new RecordingSleep({ now: NOW });

  const snapshot: ToolImportSnapshot = await data.adapter.read(data.settings, {
    transport: data.api.transport,
    sleep: sleep.sleep,
    now: (): number => {
      return sleep.clock.now;
    },
    maxRequests: 500,
    deadlineAt: NOW + 15 * 60 * 1000,
    importedSubscriberIds: importedSubscriberIds,
  });

  const plan: ToolImportPlan = buildToolImportPlan({
    snapshot: snapshot,
    state: stateAfterEarlierImports(data.world),
    access: fullAccess(),
  });

  const report: ToolImportReport = await ToolImportApplier.apply({
    runId: ObjectID.generate(),
    projectId: PROJECT_ID,
    source: snapshot.source,
    snapshot: snapshot,
    plan: plan,
    selection: everythingTicked(plan),
    props: PROPS,
    isLimitedToOneLevelPerPolicy: false,
    now: new Date(NOW),
    onProgress: async (): Promise<void> => {},
  });

  return { snapshot, plan, report, world: data.world };
}

// The addresses of the subscribers the imports made, in the order they were made.
function subscriberEmails(world: ApplierWorld): Array<string> {
  return world
    .dataOf<StatusPageSubscriber>("StatusPageSubscriber")
    .map((subscriber: StatusPageSubscriber): string => {
      return subscriber.subscriberEmail!.toString();
    });
}

function reportOf(
  report: ToolImportReport,
  kind: ToolImportResourceKind,
  sourceId: string,
): ToolImportReportItem {
  const key: string = getToolImportItemKey(kind, sourceId);
  const item: ToolImportReportItem | undefined = report.items.find(
    (candidate: ToolImportReportItem): boolean => {
      return candidate.key === key;
    },
  );

  if (!item) {
    throw new Error(`No report item ${key}`);
  }

  return item;
}

function outcomes(report: ToolImportReport): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const item of report.items) {
    counts[item.outcome] = (counts[item.outcome] || 0) + 1;
  }

  return counts;
}

// What every flow holds to: nothing ticked fails, everything is made as the person.
function expectCleanImport(flow: Flow): void {
  const failed: Array<ToolImportReportItem> = flow.report.items.filter(
    (item: ToolImportReportItem): boolean => {
      return item.outcome === ToolImportOutcome.Failed;
    },
  );

  expect(failed).toEqual([]);

  for (const create of flow.world.creates) {
    expect(create.props).toBe(PROPS);
  }

  // Every item the preview offered was imported, one for one.
  const created: number = flow.plan.items.filter(
    (item: ToolImportPlanItem): boolean => {
      return item.action === ToolImportAction.Create;
    },
  ).length;

  expect(outcomes(flow.report)[ToolImportOutcome.Created] || 0).toBe(created);
}

function monitorTypes(world: ApplierWorld): Array<MonitorType | undefined> {
  return world.dataOf<Monitor>("Monitor").map((monitor: Monitor) => {
    return monitor.monitorType;
  });
}

// Every step of a monitor the import made passes the check the API runs on one a person saves.
function expectValidSteps(world: ApplierWorld): void {
  for (const monitor of world.dataOf<Monitor>("Monitor")) {
    if (!monitor.monitorSteps) {
      continue;
    }

    expect(
      MonitorSteps.getValidationError(
        monitor.monitorSteps,
        monitor.monitorType!,
      ),
    ).toBeNull();
  }
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an UptimeRobot account, imported", () => {
  async function flow(): Promise<Flow> {
    return await importAll({
      adapter: new UptimeRobotAdapter(),
      settings: {
        source: ToolImportSource.UptimeRobot,
        region: "",
        apiKey: UptimeRobot.UPTIMEROBOT_KEY,
      },
      api: UptimeRobot.uptimeRobotApi(),
    });
  }

  test("every monitor OneUptime can check is made, valid, of the right type; the two it cannot are named", async () => {
    const result: Flow = await flow();

    expectCleanImport(result);
    expectValidSteps(result.world);
    expect(monitorTypes(result.world)).toEqual([
      MonitorType.Website,
      MonitorType.Website,
      MonitorType.API,
      MonitorType.Ping,
      MonitorType.Port,
      MonitorType.IncomingRequest,
      MonitorType.DNS,
      MonitorType.API,
      MonitorType.Website,
      MonitorType.SSLCertificate,
    ]);
    expect(
      reportOf(
        result.report,
        ToolImportResourceKind.Monitor,
        String(UptimeRobot.OPEN_PORT_ID),
      ).reason,
    ).toEqual(makeToolImportNote(ToolImportNoteCode.MonitorUpsideDown));
    expect(
      reportOf(
        result.report,
        ToolImportResourceKind.Monitor,
        String(UptimeRobot.SYSLOG_ID),
      ).outcome,
    ).toBe(ToolImportOutcome.Skipped);
  });

  test("its three pages are made; the page of every monitor names the two that did not come over", async () => {
    const result: Flow = await flow();

    expect(
      result.world.dataOf<StatusPage>("StatusPage").map((page: StatusPage) => {
        return [page.name, page.isPublicStatusPage];
      }),
    ).toEqual([
      ["Public status", true],
      ["Internal", false],
      ["Everything", true],
    ]);
    expect(
      reportOf(
        result.report,
        ToolImportResourceKind.StatusPage,
        String(UptimeRobot.EVERYTHING_PAGE_ID),
      ).notes,
    ).toEqual([
      makeToolImportNote(ToolImportNoteCode.StatusPageMonitorLeftOut, {
        name: "Telnet must stay shut",
      }),
      makeToolImportNote(ToolImportNoteCode.StatusPageMonitorLeftOut, {
        name: "Syslog",
      }),
    ]);
    // Two on the public page, one on the internal one, nine on the last.
    expect(result.world.createsOf("StatusPageResource")).toHaveLength(12);
  });
});

describe("a Pingdom account, imported", () => {
  test("its checks become monitors of the right type; UDP, custom HTTP and transactions are named", async () => {
    const result: Flow = await importAll({
      adapter: new PingdomAdapter(),
      settings: {
        source: ToolImportSource.Pingdom,
        region: "",
        apiKey: Pingdom.PINGDOM_TOKEN,
      },
      api: Pingdom.pingdomApi(),
    });

    expectCleanImport(result);
    expectValidSteps(result.world);
    expect(monitorTypes(result.world)).toEqual([
      MonitorType.Website,
      MonitorType.API,
      MonitorType.API,
      MonitorType.Port,
      MonitorType.Port,
      MonitorType.Port,
      MonitorType.Port,
      MonitorType.Ping,
      MonitorType.DNS,
      MonitorType.Website,
      MonitorType.SSLCertificate,
    ]);
    expect(outcomes(result.report)[ToolImportOutcome.Skipped]).toBe(3);
  });
});

describe("a Better Stack team, imported", () => {
  async function flow(): Promise<Flow> {
    return await importAll({
      adapter: new BetterStackAdapter(),
      settings: {
        source: ToolImportSource.BetterStack,
        region: "",
        apiKey: BetterStack.BETTER_STACK_TOKEN,
      },
      api: BetterStack.betterStackApi(),
    });
  }

  test("monitors, heartbeats and the item tracked by hand are made; UDP and Playwright are named", async () => {
    const result: Flow = await flow();

    expectCleanImport(result);
    expectValidSteps(result.world);
    expect(monitorTypes(result.world)).toEqual([
      MonitorType.Website,
      MonitorType.Website,
      MonitorType.Website,
      MonitorType.API,
      MonitorType.Ping,
      MonitorType.Port,
      MonitorType.Port,
      MonitorType.DNS,
      MonitorType.IncomingRequest,
      MonitorType.IncomingRequest,
      MonitorType.Manual,
      MonitorType.SSLCertificate,
    ]);
  });

  test("the public page's sections are its groups, each resource in its own, the manual item shown", async () => {
    const result: Flow = await flow();

    expect(
      result.world
        .dataOf<StatusPageGroup>("StatusPageGroup")
        .map((group: StatusPageGroup) => {
          return group.name;
        }),
    ).toEqual(["API", "Website"]);
    expect(
      result.world
        .dataOf<StatusPageResource>("StatusPageResource")
        .map((resource: StatusPageResource) => {
          return resource.displayName;
        }),
    ).toEqual(["Orders", "Home page", "Sync", "Support desk", "Database"]);
  });

  test("the two confirmed subscribers come over; the one who never confirmed does not", async () => {
    const result: Flow = await flow();

    expect(
      result.world
        .dataOf<StatusPageSubscriber>("StatusPageSubscriber")
        .map((subscriber: StatusPageSubscriber) => {
          return [
            subscriber.subscriberEmail?.toString(),
            subscriber.isSubscribedToAllResources,
            (subscriber.statusPageResources || []).length,
          ];
        }),
    ).toEqual([
      ["ann@example.com", true, 0],
      ["carol@example.com", false, 2],
    ]);
    expect(
      reportOf(result.report, ToolImportResourceKind.StatusPageSubscriber, "72")
        .reason,
    ).toEqual(makeToolImportNote(ToolImportNoteCode.SubscriberNotConfirmed));
  });
});

describe("a Better Stack page with more subscribers than one import brings over", () => {
  // More confirmed email subscribers on the public page than one import reads.
  const REST: number = 250;
  const TOTAL: number = TOOL_IMPORT_MAX_RECORDS_PER_KIND + REST;

  // One more import of the team, read past what came over before.
  async function importAgain(world: ApplierWorld): Promise<Flow> {
    return await readAndImport({
      world: world,
      adapter: new BetterStackAdapter(),
      settings: {
        source: ToolImportSource.BetterStack,
        region: "",
        apiKey: BetterStack.BETTER_STACK_TOKEN,
      },
      api: BetterStack.betterStackApi().add({
        path: `/api/v2/status-pages/${BetterStack.PUBLIC_PAGE_ID}/subscribers`,
        answers: [
          BetterStack.betterStackPaged(
            BetterStack.betterStackSubscribers(TOTAL, 0),
          ),
        ],
      }),
    });
  }

  function emailsOf(from: number, count: number): Array<string> {
    return BetterStack.betterStackSubscribers(count, from).map(
      (subscriber: Record<string, unknown>): string => {
        return (subscriber["attributes"] as Record<string, unknown>)[
          "email"
        ] as string;
      },
    );
  }

  test("the first import brings over the first 5,000; running it again brings over the rest, and nobody comes twice", async () => {
    const world: ApplierWorld = new ApplierWorld().withMonitoring();

    const first: Flow = await importAgain(world);

    expectCleanImport(first);
    expect(first.snapshot.notes).toEqual([
      makeToolImportNote(ToolImportNoteCode.ReadLimitReached, {
        kind: ToolImportResourceKind.StatusPageSubscriber,
        limit: TOOL_IMPORT_MAX_RECORDS_PER_KIND,
      }),
    ]);
    expect(subscriberEmails(world)).toEqual(
      emailsOf(0, TOOL_IMPORT_MAX_RECORDS_PER_KIND),
    );

    const second: Flow = await importAgain(world);

    // Read past the 5,000 that came over: the rest, and none left unread.
    expectCleanImport(second);
    expect(second.snapshot.statusPageSubscribers).toHaveLength(REST);
    expect(second.snapshot.notes).toEqual([]);
    /*
     * The monitors and the pages came over the first time; the UDP and
     * Playwright monitors are named as left out again.
     */
    expect(outcomes(second.report)).toEqual({
      [ToolImportOutcome.AlreadyImported]: 14,
      [ToolImportOutcome.Skipped]: 2,
      [ToolImportOutcome.Created]: REST,
    });
    expect(subscriberEmails(world)).toEqual(emailsOf(0, TOTAL));

    // Nobody is left to bring over.
    const third: Flow = await importAgain(world);

    expect(third.snapshot.statusPageSubscribers).toEqual([]);
    expect(outcomes(third.report)).toEqual({
      [ToolImportOutcome.AlreadyImported]: 14,
      [ToolImportOutcome.Skipped]: 2,
    });
    expect(subscriberEmails(world)).toHaveLength(TOTAL);
  }, 120000);
});

describe("a StatusCake account, imported", () => {
  test("uptime, SSL and heartbeat checks become monitors of the right type; an unknown test type is named", async () => {
    const result: Flow = await importAll({
      adapter: new StatusCakeAdapter(),
      settings: {
        source: ToolImportSource.StatusCake,
        region: "",
        apiKey: StatusCake.STATUSCAKE_KEY,
      },
      api: StatusCake.statusCakeApi(),
    });

    expectCleanImport(result);
    expectValidSteps(result.world);
    expect(monitorTypes(result.world)).toEqual([
      MonitorType.Website,
      MonitorType.API,
      MonitorType.Website,
      MonitorType.Website,
      MonitorType.Ping,
      MonitorType.Port,
      MonitorType.Port,
      MonitorType.Port,
      MonitorType.DNS,
      MonitorType.IncomingRequest,
      MonitorType.SSLCertificate,
      MonitorType.SSLCertificate,
      MonitorType.SSLCertificate,
    ]);
    expect(
      reportOf(
        result.report,
        ToolImportResourceKind.Monitor,
        `uptime-${StatusCake.PUSH_ID}`,
      ).outcome,
    ).toBe(ToolImportOutcome.Skipped);
  });
});

describe("an Atlassian Statuspage organization, imported", () => {
  test("components become manual monitors on the pages they were on, in their groups; subscribers follow the same components", async () => {
    const result: Flow = await importAll({
      adapter: new AtlassianStatuspageAdapter(),
      settings: {
        source: ToolImportSource.AtlassianStatuspage,
        region: "",
        apiKey: Statuspage.STATUSPAGE_KEY,
      },
      api: Statuspage.statuspageApi(),
    });

    expectCleanImport(result);
    expect(monitorTypes(result.world)).toEqual([
      MonitorType.Manual,
      MonitorType.Manual,
      MonitorType.Manual,
      MonitorType.Manual,
    ]);
    expect(
      result.world.dataOf<StatusPage>("StatusPage").map((page: StatusPage) => {
        return [page.name, page.isPublicStatusPage, page.pageDescription];
      }),
    ).toEqual([
      ["Acme", true, "Live status of Acme"],
      ["Internal", false, undefined],
    ]);

    const group: StatusPageGroup =
      result.world.dataOf<StatusPageGroup>("StatusPageGroup")[0]!;

    expect(
      result.world
        .dataOf<StatusPageResource>("StatusPageResource")
        .map((resource: StatusPageResource) => {
          return [
            resource.displayName,
            resource.statusPageGroupId?.toString() === group.id!.toString(),
          ];
        }),
    ).toEqual([
      ["Email delivery", false],
      ["Web app", true],
      ["API", true],
      ["Database", false],
    ]);

    const subscribers: Array<StatusPageSubscriber> =
      result.world.dataOf<StatusPageSubscriber>("StatusPageSubscriber");

    expect(
      subscribers.map((subscriber: StatusPageSubscriber) => {
        return [
          subscriber.subscriberEmail?.toString(),
          subscriber.isSubscribedToAllResources,
          (subscriber.statusPageResources || []).length,
          subscriber.isSubscriptionConfirmed,
          subscriber.sendYouHaveSubscribedMessage,
        ];
      }),
    ).toEqual([
      ["ann@example.com", true, 0, true, false],
      ["bob@example.com", false, 1, true, false],
      ["carol@example.com", false, 1, true, false],
    ]);
  });
});

describe("an Atlassian Statuspage page with more subscribers than one import brings over", () => {
  // More email subscribers on the public page than one import reads.
  const REST: number = 250;
  const TOTAL: number = TOOL_IMPORT_MAX_RECORDS_PER_KIND + REST;

  // One more import of the organization, read past what came over before.
  async function importAgain(world: ApplierWorld): Promise<Flow> {
    return await readAndImport({
      world: world,
      adapter: new AtlassianStatuspageAdapter(),
      settings: {
        source: ToolImportSource.AtlassianStatuspage,
        region: "",
        apiKey: Statuspage.STATUSPAGE_KEY,
      },
      api: Statuspage.statuspageApi().add({
        path: `/v1/pages/${Statuspage.PUBLIC_PAGE_ID}/subscribers`,
        answers: [
          Statuspage.statuspagePaged(
            Statuspage.statuspageSubscribers(TOTAL, 0),
          ),
        ],
      }),
    });
  }

  function emailsOf(from: number, count: number): Array<string> {
    return Statuspage.statuspageSubscribers(count, from).map(
      (subscriber: Record<string, unknown>): string => {
        return subscriber["email"] as string;
      },
    );
  }

  test("the first import brings over the first 5,000; running it again brings over the rest, and nobody comes twice", async () => {
    const world: ApplierWorld = new ApplierWorld().withMonitoring();

    const first: Flow = await importAgain(world);

    expectCleanImport(first);
    expect(first.snapshot.notes).toEqual([
      makeToolImportNote(ToolImportNoteCode.ReadLimitReached, {
        kind: ToolImportResourceKind.StatusPageSubscriber,
        limit: TOOL_IMPORT_MAX_RECORDS_PER_KIND,
      }),
    ]);
    expect(subscriberEmails(world)).toEqual(
      emailsOf(0, TOOL_IMPORT_MAX_RECORDS_PER_KIND),
    );

    const second: Flow = await importAgain(world);

    // Read past the 5,000 that came over: the rest, and none left unread.
    expectCleanImport(second);
    expect(second.snapshot.statusPageSubscribers).toHaveLength(REST);
    expect(second.snapshot.notes).toEqual([]);
    // The pages and their components came over the first time.
    expect(outcomes(second.report)).toEqual({
      [ToolImportOutcome.AlreadyImported]: 6,
      [ToolImportOutcome.Created]: REST,
    });
    expect(subscriberEmails(world)).toEqual(emailsOf(0, TOTAL));

    // Nobody is left to bring over.
    const third: Flow = await importAgain(world);

    expect(third.snapshot.statusPageSubscribers).toEqual([]);
    expect(outcomes(third.report)).toEqual({
      [ToolImportOutcome.AlreadyImported]: 6,
    });
    expect(subscriberEmails(world)).toHaveLength(TOTAL);
  }, 120000);
});

describe("an Uptime Kuma backup, imported", () => {
  test("its monitors are made, valid, without a password or token anywhere in what was made", async () => {
    const snapshot: ToolImportSnapshot = new UptimeKumaAdapter().readFile({
      content: Kuma.kumaBackupText(),
      fileName: "backup.json",
      now: new Date(NOW),
    });

    const result: Flow = await importSnapshot(snapshot);

    expectCleanImport(result);
    expectValidSteps(result.world);
    expect(monitorTypes(result.world)).toEqual([
      MonitorType.Website,
      MonitorType.API,
      MonitorType.Website,
      MonitorType.Website,
      MonitorType.API,
      MonitorType.Port,
      MonitorType.Ping,
      MonitorType.DNS,
      MonitorType.IncomingRequest,
      MonitorType.Manual,
      MonitorType.Ping,
      MonitorType.Website,
      MonitorType.SSLCertificate,
    ]);

    const made: string = JSON.stringify(
      result.world.creates.map((create: RecordedCreate) => {
        return create.data;
      }),
    );

    for (const secret of Kuma.KUMA_SECRETS) {
      expect(made).not.toContain(secret);
    }
  });
});
