import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import Hostname from "../../../Types/API/Hostname";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { AUDIT_LOG_REDACTED_VALUE } from "../../../Types/AuditLog/AuditLogRedaction";
import EndsWith from "../../../Types/BaseDatabase/EndsWith";
import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import EqualToOrNull from "../../../Types/BaseDatabase/EqualToOrNull";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import GreaterThanOrNull from "../../../Types/BaseDatabase/GreaterThanOrNull";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesAll from "../../../Types/BaseDatabase/IncludesAll";
import IncludesAnyOfGroups from "../../../Types/BaseDatabase/IncludesAnyOfGroups";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import LessThanOrNull from "../../../Types/BaseDatabase/LessThanOrNull";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import NotContains from "../../../Types/BaseDatabase/NotContains";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import NotOnWatchlist from "../../../Types/BaseDatabase/NotOnWatchlist";
import NotWildcard from "../../../Types/BaseDatabase/NotWildcard";
import OnWatchlist from "../../../Types/BaseDatabase/OnWatchlist";
import OwnedBy from "../../../Types/BaseDatabase/OwnedBy";
import Search from "../../../Types/BaseDatabase/Search";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import Color from "../../../Types/Color";
import TableColumnType from "../../../Types/Database/TableColumnType";
import OneUptimeDate from "../../../Types/Date";
import Decimal from "../../../Types/Decimal";
import Domain from "../../../Types/Domain";
import Email from "../../../Types/Email";
import Recurring from "../../../Types/Events/Recurring";
import HashedString from "../../../Types/HashedString";
import IP from "../../../Types/IP/IP";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import RestrictionTimes from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Phone from "../../../Types/Phone";
import Port from "../../../Types/Port";
import PositiveNumber from "../../../Types/PositiveNumber";
import SerializableObjectDictionary from "../../../Types/SerializableObjectDictionary";
import Version from "../../../Types/Version";
import ColumnValueChange from "../../../Server/Utils/Database/ColumnValueChange";
import {
  AUDIT_LOG_TYPED_VALUE_READINGS,
  AuditLogRecordedChange,
  AuditLogTypedValue,
  AuditLogTypedValueReading,
  getAuditLogHeldValue,
  readAuditLogChange,
  readAuditLogTypedValue,
  readAuditLogValue,
} from "../../../Utils/AuditLog/AuditLogTypedValues";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { listTypeScriptFiles } from "../../Helpers/ReferenceNameScan";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * A PHONE NUMBER IN AN AUDIT LOG ENTRY READS AS THE NUMBER (issue #6325).
 *
 * Pinned here, on the shared reading the recorder, the changes dialog and
 * the export use (Common/Utils/AuditLog/AuditLogTypedValues):
 *
 *   - THE GUARD: every ObjectType is decided; every { _type, value } the
 *     code in Common/Types writes names a decided type; every type read as a
 *     value has a class sampled below that gives one, and every type kept as
 *     JSON is a structure or a filter this file names - so a new typed
 *     scalar fails here until someone decides how an entry reads it;
 *   - each class read as a value holds the text its String() gives, the
 *     text ColumnValueChange compares a write by, so "changed" and "reads
 *     differently" never disagree;
 *   - what is not a typed value - more keys, a value that is JSON, a _type
 *     nobody knows, a filter - stays as it is;
 *   - an old entry's change reads as one recorded now, its "Changed the
 *     value" gone;
 *   - seeded sweeps over generated values of every class.
 */

const COMMON_DIR: string = path.resolve(__dirname, "..", "..", "..");
const TYPES_DIR: string = path.join(COMMON_DIR, "Types");

// Every reading, by type.
function typesRead(reading: AuditLogTypedValueReading): Array<string> {
  return Object.keys(AUDIT_LOG_TYPED_VALUE_READINGS)
    .filter((type: string): boolean => {
      return AUDIT_LOG_TYPED_VALUE_READINGS[type as ObjectType] === reading;
    })
    .sort();
}

/*
 * A sample of each class OneUptime writes as { _type, ... }, by its type:
 * what the recorder is handed (a column's value) and what the dashboard's
 * API client turns an entry's JSON back into.
 */
const SAMPLES: Readonly<Partial<Record<ObjectType, () => unknown>>> = {
  [ObjectType.ObjectID]: (): unknown => {
    return new ObjectID("11111111-1111-4111-8111-111111111111");
  },
  [ObjectType.DateTime]: (): unknown => {
    return new Date("2026-11-08T10:00:00.000Z");
  },
  [ObjectType.Name]: (): unknown => {
    return new Name("Ada Lovelace");
  },
  [ObjectType.Email]: (): unknown => {
    return new Email("ada@example.com");
  },
  [ObjectType.Phone]: (): unknown => {
    return new Phone("+14155550100");
  },
  [ObjectType.URL]: (): unknown => {
    return URL.fromString("https://status.example.com/incidents?page=2");
  },
  [ObjectType.Route]: (): unknown => {
    return new Route("/incidents/42");
  },
  [ObjectType.Hostname]: (): unknown => {
    return new Hostname("smtp.example.com", 587);
  },
  [ObjectType.Domain]: (): unknown => {
    return new Domain("example.com");
  },
  [ObjectType.IP]: (): unknown => {
    return new IP("192.168.1.10");
  },
  [ObjectType.Port]: (): unknown => {
    return new Port(587);
  },
  [ObjectType.Version]: (): unknown => {
    return new Version("14.0.105");
  },
  [ObjectType.Color]: (): unknown => {
    return new Color("#1d4ed8");
  },
  [ObjectType.Decimal]: (): unknown => {
    return new Decimal(12.5);
  },
  [ObjectType.PositiveNumber]: (): unknown => {
    return new PositiveNumber(42);
  },
  [ObjectType.HashedString]: (): unknown => {
    return new HashedString("5e884898da28047151d0e56f8dc6292773603d0d", true);
  },
  [ObjectType.MonitorSteps]: (): unknown => {
    return new MonitorSteps();
  },
  [ObjectType.MonitorStep]: (): unknown => {
    return new MonitorStep();
  },
  [ObjectType.MonitorCriteria]: (): unknown => {
    return new MonitorCriteria();
  },
  [ObjectType.MonitorCriteriaInstance]: (): unknown => {
    return new MonitorCriteriaInstance();
  },
  [ObjectType.Recurring]: (): unknown => {
    return new Recurring();
  },
  [ObjectType.RestrictionTimes]: (): unknown => {
    return new RestrictionTimes();
  },
  [ObjectType.Buffer]: (): unknown => {
    return JSONFunctions.serializeValue(Buffer.from("bytes"));
  },
  [ObjectType.EqualTo]: (): unknown => {
    return new EqualTo("checkout");
  },
  [ObjectType.EqualToOrNull]: (): unknown => {
    return new EqualToOrNull("checkout");
  },
  [ObjectType.NotEqual]: (): unknown => {
    return new NotEqual("checkout");
  },
  [ObjectType.Search]: (): unknown => {
    return new Search("checkout");
  },
  [ObjectType.MultiSearch]: (): unknown => {
    return new MultiSearch({ fields: ["name"], value: "checkout" });
  },
  [ObjectType.GreaterThan]: (): unknown => {
    return new GreaterThan(5);
  },
  [ObjectType.GreaterThanOrEqual]: (): unknown => {
    return new GreaterThanOrEqual(5);
  },
  [ObjectType.GreaterThanOrNull]: (): unknown => {
    return new GreaterThanOrNull(5);
  },
  [ObjectType.LessThan]: (): unknown => {
    return new LessThan(5);
  },
  [ObjectType.LessThanOrEqual]: (): unknown => {
    return new LessThanOrEqual(5);
  },
  [ObjectType.LessThanOrNull]: (): unknown => {
    return new LessThanOrNull(5);
  },
  [ObjectType.InBetween]: (): unknown => {
    return new InBetween(1, 5);
  },
  [ObjectType.NotNull]: (): unknown => {
    return new NotNull();
  },
  [ObjectType.IsNull]: (): unknown => {
    return new IsNull();
  },
  [ObjectType.Includes]: (): unknown => {
    return new Includes(["a", "b"]);
  },
  [ObjectType.IncludesAll]: (): unknown => {
    return new IncludesAll(["a", "b"]);
  },
  [ObjectType.IncludesAnyOfGroups]: (): unknown => {
    return new IncludesAnyOfGroups([["a"], ["b"]]);
  },
  [ObjectType.IncludesNone]: (): unknown => {
    return new IncludesNone(["a", "b"]);
  },
  [ObjectType.StartsWith]: (): unknown => {
    return new StartsWith("check");
  },
  [ObjectType.EndsWith]: (): unknown => {
    return new EndsWith("out");
  },
  [ObjectType.NotContains]: (): unknown => {
    return new NotContains("test");
  },
  [ObjectType.Wildcard]: (): unknown => {
    return new Wildcard("check*");
  },
  [ObjectType.NotWildcard]: (): unknown => {
    return new NotWildcard("check*");
  },
  [ObjectType.OnWatchlist]: (): unknown => {
    return new OnWatchlist("Known bad IPs");
  },
  [ObjectType.NotOnWatchlist]: (): unknown => {
    return new NotOnWatchlist("Known bad IPs");
  },
  [ObjectType.OwnedBy]: (): unknown => {
    return new OwnedBy({
      userIds: ["22222222-2222-4222-8222-222222222222"],
    });
  },
};

// The types kept as JSON that OneUptime does write, and why each is kept.
const KEPT_AS_JSON: Readonly<Record<string, string>> = {
  [ObjectType.MonitorSteps]: "a structure: a monitor's steps",
  [ObjectType.MonitorStep]: "a structure: one step",
  [ObjectType.MonitorCriteria]: "a structure: a step's criteria",
  [ObjectType.MonitorCriteriaInstance]: "a structure: one criterion",
  [ObjectType.Recurring]: "a structure: an interval and its count",
  [ObjectType.RestrictionTimes]: "a structure: a schedule's restriction times",
  [ObjectType.Buffer]: "a structure: bytes",
  [ObjectType.EqualTo]: "a query filter",
  [ObjectType.EqualToOrNull]: "a query filter",
  [ObjectType.NotEqual]: "a query filter",
  [ObjectType.Search]: "a query filter",
  [ObjectType.MultiSearch]: "a query filter",
  [ObjectType.GreaterThan]: "a query filter",
  [ObjectType.GreaterThanOrEqual]: "a query filter",
  [ObjectType.GreaterThanOrNull]: "a query filter",
  [ObjectType.LessThan]: "a query filter",
  [ObjectType.LessThanOrEqual]: "a query filter",
  [ObjectType.LessThanOrNull]: "a query filter",
  [ObjectType.NotNull]: "a query filter",
  [ObjectType.IsNull]: "a query filter",
  [ObjectType.Includes]: "a query filter",
  [ObjectType.IncludesAll]: "a query filter",
  [ObjectType.IncludesAnyOfGroups]: "a query filter",
  [ObjectType.IncludesNone]: "a query filter",
  [ObjectType.StartsWith]: "a query filter",
  [ObjectType.EndsWith]: "a query filter",
  [ObjectType.NotContains]: "a query filter",
  [ObjectType.Wildcard]: "a query filter",
  [ObjectType.NotWildcard]: "a query filter",
  [ObjectType.OnWatchlist]: "a query filter",
  [ObjectType.NotOnWatchlist]: "a query filter",
};

// The JSON a sample is written as, as an entry holds it: its own toJSON, through JSON.
function writtenJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

/*
 * Every { _type, value } object a file of Common/Types writes, with the
 * _type each one names: ObjectType.X by its enum value, a string by its
 * text, anything else by its source (which no reading knows).
 */
function findWrittenTypedValues(): Array<{ file: string; type: string }> {
  const found: Array<{ file: string; type: string }> = [];

  for (const file of listTypeScriptFiles(TYPES_DIR)) {
    const source: ts.SourceFile = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        let typeNode: ts.Expression | null = null;
        let hasValue: boolean = false;

        for (const property of node.properties) {
          if (ts.isSpreadAssignment(property)) {
            continue;
          }

          const name: string | null =
            ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
              ? property.name.text
              : null;

          if (name === "_type" && ts.isPropertyAssignment(property)) {
            typeNode = property.initializer;
          }

          if (name === "value") {
            hasValue = true;
          }
        }

        if (typeNode && hasValue) {
          let type: string = typeNode.getText(source);

          if (
            ts.isPropertyAccessExpression(typeNode) &&
            ts.isIdentifier(typeNode.expression) &&
            typeNode.expression.text === "ObjectType"
          ) {
            type = String(
              ObjectType[typeNode.name.text as keyof typeof ObjectType],
            );
          } else if (ts.isStringLiteral(typeNode)) {
            type = typeNode.text;
          }

          found.push({ file: path.relative(COMMON_DIR, file), type });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  return found;
}

describe("every typed value is decided (the guard)", () => {
  test("every ObjectType has a reading, and nothing else does", () => {
    expect(Object.keys(AUDIT_LOG_TYPED_VALUE_READINGS).sort()).toEqual(
      Object.values(ObjectType).map(String).sort(),
    );

    for (const reading of Object.values(AUDIT_LOG_TYPED_VALUE_READINGS)) {
      expect(Object.values(AuditLogTypedValueReading)).toContain(reading);
    }
  });

  test("the values people read as they are, and the one secret", () => {
    expect(typesRead(AuditLogTypedValueReading.Value)).toEqual(
      [
        ObjectType.Color,
        ObjectType.DateTime,
        ObjectType.Decimal,
        ObjectType.Domain,
        ObjectType.Email,
        ObjectType.Hostname,
        ObjectType.IP,
        ObjectType.Name,
        ObjectType.ObjectID,
        ObjectType.Phone,
        ObjectType.Port,
        ObjectType.PositiveNumber,
        ObjectType.Route,
        ObjectType.URL,
        ObjectType.Version,
      ].sort(),
    );
    expect(typesRead(AuditLogTypedValueReading.Secret)).toEqual([
      ObjectType.HashedString,
    ]);
  });

  test("every { _type, value } Common/Types writes names a decided type", () => {
    const written: Array<{ file: string; type: string }> =
      findWrittenTypedValues();
    const undecided: Array<string> = written
      .filter((item: { file: string; type: string }): boolean => {
        return !Object.prototype.hasOwnProperty.call(
          AUDIT_LOG_TYPED_VALUE_READINGS,
          item.type,
        );
      })
      .map((item: { file: string; type: string }): string => {
        return `${item.file}: _type ${item.type} - decide how an entry reads it in AUDIT_LOG_TYPED_VALUE_READINGS`;
      });

    // The scan finds the classes it is about: it reads the files it should.
    expect(
      written.map((item: { file: string; type: string }): string => {
        return item.type;
      }),
    ).toEqual(
      expect.arrayContaining([
        ObjectType.Phone,
        ObjectType.Email,
        ObjectType.URL,
        ObjectType.HashedString,
        ObjectType.MonitorSteps,
        ObjectType.EqualTo,
      ]),
    );
    expect(undecided).toEqual([]);
  });

  test("every type written as { _type, value } is sampled, and one kept as JSON says why", () => {
    const writtenTypes: Set<string> = new Set<string>(
      findWrittenTypedValues().map(
        (item: { file: string; type: string }): string => {
          return item.type;
        },
      ),
    );
    const problems: Array<string> = [];

    for (const type of writtenTypes) {
      const reading: AuditLogTypedValueReading | undefined =
        AUDIT_LOG_TYPED_VALUE_READINGS[type as ObjectType];

      if (!SAMPLES[type as ObjectType]) {
        problems.push(`${type}: written, with no sample here to check it by`);
      }

      if (reading === AuditLogTypedValueReading.Json && !KEPT_AS_JSON[type]) {
        problems.push(
          `${type}: written and kept as JSON - is it a value people read? Decide, and say why here`,
        );
      }
    }

    // A type kept as JSON because it is a structure or a filter is written.
    for (const type of Object.keys(KEPT_AS_JSON)) {
      if (!writtenTypes.has(type)) {
        problems.push(`${type}: listed as written, and nothing writes it`);
      }
    }

    // A type nothing writes as { _type, value } is kept as JSON, as before.
    for (const type of Object.values(ObjectType)) {
      if (
        !writtenTypes.has(type) &&
        AUDIT_LOG_TYPED_VALUE_READINGS[type] !== AuditLogTypedValueReading.Json
      ) {
        problems.push(`${type}: nothing writes it, so it cannot be read`);
      }
    }

    expect(problems).toEqual([]);
  });

  test("every class the API client reads a { _type } into is sampled", () => {
    const missing: Array<string> = Object.keys(SerializableObjectDictionary)
      .filter((type: string): boolean => {
        return !SAMPLES[type as ObjectType];
      })
      .sort();

    expect(missing).toEqual([]);
  });

  test("each type read as a value gives { _type, value } with text, a number or a switch in it", () => {
    const problems: Array<string> = [];

    for (const type of [
      ...typesRead(AuditLogTypedValueReading.Value),
      ...typesRead(AuditLogTypedValueReading.Secret),
    ]) {
      const sample: unknown = SAMPLES[type as ObjectType]!();
      const json: unknown =
        sample instanceof Date
          ? OneUptimeDate.toJSON(sample)
          : (sample as { toJSON: () => unknown }).toJSON();

      if (
        !json ||
        typeof json !== "object" ||
        Object.keys(json as JSONObject)
          .sort()
          .join() !== "_type,value" ||
        (json as JSONObject)["_type"] !== type ||
        !["string", "number", "boolean"].includes(
          typeof (json as JSONObject)["value"],
        )
      ) {
        problems.push(`${type}: written as ${JSON.stringify(json)}`);
      }
    }

    expect(problems).toEqual([]);
  });

  /*
   * ColumnValueChange decides whether a write changed a column by each
   * side's text (String), and an entry shows what a typed value holds. The
   * two agree as long as every class holds the text its String() gives -
   * so a value written back as it was is no change, and a changed one
   * reads differently. A time is compared by its instant instead
   * (ColumnValueChange.toInstant), and reads as that instant.
   */
  test("each class read as a value holds the text its String() gives", () => {
    const problems: Array<string> = [];

    for (const type of [
      ...typesRead(AuditLogTypedValueReading.Value),
      ...typesRead(AuditLogTypedValueReading.Secret),
    ]) {
      if (type === ObjectType.DateTime) {
        continue;
      }

      const sample: unknown = SAMPLES[type as ObjectType]!();
      const typed: AuditLogTypedValue | null = readAuditLogTypedValue(sample);

      if (!typed || String(typed.value) !== String(sample)) {
        problems.push(
          `${type}: String() is ${String(sample)}, it holds ${JSON.stringify(typed)}`,
        );
      }
    }

    expect(problems).toEqual([]);
  });

  test("a type kept as JSON reads as JSON, whatever it holds", () => {
    for (const type of typesRead(AuditLogTypedValueReading.Json)) {
      const sample: (() => unknown) | undefined = SAMPLES[type as ObjectType];

      if (!sample) {
        continue;
      }

      const value: unknown = sample();

      expect([type, readAuditLogTypedValue(value)]).toEqual([type, null]);
      expect([type, readAuditLogValue(value)]).toEqual([type, value]);
      expect([type, readAuditLogTypedValue(writtenJson(value))]).toEqual([
        type,
        null,
      ]);
    }

    // Even one holding text: a filter says what a search asks for.
    expect(writtenJson(new EqualTo("checkout"))).toEqual({
      _type: ObjectType.EqualTo,
      value: "checkout",
    });
    expect(readAuditLogValue({ _type: "EqualTo", value: "checkout" })).toEqual({
      _type: "EqualTo",
      value: "checkout",
    });
  });
});

describe("a typed value reads as what it holds", () => {
  test("a phone number, as the issue recorded it, reads as the number", () => {
    expect(readAuditLogValue({ _type: "Phone", value: "+14155550100" })).toBe(
      "+14155550100",
    );
    expect(readAuditLogValue(new Phone("+14155550100"))).toBe("+14155550100");
    expect(readAuditLogTypedValue(new Phone("+14155550100"))).toEqual({
      type: ObjectType.Phone,
      reading: AuditLogTypedValueReading.Value,
      value: "+14155550100",
    });
  });

  test("each class reads the same whether it is the object, its JSON, or JSON the API client read back", () => {
    for (const type of [
      ...typesRead(AuditLogTypedValueReading.Value),
      ...typesRead(AuditLogTypedValueReading.Secret),
    ]) {
      const sample: unknown = SAMPLES[type as ObjectType]!();
      const json: unknown =
        sample instanceof Date
          ? OneUptimeDate.toJSON(sample)
          : writtenJson(sample);
      const readBack: unknown = JSONFunctions.deserializeValue(
        json as JSONObject,
      );
      const expected: unknown =
        AUDIT_LOG_TYPED_VALUE_READINGS[type as ObjectType] ===
        AuditLogTypedValueReading.Secret
          ? AUDIT_LOG_REDACTED_VALUE
          : (json as JSONObject)["value"];

      expect([type, readAuditLogValue(sample)]).toEqual([type, expected]);
      expect([type, readAuditLogValue(json)]).toEqual([type, expected]);
      expect([type, readAuditLogValue(readBack)]).toEqual([type, expected]);
    }
  });

  test("a port and a number read as numbers, the rest as text", () => {
    expect(readAuditLogValue(new Port(587))).toBe(587);
    expect(readAuditLogValue(new PositiveNumber(42))).toBe(42);
    expect(readAuditLogValue({ _type: "Port", value: 25 })).toBe(25);
    expect(readAuditLogValue(new Decimal(12.5))).toBe("12.5");
    expect(readAuditLogValue(new Hostname("smtp.example.com", 587))).toBe(
      "smtp.example.com:587",
    );
  });

  test("a time reads as the instant it names", () => {
    const at: Date = new Date("2026-11-08T10:00:00.000Z");

    expect(readAuditLogValue(at)).toBe("2026-11-08T10:00:00.000Z");
    expect(readAuditLogValue(OneUptimeDate.toJSON(at))).toBe(
      "2026-11-08T10:00:00.000Z",
    );
    // A time that names none is not one.
    const invalid: Date = new Date("not a time");
    expect(readAuditLogTypedValue(invalid)).toBeNull();
    expect(readAuditLogValue(invalid)).toBe(invalid);
  });

  test("a hash is a secret, wherever it is", () => {
    expect(readAuditLogValue(new HashedString("abc", true))).toBe(
      AUDIT_LOG_REDACTED_VALUE,
    );
    expect(readAuditLogValue({ _type: "HashedString", value: "abc" })).toBe(
      AUDIT_LOG_REDACTED_VALUE,
    );
    expect(
      readAuditLogTypedValue({ _type: "HashedString", value: "abc" }),
    ).toEqual({
      type: ObjectType.HashedString,
      reading: AuditLogTypedValueReading.Secret,
      value: "abc",
    });
  });
});

describe("what is not a typed value stays as it is", () => {
  const notTyped: Array<[string, unknown]> = [
    ["a third key", { _type: "Phone", value: "+14155550100", label: "x" }],
    ["no value", { _type: "Phone" }],
    ["no _type", { value: "+14155550100" }],
    ["a value that is JSON", { _type: "Phone", value: { digits: "1" } }],
    ["a value that is a list", { _type: "Email", value: ["a@b.c"] }],
    ["a value that is nothing", { _type: "Phone", value: null }],
    ["a _type that is not text", { _type: 7, value: "x" }],
    ["a _type nobody knows", { _type: "Telephone", value: "+1" }],
    ["a _type in another case", { _type: "phone", value: "+1" }],
    ["a _type that is an object's own", { _type: "constructor", value: "x" }],
    ["a _type that is a prototype's", { _type: "__proto__", value: "x" }],
    ["a _type that is a method's name", { _type: "toString", value: "x" }],
    ["a list", [{ _type: "Phone", value: "+1" }]],
    ["text", "+14155550100"],
    ["a number", 587],
    ["a switch", true],
    ["nothing", null],
  ];

  test.each(notTyped)("%s", (_label: string, value: unknown) => {
    expect(readAuditLogTypedValue(value)).toBeNull();
    expect(readAuditLogValue(value)).toBe(value);
  });

  test("undefined stays undefined", () => {
    expect(readAuditLogValue(undefined)).toBeUndefined();
  });

  test("a number that JSON cannot hold is not a value", () => {
    expect(
      readAuditLogTypedValue({ _type: "Port", value: Number.NaN }),
    ).toBeNull();
    expect(
      readAuditLogTypedValue({
        _type: "PositiveNumber",
        value: Number.POSITIVE_INFINITY,
      }),
    ).toBeNull();
  });

  test("a __proto__ key JSON.parse keeps is a third key", () => {
    const parsed: unknown = JSON.parse(
      '{"_type":"Phone","value":"+1","__proto__":{"x":1}}',
    );

    expect(readAuditLogTypedValue(parsed)).toBeNull();
  });

  test("an object whose toJSON fails, or gives no object, is read as it is", () => {
    const failing: { toJSON: () => never } = {
      toJSON: (): never => {
        throw new Error("no");
      },
    };
    const textual: { toJSON: () => string } = {
      toJSON: (): string => {
        return "text";
      },
    };

    expect(readAuditLogTypedValue(failing)).toBeNull();
    expect(readAuditLogValue(failing)).toBe(failing);
    expect(readAuditLogTypedValue(textual)).toBeNull();
    expect(readAuditLogTypedValue(Buffer.from("x"))).toBeNull();
  });

  test("a typed value inside JSON stays part of that JSON", () => {
    const setting: JSONObject = {
      to: { _type: "Email", value: "ada@example.com" },
    };

    expect(readAuditLogValue(setting)).toBe(setting);
  });

  test("keys in another order are the same value", () => {
    expect(readAuditLogValue({ value: "10.0.0.1", _type: "IP" })).toBe(
      "10.0.0.1",
    );
    expect(writtenJson(new IP("10.0.0.1"))).toEqual({
      value: "10.0.0.1",
      _type: "IP",
    });
  });
});

/*
 * What the recorder compares a write by (AuditLogRecorder.areValuesEqual):
 * each side as what it holds, then ColumnValueChange's rule for the
 * column's type - an id in any case, a time by its instant.
 */
function isChangedAsTheRecorderSees(data: {
  columnType: TableColumnType;
  stored: unknown;
  written: unknown;
}): boolean {
  return ColumnValueChange.isChanged({
    columnType: data.columnType,
    storedValue: getAuditLogHeldValue(data.stored),
    writtenValue: getAuditLogHeldValue(data.written),
  });
}

describe("a value as it is compared", () => {
  test("a typed value is what it holds, a hash too, and anything else is itself", () => {
    expect(getAuditLogHeldValue(new Phone("+14155550100"))).toBe(
      "+14155550100",
    );
    expect(
      getAuditLogHeldValue({ _type: "Phone", value: "+14155550100" }),
    ).toBe("+14155550100");
    expect(getAuditLogHeldValue(new Port(587))).toBe(587);
    expect(getAuditLogHeldValue(new HashedString("a-hash", true))).toBe(
      "a-hash",
    );
    expect(getAuditLogHeldValue(new Date("2026-11-08T10:00:00.000Z"))).toBe(
      "2026-11-08T10:00:00.000Z",
    );

    const steps: MonitorSteps = new MonitorSteps();
    const filter: JSONObject = { _type: "EqualTo", value: "x" };

    for (const value of [steps, filter, "text", 7, null, undefined, [1]]) {
      expect(getAuditLogHeldValue(value)).toBe(value);
    }
  });

  test("a number written back in another of its shapes is no change", () => {
    const phone: Phone = new Phone("+14155550100");

    for (const [stored, written] of [
      [phone, writtenJson(phone)],
      [writtenJson(phone), phone],
      [phone, "+14155550100"],
      ["+14155550100", writtenJson(phone)],
      [writtenJson(phone), writtenJson(phone)],
    ] as Array<[unknown, unknown]>) {
      expect(
        isChangedAsTheRecorderSees({
          columnType: TableColumnType.Phone,
          stored,
          written,
        }),
      ).toBe(false);
    }

    expect(
      isChangedAsTheRecorderSees({
        columnType: TableColumnType.Number,
        stored: new Port(587),
        written: "587",
      }),
    ).toBe(false);
  });

  test("a changed one is a change, in every shape, and so is one cleared", () => {
    const before: Phone = new Phone("+14155550100");
    const after: Phone = new Phone("+14155550101");

    for (const [stored, written] of [
      [before, after],
      [before, writtenJson(after)],
      [writtenJson(before), writtenJson(after)],
      [before, "+14155550101"],
      [before, null],
      [null, writtenJson(after)],
    ] as Array<[unknown, unknown]>) {
      expect(
        isChangedAsTheRecorderSees({
          columnType: TableColumnType.Phone,
          stored,
          written,
        }),
      ).toBe(true);
    }
  });

  /*
   * ColumnValueChange reads an id's text in any case - and a plain
   * { _type: "ObjectID", value } as "[object object]", so two different
   * ones would be the same id. Compared as what they hold, they are not.
   */
  test("two different ids written as their JSON are two ids, and one in another case is the same", () => {
    const first: JSONObject = writtenJson(
      new ObjectID("11111111-1111-4111-8111-111111111111"),
    ) as JSONObject;
    const second: JSONObject = writtenJson(
      new ObjectID("22222222-2222-4222-8222-222222222222"),
    ) as JSONObject;

    expect(
      ColumnValueChange.isChanged({
        columnType: TableColumnType.ObjectID,
        storedValue: first,
        writtenValue: second,
      }),
    ).toBe(false);
    expect(
      isChangedAsTheRecorderSees({
        columnType: TableColumnType.ObjectID,
        stored: first,
        written: second,
      }),
    ).toBe(true);
    expect(
      isChangedAsTheRecorderSees({
        columnType: TableColumnType.ObjectID,
        stored: new ObjectID("aaaaaaaa-1111-4111-8111-111111111111"),
        written: "AAAAAAAA-1111-4111-8111-111111111111",
      }),
    ).toBe(false);
  });

  test("a hash is compared by what it holds, never by [REDACTED]", () => {
    expect(
      isChangedAsTheRecorderSees({
        columnType: TableColumnType.HashedString,
        stored: new HashedString("old-hash", true),
        written: new HashedString("new-hash", true),
      }),
    ).toBe(true);
    expect(
      isChangedAsTheRecorderSees({
        columnType: TableColumnType.HashedString,
        stored: new HashedString("same", true),
        written: { _type: "HashedString", value: "same" },
      }),
    ).toBe(false);
  });

  test("a time is compared by its instant, in any of its shapes", () => {
    const at: Date = new Date("2026-11-08T10:00:00.000Z");

    expect(
      isChangedAsTheRecorderSees({
        columnType: TableColumnType.Date,
        stored: at,
        written: OneUptimeDate.toJSON(at),
      }),
    ).toBe(false);
    expect(
      isChangedAsTheRecorderSees({
        columnType: TableColumnType.Date,
        stored: at,
        written: "2026-11-08T12:00:00+02:00",
      }),
    ).toBe(false);
    expect(
      isChangedAsTheRecorderSees({
        columnType: TableColumnType.Date,
        stored: at,
        written: new Date("2026-11-08T10:00:00.001Z"),
      }),
    ).toBe(true);
  });
});

describe("a recorded change reads as one recorded now", () => {
  test("the issue's entry: the number that went, and no 'Changed the value'", () => {
    const recorded: AuditLogRecordedChange & { field: string } = {
      field: "routingPhoneNumber",
      oldValue: { _type: "Phone", value: "+14155550100" },
      newValue: null,
      summary: ["Changed the value"],
    };

    expect(readAuditLogChange(recorded)).toEqual({
      field: "routingPhoneNumber",
      oldValue: "+14155550100",
      newValue: null,
      summary: null,
    });
    // The entry as it was read is not changed.
    expect(recorded.oldValue).toEqual({
      _type: "Phone",
      value: "+14155550100",
    });
  });

  test("a changed number: before and after, without its JSON's lines", () => {
    expect(
      readAuditLogChange({
        field: "subscriberPhone",
        oldValue: { _type: "Phone", value: "+14155550100" },
        newValue: new Phone("+14155550101"),
        summary: ["Changed value"],
      }),
    ).toEqual({
      field: "subscriberPhone",
      oldValue: "+14155550100",
      newValue: "+14155550101",
      summary: null,
    });
  });

  test("a snapshot keeps the side it has, and a change with no summary gets none", () => {
    const created: { field: string; newValue: unknown } = {
      field: "fromEmail",
      newValue: { _type: "Email", value: "alerts@example.com" },
    };
    const read: { field: string; newValue?: unknown } =
      readAuditLogChange(created);

    expect(read).toEqual({
      field: "fromEmail",
      newValue: "alerts@example.com",
    });
    expect(Object.keys(read).sort()).toEqual(["field", "newValue"]);
  });

  test("a hash reads as [REDACTED], and loses its lines too", () => {
    expect(
      readAuditLogChange({
        field: "password",
        oldValue: { _type: "HashedString", value: "old-hash" },
        newValue: { _type: "HashedString", value: "new-hash" },
        summary: ["Changed value"],
      }),
    ).toEqual({
      field: "password",
      oldValue: AUDIT_LOG_REDACTED_VALUE,
      newValue: AUDIT_LOG_REDACTED_VALUE,
      summary: null,
    });
  });

  test("a change with no typed value in it comes back as it is", () => {
    for (const change of [
      { field: "name", oldValue: "orders", newValue: "orders-v2" },
      {
        field: "graph",
        oldValue: "1 step",
        newValue: "2 steps",
        summary: ['Added "Send Email" (send-email-1)'],
      },
      {
        field: "settings",
        oldValue: { to: { _type: "Email", value: "a@example.com" } },
        newValue: { to: { _type: "Email", value: "b@example.com" } },
        summary: ["Changed to › value"],
      },
      { field: "apiKey", oldValue: "[REDACTED]", newValue: "[REDACTED]" },
      { field: "isEnabled" },
    ] as Array<AuditLogRecordedChange & { field: string }>) {
      expect(readAuditLogChange(change)).toBe(change);
    }
  });

  test("a typed value beside JSON is read, and the JSON's lines are kept", () => {
    expect(
      readAuditLogChange({
        field: "miscData",
        oldValue: { _type: "Email", value: "a@example.com" },
        newValue: { to: "b@example.com" },
        summary: ["Removed _type", "Removed value", "Added to"],
      }),
    ).toEqual({
      field: "miscData",
      oldValue: "a@example.com",
      newValue: { to: "b@example.com" },
      summary: ["Removed _type", "Removed value", "Added to"],
    });
  });
});

describe("seeded sweeps", () => {
  const DIGITS: Array<string> = "0123456789".split("");
  const LETTERS: Array<string> = "abcdefghijklmnopqrstuvwxyz".split("");

  function pick<T>(random: SeededRandom, items: ReadonlyArray<T>): T {
    return items[random(items.length)]!;
  }

  function digits(random: SeededRandom, count: number): string {
    let text: string = "";

    for (let index: number = 0; index < count; index++) {
      text += pick(random, DIGITS);
    }

    return text;
  }

  function word(random: SeededRandom): string {
    let text: string = "";

    for (let index: number = 0; index < 3 + random(8); index++) {
      text += pick(random, LETTERS);
    }

    return text;
  }

  const NAMES: Array<string> = generatedTexts(200, 6325, [
    "Ada",
    " ",
    "Lovelace",
    "é",
    "🔑",
    "'",
    '"',
    "{",
    "}",
    "_type",
    "value",
  ]).filter((text: string): boolean => {
    return text.trim().length > 0;
  });

  // A value of a class read as a value, as a column would hold it, and the column type it is in.
  function drawTypedValue(random: SeededRandom): {
    value: unknown;
    columnType: TableColumnType;
  } {
    switch (random(12)) {
      case 0:
        return {
          value: new Phone(`+1415${digits(random, 7)}`),
          columnType: TableColumnType.Phone,
        };
      case 1:
        return {
          value: new Email(`${word(random)}@${word(random)}.example.com`),
          columnType: TableColumnType.Email,
        };
      case 2:
        return {
          value: URL.fromString(
            `https://${word(random)}.example.com/${word(random)}?page=${random(9)}`,
          ),
          columnType: TableColumnType.LongURL,
        };
      case 3:
        return {
          value: new Hostname(`${word(random)}.example.com`),
          columnType: TableColumnType.ShortText,
        };
      case 4:
        return {
          value: new Port(1 + random(65535)),
          columnType: TableColumnType.Number,
        };
      case 5:
        return {
          value: new Version(`${random(20)}.${random(20)}.${random(200)}`),
          columnType: TableColumnType.Version,
        };
      case 6:
        return {
          value: new Color(`#${digits(random, 6)}`),
          columnType: TableColumnType.Color,
        };
      case 7:
        return {
          value: new Domain(`${word(random)}.example.com`),
          columnType: TableColumnType.Domain,
        };
      case 8:
        return {
          value: new Name(pick(random, NAMES)),
          columnType: TableColumnType.Name,
        };
      case 9:
        return {
          value: new IP(`10.${random(256)}.${random(256)}.${random(256)}`),
          columnType: TableColumnType.IP,
        };
      case 10:
        return {
          value: new ObjectID(
            `${digits(random, 8)}-1111-4111-8111-${digits(random, 12)}`,
          ),
          columnType: TableColumnType.ObjectID,
        };
      default:
        return {
          value: new HashedString(digits(random, 40), true),
          columnType: TableColumnType.HashedString,
        };
    }
  }

  // The shapes the same value reaches the recorder, the dialog and the export in.
  function shapeOf(random: SeededRandom, value: unknown): unknown {
    switch (random(4)) {
      case 0:
        return value;
      case 1:
        return writtenJson(value);
      case 2:
        return JSONFunctions.deserializeValue(writtenJson(value) as JSONObject);
      default:
        return String(value);
    }
  }

  test("2,000 generated values: each reads the same in every shape, as text String() gives", () => {
    const random: SeededRandom = seededRandom(6325);
    const problems: Array<string> = [];

    for (let draw: number = 0; draw < 2000; draw++) {
      const { value } = drawTypedValue(random);
      const typed: AuditLogTypedValue | null = readAuditLogTypedValue(value);
      const expected: unknown =
        value instanceof HashedString ? AUDIT_LOG_REDACTED_VALUE : typed?.value;

      for (const shape of [
        value,
        writtenJson(value),
        JSONFunctions.deserializeValue(writtenJson(value) as JSONObject),
      ]) {
        if (readAuditLogValue(shape) !== expected) {
          problems.push(`draw ${draw}: ${JSON.stringify(shape)}`);
        }
      }

      if (!typed || String(typed.value) !== String(value)) {
        problems.push(`draw ${draw}: holds ${String(typed?.value)}`);
      }

      // Nothing of a hash is read.
      if (
        value instanceof HashedString &&
        JSON.stringify(
          readAuditLogChange({ newValue: writtenJson(value) }),
        ).includes(value.toString())
      ) {
        problems.push(`draw ${draw}: a hash read`);
      }
    }

    expect(problems).toEqual([]);
  });

  /*
   * Whether a write changed a column (ColumnValueChange, which the recorder
   * asks first) and whether an entry would read differently agree, over
   * pairs of generated values in every shape: the same value written back
   * in another shape is no change, and a changed one is one.
   */
  test("3,000 generated pairs: a change and a different reading go together", () => {
    const random: SeededRandom = seededRandom(16325);
    const problems: Array<string> = [];

    for (let draw: number = 0; draw < 3000; draw++) {
      const first: { value: unknown; columnType: TableColumnType } =
        drawTypedValue(random);
      const isSame: boolean = random(2) === 0;
      let second: unknown = first.value;

      if (!isSame) {
        do {
          second = drawTypedValue(random).value;
        } while (String(second) === String(first.value));
      }

      const stored: unknown = shapeOf(random, first.value);
      const written: unknown = shapeOf(random, second);
      const isChanged: boolean = isChangedAsTheRecorderSees({
        columnType: first.columnType,
        stored,
        written,
      });
      const textBefore: string = String(
        readAuditLogTypedValue(stored)?.value ?? stored,
      );
      const textAfter: string = String(
        readAuditLogTypedValue(written)?.value ?? written,
      );

      if (isChanged === isSame || (textBefore !== textAfter) !== isChanged) {
        problems.push(
          `draw ${draw}: ${JSON.stringify(stored)} -> ${JSON.stringify(written)}: changed ${isChanged}`,
        );
      }
    }

    expect(problems).toEqual([]);
  });

  test("a megabyte-long value reads in time in line with it", () => {
    const long: string = `+1${"5".repeat(4 * 1024 * 1024)}`;
    const timed: FastestRun<unknown> = fastestRun({
      run: (): unknown => {
        return readAuditLogChange({
          oldValue: { _type: "Name", value: long },
          newValue: { _type: "Name", value: `${long}!` },
          summary: ["Changed value"],
        });
      },
      limitInMs: 2000,
    });

    expect((timed.result as AuditLogRecordedChange).summary).toBeNull();
    expect(timed.inMs).toBeLessThan(2000);
  });
});
