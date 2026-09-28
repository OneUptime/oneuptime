import {
  MoveCustomFieldValueKeyResult,
  moveCustomFieldValueKey,
  renameCustomFieldInTableViews,
} from "../../../../Server/Utils/CustomField/CustomFieldRename";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import TableViewService from "../../../../Server/Services/TableViewService";
import TableView from "../../../../Models/DatabaseModels/TableView";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Renaming a custom field.
 *
 * A custom field's values are stored in each record's `customFields` bag under
 * the field's display name, so a rename has to move the key or every stored
 * answer is orphaned. This does it with one raw UPDATE per table rather than
 * through DatabaseService, deliberately: updateBy fires the model's "on
 * update" workflow trigger per row, and customers run workflows on incident
 * custom fields. A rename is a change of label, not of anyone's answers.
 *
 * Two things make it worth testing without a database. The statement is
 * assembled from entity metadata, and the claim that it is not an injection
 * surface rests on the names coming from metadata and every value being bound
 * -- assertable exactly here. And its second job is destructive: it *removes*
 * what a record holds under the new name, because a deleted field leaves its
 * values behind and the renamed field must not adopt them. A record picking up
 * a stranger's value is the bug this guards, and on an incident field marked
 * for subscriber notifications it would be sent out.
 *
 * So the query is captured rather than run. What Postgres does with the
 * statement is not in scope here; what is in scope is that the right statement,
 * with the right bound values, is what gets sent -- and that the early returns
 * send nothing at all.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000001",
);

interface CapturedQuery {
  sql: string;
  parameters: Array<unknown>;
}

let queries: Array<CapturedQuery> = [];
let queryResult: unknown = [{ moved: 0, cleared: 0 }];

// Stands in for the service's repository: the metadata the SQL is built from.
function serviceFor(data: {
  tableName: string;
  columns: Record<string, string>;
}): DatabaseService<any> {
  const query: MockFunction = getJestMockFunction();
  query.mockImplementation(
    (sql: string, parameters: Array<unknown>): Promise<unknown> => {
      queries.push({ sql: sql, parameters: parameters });
      return Promise.resolve(queryResult);
    },
  );

  return {
    getRepository: (): unknown => {
      return {
        metadata: {
          tableName: data.tableName,
          findColumnWithPropertyName: (
            propertyName: string,
          ): { databaseName: string } | undefined => {
            const databaseName: string | undefined = data.columns[propertyName];
            return databaseName ? { databaseName: databaseName } : undefined;
          },
        },
        manager: { query: query },
      };
    },
  } as unknown as DatabaseService<any>;
}

function incidentService(): DatabaseService<any> {
  return serviceFor({
    tableName: "Incident",
    columns: { customFields: "customFields", projectId: "projectId" },
  });
}

