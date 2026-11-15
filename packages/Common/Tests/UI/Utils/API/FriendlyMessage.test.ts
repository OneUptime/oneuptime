// Must stay the first import: the client's URLs are built from HOST on load.
import "./DashboardHost";
import BaseAPI from "../../../../UI/Utils/API/API";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import APIException from "../../../../Types/Exception/ApiException";
import BadDataException from "../../../../Types/Exception/BadDataException";
import {
  isEmptyErrorPhrase,
  meetsErrorMessageRule,
} from "../../../../Types/Exception/ErrorMessageRule";
import {
  getUnexplainedServerErrorMessage,
  readUnexplainedError,
  SERVER_DOWN_MESSAGE,
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorKind,
} from "../../../../Types/Exception/UnexplainedError";
import { describe, expect, test } from "@jest/globals";

/*
 * API.getFriendlyMessage is what about 2,000 places in the Dashboard,
 * Accounts and the Admin Dashboard show when something fails. It fell back
 * to "Server Error. Please try again" whenever nobody had put the failure
 * into words, and showed a TypeError's "Cannot read properties of
 * undefined" or "Request failed to https://.../api/monitor. Network Error"
 * as they were (#6836). Now every failure nobody explained gets one of five
 * sentences that say what happened and what to do next, and a failure on
 * the server keeps the reference it named.
 */

const friendly: (err: unknown) => string = (err: unknown): string => {
  return BaseAPI.getFriendlyMessage(err);
};

describe("a failure the server explained is shown as the server put it", () => {
  test("its message", () => {
    expect(
      friendly(
        new HTTPErrorResponse(
          400,
          { message: "A project with the same name already exists." },
          {},
        ),
      ),
    ).toBe("A project with the same name already exists.");
  });

  test("OneUptime's own exception thrown in the page", () => {
    expect(friendly(new BadDataException("Pick at least one probe."))).toBe(
      "Pick at least one probe.",
    );
  });

  test("a SyntaxError about what the person typed", () => {
    expect(
      friendly(
        new SyntaxError("Invalid regular expression: /(/: Unterminated group"),
      ),
    ).toBe("Invalid regular expression: /(/: Unterminated group");
  });

  test("a 504 the API answered with its own words (#4707)", () => {
    expect(
      friendly(
        new HTTPErrorResponse(
          504,
          { error: "This search took too long. Narrow the time range." },
          {},
        ),
      ),
    ).toBe("This search took too long. Narrow the time range.");
  });
});

describe("a failure on the server nobody explained", () => {
  test("keeps the reference the server named", () => {
    const message: string = friendly(
      new HTTPErrorResponse(
        500,
        {
          error: getUnexplainedServerErrorMessage("a1b2c3d4"),
          reference: "a1b2c3d4",
        },
        {},
      ),
    );

    expect(message).toBe(getUnexplainedServerErrorMessage("a1b2c3d4"));
    expect(readUnexplainedError(message)?.reference).toBe("a1b2c3d4");
  });

  test("builds the sentence from the reference, whatever words came with it", () => {
    expect(
      friendly(
        new HTTPErrorResponse(500, { message: "x", reference: "a1b2c3d4" }, {}),
      ),
    ).toBe(getUnexplainedServerErrorMessage("a1b2c3d4"));
  });

  test("ignores a reference that is not one", () => {
    expect(
      friendly(
        new HTTPErrorResponse(
          400,
          { message: "Promo code is invalid.", reference: "<b>hi</b>" },
          {},
        ),
      ),
    ).toBe("Promo code is invalid.");
  });

  test.each([
    [{ error: "Server Error" }],
    [{ message: "Internal Server Error" }],
    [{ error: "" }],
    [{}],
  ])(
    "an answer that says nothing (%j) says what to do next",
    (body: Record<string, string>) => {
      expect(friendly(new HTTPErrorResponse(500, body, {}))).toBe(
        UNEXPLAINED_ERROR_MESSAGES.server,
      );
    },
  );

  test("never 'Server Error. Please try again'", () => {
    expect(friendly(new HTTPErrorResponse(500, {}, {}))).not.toContain(
      "Server Error",
    );
  });

  test("an older server's bare 'Server Error', thrown again as an Error", () => {
    expect(friendly(new Error("Server Error"))).toBe(
      UNEXPLAINED_ERROR_MESSAGES.server,
    );
    expect(friendly("Server Error")).toBe(UNEXPLAINED_ERROR_MESSAGES.server);
  });
});

