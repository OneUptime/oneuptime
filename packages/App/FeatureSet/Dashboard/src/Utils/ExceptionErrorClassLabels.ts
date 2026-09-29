import ErrorClass, { toErrorClass } from "Common/Types/Telemetry/ErrorClass";

/*
 * Sentence-case labels for the raw enum values, shared by the exceptions
 * list (facet sidebar and chips) and the exception detail header.
 * "Unclassified" rather than "Unknown" because the value means "triage could
 * not decide", which reads as an accusation of the reader otherwise.
 */
export const ERROR_CLASS_DISPLAY_NAMES: Record<string, string> = {
  [ErrorClass.CodeFault]: "Code fault",
  [ErrorClass.UserError]: "User error",
  [ErrorClass.ExpectedDenial]: "Expected denial",
  [ErrorClass.Infrastructure]: "Infrastructure",
  [ErrorClass.Unknown]: "Unclassified",
};

/*
 * The label the detail header shows for a group's error class. Unclassified
 * groups (and values outside the vocabulary, which older rows can hold) show
 * nothing: a badge that only says "we do not know" is noise on the header.
 */
export function getErrorClassBadgeLabel(value: unknown): string | null {
  const errorClass: ErrorClass | null = toErrorClass(value);

  if (!errorClass || errorClass === ErrorClass.Unknown) {
    return null;
  }

  return ERROR_CLASS_DISPLAY_NAMES[errorClass] || null;
}
