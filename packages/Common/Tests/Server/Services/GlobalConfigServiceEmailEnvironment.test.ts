import GlobalConfig, {
  EmailServerType,
} from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import Hostname from "../../../Types/API/Hostname";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import AmazonSesAuthenticationType from "../../../Types/Email/AmazonSesAuthenticationType";
import MailgunRegion from "../../../Types/Email/MailgunRegion";
import MailTransportType from "../../../Types/Email/MailTransportType";
import OAuthProviderType from "../../../Types/Email/OAuthProviderType";
import ServerEmailEnvironment, {
  SERVER_EMAIL_COLUMNS,
  SERVER_EMAIL_ENVIRONMENT_VARIABLES,
  SERVER_EMAIL_SET_BY_ENVIRONMENT_MESSAGE,
  ServerEmailEnvironmentVariable,
  ServerEmailSettings,
} from "../../../Types/Email/ServerEmailEnvironment";
import SMTPAuthenticationType from "../../../Types/Email/SMTPAuthenticationType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Port from "../../../Types/Port";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * NO SAVING EMAIL SETTINGS THE ENVIRONMENT VARIABLES SET (#7738).
 *
 * Once GLOBAL_EMAIL_SERVER_TYPE is set, the server sends its email with the
 * settings the GLOBAL_EMAIL_ variables describe and never the saved ones. A
 * write to the saved settings - Admin Dashboard > Settings > Emails, or the
 * API - would say "Saved" and change nothing that is sent, so it is refused
 * with where the settings are changed instead. OneUptime's own writes
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

// A value an admin could save in each column of the settings.
const SAVED_VALUES: Required<ServerEmailSettings> = {
  emailServerType: EmailServerType.CustomSMTP,
  isSMTPSecure: true,
  smtpTransportType: MailTransportType.SMTP,
  smtpAuthType: SMTPAuthenticationType.UsernamePassword,
  smtpHost: new Hostname("saved-smtp.example.com"),
  smtpPort: new Port(587),
  smtpUsername: "saved-user",
  smtpPassword: "saved-password",
  smtpFromEmail: new Email("saved@example.com"),
  smtpFromName: "Saved Sender",
  smtpClientId: "saved-client",
  smtpClientSecret: "saved-client-secret",
  smtpTokenUrl: "https://login.example.com/token",
  smtpScope: "https://outlook.office365.com/.default",
  smtpOAuthProviderType: OAuthProviderType.ClientCredentials,
  sendgridApiKey: "SG.saved",
  sendgridFromEmail: new Email("saved@example.com"),
  sendgridFromName: "Saved Sender",
  amazonSesAuthenticationType: AmazonSesAuthenticationType.AccessKey,
  amazonSesAccessKeyId: "AKIASAVED",
  amazonSesSecretAccessKey: "saved-secret-access-key",
  amazonSesRegion: "us-east-1",
  amazonSesFromEmail: new Email("saved@example.com"),
  amazonSesFromName: "Saved Sender",
  mailgunApiKey: "saved-mailgun-key",
  mailgunDomain: "mg.example.com",
  mailgunRegion: MailgunRegion.US,
  mailgunFromEmail: new Email("saved@example.com"),
  mailgunFromName: "Saved Sender",
  postmarkServerToken: "saved-postmark-token",
  postmarkFromEmail: new Email("saved@example.com"),
  postmarkFromName: "Saved Sender",
  resendApiKey: "re_saved",
  resendFromEmail: new Email("saved@example.com"),
  resendFromName: "Saved Sender",
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

function setEnvironmentSettings(): void {
  process.env[ServerEmailEnvironmentVariable.ServerType] = "sendgrid";
  process.env[ServerEmailEnvironmentVariable.SendgridApiKey] = "SG.env";
  process.env[ServerEmailEnvironmentVariable.FromEmail] = "env@example.com";
  process.env[ServerEmailEnvironmentVariable.FromName] = "Environment Sender";
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
  for (const variable of SERVER_EMAIL_ENVIRONMENT_VARIABLES) {
    before[variable] = process.env[variable];
    delete process.env[variable];
  }
});

afterEach(() => {
  for (const variable of SERVER_EMAIL_ENVIRONMENT_VARIABLES) {
    if (before[variable] === undefined) {
      delete process.env[variable];
    } else {
      process.env[variable] = before[variable];
    }
  }

  jest.restoreAllMocks();
});

