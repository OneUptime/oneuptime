import { describe, expect, jest, test } from "@jest/globals";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import { FastestRun, fastestRunAsync } from "Common/Tests/Helpers/FastestRun";
import { compileScrubRule } from "Common/Server/Utils/Telemetry/ScrubEngine/CompiledScrubRule";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

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
 * ---------------------------------------------------------------------------
 * A FORM FIELD'S VALUE IS READ UNDER WHAT NAMES IT (#11501), AND A NUMBER
 * UNDER A KEY THAT NAMES IT IS HIDDEN (#11500).
 *
 * A pattern rule reads a value under the key it is held under, as Data
 * Security reads a field's name (#11383): a Phone Number rule hides a
 * national number under `phone`. rrweb records what was typed into a form
 * field under `value`, and as the `text` of an input event that names the
 * field by its node id alone, while what names the value sits beside it:
 * `<input name="phone">`, `type="tel"`, `autocomplete="postal-code"`,
 * `id="customerPhone"`. So a form field's value is read under those too -
 * in its serialized node, in a node a mutation adds, in a mutation of its
 * attributes, and in the input events after it - and a Sensitive Attribute
 * Keys rule hides the whole value of a field its name names. A number held
 * under a key that names its type - a custom event's {phone: 2012345678} -
 * is hidden as a log's is; one under any other key, a node id, a
 * timestamp, a position, stays the number it is.
 *
 * The values are rules' real compiled patterns (compileScrubRule, as
 * LogScrubRuleService loads them), and every number is made up: 020 3123
 * 4567 is a London number in its groups, which a Phone Number rule's own
 * pattern keeps and Data Security finds beside its word or under its key.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-000000a11501",
);

const REDACTED: string = "[REDACTED]";

// A national number in its groups: the Phone Number rule's own pattern keeps it.
const NATIONAL_PHONE: string = "020 3123 4567";

function ruleOf(
  patternType: LogScrubPatternType,
  customRegex?: string | undefined,
): CompiledScrubRule {
  const rule: LogScrubRule = new LogScrubRule();
  rule.projectId = PROJECT_ID;
  rule.patternType = patternType;
  rule.scrubAction = LogScrubAction.Redact;

  if (customRegex) {
    rule.customRegex = customRegex;
  }

  const compiled: CompiledScrubRule | null = compileScrubRule(rule);

  if (!compiled) {
    throw new Error(`No rule of ${patternType}.`);
  }

  return compiled;
}

const PHONE: CompiledScrubRule = ruleOf(LogScrubPatternType.PhoneNumber);
const SSN: CompiledScrubRule = ruleOf(LogScrubPatternType.SSN);
const POSTAL_CODE: CompiledScrubRule = ruleOf(LogScrubPatternType.PostalCode);
const COORDINATES: CompiledScrubRule = ruleOf(LogScrubPatternType.Coordinates);
const SENSITIVE_KEYS: CompiledScrubRule = ruleOf(
  LogScrubPatternType.SensitiveKeys,
);

interface FormField {
  tagName: string;
  id: number;
  attributes: JSONObject;
}

// A FullSnapshot of a page whose form holds these fields.
function snapshotOf(fields: Array<FormField>): JSONObject {
  return {
    type: 2,
    timestamp: 1_732_780_800_000,
    data: {
      node: {
        type: 0,
        id: 1,
        childNodes: [
          {
            type: 2,
            tagName: "form",
            id: 2,
            attributes: { action: "/checkout" },
            childNodes: fields.map((field: FormField): JSONObject => {
              return { type: 2, ...field, childNodes: [] };
            }),
          },
        ],
      },
      initialOffset: { left: 0, top: 0 },
    },
  };
}

// What rrweb records as a person types into the field of a node id.
function inputEvent(id: number, text: string): JSONObject {
  return {
    type: 3,
    timestamp: 1_732_780_801_000,
    data: { source: 5, id, text, isChecked: false },
  };
}

// A mutation of a node's attributes, by its id.
function attributeMutation(id: number, attributes: JSONObject): JSONObject {
  return {
    type: 3,
    timestamp: 1_732_780_802_000,
    data: {
      source: 0,
      texts: [],
      attributes: [{ id, attributes }],
      removes: [],
      adds: [],
    },
  };
}

