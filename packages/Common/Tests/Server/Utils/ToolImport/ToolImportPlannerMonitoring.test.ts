import { describe, expect, test } from "@jest/globals";
import {
  buildToolImportPlan,
  ToolImportAccess,
  ToolImportExistingMonitor,
  ToolImportProjectState,
} from "../../../../Server/Utils/ToolImport/ToolImportPlanner";
import DnsRecordType from "../../../../Types/Monitor/DnsMonitor/DnsRecordType";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import {
  TOOL_IMPORT_MAX_ITEMS,
  TOOL_IMPORT_MAX_ITEMS_PER_KIND,
} from "../../../../Types/ToolImport/ToolImportLimits";
import { getToolImportMonitorMatchKey } from "../../../../Types/ToolImport/ToolImportMonitorBuilder";
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
import {
  ImportedMonitor,
  ImportedStatusPage,
  ImportedStatusPageSubscriber,
  ToolImportSnapshot,
} from "../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../Types/ToolImport/ToolImportSource";
import {
  fullAccess,
  projectState,
  snapshot,
} from "./ToolImportSnapshotFixtures";

/*
 * The planner, for what uptime and status page tools bring: which monitors
 * come over, which are the project's own already, which OneUptime cannot
 * check and why; what the plan's room and the person's permissions allow;
 * status pages with the monitors they show; and subscribers, offered
 * unticked, following the page that comes over.
 */

function monitor(
  sourceId: string,
  overrides: Partial<ImportedMonitor> = {},
): ImportedMonitor {
  return {
    sourceId: sourceId,
    name: `Site ${sourceId}`,
    sourceType: "http",
    monitorType: MonitorType.Website,
    destination: `https://site-${sourceId}.example.com`,
    intervalSeconds: 300,
    isPaused: false,
    notes: [],
    ...overrides,
  };
}

function statusPage(
  sourceId: string,
  monitorSourceIds: Array<string>,
  overrides: Partial<ImportedStatusPage> = {},
): ImportedStatusPage {
  return {
    sourceId: sourceId,
    name: `Page ${sourceId}`,
    isPublic: true,
    groups: [],
    resources: monitorSourceIds.map((monitorSourceId: string) => {
      return {
        key: monitorSourceId,
        monitorSourceId: monitorSourceId,
        displayName: `Site ${monitorSourceId}`,
        showUptimePercent: true,
        showStatusHistoryChart: true,
      };
    }),
    notes: [],
    ...overrides,
  };
}

function subscriber(
  sourceId: string,
  statusPageSourceId: string,
  overrides: Partial<ImportedStatusPageSubscriber> = {},
): ImportedStatusPageSubscriber {
  return {
    sourceId: sourceId,
    email: `${sourceId}@example.com`,
    statusPageSourceId: statusPageSourceId,
    resourceKeys: [],
    notes: [],
    ...overrides,
  };
}

function plan(
  data: Partial<ToolImportSnapshot>,
  state: ToolImportProjectState = projectState(),
  access: ToolImportAccess = fullAccess(),
): ToolImportPlan {
  return buildToolImportPlan({
    snapshot: snapshot({ source: ToolImportSource.UptimeRobot, ...data }),
    state: state,
    access: access,
  });
}

function item(
  result: ToolImportPlan,
  kind: ToolImportResourceKind,
  sourceId: string,
): ToolImportPlanItem {
  const key: string = getToolImportItemKey(kind, sourceId);
  const found: ToolImportPlanItem | undefined = result.items.find(
    (candidate: ToolImportPlanItem): boolean => {
      return candidate.key === key;
    },
  );

  if (!found) {
    throw new Error(`No item ${key} in the plan.`);
  }

  return found;
}

function monitorItem(
  result: ToolImportPlan,
  sourceId: string,
): ToolImportPlanItem {
  return item(result, ToolImportResourceKind.Monitor, sourceId);
}

