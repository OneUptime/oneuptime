import { describe, expect, test } from "@jest/globals";
import {
  getFactsNotInHeading,
  isFactSaidByHeading,
  isFactSaidBySubheading,
  ResourceCardFact,
} from "../../../Types/AI/ResourceCardFacts";

/*
 * The card Ask AI leaves under an answer says each fact once. Its heading
 * ("ALT-12 · High memory usage on test01") and subheading ("Severity:
 * High") name the record; a fact under them that only says one of those
 * again - Number ALT-12, Severity High - is left out. Only an exact repeat
 * counts: a word inside a title never stands for a fact.
 */

describe("isFactSaidByHeading", () => {
  test("a value that is the whole heading, or one of its parts", () => {
    expect(isFactSaidByHeading("#42", "#42 · Payment API down")).toBe(true);
    expect(
      isFactSaidByHeading("Payment API down", "#42 · Payment API down"),
    ).toBe(true);
    expect(isFactSaidByHeading("Payment API down", "Payment API down")).toBe(
      true,
    );
  });

  test("whatever its case and spaces", () => {
    expect(isFactSaidByHeading("  alt-12 ", "ALT-12 · High memory usage")).toBe(
      true,
    );
  });

  test("never a word inside a part", () => {
    // An alert titled "Memory is high" does not say its severity is High.
    expect(isFactSaidByHeading("High", "ALT-12 · Memory is high")).toBe(false);
    expect(isFactSaidByHeading("42", "#42 · Payment API down")).toBe(false);
  });

  test("an empty value or an empty heading says nothing", () => {
    expect(isFactSaidByHeading("", "#42 · Payment API down")).toBe(false);
    expect(isFactSaidByHeading("   ", "#42 · Payment API down")).toBe(false);
    expect(isFactSaidByHeading("#42", "")).toBe(false);
  });
});

describe("isFactSaidBySubheading", () => {
  test("the fact written as the line: label, a colon and the value", () => {
    expect(
      isFactSaidBySubheading(
        { label: "Severity", value: "High" },
        "Severity: High",
      ),
    ).toBe(true);
  });

  test("the label and the value with no colon", () => {
    expect(
      isFactSaidBySubheading(
        { label: "Incident", value: "#42" },
        "Incident #42",
      ),
    ).toBe(true);
  });

  test("the value as the whole line or one of its parts", () => {
    expect(
      isFactSaidBySubheading(
        { label: "State", value: "Investigating" },
        "Investigating",
      ),
    ).toBe(true);
    expect(
      isFactSaidBySubheading(
        { label: "State", value: "Investigating" },
        "High · Investigating",
      ),
    ).toBe(true);
    expect(
      isFactSaidBySubheading(
        { label: "Severity", value: "High" },
        "Severity: High · Investigating",
      ),
    ).toBe(true);
  });

  test("another fact on the line is not this one", () => {
    expect(
      isFactSaidBySubheading(
        { label: "Severity", value: "Low" },
        "Severity: High",
      ),
    ).toBe(false);
    expect(
      isFactSaidBySubheading(
        { label: "Owner", value: "High" },
        "Severity: High",
      ),
    ).toBe(false);
  });

  test("no value, or no line, says nothing", () => {
    expect(
      isFactSaidBySubheading({ label: "Severity", value: "" }, "Severity: "),
    ).toBe(false);
    expect(
      isFactSaidBySubheading({ label: "Severity", value: "High" }, ""),
    ).toBe(false);
  });
});

describe("getFactsNotInHeading", () => {
  test("the alert Ask AI raised: its number and severity are said above, the rest stays in its order", () => {
    const facts: Array<ResourceCardFact> = getFactsNotInHeading({
      heading: "ALT-12 · High memory usage on test01",
      subheading: "Severity: High",
      fields: [
        { label: "Number", value: "ALT-12" },
        { label: "Severity", value: "High" },
        { label: "State", value: "Created" },
        { label: "Linked to", value: "Host test01" },
      ],
    });

    expect(facts).toEqual([
      { label: "State", value: "Created" },
      { label: "Linked to", value: "Host test01" },
    ]);
  });

  test("an incident: Number #42 under a heading that starts with #42", () => {
    expect(
      getFactsNotInHeading({
        heading: "#42 · Payment API down",
        subheading: "Incident #42",
        fields: [
          { label: "Number", value: "#42" },
          { label: "Incident", value: "#42" },
          { label: "Severity", value: "SEV1" },
        ],
      }),
    ).toEqual([{ label: "Severity", value: "SEV1" }]);
  });

  test("a card with no heading, no subheading or no facts", () => {
    expect(getFactsNotInHeading({})).toEqual([]);
    expect(
      getFactsNotInHeading({ fields: [{ label: "State", value: "Open" }] }),
    ).toEqual([{ label: "State", value: "Open" }]);
    expect(
      getFactsNotInHeading({ heading: "Open", subheading: "", fields: [] }),
    ).toEqual([]);
  });

  test("a fact with an empty value is kept, as the card drew it before", () => {
    expect(
      getFactsNotInHeading({
        heading: "#42 · Payment API down",
        fields: [{ label: "Note", value: "" }],
      }),
    ).toEqual([{ label: "Note", value: "" }]);
  });
});
