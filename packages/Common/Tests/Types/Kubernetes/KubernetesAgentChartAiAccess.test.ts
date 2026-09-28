import {
  AI_AGENT_POD_NAMESPACE_ENV,
  KUBECTL_ALLOW_NODE_OPERATIONS_ENV,
  KUBECTL_ALLOW_WRITES_ENV,
  KUBECTL_WRITE_NAMESPACES_ENV,
  KUBERNETES_AI_AGENT_COMPONENT,
  KUBERNETES_AI_AGENT_IMAGE_REPOSITORY,
  PROTECTED_KUBERNETES_NAMESPACES,
  RUNNER_POD_NAMESPACE_ENV,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import yaml from "js-yaml";
import path from "path";

/*
 * Contract under test — the kubernetes-agent chart and the Kubernetes AI
 * agent agree on the environment the chart hands the agent, and the chart's
 * operator-facing copy keeps up with its own template:
 *
 * - the chart sets ONEUPTIME_KUBECTL_ALLOW_WRITES,
 *   ONEUPTIME_KUBECTL_WRITE_NAMESPACES, ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS
 *   and ONEUPTIME_AI_AGENT_POD_NAMESPACE under exactly the names Common
 *   declares (the agent reads them under the same names), the pod namespace
 *   from the downward API, and the node-operations switch from the same
 *   setting that decides whether the node role is rendered — so
 *   aiAgent.remediation.nodeOperations=false reaches the agent, not only
 *   RBAC. None of the Runner's variables: the agent is not a Runner;
 * - every variable the chart sets itself is one aiAgent.extraEnv may not
 *   set: the kubelet keeps the LAST definition of a duplicate name, so an
 *   unreserved one could be silently replaced (tests/ai-agent_test.yaml
 *   renders the refusals; this pins that the list keeps up with the env);
 * - values.yaml and values.schema.json name every reserved variable, so an
 *   operator learns it before the render fails;
 * - values.yaml leaves aiAgent.remediation.* and aiAgent.extraEnv unset.
 *   The chart carries a release's stored aiAccess values over only while
 *   the matching aiAgent key is unset, and --reset-then-reuse-values would
 *   make any default there count as set: a stored write grant could then
 *   never carry over, and an explicit revoke could never be told apart;
 * - aiAccess stays in the schema, whole and marked deprecated, because
 *   `helm upgrade --reuse-values` validates a 14.0.2-14.0.8 release's
 *   stored aiAccess block against it;
 * - the pod is labelled with the component, and runs the image, that the
 *   rest of OneUptime names (KUBERNETES_AI_AGENT_COMPONENT,
 *   KUBERNETES_AI_AGENT_IMAGE_REPOSITORY);
 * - the values tables in the chart README and the Kubernetes agent docs
 *   page list every aiAgent value the schema defines, values.yaml names
 *   every protected namespace, and the README names the kubectl version
 *   the agent's image pins.
 *
 * The RBAC itself, and every aiAccess carry-over rule, is asserted by
 * rendering, in tests/ai-agent_test.yaml and tests/ai-agent-notes_test.yaml.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const CHART_DIR: string = path.join(
  REPO_ROOT,
  "HelmChart",
  "Public",
  "kubernetes-agent",
);
const TEMPLATES_DIR: string = path.join(CHART_DIR, "templates");
const TEMPLATE_PATH: string = path.join(TEMPLATES_DIR, "ai-agent.yaml");
const SETTINGS_TEMPLATE_PATH: string = path.join(
  TEMPLATES_DIR,
  "_ai-agent.tpl",
);
const NOTES_PATH: string = path.join(TEMPLATES_DIR, "NOTES.txt");
const VALUES_PATH: string = path.join(CHART_DIR, "values.yaml");
const SCHEMA_PATH: string = path.join(CHART_DIR, "values.schema.json");
const README_PATH: string = path.join(CHART_DIR, "README.md");
const TROUBLESHOOT_PATH: string = path.join(CHART_DIR, "troubleshoot.sh");
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
const RUNNER_DOCKERFILE_PATH: string = path.join(
  REPO_ROOT,
  "packages",
  "Runner",
  "Dockerfile.tpl",
);
const AGENT_DOCKERFILE_PATH: string = path.join(
  REPO_ROOT,
  "agents",
  "KubernetesAIAgent",
  "Dockerfile.tpl",
);

// Where the values.yaml block for the agent starts, and where it ends.
const VALUES_BLOCK_HEADING: string = "# Kubernetes AI agent";
const DEPRECATION_NOTE_HEADING: string = "# aiAccess (charts";
// The header row of the chart README's aiAgent.* table.
const README_TABLE_HEADER: string = "| `aiAgent.*` | Default | What it does |";

/*
 * The node-operations role renders only inside the write role's block, and
 * the helper gives allowNodeOperations only with writes on, so the env
 * switch and the role cannot disagree.
 */
const NODE_ROLE_GATE_PATTERN: RegExp =
  /\{\{- if \$allowWrites \}\}[\s\S]*\{\{- if \$allowNodeOperations \}\}[\s\S]*-ai-agent-node-operations/;

// What a Runner reads, or is told, that the agent never is.
const RUNNER_ONLY_ENV_PATTERN: RegExp =
  /^ONEUPTIME_(RUNNER_[A-Z_]+|INGESTION_KEY)$/;

// The chart's template files: manifests, helpers and NOTES.txt.
const TEMPLATE_FILE_PATTERN: RegExp = /\.(ya?ml|tpl|txt)$/;

// A read of the deprecated aiAccess block's Runner image or resources.
const AI_ACCESS_IMAGE_OR_RESOURCES_PATTERN: RegExp =
  /\$aiAccess\.(image|resources)|\.Values\.aiAccess\.(image|resources)/;

interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: Array<string>;
  additionalProperties?: boolean | JsonSchema;
  enum?: Array<string>;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
}

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function readSchema(): JsonSchema {
  return JSON.parse(read(SCHEMA_PATH)) as JsonSchema;
}