function existingMonitor(
  id: string,
  data: Partial<ImportedMonitor> & { name: string },
): ToolImportExistingMonitor {
  const type: MonitorType = data.monitorType || MonitorType.Website;

  return {
    id: id,
    name: data.name,
    monitorType: type,
    addressKey: getToolImportMonitorMatchKey({
      monitorType: type,
      destination: data.destination,
      port: data.port,
      dnsRecordType: data.dnsRecordType,
    }),
  };
}

function withPlanRoom(
  kind: ToolImportResourceKind,
  room: number,
  limit: number,
  overrides: Partial<ToolImportAccess> = {},
): ToolImportAccess {
  return fullAccess({
    planRoomByKind: new Map([[kind, { room: room, limit: limit }]]),
    ...overrides,
  });
}

describe("ToolImportPlanner: monitors", () => {
  test("a monitor OneUptime checks the same way is created, ticked, saying what it becomes, what it checks and how often", () => {
    const result: ToolImportPlan = plan({
      monitors: [
        monitor("1"),
        // Every three minutes: OneUptime's closest is every two.
        monitor("2", { intervalSeconds: 180 }),
        monitor("3", {
          monitorType: MonitorType.IncomingRequest,
          destination: undefined,
          intervalSeconds: 86400,
        }),
        monitor("4", {
          monitorType: MonitorType.Manual,
          destination: undefined,
          intervalSeconds: undefined,
        }),
      ],
    });

    expect(monitorItem(result, "1")).toEqual({
      key: getToolImportItemKey(ToolImportResourceKind.Monitor, "1"),
      kind: ToolImportResourceKind.Monitor,
      sourceId: "1",
      name: "Site 1",
      action: ToolImportAction.Create,
      notes: [],
      isSelectable: true,
      isSelectedByDefault: true,
      summary: {
        monitorType: MonitorType.Website,
        destination: "https://site-1.example.com",
        intervalSeconds: 300,
      },
      references: [],
    });
    expect(monitorItem(result, "2").summary.intervalSeconds).toBe(120);
    // Heartbeats and manual monitors are not checked on an interval.
    expect(monitorItem(result, "3").summary).toEqual({
      monitorType: MonitorType.IncomingRequest,
    });
    expect(monitorItem(result, "4")).toMatchObject({
      action: ToolImportAction.Create,
      summary: { monitorType: MonitorType.Manual },
    });
  });

  test("a monitor paused in the tool is offered unticked", () => {
    expect(
      monitorItem(plan({ monitors: [monitor("1", { isPaused: true })] }), "1"),
    ).toMatchObject({
      action: ToolImportAction.Create,
      isSelectable: true,
      isSelectedByDefault: false,
    });
  });

  test("a check OneUptime has no monitor for is named, with the tool's own word for it, never dropped", () => {
    const result: ToolImportPlan = plan({
      monitors: [
        monitor("1", { monitorType: null, sourceType: "UDP" }),
        monitor("2", {
          monitorType: null,
          sourceType: "port",
          skipReason: makeToolImportNote(ToolImportNoteCode.MonitorUpsideDown),
        }),
        // A type the import does not create.
        monitor("3", { monitorType: MonitorType.Kubernetes }),
      ],
    });

    expect(monitorItem(result, "1")).toMatchObject({
      action: ToolImportAction.Skip,
      isSelectable: false,
      reason: makeToolImportNote(ToolImportNoteCode.MonitorTypeNotSupported, {
        type: "UDP",
      }),
    });
    expect(monitorItem(result, "2").reason).toEqual(
      makeToolImportNote(ToolImportNoteCode.MonitorUpsideDown),
    );
    expect(monitorItem(result, "3").reason?.code).toBe(
      ToolImportNoteCode.MonitorTypeNotSupported,
    );
    expect(result.items).toHaveLength(3);
  });

  test("an address OneUptime cannot check is named, in the tool's words", () => {
    const result: ToolImportPlan = plan({
      monitors: [
        monitor("1", { destination: "ftp://files.example.com" }),
        monitor("2", { destination: "" }),
        monitor("3", {
          monitorType: MonitorType.Port,
          destination: "db.example.com",
          port: undefined,
        }),
        monitor("4", {
          monitorType: MonitorType.Port,
          destination: "db.example.com",
          port: 70000,
        }),
        monitor("5", {
          monitorType: MonitorType.DNS,
          destination: "not a name!",
        }),
        monitor("6", {
          monitorType: MonitorType.Ping,
          destination: "10.0.0.1",
        }),
      ],
    });

    expect(monitorItem(result, "1").reason).toEqual(
      makeToolImportNote(ToolImportNoteCode.MonitorAddressUnreadable, {
        address: "ftp://files.example.com",
      }),
    );

    for (const sourceId of ["2", "3", "4", "5"]) {
      expect(monitorItem(result, sourceId)).toMatchObject({
        action: ToolImportAction.Skip,
        reason: { code: ToolImportNoteCode.MonitorAddressUnreadable },
      });
    }

    expect(monitorItem(result, "6").action).toBe(ToolImportAction.Create);
  });

  test("the project's own monitor is used when its type, name and address all match", () => {
    const state: ToolImportProjectState = projectState({
      existingMonitors: [
        existingMonitor("m-home", {
          name: "Home page",
          destination: "https://EXAMPLE.com",
        }),
        existingMonitor("m-db", {
          name: "Database",
          monitorType: MonitorType.Port,
          destination: "db.example.com",
          port: 5432,
        }),
        existingMonitor("m-mx", {
          name: "Mail",
          monitorType: MonitorType.DNS,
          destination: "example.com",
          dnsRecordType: DnsRecordType.MX,
        }),
      ],
    });

    const result: ToolImportPlan = plan(
      {
        monitors: [
          // Matched: case and a trailing slash aside, the same check.
          monitor("1", {
            name: " home  PAGE ",
            destination: "https://example.com/",
          }),
          // Same name, another site: a monitor of its own.
          monitor("2", {
            name: "Home page",
            destination: "https://example.org",
          }),
          // Same site, another type: a monitor of its own.
          monitor("3", {
            name: "Home page",
            monitorType: MonitorType.API,
            destination: "https://example.com",
          }),
          // Same site and type, another name: a monitor of its own.
          monitor("4", {
            name: "Front page",
            destination: "https://example.com",
          }),
          monitor("5", {
            name: "Database",
            monitorType: MonitorType.Port,
            destination: "DB.example.com",
            port: 5432,
          }),
          // Another port: a monitor of its own.
          monitor("6", {
            name: "Database",
            monitorType: MonitorType.Port,
            destination: "db.example.com",
            port: 5433,
          }),
          monitor("7", {
            name: "Mail",
            monitorType: MonitorType.DNS,
            destination: "example.com.",
            dnsRecordType: DnsRecordType.MX,
          }),
          // Another record type: a monitor of its own.
          monitor("8", {
            name: "Mail",
            monitorType: MonitorType.DNS,
            destination: "example.com",
            dnsRecordType: DnsRecordType.TXT,
          }),
        ],
      },
      state,
    );

    expect(monitorItem(result, "1")).toMatchObject({
      action: ToolImportAction.Match,
      existingRecordId: "m-home",
      isSelectable: false,
      reason: makeToolImportNote(ToolImportNoteCode.MonitorAlreadyChecked, {
        name: "Home page",
      }),
    });
    expect(monitorItem(result, "5").existingRecordId).toBe("m-db");
    expect(monitorItem(result, "7").existingRecordId).toBe("m-mx");

    for (const sourceId of ["2", "3", "4", "6", "8"]) {
      expect(monitorItem(result, sourceId).action).toBe(
        ToolImportAction.Create,
      );
    }
  });

  test("a monitor an earlier import brought over is left alone; one deleted since is made again, with a note", () => {
    const result: ToolImportPlan = plan(
      { monitors: [monitor("1"), monitor("2")] },
      projectState({
        previousRecords: [
          {
            kind: ToolImportResourceKind.Monitor,
            sourceId: "1",
            recordId: "m-1",
            isComplete: true,
            stillExists: true,
          },
          {
            kind: ToolImportResourceKind.Monitor,
            sourceId: "2",
            recordId: "m-2",
            isComplete: true,
            stillExists: false,
          },
        ],
      }),
    );

    expect(monitorItem(result, "1")).toMatchObject({
      action: ToolImportAction.AlreadyImported,
      existingRecordId: "m-1",
      reason: makeToolImportNote(ToolImportNoteCode.AlreadyImported),
    });
    expect(monitorItem(result, "2")).toMatchObject({
      action: ToolImportAction.Create,
      notes: [
        makeToolImportNote(ToolImportNoteCode.ImportedBeforeDeletedSince),
      ],
    });
  });

  test("a person who may not create monitors sees why, on every monitor", () => {
    const refusals: ToolImportAccess = fullAccess();
    refusals.createRefusals.set(
      ToolImportResourceKind.Monitor,
      makeToolImportNote(ToolImportNoteCode.NoPermission),
    );

    const result: ToolImportPlan = plan(
      {
        monitors: [
          monitor("1"),
          monitor("2", {
            monitorType: MonitorType.Manual,
            destination: undefined,
          }),
        ],
      },
      projectState(),
      refusals,
    );

    for (const sourceId of ["1", "2"]) {
      expect(monitorItem(result, sourceId)).toMatchObject({
        action: ToolImportAction.Skip,
        reason: makeToolImportNote(ToolImportNoteCode.NoPermission),
      });
    }
  });

  test("without a payment method, monitors that are checked are refused up front; manual monitors still come", () => {
    const result: ToolImportPlan = plan(
      {
        monitors: [
          monitor("1"),
          monitor("2", {
            monitorType: MonitorType.IncomingRequest,
            destination: undefined,
          }),
          monitor("3", {
            monitorType: MonitorType.Manual,
            destination: undefined,
          }),
        ],
      },
      projectState(),
      fullAccess({
        checkedMonitorRefusal: makeToolImportNote(
          ToolImportNoteCode.MonitorNeedsPaymentMethod,
        ),
      }),
    );

    for (const sourceId of ["1", "2"]) {
      expect(monitorItem(result, sourceId).reason).toEqual(
        makeToolImportNote(ToolImportNoteCode.MonitorNeedsPaymentMethod),
      );
    }

    expect(monitorItem(result, "3").action).toBe(ToolImportAction.Create);
  });

  test("the plan's room counts monitors that are checked; manual monitors are free", () => {
    const result: ToolImportPlan = plan(
      {
        monitors: [
          monitor("1"),
          monitor("2", {
            monitorType: MonitorType.Manual,
            destination: undefined,
          }),
          monitor("3"),
          monitor("4"),
          monitor("5", {
            monitorType: MonitorType.Manual,
            destination: undefined,
          }),
        ],
      },
      projectState(),
      withPlanRoom(ToolImportResourceKind.Monitor, 2, 5),
    );

    expect(
      result.items.map((planned: ToolImportPlanItem) => {
        return [planned.sourceId, planned.action];
      }),
    ).toEqual([
      ["1", ToolImportAction.Create],
      ["2", ToolImportAction.Create],
      ["3", ToolImportAction.Create],
      ["4", ToolImportAction.Skip],
      ["5", ToolImportAction.Create],
    ]);
    expect(monitorItem(result, "4").reason).toEqual(
      makeToolImportNote(ToolImportNoteCode.MonitorPlanLimit, { limit: 5 }),
    );
  });

  test("a paused monitor never takes the plan's last room from one that is on; the preview keeps the tool's order", () => {
    const result: ToolImportPlan = plan(
      {
        monitors: [
          monitor("1", { isPaused: true }),
          monitor("2"),
          monitor("3", { isPaused: true }),
          monitor("4"),
        ],
      },
      projectState(),
      withPlanRoom(ToolImportResourceKind.Monitor, 2, 10),
    );

    expect(
      result.items.map((planned: ToolImportPlanItem) => {
        return [planned.sourceId, planned.action];
      }),
    ).toEqual([
      ["1", ToolImportAction.Skip],
      ["2", ToolImportAction.Create],
      ["3", ToolImportAction.Skip],
      ["4", ToolImportAction.Create],
    ]);
  });

  test("a matched or earlier-imported monitor takes none of the plan's room", () => {
    const result: ToolImportPlan = plan(
      {
        monitors: [
          monitor("1", { name: "Home", destination: "https://example.com" }),
          monitor("2"),
        ],
      },
      projectState({
        existingMonitors: [
          existingMonitor("m-home", {
            name: "Home",
            destination: "https://example.com",
          }),
        ],
      }),
      withPlanRoom(ToolImportResourceKind.Monitor, 1, 3),
    );

    expect(monitorItem(result, "1").action).toBe(ToolImportAction.Match);
    expect(monitorItem(result, "2").action).toBe(ToolImportAction.Create);
  });

  test("one import creates at most so many monitors; the rest are left for the next", () => {
    const limit: number =
      TOOL_IMPORT_MAX_ITEMS_PER_KIND[ToolImportResourceKind.Monitor];
    const result: ToolImportPlan = plan({
      monitors: Array.from(
        { length: limit + 2 },
        (_value: unknown, index: number) => {
          return monitor(String(index + 1));
        },
      ),
    });

    const skipped: Array<ToolImportPlanItem> = result.items.filter(
      (planned: ToolImportPlanItem): boolean => {
        return planned.action === ToolImportAction.Skip;
      },
    );

    expect(skipped).toHaveLength(2);
    expect(skipped[0]!.reason).toEqual(
      makeToolImportNote(ToolImportNoteCode.OverLimit, { limit: limit }),
    );
    expect(limit).toBeLessThanOrEqual(TOOL_IMPORT_MAX_ITEMS);
  });
});

