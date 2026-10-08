import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import Project from "../../../Models/DatabaseModels/Project";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserIncomingCallNumber from "../../../Models/DatabaseModels/UserIncomingCallNumber";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import UserWhatsApp from "../../../Models/DatabaseModels/UserWhatsApp";
import CallService from "../../../Server/Services/CallService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import SmsService from "../../../Server/Services/SmsService";
import UserCallService from "../../../Server/Services/UserCallService";
import UserIncomingCallNumberService from "../../../Server/Services/UserIncomingCallNumberService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserWhatsAppService from "../../../Server/Services/UserWhatsAppService";
import WhatsAppService from "../../../Server/Services/WhatsAppService";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import {
  ChannelVerificationStatus,
  VerificationCodeState,
} from "../../../Server/Utils/ChannelVerification";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import BadDataException from "../../../Types/Exception/BadDataException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import { getProjectBalanceTooLowMessage } from "../../../Utils/Project/ProjectBalance";
import { ProjectNotificationChannel } from "../../../Utils/Project/NotificationChannels";
import {
  getNoTwilioAccountMessage,
  INCOMING_CALL_NUMBER_NO_TWILIO_ACCOUNT_MESSAGE,
  TwilioMessageKind,
} from "../../../Utils/Project/TwilioAccount";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