function getSchemaProperty(
  schema: JsonSchema,
  propertyPath: string,
): JsonSchema {
  let current: JsonSchema = schema;

  for (const key of propertyPath.split(".")) {
    const next: JsonSchema | undefined = current.properties?.[key];

    if (!next) {
      throw new Error(`values.schema.json has no ${propertyPath}`);
    }

    current = next;
  }

  return current;
}

// The names the Deployment's container env sets, in order.
function getChartEnvNames(template: string): Array<string> {
  const envBlock: string | undefined = template.split(/^ {10}env:$/m)[1];

  if (!envBlock) {
    throw new Error("templates/ai-agent.yaml has no container env block");
  }

  const envSection: string = envBlock.split(/^ {10}ports:$/m)[0] || "";

  return Array.from(
    envSection.matchAll(/^ {12}- name: ([A-Za-z0-9_]+)$/gm),
  ).map((match: RegExpMatchArray) => {
    return match[1]!;
  });
}

// The names the template refuses in extraEnv.
function getReservedEnvNames(template: string): Array<string> {
  return Array.from(
    template.matchAll(/set \$reservedEnv "([A-Za-z0-9_]+)"/g),
  ).map((match: RegExpMatchArray) => {
    return match[1]!;
  });
}

// "remediation.namespaces", "image.tag", ... for every leaf of a values map.
function getValueLeafKeys(value: unknown, prefix: string): Array<string> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, child]: [string, unknown]) => {
        return getValueLeafKeys(child, prefix ? `${prefix}.${key}` : key);
      },
    );
  }

  return [prefix];
}

// The same, for every leaf property a schema object declares.
function getSchemaLeafKeys(schema: JsonSchema, prefix: string): Array<string> {
  if (schema.properties) {
    return Object.entries(schema.properties).flatMap(
      ([key, child]: [string, JsonSchema]) => {
        return getSchemaLeafKeys(child, prefix ? `${prefix}.${key}` : key);
      },
    );
  }

  return [prefix];
}

