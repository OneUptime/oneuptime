import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ScheduleLayersSaveUtil, {
  SCHEDULE_LAYERS_SAVE_MAX_LAYERS,
  SCHEDULE_LAYERS_SAVE_MAX_USERS,
  SCHEDULE_LAYERS_SAVE_MAX_USERS_PER_LAYER,
  SCHEDULE_LAYERS_SAVE_ROUTE,
  ScheduleLayersSavePlan,
  ScheduleLayersSaveRequest,
  ScheduleLayersState,
  ScheduleLayersStateLayerUser,
  getScheduleLayersSaveRoute,
} from "../../../Types/OnCallDutyPolicy/ScheduleLayersSave";
import { describe, expect, test } from "@jest/globals";

/*
 * SAVING THE CHANGES TO A SCHEDULE'S LAYERS ALL AT ONCE (issue #7575): what
 * the Layers page sends with Save, how the server reads it, and what it
 * writes - the one module both of them share.
 *
 *   - The version of the layers: the same rows the same way have one
 *     version, however they were listed; any change to which layers there
 *     are, their order, who is in each, in what order, changes it.
 *   - A save as the server reads it: every id an id, each named once, and
 *     no more than a schedule could hold - refused in plain words.
 *   - What a save writes: people added, taken out and moved, layers moved
 *     and deleted - each list it changes renumbered 1 to n, a list nothing
 *     changes in left as it is stored - and what it changes, as the page
 *     says it.
 */

const LAYER_A: string = "0d750000-0000-4000-8000-00000000000a";
const LAYER_B: string = "0d750000-0000-4000-8000-00000000000b";
const LAYER_C: string = "0d750000-0000-4000-8000-00000000000c";

const ALICE: string = "0d750000-0000-4000-8000-0000000000a1";
const BOB: string = "0d750000-0000-4000-8000-0000000000b1";
const CAROL: string = "0d750000-0000-4000-8000-0000000000c1";
const DANA: string = "0d750000-0000-4000-8000-0000000000d1";
const ERIN: string = "0d750000-0000-4000-8000-0000000000e1";

// The row of a person in a layer: its id says which layer and turn.
function rowId(layer: string, turn: number): string {
  return `${layer.slice(0, -3)}${layer.slice(-1)}${String(turn).padStart(2, "0")}`;
}

/*
 * Layer A: Alice, Bob, Carol. Layer B: Dana. Layer C: Erin, Alice. In
 * that order of priority.
 */
function savedState(): ScheduleLayersState {
  return {
    layers: [
      { id: LAYER_A, order: 1 },
      { id: LAYER_B, order: 2 },
      { id: LAYER_C, order: 3 },
    ],
    layerUsers: [
      { id: rowId(LAYER_A, 1), layerId: LAYER_A, userId: ALICE, order: 1 },
      { id: rowId(LAYER_A, 2), layerId: LAYER_A, userId: BOB, order: 2 },
      { id: rowId(LAYER_A, 3), layerId: LAYER_A, userId: CAROL, order: 3 },
      { id: rowId(LAYER_B, 1), layerId: LAYER_B, userId: DANA, order: 1 },
      { id: rowId(LAYER_C, 1), layerId: LAYER_C, userId: ERIN, order: 1 },
      { id: rowId(LAYER_C, 2), layerId: LAYER_C, userId: ALICE, order: 2 },
    ],
  };
}

// The save that changes nothing, to change a part of.
function unchanged(
  state: ScheduleLayersState = savedState(),
): ScheduleLayersSaveRequest {
  return ScheduleLayersSaveUtil.getUnchangedRequest(state);
}

function plan(
  request: ScheduleLayersSaveRequest,
  state: ScheduleLayersState = savedState(),
): ScheduleLayersSavePlan {
  return ScheduleLayersSaveUtil.plan({ state: state, request: request });
}

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("Expected a refusal");
}

function orderWrites(
  writes: Array<{ layerUser: ScheduleLayersStateLayerUser; order: number }>,
): Array<string> {
  return writes.map(
    (write: { layerUser: ScheduleLayersStateLayerUser; order: number }) => {
      return `${write.layerUser.userId}:${write.order}`;
    },
  );
}