describe("a server that did not answer", () => {
  test.each([502, 504])(
    "a gateway's %i page reads as the server being down",
    (status: number) => {
      const message: string = friendly(
        new HTTPErrorResponse(status, "<html>Bad Gateway</html>" as never, {}),
      );

      expect(message).toBe(SERVER_DOWN_MESSAGE);
      expect(readUnexplainedError(message)?.kind).toBe(
        UnexplainedErrorKind.ServerDown,
      );
    },
  );
});

describe("OneUptime that could not be reached at all", () => {
  test("a request with no answer: the browser's words and the URL stay out", () => {
    const message: string = friendly(
      new APIException(
        "Request failed to https://oneuptime.example.com/api/monitor. Network Error",
      ),
    );

    expect(message).toBe(UNEXPLAINED_ERROR_MESSAGES.unreachable);
    expect(message).not.toContain("https://");
  });

  test("the browser's own 'Network Error', thrown as an APIException", () => {
    expect(friendly(new APIException("Network Error"))).toBe(
      UNEXPLAINED_ERROR_MESSAGES.unreachable,
    );
    expect(friendly(new APIException("Network Error."))).toBe(
      UNEXPLAINED_ERROR_MESSAGES.unreachable,
    );
  });

  test("no response at all", () => {
    expect(
      friendly(new APIException("No response received from server.")),
    ).toBe(UNEXPLAINED_ERROR_MESSAGES.unreachable);
  });

  test.each([
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "Load failed",
  ])("fetch()'s TypeError %j", (words: string) => {
    expect(friendly(new TypeError(words))).toBe(
      UNEXPLAINED_ERROR_MESSAGES.unreachable,
    );
  });

  test("an APIException with words of its own keeps them", () => {
    expect(
      friendly(new APIException("The LLM provider refused the key.")),
    ).toBe("The LLM provider refused the key.");
  });
});

describe("a page that failed", () => {
  test("a TypeError's words are a developer's, and stay out", () => {
    const message: string = friendly(
      new TypeError("Cannot read properties of undefined (reading 'id')"),
    );

    expect(message).toBe(UNEXPLAINED_ERROR_MESSAGES.page);
    expect(message).not.toContain("undefined");
  });

  test("a ReferenceError's too", () => {
    expect(friendly(new ReferenceError("project is not defined"))).toBe(
      UNEXPLAINED_ERROR_MESSAGES.page,
    );
  });

  test("an error with no message", () => {
    expect(friendly(new Error(""))).toBe(UNEXPLAINED_ERROR_MESSAGES.page);
  });

  test("an object with nothing to read, rather than its JSON", () => {
    expect(friendly({ status: 500, code: "E_X" })).toBe(
      UNEXPLAINED_ERROR_MESSAGES.page,
    );
  });

  test("an object that holds a message gives it", () => {
    expect(friendly({ error: "The key expired." })).toBe("The key expired.");
    expect(friendly({ message: "Server Error" })).toBe(
      UNEXPLAINED_ERROR_MESSAGES.server,
    );
  });

  test("nothing at all", () => {
    expect(friendly(undefined)).toBe(UNEXPLAINED_ERROR_MESSAGES.page);
    expect(friendly(null)).toBe(UNEXPLAINED_ERROR_MESSAGES.page);
    expect(friendly("")).toBe(UNEXPLAINED_ERROR_MESSAGES.server);
  });
});

/*
 * #7536: a message written in a script with no upper or lower case read as
 * empty, so the real message was replaced with the English sentence for a
 * failure nobody explained. A real message comes back exactly as it was
 * sent, in any script, whichever way it reached the page.
 */
const MESSAGES_IN_MANY_SCRIPTS: Array<[string, string]> = [
  ["Persian", "این قاعده را نمی‌توان به یک بررسی تبدیل کرد."],
  ["Arabic", "تعذر الاتصال بقاعدة البيانات."],
  ["Hebrew", "החיבור למסד הנתונים נכשל."],
  ["Japanese", "接続が拒否されました"],
  ["Chinese", "数据库连接失败。"],
  ["Korean", "연결이 거부되었습니다."],
  ["Hindi", "डेटाबेस से कनेक्शन अस्वीकार कर दिया गया।"],
  ["Thai", "การเชื่อมต่อถูกปฏิเสธ"],
  ["Urdu", "کنکشن مسترد کر دیا گیا۔"],
  ["Arabic-Indic digits", "٤٠٤"],
  ["full-width digits", "５０３"],
  ["German", "Die Verbindung zur Datenbank wurde abgelehnt."],
  ["Russian", "Соединение отклонено."],
  ["English", "A project with the same name already exists."],
];

