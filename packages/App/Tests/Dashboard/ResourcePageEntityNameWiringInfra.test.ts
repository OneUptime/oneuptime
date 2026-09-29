import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Resource pages scope the Logs / Traces / Metrics viewers by a resource
 * attribute and show that scope as a locked chip. The chips used to read the
 * machine side of the scope — "resource.k8s.cluster.name: prod-eks-01",
 * "Function: arn-ish-function-identifier" — even though the page had already
 * loaded the resource's friendly name. The fix is display only: each page
 * hands the viewer attributeFilterDisplayKeys / attributeFilterDisplayValues
 * overrides while the filter itself keeps matching the identifier telemetry
 * carries.
 *
 * The App suite runs in plain Node with no renderer (and must stay
 * React-free), so these pin the JSX wiring by reading the sources, the way
 * CloudResourcePages.test.ts does. Comments are stripped and ALL whitespace
 * and trailing commas removed, so a Prettier reflow or a rationale comment
 * can neither make a test pass nor fail.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type CompactFunction = (text: string) => string;

/*
 * Whitespace-free, trailing-comma-free form. Applied to the source AND to
 * every expected snippet, so snippets can be written readably.
 */
const compact: CompactFunction = (text: string): string => {
  return text.replace(/\s+/g, "").replace(/,([}\])])/g, "$1");
};

type StripCommentsFunction = (text: string) => string;

const stripComments: StripCommentsFunction = (text: string): string => {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
};

type ReadCodeFunction = (relativePath: string) => string;

const readCode: ReadCodeFunction = (relativePath: string): string => {
  return compact(
    stripComments(
      fs.readFileSync(
        path.join(DASHBOARD_SRC, ...relativePath.split("/")),
        "utf8",
      ),
    ),
  );
};

type ElementPropsFunction = (code: string, tagName: string) => string;

/*
 * The props of the one `<Tag ... />` element in a compacted source. Throws
 * when the element is missing or appears more than once, so a test can never
 * silently look at the wrong element.
 */
const elementProps: ElementPropsFunction = (
  code: string,
  tagName: string,
): string => {
  const opening: string = `<${tagName}`;
  const start: number = code.indexOf(opening);

  if (start < 0) {
    throw new Error(`Expected the source to render <${tagName}>.`);
  }

  if (code.indexOf(opening, start + opening.length) >= 0) {
    throw new Error(`Expected exactly one <${tagName}> element.`);
  }

  const end: number = code.indexOf("/>", start);

  if (end < 0) {
    throw new Error(`Expected <${tagName}> to be self-closing.`);
  }

  return code.slice(start + opening.length, end);
};

type ObjectPropFunction = (props: string, propName: string) => string;

/*
 * The inline object literal passed as `propName={{ ... }}` — returns the
 * contents between the double braces. Throws when the prop is not an inline
 * object.
 */
const inlineObjectProp: ObjectPropFunction = (
  props: string,
  propName: string,
): string => {
  const opening: string = `${propName}={{`;
  const start: number = props.indexOf(opening);

  if (start < 0) {
    throw new Error(`Expected an inline object for ${propName}.`);
  }

  const end: number = props.indexOf("}}", start);

  return props.slice(start + opening.length, end);
};

type ObjectKeysFunction = (objectBody: string) => Array<string>;

const quotedKeys: ObjectKeysFunction = (objectBody: string): Array<string> => {
  const keys: Array<string> = [];
  const pattern: RegExp = /"([^"]+)":/g;
  let match: RegExpExecArray | null = pattern.exec(objectBody);

  while (match) {
    keys.push(match[1]!);
    match = pattern.exec(objectBody);
  }

  return keys;
};

type LogQueryAttributeKeysFunction = (code: string) => Array<string>;

/*
 * The attribute keys a Logs page pins in its `logQuery` — the keys whose
 * chips the viewer renders.
 */
const logQueryAttributeKeys: LogQueryAttributeKeysFunction = (
  code: string,
): Array<string> => {
  const start: number = code.indexOf("constq:any={attributes:{");

  if (start < 0) {
    throw new Error("Expected the logs page to build `const q: any`.");
  }

  const bodyStart: number = start + "constq:any={attributes:{".length;
  const end: number = code.indexOf("}", bodyStart);

  return quotedKeys(code.slice(bodyStart, end));
};

