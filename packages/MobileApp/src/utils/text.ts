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

/**
 * Up to two letters for an avatar: the first letters of the first and last
 * words. "Ada Lovelace" is "AL", "(Ops) Team" is "OT", and an email address
 * uses its local part, so "jordan.lee@example.com" is "JL". Returns an empty
 * string when nothing usable is left, which avatars show as an icon instead.
 */
export function getInitials(source: string | null | undefined): string {
  const words: Array<string> = (source ?? "")
    .replace(/@.*$/, "")
    .split(/[\s._+-]+/)
    .map((word: string): string => {
      // Leading punctuation such as "(Ops)" is not part of anybody's initial.
      return word.replace(/^[^0-9A-Za-z\u00C0-\uFFFF]+/, "");
    })
    .filter((word: string): boolean => {
      return word.length > 0;
    });
  if (words.length === 0) {
    return "";
  }
  const first: string = Array.from(words[0]!)[0] ?? "";
  const last: string =
    words.length > 1 ? Array.from(words[words.length - 1]!)[0] ?? "" : "";
  return `${first}${last}`.toUpperCase();
}
