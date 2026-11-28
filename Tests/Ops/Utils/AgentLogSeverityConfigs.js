"use strict";

/**
 * Where the agents' log severity chain lives, read the way the suites that
 * hold it need it:
 *
 *   - the three container agents' collector configs (DockerAgent,
 *     PodmanAgent, DockerSwarmAgent), parsed whole;
 *   - the Kubernetes agent's DaemonSet ConfigMap, a Helm template, from which
 *     only the chain is lifted (it is plain YAML; the template around it is
 *     not);
 *   - the Kubernetes agent's API-mode tailer, whose severity numbers are a
 *     TypeScript object literal (agents/KubernetesLogTailer/OTLPBatcher.ts);
 *   - OneUptime's own TypeScript modules that import nothing but each other,
 *     loaded as the modules they are, so a suite holds the agents to the
 *     table ingest reads rather than to a copy of it.
 *
 * ContainerAgentLogSeverity.test.js reads the chain's behaviour through
 * these, and LogSeverityOneTable.test.js holds every copy of the level words
 * to one table.
 */

const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** The three agents whose `filelog` receiver carries the severity chain. */
const AGENTS = ["DockerAgent", "PodmanAgent", "DockerSwarmAgent"];

/**
 * The Kubernetes agent grew this chain first. It lives in a Helm template, so
 * it cannot be parsed as YAML wholesale; the chain itself is plain YAML and is
 * lifted out textually below.
 */
const KUBERNETES_CONFIGMAP_PATH = path.join(
  REPO_ROOT,
  "HelmChart",
  "Public",
  "kubernetes-agent",
  "templates",
  "configmap-daemonset.yaml",
);

const KUBERNETES_SOURCE = "the Kubernetes agent's DaemonSet";

const TAILER_PATH = path.join(
  REPO_ROOT,
  "agents",
  "KubernetesLogTailer",
  "OTLPBatcher.ts",
);

function agentConfigPath(agent) {
  return path.join(REPO_ROOT, "agents", agent, "otel-collector-config.yaml");
}

function readAgentConfig(agent) {
  return yaml.load(fs.readFileSync(agentConfigPath(agent), "utf8"));
}

function readAgentOperators(agent) {
  const operators = readAgentConfig(agent).receivers.filelog.operators;

  if (!Array.isArray(operators) || operators.length === 0) {
    throw new Error(`${agent}: receivers.filelog.operators is empty`);
  }

  return operators;
}

/**
 * Lift the severity chain out of the Kubernetes agent's Helm template as text
 * and parse just that block.
 *
 * Deliberately strict: if a `{{ … }}` action ever appears inside the block the
 * extraction stops and the lockstep test fails loudly, rather than quietly
 * comparing half a chain.
 */
function readKubernetesOperators() {
  const lines = fs.readFileSync(KUBERNETES_CONFIGMAP_PATH, "utf8").split("\n");
  const start = lines.findIndex((line, index) => {
    return (
      /^\s*- type: router\s*$/.test(line) &&
      /^\s*id: severity-router\s*$/.test(lines[index + 1] || "")
    );
  });

  if (start === -1) {
    throw new Error(
      `${KUBERNETES_CONFIGMAP_PATH}: no 'severity-router' operator found`,
    );
  }

  const markerIndent = lines[start].length - lines[start].trimStart().length;
  const block = [];

  for (let index = start; index < lines.length; index++) {
    const line = lines[index];

    if (line.trim() === "") {
      continue;
    }

    if (line.includes("{{")) {
      break;
    }

    const indent = line.length - line.trimStart().length;

    if (indent < markerIndent) {
      break;
    }

    block.push(line.slice(markerIndent));
  }

  return yaml.load(block.join("\n"));
}

/**
 * Every config the chain ships in: an agent's whole operator list, or the
 * Kubernetes agent's chain on its own.
 */
function readChainConfigs() {
  return new Map([
    ...AGENTS.map((agent) => {
      return [agent, readAgentOperators(agent)];
    }),
    [KUBERNETES_SOURCE, readKubernetesOperators()],
  ]);
}

/**
 * The API-mode tailer's `severityTextToNumber`, as {TEXT: number}. Read as
 * text: the tailer is its own package, built on its own, and its module reads
 * the environment when it loads. The literal is one `KEY: number,` per line
 * (a key that is not an identifier quoted), with comments between.
 */
function readTailerSeverityNumbers() {
  const source = fs.readFileSync(TAILER_PATH, "utf8");
  const opening =
    "export const severityTextToNumber: Record<string, number> = {";
  const start = source.indexOf(opening);

  if (start === -1) {
    throw new Error(`${TAILER_PATH}: no ${opening}`);
  }

  const end = source.indexOf("\n};", start);
  const numbers = {};

  for (const rawLine of source.slice(start + opening.length, end).split("\n")) {
    const line = rawLine.trim();

    if (line === "" || line.startsWith("//")) {
      continue;
    }

    const entry = /^(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*)): (\d+),$/.exec(line);

    if (!entry) {
      throw new Error(`${TAILER_PATH}: unparsed severity number line: ${line}`);
    }

    const key = entry[1] === undefined ? entry[2] : entry[1];

    if (Object.prototype.hasOwnProperty.call(numbers, key)) {
      throw new Error(`${TAILER_PATH}: ${key} is numbered twice`);
    }

    numbers[key] = Number(entry[3]);
  }

  return numbers;
}

/*
 * A TypeScript module of OneUptime's, loaded as the module it is: transpiled
 * to CommonJS and compiled with a `require` that loads the relative imports
 * it makes the same way. Any other import is refused, so a module that grows
 * one fails here by name rather than loading something else.
 */
const loadedModules = new Map();

function loadTypeScriptModule(file) {
  const resolved = path.resolve(file);

  if (loadedModules.has(resolved)) {
    return loadedModules.get(resolved).exports;
  }

  const { outputText } = ts.transpileModule(fs.readFileSync(resolved, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: resolved,
  });
  const loaded = new Module(resolved);

  loaded.filename = resolved;
  loaded.paths = [];
  loaded.require = (request) => {
    if (!request.startsWith(".")) {
      throw new Error(
        `${path.relative(REPO_ROOT, resolved)} imports ${request}, which this loader does not load`,
      );
    }

    return loadTypeScriptModule(
      path.resolve(path.dirname(resolved), `${request}.ts`),
    );
  };
  loadedModules.set(resolved, loaded);
  loaded._compile(outputText, resolved);

  return loaded.exports;
}

function loadCommonModule(relativePath) {
  return loadTypeScriptModule(
    path.join(REPO_ROOT, "packages", "Common", relativePath),
  );
}

module.exports = {
  AGENTS,
  KUBERNETES_CONFIGMAP_PATH,
  KUBERNETES_SOURCE,
  REPO_ROOT,
  TAILER_PATH,
  agentConfigPath,
  loadCommonModule,
  loadTypeScriptModule,
  readAgentConfig,
  readAgentOperators,
  readChainConfigs,
  readKubernetesOperators,
  readTailerSeverityNumbers,
};
