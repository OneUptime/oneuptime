import parseLogQuery, {
  FilterOperator,
  ParsedToken,
  TokenType,
  tokensToDisplayString,
} from "../../../Types/Log/LogQueryParser";

describe("LogQueryParser", () => {
  describe("parseLogQuery - empty and free text", () => {
    test("returns an empty array for empty / whitespace input", () => {
      expect(parseLogQuery("")).toEqual([]);
      expect(parseLogQuery("   ")).toEqual([]);
    });

    test("combines free text words into a single Contains token", () => {
      const tokens: Array<ParsedToken> = parseLogQuery("connection refused");
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        type: TokenType.FreeText,
        operator: FilterOperator.Contains,
        value: "connection refused",
        negated: false,
      });
    });

    test("strips quotes from a quoted phrase", () => {
      const tokens: Array<ParsedToken> = parseLogQuery('"connection refused"');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]!.value).toBe("connection refused");
      expect(tokens[0]!.type).toBe(TokenType.FreeText);
    });
  });

  describe("parseLogQuery - field filters and aliases", () => {
    test("resolves the severity alias to severityText", () => {
      const tokens: Array<ParsedToken> = parseLogQuery("severity:error");
      expect(tokens[0]).toMatchObject({
        type: TokenType.FieldFilter,
        field: "severityText",
        operator: FilterOperator.Equals,
        value: "error",
        negated: false,
      });
    });

    test("resolves the service alias to primaryEntityId", () => {
      expect(parseLogQuery("service:api")[0]!.field).toBe("primaryEntityId");
    });

    test("resolves level, message, and trace aliases", () => {
      expect(parseLogQuery("level:warn")[0]!.field).toBe("severityText");
      expect(parseLogQuery("message:hello")[0]!.field).toBe("body");
      expect(parseLogQuery("trace:abc")[0]!.field).toBe("traceId");
    });

    test("keeps unknown field names as-is", () => {
      expect(parseLogQuery("customfield:x")[0]!.field).toBe("customfield");
    });
  });

  describe("parseLogQuery - attribute filters", () => {
    test("parses @-prefixed attribute access", () => {
      const tokens: Array<ParsedToken> = parseLogQuery("@http.status_code:500");
      expect(tokens[0]).toMatchObject({
        type: TokenType.AttributeFilter,
        field: "http.status_code",
        operator: FilterOperator.Equals,
        value: "500",
      });
    });

    test("does not run aliasing on attribute field names", () => {
      // "service" is an alias for field filters but must stay literal as an attribute.
      expect(parseLogQuery("@service:api")[0]!.field).toBe("service");
    });
  });

  describe("parseLogQuery - negation", () => {
    test("negated equals becomes NotEquals", () => {
      const tokens: Array<ParsedToken> = parseLogQuery("-severity:debug");
      expect(tokens[0]).toMatchObject({
        field: "severityText",
        operator: FilterOperator.NotEquals,
        value: "debug",
        negated: true,
      });
    });

    test("negated attribute filter", () => {
      const tokens: Array<ParsedToken> = parseLogQuery("-@http.method:GET");
      expect(tokens[0]).toMatchObject({
        type: TokenType.AttributeFilter,
        field: "http.method",
        operator: FilterOperator.NotEquals,
        negated: true,
      });
    });
  });

  describe("parseLogQuery - operators", () => {
    test("detects wildcard values", () => {
      const tokens: Array<ParsedToken> = parseLogQuery("service:api-*");
      expect(tokens[0]).toMatchObject({
        operator: FilterOperator.Wildcard,
        value: "api-*",
      });
    });

    test("detects numeric comparison operators", () => {
      expect(parseLogQuery("@duration:>1000")[0]).toMatchObject({
        operator: FilterOperator.GreaterThan,
        value: "1000",
      });
      expect(parseLogQuery("@duration:>=1000")[0]).toMatchObject({
        operator: FilterOperator.GreaterThanOrEqual,
        value: "1000",
      });
      expect(parseLogQuery("@duration:<50")[0]).toMatchObject({
        operator: FilterOperator.LessThan,
        value: "50",
      });
      expect(parseLogQuery("@duration:<=50")[0]).toMatchObject({
        operator: FilterOperator.LessThanOrEqual,
        value: "50",
      });
    });
  });

  describe("parseLogQuery - boolean keywords and mixed queries", () => {
    test("skips bare AND/OR/NOT keywords", () => {
      const tokens: Array<ParsedToken> = parseLogQuery(
        "severity:error AND service:api",
      );
      expect(tokens).toHaveLength(2);
      expect(tokens[0]!.field).toBe("severityText");
      expect(tokens[1]!.field).toBe("primaryEntityId");
    });

    test("splits free text around a field filter", () => {
      const tokens: Array<ParsedToken> = parseLogQuery(
        "connection severity:error refused",
      );
      expect(tokens).toHaveLength(3);
      expect(tokens[0]).toMatchObject({
        type: TokenType.FreeText,
        value: "connection",
      });
      expect(tokens[1]).toMatchObject({
        type: TokenType.FieldFilter,
        field: "severityText",
      });
      expect(tokens[2]).toMatchObject({
        type: TokenType.FreeText,
        value: "refused",
      });
    });

    test("does not split a quoted phrase containing spaces", () => {
      const tokens: Array<ParsedToken> = parseLogQuery(
        '"connection refused" severity:error',
      );
      expect(tokens).toHaveLength(2);
      expect(tokens[0]!.value).toBe("connection refused");
      expect(tokens[1]!.field).toBe("severityText");
    });

    test("strips quotes from field values", () => {
      const tokens: Array<ParsedToken> = parseLogQuery('message:"a b c"');
      expect(tokens[0]!.value).toBe("a b c");
      expect(tokens[0]!.field).toBe("body");
    });
  });

  describe("tokensToDisplayString", () => {
    test("rejoins tokens using their raw representation", () => {
      const tokens: Array<ParsedToken> = parseLogQuery(
        "severity:error service:api",
      );
      expect(tokensToDisplayString(tokens)).toBe("severity:error service:api");
    });

    test("returns an empty string for no tokens", () => {
      expect(tokensToDisplayString([])).toBe("");
    });
  });
});
