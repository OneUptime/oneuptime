import { JSONObject } from "../../../Types/JSON";
import { getEntityCaseGroupingKey } from "../../../Utils/SecurityCase/SecurityEntityRiskScore";
import {
  ErasedName,
  TITLE_VALUE_SEPARATOR,
  getErasedRiskKeys,
  namesAnyone,
  unnameGroupingKey,
  unnameJson,
  unnameTitle,
  unnameValue,
} from "../../../Utils/SecurityEvent/SecurityUserErasureUnnaming";
import { describe, expect, test } from "@jest/globals";

/*
 * Taking an erased person out of what Security Events wrote about them
 * (#10908): whole values, and the one title shape OneUptime makes, get
 * what the Hash rule left in the name's place - never a name found inside
 * other words, which a short user id would mangle and which is people's to
 * change.
 */

const TOKEN: string = "[HASHED:5e29db14e508e09a]";
const NAMES: Array<ErasedName> = [
  { named: "alice@example.com", hashed: TOKEN },
  { named: "auth0|alice@example.com", hashed: `auth0|${TOKEN}` },
  { named: "bob", hashed: "[HASHED:aaaaaaaaaaaaaaab]" },
];

describe("a whole value", () => {
  test("that is one of the names becomes what the rule left", () => {
    expect(unnameValue("alice@example.com", NAMES)).toBe(TOKEN);
    expect(unnameValue("auth0|alice@example.com", NAMES)).toBe(
      `auth0|${TOKEN}`,
    );
  });

  test("that only holds a name, or spells it in another case, stays: only the vault's own spelling is the person", () => {
    expect(unnameValue("Alice@Example.com", NAMES)).toBe("Alice@Example.com");
    expect(unnameValue("alice@example.com ", NAMES)).toBe("alice@example.com ");
    expect(unnameValue("bobby", NAMES)).toBe("bobby");
  });

  test("nothing stays nothing", () => {
    expect(unnameValue(undefined, NAMES)).toBeUndefined();
    expect(unnameValue(null, NAMES)).toBeNull();
    expect(unnameValue("", NAMES)).toBe("");
  });
});

describe("a title OneUptime made", () => {
  test("<rule> — <name> ends in what the rule left instead", () => {
    expect(
      unnameTitle(
        `Repeated failed sign-ins for one account${TITLE_VALUE_SEPARATOR}alice@example.com`,
        NAMES,
      ),
    ).toBe(`Repeated failed sign-ins for one account — ${TOKEN}`);
    expect(unnameTitle("Brute force — auth0|alice@example.com", NAMES)).toBe(
      `Brute force — auth0|${TOKEN}`,
    );
  });

  test("a title that is the name alone becomes what the rule left", () => {
    expect(unnameTitle("bob", NAMES)).toBe("[HASHED:aaaaaaaaaaaaaaab]");
  });

  test("a name inside other words stays as written: a short id is part of many sentences", () => {
    for (const title of [
      "Look at bob's sign-ins",
      "alice@example.com signed in from a new country",
      "Brute force — alice@example.com, then a success",
      "Brute force — bobsleigh",
    ]) {
      expect(unnameTitle(title, NAMES)).toBe(title);
    }
  });

  test("nothing stays nothing", () => {
    expect(unnameTitle(undefined, NAMES)).toBeUndefined();
    expect(unnameTitle(null, NAMES)).toBeNull();
  });
});

describe("a case's grouping key", () => {
  test("the key about a name becomes the key about what the rule left", () => {
    expect(
      unnameGroupingKey(getEntityCaseGroupingKey("alice@example.com"), NAMES),
    ).toBe(getEntityCaseGroupingKey(TOKEN));
  });

  test("any other key stays", () => {
    expect(
      unnameGroupingKey(getEntityCaseGroupingKey("203.0.113.7"), NAMES),
    ).toBe(getEntityCaseGroupingKey("203.0.113.7"));
    expect(unnameGroupingKey("detection-rule:abc", NAMES)).toBe(
      "detection-rule:abc",
    );
    expect(unnameGroupingKey(undefined, NAMES)).toBeUndefined();
  });
});

describe("the entity risk keys of the names", () => {
  test("each name's key, once, case folded as risk keys are", () => {
    expect(
      getErasedRiskKeys([
        ...NAMES,
        { named: "Alice@Example.com", hashed: "[HASHED:1111111111111111]" },
      ]).sort(),
    ).toEqual(["alice@example.com", "auth0|alice@example.com", "bob"].sort());
  });
});

describe("a JSON value", () => {
  test("every whole string that is a name is replaced, at any depth; keys never are", () => {
    const value: JSONObject = {
      entities: [
        { type: "User", value: "alice@example.com" },
        { type: "IP Address", value: "203.0.113.7" },
      ],
      events: [
        {
          principalUser: "auth0|alice@example.com",
          observables: ["alice@example.com", "203.0.113.7"],
          message: "Failed password for alice@example.com",
          "alice@example.com": "a key that is the name",
        },
      ],
      count: 7,
      flagged: true,
      nothing: null,
    };

    const result: { value: JSONObject; changed: boolean } = unnameJson(
      value,
      NAMES,
    );

    expect(result.changed).toBe(true);
    expect(result.value).toEqual({
      entities: [
        { type: "User", value: TOKEN },
        { type: "IP Address", value: "203.0.113.7" },
      ],
      events: [
        {
          principalUser: `auth0|${TOKEN}`,
          observables: [TOKEN, "203.0.113.7"],
          // A name inside words is the words' own.
          message: "Failed password for alice@example.com",
          "alice@example.com": "a key that is the name",
        },
      ],
      count: 7,
      flagged: true,
      nothing: null,
    });
  });

  test("leaves what it was handed as it was", () => {
    const value: JSONObject = { entities: [{ value: "alice@example.com" }] };
    const copy: string = JSON.stringify(value);

    unnameJson(value, NAMES);

    expect(JSON.stringify(value)).toBe(copy);
  });

  test("hands back the very value, and says so, when nothing names anyone", () => {
    const value: JSONObject = { entities: [{ value: "carol@example.com" }] };
    const result: { value: JSONObject; changed: boolean } = unnameJson(
      value,
      NAMES,
    );

    expect(result.changed).toBe(false);
    expect(result.value).toBe(value);
    expect(namesAnyone(value, NAMES)).toBe(false);
    expect(namesAnyone({ user: "bob" }, NAMES)).toBe(true);
  });

  test("nothing, a list, a bare string", () => {
    expect(unnameJson(undefined, NAMES)).toEqual({
      value: undefined,
      changed: false,
    });
    expect(unnameJson(null, NAMES)).toEqual({ value: null, changed: false });
    expect(unnameJson(["bob", "carol"], NAMES)).toEqual({
      value: ["[HASHED:aaaaaaaaaaaaaaab]", "carol"],
      changed: true,
    });
    expect(unnameJson("alice@example.com", NAMES)).toEqual({
      value: TOKEN,
      changed: true,
    });
  });
});