describe("the columns the variables stand in for", () => {
  test("are each a GlobalConfig column, each once", () => {
    const model: GlobalConfig = new GlobalConfig();

    expect(new Set(SERVER_EMAIL_COLUMNS).size).toBe(
      SERVER_EMAIL_COLUMNS.length,
    );

    for (const column of SERVER_EMAIL_COLUMNS) {
      expect({
        column,
        isColumn: model.isTableColumn(column as string),
      }).toEqual({ column, isColumn: true });
    }
  });

  test("hold every column the variables' settings fill, whatever the type", () => {
    const filled: Set<string> = new Set();

    const readings: Array<Record<string, string>> = [
      {
        [ServerEmailEnvironmentVariable.ServerType]: "custom-smtp",
        [ServerEmailEnvironmentVariable.SmtpHost]: "smtp.example.com",
        [ServerEmailEnvironmentVariable.SmtpPort]: "587",
        [ServerEmailEnvironmentVariable.SmtpUsername]: "user",
        [ServerEmailEnvironmentVariable.SmtpPassword]: "password",
      },
      {
        [ServerEmailEnvironmentVariable.ServerType]: "custom-smtp",
        [ServerEmailEnvironmentVariable.SmtpHost]: "smtp.example.com",
        [ServerEmailEnvironmentVariable.SmtpPort]: "587",
        [ServerEmailEnvironmentVariable.SmtpAuthType]: "oauth",
        [ServerEmailEnvironmentVariable.SmtpOAuthProviderType]:
          "client-credentials",
        [ServerEmailEnvironmentVariable.SmtpUsername]: "user",
        [ServerEmailEnvironmentVariable.SmtpOAuthClientId]: "client",
        [ServerEmailEnvironmentVariable.SmtpOAuthClientSecret]: "secret",
        [ServerEmailEnvironmentVariable.SmtpOAuthTokenUrl]:
          "https://login.example.com/token",
        [ServerEmailEnvironmentVariable.SmtpOAuthScope]: "scope",
      },
      {
        [ServerEmailEnvironmentVariable.ServerType]: "sendgrid",
        [ServerEmailEnvironmentVariable.SendgridApiKey]: "SG.key",
      },
      {
        [ServerEmailEnvironmentVariable.ServerType]: "amazon-ses",
        [ServerEmailEnvironmentVariable.AmazonSesAccessKeyId]: "AKIA",
        [ServerEmailEnvironmentVariable.AmazonSesSecretAccessKey]: "secret",
        [ServerEmailEnvironmentVariable.AmazonSesRegion]: "us-east-1",
      },
      {
        [ServerEmailEnvironmentVariable.ServerType]: "mailgun",
        [ServerEmailEnvironmentVariable.MailgunApiKey]: "key",
        [ServerEmailEnvironmentVariable.MailgunDomain]: "mg.example.com",
      },
      {
        [ServerEmailEnvironmentVariable.ServerType]: "postmark",
        [ServerEmailEnvironmentVariable.PostmarkServerToken]: "token",
      },
      {
        [ServerEmailEnvironmentVariable.ServerType]: "resend",
        [ServerEmailEnvironmentVariable.ResendApiKey]: "re_key",
      },
    ];

    for (const values of readings) {
      const settings: ServerEmailSettings | null = ServerEmailEnvironment.read({
        [ServerEmailEnvironmentVariable.FromEmail]: "alerts@example.com",
        [ServerEmailEnvironmentVariable.FromName]: "Alerts",
        ...values,
      }).settings;

      for (const column of Object.keys(settings || {})) {
        filled.add(column);
      }
    }

    expect([...filled].sort()).toEqual([...SERVER_EMAIL_COLUMNS].sort());
  });
});

