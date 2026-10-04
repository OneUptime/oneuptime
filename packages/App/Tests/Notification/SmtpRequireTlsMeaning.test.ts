import { TransporterPool } from "../../FeatureSet/Notification/Services/MailService";
import Hostname from "Common/Types/API/Hostname";
import Email from "Common/Types/Email";
import EmailServer from "Common/Types/Email/EmailServer";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import Port from "Common/Types/Port";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodemailer, { type SMTPTransportOptions } from "nodemailer";
import path from "path";

jest.mock("../../FeatureSet/Notification/Config", () => {
  return {
    getEmailServerType: jest.fn(),
    getGlobalSMTPConfig: jest.fn(),
    getSendgridConfig: jest.fn(),
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  return { IsDevelopment: false, EncryptionSecret: "test-encryption-secret" };
});

jest.mock("Common/Server/Services/EmailLogService", () => {
  return { __esModule: true, default: { create: jest.fn() } };
});

jest.mock("Common/Server/Services/UserOnCallLogTimelineService", () => {
  return { __esModule: true, default: { updateOneById: jest.fn() } };
});

jest.mock("Common/Models/DatabaseModels/EmailLog", () => {
  return { __esModule: true, default: jest.fn() };
});

jest.mock("Common/Models/DatabaseModels/GlobalConfig", () => {
  return {
    EmailServerType: { Sendgrid: "Sendgrid", CustomSMTP: "Custom SMTP" },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationCounter: () => {
        return { add: jest.fn() };
      },
      getNotificationDuration: () => {
        return { record: jest.fn() };
      },
    },
  };
});

jest.mock(
  "../../FeatureSet/Notification/Services/MailProviders/MicrosoftGraphMailProvider",
  () => {
    return { __esModule: true, default: jest.fn() };
  },
);

/*
 * WHAT "REQUIRE TLS" PROMISES, AGAINST WHAT THE MAIL SERVICE DOES.
 *
 * The mail server forms named this switch "Use SSL / TLS", and the Admin
 * Dashboard's form said "Do not enable this if you use port 587". It is
 * "Require TLS" now (Common/UI/Components/SmtpConfig/SmtpConfigFormFields),
 * with help that says what the mail service does with it, and the service
 * was left exactly as it was. These pin each sentence of that help to the
 * transporter the service builds, on the submission port and on 465:
 *
 *   - "Mail is sent only over an encrypted connection with a valid
 *     certificate": on, STARTTLS is required and the certificate verified;
 *   - "When this is off, mail is encrypted only if the server offers it,
 *     and the certificate is not checked": off (or never set), STARTTLS is
 *     only taken when offered, without verifying;
 *   - "Port 465 is always encrypted": TLS from the first byte, either way.
 *
 * The operator's own server (no config id) is used, so nothing is resolved
 * or pinned; SmtpServerPinning covers that part.
 */

const BUILDER_FILE: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
  "Components",
  "SmtpConfig",
  "SmtpConfigFormFields.ts",
);

const REQUIRE_TLS_HELP: string =
  "Mail is sent only over an encrypted connection with a valid certificate. When this is off, mail is encrypted only if the server offers it, and the certificate is not checked. Port 465 is always encrypted.";

function server(port: number, secure: boolean | null | undefined): EmailServer {
  return {
    host: new Hostname("smtp.example.com"),
    port: new Port(port),
    username: "user",
    password: "pass",
    fromEmail: new Email("noreply@example.com"),
    fromName: "OneUptime",
    secure: secure as boolean | undefined,
    authType: SMTPAuthenticationType.UsernamePassword,
  };
}

describe("Require TLS means what its help says", () => {
  let createTransportSpy: jest.SpyInstance;

  beforeEach(() => {
    createTransportSpy = jest
      .spyOn(nodemailer, "createTransport")
      .mockReturnValue({
        sendMail: () => {
          return Promise.resolve({});
        },
        close: () => {
          return undefined;
        },
      } as never);
  });

  afterEach(async () => {
    await TransporterPool.cleanup();
    jest.restoreAllMocks();
  });

  async function transportFor(
    port: number,
    secure: boolean | null | undefined,
  ): Promise<SMTPTransportOptions> {
    await TransporterPool.getTransporter(server(port, secure), {});

    return createTransportSpy.mock.calls[
      createTransportSpy.mock.calls.length - 1
    ]![0] as SMTPTransportOptions;
  }

  test("the form's help is these sentences", () => {
    expect(fs.readFileSync(BUILDER_FILE, "utf8")).toContain(REQUIRE_TLS_HELP);
  });

  test("on, port 587: STARTTLS is required and the certificate is checked", async () => {
    const options: SMTPTransportOptions = await transportFor(587, true);

    expect(options.port).toBe(587);
    expect(options.secure).toBe(false);
    expect(options.requireTLS).toBe(true);
    // No rejectUnauthorized: false - Node checks the certificate.
    expect(options.tls).toBeUndefined();
  });

  test("off, port 587: encrypted only if the server offers it, the certificate unchecked", async () => {
    const options: SMTPTransportOptions = await transportFor(587, false);

    expect(options.secure).toBe(false);
    // Not required: nodemailer upgrades with STARTTLS when the server offers it.
    expect(options.requireTLS).toBe(false);
    expect(options.ignoreTLS).toBeUndefined();
    expect(options.tls).toEqual({ rejectUnauthorized: false });
  });

  test("never set, as on an older instance: the same as off", async () => {
    for (const secure of [null, undefined]) {
      await TransporterPool.cleanup();

      const options: SMTPTransportOptions = await transportFor(587, secure);

      expect({ secure, requireTLS: options.requireTLS }).toEqual({
        secure,
        requireTLS: false,
      });
      expect(options.tls).toEqual({ rejectUnauthorized: false });
    }
  });

  test("port 465 is always encrypted: TLS from the first byte, on or off", async () => {
    const on: SMTPTransportOptions = await transportFor(465, true);

    expect(on.secure).toBe(true);
    expect(on.requireTLS).toBe(false);
    expect(on.tls).toBeUndefined();

    await TransporterPool.cleanup();

    const off: SMTPTransportOptions = await transportFor(465, false);

    expect(off.secure).toBe(true);
    expect(off.requireTLS).toBe(false);
    // Off only stops the certificate being checked.
    expect(off.tls).toEqual({ rejectUnauthorized: false });
  });
});
