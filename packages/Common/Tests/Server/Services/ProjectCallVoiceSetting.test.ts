import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import Project from "../../../Models/DatabaseModels/Project";
import GlobalConfigAPI from "../../../Server/API/GlobalConfigAPI";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CALL_VOICES,
  CALL_VOICE_VALUES,
  CallVoice,
  getCallVoiceCentsOfAPage,
} from "../../../Types/Call/CallVoice";
import ProjectCallVoice, {
  PROJECT_CALL_VOICES_NOT_ON_CLOUD_MESSAGE,
  PROJECT_CALL_VOICE_NOT_OFFERED_MESSAGE,
  PROJECT_CALL_VOICE_NOT_ON_CLOUD_MESSAGE,
} from "../../../Types/Call/ProjectCallVoice";
import ColumnType from "../../../Types/Database/ColumnType";
import TableColumnType from "../../../Types/Database/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A PROJECT'S OWN CALL VOICE THROUGH THE SERVER'S TWILIO ACCOUNT (#11065).
 *
 * Twilio charges the account that places a call for its voice, so a
 * project's voice through the server's account is paid for by the server's
 * owner. The owner decides, with a switch that starts off
 * (GlobalConfig.letProjectsChooseCallVoice): while it is off, or on
 * OneUptime Cloud - whose account OneUptime pays for - no project chooses a
 * voice, and the server says so to a write that tries, rather than saving
 * a voice nothing speaks with. These pin the rules, the columns that hold
 * them, the writes they refuse and what the Dashboard is told.
 */

interface BillingSwitch {
  __projectCallVoiceSettingBillingEnabled: boolean;
}

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const billing: BillingSwitch = globalThis as unknown as BillingSwitch;
  billing.__projectCallVoiceSettingBillingEnabled = false;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return billing.__projectCallVoiceSettingBillingEnabled;
    },
  });

  return mocked;
});

function setBillingEnabled(value: boolean): void {
  (
    globalThis as unknown as BillingSwitch
  ).__projectCallVoiceSettingBillingEnabled = value;
}

type ServiceWithHooks<T extends DatabaseBaseModel> = {
  onBeforeUpdate(updateBy: UpdateBy<T>): Promise<OnUpdate<T>>;
};

const globalHooks: ServiceWithHooks<GlobalConfig> =
  GlobalConfigService as unknown as ServiceWithHooks<GlobalConfig>;

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

const OWNER: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  tenantId: ObjectID.generate(),
} as DatabaseCommonInteractionProps;

const MASTER_ADMIN: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  isMasterAdmin: true,
} as DatabaseCommonInteractionProps;

const REFUSED_VOICES: ReadonlyArray<unknown> = [
  "man",
  "alice",
  "Polly.Joanna",
  "polly.joanna-neural",
  "Polly.Vicki-Neural",
  'Polly.Joanna-Neural"><Dial>+19005550100</Dial>',
  42,
  true,
  { voice: "Polly.Joanna-Neural" },
];

// What the server's row says of the switch, per test.
let switchRow: GlobalConfig | null;
let globalConfigReads: jest.SpyInstance;

