/*
 * Pins MicrosoftTeamsMessageSize: how the Microsoft Teams bot measures a
 * message, how it recognises Teams refusing one as too large, and how it cuts
 * a text reply down to a budget.
 *
 * Issue #4111: in Teams, "create incident" and "create maintenance" answered
 * "Sorry, I encountered an error processing your request. Please try again
 * later." (twice), while "show scheduled maintenance" worked. The two forms
 * listed every monitor, label and on-call policy of the project, and Teams
 * refused the card with HTTP 413 MessageSizeTooBig ("Message size too
 * large."). Teams measures a bot message as UTF-16, two bytes a code unit, so
 * an emoji (a surrogate pair) costs four. The Bot Framework surfaces the
 * refusal as a RestError carrying statusCode 413 and code "MessageSizeTooBig",
 * and that error can come from another JavaScript realm, where instanceof does
 * not work - so it has to be recognised by its fields.
 *
 * Covered here: getSizeInBytes (a string as UTF-16, an object as the JSON that
 * is sent), isMessageTooLargeError / getErrorStatusCode / getErrorCode (every
 * field a refusal can arrive in, and everything that is not a refusal), the
 * budgets themselves, and fitTextToBudget: untouched within the budget; over
 * it, never past the budget, cut at the last line break that fits (a line
 * that ends exactly where the budget ends included) or else between whole
 * characters, and followed by the note when the note fits as well - a note
 * that does not fit is left off, and the whole budget goes to the text. Two
 * sweeps check those promises: a seeded one over hundreds of mixed texts at
 * budgets the note fits in, and one over every budget from nothing upwards.
 *
 * The review of #4111 fixed a bug these tests reported: a whole line that
 * ended exactly where the budget ended was dropped (see "keeps a whole line
 * that ends exactly where the budget ends", which checks the reported
 * example, the same with Windows line endings, and every budget over a reply
 * of lines of different lengths). It also changed what a budget smaller than
 * the note gets: the note used to be returned whole, over the budget; now the
 * text gets the budget (see "gives the whole budget to the text when the note
 * does not fit").
 */

