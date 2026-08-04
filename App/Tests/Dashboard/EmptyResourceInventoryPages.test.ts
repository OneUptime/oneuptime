import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Resource inventory pages used to return their setup documentation instead
 * of their ModelTable when the initial count was zero. That made the table's
 * Create button unreachable, so the only way to get the first resource was to
 * send telemetry and let auto-discovery create it.
 *
 * The App test suite runs in a plain Node environment without a React renderer.
 * These tests therefore pin the JSX wiring directly, following the same source
 * invariant pattern as MonitorProbeSelectionPages.test.ts and
 * NetworkSitePageInvariants.test.ts. Whitespace is squashed so Prettier can
 * reflow props without making the tests brittle.
 */

const DASHBOARD_PAGES: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
);

interface ResourceInventoryPageCase {
  readonly label: string;
  readonly relativePath: string;
  readonly modelType: string;
  readonly countState: string;
  readonly countSetter: string;
  readonly documentationCard: string;
}

const RESOURCE_INVENTORY_PAGES: ReadonlyArray<ResourceInventoryPageCase> = [
  {
    label: "RUM applications",
    relativePath: "Rum/RumApplications.tsx",
    modelType: "RumApplication",
    countState: "count",
    countSetter: "setCount",
    documentationCard: "ResourceDocumentationCard",
  },
  {
    label: "Kubernetes clusters",
    relativePath: "Kubernetes/Clusters.tsx",
    modelType: "KubernetesCluster",
    countState: "clusterCount",
    countSetter: "setClusterCount",
    documentationCard: "KubernetesDocumentationCard",
  },
  {
    label: "Docker hosts",
    relativePath: "Docker/Hosts.tsx",
    modelType: "DockerHost",
    countState: "hostCount",
    countSetter: "setHostCount",
    documentationCard: "DockerDocumentationCard",
  },
  {
    label: "Podman hosts",
    relativePath: "Podman/Hosts.tsx",
    modelType: "PodmanHost",
    countState: "hostCount",
    countSetter: "setHostCount",
    documentationCard: "PodmanDocumentationCard",
  },
  {
    label: "Docker Swarm clusters",
    relativePath: "DockerSwarm/Clusters.tsx",
    modelType: "DockerSwarmCluster",
    countState: "clusterCount",
    countSetter: "setClusterCount",
    documentationCard: "DockerSwarmDocumentationCard",
  },
  {
    label: "Proxmox clusters",
    relativePath: "Proxmox/Clusters.tsx",
    modelType: "ProxmoxCluster",
    countState: "clusterCount",
    countSetter: "setClusterCount",
    documentationCard: "ProxmoxDocumentationCard",
  },
  {
    label: "Ceph clusters",
    relativePath: "Ceph/Clusters.tsx",
    modelType: "CephCluster",
    countState: "clusterCount",
    countSetter: "setClusterCount",
    documentationCard: "CephDocumentationCard",
  },
  {
    label: "hosts",
    relativePath: "Host/Hosts.tsx",
    modelType: "Host",
    countState: "hostCount",
    countSetter: "setHostCount",
    documentationCard: "HostDocumentationCard",
  },
  {
    label: "IoT fleets",
    relativePath: "IoT/Fleets.tsx",
    modelType: "IoTFleet",
    countState: "fleetCount",
    countSetter: "setFleetCount",
    documentationCard: "IoTDocumentationCard",
  },
  {
    label: "cloud resources",
    relativePath: "Cloud/CloudResources.tsx",
    modelType: "CloudResource",
    countState: "count",
    countSetter: "setCount",
    documentationCard: "ResourceDocumentationCard",
  },
  {
    label: "serverless functions",
    relativePath: "Serverless/ServerlessFunctions.tsx",
    modelType: "ServerlessFunction",
    countState: "count",
    countSetter: "setCount",
    documentationCard: "ResourceDocumentationCard",
  },
];

function squash(source: string): string {
  return source.replace(/\s+/g, " ");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readRawSource(resourceCase: ResourceInventoryPageCase): string {
  return fs.readFileSync(
    path.join(DASHBOARD_PAGES, resourceCase.relativePath),
    "utf8",
  );
}

function readSource(resourceCase: ResourceInventoryPageCase): string {
  return squash(readRawSource(resourceCase));
}

function readCode(resourceCase: ResourceInventoryPageCase): string {
  return squash(stripComments(readRawSource(resourceCase)));
}

function getAllTsxFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...getAllTsxFiles(absolutePath));
    } else if (entry.name.endsWith(".tsx")) {
      files.push(absolutePath);
    }
  }

  return files;
}

