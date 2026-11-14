import { jest } from "@jest/globals";
import { MailService as SendGridMailService } from "@sendgrid/mail";
import AwsSecurityHubClient, {
  AwsSigV4SignResult,
} from "Common/Server/Utils/SecurityEvent/Connectors/AwsSecurityHub/AwsSecurityHubClient";
import http from "http";
import net from "net";

/*
 * STAND-INS FOR THE MAIL SERVICES ONEUPTIME SENDS THROUGH.
 *
 * Each listens on a local port, records what it was sent, and checks a
 * request the way its service checks it - the rules that decide whether an
 * email with inline images goes - answering as the service answers:
 *
 *   - startFakeSendGrid: SendGrid's v3 Mail Send (POST /v3/mail/send). An
 *     inline attachment without `content_id` is refused with SendGrid's own
 *     400 (issue #5308), and so is a content value with no characters.
 *   - startFakeMicrosoftGraph: Graph's sendMail (POST
 *     /v1.0/users/{sender}/sendMail). A fileAttachment with a property Graph
 *     does not define is refused, as OData refuses one.
 *   - startFakeSmtpServer: just enough SMTP for nodemailer, AUTH included,
 *     keeping each message as it was written.
 *   - startFakeAmazonSes: SES's v2 SendEmail (POST
 *     /v2/email/outbound-emails), its Signature Version 4 checked against
 *     the access key it was started with, as SES checks it: a request
 *     signed for another body, host, Region or service is refused with
 *     SES's own 403.
 *   - startFakeMailgun: Mailgun's messages.mime (POST
 *     /v3/{domain}/messages.mime), a multipart form of `to` and the MIME
 *     `message`, signed in as "api" with the key.
 *   - startFakePostmark: Postmark's Email API (POST /email), its
 *     X-Postmark-Server-Token and ErrorCode answers.
 *   - startFakeResend: Resend's Emails API (POST /emails), its bearer key and
 *     the User-Agent it asks for.
 *
 * sendSendGridTo, sendMicrosoftGraphTo, sendAmazonSesTo, sendMailgunTo,
 * sendPostmarkTo and sendResendTo point the real clients at them, so what a
 * test reads is what the client put on the wire. Each test that uses them
 * restores its spies (jest.restoreAllMocks) and closes its servers.
 */

export interface RecordedHttpRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
  // The body as JSON, or undefined when it is not JSON.
  json: unknown;
  // A multipart form's fields, when the stand-in read one (Mailgun's).
  form?: Map<string, RecordedFormValue> | undefined;
}

// One field of a multipart form: its text, or the file it carries.
export type RecordedFormValue =
  | string
  | { fileName: string; type: string; content: string };

export interface FakeHttpAnswer {
  status: number;
  body?: unknown;
  // The body as text, as it is written (a 401's "Forbidden"), instead of JSON.
  rawBody?: string | undefined;
  headers?: Record<string, string> | undefined;
}

export interface FakeHttpService {
  // "http://127.0.0.1:<port>", no trailing slash.
  url: string;
  requests: Array<RecordedHttpRequest>;
  // The answer to the next request, whatever it holds, instead of the check.
  answerNextWith: (answer: FakeHttpAnswer) => void;
  close: () => Promise<void>;
}

type CheckRequest = (
  request: RecordedHttpRequest,
) => FakeHttpAnswer | Promise<FakeHttpAnswer>;

