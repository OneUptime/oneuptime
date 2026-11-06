import VMwareVCenterConnectionTest from "../../../Models/DatabaseModels/VMwareVCenterConnectionTest";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BaseAPI from "../../../Server/API/BaseAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ProjectService from "../../../Server/Services/ProjectService";
import VMwareVCenterConnectionTestService, {
  Service as VMwareVCenterConnectionTestServiceClass,
} from "../../../Server/Services/VMwareVCenterConnectionTestService";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { JSONObject } from "../../../Types/JSON";
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
 * A connection test's create hands back the row it saved, and the password is
 * on that row, encrypted. For a test of a vCenter that is already set up, that
 * is the vCenter's saved password: whoever may test a connection never typed it
 * and may not read it (read: []), but the create response of
 * POST /vmware-vcenter-connection-test is serialized whole, without a column
 * read check. Where an installation still runs on a shipped ENCRYPTION_SECRET,
 * that ciphertext is as good as the password.
 *
 * DatabaseService.create is replaced with one that returns the saved row as the
 * real one does, password and all; the service's own create is real.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const PROBE_ID: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000002");
const VCENTER_ID: ObjectID = new ObjectID(
  "30000000-0000-4000-8000-000000000003",
);
const TEST_ID: string = "40000000-0000-4000-8000-000000000004";
const CIPHERTEXT: string = "U2FsdGVkX1+the+saved+password+as+stored+in+the+row";

function savedRow(): VMwareVCenterConnectionTest {
  const row: VMwareVCenterConnectionTest = new VMwareVCenterConnectionTest();
  row._id = TEST_ID;
  row.projectId = PROJECT_ID;
  row.probeId = PROBE_ID;
  row.vmwareVCenterId = VCENTER_ID;
  row.vcenterUrl = "https://vcsa.example.com";
  row.vcenterUsername = "oneuptime@vsphere.local";
  row.vcenterPassword = CIPHERTEXT;
  return row;
}

function request(userType: UserType): OneUptimeRequest {
  return {
    params: {},
    headers: {},
    userType: userType,
    tenantId: PROJECT_ID,
    body: {
      data: {
        vcenterUrl: "https://vcsa.example.com",
        vcenterUsername: "oneuptime@vsphere.local",
        probeId: PROBE_ID.toString(),
        vmwareVCenterId: VCENTER_ID.toString(),
      },
    },
  } as unknown as OneUptimeRequest;
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

describe("POST /vmware-vcenter-connection-test answers without the password", () => {
  test.each([
    ["a person testing from the dashboard", UserType.User],
    ["an API key", UserType.API],
  ])("%s", async (_label: string, userType: UserType) => {
    const api: BaseAPI<
      VMwareVCenterConnectionTest,
      VMwareVCenterConnectionTestServiceClass
    > = new BaseAPI<
      VMwareVCenterConnectionTest,
      VMwareVCenterConnectionTestServiceClass
    >(VMwareVCenterConnectionTest, VMwareVCenterConnectionTestService);

    await api.createItem(request(userType), {} as ExpressResponse);

    const sendEntityResponse: jest.Mock =
      Response.sendEntityResponse as unknown as jest.Mock;
    expect(sendEntityResponse).toHaveBeenCalledTimes(1);

    const item: VMwareVCenterConnectionTest = sendEntityResponse.mock
      .calls[0]![2] as VMwareVCenterConnectionTest;

    // What Response.sendEntityResponse serializes: every column that is set.
    const json: JSONObject = BaseModel.toJSON(
      item,
      VMwareVCenterConnectionTest,
    );

    expect(json["vcenterPassword"]).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain(CIPHERTEXT);

    // The panel polls the test by this id, and the rest of the row is still there.
    expect(json["_id"]).toBe(TEST_ID);
    expect(json["vcenterUrl"]).toBe("https://vcsa.example.com");
  });
});
