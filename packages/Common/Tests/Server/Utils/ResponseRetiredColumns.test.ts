import Monitor from "../../../Models/DatabaseModels/Monitor";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import ResponseUtil from "../../../Server/Utils/Response";
import { JSONObject } from "../../../Types/JSON";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * AN ANSWER TO A SELECT THAT NAMED WHO DELETED A RECORD (#10469).
 *
 * While deletedByUserId was a column, a select of it was answered with it:
 * null, on every record, as nothing ever wrote it. The column is gone, and a
 * client that still selects it - a generated SDK reading every field it was
 * told of - is answered as it was (RetiredColumns): each record has it, as
 * null. BaseAPI hands the names its select named to the response.
 */

describe("the records an answer sends", () => {
  let sent: unknown = undefined;
  let request: ExpressRequest;
  let response: ExpressResponse;

  beforeEach(() => {
    sent = undefined;
    request = {
      headers: {},
      query: {},
      socket: {},
    } as unknown as ExpressRequest;
    response = {
      status: (): ExpressResponse => {
        return response;
      },
      send: (body: unknown): void => {
        sent = body;
      },
      setHeader: (): void => {},
      getHeader: (): undefined => {
        return undefined;
      },
    } as unknown as ExpressResponse;
  });

  function monitor(name: string): Monitor {
    const model: Monitor = new Monitor();
    model._id = "0193c0de-aaaa-4aaa-8bbb-0000000000a1";
    model.name = name;
    return model;
  }

  function dataOf(body: unknown): Array<JSONObject> {
    return (body as { data: Array<JSONObject> }).data;
  }

  test("a list answers each record's retired columns as null", () => {
    ResponseUtil.sendEntityArrayResponse(
      request,
      response,
      [monitor("API"), monitor("Web")],
      2,
      Monitor,
      { retiredColumns: ["deletedByUserId", "deletedByUser"] },
    );

    for (const record of dataOf(sent)) {
      expect(record).toEqual(
        expect.objectContaining({ deletedByUserId: null, deletedByUser: null }),
      );
    }

    expect(
      dataOf(sent).map((record: JSONObject): unknown => {
        return record["name"];
      }),
    ).toEqual(["API", "Web"]);
  });

  test("a list that named none answers as it always did", () => {
    ResponseUtil.sendEntityArrayResponse(
      request,
      response,
      [monitor("API")],
      1,
      Monitor,
    );

    expect(Object.keys(dataOf(sent)[0]!)).not.toContain("deletedByUserId");
  });

  test("one record answers them as null too, beside its own fields", () => {
    ResponseUtil.sendEntityResponse(
      request,
      response,
      monitor("API"),
      Monitor,
      {
        retiredColumns: ["deletedByUserId"],
      },
    );

    expect(sent).toEqual(
      expect.objectContaining({ name: "API", deletedByUserId: null }),
    );
  });

  test("no record, no fields", () => {
    ResponseUtil.sendEntityResponse(request, response, null, Monitor, {
      retiredColumns: ["deletedByUserId"],
    });

    expect(sent).toEqual({});
  });
});
