import { ClickhouseAppInstance } from "../../../../Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "../../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import "../../TestingUtils/Init";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import Route from "../../../../Types/API/Route";
import AnalyticsTableEngine from "../../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableColumn from "../../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import Search from "../../../../Types/BaseDatabase/Search";
import ObjectID from "../../../../Types/ObjectID";
import { SECURITY_EVENT_SCOPE_QUERY_KEY } from "../../../../Types/SecurityEvent/SecurityEventScope";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE SECURITY EVENTS ABOUT ONE RECORD, COMPILED (issue #5769).
 *
 * A network device's Security Events page puts its scope on every read
 * under the synthetic key `securityEventScope`: the events naming one of
 * the device's identities, OR read from its own syslog. The search grammar
 * ANDs everything it is given, so the OR is the generator's to write - and
 * a scope left with nothing to match must match nothing, never every event.
 */

const DEVICE_ID: string = "0192f1a0-0000-7000-8000-0000000000dd";

function column(
  key: string,
  type: TableColumnType,
  extra: Partial<{ mapKeysColumn: string }> = {},
): AnalyticsTableColumn {
  return new AnalyticsTableColumn({
    key,
    title: "<title>",
    description: "<description>",
    required: true,
    type,
    ...(type === TableColumnType.ArrayText ? { defaultValue: [] } : {}),
    ...(type === TableColumnType.MapStringString ? { defaultValue: {} } : {}),
    ...extra,
  });
}

class ScopeModel extends AnalyticsBaseModel {
  public constructor() {
    super({
      tableName: "<security-event-scope-table>",
      singularName: "<singular>",
      pluralName: "<plural>",
      tableColumns: [
        column("_id", TableColumnType.ObjectID),
        column("observables", TableColumnType.ArrayText),
        column("attributes", TableColumnType.MapStringString, {
          mapKeysColumn: "attributeKeys",
        }),
        column("attributeKeys", TableColumnType.ArrayText),
        column("message", TableColumnType.Text),
      ],
      crudApiPath: new Route("route"),
      primaryKeys: ["_id"],
      sortKeys: ["_id"],
      partitionKey: "_id",
      tableEngine: AnalyticsTableEngine.MergeTree,
    });
  }
}

// An attributes map with no key column beside it.
class NoKeysModel extends AnalyticsBaseModel {
  public constructor() {
    super({
      tableName: "<no-keys-table>",
      singularName: "<singular>",
      pluralName: "<plural>",
      tableColumns: [
        column("_id", TableColumnType.ObjectID),
        column("observables", TableColumnType.ArrayText),
        column("attributes", TableColumnType.MapStringString),
      ],
      crudApiPath: new Route("route"),
      primaryKeys: ["_id"],
      sortKeys: ["_id"],
      partitionKey: "_id",
      tableEngine: AnalyticsTableEngine.MergeTree,
    });
  }
}

// A table that has neither: some other signal's.
class OtherSignalModel extends AnalyticsBaseModel {
  public constructor() {
    super({
      tableName: "<other-signal-table>",
      singularName: "<singular>",
      pluralName: "<plural>",
      tableColumns: [
        column("_id", TableColumnType.ObjectID),
        column("body", TableColumnType.Text),
      ],
      crudApiPath: new Route("route"),
      primaryKeys: ["_id"],
      sortKeys: ["_id"],
      partitionKey: "_id",
      tableEngine: AnalyticsTableEngine.MergeTree,
    });
  }
}

describe("the securityEventScope synthetic key", () => {
  let generator: StatementGenerator<ScopeModel>;

  beforeEach(() => {
    generator = new StatementGenerator<ScopeModel>({
      modelType: ScopeModel,
      database: ClickhouseAppInstance,
    });
  });

  function where(scope: unknown, rest: Record<string, unknown> = {}): Statement {
    return generator.toWhereStatement({
      ...rest,
      [SECURITY_EVENT_SCOPE_QUERY_KEY]: scope,
    } as any);
  }

  test("names one of the record's identities OR comes from its own logs", () => {
    const statement: Statement = where({
      observables: ["core-fw-1", "CORE-FW-1", "203.0.113.7"],
      attributeKey: "networkDevice.id",
      attributeValues: [DEVICE_ID],
    });

    expect(statement.query).toBe(
      "AND (hasAny({p0:Identifier}, {p1:Array(String)}) OR (has({p2:Identifier}, {p3:String}) AND {p4:Identifier}[{p5:String}] = {p6:String}))",
    );
    expect(statement.query_params).toStrictEqual({
      p0: "observables",
      p1: ["core-fw-1", "CORE-FW-1", "203.0.113.7"],
      p2: "attributeKeys",
      p3: "networkDevice.id",
      p4: "attributes",
      p5: "networkDevice.id",
      p6: DEVICE_ID,
    });
  });

  test("a record with no identity to name is read by its own logs alone", () => {
    const statement: Statement = where({
      observables: [],
      attributeKey: "networkDevice.id",
      attributeValues: [DEVICE_ID],
    });

    expect(statement.query).toBe(
      "AND ((has({p0:Identifier}, {p1:String}) AND {p2:Identifier}[{p3:String}] = {p4:String}))",
    );
    expect(statement.query_params).toStrictEqual({
      p0: "attributeKeys",
      p1: "networkDevice.id",
      p2: "attributes",
      p3: "networkDevice.id",
      p4: DEVICE_ID,
    });
  });

  test("a record with no logs of its own is read by its identities alone", () => {
    const statement: Statement = where({ observables: ["web-1"] });

    expect(statement.query).toBe(
      "AND (hasAny({p0:Identifier}, {p1:Array(String)}))",
    );
    expect(statement.query_params).toStrictEqual({
      p0: "observables",
      p1: ["web-1"],
    });
  });

  test("several values of the attribute are an IN", () => {
    const other: string = "0192f1a0-0000-7000-8000-0000000000ee";
    const statement: Statement = where({
      observables: [],
      attributeKey: "networkDevice.id",
      attributeValues: [DEVICE_ID, other],
    });

    expect(statement.query).toContain(
      "{p2:Identifier}[{p3:String}] IN {p4:Array(String)}",
    );
    expect(statement.query_params["p4"]).toStrictEqual([DEVICE_ID, other]);
  });

  test.each([
    ["an empty scope", {}],
    ["a scope naming nothing", { observables: [] }],
    [
      "an attribute with no values",
      { observables: [], attributeKey: "networkDevice.id", attributeValues: [] },
    ],
    ["values with no attribute", { observables: [], attributeValues: [DEVICE_ID] }],
    ["only empty identities", { observables: ["", "   "] }],
    ["a string", "core-fw-1"],
    ["a list", ["core-fw-1"]],
    ["null", null],
    ["a number", 7],
  ])(
    "%s matches nothing - never every event",
    (_case: string, scope: unknown) => {
      const statement: Statement = where(scope);

      expect(statement.query).toBe("AND 0");
      expect(statement.query_params).toStrictEqual({});
    },
  );

  test("ANDs with the rest of the query, which never takes it off", () => {
    const statement: Statement = where(
      { observables: ["core-fw-1"] },
      {
        _id: "<value>",
        observables: new Search("203.0.113"),
        message: new Search("denied"),
      },
    );

    expect(statement.query).toBe(
      "AND {p0:Identifier} = {p1:String} " +
        "AND arrayExists(x -> x ILIKE {p2:String}, {p3:Identifier}) " +
        "AND {p4:Identifier} ILIKE {p5:String} " +
        "AND (hasAny({p6:Identifier}, {p7:Array(String)}))",
    );
    expect(statement.query_params["p3"]).toBe("observables");
    expect(statement.query_params["p6"]).toBe("observables");
    expect(statement.query_params["p7"]).toStrictEqual(["core-fw-1"]);
  });

  test("a scope that matches nothing still separates the predicates around it", () => {
    const statement: Statement = generator.toWhereStatement({
      _id: "<value>",
      [SECURITY_EVENT_SCOPE_QUERY_KEY]: {},
      message: new Search("denied"),
    } as any);

    expect(statement.query).toBe(
      "AND {p0:Identifier} = {p1:String} AND 0 AND {p2:Identifier} ILIKE {p3:String}",
    );
  });

  test("every value is bound, never written into the statement", () => {
    const hostile: string = "x') OR 1=1 --";
    const statement: Statement = where({
      observables: [hostile],
      attributeKey: "networkDevice.id'] OR 1=1 --",
      attributeValues: [hostile],
    });

    expect(statement.query).not.toContain("1=1");
    expect(Object.values(statement.query_params)).toContain(hostile);
  });

  test("qualifies every column under a table alias", () => {
    const statement: Statement = generator.toWhereStatement(
      {
        [SECURITY_EVENT_SCOPE_QUERY_KEY]: {
          observables: ["core-fw-1"],
          attributeKey: "networkDevice.id",
          attributeValues: [DEVICE_ID],
        },
      } as any,
      { tableAlias: "e" },
    );

    expect(statement.query).toBe(
      "AND (hasAny({p0_t:Identifier}.{p0_c:Identifier}, {p1:Array(String)}) OR (has({p2_t:Identifier}.{p2_c:Identifier}, {p3:String}) AND {p4_t:Identifier}.{p4_c:Identifier}[{p5:String}] = {p6:String}))",
    );
  });
});

describe("the scope on other tables", () => {
  test("an attributes map with no key column is read by the map alone", () => {
    const generator: StatementGenerator<NoKeysModel> =
      new StatementGenerator<NoKeysModel>({
        modelType: NoKeysModel,
        database: ClickhouseAppInstance,
      });

    const statement: Statement = generator.toWhereStatement({
      [SECURITY_EVENT_SCOPE_QUERY_KEY]: {
        observables: [],
        attributeKey: "networkDevice.id",
        attributeValues: [DEVICE_ID],
      },
    } as any);

    expect(statement.query).toBe(
      "AND (({p0:Identifier}[{p1:String}] = {p2:String}))",
    );
  });

  test("a table without the columns matches nothing, rather than everything", () => {
    const generator: StatementGenerator<OtherSignalModel> =
      new StatementGenerator<OtherSignalModel>({
        modelType: OtherSignalModel,
        database: ClickhouseAppInstance,
      });

    const statement: Statement = generator.toWhereStatement({
      [SECURITY_EVENT_SCOPE_QUERY_KEY]: {
        observables: ["core-fw-1"],
        attributeKey: "networkDevice.id",
        attributeValues: [DEVICE_ID],
      },
    } as any);

    expect(statement.query).toBe("AND 0");
  });

  test("the SecurityEvent table reads it with its own observables, attributes and attribute keys", () => {
    const generator: StatementGenerator<SecurityEvent> =
      new StatementGenerator<SecurityEvent>({
        modelType: SecurityEvent,
        database: ClickhouseAppInstance,
      });
    const projectId: ObjectID = new ObjectID(
      "11111111-1111-4111-8111-111111111111",
    );

    const statement: Statement = generator.toWhereStatement({
      projectId,
      [SECURITY_EVENT_SCOPE_QUERY_KEY]: {
        observables: ["core-fw-1"],
        attributeKey: "networkDevice.id",
        attributeValues: [DEVICE_ID],
      },
    } as any);

    expect(statement.query).toContain(
      "(hasAny({p2:Identifier}, {p3:Array(String)}) OR (has({p4:Identifier}, {p5:String}) AND {p6:Identifier}[{p7:String}] = {p8:String}))",
    );
    expect(statement.query_params["p2"]).toBe("observables");
    expect(statement.query_params["p4"]).toBe("attributeKeys");
    expect(statement.query_params["p6"]).toBe("attributes");
    expect(statement.query_params["p8"]).toBe(DEVICE_ID);
  });
});
