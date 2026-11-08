import { AUDIT_LOG_REDACTED_VALUE } from "../../Types/AuditLog/AuditLogRedaction";
import { ObjectType } from "../../Types/JSON";

/*
 * A PHONE NUMBER IN AN AUDIT LOG ENTRY READS AS THE NUMBER (issue #6325).
 *
 * OneUptime keeps a phone number, an email address, a URL, a host name and
 * values like them as typed objects (Phone, Email, URL, Hostname), and
 * writes each one as JSON in the shape its toJSON gives:
 * { "_type": "Phone", "value": "+14155550100" }. An entry that recorded that
 * JSON showed it in the changes dialog, Before and After, and called the
 * change "Changed the value". So an entry records such a value as what
 * people read, as it always recorded an id or a time: "+14155550100".
 *
 * WHAT READS AS A VALUE. A { _type, value } with no other keys, whose value
 * is text, a number or a switch, and whose _type is one of OneUptime's own
 * (ObjectType) that AUDIT_LOG_TYPED_VALUE_READINGS reads as one:
 *
 *   - Value: what people read as it is: an id, a time, a name, an email
 *     address, a phone number, a URL, a host name, a port, a version, a
 *     colour, a number;
 *   - Secret: a hash, a secret wherever it is: "[REDACTED]";
 *   - Json: not a value of its own: a structure (a monitor's steps, a
 *     schedule's restriction times) or a query filter (EqualTo, Search).
 *     It stays JSON, with the paths that changed.
 *
 * Every ObjectType is decided there (the compiler holds the list to the
 * whole enum), and AuditLogTypedValues.test.ts holds every { _type, value }
 * that Common/Types writes to a decision, and each class read as a value to
 * giving one. Anything else - more keys, a value that is JSON itself, a
 * _type that is not OneUptime's - stays JSON, as before. Only a whole value
 * is read: a phone number inside a JSON setting stays part of that JSON.
 *
 * SECRETS FIRST. The recorder redacts a secret column's value before it
 * serializes anything (AuditLogRedaction), so a typed value in a secret
 * column is "[REDACTED]" before it is ever read here.
 *
 * ENTRIES ALREADY RECORDED keep their JSON until their retention ends (at
 * most 180 days). The changes dialog and the export read each change
 * through readAuditLogChange, so a number recorded last month reads as the
 * number too, as if it were recorded today.
 *
 * Nothing here runs a regular expression over a value. Pure: no DOM, no
 * server.
 */

export enum AuditLogTypedValueReading {
  // What people read as it is.
  Value = "Value",
  // A secret wherever it is: recorded as "[REDACTED]".
  Secret = "Secret",
  // Not a value of its own: kept as JSON.
  Json = "Json",
}

export const AUDIT_LOG_TYPED_VALUE_READINGS: Readonly<
  Record<ObjectType, AuditLogTypedValueReading>
