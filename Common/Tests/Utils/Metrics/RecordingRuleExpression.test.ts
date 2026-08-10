import {
  Node,
  ParseError,
  ParseResult,
  Token,
  ValidateResult,
  evaluate,
  parse,
  tokenize,
  validate,
} from "../../../Utils/Metrics/RecordingRuleExpression";

// Parse `expression` and return the AST, failing the test if it did not parse.
function parseOk(expression: string): Node {
  const result: ParseResult | ParseError = parse(expression);
  if (!result.ok) {
    throw new Error(
      `Expected "${expression}" to parse but got error: ${
        (result as ParseError).error
      }`,
    );
  }
  return result.ast;
}

// Parse + evaluate in one step for the common "does the math work" assertions.
function evalExpr(
  expression: string,
  bindings: Record<string, number> = {},
): number | null {
  return evaluate(parseOk(expression), bindings);
}

describe("RecordingRuleExpression", () => {
  describe("tokenize", () => {
    test("returns an empty token list for empty input", () => {
      expect(tokenize("")).toEqual([]);
    });

    test("skips all whitespace flavors", () => {
      const tokens: Array<Token> | ParseError = tokenize(" \t\n\r 1 ");
      expect(Array.isArray(tokens)).toBe(true);
      expect(tokens as Array<Token>).toHaveLength(1);
      expect((tokens as Array<Token>)[0]).toMatchObject({
        type: "number",
        value: "1",
      });
    });

    test("tokenizes each operator and paren with its position", () => {
      const tokens: Array<Token> = tokenize("1+2*3-(4/5)") as Array<Token>;
      expect(
        tokens.map((t: Token) => {
          return t.type;
        }),
      ).toEqual([
        "number",
        "op",
        "number",
        "op",
        "number",
        "op",
        "lparen",
        "number",
        "op",
        "number",
        "rparen",
      ]);
      // Positions must point back to the original string.
      expect(tokens[6]).toMatchObject({ type: "lparen", pos: 6 });
      expect(tokens[10]).toMatchObject({ type: "rparen", pos: 10 });
    });

    test("tokenizes integers and decimals including a trailing dot", () => {
      const t1: Array<Token> = tokenize("42") as Array<Token>;
      expect(t1[0]).toMatchObject({ type: "number", value: "42" });

      const t2: Array<Token> = tokenize("3.14") as Array<Token>;
      expect(t2[0]).toMatchObject({ type: "number", value: "3.14" });

      const t3: Array<Token> = tokenize("5.") as Array<Token>;
      expect(t3[0]).toMatchObject({ type: "number", value: "5." });
    });

    test("tokenizes identifiers with underscores and digits", () => {
      const tokens: Array<Token> = tokenize("_foo bar123 A") as Array<Token>;
      expect(
        tokens.map((t: Token) => {
          return t.value;
        }),
      ).toEqual(["_foo", "bar123", "A"]);
      expect(
        tokens.every((t: Token) => {
          return t.type === "ident";
        }),
      ).toBe(true);
    });

    test("does not let an identifier start with a digit", () => {
      // "1abc" -> number "1" then ident "abc"
      const tokens: Array<Token> = tokenize("1abc") as Array<Token>;
      expect(
        tokens.map((t: Token) => {
          return [t.type, t.value];
        }),
      ).toEqual([
        ["number", "1"],
        ["ident", "abc"],
      ]);
    });

    test("returns a ParseError with position on an unexpected character", () => {
      const result: Array<Token> | ParseError = tokenize("1 @ 2");
      expect(Array.isArray(result)).toBe(false);
      const err: ParseError = result as ParseError;
      expect(err.ok).toBe(false);
      expect(err.position).toBe(2);
      expect(err.error).toContain("@");
    });
  });

  describe("parse", () => {
    test("parses a single number", () => {
      expect(parseOk("7")).toEqual({ type: "num", value: 7 });
    });

    test("parses a single identifier and reports it", () => {
      const result: ParseResult = parse("cpu") as ParseResult;
      expect(result.ok).toBe(true);
      expect(result.ast).toEqual({ type: "ident", name: "cpu" });
      expect(result.identifiers).toEqual(["cpu"]);
    });

    test("deduplicates identifiers in the report", () => {
      const result: ParseResult = parse("a + a + b") as ParseResult;
      expect(result.identifiers.sort()).toEqual(["a", "b"]);
    });

    test("gives * and / higher precedence than + and -", () => {
      const ast: Node = parseOk("2 + 3 * 4");
      expect(ast).toEqual({
        type: "binary",
        op: "+",
        left: { type: "num", value: 2 },
        right: {
          type: "binary",
          op: "*",
          left: { type: "num", value: 3 },
          right: { type: "num", value: 4 },
        },
      });
    });

    test("is left-associative for same-precedence operators", () => {
      // 10 - 3 - 2 parses as (10 - 3) - 2, not 10 - (3 - 2)
      const ast: Node = parseOk("10 - 3 - 2");
      expect(ast).toMatchObject({
        type: "binary",
        op: "-",
        left: {
          type: "binary",
          op: "-",
          left: { type: "num", value: 10 },
          right: { type: "num", value: 3 },
        },
        right: { type: "num", value: 2 },
      });
    });

    test("parses parentheses to override precedence", () => {
      const ast: Node = parseOk("(2 + 3) * 4");
      expect(ast).toMatchObject({
        type: "binary",
        op: "*",
        left: { type: "binary", op: "+" },
        right: { type: "num", value: 4 },
      });
    });

    test("parses unary minus", () => {
      expect(parseOk("-5")).toEqual({
        type: "unary",
        op: "-",
        operand: { type: "num", value: 5 },
      });
    });

    test("parses a minus directly followed by a unary minus", () => {
      const ast: Node = parseOk("2 - -3");
      expect(ast).toEqual({
        type: "binary",
        op: "-",
        left: { type: "num", value: 2 },
        right: {
          type: "unary",
          op: "-",
          operand: { type: "num", value: 3 },
        },
      });
    });

    test("errors on empty input", () => {
      const result: ParseResult | ParseError = parse("");
      expect(result.ok).toBe(false);
      expect((result as ParseError).error).toContain("Unexpected end");
    });

    test("errors on a dangling operator", () => {
      const result: ParseResult | ParseError = parse("1 +");
      expect(result.ok).toBe(false);
    });

    test("errors on a missing closing paren", () => {
      const result: ParseResult | ParseError = parse("(1 + 2");
      expect(result.ok).toBe(false);
      expect((result as ParseError).error).toContain(")");
    });

    test("errors on stray trailing tokens", () => {
      const result: ParseResult | ParseError = parse("2 3");
      expect(result.ok).toBe(false);
      expect((result as ParseError).error).toContain("Unexpected token");
    });

    test("propagates a tokenizer error", () => {
      const result: ParseResult | ParseError = parse("1 $ 2");
      expect(result.ok).toBe(false);
      expect((result as ParseError).position).toBe(2);
    });

    test("rejects a numeric literal too large to be finite", () => {
      const huge: string = "9".repeat(400);
      const result: ParseResult | ParseError = parse(huge);
      expect(result.ok).toBe(false);
      expect((result as ParseError).error).toContain("Invalid number");
    });

    test("rejects excessively deep nesting instead of overflowing the stack", () => {
      const deep: string = "(".repeat(60) + "1" + ")".repeat(60);
      const result: ParseResult | ParseError = parse(deep);
      expect(result.ok).toBe(false);
      expect((result as ParseError).error).toContain("too deep");
    });

    test("accepts nesting within the depth limit", () => {
      const ok: string = "(".repeat(10) + "1" + ")".repeat(10);
      expect(parse(ok).ok).toBe(true);
    });
  });

  describe("evaluate", () => {
    test("evaluates basic arithmetic honoring precedence", () => {
      expect(evalExpr("2 + 3 * 4")).toBe(14);
      expect(evalExpr("(2 + 3) * 4")).toBe(20);
      expect(evalExpr("10 - 3 - 2")).toBe(5);
      expect(evalExpr("10 / 2 / 5")).toBe(1);
    });

    test("evaluates unary minus", () => {
      expect(evalExpr("-5 + 2")).toBe(-3);
      expect(evalExpr("2 * -3")).toBe(-6);
      expect(evalExpr("2 - -3")).toBe(5);
    });

    test("evaluates decimals", () => {
      expect(evalExpr("3.5 * 2")).toBe(7);
      expect(evalExpr("5.")).toBe(5);
    });

    test("resolves identifiers from bindings", () => {
      expect(evalExpr("cpu + mem", { cpu: 30, mem: 12 })).toBe(42);
      expect(evalExpr("total / count", { total: 100, count: 4 })).toBe(25);
    });

    test("returns null for a missing binding", () => {
      expect(evalExpr("cpu + mem", { cpu: 30 })).toBeNull();
    });

    test("returns null when a binding is not a finite number", () => {
      const ast: Node = parseOk("x + 1");
      expect(evaluate(ast, { x: Number.NaN })).toBeNull();
      expect(evaluate(ast, { x: Number.POSITIVE_INFINITY })).toBeNull();
      // Non-number value coerced through the untyped record.
      expect(evaluate(ast, { x: undefined as unknown as number })).toBeNull();
    });

    test("does not treat inherited properties as bindings", () => {
      const ast: Node = parseOk("toString");
      // "toString" exists on the prototype but not as an own property.
      expect(evaluate(ast, {})).toBeNull();
    });

    test("returns null on division by zero", () => {
      expect(evalExpr("5 / 0")).toBeNull();
      expect(evalExpr("1 / (2 - 2)")).toBeNull();
    });

    test("returns null when an intermediate result is null", () => {
      // Missing binding poisons the whole expression.
      expect(evalExpr("(a / b) + 1", { a: 1, b: 0 })).toBeNull();
      expect(evalExpr("missing * 0", {})).toBeNull();
    });

    test("returns null when arithmetic overflows to infinity", () => {
      const ast: Node = parseOk("a * b");
      expect(evaluate(ast, { a: 1e308, b: 1e308 })).toBeNull();
    });

    test("allows dividing zero by a nonzero number", () => {
      expect(evalExpr("0 / 5")).toBe(0);
    });
  });

  describe("validate", () => {
    test("accepts an expression whose identifiers are all allowed", () => {
      expect(validate("cpu + mem", ["cpu", "mem"])).toEqual({ ok: true });
    });

    test("accepts an expression with no identifiers", () => {
      expect(validate("1 + 2 * 3", [])).toEqual({ ok: true });
    });

    test("rejects and lists unknown identifiers", () => {
      const result: ValidateResult = validate("cpu + disk", ["cpu", "mem"]);
      expect(result.ok).toBe(false);
      expect(result.unknownIdentifiers).toEqual(["disk"]);
      expect(result.error).toContain("disk");
    });

    test("reports every unknown identifier", () => {
      const result: ValidateResult = validate("a + b + c", ["a"]);
      expect(result.ok).toBe(false);
      expect((result.unknownIdentifiers ?? []).sort()).toEqual(["b", "c"]);
    });

    test("surfaces a parse error with position instead of an identifier error", () => {
      const result: ValidateResult = validate("cpu +", ["cpu"]);
      expect(result.ok).toBe(false);
      expect(result.unknownIdentifiers).toBeUndefined();
    });

    test("propagates the tokenizer error position", () => {
      const result: ValidateResult = validate("cpu @ mem", ["cpu", "mem"]);
      expect(result.ok).toBe(false);
      expect(result.position).toBe(4);
    });
  });
});
