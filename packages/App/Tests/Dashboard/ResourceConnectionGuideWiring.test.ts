import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Every agent-fed resource's overview shows ResourceConnectionGuideCard - a
 * short "how do I connect this?" card - straight under its hero, beside the
 * Connected / Disconnected badge it explains. A resource created by hand
 * reads "Disconnected" from the start, and this card is the only thing on
 * the overview that says what to do about it.
 *
 * Per page this pins what a render test would miss for pages it does not
 * render:
 * - the card sits immediately after the hero;
 * - it reads status and lastSeenAt off the resource the page loaded;
 * - it is given that resource's own guide, built from the column ingest
 *   matches incoming data on (clusterIdentifier, hostIdentifier, name ...);
 * - its link opens that resource's own Documentation tab.
 *
 * The App suite runs in node without a React renderer, so the pages are
 * parsed with the TypeScript compiler and read off the syntax tree.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type JsxElementLike = ts.JsxSelfClosingElement | ts.JsxOpeningElement;

type ParseFunction = (relativePath: string) => ts.SourceFile;

const parse: ParseFunction = (relativePath: string): ts.SourceFile => {
  const filePath: string = path.join(DASHBOARD_SRC, relativePath);

  return ts.createSourceFile(
    path.basename(filePath),
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
};

type CollectJsxElementsFunction = (
  root: ts.Node,
  tagName: string,
  source: ts.SourceFile,
) => Array<JsxElementLike>;

const collectJsxElements: CollectJsxElementsFunction = (
  root: ts.Node,
  tagName: string,
  source: ts.SourceFile,
): Array<JsxElementLike> => {
  const found: Array<JsxElementLike> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText(source) === tagName
    ) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };

  visit(root);

  return found;
};

type GetAttributeTextFunction = (
  element: JsxElementLike,
  name: string,
  source: ts.SourceFile,
) => string | undefined;

// The source text of a prop's {expression}, whitespace collapsed.
const getAttributeText: GetAttributeTextFunction = (
  element: JsxElementLike,
  name: string,
  source: ts.SourceFile,
): string | undefined => {
  const attribute: ts.JsxAttribute | undefined =
    element.attributes.properties.find(
      (property: ts.JsxAttributeLike): property is ts.JsxAttribute => {
        return (
          ts.isJsxAttribute(property) && property.name.getText(source) === name
        );
      },
    );

  const initializer: ts.JsxAttributeValue | undefined = attribute?.initializer;

  if (!initializer || !ts.isJsxExpression(initializer)) {
    return undefined;
  }

  return initializer.expression?.getText(source).replace(/\s+/g, " ");
};

/*
 * The JSX child that follows `{renderHero()}`, skipping whitespace and
 * {/* comment *\/} children - the element the reader sees right under the
 * hero.
 */
type ChildAfterHeroFunction = (source: ts.SourceFile) => ts.JsxChild | null;

