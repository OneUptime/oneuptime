import { describe, expect, test } from "@jest/globals";
import DatabaseModels from "../../../Models/DatabaseModels/Index";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import Search from "../../../Types/BaseDatabase/Search";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import {
  AUDIT_LOG_RESOURCE_TYPE_KEYS,
  getAuditLogResourceTypesOfModel,
  getAuditLogResourceTypeSpellings,
  toAuditLogResourceTypeCondition,
  withAuditLogResourceTypeSpellings,
} from "../../../Utils/AuditLog/AuditLogResourceTypes";
import {
  getApiSingularName,
  getKeptSingularName,
  getScreenSingularName,
  getSingularNameSpellings,
  KEPT_SINGULAR_NAMES,
} from "../../../Utils/ModelApiName";

/*
 * A RESOURCE TYPE FINDS ITS ENTRIES BY EITHER OF ITS NAMES (#7580).
 *
 * The audit log stores a renamed model's entries under the name it kept
 * for the API (an On-Call Schedule's as "On-Call Policy Schedule"), and the
 * pages show it by today's name. A filter on "On-Call Schedule" found
 * nothing. Every read of the audit log now names a type by all of its
 * names: the kept one, as the recorder writes it, and the one on screen.
 *
 * Every renamed model is read from the models themselves, so a model
 * renamed later is held to the same, with nothing to add here.
 */

interface RenamedType {
  table: string;
  // The name the audit log stores its entries under.
  kept: string;
  // The name the product shows today.
  screen: string;
}

const RENAMED: Array<RenamedType> = DatabaseModels.map(
  (modelType: DatabaseBaseModelType): DatabaseBaseModel => {
    return new modelType();
  },
)
  .filter((model: DatabaseBaseModel): boolean => {
    return Boolean(model.apiSingularName);
  })
  .map((model: DatabaseBaseModel): RenamedType => {
    return {
      table: model.tableName!,
      kept: model.apiSingularName!,
      screen: model.singularName!,
    };
  });

// The type every model's entries are stored under, by table.
const STORED_TYPES: Map<string, string> = new Map<string, string>(
  DatabaseModels.map((modelType: DatabaseBaseModelType): [string, string] => {
    const model: DatabaseBaseModel = new modelType();

    return [model.tableName!, getApiSingularName(model)];
  }),
);

describe("the renamed models", () => {
  test("are every kept name the audit log knows, fifteen of them so far", () => {
    expect(
      RENAMED.map((renamed: RenamedType): string => {
        return renamed.kept;
      }).sort(),
    ).toEqual([...KEPT_SINGULAR_NAMES].sort());
    expect(RENAMED.length).toBeGreaterThanOrEqual(15);
  });

  test("include the two the issue names", () => {
    expect(RENAMED).toEqual(
      expect.arrayContaining([
        {
          table: "OnCallDutyPolicySchedule",
          kept: "On-Call Policy Schedule",
          screen: "On-Call Schedule",
        },
        {
          table: "OnCallDutyPolicyEscalationRuleUser",
          kept: "User's On-Call Duty Escalation Rule",
          screen: "Escalation Rule User",
        },
      ]),
    );
  });
});

describe("the names a type goes by", () => {
  test.each(RENAMED)(
    "$screen is $kept, by either name",
    (renamed: RenamedType) => {
      expect(getKeptSingularName(renamed.screen)).toBe(renamed.kept);
      expect(getKeptSingularName(renamed.kept)).toBe(renamed.kept);
      expect(getScreenSingularName(renamed.kept)).toBe(renamed.screen);

      // The kept one first: what the recorder writes.
      expect(getSingularNameSpellings(renamed.kept)).toEqual([
        renamed.kept,
        renamed.screen,
      ]);
      expect(getSingularNameSpellings(renamed.screen)).toEqual([
        renamed.kept,
        renamed.screen,
      ]);
      expect(getAuditLogResourceTypeSpellings(renamed.screen)).toEqual([
        renamed.kept,
        renamed.screen,
      ]);
    },
  );

  test("a type never renamed goes by its one name", () => {
    for (const type of ["Monitor", "On-Call Policy", "User Session", ""]) {
      expect(getKeptSingularName(type)).toBe(type);
      expect(getAuditLogResourceTypeSpellings(type)).toEqual([type]);
    }
  });

  test("a name is matched as written: another casing is another name", () => {
    expect(getAuditLogResourceTypeSpellings("on-call schedule")).toEqual([
      "on-call schedule",
    ]);
  });

  /*
   * Reading a type by both of its names must never read another type's
   * entries too: no name on screen is a name another model is stored
   * under, or another renamed model's.
   */
  test("no name of a renamed type is the name another model's entries are stored under", () => {
    const clashes: Array<string> = [];

    for (const renamed of RENAMED) {
      for (const [table, stored] of STORED_TYPES) {
        if (table === renamed.table) {
          continue;
        }

        if (stored === renamed.kept || stored === renamed.screen) {
          clashes.push(`${renamed.table} and ${table}: "${stored}"`);
        }
      }
    }

    expect(clashes).toEqual([]);
  });

  test("no two renamed types share a name on screen, and no name on screen is a kept name", () => {
    const screens: Array<string> = RENAMED.map(
      (renamed: RenamedType): string => {
        return renamed.screen;
      },
    );

    expect(new Set(screens).size).toBe(screens.length);

    for (const screen of screens) {
      expect(KEPT_SINGULAR_NAMES).not.toContain(screen);
    }
  });
});

