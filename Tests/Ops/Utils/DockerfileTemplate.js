"use strict";

/**
 * Renders a Dockerfile.tpl the way `npm run prerun` (gomplate) does, and splits
 * a Dockerfile into its build stages.
 *
 * The image templates branch on one thing only:
 *
 *   {{ if eq .Env.ENVIRONMENT "development" }} ...dev... {{ else }} ...prod... {{ end }}
 *
 * so that is all this renders by default. Anything else between `{{` and `}}`
 * throws: a template using more of gomplate must not be silently mis-rendered
 * (and a `{{` in a Dockerfile comment is a real bug, because gomplate
 * evaluates it).
 *
 * The Probe, Runner and Kubernetes agent templates also carry an optional
 * copy of operator-supplied certificates:
 *
 *   {{- if file.Exists "SslCertificates" }}
 *   COPY ./SslCertificates /usr/local/share/ca-certificates
 *   {{- end }}
 *
 * gomplate answers file.Exists against the directory it runs in (configure.sh
 * runs it from the repository root). A caller that passes
 * `options.fileExists` answers it instead, and gets those blocks rendered with
 * Go's `{{-` / `-}}` whitespace trimming; without it they are refused like any
 * other syntax.
 *
 * EnterpriseEditionBuild.test.js cross-checks this renderer against gomplate
 * itself for every Dockerfile.tpl in the repository.
 *
 * Also a CLI, for lint-app-dockerfile.sh:
 *
 *   node Tests/Ops/Utils/DockerfileTemplate.js <template> <production|development>
 */

const fs = require("fs");
const path = require("path");

const IF_DEVELOPMENT = '{{ if eq .Env.ENVIRONMENT "development" }}';
const ELSE = "{{ else }}";
const END = "{{ end }}";

const TEMPLATE_ACTION = /\{\{[\s\S]*?\}\}/g;
const FROM_INSTRUCTION = /^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?\s*$/i;
// An action's inside, with Go's trim markers: "{{- " and " -}}".
const ACTION_PARTS = /^\{\{(-\s)?([\s\S]*?)(\s-)?\}\}$/;
const FILE_EXISTS_IF = /^if\s+file\.Exists\s+"([^"]*)"$/;

class DockerfileTemplateError extends Error {
  constructor(message) {
    super(message);
    this.name = "DockerfileTemplateError";
  }
}

/**
 * Splits a template into text and actions. An action records its inside
 * (trim markers removed) and whether it trims the whitespace before or after
 * it.
 * @param {string} template
 */
function tokenize(template) {
  const parts = [];
  let last = 0;

  for (const match of template.matchAll(TEMPLATE_ACTION)) {
    const [, trimBefore, inside, trimAfter] = ACTION_PARTS.exec(match[0]);

    parts.push({ type: "text", value: template.slice(last, match.index) });
    parts.push({
      type: "action",
      raw: match[0],
      inside: inside.trim(),
      trimBefore: Boolean(trimBefore),
      trimAfter: Boolean(trimAfter),
    });
    last = match.index + match[0].length;
  }

  parts.push({ type: "text", value: template.slice(last) });

  return parts;
}

/**
 * Renders the `{{ if file.Exists "<path>" }} ... {{ end }}` blocks and leaves
 * every other action in place, for render() to deal with. A file.Exists
 * block holds plain text only (no else, nothing nested).
 * @param {string} template
 * @param {(relativePath: string) => boolean} fileExists
 */
function renderFileExistsBlocks(template, fileExists) {
  const parts = tokenize(template);

  // Pair each file.Exists `if` with its `end` first: only those two trim.
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    const condition =
      part.type === "action" ? FILE_EXISTS_IF.exec(part.inside) : null;

    if (!condition) {
      continue;
    }

    const end = parts[index + 2];

    if (!end || end.type !== "action" || end.inside !== "end") {
      throw new DockerfileTemplateError(
        `file.Exists "${condition[1]}" must hold plain text and close with {{ end }}`,
      );
    }

    part.fileExists = { path: condition[1], closing: end };
    end.closesFileExists = true;
  }

  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];

    if (part.type !== "action" || !(part.fileExists || part.closesFileExists)) {
      continue;
    }

    if (part.trimBefore) {
      parts[index - 1].value = parts[index - 1].value.trimEnd();
    }

    if (part.trimAfter) {
      parts[index + 1].value = parts[index + 1].value.trimStart();
    }
  }

  let output = "";

  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];

    if (part.type === "text") {
      output += part.value;
      continue;
    }

    if (part.fileExists) {
      if (fileExists(part.fileExists.path)) {
        output += parts[index + 1].value;
      }

      // Skip the body and the end: both are consumed here.
      index += 2;
      continue;
    }

    output += part.raw;
  }

  return output;
}

/**
 * @param {string} template - The Dockerfile.tpl text
 * @param {"production"|"development"} environment
 * @param {{fileExists?: (relativePath: string) => boolean}} [options]
 *   fileExists answers `file.Exists "<path>"`; without it such blocks throw.
 * @returns {string} The rendered Dockerfile
 */
function render(template, environment, options) {
  if (environment !== "production" && environment !== "development") {
    throw new DockerfileTemplateError(
      `environment must be production or development (got ${environment})`,
    );
  }

  if (options && typeof options.fileExists === "function") {
    return render(
      renderFileExistsBlocks(template, options.fileExists),
      environment,
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

// Directories configure.sh's `find` skips, plus git's own.
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git"]);

/**
 * Every Dockerfile.tpl under a directory, as configure.sh finds them (it
 * renders each one with gomplate), sorted and relative to that directory.
 * @param {string} root
 * @returns {Array<string>}
 */
function findTemplates(root) {
  const found = [];

  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          walk(path.join(directory, entry.name));
        }
      } else if (entry.isFile() && entry.name === "Dockerfile.tpl") {
        found.push(
          path
            .relative(root, path.join(directory, entry.name))
            .split(path.sep)
            .join("/"),
        );
      }
    }
  };

  walk(root);

  return found.sort();
}

module.exports = {
  DockerfileTemplateError,
  render,
  parseStages,
  ancestry,
  instructions,
  findTemplates,
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
