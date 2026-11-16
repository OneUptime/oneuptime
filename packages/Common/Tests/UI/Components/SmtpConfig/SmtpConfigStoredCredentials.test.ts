import { describe, expect, test } from "@jest/globals";
import GlobalConfig from "../../../../Models/DatabaseModels/GlobalConfig";
import ProjectSmtpConfig from "../../../../Models/DatabaseModels/ProjectSmtpConfig";
import MailTransportType from "../../../../Types/Email/MailTransportType";
import SMTPAuthenticationType from "../../../../Types/Email/SMTPAuthenticationType";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import {
  getGlobalSmtpConfigFormFields,
  getProjectSmtpConfigFormFields,
  PROJECT_SMTP_CONFIG_CREDENTIAL_IS_KEPT_BY,
} from "../../../../UI/Components/SmtpConfig/SmtpConfigFormFields";

/*
 * WHICH CREDENTIAL A PROJECT'S CONFIG KEEPS, AS ITS EDIT DIALOG READ IT
 * (#8989).
 *
 * A project's credentials are write-only: the Edit dialog never loads one,
 * and blank keeps the stored one. A config keeps the credential of the way
 * it sends - the password of a server it signs in to with one, the client
 * secret of its OAuth app, its provider's key - so on any other there is
 * nothing to keep, and the field is asked for as on a new config
 * (Field.hasNothingStoredWhenEditing). The rendered dialog:
 * Tests/App/Dashboard/CustomSmtpConfigForm.
 */

type StoredConfig = FormValues<ProjectSmtpConfig>;

function stored(values: Record<string, unknown>): StoredConfig {
  return values as StoredConfig;
}

const SMTP_WITH_PASSWORD: StoredConfig = stored({
  transportType: MailTransportType.SMTP,
  authType: SMTPAuthenticationType.UsernamePassword,
});
const SMTP_WITH_OAUTH: StoredConfig = stored({
  transportType: MailTransportType.SMTP,
  authType: SMTPAuthenticationType.OAuth,
});
const SMTP_WITHOUT_SIGN_IN: StoredConfig = stored({
  transportType: MailTransportType.SMTP,
  authType: SMTPAuthenticationType.None,
});
const MICROSOFT_GRAPH: StoredConfig = stored({
  transportType: MailTransportType.MicrosoftGraph,
  // Graph signs in with OAuth whatever the sign-in type stored says.
  authType: SMTPAuthenticationType.UsernamePassword,
});

function providerConfig(transport: MailTransportType): StoredConfig {
  return stored({ transportType: transport });
}

// Every way a config sends, and the credential each keeps.
const KEEPS: Array<[string, StoredConfig, Array<string>]> = [
  ["SMTP with a password", SMTP_WITH_PASSWORD, ["password"]],
  ["SMTP with OAuth", SMTP_WITH_OAUTH, ["clientSecret"]],
  ["SMTP without signing in", SMTP_WITHOUT_SIGN_IN, []],
  ["Microsoft Graph", MICROSOFT_GRAPH, ["clientSecret"]],
  [
    "Amazon SES",
    providerConfig(MailTransportType.AmazonSES),
    ["amazonSesSecretAccessKey"],
  ],
  ["SendGrid", providerConfig(MailTransportType.SendGrid), ["sendgridApiKey"]],
  ["Mailgun", providerConfig(MailTransportType.Mailgun), ["mailgunApiKey"]],
  [
    "Postmark",
    providerConfig(MailTransportType.Postmark),
    ["postmarkServerToken"],
  ],
  ["Resend", providerConfig(MailTransportType.Resend), ["resendApiKey"]],
  // A config stored before the transport existed sends over SMTP.
  [
    "a config with no transport stored",
    stored({ authType: SMTPAuthenticationType.UsernamePassword }),
    ["password"],
  ],
];

function columnOf<TEntity>(field: Field<TEntity>): string {
  return Object.keys(field.field || {})[0] || "";
}

describe.each(KEEPS)(
  "a config that sends through %s",
  (_name: string, config: StoredConfig, kept: Array<string>) => {
    test("keeps its own credential, and nothing is stored for any other", () => {
      const keptByRule: Array<string> = Object.entries(
        PROJECT_SMTP_CONFIG_CREDENTIAL_IS_KEPT_BY,
      )
        .filter(([, isKept]: [string, (stored: unknown) => boolean]) => {
          return isKept(config);
        })
        .map(([column]: [string, unknown]): string => {
          return column;
        });

      expect(keptByRule).toEqual(kept);
    });

    test("its Edit dialog asks for every other credential as on a new config", () => {
      for (const field of getProjectSmtpConfigFormFields()) {
        const column: string = columnOf(field);

        if (!PROJECT_SMTP_CONFIG_CREDENTIAL_IS_KEPT_BY[column]) {
          continue;
        }

        const rule: Field<ProjectSmtpConfig>["hasNothingStoredWhenEditing"] =
          field.hasNothingStoredWhenEditing;

        expect(typeof rule).toBe("function");
        expect({
          column,
          nothingStored: (rule as (stored: StoredConfig) => boolean)(config),
        }).toEqual({ column, nothingStored: !kept.includes(column) });
      }
    });
  },
);

describe("the fields the rule is on", () => {
  test("every credential of a project's form, and no other field", () => {
    const ruled: Array<string> = getProjectSmtpConfigFormFields()
      .filter((field: Field<ProjectSmtpConfig>): boolean => {
        return field.hasNothingStoredWhenEditing !== undefined;
      })
      .map(columnOf)
      .sort();

    expect(ruled).toEqual(
      Object.keys(PROJECT_SMTP_CONFIG_CREDENTIAL_IS_KEPT_BY).sort(),
    );
  });

  test("none of the instance's own form, which a master admin reads whole", () => {
    expect(
      getGlobalSmtpConfigFormFields().filter(
        (field: Field<GlobalConfig>): boolean => {
          return field.hasNothingStoredWhenEditing !== undefined;
        },
      ),
    ).toEqual([]);
  });

  test("a rule reads the config as the dialog read it, not the form as edited", () => {
    const password: Field<ProjectSmtpConfig> =
      getProjectSmtpConfigFormFields().find(
        (field: Field<ProjectSmtpConfig>): boolean => {
          return columnOf(field) === "password";
        },
      )!;

    // Stored with a password: kept, whatever the dialog holds now.
    expect(
      (
        password.hasNothingStoredWhenEditing as (
          stored: StoredConfig,
        ) => boolean
      )(SMTP_WITH_PASSWORD),
    ).toBe(false);
    // Nothing read yet: nothing stored to keep.
    expect(
      (
        password.hasNothingStoredWhenEditing as (
          stored: StoredConfig,
        ) => boolean
      )(stored({ transportType: MailTransportType.SendGrid })),
    ).toBe(true);
  });
});
