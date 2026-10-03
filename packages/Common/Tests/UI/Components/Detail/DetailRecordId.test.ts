import { describe, expect, test } from "@jest/globals";
import {
  getRecordIdText,
  isRecordIdField,
  RECORD_ID_COPIED_FEEDBACK_MS,
  RECORD_ID_KEY,
  RecordIdFieldLike,
  SHORT_RECORD_ID_LENGTH,
  SHORT_RECORD_ID_WIDTH,
} from "../../../../UI/Components/Detail/DetailRecordId";
import FieldType from "../../../../UI/Components/Types/FieldType";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Which field of a details card is the record's own ID - the one Detail takes
 * out of the grid and puts on its small ID line - and how its value is read.
 */

const RECORD_ID: string = "3f2a8b1c-9d4e-4b7a-a1c2-7e5f6d8c9b0a";

const recordIdField: RecordIdFieldLike = {
  key: "_id",
  fieldType: FieldType.ObjectID,
};

describe("isRecordIdField", () => {
  test("an ObjectID field on _id is the record's own ID", () => {
    expect(RECORD_ID_KEY).toBe("_id");
    expect(isRecordIdField(recordIdField)).toBe(true);
  });

  test("the same field marked showIdAsField stays a field", () => {
    expect(isRecordIdField({ ...recordIdField, showIdAsField: true })).toBe(
      false,
    );
    expect(isRecordIdField({ ...recordIdField, showIdAsField: false })).toBe(
      true,
    );
  });

  test("an ObjectID field on another key is a related record's ID, and stays a field", () => {
    for (const key of ["projectId", "monitorId", "id", "_idx", "metaAppId"]) {
      expect(isRecordIdField({ key, fieldType: FieldType.ObjectID })).toBe(
        false,
      );
    }
  });

  test("a nested _id belongs to another record", () => {
    expect(
      isRecordIdField({ key: "monitor._id", fieldType: FieldType.ObjectID }),
    ).toBe(false);
  });

  test("_id of any other field type is left where the page put it", () => {
    for (const fieldType of Object.values(FieldType)) {
      if (fieldType === FieldType.ObjectID) {
        continue;
      }

      expect(isRecordIdField({ key: "_id", fieldType })).toBe(false);
    }

    // No type at all: drawn as text, which the guard test does not allow.
    expect(isRecordIdField({ key: "_id" })).toBe(false);
  });

  test("a field the page draws itself, with getElement, is the page's to draw", () => {
    expect(
      isRecordIdField({
        ...recordIdField,
        getElement: (): null => {
          return null;
        },
      }),
    ).toBe(false);
  });

  test("a field without a key is not an ID", () => {
    expect(isRecordIdField({ key: null, fieldType: FieldType.ObjectID })).toBe(
      false,
    );
    expect(
      isRecordIdField({ key: undefined, fieldType: FieldType.ObjectID }),
    ).toBe(false);
    expect(isRecordIdField({ fieldType: FieldType.ObjectID })).toBe(false);
  });
});

describe("getRecordIdText", () => {
  test("reads the string a loaded model holds", () => {
    expect(getRecordIdText(RECORD_ID)).toBe(RECORD_ID);
  });

  test("trims what it is given", () => {
    expect(getRecordIdText(`  ${RECORD_ID}\n`)).toBe(RECORD_ID);
  });

  test("reads an ObjectID", () => {
    expect(getRecordIdText(new ObjectID(RECORD_ID))).toBe(RECORD_ID);
  });

  test("reads the { _type, value } shape a JSON item carries", () => {
    expect(getRecordIdText({ _type: "ObjectID", value: RECORD_ID })).toBe(
      RECORD_ID,
    );
  });

  test("reads a numeric id", () => {
    expect(getRecordIdText(42)).toBe("42");
  });

  test("is empty, so no line is drawn, for anything that is not an ID", () => {
    for (const value of [
      undefined,
      null,
      "",
      "   ",
      {},
      { value: 7 },
      { value: null },
      [],
      [RECORD_ID],
      true,
      false,
    ]) {
      expect(getRecordIdText(value)).toBe("");
    }
  });
});

describe("the line's constants", () => {
  test("clips the ID to a UUID's first group, exactly", () => {
    expect(RECORD_ID.split("-")[0]).toHaveLength(SHORT_RECORD_ID_LENGTH);
    // In a monospace font 1ch is one character, so the clip falls between two.
    expect(SHORT_RECORD_ID_WIDTH).toBe("8ch");
  });

  test("shows the copied tick for two seconds, as the ID pill did", () => {
    expect(RECORD_ID_COPIED_FEEDBACK_MS).toBe(2000);
  });
});
