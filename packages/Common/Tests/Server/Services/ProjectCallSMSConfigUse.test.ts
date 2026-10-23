import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import CountBy from "../../../Server/Types/Database/CountBy";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import {
  GLOBAL_TWILIO_CONFIG_USE_SELECT,
  PROJECT_TWILIO_CONFIG_SELECT,
  PROJECT_TWILIO_CONFIG_USE_SELECT,
} from "../../../Server/Utils/TwilioConfigSelect";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import { TwilioConfigUse } from "../../../Types/CallAndSMS/TwilioConfigUse";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import Phone from "../../../Types/Phone";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserType from "../../../Types/UserType";
import { TwilioMessageKind } from "../../../Utils/Project/TwilioAccount";
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
 * A PROJECT'S TWILIO CONFIG - AND THE SERVER'S OWN - SAYS WHAT IT IS USED
 * FOR, AND THE SERVER HOLDS IT TO THAT.
 *
 * A customer's account sent only SMS, yet the config made them type in a
 * number to make calls from. A config now says what it is used for - calls
 * and SMS, SMS only or calls only - and the server takes the same rule as
 * the form, for the Dashboard, the API and Terraform alike:
 *
 *   - a config is created only with the numbers what it is used for takes,
 *     through the real create() path of a member who may only create
 *     Twilio configs;
 *   - an update that changes what a config is used for, or its numbers, is
 *     held to the same rule - one that changes none of them goes through,
 *     whatever a row made before the rule holds;
 *   - a value that is not a use is refused;
 *   - the senders get a config used for SMS only without a number to make
 *     calls from, and the project's default is passed over for a message
 *     it is not used for, as if the project had no config;
 *   - every existing config reads as used for calls and SMS.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "3c000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("3c000000-0000-4000-8000-000000000002");
const CONFIG_ID: ObjectID = new ObjectID(
  "3c000000-0000-4000-8000-000000000003",
);

const US: string = "+14155550100";
const SG_MOBILE: string = "+6581234567";
const UK: string = "+447700900123";

type ConfigOptions = {
  use?: TwilioConfigUse | undefined;
  primary?: string | null | undefined;
  sms?: string | null | undefined;
};

function buildConfig(options: ConfigOptions = {}): ProjectCallSMSConfig {
  const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();
  config._id = CONFIG_ID.toString();
  config.name = "Singapore SMS";
  config.projectId = PROJECT_ID;
  config.twilioAccountSID = "AC00000000000000000000000000000001";
  config.twilioAuthToken = "auth-token";

  if (options.use !== undefined) {
    config.usedFor = options.use;
  }

  if (options.primary) {
    config.twilioPrimaryPhoneNumber = new Phone(options.primary);
  }

  if (options.sms) {
    config.twilioSmsPhoneNumbers = options.sms;
  }

  return config;
}

