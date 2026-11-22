import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Incident from "../../../Models/DatabaseModels/Incident";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import IncidentPostmortemActionItem from "../../../Models/DatabaseModels/IncidentPostmortemActionItem";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import User from "../../../Models/DatabaseModels/User";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentPostmortemActionItemService, {
  normalizeActionItemTitle,
  readActionItemStatus,
  TRACKED_FROM_NOTE_FLAG,
  TrackedFromNote,
} from "../../../Server/Services/IncidentPostmortemActionItemService";
import IncidentService from "../../../Server/Services/IncidentService";
import MonitorService from "../../../Server/Services/MonitorService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import {
  OnCreate,
  OnDelete,
  OnFind,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Gray500, Green500 } from "../../../Types/BrandColors";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import PostmortemActionItemStatus from "../../../Types/Incident/PostmortemActionItemStatus";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * A postmortem's action items on the server (#6801):
 *
 *   - a title of a line, a status of the three, an owner and a monitor read
 *     from either spelling;
 *   - who closed one and when written by OneUptime as it is marked Done or
 *     Won't Do, and cleared when it is reopened;
 *   - the incident's feed saying what happened to each - but one line for
 *     all the items tracked from the postmortem's note at once;
 *   - a private incident's items read, changed and deleted only by whoever
 *     may see the incident;
 *   - tracking the note's items: only those not tracked yet, as the person
 *     asking, done when the note ticked them off, due on the day it gives in
 *     the reader's time zone.
 *
 * No database: the services' reads and writes are spied, the hooks are
 * called as DatabaseService calls them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ITEM_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const MONITOR_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const MAYA_ID: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-000000000001");
const ANA_ID: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-000000000002");
const NOW: Date = new Date("2026-11-15T12:00:00.000Z");

const NAMES: Record<string, string> = {
  [MAYA_ID.toString()]: "Maya",
  [ANA_ID.toString()]: "Ana",
};

type Hooks = {
  onBeforeFind: (
    findBy: FindBy<IncidentPostmortemActionItem>,
  ) => Promise<OnFind<IncidentPostmortemActionItem>>;
  onBeforeCreate: (
    createBy: CreateBy<IncidentPostmortemActionItem>,
  ) => Promise<OnCreate<IncidentPostmortemActionItem>>;
  onCreateSuccess: (
    onCreate: OnCreate<IncidentPostmortemActionItem>,
    createdItem: IncidentPostmortemActionItem,
  ) => Promise<IncidentPostmortemActionItem>;
  onBeforeUpdate: (
    updateBy: UpdateBy<IncidentPostmortemActionItem>,
  ) => Promise<OnUpdate<IncidentPostmortemActionItem>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<IncidentPostmortemActionItem>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<IncidentPostmortemActionItem>>;
  onBeforeDelete: (
    deleteBy: DeleteBy<IncidentPostmortemActionItem>,
  ) => Promise<OnDelete<IncidentPostmortemActionItem>>;
  onDeleteSuccess: (
    onDelete: OnDelete<IncidentPostmortemActionItem>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ) => Promise<OnDelete<IncidentPostmortemActionItem>>;
};

const hooks: Hooks = IncidentPostmortemActionItemService as unknown as Hooks;

// Maya, a project member working on the incident.
const MAYA: DatabaseCommonInteractionProps = {
  userId: MAYA_ID,
  tenantId: PROJECT_ID,
};

let feedItems: Array<JSONObject>;
let columnWrites: Array<{ id: string; data: JSONObject }>;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] });

  feedItems = [];
  columnWrites = [];

  // The project check of every reference is its own suite's.
  jest
    .spyOn(ProjectReferenceCheck, "validateCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectReferenceCheck, "validateUpdate")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockImplementation(async (args: unknown) => {
      feedItems.push(args as JSONObject);
    });

  jest
    .spyOn(UserService, "findOneById")
    .mockImplementation(async (args: unknown) => {
      const name: string | undefined =
        NAMES[(args as { id: ObjectID }).id.toString()];

      if (!name) {
        return null;
      }

      const user: User = new User();
      user.name = name as never;
      return user;
    });

  jest
    .spyOn(MonitorService, "findOneById")
    .mockImplementation(async (): Promise<Monitor> => {
      const monitor: Monitor = new Monitor();
      monitor.name = "Pool usage";
      return monitor;
    });

  jest
    .spyOn(
      IncidentPostmortemActionItemService as unknown as {
        updateColumnsByIdWithoutHooks: () => void;
      },
      "updateColumnsByIdWithoutHooks",
    )
    .mockImplementation((async (args: unknown) => {
      const { id, data } = args as { id: ObjectID; data: JSONObject };
      columnWrites.push({ id: id.toString(), data });
    }) as never);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function feedTexts(): Array<string> {
  return feedItems.map((item: JSONObject): string => {
    return String(item["feedInfoInMarkdown"]);
  });
}