const startFakeHttpService: (
  check: CheckRequest,
) => Promise<FakeHttpService> = async (
  check: CheckRequest,
): Promise<FakeHttpService> => {
  const requests: Array<RecordedHttpRequest> = [];
  const forcedAnswers: Array<FakeHttpAnswer> = [];

  const server: http.Server = http.createServer(
    (request: http.IncomingMessage, response: http.ServerResponse) => {
      const chunks: Array<Buffer> = [];

      request.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      request.on("end", () => {
        const body: string = Buffer.concat(chunks).toString("utf8");
        let json: unknown = undefined;

        try {
          json = JSON.parse(body);
        } catch {
          json = undefined;
        }

        const recorded: RecordedHttpRequest = {
          method: request.method || "",
          path: request.url || "",
          headers: request.headers,
          body: body,
          json: json,
        };

        requests.push(recorded);

        const forced: FakeHttpAnswer | undefined = forcedAnswers.shift();

        Promise.resolve(forced || check(recorded)).then(
          (answer: FakeHttpAnswer) => {
            if (answer.rawBody !== undefined) {
              response.writeHead(answer.status, {
                "Content-Type": "text/plain",
                ...(answer.headers || {}),
              });
              response.end(answer.rawBody);
              return;
            }

            if (answer.body === undefined) {
              response.writeHead(answer.status, answer.headers || {});
              response.end();
              return;
            }

            response.writeHead(answer.status, {
              "Content-Type": "application/json",
              ...(answer.headers || {}),
            });
            response.end(JSON.stringify(answer.body));
          },
          () => {
            response.writeHead(500);
            response.end();
          },
        );
      });
    },
  );

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`,
    requests: requests,
    answerNextWith: (answer: FakeHttpAnswer): void => {
      forcedAnswers.push(answer);
    },
    close: async (): Promise<void> => {
      server.closeAllConnections();
      await new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
};

// Base64 as SendGrid and Graph read it: the alphabet, padded to fours.
const BASE64_PATTERN: RegExp = /^[A-Za-z0-9+/]*={0,2}$/;

export const isBase64: (value: unknown) => boolean = (
  value: unknown,
): boolean => {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length % 4 === 0 &&
    BASE64_PATTERN.test(value)
  );
};

const asRecord: (value: unknown) => Record<string, unknown> | null = (
  value: unknown,
): Record<string, unknown> | null => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
};

/*
 * SENDGRID
 */

export interface SendGridApiErrorJson {
  message: string;
  field: string | null;
  help: string | null;
}

// SendGrid's answer to a request without a usable API key.
export const SENDGRID_UNAUTHORIZED_ANSWER: FakeHttpAnswer = {
  status: 401,
  body: {
    errors: [
      {
        message:
          "The provided authorization grant is invalid, expired, or revoked",
        field: null,
        help: null,
      },
    ],
  },
};

// SendGrid's answer to an inline attachment without a content_id (issue #5308).
export const sendGridContentIdRequired: (
  index: number,
) => SendGridApiErrorJson = (index: number): SendGridApiErrorJson => {
  return {
    message: "The content_id parameter is required if disposition = 'inline'.",
    field: `attachments.${index}.content_id`,
    help: "http://sendgrid.com/docs/API_Reference/Web_API_v3/Mail/errors.html#message.attachments.content_id",
  };
};

const sendGridError: (
  message: string,
  field: string,
) => SendGridApiErrorJson = (
  message: string,
  field: string,
): SendGridApiErrorJson => {
  return { message: message, field: field, help: null };
};

// What SendGrid's v3 Mail Send would refuse in `body`: none when it takes it.
export const checkSendGridMailSend: (
  body: unknown,
) => Array<SendGridApiErrorJson> = (
  body: unknown,
): Array<SendGridApiErrorJson> => {
  const errors: Array<SendGridApiErrorJson> = [];
  const mail: Record<string, unknown> | null = asRecord(body);

  if (!mail) {
    return [
      sendGridError(
        "Bad Request: the request body must be a JSON object.",
        "body",
      ),
    ];
  }

  const personalizations: unknown = mail["personalizations"];
  const firstPersonalization: Record<string, unknown> | null = Array.isArray(
    personalizations,
  )
    ? asRecord(personalizations[0])
    : null;
  const to: unknown = firstPersonalization?.["to"];
  const firstTo: Record<string, unknown> | null = Array.isArray(to)
    ? asRecord(to[0])
    : null;

  if (!firstTo || typeof firstTo["email"] !== "string") {
    errors.push(
      sendGridError(
        "The to array is required for all personalization objects, and must have at least one email object with a valid email address.",
        "personalizations.0.to",
      ),
    );
  }

  if (typeof asRecord(mail["from"])?.["email"] !== "string") {
    errors.push(
      sendGridError(
        "The from object must be provided for every email send. It is an object that requires the email parameter, but may also contain a name parameter.",
        "from",
      ),
    );
  }

  if (typeof mail["subject"] !== "string" || !mail["subject"]) {
    errors.push(
      sendGridError(
        "The subject is required. You can get around this requirement if you use a template with a subject defined or if every personalization has a subject defined.",
        "subject",
      ),
    );
  }

  const content: unknown = mail["content"];

  if (!Array.isArray(content) || content.length === 0) {
    errors.push(
      sendGridError(
        "Unless a valid template_id is provided, the content parameter is required. There must be at least one defined content block. We typically suggest both text/plain and text/html blocks are included, but only one block is required.",
        "content",
      ),
    );
  } else {
    content.forEach((block: unknown, index: number) => {
      const value: unknown = asRecord(block)?.["value"];

      if (typeof value !== "string" || value.length === 0) {
        errors.push(
          sendGridError(
            "The content value must be a string at least one character in length.",
            `content.${index}.value`,
          ),
        );
      }
    });

    const types: Array<unknown> = content.map((block: unknown): unknown => {
      return asRecord(block)?.["type"];
    });

    if (types.indexOf("text/plain") > 0) {
      errors.push(
        sendGridError(
          "If present, text/plain must be first, followed by text/html, followed by any other content.",
          "content",
        ),
      );
    }
  }

  const attachments: unknown = mail["attachments"];

  if (attachments !== undefined) {
    if (!Array.isArray(attachments)) {
      errors.push(
        sendGridError(
          "The attachments parameter must be an array.",
          "attachments",
        ),
      );
    } else {
      attachments.forEach((item: unknown, index: number) => {
        const attachment: Record<string, unknown> = asRecord(item) || {};

        if (!isBase64(attachment["content"])) {
          errors.push(
            sendGridError(
              "The attachment content must be base64 encoded.",
              `attachments.${index}.content`,
            ),
          );
        }

        if (
          typeof attachment["filename"] !== "string" ||
          !attachment["filename"]
        ) {
          errors.push(
            sendGridError(
              "The attachment filename parameter is required.",
              `attachments.${index}.filename`,
            ),
          );
        }

        const disposition: unknown = attachment["disposition"];

        if (
          disposition !== undefined &&
          disposition !== "inline" &&
          disposition !== "attachment"
        ) {
          errors.push(
            sendGridError(
              "The disposition of your attachment can be either 'inline' or 'attachment'.",
              `attachments.${index}.disposition`,
            ),
          );
        }

        if (
          disposition === "inline" &&
          (typeof attachment["content_id"] !== "string" ||
            !attachment["content_id"])
        ) {
          errors.push(sendGridContentIdRequired(index));
        }
      });
    }
  }

  return errors;
};

export type FakeSendGrid = FakeHttpService;

export const startFakeSendGrid: () => Promise<FakeSendGrid> =
  async (): Promise<FakeSendGrid> => {
    return await startFakeHttpService(
      (request: RecordedHttpRequest): FakeHttpAnswer => {
        if (request.method !== "POST" || request.path !== "/v3/mail/send") {
          return {
            status: 404,
            body: {
              errors: [{ message: "Not found", field: null, help: null }],
            },
          };
        }

        const authorization: string = String(
          request.headers.authorization || "",
        );

        if (!authorization.startsWith("Bearer SG.")) {
          return SENDGRID_UNAUTHORIZED_ANSWER;
        }

        const errors: Array<SendGridApiErrorJson> = checkSendGridMailSend(
          request.json,
        );

        return errors.length > 0
          ? { status: 400, body: { errors: errors } }
          : { status: 202 };
      },
    );
  };

// What the client keeps on @sendgrid/mail's MailService, where tests reach it.
interface SendGridMailInternals {
  client: {
    setDefaultRequest: (key: string, value: unknown) => void;
  };
}

/*
 * The real @sendgrid/mail, talking to `fake`. MailService sets the API key
 * on every send, which points the client back at api.sendgrid.com, so its
 * base address is set again right after: everything else - the Mail object,
 * its JSON, axios, the request - is the client's own. Set on MailService's
 * prototype, so the shared client the server's own settings send with and
 * the client of its own every project config's send makes
 * (SendGridMailProvider.sendWithOwnClient) both go to the fake.
 */
export const sendSendGridTo: (fake: FakeSendGrid) => void = (
  fake: FakeSendGrid,
): void => {
  const realSetApiKey: (apiKey: string) => void =
    SendGridMailService.prototype.setApiKey;

  jest
    .spyOn(SendGridMailService.prototype, "setApiKey")
    .mockImplementation(function (
      this: SendGridMailService,
      apiKey: string,
    ): void {
      realSetApiKey.call(this, apiKey);

      const client: SendGridMailInternals["client"] = (
        this as unknown as SendGridMailInternals
      ).client;

      client.setDefaultRequest("baseUrl", `${fake.url}/`);
      // Never through a proxy a machine might set: the request stays local.
      client.setDefaultRequest("proxy", false);
    });
};

// The JSON body of a Mail Send the fake received.
export interface SendGridMailSendJson {
  personalizations: Array<{ to: Array<{ email: string; name?: string }> }>;
  from: { email: string; name?: string };
  subject: string;
  content: Array<{ type: string; value: string }>;
  attachments?: Array<Record<string, unknown>>;
}

/*
 * MICROSOFT GRAPH
 */

// The properties a microsoft.graph.fileAttachment defines.
const GRAPH_FILE_ATTACHMENT_PROPERTIES: ReadonlyArray<string> = [
  "@odata.type",
  "id",
  "name",
  "contentType",
  "size",
  "isInline",
  "lastModifiedDateTime",
  "contentBytes",
  "contentId",
  "contentLocation",
];

const graphError: (code: string, message: string) => FakeHttpAnswer = (
  code: string,
  message: string,
): FakeHttpAnswer => {
  return { status: 400, body: { error: { code: code, message: message } } };
};

// What Graph's sendMail would refuse in `body`, as Graph answers; null when it takes it.
export const checkGraphSendMail: (body: unknown) => FakeHttpAnswer | null = (
  body: unknown,
): FakeHttpAnswer | null => {
  const message: Record<string, unknown> | null = asRecord(
    asRecord(body)?.["message"],
  );

  if (!message) {
    return graphError(
      "ErrorInvalidRequest",
      "Empty Payload. JSON content expected.",
    );
  }

  const messageBody: Record<string, unknown> | null = asRecord(message["body"]);

  if (
    !messageBody ||
    typeof messageBody["content"] !== "string" ||
    (messageBody["contentType"] !== "HTML" &&
      messageBody["contentType"] !== "Text")
  ) {
    return graphError(
      "ErrorInvalidRequest",
      "The message body is missing or is not valid.",
    );
  }

  const recipients: unknown = message["toRecipients"];

  if (
    !Array.isArray(recipients) ||
    recipients.length === 0 ||
    typeof asRecord(asRecord(recipients[0])?.["emailAddress"])?.["address"] !==
      "string"
  ) {
    return graphError(
      "ErrorInvalidRecipients",
      "At least one recipient isn't valid.",
    );
  }

  const attachments: unknown = message["attachments"];

  if (attachments === undefined) {
    return null;
  }

  if (!Array.isArray(attachments)) {
    return graphError(
      "RequestBodyRead",
      "An unexpected 'StartObject' node was found when reading from the JSON reader. A 'StartArray' node was expected.",
    );
  }

  for (const item of attachments) {
    const attachment: Record<string, unknown> = asRecord(item) || {};

    if (attachment["@odata.type"] !== "#microsoft.graph.fileAttachment") {
      return graphError("RequestBodyRead", "Cannot create an abstract class.");
    }

    for (const property of Object.keys(attachment)) {
      if (!GRAPH_FILE_ATTACHMENT_PROPERTIES.includes(property)) {
        return graphError(
          "RequestBodyRead",
          `The property '${property}' does not exist on type 'microsoft.graph.fileAttachment'. Make sure to only use property names that are defined by the type or mark the type as open type.`,
        );
      }
    }

    if (typeof attachment["name"] !== "string" || !attachment["name"]) {
      return graphError(
        "ErrorRequiredPropertyMissing",
        "Required property is missing: the attachment's name.",
      );
    }

    if (!isBase64(attachment["contentBytes"])) {
      return graphError(
        "RequestBodyRead",
        "Invalid value for the attachment's contentBytes: it is not base64.",
      );
    }

    if (
      attachment["isInline"] !== undefined &&
      typeof attachment["isInline"] !== "boolean"
    ) {
      return graphError(
        "RequestBodyRead",
        "Cannot convert the literal to the expected type 'Edm.Boolean' for the attachment's isInline.",
      );
    }
  }

  return null;
};

export type FakeMicrosoftGraph = FakeHttpService;

export const startFakeMicrosoftGraph: () => Promise<FakeMicrosoftGraph> =
  async (): Promise<FakeMicrosoftGraph> => {
    return await startFakeHttpService(
      (request: RecordedHttpRequest): FakeHttpAnswer => {
        const sendMailPath: boolean =
          request.method === "POST" &&
          request.path.startsWith("/v1.0/users/") &&
          request.path.endsWith("/sendMail");

        if (!sendMailPath) {
          return {
            status: 404,
            body: {
              error: {
                code: "ResourceNotFound",
                message: "Resource not found.",
              },
            },
          };
        }

        if (
          !String(request.headers.authorization || "").startsWith("Bearer ")
        ) {
          return {
            status: 401,
            body: {
              error: {
                code: "InvalidAuthenticationToken",
                message: "Access token is empty.",
              },
            },
          };
        }

        return checkGraphSendMail(request.json) || { status: 202 };
      },
    );
  };

const GRAPH_ORIGIN: string = "https://graph.microsoft.com";

/*
 * Where each service's real address is sent instead: its stand-in. One
 * spy on fetch serves every route, so a test can send through Graph,
 * Amazon SES, Mailgun, Postmark and Resend at once; a route stays until the
 * test file ends, and the spy is put back after jest.restoreAllMocks.
 */
const FETCH_ROUTES: Map<string, string> = new Map<string, string>();

const routeFetchTo: (origin: string, fakeUrl: string) => void = (
  origin: string,
  fakeUrl: string,
): void => {
  FETCH_ROUTES.set(origin, fakeUrl);

  if (jest.isMockFunction(globalThis.fetch)) {
    return;
  }

  const realFetch: typeof fetch = globalThis.fetch.bind(globalThis);

  jest
    .spyOn(globalThis, "fetch")
    .mockImplementation(
      (
        input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        const address: string =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const parsed: URL = new URL(address);
        const fake: string | undefined = FETCH_ROUTES.get(parsed.origin);

        if (!fake) {
          return realFetch(input, init);
        }

        return realFetch(`${fake}${parsed.pathname}${parsed.search}`, init);
      },
    );
};

/*
 * The real MicrosoftGraphMailProvider, talking to `fake`: its fetch to
 * graph.microsoft.com goes to the same path on the fake, through the real
 * fetch, with the same method, headers and body. Anything else is fetched
 * as asked.
 */
export const sendMicrosoftGraphTo: (fake: FakeMicrosoftGraph) => void = (
  fake: FakeMicrosoftGraph,
): void => {
  routeFetchTo(GRAPH_ORIGIN, fake.url);
};

// The JSON body of a sendMail the fake received.
export interface GraphSendMailJson {
  message: {
    subject: string;
    body: { contentType: string; content: string };
    toRecipients: Array<{ emailAddress: { address: string } }>;
    from: { emailAddress: { address: string; name?: string } };
    attachments?: Array<Record<string, unknown>>;
  };
  saveToSentItems: boolean;
}

/*
 * AMAZON SES (API v2 SendEmail)
 */

export interface FakeAmazonSesCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /*
   * Temporary credentials' session token (an IAM role's, #7000): SES then
   * takes the request only with this x-amz-security-token, signed.
   */
  sessionToken?: string | undefined;
}

// Another set of keys SES knows, such as a role's next credentials.
export interface FakeAmazonSesKeys {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
}

export interface FakeAmazonSes extends FakeHttpService {
  credentials: FakeAmazonSesCredentials;
  // The host the stand-in answers for: email.{region}.amazonaws.com.
  host: string;
  // SES knows these keys too, from now on.
  acceptKeys: (keys: FakeAmazonSesKeys) => void;
  // These keys' session has ended: SES says their token expired.
  expireKeys: (accessKeyId: string) => void;
}

// SES's answer to an error: its name in X-Amzn-ErrorType and a message.
export const amazonSesError: (
  status: number,
  code: string,
  message: string,
) => FakeHttpAnswer = (
  status: number,
  code: string,
  message: string,
): FakeHttpAnswer => {
  return {
    status: status,
    headers: {
      "x-amzn-ErrorType": `${code}:http://internal.amazon.com/coral/com.amazonaws.sesv2/`,
    },
    body: { message: message },
  };
};