describe("a resource type's condition", () => {
  const SCHEDULE: Array<string> = [
    "On-Call Policy Schedule",
    "On-Call Schedule",
  ];

  test.each(RENAMED)(
    "$screen, picked by either name, is any of its names",
    (renamed: RenamedType) => {
      for (const picked of [renamed.kept, renamed.screen]) {
        const condition: unknown = toAuditLogResourceTypeCondition(picked);

        expect(condition).toBeInstanceOf(Includes);
        expect((condition as Includes).values).toEqual([
          renamed.kept,
          renamed.screen,
        ]);
      }
    },
  );

  test("a type with one name is asked for as it was: the same value, not a list", () => {
    expect(toAuditLogResourceTypeCondition("Monitor")).toBe("Monitor");

    const equalTo: EqualTo<string> = new EqualTo<string>("Monitor");

    expect(toAuditLogResourceTypeCondition(equalTo)).toBe(equalTo);

    const includes: Includes = new Includes(["Monitor", "Incident"]);

    expect(toAuditLogResourceTypeCondition(includes)).toBe(includes);
  });

  test("an EqualTo is any of the type's names", () => {
    const condition: unknown = toAuditLogResourceTypeCondition(
      new EqualTo<string>("On-Call Schedule"),
    );

    expect(condition).toBeInstanceOf(Includes);
    expect((condition as Includes).values).toEqual(SCHEDULE);
  });

  test("a list of types is every name of each, once, in the order given", () => {
    const condition: unknown = toAuditLogResourceTypeCondition(
      new Includes([
        "Monitor",
        "On-Call Schedule",
        "On-Call Policy Schedule",
        "Escalation Rule User",
      ]),
    );

    expect(condition).toBeInstanceOf(Includes);
    expect((condition as Includes).values).toEqual([
      "Monitor",
      ...SCHEDULE,
      "User's On-Call Duty Escalation Rule",
      "Escalation Rule User",
    ]);
  });

  test("not a type is none of its names", () => {
    const notEqual: unknown = toAuditLogResourceTypeCondition(
      new NotEqual<string>("On-Call Schedule"),
    );

    expect(notEqual).toBeInstanceOf(IncludesNone);
    expect((notEqual as IncludesNone).values).toEqual(SCHEDULE);

    const none: unknown = toAuditLogResourceTypeCondition(
      new IncludesNone(["On-Call Policy Schedule", "Monitor"]),
    );

    expect(none).toBeInstanceOf(IncludesNone);
    expect((none as IncludesNone).values).toEqual([...SCHEDULE, "Monitor"]);

    const one: NotEqual<string> = new NotEqual<string>("Monitor");

    expect(toAuditLogResourceTypeCondition(one)).toBe(one);
  });

  test("a text search reads the stored words, as it did", () => {
    const search: Search<string> = new Search<string>("On-Call Schedule");
    const startsWith: StartsWith<string> = new StartsWith<string>("On-Call");
    const isNull: IsNull = new IsNull();

    expect(toAuditLogResourceTypeCondition(search)).toBe(search);
    expect(toAuditLogResourceTypeCondition(startsWith)).toBe(startsWith);
    expect(toAuditLogResourceTypeCondition(isNull)).toBe(isNull);
  });

  test("a value that is no name is left as it is", () => {
    const ids: Includes = new Includes([ObjectID.generate()]);

    expect(toAuditLogResourceTypeCondition(ids)).toBe(ids);
    expect(toAuditLogResourceTypeCondition(42)).toBe(42);
    expect(toAuditLogResourceTypeCondition(undefined)).toBeUndefined();
  });
});

