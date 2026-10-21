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
  /*
   * The infrastructure lists count through the shared useFirstRecordWatch:
   * while the count is zero it watches for the first record, then shows it
   * (the table's refreshToggle) and puts the guide away.
   */
  readonly watchesForFirstRecord?: boolean | undefined;
  /*
   * Adding one by hand is a way to connect here (a vCenter through a probe,
   * a database or queue endpoint), so the empty table keeps its Create
   * button; on the other lists only the card header has it.
   */
  readonly isAddedByHand?: boolean | undefined;
  /*
   * False for a list whose rows only discovery creates - the Cloud Resources
   * discovered from cloud monitoring, which no form could identify - so it
   * has no create button, and nothing hides its guide but discovery.
   */
  readonly isCreateable?: boolean | undefined;
  /*
   * The table's refreshToggle when rows also arrive another way: the Hosts
   * list reads its rows again when the Add Host dialog sees a host connect.
   */
  readonly refreshToggle?: string | undefined;
  /*
   * Not created by a form, but added from a button of the card header (Add
   * Host) that the empty table would repeat: while the list waits for its
   * first record, the guide under it is the way in, so it does not.
   */
  readonly isAddedFromHeader?: boolean | undefined;
}

const RESOURCE_INVENTORY_PAGES: ReadonlyArray<ResourceInventoryPageCase> = [
  {
    label: "RUM applications",
    relativePath: "Rum/RumApplications.tsx",
    modelType: "RumApplication",
    countState: "count",
    countSetter: "setCount",
    documentationCard: "RumDocumentationCard",
  },
  {
    label: "Kubernetes clusters",
    relativePath: "Kubernetes/Clusters.tsx",
    modelType: "KubernetesCluster",
    countState: "firstRecordWatch.count",
    countSetter: "firstRecordWatch.onRecordCreated",
    watchesForFirstRecord: true,
    documentationCard: "KubernetesDocumentationCard",
  },
  {
    label: "Docker hosts",
    relativePath: "Docker/Hosts.tsx",
    modelType: "DockerHost",
    countState: "firstRecordWatch.count",
    countSetter: "firstRecordWatch.onRecordCreated",
    watchesForFirstRecord: true,
    documentationCard: "DockerDocumentationCard",
  },
  {
    label: "Podman hosts",
    relativePath: "Podman/Hosts.tsx",
    modelType: "PodmanHost",
    countState: "firstRecordWatch.count",
    countSetter: "firstRecordWatch.onRecordCreated",
    watchesForFirstRecord: true,
    documentationCard: "PodmanDocumentationCard",
  },
  {
    label: "Docker Swarm clusters",
    relativePath: "DockerSwarm/Clusters.tsx",
    modelType: "DockerSwarmCluster",
    countState: "firstRecordWatch.count",
    countSetter: "firstRecordWatch.onRecordCreated",
    watchesForFirstRecord: true,
    documentationCard: "DockerSwarmDocumentationCard",
  },
  {
    label: "Proxmox clusters",
    relativePath: "Proxmox/Clusters.tsx",
    modelType: "ProxmoxCluster",
    countState: "firstRecordWatch.count",
    countSetter: "firstRecordWatch.onRecordCreated",
    watchesForFirstRecord: true,
    documentationCard: "ProxmoxDocumentationCard",
  },
  {
    label: "vCenters",
    relativePath: "VMware/VCenters.tsx",
    modelType: "VMwareVCenter",
    countState: "firstRecordWatch.count",
    countSetter: "firstRecordWatch.onRecordCreated",
    watchesForFirstRecord: true,
    isAddedByHand: true,
    documentationCard: "VMwareDocumentationCard",
  },
  {
    label: "Ceph clusters",
    relativePath: "Ceph/Clusters.tsx",
    modelType: "CephCluster",
    countState: "firstRecordWatch.count",
    countSetter: "firstRecordWatch.onRecordCreated",
    watchesForFirstRecord: true,
    documentationCard: "CephDocumentationCard",
  },
  {
    label: "storage arrays",
    relativePath: "StorageArray/StorageArrays.tsx",
    modelType: "StorageArray",
    countState: "firstRecordWatch.count",
    countSetter: "firstRecordWatch.onRecordCreated",
    watchesForFirstRecord: true,
    documentationCard: "StorageArrayDocumentationCard",
  },
  /*
   * A host is added by one command on it, not by a form: the first run is
   * the Add Host guide, and a host typed in by hand would only wait for
   * telemetry nothing sends.
   */
  {
    label: "hosts",
    relativePath: "Host/Hosts.tsx",
    modelType: "Host",
    countState: "firstRecordWatch.count",
    countSetter: "firstRecordWatch.onRecordCreated",
    watchesForFirstRecord: true,
    documentationCard: "AddHostGuide",
    isCreateable: false,
    isAddedFromHeader: true,
    refreshToggle:
      "refreshToggle={`${firstRecordWatch.refreshToken}-${connectedCount}`}",
  },
  {
    label: "IoT fleets",
    relativePath: "IoT/Fleets.tsx",
    modelType: "IoTFleet",
    countState: "firstRecordWatch.count",
    countSetter: "firstRecordWatch.onRecordCreated",
    watchesForFirstRecord: true,
    documentationCard: "IoTDocumentationCard",
  },
  {
    label: "cloud resources",
    relativePath: "Cloud/CloudResources.tsx",
    modelType: "CloudResource",
    countState: "firstRecordWatch.count",
    countSetter: "firstRecordWatch.onRecordCreated",
    watchesForFirstRecord: true,
    documentationCard: "CloudDocumentationCard",
  },
  {
    label: "serverless functions",
    relativePath: "Serverless/ServerlessFunctions.tsx",
    modelType: "ServerlessFunction",
    countState: "firstRecordWatch.count",
    countSetter: "firstRecordWatch.onRecordCreated",
    watchesForFirstRecord: true,
    documentationCard: "ServerlessDocumentationCard",
  },
  {
    label: "databases",
    relativePath: "Database/Databases.tsx",
    modelType: "DatabaseServer",
    countState: "firstRecordWatch.count",
    countSetter: "firstRecordWatch.onRecordCreated",
    watchesForFirstRecord: true,
    isAddedByHand: true,
    documentationCard: "DatabaseDocumentationCard",
  },
  {
    label: "queues",
    relativePath: "MessageQueue/MessageQueues.tsx",
    modelType: "MessageQueue",
    countState: "firstRecordWatch.count",
    countSetter: "firstRecordWatch.onRecordCreated",
    watchesForFirstRecord: true,
    isAddedByHand: true,
    documentationCard: "MessageQueueDocumentationCard",
  },
  {
    label: "cloud resources discovered from cloud monitoring",
    relativePath: "Cloud/MonitoredResources.tsx",
    modelType: "CloudResource",
    countState: "firstRecordWatch.count",
    countSetter: "firstRecordWatch.onRecordCreated",
    watchesForFirstRecord: true,
    documentationCard: "CloudMonitoringDocumentationCard",
    isCreateable: false,
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
          source.match(/<(?:[A-Za-z]+DocumentationCard|AddHostGuide)\b/) !==
            null
        );
      })
      .map(toPosixRelativePath)
      .sort();

    const testedPages: Array<string> = RESOURCE_INVENTORY_PAGES.map(
      (resourceCase: ResourceInventoryPageCase): string => {
        return resourceCase.relativePath;
      },
    ).sort();

    expect(RESOURCE_INVENTORY_PAGES).toHaveLength(16);
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

    test("keeps manual creation available, where rows can be made by hand", () => {
      const tableStart: number = source.indexOf(modelTable);
      const tableEnd: number = source.indexOf("/>", tableStart);

      expect(tableStart).toBeGreaterThan(-1);
      expect(source.slice(tableStart, tableEnd)).toContain(
        resourceCase.isCreateable === false
          ? "isCreateable={false}"
          : "isCreateable={true}",
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
      if (resourceCase.isCreateable === false) {
        // Nothing is created here: no create callback to count it.
        expect(source).not.toContain("onCreateSuccess={");
        return;
      }

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
      if (!resourceCase.watchesForFirstRecord) {
        expect(createSuccessSource).toContain(
          "return (currentCount || 0) + 1;",
        );
      }
      expect(createSuccessSource).toContain("return Promise.resolve(item);");
    });

    test("retains the loading and error gates before mounting the table", () => {
      const tableStart: number = source.indexOf(modelTable);

      expect(source.indexOf("<PageLoader")).toBeGreaterThan(-1);
      expect(source.indexOf("<PageLoader")).toBeLessThan(tableStart);
      expect(source.indexOf("<ErrorMessage")).toBeGreaterThan(-1);
      expect(source.indexOf("<ErrorMessage")).toBeLessThan(tableStart);
    });

    test("watches for the first record, and shows it without a reload", () => {
      if (!resourceCase.watchesForFirstRecord) {
        return;
      }

      const tableStart: number = source.indexOf(modelTable);
      const tableEnd: number = source.indexOf("/>", tableStart);
      const table: string = source.slice(tableStart, tableEnd);

      expect(code).toContain(`useFirstRecordWatch<${resourceCase.modelType}>(`);
      expect(table).toContain(
        resourceCase.refreshToggle ||
          "refreshToggle={firstRecordWatch.refreshToken}",
      );
      expect(code).toContain("if (firstRecordWatch.isLoading) {");
      expect(code).toContain("if (firstRecordWatch.error) {");

      // No page keeps a poll of its own.
      expect(code).not.toContain("setInterval(");
      expect(code).not.toContain("FIRST_DATA_POLL_INTERVAL_MS");
    });

    test("an empty list points to the guide, and repeats Create only where adding by hand connects", () => {
      if (!resourceCase.watchesForFirstRecord) {
        return;
      }

      const tableStart: number = source.indexOf(modelTable);
      const tableEnd: number = source.indexOf("/>", tableStart);
      const table: string = source.slice(tableStart, tableEnd);

      if (
        resourceCase.isCreateable === false &&
        !resourceCase.isAddedFromHeader
      ) {
        // No create button anywhere, so nothing for the empty state to hide.
        expect(table).not.toContain("getFirstRunEmptyState(");
      } else {
        expect(table).toContain("emptyState={getFirstRunEmptyState({");
        expect(table).toContain("count: firstRecordWatch.count,");
        expect(table.includes("isAddedByHand: true,")).toBe(
          resourceCase.isAddedByHand === true,
        );
      }

      // The guide says what to do, not "No X yet" a second time.
      const guideStart: number = source.indexOf(
        `<${resourceCase.documentationCard}`,
        source.indexOf(`{${resourceCase.countState} === 0 && (`),
      );
      expect(source.slice(guideStart, guideStart + 300)).toContain(
        "description={FIRST_RUN_GUIDE_DESCRIPTION}",
      );
    });
  },
);