describe("a real message is kept as written, in any script (#7536)", () => {
  test.each(MESSAGES_IN_MANY_SCRIPTS)(
    "%s, as the server's { message }",
    (_script: string, message: string) => {
      expect(
        friendly(new HTTPErrorResponse(400, { message: message }, {})),
      ).toBe(message);
    },
  );

  test.each(MESSAGES_IN_MANY_SCRIPTS)(
    "%s, as the server's { error } on a 500",
    (_script: string, message: string) => {
      expect(friendly(new HTTPErrorResponse(500, { error: message }, {}))).toBe(
        message,
      );
    },
  );

  test.each(MESSAGES_IN_MANY_SCRIPTS)(
    "%s, as a plain-text body",
    (_script: string, message: string) => {
      expect(friendly(new HTTPErrorResponse(400, message as never, {}))).toBe(
        message,
      );
    },
  );

  test.each(MESSAGES_IN_MANY_SCRIPTS)(
    "%s, as a 504 the API answered itself",
    (_script: string, message: string) => {
      expect(friendly(new HTTPErrorResponse(504, { error: message }, {}))).toBe(
        message,
      );
    },
  );

  test.each(MESSAGES_IN_MANY_SCRIPTS)(
    "%s, as a 503 the API answered itself (StartupGate)",
    (_script: string, message: string) => {
      expect(friendly(new HTTPErrorResponse(503, { error: message }, {}))).toBe(
        message,
      );
    },
  );

  test.each(MESSAGES_IN_MANY_SCRIPTS)(
    "%s, thrown in the page",
    (_script: string, message: string) => {
      expect(friendly(new Error(message))).toBe(message);
      expect(friendly(new BadDataException(message))).toBe(message);
      expect(friendly(new APIException(message))).toBe(message);
    },
  );

  test.each(MESSAGES_IN_MANY_SCRIPTS)(
    "%s, as a string or an object",
    (_script: string, message: string) => {
      expect(friendly(message)).toBe(message);
      expect(friendly({ message: message })).toBe(message);
      expect(friendly({ error: message })).toBe(message);
    },
  );

  test("the issue's own example", () => {
    expect(
      friendly(new Error("این قاعده را نمی‌توان به یک بررسی تبدیل کرد.")),
    ).toBe("این قاعده را نمی‌توان به یک بررسی تبدیل کرد.");
  });

  test.each([
    ["Server Error"],
    ["Internal Server Error. Please try again"],
    [""],
    ["   "],
    ["..."],
    ["❌"],
  ])("an answer that says nothing, %j, is still replaced", (body: string) => {
    expect(friendly(new HTTPErrorResponse(500, { error: body }, {}))).toBe(
      UNEXPLAINED_ERROR_MESSAGES.server,
    );
    expect(friendly(new HTTPErrorResponse(500, body as never, {}))).toBe(
      UNEXPLAINED_ERROR_MESSAGES.server,
    );
  });
});

/*
 * A gateway, a proxy or a web server answers with a page, which used to be
 * shown as its markup: a 500 from a proxy read "<html><head><title>500
 * Internal Server Error</title>..." in the card.
 */
const NGINX_PAGE: (status: string) => string = (status: string): string => {
  return `<html>\r\n<head><title>${status}</title></head>\r\n<body>\r\n<center><h1>${status}</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n`;
};

