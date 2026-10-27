import MattermostWebhook, {
  MATTERMOST_MAX_REQUEST_BYTES,
  MATTERMOST_MAX_RESPONSE_BYTES,
  MATTERMOST_WEBHOOK_URL_LABEL,
  MattermostError,
} from "../../../../Server/Utils/Mattermost/MattermostWebhook";
import { JSONObject } from "../../../../Types/JSON";
import MattermostComponents, {
  MATTERMOST_INCOMING_WEBHOOK_URL_PATTERN,
  MATTERMOST_MAX_MESSAGE_LENGTH,
  MATTERMOST_MAX_NAME_LENGTH,
  MATTERMOST_WEBHOOK_ID_LENGTH,
} from "../../../../Types/Workflow/Components/Mattermost";
import ComponentMetadata, {
  Argument,
} from "../../../../Types/Workflow/Component";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * What the Mattermost step accepts before it sends anything, read without a
 * server: which URLs are an incoming webhook's, how Channel, Username and
 * Icon URL are read, what the request carries, and the words every answer
 * and every failure is reported in. The step itself, against a server, is
 * MattermostSendMessageToChannel.test.ts.
 */

const ID: string = "3fd8pjcne7ry5bauiz8kpfo3hy";

// Whether a text holds a control character, a line separator or a direction mark.
const hasControlCharacter: (text: string) => boolean = (
  text: string,
): boolean => {
  return Array.from(text).some((character: string) => {
    const code: number = character.codePointAt(0) as number;

    return (
      code < 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029 ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    );
  });
};

const GOOD_URLS: Array<string> = [
  `https://mattermost.example.com/hooks/${ID}`,
  `http://mattermost.example.com/hooks/${ID}`,
  `https://mattermost.example.com:8065/hooks/${ID}`,
  `https://example.com/mattermost/hooks/${ID}`,
  `https://example.com/a/b/c/hooks/${ID}`,
  `https://acme.cloud.mattermost.com/hooks/${ID}`,
  `http://10.0.0.5:8065/hooks/${ID}`,
  `http://[fd00::1]:8065/hooks/${ID}`,
  `https://chat.example.com/hooks/${"0".repeat(26)}`,
  `https://chat.example.com/hooks/${"z".repeat(26)}`,
];

const BAD_URLS: Array<string> = [
  "",
  "mattermost.example.com",
  `mattermost.example.com/hooks/${ID}`,
  `ftp://mattermost.example.com/hooks/${ID}`,
  `ws://mattermost.example.com/hooks/${ID}`,
  `file:///etc/hooks/${ID}`,
  `https://user@mattermost.example.com/hooks/${ID}`,
  `https://user:pass@mattermost.example.com/hooks/${ID}`,
  `https://mattermost.example.com/hooks/${ID}?a=b`,
  `https://mattermost.example.com/hooks/${ID}?`,
  `https://mattermost.example.com/hooks/${ID}#`,
  `https://mattermost.example.com/hooks/${ID}/`,
  `https://mattermost.example.com/hooks/${ID}x`,
  `https://mattermost.example.com/hooks/${ID.slice(0, 25)}`,
  `https://mattermost.example.com/hooks/${ID.toUpperCase()}`,
  `https://mattermost.example.com/hooks/${ID.slice(0, 25)}-`,
  `https://mattermost.example.com/hooks/commands/${ID}`,
  `https://mattermost.example.com/hooks`,
  `https://mattermost.example.com/hooks/`,
  `https://mattermost.example.com/`,
  `https://mattermost.example.com`,
  `https://mattermost.example.com/api/v4/hooks/incoming`,
  `https://mattermost.example.com/hooks/ ${ID}`,
  `https://mattermost.example.com\\hooks\\${ID}`,
  `https://mattermost.example.com/hooks/${ID}\n`,
  `https:///hooks/${ID}`,
  // What the URL parser would read as a webhook's URL, but nobody pastes.
  `HTTPS://mattermost.example.com/hooks/${ID}`,
  `https:/mattermost.example.com/hooks/${ID}`,
  `https://mattermost.example.com/hooks/x/../${ID}`,
  `https://mattermost.example.com/hooks/./${ID}`,
];

