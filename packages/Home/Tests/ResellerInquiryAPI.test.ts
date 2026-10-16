import {
  FOREIGN_PAGE_MESSAGE,
  MAIL_TIMEOUT_IN_MS,
  MAX_COUNTED_SENDERS,
  NOT_JSON_MESSAGE,
  NOT_SENT_MESSAGE,
  OVERALL_LIMIT,
  PER_SENDER_LIMIT,
  RATE_LIMIT_WINDOW_IN_MS,
  ResellerInquiryAnswer,
  ResellerInquiryHandlerOptions,
  SENT_MESSAGE,
  SendResellerInquiryEmail,
  TOO_MANY_FROM_SENDER_MESSAGE,
  TOO_MANY_OVERALL_MESSAGE,
  UNKNOWN_SENDER,
  createDefaultResellerInquiryOptions,
  registerResellerInquiryRoute,
} from "../API/ResellerInquiryAPI";
import FixedWindowRateLimiter from "../Utils/FixedWindowRateLimiter";
import {
  INVALID_EMAIL_MESSAGE,
  RESELLER_INQUIRY_HONEYPOT_FIELD,
  RESELLER_INQUIRY_INBOX_VARIABLE,
  RESELLER_INQUIRY_PATH,
  ResellerInquiryFieldRules,
  UNREADABLE_INQUIRY_MESSAGE,
} from "../Utils/ResellerInquiry";
import EmptyResponseData from "Common/Types/API/EmptyResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import MailService from "Common/Server/Services/MailService";
import {
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressUrlEncoded,
  createExpressApp,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import http from "http";
import { AddressInfo } from "net";

/*
 * POST /resellers/contact, ANSWERING REAL REQUESTS.
 *
 * The route is registered on a real Express app with the body parsers the
 * server runs with, and asked over HTTP: what it answers a page of this
 * site, another site's page, a body that is not JSON, a form with something
 * to fix, a form a program filled in, a sender who keeps sending, a flood
 * from many senders, and a mail service that fails. Only the sending of the
 * email is faked, and every email the route asked for is checked: one per
 * inquiry, to the inbox and to nobody else.
 *
 * MailService is replaced for the whole file: the real one would load the
 * database layer, and createDefaultResellerInquiryOptions is checked to hand
 * it each email with a timeout.
 */

jest.mock("Common/Server/Services/MailService", () => {
  return {
    __esModule: true,
    default: { sendMail: jest.fn() },
  };
});

const INSTANCE_ORIGIN: string = "https://oneuptime.com";
const INBOX: string = "partners@oneuptime.com";
const HOUR: number = 60 * 60 * 1000;

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: ResellerInquiryAnswer | null;
  text: string;
}

interface Site {
  sent: Array<EmailMessage>;
  sendMail: jest.Mock;
  advance: (milliseconds: number) => void;
  post: (options?: {
    body?: unknown;
    rawBody?: string;
    contentType?: string | null;
    origin?: string;
    fetchSite?: string;
    sender?: string;
  }) => Promise<Answer>;
  get: (path: string) => Promise<Answer>;
  close: () => Promise<void>;
}

function answers(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: "Jane Kim",
    email: "jane@acme.co.kr",
    company: "Acme Korea",
    website: "acme.co.kr",
    regions: "South Korea, Japan",
    message: "We resell DevOps tools.\nWe would like to add OneUptime.",
    [RESELLER_INQUIRY_HONEYPOT_FIELD]: "",
    ...overrides,
  };
}

function sentResponse(): HTTPResponse<EmptyResponseData> {
  return new HTTPResponse<EmptyResponseData>(200, {}, {});
}

