import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import GlobalConfigService, {
  SERVER_TWILIO_ACCOUNT_COLUMNS,
} from "../../../Server/Services/GlobalConfigService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { toServerTwilioConfig } from "../../../Server/Utils/ServerTwilioConfig";
import {
  GLOBAL_TWILIO_CONFIG_SELECT,
  PROJECT_TWILIO_CONFIG_SELECT,
} from "../../../Server/Utils/TwilioConfigSelect";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CALL_VOICE_VALUES } from "../../../Types/Call/CallVoice";
import {
  SERVER_TWILIO_ENVIRONMENT_VARIABLES,
  ServerTwilioEnvironmentVariable,
} from "../../../Types/CallAndSMS/ServerTwilioEnvironment";
import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import TwilioConfigJSON from "../../../Types/CallAndSMS/TwilioConfigJSON";
import ColumnType from "../../../Types/Database/ColumnType";
import TableColumnType from "../../../Types/Database/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Phone from "../../../Types/Phone";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE VOICE A TWILIO ACCOUNT'S CALLS SPEAK WITH, AS IT IS STORED, CHECKED AND
 * SENT (#10948).
 *
 * The server's own account (GlobalConfig.twilioCallVoice) and a project's
 * own (ProjectCallSMSConfig.twilioCallVoice) each hold one voice of
 * OneUptime's list, or none - the account's default voice, as every call
 * spoke with before. A write of any other voice is refused, an empty one is
 * stored as none, and the voice travels with the account to every call.
 */

type ServiceWithHooks<T> = {
  onBeforeCreate(createBy: CreateBy<T>): Promise<OnCreate<T>>;
  onBeforeUpdate(updateBy: UpdateBy<T>): Promise<OnUpdate<T>>;
};

const projectHooks: ServiceWithHooks<ProjectCallSMSConfig> =
  ProjectCallSMSConfigService as unknown as ServiceWithHooks<ProjectCallSMSConfig>;
const globalHooks: ServiceWithHooks<GlobalConfig> =
  GlobalConfigService as unknown as ServiceWithHooks<GlobalConfig>;

const PROJECT_ID: ObjectID = new ObjectID(
  "0fa10948-0000-4000-8000-000000000001",
);
const CONFIG_ID: ObjectID = new ObjectID(
  "0fa10948-0000-4000-8000-000000000002",
);

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

const MASTER_ADMIN: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  isMasterAdmin: true,
} as DatabaseCommonInteractionProps;

const REFUSED_VOICES: ReadonlyArray<unknown> = [
  "man",
  "alice",
  "Polly.Joanna",
  "Google.en-US-Chirp3-HD-Aoede",
  "polly.joanna-neural",
  'Polly.Joanna-Neural"><Dial>+19005550100</Dial>',
  42,
  { voice: "Polly.Joanna-Neural" },
];

function projectUpdate(
  data: Record<string, unknown>,
): UpdateBy<ProjectCallSMSConfig> {
  return {
    query: { _id: CONFIG_ID.toString() },
    data: data as UpdateBy<ProjectCallSMSConfig>["data"],
    limit: 1,
    skip: 0,
    props: ROOT,
  };
}

function globalUpdate(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps = ROOT,
): UpdateBy<GlobalConfig> {
  return {
    query: { _id: ObjectID.getZeroObjectID().toString() },
    data: data as UpdateBy<GlobalConfig>["data"],
    limit: 1,
    skip: 0,
    props: props,
  };
}

function storedProjectConfig(voice?: unknown): ProjectCallSMSConfig {
  const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();
  config._id = CONFIG_ID.toString();
  config.projectId = PROJECT_ID;
  config.twilioAccountSID = "AC00000000000000000000000000000001";
  config.twilioAuthToken = "auth-token";
  config.twilioPrimaryPhoneNumber = new Phone("+14155550100");

  if (voice !== undefined) {
    config.twilioCallVoice = voice as string;
  }

  return config;
}

