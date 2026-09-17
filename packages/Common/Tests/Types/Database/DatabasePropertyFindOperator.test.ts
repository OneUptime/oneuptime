import Color from "../../../Types/Color";
import Decimal from "../../../Types/Decimal";
import Email from "../../../Types/Email";
import Recurring from "../../../Types/Events/Recurring";
import HashedString from "../../../Types/HashedString";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Port from "../../../Types/Port";
import { JSONObject } from "../../../Types/JSON";
import {
  And,
  Between,
  DataSource,
  Equal,
  EntitySchema,
  FindOperator,
  ILike,
  In,
  IsNull,
  Not,
  Or,
  Raw,
} from "typeorm";
import { ValueTransformer } from "typeorm/decorator/options/ValueTransformer";

/*
 * A privacy/scope filter AND-combines the caller's own filter with a Raw
 * clause (Common/Server/Utils/PrivacyFilterUtil.ts), which hands TypeORM a
 * nested FindOperator on a column that carries a DatabaseProperty
 * transformer. TypeORM then calls `operator.transformValue(transformer)`
 * (SelectQueryBuilder.buildWhere), and FindOperator.transformValue maps the
 * transformer's `to()` over each CHILD OPERATOR whenever the operator holds
 * multiple parameters — which And() and Or() both do.
 *
 * Every `toDatabase()` in Common/Types is written for a *value*, so handed a
 * child operator it produces garbage instead: "[object Object]" for the
 * string-ish types, `null` for Port, a serialized operator for the JSON
 * types. The equality child is silently replaced by that garbage and the
 * predicate can no longer match — on a uuid column Postgres rejects it
 * outright with 22P02 invalid input syntax for type uuid.
 *
 * These tests pin the contract that fixes it: a FindOperator handed to the
 * transformer keeps its identity and gets its LEAF value(s) transformed,
 * exactly once, however deeply it is nested.
 */

const UUID: string = "11111111-2222-4333-8444-555555555555";
const OTHER_UUID: string = "99999999-8888-4777-8666-555555555555";

type RawClauseType = FindOperator<any>;

function makeRawClause(): RawClauseType {
  return Raw((alias: string): string => {
    return `(${alias} IS NOT NULL)`;
  }) as RawClauseType;
}

function childrenOf(operator: FindOperator<any>): Array<any> {
  return operator.value as unknown as Array<any>;
}