function item(
  overrides: Partial<IncidentPostmortemActionItem> = {},
): IncidentPostmortemActionItem {
  const model: IncidentPostmortemActionItem =
    new IncidentPostmortemActionItem();
  model.projectId = PROJECT_ID;
  model.incidentId = INCIDENT_ID;
  model.title = "Alert on pool usage";
  Object.assign(model, overrides);
  return model;
}

describe("an action item's title", () => {
  test("is kept as one line, trimmed", () => {
    expect(normalizeActionItemTitle("  Alert on\n pool   usage  ")).toBe(
      "Alert on pool usage",
    );
  });

  test("is never empty, and says what to write instead", () => {
    for (const value of ["", "   ", undefined, null, 12]) {
      expect(() => {
        return normalizeActionItemTitle(value);
      }).toThrow(
        new BadDataException(
          "An action item needs a title: what the team will do. Write it in a line, and put the details in its description.",
        ),
      );
    }
  });

  test("is at most 500 characters", () => {
    expect(normalizeActionItemTitle("x".repeat(500))).toHaveLength(500);
    expect(() => {
      return normalizeActionItemTitle("x".repeat(501));
    }).toThrow(
      "An action item's title can be at most 500 characters. Keep it to a line, and put the details in its description.",
    );
  });
});

describe("an action item's status", () => {
  test("is one of the three", () => {
    expect(readActionItemStatus("Open")).toBe(PostmortemActionItemStatus.Open);
    expect(readActionItemStatus("Done")).toBe(PostmortemActionItemStatus.Done);
    expect(readActionItemStatus("WontDo")).toBe(
      PostmortemActionItemStatus.WontDo,
    );
  });

  test("anything else is refused, naming the three", () => {
    expect(() => {
      return readActionItemStatus("Closed");
    }).toThrow(
      'An action item\'s status is Open, Done or WontDo, not "Closed".',
    );
  });
});

