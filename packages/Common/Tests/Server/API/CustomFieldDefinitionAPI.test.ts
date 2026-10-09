import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import CustomFieldDefinitionAPI, {
  CUSTOM_FIELD_OPTION_USAGE_ROUTE,
} from "../../../Server/API/CustomFieldDefinitionAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import MonitorCustomFieldService from "../../../Server/Services/MonitorCustomFieldService";
import * as OptionEditHooks from "../../../Server/Utils/CustomField/CustomFieldOptionEditHooks";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import MonitorCustomField from "../../../Models/DatabaseModels/MonitorCustomField";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
    },
  };
});

/*
 * POST (and GET) /<custom field route>/:id/option-usage: what the dashboard's
 * option editor asks while a dropdown field is edited (#4564) - how many
 * records hold each value, and which fields copy this one. Every custom
 * field definition table answers it; the work is getCustomFieldOptionUsage's
 * (tested in CustomFieldOptionEditHooks), this pins the route around it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const FIELD_ID: string = "22222222-2222-4222-8222-222222222222";

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("33333333-3333-4333-8333-333333333333"),
};

type Handler = (
  req: OneUptimeRequest,
  res: OneUptimeResponse,
  next: NextFunction,
) => Promise<void>;

let usage: MockFunction;
let props: MockFunction;

beforeEach(() => {
  mockRouter.routes.length = 0;

  usage = getJestMockFunction();
  usage.mockResolvedValue({
    values: [
      { value: "Facility A", count: 12 },
      { value: "Old Site", count: 3 },
    ],
    copiedBy: [{ resource: "Incident", fieldName: "Facility" }],
  } as never);
  jest
    .spyOn(OptionEditHooks, "getCustomFieldOptionUsage")
    .mockImplementation(usage as never);

  props = getJestMockFunction();
  props.mockResolvedValue(PROPS as never);
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(props as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

function handlerFor(method: string, uri: string): Handler {
  return mockRouter.match(method, uri).handlerFunction as unknown as Handler;
}

function request(id: string): OneUptimeRequest {
  return { params: { id: id }, body: {}, headers: {} } as unknown as OneUptimeRequest;
}

describe("the option usage route of a custom field definition table", () => {
  test("is the definition's CRUD route plus /:id/option-usage, for POST and GET, behind the user middleware", () => {
    new CustomFieldDefinitionAPI(IncidentCustomField, IncidentCustomFieldService);

    expect(CUSTOM_FIELD_OPTION_USAGE_ROUTE).toBe("/option-usage");

    for (const method of ["POST", "GET"]) {
      const route: { middlewares: Array<unknown> } = mockRouter.match(
        method,
        "/incident-custom-field/:id/option-usage",
      );

      expect(route.middlewares).toEqual([UserMiddleware.getUserMiddleware]);
    }

    // The CRUD routes are still there.
    expect(() => {
      return mockRouter.match("POST", "/incident-custom-field/get-list");
    }).not.toThrow();
    expect(() => {
      return mockRouter.match("PUT", "/incident-custom-field/:id");
    }).not.toThrow();
  });

  test("answers with the counts and the copying fields, never cached", async () => {
    new CustomFieldDefinitionAPI(IncidentCustomField, IncidentCustomFieldService);

    const next: MockFunction = getJestMockFunction();
    const res: OneUptimeResponse = {} as OneUptimeResponse;
    const req: OneUptimeRequest = request(FIELD_ID);

    await handlerFor("POST", "/incident-custom-field/:id/option-usage")(
      req,
      res,
      next as unknown as NextFunction,
    );

    expect(next).not.toHaveBeenCalled();

    const input: JSONObject = usage.mock.calls[0]![0] as JSONObject;
    expect(input["definitionModelType"]).toBe(IncidentCustomField);
    expect(input["definitionService"]).toBe(IncidentCustomFieldService);
    expect(input["fieldId"]).toEqual(new ObjectID(FIELD_ID));
    expect(input["props"]).toBe(PROPS);

    expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(res);
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(req, res, {
      values: [
        { value: "Facility A", count: 12 },
        { value: "Old Site", count: 3 },
      ],
      copiedBy: [{ resource: "Incident", fieldName: "Facility" }],
    });
  });

  test("every definition table answers under its own route", async () => {
    new CustomFieldDefinitionAPI(MonitorCustomField, MonitorCustomFieldService);

    await handlerFor("GET", "/monitor-custom-field/:id/option-usage")(
      request(FIELD_ID),
      {} as OneUptimeResponse,
      getJestMockFunction() as unknown as NextFunction,
    );

    const input: JSONObject = usage.mock.calls[0]![0] as JSONObject;
    expect(input["definitionModelType"]).toBe(MonitorCustomField);
    expect(input["definitionService"]).toBe(MonitorCustomFieldService);
  });

  test("an id that is not one is refused before anything is read", async () => {
    new CustomFieldDefinitionAPI(IncidentCustomField, IncidentCustomFieldService);

    const next: MockFunction = getJestMockFunction();

    await handlerFor("POST", "/incident-custom-field/:id/option-usage")(
      request("not-an-id"),
      {} as OneUptimeResponse,
      next as unknown as NextFunction,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]![0]).toBeInstanceOf(BadDataException);
    expect(usage).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("a request with no project is refused: the counts are of a project's records", async () => {
    new CustomFieldDefinitionAPI(IncidentCustomField, IncidentCustomFieldService);

    props.mockResolvedValue({ userId: PROPS.userId } as never);

    const next: MockFunction = getJestMockFunction();

    await handlerFor("POST", "/incident-custom-field/:id/option-usage")(
      request(FIELD_ID),
      {} as OneUptimeResponse,
      next as unknown as NextFunction,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(String(next.mock.calls[0]![0])).toContain("Project ID is required");
    expect(usage).not.toHaveBeenCalled();
  });

  test("a refusal from the usage is handed on, not answered", async () => {
    new CustomFieldDefinitionAPI(IncidentCustomField, IncidentCustomFieldService);

    const refusal: Error = new BadDataException("You may not edit this.");
    usage.mockRejectedValue(refusal as never);

    const next: MockFunction = getJestMockFunction();

    await handlerFor("POST", "/incident-custom-field/:id/option-usage")(
      request(FIELD_ID),
      {} as OneUptimeResponse,
      next as unknown as NextFunction,
    );

    expect(next).toHaveBeenCalledWith(refusal);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
