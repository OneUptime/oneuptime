"use strict";

/**
 * GitHub's `${{ }}` expressions, read for the tests that work out what a
 * workflow comes to for a given run.
 *
 *   - evaluateExpressions: the strings a workflow's concurrency groups write.
 *     Only a context path (`github.workflow`, `inputs.release_run_id`) and
 *     `||` between them, which yields the first truthy operand, else the last
 *     one.
 *   - stepRuns and playJob: whether each step of a job runs, given how the
 *     steps before it ended - a step's `if`, with the status functions
 *     (success(), failure(), cancelled(), always()), `!`, `&&`, `||`, `==`,
 *     `!=`, parentheses, 'string' literals, true, false, null, numbers and
 *     context paths (`steps.install-app.outcome`).
 *
 * A path that does not resolve reads as null, as it does on GitHub. Anything
 * else throws instead of being misread.
 */

/**
 * @param {string} template - The string as written in the workflow
 * @param {object} context - The contexts, e.g. { github: {...}, matrix: {...} }
 * @returns {string} The string with each expression evaluated
 */
function evaluateExpressions(template, context) {
  return template.replace(/\$\{\{(.*?)\}\}/g, (whole, expression) => {
    let value;
    for (const operand of expression.split("||")) {
      const contextPath = operand.trim();
      if (!/^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*)+$/.test(contextPath)) {
        throw new Error(
          `This reader cannot evaluate "${contextPath}" in "${template}": it reads context paths and "||" only`,
        );
      }
      value = resolvePath(contextPath, context);
      if (value) {
        break;
      }
    }
    return value === undefined || value === null ? "" : String(value);
  });
}

function resolvePath(contextPath, context) {
  return contextPath.split(".").reduce((object, key) => {
    return object === undefined || object === null ? undefined : object[key];
  }, context);
}

const STATUS_FUNCTIONS = ["success", "failure", "cancelled", "always"];

/*
 * The tokens of an expression: punctuation, 'strings' ('' is a quote inside
 * one), numbers, and words - a context path (dots and dashes inside it, as
 * step ids have) or a function name.
 */
const TOKEN =
  /\s*(?:(&&|\|\||==|!=|<=|>=|[()!<>,[\]])|'((?:[^']|'')*)'|(-?\d+(?:\.\d+)?)\b|([A-Za-z_][\w-]*(?:\.[A-Za-z_*][\w-]*)*))/y;

function tokenize(expression) {
  const tokens = [];
  TOKEN.lastIndex = 0;
  let index = 0;
  while (index < expression.length) {
    if (/^\s*$/.test(expression.slice(index))) {
      break;
    }
    TOKEN.lastIndex = index;
    const match = TOKEN.exec(expression);
    if (!match) {
      throw new Error(
        `This reader cannot read "${expression}" from "${expression.slice(index)}"`,
      );
    }
    index = TOKEN.lastIndex;
    if (match[1] !== undefined) {
      tokens.push({ type: "punctuation", value: match[1] });
    } else if (match[2] !== undefined) {
      tokens.push({ type: "string", value: match[2].replace(/''/g, "'") });
    } else if (match[3] !== undefined) {
      tokens.push({ type: "number", value: Number(match[3]) });
    } else {
      tokens.push({ type: "word", value: match[4] });
    }
  }
  return tokens;
}

function isTruthy(value) {
  return !(
    value === false ||
    value === null ||
    value === undefined ||
    value === "" ||
    (typeof value === "number" && (value === 0 || Number.isNaN(value)))
  );
}

/*
 * GitHub's ==: strings compare ignoring case; null equals only null; values
 * of different types compare as numbers.
 */
function looselyEqual(left, right) {
  const leftValue = left === undefined ? null : left;
  const rightValue = right === undefined ? null : right;
  if (typeof leftValue === "string" && typeof rightValue === "string") {
    return leftValue.toLowerCase() === rightValue.toLowerCase();
  }
  if (leftValue === null || rightValue === null) {
    return leftValue === rightValue;
  }
  if (typeof leftValue === typeof rightValue) {
    return leftValue === rightValue;
  }
  return Number(leftValue) === Number(rightValue);
}

/*
 * Evaluates one expression (without its `${{ }}`): `||` binds loosest, then
 * `&&`, then `==` and `!=`, then `!`.
 */
