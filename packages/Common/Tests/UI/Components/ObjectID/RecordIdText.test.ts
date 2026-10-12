import { describe, expect, test } from "@jest/globals";
import {
  getRecordIdText,
  hasRecordId,
} from "../../../../UI/Components/ObjectID/RecordIdText";
import { getRecordIdText as getRecordIdTextFromDetail } from "../../../../UI/Components/Detail/DetailRecordId";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "../../../../Models/AnalyticsModels/ExceptionInstance";
import Profile from "../../../../Models/AnalyticsModels/Profile";
import Span from "../../../../Models/AnalyticsModels/Span";
import Email from "../../../../Types/Email";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * A record's ID as text, from whatever shape the row holds it in.
 *
 * Issue #4615: "Show ID" on AI / LLM > Overview threw minified React error
 * #31. The LLM calls table is an AnalyticsModelTable, and an analytics row's
 * `_id` is an ObjectID - the shared table cast it to a string and handed the
 * object to React. These tests pin the reader every ID display now goes
 * through, with every shape an ID really arrives in, including the rows the
 * API really returns.
 */

const RECORD_ID: string = "0199c9b2-4f7e-7a10-9f1e-1234567890ab";

describe("getRecordIdText", () => {
  test("reads the string a database model holds", () => {
    expect(getRecordIdText(RECORD_ID)).toBe(RECORD_ID);
  });

  test("reads an ObjectID, the shape an analytics row holds", () => {
    expect(getRecordIdText(new ObjectID(RECORD_ID))).toBe(RECORD_ID);
  });

  test("reads the { _type, value } JSON an API response carries", () => {
    expect(getRecordIdText({ _type: "ObjectID", value: RECORD_ID })).toBe(
      RECORD_ID,
    );
  });

  test("reads an object with a text value, as an ObjectID from another copy of the module is", () => {
    /*
     * A second bundle's ObjectID class fails `instanceof`, but it still has
     * the `value` getter. Its own toString() is never relied on.
     */
    const lookalike: { value: string; toString: () => string } = {
      value: RECORD_ID,
      toString: (): string => {
        return "[object Object]";
      },
    };

    expect(getRecordIdText(lookalike)).toBe(RECORD_ID);
  });

  test("reads any other database property by its text", () => {
    expect(getRecordIdText(new Email("someone@example.com"))).toBe(
      "someone@example.com",
    );
  });

  test("trims what it is given, in every shape", () => {
    expect(getRecordIdText(`  ${RECORD_ID}\n`)).toBe(RECORD_ID);
    expect(getRecordIdText(new ObjectID(` ${RECORD_ID} `))).toBe(RECORD_ID);
    expect(
      getRecordIdText({ _type: "ObjectID", value: `\t${RECORD_ID}` }),
    ).toBe(RECORD_ID);
  });

  test("reads a numeric id", () => {
    expect(getRecordIdText(42)).toBe("42");
    expect(getRecordIdText(0)).toBe("0");
  });

  test("is empty for a number that is not one", () => {
    expect(getRecordIdText(Number.NaN)).toBe("");
    expect(getRecordIdText(Number.POSITIVE_INFINITY)).toBe("");
  });

  test("is empty for anything that holds no ID", () => {
    for (const value of [
      undefined,
      null,
      "",
      "   ",
      {},
      { value: 7 },
      { value: null },
      { _type: "ObjectID" },
      { _type: "ObjectID", value: "" },
      [],
      [RECORD_ID],
      [{ _type: "ObjectID", value: RECORD_ID }],
      true,
      false,
      Symbol("id"),
      (): string => {
        return RECORD_ID;
      },
    ]) {
      expect(getRecordIdText(value)).toBe("");
    }
  });

  test("is empty for an ObjectID made from nothing", () => {
    /*
     * CommonModel.setColumnValue turns a null `_id` into `new ObjectID(null)`
     * (typeof null is "object"), an ObjectID whose text is "".
     */
    expect(getRecordIdText(new ObjectID(null as unknown as string))).toBe("");
    expect(getRecordIdText(new ObjectID(""))).toBe("");
  });

  test("always answers with a string, never the object it was given", () => {
    for (const value of [
      RECORD_ID,
      new ObjectID(RECORD_ID),
      { _type: "ObjectID", value: RECORD_ID },
      null,
      { nested: { value: RECORD_ID } },
    ]) {
      expect(typeof getRecordIdText(value)).toBe("string");
    }
  });

  test("is the reader the details card's ID line uses", () => {
    expect(getRecordIdTextFromDetail).toBe(getRecordIdText);
  });
});

describe("hasRecordId", () => {
  test("is true for every shape that holds an ID", () => {
    expect(hasRecordId(RECORD_ID)).toBe(true);
    expect(hasRecordId(new ObjectID(RECORD_ID))).toBe(true);
    expect(hasRecordId({ _type: "ObjectID", value: RECORD_ID })).toBe(true);
  });

  test("is false for the rows Show ID is not offered on", () => {
    for (const value of [undefined, null, "", "  ", {}, new ObjectID("")]) {
      expect(hasRecordId(value)).toBe(false);
    }
  });
});

describe("the rows the API returns for the tables that show an ID", () => {
  type AnalyticsModelType = { new (): AnalyticsBaseModel };

  /*
   * What AnalyticsModelAPI.getList does with the response: every row goes
   * through AnalyticsBaseModel.fromJSONArray, which makes each ObjectID
   * column - `_id` among them - an ObjectID.
   */
  const MODELS: Array<{ name: string; modelType: AnalyticsModelType }> = [
    // AI / LLM > Overview and Calls; every Traces list.
    { name: "Span", modelType: Span },
    // Profiles lists.
    { name: "Profile", modelType: Profile },
    // Exception occurrences.
    { name: "ExceptionInstance", modelType: ExceptionInstance },
  ];

  for (const { name, modelType } of MODELS) {
    test(`${name}: a row's _id is an ObjectID, and reads as its text`, () => {
      const json: JSONObject = {
        _id: { _type: "ObjectID", value: RECORD_ID },
      };

      const [row] = AnalyticsBaseModel.fromJSONArray<AnalyticsBaseModel>(
        [json],
        modelType,
      );

      // The shape that crashed: not a string, so React cannot render it.
      expect(typeof row!._id).toBe("object");
      expect(row!._id).toBeInstanceOf(ObjectID);

      expect(getRecordIdText(row!._id)).toBe(RECORD_ID);
      expect(hasRecordId(row!._id)).toBe(true);
    });

    test(`${name}: a row whose _id came back null holds no ID`, () => {
      const [row] = AnalyticsBaseModel.fromJSONArray<AnalyticsBaseModel>(
        [{ _id: null }],
        modelType,
      );

      expect(getRecordIdText(row!._id)).toBe("");
      expect(hasRecordId(row!._id)).toBe(false);
    });
  }
});
