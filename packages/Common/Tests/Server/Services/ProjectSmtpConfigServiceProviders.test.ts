import { afterEach, describe, expect, jest, test } from "@jest/globals";
import ProjectSmtpConfig from "../../../Models/DatabaseModels/ProjectSmtpConfig";
import ProjectSmtpConfigService, {
  Service as ProjectSmtpConfigServiceClass,
} from "../../../Server/Services/ProjectSmtpConfigService";
import { PROJECT_SMTP_CONFIG_SEND_SELECT } from "../../../Server/Utils/Mail/ProjectSmtpConfigSelect";
import Email from "../../../Types/Email";
import EmailServer from "../../../Types/Email/EmailServer";
import MailgunRegion from "../../../Types/Email/MailgunRegion";
import MailTransportType from "../../../Types/Email/MailTransportType";
import ObjectID from "../../../Types/ObjectID";
import {
  AMAZON_SES_AUTHENTICATION_TYPE_INVALID,
  AMAZON_SES_ROLE_ARN_INVALID,
  AMAZON_SES_ROLE_REGION_REQUIRED,
} from "../../../Types/Email/AmazonSesRoleWords";
import ProjectAmazonSesAuthenticationType from "../../../Types/Email/ProjectAmazonSesAuthenticationType";
import Hostname from "../../../Types/API/Hostname";
import Port from "../../../Types/Port";
import {
  TableColumnMetadata,
  getTableColumns,
} from "../../../Types/Database/TableColumn";
import Dictionary from "../../../Types/Dictionary";

jest.mock("../../../Server/Utils/Logger");

/*
 * A PROJECT'S CONFIG OF A PROVIDER WITH AN HTTP API OF ITS OWN, AS IT IS
 * SENT WITH (ProjectSmtpConfigService.toEmailServer): its key alone - an
 * Amazon SES access key and Region, a SendGrid, Mailgun, Postmark or Resend
 * key, Mailgun's domain and region - and its sender. Every refusal names
 * the field to fill in; a key typed in for another transport, a mail
 * server's password or an OAuth secret is never handed on.
 */

const ID: ObjectID = new ObjectID("11111111-2222-4333-8444-555555555555");

/*
 * A config's fields, any of them unset: a stored config can hold a field as
 * undefined, which Partial<> cannot say under exactOptionalPropertyTypes.
 */
type ConfigValues = {
  [Key in keyof ProjectSmtpConfig]?: ProjectSmtpConfig[Key] | undefined;
};

function config(values: ConfigValues): ProjectSmtpConfig {
  const item: ProjectSmtpConfig = new ProjectSmtpConfig();

  Object.assign(item, {
    _id: ID.toString(),
    id: ID,
    fromEmail: new Email("alerts@example.test"),
    fromName: "Acme Alerts",
    // Every other transport's settings, as a config edited from one to another holds them.
    hostname: undefined,
    password: "smtp-password",
    clientSecret: "oauth-secret",
    amazonSesAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
    amazonSesSecretAccessKey: "ses-secret",
    amazonSesRegion: "us-east-1",
    sendgridApiKey: "SG.key",
    mailgunApiKey: "key-mailgun",
    mailgunDomain: "mg.example.test",
    postmarkServerToken: "pm-token",
    resendApiKey: "re_key",
    ...values,
  });

  return item;
}

function server(values: ConfigValues): EmailServer {
  return ProjectSmtpConfigService.toEmailServer(config(values))!;
}

// What an EmailServer carries besides who it is and who sends.
function credentialsOf(emailServer: EmailServer): Record<string, unknown> {
  const carried: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(emailServer)) {
    if (
      !["id", "transportType", "fromEmail", "fromName"].includes(key) &&
      value !== undefined
    ) {
      carried[key] = value;
    }
  }

  return carried;
}