describe("which URLs are an incoming webhook's", () => {
  test.each(GOOD_URLS)("%s is", (url: string) => {
    expect(MattermostWebhook.getWebhookUrlProblem(url)).toBeNull();
  });

  test.each(BAD_URLS)("%j is not", (url: string) => {
    const problem: string | null = MattermostWebhook.getWebhookUrlProblem(url);

    expect(problem).toEqual(expect.any(String));
    expect(problem?.startsWith(MATTERMOST_WEBHOOK_URL_LABEL)).toBe(true);
    // A sentence, which quotes nothing of the URL.
    expect(problem).toMatch(/\.$/);
    expect(problem).not.toContain(ID);
    expect(problem).not.toContain(ID.toUpperCase());
  });

  test("the problem names the part that is wrong", () => {
    expect(
      MattermostWebhook.getWebhookUrlProblem(
        `ftp://mattermost.example.com/hooks/${ID}`,
      ),
    ).toBe(
      "Mattermost Incoming Webhook URL must start with https:// (or http:// for a server without TLS).",
    );
    expect(
      MattermostWebhook.getWebhookUrlProblem(
        `https://mattermost.example.com/hooks/${ID}?x`,
      ),
    ).toBe(
      "Mattermost Incoming Webhook URL ends with the webhook's ID: nothing goes after it, no ? and no #.",
    );
    expect(
      MattermostWebhook.getWebhookUrlProblem("https://mattermost.example.com"),
    ).toBe(
      `Mattermost Incoming Webhook URL is not an incoming webhook's URL. It is the server's address, then /hooks/ and the webhook's ID of ${MATTERMOST_WEBHOOK_ID_LENGTH} lowercase letters and digits, as Mattermost shows it under Integrations, Incoming Webhooks.`,
    );
  });

  /*
   * The template wizard checks a pasted URL against a pattern before the
   * workflow is made; the step checks it again when it runs. A URL one
   * accepts and the other refuses is either a workflow that cannot be
   * created for no reason, or one that fails at its first incident.
   */
  test("the template wizard's pattern agrees with the step on every URL here", () => {
    for (const url of [...GOOD_URLS, ...BAD_URLS]) {
      expect({
        url,
        pattern: MATTERMOST_INCOMING_WEBHOOK_URL_PATTERN.test(url),
      }).toEqual({
        url,
        pattern: MattermostWebhook.getWebhookUrlProblem(url) === null,
      });
    }
  });

  /*
   * Twenty thousand URLs, each a scheme, a server, a generated middle and an
   * ending, every part drawn from what people paste and what they get wrong.
   * Whatever the step takes, the wizard's pattern takes too. (The pattern
   * may take more: the step then says what is wrong when it runs.)
   */
  test("and on twenty thousand generated ones, built from the pieces URLs are made of", () => {
    const random: SeededRandom = seededRandom(2718);
    const schemes: Array<string> = [
      "https://",
      "http://",
      "HTTP://",
      "https:/",
      "ftp://",
      "",
    ];
    const servers: Array<string> = [
      "mattermost.example.com",
      "chat.example.com:8065",
      "10.0.0.5",
      "[fd00::1]",
      "user@chat.example.com",
      "a",
      "",
    ];
    const endings: Array<string> = [
      `/hooks/${ID}`,
      `/hooks/${ID}`,
      `/hooks/${ID.toUpperCase()}`,
      `/hooks/${ID.slice(1)}`,
      `/hooks/${ID}/`,
      `/hooks/commands/${ID}`,
      `/${ID}`,
      "",
    ];
    const middles: Array<string> = generatedTexts(
      20000,
      2719,
      [
        "/",
        "a",
        "-",
        ".",
        "..",
        "%2F",
        "/hooks",
        ":",
        "?",
        "#",
        " ",
        "\\",
        "@",
      ],
      6,
    );

    const pick: (items: Array<string>) => string = (
      items: Array<string>,
    ): string => {
      return items[random(items.length)] as string;
    };

    let accepted: number = 0;
    let refused: number = 0;

    for (const middle of middles) {
      const url: string =
        pick(schemes) + pick(servers) + middle + pick(endings);

      if (MattermostWebhook.getWebhookUrlProblem(url) !== null) {
        refused++;
        continue;
      }

      accepted++;

      expect({
        url,
        pattern: MATTERMOST_INCOMING_WEBHOOK_URL_PATTERN.test(url),
      }).toEqual({ url, pattern: true });
    }

    // Both kinds were met, so the check above checked something.
    expect(accepted).toBeGreaterThan(200);
    expect(refused).toBeGreaterThan(10000);
  });

  test("the pattern keeps no state between checks, as the wizard calls it on every keystroke", () => {
    const url: string = GOOD_URLS[0] as string;

    expect(MATTERMOST_INCOMING_WEBHOOK_URL_PATTERN.flags).toBe("");
    expect(MATTERMOST_INCOMING_WEBHOOK_URL_PATTERN.test(url)).toBe(true);
    expect(MATTERMOST_INCOMING_WEBHOOK_URL_PATTERN.test(url)).toBe(true);
  });

  test("a URL of any length is read in time that grows with it alone", () => {
    const long: string = `https://mattermost.example.com/${"a/".repeat(100_000)}hooks/${ID}`;
    const slashes: string = `https://mattermost.example.com${"/".repeat(200_000)}`;
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(MattermostWebhook.getWebhookUrlProblem(long)).toBe(
          "Mattermost Incoming Webhook URL is too long to be a webhook's URL.",
        );
        expect(MATTERMOST_INCOMING_WEBHOOK_URL_PATTERN.test(slashes)).toBe(
          false,
        );
        expect(MATTERMOST_INCOMING_WEBHOOK_URL_PATTERN.test(long)).toBe(true);
      },
      limitInMs: 1000,
    });
    expect(timed.inMs).toBeLessThan(1000);
  });
});

