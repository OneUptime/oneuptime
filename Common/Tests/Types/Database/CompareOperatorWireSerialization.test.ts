import CompareBase, { CompareType } from "../../../Types/Database/CompareBase";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import GreaterThanOrNull from "../../../Types/BaseDatabase/GreaterThanOrNull";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import LessThanOrNull from "../../../Types/BaseDatabase/LessThanOrNull";
import JSONFunctions from "../../../Types/JSONFunctions";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

/*
 * Pins the WIRE CONTRACT of the comparison query operators end to end:
 *
 *   browser:  JSONFunctions.serialize(query)  ->  operator.toJSON()
 *   HTTP:     JSON.stringify / JSON.parse     (a raw Date becomes its full ISO string)
 *   server:   JSONFunctions.deserialize       ->  Dictionary[_type].fromJSON
 *   SQL bind: operator.toString()             ->  QueryHelper.<op>(value)
 *
 * The bug this file guards against: toJSON used to serialize Date values via
 * toString(), which collapses them to a DATE-ONLY string in the BROWSER'S LOCAL
 * TIMEZONE (OneUptimeDate.asDateForDatabaseQuery). A bound of "now" therefore
 * arrived at the server as midnight of the viewer's calendar date, and every
 * row from later that day was silently excluded from the query - e.g. the
 * Monitor View page dropped a monitor's current open status row whenever the
 * status had changed the same day. Serializing the RAW value (exactly what
 * InBetween always did) keeps the full timestamp across the wire in every
 * timezone.
 *
 * The legacy date-only wire format must STAY accepted: an old client (or a
 * saved query serialized before this change) sends value: "YYYY-MM-DD", and
 * the server must keep treating it as an opaque string bound.
 */

const FULL_ISO_TIMESTAMP: string = "2026-07-21T14:35:12.345Z";
const LEGACY_DATE_ONLY: string = "2026-07-21";

type OperatorFactory = (value: CompareType) => CompareBase<CompareType>;

type OperatorCase = {
  name: string;
  type: unknown;
  create: OperatorFactory;
};

const OPERATOR_CASES: Array<OperatorCase> = [
  {
    name: "LessThan",
    type: LessThan,
    create: (value: CompareType) => {
      return new LessThan(value);
    },
  },
  {
    name: "LessThanOrEqual",
    type: LessThanOrEqual,
    create: (value: CompareType) => {
      return new LessThanOrEqual(value);
    },
  },
  {
    name: "LessThanOrNull",
    type: LessThanOrNull,
    create: (value: CompareType) => {
      return new LessThanOrNull(value);
    },
  },
  {
    name: "GreaterThan",
    type: GreaterThan,
    create: (value: CompareType) => {
      return new GreaterThan(value);
    },
  },
  {
    name: "GreaterThanOrEqual",
    type: GreaterThanOrEqual,
    create: (value: CompareType) => {
      return new GreaterThanOrEqual(value);
    },
  },
  {
    name: "GreaterThanOrNull",
    type: GreaterThanOrNull,
    create: (value: CompareType) => {
      return new GreaterThanOrNull(value);
    },
  },
];

type SimulateHttpHopFunction = (query: JSONObject) => JSONObject;

/*
 * What actually happens between ModelAPI.getList and BaseAPI: the serialized
 * query is JSON.stringify'd into the request body and JSON.parse'd on the
 * server. This is the step that turns a raw Date into its full ISO string.
 */
const simulateHttpHop: SimulateHttpHopFunction = (
  query: JSONObject,
): JSONObject => {
  return JSON.parse(JSON.stringify(JSONFunctions.serialize(query)));
};

for (const operatorCase of OPERATOR_CASES) {
  describe(`${operatorCase.name} wire serialization`, () => {
    it("sends a Date bound as its full ISO timestamp, not a local date-only string", () => {
      const query: JSONObject = {
        startsAt: operatorCase.create(new Date(FULL_ISO_TIMESTAMP)),
      } as unknown as JSONObject;

      const wire: JSONObject = simulateHttpHop(query);

      expect((wire["startsAt"] as JSONObject)["_type"]).toBe(operatorCase.name);
      /*
       * The critical assertion: the full timestamp survives. Under the old
       * toString()-based toJSON this was "2026-07-21" (or "2026-07-22" east
       * of UTC) regardless of the time component.
       */
      expect((wire["startsAt"] as JSONObject)["value"]).toBe(
        FULL_ISO_TIMESTAMP,
      );
    });

    it("deserializes on the server to the operator with the full-precision bound", () => {
      const query: JSONObject = {
        startsAt: operatorCase.create(new Date(FULL_ISO_TIMESTAMP)),
      } as unknown as JSONObject;

      const deserialized: JSONObject = JSONFunctions.deserialize(
        simulateHttpHop(query),
      );

      expect(deserialized["startsAt"]).toBeInstanceOf(operatorCase.type);

      /*
       * toString() is exactly what QueryUtil passes into QueryHelper as the
       * SQL bind value, so this string IS the query bound. It must be the
       * full ISO timestamp, passed through untouched.
       */
      const operator: CompareBase<CompareType> = deserialized[
        "startsAt"
      ] as unknown as CompareBase<CompareType>;

      expect(operator.toString()).toBe(FULL_ISO_TIMESTAMP);
    });

    it("still accepts the legacy date-only wire format as an opaque string", () => {
      const legacyWire: JSONObject = {
        startsAt: {
          _type: operatorCase.name,
          value: LEGACY_DATE_ONLY,
        },
      };

      const deserialized: JSONObject = JSONFunctions.deserialize(legacyWire);

      expect(deserialized["startsAt"]).toBeInstanceOf(operatorCase.type);

      const operator: CompareBase<CompareType> = deserialized[
        "startsAt"
      ] as unknown as CompareBase<CompareType>;

      expect(operator.toString()).toBe(LEGACY_DATE_ONLY);
    });

    it("round-trips a number bound unchanged", () => {
      const query: JSONObject = {
        priority: operatorCase.create(42),
      } as unknown as JSONObject;

      const wire: JSONObject = simulateHttpHop(query);

      expect((wire["priority"] as JSONObject)["value"]).toBe(42);

      const deserialized: JSONObject = JSONFunctions.deserialize(wire);

      const operator: CompareBase<CompareType> = deserialized[
        "priority"
      ] as unknown as CompareBase<CompareType>;

      expect(operator.toString()).toBe("42");
    });
  });
}

describe("InBetween wire serialization (the reference behavior)", () => {
  it("has always sent full ISO timestamps for both bounds - the operators above now match it", () => {
    const startBound: string = "2026-04-22T00:30:00.000Z";

    const query: JSONObject = {
      createdAt: new InBetween(
        new Date(startBound),
        new Date(FULL_ISO_TIMESTAMP),
      ),
    } as unknown as JSONObject;

    const wire: JSONObject = simulateHttpHop(query);

    expect((wire["createdAt"] as JSONObject)["startValue"]).toBe(startBound);
    expect((wire["createdAt"] as JSONObject)["endValue"]).toBe(
      FULL_ISO_TIMESTAMP,
    );

    const deserialized: JSONObject = JSONFunctions.deserialize(wire);

    expect(deserialized["createdAt"]).toBeInstanceOf(InBetween);

    const operator: InBetween<CompareType> = deserialized[
      "createdAt"
    ] as unknown as InBetween<CompareType>;

    expect(operator.toStartValueString()).toBe(startBound);
    expect(operator.toEndValueString()).toBe(FULL_ISO_TIMESTAMP);
  });
});
