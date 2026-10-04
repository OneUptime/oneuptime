import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import slugify from "Common/Server/Types/MarkdownSlugify";
import {
  CLUSTER_NAME_PLACEHOLDER,
  getAllKubernetesMetricsSetups,
  getKubernetesMetricsSetupCommand,
  IN_CLUSTER_API_SERVER_METRICS_URL,
  KUBERNETES_AGENT_DOCS_ROUTE,
  KUBERNETES_CLUSTER_NAME_ATTRIBUTE,
  KubernetesMetricsSetup,
  KubernetesMetricsSource,
} from "../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesMetricsSetup";
import {
  KUBERNETES_AGENT_HELM_NAMESPACE,
  KUBERNETES_AGENT_HELM_RELEASE,
} from "../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";

/*
 * What the Kubernetes Control Plane and Service Mesh tabs tell a reader to
 * set when their charts come back empty, held to what the kubernetes-agent
 * chart really does.
 *
 * The always-on box these hints replaced got it wrong twice: it said
 * CoreDNS metrics were available on every cluster (coreDns.enabled is off by
 * default), and it sent Cilium users to serviceMesh.provider, whose schema
 * only accepts istio and linkerd - a helm upgrade that fails. So:
 *
 *   - every Helm value a hint names, and every --set flag it gives, exists in
 *     the chart's values.schema.json with the right type (enum included);
 *   - each value really turns on the scrape the tab charts (the job in the
 *     collector's config template);
 *   - a tab whose metrics no agent value collects (kube-proxy, Cilium) has
 *     no command, and the chart still has no job for them - when one is
 *     added, this fails and the hint should get its command;
 *   - every command is a complete `helm upgrade` of the installed agent;
 *   - every docs link lands on a heading of the English agent page, and that
 *     section names the same values;
 *   - every source is drawn by the page its tab is on.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../..");
const REPO_DIR: string = path.resolve(PACKAGES_DIR, "..");
const CHART_DIR: string = path.join(
  REPO_DIR,
  "HelmChart/Public/kubernetes-agent",
);
const DASHBOARD_PAGES_DIR: string = path.join(
  PACKAGES_DIR,
  "App/FeatureSet/Dashboard/src/Pages/Kubernetes/View",
);
const DOCS_PAGE: string = path.join(
  PACKAGES_DIR,
  "App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md",
);

interface SchemaNode {
  type?: string;
  enum?: Array<string>;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
}

const SCHEMA: SchemaNode = JSON.parse(
  fs.readFileSync(path.join(CHART_DIR, "values.schema.json"), "utf8"),
) as SchemaNode;

const COLLECTOR_CONFIG: string = fs.readFileSync(
  path.join(CHART_DIR, "templates/configmap-deployment.yaml"),
  "utf8",
);
const ALL_TEMPLATES: string = fs
  .readdirSync(path.join(CHART_DIR, "templates"))
  .map((file: string): string => {
    return fs.readFileSync(path.join(CHART_DIR, "templates", file), "utf8");
  })
  .join("\n");
const RBAC: string = fs.readFileSync(
  path.join(CHART_DIR, "templates/rbac.yaml"),
  "utf8",
);
const DOCS: string = fs.readFileSync(DOCS_PAGE, "utf8");

const SETUPS: Array<KubernetesMetricsSetup> = getAllKubernetesMetricsSetups();
const SETUP_ROWS: Array<[string, KubernetesMetricsSetup]> = SETUPS.map(
  (setup: KubernetesMetricsSetup): [string, KubernetesMetricsSetup] => {
    return [setup.source, setup];
  },
);

function setupOf(source: KubernetesMetricsSource): KubernetesMetricsSetup {
  return SETUPS.find((setup: KubernetesMetricsSetup): boolean => {
    return setup.source === source;
  })!;
}

// The schema node at a dotted Helm path, or undefined.
function schemaAt(helmPath: string): SchemaNode | undefined {
  let node: SchemaNode | undefined = SCHEMA;
  for (const key of helmPath.split(".")) {
    node = node?.properties?.[key];
  }
  return node;
}

// A dotted path into the chart's values: controlPlane.etcd.endpoints.
const HELM_VALUE_PATH: RegExp = /^[a-z][A-Za-z]*(\.[a-z][A-Za-z]*)+$/;
const MARKDOWN_HEADING: RegExp = /^#{1,6} /;

// The Helm values a hint names (code that is a dotted path into the chart).
function helmValuesNamed(setup: KubernetesMetricsSetup): Array<string> {
  return Object.values(setup.code).filter((code: string): boolean => {
    return (
      HELM_VALUE_PATH.test(code) && code !== KUBERNETES_CLUSTER_NAME_ATTRIBUTE
    );
  });
}

interface SetFlag {
  key: string;
  value: string;
}

function parseFlag(flag: string): SetFlag {
  const match: RegExpMatchArray | null = flag.match(
    /^--set "?([A-Za-z.]+)=(.*?)"?$/,
  );
  if (!match) {
    throw new Error(`Not a --set flag: ${flag}`);
  }
  return { key: match[1]!, value: match[2]! };
}

const TEMPLATE_ACTION: RegExp =
  /\{\{-?\s*(if|range|with|define|block|end)\b[^}]*\}\}/g;

/*
 * The `{{- if <condition> }}` block that starts at `marker`, up to its own
 * `{{- end }}`: nested range/if/with blocks are counted, so an endpoints
 * loop inside it does not end it early.
 */
