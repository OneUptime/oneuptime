import ListChangesUtil, {
  ADD_TO_LIST_KEY,
  ListChanges,
  REMOVE_FROM_LIST_KEY,
} from "../../../Types/Database/ListChanges";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * What an update's addToList and removeFromList say (#10135): which list,
 * which entries, each once - and the refusals that say what to send
 * instead. Read by the server (BaseAPI), and written by the Dashboard
 * (ModelAPI) and the providers, which send the same body.
 */

const A: string = "a0000000-0000-4000-8000-000000000001";
const B: string = "b0000000-0000-4000-8000-000000000002";
const C: string = "c0000000-0000-4000-8000-000000000003";

const LISTS: Array<string> = ["labels", "dependsOnMonitors"];

function read(body: JSONObject): ListChanges | null {
  return ListChangesUtil.fromRequestBody({
    body,
    listColumns: LISTS,
    modelName: "Monitor",
  });
}

function refusalOf(body: JSONObject): string {
  try {
    read(body);
  } catch (err) {
    expect(err).toBeInstanceOf(BadDataException);
    return (err as BadDataException).message;
  }

  throw new Error("The body was not refused.");
}

describe("the body's keys", () => {
  test("are addToList and removeFromList", () => {
    expect(ADD_TO_LIST_KEY).toBe("addToList");
    expect(REMOVE_FROM_LIST_KEY).toBe("removeFromList");
  });
});

describe("reading what a request body says", () => {
  test("a body that names no list change is none", () => {
    expect(read({ data: { name: "Checkout" } })).toBeNull();
    expect(read({})).toBeNull();
    expect(
      ListChangesUtil.fromRequestBody({
        body: undefined,
        listColumns: LISTS,
        modelName: "Monitor",
      }),
    ).toBeNull();
    expect(read({ addToList: null, removeFromList: null })).toBeNull();
    expect(read({ addToList: {}, removeFromList: {} })).toBeNull();
  });

  test("entries added and taken off, by list", () => {
    expect(
      read({
        addToList: { labels: [A, B], dependsOnMonitors: [C] },
        removeFromList: { labels: [C] },
      }),
    ).toEqual({
      labels: { add: [A, B], remove: [C] },
      dependsOnMonitors: { add: [C], remove: [] },
    });
  });

  test("an entry is an ID, an object with its _id or id, or an ObjectID as JSON", () => {
    expect(
      read({
        addToList: {
          labels: [
            A,
            { _id: B },
            { id: C },
            {
              _type: "ObjectID",
              value: "d0000000-0000-4000-8000-000000000004",
            },
            {
              _id: {
                _type: "ObjectID",
                value: "e0000000-0000-4000-8000-000000000005",
              },
            },
          ],
        },
      }),
    ).toEqual({
      labels: {
        add: [
          A,
          B,
          C,
          "d0000000-0000-4000-8000-000000000004",
          "e0000000-0000-4000-8000-000000000005",
        ],
        remove: [],
      },
    });
  });

  test("an entry named twice, in any case, is one entry", () => {
    expect(
      read({ addToList: { labels: [A, A.toUpperCase(), { _id: A }] } }),
    ).toEqual({
      labels: { add: [A], remove: [] },
    });
  });

  test("an empty list of entries is no change of that list, and the others stand", () => {
    expect(read({ addToList: { labels: [] } })).toEqual({
      labels: { add: [], remove: [] },
    });
  });
});

