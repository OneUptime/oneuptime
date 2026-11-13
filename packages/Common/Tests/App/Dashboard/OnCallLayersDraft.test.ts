import {
  LAYERS_SAVE_BAR_SHOWN_CHANGES,
  getLayersChangeLines,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayersSaveBar";
import {
  buildScheduleLayersSaveRequest,
  createAddedLayerUser,
  getLayerUserRowKey,
  getMovedLayerUserIds,
  getRemovedLayerUsers,
  getScheduleLayersState,
  isAddedLayerUser,
  isSameLayerUserRow,
  moveInList,
  moveLayerInOrder,
  restoreRemovedLayerUser,
  sortInPriorityOrder,
  sortInTurnOrder,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayersDraft";
import {
  getScheduleLayersSaveUrl,
  isScheduleLayersSaveConflict,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/SaveScheduleLayers";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import ScheduleLayersSaveUtil, {
  ScheduleLayersChanges,
  ScheduleLayersSaveRequest,
  ScheduleLayersState,
} from "../../../Types/OnCallDutyPolicy/ScheduleLayersSave";
import { Translator, createTranslator } from "../../../Types/Translator";
import { describe, expect, test } from "@jest/globals";

/*
 * THE LAYERS PAGE'S CHANGES, BEFORE THEY ARE SAVED (issue #7575): the steps
 * the page takes with nothing of React or the network in them - who is
 * moved, taken out and put back, the layers' new order, what Save sends -
 * and the lines the bar at the foot of the page says them in.
 */

const SCHEDULE: string = "0d750000-0000-4000-8000-000000000004";
const PROJECT: string = "0d750000-0000-4000-8000-000000000001";
const LAYER_A: string = "0d750000-0000-4000-8000-00000000000a";
const LAYER_B: string = "0d750000-0000-4000-8000-00000000000b";
const LAYER_C: string = "0d750000-0000-4000-8000-00000000000c";

const ALICE: string = "0d750000-0000-4000-8000-0000000000a1";
const BOB: string = "0d750000-0000-4000-8000-0000000000b1";
const CAROL: string = "0d750000-0000-4000-8000-0000000000c1";
const DANA: string = "0d750000-0000-4000-8000-0000000000d1";
const ERIN: string = "0d750000-0000-4000-8000-0000000000e1";

const english: Translator = createTranslator(undefined);

function layer(id: string, order: number): OnCallDutyPolicyScheduleLayer {
  const row: OnCallDutyPolicyScheduleLayer =
    new OnCallDutyPolicyScheduleLayer();
  row._id = id;
  row.order = order;
  row.onCallDutyPolicyScheduleId = new ObjectID(SCHEDULE);
  row.projectId = new ObjectID(PROJECT);
  return row;
}

let rowCount: number = 0;

// A person saved in a layer: a row with an id.
function saved(
  layerId: string,
  userId: string,
  order: number,
): OnCallDutyPolicyScheduleLayerUser {
  rowCount++;
  const row: OnCallDutyPolicyScheduleLayerUser =
    new OnCallDutyPolicyScheduleLayerUser();
  row._id = `0d750000-0000-4000-8000-${String(100 + rowCount).padStart(12, "0")}`;
  row.order = order;
  row.userId = new ObjectID(userId);
  const user: User = new User(new ObjectID(userId));
  row.user = user;
  row.onCallDutyPolicyScheduleLayerId = new ObjectID(layerId);
  return row;
}

function ids(rows: Array<OnCallDutyPolicyScheduleLayerUser>): Array<string> {
  return rows.map((row: OnCallDutyPolicyScheduleLayerUser): string => {
    return row.userId!.toString();
  });
}

function rowId(row: OnCallDutyPolicyScheduleLayerUser): string {
  return row.id!.toString().toLowerCase();
}

describe("the people of a layer as the page has them", () => {
  test("someone added is a row with no id, holding the person, with a key of its own", () => {
    const added: OnCallDutyPolicyScheduleLayerUser = createAddedLayerUser({
      layer: layer(LAYER_A, 1),
      userId: DANA,
      name: "Dana Diaz",
      email: "dana@example.com",
    });
    const again: OnCallDutyPolicyScheduleLayerUser = createAddedLayerUser({
      layer: layer(LAYER_A, 1),
      userId: DANA,
      name: "Dana Diaz",
      email: "not an email",
    });

    expect(isAddedLayerUser(added)).toBe(true);
    expect(added.userId!.toString()).toBe(DANA);
    expect(added.user!.name!.toString()).toBe("Dana Diaz");
    expect(added.user!.email!.toString()).toBe("dana@example.com");
    expect(added.onCallDutyPolicyScheduleLayerId!.toString()).toBe(LAYER_A);
    expect(added.onCallDutyPolicyScheduleId!.toString()).toBe(SCHEDULE);
    expect(added.projectId!.toString()).toBe(PROJECT);
    // An email that is no email is left out, not thrown on.
    expect(again.user!.email).toBeUndefined();

    // Two rows for one person keep two keys, whatever their place.
    expect(getLayerUserRowKey(added, 0)).not.toBe(getLayerUserRowKey(again, 0));
    expect(getLayerUserRowKey(added, 0)).toBe(getLayerUserRowKey(added, 5));

    const row: OnCallDutyPolicyScheduleLayerUser = saved(LAYER_A, ALICE, 1);
    expect(isAddedLayerUser(row)).toBe(false);
    expect(getLayerUserRowKey(row, 3)).toBe(row.id!.toString());
  });

  test("in turn order as the server reads it: by order, twins by id", () => {
    const first: OnCallDutyPolicyScheduleLayerUser = saved(LAYER_A, ALICE, 2);
    const second: OnCallDutyPolicyScheduleLayerUser = saved(LAYER_A, BOB, 2);
    const top: OnCallDutyPolicyScheduleLayerUser = saved(LAYER_A, CAROL, 1);

    expect(ids(sortInTurnOrder([second, first, top]))).toEqual([
      CAROL,
      ALICE,
      BOB,
    ]);

    const a: OnCallDutyPolicyScheduleLayer = layer(LAYER_A, 2);
    const b: OnCallDutyPolicyScheduleLayer = layer(LAYER_B, 1);
    const c: OnCallDutyPolicyScheduleLayer = layer(LAYER_C, 2);
    expect(
      sortInPriorityOrder([c, a, b]).map(
        (row: OnCallDutyPolicyScheduleLayer): string => {
          return row.id!.toString();
        },
      ),
    ).toEqual([LAYER_B, LAYER_A, LAYER_C]);
  });

  test("a drop moves one row, and a drop that goes nowhere leaves the list", () => {
    const list: Array<string> = ["a", "b", "c", "d"];

    expect(moveInList(list, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveInList(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveInList(list, 1, 1)).toBe(list);
    expect(moveInList(list, -1, 2)).toBe(list);
    expect(moveInList(list, 0, 4)).toBe(list);
    // The list it was given is left as it was.
    expect(list).toEqual(["a", "b", "c", "d"]);
  });
});

describe("who the page marks as moved", () => {
  const people: () => Array<OnCallDutyPolicyScheduleLayerUser> =
    (): Array<OnCallDutyPolicyScheduleLayerUser> => {
      return [
        saved(LAYER_A, ALICE, 1),
        saved(LAYER_A, BOB, 2),
        saved(LAYER_A, CAROL, 3),
        saved(LAYER_A, DANA, 4),
      ];
    };

  test("dragging one person to the top marks that one person, not everyone they passed", () => {
    const rows: Array<OnCallDutyPolicyScheduleLayerUser> = people();
    const [alice, bob, carol, dana] = rows;

    expect(
      getMovedLayerUserIds({
        saved: rows,
        draft: [dana!, alice!, bob!, carol!],
      }),
    ).toEqual(new Set<string>([rowId(dana!)]));

    expect(
      getMovedLayerUserIds({
        saved: rows,
        draft: [bob!, carol!, dana!, alice!],
      }),
    ).toEqual(new Set<string>([rowId(alice!)]));
  });

  test("two swapped are one move; the list reversed is all but one", () => {
    const rows: Array<OnCallDutyPolicyScheduleLayerUser> = people();
    const [alice, bob, carol, dana] = rows;

    expect(
      getMovedLayerUserIds({
        saved: rows,
        draft: [bob!, alice!, carol!, dana!],
      }).size,
    ).toBe(1);
    expect(
      getMovedLayerUserIds({
        saved: rows,
        draft: [dana!, carol!, bob!, alice!],
      }).size,
    ).toBe(3);
  });

  test("someone added or taken out moves nobody; nothing changed marks nobody", () => {
    const rows: Array<OnCallDutyPolicyScheduleLayerUser> = people();
    const [alice, bob, carol, dana] = rows;
    const erin: OnCallDutyPolicyScheduleLayerUser = createAddedLayerUser({
      layer: layer(LAYER_A, 1),
      userId: ERIN,
      name: "Erin",
      email: "",
    });

    expect(
      getMovedLayerUserIds({
        saved: rows,
        draft: [erin, alice!, carol!, dana!],
      }),
    ).toEqual(new Set<string>());
    expect(getMovedLayerUserIds({ saved: rows, draft: rows })).toEqual(
      new Set<string>(),
    );
    expect(
      getMovedLayerUserIds({ saved: rows, draft: [alice!, bob!] }),
    ).toEqual(new Set<string>());
    expect(getMovedLayerUserIds({ saved: [], draft: [erin] })).toEqual(
      new Set<string>(),
    );
  });

  test("ids are read in any case", () => {
    const rows: Array<OnCallDutyPolicyScheduleLayerUser> = people();
    const [alice, bob] = rows;
    const shouted: OnCallDutyPolicyScheduleLayerUser =
      new OnCallDutyPolicyScheduleLayerUser();
    shouted._id = bob!.id!.toString().toUpperCase();
    shouted.userId = bob!.userId!;

    expect(
      getMovedLayerUserIds({
        saved: [alice!, bob!],
        draft: [shouted, alice!],
      }),
    ).toEqual(new Set<string>([rowId(bob!)]));
  });
});

describe("someone taken out, and put back", () => {
  test("the people saved and no longer on the page are the ones taken out", () => {
    const alice: OnCallDutyPolicyScheduleLayerUser = saved(LAYER_A, ALICE, 1);
    const bob: OnCallDutyPolicyScheduleLayerUser = saved(LAYER_A, BOB, 2);
    const carol: OnCallDutyPolicyScheduleLayerUser = saved(LAYER_A, CAROL, 3);

    expect(
      ids(getRemovedLayerUsers({ saved: [alice, bob, carol], draft: [carol] })),
    ).toEqual([ALICE, BOB]);
    expect(
      getRemovedLayerUsers({
        saved: [alice, bob, carol],
        draft: [bob, carol, alice],
      }),
    ).toEqual([]);
  });

  test("Undo puts them back where they were: before the next person saved after them who is still there", () => {
    const alice: OnCallDutyPolicyScheduleLayerUser = saved(LAYER_A, ALICE, 1);
    const bob: OnCallDutyPolicyScheduleLayerUser = saved(LAYER_A, BOB, 2);
    const carol: OnCallDutyPolicyScheduleLayerUser = saved(LAYER_A, CAROL, 3);
    const dana: OnCallDutyPolicyScheduleLayerUser = saved(LAYER_A, DANA, 4);
    const all: Array<OnCallDutyPolicyScheduleLayerUser> = [
      alice,
      bob,
      carol,
      dana,
    ];

    // Bob out: back between Alice and Carol.
    expect(
      ids(
        restoreRemovedLayerUser({
          saved: all,
          draft: [alice, carol, dana],
          layerUser: bob,
        }),
      ),
    ).toEqual([ALICE, BOB, CAROL, DANA]);

    // Bob and Carol out, Carol back first: before Dana.
    expect(
      ids(
        restoreRemovedLayerUser({
          saved: all,
          draft: [alice, dana],
          layerUser: carol,
        }),
      ),
    ).toEqual([ALICE, CAROL, DANA]);

    // Everyone after Dana is gone: Dana back at the end.
    expect(
      ids(
        restoreRemovedLayerUser({
          saved: all,
          draft: [bob, alice],
          layerUser: dana,
        }),
      ),
    ).toEqual([BOB, ALICE, DANA]);

    // Someone already there is not put back twice.
    const draft: Array<OnCallDutyPolicyScheduleLayerUser> = [alice, bob];
    expect(
      restoreRemovedLayerUser({ saved: all, draft: draft, layerUser: bob }),
    ).toBe(draft);
  });

  test("the one row is the same object, or saved with the same id", () => {
    const bob: OnCallDutyPolicyScheduleLayerUser = saved(LAYER_A, BOB, 2);
    const copy: OnCallDutyPolicyScheduleLayerUser =
      new OnCallDutyPolicyScheduleLayerUser();
    copy._id = bob.id!.toString().toUpperCase();
    const added: OnCallDutyPolicyScheduleLayerUser = createAddedLayerUser({
      layer: layer(LAYER_A, 1),
      userId: BOB,
      name: "",
      email: "",
    });
    const addedAgain: OnCallDutyPolicyScheduleLayerUser = createAddedLayerUser({
      layer: layer(LAYER_A, 1),
      userId: BOB,
      name: "",
      email: "",
    });

    expect(isSameLayerUserRow(bob, copy)).toBe(true);
    expect(isSameLayerUserRow(added, added)).toBe(true);
    // Two people added are two rows, though they are one person.
    expect(isSameLayerUserRow(added, addedAgain)).toBe(false);
    expect(isSameLayerUserRow(bob, added)).toBe(false);
  });
});

describe("a layer moved up or down", () => {
  test("swaps places with the next layer", () => {
    const order: Array<string> = [LAYER_A, LAYER_B, LAYER_C];

    expect(
      moveLayerInOrder({
        layerOrder: order,
        deletedLayerIds: new Set<string>(),
        layerId: LAYER_C,
        direction: "up",
      }),
    ).toEqual([LAYER_A, LAYER_C, LAYER_B]);
    expect(
      moveLayerInOrder({
        layerOrder: order,
        deletedLayerIds: new Set<string>(),
        layerId: LAYER_A.toUpperCase(),
        direction: "down",
      }),
    ).toEqual([LAYER_B, LAYER_A, LAYER_C]);
  });

  test("steps over a layer to be deleted, which keeps its place", () => {
    expect(
      moveLayerInOrder({
        layerOrder: [LAYER_A, LAYER_B, LAYER_C],
        deletedLayerIds: new Set<string>([LAYER_B]),
        layerId: LAYER_C,
        direction: "up",
      }),
    ).toEqual([LAYER_C, LAYER_B, LAYER_A]);
  });

  test("at the top or the bottom, or past only layers to be deleted, stays", () => {
    const order: Array<string> = [LAYER_A, LAYER_B, LAYER_C];

    expect(
      moveLayerInOrder({
        layerOrder: order,
        deletedLayerIds: new Set<string>(),
        layerId: LAYER_A,
        direction: "up",
      }),
    ).toBe(order);
    expect(
      moveLayerInOrder({
        layerOrder: order,
        deletedLayerIds: new Set<string>([LAYER_C]),
        layerId: LAYER_B,
        direction: "down",
      }),
    ).toBe(order);
    expect(
      moveLayerInOrder({
        layerOrder: order,
        deletedLayerIds: new Set<string>(),
        layerId: "0d750000-0000-4000-8000-00000000000f",
        direction: "down",
      }),
    ).toBe(order);
  });
});

describe("what Save sends", () => {
  test("the layers kept, in the page's order, each with its people in theirs - and the layers deleted", () => {
    const alice: OnCallDutyPolicyScheduleLayerUser = saved(LAYER_A, ALICE, 1);
    const bob: OnCallDutyPolicyScheduleLayerUser = saved(LAYER_A, BOB, 2);
    const carol: OnCallDutyPolicyScheduleLayerUser = saved(LAYER_B, CAROL, 1);
    const dana: OnCallDutyPolicyScheduleLayerUser = createAddedLayerUser({
      layer: layer(LAYER_B, 2),
      userId: DANA,
      name: "Dana",
      email: "",
    });

    const layerUsers: Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>> = {
      [LAYER_A]: [bob, alice],
      [LAYER_B]: [carol, dana],
      [LAYER_C]: [],
    };

    const request: ScheduleLayersSaveRequest = buildScheduleLayersSaveRequest({
      basedOnVersion: "v1",
      layerOrder: [LAYER_B, LAYER_C, LAYER_A],
      deletedLayerIds: new Set<string>([LAYER_C]),
      layerUsers: layerUsers,
    });

    expect(request).toEqual({
      basedOnVersion: "v1",
      layers: [
        {
          layerId: LAYER_B,
          users: [
            { layerUserId: carol.id!.toString(), userId: CAROL },
            { userId: DANA },
          ],
        },
        {
          layerId: LAYER_A,
          users: [
            { layerUserId: bob.id!.toString(), userId: BOB },
            { layerUserId: alice.id!.toString(), userId: ALICE },
          ],
        },
      ],
      deletedLayerIds: [LAYER_C],
    });
  });

  test("with nothing changed, it is the save that changes nothing - at the version of the layers as saved", () => {
    const layers: Array<OnCallDutyPolicyScheduleLayer> = [
      layer(LAYER_A, 1),
      layer(LAYER_B, 2),
    ];
    const layerUsers: Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>> = {
      [LAYER_A]: [saved(LAYER_A, ALICE, 1), saved(LAYER_A, BOB, 2)],
      [LAYER_B]: [saved(LAYER_B, CAROL, 1)],
    };

    const state: ScheduleLayersState = getScheduleLayersState({
      layers: layers,
      layerUsers: layerUsers,
    });

    expect(state.layers).toEqual([
      { id: LAYER_A, order: 1 },
      { id: LAYER_B, order: 2 },
    ]);
    expect(state.layerUsers.length).toBe(3);

    const request: ScheduleLayersSaveRequest = buildScheduleLayersSaveRequest({
      basedOnVersion: ScheduleLayersSaveUtil.getVersion(state),
      layerOrder: [LAYER_A, LAYER_B],
      deletedLayerIds: new Set<string>(),
      layerUsers: layerUsers,
    });

    expect(request).toEqual(ScheduleLayersSaveUtil.getUnchangedRequest(state));
    expect(
      ScheduleLayersSaveUtil.plan({ state: state, request: request }).changes
        .hasChanges,
    ).toBe(false);
  });

  test("someone added is no row of the saved state", () => {
    const state: ScheduleLayersState = getScheduleLayersState({
      layers: [layer(LAYER_A, 1)],
      layerUsers: {
        [LAYER_A]: [
          createAddedLayerUser({
            layer: layer(LAYER_A, 1),
            userId: DANA,
            name: "",
            email: "",
          }),
        ],
      },
    });

    expect(state.layerUsers).toEqual([]);
  });
});

describe("the bar's lines", () => {
  const names: Record<string, string> = {
    [LAYER_A]: "Primary",
    [LAYER_B]: "Backup",
    [LAYER_C]: "Weekend",
  };

  function lines(changes: ScheduleLayersChanges | null): Array<string> {
    return getLayersChangeLines({
      changes: changes,
      getLayerName: (layerId: string): string => {
        return names[layerId] || "?";
      },
      translator: english,
    });
  }

  test("name each change in plain words: deleted layers, the priority, then each layer's people", () => {
    expect(
      lines({
        hasChanges: true,
        isLayerOrderChanged: true,
        deletedLayerIds: [LAYER_C],
        layers: [
          {
            layerId: LAYER_A,
            addedCount: 2,
            removedCount: 1,
            isTurnOrderChanged: true,
          },
          {
            layerId: LAYER_B,
            addedCount: 1,
            removedCount: 3,
            isTurnOrderChanged: false,
          },
        ],
      }),
    ).toEqual([
      "Weekend will be deleted",
      "Layers in a new priority order",
      "2 users added to Primary",
      "1 user removed from Primary",
      "New turn order in Primary",
      "1 user added to Backup",
      "3 users removed from Backup",
    ]);
  });

  test("with the changes not worked out, one line says there are some", () => {
    expect(lines(null)).toEqual(["Changes to the layers"]);
  });

  test("the bar names the first few and counts the rest", () => {
    expect(LAYERS_SAVE_BAR_SHOWN_CHANGES).toBe(3);
  });
});

describe("Save, as the page sends it", () => {
  test("goes to the schedule's own save route", () => {
    expect(
      getScheduleLayersSaveUrl(new ObjectID(SCHEDULE)).toString(),
    ).toContain(`/on-call-duty-policy-schedule/${SCHEDULE}/save-layers`);
  });

  test("a 409 is someone else's change; any other refusal is not", () => {
    expect(
      isScheduleLayersSaveConflict(
        new HTTPErrorResponse(409, { error: "changed" }, {}),
      ),
    ).toBe(true);
    expect(
      isScheduleLayersSaveConflict(
        new HTTPErrorResponse(400, { error: "no" }, {}),
      ),
    ).toBe(false);
    expect(isScheduleLayersSaveConflict(new Error("offline"))).toBe(false);
    expect(isScheduleLayersSaveConflict(null)).toBe(false);
  });
});