describe("each provider is sent with its own key alone", () => {
  test("Amazon SES: the access key and the Region", () => {
    const emailServer: EmailServer = server({
      transportType: MailTransportType.AmazonSES,
      amazonSesRegion: " EU-West-1 ",
    });

    expect(emailServer.transportType).toBe(MailTransportType.AmazonSES);
    expect(emailServer.id?.toString()).toBe(ID.toString());
    expect(emailServer.fromEmail.toString()).toBe("alerts@example.test");
    expect(credentialsOf(emailServer)).toEqual({
      awsAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
      awsSecretAccessKey: "ses-secret",
      awsRegion: "eu-west-1",
    });
  });

  test("Amazon SES: never the server's IAM role, whatever the row holds - a project's config signs in with its own key (#7000)", () => {
    /*
     * A project's column holds its own values (#7378: Access Key or IAM
     * Role); the server's, written on the row anyway, reads as the key.
     */
    const row: ProjectSmtpConfig = config({
      transportType: MailTransportType.AmazonSES,
    });

    Object.assign(row, {
      amazonSesAuthenticationType: "Server IAM Role",
      awsAuthenticationType: "Server IAM Role",
    });

    const emailServer: EmailServer =
      ProjectSmtpConfigService.toEmailServer(row)!;

    expect(emailServer.awsAuthenticationType).toBeUndefined();
    // Its id goes along: the sender refuses the server's role to any config that has one.
    expect(emailServer.id?.toString()).toBe(ID.toString());
    expect(credentialsOf(emailServer)).toEqual({
      awsAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
      awsSecretAccessKey: "ses-secret",
      awsRegion: "us-east-1",
    });
  });

  test.each([
    [MailTransportType.SendGrid, "SG.key"],
    [MailTransportType.Postmark, "pm-token"],
    [MailTransportType.Resend, "re_key"],
  ])("%s: its key", (transport: MailTransportType, key: string) => {
    expect(credentialsOf(server({ transportType: transport }))).toEqual({
      apiKey: key,
    });
  });

  test("Mailgun: its key, its domain and its region - US unless EU", () => {
    expect(
      credentialsOf(
        server({
          transportType: MailTransportType.Mailgun,
          mailgunDomain: " MG.Example.TEST ",
        }),
      ),
    ).toEqual({
      apiKey: "key-mailgun",
      mailgunDomain: "mg.example.test",
      mailgunRegion: MailgunRegion.US,
    });

    expect(
      server({
        transportType: MailTransportType.Mailgun,
        mailgunRegion: MailgunRegion.EU,
      }).mailgunRegion,
    ).toBe(MailgunRegion.EU);
  });
});

describe("a setting left blank, or not what the provider takes, names the field", () => {
  test.each([
    [
      MailTransportType.AmazonSES,
      { amazonSesAccessKeyId: "" },
      "Project SMTP config Amazon SES Access Key ID is not set",
    ],
    [
      MailTransportType.AmazonSES,
      { amazonSesSecretAccessKey: undefined },
      "Project SMTP config Amazon SES Secret Access Key is not set",
    ],
    [
      MailTransportType.AmazonSES,
      { amazonSesRegion: "  " },
      "Project SMTP config Amazon SES Region is not set",
    ],
    [
      MailTransportType.AmazonSES,
      { amazonSesRegion: "us-east-1.evil.test" },
      'Project SMTP config Amazon SES Region "us-east-1.evil.test" is not an AWS Region. Use a code such as us-east-1.',
    ],
    [
      MailTransportType.SendGrid,
      { sendgridApiKey: undefined },
      "Project SMTP config SendGrid API Key is not set",
    ],
    [
      MailTransportType.Mailgun,
      { mailgunApiKey: "" },
      "Project SMTP config Mailgun API Key is not set",
    ],
    [
      MailTransportType.Mailgun,
      { mailgunDomain: undefined },
      "Project SMTP config Mailgun Domain is not set",
    ],
    [
      MailTransportType.Mailgun,
      { mailgunDomain: "mg.example.test/../../v4" },
      'Project SMTP config Mailgun Domain "mg.example.test/../../v4" is not a domain. Use the sending domain as Mailgun lists it, such as mg.example.com.',
    ],
    [
      MailTransportType.Postmark,
      { postmarkServerToken: " " },
      "Project SMTP config Postmark Server API Token is not set",
    ],
    [
      MailTransportType.Resend,
      { resendApiKey: undefined },
      "Project SMTP config Resend API Key is not set",
    ],
  ])(
    "%s with %j",
    (transport: MailTransportType, values: ConfigValues, message: string) => {
      expect(() => {
        return server({ transportType: transport, ...values });
      }).toThrow(message);
    },
  );

  test("every provider needs its sender, as a mail server does", () => {
    for (const transport of [
      MailTransportType.AmazonSES,
      MailTransportType.SendGrid,
      MailTransportType.Mailgun,
      MailTransportType.Postmark,
      MailTransportType.Resend,
    ]) {
      expect(() => {
        return server({ transportType: transport, fromEmail: undefined });
      }).toThrow("Project SMTP config from email is not set");
      expect(() => {
        return server({ transportType: transport, fromName: "" });
      }).toThrow("Project SMTP config from name is not set");
    }
  });

  test("a provider needs no host, port, username or OAuth app", () => {
    expect(() => {
      return server({
        transportType: MailTransportType.Resend,
        hostname: undefined,
        port: undefined,
        username: undefined,
        clientId: undefined,
      });
    }).not.toThrow();
  });
});