// Every object schema under (and including) this one, with its path.
function getObjectSchemas(
  schema: JsonSchema,
  prefix: string,
): Array<{ path: string; schema: JsonSchema }> {
  const own: Array<{ path: string; schema: JsonSchema }> =
    schema.type === "object" ? [{ path: prefix, schema }] : [];
  const children: Array<{ path: string; schema: JsonSchema }> = Object.entries(
    schema.properties || {},
  ).flatMap(([key, child]: [string, JsonSchema]) => {
    return getObjectSchemas(child, `${prefix}.${key}`);
  });
  const items: Array<{ path: string; schema: JsonSchema }> = schema.items
    ? getObjectSchemas(schema.items, `${prefix}[]`)
    : [];

  return [...own, ...children, ...items];
}

// resources.requests.cpu and friends share one "resources" row.
function getTableRowKey(key: string): string {
  return key.startsWith("resources.") ? "resources" : key;
}

// The values.yaml text from the agent's comment block to the aiAccess deprecation note.
function getValuesAiAgentBlock(): string {
  const values: string = read(VALUES_PATH);
  const start: number = values.indexOf(VALUES_BLOCK_HEADING);

  if (start === -1) {
    throw new Error(`values.yaml has no "${VALUES_BLOCK_HEADING}" block`);
  }

  const end: number = values.indexOf(DEPRECATION_NOTE_HEADING, start);

  return values.slice(start, end === -1 ? undefined : end);
}

// The chart README's aiAgent.* table, header to the first blank line.
function getReadmeAiAgentTable(): string {
  const readme: string = read(README_PATH);
  const start: number = readme.indexOf(README_TABLE_HEADER);

  if (start === -1) {
    throw new Error("README.md has no aiAgent.* values table");
  }

  const end: number = readme.indexOf("\n\n", start);

  return readme.slice(start, end === -1 ? undefined : end);
}

function getPinnedKubectlVersion(dockerfilePath: string): string | undefined {
  return read(dockerfilePath).match(
    /^ARG KUBECTL_VERSION=(v\d+\.\d+\.\d+)$/m,
  )?.[1];
}

