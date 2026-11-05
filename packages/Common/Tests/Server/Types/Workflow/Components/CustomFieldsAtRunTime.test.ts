import ColumnValueChange from "../../../../../Server/Utils/Database/ColumnValueChange";
import buildJSONColumnQuery, {
  JSONColumnQuery,
} from "../../../../../Server/Types/Database/JSONColumnQuery";
import VMUtil from "../../../../../Server/Utils/VM/VMAPI";
import OnTriggerBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/OnTriggerBaseModel";
import { ExecuteWorkflowType } from "../../../../../Server/Types/Workflow/TriggerCode";
import IncidentService from "../../../../../Server/Services/IncidentService";
import WorkflowService from "../../../../../Server/Services/WorkflowService";
import Response from "../../../../../Server/Utils/Response";
import Workflow from "../../../../../Models/DatabaseModels/Workflow";
import { JSONObject } from "../../../../../Types/JSON";
import JSONFunctions from "../../../../../Types/JSONFunctions";
import ObjectID from "../../../../../Types/ObjectID";
import {
  CUSTOM_FIELDS_COLUMN,
  CUSTOM_FIELD_COLUMN_PREFIX,
  UPDATED_CUSTOM_FIELDS_KEY,
  getCustomFieldColumnId,
  getCustomFieldName,
} from "../../../../../Types/Workflow/CustomFieldsColumn";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Issue #5942, when a workflow runs: what the builder lists has to work once the
 * run reads it - a custom field's name in a reference, a condition on one in a
 * Find step, and an On Update trigger watching just one of them.
 */

describe("a custom field's path", () => {
  test("is the column, then its name as it was written", () => {
    expect(getCustomFieldColumnId("Priority Level")).toBe(
      "customFields.Priority Level",
    );
    expect(CUSTOM_FIELD_COLUMN_PREFIX).toBe(`${CUSTOM_FIELDS_COLUMN}.`);
  });

  test("reads back to the name, a dot in it included", () => {
    expect(getCustomFieldName("customFields.Priority Level")).toBe(
      "Priority Level",
    );
    expect(getCustomFieldName("customFields.Release 1.2")).toBe("Release 1.2");
  });

  test.each(["customFields", "customFields.", "title", "custom.Fields.x", ""])(
    "%p names no custom field",
    (columnId: string) => {
      expect(getCustomFieldName(columnId)).toBeNull();
    },
  );
});

describe("a reference to a custom field", () => {
  const storage: JSONObject = {
    local: {
      components: {
        trigger: {
          returnValues: {
            model: {
              title: "Down",
              customFields: {
                "Priority Level": "P1",
                Count: 3,
                Reviewed: false,
                "Release 1.2": "x",
                "a.b.c": "deep",
              },
            },
          },
        },
      },
    },
  };

  const PATH: string = "local.components.trigger.returnValues.model";

  test("resolves with a space in its name", () => {
    expect(
      VMUtil.deepFind(storage, `${PATH}.customFields.Priority Level`),
    ).toBe("P1");
  });

  test("resolves with a dot in its name", () => {
    expect(VMUtil.deepFind(storage, `${PATH}.customFields.Release 1.2`)).toBe(
      "x",
    );
    expect(VMUtil.deepFind(storage, `${PATH}.customFields.a.b.c`)).toBe("deep");
  });

  test("keeps a value of false", () => {
    expect(VMUtil.deepFind(storage, `${PATH}.customFields.Reviewed`)).toBe(
      false,
    );
  });

  test("a field with no value finds nothing, as any other path that finds none", () => {
    expect(
      VMUtil.deepFind(storage, `${PATH}.customFields.Nothing Here`),
    ).toBeUndefined();
    expect(
      VMUtil.deepFind(storage, `${PATH}.customFields.No.Such.Dots`),
    ).toBeUndefined();
  });

  test("a path that resolved before reads the same: an exact key wins", () => {
    const withBoth: JSONObject = {
      a: { b: { c: "nested" }, "b.c": "dotted" },
    };

    expect(VMUtil.deepFind(withBoth, "a.b.c")).toBe("nested");
  });

  test("a path through something that is no object still finds nothing", () => {
    expect(VMUtil.deepFind({ a: "text" }, "a.b.c")).toBeUndefined();
    expect(VMUtil.deepFind({ a: null } as JSONObject, "a.b")).toBeUndefined();
  });

  test("fills a text in, with its name's space", () => {
    expect(
      VMUtil.replaceValueInPlace(
        storage,
        `Urgency: {{${PATH}.customFields.Priority Level}}`,
        false,
      ),
    ).toBe("Urgency: P1");
  });

  test("on its own in JSON it is the value itself, a number staying a number", () => {
    expect(
      VMUtil.replaceValueInPlace(
        storage,
        `{"count": {{${PATH}.customFields.Count}}}`,
        true,
      ),
    ).toBe('{"count": 3}');
  });
});

