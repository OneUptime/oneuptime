import {
  evaluate,
  parse,
  tokenize,
  validate,
  type Node,
  type ParseError,
  type ParseResult,
  type Token,
  type ValidateResult,
} from "../../Utils/Metrics/RecordingRuleExpression";

function parseOk(input: string): ParseResult {
  const r: ParseResult | ParseError = parse(input);
  if (!r.ok) {
    throw new Error(
      `Expected parse to succeed for "${input}" but got: ${r.error}`,
    );
  }
  return r;
}

function parseErr(input: string): ParseError {
  const r: ParseResult | ParseError = parse(input);
  if (r.ok) {
    throw new Error(`Expected parse to fail for "${input}" but it succeeded`);
  }
  return r;
}

function tokensOf(input: string): Array<Token> {
  const t: Array<Token> | ParseError = tokenize(input);
  if (!Array.isArray(t)) {
    throw new Error(
      `Expected tokenize to succeed for "${input}" but got: ${t.error}`,
    );
  }
  return t;
}

function tokenTypes(input: string): Array<string> {
  return tokensOf(input).map((t: Token) => {
    return t.type;
  });
}

function tokenValues(input: string): Array<string> {
  return tokensOf(input).map((t: Token) => {
    return t.value;
  });
}

function tokenizeErr(input: string): ParseError {
  const t: Array<Token> | ParseError = tokenize(input);
  if (Array.isArray(t)) {
    throw new Error(`Expected tokenize to fail for "${input}" but it did not`);
  }
  return t;
}

// ((((A)))) with `depth` pairs of parens.
function nestParens(depth: number): string {
  let input: string = "A";
  for (let i: number = 0; i < depth; i++) {
    input = `(${input})`;
  }
  return input;
}

function evalOk(input: string, bindings: Record<string, number>): number {
  const r: ParseResult = parseOk(input);
  const v: number | null = evaluate(r.ast, bindings);
  if (v === null) {
    throw new Error(`Expected "${input}" to evaluate to a number, got null`);
  }
  return v;
}

