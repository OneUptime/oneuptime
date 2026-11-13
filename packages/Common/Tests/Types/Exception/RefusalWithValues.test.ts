import {
  getRefusalText,
  readRefusalValues,
  RefusalWithValues,
} from "../../../Types/Exception/RefusalWithValues";
import { translatableTerm } from "../../../Types/Translator";
import { describe, expect, test } from "@jest/globals";

/*
 * A REFUSAL WITH VALUES IN IT (#7678): the server fills the sentence in
 * English, and the Dashboard reads the values back out of that English to
 * say the sentence in its reader's language.
 */

const MISMATCH: RefusalWithValues = {
  template:
    "This monitor's type is {{monitorType}}, and this template's type is {{templateType}}. Only monitors of the template's type can be linked to it.",
  terms: ["monitorType", "templateType"],
};

const MOVED: RefusalWithValues = {
  template: '"{{name}}" moved to {{place}}.',
  terms: ["place"],
};

describe("getRefusalText: the refusal as the server answers it", () => {
  test("fills the sentence in English with its values", () => {
    expect(
      getRefusalText(MISMATCH, {
        monitorType: "Incoming Request",
        templateType: "API",
      }),
    ).toBe(
      "This monitor's type is Incoming Request, and this template's type is API. Only monitors of the template's type can be linked to it.",
    );
  });
});

describe("readRefusalValues: the values read back", () => {
  test("each value of the server's sentence, its terms as words to say in the reader's language", () => {
    expect(
      readRefusalValues(
        MISMATCH,
        getRefusalText(MISMATCH, {
          monitorType: "Incoming Request",
          templateType: "SSL Certificate",
        }),
      ),
    ).toEqual({
      monitorType: translatableTerm("Incoming Request"),
      templateType: translatableTerm("SSL Certificate"),
    });
  });

  test("a value that is not a term goes in as written", () => {
    expect(
      readRefusalValues(
        MOVED,
        getRefusalText(MOVED, { name: "Checkout, EU", place: "Archive" }),
      ),
    ).toEqual({
      name: "Checkout, EU",
      place: translatableTerm("Archive"),
    });
  });

  test("space around the message is not part of it", () => {
    expect(
      readRefusalValues(
        MISMATCH,
        `  ${getRefusalText(MISMATCH, { monitorType: "Ping", templateType: "API" })}\n`,
      ),
    ).toEqual({
      monitorType: translatableTerm("Ping"),
      templateType: translatableTerm("API"),
    });
  });

  test.each([
    ["another sentence", "Monitor not found"],
    ["no message", ""],
    ["the sentence's start only", "This monitor's type is Ping"],
    [
      "the sentence with another ending",
      "This monitor's type is Ping, and this template's type is API. Something else.",
    ],
    [
      "an empty value",
      "This monitor's type is , and this template's type is API. Only monitors of the template's type can be linked to it.",
    ],
  ])("is null for %s", (_name: string, message: string) => {
    expect(readRefusalValues(MISMATCH, message)).toBeNull();
  });

  test("is null for no message at all", () => {
    expect(readRefusalValues(MISMATCH, undefined)).toBeNull();
    expect(readRefusalValues(MISMATCH, null)).toBeNull();
  });

  test("a placeholder named twice reads the same value both times, or the message is not the refusal", () => {
    const twice: RefusalWithValues = {
      template: "{{name}} is {{name}}.",
      terms: [],
    };

    expect(readRefusalValues(twice, "Probe is Probe.")).toEqual({
      name: "Probe",
    });
    expect(readRefusalValues(twice, "Probe is Agent.")).toBeNull();
  });

  test("two placeholders with no words between them cannot be told apart", () => {
    const adjacent: RefusalWithValues = {
      template: "Read {{first}}{{second}}.",
      terms: [],
    };

    expect(readRefusalValues(adjacent, "Read ab.")).toBeNull();
  });

  test("a sentence with no placeholders is a key on its own, never read for values", () => {
    expect(
      readRefusalValues(
        { template: "This monitor is not linked to this template.", terms: [] },
        "This monitor is not linked to this template.",
      ),
    ).toBeNull();
  });
});