describe("a page instead of a message", () => {
  test.each([
    [502, NGINX_PAGE("502 Bad Gateway")],
    [504, NGINX_PAGE("504 Gateway Time-out")],
    [503, NGINX_PAGE("503 Service Temporarily Unavailable")],
    [
      503,
      "<html><body><h1>503 Service Temporarily Unavailable</h1></body></html>",
    ],
    [
      520,
      '<!DOCTYPE html><html lang="en-US"><head><title>Web server is returning an unknown error</title></head><body></body></html>',
    ],
    [521, "<!DOCTYPE html><html><body>Web server is down</body></html>"],
    [522, "<!DOCTYPE html><html><body>Connection timed out</body></html>"],
    [523, "<!DOCTYPE html><html><body>Origin is unreachable</body></html>"],
    [524, "<!DOCTYPE html><html><body>A timeout occurred</body></html>"],
    [530, "<!DOCTYPE html><html><body>Origin DNS error</body></html>"],
  ])(
    "a gateway's %i page reads as the server being down",
    (status: number, page: string) => {
      const message: string = friendly(
        new HTTPErrorResponse(status, page as never, {}),
      );

      expect(message).toBe(SERVER_DOWN_MESSAGE);
      expect(readUnexplainedError(message)?.kind).toBe(
        UnexplainedErrorKind.ServerDown,
      );
      expect(message).not.toContain("<");
    },
  );

  test.each([503, 520, 521, 522, 523, 524, 530])(
    "a gateway's %i that says nothing reads as the server being down",
    (status: number) => {
      expect(friendly(new HTTPErrorResponse(status, "" as never, {}))).toBe(
        SERVER_DOWN_MESSAGE,
      );
      expect(friendly(new HTTPErrorResponse(status, {}, {}))).toBe(
        SERVER_DOWN_MESSAGE,
      );
      expect(
        friendly(
          new HTTPErrorResponse(status, { error: "Service Unavailable" }, {}),
        ),
      ).toBe(SERVER_DOWN_MESSAGE);
    },
  );

  test.each([
    [500, NGINX_PAGE("500 Internal Server Error")],
    [404, NGINX_PAGE("404 Not Found")],
    [403, NGINX_PAGE("403 Forbidden")],
    [
      500,
      '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>Internal Server Error</pre>\n</body>\n</html>\n',
    ],
    [404, '<!doctype html><html><body><div id="root"></div></body></html>'],
    [
      400,
      '<?xml version="1.0" encoding="UTF-8"?><Error><Code>InvalidRequest</Code></Error>',
    ],
    [500, "<html><body><h1>خطای داخلی سرور</h1></body></html>"],
  ])(
    "any other %i page reads as a failure the server did not explain, not as its markup",
    (status: number, page: string) => {
      const message: string = friendly(
        new HTTPErrorResponse(status, page as never, {}),
      );

      expect(message).toBe(UNEXPLAINED_ERROR_MESSAGES.server);
      expect(message).not.toContain("<");
    },
  );

  test("a page thrown again as an Error, or passed on as a string, has lost its status: the server did not explain", () => {
    expect(friendly(new Error(NGINX_PAGE("500 Internal Server Error")))).toBe(
      UNEXPLAINED_ERROR_MESSAGES.server,
    );
    expect(friendly(NGINX_PAGE("500 Internal Server Error"))).toBe(
      UNEXPLAINED_ERROR_MESSAGES.server,
    );
    expect(
      friendly({ error: NGINX_PAGE("413 Request Entity Too Large") }),
    ).toBe(UNEXPLAINED_ERROR_MESSAGES.server);
  });

  test("a message that only starts with a tag is a message", () => {
    expect(
      friendly(
        new HTTPErrorResponse(
          400,
          { message: "<script> is not allowed in a name." },
          {},
        ),
      ),
    ).toBe("<script> is not allowed in a name.");
  });

  test("a gateway's status with a message of the server's own keeps it", () => {
    expect(
      friendly(
        new HTTPErrorResponse(
          503,
          { error: "OneUptime is starting. This page reloads in a moment." },
          {},
        ),
      ),
    ).toBe("OneUptime is starting. This page reloads in a moment.");
  });

  test("a reference still wins over a page", () => {
    expect(
      friendly(
        new HTTPErrorResponse(
          500,
          { data: NGINX_PAGE("500"), reference: "a1b2c3d4" },
          {},
        ),
      ),
    ).toBe(getUnexplainedServerErrorMessage("a1b2c3d4"));
  });
});

/*
 * A 413: what was sent was larger than a proxy in front of OneUptime, or
 * OneUptime itself, takes (#8278). nginx answers one when a body passes its
 * client_max_body_size - an upload, a big import, a large dashboard - and a
 * load balancer, a CDN or an API gateway answer theirs. It read "The server
 * ran into a problem it could not explain ... Try again in a moment.",
 * which never helps: the reader needs to send less, and whoever runs a
 * self-hosted server to raise the proxy's limit.
 */