const SES_DISPOSITIONS: ReadonlyArray<string> = ["ATTACHMENT", "INLINE"];

const SES_TRANSFER_ENCODINGS: ReadonlyArray<string> = [
  "BASE64",
  "QUOTED_PRINTABLE",
  "SEVEN_BIT",
];

// What SES's SendEmail would refuse in `body`, as SES answers; null when it takes it.
export const checkAmazonSesSendEmail: (
  body: unknown,
) => FakeHttpAnswer | null = (body: unknown): FakeHttpAnswer | null => {
  const request: Record<string, unknown> | null = asRecord(body);

  if (!request) {
    return amazonSesError(
      400,
      "BadRequestException",
      "Request body is not JSON.",
    );
  }

  if (
    typeof request["FromEmailAddress"] !== "string" ||
    !request["FromEmailAddress"]
  ) {
    return amazonSesError(
      400,
      "BadRequestException",
      "FromEmailAddress is required.",
    );
  }

  const to: unknown = asRecord(request["Destination"])?.["ToAddresses"];

  if (!Array.isArray(to) || to.length === 0) {
    return amazonSesError(
      400,
      "BadRequestException",
      "Destination must have at least one address.",
    );
  }

  const simple: Record<string, unknown> | null = asRecord(
    asRecord(request["Content"])?.["Simple"],
  );

  if (!simple) {
    return amazonSesError(
      400,
      "BadRequestException",
      "Content must be Simple, Raw or Template.",
    );
  }

  if (typeof asRecord(simple["Subject"])?.["Data"] !== "string") {
    return amazonSesError(
      400,
      "BadRequestException",
      "Subject.Data is required.",
    );
  }

  const messageBody: Record<string, unknown> | null = asRecord(simple["Body"]);

  if (
    typeof asRecord(messageBody?.["Html"])?.["Data"] !== "string" &&
    typeof asRecord(messageBody?.["Text"])?.["Data"] !== "string"
  ) {
    return amazonSesError(
      400,
      "BadRequestException",
      "Body must have Html or Text.",
    );
  }

  const attachments: unknown = simple["Attachments"];

  if (attachments === undefined) {
    return null;
  }

  if (!Array.isArray(attachments)) {
    return amazonSesError(
      400,
      "BadRequestException",
      "Attachments must be a list.",
    );
  }

  for (const item of attachments) {
    const attachment: Record<string, unknown> = asRecord(item) || {};
    const fileName: unknown = attachment["FileName"];

    if (typeof fileName !== "string" || !fileName || fileName.length > 255) {
      return amazonSesError(
        400,
        "BadRequestException",
        "Attachment FileName is required.",
      );
    }

    if (!isBase64(attachment["RawContent"])) {
      return amazonSesError(
        400,
        "BadRequestException",
        "Attachment RawContent must be base64.",
      );
    }

    const disposition: unknown = attachment["ContentDisposition"];

    if (
      disposition !== undefined &&
      !SES_DISPOSITIONS.includes(String(disposition))
    ) {
      return amazonSesError(
        400,
        "BadRequestException",
        "ContentDisposition must be ATTACHMENT or INLINE.",
      );
    }

    const encoding: unknown = attachment["ContentTransferEncoding"];

    if (
      encoding !== undefined &&
      !SES_TRANSFER_ENCODINGS.includes(String(encoding))
    ) {
      return amazonSesError(
        400,
        "BadRequestException",
        "ContentTransferEncoding is not valid.",
      );
    }

    const contentId: unknown = attachment["ContentId"];

    if (
      contentId !== undefined &&
      (typeof contentId !== "string" ||
        contentId.length < 1 ||
        contentId.length > 78)
    ) {
      return amazonSesError(
        400,
        "BadRequestException",
        "ContentId must be 1 to 78 characters.",
      );
    }
  }

  return null;
};

