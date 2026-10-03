import {
  getQueryStoppedMessage,
  readJSONResponse,
} from "../../../../Server/Utils/AnalyticsDatabase/QueryResponse";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../../Server/Utils/Express";
import logger from "../../../../Server/Utils/Logger";
import { expressErrorHandler } from "../../../../Server/Utils/StartServer";
import ServerException from "../../../../Types/Exception/ServerException";
import { JSONObject } from "../../../../Types/JSON";
import ErrorClass, {
  declaredErrorClass,
} from "../../../../Types/Telemetry/ErrorClass";
import { ResponseJSON, ResultSet } from "@clickhouse/client";
import { Readable } from "node:stream";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The client's own ResultSet over a canned body, so these tests exercise
 * the json() the services actually call rather than a stand-in for it.
 */
const resultSetWithBody: (body: string) => ResultSet<"JSON"> = (
  body: string,
): ResultSet<"JSON"> => {
  return new ResultSet(Readable.from([Buffer.from(body)]), "JSON", "query-id");
};

const resultSetFailingWith: (error: Error) => ResultSet<"JSON"> = (
  error: Error,
): ResultSet<"JSON"> => {
  const stream: Readable = new Readable({
    read(): void {
      this.destroy(error);
    },
  });

  return new ResultSet(stream, "JSON", "query-id");
};

// A FORMAT JSON document as ClickHouse writes it.
const COMPLETE_BODY: string = [
  "{",
  '\t"meta": [{"name": "severityText", "type": "String"}, {"name": "cnt", "type": "UInt64"}],',
  '\t"data": [{"severityText": "Error", "cnt": 42}, {"severityText": "Information", "cnt": 7}],',
  '\t"rows": 2,',
  '\t"statistics": {"elapsed": 0.012, "rows_read": 49, "bytes_read": 1024}',
  "}",
].join("\n");

const SUBJECT: string = "The log search";

describe("readJSONResponse", () => {
  test("returns a complete response as json() would", async () => {
    const response: ResponseJSON<JSONObject> =
      await readJSONResponse<JSONObject>({
        resultSet: resultSetWithBody(COMPLETE_BODY),
        subject: SUBJECT,
      });

    expect(response.data).toEqual([
      { severityText: "Error", cnt: 42 },
      { severityText: "Information", cnt: 7 },
    ]);
    expect(response.rows).toBe(2);
  });

  /*
   * What a query stopped by timeout_overflow_mode = 'break' sends: HTTP 200
   * and a body that is empty or ends part way through the document.
   */
  test.each([
    ["an empty body", ""],
    ["a body cut off inside the meta block", COMPLETE_BODY.slice(0, 40)],
    [
      "a body cut off inside a row",
      COMPLETE_BODY.slice(0, COMPLETE_BODY.indexOf('"Information"')),
    ],
    [
      "a body missing only its closing brace",
      COMPLETE_BODY.slice(0, COMPLETE_BODY.lastIndexOf("}")),
    ],
  ])(
    "turns %s into an exception that says what happened",
    async (_description: string, body: string) => {
      const error: unknown = await readJSONResponse<JSONObject>({
        resultSet: resultSetWithBody(body),
        subject: SUBJECT,
      }).catch((caught: unknown) => {
        return caught;
      });

      expect(error).toBeInstanceOf(ServerException);
      expect((error as ServerException).code).toBe(500);
      expect((error as ServerException).message).toBe(
        getQueryStoppedMessage(SUBJECT),
      );
    },
  );

  test("classes a stopped query as infrastructure, not a code fault", async () => {
    const error: unknown = await readJSONResponse<JSONObject>({
      resultSet: resultSetWithBody(""),
      subject: SUBJECT,
    }).catch((caught: unknown) => {
      return caught;
    });

    expect(declaredErrorClass(error)).toEqual({
      errorClass: ErrorClass.Infrastructure,
      authoritative: true,
    });
  });

  test("the body really is a SyntaxError for the client's json()", async () => {
    // Pins the premise: if the client ever stops throwing SyntaxError here, this fails first.
    await expect(resultSetWithBody("").json()).rejects.toBeInstanceOf(
      SyntaxError,
    );
    await expect(
      resultSetWithBody(COMPLETE_BODY.slice(0, 40)).json(),
    ).rejects.toBeInstanceOf(SyntaxError);
  });

  test("rethrows any other failure untouched", async () => {
    const socketError: Error = new Error("socket hang up");

    const error: unknown = await readJSONResponse<JSONObject>({
      resultSet: resultSetFailingWith(socketError),
      subject: SUBJECT,
    }).catch((caught: unknown) => {
      return caught;
    });

    expect(error).toBe(socketError);
  });

  test("rethrows an error json() raises itself, such as a consumed stream", async () => {
    const resultSet: ResultSet<"JSON"> = resultSetWithBody(COMPLETE_BODY);
    await resultSet.text();

    const error: unknown = await readJSONResponse<JSONObject>({
      resultSet,
      subject: SUBJECT,
    }).catch((caught: unknown) => {
      return caught;
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ServerException);
  });
});

/*
 * The whole point, as the browser sees it: the same stopped query, answered
 * by the API error handler with and without readJSONResponse in between.
 */
describe("what the web app receives for a stopped query", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const respond: (error: Error) => { status: number; body: unknown } = (
    error: Error,
  ): { status: number; body: unknown } => {
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    const sent: { status: number; body: unknown } = {
      status: 0,
      body: undefined,
    };

    const res: ExpressResponse = {
      headersSent: false,
      status: (code: number): ExpressResponse => {
        sent.status = code;
        return res;
      },
      send: (body: unknown): ExpressResponse => {
        sent.body = body;
        return res;
      },
    } as unknown as ExpressResponse;

    expressErrorHandler(
      error,
      { url: "/api/log/get-list" } as ExpressRequest,
      res,
      (() => {}) as unknown as NextFunction,
    );

    return sent;
  };

  const CUT_OFF_BODY: string = COMPLETE_BODY.slice(0, 40);

  test("the raw parse error could only be answered with a bare Server Error", async () => {
    const parseError: unknown = await resultSetWithBody(CUT_OFF_BODY)
      .json()
      .catch((caught: unknown) => {
        return caught;
      });

    expect(respond(parseError as Error)).toEqual({
      status: 500,
      body: { error: "Server Error" },
    });
  });

  test("readJSONResponse gets the explanation through", async () => {
    const error: unknown = await readJSONResponse<JSONObject>({
      resultSet: resultSetWithBody(CUT_OFF_BODY),
      subject: SUBJECT,
    }).catch((caught: unknown) => {
      return caught;
    });

    expect(respond(error as Error)).toEqual({
      status: 500,
      body: { error: getQueryStoppedMessage(SUBJECT) },
    });
  });
});

describe("getQueryStoppedMessage", () => {
  test("names the work and tells the reader how to narrow it", () => {
    expect(getQueryStoppedMessage("The log search")).toBe(
      "The log search took too long and was stopped before it finished. Try a shorter time range or more specific filters.",
    );
  });
});