// A mutation that adds a node under a parent.
function addedNode(parentId: number, node: JSONObject): JSONObject {
  return {
    type: 3,
    timestamp: 1_732_780_803_000,
    data: {
      source: 0,
      texts: [],
      attributes: [],
      removes: [],
      adds: [{ parentId, nextId: null, node: { childNodes: [], ...node } }],
    },
  };
}

// A custom event the page sent with rrweb's addCustomEvent.
function customEvent(payload: JSONObject): JSONObject {
  return {
    type: 5,
    timestamp: 1_732_780_804_000,
    data: { tag: "checkout", payload },
  };
}

async function scrub(
  events: Array<JSONValue>,
  rules: Array<CompiledScrubRule>,
): Promise<SessionReplayScrubResult> {
  const result: SessionReplayScrubResult =
    await SessionReplayScrubService.scrubEvents(events, rules);

  expect(result.isComplete).toBe(true);

  return result;
}

// The attributes of the snapshot's field of a node id.
function fieldAttributes(snapshot: JSONObject, id: number): JSONObject {
  const form: JSONObject = (
    ((snapshot["data"] as JSONObject)["node"] as JSONObject)[
      "childNodes"
    ] as Array<JSONObject>
  )[0]!;
  const field: JSONObject | undefined = (
    form["childNodes"] as Array<JSONObject>
  ).find((node: JSONObject): boolean => {
    return node["id"] === id;
  });

  return field!["attributes"] as JSONObject;
}

function textOf(event: JSONObject): JSONValue | undefined {
  return (event["data"] as JSONObject)["text"];
}

function mutatedAttributes(event: JSONObject): JSONObject {
  return ((event["data"] as JSONObject)["attributes"] as Array<JSONObject>)[0]![
    "attributes"
  ] as JSONObject;
}

function addedAttributes(event: JSONObject): JSONObject {
  return (
    ((event["data"] as JSONObject)["adds"] as Array<JSONObject>)[0]![
      "node"
    ] as JSONObject
  )["attributes"] as JSONObject;
}

function payloadOf(event: JSONObject): JSONObject {
  return (event["data"] as JSONObject)["payload"] as JSONObject;
}

