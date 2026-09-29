import { describe, expect, jest, test } from "@jest/globals";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import { JSONObject, JSONValue } from "Common/Types/JSON";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import SessionReplayScrubService, {
  CompiledScrubRule,
  SessionReplayScrubResult,
} from "../../FeatureSet/Telemetry/Services/SessionReplayScrubService";

/*
 * The walker is the whole reason this service exists: the log scrubber's
 * loop stops at the first non-string value and never recurses, so it would
 * walk straight past every place an rrweb event actually stores user text.
 * These tests pin the recursion, the key-targeted branch, and both caps.
 */

function rule(
  patternType: LogScrubPatternType,
  scrubAction: LogScrubAction,
  regex: RegExp,
): CompiledScrubRule {
  return {
    rule: {
      patternType: patternType,
      scrubAction: scrubAction,
    } as unknown as LogScrubRule,
    regex: regex,
  };
}

const EMAIL_REDACT: CompiledScrubRule = rule(
  LogScrubPatternType.Email,
  LogScrubAction.Redact,
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
);

const PAN_MASK: CompiledScrubRule = rule(
  LogScrubPatternType.CreditCard,
  LogScrubAction.Mask,
  /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
);

const SSN_REDACT: CompiledScrubRule = rule(
  LogScrubPatternType.SSN,
  LogScrubAction.Redact,
  /\b\d{3}-\d{2}-\d{4}\b/g,
);

const SENSITIVE_KEYS: CompiledScrubRule = rule(
  LogScrubPatternType.SensitiveKeys,
  LogScrubAction.Redact,
  /(password|token|api[._-]?key|authorization|cookie)/i,
);