/*
 * Billing on, as on OneUptime Cloud, so the balance checks run too: the
 * projects below have plenty unless a test says otherwise.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return { ...actual, IsBillingEnabled: true };
});

/*
 * "SMS IS NOT SENT BUT THE VERIFY PHONE NUMBER MODAL SAYS OTHERWISE."
 *
 * A self-hosted customer, no Twilio account set up, added their phone number
 * for SMS. Every channel sent its code fire-and-forget: the code was issued,
 * the send failed in the background, and the person was told it was sent.
 * Asking for another one did the same.
 *
 * For each channel with a code sent through a provider - SMS, calls, numbers
 * for incoming calls, WhatsApp - these pin that:
 *
 *   - the send is waited for, and the Notification service's refusal comes
 *     back as the person's answer, with the reason;
 *   - a code that never went out is not left live;
 *   - a number whose first code could not be sent is taken out again, so
 *     the add is refused rather than leaving a number nobody can verify;
 *   - a resend that cannot happen (no Twilio account) is refused up front,
 *     before a code is issued and before the cooldown is consulted;
 *   - the verify dialog's status carries that same reason.
 *
 * Only the reads and the sends are stubbed: each service's own code decides.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "8e000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("8e000000-0000-4000-8000-000000000002");
const ITEM_ID: ObjectID = new ObjectID("8e000000-0000-4000-8000-000000000003");
const CODE: string = "482915";
const PHONE: string = "+15551230100";

const PROJECT_TWILIO_CONFIG: TwilioConfig = {
  accountSid: "AC00000000000000000000000000000008",
  authToken: "00000000000000000000000000000008",
  primaryPhoneNumber: new Phone("+15550001111"),
  secondaryPhoneNumbers: [],
};

const SENT: HTTPResponse<JSONObject> = new HTTPResponse<JSONObject>(
  200,
  {},
  {},
);

const TWILIO_REFUSAL_REASON: string =
  "Twilio could not send this SMS: Permission to send an SMS has not been enabled for the region indicated by the 'To' number: +15551230100 (Twilio error 21408).";

const refused: (reason: string) => HTTPErrorResponse = (
  reason: string,
): HTTPErrorResponse => {
  return new HTTPErrorResponse(400, { error: reason }, {});
};

interface ChannelUnderTest {
  name: string;
  service: unknown;
  build: () => DatabaseBaseModel;
  // The Common service the code goes out through, and its method.
  sender: { owner: unknown; method: string };
  // An SMS the project deliberately does not send must answer an error too.
  asksToFailIfNotSent: boolean;
  // What the person is told when there is no Twilio account at all.
  noTwilioAccountMessage: string | null;
}

const withRow: <T extends DatabaseBaseModel>(row: T) => T = <
  T extends DatabaseBaseModel,
>(
  row: T,
): T => {
  row.id = ITEM_ID;
  (row as unknown as Record<string, unknown>)["projectId"] = PROJECT_ID;
  (row as unknown as Record<string, unknown>)["userId"] = USER_ID;
  (row as unknown as Record<string, unknown>)["phone"] = new Phone(PHONE);
  (row as unknown as Record<string, unknown>)["isVerified"] = false;
  return row;
};

const CHANNELS: Array<ChannelUnderTest> = [
  {
    name: "SMS",
    service: UserSmsService,
    build: () => {
      return withRow(new UserSMS());
    },
    sender: { owner: SmsService, method: "sendSms" },
    asksToFailIfNotSent: true,
    noTwilioAccountMessage: getNoTwilioAccountMessage(TwilioMessageKind.SMS),
  },
  {
    name: "Call",
    service: UserCallService,
    build: () => {
      return withRow(new UserCall());
    },
    sender: { owner: CallService, method: "makeCall" },
    asksToFailIfNotSent: false,
    noTwilioAccountMessage: getNoTwilioAccountMessage(TwilioMessageKind.Call),
  },
  {
    name: "Incoming call number",
    service: UserIncomingCallNumberService,
    build: () => {
      return withRow(new UserIncomingCallNumber());
    },
    sender: { owner: SmsService, method: "sendSms" },
    asksToFailIfNotSent: true,
    noTwilioAccountMessage: INCOMING_CALL_NUMBER_NO_TWILIO_ACCOUNT_MESSAGE,
  },
  {
    name: "WhatsApp",
    service: UserWhatsAppService,
    build: () => {
      return withRow(new UserWhatsApp());
    },
    sender: { owner: WhatsAppService, method: "sendWhatsAppMessage" },
    asksToFailIfNotSent: false,
    // WhatsApp goes through Meta, not Twilio.
    noTwilioAccountMessage: null,
  },
];

interface ChannelServiceShape {
  sendVerificationCode: (item: DatabaseBaseModel, code: string) => Promise<void>;
  issueAndSendVerificationCode: (item: DatabaseBaseModel) => Promise<void>;
  resendVerificationCode: (itemId: ObjectID) => Promise<void>;
  getVerificationStatus: (
    item: DatabaseBaseModel,
  ) => Promise<ChannelVerificationStatus>;
  onCreateSuccess: (
    onCreate: OnCreate<DatabaseBaseModel>,
    item: DatabaseBaseModel,
  ) => Promise<DatabaseBaseModel>;
}

const shapeOf: (channel: ChannelUnderTest) => ChannelServiceShape = (
  channel: ChannelUnderTest,
): ChannelServiceShape => {
  return channel.service as unknown as ChannelServiceShape;
};

function projectWith(values: { balanceInCents?: number }): Project {
  const project: Project = new Project();
  project._id = PROJECT_ID.toString();
  project.enableSmsNotifications = true;
  project.enableCallNotifications = true;
  project.enableWhatsAppNotifications = true;
  project.enableTelegramNotifications = true;
  project.smsOrCallCurrentBalanceInUSDCents =
    values.balanceInCents === undefined ? 100000 : values.balanceInCents;
  return project;
}

function serverTwilioAccount(isSetUp: boolean): GlobalConfig | null {
  if (!isSetUp) {
    return null;
  }

  const config: GlobalConfig = new GlobalConfig();
  config.twilioAccountSID = "AC11111111111111111111111111111111";
  config.twilioAuthToken = "11111111111111111111111111111111";
  config.twilioPrimaryPhoneNumber = new Phone("+15550002222");
  return config;
}

let senderMock: jest.SpyInstance;
let updateMock: jest.SpyInstance;
let deleteMock: jest.SpyInstance;

function stubChannel(
  channel: ChannelUnderTest,
  options: {
    answer?: HTTPResponse<JSONObject> | HTTPErrorResponse;
    projectTwilio?: TwilioConfig | undefined;
    serverTwilio?: boolean;
    balanceInCents?: number;
    row?: DatabaseBaseModel | null;
  } = {},
): void {
  senderMock = getJestSpyOn(channel.sender.owner, channel.sender.method)
    .mockResolvedValue(options.answer || SENT);

  getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(
    projectWith({ balanceInCents: options.balanceInCents }),
  );

  getJestSpyOn(
    ProjectCallSMSConfigService,
    "getProjectDefaultTwilioConfig",
  ).mockResolvedValue(options.projectTwilio);

  getJestSpyOn(GlobalConfigService, "findOneBy").mockResolvedValue(
    serverTwilioAccount(options.serverTwilio !== false),
  );

  updateMock = getJestSpyOn(channel.service, "updateOneById").mockResolvedValue(
    1,
  );
  deleteMock = getJestSpyOn(channel.service, "deleteOneById").mockResolvedValue(
    1,
  );

  getJestSpyOn(channel.service, "findOneById").mockResolvedValue(
    options.row === undefined ? channel.build() : options.row,
  );

  // A call number is checked against the person's SMS numbers first.
  getJestSpyOn(UserSmsService, "findBy").mockResolvedValue([]);
}

const writtenData: (call: number) => Record<string, unknown> = (
  call: number,
): Record<string, unknown> => {
  return (updateMock.mock.calls[call]![0] as { data: Record<string, unknown> })
    .data;
};

const ownerCreate: () => OnCreate<DatabaseBaseModel> =
  (): OnCreate<DatabaseBaseModel> => {
    return {
      createBy: {
        data: {} as DatabaseBaseModel,
        props: { userId: USER_ID, tenantId: PROJECT_ID },
      },
      carryForward: null,
    } as unknown as OnCreate<DatabaseBaseModel>;
  };

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(CHANNELS)("$name verification codes", (channel: ChannelUnderTest) => {
  describe("sending a code", () => {
    test("waits for the Notification service and resolves once the code went out", async () => {
      stubChannel(channel);

      await expect(
        shapeOf(channel).sendVerificationCode(channel.build(), CODE),
      ).resolves.toBeUndefined();

      expect(senderMock).toHaveBeenCalledTimes(1);
    });

    test("a refusal comes back to the caller instead of being logged and forgotten", async () => {
      const refusal: HTTPErrorResponse = refused(TWILIO_REFUSAL_REASON);
      stubChannel(channel, { answer: refusal });

      await expect(
        shapeOf(channel).sendVerificationCode(channel.build(), CODE),
      ).rejects.toBe(refusal);
    });

    if (channel.asksToFailIfNotSent) {
      test("asks for an SMS the project deliberately does not send to answer an error, not success", async () => {
        stubChannel(channel);

        await shapeOf(channel).sendVerificationCode(channel.build(), CODE);

        expect(
          (senderMock.mock.calls[0]![1] as Record<string, unknown>)[
            "failIfNotSent"
          ],
        ).toBe(true);
      });
    }
  });

  describe("issuing and sending a code", () => {
    test("a code that went out stays live", async () => {
      stubChannel(channel);

      await shapeOf(channel).issueAndSendVerificationCode(channel.build());

      expect(updateMock).toHaveBeenCalledTimes(1);
      expect(writtenData(0)["verificationCodeExpiresAt"]).toBeInstanceOf(Date);
    });

    test("a code that did not go out says so, to where, and why", async () => {
      stubChannel(channel, { answer: refused(TWILIO_REFUSAL_REASON) });

      let caught: unknown = null;

      try {
        await shapeOf(channel).issueAndSendVerificationCode(channel.build());
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(BadDataException);
      expect((caught as Error).message).toBe(
        `The verification code was not sent to ${PHONE}. ${TWILIO_REFUSAL_REASON}`,
      );
    });

    test("and leaves no live code behind for a message that never arrived", async () => {
      stubChannel(channel, { answer: refused(TWILIO_REFUSAL_REASON) });

      await expect(
        shapeOf(channel).issueAndSendVerificationCode(channel.build()),
      ).rejects.toThrow();

      expect(updateMock).toHaveBeenCalledTimes(2);
      expect(writtenData(1)["verificationCodeExpiresAt"]).toBeNull();
    });
  });

  describe("adding a number", () => {
    test("keeps a number whose first code went out", async () => {
      stubChannel(channel);

      const item: DatabaseBaseModel = channel.build();
      const created: DatabaseBaseModel = await shapeOf(channel).onCreateSuccess(
        ownerCreate(),
        item,
      );

      expect(created).toBe(item);
      expect(deleteMock).not.toHaveBeenCalled();
      expect(senderMock).toHaveBeenCalledTimes(1);
    });

    test("refuses the add, with the reason, and takes the number out when its first code could not be sent", async () => {
      stubChannel(channel, {
        answer: refused(
          channel.noTwilioAccountMessage || "WhatsApp is not set up.",
        ),
      });

      await expect(
        shapeOf(channel).onCreateSuccess(ownerCreate(), channel.build()),
      ).rejects.toThrow(`The verification code was not sent to ${PHONE}.`);

      expect(deleteMock).toHaveBeenCalledTimes(1);
      expect(
        (deleteMock.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
      ).toBe(ITEM_ID.toString());
    });
  });

  describe("sending another code", () => {
    test("goes ahead, issuing a code and sending it, when it can be sent", async () => {
      stubChannel(channel);

      await shapeOf(channel).resendVerificationCode(ITEM_ID);

      expect(senderMock).toHaveBeenCalledTimes(1);
      expect(writtenData(0)["verificationCodeSentAt"]).toBeInstanceOf(Date);
    });

    test("a send that fails is the person's answer, not a quiet success", async () => {
      stubChannel(channel, { answer: refused(TWILIO_REFUSAL_REASON) });

      await expect(
        shapeOf(channel).resendVerificationCode(ITEM_ID),
      ).rejects.toThrow(TWILIO_REFUSAL_REASON);
    });

    test("the cooldown still applies to a code sent a moment ago", async () => {
      const row: DatabaseBaseModel = channel.build();
      (row as unknown as Record<string, unknown>)["verificationCodeSentAt"] =
        new Date();
      stubChannel(channel, { row: row });

      await expect(
        shapeOf(channel).resendVerificationCode(ITEM_ID),
      ).rejects.toBeInstanceOf(TooManyRequestsException);
      expect(senderMock).not.toHaveBeenCalled();
    });

    if (channel.noTwilioAccountMessage) {
      test("is refused up front when no Twilio account is set up, saying who can add one", async () => {
        stubChannel(channel, { projectTwilio: undefined, serverTwilio: false });

        let caught: unknown = null;

        try {
          await shapeOf(channel).resendVerificationCode(ITEM_ID);
        } catch (error) {
          caught = error;
        }

        expect(caught).toBeInstanceOf(BadDataException);
        expect((caught as Error).message).toBe(channel.noTwilioAccountMessage);
        // No code was issued for a send that could not happen.
        expect(updateMock).not.toHaveBeenCalled();
        expect(senderMock).not.toHaveBeenCalled();
      });

      /*
       * Asked before the cooldown: being told to wait 60 seconds for a send
       * that can never happen would only hide the real reason.
       */
      test("the missing account is the reason given, even inside the cooldown", async () => {
        const row: DatabaseBaseModel = channel.build();
        (row as unknown as Record<string, unknown>)["verificationCodeSentAt"] =
          new Date();
        stubChannel(channel, {
          row: row,
          projectTwilio: undefined,
          serverTwilio: false,
        });

        await expect(
          shapeOf(channel).resendVerificationCode(ITEM_ID),
        ).rejects.toThrow(channel.noTwilioAccountMessage);
      });

      test("the project's own Twilio account is enough on a server with none", async () => {
        stubChannel(channel, {
          projectTwilio: PROJECT_TWILIO_CONFIG,
          serverTwilio: false,
        });

        await shapeOf(channel).resendVerificationCode(ITEM_ID);

        expect(senderMock).toHaveBeenCalledTimes(1);
      });
    }
  });

  describe("the verify dialog's status", () => {
    test("says nothing stands in the way when a code can be sent", async () => {
      stubChannel(channel);

      const status: ChannelVerificationStatus = await shapeOf(
        channel,
      ).getVerificationStatus(channel.build());

      expect(status.isVerified).toBe(false);
      expect(status.cannotSendReason).toBeNull();
      expect(status.codeState).toBe(VerificationCodeState.None);
    });

    if (channel.noTwilioAccountMessage) {
      test("says why no code can be sent when there is no Twilio account", async () => {
        stubChannel(channel, { projectTwilio: undefined, serverTwilio: false });

        const status: ChannelVerificationStatus = await shapeOf(
          channel,
        ).getVerificationStatus(channel.build());

        expect(status.cannotSendReason).toBe(channel.noTwilioAccountMessage);
      });
    }

    test("a verified number has nothing to refuse, and the project is not even read", async () => {
      stubChannel(channel);

      const row: DatabaseBaseModel = channel.build();
      (row as unknown as Record<string, unknown>)["isVerified"] = true;

      const status: ChannelVerificationStatus = await shapeOf(
        channel,
      ).getVerificationStatus(row);

      expect(status.isVerified).toBe(true);
      expect(status.cannotSendReason).toBeNull();
      expect(ProjectService.findOneById).not.toHaveBeenCalled();
    });
  });
});