const parseAmzDate: (value: string) => Date | null = (
  value: string,
): Date | null => {
  // YYYYMMDDTHHMMSSZ
  if (value.length !== 16) {
    return null;
  }

  const iso: string = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
  const date: Date = new Date(iso);

  return Number.isFinite(date.getTime()) ? date : null;
};

export const startFakeAmazonSes: (
  credentials: FakeAmazonSesCredentials,
) => Promise<FakeAmazonSes> = async (
  credentials: FakeAmazonSesCredentials,
): Promise<FakeAmazonSes> => {
  const host: string = `email.${credentials.region}.amazonaws.com`;
  const otherKeys: Array<FakeAmazonSesKeys> = [];
  const expiredAccessKeyIds: Set<string> = new Set();

  const service: FakeHttpService = await startFakeHttpService(
    (request: RecordedHttpRequest): FakeHttpAnswer => {
      if (
        request.method !== "POST" ||
        request.path !== "/v2/email/outbound-emails"
      ) {
        return amazonSesError(404, "NotFoundException", "Resource not found.");
      }

      const authorization: string = String(request.headers.authorization || "");
      const amzDate: string = String(request.headers["x-amz-date"] || "");
      const date: Date | null = parseAmzDate(amzDate);

      if (!authorization.startsWith("AWS4-HMAC-SHA256 ") || !date) {
        return amazonSesError(
          403,
          "MissingAuthenticationTokenException",
          "Missing Authentication Token",
        );
      }

      // The keys the request says it is signed with, if SES knows them.
      const keys: FakeAmazonSesKeys | undefined = [
        credentials,
        ...otherKeys,
      ].find((candidate: FakeAmazonSesKeys): boolean => {
        return authorization.includes(`Credential=${candidate.accessKeyId}/`);
      });
      const sentToken: string = String(
        request.headers["x-amz-security-token"] || "",
      );

      if (!keys || sentToken !== (keys.sessionToken || "")) {
        return amazonSesError(
          403,
          "UnrecognizedClientException",
          "The security token included in the request is invalid.",
        );
      }

      if (expiredAccessKeyIds.has(keys.accessKeyId)) {
        return amazonSesError(
          403,
          "ExpiredTokenException",
          "The security token included in the request is expired",
        );
      }

      // The signature SES computes for this request, with the secret it holds.
      const expected: AwsSigV4SignResult = AwsSecurityHubClient.signRequest({
        method: "POST",
        host: host,
        path: request.path,
        headers: {
          "Content-Type": String(request.headers["content-type"] || ""),
        },
        body: request.body,
        accessKeyId: keys.accessKeyId,
        secretAccessKey: keys.secretAccessKey,
        sessionToken: keys.sessionToken || undefined,
        region: credentials.region,
        service: "ses",
        date: date,
      });

      if (expected.headers["Authorization"] !== authorization) {
        return amazonSesError(
          403,
          "SignatureDoesNotMatch",
          "The request signature we calculated does not match the signature you provided. Check your AWS Secret Access Key and signing method.",
        );
      }

      return (
        checkAmazonSesSendEmail(request.json) || {
          status: 200,
          body: { MessageId: `0100018f-${Date.now()}-fake` },
        }
      );
    },
  );

  return {
    ...service,
    credentials: credentials,
    host: host,
    acceptKeys: (keys: FakeAmazonSesKeys): void => {
      otherKeys.push(keys);
    },
    expireKeys: (accessKeyId: string): void => {
      expiredAccessKeyIds.add(accessKeyId);
    },
  };
};