async function startSite(
  overrides: Partial<ResellerInquiryHandlerOptions> = {},
): Promise<Site> {
  let now: number = 1_700_000_000_000;
  const sent: Array<EmailMessage> = [];
  const sendMail: jest.Mock = jest.fn(
    async (
      mail: EmailMessage,
    ): Promise<HTTPResponse<EmptyResponseData> | HTTPErrorResponse> => {
      sent.push(mail);
      return sentResponse();
    },
  );

  const clock: () => number = (): number => {
    return now;
  };

  const app: ExpressApplication = createExpressApp();

  // The body parsers every service runs with (Common/Server/Utils/StartServer).
  app.use(ExpressJson({ limit: "50mb" }));
  app.use(ExpressUrlEncoded({ limit: "50mb", extended: true }));

  registerResellerInquiryRoute(app, {
    inbox: new Email(INBOX),
    sendMail: sendMail as unknown as SendResellerInquiryEmail,
    perSender: new FixedWindowRateLimiter({
      limit: PER_SENDER_LIMIT,
      windowInMs: RATE_LIMIT_WINDOW_IN_MS,
      maxKeys: MAX_COUNTED_SENDERS,
      now: clock,
    }),
    overall: new FixedWindowRateLimiter({
      limit: OVERALL_LIMIT,
      windowInMs: RATE_LIMIT_WINDOW_IN_MS,
      maxKeys: 1,
      now: clock,
    }),
    instanceOrigin: INSTANCE_ORIGIN,
    ...overrides,
  });

  const server: http.Server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const port: number = (server.address() as AddressInfo).port;

  const request: (
    method: string,
    path: string,
    headers: Record<string, string>,
    body: string | null,
  ) => Promise<Answer> = (
    method: string,
    path: string,
    headers: Record<string, string>,
    body: string | null,
  ): Promise<Answer> => {
    return new Promise<Answer>(
      (resolve: (answer: Answer) => void, reject: (error: Error) => void) => {
        const outgoing: http.ClientRequest = http.request(
          {
            host: "127.0.0.1",
            port: port,
            method: method,
            path: path,
            headers: headers,
            agent: false,
          },
          (response: http.IncomingMessage) => {
            let text: string = "";

            response.setEncoding("utf8");
            response.on("data", (chunk: string) => {
              text += chunk;
            });
            response.on("end", () => {
              let parsed: ResellerInquiryAnswer | null = null;

              try {
                parsed = JSON.parse(text) as ResellerInquiryAnswer;
              } catch {
                parsed = null;
              }

              resolve({
                status: response.statusCode || 0,
                headers: response.headers,
                body: parsed,
                text: text,
              });
            });
          },
        );

        outgoing.on("error", reject);

        if (body !== null) {
          outgoing.write(body);
        }

        outgoing.end();
      },
    );
  };

  return {
    sent: sent,
    sendMail: sendMail,
    advance: (milliseconds: number): void => {
      now += milliseconds;
    },
    post: (
      options: {
        body?: unknown;
        rawBody?: string;
        contentType?: string | null;
        origin?: string;
        fetchSite?: string;
        sender?: string;
      } = {},
    ): Promise<Answer> => {
      const headers: Record<string, string> = {
        // One proxy in front, as in production: the client is its last entry.
        "x-forwarded-for": options.sender || "203.0.113.7",
      };

      if (options.contentType !== null) {
        headers["content-type"] = options.contentType || "application/json";
      }

      if (options.origin !== undefined) {
        headers["origin"] = options.origin;
      }

      if (options.fetchSite !== undefined) {
        headers["sec-fetch-site"] = options.fetchSite;
      }

      const body: string =
        options.rawBody !== undefined
          ? options.rawBody
          : JSON.stringify(
              options.body === undefined ? answers() : options.body,
            );

      return request("POST", RESELLER_INQUIRY_PATH, headers, body);
    },
    get: (path: string): Promise<Answer> => {
      return request("GET", path, {}, null);
    },
    close: (): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

let site: Site;
let logs: Array<string>;
let logSpies: Array<jest.SpyInstance>;

beforeEach(async () => {
  logs = [];
  logSpies = (["info", "warn", "error", "debug"] as const).map(
    (level: "info" | "warn" | "error" | "debug") => {
      return jest
        .spyOn(logger, level)
        .mockImplementation((message: unknown, _attributes?: unknown): void => {
          logs.push(
            message instanceof Error ? message.message : String(message),
          );
        });
    },
  );
  site = await startSite();
});

afterEach(async () => {
  await site.close();

  for (const spy of logSpies) {
    spy.mockRestore();
  }
});

// What a person typed, none of which may reach a log.
const PERSONAL_DETAILS: Array<string> = [
  "Jane Kim",
  "jane@acme.co.kr",
  "Acme Korea",
  "acme.co.kr",
  "South Korea",
  "DevOps",
];

function expectNoPersonalDetailsLogged(): void {
  for (const line of logs) {
    for (const detail of PERSONAL_DETAILS) {
      expect([line, line.includes(detail)]).toEqual([line, false]);
    }
  }
}

describe("an inquiry from the Resellers page", () => {
  test("is sent as one email, and the page is told so", async () => {
    const answer: Answer = await site.post({
      origin: INSTANCE_ORIGIN,
      fetchSite: "same-origin",
    });

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ sent: true, message: SENT_MESSAGE });
    expect(answer.headers["content-type"]).toContain("application/json");
    expect(answer.headers["cache-control"]).toBe("no-store");
    expect(site.sent).toHaveLength(1);
  });

  test("goes to the inbox, with every answer, as the reseller inquiry email", async () => {
    await site.post();

    const mail: EmailMessage = site.sent[0]!;

    expect(mail.toEmail.toString()).toBe(INBOX);
    expect(mail.templateType).toBe(EmailTemplateType.ResellerInquiry);
    expect(mail.subject).toBe("Reseller inquiry: Acme Korea");
    expect(mail.isSubjectLiteral).toBe(true);
    expect(mail.vars).toEqual({
      companyName: "Acme Korea",
      companyWebsite: "acme.co.kr",
      regions: "South Korea, Japan",
      contactName: "Jane Kim",
      contactEmail: "jane@acme.co.kr",
      messageHtml:
        "We resell DevOps tools.<br/>We would like to add OneUptime.",
      replyUrl: "mailto:jane@acme.co.kr?subject=Your%20reseller%20inquiry",
    });
  });

  test("goes to the inbox whatever recipient the body names", async () => {
    await site.post({
      body: answers({
        toEmail: "someone@example.com",
        to: "someone@example.com",
        cc: "someone@example.com",
        bcc: "someone@example.com",
        inbox: "someone@example.com",
        templateType: EmailTemplateType.BlankTemplate,
        subject: "Something else",
      }),
    });

    expect(site.sent).toHaveLength(1);
    expect(site.sent[0]!.toEmail.toString()).toBe(INBOX);
    expect(site.sent[0]!.templateType).toBe(EmailTemplateType.ResellerInquiry);
    expect(site.sent[0]!.subject).toBe("Reseller inquiry: Acme Korea");
    expect(JSON.stringify(site.sent[0]!.vars)).not.toContain(
      "someone@example.com",
    );
  });

  test("is sent from a client that is no browser page (no Origin, no Sec-Fetch-Site)", async () => {
    const answer: Answer = await site.post();

    expect(answer.status).toBe(200);
    expect(site.sent).toHaveLength(1);
  });

  test("is sent with a charset on its content type", async () => {
    const answer: Answer = await site.post({
      contentType: "application/json; charset=utf-8",
    });

    expect(answer.status).toBe(200);
    expect(site.sent).toHaveLength(1);
  });

  test("keeps every script a person writes in", async () => {
    await site.post({
      body: answers({
        company: "슬렉슨",
        name: "김민지",
        regions: "대한민국",
        message: "안녕하세요.\n감사합니다.",
      }),
    });

    expect(site.sent[0]!.subject).toBe("Reseller inquiry: 슬렉슨");
    expect(site.sent[0]!.vars).toMatchObject({
      companyName: "슬렉슨",
      contactName: "김민지",
      regions: "대한민국",
      messageHtml: "안녕하세요.<br/>감사합니다.",
    });
  });

  test("logs nothing a person typed", async () => {
    await site.post();
    await site.post({ body: answers({ email: "jane@localhost" }) });
    await site.post({
      body: answers({ [RESELLER_INQUIRY_HONEYPOT_FIELD]: "x" }),
    });

    expectNoPersonalDetailsLogged();
  });
});

