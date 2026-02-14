interface SerializedValue {
  _type?: unknown;
  value?: unknown;
}

function isSerializedValue(value: unknown): value is SerializedValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return "_type" in value && "value" in value;
}

export function toPlainText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (isSerializedValue(value)) {
    return toPlainText(value.value);
  }

  if (Array.isArray(value)) {
    return value
      .map((item: unknown) => {
        return toPlainText(item);
      })
      .filter((item: string) => {
        return item.length > 0;
      })
      .join(", ");
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
