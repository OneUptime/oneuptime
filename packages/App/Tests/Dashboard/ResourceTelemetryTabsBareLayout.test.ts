import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A resource's Traces and Metrics tabs (Kubernetes, Host, Inventory, ...)
 * render their viewer bare, straight into the resource layout. Its Logs tab
 * used to wrap the same kind of viewer in a Card ("Cluster Logs", "Host
 * Logs", ...), which put a second frame, a heading and padding around a viewer
 * that already brings its own toolbar, histogram and table — so the Logs tab
 * looked different from the tabs next to it.
 *
 * The App suite runs in plain Node with no renderer, so these read the page
 * sources (comments stripped) and locate JSX elements with a small scanner
 * that understands attribute braces, strings and template literals. The
 * tabs are DISCOVERED by scanning Pages/<Resource>/View/{Logs,Traces,Metrics}.tsx
 * for the shared viewer import, so a new resource tab is held to the same
 * rule without editing this file. What the pages actually render is covered
 * by Common/Tests/App/Dashboard/ResourceLogsTabsBareLayout.test.tsx.
 */

const PAGES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
);

type Signal = "Logs" | "Traces" | "Metrics";

const SIGNALS: Array<Signal> = ["Logs", "Traces", "Metrics"];

const VIEWER_MODULES: Record<Signal, string> = {
  Logs: "../../../Components/Logs/LogsViewer",
  Traces: "../../../Components/Traces/TracesViewer",
  Metrics: "../../../Components/Metrics/MetricsViewer",
};

const CARD_IMPORT: string =
  'import Card from "Common/UI/Components/Card/Card";';

// What an element with no JSX parent reports as its container.
const ROOT: string = "(root)";
const FRAGMENT: string = "Fragment";
const BARE_CONTAINERS: Array<string> = [ROOT, FRAGMENT];

const CARD_LIKE_NAME: RegExp = /Card$/;
const ATTRIBUTE_NAME_START: RegExp = /[A-Za-z_]/;
const ATTRIBUTE_NAME_PART: RegExp = /[\w-]/;
const EMPTY_STATE_MESSAGE: RegExp = /^"No [^"]+"$/;

interface JsxElement {
  name: string;
  // Offset of the "<" that opens the element.
  start: number;
  // Offset just past the opening tag's ">" (or "/>").
  openEnd: number;
  // Offset of the closing tag's "<"; equals openEnd for a self-closing tag.
  closeStart: number;
  selfClosing: boolean;
}

interface OpeningTag {
  openEnd: number;
  selfClosing: boolean;
}

interface TelemetryTab {
  resource: string;
  signal: Signal;
  source: string;
  viewerName: string;
  elements: Array<JsxElement>;
}

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// `start` is on a quote; returns the offset just past its closing quote.
function skipQuoted(source: string, start: number): number {
  const quote: string = source[start]!;
  let index: number = start + 1;

  while (index < source.length) {
    const char: string = source[index]!;

    if (char === "\\") {
      index += 2;
      continue;
    }

    if (char === quote) {
      return index + 1;
    }

    if (quote === "`" && char === "$" && source[index + 1] === "{") {
      index = skipBraces(source, index + 1);
      continue;
    }

    index++;
  }

  throw new Error(`Unterminated ${quote} string at offset ${start}.`);
}

// `start` is on a "{"; returns the offset just past its matching "}".
function skipBraces(source: string, start: number): number {
  let depth: number = 0;
  let index: number = start;

  while (index < source.length) {
    const char: string = source[index]!;

    if (char === '"' || char === "'" || char === "`") {
      index = skipQuoted(source, index);
      continue;
    }

    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;

      if (depth === 0) {
        return index + 1;
      }
    }

    index++;
  }

  throw new Error(`Unbalanced "{" at offset ${start}.`);
}

function scanOpeningTag(
  source: string,
  start: number,
  name: string,
): OpeningTag | null {
  let index: number = start + 1 + name.length;

  while (index < source.length) {
    const char: string = source[index]!;

    if (char === "{") {
      index = skipBraces(source, index);
      continue;
    }

    if (char === '"' || char === "'") {
      index = skipQuoted(source, index);
      continue;
    }

    if (char === "/" && source[index + 1] === ">") {
      return { openEnd: index + 2, selfClosing: true };
    }

    if (char === ">") {
      return { openEnd: index + 1, selfClosing: false };
    }

    index++;
  }

  return null;
}