describe("a request another site's page had a browser send", () => {
  test.each([
    ["another site's Origin", { origin: "https://evil.example" }],
    ["a look-alike host", { origin: "https://oneuptime.com.evil.example" }],
    ["plain http", { origin: "http://oneuptime.com" }],
    ["another port", { origin: "https://oneuptime.com:8443" }],
    ["an opaque Origin", { origin: "null" }],
    ["Sec-Fetch-Site cross-site", { fetchSite: "cross-site" }],
    ["Sec-Fetch-Site same-site", { fetchSite: "same-site" }],
    [
      "Sec-Fetch-Site cross-site, with this site's Origin",
      { origin: INSTANCE_ORIGIN, fetchSite: "cross-site" },
    ],
  ])(
    "with %s is refused, and sends nothing",
    async (_case: string, headers: { origin?: string; fetchSite?: string }) => {
      const answer: Answer = await site.post(headers);

      expect(answer.status).toBe(403);
      expect(answer.body).toEqual({
        sent: false,
        message: FOREIGN_PAGE_MESSAGE,
      });
      expect(answer.headers["cache-control"]).toBe("no-store");
      expect(site.sent).toHaveLength(0);
    },
  );

  test("does not use up the sender's own hourly share", async () => {
    for (let attempt: number = 0; attempt < PER_SENDER_LIMIT * 3; attempt++) {
      expect((await site.post({ origin: "https://evil.example" })).status).toBe(
        403,
      );
    }

    expect((await site.post({ origin: INSTANCE_ORIGIN })).status).toBe(200);
  });
});

