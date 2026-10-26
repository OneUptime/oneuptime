import { translationKey } from "../../../Utils/TranslateTemplate";

/*
 * Every message a form field's own checks say (Forms/Validation), as the
 * English template its translation is looked up by - the field's title goes
 * in as {{field}}. Shared components look a message up in the locale files
 * of the frontend they are drawn in, and the Admin Dashboard, Accounts and
 * status pages keep small files of their own: a message one of them lacks
 * reads English in every language there - every Admin Dashboard form said
 * "Name is required." in English. App's FormValidationMessagesInLocales
 * holds each frontend to the whole list, in all seventeen languages.
 *
 * React-free, so App's tests can read it; Validation says these and no
 * other (FormValidationMessages.test).
 */
export type FormValidationMessageName =
  | "Required"
  | "MinLength"
  | "MaxLength"
  | "NoSpaces"
  | "NoSpecialCharacters"
  | "NoNumbers"
  | "FutureDate"
  | "NotANumber"
  | "MoreThanMaxValue"
  | "LessThanMinValue"
  | "DoesNotMatch"
  | "InvalidEmail"
  | "InvalidJson"
  | "InvalidYaml";

export const FormValidationMessage: Readonly<
  Record<FormValidationMessageName, string>
> = {
  Required: translationKey("{{field}} is required."),
  MinLength: translationKey(
    "{{field}} cannot be less than {{minLength}} characters.",
  ),
  MaxLength: translationKey(
    "{{field}} cannot be more than {{maxLength}} characters.",
  ),
  NoSpaces: translationKey("{{field}} should not have spaces."),
  NoSpecialCharacters: translationKey(
    "{{field}} can only contain letters, numbers, hyphens (-), and underscores (_).",
  ),
  NoNumbers: translationKey("{{field}} should not have numbers."),
  FutureDate: translationKey("{{field}} should be a future date."),
  NotANumber: translationKey("{{field}} should be a number."),
  MoreThanMaxValue: translationKey(
    "{{field}} should not be more than {{maxValue}}.",
  ),
  LessThanMinValue: translationKey(
    "{{field}} should not be less than {{minValue}}.",
  ),
  DoesNotMatch: translationKey("{{field}} should match {{matchField}}"),
  InvalidEmail: translationKey("Email is not valid."),
  InvalidJson: translationKey("{{field}} is not valid JSON. {{parserMessage}}"),
  InvalidYaml: translationKey("{{field}} is not valid YAML. {{parserMessage}}"),
};

export const FORM_VALIDATION_MESSAGES: ReadonlyArray<string> = Object.values(
  FormValidationMessage,
);
