import { Browser, Page, test, Locator } from "@playwright/test";
import Faker from "Common/Utils/Faker";
import { registerAndCreateProject } from "./Helpers/ProductOnboarding";
import {
  createInfraMonitor,
  createMonitor,
  fillByPlaceholder,
  fillCodeEditor,
  fillDestination,
  InfraMonitorRecipe,
  MonitorTypeRecipe,
} from "./Helpers/Monitors";

/*
 * Monitor creation end-to-end coverage for every monitor type offered by the
 * dashboard "Create Monitor" form.
 *
 * One project is created up front (serial mode + shared page) and every
 * monitor type is then created as its own test, so a failure is isolated to a
 * single type instead of failing the whole suite.
 *
 * To run locally against a full stack:
 *
 *   cd E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/CreateMonitors.spec.ts --project=chromium
 */
test.describe.configure({ mode: "serial" });

const recipes: Array<MonitorTypeRecipe> = [
  // Single-step: name + type only.
  {
    label: "Manual",
    cardValue: "Manual",
    hasInterval: false,
    singleStep: true,
  },
  {
    label: "Incoming Request",
    cardValue: "Incoming Request",
    hasInterval: false,
    singleStep: true,
  },
  {
    label: "Incoming Email",
    cardValue: "Incoming Email",
    hasInterval: false,
    singleStep: true,
  },

  // Telemetry types: criteria defaults are enough, no interval step.
  { label: "Logs", cardValue: "Logs", hasInterval: false },
  { label: "Metrics", cardValue: "Metrics", hasInterval: false },
  { label: "Traces", cardValue: "Traces", hasInterval: false },
  { label: "Exceptions", cardValue: "Exceptions", hasInterval: false },

  // Probeable types with a bare destination input (first textbox) + interval.
  {
    label: "Website",
    cardValue: "Website",
    hasInterval: true,
    fillCriteria: async ({ page }: { page: Page }) => {
      await fillDestination({ page, value: "https://example.com" });
    },
  },
  {
    label: "API",
    cardValue: "API",
    hasInterval: true,
    fillCriteria: async ({ page }: { page: Page }) => {
      await fillDestination({ page, value: "https://example.com" });
    },
  },
  {
    label: "Ping",
    cardValue: "Ping",
    hasInterval: true,
    fillCriteria: async ({ page }: { page: Page }) => {
      await fillDestination({ page, value: "example.com" });
    },
  },
  {
    label: "IP",
    cardValue: "IP",
    hasInterval: true,
    fillCriteria: async ({ page }: { page: Page }) => {
      await fillDestination({ page, value: "1.1.1.1" });
    },
  },
  {
    label: "Port",
    cardValue: "Port",
    hasInterval: true,
    fillCriteria: async ({ page }: { page: Page }) => {
      await fillDestination({ page, value: "example.com" });
      const portInput: Locator = page
        .locator("#create-monitor-form")
        .getByRole("textbox")
        .nth(1);
      await portInput.waitFor({ state: "visible", timeout: 30000 });
      await portInput.fill("443");
    },
  },
  {
    label: "SSL Certificate",
    cardValue: "SSL Certificate",
    hasInterval: true,
    fillCriteria: async ({ page }: { page: Page }) => {
      await fillDestination({ page, value: "https://example.com" });
    },
  },

  // Probeable types with placeholder-labelled step forms + interval.
  {
    label: "DNS",
    cardValue: "DNS",
    hasInterval: true,
    fillCriteria: async ({ page }: { page: Page }) => {
      await fillByPlaceholder({
        page,
        placeholder: "example.com",
        value: "example.com",
      });
    },
  },
  {
    label: "DNSSEC",
    cardValue: "DNSSEC",
    hasInterval: true,
    fillCriteria: async ({ page }: { page: Page }) => {
      await fillByPlaceholder({
        page,
        placeholder: "example.com",
        value: "example.com",
      });
      await fillByPlaceholder({
        page,
        placeholder: /1\.1\.1\.1/,
        value: "1.1.1.1, 8.8.8.8",
      });
    },
  },
  {
    label: "Domain",
    cardValue: "Domain",
    hasInterval: true,
    fillCriteria: async ({ page }: { page: Page }) => {
      await fillByPlaceholder({
        page,
        placeholder: "example.com",
        value: "example.com",
      });
    },
  },
  {
    label: "External Status Page",
    cardValue: "External Status Page",
    hasInterval: true,
    fillCriteria: async ({ page }: { page: Page }) => {
      await fillByPlaceholder({
        page,
        placeholder: "https://status.example.com",
        value: "https://status.example.com",
      });
    },
  },
  /*
   * The standalone "SNMP" monitor type was retired and replaced by the
   * "Network Device" monitor type, which references a registered
   * NetworkDevice resource (see MonitorType.NetworkDevice). There is no
   * longer an SNMP card in the create form, so this recipe was removed —
   * Network Device monitoring is covered by the NetworkDevice E2E flow.
   */

  // Code-based probeable types: fill the Monaco editor + interval.
  {
    label: "Synthetic Monitor",
    cardValue: "Synthetic Monitor",
    hasInterval: true,
    fillCriteria: async ({ page }: { page: Page }) => {
      await fillCodeEditor({
        page,
        code: "// e2e synthetic monitor test code",
      });
    },
  },
  {
    label: "Custom JavaScript Code",
    cardValue: "Custom JavaScript Code",
    hasInterval: true,
    fillCriteria: async ({ page }: { page: Page }) => {
      await fillCodeEditor({
        page,
        code: "// e2e custom javascript monitor test code",
      });
    },
  },
];

