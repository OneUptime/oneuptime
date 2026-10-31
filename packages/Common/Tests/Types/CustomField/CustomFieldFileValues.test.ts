import { CustomFieldDefinition } from "../../../Types/CustomField/CustomFieldDefinition";
import { CustomFieldFile } from "../../../Types/CustomField/CustomFieldFile";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { customFieldValueToText } from "../../../Types/CustomField/CustomFieldValueFormat";
import {
  isCustomFieldValueEmpty,
  mergeMappedCustomFieldValues,
  ResolvedCustomFieldValue,
  resolveMappedCustomFieldValue,
} from "../../../Types/CustomField/CustomFieldValueMapping";
import {
  CustomFieldValueValidationError,
  keepValidCustomFieldValues,
  validateCustomFieldValues,
} from "../../../Types/CustomField/CustomFieldValueValidator";
import MimeType from "../../../Types/File/MimeType";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * File and Multiple files values through the pure custom field rules every
 * other type goes through: the API's value check (shape only: the server
 * checks the files themselves, CustomFieldFiles), what "unchanged" means
 * when the dashboard sends the bag back, how a file reads as words, and how
 * a monitor's files are copied onto its incidents.
 */

const ID_A: string = "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e";
const ID_B: string = "a3f2b1c0-d9e8-4f5a-8b7c-6d5e4f3a2b1c";
const ID_C: string = "b5c4d3e2-f1a0-4b5c-9d8e-7f6a5b4c3d2e";

const file: (id: string, name: string) => CustomFieldFile = (
  id: string,
  name: string,
): CustomFieldFile => {
  return { fileId: id, name: name, fileType: MimeType.pdf, size: 1000 };
};

const FILE_A: CustomFieldFile = file(ID_A, "a.pdf");
const FILE_B: CustomFieldFile = file(ID_B, "b.pdf");
const FILE_C: CustomFieldFile = file(ID_C, "c.pdf");

const DEFINITIONS: Array<CustomFieldDefinition> = [
  { name: "Contract", customFieldType: CustomFieldType.File },
  { name: "Screenshots", customFieldType: CustomFieldType.MultipleFiles },
  { name: "Summary", customFieldType: CustomFieldType.Text },
];

type ValidateFunction = (
  customFields: JSONObject,
  stored?: JSONObject,
) => Array<string>;

const validate: ValidateFunction = (
  customFields: JSONObject,
  stored?: JSONObject,
): Array<string> => {
  return validateCustomFieldValues({
    definitions: DEFINITIONS,
    customFields: customFields,
    storedCustomFields: stored || {},
  }).map((error: CustomFieldValueValidationError): string => {
    return error.message;
  });
};

describe("a File field's value", () => {
  test("is one file: its id, { fileId }, or an uploaded File's { _id } or { id }", () => {
    expect(validate({ Contract: ID_A })).toEqual([]);
    expect(validate({ Contract: { fileId: ID_A } })).toEqual([]);
    expect(validate({ Contract: { _id: ID_A, name: "a.pdf" } })).toEqual([]);
    expect(validate({ Contract: { id: ID_A } })).toEqual([]);
    expect(validate({ Contract: FILE_A as unknown as JSONObject })).toEqual([]);
  });

  test("a list is refused, even a list of one", () => {
    expect(validate({ Contract: [ID_A] })).toEqual([
      '"Contract" holds one file, not a list: send the file\'s id, or { "fileId": "<id>" }.',
    ]);
  });

  test("anything that names no file is refused, quoting what was sent", () => {
    expect(validate({ Contract: "contract.pdf" })).toEqual([
      '"Contract" holds a file, but was sent "contract.pdf". Send the file\'s id, or { "fileId": "<id>" }.',
    ]);
    expect(validate({ Contract: 42 })).toHaveLength(1);
    expect(validate({ Contract: { name: "a.pdf" } })).toHaveLength(1);
    expect(validate({ Contract: true })).toHaveLength(1);
  });

  test("clearing it is always allowed", () => {
    expect(validate({ Contract: null })).toEqual([]);
    expect(validate({ Contract: "" })).toEqual([]);
  });
});