describe("adding an action item", () => {
  function onCreate(
    data: IncidentPostmortemActionItem,
    miscDataProps?: JSONObject,
  ): OnCreate<IncidentPostmortemActionItem> {
    return {
      createBy: {
        data,
        props: MAYA,
        ...(miscDataProps ? { miscDataProps } : {}),
      },
      carryForward: null,
    };
  }

  function created(
    overrides: Partial<IncidentPostmortemActionItem> = {},
  ): IncidentPostmortemActionItem {
    return item({ _id: ITEM_ID.toString(), ...overrides });
  }

  test("its title trimmed, open by default, and refused without a title", async () => {
    const data: IncidentPostmortemActionItem = item({
      title: "  Retry with backoff ",
    });

    await hooks.onBeforeCreate({ data, props: MAYA });

    expect(data.title).toBe("Retry with backoff");
    expect(data.status).toBe(PostmortemActionItemStatus.Open);

    await expect(
      hooks.onBeforeCreate({ data: item({ title: " " }), props: MAYA }),
    ).rejects.toThrow("An action item needs a title");
  });

  test("a status it is added with is kept, and one that is none refused", async () => {
    const done: IncidentPostmortemActionItem = item({
      status: PostmortemActionItemStatus.Done,
    });

    await hooks.onBeforeCreate({ data: done, props: MAYA });
    expect(done.status).toBe(PostmortemActionItemStatus.Done);

    await expect(
      hooks.onBeforeCreate({
        data: item({ status: "Finished" as PostmortemActionItemStatus }),
        props: MAYA,
      }),
    ).rejects.toThrow('not "Finished"');
  });

  test("its owner and monitor read from either spelling", async () => {
    const data: IncidentPostmortemActionItem = item();
    const owner: User = new User();
    owner._id = ANA_ID.toString();
    data.ownerUser = owner;
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID.toString();
    data.monitor = monitor;

    await hooks.onBeforeCreate({ data, props: MAYA });

    expect(data.ownerUserId?.toString()).toBe(ANA_ID.toString());
    expect(data.monitorId?.toString()).toBe(MONITOR_ID.toString());
  });

  test("on the incident's feed, with its owner, as a postmortem update", async () => {
    await hooks.onCreateSuccess(
      onCreate(item()),
      created({ ownerUserId: ANA_ID, createdByUserId: MAYA_ID }),
    );

    expect(feedItems).toEqual([
      {
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        incidentFeedEventType: IncidentFeedEventType.PostmortemNote,
        feedInfoInMarkdown:
          "📝 Added the action item **Alert on pool usage**, owned by **Ana**.",
        displayColor: Gray500,
        userId: MAYA_ID,
      },
    ]);
    // Open: nobody closed it.
    expect(columnWrites).toEqual([]);
  });

  /*
   * An action item's owner can be someone invited to the project who has
   * not accepted: the feed names them by the name typed for them, else as
   * someone who hasn't joined the project yet - never by their own name
   * (#9823) or any address (#10668): the feed is read beyond the project.
   */
  test("its owner only invited to the project: named by the name typed for them, never an address", async () => {
    jest
      .spyOn(UserService, "findOneById")
      .mockImplementation(async (args: unknown) => {
        const user: User = new User();
        user._id = (args as { id: ObjectID }).id.toString();
        user.name = "Ana Account" as never;
        user.email = new Email("ana@example.com");
        return user;
      });
    const withheldIn: SpyInstance<
      typeof PendingInviteeProfiles.readWithheldProfilesInProject
    > = jest
      .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
      .mockResolvedValue(
        new Map<string, WithheldProfile>([
          [
            ANA_ID.toString().toLowerCase(),
            { inviteeName: "Ana from Platform" },
          ],
        ]),
      );

    await hooks.onCreateSuccess(
      onCreate(item()),
      created({ ownerUserId: ANA_ID, createdByUserId: MAYA_ID }),
    );

    withheldIn.mockResolvedValue(
      new Map<string, WithheldProfile>([
        [ANA_ID.toString().toLowerCase(), { inviteeName: null }],
      ]),
    );

    await hooks.onCreateSuccess(
      onCreate(item()),
      created({ ownerUserId: ANA_ID, createdByUserId: MAYA_ID }),
    );

    expect(feedTexts()).toEqual([
      "📝 Added the action item **Alert on pool usage**, owned by **Ana from Platform**.",
      "📝 Added the action item **Alert on pool usage**, owned by **someone who hasn't joined the project yet**.",
    ]);
    expect(
      (withheldIn.mock.calls[0]![0] as { projectId: ObjectID }).projectId,
    ).toBe(PROJECT_ID);
  });

  test("tracked from the note: said once for all of them, not on its own", async () => {
    await hooks.onCreateSuccess(
      onCreate(item(), { [TRACKED_FROM_NOTE_FLAG]: true }),
      created(),
    );

    expect(feedItems).toEqual([]);
  });

  test("added closed: whoever added it closed it, now", async () => {
    for (const status of [
      PostmortemActionItemStatus.Done,
      PostmortemActionItemStatus.WontDo,
    ]) {
      columnWrites = [];

      await hooks.onCreateSuccess(
        onCreate(item({ status })),
        created({ status }),
      );

      expect(columnWrites).toEqual([
        {
          id: ITEM_ID.toString(),
          data: { closedAt: NOW, closedByUserId: MAYA_ID },
        },
      ]);
    }
  });

  test("the item is kept when its feed line cannot be written", async () => {
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockRejectedValue(new Error("The database went away.") as never);

    const createdItem: IncidentPostmortemActionItem = created();

    await expect(
      hooks.onCreateSuccess(onCreate(item()), createdItem),
    ).resolves.toBe(createdItem);
  });
});

