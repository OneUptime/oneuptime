import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import TwilioAccountAvailability from "../../../Server/Utils/TwilioAccountAvailability";
import {
  GLOBAL_CALL_AND_SMS_GATEWAY_SELECT,
  GLOBAL_TWILIO_CONFIG_SELECT,
} from "../../../Server/Utils/TwilioConfigSelect";
import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import { TwilioConfigUse } from "../../../Types/CallAndSMS/TwilioConfigUse";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import { TwilioMessageKind } from "../../../Utils/Project/TwilioAccount";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

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
 * WHETHER AN SMS OR A CALL HAS SOMEWHERE TO GO, ON A SERVER THAT SENDS
 * THROUGH ITS OWN GATEWAY.
 *
 * The channel services ask before they send a verification code, so a code
 * that cannot go anywhere is refused up front. A server set to its own
 * gateway (Types/CallAndSMS/CallAndSmsProvider) has somewhere to send every
 * SMS and every call, whatever its Twilio account holds - nothing at all,
 * or an account used for one kind only - so it counts for both kinds, as
 * the Notification service sends both through it. A server set to the
 * gateway without a URL has no gateway, and is asked about its Twilio
 * account as before. Both are read in the one read of the settings row.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-000000000001",
);

const URL_TEXT: string = "https://sms-gateway.internal.example.com/oneuptime";

const US: string = "+15550002222";
const SG_MOBILE: string = "+6581234567";

let globalConfig: GlobalConfig | null;
let projectDefault: TwilioConfig | undefined;
let findOneBy: jest.SpyInstance;

function server(values: Record<string, unknown>): GlobalConfig {
  return Object.assign(new GlobalConfig(), values);
}

const GATEWAY: Record<string, unknown> = {
  callAndSmsProvider: "Gateway",
  callAndSmsGatewayUrl: URL_TEXT,
  callAndSmsGatewaySecret: "d".repeat(64),
};

const TWILIO_ACCOUNT: Record<string, unknown> = {
  twilioAccountSID: "AC11111111111111111111111111111111",
  twilioAuthToken: "11111111111111111111111111111111",
  twilioPrimaryPhoneNumber: new Phone(US),
};

const KINDS: Array<TwilioMessageKind | undefined> = [
  TwilioMessageKind.SMS,
  TwilioMessageKind.Call,
  undefined,
];

