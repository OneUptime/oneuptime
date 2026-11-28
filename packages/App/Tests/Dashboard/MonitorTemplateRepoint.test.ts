import { beforeEach, describe, expect, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";

/*
 * What a network alert policy's and an auto import rule's forms read before
 * the record is pointed at another template (issues #11452, #11451): the
 * template the record is on, as the Edit form opened it, the template the
 * form now holds - however a form or a fetch spells a relation - and that
 * template's name and type for the question the form asks. A save that
 * keeps the template asks nothing; one that points it elsewhere asks once.
 */

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(),
    },
  };
});

import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  isPointedAtAnotherTemplate,
  readRelationId,
  readTemplateIdOfRecord,
  readTemplateName,
  readTemplateNameAndType,
} from "../../FeatureSet/Dashboard/src/Components/Monitor/TemplateChange/TemplateRepoint";

const getItemMock: jest.Mock = ModelAPI.getItem as unknown as jest.Mock;

const OLD_TEMPLATE_ID: string = "50000000-0000-4000-8000-000000000001";
const NEW_TEMPLATE_ID: string = "50000000-0000-4000-8000-000000000002";

beforeEach(() => {
  getItemMock.mockReset();
});

describe("a relation's id, however it is spelled", () => {
  test("an id, an ObjectID, or the related record", () => {
    expect(readRelationId(OLD_TEMPLATE_ID)).toBe(OLD_TEMPLATE_ID);
    expect(readRelationId(`  ${OLD_TEMPLATE_ID}  `)).toBe(OLD_TEMPLATE_ID);
    expect(readRelationId(new ObjectID(OLD_TEMPLATE_ID))).toBe(OLD_TEMPLATE_ID);
    expect(readRelationId({ _id: OLD_TEMPLATE_ID })).toBe(OLD_TEMPLATE_ID);
    expect(readRelationId({ id: new ObjectID(OLD_TEMPLATE_ID) })).toBe(
      OLD_TEMPLATE_ID,
    );
    // A dropdown's value nested in a record the form built.
    expect(readRelationId({ _id: { _id: OLD_TEMPLATE_ID } })).toBe(
      OLD_TEMPLATE_ID,
    );
  });

  test("none, when there is none to read", () => {
    for (const value of [
      undefined,
      null,
      "",
      "   ",
      0,
      42,
      {},
      { name: "Switches" },
      [],
    ]) {
      expect({ value, id: readRelationId(value) }).toEqual({
        value,
        id: null,
      });
    }
  });

  test("a record that names itself as its id is not read forever", () => {
    const record: Record<string, unknown> = {};
    record["_id"] = record;

    expect(readRelationId(record)).toBeNull();
  });
});

describe("the template a policy or a rule names", () => {
  test("its relation first - what the form's dropdown holds - then its id column", () => {
    expect(
      readTemplateIdOfRecord({
        monitorTemplate: { _id: NEW_TEMPLATE_ID },
        monitorTemplateId: new ObjectID(OLD_TEMPLATE_ID),
      }),
    ).toBe(NEW_TEMPLATE_ID);
    expect(
      readTemplateIdOfRecord({
        monitorTemplateId: new ObjectID(OLD_TEMPLATE_ID),
      }),
    ).toBe(OLD_TEMPLATE_ID);
    expect(readTemplateIdOfRecord({ monitorTemplateId: OLD_TEMPLATE_ID })).toBe(
      OLD_TEMPLATE_ID,
    );
    expect(readTemplateIdOfRecord({})).toBeNull();
  });
});

describe("whether a save points the record at another template", () => {
  test("another template: yes", () => {
    expect(
      isPointedAtAnotherTemplate({
        storedTemplateId: OLD_TEMPLATE_ID,
        writtenTemplateId: NEW_TEMPLATE_ID,
      }),
    ).toBe(true);
  });

  test("the same template, however its id is cased: no", () => {
    expect(
      isPointedAtAnotherTemplate({
        storedTemplateId: OLD_TEMPLATE_ID,
        writtenTemplateId: OLD_TEMPLATE_ID.toUpperCase(),
      }),
    ).toBe(false);
  });

  test("a record the Edit form did not open, or a template left empty: no question", () => {
    for (const ids of [
      { storedTemplateId: undefined, writtenTemplateId: NEW_TEMPLATE_ID },
      { storedTemplateId: "", writtenTemplateId: NEW_TEMPLATE_ID },
      { storedTemplateId: OLD_TEMPLATE_ID, writtenTemplateId: null },
      { storedTemplateId: OLD_TEMPLATE_ID, writtenTemplateId: "" },
      { storedTemplateId: null, writtenTemplateId: undefined },
    ]) {
      expect({ ids, asks: isPointedAtAnotherTemplate(ids) }).toEqual({
        ids,
        asks: false,
      });
    }
  });
});

describe("the template's name and type, for the question", () => {
  test("read by its id, with only what the question needs", async () => {
    getItemMock.mockResolvedValue({
      templateName: "Switches (new)",
      monitorType: "SNMP",
    });

    expect(await readTemplateNameAndType(NEW_TEMPLATE_ID)).toEqual({
      name: "Switches (new)",
      monitorType: "SNMP",
    });
    expect(await readTemplateName(NEW_TEMPLATE_ID)).toBe("Switches (new)");

    const call: {
      id: ObjectID;
      select: Record<string, boolean>;
    } = getItemMock.mock.calls[0]![0] as {
      id: ObjectID;
      select: Record<string, boolean>;
    };

    expect(call.id.toString()).toBe(NEW_TEMPLATE_ID);
    expect(call.select).toEqual({
      _id: true,
      templateName: true,
      monitorType: true,
    });
  });

  test("a template that cannot be read leaves the name to the question's own words", async () => {
    getItemMock.mockResolvedValue(null);

    expect(await readTemplateName(NEW_TEMPLATE_ID)).toBe("");
    expect(await readTemplateNameAndType(NEW_TEMPLATE_ID)).toEqual({
      name: "",
      monitorType: undefined,
    });

    getItemMock.mockRejectedValue(new Error("Permission denied"));

    expect(await readTemplateName(NEW_TEMPLATE_ID)).toBe("");
    expect(await readTemplateNameAndType(NEW_TEMPLATE_ID)).toEqual({
      name: "",
      monitorType: undefined,
    });
  });
});