> = {
  // Values people read as they are.
  [ObjectType.ObjectID]: AuditLogTypedValueReading.Value,
  [ObjectType.DateTime]: AuditLogTypedValueReading.Value,
  [ObjectType.Name]: AuditLogTypedValueReading.Value,
  [ObjectType.Email]: AuditLogTypedValueReading.Value,
  [ObjectType.Phone]: AuditLogTypedValueReading.Value,
  [ObjectType.URL]: AuditLogTypedValueReading.Value,
  [ObjectType.Route]: AuditLogTypedValueReading.Value,
  [ObjectType.Hostname]: AuditLogTypedValueReading.Value,
  [ObjectType.Domain]: AuditLogTypedValueReading.Value,
  [ObjectType.IP]: AuditLogTypedValueReading.Value,
  [ObjectType.Port]: AuditLogTypedValueReading.Value,
  [ObjectType.Version]: AuditLogTypedValueReading.Value,
  [ObjectType.Color]: AuditLogTypedValueReading.Value,
  [ObjectType.Decimal]: AuditLogTypedValueReading.Value,
  [ObjectType.PositiveNumber]: AuditLogTypedValueReading.Value,

  // A hash is a secret, whatever column it is in.
  [ObjectType.HashedString]: AuditLogTypedValueReading.Secret,

  // Structures: what they hold is JSON of its own.
  [ObjectType.MonitorSteps]: AuditLogTypedValueReading.Json,
  [ObjectType.MonitorStep]: AuditLogTypedValueReading.Json,
  [ObjectType.MonitorCriteria]: AuditLogTypedValueReading.Json,
  [ObjectType.MonitorCriteriaInstance]: AuditLogTypedValueReading.Json,
  [ObjectType.Recurring]: AuditLogTypedValueReading.Json,
  [ObjectType.RestrictionTimes]: AuditLogTypedValueReading.Json,
  [ObjectType.Buffer]: AuditLogTypedValueReading.Json,
  [ObjectType.DashboardComponent]: AuditLogTypedValueReading.Json,
  [ObjectType.DashboardViewConfig]: AuditLogTypedValueReading.Json,
  /*
   * Nothing writes a { _type: "Permission" }: a permission is written as
   * its name. Kept as JSON until something does, when the guard asks for a
   * decision.
   */
  [ObjectType.Permission]: AuditLogTypedValueReading.Json,

  // Query filters: what a search asks for, never a value a column holds.
  [ObjectType.EqualTo]: AuditLogTypedValueReading.Json,
  [ObjectType.EqualToOrNull]: AuditLogTypedValueReading.Json,
  [ObjectType.NotEqual]: AuditLogTypedValueReading.Json,
  [ObjectType.Search]: AuditLogTypedValueReading.Json,
  [ObjectType.MultiSearch]: AuditLogTypedValueReading.Json,
  [ObjectType.GreaterThan]: AuditLogTypedValueReading.Json,
  [ObjectType.GreaterThanOrEqual]: AuditLogTypedValueReading.Json,
  [ObjectType.GreaterThanOrNull]: AuditLogTypedValueReading.Json,
  [ObjectType.LessThan]: AuditLogTypedValueReading.Json,
  [ObjectType.LessThanOrEqual]: AuditLogTypedValueReading.Json,
  [ObjectType.LessThanOrNull]: AuditLogTypedValueReading.Json,
  [ObjectType.InBetween]: AuditLogTypedValueReading.Json,
  [ObjectType.NotNull]: AuditLogTypedValueReading.Json,
  [ObjectType.IsNull]: AuditLogTypedValueReading.Json,
  [ObjectType.Includes]: AuditLogTypedValueReading.Json,
  [ObjectType.IncludesAll]: AuditLogTypedValueReading.Json,
  [ObjectType.IncludesAnyOfGroups]: AuditLogTypedValueReading.Json,
  [ObjectType.IncludesNone]: AuditLogTypedValueReading.Json,
  [ObjectType.StartsWith]: AuditLogTypedValueReading.Json,
  [ObjectType.EndsWith]: AuditLogTypedValueReading.Json,
  [ObjectType.NotContains]: AuditLogTypedValueReading.Json,
  [ObjectType.Wildcard]: AuditLogTypedValueReading.Json,
  [ObjectType.NotWildcard]: AuditLogTypedValueReading.Json,
  [ObjectType.OnWatchlist]: AuditLogTypedValueReading.Json,
  [ObjectType.NotOnWatchlist]: AuditLogTypedValueReading.Json,
  [ObjectType.OwnedBy]: AuditLogTypedValueReading.Json,
};

// What a typed value holds that people read: its text, number or switch.
export type AuditLogPlainValue = string | number | boolean;

export interface AuditLogTypedValue {
  type: ObjectType;
  reading: AuditLogTypedValueReading.Value | AuditLogTypedValueReading.Secret;
  // What it holds, as its JSON writes it: "+14155550100", 587.
  value: AuditLogPlainValue;
}

type PlainObject = Record<string, unknown>;

const isPlainObject: (value: unknown) => value is PlainObject = (
  value: unknown,
): value is PlainObject => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

const isPlainValue: (value: unknown) => value is AuditLogPlainValue = (
  value: unknown,
): value is AuditLogPlainValue => {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
};

const hasOwn: (value: object, key: string) => boolean = (
  value: object,
  key: string,
): boolean => {
  return Object.prototype.hasOwnProperty.call(value, key);
};

/*
 * The JSON a value is written as: a typed object's own (its toJSON), or the
 * value itself when it is JSON already. A toJSON that fails writes nothing
 * readable.
 */
const toWrittenJson: (value: PlainObject) => unknown = (
  value: PlainObject,
): unknown => {
  const toJSON: unknown = value["toJSON"];

  if (typeof toJSON !== "function") {
    return value;
  }

  try {
    return (toJSON as () => unknown).call(value);
  } catch {
    return undefined;
  }
};

/*
 * The typed value a value is, when it reads as one: a Phone, or the
 * { _type: "Phone", value } it is written as - an entry recorded before
 * typed values were read holds the JSON, and the dashboard's API client
 * turns that JSON back into a Phone. A time (a Date) is one too, the
 * ObjectType.DateTime it is written as. Null for anything else: a typed
 * value read as JSON, more keys, a value that is not text, a number or a
 * switch, a _type that is not OneUptime's.
 */
