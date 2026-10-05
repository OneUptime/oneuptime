import RelationNames, {
  RelationName,
} from "../../../../Server/Utils/Database/RelationNames";
import Entities from "../../../../Models/DatabaseModels/Index";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import UserNotificationRule from "../../../../Models/DatabaseModels/UserNotificationRule";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * RelationNames lists every reference a model can be written by two names -
 * the relation and its ID column - and refuses a write whose two names
 * disagree (DatabaseService runs it before any hook). See
 * DatabaseServiceRelationNamesAgree.test.ts for the write path.
 */

const STATUS_A: string = "0193c0de-aaaa-4aaa-8bbb-0000000000a1";
const STATUS_B: string = "0193c0de-aaaa-4aaa-8bbb-0000000000b2";

type ModelType = { new (): DatabaseBaseModel };

function relationsOf(model: DatabaseBaseModel): Array<RelationName> {
  return RelationNames.getSingleRelations(model);
}

function find(
  relations: Array<RelationName>,
  relation: string,
): RelationName | undefined {
  return relations.find((entry: RelationName): boolean => {
    return entry.relation === relation;
  });
}

describe("RelationNames.getSingleRelations", () => {
  const incident: Incident = new Incident();

  test("lists an incident's references with their ID columns and titles", () => {
    const relations: Array<RelationName> = relationsOf(incident);

    expect(find(relations, "changeMonitorStatusTo")).toEqual({
      relation: "changeMonitorStatusTo",
      idColumn: "changeMonitorStatusToId",
      title: incident.getTableColumnMetadata("changeMonitorStatusTo").title,
    });
    expect(find(relations, "incidentSeverity")?.idColumn).toBe(
      "incidentSeverityId",
    );
    expect(find(relations, "currentIncidentState")?.idColumn).toBe(
      "currentIncidentStateId",
    );
    expect(find(relations, "createdByUser")?.idColumn).toBe("createdByUserId");
  });

  test("leaves out the tenant relation, which DatabaseService holds to the request's project", () => {
    expect(find(relationsOf(incident), "project")).toBeUndefined();
  });

  test("reads the ID column of a model that names the relation as its own ID column", () => {
    /*
     * UserNotificationRule's metadata names `user` as the relation's ID
     * column; the column that holds the id is `userId`.
     */
    const rule: UserNotificationRule = new UserNotificationRule();

    expect(find(relationsOf(rule), "user")?.idColumn).toBe("userId");
  });

  test("every model's references are relations, each with an ID column of its own", () => {
    const wrong: Array<string> = [];
    let count: number = 0;

    for (const modelType of Entities as Array<ModelType>) {
      const model: DatabaseBaseModel = new modelType();

      for (const relation of relationsOf(model)) {
        count++;

        if (
          model.getTableColumnMetadata(relation.relation)?.type !==
            TableColumnType.Entity ||
          relation.idColumn === relation.relation ||
          !model.hasColumn(relation.idColumn) ||
          relation.idColumn === model.getTenantColumn() ||
          !relation.title
        ) {
          wrong.push(`${model.tableName}.${relation.relation}`);
        }
      }
    }

    // A scan that found nothing would pass the check above.
    expect(count).toBeGreaterThan(1000);
    expect(wrong).toEqual([]);
  });
});

describe("RelationNames.assertNamesAgree", () => {
  const incident: Incident = new Incident();
  const title: string = incident.getTableColumnMetadata(
    "changeMonitorStatusTo",
  ).title!;
  const CONFLICT: string = `Conflicting ${title} references were provided. changeMonitorStatusToId and changeMonitorStatusTo are names for the same field and must hold the same value: send only one of them, or the same id in each.`;

  function assertAgree(payload: unknown): void {
    RelationNames.assertNamesAgree(incident, payload);
  }

  test("refuses two names that name different records", () => {
    expect(() => {
      assertAgree({
        changeMonitorStatusToId: new ObjectID(STATUS_A),
        changeMonitorStatusTo: { _id: STATUS_B },
      });
    }).toThrow(CONFLICT);
  });

  test("refuses with a BadDataException", () => {
    expect(() => {
      assertAgree({
        changeMonitorStatusToId: STATUS_A,
        changeMonitorStatusTo: STATUS_B,
      });
    }).toThrow(BadDataException);
  });

  test("refuses a record named under one name and a clear under the other", () => {
    expect(() => {
      assertAgree({
        changeMonitorStatusToId: STATUS_A,
        changeMonitorStatusTo: null,
      });
    }).toThrow(CONFLICT);
    expect(() => {
      assertAgree({
        changeMonitorStatusToId: null,
        changeMonitorStatusTo: { _id: STATUS_A },
      });
    }).toThrow(CONFLICT);
  });

  test("passes the same id under both names, in any case", () => {
    expect(() => {
      assertAgree({
        changeMonitorStatusToId: STATUS_A.toUpperCase(),
        changeMonitorStatusTo: { _id: STATUS_A },
      });
    }).not.toThrow();
  });

  test("passes a reference named once, under either name", () => {
    expect(() => {
      assertAgree({ changeMonitorStatusToId: STATUS_A });
      assertAgree({ changeMonitorStatusTo: { _id: STATUS_B } });
      assertAgree({ changeMonitorStatusTo: null });
    }).not.toThrow();
  });

  test("passes a clear under both names", () => {
    expect(() => {
      assertAgree({
        changeMonitorStatusToId: null,
        changeMonitorStatusTo: null,
      });
    }).not.toThrow();
  });

  test("checks every reference of the write, not only the first", () => {
    expect(() => {
      assertAgree({
        changeMonitorStatusToId: STATUS_A,
        changeMonitorStatusTo: { _id: STATUS_A },
        incidentSeverityId: STATUS_A,
        incidentSeverity: { _id: STATUS_B },
      });
    }).toThrow(
      `Conflicting ${incident.getTableColumnMetadata("incidentSeverity").title} references were provided.`,
    );
  });

  test("reads a model instance as it reads a plain payload", () => {
    const data: Incident = new Incident();
    data.changeMonitorStatusToId = new ObjectID(STATUS_A);
    (data as unknown as Record<string, unknown>)["changeMonitorStatusTo"] = {
      _id: STATUS_B,
    };

    expect(() => {
      assertAgree(data);
    }).toThrow(CONFLICT);

    // An instance's unset columns are not written.
    expect(() => {
      assertAgree(new Incident());
    }).not.toThrow();
  });

  test("has nothing to say about a missing payload", () => {
    expect(() => {
      assertAgree(undefined);
      assertAgree(null);
    }).not.toThrow();
  });
});
