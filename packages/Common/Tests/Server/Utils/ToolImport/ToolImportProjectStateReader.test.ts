import { afterEach, describe, expect, jest, test } from "@jest/globals";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../../Models/DatabaseModels/StatusPageSubscriber";
import ToolImportRecord from "../../../../Models/DatabaseModels/ToolImportRecord";
import IncidentRoleService from "../../../../Server/Services/IncidentRoleService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import MonitorService from "../../../../Server/Services/MonitorService";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../../Server/Services/StatusPageSubscriberService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import ToolImportRecordService from "../../../../Server/Services/ToolImportRecordService";
import {
  buildToolImportPlan,
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
import ToolImportSource from "../../../../Types/ToolImport/ToolImportSource";
import {
  idsNamedBy,
  readAsTheDatabaseWould,
  TableRead,
} from "./ToolImportApplierWorld";
import { fullAccess, snapshot } from "./ToolImportSnapshotFixtures";

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
 *    already follows a page is that subscriber, after any number of imports.
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

  interface StatuspageProject {
    // What the imports remembered, oldest first.
    records: Array<ToolImportRecord>;
    // The page's subscribers, oldest first.
    subscribers: Array<StatusPageSubscriber>;
    // The imported subscriber deleted in OneUptime since.
    deletedSourceId: string;
  }

  function rememberedRecord(
    kind: ToolImportResourceKind,
    sourceId: string,
    recordId: ObjectID,
  ): ToolImportRecord {
    const record: ToolImportRecord = new ToolImportRecord();
    record.id = ObjectID.generate();
    record.projectId = PROJECT_ID;
    record.source = ToolImportSource.AtlassianStatuspage;
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

  interface ProjectReads {
    records: Array<TableRead>;
    subscribers: Array<TableRead>;
  }

  /*
   * The project as its services answer: the records and the subscribers as
   * the database reads them (readAsTheDatabaseWould: a read that stops at
   * its limit misses the oldest), and the page and the component renamed
   * in OneUptime since the import, so neither has the tool's name.
   */
  function serveProject(project: StatuspageProject): ProjectReads {
    const reads: ProjectReads = { records: [], subscribers: [] };

    jest.spyOn(ToolImportRecordService, "findBy").mockImplementation((async (
      args: TableRead,
    ): Promise<Array<ToolImportRecord>> => {
      reads.records.push(args);
      return readAsTheDatabaseWould(project.records, args);
    }) as never);

    jest
      .spyOn(StatusPageSubscriberService, "findBy")
      .mockImplementation((async (
        args: TableRead,
      ): Promise<Array<StatusPageSubscriber>> => {
        reads.subscribers.push(args);
        return readAsTheDatabaseWould(project.subscribers, args);
      }) as never);

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

    for (const service of [
      TeamMemberService,
      IncidentStateService,
      IncidentRoleService,
    ]) {
      jest
        .spyOn(service as unknown as { findBy: () => Promise<[]> }, "findBy")
        .mockImplementation(async (): Promise<[]> => {
          return [];
        });
    }

    return reads;
  }

  async function readStatuspageState(): Promise<ToolImportProjectState> {
    return await ToolImportProjectStateReader.readState({
      projectId: PROJECT_ID,
      source: ToolImportSource.AtlassianStatuspage,
    });
  }

  test("every record the imports remembered is read, page by page, and every one is known to be there or gone", async () => {
    const project: StatuspageProject = statuspageProject();
    const reads: ProjectReads = serveProject(project);

    expect(project.records.length).toBeGreaterThan(LIMIT_MAX);
    expect(project.subscribers.length).toBeGreaterThan(LIMIT_MAX);

    const state: ToolImportProjectState = await readStatuspageState();

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
    const pages: (list: Array<TableRead>) => Array<unknown> = (
      list: Array<TableRead>,
    ): Array<unknown> => {
      return list.map((read: TableRead): unknown => {
        return [read.skip, read.limit, read.sort];
      });
    };

    expect(pages(reads.records)).toEqual([
      [0, LIMIT_MAX, { _id: SortOrder.Ascending }],
      [LIMIT_MAX, LIMIT_MAX, { _id: SortOrder.Ascending }],
    ]);
    expect(pages(reads.subscribers)).toEqual([
      [0, LIMIT_MAX, { _id: SortOrder.Ascending }],
      [LIMIT_MAX, LIMIT_MAX, { _id: SortOrder.Ascending }],
    ]);
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
      state: await readStatuspageState(),
      access: fullAccess(),
    });

    const item: (kind: ToolImportResourceKind, id: string) => unknown = (
      kind: ToolImportResourceKind,
      id: string,
    ): unknown => {
      return plan.items.find((candidate: ToolImportPlanItem): boolean => {
        return candidate.key === getToolImportItemKey(kind, id);
      });
    };

    expect(item(ToolImportResourceKind.StatusPage, "acme")).toMatchObject({
      action: ToolImportAction.AlreadyImported,
      existingRecordId: PAGE_ID.toString(),
    });
    expect(item(ToolImportResourceKind.Monitor, "web")).toMatchObject({
      action: ToolImportAction.AlreadyImported,
      existingRecordId: MONITOR_ID.toString(),
    });
    // Not offered: subscribing Ann again would be refused.
    expect(
      item(ToolImportResourceKind.StatusPageSubscriber, "ann"),
    ).toMatchObject({
      action: ToolImportAction.Match,
      existingRecordId: PAGE_ID.toString(),
      reason: makeToolImportNote(
        ToolImportNoteCode.SubscriberAlreadySubscribed,
      ),
    });
    expect(
      item(ToolImportResourceKind.StatusPageSubscriber, "bob"),
    ).toMatchObject({ action: ToolImportAction.Create });
  });
});
