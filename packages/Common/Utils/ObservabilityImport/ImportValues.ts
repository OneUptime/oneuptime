/*
 * READING A FILE SOMEONE ELSE WROTE (issue #7697).
 *
 * A Grafana dashboard, a Datadog export or a rule file is the person's,
 * and anything could be in it. It is parsed strictly (JSON.parse, or YAML
 * with no tags that run code), and read through these: a value is only
 * taken when it is the type the tool writes, a field only when the object
 * holds it itself - so a key named __proto__ or constructor reads as
 * nothing - and nothing from the file is ever merged into an object.
 */

export type ImportObject = Record<string, unknown>;

// The value when it is a plain object (not an array, not null).
export const asObject: (value: unknown) => ImportObject | undefined = (
  value: unknown,
): ImportObject | undefined => {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ImportObject)
    : undefined;
};

// The value when it is an array.
export const asArray: (value: unknown) => Array<unknown> = (
  value: unknown,
): Array<unknown> => {
  return Array.isArray(value) ? value : [];
};

// A field the object holds itself.
export const field: (
  object: ImportObject | undefined,
  key: string,
) => unknown = (object: ImportObject | undefined, key: string): unknown => {
  if (!object || !Object.prototype.hasOwnProperty.call(object, key)) {
    return undefined;
  }

  return object[key];
};

// A text field, trimmed; "" when it is not text.
export const textField: (
  object: ImportObject | undefined,
  key: string,
) => string = (object: ImportObject | undefined, key: string): string => {
  const value: unknown = field(object, key);

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return "";
};

// A number field (or numeric text); undefined when it is neither.
export const numberField: (
  object: ImportObject | undefined,
  key: string,
) => number | undefined = (
  object: ImportObject | undefined,
  key: string,
): number | undefined => {
  const value: unknown = field(object, key);

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed: number = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
};

export const booleanField: (
  object: ImportObject | undefined,
  key: string,
) => boolean | undefined = (
  object: ImportObject | undefined,
  key: string,
): boolean | undefined => {
  const value: unknown = field(object, key);
  return typeof value === "boolean" ? value : undefined;
};

export const objectField: (
  object: ImportObject | undefined,
  key: string,
) => ImportObject | undefined = (
  object: ImportObject | undefined,
  key: string,
): ImportObject | undefined => {
  return asObject(field(object, key));
};

export const arrayField: (
  object: ImportObject | undefined,
  key: string,
) => Array<unknown> = (
  object: ImportObject | undefined,
  key: string,
): Array<unknown> => {
  return asArray(field(object, key));
};

/*
 * A string -> string map the object holds (labels, annotations), its own
 * keys only, in a Map so no key reaches an object's prototype.
 */
export const stringMapField: (
  object: ImportObject | undefined,
  key: string,
) => Map<string, string> = (
  object: ImportObject | undefined,
  key: string,
): Map<string, string> => {
  const map: Map<string, string> = new Map<string, string>();
  const source: ImportObject | undefined = objectField(object, key);

  if (!source) {
    return map;
  }

  for (const name of Object.keys(source)) {
    const value: unknown = source[name];

    if (typeof value === "string") {
      map.set(name, value);
    } else if (typeof value === "number" || typeof value === "boolean") {
      map.set(name, String(value));
    }
  }

  return map;
};

// Text cut to a length, so a name or a title fits where it goes.
export const cutText: (text: string, maxLength: number) => string = (
  text: string,
  maxLength: number,
): string => {
  const trimmed: string = (text || "").trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};