describe("Channel", () => {
  test.each([
    ["town-square", "town-square"],
    ["~town-square", "town-square"],
    ["#town-square", "town-square"],
    ["TOWN-SQUARE", "town-square"],
    [" ops_alerts ", "ops_alerts"],
    ["off-topic.2026", "off-topic.2026"],
    ["@jane.doe", "@jane.doe"],
    ["@JANE_DOE", "@jane_doe"],
    ["#@jane", "@jane"],
    [
      "a".repeat(MATTERMOST_MAX_NAME_LENGTH),
      "a".repeat(MATTERMOST_MAX_NAME_LENGTH),
    ],
  ])("%j is posted to as %j", (typed: string, channel: string) => {
    expect(MattermostWebhook.getChannel(typed)).toBe(channel);
  });

  test.each([
    "Town Square",
    "ops,dev",
    "op\ns",
    "ops\u0000",
    "ops/dev",
    "@jane doe",
    "@",
    "#",
    "~",
    "ops🚨",
    "a".repeat(MATTERMOST_MAX_NAME_LENGTH + 1),
    "@" + "a".repeat(MATTERMOST_MAX_NAME_LENGTH + 1),
  ])("%j is refused, with what to type instead", (typed: string) => {
    let thrown: unknown = null;

    try {
      MattermostWebhook.getChannel(typed);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MattermostError);
    expect((thrown as Error).message).toMatch(/^Channel .*\.$/);
  });
});

describe("Username and Icon URL", () => {
  test("a name is trimmed, and may be anything on one line up to Mattermost's limit", () => {
    expect(MattermostWebhook.getUsername("  OneUptime Alerts  ")).toBe(
      "OneUptime Alerts",
    );
    expect(MattermostWebhook.getUsername("Ünïcödé 🚨")).toBe("Ünïcödé 🚨");
    expect(MattermostWebhook.getUsername("")).toBe("");
    expect(
      MattermostWebhook.getUsername("x".repeat(MATTERMOST_MAX_NAME_LENGTH)),
    ).toHaveLength(MATTERMOST_MAX_NAME_LENGTH);

    for (const bad of [
      "x".repeat(MATTERMOST_MAX_NAME_LENGTH + 1),
      "One\tUptime",
      "One\rUptime",
      "One\u007fUptime",
    ]) {
      expect(() => {
        return MattermostWebhook.getUsername(bad);
      }).toThrow(MattermostError);
    }
  });

  test("an icon is an http or https address", () => {
    expect(
      MattermostWebhook.getIconUrl(" https://example.com/oneuptime.png "),
    ).toBe("https://example.com/oneuptime.png");
    expect(
      MattermostWebhook.getIconUrl("http://example.com/icon.svg?size=64"),
    ).toBe("http://example.com/icon.svg?size=64");

    for (const bad of [
      "icon.png",
      "//example.com/icon.png",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "file:///etc/passwd",
      `https://example.com/${"a".repeat(3000)}.png`,
    ]) {
      expect(() => {
        return MattermostWebhook.getIconUrl(bad);
      }).toThrow(MattermostError);
    }
  });
});

