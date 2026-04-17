import {
  evaluate,
  parse,
  validate,
  type Node,
  type ParseError,
  type ParseResult,
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
});
