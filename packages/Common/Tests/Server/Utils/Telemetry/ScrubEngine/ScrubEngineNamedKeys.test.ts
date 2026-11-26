import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  compileScrubRule,
  CompiledScrubRule,
  ScrubEngineRule,
} from "../../../../../Server/Utils/Telemetry/ScrubEngine/CompiledScrubRule";
import LogScrubEngine from "../../../../../Server/Utils/Telemetry/ScrubEngine/LogScrubEngine";
import TraceScrubEngine, {
  ExceptionContent,
} from "../../../../../Server/Utils/Telemetry/ScrubEngine/TraceScrubEngine";
import ScrubRuleValueCounter from "../../../../../Server/Utils/Telemetry/ScrubRuleValueCounter";
import { ScrubRuleValueCountEntry } from "../../../../../Server/Services/ScrubRuleValueCountService";
import { JSONObject } from "../../../../../Types/JSON";
import LogScrubAction from "../../../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../../Types/ObjectID";
import TraceScrubField from "../../../../../Types/Trace/TraceScrubField";

/*
 * THE SCRUB ENGINES' NEW OPTIONS, AS INGEST RUNS THEM (#10366).
 *
 * A Named Attributes rule hides the whole value of each attribute it names
 * - by exact key, by a dotted prefix, with numbered parts folded, without
 * regard to case - and nothing else: not the body, not another attribute,
 * not a record's own session id. A pattern rule that names attributes looks
 * for its matches only in theirs. Every value a rule changes is counted,
 * by rule, service and version, unless the caller counts nothing.
 */

const PROJECT_ID: string = "0192f1a0-0000-7000-8000-000000103660";
const CHECKOUT: string = "0192f1a0-0000-7000-8000-000000103661";
const RULE_ID: string = "0192f1a0-0000-7000-8000-000000103662";
const OTHER_RULE_ID: string = "0192f1a0-0000-7000-8000-000000103663";

function compiled(rule: ScrubEngineRule): CompiledScrubRule {
  const result: CompiledScrubRule | null = compileScrubRule({
    _id: RULE_ID,
    projectId: new ObjectID(PROJECT_ID),
    ...rule,
  });

  expect(result).not.toBeNull();

  return result!;
}

function namedKeys(
  keys: Array<string>,
  more: Partial<ScrubEngineRule> = {},
): CompiledScrubRule {
  return compiled({
    patternType: LogScrubPatternType.NamedKeys,
    attributeKeys: keys,
    scrubAction: LogScrubAction.Redact,
    fieldsToScrub: LogScrubField.Attributes,
    ...more,
  });
}

function scrubLog(
  row: JSONObject,
  rules: Array<CompiledScrubRule>,
): JSONObject {
  return LogScrubEngine.scrubLog(JSON.parse(JSON.stringify(row)), rules, null, {
    countValues: false,
  });
}

describe("compiling a rule", () => {
  test("a Named Attributes rule that names nothing scrubs nothing", () => {
    expect(
      compileScrubRule({
        patternType: LogScrubPatternType.NamedKeys,
        attributeKeys: [],
      }),
    ).toBeNull();
    expect(
      compileScrubRule({
        patternType: LogScrubPatternType.NamedKeys,
        attributeKeys: ["  ", 42],
      }),
    ).toBeNull();
  });

  test("a Named Attributes rule finds nothing in a value, so a walker of values leaves it alone", () => {
    const rule: CompiledScrubRule = namedKeys(["customer_name"]);

    expect(rule.regex.matchRanges("Jane Doe customer_name")).toEqual([]);
    expect(rule.regex.test("anything")).toBe(false);
    expect(rule.keys?.matches("customer_name")).toBe(true);
  });

  test("a Sensitive Attribute Keys rule reads every key, whatever keys it names", () => {
    const rule: CompiledScrubRule = compiled({
      patternType: LogScrubPatternType.SensitiveKeys,
      attributeKeys: ["customer_name"],
    });

    expect(rule.keys).toBeUndefined();
  });

  test("a pattern rule with no keys reads every attribute", () => {
    expect(
      compiled({ patternType: LogScrubPatternType.Email }).keys,
    ).toBeUndefined();
  });
});