function blockAfter(marker: string): string {
  const start: number = COLLECTOR_CONFIG.indexOf(marker);
  if (start < 0) {
    throw new Error(`No block for ${marker}`);
  }

  const actions: RegExp = new RegExp(TEMPLATE_ACTION.source, "g");
  actions.lastIndex = start;
  let depth: number = 0;

  for (
    let match: RegExpExecArray | null = actions.exec(COLLECTOR_CONFIG);
    match;
    match = actions.exec(COLLECTOR_CONFIG)
  ) {
    depth += match[1] === "end" ? -1 : 1;
    if (depth === 0) {
      return COLLECTOR_CONFIG.slice(start, match.index);
    }
  }

  throw new Error(`No end for ${marker}`);
}

function docsSection(heading: string): string {
  const start: number = DOCS.indexOf(`### ${heading}\n`);
  if (start < 0) {
    throw new Error(`No docs section "${heading}"`);
  }
  const next: number = DOCS.indexOf("\n### ", start + 4);
  return DOCS.slice(start, next < 0 ? undefined : next);
}

describe("the Helm values each hint names", () => {
  test("cover every tab of both pages", () => {
    expect(
      SETUPS.map((setup: KubernetesMetricsSetup): string => {
        return setup.source;
      }).sort(),
    ).toEqual(Object.values(KubernetesMetricsSource).sort());
  });

  test.each(SETUP_ROWS)(
    "%s: every value it names is in the agent chart's schema",
    (_source: string, setup: KubernetesMetricsSetup) => {
      for (const helmPath of helmValuesNamed(setup)) {
        expect({ helmPath, inSchema: Boolean(schemaAt(helmPath)) }).toEqual({
          helmPath,
          inSchema: true,
        });
      }
    },
  );

  test.each(SETUP_ROWS)(
    "%s: every --set flag sets a real value to something the schema accepts",
    (_source: string, setup: KubernetesMetricsSetup) => {
      for (const flag of setup.helmFlags) {
        const { key, value }: SetFlag = parseFlag(flag);
        const node: SchemaNode | undefined = schemaAt(key);

        expect({ key, inSchema: Boolean(node) }).toEqual({
          key,
          inSchema: true,
        });

        if (node!.type === "boolean") {
          expect(value).toBe("true");
        } else if (node!.type === "array") {
          // Helm's list syntax: {a,b}.
          expect(value).toMatch(/^\{[^{}]+\}$/);
          expect(node!.items?.type).toBe("string");
        } else if (node!.enum) {
          expect(node!.enum).toContain(value);
        } else {
          expect(node!.type).toBe("string");
        }
      }
    },
  );

  test("each value a hint tells the reader to turn on is the one its flag sets", () => {
    for (const setup of SETUPS) {
      const enabled: string | undefined = setup.code["enabled"];
      if (!enabled) {
        continue;
      }
      expect(setup.helmFlags).toContain(`--set ${enabled}=true`);
    }
  });

  test("the service mesh hints name a provider the schema accepts, and Cilium is not one", () => {
    const providers: Array<string> = schemaAt("serviceMesh.provider")!.enum!;

    expect(setupOf(KubernetesMetricsSource.Istio).code["value"]).toBe("istio");
    expect(setupOf(KubernetesMetricsSource.Linkerd).code["value"]).toBe(
      "linkerd",
    );
    expect(providers).toContain("istio");
    expect(providers).toContain("linkerd");
    expect(providers).not.toContain("cilium");
  });
});