describe("the route", () => {
  test("is the schedule's own, under its API path", () => {
    expect(SCHEDULE_LAYERS_SAVE_ROUTE).toBe("/:id/save-layers");
    expect(getScheduleLayersSaveRoute(LAYER_A)).toBe(`/${LAYER_A}/save-layers`);
  });
});

describe("the version of a schedule's layers", () => {
  test("is the same for the same rows, however they are listed", () => {
    const state: ScheduleLayersState = savedState();
    const shuffled: ScheduleLayersState = {
      layers: [...state.layers].reverse(),
      layerUsers: [
        state.layerUsers[4]!,
        state.layerUsers[0]!,
        state.layerUsers[5]!,
        state.layerUsers[2]!,
        state.layerUsers[3]!,
        state.layerUsers[1]!,
      ],
    };

    expect(ScheduleLayersSaveUtil.getVersion(shuffled)).toBe(
      ScheduleLayersSaveUtil.getVersion(state),
    );
  });

  test("reads ids in any case, as Postgres writes them lower-cased", () => {
    const state: ScheduleLayersState = savedState();
    const shouted: ScheduleLayersState = {
      layers: state.layers.map((layer: { id: string; order: number }) => {
        return { ...layer, id: layer.id.toUpperCase() };
      }),
      layerUsers: state.layerUsers.map(
        (layerUser: ScheduleLayersStateLayerUser) => {
          return {
            id: layerUser.id.toUpperCase(),
            layerId: layerUser.layerId.toUpperCase(),
            userId: layerUser.userId.toUpperCase(),
            order: layerUser.order,
          };
        },
      ),
    };

    expect(ScheduleLayersSaveUtil.getVersion(shouted)).toBe(
      ScheduleLayersSaveUtil.getVersion(state),
    );
  });

  test("changes with each thing a save can change", () => {
    const base: string = ScheduleLayersSaveUtil.getVersion(savedState());
    const versions: Set<string> = new Set<string>([base]);

    const variants: Array<(state: ScheduleLayersState) => void> = [
      // A layer's place.
      (state: ScheduleLayersState): void => {
        state.layers[0]!.order = 4;
      },
      // A layer more.
      (state: ScheduleLayersState): void => {
        state.layers.push({
          id: "0d750000-0000-4000-8000-00000000000d",
          order: 4,
        });
      },
      // A layer fewer.
      (state: ScheduleLayersState): void => {
        state.layers.pop();
      },
      // A person's turn.
      (state: ScheduleLayersState): void => {
        state.layerUsers[0]!.order = 7;
      },
      // A person more.
      (state: ScheduleLayersState): void => {
        state.layerUsers.push({
          id: rowId(LAYER_B, 2),
          layerId: LAYER_B,
          userId: ERIN,
          order: 2,
        });
      },
      // A person fewer.
      (state: ScheduleLayersState): void => {
        state.layerUsers.pop();
      },
      // Somebody else in a row.
      (state: ScheduleLayersState): void => {
        state.layerUsers[0]!.userId = DANA;
      },
      // A row in another layer.
      (state: ScheduleLayersState): void => {
        state.layerUsers[3]!.layerId = LAYER_C;
      },
      // Another row for the same person in the same place.
      (state: ScheduleLayersState): void => {
        state.layerUsers[0]!.id = rowId(LAYER_A, 9);
      },
      // Two people swap turns.
      (state: ScheduleLayersState): void => {
        state.layerUsers[0]!.order = 2;
        state.layerUsers[1]!.order = 1;
      },
    ];

    for (const change of variants) {
      const state: ScheduleLayersState = savedState();
      change(state);
      const version: string = ScheduleLayersSaveUtil.getVersion(state);
      expect(versions.has(version)).toBe(false);
      versions.add(version);
    }
  });

  test("is short, and says how many layers and rows it is of", () => {
    const version: string = ScheduleLayersSaveUtil.getVersion(savedState());

    expect(version.startsWith("1-3-6-")).toBe(true);
    expect(version.length).toBeLessThan(60);
    expect(
      ScheduleLayersSaveUtil.getVersion({ layers: [], layerUsers: [] }),
    ).toMatch(/^1-0-0-/);
  });
});

