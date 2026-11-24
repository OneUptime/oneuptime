import CallService from "../../FeatureSet/Notification/Services/CallService";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import Project from "Common/Models/DatabaseModels/Project";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import CallLogService from "Common/Server/Services/CallLogService";
import ProjectService from "Common/Server/Services/ProjectService";
import CallRequest from "Common/Types/Call/CallRequest";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import Twilio from "twilio";

/*
 * A CALL SPELLS THE PROJECT'S RECORD NUMBERS, WHOEVER WROTE IT (#10762).
 *
 * Read as written, "INC-42" is "Incorporated 42". An on-call page's call
 * carries its record's number for the voice to spell; every other call - an
 * owner's notice, an SLA breach, a security case - writes the number into
 * its sentence. The Notification service reads the project's own number
 * prefixes with the project it already reads for every call, and spells a
 * number written with one wherever the call says it.
 *
 * Through the real CallService, with Twilio's client faked and its TwiML
 * builder real, as in PagingMessagesNameTheProduct.test.ts.
 */

jest.mock("twilio", () => {
  const actual: { twiml: unknown } = jest.requireActual("twilio") as {
    twiml: unknown;
  };
  const client: ((...args: Array<unknown>) => unknown) & {
    twiml?: unknown;
  } = jest.fn();
  client.twiml = actual.twiml;

  return {
    __esModule: true,
    default: client,
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
    EXTERNAL_FAULT: {},
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    IsBillingEnabled: false,
  };
});

jest.mock("../../FeatureSet/Notification/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../FeatureSet/Notification/Config",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    getTwilioConfig: jest.fn(),
    getCallAndSmsGateway: jest.fn().mockResolvedValue(null as never),
  };
});

import { getTwilioConfig } from "../../FeatureSet/Notification/Config";

type AsyncMock = Mock<(...args: Array<unknown>) => Promise<unknown>>;

const PROJECT_ID: ObjectID = new ObjectID(
  "0fa10762-0000-4000-8000-0000000000c1",
);

const TWILIO_CONFIG: TwilioConfig = {
  accountSid: "AC-account",
  authToken: "auth-token",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

let createCall: AsyncMock;
let readSelect: JSONObject | undefined;

function projectWithPrefixes(): Project {
  const project: Project = new Project();
  project._id = PROJECT_ID.toString();
  project.name = "Acme Production";
  project.enableCallNotifications = true;
  project.smsOrCallCurrentBalanceInUSDCents = 10000;
  project.incidentNumberPrefix = "INC-";
  project.alertNumberPrefix = "ALT-";

  return project;
}

beforeEach(() => {
  jest.spyOn(EnterpriseEdition, "getProductBranding").mockReturnValue(null);

  createCall = jest.fn<(...args: Array<unknown>) => Promise<unknown>>();
  createCall.mockResolvedValue({ sid: "CA-1", duration: "0" } as never);

  (Twilio as unknown as jest.Mock).mockImplementation(() => {
    return { calls: { create: createCall } };
  });

  (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(
    TWILIO_CONFIG as never,
  );

  readSelect = undefined;
  jest.spyOn(ProjectService, "findOneById").mockImplementation(((data: {
    select: JSONObject;
  }) => {
    readSelect = data.select;
    return Promise.resolve(projectWithPrefixes());
  }) as never);
  jest.spyOn(CallLogService, "create").mockImplementation(((data: {
    data: CallLog;
  }) => {
    return Promise.resolve(data.data);
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The TwiML Twilio was given for the one call placed.
function placedTwiml(): string {
  expect(createCall).toHaveBeenCalledTimes(1);

  return String(
    (createCall.mock.calls[0]![0] as { twiml?: unknown }).twiml || "",
  );
}

describe("a project's call", () => {
  test("reads the project's number prefixes with the project", async () => {
    await CallService.makeCall(
      {
        to: new Phone("+6590665484"),
        data: [{ sayMessage: "Words." }],
      } as unknown as CallRequest,
      { projectId: PROJECT_ID, isSensitive: true },
    );

    expect(readSelect).toMatchObject({
      incidentNumberPrefix: true,
      incidentEpisodeNumberPrefix: true,
      alertNumberPrefix: true,
      alertEpisodeNumberPrefix: true,
      scheduledMaintenanceNumberPrefix: true,
      securityCaseNumberPrefix: true,
    });
  });

  test("spells a number written with one of them, in an owner's notice that carries no number of its own", async () => {
    await CallService.makeCall(
      {
        to: new Phone("+6590665484"),
        data: [
          {
            sayMessage:
              "This is a message from OneUptime. New incident created: INC-42 (Checkout down). An alert, ALT-7, and #3 too. Good bye.",
          },
        ],
      } as unknown as CallRequest,
      { projectId: PROJECT_ID, isSensitive: true },
    );

    expect(placedTwiml()).toContain(
      "<Say>This is a message from One Uptime. New incident created: I N C 42 (Checkout down). An alert, A L T 7, and number 3 too. Good bye.</Say>",
    );
  });

  test("a call with no project - a server's test call - spells nothing", async () => {
    await CallService.makeCall(
      {
        to: new Phone("+6590665484"),
        data: [{ sayMessage: "Test INC-42." }],
      } as unknown as CallRequest,
      {},
    );

    expect(placedTwiml()).toContain("<Say>Test INC-42.</Say>");
  });
});
