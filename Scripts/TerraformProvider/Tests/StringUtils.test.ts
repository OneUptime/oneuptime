import { StringUtils } from "../Core/StringUtils";

describe("toSnakeCase", () => {
  test("handles consecutive capitals", () => {
    expect(StringUtils.toSnakeCase("APIKey")).toBe("api_key");
    expect(StringUtils.toSnakeCase("StatusPageCNAME")).toBe(
      "status_page_cname",
    );
  });

  test("handles camelCase and spaces", () => {
    expect(StringUtils.toSnakeCase("monitorType")).toBe("monitor_type");
    expect(StringUtils.toSnakeCase("On-Call Policy")).toBe("on_call_policy");
  });
});

describe("toPascalCase", () => {
  test("round-trips snake_case names", () => {
    expect(StringUtils.toPascalCase("monitor_type")).toBe("MonitorType");
    expect(StringUtils.toPascalCase("on_call_policy")).toBe("OnCallPolicy");
  });

  test("strips apostrophes and backticks", () => {
    expect(StringUtils.toPascalCase("user's team")).toBe("UsersTeam");
  });
});

describe("sanitizeGoIdentifier", () => {
  test("prefixes identifiers that start with a digit", () => {
    expect(StringUtils.sanitizeGoIdentifier("1password")).toBe("_1password");
  });
});