const childAfterHero: ChildAfterHeroFunction = (
  source: ts.SourceFile,
): ts.JsxChild | null => {
  let result: ts.JsxChild | null = null;

  const isHero: (child: ts.JsxChild) => boolean = (
    child: ts.JsxChild,
  ): boolean => {
    return (
      ts.isJsxExpression(child) &&
      Boolean(child.expression) &&
      child.expression!.getText(source) === "renderHero()"
    );
  };

  const isNoise: (child: ts.JsxChild) => boolean = (
    child: ts.JsxChild,
  ): boolean => {
    return (
      (ts.isJsxText(child) && child.getText(source).trim() === "") ||
      (ts.isJsxExpression(child) && !child.expression)
    );
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const children: Array<ts.JsxChild> = Array.from(node.children);
      const heroIndex: number = children.findIndex(isHero);

      if (heroIndex >= 0) {
        result =
          children.slice(heroIndex + 1).find((child: ts.JsxChild) => {
            return !isNoise(child);
          }) || null;
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);

  return result;
};

interface HeroPageCase {
  file: string;
  resourceVariable: string;
  // The column the guide is built from - the one ingest matches on.
  identifierColumn: string;
  builder: string;
  documentationPage: string;
  /*
   * Set for a page that routes every tab through one local helper (the
   * storage array overview's getViewRoute(pageKey)) rather than spelling
   * RouteMap[...] out at each link. The card must then hand the
   * Documentation tab to that helper, and the helper must fill the page's
   * route with this resource's id - the same route, reached one call away.
   */
  documentationRouteHelper?: string;
}

const HERO_PAGES: Array<[string, HeroPageCase]> = [
  [
    "Kubernetes cluster",
    {
      file: "Pages/Kubernetes/View/Index.tsx",
      resourceVariable: "cluster",
      identifierColumn: "clusterIdentifier",
      builder: "getKubernetesClusterConnectionGuide",
      documentationPage: "KUBERNETES_CLUSTER_VIEW_DOCUMENTATION",
    },
  ],
  [
    "Docker host",
    {
      file: "Pages/Docker/View/Overview.tsx",
      resourceVariable: "host",
      identifierColumn: "hostIdentifier",
      builder: "getDockerHostConnectionGuide",
      documentationPage: "DOCKER_HOST_VIEW_DOCUMENTATION",
    },
  ],
  [
    "Podman host",
    {
      file: "Pages/Podman/View/Overview.tsx",
      resourceVariable: "host",
      identifierColumn: "hostIdentifier",
      builder: "getPodmanHostConnectionGuide",
      documentationPage: "PODMAN_HOST_VIEW_DOCUMENTATION",
    },
  ],
  [
    "Docker Swarm cluster",
    {
      file: "Pages/DockerSwarm/View/Index.tsx",
      resourceVariable: "cluster",
      identifierColumn: "name",
      builder: "getDockerSwarmClusterConnectionGuide",
      documentationPage: "DOCKER_SWARM_CLUSTER_VIEW_DOCUMENTATION",
    },
  ],
  [
    "Host",
    {
      file: "Pages/Host/View/Overview.tsx",
      resourceVariable: "host",
      identifierColumn: "hostIdentifier",
      builder: "getHostConnectionGuide",
      documentationPage: "HOST_VIEW_DOCUMENTATION",
    },
  ],
  [
    "IoT fleet",
    {
      file: "Pages/IoT/View/Index.tsx",
      resourceVariable: "fleet",
      identifierColumn: "name",
      builder: "getIoTFleetConnectionGuide",
      documentationPage: "IOT_FLEET_VIEW_DOCUMENTATION",
    },
  ],
  [
    "Proxmox cluster",
    {
      file: "Pages/Proxmox/View/Index.tsx",
      resourceVariable: "cluster",
      identifierColumn: "name",
      builder: "getProxmoxClusterConnectionGuide",
      documentationPage: "PROXMOX_CLUSTER_VIEW_DOCUMENTATION",
    },
  ],
  [
    "Ceph cluster",
    {
      file: "Pages/Ceph/View/Index.tsx",
      resourceVariable: "cluster",
      identifierColumn: "name",
      builder: "getCephClusterConnectionGuide",
      documentationPage: "CEPH_CLUSTER_VIEW_DOCUMENTATION",
    },
  ],
  [
    "VMware vCenter",
    {
      file: "Pages/VMware/View/Index.tsx",
      resourceVariable: "vcenter",
      identifierColumn: "name",
      builder: "getVMwareVCenterConnectionGuide",
      documentationPage: "VMWARE_VCENTER_VIEW_DOCUMENTATION",
    },
  ],
  [
    "Storage array",
    {
      file: "Pages/StorageArray/View/Index.tsx",
      resourceVariable: "storageArray",
      identifierColumn: "name",
      builder: "getStorageArrayConnectionGuide",
      documentationPage: "STORAGE_ARRAY_VIEW_DOCUMENTATION",
      documentationRouteHelper: "getViewRoute",
    },
  ],
];

interface SharedOverviewPageCase {
  file: string;
  resourceVariable: string;
  identifierColumn: string;
  builder: string;
  documentationPage: string;
}

// Pages built on the shared ResourceOverview, which takes the card as a prop.
const SHARED_OVERVIEW_PAGES: Array<[string, SharedOverviewPageCase]> = [
  [
    "Serverless function",
    {
      file: "Pages/Serverless/View/Overview.tsx",
      resourceVariable: "fn",
      identifierColumn: "functionIdentifier",
      builder: "getServerlessFunctionConnectionGuide",
      documentationPage: "SERVERLESS_FUNCTION_VIEW_DOCUMENTATION",
    },
  ],
  [
    "RUM application",
    {
      file: "Pages/Rum/View/Overview.tsx",
      resourceVariable: "a",
      identifierColumn: "appIdentifier",
      builder: "getRumApplicationConnectionGuide",
      documentationPage: "RUM_APPLICATION_VIEW_DOCUMENTATION",
    },
  ],
  [
    "Cloud environment",
    {
      file: "Pages/Cloud/View/Overview.tsx",
      resourceVariable: "r",
      identifierColumn: "cloudPlatform",
      builder: "getCloudResourceConnectionGuide",
      documentationPage: "CLOUD_RESOURCE_VIEW_DOCUMENTATION",
    },
  ],
];

const ROUTE_MAP_SOURCE: string = fs.readFileSync(
  path.join(DASHBOARD_SRC, "Utils", "RouteMap.ts"),
  "utf8",
);

interface RouteHelper {
  parameter: string;
  // The helper's body, whitespace collapsed and trailing commas dropped.
  body: string;
}

type ReadRouteHelperFunction = (
  source: ts.SourceFile,
  name: string,
) => RouteHelper | null;

// A page's `const <name> = (pageKey: PageMap): Route => { ... }`.
const readRouteHelper: ReadRouteHelperFunction = (
  source: ts.SourceFile,
  name: string,
): RouteHelper | null => {
  let found: RouteHelper | null = null;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === name &&
      node.initializer &&
      ts.isArrowFunction(node.initializer) &&
      node.initializer.parameters.length === 1
    ) {
      found = {
        parameter: node.initializer.parameters[0]!.name.getText(source),
        body: node.initializer.body
          .getText(source)
          .replace(/\s+/g, " ")
          .replace(/,(\s*[})])/g, "$1"),
      };
    }
    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
};