import { describe, expect, test } from "@jest/globals";
import vm from "vm";
import MicrosoftTeamsMessageSize, {
  MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES,
  MICROSOFT_TEAMS_TEXT_MESSAGE_BUDGET_IN_BYTES,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsMessageSize";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";

// The note fitTextToBudget appends when the caller does not bring its own.
const DEFAULT_TRUNCATION_NOTE: string =
  "…\n\n_This reply was shortened to fit in Microsoft Teams. Open OneUptime to see everything._";

// Microsoft: "keep a bot message within 80 KB" (the hard limit is ~100 KB).
const TEAMS_RECOMMENDED_MAX_MESSAGE_BYTES: number = 80 * 1024;

// U+1F600, one character but two UTF-16 code units (a surrogate pair).
const GRINNING_FACE: string = "😀";
const GRINNING_FACE_HIGH_SURROGATE: string = "\uD83D";

/*
 * A string made only of whole characters: no high surrogate without its low
 * half after it, and no low surrogate on its own.
 */
const WELL_FORMED_UTF16: RegExp =
  /^(?:[^\uD800-\uDFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])*$/;

const STARTS_WITH_WHITESPACE: RegExp = /^\s/;

const ENDS_WITH_HIGH_SURROGATE: RegExp = /[\uD800-\uDBFF]$/;

/*
 * What a cut at a line break may drop of the part that fits: blanks, the line
 * break it cut at, and the start of a line that did not fit.
 */
const DROPPED_AT_A_LINE_BREAK: RegExp = /^\s*\n[^\n]*$/;

/*
 * What a cut inside a line may drop of the part that fits: blanks, and the
 * first half of an emoji the budget ends inside.
 */
const DROPPED_MID_LINE: RegExp = /^\s*[\uD800-\uDBFF]?$/;

// mulberry32: a small seeded generator, so a sweep is the same on every run.
function createSeededRandom(seed: number): () => number {
  let state: number = seed;

  return (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed: number = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const TEAMS_MESSAGE_SIZE_TOO_BIG_BODY: JSONObject = {
  error: { code: "MessageSizeTooBig", message: "Message size too large." },
};

interface RestErrorOptions {
  message: string;
  statusCode?: number | undefined;
  code?: string | undefined;
  details?: JSONObject | undefined;
  responseStatus?: number | undefined;
}

/*
 * What the Bot Framework connector throws (@azure/core-rest-pipeline's
 * RestError): an Error named "RestError" with code and statusCode of its own,
 * the parsed error body as details, and the response as a NON-enumerable
 * property, so reading it must not depend on enumeration.
 */
function buildRestError(options: RestErrorOptions): Error {
  const error: Error = new Error(options.message);
  error.name = "RestError";

  Object.assign(error, {
    code: options.code,
    statusCode: options.statusCode,
  });

  if (options.details) {
    Object.assign(error, { details: options.details });
  }

  Object.defineProperty(error, "response", {
    value:
      options.responseStatus === undefined
        ? undefined
        : { status: options.responseStatus },
    enumerable: false,
  });

  return error;
}

// Teams refusing a bot message as too large, as the connector reports it.
function buildTeamsMessageTooLargeError(): Error {
  return buildRestError({
    message: "Message size too large.",
    statusCode: 413,
    code: "MessageSizeTooBig",
    details: TEAMS_MESSAGE_SIZE_TOO_BIG_BODY,
    responseStatus: 413,
  });
}

/*
 * The same refusal created in another JavaScript realm (a vm context), where
 * `error instanceof Error` is false in this realm.
 */
function buildTeamsMessageTooLargeErrorFromAnotherRealm(): unknown {
  return vm.runInNewContext(`
    const error = new Error("Message size too large.");
    error.name = "RestError";
    error.code = "MessageSizeTooBig";
    error.statusCode = 413;
    error.details = {
      error: { code: "MessageSizeTooBig", message: "Message size too large." },
    };
    Object.defineProperty(error, "response", {
      value: { status: 413 },
      enumerable: false,
    });
    error;
  `);
}

interface ErrorCase {
  description: string;
  error: unknown;
}

const TOO_LARGE_ERRORS: Array<ErrorCase> = [
  {
    description:
      "the connector's RestError (413, MessageSizeTooBig, parsed body, response)",
    error: buildTeamsMessageTooLargeError(),
  },
  {
    description: "the same RestError as a plain object",
    error: {
      name: "RestError",
      message: "Message size too large.",
      statusCode: 413,
      code: "MessageSizeTooBig",
      details: TEAMS_MESSAGE_SIZE_TOO_BIG_BODY,
    },
  },
  {
    description: "the RestError created in another JavaScript realm",
    error: buildTeamsMessageTooLargeErrorFromAnotherRealm(),
  },
  {
    description: "an error with only statusCode 413",
    error: { statusCode: 413 },
  },
  {
    description:
      "an error with only response.status 413 (a proxy answered 413 with a body that is not JSON)",
    error: { response: { status: 413 } },
  },
  {
    description:
      "a RestError whose only status is its non-enumerable response.status 413",
    error: buildRestError({
      message: "<html><body>413 Request Entity Too Large</body></html>",
      responseStatus: 413,
    }),
  },
  {
    description: "an error with only details.error.code MessageSizeTooBig",
    error: { details: { error: { code: "MessageSizeTooBig" } } },
  },
  {
    description: "an error with only code MessageSizeTooBig",
    error: { code: "MessageSizeTooBig" },
  },
  {
    description: "status 413 with a code other than MessageSizeTooBig",
    error: { statusCode: 413, code: "RequestEntityTooLarge" },
  },
  {
    description: "code MessageSizeTooBig with a status other than 413",
    error: { statusCode: 400, code: "MessageSizeTooBig" },
  },
];

const OTHER_ERRORS: Array<ErrorCase> = [
  {
    description: "a 400 RestError",
    error: buildRestError({
      message: "The activity is missing a required field.",
      statusCode: 400,
      code: "BadSyntax",
      responseStatus: 400,
    }),
  },
  {
    description:
      "a 403 RestError (the bot was removed from the conversation roster)",
    error: buildRestError({
      message: "The bot is not part of the conversation roster.",
      statusCode: 403,
      code: "BotNotInConversationRoster",
      responseStatus: 403,
    }),
  },
  {
    description: "a 404 RestError",
    error: buildRestError({
      message: "Conversation not found.",
      statusCode: 404,
      code: "ConversationNotFound",
      responseStatus: 404,
    }),
  },
  {
    description: "a 500 RestError",
    error: buildRestError({
      message: "Internal server error.",
      statusCode: 500,
      code: "InternalServerError",
      responseStatus: 500,
    }),
  },
  {
    description: "a RestError for a request that never reached Teams",
    error: buildRestError({
      message: "getaddrinfo ENOTFOUND smba.trafficmanager.net",
      code: "REQUEST_SEND_ERROR",
    }),
  },
  {
    description: "a plain Error",
    error: new Error("Something went wrong."),
  },
  {
    description:
      "an error that says it is too large only in its message (the text is not read)",
    error: new Error("Message size too large."),
  },
  {
    description: "a Node system error (string code, no status)",
    error: Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    }),
  },
  {
    description:
      "a OneUptime BadDataException (its numeric code is not an HTTP status)",
    error: new BadDataException("Title is required."),
  },
  {
    description: "a status of 413 given as a string",
    error: { statusCode: "413", response: { status: "413" } },
  },
  {
    description: "an empty object",
    error: {},
  },
  { description: "null", error: null },
  { description: "undefined", error: undefined },
  { description: "the string MessageSizeTooBig", error: "MessageSizeTooBig" },
  { description: "the number 413", error: 413 },
  { description: "true", error: true },
];

describe("MicrosoftTeamsMessageSize.getSizeInBytes", () => {
  test("counts two bytes for every UTF-16 code unit of a string", () => {
    expect(MicrosoftTeamsMessageSize.getSizeInBytes("")).toBe(0);
    expect(MicrosoftTeamsMessageSize.getSizeInBytes("hello")).toBe(10);
  });

  test("counts an accented Latin letter as one code unit", () => {
    // "é" is U+00E9: one UTF-16 unit, two UTF-8 bytes.
    expect(MicrosoftTeamsMessageSize.getSizeInBytes("héllo")).toBe(10);
  });

  test("counts CJK characters as UTF-16, not UTF-8", () => {
    const text: string = "漢字テスト";

    expect(MicrosoftTeamsMessageSize.getSizeInBytes(text)).toBe(10);
    // The same text is 15 bytes as UTF-8; Teams counts UTF-16.
    expect(Buffer.byteLength(text, "utf8")).toBe(15);
  });

  test("counts an emoji (a surrogate pair) as two code units, four bytes", () => {
    expect(GRINNING_FACE.length).toBe(2);
    expect(MicrosoftTeamsMessageSize.getSizeInBytes(GRINNING_FACE)).toBe(4);
  });

  test("counts every code unit of a composed emoji", () => {
    // Thumbs up + medium skin tone: two surrogate pairs.
    expect(MicrosoftTeamsMessageSize.getSizeInBytes("👍🏽")).toBe(8);

    // Man, ZWJ, woman, ZWJ, girl: three surrogate pairs and two joiners.
    expect(MicrosoftTeamsMessageSize.getSizeInBytes("👨‍👩‍👧")).toBe(16);
  });

  test("measures a string as it is, without JSON-encoding it", () => {
    expect(MicrosoftTeamsMessageSize.getSizeInBytes('say "hi"')).toBe(16);
  });

  test("measures an object as its JSON", () => {
    expect(MicrosoftTeamsMessageSize.getSizeInBytes({})).toBe(4);
    // '{"text":"hello"}' is 16 code units.
    expect(MicrosoftTeamsMessageSize.getSizeInBytes({ text: "hello" })).toBe(
      32,
    );
  });

  test("measures non-ASCII text in an object as UTF-16 code units", () => {
    // '{"title":"漢字"}' is 14 code units.
    expect(MicrosoftTeamsMessageSize.getSizeInBytes({ title: "漢字" })).toBe(
      28,
    );
    // '{"t":"<emoji>"}' is 10 code units: the emoji counts twice.
    expect(MicrosoftTeamsMessageSize.getSizeInBytes({ t: GRINNING_FACE })).toBe(
      20,
    );
  });

  test("counts the escapes JSON adds, as they are sent", () => {
    const card: JSONObject = { text: 'say "hi"\n' };

    // '{"text":"say \"hi\"\n"}' is 23 code units: each escape adds one.
    expect(MicrosoftTeamsMessageSize.getSizeInBytes(card)).toBe(46);
    expect(MicrosoftTeamsMessageSize.getSizeInBytes(card)).toBe(
      JSON.stringify(card).length * 2,
    );
  });

  test("leaves out undefined fields, as the JSON sent to Teams does", () => {
    const block: JSONObject = {
      type: "TextBlock",
      text: "hello",
      color: undefined,
    };

    // '{"type":"TextBlock","text":"hello"}' is 35 code units.
    expect(MicrosoftTeamsMessageSize.getSizeInBytes(block)).toBe(70);
  });

  test("measures a whole adaptive card as the JSON sent to Teams", () => {
    const card: JSONObject = {
      type: "AdaptiveCard",
      version: "1.4",
      body: [
        { type: "TextBlock", text: `Create incident ${GRINNING_FACE}` },
        {
          type: "Input.ChoiceSet",
          id: "incidentMonitors",
          isMultiSelect: true,
          choices: [
            { title: "API - 東京", value: "monitor-1" },
            { title: "Checkout", value: "monitor-2" },
          ],
        },
      ],
    };

    expect(MicrosoftTeamsMessageSize.getSizeInBytes(card)).toBe(
      JSON.stringify(card).length * 2,
    );
  });
});

describe("MicrosoftTeamsMessageSize.isMessageTooLargeError", () => {
  for (const errorCase of TOO_LARGE_ERRORS) {
    test(`is true for ${errorCase.description}`, () => {
      expect(
        MicrosoftTeamsMessageSize.isMessageTooLargeError(errorCase.error),
      ).toBe(true);
    });
  }

  for (const errorCase of OTHER_ERRORS) {
    test(`is false for ${errorCase.description}`, () => {
      expect(
        MicrosoftTeamsMessageSize.isMessageTooLargeError(errorCase.error),
      ).toBe(false);
    });
  }

  test("does not depend on instanceof: the other realm's error is no Error here", () => {
    const foreignError: unknown =
      buildTeamsMessageTooLargeErrorFromAnotherRealm();

    expect(foreignError instanceof Error).toBe(false);
    expect(MicrosoftTeamsMessageSize.isMessageTooLargeError(foreignError)).toBe(
      true,
    );
  });
});

describe("MicrosoftTeamsMessageSize.getErrorStatusCode", () => {
  test("reads statusCode", () => {
    expect(
      MicrosoftTeamsMessageSize.getErrorStatusCode(
        buildTeamsMessageTooLargeError(),
      ),
    ).toBe(413);
  });

  test("prefers statusCode over response.status", () => {
    expect(
      MicrosoftTeamsMessageSize.getErrorStatusCode({
        statusCode: 502,
        response: { status: 413 },
      }),
    ).toBe(502);
  });

  test("falls back to response.status, enumerable or not", () => {
    expect(
      MicrosoftTeamsMessageSize.getErrorStatusCode({
        response: { status: 403 },
      }),
    ).toBe(403);
    expect(
      MicrosoftTeamsMessageSize.getErrorStatusCode(
        buildRestError({ message: "Forbidden", responseStatus: 403 }),
      ),
    ).toBe(403);
  });

  test("ignores a statusCode that is not a number and reads response.status", () => {
    expect(
      MicrosoftTeamsMessageSize.getErrorStatusCode({
        statusCode: "413",
        response: { status: 404 },
      }),
    ).toBe(404);
    expect(
      MicrosoftTeamsMessageSize.getErrorStatusCode({
        statusCode: null,
        response: { status: 404 },
      }),
    ).toBe(404);
  });

  test("is undefined when no field holds a number", () => {
    expect(
      MicrosoftTeamsMessageSize.getErrorStatusCode({
        statusCode: "413",
        response: { status: "413" },
      }),
    ).toBeUndefined();
    expect(
      MicrosoftTeamsMessageSize.getErrorStatusCode({ response: null }),
    ).toBeUndefined();
    expect(
      MicrosoftTeamsMessageSize.getErrorStatusCode({ response: "413" }),
    ).toBeUndefined();
    expect(MicrosoftTeamsMessageSize.getErrorStatusCode({})).toBeUndefined();
  });

  test("does not read a OneUptime exception's numeric code as a status", () => {
    expect(
      MicrosoftTeamsMessageSize.getErrorStatusCode(
        new BadDataException("Title is required."),
      ),
    ).toBeUndefined();
  });

  test("is undefined for anything that is not an object", () => {
    expect(MicrosoftTeamsMessageSize.getErrorStatusCode(null)).toBeUndefined();
    expect(
      MicrosoftTeamsMessageSize.getErrorStatusCode(undefined),
    ).toBeUndefined();
    expect(MicrosoftTeamsMessageSize.getErrorStatusCode(413)).toBeUndefined();
    expect(MicrosoftTeamsMessageSize.getErrorStatusCode("413")).toBeUndefined();
    expect(MicrosoftTeamsMessageSize.getErrorStatusCode(true)).toBeUndefined();
  });
});

describe("MicrosoftTeamsMessageSize.getErrorCode", () => {
  test("reads code", () => {
    expect(
      MicrosoftTeamsMessageSize.getErrorCode(buildTeamsMessageTooLargeError()),
    ).toBe("MessageSizeTooBig");
  });

  test("prefers code over details.error.code", () => {
    expect(
      MicrosoftTeamsMessageSize.getErrorCode({
        code: "BotNotInConversationRoster",
        details: { error: { code: "MessageSizeTooBig" } },
      }),
    ).toBe("BotNotInConversationRoster");
  });

  test("falls back to details.error.code when code is missing, empty or not a string", () => {
    expect(
      MicrosoftTeamsMessageSize.getErrorCode({
        details: { error: { code: "MessageSizeTooBig" } },
      }),
    ).toBe("MessageSizeTooBig");
    expect(
      MicrosoftTeamsMessageSize.getErrorCode({
        code: "",
        details: { error: { code: "MessageSizeTooBig" } },
      }),
    ).toBe("MessageSizeTooBig");
    expect(
      MicrosoftTeamsMessageSize.getErrorCode({
        code: 413,
        details: { error: { code: "MessageSizeTooBig" } },
      }),
    ).toBe("MessageSizeTooBig");
  });

  test("is undefined when no field holds a non-empty string", () => {
    expect(
      MicrosoftTeamsMessageSize.getErrorCode({
        code: 413,
        details: { error: { code: 413 } },
      }),
    ).toBeUndefined();
    expect(
      MicrosoftTeamsMessageSize.getErrorCode({
        code: "",
        details: { error: { code: "" } },
      }),
    ).toBeUndefined();
    expect(
      MicrosoftTeamsMessageSize.getErrorCode({ details: null }),
    ).toBeUndefined();
    expect(
      MicrosoftTeamsMessageSize.getErrorCode({ details: { error: null } }),
    ).toBeUndefined();
    expect(
      MicrosoftTeamsMessageSize.getErrorCode({ details: "MessageSizeTooBig" }),
    ).toBeUndefined();
    expect(MicrosoftTeamsMessageSize.getErrorCode({})).toBeUndefined();
  });

  test("reads the code of a Node system error", () => {
    expect(
      MicrosoftTeamsMessageSize.getErrorCode(
        Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
      ),
    ).toBe("ECONNRESET");
  });

  test("does not read a OneUptime exception's numeric code as a Bot Framework code", () => {
    expect(
      MicrosoftTeamsMessageSize.getErrorCode(
        new BadDataException("Title is required."),
      ),
    ).toBeUndefined();
  });

  test("is undefined for anything that is not an object", () => {
    expect(MicrosoftTeamsMessageSize.getErrorCode(null)).toBeUndefined();
    expect(MicrosoftTeamsMessageSize.getErrorCode(undefined)).toBeUndefined();
    expect(
      MicrosoftTeamsMessageSize.getErrorCode("MessageSizeTooBig"),
    ).toBeUndefined();
    expect(MicrosoftTeamsMessageSize.getErrorCode(413)).toBeUndefined();
  });
});

describe("Microsoft Teams size budgets", () => {
  test("a card is tried at 40 KiB, then 20 KiB, then with every optional list left off", () => {
    expect(MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES).toEqual([
      40 * 1024,
      20 * 1024,
      0,
    ]);
  });

  test("each card budget is smaller than the one before and within what Teams recommends", () => {
    MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES.forEach(
      (budgetInBytes: number, index: number) => {
        expect(budgetInBytes).toBeLessThanOrEqual(
          TEAMS_RECOMMENDED_MAX_MESSAGE_BYTES,
        );

        if (index > 0) {
          expect(budgetInBytes).toBeLessThan(
            MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES[index - 1] as number,
          );
        }
      },
    );
  });

  test("a text reply is kept to 40 KiB, within what Teams recommends", () => {
    expect(MICROSOFT_TEAMS_TEXT_MESSAGE_BUDGET_IN_BYTES).toBe(40 * 1024);
    expect(MICROSOFT_TEAMS_TEXT_MESSAGE_BUDGET_IN_BYTES).toBeLessThanOrEqual(
      TEAMS_RECOMMENDED_MAX_MESSAGE_BYTES,
    );
  });
});

describe("MicrosoftTeamsMessageSize.fitTextToBudget", () => {
  // Code units the default budget holds.
  const DEFAULT_BUDGET_IN_UNITS: number =
    MICROSOFT_TEAMS_TEXT_MESSAGE_BUDGET_IN_BYTES / 2;

  // A reply like "show active incidents" for a big project: one line each.
  function buildListReply(lineCount: number): string {
    const lines: Array<string> = [];

    for (let index: number = 0; index < lineCount; index++) {
      lines.push(`- Monitor ${String(index).padStart(4, "0")} is operational`);
    }

    return lines.join("\n");
  }

  test("returns a text within the budget as it is", () => {
    const text: string = "**Active incidents**\n\n- API is down\n- DB is slow";

    expect(MicrosoftTeamsMessageSize.fitTextToBudget({ text: text })).toBe(
      text,
    );
    expect(MicrosoftTeamsMessageSize.fitTextToBudget({ text: "" })).toBe("");
  });

  test("returns a text exactly the size of the default budget as it is", () => {
    const text: string = "x".repeat(DEFAULT_BUDGET_IN_UNITS);

    expect(MicrosoftTeamsMessageSize.getSizeInBytes(text)).toBe(
      MICROSOFT_TEAMS_TEXT_MESSAGE_BUDGET_IN_BYTES,
    );
    expect(MicrosoftTeamsMessageSize.fitTextToBudget({ text: text })).toBe(
      text,
    );
  });

  test("shortens a text one code unit over the default budget to exactly the budget", () => {
    const text: string = "x".repeat(DEFAULT_BUDGET_IN_UNITS + 1);

    const fitted: string = MicrosoftTeamsMessageSize.fitTextToBudget({
      text: text,
    });

    expect(fitted).toBe(
      "x".repeat(DEFAULT_BUDGET_IN_UNITS - DEFAULT_TRUNCATION_NOTE.length) +
        DEFAULT_TRUNCATION_NOTE,
    );
    expect(MicrosoftTeamsMessageSize.getSizeInBytes(fitted)).toBe(
      MICROSOFT_TEAMS_TEXT_MESSAGE_BUDGET_IN_BYTES,
    );
  });

  test("treats an explicit undefined budget and note as the defaults", () => {
    const withinBudget: string = "x".repeat(DEFAULT_BUDGET_IN_UNITS);
    const overBudget: string = "x".repeat(DEFAULT_BUDGET_IN_UNITS + 1);

    expect(
      MicrosoftTeamsMessageSize.fitTextToBudget({
        text: withinBudget,
        budgetInBytes: undefined,
        truncationNote: undefined,
      }),
    ).toBe(withinBudget);
    expect(
      MicrosoftTeamsMessageSize.fitTextToBudget({
        text: overBudget,
        budgetInBytes: undefined,
        truncationNote: undefined,
      }),
    ).toBe(MicrosoftTeamsMessageSize.fitTextToBudget({ text: overBudget }));
  });

  test("cuts a long reply at the last whole line that fits, then adds the default note", () => {
    const text: string = buildListReply(3000);
    expect(MicrosoftTeamsMessageSize.getSizeInBytes(text)).toBeGreaterThan(
      MICROSOFT_TEAMS_TEXT_MESSAGE_BUDGET_IN_BYTES,
    );

    const fitted: string = MicrosoftTeamsMessageSize.fitTextToBudget({
      text: text,
    });

    expect(
      MicrosoftTeamsMessageSize.getSizeInBytes(fitted),
    ).toBeLessThanOrEqual(MICROSOFT_TEAMS_TEXT_MESSAGE_BUDGET_IN_BYTES);
    expect(fitted.endsWith(DEFAULT_TRUNCATION_NOTE)).toBe(true);

    const kept: string = fitted.substring(
      0,
      fitted.length - DEFAULT_TRUNCATION_NOTE.length,
    );

    // A prefix of the reply that ends exactly where a line ends.
    expect(text.startsWith(kept)).toBe(true);
    expect(text.charAt(kept.length)).toBe("\n");
    expect(kept.endsWith("is operational")).toBe(true);

    // The longest such prefix: the next whole line would not have fitted.
    const nextLineEnd: number = text.indexOf("\n", kept.length + 1);
    expect(nextLineEnd + DEFAULT_TRUNCATION_NOTE.length).toBeGreaterThan(
      DEFAULT_BUDGET_IN_UNITS,
    );
  });

  test("honours a custom budget and note", () => {
    const lines: Array<string> = [];
    for (let index: number = 1; index <= 30; index++) {
      lines.push(`line ${String(index).padStart(2, "0")}`);
    }
    const text: string = lines.join("\n");

    /*
     * 200 bytes hold 100 code units: 99 for the text and one for the note.
     * The first 99 units end inside "line 13", so the cut falls after
     * "line 12".
     */
    const fitted: string = MicrosoftTeamsMessageSize.fitTextToBudget({
      text: text,
      budgetInBytes: 200,
      truncationNote: "…",
    });

    expect(fitted).toBe(lines.slice(0, 12).join("\n") + "…");
    expect(fitted).not.toContain("_This reply was shortened");
    expect(
      MicrosoftTeamsMessageSize.getSizeInBytes(fitted),
    ).toBeLessThanOrEqual(200);
  });

  test("keeps a text exactly the size of a custom budget as it is", () => {
    const text: string = GRINNING_FACE.repeat(25);

    expect(
      MicrosoftTeamsMessageSize.fitTextToBudget({
        text: text,
        budgetInBytes: 100,
      }),
    ).toBe(text);
  });

  test("reads an explicit budget of 0 as no room at all, not as the default", () => {
    expect(
      MicrosoftTeamsMessageSize.fitTextToBudget({ text: "", budgetInBytes: 0 }),
    ).toBe("");
    // With no note either, nothing of the text is kept.
    expect(
      MicrosoftTeamsMessageSize.fitTextToBudget({
        text: "hello",
        budgetInBytes: 0,
        truncationNote: "",
      }),
    ).toBe("");
  });

  test("rounds an odd budget down to whole code units", () => {
    // 101 bytes hold 50 code units.
    expect(
      MicrosoftTeamsMessageSize.fitTextToBudget({
        text: "x".repeat(50),
        budgetInBytes: 101,
        truncationNote: "…",
      }),
    ).toBe("x".repeat(50));

    const fitted: string = MicrosoftTeamsMessageSize.fitTextToBudget({
      text: "x".repeat(51),
      budgetInBytes: 101,
      truncationNote: "…",
    });

    expect(fitted).toBe("x".repeat(49) + "…");
    expect(MicrosoftTeamsMessageSize.getSizeInBytes(fitted)).toBe(100);
  });

  test("cuts a single line longer than the budget where the budget ends", () => {
    expect(
      MicrosoftTeamsMessageSize.fitTextToBudget({
        text: "x".repeat(1000),
        budgetInBytes: 100,
        truncationNote: "…",
      }),
    ).toBe("x".repeat(49) + "…");
  });

  test("cuts a first line longer than the budget where the budget ends, whatever line breaks follow", () => {
    // Only a line break within the part that fits can be cut at.
    expect(
      MicrosoftTeamsMessageSize.fitTextToBudget({
        text: "x".repeat(60) + "\nsecond line\nthird line",
        budgetInBytes: 100,
        truncationNote: "…",
      }),
    ).toBe("x".repeat(49) + "…");
  });

  /*
   * Pins the fix for a bug reported with these tests. The cut used to look
   * for a line break only in the code units before the cut, so a line break
   * sitting exactly at the cut was not seen, and the whole line before it,
   * which fits, was dropped as well: at the default budget, a "show active
   * incidents" style reply lost a line for nothing whenever a line happened
   * to end right at the budget. The line break is now looked for up to and
   * including the cut.
   */
  test("keeps a whole line that ends exactly where the budget ends", () => {
    // Code units the default budget leaves for the text before the note.
    const unitsForText: number =
      DEFAULT_BUDGET_IN_UNITS - DEFAULT_TRUNCATION_NOTE.length;

    /*
     * A 20-unit header and its line break, then 30-unit lines (29 characters
     * and a line break): the line break after line 678 sits at unit 20390,
     * exactly where the budget ends.
     */
    const reply: string = "**Active incidents**\n" + buildListReply(3000);
    expect(reply.charAt(unitsForText)).toBe("\n");
    expect(reply.substring(unitsForText - 29, unitsForText)).toBe(
      "- Monitor 0678 is operational",
    );

    const fitted: string = MicrosoftTeamsMessageSize.fitTextToBudget({
      text: reply,
    });
    const kept: string = fitted.substring(
      0,
      fitted.length - DEFAULT_TRUNCATION_NOTE.length,
    );

    // Line 678 fits, so it is the last line kept.
    expect(kept.substring(kept.length - 29)).toBe(
      "- Monitor 0678 is operational",
    );
    expect(MicrosoftTeamsMessageSize.getSizeInBytes(fitted)).toBe(
      MICROSOFT_TEAMS_TEXT_MESSAGE_BUDGET_IN_BYTES,
    );

    // The same at a small budget: 40 bytes hold 19 units of text and the note.
    expect(
      MicrosoftTeamsMessageSize.fitTextToBudget({
        text: "abcdefghi\nabcdefghi\nzzzzzzzzzz",
        budgetInBytes: 40,
        truncationNote: "…",
      }),
    ).toBe("abcdefghi\nabcdefghi…");

    // With Windows line endings: the "\r" before the cut goes, the line stays.
    expect(
      MicrosoftTeamsMessageSize.fitTextToBudget({
        text: "abcdefgh\r\nabcdefgh\r\nzzzz",
        budgetInBytes: 40,
        truncationNote: "…",
      }),
    ).toBe("abcdefgh\r\nabcdefgh…");

    /*
     * And at every budget, over lines of 1 to 13 letters: once the first line
     * fits, the reply is cut at a line break, and the line after the cut
     * would not have fitted with the note. Before that, the first line is cut
     * where the budget ends.
     */
    const lines: Array<string> = [];
    for (let index: number = 0; index < 40; index++) {
      lines.push("abcdefghijklm".substring(0, 1 + ((index * 7 + 12) % 13)));
    }
    const text: string = lines.join("\n");
    const firstLineEnd: number = text.indexOf("\n");
    const violations: Array<string> = [];

    for (
      let budgetInBytes: number = 2;
      budgetInBytes < MicrosoftTeamsMessageSize.getSizeInBytes(text);
      budgetInBytes++
    ) {
      // Code units this budget leaves for the text before the one-unit note.
      const unitsLeft: number = Math.floor(budgetInBytes / 2) - 1;
      const shortened: string = MicrosoftTeamsMessageSize.fitTextToBudget({
        text: text,
        budgetInBytes: budgetInBytes,
        truncationNote: "…",
      });
      const keptText: string = shortened.substring(0, shortened.length - 1);

      if (
        !shortened.endsWith("…") ||
        MicrosoftTeamsMessageSize.getSizeInBytes(shortened) > budgetInBytes
      ) {
        violations.push(
          `budget ${budgetInBytes}: ${JSON.stringify(shortened)}`,
        );
        continue;
      }

      if (firstLineEnd > unitsLeft) {
        if (keptText !== text.substring(0, unitsLeft)) {
          violations.push(
            `budget ${budgetInBytes}: the first line was not cut where the budget ends`,
          );
        }
        continue;
      }

      if (!text.startsWith(keptText) || text.charAt(keptText.length) !== "\n") {
        violations.push(`budget ${budgetInBytes}: cut inside a line`);
        continue;
      }

      const nextLineEnd: number = text.indexOf("\n", keptText.length + 1);
      if ((nextLineEnd === -1 ? text.length : nextLineEnd) <= unitsLeft) {
        violations.push(
          `budget ${budgetInBytes}: dropped ${JSON.stringify(
            text.substring(keptText.length + 1, nextLineEnd),
          )}, which fits`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  test("holds its promises for any mix of text, budget and note", () => {
    /*
     * A seeded sweep over replies made of ASCII, accented and CJK letters,
     * emoji (surrogate pairs), spaces, tabs and both kinds of line break, with
     * budgets on both sides of the text's size. For every one: a text within
     * the budget comes back as it is; a longer one comes back within the
     * budget as a prefix of the text, without trailing whitespace, followed
     * by the note; never with half an emoji; cut at a line break whenever the
     * part that fits has one; and fitting it again changes nothing.
     */
    const random: () => number = createSeededRandom(4111);
    const pieces: Array<string> = [
      "a",
      "Z",
      "7",
      " ",
      "\t",
      "\n",
      "\r\n",
      "é",
      "漢",
      "字",
      GRINNING_FACE,
      "👍🏽",
      "- Monitor 0042 is operational",
      "**Active incidents**",
    ];
    const notes: Array<string | undefined> = [undefined, "…", "\n[shortened]"];
    const violations: Array<string> = [];
    let shortenedCount: number = 0;
    let lineBreakCutCount: number = 0;

    for (let caseIndex: number = 0; caseIndex < 400; caseIndex++) {
      let text: string = "";
      const pieceCount: number = Math.floor(random() * 700);

      for (let index: number = 0; index < pieceCount; index++) {
        text += pieces[Math.floor(random() * pieces.length)] as string;
      }

      const truncationNote: string | undefined =
        notes[Math.floor(random() * notes.length)];
      const note: string = truncationNote ?? DEFAULT_TRUNCATION_NOTE;
      const textSizeInBytes: number =
        MicrosoftTeamsMessageSize.getSizeInBytes(text);
      /*
       * A quarter of the budgets hold the whole text; the others range from
       * the smallest budget the note fits in upwards.
       */
      const budgetInBytes: number =
        random() < 0.25
          ? Math.max(textSizeInBytes, note.length * 2) +
            Math.floor(random() * 40)
          : note.length * 2 + Math.floor(random() * textSizeInBytes);

      const fitted: string = MicrosoftTeamsMessageSize.fitTextToBudget({
        text: text,
        budgetInBytes: budgetInBytes,
        truncationNote: truncationNote,
      });

      const report: (rule: string) => void = (rule: string): void => {
        violations.push(
          `case ${caseIndex} (budget ${budgetInBytes}, note ${JSON.stringify(
            note,
          )}): ${rule}; text starts ${JSON.stringify(text.substring(0, 60))}`,
        );
      };

      if (textSizeInBytes <= budgetInBytes) {
        if (fitted !== text) {
          report("a text within the budget was changed");
        }
        continue;
      }

      shortenedCount++;
      const kept: string = fitted.substring(0, fitted.length - note.length);

      if (MicrosoftTeamsMessageSize.getSizeInBytes(fitted) > budgetInBytes) {
        report("the result is over the budget");
      }

      if (!fitted.endsWith(note)) {
        report("the result does not end with the note");
      }

      if (!text.startsWith(kept)) {
        report("the kept part is not a prefix of the text");
      }

      if (kept !== kept.trimEnd()) {
        report("the kept part ends with whitespace");
      }

      if (!WELL_FORMED_UTF16.test(fitted)) {
        report("the result has half of a surrogate pair");
      }

      const unitsForText: number = Math.floor(budgetInBytes / 2) - note.length;

      if (text.substring(0, unitsForText).lastIndexOf("\n") > 0) {
        lineBreakCutCount++;

        // At the cut the text goes on with the line break (or blanks before it).
        if (!STARTS_WITH_WHITESPACE.test(text.substring(kept.length))) {
          report("the text was cut inside a line");
        }
      }

      if (
        MicrosoftTeamsMessageSize.fitTextToBudget({
          text: fitted,
          budgetInBytes: budgetInBytes,
          truncationNote: truncationNote,
        }) !== fitted
      ) {
        report("fitting the result again changed it");
      }
    }

    expect(violations).toEqual([]);
    // The sweep went down every path: kept as it is, cut, cut at a line break.
    expect(shortenedCount).toBeGreaterThan(150);
    expect(400 - shortenedCount).toBeGreaterThan(50);
    expect(lineBreakCutCount).toBeGreaterThan(100);
  });

  test("cuts CJK text by code units", () => {
    const fitted: string = MicrosoftTeamsMessageSize.fitTextToBudget({
      text: "漢".repeat(100),
      budgetInBytes: 42,
      truncationNote: "…",
    });

    expect(fitted).toBe("漢".repeat(20) + "…");
    expect(MicrosoftTeamsMessageSize.getSizeInBytes(fitted)).toBe(42);
  });

  test("never splits an emoji when the cut falls between its two halves", () => {
    /*
     * 100 bytes hold 50 code units, 49 for the text: 48 letters and the first
     * half of the emoji. That half is dropped.
     */
    const text: string = "a".repeat(48) + GRINNING_FACE.repeat(10);

    const fitted: string = MicrosoftTeamsMessageSize.fitTextToBudget({
      text: text,
      budgetInBytes: 100,
      truncationNote: "…",
    });

    expect(fitted).toBe("a".repeat(48) + "…");
    expect(fitted).not.toContain(GRINNING_FACE_HIGH_SURROGATE);
    expect(fitted).toMatch(WELL_FORMED_UTF16);
  });

  test("keeps an emoji whose two halves both fit", () => {
    const text: string = "a".repeat(47) + GRINNING_FACE.repeat(10);

    const fitted: string = MicrosoftTeamsMessageSize.fitTextToBudget({
      text: text,
      budgetInBytes: 100,
      truncationNote: "…",
    });

    expect(fitted).toBe("a".repeat(47) + GRINNING_FACE + "…");
    expect(fitted).toMatch(WELL_FORMED_UTF16);
  });

  test("cuts a text of nothing but emoji between whole emoji", () => {
    const text: string = GRINNING_FACE.repeat(1000);

    // 11 units for the text: five emoji and half of the sixth.
    const odd: string = MicrosoftTeamsMessageSize.fitTextToBudget({
      text: text,
      budgetInBytes: 24,
      truncationNote: "…",
    });
    // 10 units for the text: exactly five emoji.
    const even: string = MicrosoftTeamsMessageSize.fitTextToBudget({
      text: text,
      budgetInBytes: 22,
      truncationNote: "…",
    });

    expect(odd).toBe(GRINNING_FACE.repeat(5) + "…");
    expect(even).toBe(GRINNING_FACE.repeat(5) + "…");
    expect(odd).toMatch(WELL_FORMED_UTF16);
    expect(even).toMatch(WELL_FORMED_UTF16);
  });

  test("never splits an emoji with the default note either", () => {
    const text: string =
      "a".repeat(DEFAULT_BUDGET_IN_UNITS - DEFAULT_TRUNCATION_NOTE.length - 1) +
      GRINNING_FACE.repeat(100);

    const fitted: string = MicrosoftTeamsMessageSize.fitTextToBudget({
      text: text,
    });

    expect(fitted).toBe(
      "a".repeat(DEFAULT_BUDGET_IN_UNITS - DEFAULT_TRUNCATION_NOTE.length - 1) +
        DEFAULT_TRUNCATION_NOTE,
    );
    expect(fitted).toMatch(WELL_FORMED_UTF16);
  });

  test("drops trailing whitespace and blank lines before the note", () => {
    const text: string = "first line   \r\n\r\n\r\n" + "y".repeat(500);

    expect(
      MicrosoftTeamsMessageSize.fitTextToBudget({
        text: text,
        budgetInBytes: 100,
        truncationNote: "…",
      }),
    ).toBe("first line…");
  });

  test("does not cut at a line break at the very start, which would keep nothing", () => {
    expect(
      MicrosoftTeamsMessageSize.fitTextToBudget({
        text: "\n" + "x".repeat(300),
        budgetInBytes: 100,
        truncationNote: "…",
      }),
    ).toBe("\n" + "x".repeat(48) + "…");
  });

  test("gives the whole budget to the text when the note does not fit", () => {
    /*
     * A reply over the budget is one Teams may refuse, so a note that does
     * not fit is left off rather than sent whole. No caller passes a budget
     * this small: the text replies use the 40 KiB default, which the note
     * always fits in.
     */
    // 10 bytes hold 5 code units, and the default note is far longer.
    const withoutDefaultNote: string =
      MicrosoftTeamsMessageSize.fitTextToBudget({
        text: "x".repeat(100),
        budgetInBytes: 10,
      });

    expect(withoutDefaultNote).toBe("xxxxx");
    expect(MicrosoftTeamsMessageSize.getSizeInBytes(withoutDefaultNote)).toBe(
      10,
    );

    // 4 bytes hold 2 code units, and "…more" needs 5.
    expect(
      MicrosoftTeamsMessageSize.fitTextToBudget({
        text: "x".repeat(100),
        budgetInBytes: 4,
        truncationNote: "…more",
      }),
    ).toBe("xx");
  });

  test("adds a note that fits exactly, although it leaves no room for the text", () => {
    // 10 bytes hold 5 code units: "[cut]" fits, with nothing left over.
    expect(
      MicrosoftTeamsMessageSize.fitTextToBudget({
        text: "x".repeat(100),
        budgetInBytes: 10,
        truncationNote: "[cut]",
      }),
    ).toBe("[cut]");

    // One code unit more is one for the text.
    expect(
      MicrosoftTeamsMessageSize.fitTextToBudget({
        text: "x".repeat(100),
        budgetInBytes: 12,
        truncationNote: "[cut]",
      }),
    ).toBe("x[cut]");

    // A note one code unit longer does not fit, and the text gets all five.
    expect(
      MicrosoftTeamsMessageSize.fitTextToBudget({
        text: "x".repeat(100),
        budgetInBytes: 10,
        truncationNote: "[cut!]",
      }),
    ).toBe("xxxxx");
  });

  test("keeps nothing, not even the note, at a budget that holds no code unit", () => {
    for (const budgetInBytes of [0, 1]) {
      expect(
        MicrosoftTeamsMessageSize.fitTextToBudget({
          text: "hello",
          budgetInBytes: budgetInBytes,
        }),
      ).toBe("");
      expect(
        MicrosoftTeamsMessageSize.fitTextToBudget({
          text: "hello",
          budgetInBytes: budgetInBytes,
          truncationNote: "…",
        }),
      ).toBe("");
    }
  });

  test("without the note, still cuts at the last line break that fits, one right at the cut included", () => {
    const text: string = "first line\nsecond line\nthird line";
    // The line break after "second line" is code unit 22.
    expect(text.charAt(22)).toBe("\n");

    // 44 bytes hold 22 code units: both lines, and no room for the note.
    const fitted: string = MicrosoftTeamsMessageSize.fitTextToBudget({
      text: text,
      budgetInBytes: 44,
    });

    expect(fitted).toBe("first line\nsecond line");
    expect(MicrosoftTeamsMessageSize.getSizeInBytes(fitted)).toBe(44);

    // One code unit less, and the second line no longer fits.
    expect(
      MicrosoftTeamsMessageSize.fitTextToBudget({
        text: text,
        budgetInBytes: 42,
      }),
    ).toBe("first line");
  });

  test("without the note, never splits an emoji and drops blanks before the cut", () => {
    // 10 bytes hold 5 code units: four letters and the first half of an emoji.
    const fitted: string = MicrosoftTeamsMessageSize.fitTextToBudget({
      text: "aaaa" + GRINNING_FACE.repeat(10),
      budgetInBytes: 10,
    });

    expect(fitted).toBe("aaaa");
    expect(fitted).not.toContain(GRINNING_FACE_HIGH_SURROGATE);

    expect(
      MicrosoftTeamsMessageSize.fitTextToBudget({
        text: "ab   " + "c".repeat(100),
        budgetInBytes: 10,
      }),
    ).toBe("ab");
  });

  test("is never over the budget at any budget, and keeps as much of the text as fits", () => {
    /*
     * Every budget from nothing to past the text's size, over replies with
     * blank lines, both kinds of line break, trailing blanks, emoji and CJK,
     * with notes that fit only some of those budgets. For every one: a text
     * within the budget comes back as it is; a longer one comes back within
     * the budget, ending with the note exactly when the note fits in it, and
     * before that a prefix of the text in whole characters, without trailing
     * whitespace. What the cut dropped within reach is only blanks, the line
     * break cut at and the start of a line that did not fit - or, with no
     * line break to cut at, blanks and at most the first half of an emoji the
     * budget ends inside. Fitting the result again changes nothing.
     */
    const texts: Array<string> = [
      `**Active incidents**\n\n- API is down ${GRINNING_FACE}\n- DB is slow\r\n- 漢字 queue   \n\n\n- Checkout ${GRINNING_FACE}${GRINNING_FACE}\n- Last line`,
      "x".repeat(40) + "\nshort\n" + GRINNING_FACE.repeat(10),
      GRINNING_FACE.repeat(30),
      "\n" + "abc def ".repeat(10),
      "abc\n   \n\t\nxyz\n" + `${GRINNING_FACE} `.repeat(10) + "\r\n\r\nend",
      buildListReply(8),
    ];
    const notes: Array<string | undefined> = [
      undefined,
      "…",
      "\n[shortened]",
      "",
    ];
    const violations: Array<string> = [];
    let noteAddedCount: number = 0;
    let noteLeftOffCount: number = 0;
    let lineBreakCutCount: number = 0;
    let lineBreakAtTheCutCount: number = 0;
    let midLineCutCount: number = 0;
    let halfEmojiDroppedCount: number = 0;

    texts.forEach((text: string, textIndex: number): void => {
      const textSizeInBytes: number =
        MicrosoftTeamsMessageSize.getSizeInBytes(text);

      for (const truncationNote of notes) {
        const note: string = truncationNote ?? DEFAULT_TRUNCATION_NOTE;

        for (
          let budgetInBytes: number = 0;
          budgetInBytes <= textSizeInBytes + 4;
          budgetInBytes++
        ) {
          const fitted: string = MicrosoftTeamsMessageSize.fitTextToBudget({
            text: text,
            budgetInBytes: budgetInBytes,
            truncationNote: truncationNote,
          });

          const report: (rule: string) => void = (rule: string): void => {
            violations.push(
              `text ${textIndex}, budget ${budgetInBytes}, note ${JSON.stringify(
                note,
              )}: ${rule}; got ${JSON.stringify(fitted)}`,
            );
          };

          if (textSizeInBytes <= budgetInBytes) {
            if (fitted !== text) {
              report("a text within the budget was changed");
            }
            continue;
          }

          if (
            MicrosoftTeamsMessageSize.getSizeInBytes(fitted) > budgetInBytes
          ) {
            report("the result is over the budget");
          }

          const unitsInBudget: number = Math.floor(budgetInBytes / 2);
          const noteFits: boolean = note.length <= unitsInBudget;

          if (note) {
            if (noteFits) {
              noteAddedCount++;
            } else {
              noteLeftOffCount++;
            }

            if (fitted.endsWith(note) !== noteFits) {
              report(
                noteFits
                  ? "the note fits but was left off"
                  : "the note does not fit but was added",
              );
            }
          }

          const kept: string = noteFits
            ? fitted.substring(0, fitted.length - note.length)
            : fitted;
          const unitsForText: number =
            unitsInBudget - (noteFits ? note.length : 0);

          if (!text.startsWith(kept)) {
            report("the kept part is not a prefix of the text");
          }

          if (kept !== kept.trimEnd()) {
            report("the kept part ends with whitespace");
          }

          if (!WELL_FORMED_UTF16.test(fitted)) {
            report("the result has half of a surrogate pair");
          }

          if (text.lastIndexOf("\n", unitsForText) > 0) {
            lineBreakCutCount++;

            if (text.charAt(unitsForText) === "\n") {
              lineBreakAtTheCutCount++;
            }

            // Up to and including the last code unit the text may take.
            if (
              !DROPPED_AT_A_LINE_BREAK.test(
                text.substring(kept.length, unitsForText + 1),
              )
            ) {
              report("dropped more than the line that did not fit");
            }
          } else {
            midLineCutCount++;
            const dropped: string = text.substring(kept.length, unitsForText);

            if (ENDS_WITH_HIGH_SURROGATE.test(dropped)) {
              halfEmojiDroppedCount++;
            }

            if (!DROPPED_MID_LINE.test(dropped)) {
              report("dropped more than blanks and half an emoji");
            }
          }

          if (
            MicrosoftTeamsMessageSize.fitTextToBudget({
              text: fitted,
              budgetInBytes: budgetInBytes,
              truncationNote: truncationNote,
            }) !== fitted
          ) {
            report("fitting the result again changed it");
          }
        }
      }
    });

    expect(violations).toEqual([]);
    /*
     * The sweep went down every path, many times: note added and left off,
     * cut at a line break (one right at the cut among them) and inside a
     * line (half an emoji dropped among them).
     */
    expect(noteAddedCount).toBeGreaterThan(2000);
    expect(noteLeftOffCount).toBeGreaterThan(1000);
    expect(lineBreakCutCount).toBeGreaterThan(2000);
    expect(lineBreakAtTheCutCount).toBeGreaterThan(150);
    expect(midLineCutCount).toBeGreaterThan(2000);
    expect(halfEmojiDroppedCount).toBeGreaterThan(200);
  });

  test("uses an explicit empty note as no note at all", () => {
    const fitted: string = MicrosoftTeamsMessageSize.fitTextToBudget({
      text: "x".repeat(100),
      budgetInBytes: 20,
      truncationNote: "",
    });

    expect(fitted).toBe("x".repeat(10));
  });
});