// The real AmazonSesMailProvider, talking to `fake` for its Region.
export const sendAmazonSesTo: (fake: FakeAmazonSes) => void = (
  fake: FakeAmazonSes,
): void => {
  routeFetchTo(`https://${fake.host}`, fake.url);
};

// The JSON body of a SendEmail the fake received.
export interface AmazonSesSendEmailJson {
  FromEmailAddress: string;
  Destination: { ToAddresses: Array<string> };
  Content: {
    Simple: {
      Subject: { Data: string; Charset?: string };
      Body: {
        Html?: { Data: string; Charset?: string };
        Text?: { Data: string; Charset?: string };
      };
      Attachments?: Array<Record<string, unknown>>;
    };
  };
}

/*
 * MAILGUN (messages.mime)
 */

export interface FakeMailgunOptions {
  apiKey: string;
  // The domains the account has in this region.
  domains: Array<string>;
}

export type FakeMailgun = FakeHttpService;

const readMultipartForm: (
  request: RecordedHttpRequest,
) => Promise<Map<string, RecordedFormValue>> = async (
  request: RecordedHttpRequest,
): Promise<Map<string, RecordedFormValue>> => {
  const form: FormData = await new Request("http://fake.invalid/", {
    method: "POST",
    headers: { "content-type": String(request.headers["content-type"] || "") },
    body: request.body,
  }).formData();

  const fields: Map<string, RecordedFormValue> = new Map<
    string,
    RecordedFormValue
  >();

  for (const [name, value] of form.entries()) {
    if (typeof value === "string") {
      fields.set(name, value);
    } else {
      fields.set(name, {
        fileName: (value as File).name,
        type: (value as File).type,
        content: await (value as File).text(),
      });
    }
  }

  return fields;
};

