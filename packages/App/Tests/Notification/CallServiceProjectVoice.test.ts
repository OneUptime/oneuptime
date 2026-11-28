import CallService from "../../FeatureSet/Notification/Services/CallService";
import { getVoicemailVoiceOfCall } from "../../FeatureSet/Notification/Utils/VoicemailCallback";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import Project from "Common/Models/DatabaseModels/Project";
import CallLogService from "Common/Server/Services/CallLogService";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import MessagingBalance from "Common/Server/Utils/Billing/MessagingBalance";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import CallRequest from "Common/Types/Call/CallRequest";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import URL from "Common/Types/API/URL";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import OnCallTimelineRows from "Common/Tests/Server/TestingUtils/OnCallTimelineRows";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import Twilio from "twilio";

/*
 * A PROJECT'S OWN VOICE, THROUGH THE SERVER'S TWILIO ACCOUNT (#11065).
 *
 * A project that calls through the server's own account speaks with the
 * server's voice, unless the server's master admin lets projects choose
 * (GlobalConfig.letProjectsChooseCallVoice): its own voice
 * (Project.callVoice) is then the one its calls speak with - every <Say>,
 * the keypad's answers and the message left on voicemail - and the server's
 * account pays for it, with the owner's consent. Never on OneUptime Cloud,
 * whose account OneUptime pays for. A project's own Twilio config keeps
 * its own voice. A voice never stops a call: should the switch not be
 * read, the call speaks with the server's voice.
 */

interface BillingSwitch {
  __projectVoiceTestBillingEnabled: boolean;
}

jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = {
    __esModule: true,
    ...actual,
    Host: "oneuptime.example.com",
    HttpProtocol: "https://",
  };
  const billing: BillingSwitch = globalThis as unknown as BillingSwitch;
  billing.__projectVoiceTestBillingEnabled = false;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return billing.__projectVoiceTestBillingEnabled;
    },
  });

  return mocked;
});

function setBillingEnabled(value: boolean): void {
  (globalThis as unknown as BillingSwitch).__projectVoiceTestBillingEnabled =
    value;
}

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
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    },
    EXTERNAL_FAULT: {},
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
    getCallAndSmsGateway: jest.fn(),
  };
});

import {
  getCallAndSmsGateway,
  getTwilioConfig,
} from "../../FeatureSet/Notification/Config";

const PROJECT_ID: ObjectID = new ObjectID(
  "11065000-0000-4000-8000-000000000001",
);

const NOTIFICATION_ID: ObjectID = new ObjectID(
  "11065000-0000-4000-8000-000000000002",
);

const SERVER_VOICE: string = "Polly.Joanna-Neural";
const PROJECT_VOICE: string = "Polly.Matthew-Neural";

// The server's own account, with the voice its admin chose.
const SERVER_ACCOUNT: TwilioConfig = {
  accountSid: "AC-server",
  authToken: "server-auth-token",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
  callVoice: SERVER_VOICE,
};

// A Twilio config of the project's own, with a voice of its own.
const PROJECT_ACCOUNT: TwilioConfig = {
  accountSid: "AC-project",
  authToken: "project-auth-token",
  primaryPhoneNumber: new Phone("+14155550111"),
  secondaryPhoneNumbers: [],
  callVoice: "Polly.Amy-Neural",
};

let createCall: jest.Mock;
let callLogs: Array<CallLog>;
let project: Project;
let timeline: OnCallTimelineRows;
// What the server's row says of the switch, per test; a function that throws stands for a failed read.
let switchRead: () => Promise<GlobalConfig | null>;
let globalConfigReads: jest.SpyInstance;

function serverRow(isOn: boolean | null | undefined): GlobalConfig {
  const row: GlobalConfig = new GlobalConfig();

  (row as unknown as Record<string, unknown>)["letProjectsChooseCallVoice"] =
    isOn;

  return row;
}

// An on-call page: its sentences, then the keypad.
function pageCall(): CallRequest {
  return {
    to: new Phone("+15555550142"),
    data: [
      { sayMessage: "This is a call from Acme" },
      { sayMessage: "A new incident has been created" },
      {
        introMessage: "To acknowledge this incident, press 1.",
        numDigits: 1,
        timeoutInSeconds: 10,
        noInputMessage: "You have not entered any input. Good bye",
        onInputCallRequest: {
          "1": { sayMessage: "You have acknowledged this incident. Good bye" },
          default: { sayMessage: "Invalid input. Good bye" },
        },
        responseUrl: URL.fromString(
          "https://oneuptime.example.com/api/user-notification-log-timeline/call/gather-input/x",
        ),
      },
    ],
  };
}

function twimlOf(index: number = 0): string {
  return String(
    (createCall.mock.calls[index]![0] as JSONObject)["twiml"] || "",
  );
}

// A <Say>'s voice, and a <Gather>'s action.
const SAY_VOICE: RegExp = /voice="([^"]+)"/;
const GATHER_ACTION: RegExp = /<Gather [^>]*action="([^"]+)"/;