function findCloseStart(
  source: string,
  name: string,
  from: number,
): number | null {
  const token: RegExp = new RegExp(
    `<(/?)${escapeRegExp(name)}(?=[\\s/>])`,
    "g",
  );
  token.lastIndex = from;
  let depth: number = 1;

  for (;;) {
    const match: RegExpExecArray | null = token.exec(source);

    if (!match) {
      return null;
    }

    if (match[1] === "/") {
      depth--;

      if (depth === 0) {
        return match.index;
      }

      continue;
    }

    const nested: OpeningTag | null = scanOpeningTag(source, match.index, name);

    if (!nested) {
      return null;
    }

    if (!nested.selfClosing) {
      depth++;
    }

    token.lastIndex = nested.openEnd;
  }
}

/*
 * Every JSX element in the source, nested ones included. A TypeScript type
 * argument (`useState<boolean>`, `FunctionComponent<Props>`) also starts with
 * "<Name", but it never has a matching closing tag, so it is dropped.
 */
function collectElements(source: string): Array<JsxElement> {
  const elements: Array<JsxElement> = [];
  const tagStart: RegExp = /<([A-Za-z][\w.]*)/g;

  for (;;) {
    const match: RegExpExecArray | null = tagStart.exec(source);

    if (!match) {
      break;
    }

    const name: string = match[1]!;
    const start: number = match.index;

    try {
      const opening: OpeningTag | null = scanOpeningTag(source, start, name);

      if (!opening) {
        continue;
      }

      if (opening.selfClosing) {
        elements.push({
          name,
          start,
          openEnd: opening.openEnd,
          closeStart: opening.openEnd,
          selfClosing: true,
        });
        continue;
      }

      const closeStart: number | null = findCloseStart(
        source,
        name,
        opening.openEnd,
      );

      if (closeStart === null) {
        continue;
      }

      elements.push({
        name,
        start,
        openEnd: opening.openEnd,
        closeStart,
        selfClosing: false,
      });
    } catch {
      // Not JSX: a type argument that ran into unbalanced code.
      continue;
    }
  }

  // Shorthand fragments: <>...</>
  const fragmentToken: RegExp = /<\/?>/g;
  const openFragments: Array<number> = [];

  for (;;) {
    const match: RegExpExecArray | null = fragmentToken.exec(source);

    if (!match) {
      break;
    }

    if (match[0] === "<>") {
      openFragments.push(match.index);
      continue;
    }

    const start: number | undefined = openFragments.pop();

    if (start !== undefined) {
      elements.push({
        name: FRAGMENT,
        start,
        openEnd: start + 2,
        closeStart: match.index,
        selfClosing: false,
      });
    }
  }

  return elements;
}

/*
 * The elements whose CHILDREN contain `target`, outermost first. An element
 * that only holds `target` inside an attribute (a render prop) is not one of
 * them: the target is what that callback returns, not something it wraps.
 */
function ancestorsOf(
  elements: Array<JsxElement>,
  target: JsxElement,
): Array<JsxElement> {
  return elements
    .filter((element: JsxElement) => {
      return (
        !element.selfClosing &&
        element.openEnd <= target.start &&
        target.start < element.closeStart
      );
    })
    .sort((a: JsxElement, b: JsxElement) => {
      return a.start - b.start;
    });
}

function containerOf(elements: Array<JsxElement>, target: JsxElement): string {
  const ancestors: Array<JsxElement> = ancestorsOf(elements, target);
  return ancestors.length > 0 ? ancestors[ancestors.length - 1]!.name : ROOT;
}