describe("a form field's value is read under what names it (#11501)", () => {
  test.each([
    ["its name", { name: "phone" }],
    ["its name, as words of a phrase", { name: "billing_phone_number" }],
    ["its id, written in camelCase", { id: "customerPhone" }],
    ["its autocomplete", { autocomplete: "tel-national" }],
    ["its type", { type: "tel" }],
    ["an attribute written in capitals", { NAME: "Phone" }],
  ])(
    "a national number typed into a field named for a phone by %s is hidden, in the field and as it is typed",
    async (_label: string, naming: JSONObject) => {
      const snapshot: JSONObject = snapshotOf([
        {
          tagName: "input",
          id: 10,
          attributes: { ...naming, value: NATIONAL_PHONE },
        },
      ]);
      const typed: JSONObject = inputEvent(10, NATIONAL_PHONE);
      const events: Array<JSONValue> = [snapshot, typed];

      const result: SessionReplayScrubResult = await scrub(events, [PHONE]);

      expect(fieldAttributes(snapshot, 10)["value"]).toBe(REDACTED);
      expect(textOf(typed)).toBe(REDACTED);
      expect(result.stringsScrubbed).toBe(2);
      // What names the field is never rewritten.
      expect(fieldAttributes(snapshot, 10)).toEqual({
        ...naming,
        value: REDACTED,
      });
    },
  );

  test("a field whose names name nothing has its value read alone, as before: the rule's own pattern keeps it", async () => {
    const snapshot: JSONObject = snapshotOf([
      {
        tagName: "input",
        id: 10,
        attributes: {
          name: "search",
          id: "q",
          type: "text",
          value: NATIONAL_PHONE,
        },
      },
    ]);
    const typed: JSONObject = inputEvent(10, NATIONAL_PHONE);

    const result: SessionReplayScrubResult = await scrub(
      [snapshot, typed],
      [PHONE],
    );

    expect(fieldAttributes(snapshot, 10)["value"]).toBe(NATIONAL_PHONE);
    expect(textOf(typed)).toBe(NATIONAL_PHONE);
    expect(result.stringsScrubbed).toBe(0);
  });

  test("a number the rule's own pattern finds is hidden in any field, named or not", async () => {
    const snapshot: JSONObject = snapshotOf([
      {
        tagName: "input",
        id: 10,
        attributes: { name: "search", value: "201-234-5678" },
      },
    ]);
    const typed: JSONObject = inputEvent(10, "call 201-234-5678");

    await scrub([snapshot, typed], [PHONE]);

    expect(fieldAttributes(snapshot, 10)["value"]).toBe(REDACTED);
    expect(textOf(typed)).toBe(`call ${REDACTED}`);
  });

  test.each([
    [
      "a ZIP code, into a field whose autocomplete is postal-code",
      { autocomplete: "postal-code" },
      "94107",
      POSTAL_CODE,
    ],
    [
      "a ZIP code, into a field named zip",
      { name: "shipping[zip]" },
      "94107-1234",
      POSTAL_CODE,
    ],
    [
      "one coordinate, into a field named lat",
      { name: "lat" },
      "37.77493",
      COORDINATES,
    ],
    [
      "one coordinate, into a field whose id names a longitude",
      { id: "dropoffLongitude" },
      "-122.41942",
      COORDINATES,
    ],
    [
      "an SSN as nine digits, into a field named ssn",
      { name: "ssn" },
      "536221234",
      SSN,
    ],
  ])(
    "%s",
    async (
      _label: string,
      naming: JSONObject,
      value: string,
      rule: CompiledScrubRule,
    ) => {
      const snapshot: JSONObject = snapshotOf([
        { tagName: "input", id: 10, attributes: { ...naming, value } },
        // The same value in a field that names nothing is kept.
        { tagName: "input", id: 11, attributes: { name: "notes", value } },
      ]);
      const typed: JSONObject = inputEvent(10, value);
      const typedElsewhere: JSONObject = inputEvent(11, value);

      await scrub([snapshot, typed, typedElsewhere], [rule]);

      expect(fieldAttributes(snapshot, 10)["value"]).toBe(REDACTED);
      expect(textOf(typed)).toBe(REDACTED);
      expect(fieldAttributes(snapshot, 11)["value"]).toBe(value);
      expect(textOf(typedElsewhere)).toBe(value);
    },
  );

  test("names of different types are each read: a field named for a phone whose autocomplete names a postal code", async () => {
    const snapshot: JSONObject = snapshotOf([
      {
        tagName: "input",
        id: 10,
        attributes: {
          name: "phone",
          type: "tel",
          autocomplete: "postal-code",
          value: "94107",
        },
      },
      {
        tagName: "input",
        id: 11,
        attributes: {
          name: "phone",
          type: "tel",
          autocomplete: "postal-code",
          value: NATIONAL_PHONE,
        },
      },
    ]);

    await scrub([snapshot], [PHONE, POSTAL_CODE]);

    // The ZIP code by the Postal Code rule, under the autocomplete; the number by the Phone Number rule.
    expect(fieldAttributes(snapshot, 10)["value"]).toBe(REDACTED);
    expect(fieldAttributes(snapshot, 11)["value"]).toBe(REDACTED);
  });

  test("a textarea and a select are form fields too", async () => {
    const snapshot: JSONObject = snapshotOf([
      {
        tagName: "textarea",
        id: 10,
        attributes: { name: "contact_phone", value: NATIONAL_PHONE },
      },
      {
        tagName: "SELECT",
        id: 11,
        attributes: { name: "mobile", value: NATIONAL_PHONE },
      },
    ]);
    const typed: JSONObject = inputEvent(10, NATIONAL_PHONE);
    const chosen: JSONObject = inputEvent(11, NATIONAL_PHONE);

    await scrub([snapshot, typed, chosen], [PHONE]);

    expect(fieldAttributes(snapshot, 10)["value"]).toBe(REDACTED);
    expect(fieldAttributes(snapshot, 11)["value"]).toBe(REDACTED);
    expect(textOf(typed)).toBe(REDACTED);
    expect(textOf(chosen)).toBe(REDACTED);
  });

  test("an element that is no form field has its value read alone, whatever its name", async () => {
    const snapshot: JSONObject = snapshotOf([
      {
        tagName: "data",
        id: 10,
        attributes: { name: "phone", value: NATIONAL_PHONE },
      },
      {
        tagName: "button",
        id: 11,
        attributes: { name: "phone", value: NATIONAL_PHONE },
      },
    ]);
    // An input event for a node that is no form field reads its text alone.
    const typed: JSONObject = inputEvent(10, NATIONAL_PHONE);

    await scrub([snapshot, typed], [PHONE]);

    expect(fieldAttributes(snapshot, 10)["value"]).toBe(NATIONAL_PHONE);
    expect(fieldAttributes(snapshot, 11)["value"]).toBe(NATIONAL_PHONE);
    expect(textOf(typed)).toBe(NATIONAL_PHONE);
  });

  test("a field's other attributes are read as they always were: a placeholder under its own key", async () => {
    const snapshot: JSONObject = snapshotOf([
      {
        tagName: "input",
        id: 10,
        attributes: {
          name: "phone",
          placeholder: NATIONAL_PHONE,
          "aria-label": NATIONAL_PHONE,
          value: NATIONAL_PHONE,
        },
      },
    ]);

    await scrub([snapshot], [PHONE]);

    // Only the value is the field's own; a placeholder names no phone.
    expect(fieldAttributes(snapshot, 10)).toEqual({
      name: "phone",
      placeholder: NATIONAL_PHONE,
      "aria-label": NATIONAL_PHONE,
      value: REDACTED,
    });
  });
});