describe("ToolImportPlanner: status pages", () => {
  test("a status page is created, ticked, naming the monitors it shows and saying how many, in how many groups", () => {
    const result: ToolImportPlan = plan({
      monitors: [monitor("1"), monitor("2")],
      statusPages: [
        statusPage("p1", ["1", "2", "1"], {
          groups: [
            { key: "g1", name: "Website" },
            { key: "g2", name: "API" },
          ],
        }),
      ],
    });

    expect(item(result, ToolImportResourceKind.StatusPage, "p1")).toMatchObject(
      {
        action: ToolImportAction.Create,
        isSelectable: true,
        isSelectedByDefault: true,
        summary: { resourceCount: 3, groupCount: 2 },
        // Each monitor once: ticking the page ticks them too.
        references: [
          getToolImportItemKey(ToolImportResourceKind.Monitor, "1"),
          getToolImportItemKey(ToolImportResourceKind.Monitor, "2"),
        ],
      },
    );
  });

  test("a page with no groups says none", () => {
    expect(
      item(
        plan({ statusPages: [statusPage("p1", [])] }),
        ToolImportResourceKind.StatusPage,
        "p1",
      ).summary,
    ).toEqual({ resourceCount: 0 });
  });

  test("a page whose name the project already uses is that page", () => {
    const result: ToolImportPlan = plan(
      { statusPages: [statusPage("p1", [], { name: "acme STATUS" })] },
      projectState({
        existingByKind: new Map([
          [
            ToolImportResourceKind.StatusPage,
            [{ id: "sp-1", name: "Acme status" }],
          ],
        ]),
      }),
    );

    expect(item(result, ToolImportResourceKind.StatusPage, "p1")).toMatchObject(
      {
        action: ToolImportAction.Match,
        existingRecordId: "sp-1",
        reason: makeToolImportNote(ToolImportNoteCode.NameExists, {
          name: "Acme status",
        }),
      },
    );
  });

  test("a private page comes over private or not at all: on a plan without private pages it is not brought over", () => {
    const access: ToolImportAccess = fullAccess({
      privateStatusPageRefusal: makeToolImportNote(
        ToolImportNoteCode.NeedsPlan,
        { plan: "Growth" },
      ),
    });

    const result: ToolImportPlan = plan(
      {
        statusPages: [
          statusPage("public", []),
          statusPage("private", [], {
            isPublic: false,
            notes: [makeToolImportNote(ToolImportNoteCode.StatusPagePrivate)],
          }),
          // The project's own page of that name is that page, whatever its plan.
          statusPage("matched", [], { name: "Team page", isPublic: false }),
        ],
      },
      projectState({
        existingByKind: new Map([
          [
            ToolImportResourceKind.StatusPage,
            [{ id: "sp-team", name: "Team page" }],
          ],
        ]),
      }),
      access,
    );

    expect(
      item(result, ToolImportResourceKind.StatusPage, "public").action,
    ).toBe(ToolImportAction.Create);
    expect(
      item(result, ToolImportResourceKind.StatusPage, "private"),
    ).toMatchObject({
      action: ToolImportAction.Skip,
      reason: makeToolImportNote(ToolImportNoteCode.NeedsPlan, {
        plan: "Growth",
      }),
      notes: [makeToolImportNote(ToolImportNoteCode.StatusPagePrivate)],
    });
    expect(
      item(result, ToolImportResourceKind.StatusPage, "matched"),
    ).toMatchObject({
      action: ToolImportAction.Match,
      existingRecordId: "sp-team",
    });
  });

  test("a page whose visitors choose what they follow says so when the plan does not let them", () => {
    const access: ToolImportAccess = fullAccess({
      subscriberChoiceRefusal: makeToolImportNote(
        ToolImportNoteCode.NeedsPlan,
        { plan: "Scale" },
      ),
    });

    const result: ToolImportPlan = plan(
      {
        statusPages: [
          statusPage("choosing", [], {
            allowsSubscribersToChooseResources: true,
          }),
          statusPage("whole", []),
        ],
      },
      projectState(),
      access,
    );

    expect(
      item(result, ToolImportResourceKind.StatusPage, "choosing"),
    ).toMatchObject({
      action: ToolImportAction.Create,
      notes: [
        makeToolImportNote(
          ToolImportNoteCode.StatusPageSubscriberChoiceNeedsPlan,
          { plan: "Scale" },
        ),
      ],
    });
    expect(
      item(result, ToolImportResourceKind.StatusPage, "whole").notes,
    ).toEqual([]);
    // On a plan with the choice, nothing is said.
    expect(
      item(
        plan({
          statusPages: [
            statusPage("choosing", [], {
              allowsSubscribersToChooseResources: true,
            }),
          ],
        }),
        ToolImportResourceKind.StatusPage,
        "choosing",
      ).notes,
    ).toEqual([]);
  });

  test("a page whose groups the plan or the person may not make comes over without them, and says why", () => {
    const grouped: ImportedStatusPage = statusPage("grouped", ["1"], {
      groups: [{ key: "g1", name: "Website" }],
    });
    const flat: ImportedStatusPage = statusPage("flat", ["1"]);

    const onFree: ToolImportPlan = plan(
      { monitors: [monitor("1")], statusPages: [grouped, flat] },
      projectState(),
      fullAccess({
        statusPageGroupRefusal: makeToolImportNote(
          ToolImportNoteCode.NeedsPlan,
          { plan: "Growth" },
        ),
      }),
    );

    expect(
      item(onFree, ToolImportResourceKind.StatusPage, "grouped"),
    ).toMatchObject({
      action: ToolImportAction.Create,
      // No groups will be made: the summary does not count them.
      summary: { resourceCount: 1 },
      notes: [
        makeToolImportNote(ToolImportNoteCode.StatusPageGroupsNeedPlan, {
          plan: "Growth",
        }),
      ],
    });
    expect(
      item(onFree, ToolImportResourceKind.StatusPage, "grouped").summary
        .groupCount,
    ).toBeUndefined();
    // A page with no groups has nothing to say.
    expect(
      item(onFree, ToolImportResourceKind.StatusPage, "flat").notes,
    ).toEqual([]);

    const notAllowed: ToolImportPlan = plan(
      { monitors: [monitor("1")], statusPages: [grouped] },
      projectState(),
      fullAccess({
        statusPageGroupRefusal: makeToolImportNote(
          ToolImportNoteCode.NoPermission,
        ),
      }),
    );

    expect(
      item(notAllowed, ToolImportResourceKind.StatusPage, "grouped").notes,
    ).toEqual([
      makeToolImportNote(ToolImportNoteCode.StatusPageGroupsNotAllowed),
    ]);
  });

  test("the plan's room counts status pages", () => {
    const result: ToolImportPlan = plan(
      { statusPages: [statusPage("p1", []), statusPage("p2", [])] },
      projectState(),
      withPlanRoom(ToolImportResourceKind.StatusPage, 1, 1),
    );

    expect(item(result, ToolImportResourceKind.StatusPage, "p1").action).toBe(
      ToolImportAction.Create,
    );
    expect(
      item(result, ToolImportResourceKind.StatusPage, "p2").reason,
    ).toEqual(
      makeToolImportNote(ToolImportNoteCode.StatusPagePlanLimit, { limit: 1 }),
    );
  });
});

