type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JsonValue[]
  | { [key: string]: JsonValue };

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Date),
  );
};

const serializeValue = (value: unknown): JsonValue => {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return {
      _type: "DateTime",
      value: value.toISOString(),
    } as JsonValue;
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item)) as JsonValue[];
  }

  if (isPlainObject(value)) {
    if ((value as Record<string, unknown>)._type) {
      return value as JsonValue;
    }

    const result: Record<string, JsonValue> = {};
    Object.entries(value).forEach(([key, val]) => {
      result[key] = serializeValue(val);
    });
    return result;
  }

  return value as JsonValue;
};

export const serializeForRequest = (payload: Record<string, unknown>): JsonValue => {
  return serializeValue(payload);
};

export const objectId = (id: string): JsonValue => ({
  _type: "ObjectID",
  value: id,
});

export const includes = (values: string[]): JsonValue => ({
  _type: "Includes",
  value: values,
});