// Raw attribute values as written: '"text"', '{expr}', or '{true}' for a bare flag.
function getJsxAttributes(
  source: string,
  element: JsxElement,
): Record<string, string> {
  const attributes: Record<string, string> = {};
  const stop: number = element.selfClosing
    ? element.openEnd - 2
    : element.openEnd - 1;
  let index: number = element.start + 1 + element.name.length;

  while (index < stop) {
    const char: string = source[index]!;

    if (char === "{") {
      // A spread: {...props}
      index = skipBraces(source, index);
      continue;
    }

    if (!ATTRIBUTE_NAME_START.test(char)) {
      index++;
      continue;
    }

    let nameEnd: number = index;

    while (nameEnd < stop && ATTRIBUTE_NAME_PART.test(source[nameEnd]!)) {
      nameEnd++;
    }

    const name: string = source.slice(index, nameEnd);

    if (source[nameEnd] !== "=") {
      attributes[name] = "{true}";
      index = nameEnd;
      continue;
    }

    const valueStart: number = nameEnd + 1;
    const valueEnd: number =
      source[valueStart] === "{"
        ? skipBraces(source, valueStart)
        : skipQuoted(source, valueStart);

    attributes[name] = source.slice(valueStart, valueEnd);
    index = valueEnd;
  }

  return attributes;
}

function getDefaultImportName(
  source: string,
  modulePath: string,
): string | undefined {
  const match: RegExpExecArray | null = new RegExp(
    `import (\\w+) from "${escapeRegExp(modulePath)}";`,
  ).exec(source);

  return match?.[1];
}

function discoverTabs(): Array<TelemetryTab> {
  const tabs: Array<TelemetryTab> = [];

  for (const resource of fs.readdirSync(PAGES_DIR).sort()) {
    for (const signal of SIGNALS) {
      const file: string = path.join(
        PAGES_DIR,
        resource,
        "View",
        `${signal}.tsx`,
      );

      if (!fs.existsSync(file)) {
        continue;
      }

      const source: string = stripComments(fs.readFileSync(file, "utf8"));
      const viewerName: string | undefined = getDefaultImportName(
        source,
        VIEWER_MODULES[signal],
      );

      // Not a telemetry tab (e.g. Monitor/View/Logs.tsx is a probe log table).
      if (!viewerName) {
        continue;
      }

      tabs.push({
        resource,
        signal,
        source,
        viewerName,
        elements: collectElements(source),
      });
    }
  }

  return tabs;
}

const TABS: Array<TelemetryTab> = discoverTabs();

function getTab(resource: string, signal: Signal): TelemetryTab {
  const tab: TelemetryTab | undefined = TABS.find((candidate: TelemetryTab) => {
    return candidate.resource === resource && candidate.signal === signal;
  });

  if (!tab) {
    throw new Error(
      `Expected ${resource}/View/${signal}.tsx to import its telemetry viewer.`,
    );
  }

  return tab;
}

function getElementsNamed(
  elements: Array<JsxElement>,
  name: string,
): Array<JsxElement> {
  return elements.filter((element: JsxElement) => {
    return element.name === name;
  });
}

function getOnlyViewer(tab: TelemetryTab): JsxElement {
  const viewers: Array<JsxElement> = getElementsNamed(
    tab.elements,
    tab.viewerName,
  );

  if (viewers.length !== 1) {
    throw new Error(
      `Expected ${tab.resource}/View/${tab.signal}.tsx to render <${tab.viewerName}> once, found ${viewers.length}.`,
    );
  }

  return viewers[0]!;
}

function namesOf(elements: Array<JsxElement>): Array<string> {
  return elements.map((element: JsxElement) => {
    return element.name;
  });
}

const TAB_TABLE: Array<[string, Signal]> = TABS.map(
  (tab: TelemetryTab): [string, Signal] => {
    return [tab.resource, tab.signal];
  },
);

const LOGS_TAB_TABLE: Array<[string]> = TABS.filter((tab: TelemetryTab) => {
  return tab.signal === "Logs";
}).map((tab: TelemetryTab): [string] => {
  return [tab.resource];
});

/*
 * The Logs tabs this change took out of a card: [resource, the card title
 * that is gone, the viewer id prefix the page must keep].
 */