describe("each value really turns on the scrape its tab charts", () => {
  test("controlPlane.enabled adds the etcd, API server, scheduler and controller manager jobs, each at its endpoints", () => {
    const block: string = blockAfter("{{- if .Values.controlPlane.enabled }}");

    for (const [job, component] of [
      ["etcd", "etcd"],
      ["kube-apiserver", "apiServer"],
      ["kube-scheduler", "scheduler"],
      ["kube-controller-manager", "controllerManager"],
    ] as Array<[string, string]>) {
      expect(block).toContain(`- job_name: ${job}`);
      expect(block).toContain(
        `{{- range .Values.controlPlane.${component}.endpoints }}`,
      );
    }

    for (const source of [
      KubernetesMetricsSource.Etcd,
      KubernetesMetricsSource.ApiServer,
      KubernetesMetricsSource.Scheduler,
      KubernetesMetricsSource.ControllerManager,
    ]) {
      expect(setupOf(source).code["enabled"]).toBe("controlPlane.enabled");
      expect(setupOf(source).code["endpoints"]).toMatch(
        /^controlPlane\.(etcd|apiServer|scheduler|controllerManager)\.endpoints$/,
      );
    }
  });

  test("the in-cluster API server address becomes a working target: https, /metrics, the service account token and the /metrics grant", () => {
    const block: string = blockAfter("{{- if .Values.controlPlane.enabled }}");
    const apiServerJob: string = block.slice(
      block.indexOf("- job_name: kube-apiserver"),
      block.indexOf("- job_name: kube-scheduler"),
    );

    expect(IN_CLUSTER_API_SERVER_METRICS_URL).toBe(
      "https://kubernetes.default.svc:443/metrics",
    );
    expect(apiServerJob).toContain("scheme: https");
    expect(apiServerJob).toContain("metrics_path: /metrics");
    expect(apiServerJob).toContain(
      "bearer_token_file: /var/run/secrets/kubernetes.io/serviceaccount/token",
    );
    // The endpoint's scheme and /metrics are trimmed off into a bare target.
    expect(apiServerJob).toContain(
      '{{ . | trimPrefix "https://" | trimPrefix "http://" | trimSuffix "/metrics" | quote }}',
    );
    expect(RBAC).toMatch(/nonResourceURLs:\s*\n\s*- \/metrics\n/);
  });

  test("coreDns.enabled adds the coredns job, matched by the namespace, service and port the hint names", () => {
    const block: string = blockAfter("{{- if .Values.coreDns.enabled }}");

    expect(block).toContain("- job_name: coredns");
    expect(block).toContain("{{ .Values.coreDns.namespace }}");
    expect(block).toContain("regex: {{ .Values.coreDns.service }}");
    expect(block).toContain('regex: "{{ .Values.coreDns.port }}"');
    expect(
      Object.values(setupOf(KubernetesMetricsSource.CoreDns).code),
    ).toEqual([
      "coreDns.enabled",
      "coreDns.namespace",
      "coreDns.service",
      "coreDns.port",
    ]);
  });

  test("serviceMesh.enabled with each provider adds that mesh's sidecar job", () => {
    expect(
      blockAfter(
        '{{- if and .Values.serviceMesh.enabled (eq .Values.serviceMesh.provider "istio") }}',
      ),
    ).toContain("- job_name: envoy-stats");
    expect(
      blockAfter(
        '{{- if and .Values.serviceMesh.enabled (eq .Values.serviceMesh.provider "linkerd") }}',
      ),
    ).toContain("- job_name: linkerd-proxy");
  });

  test("kube-proxy and Cilium have no agent value, no command, and still no job in the chart", () => {
    for (const source of [
      KubernetesMetricsSource.KubeProxy,
      KubernetesMetricsSource.Cilium,
    ]) {
      const setup: KubernetesMetricsSetup = setupOf(source);

      expect(setup.helmFlags).toEqual([]);
      expect(getKubernetesMetricsSetupCommand(source)).toBeNull();
      expect(setup.description).toContain("doesn't collect");
      expect(setup.code["attribute"]).toBe(KUBERNETES_CLUSTER_NAME_ATTRIBUTE);
      expect(setup.description).toContain(`{{${CLUSTER_NAME_PLACEHOLDER}}}`);
    }

    // When a scrape for these lands in the chart, give the hint its command.
    expect(ALL_TEMPLATES).not.toMatch(
      /job_name:\s*["']?(kube-?proxy|cilium|hubble)/i,
    );
    expect(ALL_TEMPLATES).not.toContain(":10249");
  });

  test("the agent stamps k8s.cluster.name on what it scrapes, the attribute every chart filters on", () => {
    expect(COLLECTOR_CONFIG).toContain(
      `key: ${KUBERNETES_CLUSTER_NAME_ATTRIBUTE}`,
    );

    for (const page of ["ControlPlane.tsx", "ServiceMesh.tsx"]) {
      expect(
        fs.readFileSync(path.join(DASHBOARD_PAGES_DIR, page), "utf8"),
      ).toContain(
        `"resource.${KUBERNETES_CLUSTER_NAME_ATTRIBUTE}": clusterIdentifier`,
      );
    }
  });
});

describe("the commands", () => {
  test.each(
    SETUP_ROWS.filter((row: [string, KubernetesMetricsSetup]): boolean => {
      return row[1].helmFlags.length > 0;
    }),
  )(
    "%s: a complete helm upgrade of the installed agent that keeps its values",
    (_source: string, setup: KubernetesMetricsSetup) => {
      const command: string = getKubernetesMetricsSetupCommand(setup.source)!;
      const lines: Array<string> = command.split("\n");

      expect(lines[0]).toBe(
        `helm upgrade ${KUBERNETES_AGENT_HELM_RELEASE} oneuptime/kubernetes-agent \\`,
      );
      expect(lines[1]).toBe(
        `  --namespace ${KUBERNETES_AGENT_HELM_NAMESPACE} \\`,
      );
      expect(lines[2]).toBe("  --reuse-values \\");
      expect(lines.slice(3)).toEqual(
        setup.helmFlags.map((flag: string, index: number): string => {
          return `  ${flag}${index < setup.helmFlags.length - 1 ? " \\" : ""}`;
        }),
      );
    },
  );
});

describe("the docs each hint links to", () => {
  const HEADINGS: Array<string> = DOCS.split("\n")
    .filter((line: string): boolean => {
      return MARKDOWN_HEADING.test(line);
    })
    .map((line: string): string => {
      return slugify(line.replace(/^#+ /, ""));
    });

  test.each(
    SETUPS.map((setup: KubernetesMetricsSetup): [string, string] => {
      return [setup.source, setup.docsRoute];
    }),
  )(
    "%s: %s is a heading on the English agent page",
    (_source: string, docsRoute: string) => {
      const [route, anchor] = docsRoute.split("#");

      expect(route).toBe(KUBERNETES_AGENT_DOCS_ROUTE);
      expect(HEADINGS).toContain(anchor);
    },
  );

  test("the control plane section names controlPlane.enabled, every component's endpoints and the in-cluster API server", () => {
    const section: string = docsSection("Enable Control Plane Monitoring");

    expect(section).toContain("--set controlPlane.enabled=true");
    for (const component of [
      "etcd",
      "apiServer",
      "scheduler",
      "controllerManager",
    ]) {
      expect(section).toContain(`controlPlane.${component}.endpoints`);
    }
    expect(section).toContain(
      getKubernetesMetricsSetupCommand(KubernetesMetricsSource.ApiServer)!,
    );
  });

  test("the CoreDNS section gives the hint's command and names its settings", () => {
    const section: string = docsSection("Enable CoreDNS Metrics");

    expect(section).toContain(
      getKubernetesMetricsSetupCommand(KubernetesMetricsSource.CoreDns)!,
    );
    for (const value of Object.values(
      setupOf(KubernetesMetricsSource.CoreDns).code,
    )) {
      expect(section).toContain(value);
    }
  });

  test("the service mesh section gives the Istio command and names both providers", () => {
    const section: string = docsSection("Enable Service Mesh Metrics");

    expect(section).toContain(
      getKubernetesMetricsSetupCommand(KubernetesMetricsSource.Istio)!,
    );
    expect(section).toContain("`istio`");
    expect(section).toContain("`linkerd`");
  });

  test("the section on what the agent does not collect names kube-proxy, Cilium, Hubble and k8s.cluster.name", () => {
    const section: string = docsSection("Metrics the Agent Does Not Collect");

    for (const word of [
      "kube-proxy",
      "Cilium",
      "Hubble",
      `\`${KUBERNETES_CLUSTER_NAME_ATTRIBUTE}\``,
    ]) {
      expect(section).toContain(word);
    }
  });
});

describe("the pages", () => {
  test.each([
    [
      "ControlPlane.tsx",
      [
        KubernetesMetricsSource.Etcd,
        KubernetesMetricsSource.ApiServer,
        KubernetesMetricsSource.Scheduler,
        KubernetesMetricsSource.ControllerManager,
        KubernetesMetricsSource.CoreDns,
        KubernetesMetricsSource.KubeProxy,
      ],
    ],
    [
      "ServiceMesh.tsx",
      [
        KubernetesMetricsSource.Cilium,
        KubernetesMetricsSource.Istio,
        KubernetesMetricsSource.Linkerd,
      ],
    ],
  ])(
    "%s draws a hint for each of its tabs",
    (page: string, sources: Array<KubernetesMetricsSource>) => {
      const text: string = fs.readFileSync(
        path.join(DASHBOARD_PAGES_DIR, page),
        "utf8",
      );
      const enumNames: Record<string, string> = Object.fromEntries(
        Object.entries(KubernetesMetricsSource).map(
          ([name, value]: [string, string]): [string, string] => {
            return [value, name];
          },
        ),
      );

      for (const source of sources) {
        expect(text).toContain(
          `source: KubernetesMetricsSource.${enumNames[source]}`,
        );
      }
    },
  );
});
