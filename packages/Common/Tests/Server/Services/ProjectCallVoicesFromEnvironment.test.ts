import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalConfigAPI from "../../../Server/API/GlobalConfigAPI";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import {
  getLetProjectsChooseCallVoice,
  getServerTwilioProjectCallVoices,
} from "../../../Server/Utils/ServerTwilioConfig";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  PROJECT_CALL_VOICES_NOT_ON_CLOUD_MESSAGE,
  PROJECT_CALL_VOICE_NOT_OFFERED_MESSAGE,
  PROJECT_CALL_VOICE_NOT_ON_CLOUD_MESSAGE,
} from "../../../Types/Call/ProjectCallVoice";
import {
  SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_SET_BY_ENVIRONMENT_MESSAGE,
  SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE,
} from "../../../Types/CallAndSMS/ServerTwilioEnvironment";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHETHER PROJECTS CHOOSE THEIR CALL VOICE, SET BY GLOBAL_TWILIO_LET_
 * PROJECTS_CHOOSE_CALL_VOICE (#11462), AS THE SERVER READS IT.
 *
 * An installation kept entirely in code gives the master admin's consent -
 * Let projects choose their call voice - with the variable. Once it is set
 * it is the switch, for every reader: the calls and a project's write of
 * its voice (GlobalConfigService.canProjectsChooseCallVoice), and what the
 * Dashboard is told (GET /global-config/vars) - with no read of the saved
 * switch, whatever that says. A value that is neither true nor false is
 * no. The server refuses a write to the saved switch while the variable
 * sets it, saying where it is changed; OneUptime's own writes go through.
 * On OneUptime Cloud the variable is never the switch: projects never
 * choose a voice there, and turning the switch on is still refused.
 */

interface BillingSwitch {
  __projectCallVoicesFromEnvironmentBillingEnabled: boolean;
}

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const billing: BillingSwitch = globalThis as unknown as BillingSwitch;
  billing.__projectCallVoicesFromEnvironmentBillingEnabled = false;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return billing.__projectCallVoicesFromEnvironmentBillingEnabled;
    },
  });

  return mocked;
});

function setBillingEnabled(value: boolean): void {
  (
    globalThis as unknown as BillingSwitch
  ).__projectCallVoicesFromEnvironmentBillingEnabled = value;
}

type ServiceWithHooks<T extends DatabaseBaseModel> = {
  onBeforeUpdate(updateBy: UpdateBy<T>): Promise<OnUpdate<T>>;
  onBeforeCreate(createBy: CreateBy<T>): Promise<OnCreate<T>>;
};

const globalHooks: ServiceWithHooks<GlobalConfig> =
  GlobalConfigService as unknown as ServiceWithHooks<GlobalConfig>;

const VARIABLE: string = SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE;

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

const OWNER: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  tenantId: ObjectID.generate(),
} as DatabaseCommonInteractionProps;

const MASTER_ADMIN: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  isMasterAdmin: true,
} as DatabaseCommonInteractionProps;

// What the server's row says of the switch, per test.
let switchRow: GlobalConfig | null;
let globalConfigReads: jest.SpyInstance;
let variableBefore: string | undefined;

function rowWithSwitch(isOn: boolean | null | undefined): GlobalConfig {
  const row: GlobalConfig = new GlobalConfig();

  (row as unknown as Record<string, unknown>)["letProjectsChooseCallVoice"] =
    isOn;

  return row;
}

