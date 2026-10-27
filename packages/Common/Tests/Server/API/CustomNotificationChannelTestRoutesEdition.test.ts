import CustomNotificationChannelAPI from "../../../Server/API/CustomNotificationChannelAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import TestSendAccess from "../../../Server/API/TestSendAccess";
import CustomNotificationChannelDeliveryService from "../../../Server/Services/CustomNotificationChannelDeliveryService";
import CustomNotificationChannelService from "../../../Server/Services/CustomNotificationChannelService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature, {
  ALL_ENTERPRISE_FEATURES,
} from "../../../Server/Enterprise/EnterpriseFeature";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import CustomNotificationChannel from "../../../Models/DatabaseModels/CustomNotificationChannel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import {
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  LICENSE_STATE_CASES,
  LicenseStateCase,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * THE TEST ROUTES ANSWER IN THE EDITION'S OWN WORDS WITHOUT A LICENSE.
 *
 * Custom channels are an Enterprise feature, and so is trying one:
 *
 *   POST /custom-notification-channel/test            a person's test to
 *                                                     themselves
 *   POST /custom-notification-channel/instance/test   a master admin's test
 *
 * Who is asking is settled first (TestSendAccess for a person, the signed-in
 * master admin for the instance's test), then CustomChannelEdition
 * .assertAvailable: on the Community Edition the answer is a 402 saying it is
 * an Enterprise Edition feature (EnterpriseEdition.COMMUNITY_EDITION_MESSAGE),
 * on the Enterprise Edition without a license that includes it a 402 saying
 * a license is needed (LICENSE_REQUIRED_MESSAGE) - and nothing is read and
 * nothing sent. And /available, what people's screens offer, lists no
 * channel while custom channels are not active.
 *
 * The routes are called directly, as Express would after their middleware
 * (mockRouter); billing and the edition are pinned in every test (CI's
 * config.env sets BILLING_ENABLED=true).
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

jest.mock("../../../Server/Utils/Logger");

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

const PERSON_TEST: string = "/custom-notification-channel/test";
const INSTANCE_TEST: string = "/custom-notification-channel/instance/test";
const AVAILABLE: string = "/custom-notification-channel/available";

const USER_ID: ObjectID = new ObjectID("c4a50000-0000-4000-8000-000000000001");
const PROJECT_ID: ObjectID = new ObjectID(
  "c4a50000-0000-4000-8000-000000000002",
);
const CHANNEL_ID: ObjectID = new ObjectID(
  "c4a50000-0000-4000-8000-000000000003",
);

type Answer = { json: JSONObject } | Error;

type Outcome = "sent" | "community" | "license" | string;

let findChannel: jest.SpyInstance;
let findChannels: jest.SpyInstance;
let deliver: jest.SpyInstance;
let mayTestToSelf: jest.SpyInstance;
let callerProps: jest.SpyInstance;

function request(body: JSONObject): OneUptimeRequest {
  return {
    params: {},
    body: body,
    headers: {},
    query: {},
    userType: UserType.User,
    userAuthorization: { userId: USER_ID, isMasterAdmin: false },
  } as unknown as OneUptimeRequest;
}

// The route's answer: the JSON it sent, or the error it passed on.
async function call(uri: string, body: JSONObject): Promise<Answer> {
  (Response.sendJsonObjectResponse as jest.Mock).mockClear();
  (Response.sendErrorResponse as jest.Mock).mockClear();

  let failure: Error | undefined = undefined;

  const res: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  await mockRouter
    .match("POST", uri)
    .handlerFunction(request(body), res, (err?: unknown): void => {
      failure = err as Error;
    });

  if (failure) {
    return failure;
  }

  const sent: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  expect(sent).toHaveLength(1);

  return { json: sent[0]![2] as JSONObject };
}

// How a test route answered: sent, or which of the edition's words.
function outcomeOf(answer: Answer): Outcome {
  if (answer instanceof PaymentRequiredException) {
    if (answer.message === EnterpriseEdition.COMMUNITY_EDITION_MESSAGE) {
      return "community";
    }

    if (answer.message === EnterpriseEdition.LICENSE_REQUIRED_MESSAGE) {
      return "license";
    }
  }

  if (answer instanceof Error) {
    return `${answer.constructor.name}: ${answer.message}`;
  }

  return "sent";
}

function personTest(): Promise<Answer> {
  return call(PERSON_TEST, {
    customNotificationChannelId: CHANNEL_ID.toString(),
    projectId: PROJECT_ID.toString(),
  });
}

function instanceTest(): Promise<Answer> {
  return call(INSTANCE_TEST, {
    customNotificationChannelId: CHANNEL_ID.toString(),
  });
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new CustomNotificationChannelAPI();
});

