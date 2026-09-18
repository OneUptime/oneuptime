"use strict";

/**
 * Renders a Dockerfile.tpl the way `npm run prerun` (gomplate) does, and splits
 * a Dockerfile into its build stages.
 *
 * The image templates branch on one thing only:
 *
 *   {{ if eq .Env.ENVIRONMENT "development" }} ...dev... {{ else }} ...prod... {{ end }}
 *
 * so that is all this renders. Anything else between `{{` and `}}` throws: a
 * template using more of gomplate must not be silently mis-rendered (and a
 * `{{` in a Dockerfile comment is a real bug, because gomplate evaluates it).
 * EnterpriseEditionBuild.test.js cross-checks this renderer against gomplate
 * itself wherever gomplate is on PATH.
 *
 * Also a CLI, for lint-app-dockerfile.sh:
 *
 *   node Tests/Ops/Utils/DockerfileTemplate.js <template> <production|development>
 */

const fs = require("fs");

const IF_DEVELOPMENT = '{{ if eq .Env.ENVIRONMENT "development" }}';
const ELSE = "{{ else }}";
const END = "{{ end }}";

const TEMPLATE_ACTION = /\{\{[\s\S]*?\}\}/g;
const FROM_INSTRUCTION = /^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?\s*$/i;

class DockerfileTemplateError extends Error {
  constructor(message) {
    super(message);
    this.name = "DockerfileTemplateError";
  }
}

/**
 * @param {string} template - The Dockerfile.tpl text
 * @param {"production"|"development"} environment
 * @returns {string} The rendered Dockerfile
 */
function render(template, environment) {
  if (environment !== "production" && environment !== "development") {
    throw new DockerfileTemplateError(
      `environment must be production or development (got ${environment})`,
    );
  }

  const actions = template.match(TEMPLATE_ACTION) || [];
  const unsupported = actions.filter((action) => {
    return action !== IF_DEVELOPMENT && action !== ELSE && action !== END;
  });

  if (unsupported.length > 0) {
    throw new DockerfileTemplateError(
      `unsupported template syntax: ${unsupported.join(", ")}`,
    );
  }

  if (actions.length === 0) {
    return template;
  }

  if (
    actions.length !== 3 ||
    actions[0] !== IF_DEVELOPMENT ||
    actions[1] !== ELSE ||
    actions[2] !== END
  ) {
    throw new DockerfileTemplateError(
      `expected exactly one if/else/end block, found: ${actions.join(" ")}`,
    );
  }

  const ifIndex = template.indexOf(IF_DEVELOPMENT);
  const elseIndex = template.indexOf(ELSE);
  const endIndex = template.indexOf(END);

  const before = template.slice(0, ifIndex);
  const development = template.slice(
    ifIndex + IF_DEVELOPMENT.length,
    elseIndex,
  );
  const production = template.slice(elseIndex + ELSE.length, endIndex);
  const after = template.slice(endIndex + END.length);

  return (
    before + (environment === "development" ? development : production) + after
  );
}

/**
 * @param {string} dockerfile
 * @returns {Array<{name: (string|null), from: string, body: string, index: number}>}
 *   Stages in order; `name` and `from` are lower-cased like Docker treats them.
 */
function parseStages(dockerfile) {
  const stages = [];
  let current = null;

  for (const line of dockerfile.split("\n")) {
    const match = FROM_INSTRUCTION.exec(line);

    if (match) {
      current = {
        name: match[2] ? match[2].toLowerCase() : null,
        from: match[1].toLowerCase(),
        body: "",
        index: stages.length,
      };
      stages.push(current);
      continue;
    }

    if (current) {
      current.body += `${line}\n`;
    }
  }

  return stages;
}

/**
 * The named stage and every stage it is built FROM, nearest first.
 * @param {Array<{name: (string|null), from: string}>} stages
 * @param {string} name
 */
function ancestry(stages, name) {
  const chain = [];
  let next = name;

  while (next) {
    const stage = stages.find((candidate) => {
      return candidate.name === next;
    });

    if (!stage || chain.includes(stage)) {
      break;
    }

    chain.push(stage);
    next = stage.from;
  }

  return chain;
}

/**
 * The instructions of a stage body with comments and blank lines dropped and
 * backslash continuations joined, so assertions never match prose.
 * @param {string} body
 * @returns {Array<string>}
 */
function instructions(body) {
  const joined = body
    .split("\n")
    .filter((line) => {
      return !/^\s*#/.test(line);
    })
    .join("\n")
    .replace(/\\\n/g, " ");

  return joined
    .split("\n")
    .map((line) => {
      return line.trim().replace(/\s+/g, " ");
    })
    .filter((line) => {
      return line.length > 0;
    });
}

module.exports = {
  DockerfileTemplateError,
  render,
  parseStages,
  ancestry,
  instructions,
};

if (require.main === module) {
  const [templatePath, environment] = process.argv.slice(2);

  if (!templatePath || !environment) {
    process.stderr.write(
      "usage: node DockerfileTemplate.js <template> <production|development>\n",
    );
    process.exit(2);
  }

  process.stdout.write(
    render(fs.readFileSync(templatePath, "utf8"), environment),
  );
}