describe("a Named Attributes rule over a log", () => {
  test("hides the whole value of the attribute it names, and nothing else", () => {
    const row: JSONObject = {
      primaryEntityId: CHECKOUT,
      body: "Order placed by Jane Doe",
      attributes: {
        customer_name: "Jane Doe",
        "order.id": "A-1042",
        "customer.country": "DE",
      },
    };

    expect(scrubLog(row, [namedKeys(["customer_name"])])).toEqual({
      primaryEntityId: CHECKOUT,
      body: "Order placed by Jane Doe",
      attributes: {
        customer_name: "[REDACTED]",
        "order.id": "A-1042",
        "customer.country": "DE",
      },
    });
  });

  test("a dotted prefix names every attribute under it, and only those", () => {
    const scrubbed: JSONObject = scrubLog(
      {
        attributes: {
          "request.headers.x-api-key": "k-123",
          "request.headers.cookie": "sid=1",
          "request.headersize": "512",
          "request.method": "GET",
        },
      },
      [namedKeys(["request.headers"])],
    );

    expect(scrubbed["attributes"]).toEqual({
      "request.headers.x-api-key": "[REDACTED]",
      "request.headers.cookie": "[REDACTED]",
      "request.headersize": "512",
      "request.method": "GET",
    });
  });

  test("names keys without regard to case, and numbered parts as the scan folds them", () => {
    const scrubbed: JSONObject = scrubLog(
      {
        attributes: {
          Customer_Name: "Jane Doe",
          "items.0.owner": "Ann",
          "items.1.owner": "Bob",
          "items.1.sku": "S-9",
        },
      },
      [namedKeys(["customer_name", "items[].owner"])],
    );

    expect(scrubbed["attributes"]).toEqual({
      Customer_Name: "[REDACTED]",
      "items.0.owner": "[REDACTED]",
      "items.1.owner": "[REDACTED]",
      "items.1.sku": "S-9",
    });
  });

  test("hides every text inside a list or a map it names, keeping its shape", () => {
    const scrubbed: JSONObject = scrubLog(
      {
        attributes: {
          "user.full_name": { first: "Jane", last: "Doe", age: 41 },
          nicknames: ["JD", "Janie"],
        },
      },
      [namedKeys(["user.full_name", "nicknames"])],
    );

    expect(scrubbed["attributes"]).toEqual({
      "user.full_name": { first: "[REDACTED]", last: "[REDACTED]", age: 41 },
      nicknames: ["[REDACTED]", "[REDACTED]"],
    });
  });

  test("masks with its action, as the engines mask any other text", () => {
    const scrubbed: JSONObject = scrubLog(
      { attributes: { customer_name: "Jane Doe" } },
      [namedKeys(["customer_name"], { scrubAction: LogScrubAction.Mask })],
    );
    const masked: string = (scrubbed["attributes"] as JSONObject)[
      "customer_name"
    ] as string;

    expect(masked).not.toContain("Jane Doe");
    expect(masked).toContain("***");
  });

  test("keeps the attribute that holds the log's own session id, as the column keeps it", () => {
    const scrubbed: JSONObject = scrubLog(
      {
        sessionId: "sess-1",
        attributes: { "session.id": "sess-1", customer_name: "Jane" },
      },
      [namedKeys(["session.id", "customer_name"])],
    );

    expect(scrubbed["attributes"]).toEqual({
      "session.id": "sess-1",
      customer_name: "[REDACTED]",
    });
  });

  test("a rule saved for the body only still reads attributes: a body has no keys", () => {
    const scrubbed: JSONObject = scrubLog(
      { body: "customer_name=Jane", attributes: { customer_name: "Jane" } },
      [namedKeys(["customer_name"], { fieldsToScrub: LogScrubField.Body })],
    );

    expect(scrubbed["body"]).toBe("customer_name=Jane");
    expect((scrubbed["attributes"] as JSONObject)["customer_name"]).toBe(
      "[REDACTED]",
    );
  });

  test("a rule for another service leaves this service's log as it is", () => {
    const row: JSONObject = {
      primaryEntityId: CHECKOUT,
      attributes: { customer_name: "Jane" },
    };

    expect(
      scrubLog(row, [
        namedKeys(["customer_name"], {
          serviceId: "0192f1a0-0000-7000-8000-0000001036ff",
        }),
      ]),
    ).toEqual(row);
  });
});