export const readAuditLogTypedValue: (
  value: unknown,
) => AuditLogTypedValue | null = (value: unknown): AuditLogTypedValue | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : {
          type: ObjectType.DateTime,
          reading: AuditLogTypedValueReading.Value,
          value: value.toISOString(),
        };
  }

  if (!isPlainObject(value)) {
    return null;
  }

  const json: unknown = toWrittenJson(value);

  if (!isPlainObject(json)) {
    return null;
  }

  const keys: Array<string> = Object.keys(json);

  if (keys.length !== 2 || !hasOwn(json, "_type") || !hasOwn(json, "value")) {
    return null;
  }

  const type: unknown = json["_type"];
  const held: unknown = json["value"];

  if (
    typeof type !== "string" ||
    !hasOwn(AUDIT_LOG_TYPED_VALUE_READINGS, type) ||
    !isPlainValue(held)
  ) {
    return null;
  }

  const reading: AuditLogTypedValueReading =
    AUDIT_LOG_TYPED_VALUE_READINGS[type as ObjectType];

  if (reading === AuditLogTypedValueReading.Json) {
    return null;
  }

  return { type: type as ObjectType, reading, value: held };
};

/*
 * A value as an entry holds it: a typed value as what people read
 * ("+14155550100", 587), a hash as "[REDACTED]", and anything else as it
 * is.
 */
export const readAuditLogValue: (value: unknown) => unknown = (
  value: unknown,
): unknown => {
  const typed: AuditLogTypedValue | null = readAuditLogTypedValue(value);

  if (!typed) {
    return value;
  }

  return typed.reading === AuditLogTypedValueReading.Secret
    ? AUDIT_LOG_REDACTED_VALUE
    : typed.value;
};

/*
 * Whether two values hold the same typed value, written in different
 * shapes: a Phone, its JSON or its text. At least one of them must be a
 * typed value; they are the same when they hold the same text. A hash is
 * compared by the hash it holds, never by "[REDACTED]", so a changed
 * secret is still a change.
 */
export const isSameAuditLogTypedValue: (
  before: unknown,
  after: unknown,
) => boolean = (before: unknown, after: unknown): boolean => {
  const typedBefore: AuditLogTypedValue | null =
    readAuditLogTypedValue(before);
  const typedAfter: AuditLogTypedValue | null = readAuditLogTypedValue(after);

  if (!typedBefore && !typedAfter) {
    return false;
  }

  const held: (typed: AuditLogTypedValue | null, value: unknown) => unknown = (
    typed: AuditLogTypedValue | null,
    value: unknown,
  ): unknown => {
    return typed ? typed.value : value;
  };

  const textBefore: unknown = held(typedBefore, before);
  const textAfter: unknown = held(typedAfter, after);

  return (
    isPlainValue(textBefore) &&
    isPlainValue(textAfter) &&
    String(textBefore) === String(textAfter)
  );
};

// What a recorded change carries, as far as its values go.
export interface AuditLogRecordedChange {
  oldValue?: unknown;
  newValue?: unknown;
  summary?: unknown;
}

/*
 * A recorded change as the recorder writes one now: each of its values read
 * through readAuditLogValue, and, when a typed value made both values plain,
 * no lines of what changed. Those lines were the paths that changed in the
 * typed value's JSON ("Changed value", "Changed the value"), and a phone
 * number changed today is recorded with none - so an entry recorded before
 * reads as one recorded now. The summary is then null rather than gone, so
 * a reader that expects the key still has it. A change with no typed value
 * in it comes back as it is, the same object.
 */
export const readAuditLogChange: <TChange extends AuditLogRecordedChange>(
  change: TChange,
) => TChange = <TChange extends AuditLogRecordedChange>(
  change: TChange,
): TChange => {
  let isTyped: boolean = false;
  let isEveryValuePlain: boolean = true;
  const read: AuditLogRecordedChange = {};

  for (const key of ["oldValue", "newValue"] as const) {
    if (!hasOwn(change, key)) {
      continue;
    }

    const value: unknown = change[key];

    if (readAuditLogTypedValue(value)) {
      isTyped = true;
    }

    read[key] = readAuditLogValue(value);

    if (
      read[key] !== null &&
      read[key] !== undefined &&
      !isPlainValue(read[key])
    ) {
      isEveryValuePlain = false;
    }
  }

  if (!isTyped) {
    return change;
  }

  const copy: TChange = { ...change, ...read };

  if (isEveryValuePlain && hasOwn(change, "summary")) {
    copy.summary = null;
  }

  return copy;
};