function serverRow(voice?: unknown): GlobalConfig {
  const row: GlobalConfig = new GlobalConfig();
  row.twilioAccountSID = "AC11111111111111111111111111111111";
  row.twilioAuthToken = "server-auth-token";
  row.twilioPrimaryPhoneNumber = new Phone("+14155550199");

  if (voice !== undefined) {
    row.twilioCallVoice = voice as string;
  }

  return row;
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

const environmentBefore: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const variable of SERVER_TWILIO_ENVIRONMENT_VARIABLES) {
    environmentBefore[variable] = process.env[variable];
    delete process.env[variable];
  }
});

afterEach(() => {
  jest.restoreAllMocks();

  for (const variable of SERVER_TWILIO_ENVIRONMENT_VARIABLES) {
    if (environmentBefore[variable] === undefined) {
      delete process.env[variable];
    } else {
      process.env[variable] = environmentBefore[variable];
    }
  }
});

describe("the columns", () => {
  test.each([
    [ProjectCallSMSConfig as { new (): unknown }],
    [GlobalConfig as { new (): unknown }],
  ])(
    "%p: a short, nullable text with no default, saying the voices it takes",
    (model: { new (): unknown }) => {
      const column: ColumnMetadataArgs = columnOf(model, "twilioCallVoice");

      expect(column.options.type).toBe(ColumnType.ShortText);
      expect(column.options.nullable).toBe(true);
      expect(column.options.default).toBeUndefined();

      const metadata: {
        type: TableColumnType;
        required?: boolean;
        allowedValues?: ReadonlyArray<string>;
        title: string;
      } = (
        new (model as {
          new (): ProjectCallSMSConfig;
        })() as ProjectCallSMSConfig
      ).getTableColumnMetadata("twilioCallVoice") as never;

      expect(metadata.type).toBe(TableColumnType.ShortText);
      expect(metadata.required).toBeFalsy();
      expect(metadata.allowedValues).toEqual(CALL_VOICE_VALUES);
      expect(metadata.title).toBe("Twilio Call Voice");
    },
  );

  test("a project's: whoever may write the config's numbers may choose its voice, and whoever reads them reads it", () => {
    const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();
    const voice: Record<
      string,
      Array<Permission>
    > = config.getColumnAccessControlFor("twilioCallVoice")! as never;
    const numbers: Record<
      string,
      Array<Permission>
    > = config.getColumnAccessControlFor("twilioSmsPhoneNumbers")! as never;

    expect([...voice["create"]!].sort()).toEqual(
      [...numbers["create"]!].sort(),
    );
    expect([...voice["read"]!].sort()).toEqual([...numbers["read"]!].sort());
    expect([...voice["update"]!].sort()).toEqual(
      [...numbers["update"]!].sort(),
    );
  });

  test("the server's: for its master admins alone, as every column of its account", () => {
    const voice: Record<
      string,
      Array<Permission>
    > = new GlobalConfig().getColumnAccessControlFor(
      "twilioCallVoice",
    )! as never;

    expect(voice).toEqual({ create: [], read: [], update: [] });
  });

  test("the server's is not one of its account's columns: the environment variables never stand in for it", () => {
    expect(SERVER_TWILIO_ACCOUNT_COLUMNS).not.toContain("twilioCallVoice");
  });

  test("every read of an account to send through reads its voice", () => {
    expect(PROJECT_TWILIO_CONFIG_SELECT).toMatchObject({
      twilioCallVoice: true,
    });
    expect(GLOBAL_TWILIO_CONFIG_SELECT).toMatchObject({
      twilioCallVoice: true,
    });
  });
});