describe("the input events of a field are read under its names, by its node id", () => {
  test("each field's events under its own names, in the order they come", async () => {
    const snapshot: JSONObject = snapshotOf([
      { tagName: "input", id: 10, attributes: { name: "phone", value: "" } },
      { tagName: "input", id: 11, attributes: { name: "search", value: "" } },
    ]);
    const events: Array<JSONObject> = [
      snapshot,
      inputEvent(10, "020"),
      inputEvent(11, NATIONAL_PHONE),
      inputEvent(10, NATIONAL_PHONE),
      inputEvent(11, "shoes"),
    ];

    await scrub(events, [PHONE]);

    expect(events.slice(1).map(textOf)).toEqual([
      "020",
      NATIONAL_PHONE,
      REDACTED,
      "shoes",
    ]);
  });

  test("an input event of a node the walk never saw is read alone", async () => {
    const unseen: JSONObject = inputEvent(99, NATIONAL_PHONE);
    const unseenOwnShape: JSONObject = inputEvent(98, "201-234-5678");

    await scrub([unseen, unseenOwnShape], [PHONE]);

    expect(textOf(unseen)).toBe(NATIONAL_PHONE);
    expect(textOf(unseenOwnShape)).toBe(REDACTED);
  });

  test("an input event before its field is serialized is read alone: names are read as the walk meets them", async () => {
    const early: JSONObject = inputEvent(10, NATIONAL_PHONE);
    const snapshot: JSONObject = snapshotOf([
      {
        tagName: "input",
        id: 10,
        attributes: { name: "phone", value: NATIONAL_PHONE },
      },
    ]);
    const late: JSONObject = inputEvent(10, NATIONAL_PHONE);

    await scrub([early, snapshot, late], [PHONE]);

    expect(textOf(early)).toBe(NATIONAL_PHONE);
    expect(textOf(late)).toBe(REDACTED);
  });

  test("one walk's fields are its own: another chunk's walk reads its events alone", async () => {
    const snapshot: JSONObject = snapshotOf([
      { tagName: "input", id: 10, attributes: { name: "phone", value: "" } },
    ]);

    await scrub([snapshot], [PHONE]);

    const nextChunk: JSONObject = inputEvent(10, NATIONAL_PHONE);

    await scrub([nextChunk], [PHONE]);

    expect(textOf(nextChunk)).toBe(NATIONAL_PHONE);
  });

  test("a walk remembers the names of 10,000 fields at most, and a field it remembers is brought up to date", async () => {
    const fields: Array<FormField> = [];

    for (let id: number = 100; id < 10_100; id++) {
      fields.push({ tagName: "input", id, attributes: { name: "search" } });
    }

    // One more than the walk remembers, named for a phone.
    fields.push({
      tagName: "input",
      id: 10_100,
      attributes: { name: "phone" },
    });

    const first: JSONObject = snapshotOf(fields);
    // The first field again, renamed by a node a mutation adds: remembered as it is now.
    const renamed: JSONObject = addedNode(2, {
      type: 2,
      tagName: "input",
      id: 100,
      attributes: { name: "phone" },
    });
    const intoForgotten: JSONObject = inputEvent(10_100, NATIONAL_PHONE);
    const intoRenamed: JSONObject = inputEvent(100, NATIONAL_PHONE);

    await scrub([first, renamed, intoForgotten, intoRenamed], [PHONE]);

    // Past the cap, its events are read alone, as an unseen node's.
    expect(textOf(intoForgotten)).toBe(NATIONAL_PHONE);
    expect(textOf(intoRenamed)).toBe(REDACTED);
  });

  test("an event that is no input event is not read under a field's names, though it names the field's node", async () => {
    const snapshot: JSONObject = snapshotOf([
      { tagName: "input", id: 10, attributes: { name: "phone", value: "" } },
    ]);
    // A mouse interaction (source 2) and a scroll (source 3) of the same node.
    const clicked: JSONObject = {
      type: 3,
      timestamp: 1_732_780_801_000,
      data: { source: 2, type: 2, id: 10, x: 120, y: 48, text: NATIONAL_PHONE },
    };

    await scrub([snapshot, clicked], [PHONE]);

    expect((clicked["data"] as JSONObject)["text"]).toBe(NATIONAL_PHONE);
    expect((clicked["data"] as JSONObject)["id"]).toBe(10);
  });
});