describe("a condition on a custom field, as a Find step reads it", () => {
  type QueryFunction = (stored: string) => {
    sql: string;
    parameters: JSONObject;
  };

  /*
   * What a step does with a stored Query's column: JSONFunctions.deserialize,
   * then what QueryHelper.queryJson builds.
   */
  const query: QueryFunction = (
    stored: string,
  ): { sql: string; parameters: JSONObject } => {
    const deserialized: JSONObject = JSONFunctions.deserialize(
      JSON.parse(stored),
    );

    const built: JSONColumnQuery = buildJSONColumnQuery({
      value: deserialized[CUSTOM_FIELDS_COLUMN] as JSONObject,
    });

    return {
      sql: built.toSql('"Incident"."customFields"'),
      parameters: built.parameters as JSONObject,
    };
  };

  test("equals reads the key as a bound value, spaces and all", () => {
    const built: { sql: string; parameters: JSONObject } = query(
      '{"customFields":{"Priority Level":"P1"}}',
    );

    expect(Object.values(built.parameters)).toEqual(
      expect.arrayContaining(["Priority Level"]),
    );
    expect(built.sql).not.toContain("Priority Level");
  });

  test.each([
    [
      "a comparison",
      '{"customFields":{"Count":{"_type":"GreaterThan","value":2}}}',
    ],
    [
      "is any of",
      '{"customFields":{"Tags":{"_type":"Includes","value":["a"]}}}',
    ],
    [
      "is none of",
      '{"customFields":{"Tags":{"_type":"IncludesNone","value":["a"]}}}',
    ],
    [
      "contains",
      '{"customFields":{"Customer":{"_type":"Search","value":"Ac"}}}',
    ],
    [
      "is not",
      '{"customFields":{"Customer":{"_type":"NotEqual","value":"Ac"}}}',
    ],
    ["is not set", '{"customFields":{"Customer":{"_type":"IsNull"}}}'],
    ["is set", '{"customFields":{"Customer":{"_type":"NotNull"}}}'],
  ])("%s builds", (_name: string, stored: string) => {
    expect(query(stored).sql.length).toBeGreaterThan(0);
  });
});

describe("which custom fields an update changed", () => {
  test("names the ones whose value is different", () => {
    expect(
      ColumnValueChange.getChangedCustomFieldNames({
        storedValue: { A: 1, B: "x" },
        writtenValue: { A: 2, B: "x" },
      }),
    ).toEqual(["A"]);
  });

  test("a new one, and one taken out, have changed", () => {
    expect(
      ColumnValueChange.getChangedCustomFieldNames({
        storedValue: { Gone: 1 },
        writtenValue: { New: 1 },
      }).sort(),
    ).toEqual(["Gone", "New"]);
  });

  test("one cleared to null has changed; one going from nothing to null has not", () => {
    expect(
      ColumnValueChange.getChangedCustomFieldNames({
        storedValue: { A: 1, B: null },
        writtenValue: { A: null, C: null },
      }),
    ).toEqual(["A"]);
  });

  test("a list by its content, in its order", () => {
    expect(
      ColumnValueChange.getChangedCustomFieldNames({
        storedValue: { Tags: ["a", "b"], Same: ["c"] },
        writtenValue: { Tags: ["b", "a"], Same: ["c"] },
      }),
    ).toEqual(["Tags"]);
  });

  test("a bag written back as it was has changed nothing", () => {
    expect(
      ColumnValueChange.getChangedCustomFieldNames({
        storedValue: { A: 1, B: { c: 1, d: 2 } },
        writtenValue: { B: { d: 2, c: 1 }, A: 1 },
      }),
    ).toEqual([]);
  });

  test("no bag at all is every field empty", () => {
    expect(
      ColumnValueChange.getChangedCustomFieldNames({
        storedValue: { A: 1 },
        writtenValue: null,
      }),
    ).toEqual(["A"]);
    expect(
      ColumnValueChange.getChangedCustomFieldNames({
        storedValue: undefined,
        writtenValue: { A: 1 },
      }),
    ).toEqual(["A"]);
    expect(
      ColumnValueChange.getChangedCustomFieldNames({
        storedValue: null,
        writtenValue: undefined,
      }),
    ).toEqual([]);
  });

  test("a value of 0, false or an empty text is a value", () => {
    expect(
      ColumnValueChange.getChangedCustomFieldNames({
        storedValue: { A: 1, B: true, C: "x" },
        writtenValue: { A: 0, B: false, C: "" },
      }).sort(),
    ).toEqual(["A", "B", "C"]);
  });
});