describe("compact()", () => {
  test("drops whitespace and trailing commas so snippets survive a Prettier reflow", () => {
    expect(compact('a={{\n  "k": "v",\n}}')).toBe('a={{"k":"v"}}');
    expect(compact("f(\n  a,\n  b,\n)")).toBe("f(a,b)");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Kubernetes cluster Logs / Metrics / Traces
 * ---------------------------------------------------------------------------
 */

describe("Kubernetes cluster pages show the cluster name, filter by identifier", () => {
  const CLUSTER_KEY: string = "resource.k8s.cluster.name";

  test("the pages still load the cluster's name alongside its identifier", () => {
    for (const tab of ["Logs", "Metrics", "Traces"]) {
      const code: string = readCode(`Pages/Kubernetes/View/${tab}.tsx`);

      expect(code).toContain(
        compact("select: { clusterIdentifier: true, name: true }"),
      );
    }
  });

  test("Logs: chip key 'Cluster', chip value name || identifier", () => {
    const code: string = readCode("Pages/Kubernetes/View/Logs.tsx");
    const props: string = elementProps(code, "DashboardLogsViewer");

    expect(inlineObjectProp(props, "attributeFilterDisplayKeys")).toBe(
      compact(`"${CLUSTER_KEY}": "Cluster"`),
    );

    const displayValues: string = inlineObjectProp(
      props,
      "attributeFilterDisplayValues",
    );

    expect(quotedKeys(displayValues)).toEqual([CLUSTER_KEY]);
    expect(displayValues).toMatch(
      /^"resource\.k8s\.cluster\.name":cluster\.name\|\|cluster\.clusterIdentifier!?$/,
    );
  });

  test("Logs: the filter and entity scope still match the identifier (display only)", () => {
    const code: string = readCode("Pages/Kubernetes/View/Logs.tsx");
    const props: string = elementProps(code, "DashboardLogsViewer");

    expect(code).toContain(
      compact(`"${CLUSTER_KEY}": cluster?.clusterIdentifier || ""`),
    );
    expect(props).toContain(compact(`attributeKey: "${CLUSTER_KEY}"`));
    expect(props).toContain(
      compact("attributeValue: cluster.clusterIdentifier!"),
    );
    expect(code).not.toContain(compact(`"${CLUSTER_KEY}": cluster?.name`));
    expect(props).not.toContain(compact("attributeValue: cluster.name"));
  });

  test("Logs: every pinned attribute key gets a friendly chip key", () => {
    const code: string = readCode("Pages/Kubernetes/View/Logs.tsx");
    const displayKeys: Array<string> = quotedKeys(
      inlineObjectProp(
        elementProps(code, "DashboardLogsViewer"),
        "attributeFilterDisplayKeys",
      ),
    );

    for (const key of logQueryAttributeKeys(code)) {
      expect(displayKeys).toContain(key);
    }
  });

  test.each([
    ["Metrics", "MetricsViewer"],
    ["Traces", "TracesViewer"],
  ])(
    "%s: attributeFilterDisplayValues swaps the chip value for the cluster name",
    (tab: string, viewer: string) => {
      const code: string = readCode(`Pages/Kubernetes/View/${tab}.tsx`);
      const props: string = elementProps(code, viewer);

      // The filter keeps the identifier.
      expect(inlineObjectProp(props, "attributeFilters")).toBe(
        compact(`"${CLUSTER_KEY}": cluster.clusterIdentifier`),
      );
      expect(inlineObjectProp(props, "attributeFilterDisplayKeys")).toBe(
        compact(`"${CLUSTER_KEY}": "Cluster"`),
      );

      const displayValues: string = inlineObjectProp(
        props,
        "attributeFilterDisplayValues",
      );

      expect(quotedKeys(displayValues)).toEqual(
        quotedKeys(inlineObjectProp(props, "attributeFilters")),
      );
      expect(displayValues).toBe(
        compact(`"${CLUSTER_KEY}": cluster.name || cluster.clusterIdentifier`),
      );

      // Entity scope keeps matching on the identifier.
      expect(props).toContain(
        compact("attributeValue: cluster.clusterIdentifier"),
      );
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * Kubernetes pod / container detail -> KubernetesLogsTab
 * ---------------------------------------------------------------------------
 */

describe("Kubernetes pod and container Logs tabs", () => {
  test.each(["PodDetail", "ContainerDetail"])(
    "%s selects the cluster name and hands it to the Logs tab",
    (page: string) => {
      const code: string = readCode(`Pages/Kubernetes/View/${page}.tsx`);

      expect(code).toContain(
        compact("select: { clusterIdentifier: true, name: true }"),
      );

      const props: string = elementProps(code, "KubernetesLogsTab");

      expect(props).toContain(compact("clusterIdentifier={clusterIdentifier}"));
      expect(props).toContain(compact("clusterName={cluster.name}"));
    },
  );

  test("PodDetail keeps scoping the tab by pod and namespace", () => {
    const props: string = elementProps(
      readCode("Pages/Kubernetes/View/PodDetail.tsx"),
      "KubernetesLogsTab",
    );

    expect(props).toContain(compact("podName={podName}"));
    expect(props).toContain(
      compact("namespace={podObject?.metadata.namespace}"),
    );
  });

  test("ContainerDetail scopes the tab by container (its empty podName is dropped by the helper)", () => {
    const props: string = elementProps(
      readCode("Pages/Kubernetes/View/ContainerDetail.tsx"),
      "KubernetesLogsTab",
    );

    expect(props).toContain(compact("containerName={containerName}"));
  });

  test("KubernetesLogsTab builds its filter through the pure helper, not by hand", () => {
    const code: string = readCode(
      "Components/Kubernetes/KubernetesLogsTab.tsx",
    );

    expect(code).toContain(compact('from "./KubernetesLogsScope"'));
    expect(code).toContain(
      compact(
        "attributes: buildKubernetesLogsAttributeFilters({ clusterIdentifier: props.clusterIdentifier, podName: props.podName, containerName: props.containerName, namespace: props.namespace })",
      ),
    );

    /*
     * Regression: the inline map always set pod.name, so the container page
     * sent `pod.name = ""` (logs WITHOUT a pod name).
     */
    expect(code).not.toContain(
      compact('"resource.k8s.pod.name": props.podName'),
    );
    expect(code).not.toContain(compact('"resource.k8s.cluster.name":'));
  });

  test("KubernetesLogsTab accepts an optional clusterName and passes the display overrides", () => {
    const code: string = readCode(
      "Components/Kubernetes/KubernetesLogsTab.tsx",
    );

    expect(code).toContain(compact("clusterName?: string | undefined;"));

    const props: string = elementProps(code, "DashboardLogsViewer");

    expect(props).toContain(compact("logQuery={logQuery}"));
    expect(props).toContain(
      compact(
        "attributeFilterDisplayKeys={KUBERNETES_LOGS_ATTRIBUTE_DISPLAY_KEYS}",
      ),
    );
    expect(props).toContain(
      compact("attributeFilterDisplayValues={attributeFilterDisplayValues}"),
    );
    expect(code).toContain(
      compact(
        "buildKubernetesLogsAttributeDisplayValues({ clusterIdentifier: props.clusterIdentifier, clusterName: props.clusterName })",
      ),
    );
  });

  test("KubernetesLogsTab memoises the display overrides on the values they read", () => {
    const code: string = readCode(
      "Components/Kubernetes/KubernetesLogsTab.tsx",
    );

    expect(code).toContain(
      compact("[props.clusterIdentifier, props.clusterName]"),
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Serverless function Logs / Metrics / Traces
 * ---------------------------------------------------------------------------
 */

describe("Serverless function pages show the function name, filter by identifier", () => {
  const FUNCTION_KEY: string = "resource.faas.name";

  test("the pages load the function's name alongside its identifier", () => {
    for (const tab of ["Logs", "Metrics", "Traces"]) {
      expect(readCode(`Pages/Serverless/View/${tab}.tsx`)).toContain(
        compact("select: { functionIdentifier: true, name: true }"),
      );
    }
  });

  test("Logs: chip key 'Function', chip value name || identifier", () => {
    const code: string = readCode("Pages/Serverless/View/Logs.tsx");
    const props: string = elementProps(code, "DashboardLogsViewer");

    expect(inlineObjectProp(props, "attributeFilterDisplayKeys")).toBe(
      compact(`"${FUNCTION_KEY}": "Function"`),
    );

    const displayValues: string = inlineObjectProp(
      props,
      "attributeFilterDisplayValues",
    );

    expect(quotedKeys(displayValues)).toEqual([FUNCTION_KEY]);
    expect(displayValues).toMatch(
      /^"resource\.faas\.name":serverlessFunction\.name\|\|serverlessFunction\.functionIdentifier/,
    );

    for (const key of logQueryAttributeKeys(code)) {
      expect(
        quotedKeys(inlineObjectProp(props, "attributeFilterDisplayKeys")),
      ).toContain(key);
    }
  });

  test("Logs: the filter still matches the function identifier", () => {
    const code: string = readCode("Pages/Serverless/View/Logs.tsx");

    expect(code).toContain(
      compact(
        `"${FUNCTION_KEY}": serverlessFunction?.functionIdentifier || ""`,
      ),
    );
    expect(code).not.toContain(
      compact(`"${FUNCTION_KEY}": serverlessFunction?.name`),
    );
  });

  test.each([
    ["Metrics", "MetricsViewer"],
    ["Traces", "TracesViewer"],
  ])(
    "%s: attributeFilterDisplayValues swaps the chip value for the function name",
    (tab: string, viewer: string) => {
      const props: string = elementProps(
        readCode(`Pages/Serverless/View/${tab}.tsx`),
        viewer,
      );

      expect(inlineObjectProp(props, "attributeFilters")).toBe(
        compact(`"${FUNCTION_KEY}": serverlessFunction.functionIdentifier`),
      );
      expect(inlineObjectProp(props, "attributeFilterDisplayKeys")).toBe(
        compact(`"${FUNCTION_KEY}": "Function"`),
      );
      expect(inlineObjectProp(props, "attributeFilterDisplayValues")).toBe(
        compact(
          `"${FUNCTION_KEY}": serverlessFunction.name || serverlessFunction.functionIdentifier`,
        ),
      );
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * Cloud environment Logs / Metrics / Traces
 * ---------------------------------------------------------------------------
 */

describe("Cloud environment pages label every chip through the helper", () => {
  test.each([
    ["Logs", "DashboardLogsViewer"],
    ["Metrics", "MetricsViewer"],
    ["Traces", "TracesViewer"],
  ])(
    "%s passes getCloudResourceAttributeDisplayKeys to the viewer",
    (tab: string, viewer: string) => {
      const code: string = readCode(`Pages/Cloud/View/${tab}.tsx`);

      expect(code).toContain(
        compact("getCloudResourceAttributeDisplayKeys(cloudResource)"),
      );
      expect(elementProps(code, viewer)).toContain(
        compact("attributeFilterDisplayKeys={attributeFilterDisplayKeys}"),
      );
    },
  );

  test("Logs memoises the display keys on the same columns as its filter", () => {
    const code: string = readCode("Pages/Cloud/View/Logs.tsx");

    expect(code).toContain(
      compact(
        "const attributeFilterDisplayKeys: Record<string, string> = useMemo(() => { return getCloudResourceAttributeDisplayKeys(cloudResource); }, [ cloudResource?.cloudPlatform, cloudResource?.cloudAccountId, cloudResource?.cloudRegion ]);",
      ),
    );

    // Hook order: the memo must run before the early returns.
    expect(
      code.indexOf(compact("const attributeFilterDisplayKeys")),
    ).toBeLessThan(code.indexOf(compact("if (isLoading)")));
  });

  test("values are the genuine scope, so no page overrides them", () => {
    for (const tab of ["Logs", "Metrics", "Traces"]) {
      expect(readCode(`Pages/Cloud/View/${tab}.tsx`)).not.toContain(
        "attributeFilterDisplayValues",
      );
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * Infra cluster / fleet Logs pages (values already are names)
 * ---------------------------------------------------------------------------
 */

describe("Infra Logs pages never show a raw OTel key on the locked chip", () => {
  const CASES: Array<[string, string, string, string]> = [
    ["Ceph", "resource.ceph.cluster.name", "Cluster", "cluster?.name"],
    ["Proxmox", "resource.proxmox.cluster.name", "Cluster", "cluster?.name"],
    [
      "DockerSwarm",
      "resource.docker.swarm.cluster.name",
      "Cluster",
      "cluster?.name",
    ],
    ["VMware", "resource.vmware.vcenter.name", "vCenter", "vcenter?.name"],
    ["IoT", "resource.iot.fleet.name", "Fleet", "fleet?.name"],
  ];

  test.each(CASES)(
    "%s Logs labels %s as %s",
    (page: string, attributeKey: string, label: string) => {
      const code: string = readCode(`Pages/${page}/View/Logs.tsx`);
      const props: string = elementProps(code, "DashboardLogsViewer");

      expect(inlineObjectProp(props, "attributeFilterDisplayKeys")).toBe(
        compact(`"${attributeKey}": "${label}"`),
      );
    },
  );

  test.each(CASES)(
    "%s Logs: every pinned attribute key has a label",
    (page: string) => {
      const code: string = readCode(`Pages/${page}/View/Logs.tsx`);
      const displayKeys: Array<string> = quotedKeys(
        inlineObjectProp(
          elementProps(code, "DashboardLogsViewer"),
          "attributeFilterDisplayKeys",
        ),
      );
      const pinnedKeys: Array<string> = logQueryAttributeKeys(code);

      expect(pinnedKeys.length).toBeGreaterThan(0);

      for (const key of pinnedKeys) {
        expect(displayKeys).toContain(key);
      }
    },
  );

  test.each(CASES)(
    "%s Logs keeps filtering by the name and does not override the value",
    (page: string, attributeKey: string, _label: string, nameExpr: string) => {
      const code: string = readCode(`Pages/${page}/View/Logs.tsx`);

      expect(code).toContain(compact(`"${attributeKey}": ${nameExpr} || ""`));
      expect(elementProps(code, "DashboardLogsViewer")).not.toContain(
        "attributeFilterDisplayValues",
      );
    },
  );

  test.each(CASES)(
    "%s Logs uses the same label as its Metrics tab",
    (page: string, attributeKey: string, label: string) => {
      const metrics: string = readCode(`Pages/${page}/View/Metrics.tsx`);

      expect(metrics).toContain(
        compact(
          `attributeFilterDisplayKeys={{ "${attributeKey}": "${label}" }}`,
        ),
      );
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * Cross-page invariants
 * ---------------------------------------------------------------------------
 */

describe("display overrides across the slice", () => {
  const PAGES_WITH_VALUE_OVERRIDES: Array<[string, string]> = [
    ["Pages/Kubernetes/View/Logs.tsx", "DashboardLogsViewer"],
    ["Pages/Kubernetes/View/Metrics.tsx", "MetricsViewer"],
    ["Pages/Kubernetes/View/Traces.tsx", "TracesViewer"],
    ["Pages/Serverless/View/Logs.tsx", "DashboardLogsViewer"],
    ["Pages/Serverless/View/Metrics.tsx", "MetricsViewer"],
    ["Pages/Serverless/View/Traces.tsx", "TracesViewer"],
  ];

  test.each(PAGES_WITH_VALUE_OVERRIDES)(
    "%s: every value override is keyed by a key the page filters on, and has a friendly key",
    (file: string, viewer: string) => {
      const code: string = readCode(file);
      const props: string = elementProps(code, viewer);

      const filterKeys: Array<string> =
        viewer === "DashboardLogsViewer"
          ? logQueryAttributeKeys(code)
          : quotedKeys(inlineObjectProp(props, "attributeFilters"));
      const displayKeyKeys: Array<string> = quotedKeys(
        inlineObjectProp(props, "attributeFilterDisplayKeys"),
      );
      const displayValueKeys: Array<string> = quotedKeys(
        inlineObjectProp(props, "attributeFilterDisplayValues"),
      );

      expect(displayValueKeys.length).toBeGreaterThan(0);

      for (const key of displayValueKeys) {
        expect(filterKeys).toContain(key);
        expect(displayKeyKeys).toContain(key);
      }
    },
  );

  test.each(PAGES_WITH_VALUE_OVERRIDES)(
    "%s: the friendly chip keys are labels, not OTel keys",
    (file: string, viewer: string) => {
      const displayKeys: string = inlineObjectProp(
        elementProps(readCode(file), viewer),
        "attributeFilterDisplayKeys",
      );
      const labels: Array<string> = [];
      const pattern: RegExp = /"[^"]+":"([^"]+)"/g;
      let match: RegExpExecArray | null = pattern.exec(displayKeys);

      while (match) {
        labels.push(match[1]!);
        match = pattern.exec(displayKeys);
      }

      expect(labels.length).toBeGreaterThan(0);

      for (const labelText of labels) {
        expect(labelText).not.toMatch(/^resource\./);
      }
    },
  );
});
