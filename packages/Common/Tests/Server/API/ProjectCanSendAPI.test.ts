import { mockRouter } from "./Helpers";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * GET /project-can-send (#7151, #6880): whether a page can reach this
 * project's people by email, SMS and call, for ANY signed-in member of the
 * project - three yes-or-noes. Only master admins could read whether the
 * server can send (GET /global-config/sending-status), so a member typed a
 * phone number in the guided on-call setup and was refused only then.
 *
 * Members get only what they need: never what the settings are missing,
 * what a provider said, or any setting - those stay the master admins'.
 * The GlobalConfig row and the project's Twilio configs are stood in for.
 */

let storedConfig: Record<string, unknown> | null = null;
let projectSmsConfig: unknown = undefined;
let projectCallConfig: unknown = undefined;
let isBillingEnabled: boolean = false;
const findOneById: jest.Mock = jest.fn();
const getProjectDefaultTwilioConfig: jest.Mock = jest.fn();

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return isBillingEnabled;
    },
  });

  return mocked;
});

jest.mock("../../../Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>): unknown => {
        return findOneById(...args);
      },
      writeServerSendingHealth: async (): Promise<void> => {},
      forgetServerSendingHealthOf: async (): Promise<void> => {},
    },
  };
});

jest.mock("../../../Server/Services/ProjectCallSMSConfigService", () => {
  return {
    __esModule: true,
    default: {
      getProjectDefaultTwilioConfig: (...args: Array<unknown>): unknown => {
        return getProjectDefaultTwilioConfig(...args);
      },
    },
  };
});

import CommonAPI from "../../../Server/API/CommonAPI";
import "../../../Server/API/ProjectCanSendAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import ProjectCanSendReader from "../../../Server/Utils/ServerSending/ProjectCanSendReader";
import ServerSendingStatus from "../../../Server/Utils/ServerSending/ServerSendingStatus";
import { EmailServerType } from "../../../Models/DatabaseModels/GlobalConfig";
import { CallAndSmsProvider } from "../../../Types/CallAndSMS/CallAndSmsProvider";
import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import { TwilioConfigUse } from "../../../Types/CallAndSMS/TwilioConfigUse";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import ProjectCanSend, {
  PROJECT_CAN_SEND_API_PATH,
  ProjectCanSendAnswer,
} from "../../../Types/ServerSending/ProjectCanSend";
import { ServerSendingHealth } from "../../../Types/ServerSending/ServerSendingStatus";
import { TwilioMessageKind } from "../../../Utils/Project/TwilioAccount";

const PROJECT: ObjectID = new ObjectID("71510000-0000-4000-8000-000000000001");
const MEMBER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT,
  userId: new ObjectID("71510000-0000-4000-8000-0000000000a1"),
};

const EMAIL_SET_UP: Record<string, unknown> = {
  emailServerType: EmailServerType.Resend,
  resendApiKey: "re_secret_key_value",
  resendFromEmail: "alerts@example.com",
};

const TWILIO_SET_UP: Record<string, unknown> = {
  twilioAccountSID: "AC0123456789",
  twilioAuthToken: "twilio-secret-token",
  twilioPrimaryPhoneNumber: new Phone("+14155550100"),
};

const FAILED_AT: string = "2026-11-17T09:00:00.000Z";
const SECRET_FAILURE: string =
  "535 Authentication failed for re_secret_key_value at smtp.internal.example";

function failing(channel: string): ServerSendingHealth {
  return {
    [channel]: {
      lastSucceededAt: null,
      lastFailedAt: FAILED_AT,
      failingSince: FAILED_AT,
      lastFailure: SECRET_FAILURE,
    },
  } as ServerSendingHealth;
}

function projectConfig(use: TwilioConfigUse): TwilioConfig {
  return {
    accountSid: "AC9999",
    authToken: "project-token",
    primaryPhoneNumber: new Phone("+14155550199"),
    secondaryPhoneNumbers: [],
    smsPhoneNumbers:
      use === TwilioConfigUse.CallsOnly ? [] : [new Phone("+14155550199")],
    use: use,
  } as unknown as TwilioConfig;
}

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

async function ask(): Promise<{ thrown: unknown; sent: unknown }> {
  const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
    "GET",
    PROJECT_CAN_SEND_API_PATH,
  );

  let thrown: unknown = undefined;

  await (route.handlerFunction as RouterFunction)(
    { params: {}, query: {}, headers: {} } as unknown as ExpressRequest,
    {} as ExpressResponse,
    ((err: unknown) => {
      thrown = err;
    }) as NextFunction,
  );

  return {
    thrown: thrown,
    sent: (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
      .calls[0]?.[2],
  };
}