describe("On Update, watching one custom field", () => {
  const WATCHES_PRIORITY: string = "6ba7b810-9dad-41d1-80b4-00c04fd43201";
  const WATCHES_COUNT: string = "6ba7b810-9dad-41d1-80b4-00c04fd43202";
  const WATCHES_ANY: string = "6ba7b810-9dad-41d1-80b4-00c04fd43203";
  const WATCHES_TITLE: string = "6ba7b810-9dad-41d1-80b4-00c04fd43204";

  type WorkflowWatchingFunction = (
    id: string,
    listenOn: JSONObject | string,
  ) => Workflow;

  const workflowWatching: WorkflowWatchingFunction = (
    id: string,
    listenOn: JSONObject | string,
  ): Workflow => {
    const workflow: Workflow = new Workflow();
    workflow._id = id;
    workflow.id = new ObjectID(id);
    workflow.isEnabled = true;
    workflow.triggerArguments = { "listen-on": listenOn as JSONObject };
    return workflow;
  };

  type RunsForFunction = (
    workflows: Array<Workflow>,
    miscData: JSONObject,
  ) => Promise<Array<string>>;

  const runsFor: RunsForFunction = async (
    workflows: Array<Workflow>,
    miscData: JSONObject,
  ): Promise<Array<string>> => {
    jest.spyOn(WorkflowService, "findBy").mockResolvedValue(workflows);

    const trigger: OnTriggerBaseModel<never> = new OnTriggerBaseModel(
      IncidentService as never,
      "on-update",
    );

    const executed: Array<ExecuteWorkflowType> = [];

    await trigger.initTrigger(
      {
        params: { projectId: ObjectID.generate().toString() },
        body: {
          data: { _id: ObjectID.generate().toString(), miscData: miscData },
        },
      } as never,
      {} as never,
      {
        executeWorkflow: async (run: ExecuteWorkflowType): Promise<void> => {
          executed.push(run);
        },
      } as never,
    );

    return executed.map((run: ExecuteWorkflowType): string => {
      return run.workflowId.toString();
    });
  };

  beforeEach(() => {
    jest.spyOn(Response, "sendJsonObjectResponse").mockImplementation((() => {
      return undefined;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const WORKFLOWS: () => Array<Workflow> = (): Array<Workflow> => {
    return [
      workflowWatching(WATCHES_PRIORITY, {
        [getCustomFieldColumnId("Priority Level")]: true,
      }),
      workflowWatching(WATCHES_COUNT, {
        [getCustomFieldColumnId("Count")]: true,
      }),
      workflowWatching(WATCHES_ANY, { [CUSTOM_FIELDS_COLUMN]: true }),
      workflowWatching(WATCHES_TITLE, { title: true }),
    ];
  };

  test("runs only what watches the one that changed, and any custom field", async () => {
    await expect(
      runsFor(WORKFLOWS(), {
        updatedFields: { customFields: { "Priority Level": "P1", Count: 3 } },
        [UPDATED_CUSTOM_FIELDS_KEY]: ["Priority Level"],
      }),
    ).resolves.toEqual([WATCHES_PRIORITY, WATCHES_ANY]);
  });

  test("runs nothing that watches a custom field when another field changed", async () => {
    await expect(
      runsFor(WORKFLOWS(), { updatedFields: { title: "New" } }),
    ).resolves.toEqual([WATCHES_TITLE]);
  });

  test("an event that does not say which is heard by each: a run more than asked for beats one missed", async () => {
    await expect(
      runsFor(WORKFLOWS(), {
        updatedFields: { customFields: { Count: 3 } },
      }),
    ).resolves.toEqual([WATCHES_PRIORITY, WATCHES_COUNT, WATCHES_ANY]);
  });

  test("a stored list written as JSON text reads the same", async () => {
    await expect(
      runsFor(
        [
          workflowWatching(
            WATCHES_COUNT,
            `{"${getCustomFieldColumnId("Count")}": true}`,
          ),
        ],
        {
          updatedFields: { customFields: { Count: 3 } },
          [UPDATED_CUSTOM_FIELDS_KEY]: ["Count"],
        },
      ),
    ).resolves.toEqual([WATCHES_COUNT]);
  });

  test("a custom field with a dot in its name is watched by its whole name", async () => {
    await expect(
      runsFor(
        [
          workflowWatching(WATCHES_COUNT, {
            [getCustomFieldColumnId("Release 1.2")]: true,
          }),
        ],
        {
          updatedFields: { customFields: { "Release 1.2": "x" } },
          [UPDATED_CUSTOM_FIELDS_KEY]: ["Release 1.2"],
        },
      ),
    ).resolves.toEqual([WATCHES_COUNT]);
  });

  test("watching it says nothing of a change the bag did not have", async () => {
    await expect(
      runsFor(
        [
          workflowWatching(WATCHES_COUNT, {
            [getCustomFieldColumnId("Count")]: true,
          }),
        ],
        {
          updatedFields: { customFields: { Other: 1 } },
          [UPDATED_CUSTOM_FIELDS_KEY]: [],
        },
      ),
    ).resolves.toEqual([]);
  });
});