beforeEach(() => {
  queries = [];
  queryResult = [{ moved: 0, cleared: 0 }];
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("moveCustomFieldValueKey", () => {
  describe("what it refuses to run at all", () => {
    /*
     * Each of these would be a destructive no-op if it reached the database:
     * with the two names equal the statement's ELSE branch deletes the very
     * key it was asked to keep, and a blank name matches no field.
     */
    test.each([
      ["the names are the same", "Impact", "Impact"],
      ["the old name is blank", "", "Business Impact"],
      ["the new name is blank", "Impact", ""],
    ])(
      "sends no statement when %s",
      async (_case: string, oldName: string, newName: string) => {
        const result: MoveCustomFieldValueKeyResult =
          await moveCustomFieldValueKey({
            service: incidentService(),
            projectId: PROJECT_ID,
            oldName: oldName,
            newName: newName,
          });

        expect(queries).toHaveLength(0);
        expect(result).toEqual({ moved: 0, cleared: 0 });
      },
    );
  });

  describe("the statement it sends", () => {
    beforeEach(async () => {
      await moveCustomFieldValueKey({
        service: incidentService(),
        projectId: PROJECT_ID,
        oldName: "Impact",
        newName: "Business Impact",
      });
    });

    test("runs exactly one statement", () => {
      expect(queries).toHaveLength(1);
    });

    /*
     * The injection claim, stated as a test: the only things interpolated are
     * the table and column names read from the entity metadata. Neither name
     * the caller passed appears in the SQL text.
     */
    test("interpolates only names taken from the entity metadata", () => {
      expect(queries[0]!.sql).toContain('UPDATE "Incident"');
      expect(queries[0]!.sql).toContain('"customFields"');
      expect(queries[0]!.sql).toContain('"projectId" = $1');
    });

    test("carries both field names as bound parameters, never as SQL text", () => {
      expect(queries[0]!.parameters).toEqual([
        PROJECT_ID.toString(),
        "Impact",
        "Business Impact",
      ]);
      expect(queries[0]!.sql).not.toContain("Impact");
    });

    // Without this the rename would run across every project on the instance.
    test("is scoped to the project", () => {
      expect(queries[0]!.sql).toContain('WHERE "projectId" = $1');
      expect(queries[0]!.parameters[0]).toBe(PROJECT_ID.toString());
    });

    /*
     * The clean-start rule: a record with nothing under the old name has the
     * new name removed, so a deleted field's leftover answer is not adopted by
     * the renamed field.
     */
    test("clears the new name from records that hold nothing under the old one", () => {
      expect(queries[0]!.sql).toContain('ELSE "customFields" - $3::text');
    });

    test("moves the value out from under the old name and back under the new one", () => {
      expect(queries[0]!.sql).toContain(
        '("customFields" - $2::text) || jsonb_build_object($3::text, "customFields" -> $2::text)',
      );
    });

    /*
     * `-` and `?` act on a jsonb array's elements rather than on object keys,
     * so a bag that is not an object is not a bag of named values.
     */
    test("only touches rows whose bag is a JSON object", () => {
      expect(queries[0]!.sql).toContain(
        `jsonb_typeof("customFields") = 'object'`,
      );
    });

    test("only touches rows that hold one of the two names", () => {
      expect(queries[0]!.sql).toContain(
        'jsonb_exists("customFields", $2::text)',
      );
      expect(queries[0]!.sql).toContain(
        'jsonb_exists("customFields", $3::text)',
      );
    });
  });

  describe("the counts it reports", () => {
    async function moveWithResult(
      result: unknown,
    ): Promise<MoveCustomFieldValueKeyResult> {
      queryResult = result;

      return moveCustomFieldValueKey({
        service: incidentService(),
        projectId: PROJECT_ID,
        oldName: "Impact",
        newName: "Business Impact",
      });
    }

    test("reports what the statement returned", async () => {
      await expect(moveWithResult([{ moved: 3, cleared: 2 }])).resolves.toEqual(
        { moved: 3, cleared: 2 },
      );
    });

    /*
     * Postgres hands back bigint-ish counts as strings through some drivers,
     * and a count that arrived as "3" must not be reported as 0.
     */
    test("reads counts that arrived as strings", async () => {
      await expect(
        moveWithResult([{ moved: "3", cleared: "2" }]),
      ).resolves.toEqual({ moved: 3, cleared: 2 });
    });

    test.each([
      ["no rows came back", []],
      ["the answer was not a list", { moved: 1 }],
      ["the row is missing the counts", [{}]],
      ["a count is null", [{ moved: null, cleared: null }]],
      ["a count is not a number", [{ moved: "many", cleared: "some" }]],
    ])("reports zero when %s", async (_case: string, result: unknown) => {
      await expect(moveWithResult(result)).resolves.toEqual({
        moved: 0,
        cleared: 0,
      });
    });
  });

  describe("where it runs", () => {
    test("uses the transaction it was given, so the rename is one unit of work", async () => {
      const transactionQuery: MockFunction = getJestMockFunction();
      transactionQuery.mockImplementation((): Promise<unknown> => {
        return Promise.resolve([{ moved: 1, cleared: 0 }]);
      });

      const service: DatabaseService<any> = incidentService();

      await moveCustomFieldValueKey({
        service: service,
        projectId: PROJECT_ID,
        oldName: "Impact",
        newName: "Business Impact",
        manager: { query: transactionQuery } as never,
      });

      expect(transactionQuery).toHaveBeenCalledTimes(1);
      // Nothing went to the repository's own manager, outside the transaction.
      expect(queries).toHaveLength(0);
    });

    test("falls back to the repository's manager when there is no transaction", async () => {
      await moveCustomFieldValueKey({
        service: incidentService(),
        projectId: PROJECT_ID,
        oldName: "Impact",
        newName: "Business Impact",
      });

      expect(queries).toHaveLength(1);
    });
  });

  describe("a table it cannot rename on", () => {
    /*
     * Better to fail than to build a statement against a guessed column name:
     * the model would be one that has no custom fields at all.
     */
    test("refuses a table with no customFields column, and names it", async () => {
      const service: DatabaseService<any> = serviceFor({
        tableName: "Label",
        columns: { projectId: "projectId" },
      });

      await expect(
        moveCustomFieldValueKey({
          service: service,
          projectId: PROJECT_ID,
          oldName: "Impact",
          newName: "Business Impact",
        }),
      ).rejects.toThrow(
        'Cannot rename a custom field on Label: it has no "customFields" column.',
      );

      expect(queries).toHaveLength(0);
    });

    test("refuses a table with no projectId column", async () => {
      const service: DatabaseService<any> = serviceFor({
        tableName: "GlobalConfig",
        columns: { customFields: "customFields" },
      });

      await expect(
        moveCustomFieldValueKey({
          service: service,
          projectId: PROJECT_ID,
          oldName: "Impact",
          newName: "Business Impact",
        }),
      ).rejects.toThrow('it has no "projectId" column');

      expect(queries).toHaveLength(0);
    });

    /*
     * The column the statement writes is the database name, which is not
     * always the property name.
     */
    test("writes the database column name, not the property name", async () => {
      const service: DatabaseService<any> = serviceFor({
        tableName: "Incident",
        columns: { customFields: "custom_fields", projectId: "project_id" },
      });

      await moveCustomFieldValueKey({
        service: service,
        projectId: PROJECT_ID,
        oldName: "Impact",
        newName: "Business Impact",
      });

      expect(queries[0]!.sql).toContain('"custom_fields"');
      expect(queries[0]!.sql).toContain('"project_id" = $1');
    });
  });
});

describe("renameCustomFieldInTableViews", () => {
  let findBy: MockFunction;
  let updateColumns: MockFunction;

  function viewNaming(data: {
    id: string;
    columns?: JSONObject | undefined;
    facets?: JSONObject | undefined;
    query?: JSONObject | undefined;
  }): TableView {
    const view: TableView = new TableView();
    view._id = data.id;
    view.columns = data.columns as never;
    view.facets = data.facets as never;
    view.query = data.query as never;
    return view;
  }

  beforeEach(() => {
    findBy = getJestMockFunction();
    findBy.mockImplementation((): Promise<Array<TableView>> => {
      return Promise.resolve([]);
    });
    jest.spyOn(TableViewService, "findBy").mockImplementation(findBy as never);

    updateColumns = getJestMockFunction();
    updateColumns.mockImplementation((): Promise<void> => {
      return Promise.resolve();
    });
    jest
      .spyOn(TableViewService, "updateColumnsByIdWithoutHooks")
      .mockImplementation(updateColumns as never);
  });

  test.each([
    ["the names are the same", "Impact", "Impact", ["all-incidents-table"]],
    ["the old name is blank", "", "Business Impact", ["all-incidents-table"]],
    ["the new name is blank", "Impact", "", ["all-incidents-table"]],
    ["no table has saved views", "Impact", "Business Impact", []],
  ])(
    "reads nothing when %s",
    async (
      _case: string,
      oldName: string,
      newName: string,
      tableIds: Array<string>,
    ) => {
      await expect(
        renameCustomFieldInTableViews({
          projectId: PROJECT_ID,
          tableIds: tableIds,
          oldName: oldName,
          newName: newName,
        }),
      ).resolves.toBe(0);

      expect(findBy).not.toHaveBeenCalled();
    },
  );

  test("rewrites the column id a view remembers the field by", async () => {
    findBy.mockImplementation((): Promise<Array<TableView>> => {
      return Promise.resolve([
        viewNaming({
          id: "b0000000-0000-4000-8000-00000000000a",
          columns: {
            order: ["name", "customFields.Impact"],
            hidden: ["customFields.Impact"],
          },
        }),
      ]);
    });

    await expect(
      renameCustomFieldInTableViews({
        projectId: PROJECT_ID,
        tableIds: ["all-incidents-table"],
        oldName: "Impact",
        newName: "Business Impact",
      }),
    ).resolves.toBe(1);

    const call: JSONObject = updateColumns.mock.calls[0]![0] as JSONObject;

    expect(call["data"]).toEqual({
      columns: {
        order: ["name", "customFields.Business Impact"],
        hidden: ["customFields.Business Impact"],
      },
    });
  });

  /*
   * The write is a compare-and-set against what was read, so a view someone
   * saves between the read and the write is left as they saved it rather than
   * half overwritten with a stale copy.
   */
  test("writes each view against the value it was read with", async () => {
    const columns: JSONObject = { order: ["customFields.Impact"] };

    findBy.mockImplementation((): Promise<Array<TableView>> => {
      return Promise.resolve([
        viewNaming({
          id: "b0000000-0000-4000-8000-00000000000a",
          columns: columns,
        }),
      ]);
    });

    await renameCustomFieldInTableViews({
      projectId: PROJECT_ID,
      tableIds: ["all-incidents-table"],
      oldName: "Impact",
      newName: "Business Impact",
    });

    const call: JSONObject = updateColumns.mock.calls[0]![0] as JSONObject;

    expect(call["expectedData"]).toEqual({ columns: columns });
    // A relabelled column is not a change anyone made to the view.
    expect(call["skipUpdateDateColumn"]).toBe(true);
  });

  test("leaves a view that never mentioned the field alone", async () => {
    findBy.mockImplementation((): Promise<Array<TableView>> => {
      return Promise.resolve([
        viewNaming({
          id: "b0000000-0000-4000-8000-00000000000a",
          columns: { order: ["name", "customFields.Severity"] },
        }),
      ]);
    });

    await expect(
      renameCustomFieldInTableViews({
        projectId: PROJECT_ID,
        tableIds: ["all-incidents-table"],
        oldName: "Impact",
        newName: "Business Impact",
      }),
    ).resolves.toBe(0);

    expect(updateColumns).not.toHaveBeenCalled();
  });

  test("counts only the views it rewrote", async () => {
    findBy.mockImplementation((): Promise<Array<TableView>> => {
      return Promise.resolve([
        viewNaming({
          id: "b0000000-0000-4000-8000-00000000000a",
          columns: { order: ["customFields.Impact"] },
        }),
        viewNaming({
          id: "b0000000-0000-4000-8000-00000000000b",
          columns: { order: ["name"] },
        }),
        viewNaming({
          id: "b0000000-0000-4000-8000-00000000000c",
          facets: {
            facetSelections: { "customField:Impact": ["High"] },
          },
        }),
      ]);
    });

    await expect(
      renameCustomFieldInTableViews({
        projectId: PROJECT_ID,
        tableIds: ["all-incidents-table"],
        oldName: "Impact",
        newName: "Business Impact",
      }),
    ).resolves.toBe(2);

    expect(updateColumns).toHaveBeenCalledTimes(2);
  });

  test("rewrites the facet chip a view filters by", async () => {
    findBy.mockImplementation((): Promise<Array<TableView>> => {
      return Promise.resolve([
        viewNaming({
          id: "b0000000-0000-4000-8000-00000000000a",
          facets: {
            facetSelections: { "customField:Impact": ["High"] },
            facetOperators: { "customField:Impact": "EqualTo" },
          },
        }),
      ]);
    });

    await renameCustomFieldInTableViews({
      projectId: PROJECT_ID,
      tableIds: ["all-incidents-table"],
      oldName: "Impact",
      newName: "Business Impact",
    });

    const call: JSONObject = updateColumns.mock.calls[0]![0] as JSONObject;

    expect(call["data"]).toEqual({
      facets: {
        facetSelections: { "customField:Business Impact": ["High"] },
        facetOperators: { "customField:Business Impact": "EqualTo" },
      },
    });
  });

  // Only the project's own views, and only the tables that have any.
  test("reads only this project's views, for the tables asked about", async () => {
    await renameCustomFieldInTableViews({
      projectId: PROJECT_ID,
      tableIds: ["all-incidents-table"],
      oldName: "Impact",
      newName: "Business Impact",
    });

    const query: JSONObject = (findBy.mock.calls[0]![0] as JSONObject)[
      "query"
    ] as JSONObject;

    expect(query["projectId"]).toBe(PROJECT_ID);
  });
});