export const startFakeMailgun: (
  options: FakeMailgunOptions,
) => Promise<FakeMailgun> = async (
  options: FakeMailgunOptions,
): Promise<FakeMailgun> => {
  return await startFakeHttpService(
    async (request: RecordedHttpRequest): Promise<FakeHttpAnswer> => {
      const prefix: string = "/v3/";
      const suffix: string = "/messages.mime";

      if (
        request.method !== "POST" ||
        !request.path.startsWith(prefix) ||
        !request.path.endsWith(suffix)
      ) {
        return { status: 404, body: { message: "Not Found" } };
      }

      const expected: string = `Basic ${Buffer.from(`api:${options.apiKey}`).toString("base64")}`;

      // Mailgun answers a key it does not take in plain text.
      if (String(request.headers.authorization || "") !== expected) {
        return { status: 401, rawBody: "Forbidden" };
      }

      const domain: string = decodeURIComponent(
        request.path.slice(prefix.length, request.path.length - suffix.length),
      );

      if (!options.domains.includes(domain)) {
        return { status: 404, body: { message: "Domain not found" } };
      }

      let form: Map<string, RecordedFormValue>;

      try {
        form = await readMultipartForm(request);
      } catch {
        return {
          status: 400,
          body: { message: "Message is not a valid multipart form" },
        };
      }

      request.form = form;

      if (typeof form.get("to") !== "string" || !form.get("to")) {
        return { status: 400, body: { message: "to parameter is missing" } };
      }

      const message: RecordedFormValue | undefined = form.get("message");

      if (!message || typeof message === "string" || !message.content) {
        return {
          status: 400,
          body: { message: "message parameter is missing" },
        };
      }

      return {
        status: 200,
        body: {
          id: `<20250101000000.fake@${domain}>`,
          message: "Queued. Thank you.",
        },
      };
    },
  );
};

// The real MailgunMailProvider, talking to `fake` for a region's host.
export const sendMailgunTo: (
  fake: FakeMailgun,
  host?: "api.mailgun.net" | "api.eu.mailgun.net",
) => void = (
  fake: FakeMailgun,
  host: "api.mailgun.net" | "api.eu.mailgun.net" = "api.mailgun.net",
): void => {
  routeFetchTo(`https://${host}`, fake.url);
};

// The MIME message a messages.mime the fake took carried.
export const mailgunMimeOf: (request: RecordedHttpRequest) => string = (
  request: RecordedHttpRequest,
): string => {
  const message: RecordedFormValue | undefined = request.form?.get("message");

  if (!message || typeof message === "string") {
    throw new Error("The request carried no MIME message.");
  }

  return message.content;
};

/*
 * POSTMARK (Email API)
 */

export const POSTMARK_BAD_TOKEN_ANSWER: FakeHttpAnswer = {
  status: 401,
  headers: { "X-PM-ApiErrorCode": "10" },
  body: {
    ErrorCode: 10,
    Message:
      "The Server Token you provided in the X-Postmark-Server-Token request header was invalid. Please verify that you are using a valid token.",
  },
};

export const postmarkError: (
  errorCode: number,
  message: string,
) => FakeHttpAnswer = (errorCode: number, message: string): FakeHttpAnswer => {
  return {
    status: 422,
    headers: { "X-PM-ApiErrorCode": String(errorCode) },
    body: { ErrorCode: errorCode, Message: message },
  };
};