type ExpectCardPropsFunction = (
  card: JsxElementLike,
  source: ts.SourceFile,
  pageCase: HeroPageCase | SharedOverviewPageCase,
) => void;

const expectCardProps: ExpectCardPropsFunction = (
  card: JsxElementLike,
  source: ts.SourceFile,
  pageCase: HeroPageCase | SharedOverviewPageCase,
): void => {
  const resource: string = pageCase.resourceVariable;

  expect(getAttributeText(card, "status", source)).toBe(
    `${resource}.otelCollectorStatus as string | undefined`,
  );
  expect(getAttributeText(card, "lastSeenAt", source)).toBe(
    `${resource}.lastSeenAt`,
  );

  const guide: string = getAttributeText(card, "guide", source) || "";

  expect(guide.startsWith(`${pageCase.builder}(`)).toBe(true);
  expect(guide).toContain(`${resource}.${pageCase.identifierColumn}`);

  const route: string =
    getAttributeText(card, "documentationRoute", source) || "";
  const helperName: string | undefined = (pageCase as HeroPageCase)
    .documentationRouteHelper;

  if (helperName) {
    // The call may be wrapped: read it without whitespace or a trailing comma.
    expect(route.replace(/\s+/g, "").replace(/,\)$/, ")")).toBe(
      `${helperName}(PageMap.${pageCase.documentationPage})`,
    );

    const helper: RouteHelper | null = readRouteHelper(source, helperName);

    expect(helper).not.toBeNull();
    expect(helper!.body).toBe(
      `{ return RouteUtil.populateRouteParams(RouteMap[${helper!.parameter}] as Route, { modelId: modelId }); }`,
    );
    return;
  }

  expect(route).toContain(
    `RouteMap[PageMap.${pageCase.documentationPage}] as Route`,
  );
  expect(route).toContain("{ modelId: modelId }");
};

describe.each(HERO_PAGES)(
  "the %s overview",
  (_name: string, pageCase: HeroPageCase) => {
    const source: ts.SourceFile = parse(pageCase.file);
    const cards: Array<JsxElementLike> = collectJsxElements(
      source,
      "ResourceConnectionGuideCard",
      source,
    );

    test("draws the connection guide card exactly once", () => {
      expect(cards).toHaveLength(1);
    });

    test("draws it right under the hero", () => {
      const next: ts.JsxChild | null = childAfterHero(source);

      const positionOf: (card: JsxElementLike) => number = (
        card: JsxElementLike,
      ): number => {
        return card.pos;
      };

      expect(next).not.toBeNull();
      expect(
        collectJsxElements(next!, "ResourceConnectionGuideCard", source).map(
          positionOf,
        ),
      ).toEqual(cards.map(positionOf));
    });

    test("feeds it this resource's status, last-seen time, guide and Documentation tab", () => {
      expectCardProps(cards[0]!, source, pageCase);
    });

    test("imports the card and its own guide from the shared folder", () => {
      const text: string = source.getFullText();

      expect(text).toContain(
        'import ResourceConnectionGuideCard from "../../../Components/ResourceConnection/ResourceConnectionGuideCard";',
      );
      expect(text).toMatch(
        new RegExp(
          `import \\{ ${pageCase.builder} \\} from "../../../Components/ResourceConnection/ResourceConnectionGuides";`,
        ),
      );
    });

    test("the Documentation tab it links to is a routed page", () => {
      expect(ROUTE_MAP_SOURCE).toContain(
        `[PageMap.${pageCase.documentationPage}]: new Route(`,
      );
    });
  },
);

