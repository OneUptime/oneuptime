import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Resource pages scope the shared telemetry viewers (logs, traces, metrics,
 * exceptions) and the viewers turn that scope into locked filter chips.
 *
 * The chips used to read what the page handed over verbatim:
 *
 *   - RUM application pages pass the RumApplication id as serviceIds /
 *     primaryEntityId, and the viewer resolved it against the Service table
 *     only, so the chip read "Service: 84858d6c-…".
 *   - Host / Docker / Podman pages scope by the OTel host.name attribute and
 *     the chip read "resource.host.name: ip-10-0-0-12" (the machine's
 *     hostIdentifier) even though the page had just loaded the host's name.
 *   - The container detail Logs tab read "resource.container.id: 3f2a9c…".
 *   - The network device Logs page read "networkDevice.id: <uuid>" and never
 *     fetched the device at all.
 *
 * The viewers now take display-only hints (scopeEntityType,
 * attributeFilterDisplayKeys, attributeFilterDisplayValues). These tests pin
 * the page side of that contract: every page hands the viewer the entity's
 * type or a name override, and the FILTER itself still uses the id /
 * identifier (filtering semantics must not change).
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type ReadSourceFunction = (...relativeParts: Array<string>) => string;

// Source with comments stripped and whitespace collapsed to single spaces.
const readSource: ReadSourceFunction = (
  ...relativeParts: Array<string>
): string => {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
};

type ReadPageFunction = (relativePath: string) => string;

const readPage: ReadPageFunction = (relativePath: string): string => {
  return readSource("Pages", ...relativePath.split("/"));
};

type ReadBalancedFunction = (source: string, openIndex: number) => string;

/*
 * Return the balanced {...} (or [...]) block that opens at openIndex,
 * including the delimiters. String literals are skipped so a brace inside
 * copy text does not unbalance the scan.
 */
