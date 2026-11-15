import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import DashboardAPI from "../../../UI/Utils/API/API";
import CreatedRecords, {
  CreatedRecord,
} from "../../../UI/Utils/ModelAPI/CreatedRecords";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * MODELAPI TELLS THE PAGE WHAT IT CREATED (#7465).
 *
 * The products menu said "Monitors - Not set up" after the guided setup
 * made the project's first monitor: nothing told it a monitor was created.
 * Every create the Dashboard makes - a form, a guided setup, an import -
 * goes through ModelAPI.createOrUpdate, so that is where the page hears of
 * it (CreatedRecords): the record's table and project, once the server has
 * confirmed it, and never for an update or a create the server refused.
 */

const PROJECT_ID: string = "7a000000-0000-4000-8000-00000000c001";
const OPEN_PROJECT_ID: string = "7b000000-0000-4000-8000-00000000c002";
const MONITOR_ID: string = "7c000000-0000-4000-8000-00000000c003";

let heard: Array<CreatedRecord>;
let stopHearing: () => void;
let fetchSpy: SpyInstance<typeof DashboardAPI.fetch>;

function answered(data: JSONObject): void {
  fetchSpy.mockResolvedValue(new HTTPResponse(200, data, {}) as never);
}

function monitor(): Monitor {
  const item: Monitor = new Monitor();
  item.name = "checkout-api";
  return item;
}

beforeEach(() => {
  heard = [];
  stopHearing = CreatedRecords.subscribe((record: CreatedRecord): void => {
    heard.push(record);
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

    expect(heard).toEqual([{ tableName: "Monitor", projectId: PROJECT_ID }]);
  });

  test("an answer that names no project: the project it was asked in", async () => {
    answered({ _id: MONITOR_ID, name: "checkout-api" });

    await ModelAPI.create<Monitor>({ model: monitor(), modelType: Monitor });

    expect(heard).toEqual([
      { tableName: "Monitor", projectId: OPEN_PROJECT_ID },
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
      { tableName: "OnCallDutyPolicy", projectId: PROJECT_ID },
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
    fetchSpy.mockResolvedValue(
      new HTTPErrorResponse(400, { message: "Name is required" }, {}) as never,
    );

    await expect(
      ModelAPI.create<Monitor>({ model: monitor(), modelType: Monitor }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);

    expect(heard).toEqual([]);
  });

  test("a listener that throws stops neither the create nor the others", async () => {
    answered({ _id: MONITOR_ID });
    const stopThrowing: () => void = CreatedRecords.subscribe((): void => {
      throw new Error("a listener's own bug");
    });

    try {
      const response: HTTPResponse<unknown> = await ModelAPI.create<Monitor>({
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

describe("CreatedRecords", () => {
  test("a listener hears every create until it stops", () => {
    CreatedRecords.announce({ tableName: "Monitor", projectId: PROJECT_ID });
    stopHearing();
    CreatedRecords.announce({ tableName: "Monitor", projectId: PROJECT_ID });

    expect(heard).toHaveLength(1);
  });

  test("each listener gets its own copy", () => {
    const changed: Array<CreatedRecord> = [];
    const stop: () => void = CreatedRecords.subscribe(
      (record: CreatedRecord): void => {
        record.tableName = "Changed";
        changed.push(record);
      },
    );

    try {
      CreatedRecords.announce({ tableName: "Monitor", projectId: null });
    } finally {
      stop();
    }

    expect(changed).toHaveLength(1);
    expect(heard).toEqual([{ tableName: "Monitor", projectId: null }]);
  });

  test("a record with no table is not announced", () => {
    CreatedRecords.announce({ tableName: "", projectId: PROJECT_ID });

    expect(heard).toEqual([]);
  });
});