// What Postmark would refuse in `body`, as Postmark answers; null when it takes it.
export const checkPostmarkEmail: (body: unknown) => FakeHttpAnswer | null = (
  body: unknown,
): FakeHttpAnswer | null => {
  const email: Record<string, unknown> | null = asRecord(body);

  if (!email) {
    return postmarkError(402, "Received invalid JSON input.");
  }

  if (typeof email["From"] !== "string" || !email["From"]) {
    return postmarkError(300, "Invalid 'From' address: ''.");
  }

  if (typeof email["To"] !== "string" || !email["To"]) {
    return postmarkError(300, "Zero recipients specified");
  }

  if (
    (typeof email["HtmlBody"] !== "string" || !email["HtmlBody"]) &&
    (typeof email["TextBody"] !== "string" || !email["TextBody"])
  ) {
    return postmarkError(
      300,
      "Provide either email TextBody or HtmlBody or both.",
    );
  }

  const attachments: unknown = email["Attachments"];

  if (attachments === undefined) {
    return null;
  }

  if (!Array.isArray(attachments)) {
    return postmarkError(300, "Attachments must be a list.");
  }

  for (const item of attachments) {
    const attachment: Record<string, unknown> = asRecord(item) || {};

    if (typeof attachment["Name"] !== "string" || !attachment["Name"]) {
      return postmarkError(300, "Attachment Name is required.");
    }

    if (!isBase64(attachment["Content"])) {
      return postmarkError(300, "Attachment Content must be base64.");
    }

    if (
      typeof attachment["ContentType"] !== "string" ||
      !attachment["ContentType"]
    ) {
      return postmarkError(300, "Attachment ContentType is required.");
    }

    const contentId: unknown = attachment["ContentID"];

    if (
      contentId !== undefined &&
      (typeof contentId !== "string" || !contentId.startsWith("cid:"))
    ) {
      return postmarkError(
        300,
        "An inline image's ContentID is written cid: and its id.",
      );
    }
  }

  return null;
};

export type FakePostmark = FakeHttpService;

export const startFakePostmark: (
  serverToken: string,
) => Promise<FakePostmark> = async (
  serverToken: string,
): Promise<FakePostmark> => {
  return await startFakeHttpService(
    (request: RecordedHttpRequest): FakeHttpAnswer => {
      if (request.method !== "POST" || request.path !== "/email") {
        return { status: 404, body: { ErrorCode: 404, Message: "Not found" } };
      }

      if (
        String(request.headers.accept || "") !== "application/json" ||
        !String(request.headers["content-type"] || "").startsWith(
          "application/json",
        )
      ) {
        return { status: 415, rawBody: "Unsupported Media Type" };
      }

      if (
        String(request.headers["x-postmark-server-token"] || "") !== serverToken
      ) {
        return POSTMARK_BAD_TOKEN_ANSWER;
      }

      return (
        checkPostmarkEmail(request.json) || {
          status: 200,
          body: {
            To: String(asRecord(request.json)?.["To"] || ""),
            SubmittedAt: new Date().toISOString(),
            MessageID: "b7bc2f4a-e38e-4336-af7d-e6c392c2f817",
            ErrorCode: 0,
            Message: "OK",
          },
        }
      );
    },
  );
};

export const sendPostmarkTo: (fake: FakePostmark) => void = (
  fake: FakePostmark,
): void => {
  routeFetchTo("https://api.postmarkapp.com", fake.url);
};

// The JSON body of an email the fake received.
export interface PostmarkEmailJson {
  From: string;
  To: string;
  Subject: string;
  HtmlBody: string;
  TextBody?: string;
  Attachments?: Array<Record<string, unknown>>;
}

/*
 * RESEND (Emails API)
 */

export const resendError: (
  status: number,
  name: string,
  message: string,
) => FakeHttpAnswer = (
  status: number,
  name: string,
  message: string,
): FakeHttpAnswer => {
  return {
    status: status,
    body: { statusCode: status, name: name, message: message },
  };
};

// What Resend would refuse in `body`, as Resend answers; null when it takes it.
export const checkResendEmail: (body: unknown) => FakeHttpAnswer | null = (
  body: unknown,
): FakeHttpAnswer | null => {
  const email: Record<string, unknown> | null = asRecord(body);

  if (!email) {
    return resendError(400, "validation_error", "Invalid JSON.");
  }

  for (const field of ["from", "subject"]) {
    if (typeof email[field] !== "string" || !email[field]) {
      return resendError(
        422,
        "missing_required_field",
        `Missing \`${field}\` field.`,
      );
    }
  }

  const to: unknown = email["to"];

  if (
    !(typeof to === "string" && to) &&
    !(Array.isArray(to) && to.length > 0 && to.length <= 50)
  ) {
    return resendError(422, "missing_required_field", "Missing `to` field.");
  }

  const attachments: unknown = email["attachments"];

  if (attachments === undefined) {
    return null;
  }

  if (!Array.isArray(attachments)) {
    return resendError(
      422,
      "invalid_attachment",
      "Attachments must be a list.",
    );
  }

  for (const item of attachments) {
    const attachment: Record<string, unknown> = asRecord(item) || {};

    if (
      !isBase64(attachment["content"]) &&
      typeof attachment["path"] !== "string"
    ) {
      return resendError(
        422,
        "invalid_attachment",
        "Attachment must have content or path.",
      );
    }

    if (typeof attachment["filename"] !== "string" || !attachment["filename"]) {
      return resendError(
        422,
        "invalid_attachment",
        "Attachment filename is required.",
      );
    }

    const contentId: unknown = attachment["content_id"];

    if (
      contentId !== undefined &&
      (typeof contentId !== "string" || !contentId || contentId.length >= 128)
    ) {
      return resendError(
        422,
        "invalid_attachment",
        "content_id must be less than 128 characters.",
      );
    }
  }

  return null;
};

export type FakeResend = FakeHttpService;