describe("a body that cannot be read is refused, saying what to send", () => {
  test("lists that are not an object", () => {
    expect(refusalOf({ addToList: [A] })).toBe(
      'addToList lists the entries of each list by its field, such as { "labels": ["<label id>"] }. Send an object.',
    );
    expect(refusalOf({ removeFromList: "labels" })).toBe(
      'removeFromList lists the entries of each list by its field, such as { "labels": ["<label id>"] }. Send an object.',
    );
  });

  test("a field that is not one of the model's lists, naming the ones it has", () => {
    expect(refusalOf({ addToList: { name: [A] } })).toBe(
      "Monitor has no list of related records called name. addToList can name: labels, dependsOnMonitors.",
    );
  });

  test("a model with no list at all", () => {
    expect(() => {
      ListChangesUtil.fromRequestBody({
        body: { removeFromList: { labels: [A] } },
        listColumns: [],
        modelName: "Network Site",
      });
    }).toThrow(
      "Network Site has no list of related records, so removeFromList cannot name labels. Send the field in data instead.",
    );
  });

  test("entries that are not a list", () => {
    expect(refusalOf({ addToList: { labels: A } })).toBe(
      'addToList.labels lists the IDs of the records to add, such as ["<id>"]. Send a list.',
    );
    expect(refusalOf({ removeFromList: { labels: { _id: A } } })).toBe(
      'removeFromList.labels lists the IDs of the records to take off, such as ["<id>"]. Send a list.',
    );
  });

  test("an entry that is not a record's ID", () => {
    for (const entry of ["production", 7, null, [A], { name: "Production" }]) {
      expect(refusalOf({ addToList: { labels: [entry] } })).toBe(
        `addToList.labels has an entry that is not the ID of a record: ${JSON.stringify(entry)}. Send the record's ID, or an object with its _id.`,
      );
    }
  });

  test("the same entry added and taken off", () => {
    expect(
      refusalOf({
        addToList: { labels: [A, B] },
        removeFromList: { labels: [B.toUpperCase()] },
      }),
    ).toBe(
      `${B} is both added to labels and taken off it. Send it in addToList or in removeFromList, not both.`,
    );
  });
});

describe("writing it, as a client sends it", () => {
  test("each side only where it has entries", () => {
    expect(
      ListChangesUtil.toRequestBody({
        labels: { add: [A], remove: [B] },
        dependsOnMonitors: { add: [], remove: [C] },
        services: { add: [], remove: [] },
      }),
    ).toEqual({
      addToList: { labels: [A] },
      removeFromList: { labels: [B], dependsOnMonitors: [C] },
    });

    expect(ListChangesUtil.toRequestBody({})).toEqual({});
  });

  test("is read back as it was written", () => {
    const changes: ListChanges = {
      labels: { add: [A, B], remove: [C] },
    };

    expect(read(ListChangesUtil.toRequestBody(changes))).toEqual(changes);
  });
});

describe("a list after the change", () => {
  test("loses the entries taken off, keeps its order, and gains each new one once", () => {
    expect(
      ListChangesUtil.apply([A, B], { add: [C, A.toUpperCase()], remove: [B] }),
    ).toEqual([A, C]);
  });

  test("taking off an entry it does not have, or adding one it has, changes nothing", () => {
    expect(ListChangesUtil.apply([A], { add: [A], remove: [B] })).toEqual([A]);
  });

  test("its last entry can go", () => {
    expect(ListChangesUtil.apply([A], { add: [], remove: [A] })).toEqual([]);
  });
});

describe("an entry's ID", () => {
  test("is read from what a list holds, or null", () => {
    expect(ListChangesUtil.getEntryId(` ${A} `)).toBe(A);
    expect(ListChangesUtil.getEntryId(new ObjectID(A))).toBe(A);
    expect(ListChangesUtil.getEntryId({ _id: A, name: "Production" })).toBe(A);
    expect(ListChangesUtil.getEntryId("not-an-id")).toBeNull();
    expect(ListChangesUtil.getEntryId(undefined)).toBeNull();
    expect(ListChangesUtil.getEntryId({})).toBeNull();
  });

  test("compares whatever its case", () => {
    expect(ListChangesUtil.includes([A], A.toUpperCase())).toBe(true);
    expect(ListChangesUtil.includes([A], B)).toBe(false);
  });
});
