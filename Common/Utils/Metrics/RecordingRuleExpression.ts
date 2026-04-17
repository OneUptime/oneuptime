// Recording-rule expression DSL.
//
// Grammar (recursive descent):
//
//   expr    := term (('+' | '-') term)*
//   term    := factor (('*' | '/') factor)*
//   factor  := number | identifier | '(' expr ')' | '-' factor
//   number  := digits ('.' digits)?
//   identifier := [A-Za-z_][A-Za-z0-9_]*
//
// Evaluation returns `null` when the result is not a finite real number —
// division by zero, missing binding, overflow, or NaN. Callers treat `null`
// as "skip this bucket".
//
// Intentionally small: no function calls, no power operator, no comparisons.
// A future version can grow this DSL without breaking stored rules because
// the whole expression is one string column on the model.

const MAX_DEPTH: number = 32;

export interface Token {
  type: "number" | "ident" | "op" | "lparen" | "rparen";
  value: string;
  pos: number;
}

export type Node =
  | { type: "num"; value: number }
  | { type: "ident"; name: string }
  | { type: "unary"; op: "-"; operand: Node }
  | { type: "binary"; op: "+" | "-" | "*" | "/"; left: Node; right: Node };

export interface ParseResult {
  ok: true;
  ast: Node;
  identifiers: Array<string>;
}

export interface ParseError {
  ok: false;
  error: string;
  position?: number;
}

export interface ValidateResult {
  ok: boolean;
  error?: string;
  position?: number;
  unknownIdentifiers?: Array<string>;
}

export function tokenize(input: string): Array<Token> | ParseError {
  const tokens: Array<Token> = [];
  let i: number = 0;
  while (i < input.length) {
    const ch: string = input[i] as string;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lparen", value: ch, pos: i });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", value: ch, pos: i });
      i++;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ type: "op", value: ch, pos: i });
      i++;
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      const start: number = i;
      while (i < input.length && input[i]! >= "0" && input[i]! <= "9") {
        i++;
      }
      if (input[i] === ".") {
        i++;
        while (i < input.length && input[i]! >= "0" && input[i]! <= "9") {
          i++;
        }
      }
      tokens.push({ type: "number", value: input.slice(start, i), pos: start });
      continue;
    }
    if (isIdentStart(ch)) {
      const start: number = i;
      i++;
      while (i < input.length && isIdentPart(input[i] as string)) {
        i++;
      }
      tokens.push({ type: "ident", value: input.slice(start, i), pos: start });
      continue;
    }
    return {
      ok: false,
      error: `Unexpected character "${ch}" at position ${i}`,
      position: i,
    };
  }
  return tokens;
}

function isIdentStart(ch: string): boolean {
  return (
    (ch >= "A" && ch <= "Z") ||
    (ch >= "a" && ch <= "z") ||
    ch === "_"
  );
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || (ch >= "0" && ch <= "9");
}

