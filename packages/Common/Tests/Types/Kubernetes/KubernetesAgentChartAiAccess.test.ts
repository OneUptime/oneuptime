import {
  KUBECTL_ALLOW_NODE_OPERATIONS_ENV,
  KUBECTL_ALLOW_WRITES_ENV,
  KUBECTL_WRITE_NAMESPACES_ENV,
  KUBERNETES_AGENT_RUNNER_NAME_PREFIX,
  PROTECTED_KUBERNETES_NAMESPACES,
  RUNNER_POD_NAMESPACE_ENV,
  isKubernetesAgentRunnerName,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import yaml from "js-yaml";
import path from "path";

/*
 * Contract under test — the kubernetes-agent chart and the Runner agree on
 * the environment the chart hands the in-cluster Runner, and the chart's
 * operator-facing copy keeps up with its own template:
 *
 * - the chart sets ONEUPTIME_KUBECTL_ALLOW_WRITES,
 *   ONEUPTIME_KUBECTL_WRITE_NAMESPACES, ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS
 *   and ONEUPTIME_RUNNER_POD_NAMESPACE under exactly the names Common
 *   declares (the Runner reads them through the same constants), the pod
 *   namespace from the downward API, and the node-operations switch from
 *   the same two values that decide whether the node role is rendered — so
 *   aiAccess.remediation.nodeOperations=false reaches the Runner, not only
 *   RBAC;
 * - every variable the chart sets itself is one aiAccess.extraEnv may not
 *   set: the kubelet keeps the LAST definition of a duplicate name, so an
 *   unreserved one could be silently replaced (tests/ai-runner_test.yaml
 *   renders the refusal; this pins that the list keeps up with the env);
 * - values.yaml and values.schema.json name every reserved variable, so an
 *   operator learns it before the render fails;
 * - the Runner row the chart registers is one the server recognises as the
 *   agent's own (isKubernetesAgentRunnerName);
 * - the values tables in the chart README and the Kubernetes agent docs
 *   page list every aiAccess value values.yaml defines, and values.yaml
 *   names every protected namespace.
 *
 * The RBAC itself is asserted by rendering, in tests/ai-runner_test.yaml.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const CHART_DIR: string = path.join(
  REPO_ROOT,
  "HelmChart",
  "Public",
  "kubernetes-agent",
);
const TEMPLATE_PATH: string = path.join(
  CHART_DIR,
  "templates",
  "ai-runner.yaml",
);
const VALUES_PATH: string = path.join(CHART_DIR, "values.yaml");
const SCHEMA_PATH: string = path.join(CHART_DIR, "values.schema.json");
const README_PATH: string = path.join(CHART_DIR, "README.md");
const TELEMETRY_DOC_PATH: string = path.join(
  REPO_ROOT,
  "packages",
  "App",
  "FeatureSet",
  "Docs",
  "Content",
  "en",
  "telemetry",
  "kubernetes-agent.md",
);

// The node-operations role renders only inside both switches.
const NODE_ROLE_GATE_PATTERN: RegExp =
  /\{\{- if \$allowWrites \}\}[\s\S]*\{\{- if \$nodeOperations \}\}[\s\S]*-ai-runner-node-operations/;

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

// The names the Deployment's container env sets, in order.
function getChartEnvNames(template: string): Array<string> {
  const envBlock: string | undefined = template.split(/^ {10}env:$/m)[1];

  if (!envBlock) {
    throw new Error("templates/ai-runner.yaml has no container env block");
  }

  const envSection: string = envBlock.split(/^ {10}ports:$/m)[0] || "";

  return Array.from(
    envSection.matchAll(/^ {12}- name: ([A-Za-z0-9_]+)$/gm),
  ).map((match: RegExpMatchArray) => {
    return match[1]!;
  });
}

// The names the template refuses in aiAccess.extraEnv.
function getReservedEnvNames(template: string): Array<string> {
  return Array.from(
    template.matchAll(/set \$reservedEnv "([A-Za-z0-9_]+)"/g),
  ).map((match: RegExpMatchArray) => {
    return match[1]!;
  });
}

// "remediation.namespaces", "image.tag", ... for every leaf under aiAccess.
function getLeafKeys(value: unknown, prefix: string): Array<string> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, child]: [string, unknown]) => {
        return getLeafKeys(child, prefix ? `${prefix}.${key}` : key);
      },
    );
  }

  return [prefix];
}

describe("the kubernetes-agent chart's Runner environment", () => {
  const template: string = read(TEMPLATE_PATH);
  const envNames: Array<string> = getChartEnvNames(template);
  const reservedEnvNames: Array<string> = getReservedEnvNames(template);

  it("parses the env block it asserts on", () => {
    /*
     * A guard for the helpers: a template reshuffle that hides the env
     * block must fail here, not make every assertion below vacuous.
     */
    expect(envNames).toContain("ONEUPTIME_URL");
    expect(envNames).toContain("PORT");
    expect(reservedEnvNames.length).toBeGreaterThanOrEqual(envNames.length);
  });

  it("sets the write switch, the write namespaces, the node-operations switch and the pod namespace under the names the Runner reads", () => {
    expect(envNames).toContain(KUBECTL_ALLOW_WRITES_ENV);
    expect(envNames).toContain(KUBECTL_WRITE_NAMESPACES_ENV);
    expect(envNames).toContain(KUBECTL_ALLOW_NODE_OPERATIONS_ENV);
    expect(envNames).toContain(RUNNER_POD_NAMESPACE_ENV);
  });

  it("tells the Runner node operations are on exactly when the node role is rendered", () => {
    /*
     * The node-operations ClusterRole renders inside `if $allowWrites` and
     * `if $nodeOperations`, so the switch must be both: nodeOperations=false
     * would otherwise leave an Automatic cluster auto-running a cordon that
     * the API server refuses Forbidden. tests/ai-runner_test.yaml renders
     * the four combinations.
     */
    expect(template).toContain(
      `- name: ${KUBECTL_ALLOW_NODE_OPERATIONS_ENV}\n              value: {{ and $allowWrites $nodeOperations | quote }}`,
    );
    expect(template).toMatch(NODE_ROLE_GATE_PATTERN);
  });

  it("takes the pod namespace from the downward API, not from a value an operator could get wrong", () => {
    expect(template).toContain(
      `- name: ${RUNNER_POD_NAMESPACE_ENV}\n              valueFrom:\n                fieldRef:\n                  fieldPath: metadata.namespace`,
    );
  });

  it("tells the Runner exactly the namespaces it bound write access in", () => {
    expect(template).toContain(
      `- name: ${KUBECTL_WRITE_NAMESPACES_ENV}\n              value: {{ join "," $writeNamespaces | quote }}`,
    );
  });

  it("reserves every variable it sets, so aiAccess.extraEnv can never silently replace one", () => {
    const unreserved: Array<string> = envNames.filter((name: string) => {
      return !reservedEnvNames.includes(name);
    });

    expect(unreserved).toEqual([]);
  });

  it("reserves the node-operations switch with a message naming the values to change", () => {
    expect(reservedEnvNames).toContain(KUBECTL_ALLOW_NODE_OPERATIONS_ENV);
    expect(template).toContain(
      `set $reservedEnv "${KUBECTL_ALLOW_NODE_OPERATIONS_ENV}" "the chart sets it from aiAccess.remediation.nodeOperations`,
    );
  });

  it("also reserves the dashboard-issued Runner identity, which would take the Runner out of kubernetes-agent mode", () => {
    expect(reservedEnvNames).toContain("ONEUPTIME_RUNNER_ID");
    expect(reservedEnvNames).toContain("ONEUPTIME_RUNNER_KEY");
  });

  it("names every reserved variable in values.yaml and in the schema description", () => {
    const values: string = read(VALUES_PATH);
    const schema: {
      properties: {
        aiAccess: { properties: { extraEnv: { description: string } } };
      };
    } = JSON.parse(read(SCHEMA_PATH));
    const schemaDescription: string =
      schema.properties.aiAccess.properties.extraEnv.description;

    for (const name of reservedEnvNames) {
      expect({ name, inValuesYaml: values.includes(name) }).toEqual({
        name,
        inValuesYaml: true,
      });
      expect({
        name,
        inSchema: schemaDescription.includes(name),
      }).toEqual({ name, inSchema: true });
    }
  });

  it("registers the Runner under a name the server recognises as the agent's own", () => {
    const runnerName: RegExpMatchArray | null = template.match(
      /- name: ONEUPTIME_RUNNER_NAME\n\s+value: "([^"{]+)\{\{/,
    );

    expect(runnerName?.[1]).toBe(`${KUBERNETES_AGENT_RUNNER_NAME_PREFIX}/`);
    expect(isKubernetesAgentRunnerName(`${runnerName?.[1]}prod-us`)).toBe(true);
  });
});