describe("SessionReplayScrubService.scrubEvents", () => {
  test("redacts an email inside a nested FullSnapshot text node", async () => {
    /*
     * Shape mirrors a real rrweb FullSnapshot: type 2, whose node tree
     * nests childNodes several levels deep. The email lives in
     * textContent on a leaf, which is exactly what the flat log walker
     * would never reach.
     */
    const events: Array<JSONValue> = [
      {
        type: 2,
        timestamp: 1,
        data: {
          node: {
            type: 0,
            childNodes: [
              {
                type: 2,
                tagName: "div",
                childNodes: [
                  {
                    type: 3,
                    textContent: "Signed in as ada@example.com",
                  },
                ],
              },
            ],
          },
        },
      },
    ];

    const result: SessionReplayScrubResult =
      await SessionReplayScrubService.scrubEvents(events, [EMAIL_REDACT]);

    expect(result.isComplete).toBe(true);
    expect(JSON.stringify(events)).not.toContain("ada@example.com");
    expect(JSON.stringify(events)).toContain("[REDACTED]");
    expect(result.stringsScrubbed).toBe(1);
  });

  test("masks a card number inside an incremental attribute mutation", async () => {
    const events: Array<JSONValue> = [
      {
        type: 3,
        data: {
          source: 0,
          attributes: [
            {
              id: 42,
              attributes: {
                value: "4111 1111 1111 1111",
                placeholder: "Card number",
              },
            },
          ],
        },
      },
    ];

    const result: SessionReplayScrubResult =
      await SessionReplayScrubService.scrubEvents(events, [PAN_MASK]);

    expect(result.isComplete).toBe(true);

    const serialized: string = JSON.stringify(events);

    expect(serialized).not.toContain("4111 1111 1111 1111");
    /* Mask keeps only the last four, matching the log scrubber's shape. */
    expect(serialized).toContain("****-****-****-1111");
  });

  test("redacts an SSN inside a nested styleSheetRule payload", async () => {
    const events: Array<JSONValue> = [
      {
        type: 3,
        data: {
          source: 8,
          adds: [
            {
              rule: 'div::after { content: "123-45-6789"; }',
              index: 0,
            },
          ],
        },
      },
    ];

    const result: SessionReplayScrubResult =
      await SessionReplayScrubService.scrubEvents(events, [SSN_REDACT]);

    expect(result.isComplete).toBe(true);
    expect(JSON.stringify(events)).not.toContain("123-45-6789");
  });

  test("scrubs bare strings held in arrays", async () => {
    /* Console arguments and CSS rule text arrive as plain string arrays. */
    const events: Array<JSONValue> = [
      {
        type: 5,
        data: {
          tag: "console",
          payload: {
            args: ["failed for", "ada@example.com"],
          },
        },
      },
    ];

    await SessionReplayScrubService.scrubEvents(events, [EMAIL_REDACT]);

    expect(JSON.stringify(events)).not.toContain("ada@example.com");
  });

  test("key-targeted rules redact a whole value that matches no shape", async () => {
    const events: Array<JSONValue> = [
      {
        type: 3,
        data: {
          attributes: [
            {
              attributes: {
                "data-authorization": "Bearer zzzzzzzzzzzzzzzz",
                title: "Bearer zzzzzzzzzzzzzzzz",
              },
            },
          ],
        },
      },
    ];

    await SessionReplayScrubService.scrubEvents(events, [SENSITIVE_KEYS]);

    const mutation: JSONObject = (
      (events[0] as JSONObject)["data"] as JSONObject
    )["attributes"] as unknown as JSONObject;

    const attributes: JSONObject = (
      (mutation as unknown as Array<JSONObject>)[0] as JSONObject
    )["attributes"] as JSONObject;

    expect(attributes["data-authorization"]).toBe("[REDACTED]");
    /*
     * The same value under a non-sensitive key is left alone: the rule is
     * key-targeted, and widening it to every string would be a value rule.
     */
    expect(attributes["title"]).toBe("Bearer zzzzzzzzzzzzzzzz");
  });

  test("no rules configured is a complete pass, not a failure", async () => {
    const events: Array<JSONValue> = [
      { type: 3, data: { text: "ada@example.com" } },
    ];

    const result: SessionReplayScrubResult =
      await SessionReplayScrubService.scrubEvents(events, []);

    expect(result.isComplete).toBe(true);
    expect(result.nodesVisited).toBe(0);
    /*
     * Deliberately unscrubbed. Masking at capture is the primary control,
     * and most projects will never configure a scrub rule - which is why
     * loadRules throws rather than returning an empty array, so this state
     * can never be confused with "rules could not be loaded".
     */
    expect(JSON.stringify(events)).toContain("ada@example.com");
  });

  /*
   * The depth cap counts JSON nesting levels, and an rrweb serialized node
   * costs TWO of them per DOM element (node -> childNodes array -> child
   * node). A 60-level component tree is ordinary in Tailwind / MUI / Angular
   * markup, and exceeding the cap sets isComplete = false, which makes the
   * ingest service DROP the chunk - so a cap that a real page can reach means
   * a customer loses 100% of their recordings the moment they add their first
   * scrub rule (with zero rules the walk is skipped entirely).
   */
  test("a 60-level-deep DOM snapshot scrubs completely", async () => {
    let deepest: JSONObject = { textContent: "ada@example.com" };

    for (let index: number = 0; index < 60; index++) {
      deepest = { tagName: "div", childNodes: [deepest] };
    }

    const events: Array<JSONValue> = [
      { type: 2, data: { node: deepest } } as unknown as JSONValue,
    ];

    const result: SessionReplayScrubResult =
      await SessionReplayScrubService.scrubEvents(events, [EMAIL_REDACT]);

    expect(result.truncatedAtDepth).toBe(false);
    expect(result.isComplete).toBe(true);
    /* And it actually did the scrubbing all the way down. */
    expect(JSON.stringify(events)).not.toContain("ada@example.com");
  });

  test("the depth cap holds and reports an incomplete scrub", async () => {
    /* 600 levels, past the 512-level ceiling. */
    let deepest: JSONObject = { textContent: "ada@example.com" };

    for (let index: number = 0; index < 600; index++) {
      deepest = { childNodes: [deepest] };
    }

    const events: Array<JSONValue> = [deepest];

    const result: SessionReplayScrubResult =
      await SessionReplayScrubService.scrubEvents(events, [EMAIL_REDACT]);

    expect(result.truncatedAtDepth).toBe(true);
    /*
     * isComplete false is the signal the ingest service uses to DROP the
     * chunk. Storing a tree we could not finish examining would defeat the
     * point of having a second net.
     */
    expect(result.isComplete).toBe(false);
  });

  test("the node cap holds and reports an incomplete scrub", async () => {
    const wide: Array<JSONValue> = [];

    for (let index: number = 0; index < 260_000; index++) {
      wide.push("x");
    }

    const events: Array<JSONValue> = [{ type: 3, data: { texts: wide } }];

    const result: SessionReplayScrubResult =
      await SessionReplayScrubService.scrubEvents(events, [EMAIL_REDACT]);

    expect(result.isComplete).toBe(false);
    expect(result.nodesVisited).toBeGreaterThan(250_000);
  });

  test("oversized strings are skipped and counted, not silently ignored", async () => {
    const hugeStylesheet: string = "a".repeat(70 * 1024);

    const events: Array<JSONValue> = [
      { type: 3, data: { cssText: hugeStylesheet } },
    ];

    const result: SessionReplayScrubResult =
      await SessionReplayScrubService.scrubEvents(events, [EMAIL_REDACT]);

    expect(result.isComplete).toBe(true);
    expect(result.skippedOversizedStrings).toBe(1);
  });

  test("hash action produces a stable, non-reversible marker", async () => {
    const hashRule: CompiledScrubRule = rule(
      LogScrubPatternType.Email,
      LogScrubAction.Hash,
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    );

    const first: Array<JSONValue> = [{ text: "ada@example.com" }];
    const second: Array<JSONValue> = [{ text: "ada@example.com" }];

    await SessionReplayScrubService.scrubEvents(first, [hashRule]);
    await SessionReplayScrubService.scrubEvents(second, [hashRule]);

    expect((first[0] as JSONObject)["text"]).toEqual(
      (second[0] as JSONObject)["text"],
    );
    expect(String((first[0] as JSONObject)["text"])).toMatch(
      /^\[HASHED:[0-9a-f]{8}\]$/,
    );
  });

  test("scrubs every occurrence when several rules apply to one string", async () => {
    const events: Array<JSONValue> = [
      {
        text: "ada@example.com paid with 4111 1111 1111 1111",
      },
    ];

    await SessionReplayScrubService.scrubEvents(events, [
      EMAIL_REDACT,
      PAN_MASK,
    ]);

    const text: string = String((events[0] as JSONObject)["text"]);

    expect(text).not.toContain("ada@example.com");
    expect(text).not.toContain("4111 1111 1111 1111");
  });
});

