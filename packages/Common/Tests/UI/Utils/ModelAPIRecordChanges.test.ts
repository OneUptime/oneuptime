import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import DashboardAPI from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import RecordChanges, {
  RecordChange,
  RecordChangeKind,
} from "../../../UI/Utils/ModelAPI/RecordChanges";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * MODELAPI TELLS THE PAGE WHAT IT CREATED AND DELETED (#7465, #8204).
 *
 * The products menu said "Monitors - Not set up" after the guided setup
 * made the project's first monitor: nothing told it a monitor was created.
 * And it said Monitors was in use for fifteen seconds after the project's
 * last monitor was deleted: nothing told it of the delete. Every create the
 * Dashboard makes - a form, a guided setup, an import - goes through
 * ModelAPI.createOrUpdate, and every delete - a table's row, a bulk delete,
 * a record's own page - through ModelAPI.deleteItem, so that is where the
 * page hears of them (RecordChanges): the kind of change, the record's
 * table and project, once the server has confirmed it, and never for an
 * update or a change the server refused.
 */

const PROJECT_ID: string = "7a000000-0000-4000-8000-00000000c001";
const OPEN_PROJECT_ID: string = "7b000000-0000-4000-8000-00000000c002";
const MONITOR_ID: string = "7c000000-0000-4000-8000-00000000c003";

let heard: Array<RecordChange>;
let stopHearing: () => void;
let fetchSpy: SpyInstance<typeof DashboardAPI.fetch>;

function answered(data: JSONObject): void {
  fetchSpy.mockResolvedValue(new HTTPResponse(200, data, {}) as never);
}

function refused(status: number, message: string): void {
  fetchSpy.mockResolvedValue(
    new HTTPErrorResponse(status, { message: message }, {}) as never,
  );
}

function monitor(): Monitor {
  const item: Monitor = new Monitor();
  item.name = "checkout-api";
  return item;
}

beforeEach(() => {
  heard = [];
  stopHearing = RecordChanges.subscribe((change: RecordChange): void => {
    heard.push(change);
  });
  fetchSpy = jest.spyOn(DashboardAPI, "fetch") as unknown as SpyInstance<
    typeof DashboardAPI.fetch
  >;
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(OPEN_PROJECT_ID));
});

afterEach(() => {
  stopHearing();
  jest.restoreAllMocks();
});

