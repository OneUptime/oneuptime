/** @timezone Asia/Kolkata */

import { describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";
import {
  DateComparison,
  readDateComparison,
} from "../../TestingUtils/DateComparisonPredicate";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Query from "../../../../Server/Types/Database/Query";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import EndsWith from "../../../../Types/BaseDatabase/EndsWith";
import EqualTo from "../../../../Types/BaseDatabase/EqualTo";
import EqualToOrNull from "../../../../Types/BaseDatabase/EqualToOrNull";
import GreaterThan from "../../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../../Types/BaseDatabase/GreaterThanOrEqual";
import GreaterThanOrNull from "../../../../Types/BaseDatabase/GreaterThanOrNull";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import LessThan from "../../../../Types/BaseDatabase/LessThan";
import LessThanOrEqual from "../../../../Types/BaseDatabase/LessThanOrEqual";
import LessThanOrNull from "../../../../Types/BaseDatabase/LessThanOrNull";
import MultiSearch from "../../../../Types/BaseDatabase/MultiSearch";
import NotContains from "../../../../Types/BaseDatabase/NotContains";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../../Types/BaseDatabase/NotNull";
import NotWildcard from "../../../../Types/BaseDatabase/NotWildcard";
import OwnedBy from "../../../../Types/BaseDatabase/OwnedBy";
import QueryOperator from "../../../../Types/BaseDatabase/QueryOperator";
import Search from "../../../../Types/BaseDatabase/Search";
import StartsWith from "../../../../Types/BaseDatabase/StartsWith";
import Wildcard from "../../../../Types/BaseDatabase/Wildcard";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import ObjectID from "../../../../Types/ObjectID";

/*
 * AN OPERATOR NESTED UNDER A RELATION IS WRITTEN AS THE TOP OF A QUERY
 * WRITES IT (#8378).
 *
 * QueryUtil.serializeQuery turns OneUptime's operators (LessThan, Includes,
 * IsNull...) into the TypeORM operators that become SQL. It used to visit a
 * query's own keys only; under a relation - an incident's note filtered by
 * the incident's declaredAt, `{ incident: { declaredAt: new LessThan(d) } }`
 * - it turned the text searches into SQL and handed every other operator to
 * TypeORM as the class itself. TypeORM does not know those classes: it bound
 * the object, as its JSON, and Postgres refused the read ('invalid input
 * syntax for type timestamp with time zone: "{"_type":"LessThan",...}"'),
 * or a text compared with that JSON and matched nothing, with no error.
 *
 * Each operator under a relation now says exactly what it says at the top
 * of a query of the related model: these compare the two, the SQL read back
 * with each parameter written in. Everything that is not an operator - ids,
 * values, lists, TypeORM's own operators, the label filters the permission
 * checks put under a relation - stays as it was given. The process runs in
 * Asia/Kolkata, so a Date bound in the process's zone would show.
 * DateComparisonPostgres.test.ts runs a nested comparison through a join on
 * Postgres.
 */

const AT: Date = new Date("2026-11-15T09:40:00.123Z");
const ISO: string = "2026-11-15T09:40:00.123Z";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const INCIDENT_ID: string = "22222222-2222-4222-8222-222222222222";
const STATE_ID: string = "33333333-3333-4333-8333-333333333333";
const OTHER_STATE_ID: string = "44444444-4444-4444-8444-444444444444";
const LABEL_ID: string = "55555555-5555-4555-8555-555555555555";
const OTHER_LABEL_ID: string = "66666666-6666-4666-8666-666666666666";

function serialize<TBaseModel extends BaseModel>(
  modelType: { new (): TBaseModel },
  query: Record<string, unknown>,
): Record<string, unknown> {
  return QueryUtil.serializeQuery(
    modelType,
    query as unknown as Query<TBaseModel>,
  ) as unknown as Record<string, unknown>;
}

// A note's filter on its incident, as serialized.
function underIncident(
  filter: Record<string, unknown>,
): Record<string, unknown> {
  return serialize(IncidentPublicNote, { incident: filter })[
    "incident"
  ] as Record<string, unknown>;
}

/*
 * What a filter says, with nothing random in it: a TypeORM operator as its
 * SQL for a column "col" with each parameter written in (an AND as what each
 * of its parts says), anything else as it is.
 */
function said(value: unknown): unknown {
  if (!(value instanceof FindOperator)) {
    return value;
  }

  const operator: FindOperator<unknown> = value as FindOperator<unknown>;

  if (operator.type === "and") {
    return {
      and: (operator.value as unknown as Array<unknown>).map(said),
    };
  }

  if (!operator.getSql) {
    return { type: operator.type, value: said(operator.value) };
  }

  const parameters: Record<string, unknown> =
    operator.objectLiteralParameters || {};

  return operator
    .getSql("col")
    .replace(/:(?:\.\.\.)?(\w+)/g, (_match: string, name: string) => {
      const parameter: unknown = parameters[name];
      return JSON.stringify(
        parameter instanceof Date ? parameter.toISOString() : parameter,
      );
    });
}

interface OperatorCase {
  name: string;
  column: string;
  create: () => QueryOperator<any>;
}

/*
 * One case for each operator a filter under a relation takes, on a column of
 * the kind it is used for.
 */
const OPERATORS: Array<OperatorCase> = [
  {
    name: "LessThan on a date",
    column: "declaredAt",
    create: () => {
      return new LessThan(AT);
    },
  },
  {
    name: "LessThanOrEqual on a date",
    column: "declaredAt",
    create: () => {
      return new LessThanOrEqual(AT);
    },
  },
  {
    name: "GreaterThan on a date",
    column: "declaredAt",
    create: () => {
      return new GreaterThan(AT);
    },
  },
  {
    name: "GreaterThanOrEqual on a date",
    column: "declaredAt",
    create: () => {
      return new GreaterThanOrEqual(AT);
    },
  },
  {
    name: "LessThanOrNull on a date",
    column: "declaredAt",
    create: () => {
      return new LessThanOrNull(AT);
    },
  },
  {
    name: "GreaterThanOrNull on a date",
    column: "declaredAt",
    create: () => {
      return new GreaterThanOrNull(AT);
    },
  },
  {
    name: "EqualTo on a date",
    column: "declaredAt",
    create: () => {
      return new EqualTo(AT);
    },
  },
  {
    name: "NotEqual on a date",
    column: "declaredAt",
    create: () => {
      return new NotEqual(AT);
    },
  },
  {
    name: "EqualToOrNull on a date",
    column: "declaredAt",
    create: () => {
      return new EqualToOrNull(AT);
    },
  },
  {
    name: "InBetween on a date",
    column: "declaredAt",
    create: () => {
      return new InBetween(new Date(AT.getTime() - 60_000), AT);
    },
  },
  {
    name: "GreaterThan on a number",
    column: "incidentNumber",
    create: () => {
      return new GreaterThan(41);
    },
  },
  {
    name: "InBetween on a number",
    column: "incidentNumber",
    create: () => {
      return new InBetween(10, 20);
    },
  },
  {
    name: "NotEqual on a text",
    column: "title",
    create: () => {
      return new NotEqual("Database down");
    },
  },
  {
    name: "EqualTo on a text",
    column: "title",
    create: () => {
      return new EqualTo("Database down");
    },
  },
  {
    name: "Includes on a text",
    column: "title",
    create: () => {
      return new Includes(["Database down", "Disk full"]);
    },
  },
  {
    name: "Includes on an id",
    column: "projectId",
    create: () => {
      return new Includes([PROJECT_ID]);
    },
  },
  {
    name: "EqualTo on an id",
    column: "projectId",
    create: () => {
      return new EqualTo(PROJECT_ID);
    },
  },
  {
    name: "IsNull",
    column: "declaredAt",
    create: () => {
      return new IsNull();
    },
  },
  {
    name: "NotNull",
    column: "declaredAt",
    create: () => {
      return new NotNull();
    },
  },
  {
    name: "Search",
    column: "title",
    create: () => {
      return new Search("Down");
    },
  },
  {
    name: "StartsWith",
    column: "title",
    create: () => {
      return new StartsWith("Data");
    },
  },
  {
    name: "EndsWith",
    column: "title",
    create: () => {
      return new EndsWith("down");
    },
  },
  {
    name: "NotContains",
    column: "title",
    create: () => {
      return new NotContains("test");
    },
  },
  {
    name: "Wildcard",
    column: "title",
    create: () => {
      return new Wildcard("Data*down");
    },
  },
  {
    name: "NotWildcard",
    column: "title",
    create: () => {
      return new NotWildcard("Data*down");
    },
  },
];

describe("an operator nested under a relation", () => {
  test.each(OPERATORS)(
    "$name says what it says at the top of a query of the related model",
    (item: OperatorCase) => {
      const nested: unknown = underIncident({ [item.column]: item.create() })[
        item.column
      ];
      const atTheTop: unknown = serialize(Incident, {
        [item.column]: item.create(),
      })[item.column];

      // A TypeORM operator, never the OneUptime class TypeORM would bind as JSON.
      expect(nested).toBeInstanceOf(FindOperator);
      expect(nested).not.toBeInstanceOf(QueryOperator);
      expect(said(nested)).toEqual(said(atTheTop));
    },
  );

  test("a date comparison binds the instant, in UTC, to the millisecond (#8378)", () => {
    const lessThan: DateComparison = readDateComparison(
      underIncident({ declaredAt: new LessThan(AT) })["declaredAt"],
    );

    expect(lessThan.sql).toBe(`(col < '${ISO}')`);
    expect(lessThan.values).toEqual([ISO]);
    // Rows minutes and a millisecond apart, told apart.
    expect(lessThan.matches(new Date(AT.getTime() - 60_000))).toBe(true);
    expect(lessThan.matches(new Date(AT.getTime() - 1))).toBe(true);
    expect(lessThan.matches(AT)).toBe(false);
    expect(lessThan.matches(new Date(AT.getTime() + 60_000))).toBe(false);
    expect(lessThan.matches(null)).toBe(false);
  });

  test("EqualTo and NotEqual bind a Date as its instant, never its text for people, which Postgres refuses", () => {
    for (const operator of [new EqualTo(AT), new NotEqual(AT)]) {
      const comparison: DateComparison = readDateComparison(
        underIncident({ declaredAt: operator })["declaredAt"],
      );

      expect(comparison.values).toEqual([ISO]);
      expect(String(comparison.values[0])).not.toContain("GMT");
    }
  });

  test("InBetween is inclusive at both ends, bound as instants", () => {
    const from: Date = new Date(AT.getTime() - 60_000);
    const between: DateComparison = readDateComparison(
      underIncident({ declaredAt: new InBetween(from, AT) })["declaredAt"],
    );

    expect(between.sql).toBe(
      `(col >= '${from.toISOString()}' and col <= '${ISO}')`,
    );
    expect(between.matches(from)).toBe(true);
    expect(between.matches(AT)).toBe(true);
    expect(between.matches(new Date(AT.getTime() + 1))).toBe(false);
    expect(between.matches(new Date(from.getTime() - 1))).toBe(false);
  });

  test("IsNull and NotNull are null checks on the related column", () => {
    expect(
      said(underIncident({ declaredAt: new IsNull() })["declaredAt"]),
    ).toBe("(col IS NULL)");
    expect(
      said(underIncident({ declaredAt: new NotNull() })["declaredAt"]),
    ).toBe("(col IS NOT NULL)");
  });

  test("Includes on an id writes the ids as uuid text", () => {
    const includes: unknown = underIncident({
      projectId: new Includes([new ObjectID(PROJECT_ID)]),
    })["projectId"];

    expect(said(includes)).toContain(PROJECT_ID);
  });

  test("a date that is not valid is refused as a bad request, not sent to Postgres", () => {
    expect(() => {
      return underIncident({
        declaredAt: new LessThan(new Date("not a date")),
      });
    }).toThrow(BadDataException);
    expect(() => {
      return underIncident({
        declaredAt: new LessThan(new Date("not a date")),
      });
    }).toThrow(
      "The filter on declaredAt compares it with a date that is not valid.",
    );
  });

  test("an id that is not a uuid is refused as a bad request, not sent to Postgres", () => {
    expect(() => {
      return underIncident({ projectId: new Includes(["not-a-uuid"]) });
    }).toThrow(BadDataException);
  });

  test("a filter sent by a browser, its operators as JSON, says what one built on the server says", () => {
    const built: Record<string, unknown> = {
      declaredAt: new InBetween(new Date(AT.getTime() - 60_000), AT),
      incidentNumber: new GreaterThan(41),
      title: new Search("Down"),
      projectId: new Includes([PROJECT_ID]),
    };
    const wire: JSONObject = JSON.parse(
      JSON.stringify(
        JSONFunctions.serialize({ incident: built } as unknown as JSONObject),
      ),
    ) as JSONObject;

    const fromBrowser: Record<string, unknown> = serialize(
      IncidentPublicNote,
      JSONFunctions.deserialize(wire) as Record<string, unknown>,
    )["incident"] as Record<string, unknown>;
    const fromServer: Record<string, unknown> = underIncident({
      declaredAt: new InBetween(new Date(AT.getTime() - 60_000), AT),
      incidentNumber: new GreaterThan(41),
      title: new Search("Down"),
      projectId: new Includes([PROJECT_ID]),
    });

    for (const key of Object.keys(built)) {
      expect(fromBrowser[key]).toBeInstanceOf(FindOperator);
      expect(said(fromBrowser[key])).toEqual(said(fromServer[key]));
    }
  });

  test("every operator of a filter is written, beside the values that are not operators", () => {
    const filter: Record<string, unknown> = underIncident({
      declaredAt: new LessThan(AT),
      title: new Search("Down"),
      incidentNumber: 42,
      isVisibleOnStatusPage: true,
      _id: INCIDENT_ID,
    });

    expect(filter["declaredAt"]).toBeInstanceOf(FindOperator);
    expect(filter["title"]).toBeInstanceOf(FindOperator);
    expect(filter["incidentNumber"]).toBe(42);
    expect(filter["isVisibleOnStatusPage"]).toBe(true);
    expect(filter["_id"]).toBe(INCIDENT_ID);
  });
});

describe("what is not an operator stays as it was given", () => {
  test("an id, an ObjectID, a value, a list and TypeORM's own operator", () => {
    const objectId: ObjectID = new ObjectID(INCIDENT_ID);
    const typeOrmOperator: unknown = QueryHelper.any([PROJECT_ID]);
    const titles: Array<string> = ["Database down", "Disk full"];

    const filter: Record<string, unknown> = underIncident({
      _id: objectId,
      projectId: typeOrmOperator,
      title: titles,
      incidentNumber: 7,
      declaredAt: AT,
    });

    expect(filter["_id"]).toBe(objectId);
    expect(filter["projectId"]).toBe(typeOrmOperator);
    expect(filter["title"]).toBe(titles);
    expect(filter["incidentNumber"]).toBe(7);
    expect(filter["declaredAt"]).toBe(AT);
  });

  test("the labels a member may read, as the permission checks put them under a relation", () => {
    // BasePermission.addParentRelationLabelsToQuery's filter: the parent's labels, by id.
    const labelIds: Array<ObjectID> = [
      new ObjectID(LABEL_ID),
      new ObjectID(OTHER_LABEL_ID),
    ];

    const filter: Record<string, unknown> = underIncident({
      _id: INCIDENT_ID,
      labels: labelIds,
    });

    expect(filter).toEqual({ _id: INCIDENT_ID, labels: labelIds });
    expect(filter["labels"]).toBe(labelIds);
  });

  test("the labels, beside a comparison the caller filtered by", () => {
    const labelIds: Array<ObjectID> = [new ObjectID(LABEL_ID)];

    const filter: Record<string, unknown> = underIncident({
      declaredAt: new GreaterThan(AT),
      labels: labelIds,
    });

    expect(filter["labels"]).toBe(labelIds);
    expect(said(filter["declaredAt"])).toBe(`(col > "${ISO}")`);
  });

  test("a relation filter with no operator in it is a copy with the same values", () => {
    const given: Record<string, unknown> = { _id: INCIDENT_ID };

    const filter: Record<string, unknown> = underIncident(given);

    expect(filter).toEqual({ _id: INCIDENT_ID });
  });

  test("the caller's filter is never rewritten in place: its operators are still there after", () => {
    const lessThan: LessThan<Date> = new LessThan(AT);
    const state: Record<string, unknown> = { name: new Search("Ack") };
    const given: Record<string, unknown> = {
      declaredAt: lessThan,
      currentIncidentState: state,
    };

    const filter: Record<string, unknown> = underIncident(given);

    expect(filter["declaredAt"]).toBeInstanceOf(FindOperator);
    expect(given["declaredAt"]).toBe(lessThan);
    expect(given["currentIncidentState"]).toBe(state);
    expect(state["name"]).toBeInstanceOf(Search);
  });

  test.each([
    {
      name: "a MultiSearch keyed on a column the read check holds, searching others",
      key: "title",
      create: (): QueryOperator<any> => {
        return new MultiSearch({ fields: ["title", "rootCause"], value: "db" });
      },
      says: "searches several fields at once",
    },
    {
      name: "a MultiSearch on a key of its own",
      key: "_multiFieldSearch",
      create: (): QueryOperator<any> => {
        return new MultiSearch({ fields: ["title"], value: "db" });
      },
      says: "searches several fields at once",
    },
    {
      name: "an OwnedBy under its own key",
      key: "owners",
      create: (): QueryOperator<any> => {
        return new OwnedBy({ userIds: [ObjectID.generate()] });
      },
      says: "is by owners",
    },
    {
      name: "an OwnedBy keyed on a column",
      key: "rootCause",
      create: (): QueryOperator<any> => {
        return new OwnedBy({ userIds: [ObjectID.generate()] });
      },
      says: "is by owners",
    },
  ])(
    "$name under a relation is refused as a bad request: it reaches past the column the read check holds it to",
    (item: { key: string; create: () => QueryOperator<any>; says: string }) => {
      expect(() => {
        return underIncident({ [item.key]: item.create() });
      }).toThrow(BadDataException);
      expect(() => {
        return underIncident({ [item.key]: item.create() });
      }).toThrow(
        `The filter on ${item.key} of a related Incident ${item.says}, which a filter on a related record cannot do.`,
      );
    },
  );

  test("a MultiSearch or an OwnedBy at the top of a query is still taken, as before", () => {
    expect(() => {
      return serialize(Incident, {
        _multiFieldSearch: new MultiSearch({ fields: ["title"], value: "db" }),
      });
    }).not.toThrow();
  });

  test("a key that is no column of the related model is left as it was", () => {
    const lessThan: LessThan<Date> = new LessThan(AT);

    expect(underIncident({ notAColumn: lessThan })["notAColumn"]).toBe(
      lessThan,
    );
  });
});

describe("a relation of the related record", () => {
  test("filtered by ids, is written onto its key, as at the top of a query", () => {
    const filter: Record<string, unknown> = underIncident({
      currentIncidentState: new Includes([STATE_ID]),
    });

    expect(filter["currentIncidentState"]).toBeUndefined();
    expect(said(filter["currentIncidentStateId"])).toEqual(
      said(
        serialize(Incident, {
          currentIncidentState: new Includes([STATE_ID]),
        })["currentIncidentStateId"],
      ),
    );
    expect(said(filter["currentIncidentStateId"])).toContain(STATE_ID);
  });

  test("filtered by ids beside a filter on its key: both hold", () => {
    const filter: Record<string, unknown> = underIncident({
      currentIncidentState: new Includes([STATE_ID]),
      currentIncidentStateId: OTHER_STATE_ID,
    });

    expect(filter["currentIncidentState"]).toBeUndefined();

    const both: unknown = said(filter["currentIncidentStateId"]);

    expect(both).toEqual({
      and: [`(col = "${OTHER_STATE_ID}")`, expect.stringContaining(STATE_ID)],
    });
  });

  test("filtered by ids beside an operator on its key: both hold, whichever is named first", () => {
    for (const filter of [
      underIncident({
        currentIncidentStateId: new NotEqual(OTHER_STATE_ID),
        currentIncidentState: new Includes([STATE_ID]),
      }),
      underIncident({
        currentIncidentState: new Includes([STATE_ID]),
        currentIncidentStateId: new NotEqual(OTHER_STATE_ID),
      }),
    ]) {
      const both: { and: Array<string> } = said(
        filter["currentIncidentStateId"],
      ) as { and: Array<string> };

      expect(both.and).toHaveLength(2);
      expect(both.and.join(" ")).toContain(`(col != "${OTHER_STATE_ID}")`);
      expect(both.and.join(" ")).toContain(STATE_ID);
    }
  });

  test("a filter a level deeper is written the same way", () => {
    const filter: Record<string, unknown> = underIncident({
      currentIncidentState: {
        name: new Search("Ack"),
        order: new GreaterThan(1),
        isResolvedState: false,
      },
    });

    const state: Record<string, unknown> = filter[
      "currentIncidentState"
    ] as Record<string, unknown>;

    expect(said(state["name"])).toBe(`((CAST(col AS TEXT) ILIKE "%ack%"))`);
    expect(said(state["order"])).toBe(`(col > "1")`);
    expect(state["isResolvedState"]).toBe(false);
  });
});

describe("a many-to-many relation", () => {
  test("filtered by the related records' columns, under a relation and at the top of a query", () => {
    const underTheIncident: Record<string, unknown> = underIncident({
      labels: { name: new Search("prod") },
    })["labels"] as Record<string, unknown>;
    const atTheTop: Record<string, unknown> = serialize(Incident, {
      labels: { name: new StartsWith("prod") },
    })["labels"] as Record<string, unknown>;

    expect(underTheIncident["name"]).toBeInstanceOf(FindOperator);
    expect(said(underTheIncident["name"])).toBe(
      `((CAST(col AS TEXT) ILIKE "%prod%"))`,
    );
    expect(atTheTop["name"]).toBeInstanceOf(FindOperator);
  });

  test("a list of ids under a relation is still a list", () => {
    const filter: Record<string, unknown> = underIncident({
      labels: [LABEL_ID],
    });

    expect(filter["labels"]).toEqual([LABEL_ID]);
  });
});

/*
 * #8466. A filter on a JSON column of the related record - its custom
 * fields - is written as at the top of a query: a containment check per
 * key, an operator under a key as the checks it stands for, a null check
 * on the whole column. Handed to TypeORM as it was given, the plain object
 * was compared TypeORM's own way, and an operator under a key was bound as
 * its JSON and matched nothing.
 */
describe("a filter on a related record's JSON column", () => {
  test.each([
    {
      name: "a key and its value",
      filter: (): unknown => {
        return { Team: "Payments" };
      },
    },
    {
      name: "a key and its value, beside another",
      filter: (): unknown => {
        return { Team: "Payments", Tier: "Gold" };
      },
    },
    {
      name: "an operator under a key",
      filter: (): unknown => {
        return { Team: new Includes(["Payments", "Billing"]) };
      },
    },
    {
      name: "a search under a key",
      filter: (): unknown => {
        return { Team: new Search("pay") };
      },
    },
    {
      name: "a null check on the whole column",
      filter: (): unknown => {
        return new IsNull();
      },
    },
    {
      name: "a null",
      filter: (): unknown => {
        return null;
      },
    },
  ])(
    "$name says what it says at the top of a query of the related model",
    (item: { name: string; filter: () => unknown }) => {
      const nested: unknown = underIncident({ customFields: item.filter() })[
        "customFields"
      ];
      const atTheTop: unknown = serialize(Incident, {
        customFields: item.filter(),
      })["customFields"];

      expect(nested).toBeInstanceOf(FindOperator);
      expect(said(nested)).toEqual(said(atTheTop));
    },
  );

  test("a key and its value is a check on the joined column, its key and value bound", () => {
    const sql: string = said(
      underIncident({ customFields: { Team: "Payments" } })["customFields"],
    ) as string;

    expect(sql).toContain(`"col"`);
    expect(sql).toContain("Payments");
    expect(sql).toContain("Team");
  });

  test("never writes a custom field's name into the statement's text", () => {
    const filter: unknown = underIncident({
      customFields: { "x' OR 1=1 --": "v" },
    })["customFields"];

    expect((filter as FindOperator<unknown>).getSql!("col")).not.toContain(
      "1=1",
    );
  });

  test("a level deeper, under the related record's many-to-many relation, as at the top", () => {
    const nested: Record<string, unknown> = underIncident({
      monitors: { customFields: { Team: new Includes(["Payments"]) } },
    })["monitors"] as Record<string, unknown>;
    const atTheTop: unknown = serialize(Monitor, {
      customFields: { Team: new Includes(["Payments"]) },
    })["customFields"];

    expect(nested["customFields"]).toBeInstanceOf(FindOperator);
    expect(said(nested["customFields"])).toEqual(said(atTheTop));
  });

  test("beside the labels the permission checks put there, which stay as they are", () => {
    const labelIds: Array<ObjectID> = [new ObjectID(LABEL_ID)];

    const filter: Record<string, unknown> = underIncident({
      customFields: { Team: "Payments" },
      labels: labelIds,
    });

    expect(filter["customFields"]).toBeInstanceOf(FindOperator);
    expect(filter["labels"]).toBe(labelIds);
  });

  test("one of TypeORM's own operators on the column is handed on as it is", () => {
    const typeOrmOperator: unknown = QueryHelper.isNull();

    expect(
      underIncident({ customFields: typeOrmOperator })["customFields"],
    ).toBe(typeOrmOperator);
  });

  test("the caller's filter is never rewritten in place", () => {
    const customFields: Record<string, unknown> = {
      Team: new Includes(["Payments"]),
    };
    const given: Record<string, unknown> = { customFields: customFields };

    underIncident(given);

    expect(given["customFields"]).toBe(customFields);
    expect(customFields["Team"]).toBeInstanceOf(Includes);
  });
});

describe("a filter on a single related record, as before", () => {
  test("a team member's user, searched by name and email", () => {
    const filter: Record<string, unknown> = serialize(TeamMember, {
      user: { name: new Search("Alice"), email: new EndsWith("@acme.com") },
    })["user"] as Record<string, unknown>;

    expect(said(filter["name"])).toBe(`((CAST(col AS TEXT) ILIKE "%alice%"))`);
    expect(filter["email"]).toBeInstanceOf(FindOperator);
  });
});
