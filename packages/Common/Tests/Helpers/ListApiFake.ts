import { jest } from "@jest/globals";
import HTTPResponse from "../../Types/API/HTTPResponse";
import { JSONObject } from "../../Types/JSON";
import API from "../../UI/Utils/API/API";

/*
 * The HTTP layer under AnalyticsModelAPI and ModelAPI, answered the way the
 * server answers a list request: `{ data, count, skip, limit }`, each row
 * serialized by JSONFunctions - so an ObjectID column, `_id` among them,
 * arrives as `{ _type: "ObjectID", value }`.
 *
 * Faking here, and not one level up at AnalyticsModelAPI.getList, keeps the
 * real deserialization in the test: HTTPResponse turns the JSON back into
 * ObjectIDs and AnalyticsBaseModel.fromJSONArray builds the rows, exactly as
 * in the browser. That is the shape the LLM calls table of issue #4615 was
 * handed, so a table under test sees what a real one sees.
 */

// A count request's URL ends with /count where its list's ends with /get-list.
const COUNT_SUFFIX: RegExp = /\/count$/;

export interface ListApiFake {
  // Every URL requested, in order.
  requests: Array<string>;
  restore: () => void;
}

// A row's ID as the server writes it.
export const serializedObjectId: (id: string) => JSONObject = (
  id: string,
): JSONObject => {
  return { _type: "ObjectID", value: id };
};

/*
 * `lists` maps the end of a list URL ("/span/get-list") to the rows it
 * returns. Any other list is empty, a count answers with the rows of the
 * list it counts, and every other request gets an empty object.
 */
export const fakeListApi: (
  lists: Record<string, Array<JSONObject>>,
) => ListApiFake = (lists: Record<string, Array<JSONObject>>): ListApiFake => {
  const requests: Array<string> = [];

  type FetchOptions = { url?: { toString: () => string } | undefined };

  const rowsFor: (url: string) => Array<JSONObject> | undefined = (
    url: string,
  ): Array<JSONObject> | undefined => {
    const path: string = url.split("?")[0] || "";

    for (const suffix of Object.keys(lists)) {
      if (path.endsWith(suffix)) {
        return lists[suffix];
      }
    }

    return undefined;
  };

  const spy: { mockRestore: () => void } = (
    jest.spyOn(API, "fetch") as unknown as {
      mockImplementation: (
        implementation: (options: FetchOptions) => Promise<unknown>,
      ) => { mockRestore: () => void };
    }
  ).mockImplementation(async (options: FetchOptions): Promise<unknown> => {
    const url: string = options.url ? options.url.toString() : "";
    requests.push(url);
    const path: string = url.split("?")[0] || "";

    if (path.endsWith("/get-list")) {
      const rows: Array<JSONObject> = rowsFor(url) || [];

      return new HTTPResponse<JSONObject>(
        200,
        { data: rows, count: rows.length, skip: 0, limit: 10 },
        {},
      );
    }

    if (path.endsWith("/count")) {
      const rows: Array<JSONObject> =
        rowsFor(path.replace(COUNT_SUFFIX, "/get-list")) || [];

      return new HTTPResponse<JSONObject>(200, { count: rows.length }, {});
    }

    return new HTTPResponse<JSONObject>(200, {}, {});
  });

  return {
    requests,
    restore: (): void => {
      spy.mockRestore();
    },
  };
};
