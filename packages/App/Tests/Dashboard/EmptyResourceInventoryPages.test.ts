import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { escapeRegExp } from "Common/Utils/RegExpEscape";

/*
 * Resource inventory pages used to return their setup documentation instead
 * of their ModelTable when the initial count was zero. That made the table's
 * Create button unreachable, so the only way to get the first resource was to
 * send telemetry and let auto-discovery create it.
 *
 * Lists whose resources register themselves when their agent first reports
 * (Kubernetes clusters, Docker and Podman hosts, Docker Swarm, Proxmox and
 * Ceph clusters, storage arrays, IoT fleets, serverless functions, cloud
 * environments) are added the way a host is (Components/ResourceOnboarding):
 * they have no create form, since a row typed in by hand only waited for data
 * nothing sent. The card header's Add button opens the resource's Add guide in
 * a dialog. Lists whose rows a form adds (databases, queues, RUM applications,
 * vCenters) keep their Create button, and the form's guide follows it.
 *
 * Under an empty table each of them shows its showcase
 * (Components/ResourceShowcase): what the product gives, with the list's Add
 * button - the same dialog, or the same create form - rather than every step
 * of the guide up front. Cloud Resources, which nothing adds by hand, keeps
 * its Connect tiles and its folded guide.
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
  /*
   * What an empty list shows under its table: its showcase (the constant
   * ResourceShowcaseCard is handed), or - Cloud Resources - a guide card.
   */
  readonly showcase?: string | undefined;
  readonly documentationCard?: string | undefined;
  /*
   * The infrastructure lists count through the shared useFirstRecordWatch:
   * while the count is zero it watches for the first record, then shows it
   * (the table's refreshToggle) and puts the showcase away.
   */
  readonly watchesForFirstRecord?: boolean | undefined;
  /*
   * A form adds its rows (a vCenter through a probe, a database or queue
   * endpoint, a RUM application): the showcase's button opens the table's
   * own create form (useShowcaseCreateForm).
   */
  readonly isAddedByForm?: boolean | undefined;
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
   * Host, Add Kubernetes Cluster) that the empty table would repeat: while
   * the list waits for its first record, the showcase under it has the
   * button, so the table does not.
   */
  readonly isAddedFromHeader?: boolean | undefined;
  /*
   * That button, as the card header writes its title, and the dialog it
   * opens - which the showcase's button opens too.
   */
  readonly addButtonTitle?: string | undefined;
  readonly addDialog?: string | undefined;
  // The onboarding config (Components/ResourceOnboarding) the dialog draws.
  readonly onboarding?: string | undefined;
}

/*
 * A list whose resources register themselves when their agent first reports:
 * no create form, the card header's Add button opens the resource's Add guide
 * in a dialog (AddResourceModal), and the empty list's showcase has the same
 * button. The dialog seeing the resource connect makes the table read it
 * again (connectedCount) and puts the showcase away at once.
 */
function addedByGuide(data: {
  label: string;
  relativePath: string;
  modelType: string;
  onboarding: string;
  showcase: string;
}): ResourceInventoryPageCase {
  return {
    label: data.label,
    relativePath: data.relativePath,
    modelType: data.modelType,
    countState: "firstRecordWatch.count",
    countSetter: "firstRecordWatch.onRecordCreated",
    watchesForFirstRecord: true,
    showcase: data.showcase,
    onboarding: data.onboarding,
    isCreateable: false,
    isAddedFromHeader: true,
    addButtonTitle: `${data.onboarding}.addTitle`,
    addDialog: `<AddResourceModal onboarding={${data.onboarding}}`,
    refreshToggle:
      "refreshToggle={`${firstRecordWatch.refreshToken}-${connectedCount}`}",
  };
}

// A list whose rows a form adds, which watches for its first record.
function addedByForm(data: {
  label: string;
  relativePath: string;
  modelType: string;
  showcase: string;
}): ResourceInventoryPageCase {
  return {
    label: data.label,
    relativePath: data.relativePath,
    modelType: data.modelType,
    countState: "firstRecordWatch.count",
    countSetter: "firstRecordWatch.onRecordCreated",
    watchesForFirstRecord: true,
    showcase: data.showcase,
    isAddedByForm: true,
  };
}