const HAPROXY_413_PAGE: string =
  "<html><body><h1>413 Request Entity Too Large</h1>\nThe request entity exceeds the maximum allowed.\n</body></html>\n";

const CLOUDFLARE_413_PAGE: string =
  "<html>\r\n<head><title>413 Request Entity Too Large</title></head>\r\n<body>\r\n<center><h1>413 Request Entity Too Large</h1></center>\r\n<hr><center>cloudflare</center>\r\n</body>\r\n</html>\r\n";

const AWS_ALB_413_PAGE: string =
  "<html>\r\n<head><title>413 Request Entity Too Large</title></head>\r\n<body>\r\n<center><h1>413 Request Entity Too Large</h1></center>\r\n</body>\r\n</html>\r\n";

const IIS_413_PAGE: string =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">\r\n<html xmlns="http://www.w3.org/1999/xhtml">\r\n<head><title>IIS 10.0 Detailed Error - 413.1 - Request Entity Too Large</title></head><body><div id="content"><h3>The page was not displayed because the request entity is too large.</h3></div></body></html>';

const GOOGLE_413_PAGE: string =
  "<!DOCTYPE html>\n<html lang=en>\n  <meta charset=utf-8>\n  <title>Error 413 (Request Entity Too Large)!!1</title>\n  <p><b>413.</b> <ins>That’s an error.</ins>\n  <p>Your client issued a request that was too large.\n  <ins>That’s all we know.</ins>\n</html>";