function setVariable(value: string | undefined): void {
  if (value === undefined) {
    delete process.env[VARIABLE];
  } else {
    process.env[VARIABLE] = value;
  }
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

function globalCreate(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps = MASTER_ADMIN,
): CreateBy<GlobalConfig> {
  const row: GlobalConfig = new GlobalConfig();

  Object.assign(row, data);

  return { data: row, props: props };
}

// A write of the project's voice, through ProjectService's own rule.
async function writeProjectVoice(
  value: unknown,
  props: DatabaseCommonInteractionProps = OWNER,
): Promise<{ callVoice?: unknown }> {
  const data: { callVoice?: unknown } = { callVoice: value };

  await ProjectService.applyCallVoiceRules(data, props);

  return data;
}

function told(row: GlobalConfig | null): unknown {
  return (GlobalConfigAPI.buildVarsResponse(row) as JSONObject)[
    "canProjectsChooseCallVoice"
  ];
}

beforeEach(() => {
  variableBefore = process.env[VARIABLE];
  setVariable(undefined);
  setBillingEnabled(false);
  switchRow = rowWithSwitch(false);
  globalConfigReads = jest
    .spyOn(GlobalConfigService, "findOneById")
    .mockImplementation((() => {
      return Promise.resolve(switchRow);
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  setBillingEnabled(false);
  setVariable(variableBefore);
});

describe("the reading the server takes (ServerTwilioConfig)", () => {
  test("is read from the environment as it is now, on every call", () => {
    expect(getServerTwilioProjectCallVoices().isSet).toBe(false);

    setVariable("true");
    expect(getServerTwilioProjectCallVoices()).toEqual({
      isSet: true,
      letProjectsChoose: true,
      problem: null,
    });

    setVariable("false");
    expect(getServerTwilioProjectCallVoices().letProjectsChoose).toBe(false);

    setVariable(undefined);
    expect(getServerTwilioProjectCallVoices().isSet).toBe(false);
  });

  test("on OneUptime Cloud it is never the switch", () => {
    setBillingEnabled(true);
    setVariable("true");

    expect(getServerTwilioProjectCallVoices().isSet).toBe(false);
    expect(getServerTwilioProjectCallVoices().problem).toContain("ignored");
  });

  test.each([
    ["unset", undefined, true, true],
    ["unset", undefined, false, false],
    ["unset", undefined, undefined, undefined],
    ["true", "true", false, true],
    ["false", "false", true, false],
    ["neither", "yes", true, false],
  ])(
    "%s: the switch every reader takes is the variable's once it is set, else the saved one as read",
    (
      _label: string,
      value: string | undefined,
      saved: boolean | undefined,
      expected: boolean | undefined,
    ) => {
      setVariable(value);

      expect(getLetProjectsChooseCallVoice(saved)).toBe(expected);
    },
  );
});

describe("whether projects choose (GlobalConfigService.canProjectsChooseCallVoice)", () => {
  test("unset: the saved switch, read from the server's own row as OneUptime", async () => {
    switchRow = rowWithSwitch(true);
    expect(await GlobalConfigService.canProjectsChooseCallVoice()).toBe(true);

    switchRow = rowWithSwitch(false);
    expect(await GlobalConfigService.canProjectsChooseCallVoice()).toBe(false);

    switchRow = null;
    expect(await GlobalConfigService.canProjectsChooseCallVoice()).toBe(false);

    const read: {
      id: ObjectID;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    } = globalConfigReads.mock.calls[0]![0] as never;

    expect(read.id.toString()).toBe(ObjectID.getZeroObjectID().toString());
    expect(read.select).toEqual({ letProjectsChooseCallVoice: true });
    expect(read.props).toEqual({ isRoot: true });
  });

  test("true: yes, without a read of the row, whatever it says", async () => {
    setVariable("true");
    switchRow = rowWithSwitch(false);

    expect(await GlobalConfigService.canProjectsChooseCallVoice()).toBe(true);
    expect(globalConfigReads).not.toHaveBeenCalled();
  });

  test("false: no, without a read of the row, whatever it says", async () => {
    setVariable("False");
    switchRow = rowWithSwitch(true);

    expect(await GlobalConfigService.canProjectsChooseCallVoice()).toBe(false);
    expect(globalConfigReads).not.toHaveBeenCalled();
  });

  test("neither true nor false: no - never the saved switch nobody set the variable to", async () => {
    setVariable("yes");
    switchRow = rowWithSwitch(true);

    expect(await GlobalConfigService.canProjectsChooseCallVoice()).toBe(false);
    expect(globalConfigReads).not.toHaveBeenCalled();
  });

  test("on OneUptime Cloud: no, with nothing read, whatever the variable and the row say", async () => {
    setBillingEnabled(true);
    switchRow = rowWithSwitch(true);

    for (const value of [undefined, "true", "false", "yes"]) {
      setVariable(value);
      expect(await GlobalConfigService.canProjectsChooseCallVoice()).toBe(
        false,
      );
    }

    expect(globalConfigReads).not.toHaveBeenCalled();
  });

  test("a row that cannot be read is said to the caller, who decides what it means", async () => {
    globalConfigReads.mockRejectedValue(new Error("connection terminated"));

    await expect(
      GlobalConfigService.canProjectsChooseCallVoice(),
    ).rejects.toThrow("connection terminated");

    // The variable needs no row.
    setVariable("true");
    expect(await GlobalConfigService.canProjectsChooseCallVoice()).toBe(true);
  });
});

describe("a write to the saved switch while the variable sets it", () => {
  test.each([
    ["true", true],
    ["true", false],
    ["true", null],
    ["false", true],
    ["false", false],
    ["yes", true],
  ])(
    "with the variable %s, a master admin's write of %p is refused, saying where to change it",
    async (value: string, written: boolean | null) => {
      setVariable(value);

      await expect(
        globalHooks.onBeforeUpdate(
          globalUpdate({ letProjectsChooseCallVoice: written }),
        ),
      ).rejects.toThrow(
        new BadDataException(
          SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_SET_BY_ENVIRONMENT_MESSAGE,
        ),
      );
    },
  );

  test("a create that writes it is refused too", async () => {
    setVariable("true");

    await expect(
      globalHooks.onBeforeCreate(
        globalCreate({ letProjectsChooseCallVoice: true }),
      ),
    ).rejects.toThrow(
      SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_SET_BY_ENVIRONMENT_MESSAGE,
    );
  });

  test("OneUptime's own writes go through: they change nothing a call says", async () => {
    setVariable("true");

    const updateBy: UpdateBy<GlobalConfig> = globalUpdate(
      { letProjectsChooseCallVoice: false },
      ROOT,
    );

    await expect(globalHooks.onBeforeUpdate(updateBy)).resolves.toBeDefined();
    expect(updateBy.data.letProjectsChooseCallVoice).toBe(false);
  });

  test("a write that leaves the switch out is taken: the call voice, say", async () => {
    setVariable("true");

    await expect(
      globalHooks.onBeforeUpdate(
        globalUpdate({ twilioCallVoice: "Polly.Amy-Neural" }),
      ),
    ).resolves.toBeDefined();
  });

  test("unset, a master admin's write of the switch is taken, as it always was", async () => {
    for (const written of [true, false]) {
      const updateBy: UpdateBy<GlobalConfig> = globalUpdate({
        letProjectsChooseCallVoice: written,
      });

      await expect(globalHooks.onBeforeUpdate(updateBy)).resolves.toBeDefined();
      expect(updateBy.data.letProjectsChooseCallVoice).toBe(written);
    }
  });

  test("on OneUptime Cloud the variable refuses nothing: turning the switch on is refused for Cloud, off is taken", async () => {
    setBillingEnabled(true);
    setVariable("true");

    await expect(
      globalHooks.onBeforeUpdate(
        globalUpdate({ letProjectsChooseCallVoice: true }),
      ),
    ).rejects.toThrow(
      new BadDataException(PROJECT_CALL_VOICES_NOT_ON_CLOUD_MESSAGE),
    );
    await expect(
      globalHooks.onBeforeUpdate(
        globalUpdate({ letProjectsChooseCallVoice: false }),
      ),
    ).resolves.toBeDefined();
  });
});

describe("a write of a project's voice while the variable sets the switch", () => {
  test("true: a voice is taken, though the saved switch is off, and the row is not read", async () => {
    setVariable("true");
    switchRow = rowWithSwitch(false);

    expect((await writeProjectVoice("Polly.Brian-Neural")).callVoice).toBe(
      "Polly.Brian-Neural",
    );
    expect(globalConfigReads).not.toHaveBeenCalled();
  });

  test("false: a voice is refused, though the saved switch is on", async () => {
    setVariable("false");
    switchRow = rowWithSwitch(true);

    await expect(writeProjectVoice("Polly.Brian-Neural")).rejects.toThrow(
      new BadDataException(PROJECT_CALL_VOICE_NOT_OFFERED_MESSAGE),
    );
  });

  test("neither true nor false: a voice is refused", async () => {
    setVariable("on");
    switchRow = rowWithSwitch(true);

    await expect(writeProjectVoice("Polly.Brian-Neural")).rejects.toThrow(
      PROJECT_CALL_VOICE_NOT_OFFERED_MESSAGE,
    );
  });

  test("clearing the voice is always taken: back to the server's voice", async () => {
    setVariable("false");

    expect((await writeProjectVoice(null)).callVoice).toBeNull();
    expect((await writeProjectVoice("")).callVoice).toBeNull();
  });

  test("a voice OneUptime does not offer is refused for that, first", async () => {
    setVariable("true");

    await expect(writeProjectVoice("Polly.Vicki-Neural")).rejects.toThrow(
      /is not one OneUptime offers/,
    );
  });

  test("on OneUptime Cloud a voice is refused for Cloud, whatever the variable says", async () => {
    setBillingEnabled(true);
    setVariable("true");

    await expect(writeProjectVoice("Polly.Brian-Neural")).rejects.toThrow(
      new BadDataException(PROJECT_CALL_VOICE_NOT_ON_CLOUD_MESSAGE),
    );
    expect(globalConfigReads).not.toHaveBeenCalled();
  });
});

describe("what the Dashboard is told (GET /global-config/vars) while the variable sets the switch", () => {
  test("true: projects choose, whatever the row says", () => {
    setVariable("true");

    expect(told(rowWithSwitch(false))).toBe(true);
    expect(told(rowWithSwitch(undefined))).toBe(true);
    expect(told(null)).toBe(true);
  });

  test("false, or neither: they do not, whatever the row says", () => {
    for (const value of ["false", "FALSE", "yes", "1"]) {
      setVariable(value);

      expect([value, told(rowWithSwitch(true))]).toEqual([value, false]);
    }
  });

  test("unset: the row's switch, as before", () => {
    expect(told(rowWithSwitch(true))).toBe(true);
    expect(told(rowWithSwitch(false))).toBe(false);
  });

  test("never on OneUptime Cloud", () => {
    setBillingEnabled(true);
    setVariable("true");

    expect(told(rowWithSwitch(true))).toBe(false);
  });
});