const RESOURCE_INVENTORY_PAGES: ReadonlyArray<ResourceInventoryPageCase> = [
  {
    label: "RUM applications",
    relativePath: "Rum/RumApplications.tsx",
    modelType: "RumApplication",
    countState: "count",
    countSetter: "setCount",
    showcase: "RUM_APPLICATION_SHOWCASE",
    isAddedByForm: true,
  },
  addedByGuide({
    label: "Kubernetes clusters",
    relativePath: "Kubernetes/Clusters.tsx",
    modelType: "KubernetesCluster",
    onboarding: "KUBERNETES_CLUSTER_ONBOARDING",
    showcase: "KUBERNETES_CLUSTER_SHOWCASE",
  }),
  addedByGuide({
    label: "Docker hosts",
    relativePath: "Docker/Hosts.tsx",
    modelType: "DockerHost",
    onboarding: "DOCKER_HOST_ONBOARDING",
    showcase: "DOCKER_HOST_SHOWCASE",
  }),
  addedByGuide({
    label: "Podman hosts",
    relativePath: "Podman/Hosts.tsx",
    modelType: "PodmanHost",
    onboarding: "PODMAN_HOST_ONBOARDING",
    showcase: "PODMAN_HOST_SHOWCASE",
  }),
  addedByGuide({
    label: "Docker Swarm clusters",
    relativePath: "DockerSwarm/Clusters.tsx",
    modelType: "DockerSwarmCluster",
    onboarding: "DOCKER_SWARM_CLUSTER_ONBOARDING",
    showcase: "DOCKER_SWARM_CLUSTER_SHOWCASE",
  }),
  addedByGuide({
    label: "Proxmox clusters",
    relativePath: "Proxmox/Clusters.tsx",
    modelType: "ProxmoxCluster",
    onboarding: "PROXMOX_CLUSTER_ONBOARDING",
    showcase: "PROXMOX_CLUSTER_SHOWCASE",
  }),
  addedByForm({
    label: "vCenters",
    relativePath: "VMware/VCenters.tsx",
    modelType: "VMwareVCenter",
    showcase: "VMWARE_VCENTER_SHOWCASE",
  }),
  addedByGuide({
    label: "Ceph clusters",
    relativePath: "Ceph/Clusters.tsx",
    modelType: "CephCluster",
    onboarding: "CEPH_CLUSTER_ONBOARDING",
    showcase: "CEPH_CLUSTER_SHOWCASE",
  }),
  addedByGuide({
    label: "storage arrays",
    relativePath: "StorageArray/StorageArrays.tsx",
    modelType: "StorageArray",
    onboarding: "STORAGE_ARRAY_ONBOARDING",
    showcase: "STORAGE_ARRAY_SHOWCASE",
  }),
  /*
   * A host is added by one command on it, not by a form: Add Host opens
   * that guide, and a host typed in by hand would only wait for telemetry
   * nothing sends.
   */
  {
    label: "hosts",
    relativePath: "Host/Hosts.tsx",
    modelType: "Host",
    countState: "firstRecordWatch.count",
    countSetter: "firstRecordWatch.onRecordCreated",
    watchesForFirstRecord: true,
    showcase: "HOST_SHOWCASE",
    isCreateable: false,
    isAddedFromHeader: true,
    addButtonTitle: '"Add Host"',
    addDialog: "<AddHostModal",
    refreshToggle:
      "refreshToggle={`${firstRecordWatch.refreshToken}-${connectedCount}`}",
  },
  addedByGuide({
    label: "IoT fleets",
    relativePath: "IoT/Fleets.tsx",
    modelType: "IoTFleet",
    onboarding: "IOT_FLEET_ONBOARDING",
    showcase: "IOT_FLEET_SHOWCASE",
  }),
  // The cloud environments an app's OpenTelemetry reports.
  addedByGuide({
    label: "cloud resources",
    relativePath: "Cloud/CloudResources.tsx",
    modelType: "CloudResource",
    onboarding: "CLOUD_ENVIRONMENT_ONBOARDING",
    showcase: "CLOUD_ENVIRONMENT_SHOWCASE",
  }),
  addedByGuide({
    label: "serverless functions",
    relativePath: "Serverless/ServerlessFunctions.tsx",
    modelType: "ServerlessFunction",
    onboarding: "SERVERLESS_FUNCTION_ONBOARDING",
    showcase: "SERVERLESS_FUNCTION_SHOWCASE",
  }),
  addedByForm({
    label: "databases",
    relativePath: "Database/Databases.tsx",
    modelType: "DatabaseServer",
    showcase: "DATABASE_SHOWCASE",
  }),
  addedByForm({
    label: "queues",
    relativePath: "MessageQueue/MessageQueues.tsx",
    modelType: "MessageQueue",
    showcase: "MESSAGE_QUEUE_SHOWCASE",
  }),
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

// The opening of what an empty list shows under its table.
function firstRunCardOf(resourceCase: ResourceInventoryPageCase): string {
  return resourceCase.showcase
    ? `<ResourceShowcaseCard showcase={${resourceCase.showcase}}`
    : `<${resourceCase.documentationCard as string}`;
}

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
  test("covers every page that combines a model table with a first-run card", () => {
    const discoveredPages: Array<string> = getAllTsxFiles(DASHBOARD_PAGES)
      .filter((absolutePath: string): boolean => {
        const source: string = fs.readFileSync(absolutePath, "utf8");

        return (
          source.includes("<ModelTable<") &&
          source.match(
            /<(?:ResourceShowcaseCard|[A-Za-z]+DocumentationCard|AddHostGuide|AddResourceGuide)\b/,
          ) !== null
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

  test("each list shows a showcase of its own", () => {
    const showcases: Array<string> = RESOURCE_INVENTORY_PAGES.map(
      (resourceCase: ResourceInventoryPageCase): string => {
        return resourceCase.showcase || "";
      },
    ).filter((showcase: string): boolean => {
      return showcase.length > 0;
    });

    expect(showcases).toHaveLength(15);
    expect(new Set(showcases).size).toBe(showcases.length);
  });
});

describe.each(RESOURCE_INVENTORY_PAGES)(
  "$label empty state",
  (resourceCase: ResourceInventoryPageCase) => {
    const source: string = readSource(resourceCase);
    const code: string = readCode(resourceCase);
    const modelTable: string = `<ModelTable<${resourceCase.modelType}>`;
    const zeroState: string = `{${resourceCase.countState} === 0 && (`;
    const firstRunCard: string = firstRunCardOf(resourceCase);

    // The JSX of what an empty list shows under its table.
    const firstRunCardSource: () => string = (): string => {
      const cardStart: number = source.indexOf(
        firstRunCard,
        source.indexOf(zeroState),
      );
      return source.slice(cardStart, source.indexOf("/>", cardStart));
    };

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

    test("where rows register themselves, the card header's Add button and the showcase's open the guide in a dialog", () => {
      if (!resourceCase.isAddedFromHeader) {
        return;
      }

      const tableStart: number = source.indexOf(modelTable);
      const tableEnd: number = source.indexOf("/>", tableStart);
      const table: string = source.slice(tableStart, tableEnd);
      const button: RegExpMatchArray | null = table.match(
        new RegExp(
          // On a phone the button says its verb alone (phoneTitle).
          `buttons: \\[ \\{ title: ${escapeRegExp(
            resourceCase.addButtonTitle as string,
          )}, (?:phoneTitle: "[A-Za-z]+", )?icon: IconProp\\.Add, buttonStyle: ButtonStyleType\\.NORMAL, onClick: \\(\\) => \\{ set([A-Z][A-Za-z]*)\\(true\\); \\}, \\}, \\],`,
        ),
      );

      // No form to fill in: the button is the way in, empty list or not.
      expect(table).toContain("formFields={[]}");
      expect(code).not.toContain("onCreateSuccess");
      expect(button).not.toBeNull();

      // The button opens the dialog with the guide.
      const setter: string = button ? (button[1] as string) : "";
      const isOpen: string = setter.charAt(0).toLowerCase() + setter.slice(1);
      const dialogStart: number = source.indexOf(
        `{${isOpen} && ( ${resourceCase.addDialog as string}`,
      );
      expect(dialogStart).toBeGreaterThan(tableEnd);

      // The showcase's button says the same and opens the same dialog.
      expect(firstRunCardSource()).toContain(
        `addButton={{ title: ${resourceCase.addButtonTitle as string}, onClick: () => { set${setter}(true); }, }}`,
      );

      // One it sees connect shows in the list at once.
      const dialog: string = source.slice(
        dialogStart,
        source.indexOf("/>", dialogStart),
      );
      expect(dialog).toContain("setConnectedCount(");
    });

    test("where a form adds rows, the showcase's button opens the table's own create form", () => {
      if (!resourceCase.isAddedByForm) {
        return;
      }

      const tableStart: number = source.indexOf(modelTable);
      const tableEnd: number = source.indexOf("/>", tableStart);
      const table: string = source.slice(tableStart, tableEnd);

      expect(code).toContain(
        `const showcaseCreateForm: ShowcaseCreateForm = useShowcaseCreateForm({ modelType: ${resourceCase.modelType},`,
      );
      expect(table).toContain(
        "showCreateForm={showcaseCreateForm.showCreateForm}",
      );
      expect(firstRunCardSource()).toContain(
        "addButton={showcaseCreateForm.addButton}",
      );
      // The hook is called with the others, before the page can return early.
      expect(code.indexOf("useShowcaseCreateForm({")).toBeLessThan(
        code.indexOf("<PageLoader"),
      );
    });

    test("renders its first-run card only for a zero count", () => {
      expect(source).toContain(zeroState);
      expect(
        source.indexOf(firstRunCard, source.indexOf(zeroState)),
      ).toBeGreaterThan(source.indexOf(zeroState));
    });

    test("places the empty table above its first-run card", () => {
      const tableStart: number = source.indexOf(modelTable);
      const zeroStateStart: number = source.indexOf(zeroState);
      const cardStart: number = source.indexOf(firstRunCard, zeroStateStart);

      expect(tableStart).toBeGreaterThan(-1);
      expect(zeroStateStart).toBeGreaterThan(tableStart);
      expect(cardStart).toBeGreaterThan(zeroStateStart);
    });

    test("puts the showcase away as soon as the first one is added, by hand or through the dialog", () => {
      if (resourceCase.isCreateable === false) {
        // Nothing is created here: no create callback to count it.
        expect(source).not.toContain("onCreateSuccess={");

        if (resourceCase.isAddedFromHeader) {
          /*
           * Added through the dialog: once its last step sees the first one
           * connect, the showcase gives way at once - not at the watch's
           * next count - and the table reads the new row.
           */
          const dialogStart: number = source.indexOf(
            resourceCase.addDialog as string,
            source.indexOf(zeroState),
          );
          const dialog: string = source.slice(
            dialogStart,
            source.indexOf("/>", dialogStart),
          );

          expect(dialogStart).toBeGreaterThan(-1);
          expect(dialog).toMatch(/ on(?:Host)?Connected=\{\(\) => \{/);
          expect(dialog).toContain(`${resourceCase.countSetter}();`);
          expect(dialog).toContain("setConnectedCount(");
        }
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

    test("an empty list's table does not repeat Create: the showcase under it has the button", () => {
      const tableStart: number = source.indexOf(modelTable);
      const tableEnd: number = source.indexOf("/>", tableStart);
      const table: string = source.slice(tableStart, tableEnd);

      if (!resourceCase.showcase) {
        // No create button anywhere, so nothing for the empty state to hide.
        expect(table).not.toContain("getFirstRunEmptyState(");
        // Its folded guide says what to do, not "No X yet" a second time.
        expect(firstRunCardSource()).toContain(
          "description={FIRST_RUN_GUIDE_DESCRIPTION}",
        );
        return;
      }

      expect(table).toContain("emptyState={getFirstRunEmptyState({");
      expect(table).toContain(`count: ${resourceCase.countState},`);
      expect(table).not.toContain("isAddedByHand");
      expect(firstRunCardSource()).toContain("addButton={");
    });
  },
);
