import BaseAPI from "../../../Server/API/BaseAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import EnterpriseLicense from "../../../Models/DatabaseModels/EnterpriseLicense";
import Form from "../../../Models/DatabaseModels/Form";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import { JSONObject } from "../../../Types/JSON";
import { getJestSpyOn } from "../../Spy";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
  };
});

/*
 * POST and PUT /<model>: a switch sent as text reaches the service as the
 * boolean the database stores - "true", "yes", "on", "1" and 1 as true,
 * "false", "no", "off", "0" and 0 as false - beside the number and date
 * coercions, so a hook never sees a string where the column holds a
 * boolean. A value the database would refuse is left for DatabaseService,
 * which refuses it with one plain message (BooleanColumnWrites).
 */

const TEST_ID: string = "550e8400-e29b-41d4-a716-4466554400b1";

type ModelType = { new (): BaseModel };

interface ApiCase {
  label: string;
  modelType: ModelType;
  // A switch of the model.
  column: string;
}

const CASES: Array<ApiCase> = [
  {
    label: "a scheduled maintenance event's Visible on Status Page",
    modelType: ScheduledMaintenance,
    column: "isVisibleOnStatusPage",
  },
  {
    label: "a form's Enabled",
    modelType: Form,
    column: "isEnabled",
  },
  {
    label: "a monitor's Disable Active Monitoring",
    modelType: Monitor,
    column: "disableActiveMonitoring",
  },
  {
    label: "an enterprise license's Evaluation License",
    modelType: EnterpriseLicense,
    column: "isEvaluationLicense",
  },
];

const AS_TRUE: Array<unknown> = ["true", "TRUE", " yes ", "on", "t", "1", 1];
const AS_FALSE: Array<unknown> = ["false", "No", "off", "f", "0", 0];

function makeApi(modelType: ModelType): {
  api: BaseAPI<BaseModel, DatabaseService<BaseModel>>;
  service: DatabaseService<BaseModel>;
} {
  const service: DatabaseService<BaseModel> = new DatabaseService<BaseModel>(
    modelType,
  );

  return {
    service,
    api: new BaseAPI<BaseModel, DatabaseService<BaseModel>>(modelType, service),
  };
}

function makeResponse(): ExpressResponse {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;
}

function requestWithData(data: JSONObject): OneUptimeRequest {
  return {
    params: { id: TEST_ID },
    body: { data: data },
    headers: {},
  } as unknown as OneUptimeRequest;
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("PUT: the update reaches the service with the switch the database stores", () => {
  for (const apiCase of CASES) {
    describe(apiCase.label, () => {
      async function updatedValue(value: unknown): Promise<unknown> {
        const { api, service } = makeApi(apiCase.modelType);
        const updateSpy: jest.Mock = getJestSpyOn(
          service,
          "updateOneById",
        ).mockResolvedValue(1) as unknown as jest.Mock;

        await api.updateItem(
          requestWithData({ [apiCase.column]: value } as JSONObject),
          makeResponse(),
        );

        return (
          (updateSpy.mock.calls[0] as Array<unknown>)[0] as {
            data: JSONObject;
          }
        ).data[apiCase.column];
      }

      it.each(AS_TRUE)("%p is true", async (value: unknown) => {
        await expect(updatedValue(value)).resolves.toBe(true);
      });

      it.each(AS_FALSE)("%p is false", async (value: unknown) => {
        await expect(updatedValue(value)).resolves.toBe(false);
      });

      it("true, false and null pass through as they are", async () => {
        await expect(updatedValue(true)).resolves.toBe(true);
        await expect(updatedValue(false)).resolves.toBe(false);
        await expect(updatedValue(null)).resolves.toBeNull();
      });

      it("a value the database would refuse is left for the service to refuse", async () => {
        await expect(updatedValue("maybe")).resolves.toBe("maybe");
        await expect(updatedValue(2)).resolves.toBe(2);
      });
    });
  }

  it("leaves the columns that are not switches alone, and still coerces numbers and dates in the same patch", async () => {
    const { api, service } = makeApi(EnterpriseLicense);
    const updateSpy: jest.Mock = getJestSpyOn(
      service,
      "updateOneById",
    ).mockResolvedValue(1) as unknown as jest.Mock;

    await api.updateItem(
      requestWithData({
        companyName: "true",
        licenseKey: "0",
        isEvaluationLicense: "yes",
        userLimit: "75",
        expiresAt: "2028-06-30",
      }),
      makeResponse(),
    );

    const data: JSONObject = (
      (updateSpy.mock.calls[0] as Array<unknown>)[0] as { data: JSONObject }
    ).data;

    expect(data["companyName"]).toBe("true");
    expect(data["licenseKey"]).toBe("0");
    expect(data["isEvaluationLicense"]).toBe(true);
    expect(data["userLimit"]).toBe(75);
    expect(data["expiresAt"]).toBeInstanceOf(Date);
  });
});

describe("POST: the new record reaches the service with the switch the database stores", () => {
  for (const apiCase of CASES) {
    describe(apiCase.label, () => {
      async function createdValue(value: unknown): Promise<unknown> {
        const { api, service } = makeApi(apiCase.modelType);
        const createSpy: jest.Mock = getJestSpyOn(
          service,
          "create",
        ).mockResolvedValue(
          new apiCase.modelType() as never,
        ) as unknown as jest.Mock;

        await api.createItem(
          {
            params: {},
            body: { data: { [apiCase.column]: value } },
            headers: {},
          } as unknown as OneUptimeRequest,
          makeResponse(),
        );

        const createBy: CreateBy<BaseModel> = createSpy.mock
          .calls[0]![0] as CreateBy<BaseModel>;

        return (createBy.data as unknown as Record<string, unknown>)[
          apiCase.column
        ];
      }

      it.each(AS_TRUE)("%p is true", async (value: unknown) => {
        await expect(createdValue(value)).resolves.toBe(true);
      });

      it.each(AS_FALSE)("%p is false", async (value: unknown) => {
        await expect(createdValue(value)).resolves.toBe(false);
      });

      it("a value the database would refuse is left for the service to refuse", async () => {
        await expect(createdValue("maybe")).resolves.toBe("maybe");
      });
    });
  }
});
