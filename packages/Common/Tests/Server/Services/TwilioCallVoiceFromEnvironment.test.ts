import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import {
  getServerCallVoice,
  getServerTwilioCallVoice,
  toServerTwilioConfig,
} from "../../../Server/Utils/ServerTwilioConfig";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CALL_VOICE_VALUES } from "../../../Types/Call/CallVoice";
import {
  SERVER_TWILIO_CALL_VOICE_SET_BY_ENVIRONMENT_MESSAGE,
  SERVER_TWILIO_CALL_VOICE_VARIABLE,
  SERVER_TWILIO_ENVIRONMENT_VARIABLES,
  ServerTwilioEnvironmentVariable,
} from "../../../Types/CallAndSMS/ServerTwilioEnvironment";
import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE VOICE OF THE SERVER'S CALLS, FROM GLOBAL_TWILIO_CALL_VOICE (#11064),
 * AS THE SENDERS TAKE IT AND AS THE SERVER GUARDS IT.
 *
 * Once the variable is set, the voice is the one it names - whoever sets
 * the account, the row or the GLOBAL_TWILIO_ variables - and the voice
 * saved in the Admin Dashboard is not used; the server refuses a write to
 * it, saying where the voice is changed instead. A value that names no
 * voice OneUptime offers leaves the calls in the account's default voice:
 * never the saved voice, which nobody set the variable to, and never no
 * call. Unset or empty, the saved voice applies, as before.
 */

type ServiceWithHooks<T extends DatabaseBaseModel> = {
  onBeforeCreate(createBy: CreateBy<T>): Promise<OnCreate<T>>;
  onBeforeUpdate(updateBy: UpdateBy<T>): Promise<OnUpdate<T>>;
};

const globalHooks: ServiceWithHooks<GlobalConfig> =
  GlobalConfigService as unknown as ServiceWithHooks<GlobalConfig>;

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

const MASTER_ADMIN: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  isMasterAdmin: true,
} as DatabaseCommonInteractionProps;

const ENV_SID: string = "AC22222222222222222222222222222222";
const ROW_SID: string = "AC11111111111111111111111111111111";

const VARIABLES: Array<string> = [
  ...SERVER_TWILIO_ENVIRONMENT_VARIABLES,
  SERVER_TWILIO_CALL_VOICE_VARIABLE,
];

const environmentBefore: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const variable of VARIABLES) {
    environmentBefore[variable] = process.env[variable];
    delete process.env[variable];
  }
});

afterEach(() => {
  jest.restoreAllMocks();

  for (const variable of VARIABLES) {
    if (environmentBefore[variable] === undefined) {
      delete process.env[variable];
    } else {
      process.env[variable] = environmentBefore[variable];
    }
  }
});

function setVoiceVariable(value: string): void {
  process.env[SERVER_TWILIO_CALL_VOICE_VARIABLE] = value;
}

function setAccountVariables(): void {
  process.env[ServerTwilioEnvironmentVariable.AccountSid] = ENV_SID;
  process.env[ServerTwilioEnvironmentVariable.AuthToken] = "env-auth-token";
  process.env[ServerTwilioEnvironmentVariable.PrimaryPhoneNumber] =
    "+14155550100";
}

// The server's row: its account, and the voice saved in the Admin Dashboard.
function serverRow(savedVoice?: string): GlobalConfig {
  const row: GlobalConfig = new GlobalConfig();
  row.twilioAccountSID = ROW_SID;
  row.twilioAuthToken = "row-auth-token";
  row.twilioPrimaryPhoneNumber = new Phone("+14155550199");

  if (savedVoice !== undefined) {
    row.twilioCallVoice = savedVoice;
  }

  return row;
}

function globalUpdate(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps = MASTER_ADMIN,
): UpdateBy<GlobalConfig> {
  return {
    query: { _id: ObjectID.getZeroObjectID().toString() },
    data: data as UpdateBy<GlobalConfig>["data"],
    limit: 1,
    skip: 0,
    props: props,
  };
}

