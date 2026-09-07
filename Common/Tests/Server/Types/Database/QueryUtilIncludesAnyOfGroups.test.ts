import Monitor from "../../../../Models/DatabaseModels/Monitor";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import IncludesAnyOfGroups from "../../../../Types/BaseDatabase/IncludesAnyOfGroups";
import Includes from "../../../../Types/BaseDatabase/Includes";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { FindOperator, In } from "typeorm";

const relation: {
  joinTableName: string;
  ownerColumnName: string;
  relationColumnName: string;
} = {
  joinTableName: "MonitorLabel",
  ownerColumnName: "monitorId",
  relationColumnName: "labelId",
};

describe("QueryUtil — grouped relation membership", () => {
  beforeEach(() => {
    jest
      .spyOn(QueryUtil, "getManyToManyRelationMetadata")
      .mockReturnValue(relation);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("ANDs independent ANY groups without joining the relation into the row set", () => {
    const result: Record<string, any> = QueryUtil.serializeQuery(Monitor, {
      labels: new IncludesAnyOfGroups([
        ["network", "router"],
        ["0660", "0661"],
      ]),
    });
    expect(result["labels"]).toBeUndefined();
    const filter: FindOperator<FindOperator<unknown>[]> = result["_id"];
    expect(filter.type).toBe("and");
    expect(filter.value).toHaveLength(2);
    expect(
      filter.value.map((child: FindOperator<unknown>) => {
        return Object.values(child.objectLiteralParameters || {});
      }),
    ).toEqual([[["network", "router"]], [["0660", "0661"]]]);
    for (const child of filter.value) {
      expect(child.getSql?.("Monitor._id")).toContain(
        'Monitor._id IN (SELECT "MonitorLabel"."monitorId"',
      );
    }
    const parameterNames: Array<string> = filter.value.flatMap(
      (child: FindOperator<unknown>) => {
        return Object.keys(child.objectLiteralParameters || {});
      },
    );
    expect(new Set(parameterNames).size).toBe(2);
  });

  test("an empty group contributes a false condition", () => {
    const result: Record<string, any> = QueryUtil.serializeQuery(Monitor, {
      labels: new IncludesAnyOfGroups([["network"], []]),
    });
    expect(result["_id"].value[1].getSql("Monitor._id")).toBe("TRUE = FALSE");
  });

  test.each(["before", "after"])(
    "preserves an ObjectID filter placed %s the relation key",
    (position: string) => {
      const id: ObjectID = ObjectID.generate();
      const labels: IncludesAnyOfGroups = new IncludesAnyOfGroups([
        ["network"],
        ["0660"],
      ]);
      const query: Record<string, unknown> =
        position === "before" ? { _id: id, labels } : { labels, _id: id };
      const result: Record<string, any> = QueryUtil.serializeQuery(
        Monitor,
        query as any,
      );
      expect(result["_id"].type).toBe("and");
      expect(result["_id"].value).toHaveLength(3);
      expect(
        Object.values(result["_id"].value[0].objectLiteralParameters),
      ).toEqual([id.toString()]);
    },
  );

  test.each(["before", "after"])(
    "preserves an Includes id filter placed %s the relation key",
    (position: string) => {
      const ids: Array<string> = [
        ObjectID.generate().toString(),
        ObjectID.generate().toString(),
      ];
      const labels: IncludesAnyOfGroups = new IncludesAnyOfGroups([
        ["network"],
        ["0660"],
      ]);
      const query: Record<string, unknown> =
        position === "before"
          ? { _id: new Includes(ids), labels }
          : { labels, _id: new Includes(ids) };
      const result: Record<string, any> = QueryUtil.serializeQuery(
        Monitor,
        query as any,
      );
      expect(result["_id"].value[0].type).toBe("raw");
      expect(
        Object.values(result["_id"].value[0].objectLiteralParameters),
      ).toEqual([ids]);
    },
  );

  test("preserves existing string and TypeORM id conditions", () => {
    const id: string = ObjectID.generate().toString();
    const stringResult: Record<string, any> = QueryUtil.serializeQuery(
      Monitor,
      {
        _id: id,
        labels: new IncludesAnyOfGroups([["network"], ["0660"]]),
      },
    );
    expect(
      Object.values(stringResult["_id"].value[0].objectLiteralParameters),
    ).toEqual([id]);
    const idFilter: FindOperator<string> = In([id]);
    const operatorResult: Record<string, any> = QueryUtil.serializeQuery(
      Monitor,
      {
        _id: idFilter as any,
        labels: new IncludesAnyOfGroups([["network"], ["0660"]]),
      },
    );
    expect(operatorResult["_id"].value[0]).toBe(idFilter);
  });

  test("retains the project and other widget conditions", () => {
    const projectId: ObjectID = ObjectID.generate();
    const result: Record<string, any> = QueryUtil.serializeQuery(Monitor, {
      projectId,
      disableActiveMonitoring: false,
      labels: new IncludesAnyOfGroups([["network"], ["0660"]]),
    });
    expect(Object.values(result["projectId"].objectLiteralParameters)).toEqual([
      projectId.toString(),
    ]);
    expect(result["disableActiveMonitoring"]).toBe(false);
  });

  test.each(["name", "customFields", "project", "missingColumn"])(
    "rejects the operator on the unsupported %s column",
    (column: string) => {
      expect(() => {
        return QueryUtil.serializeQuery(Monitor, {
          [column]: new IncludesAnyOfGroups([["network"]]),
        });
      }).toThrow(BadDataException);
    },
  );

  test("fails clearly when the many-to-many relation cannot be resolved", () => {
    jest.mocked(QueryUtil.getManyToManyRelationMetadata).mockReturnValue(null);
    expect(() => {
      return QueryUtil.serializeQuery(Monitor, {
        labels: new IncludesAnyOfGroups([["network"], ["0660"]]),
      });
    }).toThrow("available many-to-many relation metadata");
  });
});