describe("the request", () => {
  test("carries the text, and each other setting only when it is given, under Mattermost's names", () => {
    expect(MattermostWebhook.getPayload({ text: "Deploy finished" })).toEqual({
      text: "Deploy finished",
    });

    const payload: JSONObject = MattermostWebhook.getPayload({
      text: "Deploy finished",
      channel: "@jane.doe",
      username: "OneUptime",
      iconUrl: "https://example.com/oneuptime.png",
    });

    expect(payload).toEqual({
      text: "Deploy finished",
      channel: "@jane.doe",
      username: "OneUptime",
      icon_url: "https://example.com/oneuptime.png",
    });
  });

  test("a post as long as Mattermost takes, JSON-escaped at its worst, fits the request's limit", () => {
    // Every character a control character: six bytes each once escaped.
    const worst: string = "\u0001".repeat(MATTERMOST_MAX_MESSAGE_LENGTH);
    const body: string = JSON.stringify(
      MattermostWebhook.getPayload({
        text: worst,
        channel: "a".repeat(MATTERMOST_MAX_NAME_LENGTH),
        username: "x".repeat(MATTERMOST_MAX_NAME_LENGTH),
        iconUrl: `https://example.com/${"a".repeat(2000)}`,
      }),
    );

    expect(Buffer.byteLength(body, "utf8")).toBeLessThan(
      MATTERMOST_MAX_REQUEST_BYTES,
    );
    expect(MATTERMOST_MAX_RESPONSE_BYTES).toBe(64 * 1024);
  });
});

describe("the words an answer is reported in", () => {
  const appError: (id: string, message: string) => string = (
    id: string,
    message: string,
  ): string => {
    return JSON.stringify({
      id,
      message,
      detailed_error: "",
      request_id: "r",
      status_code: 400,
    });
  };

  test("a redirect, whatever it says, is a redirect", () => {
    for (const status of [300, 301, 302, 303, 307, 308]) {
      expect(
        MattermostWebhook.describeAnswer({
          status,
          body: appError("x", "Moved"),
          hasChannel: false,
        }),
      ).toMatch(
        /^Mattermost did not take the message: the server answered with a redirect \(HTTP 30\d [A-Za-z ]+\), which the step does not follow\./,
      );
    }
  });

  test("an AppError's message is quoted as a sentence, and its id never is", () => {
    expect(
      MattermostWebhook.describeAnswer({
        status: 400,
        body: appError(
          "web.incoming_webhook.text.app_error",
          "No text specified",
        ),
        hasChannel: false,
      }),
    ).toBe(
      "Mattermost refused the message (HTTP 400 Bad Request): No text specified.",
    );
    expect(
      MattermostWebhook.describeAnswer({
        status: 503,
        body: appError("x", "Try again later!"),
        hasChannel: false,
      }),
    ).toBe(
      "Mattermost could not take the message (HTTP 503 Service Unavailable): Try again later!",
    );
  });

  test("an answer that only looks like an AppError is not one", () => {
    for (const body of [
      "",
      "ok",
      "null",
      "[]",
      '["message"]',
      '{"message": ""}',
      '{"message": "   "}',
      '{"message": 42}',
      '{"msg": "Invalid webhook."}',
      "{not json",
      ' <html>{"message":"x"}</html>',
    ]) {
      expect(
        MattermostWebhook.describeAnswer({
          status: 400,
          body,
          hasChannel: false,
        }),
      ).toBe(
        "Mattermost did not take the message: the server answered HTTP 400 Bad Request.",
      );
    }
  });

  test("an id that names what every object has is no hint", () => {
    for (const id of [
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
    ]) {
      expect(
        MattermostWebhook.describeAnswer({
          status: 400,
          body: JSON.stringify({ id, message: "Nope." }),
          hasChannel: true,
        }),
      ).toBe("Mattermost refused the message (HTTP 400 Bad Request): Nope.");
    }
  });

  test("an AppError with no id is still quoted, without a hint", () => {
    expect(
      MattermostWebhook.describeAnswer({
        status: 400,
        body: JSON.stringify({ message: "Unable to parse incoming data." }),
        hasChannel: true,
      }),
    ).toBe(
      "Mattermost refused the message (HTTP 400 Bad Request): Unable to parse incoming data.",
    );
  });

  test("a reason is held to one short line, however it arrives", () => {
    const reasons: Array<string> = generatedTexts(2000, 1414, [
      "a",
      " ",
      "\n",
      "\r",
      "\t",
      "\u0000",
      "\u0085",
      "\u2028",
      "\u202e",
      "\u2066",
      "é",
      "🚨",
      ".",
    ]);

    for (const reason of reasons) {
      if (!reason.trim()) {
        continue;
      }

      const described: string = MattermostWebhook.describeAnswer({
        status: 400,
        body: JSON.stringify({ id: "x", message: reason }),
        hasChannel: false,
      });

      expect(hasControlCharacter(described)).toBe(false);
      expect(described).not.toMatch(/ {2}/);
      expect(described.length).toBeLessThanOrEqual(
        "Mattermost refused the message (HTTP 400 Bad Request): ".length + 302,
      );
    }
  });
});