describe("with GLOBAL_EMAIL_SERVER_TYPE set", () => {
  beforeEach(() => {
    setEnvironmentSettings();
  });

  test.each([...SERVER_EMAIL_COLUMNS] as Array<string>)(
    "refuses a master admin saving %s, and says where the settings are changed",
    async (column: string) => {
      const error: unknown = await refusal(
        hooks.onBeforeUpdate(
          makeUpdateBy(
            {
              [column]: (SAVED_VALUES as Record<string, unknown>)[column],
            },
            MASTER_ADMIN_PROPS,
          ),
        ),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toBe(
        SERVER_EMAIL_SET_BY_ENVIRONMENT_MESSAGE,
      );
    },
  );

  test.each([...SERVER_EMAIL_COLUMNS] as Array<string>)(
    "refuses a master admin clearing %s with null",
    async (column: string) => {
      await expect(
        hooks.onBeforeUpdate(
          makeUpdateBy({ [column]: null }, MASTER_ADMIN_PROPS),
        ),
      ).rejects.toBeInstanceOf(BadDataException);
    },
  );

  test("refuses each form, as the Admin Dashboard saves it", async () => {
    const forms: Array<Record<string, unknown>> = [
      // Email Server Type.
      { emailServerType: EmailServerType.Mailgun },
      // Custom SMTP.
      {
        smtpTransportType: MailTransportType.SMTP,
        smtpHost: SAVED_VALUES.smtpHost,
        smtpPort: SAVED_VALUES.smtpPort,
        isSMTPSecure: true,
        smtpAuthType: SMTPAuthenticationType.UsernamePassword,
        smtpUsername: "saved-user",
        smtpPassword: "saved-password",
        smtpFromEmail: SAVED_VALUES.smtpFromEmail,
        smtpFromName: "Saved Sender",
      },
      // SendGrid.
      {
        sendgridApiKey: "SG.saved",
        sendgridFromEmail: SAVED_VALUES.sendgridFromEmail,
        sendgridFromName: "Saved Sender",
      },
      // Amazon SES, signed in as the server's IAM role.
      {
        amazonSesAuthenticationType: AmazonSesAuthenticationType.ServerIamRole,
        amazonSesRegion: "eu-west-1",
      },
      // The whole of it at once.
      SAVED_VALUES as unknown as Record<string, unknown>,
    ];

    for (const form of forms) {
      await expect(
        hooks.onBeforeUpdate(makeUpdateBy(form, MASTER_ADMIN_PROPS)),
      ).rejects.toThrow(SERVER_EMAIL_SET_BY_ENVIRONMENT_MESSAGE);
    }
  });

  test("refuses one column hidden among settings that are not the email's", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy(
          { disableSignup: true, smtpPassword: "x" },
          MASTER_ADMIN_PROPS,
        ),
      ),
    ).rejects.toBeInstanceOf(BadDataException);
  });

  test("refuses a create holding the settings, and a caller with no flags at all", async () => {
    await expect(
      hooks.onBeforeCreate(
        makeCreateBy({ smtpHost: SAVED_VALUES.smtpHost }, MASTER_ADMIN_PROPS),
      ),
    ).rejects.toThrow(SERVER_EMAIL_SET_BY_ENVIRONMENT_MESSAGE);
    expect(() => {
      GlobalConfigService.assertEmailSettingsNotSetByEnvironment(
        { smtpPassword: "x" },
        {} as DatabaseCommonInteractionProps,
      );
    }).toThrow(SERVER_EMAIL_SET_BY_ENVIRONMENT_MESSAGE);
    expect(() => {
      GlobalConfigService.assertEmailSettingsNotSetByEnvironment(
        { smtpPassword: "x" },
        undefined,
      );
    }).toThrow(SERVER_EMAIL_SET_BY_ENVIRONMENT_MESSAGE);
  });

  test("lets a master admin save every other setting - the Admin Notification Email among them", async () => {
    const result: OnUpdate<GlobalConfig> = await hooks.onBeforeUpdate(
      makeUpdateBy(
        {
          disableSignup: true,
          adminNotificationEmail: new Email("admin@example.com"),
        },
        MASTER_ADMIN_PROPS,
      ),
    );

    expect(result.updateBy.data).toEqual({
      disableSignup: true,
      adminNotificationEmail: new Email("admin@example.com"),
    });
  });

  test("a column left undefined is not written", () => {
    expect(() => {
      GlobalConfigService.assertEmailSettingsNotSetByEnvironment(
        { smtpPassword: undefined, disableSignup: true },
        MASTER_ADMIN_PROPS,
      );
    }).not.toThrow();
    for (const data of [null, undefined, {}]) {
      expect(() => {
        GlobalConfigService.assertEmailSettingsNotSetByEnvironment(
          data,
          MASTER_ADMIN_PROPS,
        );
      }).not.toThrow();
    }
  });

  test("lets OneUptime's own writes through: the data migrations", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy({ smtpPassword: "migrated-password" }, ROOT_PROPS),
      ),
    ).resolves.toBeDefined();
    expect(() => {
      GlobalConfigService.assertEmailSettingsNotSetByEnvironment(
        SAVED_VALUES,
        ROOT_PROPS,
      );
    }).not.toThrow();
  });

  test("still refuses while the variables have a problem: they, not the saved settings, are what is fixed", () => {
    delete process.env[ServerEmailEnvironmentVariable.SendgridApiKey];

    expect(() => {
      GlobalConfigService.assertEmailSettingsNotSetByEnvironment(
        { sendgridApiKey: "x" },
        MASTER_ADMIN_PROPS,
      );
    }).toThrow(SERVER_EMAIL_SET_BY_ENVIRONMENT_MESSAGE);

    process.env[ServerEmailEnvironmentVariable.ServerType] = "gmail";

    expect(() => {
      GlobalConfigService.assertEmailSettingsNotSetByEnvironment(
        { sendgridApiKey: "x" },
        MASTER_ADMIN_PROPS,
      );
    }).toThrow(SERVER_EMAIL_SET_BY_ENVIRONMENT_MESSAGE);
  });

  test("the message says where they are changed, and nothing of what was written", async () => {
    const error: unknown = await refusal(
      hooks.onBeforeUpdate(
        makeUpdateBy({ smtpPassword: "typed-password" }, MASTER_ADMIN_PROPS),
      ),
    );

    expect((error as Error).message).toContain("GLOBAL_EMAIL_SERVER_TYPE");
    expect((error as Error).message).toContain("Helm chart's values");
    expect((error as Error).message).toContain("config.env");
    expect((error as Error).message).not.toContain("typed-password");
    expect((error as Error).message).not.toContain("SG.env");
  });
});

