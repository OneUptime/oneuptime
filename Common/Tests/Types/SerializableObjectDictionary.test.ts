import SerializableObjectDictionary from "../../Types/SerializableObjectDictionary";
import Color from "../../Types/Color";
import Email from "../../Types/Email";
import { JSONValue, ObjectType } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import ObjectID from "../../Types/ObjectID";
import Phone from "../../Types/Phone";
import Port from "../../Types/Port";
import Version from "../../Types/Version";

/*
 * SerializableObjectDictionary is the registry JSONFunctions.deserializeValue
 * looks a `_type` up in. A missing or wrong entry does not throw — the value
 * just silently stays a plain `{ _type, value }` object and surfaces much
 * later as a "x.toString is not a function" somewhere else entirely. These
 * tests make that failure mode loud.
 */

/*
 * ObjectTypes that deliberately have no registry entry, with the reason.
 * Adding a new ObjectType without deciding which side of this line it falls
 * on will fail the completeness test below.
 */
const INTENTIONALLY_UNREGISTERED: Array<ObjectType> = [
  // Handled by its own branch in deserializeValue, before the registry lookup.
  ObjectType.Buffer,
  // Plain numeric wrappers that serialize as bare values.
  ObjectType.Decimal,
  ObjectType.PositiveNumber,
  // Not a database property: permissions serialize as plain enum strings.
  ObjectType.Permission,
  // Nested inside Recurring / dashboard configs, never deserialized standalone.
  ObjectType.RestrictionTimes,
  ObjectType.DashboardComponent,
  ObjectType.DashboardViewConfig,
];

describe("SerializableObjectDictionary", () => {
  test("every key should be a known ObjectType", () => {
    const objectTypes: Array<string> = Object.values(ObjectType);

    for (const key of Object.keys(SerializableObjectDictionary)) {
      expect(objectTypes).toContain(key);
    }
  });

  test("every registered class should expose a static fromJSON", () => {
    const withoutFromJson: Array<string> = Object.entries(
      SerializableObjectDictionary,
    )
      .filter(([, value]: [string, any]) => {
        return !value || typeof value.fromJSON !== "function";
      })
      .map(([key]: [string, any]) => {
        return key;
      });

    // Listing the offenders makes a failure name the broken entry directly.
    expect(withoutFromJson).toEqual([]);
  });

  test("every ObjectType should be registered or explicitly exempt", () => {
    const registered: Array<string> = Object.keys(SerializableObjectDictionary);
    const exempt: Array<string> = INTENTIONALLY_UNREGISTERED.map(
      (type: ObjectType) => {
        return type.toString();
      },
    );

    const unaccounted: Array<string> = Object.values(ObjectType).filter(
      (type: string) => {
        return !registered.includes(type) && !exempt.includes(type);
      },
    );

    /*
     * A non-empty list here means a new ObjectType was added without deciding
     * whether it needs a registry entry: either add it to
     * SerializableObjectDictionary or list it in INTENTIONALLY_UNREGISTERED
     * with the reason.
     */
    expect(unaccounted).toEqual([]);
  });

  test("no exempt ObjectType should also be registered", () => {
    // Keeps the exemption list honest as entries get added to the registry.
    const exemptButRegistered: Array<string> =
      INTENTIONALLY_UNREGISTERED.filter((type: ObjectType) => {
        return Boolean(SerializableObjectDictionary[type.toString()]);
      }).map((type: ObjectType) => {
        return type.toString();
      });

    expect(exemptButRegistered).toEqual([]);
  });

  describe("deserializeValue should hydrate registered types", () => {
    test("should hydrate an ObjectID", () => {
      const id: ObjectID = ObjectID.generate();
      const hydrated: JSONValue = JSONFunctions.deserializeValue(id.toJSON());

      expect(hydrated).toBeInstanceOf(ObjectID);
      expect((hydrated as ObjectID).toString()).toEqual(id.toString());
    });

    test("should hydrate an Email", () => {
      const email: Email = new Email("registry@example.com");
      const hydrated: JSONValue = JSONFunctions.deserializeValue(
        email.toJSON(),
      );

      expect(hydrated).toBeInstanceOf(Email);
      expect((hydrated as Email).toString()).toEqual("registry@example.com");
    });

    test("should hydrate a Color", () => {
      const color: Color = new Color("#ab12cd");
      const hydrated: JSONValue = JSONFunctions.deserializeValue(
        color.toJSON(),
      );

      expect(hydrated).toBeInstanceOf(Color);
      expect((hydrated as Color).toString()).toEqual("#ab12cd");
    });

    test("should hydrate a Port", () => {
      const port: Port = new Port(8080);
      const hydrated: JSONValue = JSONFunctions.deserializeValue(port.toJSON());

      expect(hydrated).toBeInstanceOf(Port);
      expect((hydrated as Port).toNumber()).toEqual(8080);
    });

    test("should hydrate a Version", () => {
      const version: Version = new Version("1.2.3");
      const hydrated: JSONValue = JSONFunctions.deserializeValue(
        version.toJSON(),
      );

      expect(hydrated).toBeInstanceOf(Version);
      expect((hydrated as Version).toString()).toEqual("1.2.3");
    });

    test("should hydrate a Phone", () => {
      const phone: Phone = new Phone("+15551234567");
      const hydrated: JSONValue = JSONFunctions.deserializeValue(
        phone.toJSON(),
      );

      expect(hydrated).toBeInstanceOf(Phone);
      expect((hydrated as Phone).toString()).toEqual("+15551234567");
    });

    test("should leave an unknown _type as a plain object", () => {
      const unknown: JSONValue = JSONFunctions.deserializeValue({
        _type: "NotARegisteredType",
        value: "whatever",
      });

      expect(unknown).toEqual({
        _type: "NotARegisteredType",
        value: "whatever",
      });
    });
  });
});