// Recursive-descent parser.
export function parse(input: string): ParseResult | ParseError {
  const tokenized: Array<Token> | ParseError = tokenize(input);
  if (!Array.isArray(tokenized)) {
    return tokenized;
  }

  const tokens: Array<Token> = tokenized;
  const state: { i: number; depth: number } = { i: 0, depth: 0 };
  const identifiers: Set<string> = new Set();

  function peek(): Token | undefined {
    return tokens[state.i];
  }

  function advance(): Token | undefined {
    return tokens[state.i++];
  }

  function parseExpr(): Node | ParseError {
    if (state.depth > MAX_DEPTH) {
      return { ok: false, error: "Expression nesting too deep" };
    }
    state.depth++;
    let left: Node | ParseError = parseTerm();
    if ("ok" in left && left.ok === false) {
      state.depth--;
      return left;
    }
    while (true) {
      const next: Token | undefined = peek();
      if (next?.type === "op" && (next.value === "+" || next.value === "-")) {
        advance();
        const right: Node | ParseError = parseTerm();
        if ("ok" in right && right.ok === false) {
          state.depth--;
          return right;
        }
        left = {
          type: "binary",
          op: next.value as "+" | "-",
          left: left as Node,
          right: right as Node,
        };
        continue;
      }
      break;
    }
    state.depth--;
    return left as Node;
  }

  function parseTerm(): Node | ParseError {
    let left: Node | ParseError = parseFactor();
    if ("ok" in left && left.ok === false) {
      return left;
    }
    while (true) {
      const next: Token | undefined = peek();
      if (next?.type === "op" && (next.value === "*" || next.value === "/")) {
        advance();
        const right: Node | ParseError = parseFactor();
        if ("ok" in right && right.ok === false) {
          return right;
        }
        left = {
          type: "binary",
          op: next.value as "*" | "/",
          left: left as Node,
          right: right as Node,
        };
        continue;
      }
      break;
    }
    return left as Node;
  }

  function parseFactor(): Node | ParseError {
    const tok: Token | undefined = peek();
    if (!tok) {
      return {
        ok: false,
        error: "Unexpected end of expression",
      };
    }
    if (tok.type === "op" && tok.value === "-") {
      advance();
      const operand: Node | ParseError = parseFactor();
      if ("ok" in operand && operand.ok === false) {
        return operand;
      }
      return { type: "unary", op: "-", operand: operand as Node };
    }
    if (tok.type === "number") {
      advance();
      const n: number = Number(tok.value);
      if (!Number.isFinite(n)) {
        return {
          ok: false,
          error: `Invalid number "${tok.value}"`,
          position: tok.pos,
        };
      }
      return { type: "num", value: n };
    }
    if (tok.type === "ident") {
      advance();
      identifiers.add(tok.value);
      return { type: "ident", name: tok.value };
    }
    if (tok.type === "lparen") {
      advance();
      const inner: Node | ParseError = parseExpr();
      if ("ok" in inner && inner.ok === false) {
        return inner;
      }
      const close: Token | undefined = advance();
      if (!close || close.type !== "rparen") {
        return {
          ok: false,
          error: "Expected ')'",
          ...(close ? { position: close.pos } : {}),
        };
      }
      return inner as Node;
    }
    return {
      ok: false,
      error: `Unexpected token "${tok.value}"`,
      position: tok.pos,
    };
  }

  const ast: Node | ParseError = parseExpr();
  if ("ok" in ast && ast.ok === false) {
    return ast;
  }
  if (state.i !== tokens.length) {
    const stray: Token | undefined = tokens[state.i];
    return {
      ok: false,
      error: `Unexpected token "${stray?.value ?? ""}" at position ${stray?.pos ?? -1}`,
      ...(stray ? { position: stray.pos } : {}),
    };
  }
  return {
    ok: true,
    ast: ast as Node,
    identifiers: Array.from(identifiers),
  };
}

// Evaluate an AST against the given variable bindings. Returns null when
// the result is not a finite real number (division by zero, missing binding,
// NaN, Infinity). The caller skips any output row whose result is null.
export function evaluate(
  node: Node,
  bindings: Record<string, number>,
): number | null {
  switch (node.type) {
    case "num":
      return Number.isFinite(node.value) ? node.value : null;
    case "ident": {
      const v: number | undefined = bindings[node.name];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        return null;
      }
      return v;
    }
    case "unary": {
      const inner: number | null = evaluate(node.operand, bindings);
      if (inner === null) {
        return null;
      }
      return -inner;
    }
    case "binary": {
      const l: number | null = evaluate(node.left, bindings);
      if (l === null) {
        return null;
      }
      const r: number | null = evaluate(node.right, bindings);
      if (r === null) {
        return null;
      }
      let out: number;
      switch (node.op) {
        case "+":
          out = l + r;
          break;
        case "-":
          out = l - r;
          break;
        case "*":
          out = l * r;
          break;
        case "/":
          if (r === 0) {
            return null;
          }
          out = l / r;
          break;
      }
      return Number.isFinite(out) ? out : null;
    }
  }
}

// Parse + check that every identifier in the expression is in `allowed`.
// Used at rule-save time so the form can fail fast before the cron runs.
export function validate(
  expression: string,
  allowed: Array<string>,
): ValidateResult {
  const parsed: ParseResult | ParseError = parse(expression);
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error,
      ...(typeof parsed.position === "number"
        ? { position: parsed.position }
        : {}),
    };
  }
  const allowedSet: Set<string> = new Set(allowed);
  const unknown: Array<string> = parsed.identifiers.filter((id: string) => {
    return !allowedSet.has(id);
  });
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Unknown identifier(s): ${unknown.join(", ")}`,
      unknownIdentifiers: unknown,
    };
  }
  return { ok: true };
}