describe.each(SHARED_OVERVIEW_PAGES)(
  "the %s overview",
  (_name: string, pageCase: SharedOverviewPageCase) => {
    const source: ts.SourceFile = parse(pageCase.file);
    const overviews: Array<JsxElementLike> = collectJsxElements(
      source,
      "ResourceOverview",
      source,
    );
    const cards: Array<JsxElementLike> = collectJsxElements(
      source,
      "ResourceConnectionGuideCard",
      source,
    );

    test("hands the card to ResourceOverview as its connectionGuide", () => {
      expect(overviews).toHaveLength(1);
      expect(cards).toHaveLength(1);

      const connectionGuide: string =
        getAttributeText(overviews[0]!, "connectionGuide", source) || "";

      expect(connectionGuide).toContain("<ResourceConnectionGuideCard");
    });

    test("feeds it this resource's status, last-seen time, guide and Documentation tab", () => {
      expectCardProps(cards[0]!, source, pageCase);
    });

    test("the card agrees with the pill: both read the same status and last-seen time", () => {
      expect(getAttributeText(overviews[0]!, "lastSeenAt", source)).toBe(
        `${pageCase.resourceVariable}.lastSeenAt`,
      );
      expect(getAttributeText(overviews[0]!, "status", source)).toBe(
        `${pageCase.resourceVariable}.otelCollectorStatus`,
      );
    });

    test("the Documentation tab it links to is a routed page", () => {
      expect(ROUTE_MAP_SOURCE).toContain(
        `[PageMap.${pageCase.documentationPage}]: new Route(`,
      );
    });
  },
);

describe("the Cloud environment overview", () => {
  const source: ts.SourceFile = parse("Pages/Cloud/View/Overview.tsx");
  const overview: JsxElementLike = collectJsxElements(
    source,
    "ResourceOverview",
    source,
  )[0]!;

  test("shows the card only for an environment with a cloud.platform - an unscoped one already has its 'Waiting for telemetry' banner", () => {
    const connectionGuide: string =
      getAttributeText(overview, "connectionGuide", source) || "";

    expect(connectionGuide).toMatch(
      /^isScoped \? \( <ResourceConnectionGuideCard[\s\S]*\) : undefined$/,
    );
    expect(source.getFullText()).toContain("{!isScoped ? (");
    expect(
      collectJsxElements(source, "CloudResourceConnectBanner", source),
    ).toHaveLength(1);
  });

  test("builds its guide from all three attributes the environment is keyed on", () => {
    const card: JsxElementLike = collectJsxElements(
      source,
      "ResourceConnectionGuideCard",
      source,
    )[0]!;
    const guide: string = getAttributeText(card, "guide", source) || "";

    for (const column of ["cloudPlatform", "cloudAccountId", "cloudRegion"]) {
      expect(guide).toContain(`${column}: r.${column} as string | undefined`);
    }
  });
});

describe("the shared ResourceOverview", () => {
  const text: string = fs.readFileSync(
    path.join(
      DASHBOARD_SRC,
      "Components",
      "TelemetryResource",
      "ResourceOverview.tsx",
    ),
    "utf8",
  );

  test("takes an optional connectionGuide", () => {
    expect(text).toMatch(/connectionGuide\?: ReactElement \| undefined;/);
  });

  test("draws it after the hero and before the metric tiles", () => {
    const hero: number = text.indexOf("{/* Hero */}");
    const guide: number = text.indexOf("{props.connectionGuide ?");
    const tiles: number = text.indexOf("{/* Golden metric tiles */}");

    expect(hero).toBeGreaterThan(-1);
    expect(guide).toBeGreaterThan(hero);
    expect(tiles).toBeGreaterThan(guide);
  });
});

describe("the Database overview", () => {
  /*
   * Deliberately left out: its pill is about when ANY source last saw the
   * database ("Seen recently" / "Never seen"), not a collector's
   * Connected / Disconnected, and it already explains how to connect engine
   * metrics in its own card and unscoped banner.
   */
  test("does not draw the connection guide card", () => {
    const source: ts.SourceFile = parse("Pages/Database/View/Overview.tsx");

    expect(
      collectJsxElements(source, "ResourceConnectionGuideCard", source),
    ).toHaveLength(0);
  });
});
