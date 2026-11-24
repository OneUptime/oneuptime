import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Select from "../../../Types/BaseDatabase/Select";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  ItemInParts,
  SplitSelect,
  getItemInParts,
  splitSelect,
} from "../../../UI/Utils/ModelAPI/ItemInParts";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

/*
 * A RECORD'S PAGE SHOWS WHAT IT CAN (#10238): getItemInParts reads a record
 * and the records it names in one read, as every page does, and only when
 * the server refuses that read does it read again in parts - the record's
 * own columns, then each record it names - so one related record the
 * server will not read never takes the record itself off its page.
 */

const ISSUE_ID: ObjectID = new ObjectID("10238000-0000-4000-8000-0000000000a1");

const REFUSAL: string =
  "Column dataTypeIds on Data Store does not support read on relation query.";

const SELECT: Select<DataSecurityIssue> = {
  _id: true,
  title: true,
  severity: true,
  dataStore: { _id: true, name: true, dataTypeIds: true },
  assignedToUser: { name: true },
  assignedToTeam: { name: true },
};

function refused(message: string, status: number = 400): HTTPErrorResponse {
  return new HTTPErrorResponse(status, { error: message }, {});
}

function issueWith(json: JSONObject): DataSecurityIssue {
  return DataSecurityIssue.fromJSON(
    { _id: ISSUE_ID.toString(), ...json },
    DataSecurityIssue,
  ) as DataSecurityIssue;
}

const ISSUE_ROW: JSONObject = {
  title: "Anyone on the internet can read it",
  severity: "Critical",
};

let reads: Array<JSONObject>;

/*
 * The server, as the page meets it: `refuse` says which reads it refuses,
 * by the select each one sends, and every other read is answered.
 */
function serve(refuse: (select: JSONObject) => HTTPErrorResponse | null): void {
  jest.spyOn(ModelAPI, "getItem").mockImplementation((async (data: {
    select: JSONObject;
  }): Promise<DataSecurityIssue | null> => {
    reads.push(data.select);

    const refusal: HTTPErrorResponse | null = refuse(data.select);

    if (refusal) {
      throw refusal;
    }

    const answer: JSONObject = {};

    for (const key of Object.keys(data.select)) {
      if (key === "dataStore") {
        answer["dataStore"] = { _id: "store-1", name: "customer-exports" };
      } else if (key === "assignedToUser") {
        answer["assignedToUser"] = { name: "Jane Doe" };
      } else if (key === "assignedToTeam") {
        answer["assignedToTeam"] = { name: "Data Platform" };
      } else if (key in ISSUE_ROW) {
        answer[key] = ISSUE_ROW[key]!;
      }
    }

    return issueWith(answer);
  }) as never);
}

async function read(): Promise<ItemInParts<DataSecurityIssue>> {
  return await getItemInParts<DataSecurityIssue>({
    modelType: DataSecurityIssue,
    id: ISSUE_ID,
    select: SELECT,
  });
}