// The voice every <Say> of the call names: one, or none.
function voicesOf(twiml: string): Array<string> {
  return Array.from(
    new Set(
      (twiml.match(/<Say[^>]*>/g) || []).map((say: string): string => {
        return SAY_VOICE.exec(say)?.[1] || "";
      }),
    ),
  );
}

// The voice the keypad's answers are said in: the one the call's token carries.
function keypadVoiceOf(twiml: string): unknown {
  const action: RegExpExecArray | null = GATHER_ACTION.exec(twiml);

  expect(action).not.toBeNull();

  const url: globalThis.URL = new globalThis.URL(
    action![1]!.replace(/&amp;/g, "&"),
  );

  return JSONWebToken.decodeJsonPayload(url.searchParams.get("token")!)[
    "voice"
  ];
}

async function placePage(
  options: { customTwilioConfig?: TwilioConfig } = {},
): Promise<string> {
  await CallService.makeCall(pageCall(), {
    projectId: PROJECT_ID,
    userOnCallLogTimelineId: NOTIFICATION_ID,
    ...options,
  });

  expect(createCall).toHaveBeenCalledTimes(1);

  return twimlOf();
}

beforeEach(() => {
  setBillingEnabled(false);

  (getCallAndSmsGateway as unknown as jest.Mock).mockReset();
  (getCallAndSmsGateway as unknown as jest.Mock).mockResolvedValue(null);
  (getTwilioConfig as unknown as jest.Mock).mockReset();
  (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(SERVER_ACCOUNT);

  createCall = jest.fn().mockResolvedValue({
    sid: "CA0123456789abcdef0123456789abcdef",
    duration: "0",
  });
  (Twilio as unknown as jest.Mock).mockReset();
  (Twilio as unknown as jest.Mock).mockImplementation(() => {
    return { calls: { create: createCall } };
  });

  project = new Project();
  project._id = PROJECT_ID.toString();
  project.name = "Acme";
  project.enableCallNotifications = true;
  project.smsOrCallCurrentBalanceInUSDCents = 10000;
  project.callVoice = PROJECT_VOICE;

  jest.spyOn(ProjectService, "findOneById").mockImplementation((() => {
    return Promise.resolve(project);
  }) as never);
  jest.spyOn(ProjectService, "updateOneById").mockResolvedValue(1 as never);
  jest
    .spyOn(NotificationService, "rechargeIfBalanceIsLow")
    .mockResolvedValue(10000 as never);
  jest
    .spyOn(MessagingBalance, "shouldTellOwnersBalanceIsLow")
    .mockResolvedValue(false);
  jest.spyOn(MessagingBalance, "payForSentMessage").mockResolvedValue(0);

  switchRead = async (): Promise<GlobalConfig | null> => {
    return serverRow(true);
  };
  globalConfigReads = jest
    .spyOn(GlobalConfigService, "findOneById")
    .mockImplementation((() => {
      return switchRead();
    }) as never);

  callLogs = [];

  jest.spyOn(CallLogService, "create").mockImplementation(((data: {
    data: CallLog;
  }) => {
    callLogs.push(data.data);
    return Promise.resolve(data.data);
  }) as never);

  timeline = new OnCallTimelineRows();
  timeline.add(NOTIFICATION_ID, UserNotificationStatus.Sending);
  timeline.standIn(UserOnCallLogTimelineService);

  jest
    .spyOn(UserOnCallLogTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  setBillingEnabled(false);
});

describe("while the server lets projects choose", () => {
  test("the project's voice names every <Say>, in its language", async () => {
    const twiml: string = await placePage();

    expect(voicesOf(twiml)).toEqual([PROJECT_VOICE]);
    expect(twiml).toContain(`<Say voice="${PROJECT_VOICE}" language="en-US">`);
    expect(twiml).not.toContain(SERVER_VOICE);
  });

  test("the keypad's answers are said in it too: the call's token carries it", async () => {
    expect(keypadVoiceOf(await placePage())).toBe(PROJECT_VOICE);
  });

  test("and the message left on voicemail", async () => {
    await placePage();

    expect(getVoicemailVoiceOfCall(callLogs[0]!.callData)).toBe(PROJECT_VOICE);
  });

  test("the switch is read once, as the server's own row, and nothing is written", async () => {
    await placePage();

    expect(globalConfigReads).toHaveBeenCalledTimes(1);

    const read: {
      id: ObjectID;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    } = globalConfigReads.mock.calls[0]![0] as never;

    expect(read.id.toString()).toBe(ObjectID.getZeroObjectID().toString());
    expect(read.select).toEqual({ letProjectsChooseCallVoice: true });
    expect(read.props).toEqual({ isRoot: true });
  });

  test("a server with no voice of its own: the project's voice all the same, which its owner let projects choose", async () => {
    (getTwilioConfig as unknown as jest.Mock).mockResolvedValue({
      ...SERVER_ACCOUNT,
      callVoice: undefined,
    });

    expect(voicesOf(await placePage())).toEqual([PROJECT_VOICE]);
  });

  test("a project that chose none speaks with the server's voice, and the switch is not even read", async () => {
    project.callVoice = undefined;

    expect(voicesOf(await placePage())).toEqual([SERVER_VOICE]);
    expect(globalConfigReads).not.toHaveBeenCalled();
  });

  test.each([
    ["empty", ""],
    ["a Basic voice", "alice"],
    ["a voice the list no longer holds", "Polly.Kevin-Neural"],
    ["another language's voice", "Polly.Vicki-Neural"],
  ])(
    "a project voice that is %s is none: the server's voice, and the call is placed",
    async (_label: string, value: string) => {
      project.callVoice = value;

      expect(voicesOf(await placePage())).toEqual([SERVER_VOICE]);
    },
  );

  test("a project's own Twilio config keeps its own voice: the project's voice is for the server's account", async () => {
    const twiml: string = await placePage({
      customTwilioConfig: PROJECT_ACCOUNT,
    });

    expect(voicesOf(twiml)).toEqual(["Polly.Amy-Neural"]);
    expect(globalConfigReads).not.toHaveBeenCalled();
  });
});

describe("while the server does not", () => {
  test.each([
    ["switched off", false],
    ["never set", undefined],
    ["empty", null],
  ])(
    "%s: the server's voice, whatever the project chose",
    async (_label: string, isOn: boolean | null | undefined) => {
      switchRead = async (): Promise<GlobalConfig | null> => {
        return serverRow(isOn);
      };

      const twiml: string = await placePage();

      expect(voicesOf(twiml)).toEqual([SERVER_VOICE]);
      expect(keypadVoiceOf(twiml)).toBe(SERVER_VOICE);
      expect(getVoicemailVoiceOfCall(callLogs[0]!.callData)).toBe(SERVER_VOICE);
    },
  );

  test("a server whose row cannot be found: the server's voice", async () => {
    switchRead = async (): Promise<GlobalConfig | null> => {
      return null;
    };

    expect(voicesOf(await placePage())).toEqual([SERVER_VOICE]);
  });

  test("a switch that cannot be read never stops the call: it goes out in the server's voice", async () => {
    switchRead = async (): Promise<GlobalConfig | null> => {
      throw new Error("The database is not reachable.");
    };

    expect(voicesOf(await placePage())).toEqual([SERVER_VOICE]);
  });

  test("with no server voice either: the account's default voice, naming none", async () => {
    switchRead = async (): Promise<GlobalConfig | null> => {
      return serverRow(false);
    };
    (getTwilioConfig as unknown as jest.Mock).mockResolvedValue({
      ...SERVER_ACCOUNT,
      callVoice: undefined,
    });

    const twiml: string = await placePage();

    expect(twiml).not.toContain("voice=");
  });
});

describe("on OneUptime Cloud", () => {
  test("the server's voice, even with the switch on and a voice chosen: OneUptime's account pays for it", async () => {
    setBillingEnabled(true);

    expect(voicesOf(await placePage())).toEqual([SERVER_VOICE]);
    // The switch is never even read there.
    expect(globalConfigReads).not.toHaveBeenCalled();
  });

  test("a project's own Twilio config keeps its own voice there too", async () => {
    setBillingEnabled(true);

    expect(
      voicesOf(await placePage({ customTwilioConfig: PROJECT_ACCOUNT })),
    ).toEqual(["Polly.Amy-Neural"]);
  });
});

describe("getServerAccountCallVoice", () => {
  test.each([
    // [what the project chose, the switch, billing, the voice]
    [PROJECT_VOICE, true, false, PROJECT_VOICE],
    [PROJECT_VOICE, false, false, SERVER_VOICE],
    [PROJECT_VOICE, true, true, SERVER_VOICE],
    [undefined, true, false, SERVER_VOICE],
    [null, true, false, SERVER_VOICE],
    ["  Polly.Brian-Neural  ", true, false, "Polly.Brian-Neural"],
  ])(
    "project %p, switch %p, billing %p: %p",
    async (
      projectVoice: string | null | undefined,
      isOn: boolean,
      isBilling: boolean,
      voice: string,
    ) => {
      setBillingEnabled(isBilling);
      switchRead = async (): Promise<GlobalConfig | null> => {
        return serverRow(isOn);
      };

      await expect(
        CallService.getServerAccountCallVoice({
          serverVoice: SERVER_VOICE,
          project: { callVoice: projectVoice },
        }),
      ).resolves.toBe(voice);
    },
  );

  test("no project - a call that is no project's - speaks with the server's voice", async () => {
    await expect(
      CallService.getServerAccountCallVoice({
        serverVoice: SERVER_VOICE,
        project: null,
      }),
    ).resolves.toBe(SERVER_VOICE);
    expect(globalConfigReads).not.toHaveBeenCalled();
  });

  test("a server voice the list does not hold is none", async () => {
    project.callVoice = undefined;

    await expect(
      CallService.getServerAccountCallVoice({
        serverVoice: "man",
        project: project,
      }),
    ).resolves.toBeUndefined();
  });
});
