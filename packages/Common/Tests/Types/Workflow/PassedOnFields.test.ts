/*
 * Which fields of a record a step passes on (Types/Workflow/PassedOnFields).
 * The value picker, a chip, the workflow's checks and a run all read it here,
 * so they say the same about the same reference.
 */

import { JSONObject } from "../../../Types/JSON";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
  NodeDataProp,
  NodeType,
  ReturnValue,
} from "../../../Types/Workflow/Component";
import IconProp from "../../../Types/Icon/IconProp";
import {
  getFieldPathInRecord,
  getFieldPathSegments,
  isFieldPassedOn,
  namesNoFieldsUnder,
  readsFieldNotPassedOn,
  selectedColumnIds,
} from "../../../Types/Workflow/PassedOnFields";
import { selectedColumnIds as selectedColumnIdsOfThePicker } from "../../../UI/Components/Workflow/ValuePicker/StepValueSource";
import { describe, expect, test } from "@jest/globals";

type StepFunction = (
  select: JSONObject | string | undefined,
  metadataId?: string,
) => NodeDataProp;

const stepWith: StepFunction = (
  select: JSONObject | string | undefined,
  metadataId: string = "alert-on-create",
): NodeDataProp => {
  const metadata: ComponentMetadata = {
    id: metadataId,
    title: "On Create Alert",
    category: "Alert",
    description: "",
    iconProp: IconProp.Bolt,
    componentType: ComponentType.Trigger,
    arguments: [
      {
        id: "select",
        name: "Fields to pass on",
        description: "",
        type: ComponentInputType.Select,
        required: true,
      },
    ],
    returnValues: [],
    inPorts: [],
    outPorts: [],
    tableName: "Alert",
  };

  return {
    error: "",
    id: "alert-on-create-1",
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadataId,
    internalId: "internal",
    arguments: select === undefined ? {} : { select: select },
    returnValues: {},
    componentType: ComponentType.Trigger,
  };
};

const RECORD: ReturnValue = {
  id: "model",
  name: "Alert",
  description: "",
  type: ComponentInputType.BaseModel,
  required: false,
};

const RECORDS: ReturnValue = {
  id: "models",
  name: "Alerts",
  description: "",
  type: ComponentInputType.BaseModelArray,
  required: false,
};

const BODY: ReturnValue = {
  id: "response-body",
  name: "Response Body",
  description: "",
  type: ComponentInputType.JSON,
  required: false,
};

const SELECT: JSONObject = {
  title: true,
  description: false,
  customFields: true,
  monitor: { name: true },
  alertSeverity: true,
};

describe("selectedColumnIds", () => {
  test("is the one the value picker has always offered", () => {
    expect(selectedColumnIdsOfThePicker).toBe(selectedColumnIds);
  });

  test("names the fields set to true, and a related record's by its own", () => {
    expect(selectedColumnIds(stepWith(SELECT))).toEqual([
      "_id",
      "title",
      "customFields",
      "monitor",
      "monitor.name",
      "alertSeverity",
    ]);
  });

  test("reads Fields to pass on stored as text", () => {
    expect(selectedColumnIds(stepWith('{"title": true}'))).toEqual([
      "_id",
      "title",
    ]);
  });

  test("an On Delete trigger passes on the ID alone", () => {
    expect(selectedColumnIds(stepWith(SELECT, "alert-on-delete"))).toEqual([
      "_id",
    ]);
  });

  test.each([
    ["nothing stored", undefined],
    ["blank text", "   "],
    ["text that is not JSON", "{title"],
    ["a list", "[1]"],
    ["nothing set to true", { title: false }],
  ])("%s says nothing can be told", (_name: string, select: unknown) => {
    expect(selectedColumnIds(stepWith(select as JSONObject))).toBeNull();
  });
});

describe("isFieldPassedOn", () => {
  test.each([
    ["the field it names", "title", true],
    ["the record's ID", "_id", true],
    ["a field set to false", "description", false],
    ["a field it does not name", "currentAlertState", false],
    [
      "a field of a related record it does not name",
      "currentAlertState.name",
      false,
    ],
    ["the related record's field it names", "monitor.name", true],
    ["the related record itself", "monitor", true],
    ["another field of the related record", "monitor.description", false],
    // On a real read the related record's ID comes with it, whatever is named.
    ["the related record's ID", "monitor._id", true],
    /*
     * A key set to true says nothing of what is inside it: a JSON field holds
     * its keys, and a related record its ID alone (SelectUtil.sanitizeSelect).
     * Only a model can tell the two apart, which a run has (EmptyValues).
     */
    ["a key under a related record set to true", "alertSeverity.name", true],
    ["a key inside a JSON field", "customFields.Impact", true],
    ["an index on a field it names", "monitor[0]", true],
  ])("%s", (_name: string, path: string, expected: boolean) => {
    expect(isFieldPassedOn(stepWith(SELECT), path)).toBe(expected);
  });

  test("nothing can be said when Fields to pass on cannot be read", () => {
    expect(isFieldPassedOn(stepWith("{broken"), "anything")).toBe(true);
  });

  test("nothing can be said of a path that names no field", () => {
    expect(isFieldPassedOn(stepWith(SELECT), "[0]")).toBe(true);
    expect(isFieldPassedOn(stepWith(SELECT), "")).toBe(true);
  });

  test("an On Delete trigger passes on nothing but the ID", () => {
    const step: NodeDataProp = stepWith(SELECT, "alert-on-delete");

    expect(isFieldPassedOn(step, "_id")).toBe(true);
    expect(isFieldPassedOn(step, "title")).toBe(false);
  });
});

