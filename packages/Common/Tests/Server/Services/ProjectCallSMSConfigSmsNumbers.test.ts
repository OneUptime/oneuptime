import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import CountBy from "../../../Server/Types/Database/CountBy";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import {
  GLOBAL_TWILIO_CONFIG_SELECT,
  PROJECT_TWILIO_CONFIG_SELECT,
} from "../../../Server/Utils/TwilioConfigSelect";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import Phone from "../../../Types/Phone";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserType from "../../../Types/UserType";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A PROJECT'S TWILIO CONFIG, AND THE SERVER'S OWN, LIST NUMBERS FOR SMS.
 *
 * A Twilio number can make calls and send SMS, or only one of the two
 * (Singapore's national numbers are voice-only; SMS there need a mobile
 * number), so a config holds Twilio SMS Phone Numbers - once listed, every
 * SMS goes out from one of them (Types/CallAndSMS/TwilioPhoneNumbers says
 * which). These pin the server's side of that:
 *
 *   - toTwilioConfig hands every sender the SMS numbers with the rest, and a
 *     config without them exactly as before;
 *   - the project default is read with every number it sends from
 *     (TwilioConfigSelect), SMS numbers included;
 *   - a list of SMS numbers that holds something that is not a phone number
 *     is refused when it is written - on create and on update, through the
 *     real create() path for a member - and so is the server's own;
 *   - who may write and read the new column is who may write and read the
 *     numbers beside it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "3b000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("3b000000-0000-4000-8000-000000000002");
const CONFIG_ID: ObjectID = new ObjectID(
  "3b000000-0000-4000-8000-000000000003",
);

const SG_NATIONAL: string = "+6561234567";
const SG_MOBILE: string = "+6581234567";
const UK: string = "+447700900123";
const SE: string = "+46701234567";

const SMS_NUMBERS_TITLE: string = "Twilio SMS Phone Numbers";

function buildConfig(
  numbers: {
    secondary?: string | undefined;
    sms?: string | undefined;
  } = {},
): ProjectCallSMSConfig {
  const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();
  config._id = CONFIG_ID.toString();
  config.name = "Singapore";
  config.projectId = PROJECT_ID;
  config.twilioAccountSID = "AC00000000000000000000000000000001";
  config.twilioAuthToken = "auth-token";
  config.twilioPrimaryPhoneNumber = new Phone(SG_NATIONAL);

  if (numbers.secondary !== undefined) {
    config.twilioSecondaryPhoneNumbers = numbers.secondary;
  }

  if (numbers.sms !== undefined) {
    config.twilioSmsPhoneNumbers = numbers.sms;
  }

  return config;
}

function asText(config: TwilioConfig | undefined): Record<string, unknown> {
  return {
    primary: config?.primaryPhoneNumber.toString(),
    secondary: config?.secondaryPhoneNumbers.map(String),
    sms: config?.smsPhoneNumbers?.map(String),
  };
}

function memberProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
        scope: PermissionScope.All,
      };
    }),
  };

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userType: UserType.User,
    ...ON_HIGHEST_PLAN,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ProjectCallSMSConfigService.toTwilioConfig", () => {
  test("hands every sender the SMS numbers with the rest, in the order they were typed", () => {
    expect(
      asText(
        ProjectCallSMSConfigService.toTwilioConfig(
          buildConfig({
            secondary: UK,
            sms: `${SG_MOBILE}, ${SE}, ${UK}`,
          }),
        ),
      ),
    ).toEqual({
      primary: SG_NATIONAL,
      secondary: [UK],
      sms: [SG_MOBILE, SE, UK],
    });
  });

  test("a config without SMS numbers comes out exactly as before: no SMS numbers at all", () => {
    const twilioConfig: TwilioConfig | undefined =
      ProjectCallSMSConfigService.toTwilioConfig(buildConfig({ secondary: UK }));

    expect(twilioConfig).toBeDefined();
    expect("smsPhoneNumbers" in twilioConfig!).toBe(false);
    expect(asText(twilioConfig)).toEqual({
      primary: SG_NATIONAL,
      secondary: [UK],
      sms: undefined,
    });
  });

  test("an emptied list of SMS numbers is none", () => {
    for (const emptied of ["", " , ", ";\n"]) {
      expect(
        ProjectCallSMSConfigService.toTwilioConfig(buildConfig({ sms: emptied }))
          ?.smsPhoneNumbers,
      ).toBeUndefined();
    }
  });

  test("reads the secondary numbers past a stray comma, which used to fail the whole config", () => {
    expect(
      asText(
        ProjectCallSMSConfigService.toTwilioConfig(
          buildConfig({ secondary: `${UK}, ${SE},` }),
        ),
      ).secondary,
    ).toEqual([UK, SE]);
  });

  test("still refuses a secondary number that is not one, naming it", () => {
    expect(() => {
      ProjectCallSMSConfigService.toTwilioConfig(
        buildConfig({ secondary: `${UK}, nope` }),
      );
    }).toThrow('"nope" is not a phone number.');
  });

  test("still needs the account, the token and the primary number - SMS numbers are no stand-in for it", () => {
    const noPrimary: ProjectCallSMSConfig = buildConfig({ sms: SG_MOBILE });
    delete (noPrimary as unknown as Record<string, unknown>)[
      "twilioPrimaryPhoneNumber"
    ];

    expect(() => {
      ProjectCallSMSConfigService.toTwilioConfig(noPrimary);
    }).toThrow(BadDataException);
    expect(ProjectCallSMSConfigService.toTwilioConfig(undefined)).toBe(
      undefined,
    );
  });
});

describe("the project's default Twilio config", () => {
  test("is read with every number it sends from, its SMS numbers included", async () => {
    const findOneBy: SpyInstance<typeof ProjectCallSMSConfigService.findOneBy> =
      jest
        .spyOn(ProjectCallSMSConfigService, "findOneBy")
        .mockResolvedValue(buildConfig({ sms: `${SG_MOBILE},${SE}` }) as never);

    const twilioConfig: TwilioConfig | undefined =
      await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
        PROJECT_ID,
      );

    const call: FindOneBy<ProjectCallSMSConfig> = findOneBy.mock
      .calls[0]![0] as FindOneBy<ProjectCallSMSConfig>;

    expect(call.select).toEqual(PROJECT_TWILIO_CONFIG_SELECT);
    expect(call.query).toEqual({
      projectId: PROJECT_ID,
      isProjectDefault: true,
    });
    expect(asText(twilioConfig)).toEqual({
      primary: SG_NATIONAL,
      secondary: [],
      sms: [SG_MOBILE, SE],
    });
  });

  test("a project without a default config has none: the server's own account sends", async () => {
    jest
      .spyOn(ProjectCallSMSConfigService, "findOneBy")
      .mockResolvedValue(null as never);

    await expect(
      ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(PROJECT_ID),
    ).resolves.toBeUndefined();
    await expect(
      ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(undefined),
    ).resolves.toBeUndefined();
  });

  test("the select names the SMS column, and every other column a send needs", () => {
    expect(Object.keys(PROJECT_TWILIO_CONFIG_SELECT).sort()).toEqual(
      [
        "_id",
        "twilioAccountSID",
        "twilioAuthToken",
        "twilioPrimaryPhoneNumber",
        "twilioSecondaryPhoneNumbers",
        "twilioSmsPhoneNumbers",
      ].sort(),
    );
    expect(Object.keys(GLOBAL_TWILIO_CONFIG_SELECT).sort()).toEqual(
      [
        "twilioAccountSID",
        "twilioAuthToken",
        "twilioPrimaryPhoneNumber",
        "twilioSecondaryPhoneNumbers",
        "twilioSmsPhoneNumbers",
      ].sort(),
    );
  });
});