const UNCARDED_LOGS_TABS: Array<[string, string, string]> = [
  ["Ceph", "Cluster Logs", "ceph-cluster-logs"],
  ["Cloud", "Cloud Environment Logs", "cloud-resource-logs"],
  ["Docker", "Container Logs", "docker-host-logs"],
  ["DockerSwarm", "Cluster Logs", "docker-swarm-cluster-logs"],
  ["Host", "Host Logs", "host-logs"],
  ["Inventory", "Logs", "inventory-item-logs"],
  ["IoT", "Fleet Logs", "iot-fleet-logs"],
  ["Kubernetes", "Cluster Logs", "kubernetes-cluster-logs"],
  ["NetworkDevice", "Device Logs", "network-device-logs"],
  ["Podman", "Container Logs", "podman-host-logs"],
  ["Proxmox", "Cluster Logs", "proxmox-cluster-logs"],
  ["Rum", "RUM Application Logs", "rum-application-logs"],
  ["Serverless", "Function Logs", "serverless-logs"],
  ["VMware", "vCenter Logs", "vmware-vcenter-logs"],
];

describe("the JSX scanner these checks rely on", () => {
  test("reports the Card a viewer sits in, past '>' and '=>' inside attributes", () => {
    const source: string = [
      "const Page = (): ReactElement => {",
      "  const [open, setOpen] = useState<boolean>(false);",
      "  const labels: Record<string, string> = {};",
      "  return (",
      '    <Card title="Logs > all" description={"a => b"}>',
      "      <Viewer id={`logs-${modelId.toString()}`} onChange={(next: boolean) => { return setOpen(next); }} />",
      "    </Card>",
      "  );",
      "};",
    ].join("\n");
    const elements: Array<JsxElement> = collectElements(source);
    const viewers: Array<JsxElement> = getElementsNamed(elements, "Viewer");

    expect(viewers).toHaveLength(1);
    expect(containerOf(elements, viewers[0]!)).toBe("Card");
    // Type arguments are not elements.
    expect(namesOf(elements).sort()).toEqual(["Card", "Viewer"]);
  });

  test("a viewer returned from a render prop has no container", () => {
    const source: string =
      "<Shell render={(signal: Props): ReactElement => { return (<Viewer id={`x-${signal.id}`} />); }} />";
    const elements: Array<JsxElement> = collectElements(source);
    const viewer: JsxElement = getElementsNamed(elements, "Viewer")[0]!;

    expect(containerOf(elements, viewer)).toBe(ROOT);
  });

  test("a render prop inside a Card is still inside the Card", () => {
    const source: string =
      '<Card title="t"><Shell render={() => { return <Viewer />; }} /></Card>';
    const elements: Array<JsxElement> = collectElements(source);
    const viewer: JsxElement = getElementsNamed(elements, "Viewer")[0]!;

    expect(containerOf(elements, viewer)).toBe("Card");
  });

  test("CardModelDetail, InfoCard and a self-closing sibling Card do not wrap the viewer", () => {
    const source: string =
      '<Fragment><CardModelDetail name="a"><InfoCard title="b" value="c" /></CardModelDetail><Card title="Help" /><Viewer /></Fragment>';
    const elements: Array<JsxElement> = collectElements(source);
    const viewer: JsxElement = getElementsNamed(elements, "Viewer")[0]!;

    expect(containerOf(elements, viewer)).toBe(FRAGMENT);
    expect(getElementsNamed(elements, "Card")).toHaveLength(1);
    expect(getElementsNamed(elements, "Card")[0]!.selfClosing).toBe(true);
  });

  test("nested cards report the innermost one, and every card-like ancestor is visible", () => {
    const source: string =
      '<Card title="Outer"><div className="mt-4"><Card title="Inner"><Viewer /></Card></div></Card>';
    const elements: Array<JsxElement> = collectElements(source);
    const viewer: JsxElement = getElementsNamed(elements, "Viewer")[0]!;
    const ancestors: Array<JsxElement> = ancestorsOf(elements, viewer);

    expect(namesOf(ancestors)).toEqual(["Card", "div", "Card"]);
    expect(
      getJsxAttributes(source, ancestors[ancestors.length - 1]!)["title"],
    ).toBe('"Inner"');
  });

  test("a shorthand fragment counts as a Fragment, a wrapping div does not", () => {
    const fragment: string = "<><Viewer /></>";
    const fragmentElements: Array<JsxElement> = collectElements(fragment);

    expect(
      containerOf(
        fragmentElements,
        getElementsNamed(fragmentElements, "Viewer")[0]!,
      ),
    ).toBe(FRAGMENT);

    const div: string = '<div className="p-4"><Viewer /></div>';
    const divElements: Array<JsxElement> = collectElements(div);

    expect(
      containerOf(divElements, getElementsNamed(divElements, "Viewer")[0]!),
    ).toBe("div");
  });

  test("a commented-out card cannot make a bare page look carded", () => {
    const source: string = stripComments(
      '<Fragment>{/* <Card title="old"> */}<Viewer />{/* </Card> */}</Fragment>',
    );
    const elements: Array<JsxElement> = collectElements(source);

    expect(getElementsNamed(elements, "Card")).toHaveLength(0);
    expect(
      containerOf(elements, getElementsNamed(elements, "Viewer")[0]!),
    ).toBe(FRAGMENT);
  });

  test("reads attribute values as written, including template literals and bare flags", () => {
    const source: string =
      '<Viewer id={`a-${b.toString()}`} showFilters={true} message="No logs, yet" live {...rest} />';
    const viewer: JsxElement = getElementsNamed(
      collectElements(source),
      "Viewer",
    )[0]!;

    expect(getJsxAttributes(source, viewer)).toEqual({
      id: "{`a-${b.toString()}`}",
      showFilters: "{true}",
      message: '"No logs, yet"',
      live: "{true}",
    });
  });
});

