"use strict";

/**
 * GitHub's `${{ }}` expressions, read for the tests that work out what a
 * workflow's concurrency group comes to for a given run.
 *
 * Only the forms those groups use are understood: a context path
 * (`github.workflow`, `inputs.release_run_id`), and `||` between them, which
 * yields the first truthy operand, else the last one. A path that does not
 * resolve reads as null, as it does on GitHub. Anything else throws instead of
 * being misread.
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
      value = contextPath.split(".").reduce((object, key) => {
        return object === undefined || object === null
          ? undefined
          : object[key];
      }, context);
      if (value) {
        break;
      }
    }
    return value === undefined || value === null ? "" : String(value);
  });
}

module.exports = { evaluateExpressions };