describe("a body that is not JSON", () => {
  test.each([
    [
      "urlencoded, as a plain HTML form posts",
      "application/x-www-form-urlencoded",
    ],
    ["plain text", "text/plain"],
    ["multipart", "multipart/form-data; boundary=x"],
    ["JSON's look-alike", "application/jsonp"],
  ])(
    "%s is refused, and sends nothing",
    async (_case: string, contentType: string) => {
      const answer: Answer = await site.post({
        contentType: contentType,
        rawBody: "name=Jane&email=jane%40acme.co.kr&company=Acme&regions=Korea",
      });

      expect(answer.status).toBe(415);
      expect(answer.body).toEqual({ sent: false, message: NOT_JSON_MESSAGE });
      expect(site.sent).toHaveLength(0);
    },
  );

  test("without a content type is refused", async () => {
    const answer: Answer = await site.post({ contentType: null });

    expect(answer.status).toBe(415);
    expect(site.sent).toHaveLength(0);
  });

  test("that is broken JSON is refused by the parser, and sends nothing", async () => {
    const answer: Answer = await site.post({ rawBody: '{"name": "Jane",' });

    expect(answer.status).toBe(400);
    expect(site.sent).toHaveLength(0);
  });
});

describe("a form with something to fix", () => {
  test("is answered with what to fix, and the field, and sends nothing", async () => {
    const answer: Answer = await site.post({
      body: answers({ email: "jane@localhost" }),
    });

    expect(answer.status).toBe(400);
    expect(answer.body).toEqual({
      sent: false,
      message: INVALID_EMAIL_MESSAGE,
      field: "email",
    });
    expect(site.sent).toHaveLength(0);
  });

  test("names the first required field left empty", async () => {
    const answer: Answer = await site.post({
      body: answers({ company: "   " }),
    });

    expect(answer.status).toBe(400);
    expect(answer.body).toEqual({
      sent: false,
      message: ResellerInquiryFieldRules.company.missingMessage,
      field: "company",
    });
  });

  test("that is a list rather than a form names no field", async () => {
    const answer: Answer = await site.post({ body: [answers()] });

    expect(answer.status).toBe(400);
    expect(answer.body).toEqual({
      sent: false,
      message: UNREADABLE_INQUIRY_MESSAGE,
    });
    expect(site.sent).toHaveLength(0);
  });

  test("that is a bare value is refused by the strict JSON parser before the route", async () => {
    for (const body of ["text", 42, null, true]) {
      expect((await site.post({ body: body })).status).toBe(400);
    }

    expect(site.sent).toHaveLength(0);
  });
});

