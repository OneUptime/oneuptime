import UnreadableAnswerException from "../Exception/UnreadableAnswerException";
import { JSONArray, JSONObject, JSONObjectOrArray } from "../JSON";

/*
 * A SUCCESSFUL ANSWER, READ INTO WHAT THE CALLER ASKED FOR (#8413).
 *
 * ModelAPI and AnalyticsModelAPI turn an answer into a list's rows, a
 * count or a record. An answer of a shape they did not expect - a proxy's
 * or a captive portal's page answering 200, an object where rows should
 * be - made them throw a developer's words ("json is not iterable"), or
 * pass on nothing at all: a count of undefined, a record with no fields.
 * Each read goes through here instead, and anything that does not read is
 * an UnreadableAnswerException, which the browser says as a failure nobody
 * explained, never in the words thrown (BaseAPI.getFriendlyMessage).
 */

// What an answer is to its reader: an HTTPResponse, whatever it holds.
export interface ReadableAnswer {
  statusCode: number;
  data: unknown;
  jsonData: JSONObjectOrArray;
  isText: boolean;
}

export default class AnswerReader {
  /*
   * What `read` makes of the answer. Whatever it throws - a model whose
   * value would not read, a row that is not one - is an
   * UnreadableAnswerException that keeps what was thrown.
   */
  public static read<T>(answer: ReadableAnswer, read: () => T): T {
    try {
      return read();
    } catch (readError) {
      throw UnreadableAnswerException.fromReadError(
        readError,
        AnswerReader.describe(answer),
      );
    }
  }

  // A list read's rows: the answer's list, never anything else.
  public static getRows(answer: ReadableAnswer): JSONArray {
    const rows: unknown = answer.data;

    if (answer.isText || !Array.isArray(rows)) {
      throw new UnreadableAnswerException(
        "The answer to a list's read held no list of rows.",
        AnswerReader.describe(answer),
      );
    }

    return rows as JSONArray;
  }

  // A count read's count: a number, never undefined.
  public static getCount(answer: ReadableAnswer): number {
    const data: unknown = answer.data;
    const count: unknown =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as JSONObject)["count"]
        : undefined;

    if (
      answer.isText ||
      typeof count !== "number" ||
      !Number.isFinite(count) ||
      count < 0
    ) {
      throw new UnreadableAnswerException(
        "The answer to a count's read held no count.",
        AnswerReader.describe(answer),
      );
    }

    return count;
  }

  /*
   * A record read's record: an object, never a page of text (which
   * HTTPResponse keeps under `data`, and which read as a record with no
   * fields) and never a list.
   */
  public static getRecord(answer: ReadableAnswer): JSONObject {
    const record: unknown = answer.data;

    if (
      answer.isText ||
      !record ||
      typeof record !== "object" ||
      Array.isArray(record)
    ) {
      throw new UnreadableAnswerException(
        "The answer to a record's read held no record.",
        AnswerReader.describe(answer),
      );
    }

    return record as JSONObject;
  }

  // The answer as UnreadableAnswerException keeps it: its status and body.
  private static describe(answer: ReadableAnswer): {
    statusCode: number;
    body: JSONObjectOrArray;
  } {
    return { statusCode: answer.statusCode, body: answer.jsonData };
  }
}
