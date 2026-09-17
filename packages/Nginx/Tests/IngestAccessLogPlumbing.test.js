/**
 * The ingest access-logging switch is only a switch if an operator can reach
 * it.
 *
 * NGINX_INGEST_ACCESS_LOG is read by conf.d/default.conf, but the ingress
 * container's environment is written in two places and neither is in this
 * directory: the `ingress` service in docker-compose.base.yml, and the nginx
 * Deployment in the Helm chart (whose value comes from values.yaml and has to
 * be declared in values.schema.json, because the chart's `nginx` block sets
 * "additionalProperties": false and Helm rejects an undeclared key outright).
 *
 * These tests walk that path end to end so the knob cannot ship unreachable.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { NGINX_DIRECTORY, readTemplate } = require("./NginxConfigParser");

const REPOSITORY_ROOT = path.resolve(NGINX_DIRECTORY, "..");

const ENVIRONMENT_VARIABLE = "NGINX_INGEST_ACCESS_LOG";
const HELM_VALUE_PATH = "nginx.ingestAccessLog";

const template = readTemplate();

function readRepositoryFile(relativePath) {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), "utf8");
}

const dockerCompose = readRepositoryFile("docker-compose.base.yml");
const helmNginxTemplate = readRepositoryFile(
  "HelmChart/Public/oneuptime/templates/nginx.yaml",
);
const helmValues = readRepositoryFile("HelmChart/Public/oneuptime/values.yaml");
const helmValuesSchema = JSON.parse(
  readRepositoryFile("HelmChart/Public/oneuptime/values.schema.json"),
);

/**
 * Take the lines of a YAML block whose key sits at `indent` spaces, stopping at
 * the next key at that same indent or shallower. Enough for "the environment
 * block of the ingress service" without pulling a YAML parser into a package
 * that has none.
 */
function yamlBlock(source, keyPattern, indent) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => {
    return new RegExp(`^ {${indent}}${keyPattern}:`).test(line);
  });

  assert.notEqual(start, -1, `could not find a "${keyPattern}:" block`);

  const body = [];

  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || /^\s*#/.test(line)) {
      body.push(line);
      continue;
    }

    if (!new RegExp(`^ {${indent + 1},}\\S`).test(line)) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

/** The values the template's map turns into 0, i.e. "stop logging". */
function offValues() {
  const mapBody = template.match(
    /map\s+"\$\{NGINX_INGEST_ACCESS_LOG\}"\s+\$ingest_access_log\s*\{([^}]*)\}/,
  );

  assert.ok(mapBody, "expected the ingest map in the template");

  return [...mapBody[1].matchAll(/^\s*"([^"]*)"\s+0\s*;/gm)].map((match) => {
    return match[1];
  });
}

test("the template reads exactly the variable everything else supplies", () => {
  assert.ok(
    template.includes(`map "\${${ENVIRONMENT_VARIABLE}}" $ingest_access_log {`),
    "the template's map must be keyed on the environment variable being plumbed",
  );
});

test("the compose ingress service passes the switch through, defaulting to on", () => {
  const ingressService = yamlBlock(dockerCompose, "ingress", 2);
  const environment = yamlBlock(ingressService, "environment", 4);

  const declaration = environment
    .split("\n")
    .map((line) => {
      return line.trim();
    })
    .find((line) => {
      return line.startsWith(`${ENVIRONMENT_VARIABLE}:`);
    });

  assert.ok(
    declaration,
    `the ingress service does not pass ${ENVIRONMENT_VARIABLE} to the container, so config.env cannot reach nginx`,
  );

  // "${VAR:-on}" rather than a bare "${VAR}": the variable is deliberately
  // absent from config.env, and a bare reference would make every compose
  // command warn and would hand the container an empty value.
  const match = declaration.match(
    new RegExp(
      `^${ENVIRONMENT_VARIABLE}:\\s*\\$\\{${ENVIRONMENT_VARIABLE}:-([^}]*)\\}$`,
    ),
  );

  assert.ok(match, `unexpected declaration: ${declaration}`);
  assert.ok(
    !offValues().includes(match[1]),
    `the compose default "${match[1]}" disables ingest logging; the default must preserve today's behaviour`,
  );
});

test("the Helm nginx container gets the switch from values.yaml", () => {
  const envEntry = helmNginxTemplate.match(
    new RegExp(`- name: ${ENVIRONMENT_VARIABLE}\\n\\s*value: (.*)\\n`),
  );

  assert.ok(
    envEntry,
    `the nginx Deployment does not set ${ENVIRONMENT_VARIABLE}, so the chart value would never reach the container`,
  );

  const valueExpression = envEntry[1];

  assert.ok(
    valueExpression.includes(`$.Values.${HELM_VALUE_PATH}`),
    `the env value must come from ${HELM_VALUE_PATH}: ${valueExpression}`,
  );
  assert.ok(
    valueExpression.includes("| quote"),
    `the env value must be quoted, or a YAML-boolean value would render bare: ${valueExpression}`,
  );

  const helmDefault = valueExpression.match(/default\s+"([^"]*)"/);

  assert.ok(helmDefault, `expected a fail-safe default: ${valueExpression}`);
  assert.ok(
    !offValues().includes(helmDefault[1]),
    `the chart default "${helmDefault[1]}" disables ingest logging`,
  );
});

test("values.yaml ships the switch on, and ships it quoted", () => {
  const nginxValues = yamlBlock(helmValues, "nginx", 0);

  const declaration = nginxValues
    .split("\n")
    .map((line) => {
      return line.trim();
    })
    .find((line) => {
      return line.startsWith("ingestAccessLog:");
    });

  assert.ok(declaration, "values.yaml has no nginx.ingestAccessLog key");

  // Unquoted `on` is a YAML 1.1 boolean, which is what Helm's loader speaks.
  // It would reach the container as "true" -- harmless today because the map
  // only disables on explicit off values, but it is not what it says.
  const match = declaration.match(/^ingestAccessLog:\s*"([^"]*)"$/);

  assert.ok(
    match,
    `nginx.ingestAccessLog must be a quoted string: ${declaration}`,
  );
  assert.ok(
    !offValues().includes(match[1]),
    `values.yaml ships ingest logging disabled ("${match[1]}")`,
  );
});

test("values.schema.json declares the key, or Helm would reject values.yaml", () => {
  const nginxSchema = helmValuesSchema.properties.nginx;

  // Without this, `helm install` fails schema validation on the chart's own
  // default values -- the nginx block is closed.
  assert.equal(
    nginxSchema.additionalProperties,
    false,
    "the nginx block is expected to be closed; if that changed, this test's premise did too",
  );

  assert.deepEqual(nginxSchema.properties.ingestAccessLog, {
    type: "string",
  });
});