export const startFakeResend: (apiKey: string) => Promise<FakeResend> = async (
  apiKey: string,
): Promise<FakeResend> => {
  return await startFakeHttpService(
    (request: RecordedHttpRequest): FakeHttpAnswer => {
      if (request.method !== "POST" || request.path !== "/emails") {
        return resendError(
          404,
          "not_found",
          "The requested endpoint does not exist.",
        );
      }

      // Refused before it reaches the API, as Resend's edge refuses it.
      if (!String(request.headers["user-agent"] || "").trim()) {
        return { status: 403, rawBody: "error code: 1010" };
      }

      const authorization: string = String(request.headers.authorization || "");

      if (!authorization) {
        return resendError(
          401,
          "missing_api_key",
          "Missing API key in the authorization header.",
        );
      }

      if (authorization !== `Bearer ${apiKey}`) {
        return resendError(401, "validation_error", "API key is invalid");
      }

      return (
        checkResendEmail(request.json) || {
          status: 200,
          body: { id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" },
        }
      );
    },
  );
};

export const sendResendTo: (fake: FakeResend) => void = (
  fake: FakeResend,
): void => {
  routeFetchTo("https://api.resend.com", fake.url);
};

// The JSON body of an email the fake received.
export interface ResendEmailJson {
  from: string;
  to: Array<string> | string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: Array<Record<string, unknown>>;
}

/*
 * SMTP
 */

export interface ReceivedSmtpMessage {
  from: string;
  recipients: Array<string>;
  // The message as written, its dot-stuffing undone, lines ending in CRLF.
  data: string;
  // What the server answered the message with.
  reply: string;
}

export interface FakeSmtpServer {
  port: number;
  // Every command line the client sent, AUTH lines included.
  commands: Array<string>;
  // Every message that reached the end of DATA, taken or refused.
  messages: Array<ReceivedSmtpMessage>;
  close: () => Promise<void>;
}

export interface FakeSmtpServerOptions {
  /*
   * The reply to a message at the end of DATA, from the message as
   * written: "250 2.0.0 Ok: queued" when absent.
   */
  answerMessage?: (data: string) => string;
}

export const SMTP_QUEUED_REPLY: string = "250 2.0.0 Ok: queued";

export const startFakeSmtpServer: (
  options?: FakeSmtpServerOptions,
) => Promise<FakeSmtpServer> = async (
  options?: FakeSmtpServerOptions,
): Promise<FakeSmtpServer> => {
  const commands: Array<string> = [];
  const messages: Array<ReceivedSmtpMessage> = [];
  const sockets: Set<net.Socket> = new Set<net.Socket>();

  const server: net.Server = net.createServer((socket: net.Socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
    socket.on("error", () => {});

    let buffered: string = "";
    let from: string = "";
    let recipients: Array<string> = [];
    let dataLines: Array<string> | null = null;

    const reply: (line: string) => void = (line: string): void => {
      socket.write(`${line}\r\n`);
    };

    reply("220 fake.smtp.test ESMTP");

    socket.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("latin1");

      let lineEnd: number = buffered.indexOf("\r\n");

      while (lineEnd !== -1) {
        const line: string = buffered.slice(0, lineEnd);
        buffered = buffered.slice(lineEnd + 2);
        lineEnd = buffered.indexOf("\r\n");

        if (dataLines) {
          if (line === ".") {
            const data: string = Buffer.from(
              dataLines.join("\r\n"),
              "latin1",
            ).toString("utf8");
            const answer: string = options?.answerMessage
              ? options.answerMessage(data)
              : SMTP_QUEUED_REPLY;

            messages.push({
              from: from,
              recipients: recipients,
              data: data,
              reply: answer,
            });
            dataLines = null;
            reply(answer);
          } else {
            dataLines.push(line.startsWith("..") ? line.slice(1) : line);
          }

          continue;
        }

        commands.push(line);

        const verb: string = (line.split(" ")[0] || "").toUpperCase();

        if (verb === "EHLO" || verb === "HELO") {
          reply("250-fake.smtp.test");
          reply("250-AUTH PLAIN LOGIN XOAUTH2");
          reply("250 SMTPUTF8");
        } else if (verb === "AUTH") {
          reply("235 2.7.0 Authentication successful");
        } else if (verb === "MAIL") {
          from = line.slice(line.indexOf(":") + 1).trim();
          recipients = [];
          reply("250 2.1.0 Ok");
        } else if (verb === "RCPT") {
          recipients.push(line.slice(line.indexOf(":") + 1).trim());
          reply("250 2.1.5 Ok");
        } else if (verb === "DATA") {
          dataLines = [];
          reply("354 End data with <CR><LF>.<CR><LF>");
        } else if (verb === "QUIT") {
          reply("221 2.0.0 Bye");
          socket.end();
        } else {
          reply("250 2.0.0 Ok");
        }
      }
    });
  });

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    port: (server.address() as net.AddressInfo).port,
    commands: commands,
    messages: messages,
    close: async (): Promise<void> => {
      for (const socket of sockets) {
        socket.destroy();
      }

      await new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
};

/*
 * HTML
 */

/*
 * The Content-IDs an email's HTML points at, in order: each <img>'s
 * src="cid:..." value. Read with indexOf, in time linear in the HTML.
 */
export const contentIdsInHtml: (html: string) => Array<string> = (
  html: string,
): Array<string> => {
  const marker: string = 'src="cid:';
  const contentIds: Array<string> = [];
  let index: number = html.indexOf(marker);

  while (index !== -1) {
    const start: number = index + marker.length;
    const end: number = html.indexOf('"', start);

    if (end === -1) {
      break;
    }

    contentIds.push(html.slice(start, end));
    index = html.indexOf(marker, end);
  }

  return contentIds;
};