function toPosixRelativePath(absolutePath: string): string {
  return path.relative(DASHBOARD_PAGES, absolutePath).split(path.sep).join("/");
}

describe("empty resource inventory page catalog", () => {
  test("covers every page that combines a model table with setup documentation", () => {
    const discoveredPages: Array<string> = getAllTsxFiles(DASHBOARD_PAGES)
      .filter((absolutePath: string): boolean => {
        const source: string = fs.readFileSync(absolutePath, "utf8");

        return (
          source.includes("<ModelTable<") &&
          source.match(/<[A-Za-z]+DocumentationCard\b/) !== null
        );
      })
      .map(toPosixRelativePath)
      .sort();

    const testedPages: Array<string> = RESOURCE_INVENTORY_PAGES.map(
      (resourceCase: ResourceInventoryPageCase): string => {
        return resourceCase.relativePath;
      },
    ).sort();

    expect(RESOURCE_INVENTORY_PAGES).toHaveLength(11);
    expect(discoveredPages).toEqual(testedPages);
  });

  test("does not accidentally list the same inventory twice", () => {
    const paths: Array<string> = RESOURCE_INVENTORY_PAGES.map(
      (resourceCase: ResourceInventoryPageCase): string => {
        return resourceCase.relativePath;
      },
    );

    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe.each(RESOURCE_INVENTORY_PAGES)(
  "$label empty state",
  (resourceCase: ResourceInventoryPageCase) => {
    const source: string = readSource(resourceCase);
    const code: string = readCode(resourceCase);
    const modelTable: string = `<ModelTable<${resourceCase.modelType}>`;
    const zeroState: string = `{${resourceCase.countState} === 0 && (`;
    const documentationCard: string = `<${resourceCase.documentationCard}`;

    test("keeps the inventory table mounted when the count is zero", () => {
      expect(source).toContain(modelTable);
      expect(code).not.toMatch(
        new RegExp(
          `if\\s*\\(\\s*${resourceCase.countState}\\s*===\\s*0\\s*\\)\\s*\\{\\s*return\\s*\\(`,
        ),
      );
    });

    test("keeps manual creation available", () => {
      const tableStart: number = source.indexOf(modelTable);
      const tableEnd: number = source.indexOf("/>", tableStart);

      expect(tableStart).toBeGreaterThan(-1);
      expect(source.slice(tableStart, tableEnd)).toContain(
        "isCreateable={true}",
      );
    });

    test("renders setup documentation only for a zero count", () => {
      expect(source).toContain(zeroState);
      expect(
        source.indexOf(documentationCard, source.indexOf(zeroState)),
      ).toBeGreaterThan(source.indexOf(zeroState));
    });

    test("places the empty table above the documentation", () => {
      const tableStart: number = source.indexOf(modelTable);
      const zeroStateStart: number = source.indexOf(zeroState);
      const documentationStart: number = source.indexOf(
        documentationCard,
        zeroStateStart,
      );

      expect(tableStart).toBeGreaterThan(-1);
      expect(zeroStateStart).toBeGreaterThan(tableStart);
      expect(documentationStart).toBeGreaterThan(zeroStateStart);
    });

    test("hides the guide immediately after the first manual creation", () => {
      const createSuccessStart: number = source.indexOf("onCreateSuccess={");
      const createSuccessEnd: number = source.indexOf(
        "isDeleteable=",
        createSuccessStart,
      );
      const createSuccessSource: string = source.slice(
        createSuccessStart,
        createSuccessEnd,
      );

      expect(createSuccessStart).toBeGreaterThan(-1);
      expect(createSuccessSource).toContain(`${resourceCase.countSetter}(`);
      expect(createSuccessSource).toContain("return (currentCount || 0) + 1;");
      expect(createSuccessSource).toContain("return Promise.resolve(item);");
    });

    test("retains the loading and error gates before mounting the table", () => {
      const tableStart: number = source.indexOf(modelTable);

      expect(source.indexOf("<PageLoader")).toBeGreaterThan(-1);
      expect(source.indexOf("<PageLoader")).toBeLessThan(tableStart);
      expect(source.indexOf("<ErrorMessage")).toBeGreaterThan(-1);
      expect(source.indexOf("<ErrorMessage")).toBeLessThan(tableStart);
    });
  },
);