function rowWithSwitch(isOn: boolean | null | undefined): GlobalConfig {
  const row: GlobalConfig = new GlobalConfig();

  (row as unknown as Record<string, unknown>)["letProjectsChooseCallVoice"] =
    isOn;

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

// A write of the project's voice, through ProjectService's own rule.
async function writeProjectVoice(
  value: unknown,
  props: DatabaseCommonInteractionProps = OWNER,
): Promise<{ callVoice?: unknown }> {
  const data: { callVoice?: unknown } = { callVoice: value };

  await ProjectService.applyCallVoiceRules(data, props);

  return data;
}

function columnOf(
  model: { new (): unknown },
  propertyName: string,
): ColumnMetadataArgs {
  const column: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .filterColumns(model)
    .find((candidate: ColumnMetadataArgs): boolean => {
      return candidate.propertyName === propertyName;
    });

  expect(column).toBeDefined();

  return column!;
}

beforeEach(() => {
  setBillingEnabled(false);
  switchRow = rowWithSwitch(true);
  globalConfigReads = jest
    .spyOn(GlobalConfigService, "findOneById")
    .mockImplementation((() => {
      return Promise.resolve(switchRow);
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  setBillingEnabled(false);
});

describe("the rules (Types/Call/ProjectCallVoice)", () => {
  test.each([
    [false, true, true],
    [false, false, false],
    [false, undefined, false],
    [false, null, false],
    [false, "true", false],
    [false, 1, false],
    [true, true, false],
    [true, false, false],
  ])(
    "billing %p, switch %p: offered %p",
    (isBillingEnabled: boolean, isOn: unknown, isOffered: boolean) => {
      expect(
        ProjectCallVoice.areOffered({
          isBillingEnabled: isBillingEnabled,
          letProjectsChooseCallVoice: isOn,
        }),
      ).toBe(isOffered);
    },
  );

  test("offered, the project's voice; else the server's; else none", () => {
    const voice: (data: {
      serverVoice: unknown;
      projectVoice: unknown;
      areOffered: boolean;
    }) => string | undefined = ProjectCallVoice.getVoiceOnServerAccount;

    expect(
      voice({
        serverVoice: "Polly.Joanna-Neural",
        projectVoice: "Polly.Brian-Neural",
        areOffered: true,
      }),
    ).toBe("Polly.Brian-Neural");
    expect(
      voice({
        serverVoice: "Polly.Joanna-Neural",
        projectVoice: "Polly.Brian-Neural",
        areOffered: false,
      }),
    ).toBe("Polly.Joanna-Neural");
    expect(
      voice({
        serverVoice: "Polly.Joanna-Neural",
        projectVoice: undefined,
        areOffered: true,
      }),
    ).toBe("Polly.Joanna-Neural");
    expect(
      voice({
        serverVoice: undefined,
        projectVoice: "Google.en-US-Neural2-J",
        areOffered: true,
      }),
    ).toBe("Google.en-US-Neural2-J");
    expect(
      voice({
        serverVoice: undefined,
        projectVoice: "Google.en-US-Neural2-J",
        areOffered: false,
      }),
    ).toBeUndefined();
    // A voice the list does not hold is none, on either side.
    expect(
      voice({
        serverVoice: "man",
        projectVoice: "alice",
        areOffered: true,
      }),
    ).toBeUndefined();
  });

  test("what a write of a voice is told: nothing for no voice; on Cloud, why not there; else, while not offered, who can offer it", () => {
    for (const value of [undefined, null, "", "   "]) {
      for (const isBillingEnabled of [false, true]) {
        for (const isOn of [true, false, undefined]) {
          expect(
            ProjectCallVoice.getWriteError({
              value: value,
              isBillingEnabled: isBillingEnabled,
              letProjectsChooseCallVoice: isOn,
            }),
          ).toBe(null);
        }
      }
    }

    expect(
      ProjectCallVoice.getWriteError({
        value: "Polly.Amy-Neural",
        isBillingEnabled: true,
        letProjectsChooseCallVoice: true,
      }),
    ).toBe(PROJECT_CALL_VOICE_NOT_ON_CLOUD_MESSAGE);
    expect(
      ProjectCallVoice.getWriteError({
        value: "Polly.Amy-Neural",
        isBillingEnabled: false,
        letProjectsChooseCallVoice: false,
      }),
    ).toBe(PROJECT_CALL_VOICE_NOT_OFFERED_MESSAGE);
    expect(
      ProjectCallVoice.getWriteError({
        value: "Polly.Amy-Neural",
        isBillingEnabled: false,
        letProjectsChooseCallVoice: true,
      }),
    ).toBe(null);
  });

  test("the words say where to go, and never promise what is not there", () => {
    expect(PROJECT_CALL_VOICE_NOT_OFFERED_MESSAGE).toContain(
      "Admin Dashboard > Settings > Call and SMS",
    );
    expect(PROJECT_CALL_VOICE_NOT_ON_CLOUD_MESSAGE).toContain(
      "Project Settings > Notifications > Notification Channels",
    );
    expect(PROJECT_CALL_VOICES_NOT_ON_CLOUD_MESSAGE).toContain(
      "Twilio config of its own",
    );
  });

  test("what a page's call costs in a project's voice: the dearest voice's, the price every voice picker says", () => {
    expect(ProjectCallVoice.getMostCentsOfAPage()).toBe(
      Math.max(
        ...CALL_VOICES.map((voice: CallVoice): number => {
          return getCallVoiceCentsOfAPage(voice);
        }),
      ),
    );
    expect(ProjectCallVoice.getMostCentsOfAPage()).toBe(3);
  });
});

describe("the columns", () => {
  test("the project's voice: a short, nullable text with no default, saying the voices it takes", () => {
    const column: ColumnMetadataArgs = columnOf(Project, "callVoice");

    expect(column.options.type).toBe(ColumnType.ShortText);
    expect(column.options.nullable).toBe(true);
    expect(column.options.default).toBeUndefined();

    const project: Project = new Project();

    expect(project.getTableColumnMetadata("callVoice").type).toBe(
      TableColumnType.ShortText,
    );
    expect(project.getTableColumnMetadata("callVoice").allowedValues).toEqual(
      CALL_VOICE_VALUES,
    );
  });

  test("the project's voice is chosen by its owners and admins - the people who choose its other call settings - and read by its members", () => {
    const project: Project = new Project();
    const access: ReturnType<Project["getColumnAccessControlFor"]> =
      project.getColumnAccessControlFor("callVoice");

    expect(access?.update).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]);
    expect(access?.create).toEqual([]);
    expect(access?.read).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.ReadProject,
      ]),
    );
    expect(access).toEqual(
      project.getColumnAccessControlFor("detectVoicemailOnCalls"),
    );
  });

  test("the switch: a nullable boolean, off by default, for the server's master admins alone", () => {
    const column: ColumnMetadataArgs = columnOf(
      GlobalConfig,
      "letProjectsChooseCallVoice",
    );

    expect(column.options.type).toBe(ColumnType.Boolean);
    expect(column.options.default).toBe(false);

    const config: GlobalConfig = new GlobalConfig();

    expect(
      config.getTableColumnMetadata("letProjectsChooseCallVoice").type,
    ).toBe(TableColumnType.Boolean);
    expect(
      config.getColumnAccessControlFor("letProjectsChooseCallVoice"),
    ).toEqual({ create: [], read: [], update: [] });
  });
});