beforeEach(() => {
  jest.restoreAllMocks();
  (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();
  ServerSendingStatus.clearCache();

  storedConfig = {};
  projectSmsConfig = undefined;
  projectCallConfig = undefined;
  isBillingEnabled = false;

  findOneById.mockReset();
  findOneById.mockImplementation(async (): Promise<unknown> => {
    return storedConfig ? { ...storedConfig } : null;
  });

  getProjectDefaultTwilioConfig.mockReset();
  getProjectDefaultTwilioConfig.mockImplementation(
    async (_projectId: ObjectID, kind: TwilioMessageKind): Promise<unknown> => {
      return kind === TwilioMessageKind.SMS
        ? projectSmsConfig
        : projectCallConfig;
    },
  );

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(MEMBER as never);
  jest
    .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
    .mockReturnValue(PROJECT as never);
});

describe("GET /project-can-send", () => {
  test("is at /project-can-send, behind the signed-in member's middleware", () => {
    expect(PROJECT_CAN_SEND_API_PATH).toBe("/project-can-send");
    expect(mockRouter.match("GET", PROJECT_CAN_SEND_API_PATH).middleware).toBe(
      UserMiddleware.getUserMiddleware,
    );
  });

  test("any member of the project is answered, for the project they were let into", async () => {
    const { thrown, sent } = await ask();

    expect(thrown).toBeUndefined();
    expect(sent).toEqual({ email: false, sms: false, call: false });
    expect(CommonAPI.assertAuthenticatedProjectMember).toHaveBeenCalledWith(
      MEMBER,
    );
    expect(getProjectDefaultTwilioConfig.mock.calls[0]![0]).toBe(PROJECT);
  });

  test("somebody who is not a member is refused before anything is read", async () => {
    jest
      .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
      .mockImplementation(() => {
        throw new NotAuthorizedException("Not a member.");
      });

    const { thrown, sent } = await ask();

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect(sent).toBeUndefined();
    expect(findOneById).not.toHaveBeenCalled();
    expect(getProjectDefaultTwilioConfig).not.toHaveBeenCalled();
  });

  test("never why: no failure, no setting, no address - three yes-or-noes only", async () => {
    storedConfig = {
      ...EMAIL_SET_UP,
      ...TWILIO_SET_UP,
      serverSendingHealth: {
        ...failing("email"),
        ...failing("sms"),
      },
    };

    const { sent } = await ask();

    expect(sent).toEqual({ email: false, sms: false, call: true });
    expect(Object.keys(sent as Record<string, unknown>).sort()).toEqual([
      "call",
      "email",
      "sms",
    ]);

    const text: string = JSON.stringify(sent);

    for (const secret of [
      "535",
      "re_secret_key_value",
      "twilio-secret-token",
      "smtp.internal.example",
      "alerts@example.com",
      "+14155550100",
      "Settings",
    ]) {
      expect({ secret, leaked: text.includes(secret) }).toEqual({
        secret,
        leaked: false,
      });
    }
  });
});

describe("what a page can reach", () => {
  test("a fresh server: no email, no SMS, no calls", async () => {
    expect(await ProjectCanSendReader.read(PROJECT)).toEqual({
      email: false,
      sms: false,
      call: false,
    });
  });

  test("email set up, untested or working: yes; failing: no", async () => {
    storedConfig = { ...EMAIL_SET_UP };

    expect((await ProjectCanSendReader.read(PROJECT)).email).toBe(true);

    ServerSendingStatus.clearCache();
    storedConfig = { ...EMAIL_SET_UP, serverSendingHealth: failing("email") };

    expect((await ProjectCanSendReader.read(PROJECT)).email).toBe(false);
  });

  test("the server's Twilio account sends both, and the project's own is not read", async () => {
    storedConfig = { ...TWILIO_SET_UP };

    expect(await ProjectCanSendReader.read(PROJECT)).toMatchObject({
      sms: true,
      call: true,
    });
    expect(getProjectDefaultTwilioConfig).not.toHaveBeenCalled();
  });

  test("the server's own gateway carries both", async () => {
    storedConfig = {
      callAndSmsProvider: CallAndSmsProvider.Gateway,
      callAndSmsGatewayUrl: "https://gateway.example.com/send",
    };

    expect(await ProjectCanSendReader.read(PROJECT)).toMatchObject({
      sms: true,
      call: true,
    });
  });

  test("a server without Twilio: the project's own config sends what it is used for", async () => {
    projectSmsConfig = projectConfig(TwilioConfigUse.SmsOnly);

    expect(await ProjectCanSendReader.read(PROJECT)).toMatchObject({
      sms: true,
      call: false,
    });

    projectSmsConfig = projectConfig(TwilioConfigUse.CallsAndSms);
    projectCallConfig = projectConfig(TwilioConfigUse.CallsAndSms);

    expect(await ProjectCanSendReader.read(PROJECT)).toMatchObject({
      sms: true,
      call: true,
    });
  });

  test("the server's Twilio failing: no, unless the project has its own", async () => {
    storedConfig = { ...TWILIO_SET_UP, serverSendingHealth: failing("call") };

    expect((await ProjectCanSendReader.read(PROJECT)).call).toBe(false);

    projectCallConfig = projectConfig(TwilioConfigUse.CallsAndSms);

    expect((await ProjectCanSendReader.read(PROJECT)).call).toBe(true);
  });

  test("OneUptime Cloud: every channel, nothing read", async () => {
    isBillingEnabled = true;

    expect(await ProjectCanSendReader.read(PROJECT)).toEqual({
      email: true,
      sms: true,
      call: true,
    });
    expect(findOneById).not.toHaveBeenCalled();
    expect(getProjectDefaultTwilioConfig).not.toHaveBeenCalled();
  });
});

describe("read in a browser", () => {
  test("only a plain false is no: an older server, a refusal or a proxy's page reads as yes", () => {
    const read: ProjectCanSendAnswer = ProjectCanSend.parse({
      email: false,
      sms: "false",
      call: 0,
    });

    expect(read).toEqual({ email: false, sms: true, call: true });

    for (const answer of [null, undefined, "<html>", [], {}]) {
      expect(ProjectCanSend.parse(answer)).toEqual({
        email: true,
        sms: true,
        call: true,
      });
    }
  });
});