describe("the layers and their people, as they take turns", () => {
  test("in their order, and twins - two rows saved with one order - by id", () => {
    const state: ScheduleLayersState = {
      layers: [
        { id: LAYER_C, order: 1 },
        { id: LAYER_B, order: 1 },
        { id: LAYER_A, order: 0 },
      ],
      layerUsers: [
        { id: rowId(LAYER_A, 3), layerId: LAYER_A, userId: CAROL, order: 2 },
        { id: rowId(LAYER_A, 2), layerId: LAYER_A, userId: BOB, order: 2 },
        { id: rowId(LAYER_A, 1), layerId: LAYER_A, userId: ALICE, order: 5 },
        { id: rowId(LAYER_B, 1), layerId: LAYER_B, userId: DANA, order: 1 },
      ],
    };

    expect(
      ScheduleLayersSaveUtil.getLayersInPriorityOrder(state).map(
        (layer: { id: string }) => {
          return layer.id;
        },
      ),
    ).toEqual([LAYER_A, LAYER_B, LAYER_C]);

    expect(
      ScheduleLayersSaveUtil.getLayerUsersInTurnOrder(state, LAYER_A).map(
        (layerUser: ScheduleLayersStateLayerUser) => {
          return layerUser.userId;
        },
      ),
    ).toEqual([BOB, CAROL, ALICE]);

    // Asked in capitals, as an id may come.
    expect(
      ScheduleLayersSaveUtil.getLayerUsersInTurnOrder(
        state,
        LAYER_B.toUpperCase(),
      ).length,
    ).toBe(1);
  });

  test("the save that changes nothing names every layer, and every person by their row", () => {
    const request: ScheduleLayersSaveRequest = unchanged();

    expect(request.basedOnVersion).toBe(
      ScheduleLayersSaveUtil.getVersion(savedState()),
    );
    expect(request.deletedLayerIds).toEqual([]);
    expect(
      request.layers.map((layer: { layerId: string }) => {
        return layer.layerId;
      }),
    ).toEqual([LAYER_A, LAYER_B, LAYER_C]);
    expect(request.layers[0]!.users).toEqual([
      { layerUserId: rowId(LAYER_A, 1), userId: ALICE },
      { layerUserId: rowId(LAYER_A, 2), userId: BOB },
      { layerUserId: rowId(LAYER_A, 3), userId: CAROL },
    ]);

    const saved: ScheduleLayersSavePlan = plan(request);
    expect(saved.changes.hasChanges).toBe(false);
    expect(ScheduleLayersSaveUtil.isEmpty(saved)).toBe(true);
  });
});

