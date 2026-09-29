import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BaseAPI from "../../../Server/API/BaseAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageSubscriberService, {
  Service as StatusPageSubscriberServiceClass,
} from "../../../Server/Services/StatusPageSubscriberService";
import {
  RunOptions,
  RunReturnType,
} from "../../../Server/Types/Workflow/ComponentCode";
import CreateManyBaseModel from "../../../Server/Types/Workflow/Components/BaseModel/CreateManyBaseModel";
import CreateOneBaseModel from "../../../Server/Types/Workflow/Components/BaseModel/CreateOneBaseModel";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Email from "../../../Types/Email";
import Exception from "../../../Types/Exception/Exception";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

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
 * A subscriber's create hands back the row it saved, and the unsubscribe
 * token and the confirmation code are on that row: StatusPageSubscriberService
 * minted them in onBeforeCreate. Nobody may read either column (read: []), but
 * the create response of POST /status-page-subscriber is serialized whole,
 * without a column read check - so a teammate's Add Subscriber or Add in Bulk,
 * or any API key, got the token back, and could cancel the subscription
 * "through the link", which the team's notice then blamed on the subscriber.
 * A workflow's Create Status Page Subscriber step returned it too, and step
 * return values are kept in the workflow's logs.
 *
 * DatabaseService.create is replaced with one that returns the saved row as
 * the real one does, secrets and all; the service's own create is real.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000002",
);
const SUBSCRIBER_ID: string = "30000000-0000-4000-8000-000000000003";
const TOKEN: string = "4d".repeat(32);
const CONFIRMATION_CODE: string = "654321";

function savedRow(): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row._id = SUBSCRIBER_ID;
  row.projectId = PROJECT_ID;
  row.statusPageId = STATUS_PAGE_ID;
  row.subscriberEmail = new Email("site03-all@acme.com");
  row.isSubscriptionConfirmed = true;
  row.isAddedByTeam = true;
  row.unsubscribeToken = TOKEN;
  row.subscriptionConfirmationToken = CONFIRMATION_CODE;
  return row;
}

function expectNoSecrets(json: JSONObject): void {
  const text: string = JSON.stringify(json);

  expect(json["unsubscribeToken"]).toBeUndefined();
  expect(json["subscriptionConfirmationToken"]).toBeUndefined();
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain(CONFIRMATION_CODE);

  // The rest of the row is still there.
  expect(json["_id"]).toBe(SUBSCRIBER_ID);
  expect(JSON.stringify(json["subscriberEmail"])).toContain(
    "site03-all@acme.com",
  );
}

beforeEach(() => {
  // With billing on, the request's props carry the project's plan.
  jest
    .spyOn(ProjectService, "getCurrentPlan")
    .mockResolvedValue({ plan: null, isSubscriptionUnpaid: false } as never);

  jest.spyOn(DatabaseService.prototype, "create").mockImplementation((() => {
    return Promise.resolve(savedRow());
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("POST /status-page-subscriber answers without the subscriber's secrets", () => {
  function request(userType: UserType): OneUptimeRequest {
    return {
      params: {},
      headers: {},
      userType: userType,
      tenantId: PROJECT_ID,
      body: {
        data: {
          statusPageId: STATUS_PAGE_ID.toString(),
          subscriberEmail: "site03-all@acme.com",
        },
      },
    } as unknown as OneUptimeRequest;
  }

  test.each([
    ["a teammate's Add Subscriber or Add in Bulk", UserType.User],
    ["an API key", UserType.API],
  ])("%s", async (_label: string, userType: UserType) => {
    const api: BaseAPI<StatusPageSubscriber, StatusPageSubscriberServiceClass> =
      new BaseAPI<StatusPageSubscriber, StatusPageSubscriberServiceClass>(
        StatusPageSubscriber,
        StatusPageSubscriberService,
      );

    await api.createItem(request(userType), {} as ExpressResponse);

    const sendEntityResponse: jest.Mock =
      Response.sendEntityResponse as unknown as jest.Mock;
    expect(sendEntityResponse).toHaveBeenCalledTimes(1);

    const item: StatusPageSubscriber = sendEntityResponse.mock
      .calls[0]![2] as StatusPageSubscriber;

    // What Response.sendEntityResponse serializes: every column that is set.
    expectNoSecrets(BaseModel.toJSON(item, StatusPageSubscriber));
  });
});

describe("a workflow's create steps return the subscriber without its secrets", () => {
  function options(): RunOptions {
    return {
      log: jest.fn() as unknown as RunOptions["log"],
      workflowLogId: ObjectID.generate(),
      workflowId: ObjectID.generate(),
      projectId: PROJECT_ID,
      onError: ((exception: Exception): Exception => {
        return exception;
      }) as RunOptions["onError"],
      executeWorkflow: async (): Promise<void> => {},
    };
  }

  test("Create Status Page Subscriber", async () => {
    const component: CreateOneBaseModel<StatusPageSubscriber> =
      new CreateOneBaseModel<StatusPageSubscriber>(StatusPageSubscriberService);

    const result: RunReturnType = await component.run(
      {
        json: {
          statusPageId: STATUS_PAGE_ID.toString(),
          subscriberEmail: "site03-all@acme.com",
        },
      },
      options(),
    );

    expect(result.executePort?.id).toBe("success");
    expectNoSecrets(result.returnValues["model"] as JSONObject);
  });

  test("Create Many Status Page Subscribers", async () => {
    const component: CreateManyBaseModel<StatusPageSubscriber> =
      new CreateManyBaseModel<StatusPageSubscriber>(
        StatusPageSubscriberService,
      );

    const result: RunReturnType = await component.run(
      {
        "json-array": [
          {
            statusPageId: STATUS_PAGE_ID.toString(),
            subscriberEmail: "site03-all@acme.com",
          },
        ],
      },
      options(),
    );

    expect(result.executePort?.id).toBe("success");

    const models: JSONArray = result.returnValues["models"] as JSONArray;
    expect(models).toHaveLength(1);
    expectNoSecrets(models[0] as JSONObject);
  });
});