describe("the kubernetes-agent chart's Kubernetes AI agent environment", () => {
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

  it("replaces the in-cluster Runner's template instead of rendering both", () => {
    expect(fs.existsSync(path.join(TEMPLATES_DIR, "ai-runner.yaml"))).toBe(
      false,
    );
    expect(fs.existsSync(TEMPLATE_PATH)).toBe(true);
  });

  it("sets the write switch, the write namespaces, the node-operations switch and the pod namespace under the names the agent reads", () => {
    expect(envNames).toContain(KUBECTL_ALLOW_WRITES_ENV);
    expect(envNames).toContain(KUBECTL_WRITE_NAMESPACES_ENV);
    expect(envNames).toContain(KUBECTL_ALLOW_NODE_OPERATIONS_ENV);
    expect(envNames).toContain(AI_AGENT_POD_NAMESPACE_ENV);
  });

  it("sets none of the Runner's variables, because the agent is not a Runner", () => {
    expect(envNames).not.toContain(RUNNER_POD_NAMESPACE_ENV);
    expect(
      envNames.filter((name: string) => {
        return RUNNER_ONLY_ENV_PATTERN.test(name);
      }),
    ).toEqual([]);
  });

  it("hands the agent the collector's API key from the chart's Secret, never a literal", () => {
    expect(template).toContain(
      `- name: ONEUPTIME_API_KEY\n              valueFrom:\n                secretKeyRef:\n                  name: {{ $fullname }}\n                  key: api-key`,
    );
    expect(template).not.toContain(".Values.oneuptime.apiKey");
  });

  it("tells the agent node operations are on exactly when the node role is rendered", () => {
    /*
     * The node-operations ClusterRole renders inside `if $allowWrites` and
     * `if $allowNodeOperations`, and the env switch is the same setting, so
     * nodeOperations=false would otherwise leave an Automatic cluster
     * auto-running a cordon that the API server refuses Forbidden.
     * tests/ai-agent_test.yaml renders the combinations.
     */
    expect(template).toContain(
      `- name: ${KUBECTL_ALLOW_NODE_OPERATIONS_ENV}\n              value: {{ $allowNodeOperations | quote }}`,
    );
    expect(template).toMatch(NODE_ROLE_GATE_PATTERN);
    expect(read(SETTINGS_TEMPLATE_PATH)).toContain(
      '"allowNodeOperations" (and $allowWrites $nodeOperations)',
    );
  });

  it("takes the pod namespace from the downward API, not from a value an operator could get wrong", () => {
    expect(template).toContain(
      `- name: ${AI_AGENT_POD_NAMESPACE_ENV}\n              valueFrom:\n                fieldRef:\n                  fieldPath: metadata.namespace`,
    );
  });

  it("tells the agent exactly the namespaces it bound write access in", () => {
    expect(template).toContain(
      `- name: ${KUBECTL_WRITE_NAMESPACES_ENV}\n              value: {{ join "," $writeNamespaces | quote }}`,
    );
  });

  it("serves the health probes on the port it tells the agent to listen on", () => {
    const port: string | undefined = template.match(
      /- name: PORT\n\s+value: "(\d+)"/,
    )?.[1];

    expect(port).toBe("3876");
    expect(template).toContain(`containerPort: ${port}`);
  });

  it("reserves every variable it sets, so extraEnv can never silently replace one", () => {
    const unreserved: Array<string> = envNames.filter((name: string) => {
      return !reservedEnvNames.includes(name);
    });

    expect(unreserved).toEqual([]);
  });

  it("leaves the proxy settings to the operator", () => {
    /*
     * Proxy users carry HTTPS_PROXY / NO_PROXY over from aiAccess.extraEnv;
     * reserving them would fail those upgrades.
     */
    for (const name of [
      "HTTPS_PROXY",
      "HTTP_PROXY",
      "NO_PROXY",
      "NODE_USE_ENV_PROXY",
    ]) {
      expect({ name, reserved: reservedEnvNames.includes(name) }).toEqual({
        name,
        reserved: false,
      });
    }
  });

  it("reserves the switches with a message naming the aiAgent value to change", () => {
    expect(template).toContain(
      `set $reservedEnv "${KUBECTL_ALLOW_WRITES_ENV}" "the chart sets it from aiAgent.remediation.enabled`,
    );
    expect(template).toContain(
      `set $reservedEnv "${KUBECTL_WRITE_NAMESPACES_ENV}" "the chart sets it from aiAgent.remediation.namespaces`,
    );
    expect(template).toContain(
      `set $reservedEnv "${KUBECTL_ALLOW_NODE_OPERATIONS_ENV}" "the chart sets it from aiAgent.remediation.nodeOperations`,
    );
  });

  it("names every reserved variable in values.yaml and in the schema's aiAgent.extraEnv description", () => {
    const valuesBlock: string = getValuesAiAgentBlock();
    const schemaDescription: string =
      getSchemaProperty(readSchema(), "aiAgent.extraEnv").description || "";

    for (const name of reservedEnvNames) {
      expect({ name, inValuesYaml: valuesBlock.includes(name) }).toEqual({
        name,
        inValuesYaml: true,
      });
      expect({
        name,
        inSchema: schemaDescription.includes(name),
      }).toEqual({ name, inSchema: true });
    }
  });

  it("labels every object with the component the rest of OneUptime names", () => {
    const labels: Array<string> = Array.from(
      template.matchAll(/^\s+component: ([a-z-]+)$/gm),
    ).map((match: RegExpMatchArray) => {
      return match[1]!;
    });

    /*
     * ServiceAccount, three ClusterRoles, their bindings, the RoleBinding
     * range, the Deployment, its selector and its pod template.
     */
    expect(labels.length).toBeGreaterThanOrEqual(10);
    expect(Array.from(new Set(labels))).toEqual([
      KUBERNETES_AI_AGENT_COMPONENT,
    ]);
  });

  it("falls back to the image the rest of OneUptime names, the same one values.yaml sets", () => {
    const values: { aiAgent: { image: { repository: string } } } = yaml.load(
      read(VALUES_PATH),
    ) as { aiAgent: { image: { repository: string } } };

    expect(template).toContain(
      `$image.repository | default "${KUBERNETES_AI_AGENT_IMAGE_REPOSITORY}"`,
    );
    expect(values.aiAgent.image.repository).toBe(
      KUBERNETES_AI_AGENT_IMAGE_REPOSITORY,
    );
  });

  it("reads the deprecated aiAccess values in one place only, and never its image or resources", () => {
    /*
     * On 14.0.2-14.0.8 releases aiAccess.image is always the Runner image
     * and aiAccess.resources the Runner's defaults, so reading either would
     * deploy the wrong pod. Only the settings helper may read aiAccess, so
     * the template and NOTES can never disagree about a carried-over value.
     */
    const templateFiles: Array<string> = fs
      .readdirSync(TEMPLATES_DIR)
      .filter((name: string) => {
        return TEMPLATE_FILE_PATTERN.test(name);
      });

    for (const name of templateFiles) {
      const text: string = read(path.join(TEMPLATES_DIR, name));

      expect({
        name,
        readsAiAccess: text.includes(".Values.aiAccess"),
      }).toEqual({ name, readsAiAccess: name === "_ai-agent.tpl" });
      expect({
        name,
        readsRunnerImageOrResources:
          AI_ACCESS_IMAGE_OR_RESOURCES_PATTERN.test(text),
      }).toEqual({ name, readsRunnerImageOrResources: false });
    }
  });

  it("points NOTES.txt at the agent's pod, not the Runner's", () => {
    const notes: string = read(NOTES_PATH);

    expect(notes).toContain(`-l component=${KUBERNETES_AI_AGENT_COMPONENT}`);
    expect(notes).toContain(
      'include "kubernetes-agent.aiAgent.settings" . | fromJson',
    );
    expect(notes).not.toContain("ai-runner");
    expect(notes).not.toContain("--set aiAccess");
  });

  it("tells troubleshoot.sh to read the agent's own container on a crash loop", () => {
    const script: string = read(TROUBLESHOOT_PATH);

    expect(script).toContain(
      `[ "$component" = "${KUBERNETES_AI_AGENT_COMPONENT}" ] && container="ai-agent"`,
    );
    expect(script).toContain(
      "Inspect: kubectl logs -n $NS $pod -c $container --previous",
    );
    // Its image is the one a mirror most often lacks; say how to fix or skip it.
    expect(script).toContain("aiAgent.image.repository");
    expect(script).toContain("--set aiAgent.enabled=false");
  });
});