describe("a write of a project's voice", () => {
  describe("while the server lets projects choose", () => {
    test.each(CALL_VOICE_VALUES)("takes %s", async (voice: string) => {
      expect((await writeProjectVoice(voice)).callVoice).toBe(voice);
    });

    test("stores it as the list writes it, without the spaces around it", async () => {
      expect((await writeProjectVoice("  Polly.Brian-Neural ")).callVoice).toBe(
        "Polly.Brian-Neural",
      );
    });

    test.each(REFUSED_VOICES)(
      "refuses %p, a voice OneUptime does not offer",
      async (voice: unknown) => {
        await expect(writeProjectVoice(voice)).rejects.toThrow(
          /is not one OneUptime offers/,
        );
      },
    );

    test("reads the switch from the server's own row, as OneUptime", async () => {
      await writeProjectVoice("Polly.Amy-Neural");

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
  });

  describe("while it does not", () => {
    test.each([
      ["switched off", false],
      ["never set", undefined],
      ["empty", null],
    ])(
      "%s: a voice is refused, saying who can let projects choose",
      async (_label: string, isOn: boolean | null | undefined) => {
        switchRow = rowWithSwitch(isOn);

        await expect(writeProjectVoice("Polly.Amy-Neural")).rejects.toThrow(
          new BadDataException(PROJECT_CALL_VOICE_NOT_OFFERED_MESSAGE),
        );
      },
    );

    test("a server whose row cannot be found does not offer it", async () => {
      switchRow = null;

      await expect(writeProjectVoice("Polly.Amy-Neural")).rejects.toThrow(
        PROJECT_CALL_VOICE_NOT_OFFERED_MESSAGE,
      );
    });

    test.each([null, ""])(
      "clearing the voice (%p) is always taken: back to the server's voice",
      async (value: null | string) => {
        switchRow = rowWithSwitch(false);

        expect((await writeProjectVoice(value)).callVoice).toBeNull();
        // Nothing to ask the server about.
        expect(globalConfigReads).not.toHaveBeenCalled();
      },
    );

    test("a voice OneUptime does not offer is refused for that, first", async () => {
      switchRow = rowWithSwitch(false);

      await expect(writeProjectVoice("man")).rejects.toThrow(
        /is not one OneUptime offers/,
      );
    });

    test("OneUptime's own writes are not asked", async () => {
      switchRow = rowWithSwitch(false);

      expect(
        (await writeProjectVoice("Polly.Amy-Neural", ROOT)).callVoice,
      ).toBe("Polly.Amy-Neural");
      expect(globalConfigReads).not.toHaveBeenCalled();
    });
  });

  describe("on OneUptime Cloud", () => {
    test("a voice is refused, saying a Twilio config of the project's own chooses one - without reading the switch", async () => {
      setBillingEnabled(true);

      await expect(writeProjectVoice("Polly.Amy-Neural")).rejects.toThrow(
        new BadDataException(PROJECT_CALL_VOICE_NOT_ON_CLOUD_MESSAGE),
      );
      expect(globalConfigReads).not.toHaveBeenCalled();
    });

    test("even by a master admin", async () => {
      setBillingEnabled(true);

      await expect(
        writeProjectVoice("Polly.Amy-Neural", MASTER_ADMIN),
      ).rejects.toThrow(PROJECT_CALL_VOICE_NOT_ON_CLOUD_MESSAGE);
    });

    test("clearing it is taken", async () => {
      setBillingEnabled(true);

      expect((await writeProjectVoice(null)).callVoice).toBeNull();
    });
  });

  test("a write that says nothing of the voice is left as it is, and asks nothing", async () => {
    const data: { callVoice?: unknown; name?: string } = { name: "Acme" };

    await ProjectService.applyCallVoiceRules(data, OWNER);

    expect(data).toEqual({ name: "Acme" });
    expect(globalConfigReads).not.toHaveBeenCalled();
  });
});

describe("the switch", () => {
  test.each([true, false])(
    "a master admin of a self-hosted server sets it %p",
    async (isOn: boolean) => {
      const updateBy: UpdateBy<GlobalConfig> = globalUpdate({
        letProjectsChooseCallVoice: isOn,
      });

      await expect(globalHooks.onBeforeUpdate(updateBy)).resolves.toBeDefined();
      expect(updateBy.data.letProjectsChooseCallVoice).toBe(isOn);
    },
  );

  test("on OneUptime Cloud, turning it on is refused - by anyone", async () => {
    setBillingEnabled(true);

    for (const props of [MASTER_ADMIN, ROOT]) {
      await expect(
        globalHooks.onBeforeUpdate(
          globalUpdate({ letProjectsChooseCallVoice: true }, props),
        ),
      ).rejects.toThrow(
        new BadDataException(PROJECT_CALL_VOICES_NOT_ON_CLOUD_MESSAGE),
      );
    }
  });

  test("on OneUptime Cloud, turning it off, or a write that leaves it out, is taken", async () => {
    setBillingEnabled(true);

    await expect(
      globalHooks.onBeforeUpdate(
        globalUpdate({ letProjectsChooseCallVoice: false }),
      ),
    ).resolves.toBeDefined();
    await expect(
      globalHooks.onBeforeUpdate(
        globalUpdate({ twilioCallVoice: "Polly.Amy-Neural" }),
      ),
    ).resolves.toBeDefined();
  });
});

describe("what the Dashboard is told (GET /global-config/vars)", () => {
  function told(row: GlobalConfig | null): unknown {
    return (GlobalConfigAPI.buildVarsResponse(row) as JSONObject)[
      "canProjectsChooseCallVoice"
    ];
  }

  test("that projects choose only while the switch is on", () => {
    expect(told(rowWithSwitch(true))).toBe(true);
    expect(told(rowWithSwitch(false))).toBe(false);
    expect(told(rowWithSwitch(undefined))).toBe(false);
    expect(told(rowWithSwitch(null))).toBe(false);
    expect(told(null)).toBe(false);
  });

  test("never on OneUptime Cloud, whatever the row says", () => {
    setBillingEnabled(true);

    expect(told(rowWithSwitch(true))).toBe(false);
  });

  test("only whether: nothing of the voices chosen, and the answer stays the shape it was", () => {
    const answer: JSONObject = GlobalConfigAPI.buildVarsResponse(
      rowWithSwitch(true),
    );

    expect(Object.keys(answer).sort()).toEqual(
      [
        "canProjectsChooseCallVoice",
        "canSendEmail",
        "disablePushNotifications",
        "disableUserProjectCreation",
      ].sort(),
    );
  });
});
