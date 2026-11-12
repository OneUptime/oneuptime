import { describe, expect, test } from "@jest/globals";
import AmazonSesAuthenticationType, {
  isAmazonSesAuthenticationType,
  toAmazonSesAuthenticationType,
} from "../../../Types/Email/AmazonSesAuthenticationType";
import { isMailgunDomain } from "../../../Types/Email/MailgunDomain";
import MailgunRegion, {
  DEFAULT_MAILGUN_REGION,
  getMailgunApiBaseUrl,
  toMailgunRegion,
} from "../../../Types/Email/MailgunRegion";
import MailTransportType, {
  API_KEY_MAIL_TRANSPORTS,
  isApiKeyMailTransport,
  isMailTransportType,
  toMailTransportType,
} from "../../../Types/Email/MailTransportType";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { generatedTexts } from "../../Helpers/GeneratedTexts";

/*
 * THE WORDS THE EMAIL PROVIDERS ARE STORED AND CHECKED IN: the transports
 * (what a config sends through, as the API and Terraform write it), how the
 * server's own Amazon SES signs in, the Mailgun region and its host, and
 * what passes as a Mailgun sending domain - which is part of the API's
 * path, so nothing else may.
 */

describe("MailTransportType", () => {
  test("the values the API, Terraform and the guides use, in order", () => {
    expect(Object.values(MailTransportType)).toEqual([
      "SMTP",
      "Microsoft Graph",
      "Amazon SES",
      "SendGrid",
      "Mailgun",
      "Postmark",
      "Resend",
    ]);
  });

  test("the providers with an HTTP API and a key of their own", () => {
    expect([...API_KEY_MAIL_TRANSPORTS]).toEqual([
      MailTransportType.AmazonSES,
      MailTransportType.SendGrid,
      MailTransportType.Mailgun,
      MailTransportType.Postmark,
      MailTransportType.Resend,
    ]);

    for (const transport of API_KEY_MAIL_TRANSPORTS) {
      expect(isApiKeyMailTransport(transport)).toBe(true);
    }

    expect(isApiKeyMailTransport(MailTransportType.SMTP)).toBe(false);
    expect(isApiKeyMailTransport(MailTransportType.MicrosoftGraph)).toBe(false);
    expect(isApiKeyMailTransport("amazon ses")).toBe(false);
    expect(isApiKeyMailTransport(undefined)).toBe(false);
  });

  test("a stored value reads as its transport; anything else - nothing included - is SMTP, as every config before the choice holds", () => {
    for (const transport of Object.values(MailTransportType)) {
      expect(isMailTransportType(transport)).toBe(true);
      expect(toMailTransportType(transport)).toBe(transport);
    }

    for (const value of [undefined, null, "", "smtp", "SES", 1, {}]) {
      expect(isMailTransportType(value)).toBe(false);
      expect(toMailTransportType(value)).toBe(MailTransportType.SMTP);
    }
  });
});

describe("AmazonSesAuthenticationType", () => {
  test("the values the API stores, an access key first", () => {
    expect(Object.values(AmazonSesAuthenticationType)).toEqual([
      "Access Key",
      "Server IAM Role",
    ]);
  });

  test("a stored value reads as itself; anything else - nothing included - is an access key, as every config before the choice signs in (#7000)", () => {
    for (const value of Object.values(AmazonSesAuthenticationType)) {
      expect(isAmazonSesAuthenticationType(value)).toBe(true);
      expect(toAmazonSesAuthenticationType(value)).toBe(value);
    }

    for (const value of [
      undefined,
      null,
      "",
      "server iam role",
      "IAM Role",
      "Instance Profile",
      1,
      {},
    ]) {
      expect(isAmazonSesAuthenticationType(value)).toBe(false);
      expect(toAmazonSesAuthenticationType(value)).toBe(
        AmazonSesAuthenticationType.AccessKey,
      );
    }
  });
});

describe("MailgunRegion", () => {
  test("US unless EU, as the mail service reads a stored value", () => {
    expect(DEFAULT_MAILGUN_REGION).toBe(MailgunRegion.US);
    expect(toMailgunRegion(MailgunRegion.EU)).toBe(MailgunRegion.EU);
    expect(toMailgunRegion(MailgunRegion.US)).toBe(MailgunRegion.US);

    for (const value of [undefined, null, "", "eu", "Europe", 1]) {
      expect(toMailgunRegion(value)).toBe(MailgunRegion.US);
    }
  });

  test("each region's API host, as Mailgun documents it", () => {
    expect(getMailgunApiBaseUrl(MailgunRegion.US)).toBe(
      "https://api.mailgun.net",
    );
    expect(getMailgunApiBaseUrl(MailgunRegion.EU)).toBe(
      "https://api.eu.mailgun.net",
    );
  });
});

describe("isMailgunDomain", () => {
  test.each([
    "mg.example.com",
    "example.com",
    "MG.Example.COM",
    " mg.example.com ",
    "mail-1.eu.example.co.uk",
    "sandbox0123456789abcdef.mailgun.org",
    "xn--bcher-kva.example",
  ])("%j is a domain", (value: string) => {
    expect(isMailgunDomain(value)).toBe(true);
  });

  test.each([
    "",
    "   ",
    "localhost",
    "example",
    "mg..example.com",
    ".example.com",
    "example.com.",
    "-mg.example.com",
    "mg-.example.com",
    "mg.example.com/../../v4",
    "mg.example.com?x=1",
    "mg.example.com#frag",
    "https://mg.example.com",
    "mg.example.com:443",
    "user@mg.example.com",
    "mg example.com",
    "127.0.0.1",
    "10.0.0.1",
    "mg_example.com",
    `${"a".repeat(64)}.example.com`,
    `${"a.".repeat(127)}com`,
  ])("%j is not", (value: string) => {
    expect(isMailgunDomain(value)).toBe(false);
  });

  test("anything but a string is not", () => {
    for (const value of [undefined, null, 1, {}, ["mg.example.com"]]) {
      expect(isMailgunDomain(value)).toBe(false);
    }
  });

  test("a 63-character label and a 253-character name are the most it takes", () => {
    expect(isMailgunDomain(`${"a".repeat(63)}.example.com`)).toBe(true);

    const longest: string = `${"a".repeat(61)}.${"b".repeat(61)}.${"c".repeat(61)}.${"d".repeat(61)}.io`;

    expect(longest.length).toBe(250);
    expect(isMailgunDomain(longest)).toBe(true);
    expect(isMailgunDomain(`${"e".repeat(3)}${longest}`)).toBe(false);
  });

  test("whatever text it is given, it passes only letters, digits, hyphens and dots, and reads megabytes at once", () => {
    const texts: Array<string> = generatedTexts(
      3000,
      5481,
      ["mg", ".", "-", "/", "..", "?", "#", "@", ":", " ", "é", "1", "com"],
      12,
    );

    for (const text of texts) {
      if (isMailgunDomain(text)) {
        expect(text.trim().toLowerCase()).toMatch(/^[a-z0-9.-]+$/);
        expect(text.includes("/")).toBe(false);
        expect(text.includes("..")).toBe(false);
      }
    }

    // Fastest of up to three attempts, each reading the whole value again.
    const read: FastestRun<boolean> = fastestRun({
      run: (): boolean => {
        return isMailgunDomain(`${"a".repeat(3_000_000)}.com`);
      },
      limitInMs: 1000,
    });

    expect(read.result).toBe(false);
    expect(read.inMs).toBeLessThan(1000);
  });
});