describe("a project's Twilio config", () => {
  test.each(CALL_VOICE_VALUES)("takes %s", async (voice: string) => {
    const updateBy: UpdateBy<ProjectCallSMSConfig> = projectUpdate({
      twilioCallVoice: ` ${voice} `,
    });

    await projectHooks.onBeforeUpdate(updateBy);

    expect(updateBy.data.twilioCallVoice).toBe(voice);
  });

  test("stores an empty voice as none: the account's default voice", async () => {
    for (const empty of ["", "   ", null]) {
      const updateBy: UpdateBy<ProjectCallSMSConfig> = projectUpdate({
        twilioCallVoice: empty,
      });

      await projectHooks.onBeforeUpdate(updateBy);

      expect(updateBy.data.twilioCallVoice).toBeNull();
    }
  });

  test("leaves a write that says nothing of the voice as it is", async () => {
    const updateBy: UpdateBy<ProjectCallSMSConfig> = projectUpdate({
      name: "Renamed",
    });

    await projectHooks.onBeforeUpdate(updateBy);

    expect("twilioCallVoice" in updateBy.data).toBe(false);
  });

  test.each(REFUSED_VOICES)(
    "refuses %p, on update and on create, saying which voices there are",
    async (voice: unknown) => {
      await expect(
        projectHooks.onBeforeUpdate(projectUpdate({ twilioCallVoice: voice })),
      ).rejects.toThrow(BadDataException);

      const createBy: CreateBy<ProjectCallSMSConfig> = {
        data: Object.assign(storedProjectConfig(), {
          twilioCallVoice: voice,
          isProjectDefault: false,
        }),
        props: ROOT,
      } as unknown as CreateBy<ProjectCallSMSConfig>;

      await expect(projectHooks.onBeforeCreate(createBy)).rejects.toThrow(
        /is not one OneUptime offers\. Choose one of Polly\.Joanna-Neural/,
      );
    },
  );

  test("sends its calls in its voice: the config the senders take carries it", () => {
    const twilioConfig: TwilioConfig | undefined =
      ProjectCallSMSConfigService.toTwilioConfig(
        storedProjectConfig("Polly.Brian-Neural"),
      );

    expect(twilioConfig?.callVoice).toBe("Polly.Brian-Neural");
  });

  test("a config with no voice - every config before this release - sends as it always did", () => {
    const twilioConfig: TwilioConfig | undefined =
      ProjectCallSMSConfigService.toTwilioConfig(storedProjectConfig());

    expect(twilioConfig).toBeDefined();
    expect(Object.keys(twilioConfig as TwilioConfig)).not.toContain(
      "callVoice",
    );
  });

  test("a stored voice the list no longer holds is none: the call is placed all the same, in the account's default voice", () => {
    const twilioConfig: TwilioConfig | undefined =
      ProjectCallSMSConfigService.toTwilioConfig(
        storedProjectConfig("Polly.Kevin-Neural"),
      );

    expect(twilioConfig).toBeDefined();
    expect(twilioConfig?.callVoice).toBeUndefined();
  });
});