describe("the words a failed connection is reported in", () => {
  type ErrorWithCode = Error & { code?: string };

  const failure: (code: string, message?: string) => ErrorWithCode = (
    code: string,
    message: string = "failed",
  ): ErrorWithCode => {
    const error: ErrorWithCode = new Error(message);
    error.code = code;
    return error;
  };

  test.each([
    [
      "ECONNABORTED",
      "Mattermost did not answer within 12 seconds, so the message may not have been posted.",
    ],
    [
      "ETIMEDOUT",
      "Mattermost did not answer within 12 seconds, so the message may not have been posted.",
    ],
    [
      "ECONNREFUSED",
      "The Mattermost server refused the connection. Check the server and port in Mattermost Incoming Webhook URL.",
    ],
    [
      "ECONNRESET",
      "The connection to the Mattermost server closed before it answered, so the message may not have been posted.",
    ],
    [
      "EHOSTUNREACH",
      "The Mattermost server could not be reached from OneUptime (EHOSTUNREACH).",
    ],
    [
      "ENETUNREACH",
      "The Mattermost server could not be reached from OneUptime (ENETUNREACH).",
    ],
    [
      "ENOTFOUND",
      "The Mattermost server could not be reached from OneUptime (ENOTFOUND).",
    ],
    [
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "The Mattermost server's TLS certificate is not for the server named in Mattermost Incoming Webhook URL.",
    ],
    [
      "CERT_HAS_EXPIRED",
      "The Mattermost server's TLS certificate is not valid now (CERT_HAS_EXPIRED).",
    ],
    [
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "The Mattermost server's TLS certificate is not trusted (DEPTH_ZERO_SELF_SIGNED_CERT). A self-hosted install can trust its own certificate authority with NODE_EXTRA_CA_CERTS.",
    ],
    [
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "The Mattermost server's TLS certificate is not trusted (UNABLE_TO_VERIFY_LEAF_SIGNATURE). A self-hosted install can trust its own certificate authority with NODE_EXTRA_CA_CERTS.",
    ],
    [
      "EPROTO",
      "Could not make a TLS connection to the Mattermost server. If it does not use TLS, Mattermost Incoming Webhook URL starts with http://.",
    ],
    [
      "ERR_FR_MAX_BODY_LENGTH_EXCEEDED",
      "Mattermost's answer was larger than an answer to a webhook can be, so it was not read.",
    ],
    ["ESOMETHINGNEW", "Could not reach the Mattermost server (ESOMETHINGNEW)."],
  ])("%s", (code: string, described: string) => {
    expect(
      MattermostWebhook.describeTransportError(failure(code), 12_000),
    ).toBe(described);
  });

  test("by what the error says, where its code does not tell", () => {
    expect(
      MattermostWebhook.describeTransportError(
        failure("", "timeout of 2500ms exceeded"),
        2500,
      ),
    ).toBe(
      "Mattermost did not answer within 3 seconds, so the message may not have been posted.",
    );
    expect(
      MattermostWebhook.describeTransportError(
        failure("", "maxContentLength size of 65536 exceeded"),
        2500,
      ),
    ).toBe(
      "Mattermost's answer was larger than an answer to a webhook can be, so it was not read.",
    );
    expect(
      MattermostWebhook.describeTransportError(
        failure("", "socket hang up"),
        2500,
      ),
    ).toBe(
      "The connection to the Mattermost server closed before it answered, so the message may not have been posted.",
    );
    expect(
      MattermostWebhook.describeTransportError(
        failure("ERR_SSL_WRONG_VERSION_NUMBER", "...:wrong version number"),
        2500,
      ),
    ).toBe(
      "Could not make a TLS connection to the Mattermost server. If it does not use TLS, Mattermost Incoming Webhook URL starts with http://.",
    );
    expect(MattermostWebhook.describeTransportError("thrown text", 2500)).toBe(
      "Could not reach the Mattermost server.",
    );
    expect(MattermostWebhook.describeTransportError(undefined, 2500)).toBe(
      "Could not reach the Mattermost server.",
    );
  });

  test("never quotes what the error says beyond its code: the URL may be in it", () => {
    const random: SeededRandom = seededRandom(31);
    const codes: Array<string> = [
      "",
      "ECONNREFUSED",
      "EAI_AGAIN",
      "ESOMETHINGNEW",
      "CERT_REVOKED",
    ];

    for (let index: number = 0; index < 200; index++) {
      const code: string = codes[random(codes.length)] as string;
      const described: string = MattermostWebhook.describeTransportError(
        failure(code, `connect failed for https://x.example/hooks/${ID}`),
        random(60_000) + 1000,
      );

      expect(described).not.toContain(ID);
      expect(described).not.toContain("x.example");
    }
  });
});