/*
 * Infrastructure types: an entity is seeded via the CRUD API, then the monitor
 * is created by picking that entity from the dropdown and a Quick Setup
 * template.
 */
const infraRecipes: Array<InfraMonitorRecipe> = [
  {
    label: "Kubernetes",
    cardValue: "Kubernetes",
    apiPath: "/api/kubernetes-cluster",
    identifierField: "clusterIdentifier",
    templateName: /CrashLoopBackOff/,
  },
  {
    label: "Docker",
    cardValue: "Docker",
    apiPath: "/api/docker-host",
    identifierField: "hostIdentifier",
    templateName: /High Container CPU Usage/,
  },
  {
    label: "Host",
    cardValue: "Host",
    apiPath: "/api/host",
    identifierField: "hostIdentifier",
    templateName: /High CPU Utilization/,
  },
  {
    label: "Podman",
    cardValue: "Podman",
    apiPath: "/api/podman-host",
    identifierField: "hostIdentifier",
    templateName: /High Container CPU Usage/,
  },
  {
    label: "Docker Swarm",
    cardValue: "Docker Swarm",
    apiPath: "/api/docker-swarm-cluster",
    templateName: /High Task CPU Usage/,
  },
  {
    label: "Proxmox",
    cardValue: "Proxmox",
    apiPath: "/api/proxmox-cluster",
    templateName: /Node Offline/,
  },
  {
    label: "Ceph",
    cardValue: "Ceph",
    apiPath: "/api/ceph-cluster",
    templateName: /Cluster Health Error/,
  },
  {
    label: "IoT Device",
    cardValue: "IoT Device",
    apiPath: "/api/iot-fleet",
    templateName: /Device Offline/,
  },
];

/*
 * Shared context lives on a const object so the per-type test closures created
 * in the loops below reference a stable binding (avoids no-loop-func on a
 * reassigned `let`). It is populated by beforeAll before any test runs.
 */
interface SharedContext {
  page: Page;
  projectId: string;
}

test.describe("Monitor Creation - All Types", () => {
  const ctx: SharedContext = {
    page: undefined as unknown as Page,
    projectId: "",
  };

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300000);
    ctx.page = await browser.newPage();
    ctx.projectId = await registerAndCreateProject({
      page: ctx.page,
      projectNamePrefix: "E2E Monitors Project",
    });
  });

  test.afterAll(async () => {
    await ctx.page.close();
  });

  for (const recipe of recipes) {
    test(`should create a ${recipe.label} monitor`, async () => {
      test.setTimeout(120000);
      await createMonitor({
        page: ctx.page,
        projectId: ctx.projectId,
        monitorName: `E2E ${recipe.label} ${Faker.generateName().toString()}`,
        recipe,
      });
    });
  }

  for (const recipe of infraRecipes) {
    test(`should create a ${recipe.label} monitor`, async () => {
      test.setTimeout(120000);
      await createInfraMonitor({
        page: ctx.page,
        projectId: ctx.projectId,
        monitorName: `E2E ${recipe.label} ${Faker.generateName().toString()}`,
        recipe,
      });
    });
  }
});