/*
 * Audit finding ingest-14. Value rules used to run over every string in the
 * tree, and most of an rrweb tree is not text: a digit run in an SVG path,
 * an inline style or a base64 image source matched a card / phone rule and
 * was rewritten to "[REDACTED]", which broke playback with nothing
 * explaining why. Scanning is now confined to text-bearing fields.
 */
describe("SessionReplayScrubService.scrubEvents leaves rrweb plumbing alone", () => {
  const PHONE_REDACT: CompiledScrubRule = rule(
    LogScrubPatternType.PhoneNumber,
    LogScrubAction.Redact,
    /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  );

  const DATA_URI: string =
    "data:image/png;base64,AAAA4111111111111111BBBB555-123-4567CCCC";
  const SVG_PATH: string = "M 4111 1111 L 1111 1111 Z";

  test("a data: URI image source survives a card rule, and the skip is counted", async () => {
    const events: Array<JSONValue> = [
      {
        type: 2,
        data: {
          node: {
            type: 2,
            tagName: "img",
            id: 7,
            attributes: { src: DATA_URI, alt: "card 4111 1111 1111 1111" },
            childNodes: [],
          },
        },
      },
    ];

    const result: SessionReplayScrubResult =
      await SessionReplayScrubService.scrubEvents(events, [PAN_MASK]);

    const attributes: JSONObject = (
      ((events[0] as JSONObject)["data"] as JSONObject)["node"] as JSONObject
    )["attributes"] as JSONObject;

    expect(attributes["src"]).toBe(DATA_URI);
    /* Text-bearing attributes are still scrubbed. */
    expect(attributes["alt"]).toBe("card ****-****-****-1111");
    expect(result.skippedStructuralStrings).toBeGreaterThan(0);
    expect(result.isComplete).toBe(true);
  });

  test("a data: URI is skipped wherever it sits, including a bare array element", async () => {
    const events: Array<JSONValue> = [
      { type: 5, data: { tag: "console", payload: { args: [DATA_URI] } } },
      { type: 3, data: { source: 0, texts: [{ id: 3, value: DATA_URI }] } },
    ];

    await SessionReplayScrubService.scrubEvents(events, [PAN_MASK]);

    expect(JSON.stringify(events)).toContain(DATA_URI);
  });

  test("SVG geometry, class lists and ids are never rewritten", async () => {
    const events: Array<JSONValue> = [
      {
        type: 2,
        data: {
          node: {
            type: 2,
            tagName: "path",
            id: 4111111111111111,
            isSVG: true,
            attributes: {
              d: SVG_PATH,
              points: "4111,1111 1111,1111",
              class: "c-4111111111111111",
              id: "el-555-123-4567",
              transform: "translate(4111 1111)",
            },
            childNodes: [],
          },
        },
      },
    ];

    await SessionReplayScrubService.scrubEvents(events, [
      PAN_MASK,
      PHONE_REDACT,
    ]);

    const attributes: JSONObject = (
      ((events[0] as JSONObject)["data"] as JSONObject)["node"] as JSONObject
    )["attributes"] as JSONObject;

    expect(attributes["d"]).toBe(SVG_PATH);
    expect(attributes["points"]).toBe("4111,1111 1111,1111");
    expect(attributes["class"]).toBe("c-4111111111111111");
    expect(attributes["id"]).toBe("el-555-123-4567");
    expect(attributes["transform"]).toBe("translate(4111 1111)");
  });

  test("an inline style object in an attribute mutation is skipped whole", async () => {
    const events: Array<JSONValue> = [
      {
        type: 3,
        data: {
          source: 0,
          attributes: [
            {
              id: 9,
              attributes: {
                style: {
                  "background-image": `url(${DATA_URI})`,
                  "font-family": "4111 1111 1111 1111",
                  "z-index": ["555-123-4567", "important"],
                },
                value: "555-123-4567",
              },
            },
          ],
        },
      },
    ];

    await SessionReplayScrubService.scrubEvents(events, [
      PAN_MASK,
      PHONE_REDACT,
    ]);

    const mutation: Array<JSONObject> = (
      (events[0] as JSONObject)["data"] as JSONObject
    )["attributes"] as unknown as Array<JSONObject>;
    const attributes: JSONObject = mutation[0]!["attributes"] as JSONObject;
    const style: JSONObject = attributes["style"] as JSONObject;

    expect(style["font-family"]).toBe("4111 1111 1111 1111");
    expect((style["z-index"] as Array<string>)[0]).toBe("555-123-4567");
    /* The input's VALUE is text a person typed, so it is still scrubbed. */
    expect(attributes["value"]).toBe("[REDACTED]");
  });

  test("a key-targeted rule cannot redact the structural attributes the DOM needs", async () => {
    const NAME_TYPE_KEYS: CompiledScrubRule = rule(
      LogScrubPatternType.SensitiveKeys,
      LogScrubAction.Redact,
      /(name|type|id|password)/i,
    );

    const events: Array<JSONValue> = [
      {
        type: 2,
        data: {
          node: {
            type: 2,
            tagName: "input",
            id: 12,
            attributes: {
              name: "email",
              type: "password",
              id: "login-password",
              "data-password-hint": "hunter2",
            },
            childNodes: [],
          },
        },
      },
    ];

    await SessionReplayScrubService.scrubEvents(events, [NAME_TYPE_KEYS]);

    const node: JSONObject = ((events[0] as JSONObject)["data"] as JSONObject)[
      "node"
    ] as JSONObject;
    const attributes: JSONObject = node["attributes"] as JSONObject;

    expect(node["tagName"]).toBe("input");
    expect(node["type"]).toBe(2);
    expect(attributes["name"]).toBe("email");
    expect(attributes["type"]).toBe("password");
    expect(attributes["id"]).toBe("login-password");
    /* A data-* attribute whose NAME matches is user-authored: redacted. */
    expect(attributes["data-password-hint"]).toBe("[REDACTED]");
  });

  test("text nodes, input values and placeholders are still scrubbed", async () => {
    const events: Array<JSONValue> = [
      {
        type: 2,
        data: {
          node: {
            type: 2,
            tagName: "label",
            id: 1,
            childNodes: [{ type: 3, id: 2, textContent: "Call 555-123-4567" }],
          },
        },
      },
      { type: 3, data: { source: 5, id: 3, text: "555-123-4567" } },
      {
        type: 3,
        data: {
          source: 0,
          attributes: [
            { id: 4, attributes: { placeholder: "e.g. 555-123-4567" } },
          ],
        },
      },
    ];

    await SessionReplayScrubService.scrubEvents(events, [PHONE_REDACT]);

    expect(JSON.stringify(events)).not.toContain("555-123-4567");
  });
});