function withoutId(config: ProjectCallSMSConfig): ProjectCallSMSConfig {
  delete (config as unknown as Record<string, unknown>)["_id"];
  return config;
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

type OnBeforeUpdateFunction<T extends DatabaseBaseModel> = (
  updateBy: UpdateBy<T>,
) => Promise<OnUpdate<T>>;

const projectBeforeUpdate: OnBeforeUpdateFunction<ProjectCallSMSConfig> = (
  updateBy: UpdateBy<ProjectCallSMSConfig>,
): Promise<OnUpdate<ProjectCallSMSConfig>> => {
  return (
    ProjectCallSMSConfigService as unknown as {
      onBeforeUpdate: OnBeforeUpdateFunction<ProjectCallSMSConfig>;
    }
  ).onBeforeUpdate.call(ProjectCallSMSConfigService, updateBy);
};

function updateOf(
  data: Record<string, unknown>,
): UpdateBy<ProjectCallSMSConfig> {
  return {
    query: { _id: CONFIG_ID.toString() },
    data: data as UpdateBy<ProjectCallSMSConfig>["data"],
    limit: 1,
    skip: 0,
    props: { isRoot: true },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the column", () => {
  test("starts every config, and every one made before it, as used for calls and SMS", () => {
    const column: TableColumnMetadata | undefined = getTableColumns(
      new ProjectCallSMSConfig(),
    )["usedFor"];

    expect(column?.defaultValue).toBe(TwilioConfigUse.CallsAndSms);
    expect(column?.required).toBe(true);
    // Left out of a create, it is stored as its default, never refused.
    expect(column?.isDefaultValueColumn).toBe(true);
    expect(column?.title).toBe("Used For");
    expect(column?.description).toContain('"SMS only"');
    expect(column?.description).toContain('"Calls only"');
  });

  test("is written and read by whoever writes and reads the numbers beside it", () => {
    const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();

    expect(config.getColumnAccessControlFor("usedFor")).toEqual(
      config.getColumnAccessControlFor("twilioPrimaryPhoneNumber"),
    );
  });

  test("is the server's account's too, the master admin's alone", () => {
    const global: GlobalConfig = new GlobalConfig();

    expect(getTableColumns(global)["twilioUsedFor"]?.defaultValue).toBe(
      TwilioConfigUse.CallsAndSms,
    );
    expect(global.getColumnAccessControlFor("twilioUsedFor")).toEqual({
      create: [],
      read: [],
      update: [],
    });
  });
});

describe("creating a config", () => {
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
    /*
     * No row shares the config's name or slug; the project's first config
     * becomes its default, which takes it from no other (updateBy).
     */
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

  const create: (
    config: ProjectCallSMSConfig,
  ) => Promise<ProjectCallSMSConfig> = (
    config: ProjectCallSMSConfig,
  ): Promise<ProjectCallSMSConfig> => {
    return ProjectCallSMSConfigService.create({
      data: withoutId(config),
      props: memberProps([Permission.CreateProjectCallSMSConfig]),
    });
  };

  test("used for SMS only, with SMS numbers and no number to make calls from, is saved", async () => {
    const saved: ProjectCallSMSConfig = await create(
      buildConfig({ use: TwilioConfigUse.SmsOnly, sms: SG_MOBILE }),
    );

    expect(save).toHaveBeenCalledTimes(1);
    expect(saved.usedFor).toBe(TwilioConfigUse.SmsOnly);
    expect(saved.twilioSmsPhoneNumbers).toBe(SG_MOBILE);
    expect(saved.twilioPrimaryPhoneNumber).toBeUndefined();
  });

  test("used for SMS only, without SMS numbers, is refused before anything is saved", async () => {
    await expect(
      create(buildConfig({ use: TwilioConfigUse.SmsOnly, primary: US })),
    ).rejects.toThrow(
      new BadDataException(
        "A Twilio config used for SMS only needs at least one number in Twilio SMS Phone Numbers: every SMS goes out from one of them.",
      ),
    );
    await expect(
      create(buildConfig({ use: TwilioConfigUse.SmsOnly, sms: " , " })),
    ).rejects.toThrow(BadDataException);
    expect(save).not.toHaveBeenCalled();
  });

  test("used for calls only, with a number to make calls from, is saved", async () => {
    const saved: ProjectCallSMSConfig = await create(
      buildConfig({ use: TwilioConfigUse.CallsOnly, primary: US }),
    );

    expect(save).toHaveBeenCalledTimes(1);
    expect(saved.usedFor).toBe(TwilioConfigUse.CallsOnly);
  });

  test("used for calls only, or for calls and SMS, without a number to make calls from, is refused", async () => {
    await expect(
      create(buildConfig({ use: TwilioConfigUse.CallsOnly, sms: SG_MOBILE })),
    ).rejects.toThrow(
      new BadDataException(
        "A Twilio config used for calls only needs a Twilio Primary Phone Number: calls go out from it.",
      ),
    );
    await expect(
      create(buildConfig({ use: TwilioConfigUse.CallsAndSms, sms: SG_MOBILE })),
    ).rejects.toThrow(
      new BadDataException(
        "A Twilio config used for calls and SMS needs a Twilio Primary Phone Number: calls go out from it.",
      ),
    );
    expect(save).not.toHaveBeenCalled();
  });

  test("that says nothing of its use is held to calls and SMS's numbers - an API call or Terraform as before", async () => {
    await expect(create(buildConfig({ sms: SG_MOBILE }))).rejects.toThrow(
      "needs a Twilio Primary Phone Number",
    );

    const saved: ProjectCallSMSConfig = await create(
      buildConfig({ primary: US }),
    );

    expect(save).toHaveBeenCalledTimes(1);
    // Left out, so the column's default is stored: calls and SMS.
    expect(saved.usedFor).toBeUndefined();
  });

  test("that says it is used for something else is refused, naming the three", async () => {
    for (const notAUse of ["SMS", "Email", "sms only"]) {
      await expect(
        create(
          buildConfig({
            use: notAUse as TwilioConfigUse,
            primary: US,
            sms: SG_MOBILE,
          }),
        ),
      ).rejects.toThrow(
        `Used For must be "Calls and SMS", "SMS only" or "Calls only", not "${notAUse}".`,
      );
    }

    expect(save).not.toHaveBeenCalled();
  });
});

describe("updating a config", () => {
  let readRows: SpyInstance<
    typeof ProjectCallSMSConfigService.findRowsAndHoldUpdateToThem
  >;

  const storedAs: (stored: Array<ProjectCallSMSConfig>) => void = (
    stored: Array<ProjectCallSMSConfig>,
  ): void => {
    readRows = jest
      .spyOn(ProjectCallSMSConfigService, "findRowsAndHoldUpdateToThem")
      .mockResolvedValue(stored as never);
  };

  test("that makes it used for SMS only, without SMS numbers, is refused", async () => {
    storedAs([buildConfig({ use: TwilioConfigUse.CallsAndSms, primary: US })]);

    await expect(
      projectBeforeUpdate(updateOf({ usedFor: TwilioConfigUse.SmsOnly })),
    ).rejects.toThrow(
      "A Twilio config used for SMS only needs at least one number in Twilio SMS Phone Numbers",
    );
  });

  test("that makes it used for SMS only with its SMS numbers goes through", async () => {
    storedAs([buildConfig({ use: TwilioConfigUse.CallsAndSms, primary: US })]);

    const updateBy: UpdateBy<ProjectCallSMSConfig> = updateOf({
      usedFor: TwilioConfigUse.SmsOnly,
      twilioSmsPhoneNumbers: SG_MOBILE,
    });

    const result: OnUpdate<ProjectCallSMSConfig> =
      await projectBeforeUpdate(updateBy);

    expect(result.updateBy).toBe(updateBy);
    // The rows it changes are read with the use and its numbers, nothing more.
    expect(readRows).toHaveBeenCalledWith(
      updateBy,
      PROJECT_TWILIO_CONFIG_USE_SELECT,
    );
  });

  test("that empties an SMS-only config's numbers, or takes them all away, is refused", async () => {
    storedAs([buildConfig({ use: TwilioConfigUse.SmsOnly, sms: SG_MOBILE })]);

    for (const emptied of ["", null, " , "]) {
      await expect(
        projectBeforeUpdate(updateOf({ twilioSmsPhoneNumbers: emptied })),
      ).rejects.toThrow(BadDataException);
    }
  });

  test("that makes an SMS-only config make calls needs a number to make them from", async () => {
    storedAs([buildConfig({ use: TwilioConfigUse.SmsOnly, sms: SG_MOBILE })]);

    for (const use of [
      TwilioConfigUse.CallsAndSms,
      TwilioConfigUse.CallsOnly,
    ]) {
      await expect(
        projectBeforeUpdate(updateOf({ usedFor: use })),
      ).rejects.toThrow("needs a Twilio Primary Phone Number");
      await expect(
        projectBeforeUpdate(
          updateOf({ usedFor: use, twilioPrimaryPhoneNumber: new Phone(US) }),
        ),
      ).resolves.toBeDefined();
    }
  });

  test("that changes none of its use and numbers goes through without reading the rows", async () => {
    storedAs([]);

    for (const data of [
      { name: "Renamed" },
      { isProjectDefault: true },
      { description: "For on-call SMS" },
    ]) {
      await expect(projectBeforeUpdate(updateOf(data))).resolves.toBeDefined();
    }

    expect(readRows).not.toHaveBeenCalled();
  });

  /*
   * A row made through the API before the rule, without a number to make
   * calls from: an API or Terraform write that sends every field back as it
   * was changes nothing, and is let through - only a write that changes its
   * use or numbers must fix it.
   */
  test("of a row made before the rule, sending every field back as it was, goes through", async () => {
    storedAs([buildConfig({ use: TwilioConfigUse.CallsAndSms })]);

    await expect(
      projectBeforeUpdate(
        updateOf({
          name: "Incoming calls",
          usedFor: TwilioConfigUse.CallsAndSms,
          twilioPrimaryPhoneNumber: null,
          twilioSmsPhoneNumbers: null,
        }),
      ),
    ).resolves.toBeDefined();
    await expect(
      projectBeforeUpdate(updateOf({ twilioSmsPhoneNumbers: SG_MOBILE })),
    ).rejects.toThrow("needs a Twilio Primary Phone Number");
  });

  test("of several rows is held to the rule on each", async () => {
    storedAs([
      buildConfig({ use: TwilioConfigUse.CallsAndSms, primary: US }),
      buildConfig({ use: TwilioConfigUse.CallsAndSms, sms: SG_MOBILE }),
    ]);

    await expect(
      projectBeforeUpdate(updateOf({ twilioSmsPhoneNumbers: UK })),
    ).rejects.toThrow("needs a Twilio Primary Phone Number");
  });

  test("that says it is used for something else is refused before any row is read", async () => {
    storedAs([buildConfig({ use: TwilioConfigUse.CallsAndSms, primary: US })]);

    await expect(
      projectBeforeUpdate(updateOf({ usedFor: "SMS" })),
    ).rejects.toThrow(
      'Used For must be "Calls and SMS", "SMS only" or "Calls only", not "SMS".',
    );
    expect(readRows).not.toHaveBeenCalled();
  });
});

describe("a config, as the senders take it", () => {
  test("used for SMS only, has no number to make calls from and needs none", () => {
    const twilioConfig: TwilioConfig | undefined =
      ProjectCallSMSConfigService.toTwilioConfig(
        buildConfig({
          use: TwilioConfigUse.SmsOnly,
          sms: `${SG_MOBILE},${UK}`,
        }),
      );

    expect(twilioConfig?.use).toBe(TwilioConfigUse.SmsOnly);
    expect(twilioConfig?.primaryPhoneNumber).toBeUndefined();
    expect(twilioConfig?.smsPhoneNumbers?.map(String)).toEqual([SG_MOBILE, UK]);
  });

  test("used for calls and SMS - or saying nothing - carries no use, exactly as before", () => {
    for (const use of [undefined, TwilioConfigUse.CallsAndSms]) {
      const twilioConfig: TwilioConfig | undefined =
        ProjectCallSMSConfigService.toTwilioConfig(
          buildConfig({ use: use, primary: US }),
        );

      expect(twilioConfig).toBeDefined();
      expect("use" in twilioConfig!).toBe(false);
      expect(twilioConfig!.primaryPhoneNumber?.toString()).toBe(US);
    }
  });

  test("for a message it is not used for, is none: the message goes as without a config", () => {
    const smsOnly: ProjectCallSMSConfig = buildConfig({
      use: TwilioConfigUse.SmsOnly,
      sms: SG_MOBILE,
    });
    const callsOnly: ProjectCallSMSConfig = buildConfig({
      use: TwilioConfigUse.CallsOnly,
      primary: US,
    });

    expect(
      ProjectCallSMSConfigService.toTwilioConfig(
        smsOnly,
        TwilioMessageKind.Call,
      ),
    ).toBeUndefined();
    expect(
      ProjectCallSMSConfigService.toTwilioConfig(
        smsOnly,
        TwilioMessageKind.SMS,
      ),
    ).toBeDefined();
    expect(
      ProjectCallSMSConfigService.toTwilioConfig(
        callsOnly,
        TwilioMessageKind.SMS,
      ),
    ).toBeUndefined();
    expect(
      ProjectCallSMSConfigService.toTwilioConfig(
        callsOnly,
        TwilioMessageKind.Call,
      ),
    ).toBeDefined();
  });

  test("without the numbers its use takes, is refused, as a config without its number always was", () => {
    expect(() => {
      ProjectCallSMSConfigService.toTwilioConfig(
        buildConfig({ use: TwilioConfigUse.SmsOnly, primary: US }),
      );
    }).toThrow(
      "Project Call and SMS Config is used for SMS only and has no SMS phone numbers",
    );
    expect(() => {
      ProjectCallSMSConfigService.toTwilioConfig(
        buildConfig({ use: TwilioConfigUse.CallsOnly, sms: SG_MOBILE }),
      );
    }).toThrow("Project Call and SMS Config twilio phone number is not set");
  });
});

describe("the project's default config, for one kind of message", () => {
  const defaultIs: (config: ProjectCallSMSConfig | null) => void = (
    config: ProjectCallSMSConfig | null,
  ): void => {
    jest
      .spyOn(ProjectCallSMSConfigService, "findOneBy")
      .mockResolvedValue(config as never);
  };

  test("is the default when it is used for that kind", async () => {
    defaultIs(buildConfig({ use: TwilioConfigUse.SmsOnly, sms: SG_MOBILE }));

    const twilioConfig: TwilioConfig | undefined =
      await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
        PROJECT_ID,
        TwilioMessageKind.SMS,
      );

    expect(twilioConfig?.smsPhoneNumbers?.map(String)).toEqual([SG_MOBILE]);
  });

  test("is none when the default is not used for that kind: the server's own account takes it, paid for as such", async () => {
    defaultIs(buildConfig({ use: TwilioConfigUse.SmsOnly, sms: SG_MOBILE }));

    await expect(
      ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
        PROJECT_ID,
        TwilioMessageKind.Call,
      ),
    ).resolves.toBeUndefined();

    defaultIs(buildConfig({ use: TwilioConfigUse.CallsOnly, primary: US }));

    await expect(
      ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
        PROJECT_ID,
        TwilioMessageKind.SMS,
      ),
    ).resolves.toBeUndefined();
  });

  test("without a kind, is the default whatever it is used for: the senders decide per message", async () => {
    defaultIs(buildConfig({ use: TwilioConfigUse.SmsOnly, sms: SG_MOBILE }));

    const twilioConfig: TwilioConfig | undefined =
      await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
        PROJECT_ID,
      );

    expect(twilioConfig?.use).toBe(TwilioConfigUse.SmsOnly);
  });

  test("is read with what it is used for", async () => {
    const findOneBy: SpyInstance<typeof ProjectCallSMSConfigService.findOneBy> =
      jest
        .spyOn(ProjectCallSMSConfigService, "findOneBy")
        .mockResolvedValue(buildConfig({ primary: US }) as never);

    await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
      PROJECT_ID,
      TwilioMessageKind.Call,
    );

    expect(
      (findOneBy.mock.calls[0]![0] as { select: Record<string, unknown> })
        .select,
    ).toEqual(PROJECT_TWILIO_CONFIG_SELECT);
    expect(PROJECT_TWILIO_CONFIG_SELECT.usedFor).toBe(true);
  });

  test("a default for calls and SMS - every existing config - serves both, as before", async () => {
    defaultIs(buildConfig({ primary: US }));

    for (const kind of [TwilioMessageKind.SMS, TwilioMessageKind.Call]) {
      const twilioConfig: TwilioConfig | undefined =
        await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
          PROJECT_ID,
          kind,
        );

      expect(twilioConfig?.primaryPhoneNumber?.toString()).toBe(US);
    }
  });
});