describe("namesNoFieldsUnder", () => {
  test.each([
    ["a related record set to true", "alertSeverity", true],
    ["a JSON field set to true", "customFields", true],
    ["a related record with a field named", "monitor", false],
    ["a field it does not name", "currentAlertState", false],
    ["a field set to false", "description", false],
  ])("%s", (_name: string, field: string, expected: boolean) => {
    expect(namesNoFieldsUnder(stepWith(SELECT), field)).toBe(expected);
  });

  test("says no when Fields to pass on cannot be read", () => {
    expect(namesNoFieldsUnder(stepWith("{broken"), "monitor")).toBe(false);
    expect(namesNoFieldsUnder(stepWith(undefined), "monitor")).toBe(false);
  });
});

describe("getFieldPathSegments", () => {
  test("names each field of a path", () => {
    expect(getFieldPathSegments("monitor.name")).toEqual(["monitor", "name"]);
    expect(getFieldPathSegments("items[0].name")).toEqual(["items", "name"]);
    expect(getFieldPathSegments("a-b_c.d1")).toEqual(["a-b_c", "d1"]);
  });

  test("an index with no name is no field", () => {
    expect(getFieldPathSegments("[0].name")).toEqual(["", "name"]);
  });

  /*
   * It is read with a loop: a quantifier is not safe on a long one
   * (Docs/notifications/README.md, "Megabyte-long values").
   */
  test("reads a name megabytes long", () => {
    const name: string = "x".repeat(4 * 1024 * 1024);

    expect(getFieldPathSegments(`${name}.y`)).toEqual([name, "y"]);
  });
});

describe("getFieldPathInRecord", () => {
  test("past a record, what follows it", () => {
    expect(getFieldPathInRecord(RECORD, "monitor.name")).toBe("monitor.name");
    expect(getFieldPathInRecord(RECORD, "title")).toBe("title");
  });

  test("past a list of records, what follows the item", () => {
    expect(getFieldPathInRecord(RECORDS, "[0].monitor.name")).toBe(
      "monitor.name",
    );
    expect(getFieldPathInRecord(RECORDS, "[last].title")).toBe("title");
  });

  test.each([
    ["the whole record", RECORD, ""],
    ["a whole item of a list", RECORDS, "[0]"],
    ["what a list says of itself", RECORDS, "length"],
    ["nothing past a list", RECORDS, ""],
    ["a value that is no record", BODY, "owner.name"],
    ["a value the step does not return", undefined, "owner.name"],
  ])(
    "%s reads no field",
    (_name: string, returnValue: ReturnValue | undefined, path: string) => {
      expect(getFieldPathInRecord(returnValue, path)).toBeNull();
    },
  );
});

describe("readsFieldNotPassedOn", () => {
  const reads: (returnValue: ReturnValue, path: string) => boolean = (
    returnValue: ReturnValue,
    path: string,
  ): boolean => {
    return readsFieldNotPassedOn({
      step: stepWith(SELECT),
      returnValue: returnValue,
      pathPastValue: path,
    });
  };

  test("a record's field the step leaves out", () => {
    expect(reads(RECORD, "currentAlertState.name")).toBe(true);
    expect(reads(RECORD, "monitor.description")).toBe(true);
  });

  test("a field of an item of a list of records the step leaves out", () => {
    expect(reads(RECORDS, "[0].currentAlertState.name")).toBe(true);
    expect(reads(RECORDS, "[last].monitor.description")).toBe(true);
  });

  test("what the step passes on", () => {
    expect(reads(RECORD, "monitor.name")).toBe(false);
    expect(reads(RECORDS, "[0].monitor.name")).toBe(false);
    expect(reads(RECORD, "_id")).toBe(false);
  });

  test("whatever is not a field of a record", () => {
    expect(reads(RECORD, "")).toBe(false);
    expect(reads(RECORDS, "length")).toBe(false);
    expect(reads(BODY, "currentAlertState.name")).toBe(false);
  });
});