describe("a pattern rule that names attributes", () => {
  test("looks for its matches in their values only; the body as its fields say", () => {
    const scrubbed: JSONObject = scrubLog(
      {
        body: "mail jane@example.com",
        attributes: {
          "user.email": "jane@example.com",
          "support.email": "help@example.com",
        },
      },
      [
        compiled({
          patternType: LogScrubPatternType.Email,
          attributeKeys: ["user.email"],
          scrubAction: LogScrubAction.Redact,
          fieldsToScrub: LogScrubField.Both,
        }),
      ],
    );

    expect(scrubbed["body"]).toBe("mail [REDACTED]");
    expect(scrubbed["attributes"]).toEqual({
      "user.email": "[REDACTED]",
      "support.email": "help@example.com",
    });
  });

  test("a custom pattern too broad for every value stays in its attribute", () => {
    const scrubbed: JSONObject = scrubLog(
      {
        attributes: {
          "bank.routing": "021000021",
          "order.number": "123456789",
        },
      },
      [
        compiled({
          patternType: LogScrubPatternType.Custom,
          customRegex: "\\b\\d{9}\\b",
          attributeKeys: ["bank.routing"],
          scrubAction: LogScrubAction.Redact,
          fieldsToScrub: LogScrubField.Attributes,
        }),
      ],
    );

    expect(scrubbed["attributes"]).toEqual({
      "bank.routing": "[REDACTED]",
      "order.number": "123456789",
    });
  });
});

describe("a Named Attributes rule over a span", () => {
  function span(): JSONObject {
    return {
      primaryEntityId: CHECKOUT,
      name: "POST /checkout",
      attributes: { customer_name: "Jane", "http.route": "/checkout" },
      events: [
        {
          name: "lookup",
          attributes: { customer_name: "Jane", step: "1" },
        },
      ],
      links: [{ attributes: { customer_name: "Jane" } }],
    };
  }

  function scrubSpan(rule: CompiledScrubRule): JSONObject {
    return TraceScrubEngine.scrubSpan(span(), [rule], null, {
      countValues: false,
    });
  }

  test("Attributes: the span's and its links' attributes, not its events'", () => {
    const scrubbed: JSONObject = scrubSpan(
      namedKeys(["customer_name"], {
        fieldsToScrub: TraceScrubField.Attributes,
      }),
    );

    expect((scrubbed["attributes"] as JSONObject)["customer_name"]).toBe(
      "[REDACTED]",
    );
    expect(
      (
        (scrubbed["links"] as Array<JSONObject>)[0]!["attributes"] as JSONObject
      )["customer_name"],
    ).toBe("[REDACTED]");
    expect(
      (
        (scrubbed["events"] as Array<JSONObject>)[0]![
          "attributes"
        ] as JSONObject
      )["customer_name"],
    ).toBe("Jane");
    expect(scrubbed["name"]).toBe("POST /checkout");
  });

  test("Events: its events' attributes only", () => {
    const scrubbed: JSONObject = scrubSpan(
      namedKeys(["customer_name"], { fieldsToScrub: TraceScrubField.Events }),
    );

    expect((scrubbed["attributes"] as JSONObject)["customer_name"]).toBe(
      "Jane",
    );
    expect(
      (
        (scrubbed["events"] as Array<JSONObject>)[0]![
          "attributes"
        ] as JSONObject
      )["customer_name"],
    ).toBe("[REDACTED]");
  });

  test("All, or the span's name, which has no keys: every attribute map", () => {
    for (const fieldsToScrub of [TraceScrubField.All, TraceScrubField.Name]) {
      const scrubbed: JSONObject = scrubSpan(
        namedKeys(["customer_name"], { fieldsToScrub }),
      );

      expect((scrubbed["attributes"] as JSONObject)["customer_name"]).toBe(
        "[REDACTED]",
      );
      expect(
        (
          (scrubbed["events"] as Array<JSONObject>)[0]![
            "attributes"
          ] as JSONObject
        )["customer_name"],
      ).toBe("[REDACTED]");
      expect(scrubbed["name"]).toBe("POST /checkout");
    }
  });

  test("hides the identity column copied out of an attribute it names", () => {
    const scrubbed: JSONObject = TraceScrubEngine.scrubSpan(
      {
        primaryEntityId: CHECKOUT,
        attributes: { "user.email": "jane@example.com" },
        llmUserEmail: "jane@example.com",
        llmTeam: "growth",
      },
      [namedKeys(["user.email"], { fieldsToScrub: TraceScrubField.All })],
      null,
      { countValues: false },
    );

    expect(scrubbed["llmUserEmail"]).toBe("[REDACTED]");
    expect(scrubbed["llmTeam"]).toBe("growth");
  });

  test("an exception copied from an event: the message under a key it names, hidden whole", () => {
    const content: ExceptionContent = TraceScrubEngine.scrubExceptionContent(
      {
        message: "card declined for Jane",
        stackTrace: "at pay()",
        attributes: { customer_name: "Jane" },
      },
      [
        namedKeys(["exception.message", "customer_name"], {
          fieldsToScrub: TraceScrubField.Events,
        }),
      ],
      CHECKOUT,
    );

    expect(content.message).toBe("[REDACTED]");
    expect(content.stackTrace).toBe("at pay()");
    expect(content.attributes).toEqual({ customer_name: "[REDACTED]" });
  });
});