describe("a list of SMS numbers that holds something that is not a phone number", () => {
  let save: MockFunction;

  beforeEach(() => {
    save = getJestMockFunction().mockImplementation(
      async (entity: ProjectCallSMSConfig): Promise<ProjectCallSMSConfig> => {
        entity._id = CONFIG_ID.toString();
        return entity;
      },
    );

    jest
      .spyOn(ProjectCallSMSConfigService, "getRepository")
      .mockReturnValue({ save: save } as never);
    jest
      .spyOn(ProjectCallSMSConfigService, "onTriggerWorkflow")
      .mockResolvedValue(undefined);
    jest
      .spyOn(ProjectCallSMSConfigService, "onTriggerRealtime")
      .mockResolvedValue(undefined);
    // The project has a config, so this one is not made its default.
    jest
      .spyOn(ProjectCallSMSConfigService, "countBy")
      .mockImplementation(
        async (
          _countBy: CountBy<ProjectCallSMSConfig>,
        ): Promise<PositiveNumber> => {
          return new PositiveNumber(0);
        },
      );
    jest
      .spyOn(ProjectCallSMSConfigService, "updateBy")
      .mockResolvedValue(0 as never);
  });

  test("is refused when a member creates the config, before anything is saved", async () => {
    const config: ProjectCallSMSConfig = buildConfig({
      sms: `${SG_MOBILE}, call the office`,
    });
    delete (config as unknown as Record<string, unknown>)["_id"];

    await expect(
      ProjectCallSMSConfigService.create({
        data: config,
        props: memberProps([Permission.CreateProjectCallSMSConfig]),
      }),
    ).rejects.toThrow(
      `${SMS_NUMBERS_TITLE}: "call the office" is not a phone number.`,
    );
    expect(save).not.toHaveBeenCalled();
  });

  test("a config with good SMS numbers is saved with them, by a member who may only create Twilio configs", async () => {
    const config: ProjectCallSMSConfig = buildConfig({
      sms: `${SG_MOBILE}, ${UK}`,
    });
    delete (config as unknown as Record<string, unknown>)["_id"];

    const saved: ProjectCallSMSConfig =
      await ProjectCallSMSConfigService.create({
        data: config,
        props: memberProps([Permission.CreateProjectCallSMSConfig]),
      });

    expect(save).toHaveBeenCalledTimes(1);
    expect(saved.twilioSmsPhoneNumbers).toBe(`${SG_MOBILE}, ${UK}`);
  });

  test("is refused when the config is updated", async () => {
    await expect(
      (
        ProjectCallSMSConfigService as unknown as {
          onBeforeUpdate: (
            updateBy: UpdateBy<ProjectCallSMSConfig>,
          ) => Promise<OnUpdate<ProjectCallSMSConfig>>;
        }
      ).onBeforeUpdate({
        query: { _id: CONFIG_ID.toString() },
        data: { twilioSmsPhoneNumbers: "+65 8123 4567" },
        limit: 1,
        skip: 0,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(
      `${SMS_NUMBERS_TITLE}: "+65 8123 4567" is not a phone number.`,
    );
  });

  test("a list that is not text at all is refused", async () => {
    await expect(
      (
        ProjectCallSMSConfigService as unknown as {
          onBeforeUpdate: (
            updateBy: UpdateBy<ProjectCallSMSConfig>,
          ) => Promise<OnUpdate<ProjectCallSMSConfig>>;
        }
      ).onBeforeUpdate({
        query: { _id: CONFIG_ID.toString() },
        data: {
          twilioSmsPhoneNumbers: [SG_MOBILE],
        } as unknown as UpdateBy<ProjectCallSMSConfig>["data"],
        limit: 1,
        skip: 0,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(
      `${SMS_NUMBERS_TITLE} must be phone numbers separated by commas.`,
    );
  });

  test("an update that leaves the list out, or empties it, goes through untouched", async () => {
    const onBeforeUpdate: (
      updateBy: UpdateBy<ProjectCallSMSConfig>,
    ) => Promise<OnUpdate<ProjectCallSMSConfig>> = (
      ProjectCallSMSConfigService as unknown as {
        onBeforeUpdate: (
          updateBy: UpdateBy<ProjectCallSMSConfig>,
        ) => Promise<OnUpdate<ProjectCallSMSConfig>>;
      }
    ).onBeforeUpdate.bind(ProjectCallSMSConfigService);

    for (const data of [
      { name: "Renamed" },
      { twilioSmsPhoneNumbers: "" },
      { twilioSmsPhoneNumbers: null },
      { twilioSmsPhoneNumbers: `${SG_MOBILE},${UK}` },
    ]) {
      const updateBy: UpdateBy<ProjectCallSMSConfig> = {
        query: { _id: CONFIG_ID.toString() },
        data: data as UpdateBy<ProjectCallSMSConfig>["data"],
        limit: 1,
        skip: 0,
        props: { isRoot: true },
      };

      const result: OnUpdate<ProjectCallSMSConfig> =
        await onBeforeUpdate(updateBy);

      expect(result.updateBy).toBe(updateBy);
      expect(result.updateBy.data).toEqual(data);
    }
  });

  /*
   * The older list is read as it always was and never refused on write:
   * the API and Terraform keep accepting what they always did.
   */
  test("the older list of secondary numbers is not refused on write", async () => {
    const config: ProjectCallSMSConfig = buildConfig({
      secondary: "whatever was stored",
    });
    delete (config as unknown as Record<string, unknown>)["_id"];

    await expect(
      ProjectCallSMSConfigService.create({
        data: config,
        props: { isRoot: true },
      }),
    ).resolves.toBeDefined();
  });
});

describe("the server's own Twilio account", () => {
  type OnBeforeUpdateFunction = (
    updateBy: UpdateBy<GlobalConfig>,
  ) => Promise<OnUpdate<GlobalConfig>>;

  const runBeforeUpdate: (
    data: Record<string, unknown>,
  ) => Promise<OnUpdate<GlobalConfig>> = async (
    data: Record<string, unknown>,
  ): Promise<OnUpdate<GlobalConfig>> => {
    return await (
      GlobalConfigService as unknown as {
        onBeforeUpdate: OnBeforeUpdateFunction;
      }
    ).onBeforeUpdate({
      query: { _id: ObjectID.getZeroObjectID().toString() },
      data: data as UpdateBy<GlobalConfig>["data"],
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });
  };

  test("refuses a list of SMS numbers that is not one, as a project's is refused", async () => {
    await expect(
      runBeforeUpdate({
        twilioSmsPhoneNumbers: `${SG_MOBILE}; mobile`,
      }),
    ).rejects.toThrow(`${SMS_NUMBERS_TITLE}: "mobile" is not a phone number.`);
  });

  test("takes a good list, and an emptied one", async () => {
    await expect(
      runBeforeUpdate({
        twilioSmsPhoneNumbers: `${SG_MOBILE}, ${UK}`,
      }),
    ).resolves.toBeDefined();
    await expect(
      runBeforeUpdate({ twilioSmsPhoneNumbers: "" }),
    ).resolves.toBeDefined();
    await expect(
      runBeforeUpdate({ twilioPrimaryPhoneNumber: new Phone(SG_NATIONAL) }),
    ).resolves.toBeDefined();
  });

  test("refuses it on create too", async () => {
    await expect(
      (
        GlobalConfigService as unknown as {
          onBeforeCreate: (createBy: {
            data: GlobalConfig;
            props: DatabaseCommonInteractionProps;
          }) => Promise<unknown>;
        }
      ).onBeforeCreate({
        data: Object.assign(new GlobalConfig(), {
          twilioSmsPhoneNumbers: "nope",
        }),
        props: { isRoot: true },
      }),
    ).rejects.toThrow(`${SMS_NUMBERS_TITLE}: "nope" is not a phone number.`);
  });
});

describe("who may write and read the SMS numbers", () => {
  /*
   * Exactly who may for the numbers beside them: a project's owners and
   * admins and whoever may create or edit Twilio configs write them, and
   * everyone who may see a config reads them - they are numbers, not
   * credentials. The server's own are the master admin's alone.
   */
  test("on a project's config, the primary and secondary numbers'", () => {
    const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();

    for (const beside of [
      "twilioPrimaryPhoneNumber",
      "twilioSecondaryPhoneNumbers",
    ]) {
      expect({
        beside,
        access: config.getColumnAccessControlFor("twilioSmsPhoneNumbers"),
      }).toEqual({
        beside,
        access: config.getColumnAccessControlFor(beside),
      });
    }
  });

  test("on the server's, nobody's but a master admin's", () => {
    const config: GlobalConfig = new GlobalConfig();

    expect(config.getColumnAccessControlFor("twilioSmsPhoneNumbers")).toEqual({
      create: [],
      read: [],
      update: [],
    });
  });
});