describe("changing an action item", () => {
  let heldRows: Array<IncidentPostmortemActionItem>;
  let rowReads: number;

  beforeEach(() => {
    rowReads = 0;
    heldRows = [
      item({
        _id: ITEM_ID.toString(),
        status: PostmortemActionItemStatus.Open,
        ownerUserId: ANA_ID,
      }),
    ];

    jest
      .spyOn(
        IncidentPostmortemActionItemService as unknown as {
          findRowsAndHoldUpdateToThem: () => void;
        },
        "findRowsAndHoldUpdateToThem",
      )
      .mockImplementation((async () => {
        rowReads++;
        return heldRows;
      }) as never);
  });

  async function change(
    data: JSONObject,
    props: DatabaseCommonInteractionProps = MAYA,
  ): Promise<UpdateBy<IncidentPostmortemActionItem>> {
    const updateBy: UpdateBy<IncidentPostmortemActionItem> = {
      query: { _id: ITEM_ID },
      data: data as never,
      props,
      limit: 1,
      skip: 0,
    };
    const onUpdate: OnUpdate<IncidentPostmortemActionItem> =
      await hooks.onBeforeUpdate(updateBy);
    await hooks.onUpdateSuccess(onUpdate, [ITEM_ID]);
    return updateBy;
  }

  test("a new title alone: trimmed, nothing read, nothing said", async () => {
    const data: JSONObject = { title: "  Retry with backoff " };

    await change(data);

    expect(data["title"]).toBe("Retry with backoff");
    expect(rowReads).toBe(0);
    expect(feedItems).toEqual([]);
  });

  test("marked done: who and when written by OneUptime, and on the feed in green", async () => {
    await change({ status: PostmortemActionItemStatus.Done });

    expect(columnWrites).toEqual([
      {
        id: ITEM_ID.toString(),
        data: { closedAt: NOW, closedByUserId: MAYA_ID },
      },
    ]);
    expect(feedItems).toHaveLength(1);
    expect(feedItems[0]!["feedInfoInMarkdown"]).toBe(
      "✅ Marked the action item **Alert on pool usage** done.",
    );
    expect(feedItems[0]!["displayColor"]).toEqual(Green500);
    expect(feedItems[0]!["userId"]).toEqual(MAYA_ID);
  });

  test("won't do: closed too, and the feed says the team decided not to", async () => {
    await change({ status: PostmortemActionItemStatus.WontDo });

    expect(columnWrites[0]!.data).toEqual({
      closedAt: NOW,
      closedByUserId: MAYA_ID,
    });
    expect(feedTexts()).toEqual([
      "🚫 Decided not to do the action item **Alert on pool usage**.",
    ]);
  });

  test("reopened: who closed it and when are cleared", async () => {
    heldRows[0]!.status = PostmortemActionItemStatus.Done;

    await change({ status: PostmortemActionItemStatus.Open });

    expect(columnWrites).toEqual([
      {
        id: ITEM_ID.toString(),
        data: { closedAt: null, closedByUserId: null },
      },
    ]);
    expect(feedTexts()).toEqual([
      "↩️ Reopened the action item **Alert on pool usage**.",
    ]);
  });

  test("from done to won't do: closed again, by whoever changed it", async () => {
    heldRows[0]!.status = PostmortemActionItemStatus.Done;

    await change({ status: PostmortemActionItemStatus.WontDo });

    expect(columnWrites[0]!.data).toEqual({
      closedAt: NOW,
      closedByUserId: MAYA_ID,
    });
  });

  test("the status it already has: nothing written, nothing said", async () => {
    await change({ status: PostmortemActionItemStatus.Open });

    expect(columnWrites).toEqual([]);
    expect(feedItems).toEqual([]);
  });

  test("given to someone else, or nobody: the feed says so", async () => {
    await change({ ownerUserId: MAYA_ID.toString() });
    await change({ ownerUser: null });

    expect(feedTexts()).toEqual([
      "👤 Gave the action item **Alert on pool usage** to **Maya**.",
      "👤 Took the owner off the action item **Alert on pool usage**.",
    ]);
  });

  test("its owner the same again: nothing said", async () => {
    await change({ ownerUserId: ANA_ID.toString() });

    expect(feedItems).toEqual([]);
  });

  test("a monitor made for it, and so done: both on the feed, the monitor first", async () => {
    await change({
      monitorId: MONITOR_ID.toString(),
      status: PostmortemActionItemStatus.Done,
    });

    expect(feedTexts()).toEqual([
      "📈 Created the monitor **Pool usage** for the action item **Alert on pool usage**.",
      "✅ Marked the action item **Alert on pool usage** done.",
    ]);
  });

  test("a status that is none is refused before anything is read", async () => {
    await expect(change({ status: "Later" })).rejects.toThrow('not "Later"');
    expect(rowReads).toBe(0);
  });

  test("a teammate's change is held to the items of incidents they may see", async () => {
    const updateBy: UpdateBy<IncidentPostmortemActionItem> = await change({
      status: PostmortemActionItemStatus.Done,
    });

    expect(
      (updateBy.query as unknown as JSONObject)["incidentId"],
    ).toBeDefined();
  });

  test("OneUptime's own change is not", async () => {
    const updateBy: UpdateBy<IncidentPostmortemActionItem> = await change(
      { title: "x" },
      { isRoot: true },
    );

    expect(
      (updateBy.query as unknown as JSONObject)["incidentId"],
    ).toBeUndefined();
  });

  test("the change stands when its feed line cannot be written", async () => {
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockRejectedValue(new Error("The database went away.") as never);

    await expect(
      change({ status: PostmortemActionItemStatus.Done }),
    ).resolves.toBeDefined();
    expect(columnWrites).toHaveLength(1);
  });
});