describe("the values each rule changed", () => {
  beforeEach(() => {
    ScrubRuleValueCounter.reset();
  });

  afterEach(() => {
    ScrubRuleValueCounter.reset();
  });

  test("ingest counts every value a rule changed, by rule, service and version", () => {
    const email: CompiledScrubRule = compiled({
      _id: OTHER_RULE_ID,
      patternType: LogScrubPatternType.Email,
      fieldsToScrub: LogScrubField.Both,
    });
    const names: CompiledScrubRule = namedKeys(["customer_name"]);

    LogScrubEngine.scrubLog(
      {
        primaryEntityId: CHECKOUT,
        body: "a@example.com and b@example.com",
        attributes: {
          customer_name: "Jane",
          "resource.service.version": "2.4.1",
        },
      },
      [email, names],
    );

    const entries: Array<ScrubRuleValueCountEntry> =
      ScrubRuleValueCounter.getPendingEntries();

    expect(
      entries
        .map((entry: ScrubRuleValueCountEntry): Array<unknown> => {
          return [
            entry.scrubRuleId,
            entry.signal,
            entry.serviceId,
            entry.serviceVersion,
            entry.valueCount,
          ];
        })
        .sort(),
    ).toEqual(
      [
        [OTHER_RULE_ID, "log", CHECKOUT, "2.4.1", 2],
        [RULE_ID, "log", CHECKOUT, "2.4.1", 1],
      ].sort(),
    );
    expect(entries[0]!.projectId).toBe(PROJECT_ID);
    expect(entries[0]!.hour.getUTCMinutes()).toBe(0);
  });

  test("a span's values are counted under traces; a record nothing changed counts nothing", () => {
    TraceScrubEngine.scrubSpan(
      {
        primaryEntityId: CHECKOUT,
        attributes: { customer_name: "Jane" },
      },
      [namedKeys(["customer_name"], { fieldsToScrub: TraceScrubField.All })],
    );
    TraceScrubEngine.scrubSpan(
      { primaryEntityId: CHECKOUT, attributes: { other: "x" } },
      [namedKeys(["customer_name"], { fieldsToScrub: TraceScrubField.All })],
    );

    expect(
      ScrubRuleValueCounter.getPendingEntries().map(
        (entry: ScrubRuleValueCountEntry): Array<unknown> => {
          return [entry.signal, entry.serviceVersion, entry.valueCount];
        },
      ),
    ).toEqual([["trace", "", 1]]);
  });

  test("a proof's copies count nothing", () => {
    LogScrubEngine.scrubLog(
      { primaryEntityId: CHECKOUT, attributes: { customer_name: "Jane" } },
      [namedKeys(["customer_name"])],
      null,
      { countValues: false },
    );

    expect(ScrubRuleValueCounter.getPendingEntries()).toEqual([]);
  });

  test("the same key adds up, and an exception counts nothing of its own", () => {
    const rule: CompiledScrubRule = namedKeys(["customer_name"], {
      fieldsToScrub: TraceScrubField.All,
    });

    for (let index: number = 0; index < 3; index++) {
      TraceScrubEngine.scrubSpan(
        { primaryEntityId: CHECKOUT, attributes: { customer_name: "Jane" } },
        [rule],
      );
    }

    TraceScrubEngine.scrubExceptionContent(
      { message: "x", stackTrace: "y", attributes: { customer_name: "Jane" } },
      [rule],
      CHECKOUT,
    );

    expect(
      ScrubRuleValueCounter.getPendingEntries().map(
        (entry: ScrubRuleValueCountEntry): number => {
          return entry.valueCount;
        },
      ),
    ).toEqual([3]);
  });
});