describe("a mutation of a field is read under the names it was serialized with, and its own", () => {
  test("a field's value set by a mutation of its attributes", async () => {
    const snapshot: JSONObject = snapshotOf([
      { tagName: "input", id: 10, attributes: { name: "phone", value: "" } },
      { tagName: "input", id: 11, attributes: { name: "search", value: "" } },
    ]);
    const ofPhone: JSONObject = attributeMutation(10, {
      value: NATIONAL_PHONE,
    });
    const ofSearch: JSONObject = attributeMutation(11, {
      value: NATIONAL_PHONE,
    });
    const ofUnseen: JSONObject = attributeMutation(12, {
      value: NATIONAL_PHONE,
    });

    await scrub([snapshot, ofPhone, ofSearch, ofUnseen], [PHONE]);

    expect(mutatedAttributes(ofPhone)["value"]).toBe(REDACTED);
    expect(mutatedAttributes(ofSearch)["value"]).toBe(NATIONAL_PHONE);
    expect(mutatedAttributes(ofUnseen)["value"]).toBe(NATIONAL_PHONE);
  });

  test("a mutation that names the field as it sets its value is read under that name too", async () => {
    const snapshot: JSONObject = snapshotOf([
      { tagName: "input", id: 11, attributes: { name: "search", value: "" } },
    ]);
    const renamed: JSONObject = attributeMutation(11, {
      name: "phone",
      value: NATIONAL_PHONE,
    });

    await scrub([snapshot, renamed], [PHONE]);

    expect(mutatedAttributes(renamed)).toEqual({
      name: "phone",
      value: REDACTED,
    });
  });

  test("a field a mutation adds is read under its names, and remembered for the input events after it", async () => {
    const snapshot: JSONObject = snapshotOf([]);
    const added: JSONObject = addedNode(2, {
      type: 2,
      tagName: "input",
      id: 20,
      attributes: { autocomplete: "tel", value: NATIONAL_PHONE },
    });
    const typed: JSONObject = inputEvent(20, NATIONAL_PHONE);

    await scrub([snapshot, added, typed], [PHONE]);

    expect(addedAttributes(added)).toEqual({
      autocomplete: "tel",
      value: REDACTED,
    });
    expect(textOf(typed)).toBe(REDACTED);
  });
});

