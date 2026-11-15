// Must stay the first import: the client's URLs are built from HOST on load.
import "./DashboardHost";
import BaseAPI from "../../../../UI/Utils/API/API";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import APIException from "../../../../Types/Exception/ApiException";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { isEmptyErrorPhrase } from "../../../../Types/Exception/ErrorMessageRule";
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
 * as they were (#6836). Now every failure nobody explained gets one of four
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
    [413, NGINX_PAGE("413 Request Entity Too Large")],
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

  test("a page thrown again as an Error, or passed on as a string", () => {
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
