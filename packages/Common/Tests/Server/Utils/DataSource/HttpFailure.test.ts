import { describe, expect, test } from "@jest/globals";
import {
  asSentence,
  DataSourceRequestError,
  describeFailedAnswer,
  describeTransportError,
  failedAnswerError,
  firstLineOf,
  isRequestId,
  MAX_PROVIDER_MESSAGE_LENGTH,
  readBodyText,
  readErrorCode,
  readRequestIdHeader,
  redactAnswer,
  unreachedError,
} from "../../../../Server/Utils/DataSource/HttpFailure";

/*
 * HOW EVERY COLLECTOR SAYS A FAILED ANSWER (#9506, #9540).
 *
 * What was being read, the provider's status, code and message, how many
 * times it was asked and the ID its support finds the request by - never a
 * credential. A refusal says who was refused, and what to do where the
 * collector knows.
 */

const JWT: string =
  "eyJhbGciOiJSUzI1NiJ9.eyJhdWQiOiJodHRwczovL2NvbnRvc28ifQ.c2lnbmF0dXJlLW9mLXRoZS10b2tlbg";

describe("the words of an answer", () => {
  test("a message ends in a full stop, so a sentence can follow it", () => {
    expect(asSentence("Service unavailable")).toBe("Service unavailable.");
    expect(asSentence("Rate exceeded!")).toBe("Rate exceeded!");
    expect(asSentence("  ")).toBe("");
  });

  test("the first line only", () => {
    expect(firstLineOf("Line one\r\nTrace ID: 1")).toBe("Line one");
    expect(firstLineOf("")).toBe("");
  });

  test("a gateway's HTML page is said by its title, or by its words", () => {
    expect(
      readBodyText(
        "<!DOCTYPE html><html><head><title>502 Bad Gateway</title><style>p{}</style></head><body><p>nginx</p></body></html>",
      ),
    ).toBe("502 Bad Gateway");
    expect(
      readBodyText(
        "<html><body><script>var x = 1;</script><h1>Service&nbsp;Unavailable</h1></body></html>",
      ),
    ).toBe("Service Unavailable");
    expect(readBodyText("Code: 202. DB::Exception: Too many\nstack")).toBe(
      "Code: 202. DB::Exception: Too many",
    );
  });

  test("a bearer token, a JSON web token and the connection's secrets are taken out", () => {
    expect(
      redactAnswer(
        `Bearer ${JWT} was refused; token ${JWT}; secret s3cr3t-value`,
        ["s3cr3t-value"],
      ),
    ).toBe("Bearer **** was refused; token ****; secret ****");
  });

  test("a secret too short to be one is not looked for", () => {
    expect(redactAnswer("a b c", ["a", ""])).toBe("a b c");
  });

  test("a provider's own error code, when it is one", () => {
    expect(readErrorCode("ThrottlingException")).toBe("ThrottlingException");
    expect(readErrorCode(390144)).toBe("390144");
    expect(readErrorCode("not a code")).toBe(null);
    expect(readErrorCode(undefined)).toBe(null);
  });

  test("a request ID from the first header that holds one", () => {
    expect(
      readRequestIdHeader(
        { "x-amzn-requestid": "c0ffee00-1111-2222-3333-444455556666" },
        ["x-request-id", "x-amzn-requestid"],
      ),
    ).toBe("c0ffee00-1111-2222-3333-444455556666");
    expect(
      readRequestIdHeader({ "x-request-id": "<script>" }, ["x-request-id"]),
    ).toBe(null);
    expect(readRequestIdHeader(undefined, ["x-request-id"])).toBe(null);
    expect(isRequestId("01b2c3d4-0000-0001-0000-0001")).toBe(true);
    expect(isRequestId("no spaces allowed")).toBe(false);
  });
});