describe("a form a program filled in", () => {
  test("is answered as sent, and nothing is sent", async () => {
    const answer: Answer = await site.post({
      body: answers({ [RESELLER_INQUIRY_HONEYPOT_FIELD]: "Mornings" }),
    });

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ sent: true, message: SENT_MESSAGE });
    expect(site.sent).toHaveLength(0);
    expect(site.sendMail).not.toHaveBeenCalled();
  });

  test("does not use up the hourly share of everyone else", async () => {
    for (let index: number = 0; index < OVERALL_LIMIT * 2; index++) {
      await site.post({
        sender: `198.51.100.${index}`,
        body: answers({ [RESELLER_INQUIRY_HONEYPOT_FIELD]: "x" }),
      });
    }

    for (let index: number = 0; index < OVERALL_LIMIT; index++) {
      expect((await site.post({ sender: `192.0.2.${index}` })).status).toBe(
        200,
      );
    }

    expect(site.sent).toHaveLength(OVERALL_LIMIT);
  });
});

describe("a sender who keeps sending", () => {
  test(`gets ${PER_SENDER_LIMIT} requests an hour, the refused ones counted too`, async () => {
    // Two that need fixing and three that are sent: five requests.
    await site.post({ body: answers({ email: "nope" }) });
    await site.post({ body: answers({ name: "" }) });
    await site.post();
    await site.post();
    await site.post();

    const refused: Answer = await site.post();

    expect(refused.status).toBe(429);
    expect(refused.body).toEqual({
      sent: false,
      message: TOO_MANY_FROM_SENDER_MESSAGE,
    });
    expect(refused.headers["retry-after"]).toBe("3600");
    expect(refused.headers["cache-control"]).toBe("no-store");
    expect(site.sent).toHaveLength(3);
  });

  test("is told when to come back", async () => {
    for (let index: number = 0; index < PER_SENDER_LIMIT; index++) {
      await site.post();
    }

    site.advance(15 * 60 * 1000);

    expect((await site.post()).headers["retry-after"]).toBe(String(45 * 60));
  });

  test("is let in again when the hour is up", async () => {
    for (let index: number = 0; index < PER_SENDER_LIMIT + 3; index++) {
      await site.post();
    }

    site.advance(HOUR);

    expect((await site.post()).status).toBe(200);
  });

  test("does not hold up anyone else", async () => {
    for (let index: number = 0; index < PER_SENDER_LIMIT + 1; index++) {
      await site.post({ sender: "203.0.113.7" });
    }

    expect((await site.post({ sender: "203.0.113.7" })).status).toBe(429);
    expect((await site.post({ sender: "198.51.100.4" })).status).toBe(200);
    expect((await site.post({ sender: "2001:db8::1" })).status).toBe(200);
  });

  test("is told apart by the address the proxy saw, not the one the request claims", async () => {
    // A forged first entry; the proxy appended the real one last.
    for (let index: number = 0; index < PER_SENDER_LIMIT + 1; index++) {
      await site.post({ sender: `10.0.0.${index}, 203.0.113.7` });
    }

    expect((await site.post({ sender: "10.0.0.99, 203.0.113.7" })).status).toBe(
      429,
    );
  });

  test("whose address cannot be told shares one count with every such sender", async () => {
    await site.close();
    site = await startSite({
      clientIpOf: (): string | undefined => {
        return undefined;
      },
    });

    for (let index: number = 0; index < PER_SENDER_LIMIT; index++) {
      expect((await site.post({ sender: `198.51.100.${index}` })).status).toBe(
        200,
      );
    }

    expect((await site.post({ sender: "192.0.2.1" })).status).toBe(429);
    expect(UNKNOWN_SENDER).toBe("unknown");
  });
});

