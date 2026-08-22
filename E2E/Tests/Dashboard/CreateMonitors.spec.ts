import { Browser, expect, Locator, Page, test } from "@playwright/test";
import Faker from "Common/Utils/Faker";
import { IS_BILLING_ENABLED } from "../../Config";
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
import { createItem, getItem, JSONish, toId } from "./Helpers/MonitorAlerting";

/*
 * Broad monitor creation end-to-end coverage across each wizard shape offered
 * by the dashboard "Create Monitor" form.
 *
 * One project is created up front (serial mode + shared page) and each
 * representative monitor type is then created as its own test, so a failure
 * is isolated to a single type instead of failing the whole suite.
 *
 * To run locally against a full stack:
 *
 *   cd E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/CreateMonitors.spec.ts --project=chromium
 */
test.describe.configure({ mode: "serial" });

const recipes: Array<MonitorTypeRecipe> = [
  // Manual skips criteria and interval, then lands on the final Labels step.
  {
    label: "Manual",
    cardValue: "Manual",
    hasInterval: false,
    skipsCriteria: true,
  },
  {
    /*
     * Inbound types have a criteria step (e.g. "incident if no request in X
     * minutes"); only Manual truly skips criteria. They have no interval step.
     */
    label: "Incoming Request",
    cardValue: "Incoming Request",
    hasInterval: false,
  },
  {
    label: "Incoming Email",
    cardValue: "Incoming Email",
    hasInterval: false,
  },

  // Telemetry types: criteria defaults are enough, no interval step.
  { label: "Logs", cardValue: "Logs", hasInterval: false },
  { label: "Metrics", cardValue: "Metrics", hasInterval: false },
  { label: "Traces", cardValue: "Traces", hasInterval: false },
  { label: "Exceptions", cardValue: "Exceptions", hasInterval: false },
  {
    label: "Security Events",
    cardValue: "Security Events",
    hasInterval: false,
  },

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
   * longer an SNMP card in the create form. Network Device creation needs a
   * separately configured device and is outside this general recipe table.
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
  labelIds: Array<string>;
  labelNames: Array<string>;
}

test.describe("Monitor Creation - Representative Types", () => {
  const ctx: SharedContext = {
    page: undefined as unknown as Page,
    projectId: "",
    labelIds: [],
    labelNames: [],
  };

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300000);
    ctx.page = await browser.newPage();
    ctx.projectId = await registerAndCreateProject({
      page: ctx.page,
      projectNamePrefix: "E2E Monitors Project",
      /*
       * This suite creates one monitor of every type in a single project. On
       * the Free plan, non-Manual monitors are capped
       * (AllowedActiveMonitorCountInFreePlan), so once the suite passes that
       * count the remaining creates fail with "reached the maximum allowed
       * monitor limit" and the wizard stalls on /monitors/create. That cap
       * only applies to the Free plan, so when billing is enabled land the
       * project on a paid plan — the same reason MonitorIncidentOnCall picks
       * Growth. With billing disabled there is no limit and no plan step.
       */
      preferredPlanName: IS_BILLING_ENABLED ? "Growth" : undefined,
    });

    for (const color of ["#3b82f6", "#22c55e"]) {
      const labelName: string = `E2E Monitor Label ${Faker.generateName().toString()}`;
      const label: JSONish = await createItem({
        page: ctx.page,
        projectId: ctx.projectId,
        path: "/api/label",
        item: {
          name: labelName,
          projectId: ctx.projectId,
          color: { _type: "Color", value: color },
        },
      });

      const labelId: string = toId(label["_id"]);
      expect(labelId, `seeded label "${labelName}" should have an id`).not.toBe(
        "",
      );
      ctx.labelIds.push(labelId);
      ctx.labelNames.push(labelName);
    }
  });

  test.afterAll(async () => {
    await ctx.page.close();
  });

  test("should create a Manual monitor with multiple labels", async () => {
    test.setTimeout(120000);

    const monitorId: string = await createMonitor({
      page: ctx.page,
      projectId: ctx.projectId,
      monitorName: `E2E Labelled Manual ${Faker.generateName().toString()}`,
      recipe: recipes[0]!,
      labelNames: ctx.labelNames,
    });

    expect(monitorId, "the labelled monitor should have an id").not.toBe("");

    const monitor: JSONish = await getItem({
      page: ctx.page,
      projectId: ctx.projectId,
      path: "/api/monitor",
      id: monitorId,
      select: {
        _id: true,
        labels: { _id: true, name: true },
      },
    });
    const labels: Array<JSONish> =
      (monitor["labels"] as Array<JSONish> | undefined) || [];

    expect(
      labels
        .map((label: JSONish) => {
          return toId(label["_id"]);
        })
        .sort(),
    ).toEqual([...ctx.labelIds].sort());
    expect(
      labels
        .map((label: JSONish) => {
          return String(label["name"] || "");
        })
        .sort(),
    ).toEqual([...ctx.labelNames].sort());
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