describe("the kubernetes-agent chart's aiAgent values and schema", () => {
  const values: Record<string, unknown> = yaml.load(
    read(VALUES_PATH),
  ) as Record<string, unknown>;
  const aiAgent: Record<string, unknown> = values["aiAgent"] as Record<
    string,
    unknown
  >;
  const schema: JsonSchema = readSchema();
  const aiAgentSchema: JsonSchema = getSchemaProperty(schema, "aiAgent");
  const schemaLeafKeys: Array<string> = getSchemaLeafKeys(aiAgentSchema, "");

  it("reads the aiAgent values and schema it compares against", () => {
    expect(schemaLeafKeys).toEqual(
      expect.arrayContaining([
        "enabled",
        "remediation.enabled",
        "remediation.namespaces",
        "remediation.nodeOperations",
        "image.repository",
        "image.tag",
        "image.pullPolicy",
        "imagePullSecrets",
        "resources.requests.cpu",
        "extraEnv",
      ]),
    );
  });

  it("sets only the keys that are safe to store, leaving remediation and extraEnv to the aiAccess carry-over", () => {
    expect(Object.keys(aiAgent).sort()).toEqual([
      "enabled",
      "image",
      "imagePullSecrets",
      "resources",
    ]);
  });

  it("is on by default, tracks the moving release tag, and asks for little", () => {
    expect(aiAgent).toEqual({
      enabled: true,
      image: {
        repository: KUBERNETES_AI_AGENT_IMAGE_REPOSITORY,
        // Empty tag = the moving `release`; empty pullPolicy = Always for it.
        tag: "",
        pullPolicy: "",
      },
      imagePullSecrets: [],
      resources: {
        requests: { cpu: "50m", memory: "64Mi" },
        limits: { cpu: "500m", memory: "256Mi" },
      },
    });
  });

  it("documents the unset keys, with their effective defaults, as commented keys", () => {
    const block: string = getValuesAiAgentBlock();

    for (const line of [
      "  # remediation:",
      "  #   enabled: false",
      "  #   namespaces: []",
      "  #   nodeOperations: true",
      "  # extraEnv: []",
    ]) {
      expect({ line, documented: block.includes(`\n${line}\n`) }).toEqual({
        line,
        documented: true,
      });
    }
  });

  it("no longer sets aiAccess, and says what replaced it", () => {
    expect(values).not.toHaveProperty("aiAccess");
    expect(read(VALUES_PATH)).toContain(
      `${DEPRECATION_NOTE_HEADING} 14.0.2 to 14.0.8) is deprecated: use aiAgent.`,
    );
  });

  it("declares every value values.yaml sets", () => {
    for (const key of getValueLeafKeys(aiAgent, "")) {
      expect({ key, declared: schemaLeafKeys.includes(key) }).toEqual({
        key,
        declared: true,
      });
    }
  });

  it("refuses unknown keys at every level of aiAgent", () => {
    for (const object of getObjectSchemas(aiAgentSchema, "aiAgent")) {
      /*
       * extraEnv[].valueFrom is a Kubernetes EnvVarSource, passed through
       * as-is.
       */
      if (!object.schema.properties) {
        continue;
      }

      expect({
        path: object.path,
        additionalProperties: object.schema.additionalProperties,
      }).toEqual({ path: object.path, additionalProperties: false });
    }
  });

  it("takes only Kubernetes namespace names, the same rule the deprecated aiAccess list had", () => {
    const namespaces: JsonSchema = getSchemaProperty(
      schema,
      "aiAgent.remediation.namespaces",
    );

    expect(namespaces.type).toBe("array");
    expect(namespaces.items).toEqual({
      type: "string",
      minLength: 1,
      maxLength: 63,
      pattern: "^[a-z0-9]([-a-z0-9]*[a-z0-9])?$",
    });
    expect(
      getSchemaProperty(schema, "aiAccess.remediation.namespaces").items,
    ).toEqual(namespaces.items);
  });

  it("types the switches as booleans, so --set 'true' cannot pass as a truthy string", () => {
    for (const key of [
      "aiAgent.enabled",
      "aiAgent.remediation.enabled",
      "aiAgent.remediation.nodeOperations",
    ]) {
      expect({ key, type: getSchemaProperty(schema, key).type }).toEqual({
        key,
        type: "boolean",
      });
    }
  });

  it("takes image pull secrets as Kubernetes LocalObjectReferences", () => {
    expect(getSchemaProperty(schema, "aiAgent.imagePullSecrets")).toMatchObject(
      {
        type: "array",
        items: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string", minLength: 1 } },
          additionalProperties: false,
        },
      },
    );
  });

  it("takes only the pull policies Kubernetes knows, or empty for the default", () => {
    expect(getSchemaProperty(schema, "aiAgent.image.pullPolicy").enum).toEqual([
      "",
      "Always",
      "IfNotPresent",
      "Never",
    ]);
  });

  it("keeps the whole deprecated aiAccess block, so a 14.0.x release's stored values still validate", () => {
    const aiAccess: JsonSchema = getSchemaProperty(schema, "aiAccess");

    expect(aiAccess.description).toMatch(/^Deprecated: use aiAgent\./);
    expect(aiAccess.additionalProperties).toBe(false);
    expect(getSchemaLeafKeys(aiAccess, "").sort()).toEqual(
      [
        "enabled",
        "extraEnv",
        "image.pullPolicy",
        "image.repository",
        "image.tag",
        "remediation.enabled",
        "remediation.namespaces",
        "remediation.nodeOperations",
        "resources.limits.cpu",
        "resources.limits.memory",
        "resources.requests.cpu",
        "resources.requests.memory",
      ].sort(),
    );
    // Every value a 14.0.x release stored is one this schema accepts.
    expect(getSchemaProperty(schema, "aiAccess.image.pullPolicy").enum).toEqual(
      ["", "Always", "IfNotPresent", "Never"],
    );
    expect(getSchemaProperty(schema, "aiAccess.extraEnv").items).toEqual(
      getSchemaProperty(schema, "aiAgent.extraEnv").items,
    );
  });

  it("names every protected namespace where it explains the cluster-wide binding", () => {
    // Only the agent's block: coreDns already mentions kube-system.
    const block: string = getValuesAiAgentBlock();

    for (const namespace of PROTECTED_KUBERNETES_NAMESPACES) {
      expect({ namespace, named: block.includes(namespace) }).toEqual({
        namespace,
        named: true,
      });
    }
  });
});