describe("a flood from many senders", () => {
  test(`sends at most ${OVERALL_LIMIT} emails an hour, then says to come back later`, async () => {
    for (let index: number = 0; index < OVERALL_LIMIT; index++) {
      expect((await site.post({ sender: `198.51.100.${index}` })).status).toBe(
        200,
      );
    }

    const refused: Answer = await site.post({ sender: "192.0.2.200" });

    expect(refused.status).toBe(429);
    expect(refused.body).toEqual({
      sent: false,
      message: TOO_MANY_OVERALL_MESSAGE,
    });
    expect(refused.headers["retry-after"]).toBe("3600");
    expect(site.sent).toHaveLength(OVERALL_LIMIT);
    expect(logs.join("\n")).toContain(`more than ${OVERALL_LIMIT} inquiries`);
    expectNoPersonalDetailsLogged();
  });

  test("is logged once an hour, however many requests it refuses", async () => {
    for (let index: number = 0; index < OVERALL_LIMIT + 30; index++) {
      await site.post({ sender: `198.51.100.${index}` });
    }

    const warnings: (lines: Array<string>) => number = (
      lines: Array<string>,
    ): number => {
      return lines.filter((line: string) => {
        return line.includes(`more than ${OVERALL_LIMIT} inquiries`);
      }).length;
    };

    expect(site.sent).toHaveLength(OVERALL_LIMIT);
    expect(warnings(logs)).toBe(1);

    // A new hour, a new flood: one more line.
    site.advance(HOUR);
    for (let index: number = 0; index < OVERALL_LIMIT + 5; index++) {
      await site.post({ sender: `192.0.2.${index}` });
    }

    expect(warnings(logs)).toBe(2);
  });

  test("sends again when the hour is up", async () => {
    for (let index: number = 0; index < OVERALL_LIMIT + 1; index++) {
      await site.post({ sender: `198.51.100.${index}` });
    }

    site.advance(HOUR);

    expect((await site.post({ sender: "192.0.2.201" })).status).toBe(200);
    expect(site.sent).toHaveLength(OVERALL_LIMIT + 1);
  });
});

describe("a mail service that does not send", () => {
  test("that refuses the email is answered with a try-again, and logged without the inquiry", async () => {
    site.sendMail.mockImplementation(async (): Promise<HTTPErrorResponse> => {
      return new HTTPErrorResponse(500, { message: "SMTP is down" }, {});
    });

    const answer: Answer = await site.post();

    expect(answer.status).toBe(502);
    expect(answer.body).toEqual({ sent: false, message: NOT_SENT_MESSAGE });
    expect(logs.join("\n")).toContain("status 500");
    expectNoPersonalDetailsLogged();
  });

  test("that cannot be reached is answered with a try-again", async () => {
    site.sendMail.mockImplementation(async (): Promise<never> => {
      throw new Error("connect ECONNREFUSED 10.0.0.1:3002");
    });

    const answer: Answer = await site.post();

    expect(answer.status).toBe(502);
    expect(answer.body).toEqual({ sent: false, message: NOT_SENT_MESSAGE });
    expect(logs.join("\n")).toContain("could not be sent");
    expectNoPersonalDetailsLogged();
  });
});

describe("the route", () => {
  test("answers POST only", async () => {
    const answer: Answer = await site.get(RESELLER_INQUIRY_PATH);

    expect(answer.status).toBe(404);
    expect(site.sent).toHaveLength(0);
  });

  test("is /resellers/contact", () => {
    expect(RESELLER_INQUIRY_PATH).toBe("/resellers/contact");
  });
});

