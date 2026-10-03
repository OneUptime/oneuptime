import {
  KeyFormat,
  makeKeyFromName,
  makeUniqueKeyFromName,
} from "../../Utils/KeyFromName";

/*
 * A measurement's key: the permanent, machine readable half of its metric
 * name, oneuptime.<incident|alert|scheduled-maintenance>.measurement.<key>.
 *
 * Nobody has to type one. The key is made from the measurement's name -
 * "Time to Detect" gets "time-to-detect" - by the form while the name is
 * typed and by the server when a create leaves it out, so a person names the
 * measurement and is done. Someone who wants a different key can still set
 * one, before the measurement is created: afterwards it never changes,
 * because every point already written sits under the old metric name.
 *
 * Pure, so the dashboard and the server make the same key from the same
 * name.
 */

/*
 * The longest key the server accepts. The metric name around it adds about
 * forty characters, and a ClickHouse metric name is easier to read short.
 */
export const MEASUREMENT_KEY_MAX_LENGTH: number = 50;

/*
 * What a name with nothing usable in it becomes ("!!!", or a name written
 * wholly in a script with no Latin transliteration, such as "検出までの時間"):
 * measurement, measurement-2, ...
 */
export const MEASUREMENT_KEY_FALLBACK: string = "measurement";

// How Utils/KeyFromName makes a measurement's key from its name.
export const MEASUREMENT_KEY_FORMAT: KeyFormat = {
  separator: "-",
  maxLength: MEASUREMENT_KEY_MAX_LENGTH,
  fallback: MEASUREMENT_KEY_FALLBACK,
};

/*
 * What the server accepts for a key someone typed: a lowercase letter or
 * digit, then lowercase letters, digits and hyphens, at most fifty in all.
 * Every key made from a name fits it. Looser than what the generator makes
 * ("a--b" passes): keys that were typed before keys were made from names
 * stay valid.
 */
export const MEASUREMENT_KEY_PATTERN: RegExp = /^[a-z0-9][a-z0-9-]{0,49}$/;

export type IsValidMeasurementKeyFunction = (key: unknown) => boolean;

export const isValidMeasurementKey: IsValidMeasurementKeyFunction = (
  key: unknown,
): boolean => {
  return typeof key === "string" && MEASUREMENT_KEY_PATTERN.test(key);
};

// What a form says about a key someone typed that the server would refuse.
export const MEASUREMENT_KEY_INVALID_MESSAGE: string =
  "Use lowercase letters (a-z), numbers and hyphens, starting with a letter or a number, at most 50 characters.";

export type GetMeasurementKeyErrorFunction = (key: string) => string | null;

/**
 * The form's message for a key someone typed, or null when the server takes
 * it. A key made from the name is never asked: it always fits.
 */
export const getMeasurementKeyError: GetMeasurementKeyErrorFunction = (
  key: string,
): string | null => {
  return isValidMeasurementKey(key) ? null : MEASUREMENT_KEY_INVALID_MESSAGE;
};

export type GetMeasurementKeyFromNameFunction = (name: string) => string;

/**
 * The key a measurement of this name gets when no other measurement of the
 * project has it: "Time to Detect" -> "time-to-detect". Never empty, and
 * always a valid key.
 */
export const getMeasurementKeyFromName: GetMeasurementKeyFromNameFunction = (
  name: string,
): string => {
  return makeKeyFromName(name, MEASUREMENT_KEY_FORMAT);
};

export type GenerateMeasurementKeyFunction = (data: {
  name: string;
  // The keys the project's other measurements (of the same kind) hold.
  existingKeys: Iterable<string | null | undefined>;
}) => string;

/**
 * The key for a new measurement created without one: its name's key, or
 * the first of key-2, key-3, ... that no other measurement holds.
 */
export const generateMeasurementKey: GenerateMeasurementKeyFunction = (data: {
  name: string;
  existingKeys: Iterable<string | null | undefined>;
}): string => {
  return makeUniqueKeyFromName({
    name: data.name,
    existingKeys: data.existingKeys,
    format: MEASUREMENT_KEY_FORMAT,
  });
};