describe("reading and deleting action items", () => {
  test("a teammate reads only the items of incidents they may see", async () => {
    const findBy: FindBy<IncidentPostmortemActionItem> = {
      query: { projectId: PROJECT_ID },
      select: { title: true },
      props: MAYA,
      limit: 10,
      skip: 0,
    };

    await hooks.onBeforeFind(findBy);

    expect((findBy.query as unknown as JSONObject)["incidentId"]).toBeDefined();
  });

  test("deleted: the feed says which, read before the rows go", async () => {
    jest
      .spyOn(
        IncidentPostmortemActionItemService as unknown as {
          findRowsAndHoldDeleteToThem: () => void;
        },
        "findRowsAndHoldDeleteToThem",
      )
      .mockImplementation((async () => {
        return [item({ _id: ITEM_ID.toString() })];
      }) as never);

    const deleteBy: DeleteBy<IncidentPostmortemActionItem> = {
      query: { _id: ITEM_ID },
      props: MAYA,
      limit: 1,
      skip: 0,
    };

    const onDelete: OnDelete<IncidentPostmortemActionItem> =
      await hooks.onBeforeDelete(deleteBy);
    await hooks.onDeleteSuccess(onDelete, [ITEM_ID]);

    expect(
      (deleteBy.query as unknown as JSONObject)["incidentId"],
    ).toBeDefined();
    expect(feedTexts()).toEqual([
      "🗑️ Deleted the action item **Alert on pool usage**.",
    ]);
  });
});