describe("the scan finds the resource telemetry tabs", () => {
  test("Logs, Traces and Metrics tabs are found, including Kubernetes and Inventory", () => {
    for (const signal of SIGNALS) {
      const resources: Array<string> = TABS.filter((tab: TelemetryTab) => {
        return tab.signal === signal;
      }).map((tab: TelemetryTab) => {
        return tab.resource;
      });

      expect({ signal, resources }).toEqual({
        signal,
        resources: expect.arrayContaining(["Kubernetes", "Inventory"]),
      });
    }
  });

  test("every Logs tab this change touched is found by the scan", () => {
    expect(
      LOGS_TAB_TABLE.map((row: [string]) => {
        return row[0];
      }),
    ).toEqual(
      expect.arrayContaining(
        UNCARDED_LOGS_TABS.map((row: [string, string, string]) => {
          return row[0];
        }),
      ),
    );
  });

  test.each(TAB_TABLE)(
    "%s/View/%s.tsx renders its viewer exactly once",
    (resource: string, signal: Signal) => {
      expect(() => {
        return getOnlyViewer(getTab(resource, signal));
      }).not.toThrow();
    },
  );
});

describe("no resource telemetry tab wraps its viewer in a card", () => {
  test.each(TAB_TABLE)(
    "%s/View/%s.tsx renders the viewer bare (at the root or in a Fragment)",
    (resource: string, signal: Signal) => {
      const tab: TelemetryTab = getTab(resource, signal);
      const container: string = containerOf(tab.elements, getOnlyViewer(tab));

      expect(BARE_CONTAINERS).toContain(container);
    },
  );

  test.each(TAB_TABLE)(
    "%s/View/%s.tsx has no card-like element anywhere above the viewer",
    (resource: string, signal: Signal) => {
      const tab: TelemetryTab = getTab(resource, signal);
      const cardLikeAncestors: Array<string> = namesOf(
        ancestorsOf(tab.elements, getOnlyViewer(tab)),
      ).filter((name: string) => {
        return CARD_LIKE_NAME.test(name);
      });

      expect(cardLikeAncestors).toEqual([]);
    },
  );

  test.each(LOGS_TAB_TABLE)(
    "%s Logs imports Card only if it still renders one",
    (resource: string) => {
      const tab: TelemetryTab = getTab(resource, "Logs");

      expect(tab.source.includes(CARD_IMPORT)).toBe(
        getElementsNamed(tab.elements, "Card").length > 0,
      );
    },
  );
});