describe("a mail server's config reads as it always did", () => {
  test("an unknown transport is SMTP, and needs its host", () => {
    expect(() => {
      return server({ transportType: "Carrier Pigeon" as MailTransportType });
    }).toThrow("Project SMTP config host is not set");
  });

  test("an SMTP config never carries a provider's key", () => {
    const emailServer: EmailServer = server({
      transportType: MailTransportType.SMTP,
      hostname: new Hostname("smtp.example.test"),
      port: new Port(587),
      username: "alerts@example.test",
    });

    expect(emailServer.host?.toString()).toBe("smtp.example.test");
    expect(emailServer.password).toBe("smtp-password");

    for (const key of [
      "apiKey",
      "awsAccessKeyId",
      "awsSecretAccessKey",
      "awsRegion",
      "mailgunDomain",
      "mailgunRegion",
    ]) {
      expect({
        key,
        value: (emailServer as unknown as Record<string, unknown>)[key],
      }).toEqual({
        key,
        value: undefined,
      });
    }
  });

  test("neither does a Microsoft Graph config", () => {
    const emailServer: EmailServer = server({
      transportType: MailTransportType.MicrosoftGraph,
      clientId: "client-id",
      tokenUrl: "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
      scope: "https://graph.microsoft.com/.default",
    });

    expect(emailServer.clientSecret).toBe("oauth-secret");
    expect(emailServer.apiKey).toBeUndefined();
    expect(emailServer.awsSecretAccessKey).toBeUndefined();
  });
});

describe("what a send reads of a config (PROJECT_SMTP_CONFIG_SEND_SELECT)", () => {
  test("every column toEmailServer reads, for every transport", () => {
    expect(Object.keys(PROJECT_SMTP_CONFIG_SEND_SELECT).sort()).toEqual(
      [
        "_id",
        // Whose config it is: an Amazon SES role's external id is derived from it (#7378).
        "projectId",
        "transportType",
        "hostname",
        "port",
        "username",
        "password",
        "fromEmail",
        "fromName",
        "secure",
        "authType",
        "clientId",
        "clientSecret",
        "tokenUrl",
        "scope",
        "oauthProviderType",
        "amazonSesAccessKeyId",
        "amazonSesSecretAccessKey",
        "amazonSesRegion",
        "amazonSesAuthenticationType",
        "amazonSesRoleArn",
        "sendgridApiKey",
        "mailgunApiKey",
        "mailgunDomain",
        "mailgunRegion",
        "postmarkServerToken",
        "resendApiKey",
      ].sort(),
    );
  });

  test("every provider's key is a secret, encrypted at rest and read only by those who may", () => {
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(
      new ProjectSmtpConfig(),
    );

    for (const name of [
      "amazonSesSecretAccessKey",
      "sendgridApiKey",
      "mailgunApiKey",
      "postmarkServerToken",
      "resendApiKey",
    ]) {
      expect({ name, encrypted: columns[name]?.encrypted }).toEqual({
        name,
        encrypted: true,
      });
    }

    // Identifiers that sign in to nothing stay plain text.
    for (const name of [
      "amazonSesAccessKeyId",
      "amazonSesRegion",
      "mailgunDomain",
      "mailgunRegion",
    ]) {
      expect({ name, encrypted: Boolean(columns[name]?.encrypted) }).toEqual({
        name,
        encrypted: false,
      });
    }
  });
});