beforeEach(() => {
  reads = [];
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("splitSelect", () => {
  test("puts the record's own columns, and its id, apart from each record it names, in the select's order", () => {
    const split: SplitSelect<DataSecurityIssue> = splitSelect(SELECT);

    expect(split.own).toEqual({ _id: true, title: true, severity: true });
    expect(split.relations).toEqual([
      ["dataStore", { _id: true, name: true, dataTypeIds: true }],
      ["assignedToUser", { name: true }],
      ["assignedToTeam", { name: true }],
    ]);
  });

  test("a select that names no other record has no relations, and keeps its id", () => {
    expect(splitSelect<DataStore>({ name: true })).toEqual({
      own: { _id: true, name: true },
      relations: [],
    });
  });
});

describe("getItemInParts", () => {
  test("a read the server answers is one request, whole", async () => {
    serve(() => {
      return null;
    });

    const result: ItemInParts<DataSecurityIssue> = await read();

    expect(reads).toEqual([SELECT]);
    expect(result.unloadedParts).toEqual([]);
    expect(result.item?.title).toBe("Anyone on the internet can read it");
    expect(result.item?.dataStore?.name).toBe("customer-exports");
    expect(result.item?.assignedToUser?.name?.toString()).toBe("Jane Doe");
  });

  test("a read refused for one record it names shows the record with every other one, and names the one it could not read, with why", async () => {
    // As #10238's server did: the whole read, and the store's own, refused.
    serve((select: JSONObject): HTTPErrorResponse | null => {
      return select["dataStore"] ? refused(REFUSAL) : null;
    });

    const result: ItemInParts<DataSecurityIssue> = await read();

    expect(result.item?.title).toBe("Anyone on the internet can read it");
    expect(result.item?.severity).toBe("Critical");
    expect(result.item?.dataStore).toBeUndefined();
    expect(result.item?.assignedToUser?.name?.toString()).toBe("Jane Doe");
    expect(result.item?.assignedToTeam?.name).toBe("Data Platform");
    expect(result.unloadedParts).toEqual([
      { relation: "dataStore", error: REFUSAL },
    ]);

    // The whole read, its own columns, then each record it names on its own.
    expect(reads).toEqual([
      SELECT,
      { _id: true, title: true, severity: true },
      { _id: true, dataStore: { _id: true, name: true, dataTypeIds: true } },
      { _id: true, assignedToUser: { name: true } },
      { _id: true, assignedToTeam: { name: true } },
    ]);
  });

  test("several records it could not read are each named, in the select's order", async () => {
    serve((select: JSONObject): HTTPErrorResponse | null => {
      if (select["assignedToTeam"]) {
        return refused("You do not have permissions to read Team.", 403);
      }

      return select["dataStore"] ? refused(REFUSAL) : null;
    });

    const result: ItemInParts<DataSecurityIssue> = await read();

    expect(result.item?.assignedToUser?.name?.toString()).toBe("Jane Doe");
    expect(result.unloadedParts).toEqual([
      { relation: "dataStore", error: REFUSAL },
      {
        relation: "assignedToTeam",
        error: "You do not have permissions to read Team.",
      },
    ]);
  });

  test("a read that failed for a moment, answered in parts, is whole again", async () => {
    let isFirst: boolean = true;

    serve((): HTTPErrorResponse | null => {
      if (isFirst) {
        isFirst = false;
        return refused("Something went wrong for a moment.", 502);
      }

      return null;
    });

    const result: ItemInParts<DataSecurityIssue> = await read();

    expect(result.unloadedParts).toEqual([]);
    expect(result.item?.dataStore?.name).toBe("customer-exports");
    expect(result.item?.assignedToTeam?.name).toBe("Data Platform");
  });

  test("a record whose own columns cannot be read either is not shown: that read's reason is thrown", async () => {
    serve((select: JSONObject): HTTPErrorResponse | null => {
      return select["title"]
        ? refused(
            "You do not have permissions to read Data Security Issue.",
            403,
          )
        : null;
    });

    let thrown: unknown = null;

    try {
      await read();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(HTTPErrorResponse);
    expect((thrown as HTTPErrorResponse).message).toBe(
      "You do not have permissions to read Data Security Issue.",
    );
    // Nothing is read in parts once the record itself cannot be.
    expect(reads).toHaveLength(2);
  });

  test("a read that names no other record is not read again: its own refusal is thrown", async () => {
    jest
      .spyOn(ModelAPI, "getItem")
      .mockRejectedValue(refused("Data Store not found.", 500) as never);

    await expect(
      getItemInParts<DataStore>({
        modelType: DataStore,
        id: ISSUE_ID,
        select: { _id: true, name: true },
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
    expect(ModelAPI.getItem).toHaveBeenCalledTimes(1);
  });

  test("a record that is not there is no record, whole or read in parts", async () => {
    jest.spyOn(ModelAPI, "getItem").mockResolvedValue(null as never);

    expect(await read()).toEqual({ item: null, unloadedParts: [] });

    jest.restoreAllMocks();

    let isFirst: boolean = true;
    jest
      .spyOn(ModelAPI, "getItem")
      .mockImplementation((async (): Promise<DataSecurityIssue | null> => {
        if (isFirst) {
          isFirst = false;
          throw refused(REFUSAL);
        }

        // Deleted between the two reads.
        return null;
      }) as never);

    expect(await read()).toEqual({ item: null, unloadedParts: [] });
  });

  test("a related record that is not there leaves the record as it is, with nothing named", async () => {
    let isFirst: boolean = true;

    jest.spyOn(ModelAPI, "getItem").mockImplementation((async (data: {
      select: JSONObject;
    }): Promise<DataSecurityIssue | null> => {
      if (isFirst) {
        isFirst = false;
        throw refused(REFUSAL);
      }

      if (data.select["title"]) {
        return issueWith(ISSUE_ROW);
      }

      // Each part read answers the issue without the record it names.
      return issueWith({});
    }) as never);

    const result: ItemInParts<DataSecurityIssue> = await read();

    expect(result.unloadedParts).toEqual([]);
    expect(result.item?.title).toBe("Anyone on the internet can read it");
    expect(result.item?.dataStore).toBeUndefined();
    expect(result.item?.assignedToUser).toBeUndefined();
  });

  test("related records are put back as the models they are", async () => {
    serve((select: JSONObject): HTTPErrorResponse | null => {
      return select["dataStore"] && select["title"] ? refused(REFUSAL) : null;
    });

    const result: ItemInParts<DataSecurityIssue> = await read();

    expect(result.unloadedParts).toEqual([]);
    expect(result.item?.dataStore).toBeInstanceOf(DataStore);
    expect(result.item?.assignedToUser).toBeInstanceOf(User);
    expect(result.item?.assignedToTeam).toBeInstanceOf(Team);
  });
});