describe("the server's own Twilio account", () => {
  const globalBeforeUpdate: OnBeforeUpdateFunction<GlobalConfig> = (
    updateBy: UpdateBy<GlobalConfig>,
  ): Promise<OnUpdate<GlobalConfig>> => {
    return (
      GlobalConfigService as unknown as {
        onBeforeUpdate: OnBeforeUpdateFunction<GlobalConfig>;
      }
    ).onBeforeUpdate.call(GlobalConfigService, updateBy);
  };

  const update: (
    data: Record<string, unknown>,
  ) => Promise<OnUpdate<GlobalConfig>> = (
    data: Record<string, unknown>,
  ): Promise<OnUpdate<GlobalConfig>> => {
    return globalBeforeUpdate({
      query: { _id: ObjectID.getZeroObjectID().toString() },
      data: data as UpdateBy<GlobalConfig>["data"],
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });
  };

  const storedAs: (stored: Partial<GlobalConfig>) => void = (
    stored: Partial<GlobalConfig>,
  ): void => {
    jest
      .spyOn(GlobalConfigService, "findRowsAndHoldUpdateToThem")
      .mockResolvedValue([Object.assign(new GlobalConfig(), stored)] as never);
  };

  test("used for SMS only takes SMS numbers, and needs no number to make calls from", async () => {
    storedAs({
      twilioAccountSID: "AC1",
      twilioPrimaryPhoneNumber: new Phone(US),
    });

    await expect(
      update({
        twilioUsedFor: TwilioConfigUse.SmsOnly,
        twilioPrimaryPhoneNumber: null,
        twilioSmsPhoneNumbers: SG_MOBILE,
      }),
    ).resolves.toBeDefined();
    await expect(
      update({ twilioUsedFor: TwilioConfigUse.SmsOnly }),
    ).rejects.toThrow(
      "A Twilio config used for SMS only needs at least one number in Twilio SMS Phone Numbers",
    );
  });

  test("used for calls needs a number to make them from", async () => {
    storedAs({
      twilioAccountSID: "AC1",
      twilioUsedFor: TwilioConfigUse.SmsOnly,
      twilioSmsPhoneNumbers: SG_MOBILE,
    });

    await expect(
      update({ twilioUsedFor: TwilioConfigUse.CallsOnly }),
    ).rejects.toThrow(
      "A Twilio config used for calls only needs a Twilio Primary Phone Number",
    );
  });

  test("is asked for no numbers while it has no account SID: nothing goes through it", async () => {
    storedAs({});

    await expect(
      update({ twilioUsedFor: TwilioConfigUse.SmsOnly }),
    ).resolves.toBeDefined();
    // Clearing the account clears the need too.
    storedAs({
      twilioAccountSID: "AC1",
      twilioUsedFor: TwilioConfigUse.SmsOnly,
      twilioSmsPhoneNumbers: SG_MOBILE,
    });
    await expect(
      update({ twilioAccountSID: null, twilioSmsPhoneNumbers: null }),
    ).resolves.toBeDefined();
  });

  test("reads the row it changes with its use and numbers alone", async () => {
    const read: SpyInstance<
      typeof GlobalConfigService.findRowsAndHoldUpdateToThem
    > = jest
      .spyOn(GlobalConfigService, "findRowsAndHoldUpdateToThem")
      .mockResolvedValue([] as never);

    await update({ twilioUsedFor: TwilioConfigUse.CallsAndSms });

    expect(read.mock.calls[0]![1]).toEqual(GLOBAL_TWILIO_CONFIG_USE_SELECT);
  });

  test("refuses a value that is not a use", async () => {
    await expect(update({ twilioUsedFor: "Calls" })).rejects.toThrow(
      'Used For must be "Calls and SMS", "SMS only" or "Calls only", not "Calls".',
    );
    await expect(
      (
        GlobalConfigService as unknown as {
          onBeforeCreate: (createBy: {
            data: GlobalConfig;
            props: DatabaseCommonInteractionProps;
          }) => Promise<unknown>;
        }
      ).onBeforeCreate({
        data: Object.assign(new GlobalConfig(), { twilioUsedFor: "Email" }),
        props: { isRoot: true },
      }),
    ).rejects.toThrow(BadDataException);
  });

  test("an update that changes none of its use and numbers reads nothing", async () => {
    const read: SpyInstance<
      typeof GlobalConfigService.findRowsAndHoldUpdateToThem
    > = jest
      .spyOn(GlobalConfigService, "findRowsAndHoldUpdateToThem")
      .mockResolvedValue([] as never);

    await update({ twilioAuthToken: "rotated" });

    expect(read).not.toHaveBeenCalled();
  });
});
