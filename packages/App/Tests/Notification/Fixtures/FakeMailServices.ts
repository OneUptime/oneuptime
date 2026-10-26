import { jest } from "@jest/globals";
import SendgridMail from "@sendgrid/mail";
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
 *
 * sendSendGridTo and sendMicrosoftGraphTo point the real clients at them, so
 * what a test reads is what the client put on the wire. Each test that uses
 * them restores its spies (jest.restoreAllMocks) and closes its servers.
 */

export interface RecordedHttpRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
  // The body as JSON, or undefined when it is not JSON.
  json: unknown;
}

export interface FakeHttpAnswer {
  status: number;
  body?: unknown;
}

export interface FakeHttpService {
  // "http://127.0.0.1:<port>", no trailing slash.
  url: string;
  requests: Array<RecordedHttpRequest>;
  // The answer to the next request, whatever it holds, instead of the check.
  answerNextWith: (answer: FakeHttpAnswer) => void;
  close: () => Promise<void>;
}

type CheckRequest = (request: RecordedHttpRequest) => FakeHttpAnswer;

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

        const answer: FakeHttpAnswer = forcedAnswers.shift() || check(recorded);

        if (answer.body === undefined) {
          response.writeHead(answer.status);
          response.end();
          return;
        }

        response.writeHead(answer.status, {
          "Content-Type": "application/json",
        });
        response.end(JSON.stringify(answer.body));
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
 * its JSON, axios, the request - is the client's own.
 */
export const sendSendGridTo: (fake: FakeSendGrid) => void = (
  fake: FakeSendGrid,
): void => {
  const realSetApiKey: (apiKey: string) => void =
    SendgridMail.setApiKey.bind(SendgridMail);

  jest
    .spyOn(SendgridMail, "setApiKey")
    .mockImplementation((apiKey: string): void => {
      realSetApiKey(apiKey);

      const client: SendGridMailInternals["client"] = (
        SendgridMail as unknown as SendGridMailInternals
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
 * The real MicrosoftGraphMailProvider, talking to `fake`: its fetch to
 * graph.microsoft.com goes to the same path on the fake, through the real
 * fetch, with the same method, headers and body. Anything else is fetched
 * as asked.
 */
export const sendMicrosoftGraphTo: (fake: FakeMicrosoftGraph) => void = (
  fake: FakeMicrosoftGraph,
): void => {
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

        if (parsed.origin !== GRAPH_ORIGIN) {
          return realFetch(input, init);
        }

        return realFetch(`${fake.url}${parsed.pathname}${parsed.search}`, init);
      },
    );
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