const readBalanced: ReadBalancedFunction = (
  source: string,
  openIndex: number,
): string => {
  const open: string = source[openIndex]!;
  const close: string = open === "{" ? "}" : open === "[" ? "]" : ")";
  let depth: number = 0;
  let quote: string | null = null;

  for (let i: number = openIndex; i < source.length; i++) {
    const char: string = source[i]!;

    if (quote) {
      if (char === "\\") {
        i++;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === open) {
      depth++;
    } else if (char === close) {
      depth--;
      if (depth === 0) {
        return source.substring(openIndex, i + 1);
      }
    }
  }

  throw new Error(`Unbalanced ${open} at ${openIndex}`);
};

type GetJsxElementsFunction = (
  source: string,
  tagName: string,
) => Array<string>;

// Every self-closing <tagName ... /> element in the source.
const getJsxElements: GetJsxElementsFunction = (
  source: string,
  tagName: string,
): Array<string> => {
  const elements: Array<string> = [];
  let searchFrom: number = 0;

  for (;;) {
    const start: number = source.indexOf(`<${tagName} `, searchFrom);

    if (start === -1) {
      return elements;
    }

    let i: number = start + tagName.length + 1;
    let quote: string | null = null;

    for (; i < source.length; i++) {
      const char: string = source[i]!;

      if (quote) {
        if (char === quote) {
          quote = null;
        }
        continue;
      }

      if (char === '"') {
        quote = char;
        continue;
      }

      if (char === "{") {
        i += readBalanced(source, i).length - 1;
        continue;
      }

      if (char === "/" && source[i + 1] === ">") {
        break;
      }
    }

    elements.push(source.substring(start, i + 2));
    searchFrom = i + 2;
  }
};

type GetOnlyJsxElementFunction = (source: string, tagName: string) => string;

const getOnlyJsxElement: GetOnlyJsxElementFunction = (
  source: string,
  tagName: string,
): string => {
  const elements: Array<string> = getJsxElements(source, tagName);
  expect(elements).toHaveLength(1);
  return elements[0]!;
};

type GetJsxPropFunction = (
  element: string,
  propName: string,
) => string | undefined;

/*
 * The expression passed to a JSX prop: the text inside {…} (without the
 * outer braces) or a "string" literal (with its quotes). undefined when the
 * prop is not passed.
 */
const getJsxProp: GetJsxPropFunction = (
  element: string,
  propName: string,
): string | undefined => {
  const match: RegExpExecArray | null = new RegExp(`\\s${propName}=`).exec(
    element,
  );

  if (!match) {
    return undefined;
  }

  const valueStart: number = match.index + match[0].length;

  if (element[valueStart] === '"') {
    const end: number = element.indexOf('"', valueStart + 1);
    return element.substring(valueStart, end + 1);
  }

  const block: string = readBalanced(element, valueStart);
  return block.substring(1, block.length - 1).trim();
};

type ParseObjectLiteralFunction = (literal: string) => Record<string, string>;

/*
 * Parse a flat object literal `{ "a.b": expr, [CONST]: expr, }` into a map
 * of key -> value expression text. Keys keep a [computed] form as written.
 */
const parseObjectLiteral: ParseObjectLiteralFunction = (
  literal: string,
): Record<string, string> => {
  const trimmed: string = literal.trim();
  expect(trimmed.startsWith("{")).toBe(true);
  expect(trimmed.endsWith("}")).toBe(true);

  const body: string = trimmed.substring(1, trimmed.length - 1);
  const entries: Array<string> = [];
  let current: string = "";
  let depth: number = 0;
  let quote: string | null = null;

  for (const char of body) {
    if (quote) {
      current += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === "{" || char === "[" || char === "(") {
      depth++;
    } else if (char === "}" || char === "]" || char === ")") {
      depth--;
    } else if (char === "," && depth === 0) {
      entries.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  entries.push(current);

  const result: Record<string, string> = {};

  for (const entry of entries) {
    if (!entry.trim()) {
      continue;
    }

    const entryPattern: RegExp =
      /^\s*("[^"]*"|\[[^\]]*\]|[A-Za-z_$][\w$]*)\s*:\s*([\s\S]*)$/;
    const keyMatch: RegExpExecArray | null = entryPattern.exec(entry);

    if (!keyMatch) {
      throw new Error(`Cannot parse object entry: ${entry}`);
    }

    const rawKey: string = keyMatch[1]!;
    const key: string = rawKey.startsWith('"')
      ? rawKey.substring(1, rawKey.length - 1)
      : rawKey;

    result[key] = keyMatch[2]!.trim();
  }

  return result;
};

type GetObjectPropFunction = (
  element: string,
  propName: string,
) => Record<string, string>;

// Parse an inline object-literal prop: propName={{ ... }}.
const getObjectProp: GetObjectPropFunction = (
  element: string,
  propName: string,
): Record<string, string> => {
  const expression: string | undefined = getJsxProp(element, propName);
  expect(expression).toBeDefined();
  return parseObjectLiteral(expression!);
};

type GetConstObjectFunction = (
  source: string,
  constName: string,
) => Record<string, string>;

// Parse `const NAME: Record<string, string> = { ... };` from the source.
const getConstObject: GetConstObjectFunction = (
  source: string,
  constName: string,
): Record<string, string> => {
  const declaration: string = `const ${constName}: Record<string, string> = `;
  const start: number = source.indexOf(declaration);
  expect(start).toBeGreaterThan(-1);
  return parseObjectLiteral(readBalanced(source, start + declaration.length));
};

type GetConstStringFunction = (source: string, constName: string) => string;

const getConstString: GetConstStringFunction = (
  source: string,
  constName: string,
): string => {
  const match: RegExpExecArray | null = new RegExp(
    `const ${constName}: string = "([^"]*)";`,
  ).exec(source);
  expect(match).not.toBeNull();
  return match![1]!;
};

const SERVICE_TYPE_IMPORT: string =
  'import ServiceType from "Common/Types/Telemetry/ServiceType";';

const VIEWER_TAGS: Array<string> = [
  "MetricsViewer",
  "TracesViewer",
  "DashboardLogsViewer",
  "ExceptionsViewer",
];

const ALL_PAGES: Array<string> = [
  "Rum/View/Metrics.tsx",
  "Rum/View/Logs.tsx",
  "Rum/View/Traces.tsx",
  "Service/View/Logs.tsx",
  "Service/View/Traces.tsx",
  "Service/View/Exceptions.tsx",
  "Host/View/Logs.tsx",
  "Host/View/Metrics.tsx",
  "Host/View/Traces.tsx",
  "Docker/View/Logs.tsx",
  "Docker/View/Traces.tsx",
  "Docker/View/ContainerDetail.tsx",
  "Podman/View/Logs.tsx",
  "Podman/View/Traces.tsx",
  "Podman/View/ContainerDetail.tsx",
  "NetworkDevice/View/Logs.tsx",
];

interface ViewerUsage {
  page: string;
  tag: string;
  element: string;
}

type GetViewerUsagesFunction = (page: string) => Array<ViewerUsage>;

const getViewerUsages: GetViewerUsagesFunction = (
  page: string,
): Array<ViewerUsage> => {
  const source: string = readPage(page);
  const usages: Array<ViewerUsage> = [];

  for (const tag of VIEWER_TAGS) {
    for (const element of getJsxElements(source, tag)) {
      usages.push({ page, tag, element });
    }
  }

  return usages;
};

/*
 * Expressions that are a raw id / machine identifier. A chip display value
 * must never be one of these on its own — that is exactly the value the
 * chip already fell back to.
 */
const RAW_IDENTIFIER_EXPRESSIONS: Array<string> = [
  "modelId",
  "modelId.toString()",
  "host.hostIdentifier",
  "host.hostIdentifier!",
  "host?.hostIdentifier",
  "containerId",
];

describe("source helpers", () => {
  test("getJsxElements finds nested-brace props and stops at the right />", () => {
    const source: string =
      '<Card title="x"> <Viewer id={`a-${b.toString()}`} attributes={{ "k": v }} flag={true} /> <Viewer other={1} /> </Card>';

    const elements: Array<string> = getJsxElements(source, "Viewer");

    expect(elements).toHaveLength(2);
    expect(getJsxProp(elements[0]!, "id")).toBe("`a-${b.toString()}`");
    expect(parseObjectLiteral(getJsxProp(elements[0]!, "attributes")!)).toEqual(
      { k: "v" },
    );
    expect(getJsxProp(elements[0]!, "flag")).toBe("true");
    expect(getJsxProp(elements[0]!, "missing")).toBeUndefined();
    expect(getJsxProp(elements[1]!, "other")).toBe("1");
  });

  test("parseObjectLiteral keeps || fallbacks and computed keys intact", () => {
    expect(
      parseObjectLiteral(
        '{ "resource.host.name": host.name || host.hostIdentifier || "", [ATTR]: f(a, b), }',
      ),
    ).toEqual({
      "resource.host.name": 'host.name || host.hostIdentifier || ""',
      "[ATTR]": "f(a, b)",
    });
  });

  test("comment stripping keeps URLs and string content", () => {
    const source: string = readPage("NetworkDevice/View/Logs.tsx");
    expect(source).not.toContain("/*");
    expect(source).toContain("PROBE_SYSLOG_RECEIVER_ENABLED=true");
  });
});

describe("every scoped resource page gives the viewer a name, not just an id", () => {
  test("each page in the slice renders exactly one telemetry viewer", () => {
    for (const page of ALL_PAGES) {
      expect({ page, usages: getViewerUsages(page).length }).toEqual({
        page,
        usages: 1,
      });
    }
  });

  test("a viewer scoped by entity id is always told the entity's type", () => {
    let idScopedViewers: number = 0;

    for (const page of ALL_PAGES) {
      for (const usage of getViewerUsages(page)) {
        const scopedById: boolean =
          getJsxProp(usage.element, "serviceIds") !== undefined ||
          getJsxProp(usage.element, "primaryEntityId") !== undefined;

        if (!scopedById) {
          continue;
        }

        idScopedViewers++;

        const scopeEntityType: string | undefined = getJsxProp(
          usage.element,
          "scopeEntityType",
        );

        expect({ page, tag: usage.tag, scopeEntityType }).toEqual({
          page,
          tag: usage.tag,
          scopeEntityType: expect.stringMatching(/^ServiceType\.[A-Za-z]+$/),
        });
      }
    }

    // Three RUM pages + three Service pages.
    expect(idScopedViewers).toBe(6);
  });

  test("a viewer scoped by attribute always carries chip display keys and values", () => {
    let attributeScopedViewers: number = 0;

    for (const page of ALL_PAGES) {
      for (const usage of getViewerUsages(page)) {
        const scopedByAttribute: boolean =
          getJsxProp(usage.element, "attributeFilters") !== undefined ||
          getJsxProp(usage.element, "logQuery") !== undefined;

        if (!scopedByAttribute) {
          continue;
        }

        attributeScopedViewers++;

        expect({
          page,
          tag: usage.tag,
          hasDisplayKeys:
            getJsxProp(usage.element, "attributeFilterDisplayKeys") !==
            undefined,
          hasDisplayValues:
            getJsxProp(usage.element, "attributeFilterDisplayValues") !==
            undefined,
        }).toEqual({
          page,
          tag: usage.tag,
          hasDisplayKeys: true,
          hasDisplayValues: true,
        });
      }
    }

    // Host x3, Docker x3, Podman x3, NetworkDevice x1.
    expect(attributeScopedViewers).toBe(10);
  });

  test("no inline chip display value is a bare id or machine identifier", () => {
    for (const page of ALL_PAGES) {
      for (const usage of getViewerUsages(page)) {
        const expression: string | undefined = getJsxProp(
          usage.element,
          "attributeFilterDisplayValues",
        );

        if (!expression || !expression.startsWith("{")) {
          continue;
        }

        const values: Record<string, string> = parseObjectLiteral(expression);

        for (const [key, value] of Object.entries(values)) {
          expect({ page, key, value }).toEqual({
            page,
            key,
            value: expect.not.stringMatching(
              new RegExp(
                `^(${RAW_IDENTIFIER_EXPRESSIONS.map((raw: string) => {
                  return raw.replace(/[.*+?^${}()|[\]\\!]/g, "\\$&");
                }).join("|")})$`,
              ),
            ),
          });

          // The friendly name comes first; the identifier is only a fallback.
          expect({ page, key, value }).toEqual({
            page,
            key,
            value: expect.stringMatching(/^(host\??\.name|containerName)\b/),
          });
        }
      }
    }
  });

  test("no page still labels a chip with a raw OTel resource key", () => {
    for (const page of ALL_PAGES) {
      for (const usage of getViewerUsages(page)) {
        const expression: string | undefined = getJsxProp(
          usage.element,
          "attributeFilterDisplayKeys",
        );

        if (!expression || !expression.startsWith("{")) {
          continue;
        }

        for (const [key, label] of Object.entries(
          parseObjectLiteral(expression),
        )) {
          expect({ page, key, label }).toEqual({
            page,
            key,
            label: expect.stringMatching(/^"[A-Z][A-Za-z ]+"$/),
          });
        }
      }
    }
  });
});

describe("RUM application pages", () => {
  const RUM_CASES: Array<[string, string, string]> = [
    ["Rum/View/Metrics.tsx", "MetricsViewer", "serviceIds"],
    ["Rum/View/Traces.tsx", "TracesViewer", "primaryEntityId"],
    ["Rum/View/Logs.tsx", "DashboardLogsViewer", "serviceIds"],
  ];

  test.each(RUM_CASES)(
    "%s tells %s its scope id is a RumApplication",
    (page: string, tag: string, idProp: string) => {
      const source: string = readPage(page);
      const element: string = getOnlyJsxElement(source, tag);

      expect(source).toContain(SERVICE_TYPE_IMPORT);
      expect(getJsxProp(element, "scopeEntityType")).toBe(
        "ServiceType.RealUserMonitor",
      );
      // The filter still uses the RumApplication id itself.
      expect(getJsxProp(element, idProp)).toBe(
        idProp === "serviceIds" ? "[modelId]" : "modelId",
      );
    },
  );

  test.each(RUM_CASES)(
    "%s never labels the RUM application as a Service",
    (page: string) => {
      const source: string = readPage(page);

      expect(source).not.toContain("ServiceType.OpenTelemetry");
      expect(source).not.toContain("useServiceNames");
    },
  );

  test("RUM Logs keeps its viewer id, realtime and filters", () => {
    const element: string = getOnlyJsxElement(
      readPage("Rum/View/Logs.tsx"),
      "DashboardLogsViewer",
    );

    expect(getJsxProp(element, "id")).toBe(
      "`rum-application-logs-${modelId.toString()}`",
    );
    expect(getJsxProp(element, "showFilters")).toBe("true");
    expect(getJsxProp(element, "enableRealtime")).toBe("true");
  });
});

describe("Service pages", () => {
  const SERVICE_CASES: Array<[string, string, string]> = [
    ["Service/View/Logs.tsx", "DashboardLogsViewer", "serviceIds"],
    ["Service/View/Traces.tsx", "TracesViewer", "primaryEntityId"],
    ["Service/View/Exceptions.tsx", "ExceptionsViewer", "primaryEntityId"],
  ];

  test.each(SERVICE_CASES)(
    "%s tells %s its scope id is a Service",
    (page: string, tag: string, idProp: string) => {
      const source: string = readPage(page);
      const element: string = getOnlyJsxElement(source, tag);

      expect(source).toContain(SERVICE_TYPE_IMPORT);
      expect(getJsxProp(element, "scopeEntityType")).toBe(
        "ServiceType.OpenTelemetry",
      );
      expect(getJsxProp(element, idProp)).toBe(
        idProp === "serviceIds" ? "[modelId]" : "modelId",
      );
      expect(source).not.toContain("ServiceType.RealUserMonitor");
    },
  );

  test("Service Logs keeps its id, limit and realtime", () => {
    const element: string = getOnlyJsxElement(
      readPage("Service/View/Logs.tsx"),
      "DashboardLogsViewer",
    );

    expect(getJsxProp(element, "id")).toBe('"service-logs"');
    expect(getJsxProp(element, "limit")).toBe("100");
    expect(getJsxProp(element, "enableRealtime")).toBe("true");
  });
});

describe("Host pages", () => {
  test("Host Logs labels the host.name chip 'Host' and shows the host's name", () => {
    const source: string = readPage("Host/View/Logs.tsx");
    const element: string = getOnlyJsxElement(source, "DashboardLogsViewer");

    expect(getObjectProp(element, "attributeFilterDisplayKeys")).toEqual({
      "resource.host.name": '"Host"',
    });
    expect(getObjectProp(element, "attributeFilterDisplayValues")).toEqual({
      "resource.host.name": "host.name || host.hostIdentifier!",
    });

    // The page must load the name it displays.
    expect(source).toMatch(/select: \{ hostIdentifier: true, name: true, \}/);
  });

  test("Host Logs still filters on the hostIdentifier", () => {
    const source: string = readPage("Host/View/Logs.tsx");
    const element: string = getOnlyJsxElement(source, "DashboardLogsViewer");

    expect(source).toContain(
      '"resource.host.name": host?.hostIdentifier || ""',
    );
    expect(getJsxProp(element, "logQuery")).toBe("logQuery");

    const entityScope: string = getJsxProp(element, "entityScope")!;
    expect(entityScope).toContain('attributeKey: "resource.host.name"');
    expect(entityScope).toContain("attributeValue: host.hostIdentifier!");
    expect(entityScope).not.toContain("host.name ||");
  });

  test.each([
    ["Host/View/Metrics.tsx", "MetricsViewer"],
    ["Host/View/Traces.tsx", "TracesViewer"],
  ])(
    "%s shows the host's name on the host.name chip but filters on the identifier",
    (page: string, tag: string) => {
      const source: string = readPage(page);
      const element: string = getOnlyJsxElement(source, tag);

      expect(getObjectProp(element, "attributeFilters")).toEqual({
        "resource.host.name": "host.hostIdentifier",
      });
      expect(getObjectProp(element, "attributeFilterDisplayKeys")).toEqual({
        "resource.host.name": '"Host"',
      });
      expect(getObjectProp(element, "attributeFilterDisplayValues")).toEqual({
        "resource.host.name": "host.name || host.hostIdentifier",
      });

      const entityScope: string = getJsxProp(element, "entityScope")!;
      expect(entityScope).toContain("attributeValue: host.hostIdentifier");
      expect(entityScope).not.toContain("host.name ||");

      expect(source).toMatch(/select: \{ hostIdentifier: true, name: true, \}/);
    },
  );
});

describe("Docker and Podman host pages", () => {
  const RUNTIMES: Array<[string, string, string]> = [
    ["Docker", "Docker Host", "docker"],
    ["Podman", "Podman Host", "podman"],
  ];

  test.each(RUNTIMES)(
    "%s host Logs labels host and runtime chips and shows the host's name",
    (runtime: string, hostLabel: string, runtimeSlug: string) => {
      const source: string = readPage(`${runtime}/View/Logs.tsx`);
      const element: string = getOnlyJsxElement(source, "DashboardLogsViewer");

      expect(getObjectProp(element, "attributeFilterDisplayKeys")).toEqual({
        "resource.host.name": `"${hostLabel}"`,
        "resource.container.runtime": '"Runtime"',
      });
      expect(getObjectProp(element, "attributeFilterDisplayValues")).toEqual({
        "resource.host.name": 'host.name || host.hostIdentifier || ""',
      });

      // Filters unchanged: machine identifier + runtime slug.
      expect(source).toContain(
        '"resource.host.name": host?.hostIdentifier || ""',
      );
      expect(source).toContain(
        `"resource.container.runtime": "${runtimeSlug}"`,
      );
      expect(source).toMatch(/select: \{ hostIdentifier: true, name: true, \}/);
    },
  );

  test.each(RUNTIMES)(
    "%s host Traces shows the host's name on the host chip",
    (runtime: string, hostLabel: string) => {
      const source: string = readPage(`${runtime}/View/Traces.tsx`);
      const element: string = getOnlyJsxElement(source, "TracesViewer");

      expect(getObjectProp(element, "attributeFilters")).toEqual({
        "resource.host.name": "host.hostIdentifier",
      });
      expect(getObjectProp(element, "attributeFilterDisplayKeys")).toEqual({
        "resource.host.name": `"${hostLabel}"`,
      });
      expect(getObjectProp(element, "attributeFilterDisplayValues")).toEqual({
        "resource.host.name": "host.name || host.hostIdentifier",
      });
      expect(source).toMatch(/select: \{ hostIdentifier: true, name: true, \}/);
    },
  );
});

describe("Docker and Podman container detail Logs tab", () => {
  const RUNTIMES: Array<[string, string, string]> = [
    ["Docker", "Docker Host", "docker"],
    ["Podman", "Podman Host", "podman"],
  ];

  test.each(RUNTIMES)(
    "%s container logs chips read Host / Runtime / Container with names",
    (runtime: string, hostLabel: string) => {
      const source: string = readPage(`${runtime}/View/ContainerDetail.tsx`);
      const element: string = getOnlyJsxElement(source, "DashboardLogsViewer");

      expect(getJsxProp(element, "attributeFilterDisplayKeys")).toBe(
        "LOG_ATTRIBUTE_DISPLAY_KEYS",
      );
      expect(getJsxProp(element, "attributeFilterDisplayValues")).toBe(
        "logAttributeDisplayValues",
      );

      expect(getConstObject(source, "LOG_ATTRIBUTE_DISPLAY_KEYS")).toEqual({
        "resource.host.name": `"${hostLabel}"`,
        "resource.container.runtime": '"Runtime"',
        "resource.container.id": '"Container"',
      });
    },
  );

  test.each(RUNTIMES)(
    "%s container chip shows the container name, host chip the host name",
    (runtime: string) => {
      const source: string = readPage(`${runtime}/View/ContainerDetail.tsx`);

      const memoStart: number = source.indexOf(
        "const logAttributeDisplayValues: Record<string, string> = useMemo(",
      );
      expect(memoStart).toBeGreaterThan(-1);

      const memo: string = readBalanced(
        source,
        source.indexOf("(", memoStart + "const ".length),
      );

      expect(memo).toContain(
        '"resource.host.name": host?.name || host?.hostIdentifier || ""',
      );
      /*
       * Only override the container chip when the id filter is actually
       * pinned, and prefer the name the user clicked through from.
       */
      expect(memo).toMatch(
        /if \(containerId\) \{ displayValues\["resource\.container\.id"\] = containerName \|\| containerId; \}/,
      );
      expect(memo).toContain(
        "[host?.name, host?.hostIdentifier, containerId, containerName]",
      );
    },
  );

  test.each(RUNTIMES)(
    "%s container logs still filter on the host identifier and container id",
    (runtime: string, _hostLabel: string, runtimeSlug: string) => {
      const source: string = readPage(`${runtime}/View/ContainerDetail.tsx`);

      expect(getConstString(source, "CONTAINER_ID_ATTR")).toBe(
        "resource.container.id",
      );
      expect(source).toContain(
        `const attributeFilters: Record<string, string> = { "resource.host.name": host?.hostIdentifier || "", "resource.container.runtime": "${runtimeSlug}", };`,
      );
      expect(source).toContain(
        'if (containerId) { attributeFilters["resource.container.id"] = containerId; }',
      );
      expect(source).toMatch(/select: \{ hostIdentifier: true, name: true, \}/);
    },
  );

  test.each(RUNTIMES)(
    "%s container overview shows the host's name before its identifier",
    (runtime: string) => {
      const source: string = readPage(`${runtime}/View/ContainerDetail.tsx`);

      expect(source).toContain(
        '<InfoCard title="Host" value={host.name || host.hostIdentifier || "—"} />',
      );
      expect(source).not.toContain(
        '<InfoCard title="Host" value={host.hostIdentifier || "—"} />',
      );
    },
  );

  test("the display-values memo runs before any early return (rules of hooks)", () => {
    for (const runtime of ["Docker", "Podman"]) {
      const source: string = readPage(`${runtime}/View/ContainerDetail.tsx`);

      expect(source.indexOf("const logAttributeDisplayValues")).toBeLessThan(
        source.indexOf("if (isLoading) {"),
      );
    }
  });
});

describe("Network device Logs page", () => {
  const PAGE: string = "NetworkDevice/View/Logs.tsx";

  test("fetches the device name for the chip", () => {
    const source: string = readPage(PAGE);

    expect(source).toContain(
      'import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";',
    );
    expect(source).toContain(
      'import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";',
    );
    expect(source).toMatch(
      /await ModelAPI\.getItem\(\{ modelType: NetworkDevice, id: modelId, select: \{ name: true, \}, \}\)/,
    );
  });

  test("labels the networkDevice.id chip 'Network Device' and shows the name once known", () => {
    const source: string = readPage(PAGE);
    const element: string = getOnlyJsxElement(source, "DashboardLogsViewer");

    expect(getConstString(source, "NETWORK_DEVICE_ID_ATTR")).toBe(
      "networkDevice.id",
    );
    expect(getJsxProp(element, "attributeFilterDisplayKeys")).toBe(
      "LOG_ATTRIBUTE_DISPLAY_KEYS",
    );
    expect(getConstObject(source, "LOG_ATTRIBUTE_DISPLAY_KEYS")).toEqual({
      "[NETWORK_DEVICE_ID_ATTR]": '"Network Device"',
    });

    expect(getJsxProp(element, "attributeFilterDisplayValues")).toBe(
      "attributeFilterDisplayValues",
    );
    /*
     * No override until the name is known, so the chip falls back to the id
     * rather than going blank.
     */
    expect(source).toMatch(
      /const attributeFilterDisplayValues: Record<string, string> \| undefined = useMemo\(\(\) => \{ if \(!deviceName\) \{ return undefined; \} return \{ \[NETWORK_DEVICE_ID_ATTR\]: deviceName, \}; \}, \[deviceName\]\);/,
    );
  });

  test("still filters on the device id", () => {
    const source: string = readPage(PAGE);
    const element: string = getOnlyJsxElement(source, "DashboardLogsViewer");

    expect(source).toContain(
      "attributes: { [NETWORK_DEVICE_ID_ATTR]: modelId.toString(), },",
    );
    expect(getJsxProp(element, "logQuery")).toBe("logQuery");
    expect(getJsxProp(element, "id")).toBe(
      "`network-device-logs-${modelId.toString()}`",
    );
  });

  test("a failed name lookup never hides the logs", () => {
    const source: string = readPage(PAGE);

    // There is no error state that could replace the viewer.
    expect(source).not.toContain("ErrorMessage");
    expect(source).not.toContain("setError");

    // The catch resets the name and loading still ends.
    expect(source).toMatch(
      /catch \{ setDeviceName\(""\); \} setIsLoading\(false\);/,
    );
    expect(source).toMatch(
      /fetchDeviceName\(\)\.catch\(\(\) => \{ setIsLoading\(false\); \}\);/,
    );

    // Loading is the only early return before the viewer renders.
    const earlyReturns: Array<string> =
      source.match(/if \([^)]*\) \{ return <[A-Za-z]+/g) || [];
    expect(earlyReturns).toEqual(["if (isLoading) { return <PageLoader"]);
  });

  test("hooks are all declared before the loading early return", () => {
    const source: string = readPage(PAGE);
    const earlyReturn: number = source.indexOf("if (isLoading) {");

    for (const hook of [
      "useState<string>",
      "useState<boolean>",
      "useEffect(",
      "const logQuery: Query<Log> = useMemo(",
      "const attributeFilterDisplayValues",
    ]) {
      const index: number = source.indexOf(hook);
      expect({ hook, declared: index > -1 }).toEqual({ hook, declared: true });
      expect({ hook, beforeReturn: index < earlyReturn }).toEqual({
        hook,
        beforeReturn: true,
      });
    }
  });
});