describe("the kubernetes-agent chart's aiAgent tables", () => {
  const schemaLeafKeys: Array<string> = getSchemaLeafKeys(
    getSchemaProperty(readSchema(), "aiAgent"),
    "",
  );

  it("lists every aiAgent value in the chart README's table", () => {
    const table: string = getReadmeAiAgentTable();
    const firstCells: Array<string> = table
      .split("\n")
      .slice(2)
      .map((row: string) => {
        return row.split(" | ")[0] || "";
      });

    for (const key of schemaLeafKeys) {
      const rowKey: string = getTableRowKey(key);

      expect({
        key,
        listed: firstCells.some((cell: string) => {
          return cell.includes(`\`${rowKey}\``);
        }),
      }).toEqual({ key, listed: true });
    }
  });

  it("gives every README row a default and an explanation", () => {
    const rows: Array<string> = getReadmeAiAgentTable().split("\n").slice(2);

    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const cells: Array<string> = row
        .split(" | ")
        .map((cell: string) => {
          return cell.replace(/^\|\s*|\s*\|$/g, "").trim();
        })
        .filter(Boolean);

      expect({ row, cells: cells.length }).toEqual({ row, cells: 3 });
    }
  });

  it("lists every aiAgent value in the Kubernetes agent docs page's table", () => {
    const doc: string = read(TELEMETRY_DOC_PATH);

    for (const key of schemaLeafKeys) {
      const rowKey: string = `aiAgent.${getTableRowKey(key)}`;

      expect({ key, listed: doc.includes(`\`${rowKey}\``) }).toEqual({
        key,
        listed: true,
      });
    }
  });
});

describe("the kubectl version the chart README names", () => {
  const named: Array<string> = Array.from(
    read(README_PATH).matchAll(/pinned kubectl \((v\d+\.\d+\.\d+)\)/g),
  ).map((match: RegExpMatchArray) => {
    return match[1]!;
  });

  it("names one", () => {
    expect(named.length).toBeGreaterThan(0);
    expect(new Set(named).size).toBe(1);
  });

  it("is the one the Runner image pins", () => {
    expect(named[0]).toBe(getPinnedKubectlVersion(RUNNER_DOCKERFILE_PATH));
  });

  it("is the one the Kubernetes AI agent image pins", () => {
    // The README describes the agent's kubectl; both images pin one version.
    expect(named[0]).toBe(getPinnedKubectlVersion(AGENT_DOCKERFILE_PATH));
  });
});