describe("the kubernetes-agent chart's aiAccess copy", () => {
  const values: Record<string, unknown> = yaml.load(
    read(VALUES_PATH),
  ) as Record<string, unknown>;
  const aiAccessKeys: Array<string> = getLeafKeys(values["aiAccess"], "");

  it("reads the aiAccess values it compares against", () => {
    expect(aiAccessKeys).toEqual(
      expect.arrayContaining([
        "enabled",
        "remediation.enabled",
        "remediation.namespaces",
        "remediation.nodeOperations",
        "image.repository",
        "image.tag",
        "image.pullPolicy",
        "extraEnv",
      ]),
    );
  });

  it("lists every aiAccess value in the chart README's table", () => {
    const readme: string = read(README_PATH);

    for (const key of aiAccessKeys) {
      // resources.requests.cpu and friends share one "resources" row.
      const rowKey: string = key.startsWith("resources.") ? "resources" : key;
      expect({ key, listed: readme.includes(`\`${rowKey}\``) }).toEqual({
        key,
        listed: true,
      });
    }
  });

  it("lists every aiAccess value in the Kubernetes agent docs page's table", () => {
    const doc: string = read(TELEMETRY_DOC_PATH);

    for (const key of aiAccessKeys) {
      const rowKey: string = key.startsWith("resources.")
        ? "aiAccess.resources"
        : `aiAccess.${key}`;
      expect({ key, listed: doc.includes(`\`${rowKey}\``) }).toEqual({
        key,
        listed: true,
      });
    }
  });

  it("defaults to read-only, cluster-wide binding when remediation is on, and node operations on", () => {
    const aiAccess: {
      enabled: boolean;
      remediation: {
        enabled: boolean;
        namespaces: Array<string>;
        nodeOperations: boolean;
      };
      image: { tag: string; pullPolicy: string };
    } = values["aiAccess"] as never;

    expect(aiAccess.enabled).toBe(false);
    expect(aiAccess.remediation).toEqual({
      enabled: false,
      namespaces: [],
      nodeOperations: true,
    });
    // Empty tag = the moving `release`; empty pullPolicy = Always for it.
    expect(aiAccess.image.tag).toBe("");
    expect(aiAccess.image.pullPolicy).toBe("");
  });

  it("names every protected namespace where it explains the cluster-wide default", () => {
    // Only the aiAccess block: coreDns already mentions kube-system.
    const valuesText: string = read(VALUES_PATH);
    const blockStart: number = valuesText.indexOf("# OneUptime AI access");

    expect(blockStart).toBeGreaterThan(-1);

    const aiAccessComments: string = valuesText.slice(blockStart);

    for (const namespace of PROTECTED_KUBERNETES_NAMESPACES) {
      expect({
        namespace,
        named: aiAccessComments.includes(namespace),
      }).toEqual({
        namespace,
        named: true,
      });
    }
  });
});
