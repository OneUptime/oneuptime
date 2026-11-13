import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalConfigService, {
  SERVER_TWILIO_ACCOUNT_COLUMNS,
} from "../../../Server/Services/GlobalConfigService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ServerTwilioEnvironment, {
  SERVER_TWILIO_ENVIRONMENT_VARIABLES,
  SERVER_TWILIO_SET_BY_ENVIRONMENT_MESSAGE,
  ServerTwilioEnvironmentAccount,
  ServerTwilioEnvironmentVariable,
} from "../../../Types/CallAndSMS/ServerTwilioEnvironment";
import { TwilioConfigUse } from "../../../Types/CallAndSMS/TwilioConfigUse";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * NO SAVING AN ACCOUNT THE ENVIRONMENT VARIABLES SET (#7515).
 *
 * Once GLOBAL_TWILIO_ACCOUNT_SID is set, the server sends through the
 * account the GLOBAL_TWILIO_ variables describe and never the saved one. A
 * write to the saved account - the Admin Dashboard's Call and SMS form, or
 * the API - would say "Saved" and change nothing that is sent, so it is
 * refused with where the account is changed instead. OneUptime's own writes
 * (isRoot: the data migrations, such as UpdateGlobalConfigFromEnv) go
 * through. With the variables unset, nothing changes.
 */

type GlobalConfigServiceWithHooks = {
  onBeforeCreate(
    createBy: CreateBy<GlobalConfig>,
  ): Promise<OnCreate<GlobalConfig>>;
  onBeforeUpdate(
    updateBy: UpdateBy<GlobalConfig>,
  ): Promise<OnUpdate<GlobalConfig>>;
};

const hooks: GlobalConfigServiceWithHooks =
  GlobalConfigService as unknown as GlobalConfigServiceWithHooks;

const MASTER_ADMIN_PROPS: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  isMasterAdmin: true,
} as DatabaseCommonInteractionProps;

const ROOT_PROPS: DatabaseCommonInteractionProps = {
  isRoot: true,
} as DatabaseCommonInteractionProps;

// A value an admin could save in each column of the account.
const SAVED_VALUES: Record<string, unknown> = {
  twilioAccountSID: "AC11111111111111111111111111111111",
  twilioAuthToken: "saved-auth-token",
  twilioUsedFor: TwilioConfigUse.CallsAndSms,
  twilioPrimaryPhoneNumber: new Phone("+15550001111"),
  twilioSecondaryPhoneNumbers: "+15550002222",
  twilioSmsPhoneNumbers: "+15550003333",
};

function makeUpdateBy(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): UpdateBy<GlobalConfig> {
  return {
    query: { _id: ObjectID.getZeroObjectID().toString() },
    data,
    limit: 1,
    skip: 0,
    props,
  } as unknown as UpdateBy<GlobalConfig>;
}

function makeCreateBy(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): CreateBy<GlobalConfig> {
  const model: GlobalConfig = new GlobalConfig();
  model.id = ObjectID.getZeroObjectID();
  Object.assign(model, data);

  return { data: model, props } as unknown as CreateBy<GlobalConfig>;
}

const before: Record<string, string | undefined> = {};

function setEnvironmentAccount(): void {
  process.env[ServerTwilioEnvironmentVariable.AccountSid] =
    "AC22222222222222222222222222222222";
  process.env[ServerTwilioEnvironmentVariable.AuthToken] = "env-auth-token";
  process.env[ServerTwilioEnvironmentVariable.PrimaryPhoneNumber] =
    "+14155550100";
}

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return null;
}

beforeEach(() => {
  for (const variable of SERVER_TWILIO_ENVIRONMENT_VARIABLES) {
    before[variable] = process.env[variable];
    delete process.env[variable];
  }
});

afterEach(() => {
  for (const variable of SERVER_TWILIO_ENVIRONMENT_VARIABLES) {
    if (before[variable] === undefined) {
      delete process.env[variable];
    } else {
      process.env[variable] = before[variable];
    }
  }

  jest.restoreAllMocks();
});

