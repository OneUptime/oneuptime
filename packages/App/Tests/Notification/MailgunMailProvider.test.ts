import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  MailApiAnswer,
  MailApiSendException,
} from "../../FeatureSet/Notification/Services/MailProviders/HttpMailApi";
import MailgunMailProvider from "../../FeatureSet/Notification/Services/MailProviders/MailgunMailProvider";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import MailgunRegion from "Common/Types/Email/MailgunRegion";
import MailTransportType from "Common/Types/Email/MailTransportType";
import ObjectID from "Common/Types/ObjectID";
import { EmailInlineImage } from "Common/Server/Utils/Mail/EmailInlineImages";
import {
  FakeMailgun,
  mailgunMimeOf,
  sendMailgunTo,
  startFakeMailgun,
} from "./Fixtures/FakeMailServices";
import {
  MimeEntity,
  allMimeEntities,
  contentIdOf,
  mimeEntitiesOfType,
  readMimeEntity,
} from "./Fixtures/MimeMessage";

/*
 * MAILGUN (MailgunMailProvider): messages.mime on the API host of the
 * domain's region, signed in as "api" with the key, carrying the message
 * nodemailer writes for SMTP - so its inline images are MIME parts by
 * Content-ID - and what each refusal reads as: a key Mailgun will not take,
 * a domain in the other region, a sandbox domain's recipients, throttling.
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    },
  };
});

const API_KEY: string = "mailgun-test-api-key";

const SERVER: EmailServer = {
  id: ObjectID.generate(),
  transportType: MailTransportType.Mailgun,
  username: undefined,
  password: undefined,
  fromEmail: new Email("alerts@mg.example.test"),
  fromName: "Acme Alerts",
  apiKey: API_KEY,
  mailgunDomain: "mg.example.test",
  mailgunRegion: MailgunRegion.US,
};

const LOGO: EmailInlineImage = {
  contentId: "4f1e9c2a-6b7d-4e8f-9a0b-1c2d3e4f5a6b@oneuptime",
  fileName: "oneuptime-logo.png",
  mimeType: "image/png",
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  byteLength: 70,
};

function mail(): EmailMessage {
  return {
    toEmail: new Email("oncall@example.test"),
    subject: "Incident #12 created",
    body: `<p>Checkout is down.</p><img src="cid:${LOGO.contentId}" alt="OneUptime">`,
  };
}

function answer(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): MailApiAnswer {
  return { status: status, headers: new Headers(headers), bodyText: body };
}

function explain(
  status: number,
  body: string,
  options: { region?: MailgunRegion; hadInlineImages?: boolean } = {},
  headers: Record<string, string> = {},
): MailApiSendException {
  return MailgunMailProvider.explainError(answer(status, body, headers), {
    domain: "mg.example.test",
    region: options.region || MailgunRegion.US,
    hadInlineImages: options.hadInlineImages === true,
    secrets: [API_KEY],
  });
}

describe("where it sends", () => {
  test("the domain's region's host, at messages.mime", () => {
    expect(
      MailgunMailProvider.getSendUrl("mg.example.test", MailgunRegion.US),
    ).toBe("https://api.mailgun.net/v3/mg.example.test/messages.mime");
    expect(
      MailgunMailProvider.getSendUrl("MG.Example.TEST", MailgunRegion.EU),
    ).toBe("https://api.eu.mailgun.net/v3/mg.example.test/messages.mime");
  });

  test.each([
    "mg.example.test/../../v4",
    "../domains",
    "mg.example.test?x=1",
    "mg.example.test#",
    "https://mg.example.test",
    "localhost",
    "127.0.0.1",
    "mg..example.test",
    "",
  ])("%j is refused: the domain is part of the path", (domain: string) => {
    expect(() => {
      return MailgunMailProvider.getSendUrl(domain, MailgunRegion.US);
    }).toThrow("is not a domain");
  });

  test("signed in as api, with the key", () => {
    expect(MailgunMailProvider.getAuthorization("key-1")).toBe(
      `Basic ${Buffer.from("api:key-1").toString("base64")}`,
    );
  });
});

describe("what each refusal reads as", () => {
  test("a key Mailgun will not take, answered in plain text", () => {
    const error: MailApiSendException = explain(401, "Forbidden");

    expect(error.message).toBe(
      "Mailgun did not accept the API key (HTTP 401). Check the Mailgun API Key; a sending key works only for its own domain. Mailgun said: Forbidden",
    );
    expect(error.isRetryable).toBe(false);
  });

  test("a domain the region does not have points at the other region", () => {
    expect(
      explain(404, JSON.stringify({ message: "Domain not found" })).message,
    ).toContain(
      "Mailgun has no domain mg.example.test in its US region (HTTP 404). Check the Mailgun Domain, and set the Mailgun Region to EU if the domain was made there.",
    );
    expect(
      explain(404, JSON.stringify({ message: "Domain not found" }), {
        region: MailgunRegion.EU,
      }).message,
    ).toContain("in its EU region");
    expect(
      explain(404, JSON.stringify({ message: "Domain not found" }), {
        region: MailgunRegion.EU,
      }).message,
    ).toContain("set the Mailgun Region to US");
  });

  test("a sandbox domain sends only to its authorized recipients", () => {
    expect(
      explain(
        403,
        JSON.stringify({
          message:
            "Domain mg.example.test is not allowed to send: Free accounts are for test purposes only. Please upgrade or add the address to authorized recipients in Account Settings.",
        }),
      ).message,
    ).toContain("which sends only to its authorized recipients");
  });

  test("throttling is tried again, after X-RateLimit-Reset", () => {
    const now: number = Date.now();
    const error: MailApiSendException = explain(
      429,
      JSON.stringify({ message: "Too Many Requests" }),
      {},
      { "x-ratelimit-reset": String(now + 3000) },
    );

    expect(error.isRetryable).toBe(true);
    expect(error.retryAfterSeconds).toBeGreaterThanOrEqual(2);
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(3);
  });

  test("Retry-After wins over X-RateLimit-Reset when Mailgun sends it", () => {
    expect(
      MailgunMailProvider.getRetryAfterSeconds(
        answer(429, "", {
          "retry-after": "4",
          "x-ratelimit-reset": String(Date.now() + 60000),
        }),
      ),
    ).toBe(4);
  });

  test("a reset given in seconds is read as seconds", () => {
    const now: number = 1_800_000_000_000;

    expect(
      MailgunMailProvider.getRetryAfterSeconds(
        answer(429, "", { "x-ratelimit-reset": String(now / 1000 + 10) }),
        now,
      ),
    ).toBe(10);
  });

  test("an email too large is refused for its images, when it had them", () => {
    expect(
      explain(413, "", { hadInlineImages: true }).refusedInlineImages,
    ).toBe(true);
    expect(
      explain(400, JSON.stringify({ message: "Message too large" }), {
        hadInlineImages: true,
      }).refusedInlineImages,
    ).toBe(true);
    expect(
      explain(400, JSON.stringify({ message: "to parameter is missing" }), {
        hadInlineImages: true,
      }).refusedInlineImages,
    ).toBe(false);
  });

  test("Mailgun's own failures are tried again; the key never reaches the message", () => {
    expect(explain(500, "Internal Server Error").isRetryable).toBe(true);
    expect(explain(401, `Forbidden: key ${API_KEY}`).message).not.toContain(
      API_KEY,
    );
  });
});

describe("sending, to a stand-in for Mailgun", () => {
  let mailgun: FakeMailgun;
  let eu: FakeMailgun;

  beforeAll(async () => {
    mailgun = await startFakeMailgun({
      apiKey: API_KEY,
      domains: ["mg.example.test"],
    });
    eu = await startFakeMailgun({
      apiKey: API_KEY,
      domains: ["mg.eu.example.test"],
    });
  });

  afterAll(async () => {
    await mailgun.close();
    await eu.close();
  });

  beforeEach(() => {
    mailgun.requests.length = 0;
    eu.requests.length = 0;
    sendMailgunTo(mailgun, "api.mailgun.net");
    sendMailgunTo(eu, "api.eu.mailgun.net");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the MIME message carries the text, the HTML and the image by its Content-ID", async () => {
    await new MailgunMailProvider().send(mail(), SERVER, {
      inlineImages: [LOGO],
    });

    expect(mailgun.requests).toHaveLength(1);
    expect(mailgun.requests[0]!.form?.get("to")).toBe("oncall@example.test");

    const message: MimeEntity = readMimeEntity(
      mailgunMimeOf(mailgun.requests[0]!),
    );
    const images: Array<MimeEntity> = allMimeEntities(message).filter(
      (part: MimeEntity): boolean => {
        return part.type.startsWith("image/");
      },
    );

    expect(message.headers.get("subject")).toBe("Incident #12 created");
    expect(mimeEntitiesOfType(message, "text/plain")).toHaveLength(1);
    expect(mimeEntitiesOfType(message, "text/html")).toHaveLength(1);
    expect(images).toHaveLength(1);
    expect(contentIdOf(images[0]!)).toBe(LOGO.contentId);
    expect(images[0]!.body.toString("base64")).toBe(LOGO.base64);
  });

  test("an EU domain goes to the EU host", async () => {
    await new MailgunMailProvider().send(
      mail(),
      {
        ...SERVER,
        mailgunDomain: "mg.eu.example.test",
        mailgunRegion: MailgunRegion.EU,
      },
      {},
    );

    expect(eu.requests).toHaveLength(1);
    expect(mailgun.requests).toHaveLength(0);
    expect(eu.requests[0]!.path).toBe("/v3/mg.eu.example.test/messages.mime");
  });

  test("throttled, it is tried again with a fresh form, and goes", async () => {
    mailgun.answerNextWith({
      status: 429,
      body: { message: "Too Many Requests" },
      headers: { "Retry-After": "0" },
    });

    await new MailgunMailProvider().send(mail(), SERVER, {
      inlineImages: [LOGO],
    });

    expect(mailgun.requests).toHaveLength(2);
    expect(mailgunMimeOf(mailgun.requests[1]!)).toContain(LOGO.contentId);
  });

  test("a key Mailgun does not take is reported at once", async () => {
    await expect(
      new MailgunMailProvider().send(
        mail(),
        { ...SERVER, apiKey: "key-wrong" },
        {},
      ),
    ).rejects.toThrow("Mailgun did not accept the API key (HTTP 401).");
    expect(mailgun.requests).toHaveLength(1);
  });

  test("a config without its key or domain is refused before anything is sent", async () => {
    await expect(
      new MailgunMailProvider().send(
        mail(),
        { ...SERVER, mailgunDomain: undefined },
        {},
      ),
    ).rejects.toThrow("Mailgun needs an API Key and a sending Domain.");
    expect(mailgun.requests).toHaveLength(0);
  });
});