describe("a Sensitive Attribute Keys rule hides the whole value of a field its names name", () => {
  test.each([
    [
      "a password field, by its type",
      { type: "password" },
      "correct horse battery staple",
    ],
    ["a field named for a token", { name: "api_token" }, "tok_live_51HxQ2a"],
    ["a field whose id names a secret", { id: "clientSecret" }, "s3cr3t-value"],
    [
      "a field whose autocomplete is a new password",
      { autocomplete: "new-password" },
      "hunter2!",
    ],
  ])("%s", async (_label: string, naming: JSONObject, value: string) => {
    const snapshot: JSONObject = snapshotOf([
      { tagName: "input", id: 10, attributes: { ...naming, value } },
    ]);
    const typed: JSONObject = inputEvent(10, value);
    const mutated: JSONObject = attributeMutation(10, { value });

    await scrub([snapshot, typed, mutated], [SENSITIVE_KEYS]);

    expect(fieldAttributes(snapshot, 10)["value"]).toBe(REDACTED);
    expect(textOf(typed)).toBe(REDACTED);
    expect(mutatedAttributes(mutated)["value"]).toBe(REDACTED);
    // Its names stay as they are: the DOM needs them.
    for (const [attribute, name] of Object.entries(naming)) {
      expect(fieldAttributes(snapshot, 10)[attribute]).toBe(name);
    }
  });

  test("a field its names do not name keeps its value", async () => {
    const snapshot: JSONObject = snapshotOf([
      {
        tagName: "input",
        id: 10,
        attributes: { name: "comment", type: "text", value: "Lovely shop" },
      },
    ]);
    const typed: JSONObject = inputEvent(10, "Lovely shop");

    await scrub([snapshot, typed], [SENSITIVE_KEYS]);

    expect(fieldAttributes(snapshot, 10)["value"]).toBe("Lovely shop");
    expect(textOf(typed)).toBe("Lovely shop");
  });

  test("a name of a paragraph's length is read no further than a field's name goes", async () => {
    const longName: string = `${"x".repeat(300)}password`;
    const snapshot: JSONObject = snapshotOf([
      {
        tagName: "input",
        id: 10,
        attributes: { name: longName, value: "kept" },
      },
    ]);

    await scrub([snapshot], [SENSITIVE_KEYS]);

    // Past the 256 characters read, "password" names nothing.
    expect(fieldAttributes(snapshot, 10)["value"]).toBe("kept");
  });
});

describe("a number under a key that names its type is hidden, as a log's is (#11500)", () => {
  test("a custom event's phone number and SSN sent as numbers", async () => {
    const event: JSONObject = customEvent({
      phone: 2012345678,
      contact: { mobile_phone: 2012345679 },
      ssn: 536221234,
      orderId: 2012345678,
      total: 536221234,
    });

    const result: SessionReplayScrubResult = await scrub([event], [PHONE, SSN]);

    expect(payloadOf(event)).toEqual({
      phone: REDACTED,
      contact: { mobile_phone: REDACTED },
      ssn: REDACTED,
      // A number under a key that names nothing stays the number it is.
      orderId: 2012345678,
      total: 536221234,
    });
    expect(result.stringsScrubbed).toBe(3);
  });

  test("a ZIP code and a coordinate sent as numbers under their keys", async () => {
    const event: JSONObject = customEvent({
      zip: 94107,
      lat: 37.77493,
      lng: -122.41942,
      quantity: 94107,
      price: 37.77493,
    });

    await scrub([event], [POSTAL_CODE, COORDINATES]);

    expect(payloadOf(event)).toEqual({
      zip: REDACTED,
      lat: REDACTED,
      lng: REDACTED,
      quantity: 94107,
      price: 37.77493,
    });
  });

  test("rrweb's own numbers - node ids, timestamps, positions, sources - are never rewritten, by any rule", async () => {
    const digits: CompiledScrubRule = ruleOf(
      LogScrubPatternType.Custom,
      "[0-9]+",
    );
    const snapshot: JSONObject = snapshotOf([
      {
        tagName: "input",
        id: 2012345678,
        attributes: { name: "phone", value: "" },
      },
    ]);
    const moved: JSONObject = {
      type: 3,
      timestamp: 1_732_780_801_000,
      data: {
        source: 1,
        positions: [{ x: 941, y: 377, id: 2012345678, timeOffset: -50 }],
      },
    };
    const before: string = JSON.stringify([snapshot, moved]);

    await scrub(
      [snapshot, moved],
      [PHONE, SSN, POSTAL_CODE, COORDINATES, digits, SENSITIVE_KEYS],
    );

    expect(JSON.stringify([snapshot, moved])).toBe(before);
  });

  test("a number a rule finds nothing in under its key is the number it was, not its text", async () => {
    const event: JSONObject = customEvent({ phone: 42, zip: 0, lat: 9999 });

    await scrub([event], [PHONE, POSTAL_CODE, COORDINATES]);

    expect(payloadOf(event)).toEqual({ phone: 42, zip: 0, lat: 9999 });
  });

  test("a number that is not finite is left as it is", async () => {
    const event: JSONObject = customEvent({ phone: 0 });
    // JSON never carries these, but a walk given one keeps it.
    (event["data"] as JSONObject)["payload"] = {
      phone: Number.POSITIVE_INFINITY,
      ssn: Number.NaN,
    } as unknown as JSONObject;

    await scrub([event], [PHONE, SSN]);

    expect(payloadOf(event)["phone"]).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isNaN(payloadOf(event)["ssn"] as number)).toBe(true);
  });

  test("a Sensitive Attribute Keys rule reads no number: a number under `token` stays a number", async () => {
    const event: JSONObject = customEvent({ token: 2012345678 });

    await scrub([event], [SENSITIVE_KEYS]);

    expect(payloadOf(event)).toEqual({ token: 2012345678 });
  });
});

