import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import Search from "../../../Types/BaseDatabase/Search";
import {
  LogFilter,
  queryStringToFilter,
} from "../../../Types/Log/LogQueryToFilter";
import { describe, expect, test } from "@jest/globals";

/*
 * queryStringToFilter turns the log search bar's query string into a
 * Query<Log>-shaped filter. It sits on top of the (separately tested)
 * LogQueryParser, so these tests focus on the mapping layer: operator ->
 * BaseDatabase value type, top-level vs @attribute routing, severity casing
 * normalization, and free-text accumulation into body Search.
 */

describe("queryStringToFilter - free text", () => {
  test("empty query yields an empty filter", () => {
    expect(queryStringToFilter("")).toEqual({});
  });

  test("bare words become a body Search", () => {
    const filter: LogFilter = queryStringToFilter("connection refused");
    expect(filter.body).toBeInstanceOf(Search);
    expect((filter.body as Search<string>).toString()).toBe(
      "connection refused",
    );
  });
});

describe("queryStringToFilter - top-level fields", () => {
  test("severity:error normalizes to title-case Error as an equals match", () => {
    const filter: LogFilter = queryStringToFilter("severity:error");
    expect(filter.severityText).toBe("Error");
  });

  test("level:warn aliases to severityText and normalizes warn -> Warning", () => {
    const filter: LogFilter = queryStringToFilter("level:warn");
    expect(filter.severityText).toBe("Warning");
  });

  test("service:api maps to primaryEntityId", () => {
    const filter: LogFilter = queryStringToFilter("service:api");
    expect(filter.primaryEntityId).toBe("api");
  });

  test("negation produces a NotEqual with normalized severity", () => {
    const filter: LogFilter = queryStringToFilter("-severity:debug");
    expect(filter.severityText).toBeInstanceOf(NotEqual);
    expect((filter.severityText as unknown as NotEqual<string>).value).toBe(
      "Debug",
    );
  });

  test("wildcard produces a Search with the asterisks stripped", () => {
    const filter: LogFilter = queryStringToFilter("service:api-*");
    expect(filter.primaryEntityId).toBeInstanceOf(Search);
    expect(
      (filter.primaryEntityId as unknown as Search<string>).toString(),
    ).toBe("api-");
  });
});

describe("queryStringToFilter - attribute fields", () => {
  test("@http.status_code:500 lands under attributes as an equals string", () => {
    const filter: LogFilter = queryStringToFilter("@http.status_code:500");
    expect(filter.attributes).toEqual({ "http.status_code": "500" });
  });

  test("numeric comparison operators parse the value as a number", () => {
    const gt: LogFilter = queryStringToFilter("@duration:>1000");
    expect(gt.attributes!["duration"]).toBeInstanceOf(GreaterThan);
    expect((gt.attributes!["duration"] as GreaterThan<number>).value).toBe(
      1000,
    );

    const gte: LogFilter = queryStringToFilter("@duration:>=1000");
    expect(gte.attributes!["duration"]).toBeInstanceOf(GreaterThanOrEqual);

    const lt: LogFilter = queryStringToFilter("@duration:<50");
    expect(lt.attributes!["duration"]).toBeInstanceOf(LessThan);
    expect((lt.attributes!["duration"] as LessThan<number>).value).toBe(50);
  });

  test("a non-numeric comparison value stays a string", () => {
    const filter: LogFilter = queryStringToFilter("@version:>abc");
    expect((filter.attributes!["version"] as GreaterThan<string>).value).toBe(
      "abc",
    );
  });

  test("negated attribute filter produces a NotEqual", () => {
    const filter: LogFilter = queryStringToFilter("-@http.method:GET");
    expect(filter.attributes!["http.method"]).toBeInstanceOf(NotEqual);
    expect((filter.attributes!["http.method"] as NotEqual<string>).value).toBe(
      "GET",
    );
  });
});

describe("queryStringToFilter - combinations", () => {
  test("a field filter plus trailing free text populate distinct slots", () => {
    const filter: LogFilter = queryStringToFilter("severity:error timeout");
    expect(filter.severityText).toBe("Error");
    expect(filter.body).toBeInstanceOf(Search);
    expect((filter.body as Search<string>).toString()).toBe("timeout");
  });
});