beforeEach(() => {
  globalConfig = null;
  projectDefault = undefined;

  findOneBy = jest
    .spyOn(GlobalConfigService, "findOneBy")
    .mockImplementation((async (): Promise<GlobalConfig | null> => {
      return globalConfig;
    }) as never);

  jest
    .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
    .mockImplementation(async (): Promise<TwilioConfig | undefined> => {
      return projectDefault;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the server's own gateway counts as somewhere to send", () => {
  test.each(
    KINDS.map((kind: TwilioMessageKind | undefined) => {
      return [kind];
    }),
  )(
    "for %p, with no Twilio account at all",
    async (kind: TwilioMessageKind | undefined) => {
      globalConfig = server(GATEWAY);

      expect(await TwilioAccountAvailability.isServerAccountSetUp(kind)).toBe(
        true,
      );
    },
  );

  test("for calls too, on a server whose Twilio account sends SMS only", async () => {
    globalConfig = server({
      ...GATEWAY,
      twilioAccountSID: "AC11111111111111111111111111111111",
      twilioAuthToken: "11111111111111111111111111111111",
      twilioUsedFor: TwilioConfigUse.SmsOnly,
      twilioSmsPhoneNumbers: SG_MOBILE,
    });

    expect(
      await TwilioAccountAvailability.isServerAccountSetUp(
        TwilioMessageKind.Call,
      ),
    ).toBe(true);
  });

  test("for SMS too, on a server whose Twilio account makes calls only", async () => {
    globalConfig = server({
      ...GATEWAY,
      ...TWILIO_ACCOUNT,
      twilioUsedFor: TwilioConfigUse.CallsOnly,
    });

    expect(
      await TwilioAccountAvailability.isServerAccountSetUp(
        TwilioMessageKind.SMS,
      ),
    ).toBe(true);
  });

  test("even when the stored list of Twilio numbers cannot be read", async () => {
    globalConfig = server({
      ...GATEWAY,
      ...TWILIO_ACCOUNT,
      twilioSecondaryPhoneNumbers: "not a number",
    });

    expect(await TwilioAccountAvailability.isServerAccountSetUp()).toBe(true);
  });
});

describe("a server without a usable gateway is asked about its Twilio account, as before", () => {
  test.each(
    KINDS.map((kind: TwilioMessageKind | undefined) => {
      return [kind];
    }),
  )(
    "set to the gateway with no URL, and no Twilio account: nowhere to send %p",
    async (kind: TwilioMessageKind | undefined) => {
      globalConfig = server({
        callAndSmsProvider: "Gateway",
        callAndSmsGatewaySecret: "d".repeat(64),
      });

      expect(await TwilioAccountAvailability.isServerAccountSetUp(kind)).toBe(
        false,
      );
    },
  );

  test("set to the gateway with a blank URL, but a Twilio account: the account counts", async () => {
    globalConfig = server({
      callAndSmsProvider: "Gateway",
      callAndSmsGatewayUrl: "   ",
      ...TWILIO_ACCOUNT,
    });

    expect(await TwilioAccountAvailability.isServerAccountSetUp()).toBe(true);
  });

  test.each(
    KINDS.map((kind: TwilioMessageKind | undefined) => {
      return [kind];
    }),
  )(
    "sending through Twilio with a URL kept for later, and no Twilio account: nowhere to send %p",
    async (kind: TwilioMessageKind | undefined) => {
      globalConfig = server({
        ...GATEWAY,
        callAndSmsProvider: "Twilio",
      });

      expect(await TwilioAccountAvailability.isServerAccountSetUp(kind)).toBe(
        false,
      );
    },
  );

  test("a provider that is not one, from a row edited by hand, is Twilio", async () => {
    globalConfig = server({ ...GATEWAY, callAndSmsProvider: "gateway" });

    expect(await TwilioAccountAvailability.isServerAccountSetUp()).toBe(false);
  });

  test("sending through Twilio, an account used for SMS only still makes no calls", async () => {
    globalConfig = server({
      ...GATEWAY,
      callAndSmsProvider: "Twilio",
      twilioAccountSID: "AC11111111111111111111111111111111",
      twilioAuthToken: "11111111111111111111111111111111",
      twilioUsedFor: TwilioConfigUse.SmsOnly,
      twilioSmsPhoneNumbers: SG_MOBILE,
    });

    expect(
      await TwilioAccountAvailability.isServerAccountSetUp(
        TwilioMessageKind.SMS,
      ),
    ).toBe(true);
    expect(
      await TwilioAccountAvailability.isServerAccountSetUp(
        TwilioMessageKind.Call,
      ),
    ).toBe(false);
  });
});

describe("the one read of the settings row", () => {
  test("reads the Twilio account and the gateway's columns together, as OneUptime", async () => {
    globalConfig = server(GATEWAY);

    await TwilioAccountAvailability.isServerAccountSetUp(TwilioMessageKind.SMS);

    expect(findOneBy).toHaveBeenCalledTimes(1);

    const call: {
      query: { _id: string };
      props: { isRoot: boolean };
      select: Record<string, unknown>;
    } = findOneBy.mock.calls[0]![0] as {
      query: { _id: string };
      props: { isRoot: boolean };
      select: Record<string, unknown>;
    };

    expect(call.query._id).toBe(ObjectID.getZeroObjectID().toString());
    expect(call.props.isRoot).toBe(true);
    expect(call.select).toEqual({
      ...GLOBAL_TWILIO_CONFIG_SELECT,
      ...GLOBAL_CALL_AND_SMS_GATEWAY_SELECT,
    });
    // Every column of both lists, none left out.
    for (const column of [
      ...Object.keys(GLOBAL_TWILIO_CONFIG_SELECT),
      ...Object.keys(GLOBAL_CALL_AND_SMS_GATEWAY_SELECT),
    ]) {
      expect({ column, selected: call.select[column] }).toEqual({
        column,
        selected: true,
      });
    }
  });

  test("a server with no settings row has nowhere to send", async () => {
    globalConfig = null;

    expect(await TwilioAccountAvailability.isServerAccountSetUp()).toBe(false);
    expect(findOneBy).toHaveBeenCalledTimes(1);
  });
});

describe("whether a project's message has somewhere to go, on a server with a gateway", () => {
  test("a project with no Twilio config of its own sends through the server's gateway", async () => {
    globalConfig = server(GATEWAY);

    for (const kind of [TwilioMessageKind.SMS, TwilioMessageKind.Call]) {
      expect(
        await TwilioAccountAvailability.isAccountAvailableForProject({
          projectId: PROJECT_ID,
          kind: kind,
        }),
      ).toBe(true);
    }
  });

  test("a project default used for SMS only sends its calls through the server's gateway", async () => {
    projectDefault = {
      accountSid: "AC00000000000000000000000000000007",
      authToken: "00000000000000000000000000000007",
      secondaryPhoneNumbers: [],
      use: TwilioConfigUse.SmsOnly,
      smsPhoneNumbers: [new Phone(SG_MOBILE)],
    };
    globalConfig = server(GATEWAY);

    expect(
      await TwilioAccountAvailability.isAccountAvailableForProject({
        projectId: PROJECT_ID,
        kind: TwilioMessageKind.Call,
      }),
    ).toBe(true);
  });

  test("a project's own Twilio config is enough without asking the server at all", async () => {
    projectDefault = {
      accountSid: "AC00000000000000000000000000000007",
      authToken: "00000000000000000000000000000007",
      primaryPhoneNumber: new Phone(US),
      secondaryPhoneNumbers: [],
    };

    expect(
      await TwilioAccountAvailability.isAccountAvailableForProject({
        projectId: PROJECT_ID,
        kind: TwilioMessageKind.SMS,
      }),
    ).toBe(true);
    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("a project on a server set to the gateway without a URL, and with no Twilio account, has nowhere to send", async () => {
    globalConfig = server({ callAndSmsProvider: "Gateway" });

    expect(
      await TwilioAccountAvailability.isAccountAvailableForProject({
        projectId: PROJECT_ID,
        kind: TwilioMessageKind.SMS,
      }),
    ).toBe(false);
  });
});