describe("a Multiple files field's value", () => {
  test("is a list of files, in any of the shapes, or one on its own", () => {
    expect(
      validate({ Screenshots: [ID_A, { fileId: ID_B }, { _id: ID_C }] }),
    ).toEqual([]);
    expect(validate({ Screenshots: ID_A })).toEqual([]);
    expect(validate({ Screenshots: { fileId: ID_A } })).toEqual([]);
  });

  test("an entry that names no file is refused", () => {
    expect(validate({ Screenshots: [ID_A, "b.png"] })).toEqual([
      '"Screenshots" holds a list of files, but was sent "["5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e","b.png"]". Send a list of file ids, or of { "fileId": "<id>" }.',
    ]);
  });

  test("the same file twice is refused", () => {
    expect(
      validate({ Screenshots: [ID_A, { fileId: ID_A.toUpperCase() }] }),
    ).toEqual(['"Screenshots" lists the same file more than once.']);
  });

  test("more than 10 files is refused, counting them", () => {
    const ids: Array<string> = [];

    for (let index: number = 0; index < 11; index++) {
      ids.push(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
    }

    expect(validate({ Screenshots: ids })).toEqual([
      '"Screenshots" holds at most 10 files, but was sent 11.',
    ]);
    expect(validate({ Screenshots: ids.slice(0, 10) })).toEqual([]);
  });

  test("an empty list clears it", () => {
    expect(validate({ Screenshots: [] })).toEqual([]);
  });
});

describe("a value sent back as it was is not checked again", () => {
  test("a file the record holds, sent back as the dashboard holds it", () => {
    /*
     * The record holds { fileId, name, fileType, size }; the dashboard's
     * file picker hands back { _id, name, fileType }. The same file.
     */
    expect(
      validateCustomFieldValues({
        definitions: [
          { name: "Contract", customFieldType: CustomFieldType.Number },
        ],
        customFields: { Contract: { _id: ID_A, name: "a.pdf" } },
        storedCustomFields: { Contract: FILE_A as unknown as JSONObject },
      }),
    ).toEqual([]);
  });

  test("files the record holds, in another order, in another shape", () => {
    expect(
      validateCustomFieldValues({
        definitions: [
          { name: "Screenshots", customFieldType: CustomFieldType.Text },
        ],
        customFields: { Screenshots: [{ _id: ID_B }, { _id: ID_A }] },
        storedCustomFields: {
          Screenshots: [FILE_A, FILE_B] as unknown as JSONObject[],
        },
      }),
    ).toEqual([]);
  });

  test("a different list of as many files is a change, and is checked", () => {
    /*
     * Lists used to be compared entry by entry as text, and every object
     * reads as "[object Object]": any two lists of files of one length
     * looked the same, so a changed list was never checked.
     */
    expect(
      validateCustomFieldValues({
        definitions: [
          { name: "Screenshots", customFieldType: CustomFieldType.Text },
        ],
        customFields: { Screenshots: [{ fileId: ID_C }] },
        storedCustomFields: {
          Screenshots: [FILE_A] as unknown as JSONObject[],
        },
      }),
    ).toHaveLength(1);
  });

  test("a different file in a File field is a change, and is checked", () => {
    expect(
      validateCustomFieldValues({
        definitions: [
          { name: "Contract", customFieldType: CustomFieldType.Number },
        ],
        customFields: { Contract: { fileId: ID_B } },
        storedCustomFields: { Contract: FILE_A as unknown as JSONObject },
      }),
    ).toHaveLength(1);
  });
});

describe("keepValidCustomFieldValues", () => {
  test("keeps a template's files and leaves out a value that names none", () => {
    expect(
      keepValidCustomFieldValues({
        definitions: DEFINITIONS,
        customFields: {
          Contract: FILE_A as unknown as JSONObject,
          Screenshots: "not files",
          Summary: "ok",
        },
      }),
    ).toEqual({ Contract: FILE_A, Summary: "ok" });
  });
});

describe("a file reads as its name", () => {
  test("one file, a list of them, never the id or JSON", () => {
    expect(customFieldValueToText(FILE_A)).toBe("a.pdf");
    expect(customFieldValueToText([FILE_A, FILE_B])).toBe("a.pdf, b.pdf");
  });

  test("a file with a blank name reads as its id", () => {
    expect(customFieldValueToText({ ...FILE_A, name: "  " })).toBe(ID_A);
  });

  test("another object still reads as JSON", () => {
    expect(customFieldValueToText({ fileId: ID_A })).toBe(
      JSON.stringify({ fileId: ID_A }),
    );
    expect(customFieldValueToText({ a: 1 })).toBe('{"a":1}');
  });

  test("a value with no file in it is empty", () => {
    expect(isCustomFieldValueEmpty([])).toBe(true);
    expect(isCustomFieldValueEmpty([FILE_A])).toBe(false);
    expect(isCustomFieldValueEmpty(FILE_A)).toBe(false);
  });
});

describe("a monitor's files copied onto its incidents", () => {
  test("monitors that agree give that file", () => {
    const resolved: ResolvedCustomFieldValue = resolveMappedCustomFieldValue({
      sourceValues: [FILE_A, { ...FILE_A }],
      targetFieldType: CustomFieldType.File,
    });

    expect(resolved).toEqual({ hasValue: true, value: FILE_A });
  });

  test("monitors with different files give a File field nothing", () => {
    expect(
      resolveMappedCustomFieldValue({
        sourceValues: [FILE_A, FILE_B],
        targetFieldType: CustomFieldType.File,
      }),
    ).toEqual({ hasValue: false });
  });

  test("lists of different files are different, however many each holds", () => {
    /*
     * Each list used to read as ["[object Object]"], so two monitors with
     * one different file each "agreed", and the first one's file won.
     */
    expect(
      resolveMappedCustomFieldValue({
        sourceValues: [[FILE_A], [FILE_B]],
        targetFieldType: CustomFieldType.File,
      }),
    ).toEqual({ hasValue: false });
  });

  test("a Multiple files field gets every file, each once, by name", () => {
    expect(
      resolveMappedCustomFieldValue({
        sourceValues: [[FILE_C, FILE_A], [FILE_B], [FILE_A]],
        targetFieldType: CustomFieldType.MultipleFiles,
      }),
    ).toEqual({ hasValue: true, value: [FILE_A, FILE_B, FILE_C] });
  });

  test("and never more than the field holds", () => {
    const sources: Array<Array<CustomFieldFile>> = [];

    for (let index: number = 0; index < 12; index++) {
      sources.push([
        file(
          `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          `file-${String(index).padStart(2, "0")}.pdf`,
        ),
      ]);
    }

    const resolved: ResolvedCustomFieldValue = resolveMappedCustomFieldValue({
      sourceValues: sources,
      targetFieldType: CustomFieldType.MultipleFiles,
    });

    expect(resolved.hasValue).toBe(true);
    expect((resolved.value as Array<CustomFieldFile>).length).toBe(10);
    expect((resolved.value as Array<CustomFieldFile>)[0]!.name).toBe(
      "file-00.pdf",
    );
  });

  test("the copy is skipped when the incident holds those files already, in any order", () => {
    expect(
      mergeMappedCustomFieldValues({
        existingCustomFields: {
          Screenshots: [FILE_B, FILE_A] as unknown as JSONObject[],
        },
        resolvedValues: {
          Screenshots: [FILE_A, FILE_B] as unknown as JSONObject[],
        },
      }).hasChanged,
    ).toBe(false);
  });

  test("and written when it holds others", () => {
    expect(
      mergeMappedCustomFieldValues({
        existingCustomFields: {
          Screenshots: [FILE_C] as unknown as JSONObject[],
        },
        resolvedValues: {
          Screenshots: [FILE_A] as unknown as JSONObject[],
        },
      }).hasChanged,
    ).toBe(true);
  });
});