describe("a save, as the server reads it", () => {
  test("comes back as it was sent, through JSON", () => {
    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers[1]!.users.push({ userId: ERIN });
    request.deletedLayerIds = [LAYER_C];
    request.layers.pop();

    const json: JSONObject = ScheduleLayersSaveUtil.requestToJSON(request);

    // Someone added is sent with no layerUserId at all, not a null one.
    expect(
      Object.keys(
        (
          (json["layers"] as Array<JSONObject>)[1]![
            "users"
          ] as Array<JSONObject>
        )[1]!,
      ),
    ).toEqual(["userId"]);

    expect(
      ScheduleLayersSaveUtil.parseRequest(JSON.parse(JSON.stringify(json))),
    ).toEqual(request);
  });

  test("lower-cases every id, as Postgres writes them", () => {
    const parsed: ScheduleLayersSaveRequest =
      ScheduleLayersSaveUtil.parseRequest({
        basedOnVersion: "v",
        layers: [
          {
            layerId: LAYER_A.toUpperCase(),
            users: [
              {
                layerUserId: rowId(LAYER_A, 1).toUpperCase(),
                userId: ALICE.toUpperCase(),
              },
              { userId: ` ${BOB.toUpperCase()} ` },
            ],
          },
        ],
        deletedLayerIds: [LAYER_B.toUpperCase()],
      });

    expect(parsed.layers[0]!.layerId).toBe(LAYER_A);
    expect(parsed.layers[0]!.users).toEqual([
      { layerUserId: rowId(LAYER_A, 1), userId: ALICE },
      { userId: BOB },
    ]);
    expect(parsed.deletedLayerIds).toEqual([LAYER_B]);
  });

  test("takes no deletedLayerIds, or null, as none", () => {
    for (const deletedLayerIds of [undefined, null]) {
      expect(
        ScheduleLayersSaveUtil.parseRequest({
          basedOnVersion: "v",
          layers: [],
          deletedLayerIds: deletedLayerIds,
        }).deletedLayerIds,
      ).toEqual([]);
    }
  });

  test("a layerUserId of null is someone added", () => {
    expect(
      ScheduleLayersSaveUtil.parseRequest({
        basedOnVersion: "v",
        layers: [
          {
            layerId: LAYER_A,
            users: [{ layerUserId: null, userId: ALICE }],
          },
        ],
      }).layers[0]!.users,
    ).toEqual([{ userId: ALICE }]);
  });

  const refused: Array<{ name: string; body: unknown; says: RegExp }> = [
    { name: "nothing", body: undefined, says: /Send the layers to save/ },
    { name: "a list", body: [], says: /Send the layers to save/ },
    {
      name: "no version",
      body: { layers: [] },
      says: /Send basedOnVersion/,
    },
    {
      name: "a blank version",
      body: { basedOnVersion: "  ", layers: [] },
      says: /Send basedOnVersion/,
    },
    {
      name: "a version that is no version",
      body: { basedOnVersion: "v".repeat(201), layers: [] },
      says: /Send basedOnVersion/,
    },
    {
      name: "no layers",
      body: { basedOnVersion: "v" },
      says: /Send layers as a list/,
    },
    {
      name: "deleted layers that are no list",
      body: { basedOnVersion: "v", layers: [], deletedLayerIds: LAYER_A },
      says: /Send deletedLayerIds as a list/,
    },
    {
      name: "a layer that is no layer",
      body: { basedOnVersion: "v", layers: ["x"] },
      says: /Each layer in layers is \{ layerId, users \}/,
    },
    {
      name: "a layer with no id",
      body: { basedOnVersion: "v", layers: [{ users: [] }] },
      says: /named by its layerId/,
    },
    {
      name: "a layer whose id is no id",
      body: { basedOnVersion: "v", layers: [{ layerId: "1", users: [] }] },
      says: /named by its layerId/,
    },
    {
      name: "a layer with no people",
      body: { basedOnVersion: "v", layers: [{ layerId: LAYER_A }] },
      says: /Send the users of layer/,
    },
    {
      name: "a layer named twice",
      body: {
        basedOnVersion: "v",
        layers: [
          { layerId: LAYER_A, users: [] },
          { layerId: LAYER_A.toUpperCase(), users: [] },
        ],
      },
      says: /Name each layer once/,
    },
    {
      name: "a layer kept and deleted",
      body: {
        basedOnVersion: "v",
        layers: [{ layerId: LAYER_A, users: [] }],
        deletedLayerIds: [LAYER_A],
      },
      says: /Name each layer once/,
    },
    {
      name: "a deleted layer whose id is no id",
      body: { basedOnVersion: "v", layers: [], deletedLayerIds: ["x"] },
      says: /Each of deletedLayerIds is the id/,
    },
    {
      name: "a person who is no person",
      body: {
        basedOnVersion: "v",
        layers: [{ layerId: LAYER_A, users: [ALICE] }],
      },
      says: /Each person in a layer's users is \{ userId \}/,
    },
    {
      name: "a person with no user id",
      body: {
        basedOnVersion: "v",
        layers: [{ layerId: LAYER_A, users: [{}] }],
      },
      says: /named by their userId/,
    },
    {
      name: "a row whose id is no id",
      body: {
        basedOnVersion: "v",
        layers: [
          { layerId: LAYER_A, users: [{ layerUserId: 7, userId: ALICE }] },
        ],
      },
      says: /leave it out for someone added/,
    },
    {
      name: "a row named twice",
      body: {
        basedOnVersion: "v",
        layers: [
          {
            layerId: LAYER_A,
            users: [{ layerUserId: rowId(LAYER_A, 1), userId: ALICE }],
          },
          {
            layerId: LAYER_B,
            users: [{ layerUserId: rowId(LAYER_A, 1), userId: ALICE }],
          },
        ],
      },
      says: /Name each person already in a layer once/,
    },
  ];

  for (const sent of refused) {
    test(`refuses ${sent.name}, in plain words`, () => {
      expect(
        refusal(() => {
          return ScheduleLayersSaveUtil.parseRequest(sent.body);
        }),
      ).toMatch(sent.says);
    });
  }

  test("refuses more layers or people than a schedule could hold", () => {
    const layerIds: Array<string> = Array.from(
      { length: SCHEDULE_LAYERS_SAVE_MAX_LAYERS + 1 },
      (_: unknown, index: number): string => {
        return `0d750000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      },
    );

    expect(
      refusal(() => {
        return ScheduleLayersSaveUtil.parseRequest({
          basedOnVersion: "v",
          layers: layerIds.map((layerId: string) => {
            return { layerId: layerId, users: [] };
          }),
        });
      }),
    ).toMatch(/at most 100 layers/);

    expect(
      refusal(() => {
        return ScheduleLayersSaveUtil.parseRequest({
          basedOnVersion: "v",
          layers: [],
          deletedLayerIds: layerIds,
        });
      }),
    ).toMatch(/at most 100 layers/);

    const people: (count: number) => Array<JSONObject> = (
      count: number,
    ): Array<JSONObject> => {
      return Array.from({ length: count }, (): JSONObject => {
        return { userId: ALICE };
      });
    };

    expect(
      refusal(() => {
        return ScheduleLayersSaveUtil.parseRequest({
          basedOnVersion: "v",
          layers: [
            {
              layerId: LAYER_A,
              users: people(SCHEDULE_LAYERS_SAVE_MAX_USERS_PER_LAYER + 1),
            },
          ],
        });
      }),
    ).toMatch(/A layer takes at most 500 people/);

    // Within each layer's limit, beyond the save's.
    const perLayer: number = SCHEDULE_LAYERS_SAVE_MAX_USERS_PER_LAYER;
    const layersNeeded: number =
      Math.floor(SCHEDULE_LAYERS_SAVE_MAX_USERS / perLayer) + 1;

    expect(
      refusal(() => {
        return ScheduleLayersSaveUtil.parseRequest({
          basedOnVersion: "v",
          layers: layerIds.slice(0, layersNeeded).map((layerId: string) => {
            return { layerId: layerId, users: people(perLayer) };
          }),
        });
      }),
    ).toMatch(/A save names at most 2000 people/);

    // At the limits, it is read.
    expect(
      ScheduleLayersSaveUtil.parseRequest({
        basedOnVersion: "v",
        layers: [{ layerId: LAYER_A, users: people(perLayer) }],
      }).layers[0]!.users.length,
    ).toBe(perLayer);
  });
});

describe("what a save writes, and what it changes", () => {
  test("a person dragged to the top: the people of that layer renumbered, as moves", () => {
    const request: ScheduleLayersSaveRequest = unchanged();
    const users: Array<{ layerUserId?: string | undefined; userId: string }> =
      request.layers[0]!.users;
    request.layers[0]!.users = [users[2]!, users[0]!, users[1]!];

    const saved: ScheduleLayersSavePlan = plan(request);

    expect(orderWrites(saved.layerUserOrderUpdates)).toEqual([
      `${CAROL}:1`,
      `${ALICE}:2`,
      `${BOB}:3`,
    ]);
    expect(orderWrites(saved.layerUserMoves)).toEqual(
      orderWrites(saved.layerUserOrderUpdates),
    );
    expect(saved.layerUserCreates).toEqual([]);
    expect(saved.layerUserDeletes).toEqual([]);
    expect(saved.layerDeletes).toEqual([]);
    expect(saved.layerOrderUpdates).toEqual([]);
    expect(saved.changes).toEqual({
      hasChanges: true,
      isLayerOrderChanged: false,
      deletedLayerIds: [],
      layers: [
        {
          layerId: LAYER_A,
          addedCount: 0,
          removedCount: 0,
          isTurnOrderChanged: true,
        },
      ],
    });
  });

  test("a person added at the end: one row, at the next place, and nobody moves", () => {
    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers[1]!.users.push({ userId: ERIN });

    const saved: ScheduleLayersSavePlan = plan(request);

    expect(saved.layerUserCreates).toEqual([
      { layerId: LAYER_B, userId: ERIN, order: 2 },
    ]);
    expect(saved.layerUserOrderUpdates).toEqual([]);
    expect(saved.layerUserMoves).toEqual([]);
    expect(saved.changes.layers).toEqual([
      {
        layerId: LAYER_B,
        addedCount: 1,
        removedCount: 0,
        isTurnOrderChanged: false,
      },
    ]);
  });

  test("a person added at the top: the others step down, which is no move of theirs", () => {
    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers[0]!.users.unshift({ userId: DANA });

    const saved: ScheduleLayersSavePlan = plan(request);

    expect(saved.layerUserCreates).toEqual([
      { layerId: LAYER_A, userId: DANA, order: 1 },
    ]);
    expect(orderWrites(saved.layerUserOrderUpdates)).toEqual([
      `${ALICE}:2`,
      `${BOB}:3`,
      `${CAROL}:4`,
    ]);
    expect(saved.layerUserMoves).toEqual([]);
    expect(saved.changes.layers[0]!.isTurnOrderChanged).toBe(false);
  });

  test("a person taken out: their row goes, the people after them step up", () => {
    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers[0]!.users.splice(1, 1);

    const saved: ScheduleLayersSavePlan = plan(request);

    expect(
      saved.layerUserDeletes.map((layerUser: ScheduleLayersStateLayerUser) => {
        return layerUser.userId;
      }),
    ).toEqual([BOB]);
    expect(orderWrites(saved.layerUserOrderUpdates)).toEqual([`${CAROL}:2`]);
    expect(saved.layerUserMoves).toEqual([]);
    expect(saved.changes.layers).toEqual([
      {
        layerId: LAYER_A,
        addedCount: 0,
        removedCount: 1,
        isTurnOrderChanged: false,
      },
    ]);
  });

  test("everyone taken out of a layer: the layer stays, with nobody in it", () => {
    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers[2]!.users = [];

    const saved: ScheduleLayersSavePlan = plan(request);

    expect(saved.layerUserDeletes.length).toBe(2);
    expect(saved.layerDeletes).toEqual([]);
    expect(saved.changes.layers[0]!.removedCount).toBe(2);
  });

  test("the same person in a layer twice is two turns", () => {
    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers[1]!.users.push({ userId: DANA });

    expect(plan(request).layerUserCreates).toEqual([
      { layerId: LAYER_B, userId: DANA, order: 2 },
    ]);
  });

  test("a layer moved up: the layers renumbered in their new order, as moves", () => {
    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers = [
      request.layers[1]!,
      request.layers[0]!,
      request.layers[2]!,
    ];

    const saved: ScheduleLayersSavePlan = plan(request);

    expect(
      saved.layerOrderUpdates.map(
        (write: { layer: { id: string }; order: number }) => {
          return `${write.layer.id}:${write.order}`;
        },
      ),
    ).toEqual([`${LAYER_B}:1`, `${LAYER_A}:2`]);
    expect(saved.layerOrderUpdatesAreMoves).toBe(true);
    expect(saved.changes.isLayerOrderChanged).toBe(true);
    expect(saved.changes.layers).toEqual([]);
  });

  test("a layer deleted: it goes with its people, the layers below step up - no move of theirs", () => {
    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers.splice(0, 1);
    request.deletedLayerIds = [LAYER_A];

    const saved: ScheduleLayersSavePlan = plan(request);

    expect(saved.layerDeletes).toEqual([{ id: LAYER_A, order: 1 }]);
    expect(
      saved.layerUsersOfDeletedLayers.map(
        (layerUser: ScheduleLayersStateLayerUser) => {
          return layerUser.userId;
        },
      ),
    ).toEqual([ALICE, BOB, CAROL]);
    // Its people go with it by its foreign key: no row of theirs is deleted on its own.
    expect(saved.layerUserDeletes).toEqual([]);
    expect(
      saved.layerOrderUpdates.map(
        (write: { layer: { id: string }; order: number }) => {
          return `${write.layer.id}:${write.order}`;
        },
      ),
    ).toEqual([`${LAYER_B}:1`, `${LAYER_C}:2`]);
    expect(saved.layerOrderUpdatesAreMoves).toBe(false);
    expect(saved.changes).toEqual({
      hasChanges: true,
      isLayerOrderChanged: false,
      deletedLayerIds: [LAYER_A],
      layers: [],
    });
  });

  test("the last layer deleted needs nobody renumbered", () => {
    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers.pop();
    request.deletedLayerIds = [LAYER_C];

    const saved: ScheduleLayersSavePlan = plan(request);

    expect(saved.layerDeletes.length).toBe(1);
    expect(saved.layerOrderUpdates).toEqual([]);
  });

  test("many changes at once, in several layers", () => {
    const request: ScheduleLayersSaveRequest = unchanged();
    // Layer C first, then A; B deleted.
    const [layerA, , layerC] = request.layers;
    layerA!.users = [layerA!.users[1]!, { userId: ERIN }, layerA!.users[0]!];
    layerC!.users = [layerC!.users[1]!];
    request.layers = [layerC!, layerA!];
    request.deletedLayerIds = [LAYER_B];

    const saved: ScheduleLayersSavePlan = plan(request);

    expect(saved.changes).toEqual({
      hasChanges: true,
      isLayerOrderChanged: true,
      deletedLayerIds: [LAYER_B],
      layers: [
        {
          layerId: LAYER_C,
          addedCount: 0,
          removedCount: 1,
          isTurnOrderChanged: false,
        },
        {
          layerId: LAYER_A,
          addedCount: 1,
          removedCount: 1,
          isTurnOrderChanged: true,
        },
      ],
    });
    expect(saved.layerUserCreates).toEqual([
      { layerId: LAYER_A, userId: ERIN, order: 2 },
    ]);
    expect(orderWrites(saved.layerUserOrderUpdates)).toEqual([
      `${ALICE}:1`,
      `${BOB}:1`,
      `${ALICE}:3`,
    ]);
    expect(saved.layerUserMoves.length).toBe(2);
    expect(
      saved.layerUserDeletes.map((layerUser: ScheduleLayersStateLayerUser) => {
        return layerUser.userId;
      }),
    ).toEqual([ERIN, CAROL]);
  });

  test("a list nothing changes in is left as stored, gaps and twins included", () => {
    const state: ScheduleLayersState = {
      layers: [
        { id: LAYER_A, order: 3 },
        { id: LAYER_B, order: 9 },
      ],
      layerUsers: [
        { id: rowId(LAYER_A, 1), layerId: LAYER_A, userId: ALICE, order: 4 },
        { id: rowId(LAYER_A, 2), layerId: LAYER_A, userId: BOB, order: 4 },
        { id: rowId(LAYER_B, 1), layerId: LAYER_B, userId: CAROL, order: 7 },
      ],
    };

    const nothing: ScheduleLayersSavePlan = plan(unchanged(state), state);
    expect(ScheduleLayersSaveUtil.isEmpty(nothing)).toBe(true);

    // A change in layer B renumbers layer B only.
    const request: ScheduleLayersSaveRequest = unchanged(state);
    request.layers[1]!.users.push({ userId: DANA });
    const saved: ScheduleLayersSavePlan = plan(request, state);

    expect(orderWrites(saved.layerUserOrderUpdates)).toEqual([`${CAROL}:1`]);
    expect(saved.layerUserCreates).toEqual([
      { layerId: LAYER_B, userId: DANA, order: 2 },
    ]);
    expect(saved.layerOrderUpdates).toEqual([]);
  });

  test("a layer deleted renumbers the layers kept, even from gaps", () => {
    const state: ScheduleLayersState = {
      layers: [
        { id: LAYER_A, order: 2 },
        { id: LAYER_B, order: 5 },
        { id: LAYER_C, order: 8 },
      ],
      layerUsers: [],
    };
    const request: ScheduleLayersSaveRequest = unchanged(state);
    request.layers.splice(1, 1);
    request.deletedLayerIds = [LAYER_B];

    expect(
      plan(request, state).layerOrderUpdates.map(
        (write: { layer: { id: string }; order: number }) => {
          return `${write.layer.id}:${write.order}`;
        },
      ),
    ).toEqual([`${LAYER_A}:1`, `${LAYER_C}:2`]);
  });

  const notThisSchedule: Array<{
    name: string;
    change: (request: ScheduleLayersSaveRequest) => void;
    says: RegExp;
  }> = [
    {
      name: "a layer it does not have",
      change: (request: ScheduleLayersSaveRequest): void => {
        request.layers.push({
          layerId: "0d750000-0000-4000-8000-00000000000f",
          users: [],
        });
      },
      says: /is not a layer of this schedule/,
    },
    {
      name: "a deleted layer it does not have",
      change: (request: ScheduleLayersSaveRequest): void => {
        request.deletedLayerIds.push("0d750000-0000-4000-8000-00000000000f");
      },
      says: /is not a layer of this schedule/,
    },
    {
      name: "a layer it leaves out",
      change: (request: ScheduleLayersSaveRequest): void => {
        request.layers.pop();
      },
      says: /Name every layer of the schedule/,
    },
    {
      name: "every layer deleted",
      change: (request: ScheduleLayersSaveRequest): void => {
        request.deletedLayerIds = request.layers.map(
          (layer: { layerId: string }) => {
            return layer.layerId;
          },
        );
        request.layers = [];
      },
      says: /A schedule must have at least one layer/,
    },
    {
      name: "a row the schedule does not have",
      change: (request: ScheduleLayersSaveRequest): void => {
        request.layers[0]!.users.push({
          layerUserId: rowId(LAYER_B, 9),
          userId: ALICE,
        });
      },
      says: /is not a person in this schedule's layers/,
    },
    {
      name: "a row of another layer",
      change: (request: ScheduleLayersSaveRequest): void => {
        const moved: { layerUserId?: string | undefined; userId: string } =
          request.layers[1]!.users.pop()!;
        request.layers[0]!.users.push(moved);
      },
      says: /is a person in another layer/,
    },
    {
      name: "a row with somebody else in it",
      change: (request: ScheduleLayersSaveRequest): void => {
        request.layers[0]!.users[0]!.userId = DANA;
      },
      says: /is the row of another person/,
    },
  ];

  for (const sent of notThisSchedule) {
    test(`refuses ${sent.name}, in plain words`, () => {
      const request: ScheduleLayersSaveRequest = unchanged();
      sent.change(request);

      expect(
        refusal(() => {
          return plan(request);
        }),
      ).toMatch(sent.says);
    });
  }

  test("a schedule with no layers saves nothing, and is no refusal", () => {
    const empty: ScheduleLayersState = { layers: [], layerUsers: [] };

    expect(ScheduleLayersSaveUtil.isEmpty(plan(unchanged(empty), empty))).toBe(
      true,
    );
  });
});

describe("what a save answers", () => {
  test("goes through JSON as it is", () => {
    const result: {
      version: string;
      deletedLayers: number;
      movedLayers: number;
      addedLayerUsers: number;
      removedLayerUsers: number;
      movedLayerUsers: number;
    } = {
      version: "1-2-3-a-b",
      deletedLayers: 1,
      movedLayers: 2,
      addedLayerUsers: 3,
      removedLayerUsers: 4,
      movedLayerUsers: 5,
    };

    expect(
      ScheduleLayersSaveUtil.resultFromJSON(
        JSON.parse(JSON.stringify(ScheduleLayersSaveUtil.resultToJSON(result))),
      ),
    ).toEqual(result);
  });

  test("reads what it cannot read as nothing", () => {
    expect(ScheduleLayersSaveUtil.resultFromJSON(null)).toEqual({
      version: "",
      deletedLayers: 0,
      movedLayers: 0,
      addedLayerUsers: 0,
      removedLayerUsers: 0,
      movedLayerUsers: 0,
    });
    expect(
      ScheduleLayersSaveUtil.resultFromJSON({
        version: 7,
        deletedLayers: -1,
        movedLayers: "2",
        addedLayerUsers: Number.NaN,
        removedLayerUsers: Number.POSITIVE_INFINITY,
        movedLayerUsers: 1,
      }),
    ).toEqual({
      version: "",
      deletedLayers: 0,
      movedLayers: 0,
      addedLayerUsers: 0,
      removedLayerUsers: 0,
      movedLayerUsers: 1,
    });
  });
});