/*
 * WhatsApp is sent while the project has WhatsApp off (the Notification
 * service does not ask), but a code the balance cannot pay for was dropped
 * there without a word - and announced as sent. It is refused here instead,
 * with who can add balance.
 */
describe("WhatsApp codes and the balance", () => {
  const whatsApp: ChannelUnderTest = CHANNELS.find(
    (channel: ChannelUnderTest): boolean => {
      return channel.name === "WhatsApp";
    },
  )!;

  test("sending another one is refused at 1 USD or less, naming who can add balance", async () => {
    stubChannel(whatsApp, { balanceInCents: 100 });

    await expect(
      shapeOf(whatsApp).resendVerificationCode(ITEM_ID),
    ).rejects.toThrow(
      getProjectBalanceTooLowMessage(ProjectNotificationChannel.WhatsApp),
    );
    expect(senderMock).not.toHaveBeenCalled();
  });

  test("the dialog says so up front", async () => {
    stubChannel(whatsApp, { balanceInCents: 50 });

    const status: ChannelVerificationStatus = await shapeOf(
      whatsApp,
    ).getVerificationStatus(whatsApp.build());

    expect(status.cannotSendReason).toBe(
      getProjectBalanceTooLowMessage(ProjectNotificationChannel.WhatsApp),
    );
  });

  test("but not while WhatsApp is merely off, as before", async () => {
    stubChannel(whatsApp);
    const project: Project = projectWith({});
    project.enableWhatsAppNotifications = false;
    getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(project);

    await shapeOf(whatsApp).resendVerificationCode(ITEM_ID);

    expect(senderMock).toHaveBeenCalledTimes(1);
  });
});

beforeEach(() => {
  // Each test stubs what it reads; nothing leaks from the last one.
  jest.restoreAllMocks();
});