describe("RecordingRuleExpression", () => {
  describe("parse + evaluate", () => {
    test("numeric literal", () => {
      expect(evalOk("42", {})).toBe(42);
      expect(evalOk("3.14", {})).toBeCloseTo(3.14);
    });

    test("identifier binding", () => {
      expect(evalOk("A", { A: 7 })).toBe(7);
    });

    test("basic arithmetic", () => {
      expect(evalOk("A + B", { A: 3, B: 4 })).toBe(7);
      expect(evalOk("A - B", { A: 10, B: 3 })).toBe(7);
      expect(evalOk("A * B", { A: 6, B: 7 })).toBe(42);
      expect(evalOk("A / B", { A: 10, B: 2 })).toBe(5);
    });

    test("operator precedence", () => {
      // * binds tighter than +
      expect(evalOk("A + B * C", { A: 1, B: 2, C: 3 })).toBe(7);
      // parens override
      expect(evalOk("(A + B) * C", { A: 1, B: 2, C: 3 })).toBe(9);
    });

    test("unary minus", () => {
      expect(evalOk("-A", { A: 5 })).toBe(-5);
      expect(evalOk("-(A + B)", { A: 1, B: 2 })).toBe(-3);
      expect(evalOk("A + -B", { A: 10, B: 3 })).toBe(7);
    });

    test("real-world error rate expression", () => {
      // http.error_rate = errors / requests * 100
      expect(evalOk("A / B * 100", { A: 3, B: 10 })).toBe(30);
    });

    test("whitespace tolerant", () => {
      expect(evalOk("   A  +   B  ", { A: 1, B: 2 })).toBe(3);
    });

    test("division by zero returns null", () => {
      const r: ParseResult = parseOk("A / B");
      expect(evaluate(r.ast, { A: 5, B: 0 })).toBeNull();
    });

    test("missing binding returns null", () => {
      const r: ParseResult = parseOk("A + B");
      expect(evaluate(r.ast, { A: 1 })).toBeNull();
    });

    test("non-finite input returns null", () => {
      const r: ParseResult = parseOk("A + B");
      expect(evaluate(r.ast, { A: Number.NaN, B: 1 })).toBeNull();
      expect(evaluate(r.ast, { A: Number.POSITIVE_INFINITY, B: 1 })).toBeNull();
    });

    test("binary overflow guarded", () => {
      // Number.MAX_VALUE * 2 overflows to Infinity → null.
      const r: ParseResult = parseOk("A * B");
      expect(evaluate(r.ast, { A: Number.MAX_VALUE, B: 2 })).toBeNull();
    });
  });

  describe("parse errors", () => {
    test("unexpected character", () => {
      const r: ParseResult | ParseError = parse("A @ B");
      expect(r.ok).toBe(false);
    });

    test("trailing token", () => {
      const r: ParseResult | ParseError = parse("A B");
      expect(r.ok).toBe(false);
    });

    test("missing closing paren", () => {
      const r: ParseResult | ParseError = parse("(A + B");
      expect(r.ok).toBe(false);
    });

    test("empty expression", () => {
      const r: ParseResult | ParseError = parse("   ");
      expect(r.ok).toBe(false);
    });

    test("operator without operand", () => {
      const r: ParseResult | ParseError = parse("A +");
      expect(r.ok).toBe(false);
    });
  });

  describe("identifier collection", () => {
    test("lists unique identifiers", () => {
      const r: ParseResult = parseOk("A + B + A * C");
      const sorted: Array<string> = [...r.identifiers].sort();
      expect(sorted).toEqual(["A", "B", "C"]);
    });
  });

  describe("validate", () => {
    test("allows known identifiers", () => {
      expect(validate("A + B", ["A", "B"]).ok).toBe(true);
    });

    test("rejects unknown identifiers", () => {
      const r: { ok: boolean; unknownIdentifiers?: Array<string> } = validate(
        "A + X",
        ["A", "B"],
      );
      expect(r.ok).toBe(false);
      expect(r.unknownIdentifiers).toEqual(["X"]);
    });

    test("surfaces parse errors", () => {
      const r: { ok: boolean; error?: string } = validate("A +", ["A"]);
      expect(r.ok).toBe(false);
      expect(r.error).toBeDefined();
    });
  });

  describe("nesting limit", () => {
    test("rejects deeply nested expression", () => {
      // Build 100 nested parens: ((((...A...))))
      let input: string = "A";
      for (let i: number = 0; i < 100; i++) {
        input = `(${input})`;
      }
      const r: ParseResult | ParseError = parse(input);
      expect(r.ok).toBe(false);
    });
  });

  describe("AST shape", () => {
    test("respects precedence in AST", () => {
      const r: ParseResult = parseOk("A + B * C");
      // Root is +; right side is * node.
      const ast: Node = r.ast;
      expect(ast.type).toBe("binary");
      if (ast.type !== "binary") {
        return;
      }
      expect(ast.op).toBe("+");
      expect(ast.right.type).toBe("binary");
      if (ast.right.type !== "binary") {
        return;
      }
      expect(ast.right.op).toBe("*");
    });
  });

  describe("tokenize", () => {
    test("emits typed tokens carrying their source position", () => {
      expect(tokensOf("A + 1")).toEqual([
        { type: "ident", value: "A", pos: 0 },
        { type: "op", value: "+", pos: 2 },
        { type: "number", value: "1", pos: 4 },
      ]);
    });

    test("parens get their own token types", () => {
      expect(tokenTypes("(A)")).toEqual(["lparen", "ident", "rparen"]);
    });

    test("adjacent operators need no separating space", () => {
      expect(tokenValues("A*B/C")).toEqual(["A", "*", "B", "/", "C"]);
    });

    test("space, tab, newline and carriage return are all skipped, and positions still point at the original string", () => {
      expect(tokensOf("  A\t\n\rB  ")).toEqual([
        { type: "ident", value: "A", pos: 2 },
        { type: "ident", value: "B", pos: 6 },
      ]);
    });

    test("an unknown character aborts tokenizing and reports where", () => {
      const r: ParseError = tokenizeErr("A@B");
      expect(r.error).toBe('Unexpected character "@" at position 1');
      expect(r.position).toBe(1);
    });
  });

  describe("number lexing", () => {
    test("a trailing dot is consumed into the number and reads as the integer", () => {
      // The lexer takes the '.' unconditionally, so "1." is one number token.
      expect(tokensOf("1.")).toEqual([{ type: "number", value: "1.", pos: 0 }]);
      expect(evalOk("1.", {})).toBe(1);
    });

    test("leading zeros are kept in the token but not in the value", () => {
      expect(tokensOf("007")[0]?.value).toBe("007");
      expect(evalOk("007", {})).toBe(7);
    });

    test("a second dot is not part of the number and is rejected as a stray character", () => {
      const r: ParseError = parseErr("2.5.5");
      expect(r.error).toBe('Unexpected character "." at position 3');
      expect(r.position).toBe(3);
    });

    test("a number may not start with a dot", () => {
      const r: ParseError = parseErr(".5");
      expect(r.error).toBe('Unexpected character "." at position 0');
      expect(r.position).toBe(0);
    });

    test("digits followed by letters lex as two tokens, so the parser rejects them", () => {
      expect(tokenTypes("1a")).toEqual(["number", "ident"]);
      expect(parseErr("1a").error).toBe('Unexpected token "a" at position 1');
    });
  });

  describe("identifier lexing rules", () => {
    test("an identifier may be a bare underscore", () => {
      expect(tokensOf("_")).toEqual([{ type: "ident", value: "_", pos: 0 }]);
    });

    test("digits are allowed after the first character but not as the first", () => {
      expect(tokensOf("_9")[0]?.value).toBe("_9");
      expect(tokensOf("a9_b")[0]?.value).toBe("a9_b");
      // A leading digit starts a number instead, which leaves a stray ident.
      expect(tokenTypes("9a")).toEqual(["number", "ident"]);
    });

    test("characters outside [A-Za-z0-9_] are not identifier characters", () => {
      expect(tokenizeErr("$a").position).toBe(0);
      // '-' ends the identifier and becomes an operator rather than joining it.
      expect(tokenValues("a-b")).toEqual(["a", "-", "b"]);
    });
  });

  describe("parse error shapes", () => {
    test("running out of input reports no position, because there is no token to point at", () => {
      for (const input of ["", "   ", "A +", "("]) {
        const r: ParseError = parseErr(input);
        expect(r.error).toBe("Unexpected end of expression");
        expect(r.position).toBeUndefined();
      }
    });

    test("an unclosed paren at end of input also has no position", () => {
      const r: ParseError = parseErr("(A + B");
      expect(r.error).toBe("Expected ')'");
      expect(r.position).toBeUndefined();
    });

    test("a stray trailing token names the position both in the message and in the field", () => {
      const r: ParseError = parseErr("A B");
      expect(r.error).toBe('Unexpected token "B" at position 2');
      expect(r.position).toBe(2);
    });

    test("a token in operand position reports the field but omits the position from the message", () => {
      // Note the asymmetry with the trailing-token message above.
      const r: ParseError = parseErr("A + + B");
      expect(r.error).toBe('Unexpected token "+"');
      expect(r.position).toBe(4);
    });

    test("empty parens and a leading binary operator are both rejected in operand position", () => {
      expect(parseErr("()").error).toBe('Unexpected token ")"');
      expect(parseErr("()").position).toBe(1);
      expect(parseErr("* A").error).toBe('Unexpected token "*"');
      expect(parseErr("* A").position).toBe(0);
    });
  });

  describe("associativity", () => {
    test("'-' is left associative, so A - B - C is (A - B) - C", () => {
      const ast: Node = parseOk("A - B - C").ast;
      expect(ast.type).toBe("binary");
      if (ast.type !== "binary") {
        return;
      }
      expect(ast.left.type).toBe("binary");
      expect(ast.right.type).toBe("ident");
      // Right associativity would give 10 - (3 - 2) = 9.
      expect(evalOk("A - B - C", { A: 10, B: 3, C: 2 })).toBe(5);
    });

    test("'/' is left associative, so A / B / C is (A / B) / C", () => {
      const ast: Node = parseOk("A / B / C").ast;
      expect(ast.type).toBe("binary");
      if (ast.type !== "binary") {
        return;
      }
      expect(ast.left.type).toBe("binary");
      expect(ast.right.type).toBe("ident");
      // Right associativity would give 100 / (5 / 2) = 40.
      expect(evalOk("A / B / C", { A: 100, B: 5, C: 2 })).toBe(10);
    });

    test("equal-precedence operators mix left to right", () => {
      const ast: Node = parseOk("A - B + C").ast;
      expect(ast.type).toBe("binary");
      if (ast.type !== "binary") {
        return;
      }
      // The last operator ends up at the root.
      expect(ast.op).toBe("+");
      expect(evalOk("A - B + C", { A: 10, B: 3, C: 2 })).toBe(9);
      expect(evalOk("A / B * C", { A: 100, B: 5, C: 2 })).toBe(40);
    });
  });

  describe("nesting depth boundary", () => {
    test("32 levels of parens still parse", () => {
      expect(parse(nestParens(32)).ok).toBe(true);
    });

    test("33 levels are rejected, with no position", () => {
      const r: ParseError = parseErr(nestParens(33));
      expect(r.error).toBe("Expression nesting too deep");
      expect(r.position).toBeUndefined();
    });

    test("the limit is on nesting, not on expression length", () => {
      // 200 chained additions stay at depth 1 and must not trip the guard.
      let chain: string = "A";
      for (let i: number = 0; i < 200; i++) {
        chain += " + A";
      }
      expect(parse(chain).ok).toBe(true);
      expect(evalOk(chain, { A: 1 })).toBe(201);
    });
  });

  describe("identifier collection order", () => {
    test("identifiers come back in first-appearance order, not sorted", () => {
      expect(parseOk("C + A + B").identifiers).toEqual(["C", "A", "B"]);
    });

    test("a repeated identifier is listed once", () => {
      expect(parseOk("A + A").identifiers).toEqual(["A"]);
    });

    test("order follows the parse, so a parenthesised group is collected as it is reached", () => {
      expect(parseOk("Z * (Y + X)").identifiers).toEqual(["Z", "Y", "X"]);
    });

    test("an expression of pure literals binds nothing", () => {
      expect(parseOk("1 + 2 * 3").identifiers).toEqual([]);
    });
  });

  describe("validate passthrough", () => {
    test("a parse error carrying a position keeps it", () => {
      const r: ValidateResult = validate("A @ B", ["A"]);
      expect(r.ok).toBe(false);
      expect(r.error).toBe('Unexpected character "@" at position 2');
      expect(r.position).toBe(2);
    });

    test("a parse error without a position does not invent one", () => {
      const r: ValidateResult = validate("(A", ["A"]);
      expect(r.ok).toBe(false);
      expect(r.error).toBe("Expected ')'");
      expect(r.position).toBeUndefined();
    });

    test("every unknown identifier is reported, in first-appearance order", () => {
      const r: ValidateResult = validate("A + X + Y", ["A"]);
      expect(r.ok).toBe(false);
      expect(r.error).toBe("Unknown identifier(s): X, Y");
      expect(r.unknownIdentifiers).toEqual(["X", "Y"]);
    });

    test("an expression with no identifiers passes an empty allow list", () => {
      expect(validate("1 + 1", [])).toEqual({ ok: true });
    });

    test("a successful validate reports nothing but ok", () => {
      const r: ValidateResult = validate("A + B", ["A", "B", "C"]);
      expect(r.ok).toBe(true);
      expect(r.error).toBeUndefined();
      expect(r.unknownIdentifiers).toBeUndefined();
    });
  });

  describe("evaluate edge cases", () => {
    test("a binding inherited from Object.prototype is not a binding", () => {
      /*
       * bindings["toString"] is a function, so the typeof guard must reject it
       * rather than letting a prototype member leak into the result.
       */
      const r: ParseResult = parseOk("toString");
      expect(evaluate(r.ast, {})).toBeNull();
    });

    test("0 / 0 is null rather than NaN", () => {
      const r: ParseResult = parseOk("A / B");
      expect(evaluate(r.ast, { A: 0, B: 0 })).toBeNull();
    });

    test("double unary minus cancels out", () => {
      expect(evalOk("--A", { A: 5 })).toBe(5);
      expect(evalOk("-3 * -2", {})).toBe(6);
    });
  });
});