describe("ModelAPI announces a create the server confirmed", () => {
  test("a monitor: its table, and the project the server stored it in", async () => {
    answered({
      _id: MONITOR_ID,
      name: "checkout-api",
      projectId: { _type: "ObjectID", value: PROJECT_ID },
    });

    await ModelAPI.create<Monitor>({ model: monitor(), modelType: Monitor });

    expect(heard).toEqual([
      {
        kind: RecordChangeKind.Created,
        tableName: "Monitor",
        projectId: PROJECT_ID,
      },
    ]);
  });

  test("an answer that names no project: the project it was asked in", async () => {
    answered({ _id: MONITOR_ID, name: "checkout-api" });

    await ModelAPI.create<Monitor>({ model: monitor(), modelType: Monitor });

    expect(heard).toEqual([
      {
        kind: RecordChangeKind.Created,
        tableName: "Monitor",
        projectId: OPEN_PROJECT_ID,
      },
    ]);
  });

  test("an on-call policy made through createOrUpdate, as a guided setup makes it", async () => {
    answered({
      _id: MONITOR_ID,
      projectId: { _type: "ObjectID", value: PROJECT_ID },
    });

    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy.name = "Primary on-call";

    await ModelAPI.createOrUpdate<OnCallDutyPolicy>({
      model: policy,
      modelType: OnCallDutyPolicy,
      formType: FormType.Create,
    });

    expect(heard).toEqual([
      {
        kind: RecordChangeKind.Created,
        tableName: "OnCallDutyPolicy",
        projectId: PROJECT_ID,
      },
    ]);
  });

  test("an update is no create: nothing is announced", async () => {
    answered({ _id: MONITOR_ID });

    const item: Monitor = monitor();
    item._id = MONITOR_ID;

    await ModelAPI.update<Monitor>({ model: item, modelType: Monitor });
    await ModelAPI.createOrUpdate<Monitor>({
      model: item,
      modelType: Monitor,
      formType: FormType.Update,
    });

    expect(heard).toEqual([]);
  });

  test("a create the server refused announces nothing", async () => {
    refused(400, "Name is required");

    await expect(
      ModelAPI.create<Monitor>({ model: monitor(), modelType: Monitor }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);

    expect(heard).toEqual([]);
  });

  test("a listener that throws stops neither the create nor the others", async () => {
    answered({ _id: MONITOR_ID });
    const stopThrowing: () => void = RecordChanges.subscribe((): void => {
      throw new Error("a listener's own bug");
    });

    try {
      const response: HTTPResponse<
        JSONObject | JSONArray | Monitor | Array<Monitor>
      > = await ModelAPI.create<Monitor>({
        model: monitor(),
        modelType: Monitor,
      });

      expect(response.isSuccess()).toBe(true);
      expect(heard).toHaveLength(1);
    } finally {
      stopThrowing();
    }
  });
});

describe("ModelAPI announces a delete the server confirmed (#8204)", () => {
  test("a monitor: its table, and the project it was deleted in", async () => {
    answered({});

    await ModelAPI.deleteItem<Monitor>({
      modelType: Monitor,
      id: new ObjectID(MONITOR_ID),
    });

    expect(heard).toEqual([
      {
        kind: RecordChangeKind.Deleted,
        tableName: "Monitor",
        projectId: OPEN_PROJECT_ID,
      },
    ]);
  });

  test("the request is the delete it always was: DELETE of the record, in the open project", async () => {
    answered({});

    await ModelAPI.deleteItem<Monitor>({
      modelType: Monitor,
      id: new ObjectID(MONITOR_ID),
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const request: {
      method: HTTPMethod;
      url: { toString: () => string };
      headers: Record<string, string>;
    } = fetchSpy.mock.calls[0]![0] as never;
    expect(request.method).toBe(HTTPMethod.DELETE);
    expect(request.url.toString()).toContain(`/monitor/${MONITOR_ID}`);
    expect(request.headers["tenantid"]).toBe(OPEN_PROJECT_ID);
  });

  test("a record of no product is announced too: the listener decides what it means", async () => {
    answered({});

    await ModelAPI.deleteItem<Label>({
      modelType: Label,
      id: new ObjectID(MONITOR_ID),
    });

    expect(heard).toEqual([
      {
        kind: RecordChangeKind.Deleted,
        tableName: "Label",
        projectId: OPEN_PROJECT_ID,
      },
    ]);
  });

  test("a delete across projects names none: the listener takes the open one", async () => {
    answered({});

    await ModelAPI.deleteItem<Monitor>({
      modelType: Monitor,
      id: new ObjectID(MONITOR_ID),
      requestOptions: { isMultiTenantRequest: true },
    });

    expect(heard).toEqual([
      {
        kind: RecordChangeKind.Deleted,
        tableName: "Monitor",
        projectId: null,
      },
    ]);
  });

  test("a delete the server refused announces nothing", async () => {
    refused(403, "You do not have permission to delete this monitor");

    await expect(
      ModelAPI.deleteItem<Monitor>({
        modelType: Monitor,
        id: new ObjectID(MONITOR_ID),
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);

    expect(heard).toEqual([]);
  });

  test("a listener that throws stops neither the delete nor the others", async () => {
    answered({});
    const stopThrowing: () => void = RecordChanges.subscribe((): void => {
      throw new Error("a listener's own bug");
    });

    try {
      await expect(
        ModelAPI.deleteItem<Monitor>({
          modelType: Monitor,
          id: new ObjectID(MONITOR_ID),
        }),
      ).resolves.toBeUndefined();

      expect(heard).toHaveLength(1);
    } finally {
      stopThrowing();
    }
  });
});

describe("RecordChanges", () => {
  test("a listener hears every change until it stops", () => {
    RecordChanges.announce({
      kind: RecordChangeKind.Created,
      tableName: "Monitor",
      projectId: PROJECT_ID,
    });
    RecordChanges.announce({
      kind: RecordChangeKind.Deleted,
      tableName: "Monitor",
      projectId: PROJECT_ID,
    });
    stopHearing();
    RecordChanges.announce({
      kind: RecordChangeKind.Created,
      tableName: "Monitor",
      projectId: PROJECT_ID,
    });

    expect(
      heard.map((change: RecordChange): RecordChangeKind => {
        return change.kind;
      }),
    ).toEqual([RecordChangeKind.Created, RecordChangeKind.Deleted]);
  });

  test("each listener gets its own copy", () => {
    const changed: Array<RecordChange> = [];
    const stop: () => void = RecordChanges.subscribe(
      (change: RecordChange): void => {
        change.tableName = "Changed";
        changed.push(change);
      },
    );

    try {
      RecordChanges.announce({
        kind: RecordChangeKind.Deleted,
        tableName: "Monitor",
        projectId: null,
      });
    } finally {
      stop();
    }

    expect(changed).toHaveLength(1);
    expect(heard).toEqual([
      { kind: RecordChangeKind.Deleted, tableName: "Monitor", projectId: null },
    ]);
  });

  test("a change with no table is not announced", () => {
    RecordChanges.announce({
      kind: RecordChangeKind.Created,
      tableName: "",
      projectId: PROJECT_ID,
    });
    RecordChanges.announce({
      kind: RecordChangeKind.Deleted,
      tableName: "",
      projectId: PROJECT_ID,
    });

    expect(heard).toEqual([]);
  });
});