describe("the Logs tabs taken out of their card", () => {
  test.each(UNCARDED_LOGS_TABS)(
    '%s: the viewer is bare and the "%s" card is gone',
    (resource: string, removedTitle: string) => {
      const tab: TelemetryTab = getTab(resource, "Logs");
      const viewer: JsxElement = getOnlyViewer(tab);

      expect(BARE_CONTAINERS).toContain(containerOf(tab.elements, viewer));

      const cardTitles: Array<string | undefined> = getElementsNamed(
        tab.elements,
        "Card",
      ).map((card: JsxElement) => {
        return getJsxAttributes(tab.source, card)["title"];
      });

      expect(cardTitles).not.toContain(`"${removedTitle}"`);
    },
  );

  test.each(UNCARDED_LOGS_TABS)(
    "%s: the viewer keeps its id, filter bar, live tail and empty-state message",
    (resource: string, _removedTitle: string, idPrefix: string) => {
      const tab: TelemetryTab = getTab(resource, "Logs");
      const attributes: Record<string, string> = getJsxAttributes(
        tab.source,
        getOnlyViewer(tab),
      );

      expect(attributes["id"]).toBeDefined();
      expect(attributes["id"]!.startsWith(`{\`${idPrefix}-\${`)).toBe(true);
      expect(attributes["showFilters"]).toBe("{true}");
      expect(attributes["enableRealtime"]).toBe("{true}");
      expect(attributes["noLogsMessage"]).toMatch(EMPTY_STATE_MESSAGE);
    },
  );

  test("each tab keeps a distinct viewer id prefix", () => {
    const prefixes: Array<string> = UNCARDED_LOGS_TABS.map(
      (row: [string, string, string]) => {
        return row[2];
      },
    );

    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});

describe("NetworkDevice Logs keeps its setup guide below the bare viewer", () => {
  test("the guide is the page's only card and it comes after the viewer", () => {
    const tab: TelemetryTab = getTab("NetworkDevice", "Logs");
    const viewer: JsxElement = getOnlyViewer(tab);
    const cards: Array<JsxElement> = getElementsNamed(tab.elements, "Card");

    expect(cards).toHaveLength(1);
    expect(getJsxAttributes(tab.source, cards[0]!)["title"]).toBe(
      '"Setting up device logging"',
    );
    expect(cards[0]!.start).toBeGreaterThan(viewer.closeStart);
  });

  test("the guide is spaced off the viewer as a sibling, not wrapped around it", () => {
    const tab: TelemetryTab = getTab("NetworkDevice", "Logs");
    const viewer: JsxElement = getOnlyViewer(tab);
    const card: JsxElement = getElementsNamed(tab.elements, "Card")[0]!;
    const cardAncestors: Array<JsxElement> = ancestorsOf(tab.elements, card);
    const spacer: JsxElement = cardAncestors[cardAncestors.length - 1]!;

    expect(containerOf(tab.elements, viewer)).toBe(FRAGMENT);
    expect(spacer.name).toBe("div");
    expect(getJsxAttributes(tab.source, spacer)["className"]).toBe('"mt-4"');
    expect(containerOf(tab.elements, spacer)).toBe(FRAGMENT);
    expect(namesOf(ancestorsOf(tab.elements, viewer))).not.toContain("div");
  });

  test("the guide still tells the user how to turn the syslog receiver on", () => {
    const tab: TelemetryTab = getTab("NetworkDevice", "Logs");
    const card: JsxElement = getElementsNamed(tab.elements, "Card")[0]!;
    const cardBody: string = tab.source.slice(card.openEnd, card.closeStart);

    expect(cardBody).toContain("PROBE_SYSLOG_RECEIVER_ENABLED=true");
    expect(cardBody).toContain("UDP port 162");
    expect(cardBody).toContain("UDP port 5140");
  });
});

describe("Inventory tabs return the viewer straight from the signal page's render prop", () => {
  test.each(
    SIGNALS.map((signal: Signal): [Signal] => {
      return [signal];
    }),
  )("Inventory %s", (signal: Signal) => {
    const tab: TelemetryTab = getTab("Inventory", signal);
    const shells: Array<JsxElement> = getElementsNamed(
      tab.elements,
      "InventorySignalPage",
    );
    const viewer: JsxElement = getOnlyViewer(tab);

    expect(shells).toHaveLength(1);
    // Inside the render attribute, not the shell's children.
    expect(viewer.start).toBeGreaterThan(shells[0]!.start);
    expect(viewer.start).toBeLessThan(shells[0]!.openEnd);
    expect(containerOf(tab.elements, viewer)).toBe(ROOT);
  });
});