describe("the voice the server's calls speak with", () => {
  test("unset: the voice saved in the Admin Dashboard, as before", () => {
    expect(getServerCallVoice(serverRow("Polly.Amy-Neural"))).toBe(
      "Polly.Amy-Neural",
    );
    expect(toServerTwilioConfig(serverRow("Polly.Amy-Neural"))).toEqual(
      expect.objectContaining({
        accountSid: ROW_SID,
        callVoice: "Polly.Amy-Neural",
      }),
    );
  });

  test.each(["", "   "])(
    "set to %p: not set, so the saved voice",
    (value: string) => {
      setVoiceVariable(value);

      expect(getServerTwilioCallVoice().isSet).toBe(false);
      expect(getServerCallVoice(serverRow("Polly.Amy-Neural"))).toBe(
        "Polly.Amy-Neural",
      );
    },
  );

  test.each(CALL_VOICE_VALUES)(
    "set to %s: that voice, in place of the saved one, for the account the row holds",
    (voice: string) => {
      setVoiceVariable(voice);

      expect(getServerCallVoice(serverRow("Polly.Amy-Neural"))).toBe(voice);
      expect(toServerTwilioConfig(serverRow("Polly.Amy-Neural"))).toEqual(
        expect.objectContaining({ accountSid: ROW_SID, callVoice: voice }),
      );
    },
  );

  test("set, with a row that saved no voice: the variable's voice", () => {
    setVoiceVariable("Google.en-US-Neural2-F");

    expect(toServerTwilioConfig(serverRow())).toEqual(
      expect.objectContaining({ callVoice: "Google.en-US-Neural2-F" }),
    );
  });

  test("set beside the account's variables: the variables' account, in the variable's voice", () => {
    setAccountVariables();
    setVoiceVariable("Polly.Matthew-Neural");

    expect(toServerTwilioConfig(serverRow("Polly.Amy-Neural"))).toEqual(
      expect.objectContaining({
        accountSid: ENV_SID,
        callVoice: "Polly.Matthew-Neural",
      }),
    );
  });

  test("the account's variables alone leave the voice to the Admin Dashboard, as they did", () => {
    setAccountVariables();

    expect(toServerTwilioConfig(serverRow("Polly.Brian-Neural"))).toEqual(
      expect.objectContaining({
        accountSid: ENV_SID,
        callVoice: "Polly.Brian-Neural",
      }),
    );
  });

  test.each(["Polly.Joanna", "alice", "polly.joanna-neural", "Polly.Vicki-Neural"])(
    "set to %p, which names no voice OneUptime offers: the account's default voice - never the saved one - and the call still goes out",
    (value: string) => {
      setVoiceVariable(value);

      const config: TwilioConfig | null = toServerTwilioConfig(
        serverRow("Polly.Amy-Neural"),
      );

      expect(config).not.toBeNull();
      expect(config!.accountSid).toBe(ROW_SID);
      expect(Object.keys(config!)).not.toContain("callVoice");
      expect(getServerCallVoice(serverRow("Polly.Amy-Neural"))).toBeUndefined();
    },
  );

  test("a voice problem never stops the variables' account from sending", () => {
    setAccountVariables();
    setVoiceVariable("nope");

    const config: TwilioConfig | null = toServerTwilioConfig(serverRow());

    expect(config).not.toBeNull();
    expect(config!.accountSid).toBe(ENV_SID);
    expect(Object.keys(config!)).not.toContain("callVoice");
  });

  test("an account that is not set up has no voice to speak with, whatever the variable says", () => {
    setVoiceVariable("Polly.Joanna-Neural");

    expect(toServerTwilioConfig(new GlobalConfig())).toBeNull();
    expect(toServerTwilioConfig(null)).toBeNull();
  });

  test("read again on every call: a change of the variable is the voice of the next call", () => {
    setVoiceVariable("Polly.Joanna-Neural");
    expect(getServerCallVoice(serverRow())).toBe("Polly.Joanna-Neural");

    setVoiceVariable("Polly.Brian-Neural");
    expect(getServerCallVoice(serverRow())).toBe("Polly.Brian-Neural");

    delete process.env[SERVER_TWILIO_CALL_VOICE_VARIABLE];
    expect(getServerCallVoice(serverRow("Polly.Amy-Neural"))).toBe(
      "Polly.Amy-Neural",
    );
  });
});

