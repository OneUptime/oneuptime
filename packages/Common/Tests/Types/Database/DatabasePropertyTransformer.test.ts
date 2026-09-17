import Recurring from "../../../Types/Events/Recurring";
import RestrictionTimes from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import ObjectID from "../../../Types/ObjectID";
import Email from "../../../Types/Email";
import Color from "../../../Types/Color";
import EventInterval from "../../../Types/Events/EventInterval";
import PositiveNumber from "../../../Types/PositiveNumber";
import { ValueTransformer } from "typeorm/decorator/options/ValueTransformer";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — `DatabaseProperty.getDatabaseTransformer()`, the one
 * transformer behind nearly every non-primitive column in the schema.
 *
 * Its `to` has to keep `undefined` and `null` apart. TypeORM applies the
 * transformer BEFORE deciding whether the caller supplied the column:
 *
 *   InsertQueryBuilder.createColumnValueExpression
 *     -> driver.preparePersistentValue   (runs transformer.to)
 *     -> if (value === undefined) expression += "DEFAULT"
 *
 * Every `toDatabase` implementation returns null for a falsy input, so
 * before this guard an omitted column arrived as an explicit NULL and the
 * column's DEFAULT was unreachable. On a NOT NULL column with a default that
 * is a not-null constraint violation — an HTTP 500 — on every create that
 * does not mention the column. That is the mechanism behind
 * github.com/OneUptime/oneuptime/issues/3026 (the drop-filter counters), and
 * `OnCallDutyPolicyScheduleLayer.rotation` / `.restrictionTimes` are the same
 * shape: NOT NULL, with a JSON default, written through this transformer.
 *
 * UPDATE is unaffected in both directions — UpdateQueryBuilder drops
 * undefined properties before the transformer runs — so this only ever
 * changes an INSERT from "write NULL" to "use the DEFAULT".
 */

interface TransformerCase {
  name: string;
  transformer: ValueTransformer;
  sample: unknown;
}

const CASES: Array<TransformerCase> = [
  {
    name: "Recurring",
    transformer: Recurring.getDatabaseTransformer(),
    sample: Recurring.getDefault(),
  },
  {
    name: "RestrictionTimes",
    transformer: RestrictionTimes.getDatabaseTransformer(),
    sample: RestrictionTimes.getDefault(),
  },
  {
    name: "ObjectID",
    transformer: ObjectID.getDatabaseTransformer(),
    sample: new ObjectID("11111111-1111-4111-8111-111111111111"),
  },
  {
    name: "Email",
    transformer: Email.getDatabaseTransformer(),
    sample: new Email("someone@oneuptime.com"),
  },
  {
    name: "Color",
    transformer: Color.getDatabaseTransformer(),
    sample: new Color("#ff0000"),
  },
];

describe.each(CASES)(
  "$name.getDatabaseTransformer()",
  ({ transformer, sample }: TransformerCase) => {
    it("passes undefined through so the column DEFAULT applies", () => {
      expect(transformer.to(undefined)).toBeUndefined();
    });

    it("does not collapse undefined into null", () => {
      expect(transformer.to(undefined)).not.toBeNull();
    });

    /*
     * An explicit null is a different instruction — "store nothing here" —
     * and still has to reach the column as NULL.
     */
    it("keeps an explicit null as null", () => {
      expect(transformer.to(null)).toBeNull();
    });

    it("still serializes a real value", () => {
      expect(transformer.to(sample)).not.toBeUndefined();
      expect(transformer.to(sample)).not.toBeNull();
    });
  },
);

describe("the INSERT expression TypeORM derives for a NOT NULL column", () => {
  /*
   * A miniature of PostgresDriver.preparePersistentValue followed by
   * InsertQueryBuilder.createColumnValueExpression, so the consequence is
   * asserted rather than described.
   */
  function insertExpressionFor(
    transformer: ValueTransformer,
    value: unknown,
  ): string {
    const prepared: unknown = transformer.to(value);

    if (prepared === undefined) {
      return "DEFAULT";
    }

    if (prepared === null) {
      return "NULL";
    }

    return "?";
  }

  it("uses the schedule layer's rotation default instead of NULL", () => {
    expect(
      insertExpressionFor(Recurring.getDatabaseTransformer(), undefined),
    ).toBe("DEFAULT");
  });

  it("uses the schedule layer's restriction default instead of NULL", () => {
    expect(
      insertExpressionFor(RestrictionTimes.getDatabaseTransformer(), undefined),
    ).toBe("DEFAULT");
  });

  it("still binds a supplied value", () => {
    const rotation: Recurring = new Recurring();
    rotation.intervalType = EventInterval.Week;
    rotation.intervalCount = new PositiveNumber(2);

    expect(
      insertExpressionFor(Recurring.getDatabaseTransformer(), rotation),
    ).toBe("?");
  });
});