beforeEach(() => {
  setTestBillingEnabled(false);
  uninstallEnterpriseModule();

  const row: CustomNotificationChannel = new CustomNotificationChannel();
  row._id = CHANNEL_ID.toString();
  row.name = "CorpoApp";
  row.isEnabled = true;

  findChannel = jest
    .spyOn(CustomNotificationChannelService, "findOneById")
    .mockResolvedValue(row);
  findChannels = jest
    .spyOn(CustomNotificationChannelService, "findBy")
    .mockResolvedValue([row]);
  deliver = jest
    .spyOn(CustomNotificationChannelDeliveryService, "send")
    .mockResolvedValue({
      ok: true,
      statusCode: 202,
      message: "Sent to CorpoApp (HTTP 202).",
    });
  mayTestToSelf = jest
    .spyOn(TestSendAccess, "assertMaySendTestToSelf")
    .mockResolvedValue({
      props: {
        userId: USER_ID,
        userType: UserType.User,
      } as DatabaseCommonInteractionProps,
      userId: USER_ID,
    });
  jest
    .spyOn(TestSendAccess, "assertSenderIsMemberOf")
    .mockImplementation((): void => {
      return undefined;
    });
  callerProps = jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue({
      userId: USER_ID,
      userType: UserType.MasterAdmin,
      isMasterAdmin: true,
    } as DatabaseCommonInteractionProps);
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue(null);
  jest.spyOn(UserService, "findOneById").mockResolvedValue(null);
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe.each([
  ["a person's own test", PERSON_TEST, personTest],
  ["the master admin's test", INSTANCE_TEST, instanceTest],
])("%s", (_label: string, uri: string, sendTest: () => Promise<Answer>) => {
  test("the route is there in every edition", () => {
    expect(mockRouter.match("POST", uri)).toBeDefined();
  });

  test("the Community Edition: a 402 saying it is an Enterprise Edition feature, and nothing is read or sent", async () => {
    const answer: Answer = await sendTest();

    expect(answer).toBeInstanceOf(PaymentRequiredException);
    expect((answer as PaymentRequiredException).code).toBe(402);
    expect((answer as PaymentRequiredException).message).toBe(
      EnterpriseEdition.COMMUNITY_EDITION_MESSAGE,
    );
    expect(findChannel).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  test("the Community Edition with billing on: the same", async () => {
    setTestBillingEnabled(true);

    expect(outcomeOf(await sendTest())).toBe("community");
    expect(deliver).not.toHaveBeenCalled();
  });

  test("the Enterprise Edition after a lapse: a 402 saying a license that includes it is needed", async () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });

    expect(outcomeOf(await sendTest())).toBe("license");
    expect(findChannel).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  test("a license that leaves custom channels out: the same", async () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({
        features: ALL_ENTERPRISE_FEATURES.filter(
          (feature: EnterpriseFeature): boolean => {
            return feature !== EnterpriseFeature.CustomNotificationChannels;
          },
        ),
      }),
    });

    expect(outcomeOf(await sendTest())).toBe("license");
  });

  test("a license that includes them: the test is sent, as a test, and answered", async () => {
    installFakeEnterpriseModule();

    const answer: Answer = await sendTest();

    expect(answer).toEqual({
      json: {
        ok: true,
        responseStatusCode: 202,
        statusMessage: "Sent to CorpoApp (HTTP 202).",
      },
    });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(
      (deliver.mock.calls[0]![0] as Record<string, unknown>)["isTest"],
    ).toBe(true);
  });

  test("OneUptime Cloud: sent, whatever the license says", async () => {
    setTestBillingEnabled(true);
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });

    expect(outcomeOf(await sendTest())).toBe("sent");
  });

  test.each(
    LICENSE_STATE_CASES.map(
      (state: LicenseStateCase): [string, LicenseStateCase] => {
        return [state.label, state];
      },
    ),
  )(
    "self-hosted, %s: answers as the edition does for configuration",
    async (_stateLabel: string, state: LicenseStateCase) => {
      state.install();

      const expected: Outcome = (await EnterpriseEdition.isFeatureAvailable(
        EnterpriseFeature.CustomNotificationChannels,
      ))
        ? "sent"
        : "license";

      expect(outcomeOf(await sendTest())).toBe(expected);
    },
  );
});

describe("who is asking is settled before the edition", () => {
  test("a person who may not send themselves a test is refused for that, on any edition, and the license is never asked", async () => {
    const available: jest.SpyInstance = jest.spyOn(
      EnterpriseEdition,
      "isFeatureAvailable",
    );
    mayTestToSelf.mockRejectedValue(
      new NotAuthorizedException("You are not signed in."),
    );

    const answer: Answer = await personTest();

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect(available).not.toHaveBeenCalled();
    expect(findChannel).not.toHaveBeenCalled();
  });

  test("the instance's test without a signed-in master admin is refused for that, and the license is never asked", async () => {
    const available: jest.SpyInstance = jest.spyOn(
      EnterpriseEdition,
      "isFeatureAvailable",
    );
    callerProps.mockResolvedValue({} as DatabaseCommonInteractionProps);

    const answer: Answer = await instanceTest();

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect((answer as NotAuthorizedException).message).toBe(
      "Sign in as a master admin to test a custom channel.",
    );
    expect(available).not.toHaveBeenCalled();
  });

  test("with a caller settled, the edition is asked once, for custom channels", async () => {
    const available: jest.SpyInstance = jest.spyOn(
      EnterpriseEdition,
      "isFeatureAvailable",
    );

    await instanceTest();
    await personTest();

    expect(
      available.mock.calls.map((call: Array<unknown>): unknown => {
        return call[0];
      }),
    ).toEqual([
      EnterpriseFeature.CustomNotificationChannels,
      EnterpriseFeature.CustomNotificationChannels,
    ]);
  });
});

describe("POST /custom-notification-channel/available", () => {
  test("the Community Edition: no channel is offered, and none is read", async () => {
    const answer: Answer = await call(AVAILABLE, {});

    expect(answer).toEqual({ json: { channels: [] } });
    expect(findChannels).not.toHaveBeenCalled();
  });

  test("a lapsed license: the same", async () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("missing"),
    });

    expect(await call(AVAILABLE, {})).toEqual({ json: { channels: [] } });
    expect(findChannels).not.toHaveBeenCalled();
  });

  test("a license that includes them: the channels that are on, by id and name", async () => {
    installFakeEnterpriseModule();

    expect(await call(AVAILABLE, {})).toEqual({
      json: {
        channels: [
          {
            _id: CHANNEL_ID.toString(),
            name: "CorpoApp",
            pageEveryoneByDefault: true,
          },
        ],
      },
    });
  });
});