describe("a query of the audit log", () => {
  const PROJECT_ID: ObjectID = new ObjectID(
    "75800000-0000-4000-8000-000000000001",
  );

  test("reads its resource type and its root's type by every name", () => {
    const query: JSONObject = {
      projectId: PROJECT_ID,
      resourceType: "On-Call Schedule",
      rootResourceType: "Maintenance Event",
    } as unknown as JSONObject;

    const rewritten: Record<string, unknown> =
      withAuditLogResourceTypeSpellings(query) as Record<string, unknown>;

    expect(rewritten["projectId"]).toBe(PROJECT_ID);
    expect((rewritten["resourceType"] as Includes).values).toEqual([
      "On-Call Policy Schedule",
      "On-Call Schedule",
    ]);
    expect((rewritten["rootResourceType"] as Includes).values).toEqual([
      "Scheduled Maintenance Event",
      "Maintenance Event",
    ]);
    expect(AUDIT_LOG_RESOURCE_TYPE_KEYS).toEqual([
      "resourceType",
      "rootResourceType",
    ]);
  });

  test("leaves every other field alone: a resource named after a type is still searched by its name", () => {
    const query: Record<string, unknown> = {
      projectId: PROJECT_ID,
      resourceName: "On-Call Schedule",
      action: "Update",
    };

    expect(withAuditLogResourceTypeSpellings(query)).toEqual(query);
  });

  test("is a new query: the one given is not changed", () => {
    const query: Record<string, unknown> = {
      resourceType: "Escalation Rule User",
    };

    const rewritten: Record<string, unknown> =
      withAuditLogResourceTypeSpellings(query);

    expect(rewritten).not.toBe(query);
    expect(query).toEqual({ resourceType: "Escalation Rule User" });
  });

  test("a query with no type, or none at all, reads as it did", () => {
    expect(withAuditLogResourceTypeSpellings({})).toEqual({});
    expect(withAuditLogResourceTypeSpellings({ resourceType: null })).toEqual({
      resourceType: null,
    });
    expect(withAuditLogResourceTypeSpellings(undefined)).toBeUndefined();
  });

  /*
   * The Dashboard's filter and the API send a query as JSON; the server
   * rewrites what it reads back.
   */
  test("a type sent over the API is read by every name once it is back", () => {
    const sent: JSONObject = JSONFunctions.serialize({
      projectId: PROJECT_ID,
      resourceType: "User's On-Call Duty Escalation Rule",
    } as unknown as JSONObject);

    const received: JSONObject = JSONFunctions.deserialize(
      JSON.parse(JSON.stringify(sent)) as JSONObject,
    );

    const condition: unknown = (
      withAuditLogResourceTypeSpellings(received) as Record<string, unknown>
    )["resourceType"];

    expect((condition as Includes).values).toEqual([
      "User's On-Call Duty Escalation Rule",
      "Escalation Rule User",
    ]);
  });
});

/*
 * Every type a model's entries can carry (#10664): the one it is recorded
 * under today, its name on screen, and the name it had before it was
 * renamed, which its older entries keep. The reads and the export find a
 * model by them; the Resource Type filter is not widened by a former name.
 */
describe("the types a model's entries can carry", () => {
  test("a model never renamed: its one name", () => {
    expect(
      getAuditLogResourceTypesOfModel({
        tableName: "Monitor",
        singularName: "Monitor",
      }),
    ).toEqual(["Monitor"]);
  });

  test("a model renamed on screen (#6817): the name it kept, then the one on screen", () => {
    expect(
      getAuditLogResourceTypesOfModel({
        tableName: "OnCallDutyPolicySchedule",
        singularName: "On-Call Schedule",
        apiSingularName: "On-Call Policy Schedule",
      }),
    ).toEqual(["On-Call Policy Schedule", "On-Call Schedule"]);
  });

  test("a model renamed outright: today's name, then the one its older entries carry", () => {
    expect(
      getAuditLogResourceTypesOfModel({
        tableName: "AutoRemediationRule",
        singularName: "AI Rule",
        formerSingularName: "Auto Remediation Rule",
      }),
    ).toEqual(["AI Rule", "Auto Remediation Rule"]);
  });

  test("a former name already among them is not named twice, and a blank one is none", () => {
    expect(
      getAuditLogResourceTypesOfModel({
        singularName: "Thing",
        formerSingularName: "Thing",
      }),
    ).toEqual(["Thing"]);
    expect(
      getAuditLogResourceTypesOfModel({
        singularName: "Thing",
        formerSingularName: "  ",
      }),
    ).toEqual(["Thing"]);
    expect(getAuditLogResourceTypesOfModel({})).toEqual([]);
  });

  test("each model's are read from the model itself, its type today first", () => {
    for (const modelType of DatabaseModels as Array<DatabaseBaseModelType>) {
      const model: DatabaseBaseModel = new modelType();
      const types: Array<string> = getAuditLogResourceTypesOfModel(model);

      expect({ table: model.tableName, first: types[0] }).toEqual({
        table: model.tableName,
        first: getApiSingularName(model),
      });

      if (model.formerSingularName) {
        expect(types).toContain(model.formerSingularName);
      }
    }
  });

  /*
   * The link's former name is the template's name today: a filter on the
   * link's type that named it too would find every template's entries.
   */
  test("a filter on a renamed model's type is not widened by its former name", () => {
    expect(
      toAuditLogResourceTypeCondition(
        "Status Page Subscriber Notification Template",
      ),
    ).toBe("Status Page Subscriber Notification Template");
    expect(
      toAuditLogResourceTypeCondition("Subscriber Notification Template"),
    ).toBe("Subscriber Notification Template");
    expect(getAuditLogResourceTypeSpellings("AI Rule")).toEqual(["AI Rule"]);
  });
});
