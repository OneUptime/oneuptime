import DashboardPlaylistService, {
  Service as DashboardPlaylistServiceClass,
} from "../../../Server/Services/DashboardPlaylistService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DashboardPlaylist from "../../../Models/DatabaseModels/DashboardPlaylist";
import {
  DASHBOARD_PLAYLIST_DASHBOARDS_SHAPE_PROBLEM,
  DASHBOARD_PLAYLIST_INTERVAL_PROBLEM,
  DASHBOARD_PLAYLIST_TOO_MANY_DASHBOARDS_PROBLEM,
  getDashboardPlaylistEntryProblem,
} from "../../../Types/Dashboard/DashboardPlaylist";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * A dashboard playlist that saves is one the player can play (issue #5235):
 * its dashboards a list of {"dashboardId": "<id>"} - JSON text stored as the
 * list it spells, nothing as an empty playlist - and how long each is shown
 * a whole number of seconds from 10 to a day, or left out (the column's
 * default on create, what is stored on update). Which dashboards the ids
 * are is never checked here: the player reads them as its viewer, so an
 * editor saving a playlist keeps the dashboards in it they cannot see.
 */

const PROJECT: ObjectID = new ObjectID("7d000000-0000-4000-8000-000000000001");
const PLAYLIST: ObjectID = new ObjectID("7d000000-0000-4000-8000-000000000002");
const A: string = "7d000000-0000-4000-8000-0000000000a1";
const B: string = "7d000000-0000-4000-8000-0000000000b2";

type Hooks = {
  onBeforeCreate: (
    createBy: CreateBy<DashboardPlaylist>,
  ) => Promise<OnCreate<DashboardPlaylist>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<DashboardPlaylist>,
  ) => Promise<OnUpdate<DashboardPlaylist>>;
};

const service: Hooks = DashboardPlaylistService as unknown as Hooks;

function createBy(data: JSONObject): CreateBy<DashboardPlaylist> {
  const playlist: DashboardPlaylist = new DashboardPlaylist();
  Object.assign(playlist, { projectId: PROJECT, name: "NOC wall", ...data });

  return {
    data: playlist,
    props: { isRoot: true },
  } as CreateBy<DashboardPlaylist>;
}

function updateBy(data: JSONObject): UpdateBy<DashboardPlaylist> {
  return {
    query: { _id: PLAYLIST.toString() },
    data: data,
    props: { isRoot: true, tenantId: PROJECT },
  } as unknown as UpdateBy<DashboardPlaylist>;
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("The write was saved; a refusal was expected.");
}

describe("DashboardPlaylistService is the playlist's service", () => {
  test("its default export is an instance of its class, for DashboardPlaylist", () => {
    expect(DashboardPlaylistService).toBeInstanceOf(
      DashboardPlaylistServiceClass,
    );
    expect(DashboardPlaylistService.getModel().tableName).toBe(
      "DashboardPlaylist",
    );
  });
});

describe("creating a playlist", () => {
  test("saves its dashboards in the order sent, a repeated one included", async () => {
    const result: OnCreate<DashboardPlaylist> = await service.onBeforeCreate(
      createBy({
        dashboards: [
          { dashboardId: A },
          { dashboardId: B },
          { dashboardId: A },
        ],
        intervalInSeconds: 30,
      }),
    );

    expect(result.createBy.data.dashboards).toEqual([
      { dashboardId: A },
      { dashboardId: B },
      { dashboardId: A },
    ]);
    expect(result.createBy.data.intervalInSeconds).toBe(30);
    expect(result.carryForward).toBeNull();
  });

  test("stores the list JSON text spells", async () => {
    const result: OnCreate<DashboardPlaylist> = await service.onBeforeCreate(
      createBy({
        dashboards: JSON.stringify([
          { dashboardId: B },
        ]) as unknown as JSONObject,
      }),
    );

    expect(result.createBy.data.dashboards).toEqual([{ dashboardId: B }]);
  });

  test("an empty playlist and one with no interval save: the column's default fills it in", async () => {
    const empty: OnCreate<DashboardPlaylist> = await service.onBeforeCreate(
      createBy({ dashboards: [] }),
    );
    expect(empty.createBy.data.dashboards).toEqual([]);
    expect(empty.createBy.data.intervalInSeconds).toBeUndefined();

    const nothing: OnCreate<DashboardPlaylist> = await service.onBeforeCreate(
      createBy({}),
    );
    expect(nothing.createBy.data.dashboards).toBeUndefined();
  });

  test("names the playlist's dashboards by id and nothing else - no dashboard is read", async () => {
    // Ids of no dashboard at all: the player skips them; saving never asks.
    const result: OnCreate<DashboardPlaylist> = await service.onBeforeCreate(
      createBy({
        dashboards: [{ dashboardId: "7d000000-0000-4000-8000-0000000000ff" }],
      }),
    );

    expect(result.createBy.data.dashboards).toHaveLength(1);
  });

  test("refuses dashboards that are no list, an entry that is no dashboard, and too many", async () => {
    expect(
      await refusal(
        service.onBeforeCreate(createBy({ dashboards: { dashboardId: A } })),
      ),
    ).toBe(DASHBOARD_PLAYLIST_DASHBOARDS_SHAPE_PROBLEM);

    expect(
      await refusal(
        service.onBeforeCreate(
          createBy({
            dashboards: [{ dashboardId: A }, { dashboardId: "dashboard-2" }],
          }),
        ),
      ),
    ).toBe(getDashboardPlaylistEntryProblem(1));

    expect(
      await refusal(
        service.onBeforeCreate(
          createBy({
            dashboards: Array.from({ length: 101 }, () => {
              return { dashboardId: A };
            }),
          }),
        ),
      ),
    ).toBe(DASHBOARD_PLAYLIST_TOO_MANY_DASHBOARDS_PROBLEM);
  });

  test("refuses an interval outside 10 seconds to a day, or not a whole number", async () => {
    for (const intervalInSeconds of [0, 9, 86401, 12.5, -1]) {
      expect(
        await refusal(service.onBeforeCreate(createBy({ intervalInSeconds }))),
      ).toBe(DASHBOARD_PLAYLIST_INTERVAL_PROBLEM);
    }
  });
});

