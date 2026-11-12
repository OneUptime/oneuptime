import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ONLY THE SERVER'S OWN EMAIL SIGNS IN WITH THE SERVER'S IAM ROLE (#7000).
 *
 * The server's Amazon SES settings (Admin Dashboard > Settings > Emails)
 * may sign in with the IAM role AWS gives the server itself instead of a
 * stored access key. Notification/Config's getGlobalEmailProviderServer is
 * the one place that reads that choice: it hands the sender an EmailServer
 * with the role named, no key, and no id - and the sender
 * (AmazonSesMailProvider) refuses the role to any config with an id. An
 * email handed to the Notification service's API with a mail server of its
 * own (MailService.getEmailServer, a project's Custom SMTP config) has no
 * way to name the role: it signs in with the key it carries, or not at all.
 */

let mockStoredRow: Record<string, unknown> | null = null;
let mockLastSelect: Record<string, unknown> | null = null;

jest.mock("Common/Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: async (query: {
        select?: Record<string, unknown>;
      }): Promise<unknown> => {
        mockLastSelect = query.select || null;
        return mockStoredRow ? { ...mockStoredRow } : null;
      },
    },
  };
});

jest.mock("Common/Server/Utils/CallAndSmsGatewayConfig", () => {
  return { __esModule: true, default: { getGateway: jest.fn() } };
});

import { getGlobalEmailProviderServer } from "../../FeatureSet/Notification/Config";
import MailService from "../../FeatureSet/Notification/Services/MailService";
import { EmailServerType } from "Common/Models/DatabaseModels/GlobalConfig";
import logger from "Common/Server/Utils/Logger";
import Email from "Common/Types/Email";
import AmazonSesAuthenticationType from "Common/Types/Email/AmazonSesAuthenticationType";
import EmailServer from "Common/Types/Email/EmailServer";
import MailTransportType from "Common/Types/Email/MailTransportType";

const ROLE_ROW: Record<string, unknown> = {
  emailServerType: EmailServerType.AmazonSES,
  amazonSesAuthenticationType: AmazonSesAuthenticationType.ServerIamRole,
  amazonSesRegion: " EU-WEST-1 ",
  amazonSesFromEmail: new Email("alerts@example.com"),
  amazonSesFromName: "Acme Alerts",
};

const KEY_ROW: Record<string, unknown> = {
  emailServerType: EmailServerType.AmazonSES,
  amazonSesAccessKeyId: " AKIAIOSFODNN7EXAMPLE ",
  amazonSesSecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  amazonSesRegion: "us-east-1",
  amazonSesFromEmail: new Email("alerts@example.com"),
};

const serverFor: (
  row: Record<string, unknown>,
) => Promise<EmailServer> = async (
  row: Record<string, unknown>,
): Promise<EmailServer> => {
  mockStoredRow = row;
  return getGlobalEmailProviderServer(MailTransportType.AmazonSES);
};

const refusalFor: (row: Record<string, unknown>) => Promise<unknown> = async (
  row: Record<string, unknown>,
): Promise<unknown> => {
  return serverFor(row).then(
    () => {
      throw new Error("Expected the settings to be refused.");
    },
    (error: unknown) => {
      return error;
    },
  );
};