describe("a write to the saved voice", () => {
  test.each([
    ["a voice", "Polly.Joanna-Neural"],
    ["none", null],
    ["empty", ""],
    // Refused as set by the variable before it is looked at.
    ["a voice OneUptime does not offer", "man"],
  ])(
    "while the variable sets the voice, %s is refused, saying where the voice is changed",
    async (_label: string, value: string | null) => {
      setVoiceVariable("Polly.Matthew-Neural");

      await expect(
        globalHooks.onBeforeUpdate(globalUpdate({ twilioCallVoice: value })),
      ).rejects.toThrow(
        new BadDataException(
          SERVER_TWILIO_CALL_VOICE_SET_BY_ENVIRONMENT_MESSAGE,
        ),
      );
    },
  );

  test("refused on create too", async () => {
    setVoiceVariable("Polly.Matthew-Neural");

    const createBy: CreateBy<GlobalConfig> = {
      data: Object.assign(new GlobalConfig(), {
        twilioCallVoice: "Polly.Joanna-Neural",
      }),
      props: MASTER_ADMIN,
    };

    await expect(globalHooks.onBeforeCreate(createBy)).rejects.toThrow(
      SERVER_TWILIO_CALL_VOICE_SET_BY_ENVIRONMENT_MESSAGE,
    );
  });

  test("a variable that names no voice still sets it: the write is refused, as the voice is the variable's to fix", async () => {
    setVoiceVariable("Polly.Nobody-Neural");

    await expect(
      globalHooks.onBeforeUpdate(
        globalUpdate({ twilioCallVoice: "Polly.Joanna-Neural" }),
      ),
    ).rejects.toThrow(SERVER_TWILIO_CALL_VOICE_SET_BY_ENVIRONMENT_MESSAGE);
  });

  test("a write that leaves the voice out goes through: the switch beside it, the gateway, anything else", async () => {
    setVoiceVariable("Polly.Matthew-Neural");

    const updateBy: UpdateBy<GlobalConfig> = globalUpdate({
      letProjectsChooseCallVoice: true,
    });

    await expect(globalHooks.onBeforeUpdate(updateBy)).resolves.toBeDefined();
    expect(updateBy.data.letProjectsChooseCallVoice).toBe(true);
  });

  test("OneUptime's own writes go through, and change nothing a call says", async () => {
    setVoiceVariable("Polly.Matthew-Neural");

    const updateBy: UpdateBy<GlobalConfig> = globalUpdate(
      { twilioCallVoice: "Polly.Joanna-Neural" },
      ROOT,
    );

    await expect(globalHooks.onBeforeUpdate(updateBy)).resolves.toBeDefined();
    expect(getServerCallVoice(serverRow("Polly.Joanna-Neural"))).toBe(
      "Polly.Matthew-Neural",
    );
  });

  test("with the variable unset, a master admin saves the voice, as before - also while the account's variables set the account", async () => {
    setAccountVariables();

    const updateBy: UpdateBy<GlobalConfig> = globalUpdate({
      twilioCallVoice: "Polly.Joanna-Neural",
    });

    await expect(globalHooks.onBeforeUpdate(updateBy)).resolves.toBeDefined();
    expect(updateBy.data.twilioCallVoice).toBe("Polly.Joanna-Neural");
  });

  test("the voice variable alone never locks the account's fields: those are the account variables' to lock", async () => {
    setVoiceVariable("Polly.Matthew-Neural");

    const updateBy: UpdateBy<GlobalConfig> = globalUpdate({
      twilioAccountSID: ROW_SID,
    });

    await expect(globalHooks.onBeforeUpdate(updateBy)).resolves.toBeDefined();
  });
});