describe("with GLOBAL_EMAIL_SERVER_TYPE unset", () => {
  test("a master admin saves the settings, as before", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy({ smtpPassword: "saved-password" }, MASTER_ADMIN_PROPS),
      ),
    ).resolves.toBeDefined();
    expect(() => {
      GlobalConfigService.assertEmailSettingsNotSetByEnvironment(
        SAVED_VALUES,
        MASTER_ADMIN_PROPS,
      );
    }).not.toThrow();
  });

  test("other variables set without it change nothing: nothing reads them", () => {
    process.env[ServerEmailEnvironmentVariable.SmtpHost] = "smtp.example.com";
    process.env[ServerEmailEnvironmentVariable.SmtpPassword] = "env-password";

    expect(() => {
      GlobalConfigService.assertEmailSettingsNotSetByEnvironment(
        SAVED_VALUES,
        MASTER_ADMIN_PROPS,
      );
    }).not.toThrow();
  });

  test("set to nothing but spaces, it is not set", () => {
    process.env[ServerEmailEnvironmentVariable.ServerType] = "   ";

    expect(() => {
      GlobalConfigService.assertEmailSettingsNotSetByEnvironment(
        SAVED_VALUES,
        MASTER_ADMIN_PROPS,
      );
    }).not.toThrow();
  });

  test("is read on every write: set after the server started, it refuses from then on", () => {
    expect(() => {
      GlobalConfigService.assertEmailSettingsNotSetByEnvironment(
        { smtpPassword: "x" },
        MASTER_ADMIN_PROPS,
      );
    }).not.toThrow();

    setEnvironmentSettings();

    expect(() => {
      GlobalConfigService.assertEmailSettingsNotSetByEnvironment(
        { smtpPassword: "x" },
        MASTER_ADMIN_PROPS,
      );
    }).toThrow(SERVER_EMAIL_SET_BY_ENVIRONMENT_MESSAGE);
  });

  test("the Twilio account's variables are not the email's", () => {
    const twilioAccountSid: string | undefined =
      process.env["GLOBAL_TWILIO_ACCOUNT_SID"];
    process.env["GLOBAL_TWILIO_ACCOUNT_SID"] = "AC1";

    try {
      expect(() => {
        GlobalConfigService.assertEmailSettingsNotSetByEnvironment(
          SAVED_VALUES,
          MASTER_ADMIN_PROPS,
        );
      }).not.toThrow();
    } finally {
      if (twilioAccountSid === undefined) {
        delete process.env["GLOBAL_TWILIO_ACCOUNT_SID"];
      } else {
        process.env["GLOBAL_TWILIO_ACCOUNT_SID"] = twilioAccountSid;
      }
    }
  });
});