describe("the production settings", () => {
  const savedInbox: string | undefined =
    process.env[RESELLER_INQUIRY_INBOX_VARIABLE];

  afterEach(() => {
    if (savedInbox === undefined) {
      delete process.env[RESELLER_INQUIRY_INBOX_VARIABLE];
    } else {
      process.env[RESELLER_INQUIRY_INBOX_VARIABLE] = savedInbox;
    }

    (MailService.sendMail as jest.Mock).mockReset();
  });

  test("are five requests per sender and twenty emails an hour", () => {
    expect(PER_SENDER_LIMIT).toBe(5);
    expect(OVERALL_LIMIT).toBe(20);
    expect(RATE_LIMIT_WINDOW_IN_MS).toBe(HOUR);
    expect(MAX_COUNTED_SENDERS).toBe(10000);
    expect(MAIL_TIMEOUT_IN_MS).toBe(15000);

    const options: ResellerInquiryHandlerOptions =
      createDefaultResellerInquiryOptions();

    for (let index: number = 0; index < PER_SENDER_LIMIT; index++) {
      expect(options.perSender.consume("a").allowed).toBe(true);
    }
    expect(options.perSender.consume("a").allowed).toBe(false);

    for (let index: number = 0; index < OVERALL_LIMIT; index++) {
      expect(options.overall.consume("all").allowed).toBe(true);
    }
    expect(options.overall.consume("all").allowed).toBe(false);
  });

  test("send to the configured inbox", () => {
    process.env[RESELLER_INQUIRY_INBOX_VARIABLE] = "resellers@example.com";

    expect(createDefaultResellerInquiryOptions().inbox.toString()).toBe(
      "resellers@example.com",
    );
    expect(logs).toEqual([]);
  });

  test("send to sales@oneuptime.com, and say why, when the configured inbox is no address", () => {
    process.env[RESELLER_INQUIRY_INBOX_VARIABLE] = "not an address";

    expect(createDefaultResellerInquiryOptions().inbox.toString()).toBe(
      "sales@oneuptime.com",
    );
    expect(logs).toEqual([
      "RESELLER_INQUIRY_EMAIL is not an email address, so reseller inquiries go to sales@oneuptime.com.",
    ]);
  });

  test("hand each email to MailService, with a timeout", async () => {
    const sent: HTTPResponse<EmptyResponseData> = sentResponse();
    (MailService.sendMail as jest.Mock).mockResolvedValue(sent);

    const mail: EmailMessage = {
      toEmail: new Email(INBOX),
      subject: "Reseller inquiry: Acme",
      vars: {},
    };

    await expect(
      createDefaultResellerInquiryOptions().sendMail(mail),
    ).resolves.toBe(sent);
    expect(MailService.sendMail).toHaveBeenCalledWith(mail, {
      timeoutInMs: MAIL_TIMEOUT_IN_MS,
    });
  });

  test("accept this site's own pages, by HOST and HTTP_PROTOCOL", () => {
    const savedHost: string | undefined = process.env["HOST"];
    const savedProtocol: string | undefined = process.env["HTTP_PROTOCOL"];

    process.env["HOST"] = "oneuptime.com";
    process.env["HTTP_PROTOCOL"] = "https";

    try {
      jest.isolateModules(() => {
        const isolated: {
          createDefaultResellerInquiryOptions: () => ResellerInquiryHandlerOptions;
        } = jest.requireActual("../API/ResellerInquiryAPI");

        expect(
          isolated.createDefaultResellerInquiryOptions().instanceOrigin,
        ).toBe("https://oneuptime.com");
      });
    } finally {
      if (savedHost === undefined) {
        delete process.env["HOST"];
      } else {
        process.env["HOST"] = savedHost;
      }

      if (savedProtocol === undefined) {
        delete process.env["HTTP_PROTOCOL"];
      } else {
        process.env["HTTP_PROTOCOL"] = savedProtocol;
      }
    }
  });

  test("tell senders apart by ClientIp's reading of the address the proxy saw", () => {
    const clientIpOf:
      | ((req: ExpressRequest) => string | undefined)
      | undefined = createDefaultResellerInquiryOptions().clientIpOf;

    // No override: the handler reads Common/Server/Utils/ClientIp.
    expect(clientIpOf).toBeUndefined();
  });
});