function evaluate(expression, state) {
  const tokens = tokenize(expression);
  let position = 0;

  const peek = () => {
    return tokens[position];
  };
  const isPunctuation = (value) => {
    const token = peek();
    return (
      Boolean(token) && token.type === "punctuation" && token.value === value
    );
  };
  const expect = (value) => {
    if (!isPunctuation(value)) {
      throw new Error(`Expected "${value}" in "${expression}"`);
    }
    position++;
  };

  function parseOr() {
    let value = parseAnd();
    while (isPunctuation("||")) {
      position++;
      const right = parseAnd();
      value = isTruthy(value) ? value : right;
    }
    return value;
  }

  function parseAnd() {
    let value = parseEquality();
    while (isPunctuation("&&")) {
      position++;
      const right = parseEquality();
      value = isTruthy(value) ? right : value;
    }
    return value;
  }

  function parseEquality() {
    let value = parseUnary();
    while (isPunctuation("==") || isPunctuation("!=")) {
      const operator = peek().value;
      position++;
      const right = parseUnary();
      const equal = looselyEqual(value, right);
      value = operator === "==" ? equal : !equal;
    }
    return value;
  }

  function parseUnary() {
    if (isPunctuation("!")) {
      position++;
      return !isTruthy(parseUnary());
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const token = peek();
    if (!token) {
      throw new Error(`"${expression}" ends where a value was expected`);
    }
    if (isPunctuation("(")) {
      position++;
      const value = parseOr();
      expect(")");
      return value;
    }
    position++;
    if (token.type === "string" || token.type === "number") {
      return token.value;
    }
    if (token.type !== "word") {
      throw new Error(
        `This reader cannot evaluate "${token.value}" in "${expression}"`,
      );
    }
    if (token.value === "true" || token.value === "false") {
      return token.value === "true";
    }
    if (token.value === "null") {
      return null;
    }
    if (isPunctuation("(")) {
      if (!STATUS_FUNCTIONS.includes(token.value)) {
        throw new Error(
          `This reader cannot evaluate ${token.value}() in "${expression}": it knows ${STATUS_FUNCTIONS.join("(), ")}() only`,
        );
      }
      position++;
      expect(")");
      return statusFunction(token.value, state);
    }
    if (!token.value.includes(".") || token.value.includes("*")) {
      throw new Error(
        `This reader cannot evaluate "${token.value}" in "${expression}": it reads context paths such as steps.<id>.outcome`,
      );
    }
    const value = resolvePath(token.value, state.contexts);
    return value === undefined ? null : value;
  }

  const value = parseOr();
  if (position < tokens.length) {
    throw new Error(
      `This reader cannot evaluate "${expression}" past "${tokens[position].value}"`,
    );
  }
  return value;
}

function statusFunction(name, state) {
  if (name === "always") {
    return true;
  }
  if (name === "cancelled") {
    return state.cancelled;
  }
  if (name === "failure") {
    return state.failed;
  }
  return !state.failed && !state.cancelled;
}

/*
 * A step's `if` as GitHub evaluates it: the expression inside `${{ }}` (which
 * an `if` may leave out), and success() && (...) when it calls no status
 * function itself. No `if` at all is success().
 */
function conditionExpression(condition) {
  if (condition === undefined || condition === null) {
    return "success()";
  }
  if (typeof condition === "boolean") {
    return `success() && ${condition}`;
  }
  const written = String(condition).trim();
  const wrapped = written.match(/^\$\{\{([\s\S]*)\}\}$/);
  const expression = (wrapped ? wrapped[1] : written).trim();
  if (expression.includes("${{")) {
    throw new Error(
      `This reader cannot evaluate "${written}": an if is one expression`,
    );
  }
  const callsStatusFunction = STATUS_FUNCTIONS.some((name) => {
    return new RegExp(`(^|[^\\w.-])${name}\\s*\\(`).test(expression);
  });
  return callsStatusFunction ? expression : `success() && (${expression})`;
}

/**
 * Whether a step with this `if` runs.
 * @param {string|boolean|undefined} condition - The step's `if`, as written
 * @param {object} state - { contexts: { steps: { <id>: { outcome, conclusion } }, ... },
 *   failed: whether a step before it failed, cancelled: whether the run was cancelled }
 * @returns {boolean}
 */
function stepRuns(condition, state) {
  return isTruthy(
    evaluate(conditionExpression(condition), {
      contexts: state.contexts || {},
      failed: Boolean(state.failed),
      cancelled: Boolean(state.cancelled),
    }),
  );
}

/**
 * The ids of the steps an `if` reads (`steps.<id>.outcome`, ...).
 * @param {string|boolean|undefined} condition
 * @returns {Array<string>}
 */
function stepIdsReadBy(condition) {
  if (typeof condition !== "string") {
    return [];
  }
  return tokenize(conditionExpression(condition))
    .filter((token) => {
      return token.type === "word" && token.value.startsWith("steps.");
    })
    .map((token) => {
      return token.value.split(".")[1];
    });
}

/**
 * Plays a job's steps through their `if`s, in order, as a runner does: a
 * step that runs ends with `outcomeOf(step, index)` ("success" unless it says
 * otherwise), one that does not is "skipped". A failed step with
 * continue-on-error concludes as a success. The job fails when a step
 * concludes as a failure.
 * @param {Array<object>} steps - The job's steps, as parsed from the workflow
 * @param {object} options - { outcomeOf(step, index), cancelled, contexts }
 * @returns {{ outcomes: Array<string>, result: string }}
 */
function playJob(steps, options = {}) {
  const outcomeOf =
    options.outcomeOf ||
    (() => {
      return "success";
    });
  const contexts = { ...(options.contexts || {}), steps: {} };
  let failed = false;
  const outcomes = [];

  steps.forEach((step, index) => {
    const runs = stepRuns(step.if, {
      contexts,
      failed,
      cancelled: options.cancelled,
    });
    const outcome = runs ? outcomeOf(step, index) || "success" : "skipped";
    const conclusion =
      outcome === "failure" && step["continue-on-error"] === true
        ? "success"
        : outcome;
    if (step.id) {
      contexts.steps[step.id] = { outcome, conclusion };
    }
    failed = failed || conclusion === "failure";
    outcomes.push(outcome);
  });

  return { outcomes, result: failed ? "failure" : "success" };
}

module.exports = { evaluateExpressions, stepRuns, stepIdsReadBy, playJob };
