import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";
import {
  FORM_VALIDATION_MESSAGES,
  FormValidationMessage,
} from "../../../../../UI/Components/Forms/Utils/FormValidationMessages";
import Validation from "../../../../../UI/Components/Forms/Validation";
import FormFieldSchemaType from "../../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Field from "../../../../../UI/Components/Forms/Types/Field";
import FormValues from "../../../../../UI/Components/Forms/Types/FormValues";

/*
 * Forms/Utils/FormValidationMessages: every message a form field's own
 * checks say, named in one list, so every frontend with locale files of its
 * own can be held to all of them (App's FormValidationMessagesInLocales).
 * The Admin Dashboard's had none of them, so every Admin form said "Name is
 * required." in English in every language.
 *
 * Pinned here: Validation says these and no other - each check, run, says
 * one of them, and Validation's source hands translateValidationMessage
 * nothing but a name from the list, so a new message cannot skip it.
 */

const VALIDATION_SOURCE: string = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "..",
    "UI",
    "Components",
    "Forms",
    "Validation.ts",
  ),
  "utf8",
);

type AnyField = Field<FormValues<any>>;

function field(partial: Partial<AnyField>): AnyField {
  return {
    name: "value",
    field: { value: true },
    title: "Value",
    ...partial,
  } as AnyField;
}

function errorFor(f: AnyField, value: unknown): string | undefined {
  return Validation.validate({
    formFields: [f],
    values: { value } as FormValues<any>,
    onValidate: undefined,
  })["value"];
}

describe("the form validation messages", () => {
  test("are the fourteen the checks say, each once", () => {
    expect(FORM_VALIDATION_MESSAGES).toEqual([
      "{{field}} is required.",
      "{{field}} cannot be less than {{minLength}} characters.",
      "{{field}} cannot be more than {{maxLength}} characters.",
      "{{field}} should not have spaces.",
      "{{field}} can only contain letters, numbers, hyphens (-), and underscores (_).",
      "{{field}} should not have numbers.",
      "{{field}} should be a future date.",
      "{{field}} should be a number.",
      "{{field}} should not be more than {{maxValue}}.",
      "{{field}} should not be less than {{minValue}}.",
      "{{field}} should match {{matchField}}",
      "Email is not valid.",
      "{{field}} is not valid JSON. {{parserMessage}}",
      "{{field}} is not valid YAML. {{parserMessage}}",
    ]);
    expect(new Set(FORM_VALIDATION_MESSAGES).size).toBe(
      FORM_VALIDATION_MESSAGES.length,
    );
  });

  test("Validation hands translateValidationMessage only a name from the list", () => {
    const calls: Array<string> = VALIDATION_SOURCE.split(
      "translateValidationMessage(",
    ).slice(1);

    // The definition's own parameters, then every call.
    const handed: Array<string> = calls
      .map((call: string): string => {
        return call.trim().split(/[,)]/)[0]!.trim();
      })
      .filter((argument: string): boolean => {
        return !argument.startsWith("template:");
      });

    expect(handed.length).toBeGreaterThanOrEqual(14);

    for (const argument of handed) {
      expect(argument).toMatch(/^FormValidationMessage\.[A-Za-z]+$/);
    }
  });

  test("each check says its message", () => {
    expect(errorFor(field({ required: true }), "")).toBe("Value is required.");
    expect(errorFor(field({ validation: { minLength: 3 } }), "ab")).toBe(
      "Value cannot be less than 3 characters.",
    );
    expect(errorFor(field({ validation: { maxLength: 2 } }), "abc")).toBe(
      "Value cannot be more than 2 characters.",
    );
    expect(errorFor(field({ validation: { noSpaces: true } }), "a b")).toBe(
      "Value should not have spaces.",
    );
    expect(
      errorFor(field({ validation: { noSpecialCharacters: true } }), "a!"),
    ).toBe(
      "Value can only contain letters, numbers, hyphens (-), and underscores (_).",
    );
    expect(errorFor(field({ validation: { noNumbers: true } }), "a1")).toBe(
      "Value should not have numbers.",
    );
    expect(
      errorFor(
        field({ validation: { dateShouldBeInTheFuture: true } }),
        "2001-01-01",
      ),
    ).toBe("Value should be a future date.");
    expect(errorFor(field({ validation: { maxValue: 10 } }), "11")).toBe(
      "Value should not be more than 10.",
    );
    expect(errorFor(field({ validation: { minValue: 10 } }), "9")).toBe(
      "Value should not be less than 10.",
    );
    expect(
      errorFor(field({ fieldType: FormFieldSchemaType.Email }), "not-mail"),
    ).toBe("Email is not valid.");
    expect(
      errorFor(field({ fieldType: FormFieldSchemaType.JSON }), "{,}"),
    ).toMatch(/^Value is not valid JSON\./);
    expect(
      errorFor(field({ fieldType: FormFieldSchemaType.YAML }), "a: [b"),
    ).toMatch(/^Value is not valid YAML\./);
  });

  test("a name in the list is its message", () => {
    expect(FormValidationMessage.Required).toBe("{{field}} is required.");
    expect(FormValidationMessage.InvalidEmail).toBe("Email is not valid.");
  });
});