describe("a 413: what was sent was too large (#8278)", () => {
  test("the issue's own example: nginx's page says it was too large, and to send less", () => {
    const message: string = friendly(
      new HTTPErrorResponse(
        413,
        "<html><head><title>413 Request Entity Too Large</title></head><body><center><h1>413 Request Entity Too Large</h1></center><hr><center>nginx</center></body></html>" as never,
        {},
      ),
    );

    expect(message).toBe(UNEXPLAINED_ERROR_MESSAGES.tooLarge);
    expect(message).toBe(
      "What was sent was too large for the server to accept, so this did not finish. Try again with less at once, such as a smaller file.",
    );
    expect(message).not.toBe(UNEXPLAINED_ERROR_MESSAGES.server);
    expect(message).not.toContain("Try again in a moment");
    expect(readUnexplainedError(message)).toEqual({
      kind: UnexplainedErrorKind.TooLarge,
      reference: null,
    });
  });

  test.each([
    ["nginx", NGINX_PAGE("413 Request Entity Too Large")],
    ["ingress-nginx", NGINX_PAGE("413 Request Entity Too Large")],
    ["HAProxy", HAPROXY_413_PAGE],
    ["Cloudflare", CLOUDFLARE_413_PAGE],
    ["an AWS load balancer", AWS_ALB_413_PAGE],
    ["IIS", IIS_413_PAGE],
    ["Google's front end", GOOGLE_413_PAGE],
    [
      "a proxy's XML",
      '<?xml version="1.0"?><Error><Code>EntityTooLarge</Code></Error>',
    ],
  ])(
    "%s's 413 page reads as too large, not as its markup",
    (_proxy: string, page: string) => {
      const message: string = friendly(
        new HTTPErrorResponse(413, page as never, {}),
      );

      expect(message).toBe(UNEXPLAINED_ERROR_MESSAGES.tooLarge);
      expect(message).not.toContain("<");
      expect(readUnexplainedError(message)?.kind).toBe(
        UnexplainedErrorKind.TooLarge,
      );
    },
  );

  test.each([
    ["an empty body", "" as never],
    ["an empty JSON body", {}],
    ["spaces only", "   \n" as never],
    ["an empty phrase", { error: "Server Error" }],
    ["an empty message", { message: "" }],
  ])(
    "a 413 that says nothing (%s) reads as too large",
    (_shape: string, body: unknown) => {
      expect(friendly(new HTTPErrorResponse(413, body as never, {}))).toBe(
        UNEXPLAINED_ERROR_MESSAGES.tooLarge,
      );
    },
  );

  test.each([
    ["nginx, as plain text", "Request Entity Too Large" as never],
    ["Express's body parser", "request entity too large" as never],
    ["its status line", "413 Request Entity Too Large" as never],
    ["RFC 7231's name", "Payload Too Large" as never],
    ["RFC 9110's name", "Content Too Large" as never],
    ["Envoy", { message: "Payload Too Large" }],
    ["Amazon API Gateway", { message: "Request Too Long" }],
    ["Go's MaxBytesReader", "http: request body too large" as never],
    ["Kong", { message: "Request size limit exceeded" }],
    [
      "a gateway's error object",
      { error: { message: "Request Entity Too Large" } },
    ],
    ["Error 413", "Error 413: Payload Too Large." as never],
    ["HTTP 413", "HTTP 413 - Request Entity Too Large" as never],
    ["in capitals", "REQUEST ENTITY TOO LARGE" as never],
  ])(
    "a 413 that says only its status (%s) reads as too large",
    (_source: string, body: unknown) => {
      expect(friendly(new HTTPErrorResponse(413, body as never, {}))).toBe(
        UNEXPLAINED_ERROR_MESSAGES.tooLarge,
      );
    },
  );

  test.each([
    [
      "the gzip limit OneUptime holds a body to",
      "Request body too large. The compressed body of a gzip-encoded request may not exceed 4194304 bytes.",
    ],
    ["a refused upload", "Multipart request rejected: LIMIT_FILE_SIZE."],
    [
      "a limit with its number",
      "This file is larger than 10 MB. Choose a smaller file.",
    ],
    ["a message in Persian", "این فایل بزرگ‌تر از حد مجاز است."],
    ["a message in Japanese", "ファイルが大きすぎます。"],
    [
      "a phrase with more after it",
      "Request entity too large: the monitor's steps are larger than 2 MB.",
    ],
  ])(
    "a 413 the API wrote in words of its own (%s) is kept as written",
    (_source: string, words: string) => {
      expect(friendly(new HTTPErrorResponse(413, { error: words }, {}))).toBe(
        words,
      );
      expect(friendly(new HTTPErrorResponse(413, { message: words }, {}))).toBe(
        words,
      );
    },
  );

  test("a 413 that names a reference is a server failure with that reference", () => {
    expect(
      friendly(
        new HTTPErrorResponse(
          413,
          {
            error: getUnexplainedServerErrorMessage("a1b2c3d4"),
            reference: "a1b2c3d4",
          },
          {},
        ),
      ),
    ).toBe(getUnexplainedServerErrorMessage("a1b2c3d4"));
  });

  test.each([400, 403, 404, 422, 500])(
    "only a 413 says it was too large: a %i that says the words keeps them",
    (status: number) => {
      expect(
        friendly(
          new HTTPErrorResponse(
            status,
            "Request Entity Too Large" as never,
            {},
          ),
        ),
      ).toBe("Request Entity Too Large");
    },
  );

  test.each([400, 403, 404, 500])(
    "only a 413 says it was too large: a %i page still reads as a failure the server did not explain",
    (status: number) => {
      expect(
        friendly(
          new HTTPErrorResponse(
            status,
            NGINX_PAGE("413 Request Entity Too Large") as never,
            {},
          ),
        ),
      ).toBe(UNEXPLAINED_ERROR_MESSAGES.server);
    },
  );

  test("the sentence meets the rule every error is held to", () => {
    const message: string = UNEXPLAINED_ERROR_MESSAGES.tooLarge;

    expect(isEmptyErrorPhrase(message)).toBe(false);
    expect(meetsErrorMessageRule(message)).toBe(true);
  });
});

describe("whatever failed, the answer is never an empty phrase", () => {
  test.each([
    new HTTPErrorResponse(500, {}, {}),
    new HTTPErrorResponse(500, { error: "Server Error" }, {}),
    new HTTPErrorResponse(
      500,
      NGINX_PAGE("500 Internal Server Error") as never,
      {},
    ),
    new HTTPErrorResponse(
      503,
      NGINX_PAGE("503 Service Unavailable") as never,
      {},
    ),
    new HTTPErrorResponse(500, "" as never, {}),
    new HTTPErrorResponse(
      413,
      NGINX_PAGE("413 Request Entity Too Large") as never,
      {},
    ),
    new HTTPErrorResponse(413, "" as never, {}),
    new HTTPErrorResponse(413, "Payload Too Large" as never, {}),
    new Error(""),
    new TypeError("x is not a function"),
    new APIException("Request failed to https://x/api. Network Error"),
    undefined,
    {},
    "",
  ])("%p", (err: unknown) => {
    expect(isEmptyErrorPhrase(friendly(err))).toBe(false);
  });
});