describe("ToolImportPlanner: status page subscribers", () => {
  const pages: Partial<ToolImportSnapshot> = {
    statusPages: [statusPage("p1", [])],
  };

  test("a subscriber of a page that comes over is offered unticked, naming the page", () => {
    const result: ToolImportPlan = plan({
      ...pages,
      statusPageSubscribers: [subscriber("ann", "p1")],
    });

    expect(
      item(result, ToolImportResourceKind.StatusPageSubscriber, "ann"),
    ).toEqual({
      key: getToolImportItemKey(
        ToolImportResourceKind.StatusPageSubscriber,
        "ann",
      ),
      kind: ToolImportResourceKind.StatusPageSubscriber,
      sourceId: "ann",
      name: "ann@example.com",
      action: ToolImportAction.Create,
      notes: [],
      isSelectable: true,
      // Only with the person's tick and their word.
      isSelectedByDefault: false,
      summary: { statusPageName: "Page p1" },
      references: [
        getToolImportItemKey(ToolImportResourceKind.StatusPage, "p1"),
      ],
    });
  });

  test("one who never confirmed, or whose page does not come over, is named and not offered", () => {
    const refusals: ToolImportAccess = fullAccess();
    refusals.createRefusals.set(
      ToolImportResourceKind.StatusPage,
      makeToolImportNote(ToolImportNoteCode.NoPermission),
    );

    const unconfirmed: ToolImportPlan = plan({
      ...pages,
      statusPageSubscribers: [
        subscriber("bob", "p1", {
          skipReason: makeToolImportNote(
            ToolImportNoteCode.SubscriberNotConfirmed,
          ),
        }),
        // A page the read never found.
        subscriber("carol", "missing"),
      ],
    });

    expect(
      item(unconfirmed, ToolImportResourceKind.StatusPageSubscriber, "bob")
        .reason,
    ).toEqual(makeToolImportNote(ToolImportNoteCode.SubscriberNotConfirmed));
    expect(
      item(unconfirmed, ToolImportResourceKind.StatusPageSubscriber, "carol"),
    ).toMatchObject({
      action: ToolImportAction.Skip,
      reason: makeToolImportNote(ToolImportNoteCode.SubscriberPageLeftOut),
      summary: {},
    });

    // The page itself is refused: so are its subscribers.
    const refused: ToolImportPlan = plan(
      { ...pages, statusPageSubscribers: [subscriber("dan", "p1")] },
      projectState(),
      refusals,
    );

    expect(
      item(refused, ToolImportResourceKind.StatusPageSubscriber, "dan").reason,
    ).toEqual(makeToolImportNote(ToolImportNoteCode.SubscriberPageLeftOut));
  });

  test("someone already following the project's page of that name is that subscriber", () => {
    const result: ToolImportPlan = plan(
      {
        ...pages,
        statusPageSubscribers: [
          subscriber("ann", "p1"),
          subscriber("bob", "p1"),
        ],
      },
      projectState({
        existingByKind: new Map([
          [
            ToolImportResourceKind.StatusPage,
            [{ id: "SP-1", name: "Page p1" }],
          ],
        ]),
        subscriberEmailsByStatusPageId: new Map([
          ["sp-1", new Set<string>(["ann@example.com"])],
        ]),
      }),
    );

    expect(
      item(result, ToolImportResourceKind.StatusPageSubscriber, "ann"),
    ).toMatchObject({
      action: ToolImportAction.Match,
      existingRecordId: "SP-1",
      reason: makeToolImportNote(
        ToolImportNoteCode.SubscriberAlreadySubscribed,
      ),
    });
    // Someone new to that page joins it.
    expect(
      item(result, ToolImportResourceKind.StatusPageSubscriber, "bob").action,
    ).toBe(ToolImportAction.Create);
  });

  test("the same address twice on one page comes over once; on two pages, once on each", () => {
    const result: ToolImportPlan = plan({
      statusPages: [statusPage("p1", []), statusPage("p2", [])],
      statusPageSubscribers: [
        subscriber("ann-1", "p1", { email: "ann@example.com" }),
        subscriber("ann-2", "p1", { email: "ANN@example.com" }),
        subscriber("ann-3", "p2", { email: "ann@example.com" }),
      ],
    });

    expect(
      item(result, ToolImportResourceKind.StatusPageSubscriber, "ann-1").action,
    ).toBe(ToolImportAction.Create);
    expect(
      item(result, ToolImportResourceKind.StatusPageSubscriber, "ann-2"),
    ).toMatchObject({
      action: ToolImportAction.Skip,
      reason: makeToolImportNote(
        ToolImportNoteCode.SubscriberAlreadySubscribed,
      ),
    });
    expect(
      item(result, ToolImportResourceKind.StatusPageSubscriber, "ann-3").action,
    ).toBe(ToolImportAction.Create);
  });

  test("the plan's room and the person's permissions count subscribers", () => {
    const roomed: ToolImportPlan = plan(
      {
        ...pages,
        statusPageSubscribers: [
          subscriber("ann", "p1"),
          subscriber("bob", "p1"),
        ],
      },
      projectState(),
      withPlanRoom(ToolImportResourceKind.StatusPageSubscriber, 1, 100),
    );

    expect(
      item(roomed, ToolImportResourceKind.StatusPageSubscriber, "bob").reason,
    ).toEqual(
      makeToolImportNote(ToolImportNoteCode.SubscriberPlanLimit, {
        limit: 100,
      }),
    );

    const refusals: ToolImportAccess = fullAccess();
    refusals.createRefusals.set(
      ToolImportResourceKind.StatusPageSubscriber,
      makeToolImportNote(ToolImportNoteCode.NoPermission),
    );

    expect(
      item(
        plan(
          { ...pages, statusPageSubscribers: [subscriber("ann", "p1")] },
          projectState(),
          refusals,
        ),
        ToolImportResourceKind.StatusPageSubscriber,
        "ann",
      ).reason,
    ).toEqual(makeToolImportNote(ToolImportNoteCode.NoPermission));
  });

  test("subscribers have a limit of their own, outside the import's total", () => {
    const total: number = TOOL_IMPORT_MAX_ITEMS;
    const monitors: Array<ImportedMonitor> = Array.from(
      {
        length: TOOL_IMPORT_MAX_ITEMS_PER_KIND[ToolImportResourceKind.Monitor],
      },
      (_value: unknown, index: number) => {
        return monitor(`m${index}`);
      },
    );
    const many: Array<ImportedStatusPageSubscriber> = Array.from(
      { length: total },
      (_value: unknown, index: number) => {
        return subscriber(`s${index}`, "p1");
      },
    );

    const result: ToolImportPlan = plan({
      monitors: monitors,
      ...pages,
      statusPageSubscribers: many,
    });

    expect(
      result.items.filter((planned: ToolImportPlanItem): boolean => {
        return (
          planned.kind === ToolImportResourceKind.StatusPageSubscriber &&
          planned.action === ToolImportAction.Create
        );
      }),
    ).toHaveLength(total);
  });
});