beforeEach(() => {
  mockStoredRow = null;
  mockLastSelect = null;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the server's own Amazon SES settings, as the sender reads them", () => {
  test("its IAM role: the role named, no key, no id, the Region as AWS writes it", async () => {
    const server: EmailServer = await serverFor(ROLE_ROW);

    expect(server.transportType).toBe(MailTransportType.AmazonSES);
    expect(server.awsAuthenticationType).toBe(
      AmazonSesAuthenticationType.ServerIamRole,
    );
    expect(server.awsAccessKeyId).toBeUndefined();
    expect(server.awsSecretAccessKey).toBeUndefined();
    expect(server.awsRegion).toBe("eu-west-1");
    // No id: the sender gives the server's role to no config that has one.
    expect(server.id).toBeUndefined();
    expect(server.fromEmail.toString()).toBe("alerts@example.com");
    expect(server.fromName).toBe("Acme Alerts");

    expect(mockLastSelect).toMatchObject({
      amazonSesAuthenticationType: true,
      amazonSesRegion: true,
    });
  });

  test("its IAM role never sends a key kept from before", async () => {
    const server: EmailServer = await serverFor({
      ...ROLE_ROW,
      amazonSesAccessKeyId: "AKIAOLDKEYEXAMPLE000",
      amazonSesSecretAccessKey: "old-secret",
    });

    expect(server.awsAccessKeyId).toBeUndefined();
    expect(server.awsSecretAccessKey).toBeUndefined();
  });

  test("its IAM role still needs a real Region", async () => {
    const withoutRegion: Record<string, unknown> = { ...ROLE_ROW };
    delete withoutRegion["amazonSesRegion"];

    expect(String(await refusalFor(withoutRegion))).toContain("Region");
    expect(
      String(await refusalFor({ ...ROLE_ROW, amazonSesRegion: "moon-1" })),
    ).toContain("Region");
  });

  test("an access key: the key, trimmed, as before", async () => {
    const server: EmailServer = await serverFor(KEY_ROW);

    expect(server.awsAuthenticationType).toBe(
      AmazonSesAuthenticationType.AccessKey,
    );
    expect(server.awsAccessKeyId).toBe("AKIAIOSFODNN7EXAMPLE");
    expect(server.awsSecretAccessKey).toBe(
      "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    );
    expect(server.awsRegion).toBe("us-east-1");
  });

  test.each([
    ["never picked", undefined],
    ["picked as an access key", AmazonSesAuthenticationType.AccessKey],
    ["a choice it does not know", "Instance Profile"],
  ])(
    "%s: an access key, and without one nothing is sent",
    async (_label: string, value: unknown) => {
      const row: Record<string, unknown> = {
        ...KEY_ROW,
        amazonSesAuthenticationType: value,
      };

      expect((await serverFor(row)).awsAuthenticationType).toBe(
        AmazonSesAuthenticationType.AccessKey,
      );

      const withoutKey: Record<string, unknown> = { ...row };
      delete withoutKey["amazonSesAccessKeyId"];

      expect(String(await refusalFor(withoutKey))).toContain("Access Key ID");
    },
  );
});

describe("a mail server handed to the Notification service's API", () => {
  const BODY: Record<string, string> = {
    SMTP_ID: "11111111-2222-4333-8444-555555555555",
    SMTP_TRANSPORT_TYPE: MailTransportType.AmazonSES,
    SMTP_EMAIL: "alerts@example.com",
    SMTP_FROM_NAME: "Acme Alerts",
    SMTP_AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
    SMTP_AWS_SECRET_ACCESS_KEY: "ses-secret",
    SMTP_AWS_REGION: "us-east-1",
  };

  test("cannot name the server's IAM role, however it asks", () => {
    const server: EmailServer = MailService.getEmailServer({
      ...BODY,
      SMTP_AWS_AUTHENTICATION_TYPE: AmazonSesAuthenticationType.ServerIamRole,
      awsAuthenticationType: AmazonSesAuthenticationType.ServerIamRole,
    });

    expect(server.awsAuthenticationType).toBeUndefined();
    expect(server.awsAccessKeyId).toBe("AKIAIOSFODNN7EXAMPLE");
  });

  test("is refused without its key: no key is no role", () => {
    // It logs which key is missing; quiet here.
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    const body: Record<string, string> = {
      ...BODY,
      SMTP_AWS_AUTHENTICATION_TYPE: AmazonSesAuthenticationType.ServerIamRole,
    };
    delete body["SMTP_AWS_ACCESS_KEY_ID"];
    delete body["SMTP_AWS_SECRET_ACCESS_KEY"];
    delete body["SMTP_ID"];

    expect(() => {
      MailService.getEmailServer(body);
    }).toThrow("SMTP Config is not valid");
  });
});