describe("changing a playlist", () => {
  test("a change of name alone is not looked at", async () => {
    const result: OnUpdate<DashboardPlaylist> = await service.onBeforeUpdate(
      updateBy({ name: "Night shift" }),
    );

    expect(result.updateBy.data).toEqual({ name: "Night shift" });
    expect(result.carryForward).toBeNull();
  });

  test("a new order is saved as sent", async () => {
    const result: OnUpdate<DashboardPlaylist> = await service.onBeforeUpdate(
      updateBy({
        dashboards: [{ dashboardId: B }, { dashboardId: A }],
      }),
    );

    expect(
      (result.updateBy.data as unknown as JSONObject)["dashboards"],
    ).toEqual([{ dashboardId: B }, { dashboardId: A }]);
  });

  test("clearing the dashboards empties the playlist", async () => {
    const result: OnUpdate<DashboardPlaylist> = await service.onBeforeUpdate(
      updateBy({ dashboards: null }),
    );

    expect(
      (result.updateBy.data as unknown as JSONObject)["dashboards"],
    ).toEqual([]);
  });

  test("refuses a broken list and an interval that is none - the column is required", async () => {
    expect(
      await refusal(
        service.onBeforeUpdate(updateBy({ dashboards: "not a list" })),
      ),
    ).toBe(DASHBOARD_PLAYLIST_DASHBOARDS_SHAPE_PROBLEM);

    expect(
      await refusal(
        service.onBeforeUpdate(updateBy({ intervalInSeconds: null })),
      ),
    ).toBe(DASHBOARD_PLAYLIST_INTERVAL_PROBLEM);

    expect(
      await refusal(
        service.onBeforeUpdate(updateBy({ intervalInSeconds: 100000 })),
      ),
    ).toBe(DASHBOARD_PLAYLIST_INTERVAL_PROBLEM);
  });

  test("an update with no data at all passes", async () => {
    const write: UpdateBy<DashboardPlaylist> = {
      query: { _id: PLAYLIST.toString() },
      props: { isRoot: true },
    } as unknown as UpdateBy<DashboardPlaylist>;

    const result: OnUpdate<DashboardPlaylist> =
      await service.onBeforeUpdate(write);

    expect(result.updateBy).toBe(write);
  });
});

describe("checkWrite, the one rule both hooks keep", () => {
  test("reads only the columns the write sends", () => {
    const data: Record<string, unknown> = { name: "Lobby" };

    DashboardPlaylistServiceClass.checkWrite(data);

    expect(data).toEqual({ name: "Lobby" });
  });

  test("turns JSON text into its list, in place", () => {
    const data: Record<string, unknown> = {
      dashboards: JSON.stringify([{ dashboardId: A }]),
      intervalInSeconds: 120,
    };

    DashboardPlaylistServiceClass.checkWrite(data);

    expect(data["dashboards"]).toEqual([{ dashboardId: A }]);
    expect(data["intervalInSeconds"]).toBe(120);
  });

  test("throws the problem's own words", () => {
    expect(() => {
      DashboardPlaylistServiceClass.checkWrite({ intervalInSeconds: 5 });
    }).toThrow(DASHBOARD_PLAYLIST_INTERVAL_PROBLEM);
  });
});