describe("a failed answer, said", () => {
  test("what was being read, the status and code, the provider's words, the tries and the request ID", () => {
    expect(
      describeFailedAnswer({
        provider: "Snowflake",
        statusCode: 503,
        errorCode: "390600",
        operation: "listing the tables (SHOW TABLES)",
        message: "Service unavailable",
        attempts: 3,
        requestId: "01b2c3d4-0000-0001",
        requestIdLabel: "Query ID",
      }),
    ).toEqual({
      message:
        "Snowflake answered 503 (390600) while listing the tables (SHOW TABLES): Service unavailable. Tried 3 times. Query ID: 01b2c3d4-0000-0001.",
      reason: "Snowflake answered 503 (390600): Service unavailable.",
    });
  });

  test("an answer with no message says so, and one try says no count", () => {
    expect(
      describeFailedAnswer({
        provider: "ClickHouse",
        statusCode: 502,
        errorCode: null,
        operation: "running a query",
        message: "",
        attempts: 1,
        requestId: null,
      }).message,
    ).toBe(
      "ClickHouse answered 502 while running a query, with no error message.",
    );
  });

  test("a refusal says who was refused and what to do, never the tries or the request ID", () => {
    expect(
      describeFailedAnswer({
        provider: "Dataverse",
        statusCode: 403,
        errorCode: "0x80040220",
        operation: "counting rows (RetrieveTotalRecordCount)",
        message: "Principal user is missing prvReadaccount privilege",
        attempts: 1,
        requestId: "0b6e8ad1-0000-0000-0000-000000000000",
        refused: {
          who: "the app",
          advice: "Give its security role read access.",
        },
      }),
    ).toEqual({
      message:
        "Dataverse refused the app (403, 0x80040220) while counting rows (RetrieveTotalRecordCount): Principal user is missing prvReadaccount privilege. Give its security role read access.",
      reason:
        "Dataverse refused the app (403, 0x80040220): Principal user is missing prvReadaccount privilege.",
    });
  });

  test("a refusal of a collector that names no one refused is said as an answer", () => {
    expect(
      describeFailedAnswer({
        provider: "AWS Glue",
        statusCode: 403,
        errorCode: "AccessDeniedException",
        operation: "reading the Glue database (GetDatabase)",
        message: "User is not authorized to perform: glue:GetDatabase",
        attempts: 1,
        requestId: "c0ffee00-1111-2222-3333-444455556666",
      }).message,
    ).toBe(
      "AWS Glue answered 403 (AccessDeniedException) while reading the Glue database (GetDatabase): User is not authorized to perform: glue:GetDatabase. Request ID: c0ffee00-1111-2222-3333-444455556666.",
    );
  });

  test("a long message is cut, so the whole sentence fits; a credential in it is taken out", () => {
    const said: string = describeFailedAnswer({
      provider: "Databricks",
      statusCode: 503,
      errorCode: "TEMPORARILY_UNAVAILABLE",
      operation: "listing the schemas",
      message: `token ${JWT} ${"x".repeat(400)}`,
      attempts: 2,
      requestId: null,
    }).message;

    expect(said).not.toContain(JWT);
    expect(said).toContain("token ****");
    expect(said.length).toBeLessThan(MAX_PROVIDER_MESSAGE_LENGTH + 150);
    expect(said.endsWith("Tried 2 times.")).toBe(true);
  });

  test("as an error, with what support and a caller read off it", () => {
    const error: DataSourceRequestError = failedAnswerError({
      provider: "Google BigQuery",
      statusCode: 500,
      errorCode: "backendError",
      operation: "running a query",
      message: "Backend error",
      attempts: 3,
      requestId: null,
    });

    expect(error).toBeInstanceOf(DataSourceRequestError);
    expect(error.message).toBe(
      "Google BigQuery answered 500 (backendError) while running a query: Backend error. Tried 3 times.",
    );
    expect(error.reason).toBe(
      "Google BigQuery answered 500 (backendError): Backend error.",
    );
    expect(error.statusCode).toBe(500);
    expect(error.errorCode).toBe("backendError");
    expect(error.attempts).toBe(3);
    expect(error.requestId).toBe(null);
  });
});

describe("a request that got no answer", () => {
  test("says what was being read, without the transport's own prefix", () => {
    expect(
      unreachedError({
        provider: "ClickHouse",
        operation: "checking the connection",
        error: new Error(
          "Could not reach data source: connect ECONNREFUSED 10.0.0.1:8443",
        ),
      }).message,
    ).toBe(
      "ClickHouse could not be reached while checking the connection: connect ECONNREFUSED 10.0.0.1:8443.",
    );
  });

  test("never repeats a secret the error held", () => {
    expect(
      unreachedError({
        provider: "Snowflake",
        operation: "running a query",
        error: new Error("refused for key hunter22"),
        secrets: ["hunter22"],
      }).message,
    ).toBe(
      "Snowflake could not be reached while running a query: refused for key ****.",
    );
  });

  test("an error with no words still says something", () => {
    expect(describeTransportError(new Error(""))).toBe("the connection failed");
    expect(describeTransportError("socket hang up")).toBe("socket hang up");
  });
});