describe("tracking the items the postmortem's note lists", () => {
  const NOTE: string = `## Root Cause
The pool ran out.

## Action Items
- [x] Increase the connection pool
- [ ] Alert on pool usage
- [ ] Add a regression test (due 2026-11-20)`;

  let created: Array<{
    data: IncidentPostmortemActionItem;
    props: DatabaseCommonInteractionProps;
    miscDataProps: JSONObject | undefined;
  }>;
  let incidentReadProps: DatabaseCommonInteractionProps | undefined;
  let tracked: Array<string>;
  let note: string | undefined;

  beforeEach(() => {
    created = [];
    incidentReadProps = undefined;
    tracked = [];
    note = NOTE;

    jest
      .spyOn(IncidentService, "findOneById")
      .mockImplementation(async (args: unknown) => {
        incidentReadProps = (args as { props: DatabaseCommonInteractionProps })
          .props;

        if (note === undefined) {
          return null;
        }

        const incident: Incident = new Incident();
        incident._id = INCIDENT_ID.toString();
        incident.projectId = PROJECT_ID;
        incident.postmortemNote = note;
        return incident;
      });

    jest
      .spyOn(IncidentPostmortemActionItemService, "findBy")
      .mockImplementation(async () => {
        return tracked.map((title: string): IncidentPostmortemActionItem => {
          return item({ title });
        });
      });

    jest
      .spyOn(IncidentPostmortemActionItemService, "create")
      .mockImplementation(
        async (createBy: CreateBy<IncidentPostmortemActionItem>) => {
          created.push({
            data: createBy.data,
            props: createBy.props,
            miscDataProps: createBy.miscDataProps,
          });
          return createBy.data;
        },
      );
  });

  test("each becomes an action item, as the person asking, in the note's order", async () => {
    const result: TrackedFromNote =
      await IncidentPostmortemActionItemService.trackFromPostmortemNote({
        incidentId: INCIDENT_ID,
        props: MAYA,
        timezone: "Europe/Berlin",
      });

    expect(incidentReadProps).toBe(MAYA);
    expect(result.listedCount).toBe(3);
    expect(
      created.map(
        (entry: { data: IncidentPostmortemActionItem }): Array<unknown> => {
          return [entry.data.title, entry.data.status];
        },
      ),
    ).toEqual([
      ["Increase the connection pool", PostmortemActionItemStatus.Done],
      ["Alert on pool usage", PostmortemActionItemStatus.Open],
      ["Add a regression test", PostmortemActionItemStatus.Open],
    ]);

    for (const entry of created) {
      expect(entry.props).toBe(MAYA);
      expect(entry.miscDataProps).toEqual({ [TRACKED_FROM_NOTE_FLAG]: true });
      expect(entry.data.projectId).toEqual(PROJECT_ID);
      expect(entry.data.incidentId).toEqual(INCIDENT_ID);
    }
  });

  test("a due day the note gives is that day's start in the reader's time zone", async () => {
    await IncidentPostmortemActionItemService.trackFromPostmortemNote({
      incidentId: INCIDENT_ID,
      props: MAYA,
      timezone: "Europe/Berlin",
    });

    expect(created[2]!.data.dueDate).toEqual(
      new Date("2026-11-19T23:00:00.000Z"),
    );
    expect(created[0]!.data.dueDate).toBeUndefined();
  });

  test("said in one feed line", async () => {
    await IncidentPostmortemActionItemService.trackFromPostmortemNote({
      incidentId: INCIDENT_ID,
      props: MAYA,
    });

    expect(feedTexts()).toEqual([
      "📝 Tracked 3 action items from the postmortem: **Increase the connection pool**; **Alert on pool usage**; **Add a regression test**.",
    ]);
    expect(feedItems[0]!["userId"]).toEqual(MAYA_ID);
  });

  test("only the items the incident does not track yet: tracking twice adds nothing", async () => {
    tracked = ["increase the connection pool", "Alert on pool usage"];

    const result: TrackedFromNote =
      await IncidentPostmortemActionItemService.trackFromPostmortemNote({
        incidentId: INCIDENT_ID,
        props: MAYA,
      });

    expect(
      result.trackedItems.map((entry: IncidentPostmortemActionItem) => {
        return entry.title;
      }),
    ).toEqual(["Add a regression test"]);

    tracked = [
      "Increase the connection pool",
      "Alert on pool usage",
      "Add a regression test",
    ];
    feedItems = [];
    created = [];

    const again: TrackedFromNote =
      await IncidentPostmortemActionItemService.trackFromPostmortemNote({
        incidentId: INCIDENT_ID,
        props: MAYA,
      });

    expect(again.trackedItems).toEqual([]);
    expect(created).toEqual([]);
    expect(feedItems).toEqual([]);
  });

  test("a note with no action items tracks none", async () => {
    note = "## What Happened\nNothing to do.";

    const result: TrackedFromNote =
      await IncidentPostmortemActionItemService.trackFromPostmortemNote({
        incidentId: INCIDENT_ID,
        props: MAYA,
      });

    expect(result).toEqual({ trackedItems: [], listedCount: 0 });
    expect(feedItems).toEqual([]);
  });

  test("an incident the person cannot read is refused, with what to do", async () => {
    note = undefined;

    await expect(
      IncidentPostmortemActionItemService.trackFromPostmortemNote({
        incidentId: INCIDENT_ID,
        props: MAYA,
      }),
    ).rejects.toThrow(
      "The incident was not found, or you cannot read it. Open the incident again, then track its action items.",
    );
    expect(created).toEqual([]);
  });
});