describe("the step's settings, as the builder shows them", () => {
  const metadata: ComponentMetadata =
    MattermostComponents[0] as ComponentMetadata;

  const argument: (id: string) => Argument = (id: string): Argument => {
    return metadata.arguments.find((candidate: Argument) => {
      return candidate.id === id;
    }) as Argument;
  };

  test("the URL and the text come first and are required; the rest are under More fields", () => {
    expect(
      metadata.arguments.map((candidate: Argument) => {
        return [
          candidate.id,
          candidate.required,
          Boolean(candidate.isAdvanced),
        ];
      }),
    ).toEqual([
      ["webhook-url", true, false],
      ["text", true, false],
      ["channel", false, true],
      ["username", false, true],
      ["icon-url", false, true],
    ]);
  });

  test("the webhook's URL is a credential, hidden in run logs; nothing else is", () => {
    expect(argument("webhook-url").isSensitive).toBe(true);

    for (const id of ["text", "channel", "username", "icon-url"]) {
      expect(Boolean(argument(id).isSensitive)).toBe(false);
    }
  });

  test("the URL's example is a URL the step takes, and the limits are Mattermost's", () => {
    expect(
      MattermostWebhook.getWebhookUrlProblem(
        argument("webhook-url").placeholder as string,
      ),
    ).toBeNull();
    expect(MATTERMOST_MAX_MESSAGE_LENGTH).toBe(16383);
    expect(MATTERMOST_MAX_NAME_LENGTH).toBe(64);
    expect(MATTERMOST_WEBHOOK_ID_LENGTH).toBe(26);
    expect(() => {
      return MattermostWebhook.getIconUrl(
        argument("icon-url").placeholder as string,
      );
    }).not.toThrow();
    expect(
      MattermostWebhook.getChannel(argument("channel").placeholder as string),
    ).toBe(argument("channel").placeholder);
  });
});