/*
 * A PROJECT'S AMAZON SES CONFIG THAT SIGNS IN WITH AN IAM ROLE IN ITS OWN AWS
 * ACCOUNT (#7378): sent with the role's ARN, its Region and the row's own
 * project - never a key - and written only with a role that can be signed
 * in to.
 */
describe("Amazon SES with an IAM role in the project's own account", () => {
  const PROJECT_ID: ObjectID = new ObjectID(
    "66666666-7777-4888-8999-000000000000",
  );
  const ROLE: string = "arn:aws:iam::210987654321:role/OneUptimeSes";

  function roleConfig(values: ConfigValues = {}): ProjectSmtpConfig {
    return config({
      projectId: PROJECT_ID,
      transportType: MailTransportType.AmazonSES,
      amazonSesAuthenticationType: ProjectAmazonSesAuthenticationType.IamRole,
      amazonSesRoleArn: ` ${ROLE} `,
      amazonSesRegion: " EU-West-1 ",
      ...values,
    });
  }

  test("is sent with its role, its Region and the row's own project, and no key - whatever the row still holds", () => {
    const emailServer: EmailServer =
      ProjectSmtpConfigService.toEmailServer(roleConfig())!;

    expect(emailServer.id?.toString()).toBe(ID.toString());
    expect(credentialsOf(emailServer)).toEqual({
      awsRoleArn: ROLE,
      awsRoleProjectId: PROJECT_ID.toString(),
      awsRegion: "eu-west-1",
    });
    expect(emailServer.awsAuthenticationType).toBeUndefined();
  });

  test("is refused without a role it can sign in to, a Region, or the project it belongs to", () => {
    for (const [values, refusal] of [
      [{ amazonSesRoleArn: undefined }, AMAZON_SES_ROLE_ARN_INVALID],
      [
        { amazonSesRoleArn: "arn:aws:iam::210987654321:user/OneUptime" },
        AMAZON_SES_ROLE_ARN_INVALID,
      ],
      [{ amazonSesRegion: undefined }, AMAZON_SES_ROLE_REGION_REQUIRED],
      [
        { amazonSesRegion: "email.us-east-1.amazonaws.com" },
        AMAZON_SES_ROLE_REGION_REQUIRED,
      ],
      [
        { projectId: undefined },
        "This SMTP config was read without its project, so its Amazon SES role cannot be signed in to.",
      ],
    ] as Array<[ConfigValues, string]>) {
      expect(() => {
        return ProjectSmtpConfigService.toEmailServer(roleConfig(values));
      }).toThrow(refusal);
    }
  });

  test("an access key config is read as it always was, a role ARN beside it or not", () => {
    for (const type of [
      ProjectAmazonSesAuthenticationType.AccessKey,
      undefined,
      "Server IAM Role",
      "IAM role",
    ]) {
      const emailServer: EmailServer = ProjectSmtpConfigService.toEmailServer(
        roleConfig({
          amazonSesAuthenticationType:
            type as ProjectAmazonSesAuthenticationType,
        }),
      )!;

      expect(credentialsOf(emailServer)).toEqual({
        awsAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
        awsSecretAccessKey: "ses-secret",
        awsRegion: "eu-west-1",
      });
    }
  });

  describe("as it is written (applyAmazonSesAuthenticationRules)", () => {
    function apply(
      data: Record<string, unknown>,
      stored?: Record<string, unknown>,
    ): Record<string, unknown> {
      ProjectSmtpConfigServiceClass.applyAmazonSesAuthenticationRules(
        data,
        stored,
      );

      return data;
    }

    const SES_ROLE: Record<string, unknown> = {
      transportType: MailTransportType.AmazonSES,
      amazonSesAuthenticationType: ProjectAmazonSesAuthenticationType.IamRole,
      amazonSesRoleArn: ROLE,
      amazonSesRegion: "eu-west-1",
    };

    test("a project's own values only: the server's role, or anything else, is refused with what it may be", () => {
      for (const value of [
        "Server IAM Role",
        "IAM role",
        "iam role",
        "Role",
        7,
        true,
      ]) {
        expect(() => {
          return apply({ amazonSesAuthenticationType: value });
        }).toThrow(AMAZON_SES_AUTHENTICATION_TYPE_INVALID);
      }

      // Nothing written is an access key; so is an empty one.
      expect(apply({ amazonSesAuthenticationType: "" })).toEqual({
        amazonSesAuthenticationType:
          ProjectAmazonSesAuthenticationType.AccessKey,
      });
      expect(apply({ name: "Renamed" })).toEqual({ name: "Renamed" });
    });

    test("signing in with a role clears the access key in the same write", () => {
      expect(
        apply({
          ...SES_ROLE,
          amazonSesAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
          amazonSesSecretAccessKey: "ses-secret",
        }),
      ).toEqual({
        ...SES_ROLE,
        amazonSesAccessKeyId: null,
        amazonSesSecretAccessKey: null,
      });
    });

    test("a role keeps no key: one written to a config that signs in with a role is cleared", () => {
      expect(
        apply(
          {
            amazonSesAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
            amazonSesSecretAccessKey: "ses-secret",
          },
          SES_ROLE,
        ),
      ).toEqual({
        amazonSesAccessKeyId: null,
        amazonSesSecretAccessKey: null,
      });
    });

    test("a role needs an ARN that is one, and a Region, as stored after the write", () => {
      expect(() => {
        return apply({ ...SES_ROLE, amazonSesRoleArn: undefined });
      }).toThrow(AMAZON_SES_ROLE_ARN_INVALID);
      expect(() => {
        return apply({ ...SES_ROLE, amazonSesRoleArn: "OneUptimeSes" });
      }).toThrow(AMAZON_SES_ROLE_ARN_INVALID);
      expect(() => {
        return apply({ ...SES_ROLE, amazonSesRegion: undefined });
      }).toThrow(AMAZON_SES_ROLE_REGION_REQUIRED);
      expect(() => {
        return apply({ ...SES_ROLE, amazonSesRegion: "not a region" });
      }).toThrow(AMAZON_SES_ROLE_REGION_REQUIRED);

      // The ARN and the Region a config already holds count.
      expect(
        apply(
          {
            amazonSesAuthenticationType:
              ProjectAmazonSesAuthenticationType.IamRole,
          },
          {
            transportType: MailTransportType.AmazonSES,
            amazonSesRoleArn: ROLE,
            amazonSesRegion: "us-east-1",
          },
        ),
      ).toEqual({
        amazonSesAuthenticationType: ProjectAmazonSesAuthenticationType.IamRole,
        amazonSesAccessKeyId: null,
        amazonSesSecretAccessKey: null,
      });

      // A write that empties a stored role's ARN is refused.
      expect(() => {
        return apply({ amazonSesRoleArn: "  " }, SES_ROLE);
      }).toThrow(AMAZON_SES_ROLE_ARN_INVALID);
    });

    test("a role ARN written on its own is checked, and trimmed", () => {
      expect(() => {
        return apply({ amazonSesRoleArn: "arn:aws:iam::1:role/x" });
      }).toThrow(AMAZON_SES_ROLE_ARN_INVALID);
      expect(apply({ amazonSesRoleArn: ` ${ROLE} ` })).toEqual({
        amazonSesRoleArn: ROLE,
      });
    });

    test("an access key config, or a role on another transport, asks for no role", () => {
      expect(
        apply({
          transportType: MailTransportType.AmazonSES,
          amazonSesAuthenticationType:
            ProjectAmazonSesAuthenticationType.AccessKey,
          amazonSesAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
        }),
      ).toEqual({
        transportType: MailTransportType.AmazonSES,
        amazonSesAuthenticationType:
          ProjectAmazonSesAuthenticationType.AccessKey,
        amazonSesAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
      });
      expect(
        apply({
          transportType: MailTransportType.SendGrid,
          amazonSesAuthenticationType:
            ProjectAmazonSesAuthenticationType.IamRole,
        }),
      ).toEqual({
        transportType: MailTransportType.SendGrid,
        amazonSesAuthenticationType: ProjectAmazonSesAuthenticationType.IamRole,
        amazonSesAccessKeyId: null,
        amazonSesSecretAccessKey: null,
      });
    });
  });

  describe("on create and update", () => {
    type Hooks = {
      onBeforeCreate: (createBy: unknown) => Promise<unknown>;
      onBeforeUpdate: (updateBy: unknown) => Promise<unknown>;
    };

    const hooks: Hooks = ProjectSmtpConfigService as unknown as Hooks;

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("a new config that signs in with a role keeps no key", async () => {
      const created: ProjectSmtpConfig = roleConfig({
        amazonSesRoleArn: ROLE,
        amazonSesRegion: "eu-west-1",
      });

      await hooks.onBeforeCreate({ data: created, props: { isRoot: true } });

      expect(created.amazonSesAccessKeyId).toBeFalsy();
      expect(created.amazonSesSecretAccessKey).toBeFalsy();
      expect(created.amazonSesRoleArn).toBe(ROLE);
    });

    test("a new config that asks for the server's role, or a role it cannot sign in to, is refused", async () => {
      await expect(
        hooks.onBeforeCreate({
          data: roleConfig({
            amazonSesAuthenticationType:
              "Server IAM Role" as ProjectAmazonSesAuthenticationType,
          }),
          props: { isRoot: true },
        }),
      ).rejects.toThrow(AMAZON_SES_AUTHENTICATION_TYPE_INVALID);
      await expect(
        hooks.onBeforeCreate({
          data: roleConfig({ amazonSesRoleArn: undefined }),
          props: { isRoot: true },
        }),
      ).rejects.toThrow(AMAZON_SES_ROLE_ARN_INVALID);
    });

    test("an update is weighed against the config it changes, and clears its key when it moves to a role", async () => {
      jest
        .spyOn(ProjectSmtpConfigService, "findBy")
        .mockResolvedValue([
          config({
            transportType: MailTransportType.AmazonSES,
            amazonSesRoleArn: ROLE,
            amazonSesRegion: "eu-west-1",
          }),
        ]);

      const data: Record<string, unknown> = {
        amazonSesAuthenticationType: ProjectAmazonSesAuthenticationType.IamRole,
      };

      await hooks.onBeforeUpdate({
        query: { _id: ID.toString() },
        data,
        props: { isRoot: true },
      });

      expect(data).toEqual({
        amazonSesAuthenticationType: ProjectAmazonSesAuthenticationType.IamRole,
        amazonSesAccessKeyId: null,
        amazonSesSecretAccessKey: null,
      });
    });

    test("an update that leaves a config with a role it cannot sign in to is refused", async () => {
      jest
        .spyOn(ProjectSmtpConfigService, "findBy")
        .mockResolvedValue([
          config({
            transportType: MailTransportType.AmazonSES,
            amazonSesRoleArn: undefined,
          }),
        ]);

      await expect(
        hooks.onBeforeUpdate({
          query: { _id: ID.toString() },
          data: {
            amazonSesAuthenticationType:
              ProjectAmazonSesAuthenticationType.IamRole,
          },
          props: { isRoot: true },
        }),
      ).rejects.toThrow(AMAZON_SES_ROLE_ARN_INVALID);
    });

    test("one write is never half done across configs that sign in in different ways", async () => {
      jest
        .spyOn(ProjectSmtpConfigService, "findBy")
        .mockResolvedValue([
          config({
            transportType: MailTransportType.AmazonSES,
            amazonSesAuthenticationType:
              ProjectAmazonSesAuthenticationType.IamRole,
            amazonSesRoleArn: ROLE,
          }),
          config({ transportType: MailTransportType.AmazonSES }),
        ]);

      await expect(
        hooks.onBeforeUpdate({
          query: { projectId: PROJECT_ID.toString() },
          data: { amazonSesAccessKeyId: "AKIAIOSFODNN7EXAMPLE" },
          props: { isRoot: true },
        }),
      ).rejects.toThrow(
        "Change how one SMTP config signs in to Amazon SES at a time: these configs sign in in different ways.",
      );
    });

    test("an update that names none of the sign-in's columns reads nothing", async () => {
      const findBy: jest.SpiedFunction<typeof ProjectSmtpConfigService.findBy> =
        jest.spyOn(ProjectSmtpConfigService, "findBy");

      await hooks.onBeforeUpdate({
        query: { _id: ID.toString() },
        data: { name: "Renamed" },
        props: { isRoot: true },
      });

      expect(findBy).not.toHaveBeenCalled();
    });
  });
});