/*
 * A recording of 400,000 characters of form fields and what was typed in
 * them, in time in line with its length (Tests/Helpers/FastestRun): every
 * field's names are read once and remembered by its node id, and each
 * value read under them as a log's value is under its key. Every attempt
 * scrubs a recording of its own, since the walk changes what it reads.
 */
describe("a recording of 400,000 characters of form fields is scrubbed in time in line with its length", () => {
  const LENGTH: number = 400_000;
  const LIMIT_IN_MS: number = 2000;

  function repeat(unit: string, length: number): string {
    return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
  }

  /*
   * Fields of `value` each, named for a phone by their name and their
   * type, and an input event of each: as many as hold LENGTH characters of
   * values, in the fields and the events together.
   */
  function recordingOf(value: string): Array<JSONValue> {
    const count: number = Math.ceil(LENGTH / (2 * value.length));
    const fields: Array<FormField> = [];
    const typed: Array<JSONObject> = [];

    for (let index: number = 0; index < count; index++) {
      fields.push({
        tagName: "input",
        id: 100 + index,
        attributes: { name: `phone_${index}`, type: "tel", value },
      });
      typed.push(inputEvent(100 + index, value));
    }

    return [snapshotOf(fields), ...typed];
  }

  // Five national numbers to a field, each one ended by a comma.
  const FIVE_NUMBERS: string = repeat(`${NATIONAL_PHONE}, `, 75);

  test.each([
    ["national numbers in their groups, five to a field", FIVE_NUMBERS],
    ["groups of two without end in each field", repeat("12 ", 4_000)],
    [
      "a phone word and hyphens without end in each field",
      `tel ${repeat("0-", 4_000)}`,
    ],
    ["fullwidth digits and hyphens in each field", repeat("０３－", 4_000)],
    [
      "one field of the longest value a walk reads, sixty thousand characters",
      repeat(`${NATIONAL_PHONE}, `, 60_000),
    ],
  ])("%s", async (_label: string, value: string) => {
    const timed: FastestRun<SessionReplayScrubResult> = await fastestRunAsync({
      run: async (): Promise<SessionReplayScrubResult> => {
        return await SessionReplayScrubService.scrubEvents(recordingOf(value), [
          PHONE,
        ]);
      },
      limitInMs: LIMIT_IN_MS,
    });

    expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
    // Read whole: no cap of the walk was reached.
    expect(timed.result.isComplete).toBe(true);
    expect(timed.result.skippedOversizedStrings).toBe(0);
  });

  test("and what it hides there, it hides in every field and every event", async () => {
    const events: Array<JSONValue> = recordingOf(FIVE_NUMBERS);

    const result: SessionReplayScrubResult = await scrub(events, [PHONE]);

    // 2,667 fields of five numbers each, and what was typed in each.
    expect(events.length).toBe(2_668);
    expect(JSON.stringify(events)).not.toContain(NATIONAL_PHONE);
    // Each field's value and each event's text.
    expect(result.stringsScrubbed).toBe(2 * (events.length - 1));
  });
});