describe("the columns the variables stand in for", () => {
  test("are the six of the account, each a GlobalConfig column", () => {
    expect([...SERVER_TWILIO_ACCOUNT_COLUMNS]).toEqual([
      "twilioAccountSID",
      "twilioAuthToken",
      "twilioUsedFor",
      "twilioPrimaryPhoneNumber",
      "twilioSecondaryPhoneNumbers",
      "twilioSmsPhoneNumbers",
    ]);

    const model: GlobalConfig = new GlobalConfig();

    for (const column of SERVER_TWILIO_ACCOUNT_COLUMNS) {
      expect({
        column,
        isColumn: model.isTableColumn(column as string),
      }).toEqual({ column, isColumn: true });
    }
  });

  test("are exactly the columns the variables' account gives", () => {
    const account: ServerTwilioEnvironmentAccount | null =
      ServerTwilioEnvironment.read({
        [ServerTwilioEnvironmentVariable.AccountSid]: "AC1",
        [ServerTwilioEnvironmentVariable.AuthToken]: "token",
        [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "+14155550100",
      }).account;

    expect(Object.keys(account || {}).sort()).toEqual(
      [...SERVER_TWILIO_ACCOUNT_COLUMNS].sort(),
    );
  });
});

describe("with GLOBAL_TWILIO_ACCOUNT_SID set", () => {
  beforeEach(() => {
    setEnvironmentAccount();
  });

  test.each([...SERVER_TWILIO_ACCOUNT_COLUMNS] as Array<string>)(
    "refuses a master admin saving %s, and says where the account is changed",
    async (column: string) => {
      const error: unknown = await refusal(
        hooks.onBeforeUpdate(
          makeUpdateBy({ [column]: SAVED_VALUES[column] }, MASTER_ADMIN_PROPS),
        ),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toBe(
        SERVER_TWILIO_SET_BY_ENVIRONMENT_MESSAGE,
      );
    },
  );

  test.each([...SERVER_TWILIO_ACCOUNT_COLUMNS] as Array<string>)(
    "refuses a master admin clearing %s with null",
    async (column: string) => {
      await expect(
        hooks.onBeforeUpdate(
          makeUpdateBy({ [column]: null }, MASTER_ADMIN_PROPS),
        ),
      ).rejects.toBeInstanceOf(BadDataException);
    },
  );

  test("refuses the whole form, as the Admin Dashboard saves it", async () => {
    await expect(
      hooks.onBeforeUpdate(makeUpdateBy(SAVED_VALUES, MASTER_ADMIN_PROPS)),
    ).rejects.toThrow(SERVER_TWILIO_SET_BY_ENVIRONMENT_MESSAGE);
  });

  test("refuses one column hidden among settings that are not the account's", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy(
          { disableSignup: true, twilioAuthToken: "x" },
          MASTER_ADMIN_PROPS,
        ),
      ),
    ).rejects.toBeInstanceOf(BadDataException);
  });

  test("refuses a create holding the account, and a caller with no flags at all", async () => {
    await expect(
      hooks.onBeforeCreate(
        makeCreateBy(
          { twilioAccountSID: SAVED_VALUES["twilioAccountSID"] },
          MASTER_ADMIN_PROPS,
        ),
      ),
    ).rejects.toBeInstanceOf(BadDataException);
    expect(() => {
      GlobalConfigService.assertTwilioAccountNotSetByEnvironment(
        { twilioAuthToken: "x" },
        {} as DatabaseCommonInteractionProps,
      );
    }).toThrow(SERVER_TWILIO_SET_BY_ENVIRONMENT_MESSAGE);
    expect(() => {
      GlobalConfigService.assertTwilioAccountNotSetByEnvironment(
        { twilioAuthToken: "x" },
        undefined,
      );
    }).toThrow(SERVER_TWILIO_SET_BY_ENVIRONMENT_MESSAGE);
  });

  test("lets a master admin save every other setting", async () => {
    const result: OnUpdate<GlobalConfig> = await hooks.onBeforeUpdate(
      makeUpdateBy({ disableSignup: true }, MASTER_ADMIN_PROPS),
    );

    expect(result.updateBy.data).toEqual({ disableSignup: true });
  });

  test("a column left undefined is not written", () => {
    expect(() => {
      GlobalConfigService.assertTwilioAccountNotSetByEnvironment(
        { twilioAuthToken: undefined, disableSignup: true },
        MASTER_ADMIN_PROPS,
      );
    }).not.toThrow();
    for (const data of [null, undefined, {}]) {
      expect(() => {
        GlobalConfigService.assertTwilioAccountNotSetByEnvironment(
          data,
          MASTER_ADMIN_PROPS,
        );
      }).not.toThrow();
    }
  });

  test("lets OneUptime's own writes through: the data migrations", async () => {
    // The auth token alone asks nothing of the stored row.
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy({ twilioAuthToken: "migrated-token" }, ROOT_PROPS),
      ),
    ).resolves.toBeDefined();
    expect(() => {
      GlobalConfigService.assertTwilioAccountNotSetByEnvironment(
        SAVED_VALUES,
        ROOT_PROPS,
      );
    }).not.toThrow();
  });

  test("still refuses while the variables have a problem: they, not the saved account, are what is fixed", () => {
    delete process.env[ServerTwilioEnvironmentVariable.AuthToken];

    expect(() => {
      GlobalConfigService.assertTwilioAccountNotSetByEnvironment(
        { twilioAuthToken: "x" },
        MASTER_ADMIN_PROPS,
      );
    }).toThrow(SERVER_TWILIO_SET_BY_ENVIRONMENT_MESSAGE);
  });
});

describe("with GLOBAL_TWILIO_ACCOUNT_SID unset", () => {
  test("a master admin saves the account, as before", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy({ twilioAuthToken: "saved-token" }, MASTER_ADMIN_PROPS),
      ),
    ).resolves.toBeDefined();
    expect(() => {
      GlobalConfigService.assertTwilioAccountNotSetByEnvironment(
        SAVED_VALUES,
        MASTER_ADMIN_PROPS,
      );
    }).not.toThrow();
  });

  test("other variables set without it change nothing: nothing reads them", () => {
    process.env[ServerTwilioEnvironmentVariable.AuthToken] = "env-auth-token";
    process.env[ServerTwilioEnvironmentVariable.PrimaryPhoneNumber] =
      "+14155550100";

    expect(() => {
      GlobalConfigService.assertTwilioAccountNotSetByEnvironment(
        SAVED_VALUES,
        MASTER_ADMIN_PROPS,
      );
    }).not.toThrow();
  });

  test("is read on every write: set after the server started, it refuses from then on", () => {
    expect(() => {
      GlobalConfigService.assertTwilioAccountNotSetByEnvironment(
        { twilioAuthToken: "x" },
        MASTER_ADMIN_PROPS,
      );
    }).not.toThrow();

    setEnvironmentAccount();

    expect(() => {
      GlobalConfigService.assertTwilioAccountNotSetByEnvironment(
        { twilioAuthToken: "x" },
        MASTER_ADMIN_PROPS,
      );
    }).toThrow(SERVER_TWILIO_SET_BY_ENVIRONMENT_MESSAGE);
  });
});