describe("the server's own Twilio account", () => {
  test.each(CALL_VOICE_VALUES)("takes %s", async (voice: string) => {
    const updateBy: UpdateBy<GlobalConfig> = globalUpdate({
      twilioCallVoice: voice,
    });

    await globalHooks.onBeforeUpdate(updateBy);

    expect(updateBy.data.twilioCallVoice).toBe(voice);
  });

  test("stores an empty voice as none", async () => {
    const updateBy: UpdateBy<GlobalConfig> = globalUpdate({
      twilioCallVoice: "",
    });

    await globalHooks.onBeforeUpdate(updateBy);

    expect(updateBy.data.twilioCallVoice).toBeNull();
  });

  test.each(REFUSED_VOICES)("refuses %p", async (voice: unknown) => {
    await expect(
      globalHooks.onBeforeUpdate(globalUpdate({ twilioCallVoice: voice })),
    ).rejects.toThrow(/is not one OneUptime offers/);
  });

  test("its voice is chosen even while the GLOBAL_TWILIO_ environment variables set the account, which say nothing of a voice", async () => {
    process.env[ServerTwilioEnvironmentVariable.AccountSid] =
      "AC22222222222222222222222222222222";
    process.env[ServerTwilioEnvironmentVariable.AuthToken] = "env-auth-token";
    process.env[ServerTwilioEnvironmentVariable.PrimaryPhoneNumber] =
      "+14155550100";

    const updateBy: UpdateBy<GlobalConfig> = globalUpdate(
      { twilioCallVoice: "Polly.Joanna-Neural" },
      MASTER_ADMIN,
    );

    await expect(globalHooks.onBeforeUpdate(updateBy)).resolves.toBeDefined();
    expect(updateBy.data.twilioCallVoice).toBe("Polly.Joanna-Neural");

    // While the account itself is still the environment's to set.
    await expect(
      globalHooks.onBeforeUpdate(
        globalUpdate({ twilioAuthToken: "typed-in" }, MASTER_ADMIN),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("sends its calls in its voice, set by the row", () => {
    expect(toServerTwilioConfig(serverRow("Google.en-US-Neural2-F"))).toEqual(
      expect.objectContaining({
        accountSid: "AC11111111111111111111111111111111",
        callVoice: "Google.en-US-Neural2-F",
      }),
    );
  });

  test("and in its voice when the environment variables set the account", () => {
    process.env[ServerTwilioEnvironmentVariable.AccountSid] =
      "AC22222222222222222222222222222222";
    process.env[ServerTwilioEnvironmentVariable.AuthToken] = "env-auth-token";
    process.env[ServerTwilioEnvironmentVariable.PrimaryPhoneNumber] =
      "+14155550100";

    expect(toServerTwilioConfig(serverRow("Polly.Amy-Neural"))).toEqual(
      expect.objectContaining({
        accountSid: "AC22222222222222222222222222222222",
        callVoice: "Polly.Amy-Neural",
      }),
    );
  });

  test("with no voice, or one the list does not hold, sends as it always did: no voice", () => {
    for (const voice of [undefined, null, "", "man", "Polly.Kevin-Neural"]) {
      const config: TwilioConfig | null = toServerTwilioConfig(
        serverRow(voice),
      );

      expect(config).not.toBeNull();
      expect(Object.keys(config as TwilioConfig)).not.toContain("callVoice");
    }
  });

  test("an account that is not set up has no voice to speak with", () => {
    const row: GlobalConfig = new GlobalConfig();
    row.twilioCallVoice = "Polly.Joanna-Neural";

    expect(toServerTwilioConfig(row)).toBeNull();
  });
});

describe("the voice travels with a config to the Notification service", () => {
  const config: TwilioConfig = {
    accountSid: "AC00000000000000000000000000000001",
    authToken: "auth-token",
    primaryPhoneNumber: new Phone("+14155550100"),
    secondaryPhoneNumbers: [],
  };

  test("there and back", () => {
    const json: JSONObject = TwilioConfigJSON.toJSON({
      ...config,
      callVoice: "Polly.Matthew-Neural",
    });

    expect(json["callVoice"]).toBe("Polly.Matthew-Neural");
    expect(TwilioConfigJSON.fromJSON(json)?.callVoice).toBe(
      "Polly.Matthew-Neural",
    );
  });

  test("left out for none, as an older receiver expects: the JSON of a config without one is what it always was", () => {
    const json: JSONObject = TwilioConfigJSON.toJSON(config);

    expect("callVoice" in json).toBe(false);
    expect(json).toEqual({
      accountSid: config.accountSid,
      authToken: config.authToken,
      primaryPhoneNumber: "+14155550100",
      secondaryPhoneNumbers: [],
    });
  });

  test("a voice OneUptime does not offer is none, never a reason to refuse the config: a voice never stops a call", () => {
    for (const voice of ["man", "Polly.Kevin-Neural", 42, { a: 1 }, ""]) {
      const received: TwilioConfig | undefined = TwilioConfigJSON.fromJSON({
        ...TwilioConfigJSON.toJSON(config),
        callVoice: voice as never,
      });

      expect(received).toBeDefined();
      expect(received?.callVoice).toBeUndefined();
    }
  });

  test("an older sender's config, which carries none, is read as none", () => {
    expect(
      TwilioConfigJSON.fromJSON(TwilioConfigJSON.toJSON(config))?.callVoice,
    ).toBeUndefined();
  });
});