describe("DatabaseProperty database transformer — nested FindOperator values", () => {
  describe("ObjectID (the reported failure: 1698 uuid columns use this transformer)", () => {
    it("transforms the leaf of a nested Equal instead of stringifying the operator", () => {
      const operator: FindOperator<any> = And(
        Equal(new ObjectID(UUID) as any),
        makeRawClause(),
      ) as FindOperator<any>;

      operator.transformValue(ObjectID.getDatabaseTransformer());

      const children: Array<any> = childrenOf(operator);
      expect(children).toHaveLength(2);
      // Before the fix this child was the string "[object Object]".
      expect(children[0]).toBeInstanceOf(FindOperator);
      expect(children[0].type).toBe("equal");
      expect(children[0].value).toBe(UUID);
      expect(children[0].value).not.toBe("[object Object]");
    });

    it("leaves a Raw sibling byte-identical", () => {
      const clause: RawClauseType = makeRawClause();
      const operator: FindOperator<any> = And(
        Equal(new ObjectID(UUID) as any),
        clause,
      ) as FindOperator<any>;

      operator.transformValue(ObjectID.getDatabaseTransformer());

      expect(childrenOf(operator)[1]).toBe(clause);
      expect(childrenOf(operator)[1].type).toBe("raw");
    });

    it("accepts an ObjectID leaf, a string leaf and a nested ObjectID equally", () => {
      const fromInstance: FindOperator<any> = And(
        Equal(new ObjectID(UUID) as any),
        makeRawClause(),
      ) as FindOperator<any>;
      const fromString: FindOperator<any> = And(
        Equal(UUID),
        makeRawClause(),
      ) as FindOperator<any>;

      fromInstance.transformValue(ObjectID.getDatabaseTransformer());
      fromString.transformValue(ObjectID.getDatabaseTransformer());

      expect(childrenOf(fromInstance)[0].value).toBe(UUID);
      expect(childrenOf(fromString)[0].value).toBe(UUID);
    });

    it("handles Or, In, Not, Between and IsNull children", () => {
      const or: FindOperator<any> = Or(
        Equal(new ObjectID(UUID) as any),
        makeRawClause(),
      ) as FindOperator<any>;
      const includes: FindOperator<any> = And(
        In([new ObjectID(UUID), new ObjectID(OTHER_UUID)] as any),
        makeRawClause(),
      ) as FindOperator<any>;
      const negated: FindOperator<any> = And(
        Not(Equal(new ObjectID(UUID) as any)),
        makeRawClause(),
      ) as FindOperator<any>;
      const between: FindOperator<any> = And(
        Between(new ObjectID(UUID) as any, new ObjectID(OTHER_UUID) as any),
        makeRawClause(),
      ) as FindOperator<any>;
      const isNull: FindOperator<any> = And(
        IsNull(),
        makeRawClause(),
      ) as FindOperator<any>;

      for (const operator of [or, includes, negated, between, isNull]) {
        operator.transformValue(ObjectID.getDatabaseTransformer());
      }

      expect(childrenOf(or)[0].value).toBe(UUID);
      expect(childrenOf(includes)[0].type).toBe("in");
      expect(childrenOf(includes)[0].value).toEqual([UUID, OTHER_UUID]);
      /*
       * Not() wraps a single child operator, which TypeORM recurses into on
       * its own. FindOperator's `value` getter unwraps a nested operator, so
       * the transformed leaf shows up on `value` and the operator itself on
       * `child`.
       */
      expect(childrenOf(negated)[0].type).toBe("not");
      expect(childrenOf(negated)[0].child.type).toBe("equal");
      expect(childrenOf(negated)[0].value).toBe(UUID);
      expect(childrenOf(between)[0].value).toEqual([UUID, OTHER_UUID]);
      expect(childrenOf(isNull)[0].type).toBe("isNull");
    });

    it("recurses through a doubly-nested And", () => {
      /*
       * Reachable in production: BaseAPI.getList hands the SAME query object
       * to findBy and then countBy, so the count query's privacy hook
       * AND-combines a clause onto the And the find query already built.
       */
      const innerClause: RawClauseType = makeRawClause();
      const outerClause: RawClauseType = makeRawClause();
      const inner: FindOperator<any> = And(
        Equal(new ObjectID(UUID) as any),
        innerClause,
      ) as FindOperator<any>;
      const outer: FindOperator<any> = And(
        inner,
        outerClause,
      ) as FindOperator<any>;

      outer.transformValue(ObjectID.getDatabaseTransformer());

      expect(childrenOf(outer)[0]).toBe(inner);
      expect(childrenOf(outer)[0].type).toBe("and");
      expect(childrenOf(inner)[0].value).toBe(UUID);
      expect(childrenOf(inner)[1]).toBe(innerClause);
      expect(childrenOf(outer)[1]).toBe(outerClause);
    });

    it("preserves an all-Raw nested And (the QueryUtil filter-stacking shape)", () => {
      const rawA: RawClauseType = makeRawClause();
      const rawB: RawClauseType = makeRawClause();
      const rawC: RawClauseType = makeRawClause();
      const inner: FindOperator<any> = And(rawA, rawB) as FindOperator<any>;
      const outer: FindOperator<any> = And(inner, rawC) as FindOperator<any>;

      outer.transformValue(ObjectID.getDatabaseTransformer());

      /*
       * The pre-existing `_type === "raw"` escape hatch rescues a Raw child,
       * but an And OF Raws is itself type "and", so it was stringified too.
       */
      expect(childrenOf(outer)[0]).toBe(inner);
      expect(childrenOf(inner)[0]).toBe(rawA);
      expect(childrenOf(inner)[1]).toBe(rawB);
    });

    it("does not throw on a nested pattern operator", () => {
      const operator: FindOperator<any> = And(
        ILike("%abc%"),
        makeRawClause(),
      ) as FindOperator<any>;

      expect(() => {
        operator.transformValue(ObjectID.getDatabaseTransformer());
      }).not.toThrow();
      expect(childrenOf(operator)[0].value).toBe("%abc%");
    });

    it("still transforms a plain value and a top-level operator", () => {
      const transformer: ValueTransformer = ObjectID.getDatabaseTransformer();

      expect(transformer.to(new ObjectID(UUID))).toBe(UUID);

      const topLevel: FindOperator<any> = Equal(
        new ObjectID(UUID) as any,
      ) as FindOperator<any>;
      const returned: any = transformer.to(topLevel);

      expect(returned).toBe(topLevel);
      expect(topLevel.value).toBe(UUID);
    });

    it("keeps the undefined / null contract that omitted columns rely on", () => {
      const transformer: ValueTransformer = ObjectID.getDatabaseTransformer();

      // undefined must stay undefined so a column DEFAULT stays reachable.
      expect(transformer.to(undefined)).toBeUndefined();
      expect(transformer.to(null)).toBeNull();
    });
  });

  describe("non-ObjectID types (an ObjectID-only patch would not fix these)", () => {
    it("Port keeps a numeric leaf instead of collapsing the operator to null", () => {
      const operator: FindOperator<any> = And(
        Equal(new Port(587) as any),
        makeRawClause(),
      ) as FindOperator<any>;

      operator.transformValue(Port.getDatabaseTransformer());

      // Before the fix this child was `null` — silently unmatchable.
      expect(childrenOf(operator)[0]).toBeInstanceOf(FindOperator);
      expect(childrenOf(operator)[0].value).toBe(587);
      expect(typeof childrenOf(operator)[0].value).toBe("number");
    });

    it("Port keeps a falsy 0 leaf", () => {
      const operator: FindOperator<any> = And(
        Equal(new Port(0) as any),
        makeRawClause(),
      ) as FindOperator<any>;

      operator.transformValue(Port.getDatabaseTransformer());

      expect(childrenOf(operator)[0].value).toBe(0);
    });

    it("Email normalizes the leaf rather than stringifying the operator", () => {
      const operator: FindOperator<any> = And(
        Equal(new Email("User@Example.COM") as any),
        makeRawClause(),
      ) as FindOperator<any>;

      operator.transformValue(Email.getDatabaseTransformer());

      expect(childrenOf(operator)[0].value).toBe("user@example.com");
    });

    it("Decimal, HashedString, Name and Color transform their leaves", () => {
      const decimal: FindOperator<any> = And(
        Equal(new Decimal("12.5") as any),
        makeRawClause(),
      ) as FindOperator<any>;
      const hashed: FindOperator<any> = And(
        Equal(new HashedString("raw-token", false) as any),
        makeRawClause(),
      ) as FindOperator<any>;
      const name: FindOperator<any> = And(
        Equal(new Name("Jane Doe") as any),
        makeRawClause(),
      ) as FindOperator<any>;
      const color: FindOperator<any> = And(
        Equal(new Color("#ff0000") as any),
        makeRawClause(),
      ) as FindOperator<any>;

      decimal.transformValue(Decimal.getDatabaseTransformer());
      hashed.transformValue(HashedString.getDatabaseTransformer());
      name.transformValue(Name.getDatabaseTransformer());
      color.transformValue(Color.getDatabaseTransformer());

      expect(childrenOf(decimal)[0].value).toBe("12.5");
      expect(childrenOf(hashed)[0].value).toBe("raw-token");
      expect(childrenOf(name)[0].value).toBe("Jane Doe");
      expect(childrenOf(color)[0].value).toBe("#ff0000");
    });

    it("Recurring transforms a JSON leaf to its serialized form", () => {
      const operator: FindOperator<any> = And(
        Equal(Recurring.getDefault() as any),
        makeRawClause(),
      ) as FindOperator<any>;

      operator.transformValue(Recurring.getDatabaseTransformer());

      expect(childrenOf(operator)[0]).toBeInstanceOf(FindOperator);
      expect(childrenOf(operator)[0].value).toEqual(
        Recurring.getDefault().toJSON(),
      );
    });
  });

  describe("idempotence — one query object is transformed more than once", () => {
    /*
     * BaseAPI.getList (Common/Server/API/BaseAPI.ts) awaits findBy and then
     * countBy with the SAME query object, and transformValue mutates the
     * operator in place. So every transformer must be a fixpoint: handed its
     * own output it must return that output unchanged, not re-wrap or throw.
     */
    type TransformerOwnerType = {
      getDatabaseTransformer: () => ValueTransformer;
    };

    const cases: Array<{
      name: string;
      owner: TransformerOwnerType;
      operator: () => FindOperator<any>;
    }> = [
      {
        name: "ObjectID",
        owner: ObjectID,
        operator: () => {
          return And(
            Equal(new ObjectID(UUID) as any),
            makeRawClause(),
          ) as FindOperator<any>;
        },
      },
      {
        name: "Port",
        owner: Port,
        operator: () => {
          return And(
            Equal(new Port(587) as any),
            makeRawClause(),
          ) as FindOperator<any>;
        },
      },
      {
        name: "Email",
        owner: Email,
        operator: () => {
          return And(
            Equal(new Email("user@example.com") as any),
            makeRawClause(),
          ) as FindOperator<any>;
        },
      },
      {
        name: "Decimal",
        owner: Decimal,
        operator: () => {
          return And(
            Equal(new Decimal("12.5") as any),
            makeRawClause(),
          ) as FindOperator<any>;
        },
      },
      {
        name: "HashedString",
        owner: HashedString,
        operator: () => {
          return And(
            Equal(new HashedString("raw-token", false) as any),
            makeRawClause(),
          ) as FindOperator<any>;
        },
      },
      {
        name: "Recurring (scalar)",
        owner: Recurring,
        operator: () => {
          return And(
            Equal(Recurring.getDefault() as any),
            makeRawClause(),
          ) as FindOperator<any>;
        },
      },
      {
        name: "Recurring (array column)",
        owner: Recurring,
        operator: () => {
          return And(
            Equal([Recurring.getDefault(), Recurring.getDefault()] as any),
            makeRawClause(),
          ) as FindOperator<any>;
        },
      },
    ];

    for (const testCase of cases) {
      it(`${testCase.name} is a fixpoint under repeated transformation`, () => {
        const operator: FindOperator<any> = testCase.operator();
        const transformer: ValueTransformer =
          testCase.owner.getDatabaseTransformer();

        operator.transformValue(transformer);
        const afterFirstPass: string = JSON.stringify(
          childrenOf(operator)[0].value,
        );

        expect(() => {
          operator.transformValue(transformer);
          operator.transformValue(transformer);
        }).not.toThrow();

        expect(JSON.stringify(childrenOf(operator)[0].value)).toBe(
          afterFirstPass,
        );
      });
    }
  });

  describe("end to end — the SQL and bound parameters TypeORM emits", () => {
    /*
     * The unit tests above pin the transformer. This one pins the thing the
     * user actually saw: the parameter bound against a uuid column. It runs
     * real TypeORM query building against real metadata; no database
     * connection is needed to render the statement.
     */
    let dataSource: DataSource;

    const IncidentFeedLike: EntitySchema = new EntitySchema({
      name: "IncidentFeedLike",
      tableName: "IncidentFeedLike",
      columns: {
        _id: { primary: true, type: "uuid", generated: "uuid" },
        incidentId: {
          type: "uuid",
          transformer: ObjectID.getDatabaseTransformer(),
        },
        feedInfoInMarkdown: { type: "character varying", nullable: true },
      },
    });

    beforeAll(async () => {
      dataSource = new DataSource({
        type: "postgres",
        entities: [IncidentFeedLike],
        synchronize: false,
      });
      /*
       * Builds entity metadata without opening a connection, so the test can
       * render real SQL offline. Protected on DataSource, hence the cast.
       */
      await (
        dataSource as unknown as { buildMetadatas: () => Promise<void> }
      ).buildMetadatas();
    });

    it("binds the uuid, not '[object Object]', for a privacy-filtered read", () => {
      const [sql, parameters]: [string, Array<any>] = dataSource
        .createQueryBuilder(IncidentFeedLike, "IncidentFeedLike")
        .setFindOptions({
          where: {
            incidentId: And(Equal(UUID), makeRawClause()) as any,
          },
          take: 10,
        })
        .getQueryAndParameters();

      expect(parameters).toEqual([UUID]);
      expect(parameters).not.toContain("[object Object]");
      expect(sql).toContain('"IncidentFeedLike"."incidentId" = $1');
      expect(sql).toContain('"IncidentFeedLike"."incidentId" IS NOT NULL');
    });

    it("binds the uuid when the caller passed an ObjectID instance", () => {
      const [, parameters]: [string, Array<any>] = dataSource
        .createQueryBuilder(IncidentFeedLike, "IncidentFeedLike")
        .setFindOptions({
          where: {
            incidentId: And(
              Equal(new ObjectID(UUID) as any),
              makeRawClause(),
            ) as any,
          },
          take: 10,
        })
        .getQueryAndParameters();

      expect(parameters).toEqual([UUID]);
    });

    it("keeps both predicates when the same query object is read twice", () => {
      const query: JSONObject = {
        incidentId: And(Equal(UUID), makeRawClause()) as any,
      };

      const first: [string, Array<any>] = dataSource
        .createQueryBuilder(IncidentFeedLike, "IncidentFeedLike")
        .setFindOptions({ where: query as any, take: 10 })
        .getQueryAndParameters();

      const second: [string, Array<any>] = dataSource
        .createQueryBuilder(IncidentFeedLike, "IncidentFeedLike")
        .setFindOptions({ where: query as any })
        .getQueryAndParameters();

      expect(first[1]).toEqual([UUID]);
      expect(second[1]).toEqual([UUID]);
      expect(second[0]).toContain('"IncidentFeedLike"."incidentId" = $1');
      expect(second[0]).toContain(
        '"IncidentFeedLike"."incidentId" IS NOT NULL',
      );
    });
  });
});
