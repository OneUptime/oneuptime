import {
  Browser,
  BrowserContext,
  Download,
  Page,
  Route,
  expect,
  test,
} from "@playwright/test";
import { mkdir, readFile } from "fs/promises";
import path from "path";
import {
  JSONish,
  registerAndCreateProject,
  buildUrl,
  createItem,
  deleteItem,
  getItem,
  listItems,
  toId,
} from "./Helpers";

interface PortableRuleFile {
  fileType: string;
  schemaVersion: number;
  resourceType: string;
  items: Array<JSONish>;
}

interface ProjectFixture {
  id: string;
  productionLabelId: string;
  networkLabelId: string;
}

const artifacts: string = path.resolve(
  __dirname,
  "../../output/playwright/label-rule-import-export",
);
const networkRulePath: string = "/api/network-device-label-rule";
const monitorRulePath: string = "/api/monitor-label-rule";

const portableFile: (items: Array<JSONish>) => PortableRuleFile = (
  items: Array<JSONish>,
): PortableRuleFile => {
  return {
    fileType: "oneuptime-label-rules",
    schemaVersion: 1,
    resourceType: "NetworkDeviceLabelRule",
    items,
  };
};

const rule: (name: string, changes?: JSONish) => JSONish = (
  name: string,
  changes: JSONish = {},
): JSONish => {
  return {
    name,
    description: "Apply Network to matching production devices.",
    isEnabled: true,
    networkDeviceNamePattern: "core-.*",
    networkDeviceDescriptionPattern: "production",
    networkDeviceLabels: ["Production"],
    labelsToAdd: ["Network"],
    ...changes,
  };
};

const downloadJson: (download: Download) => Promise<PortableRuleFile> = async (
  download: Download,
): Promise<PortableRuleFile> => {
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  const filePath: string | null = await download.path();
  expect(filePath).not.toBeNull();
  return JSON.parse(await readFile(filePath!, "utf8")) as PortableRuleFile;
};

test.describe("Label rule JSON transfer through the Dashboard and API", () => {
  test.describe.configure({ mode: "serial" });
  let context: BrowserContext;
  let page: Page;
  let source: ProjectFixture;
  let destination: ProjectFixture;
  let emptyProjectId: string;
  const projectIds: Array<string> = [];

  const seedLabels: (projectId: string) => Promise<ProjectFixture> = async (
    projectId: string,
  ): Promise<ProjectFixture> => {
    const production: JSONish = await createItem({
      page,
      projectId,
      path: "/api/label",
      item: { name: "Production", color: "#2563eb", projectId },
    });
    const network: JSONish = await createItem({
      page,
      projectId,
      path: "/api/label",
      item: { name: "Network", color: "#16a34a", projectId },
    });
    return {
      id: projectId,
      productionLabelId: toId(production["_id"]),
      networkLabelId: toId(network["_id"]),
    };
  };

  const navigate: (
    projectId: string,
    resource?: string,
  ) => Promise<void> = async (
    projectId: string,
    resource: string = "network-devices",
  ): Promise<void> => {
    await page.goto(
      buildUrl(`/dashboard/${projectId}/${resource}/settings/label-rules`),
    );
    await expect(page.getByRole("button", { name: "Import JSON" })).toBeVisible();
  };

  const openImport: (payload: PortableRuleFile | string) => Promise<void> = async (
    payload: PortableRuleFile | string,
  ): Promise<void> => {
    await page.getByRole("button", { name: "Import JSON" }).click();
    await page
      .getByTestId("label-rule-import-json")
      .fill(typeof payload === "string" ? payload : JSON.stringify(payload, null, 2));
  };

  const preview: () => Promise<void> = async (): Promise<void> => {
    await page.getByRole("button", { name: "Validate and preview" }).click();
    await expect(page.getByText("Preview import", { exact: true })).toBeVisible();
  };

  const importRules: (count: number) => Promise<void> = async (
    count: number,
  ): Promise<void> => {
    await page
      .getByRole("button", { name: new RegExp(`^Import ${count} rules?$`) })
      .click();
    await expect(page.getByText("Import complete", { exact: true })).toBeVisible();
  };

  const rulesNamed: (
    projectId: string,
    name: string,
    apiPath?: string,
  ) => Promise<Array<JSONish>> = async (
    projectId: string,
    name: string,
    apiPath: string = networkRulePath,
  ): Promise<Array<JSONish>> => {
    return listItems({
      page,
      projectId,
      path: apiPath,
      query: { name },
      select: { _id: true, name: true, isEnabled: true },
    });
  };

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
    page = await context.newPage();
    const sourceId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "Label transfer source",
    });
    projectIds.push(sourceId);
    source = await seedLabels(sourceId);
    const second: JSONish = await createItem({
      page,
      projectId: sourceId,
      path: "/api/project",
      item: { name: "Label transfer destination" },
    });
    projectIds.push(toId(second["_id"]));
    destination = await seedLabels(toId(second["_id"]));
    const empty: JSONish = await createItem({
      page,
      projectId: sourceId,
      path: "/api/project",
      item: { name: "Label transfer empty project" },
    });
    emptyProjectId = toId(empty["_id"]);
    projectIds.push(emptyProjectId);
    await mkdir(artifacts, { recursive: true });
  });

  test.afterAll(async () => {
    for (const projectId of projectIds.reverse()) {
      await deleteItem({ page, projectId, path: "/api/project", id: projectId });
    }
    await context?.close();
  });

  test("pasted JSON previews without writes and preserves disabled rules on import", async () => {
    const name: string = "Production core switches";
    await navigate(source.id);
    await openImport(portableFile([rule(name, { isEnabled: false })]));
    await preview();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    expect(await rulesNamed(source.id, name)).toHaveLength(0);
    if (process.env["LABEL_RULE_SCREENSHOTS"] === "true") {
      await page.screenshot({ path: path.join(artifacts, "import-preview.png"), fullPage: true });
    }
    await importRules(1);
    const saved: Array<JSONish> = await rulesNamed(source.id, name);
    expect(saved).toHaveLength(1);
    expect(saved[0]!["isEnabled"]).toBe(false);
    const item: JSONish = await getItem({
      page,
      projectId: source.id,
      path: networkRulePath,
      id: saved[0]!["_id"] as string,
      select: {
        name: true,
        networkDeviceNamePattern: true,
        networkDeviceDescriptionPattern: true,
        networkDeviceLabels: { _id: true, name: true },
        labelsToAdd: { _id: true, name: true },
      },
    });
    expect(item["networkDeviceNamePattern"]).toBe("core-.*");
    expect(item["networkDeviceDescriptionPattern"]).toBe("production");
    expect(item["labelsToAdd"]).toEqual([
      expect.objectContaining({ _id: source.networkLabelId, name: "Network" }),
    ]);
  });

  test("file upload resolves references to destination labels and creates new records", async () => {
    const name: string = "Imported production routers";
    await navigate(destination.id);
    await page.getByRole("button", { name: "Import JSON" }).click();
    await page.getByTestId("label-rule-import-file").setInputFiles({
      name: "network-label-rules.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(portableFile([rule(name)]))),
    });
    await preview();
    expect(await rulesNamed(destination.id, name)).toHaveLength(0);
    await importRules(1);
    const saved: Array<JSONish> = await rulesNamed(destination.id, name);
    expect(saved).toHaveLength(1);
    const item: JSONish = await getItem({
      page,
      projectId: destination.id,
      path: networkRulePath,
      id: saved[0]!["_id"] as string,
      select: {
        projectId: true,
        networkDeviceLabels: { _id: true, name: true },
        labelsToAdd: { _id: true, name: true },
      },
    });
    expect(toId(item["projectId"])).toBe(destination.id);
    expect(item["networkDeviceLabels"]).toEqual([
      expect.objectContaining({ _id: destination.productionLabelId }),
    ]);
    expect(item["labelsToAdd"]).toEqual([
      expect.objectContaining({ _id: destination.networkLabelId }),
    ]);
    expect(destination.networkLabelId).not.toBe(source.networkLabelId);
    expect(await rulesNamed(source.id, name)).toHaveLength(0);
    if (process.env["LABEL_RULE_SCREENSHOTS"] === "true") {
      await page.screenshot({ path: path.join(artifacts, "import-complete.png"), fullPage: true });
    }
  });

  test("imports a compatible network rule into monitors with mapped match criteria", async () => {
    const name: string = "Production monitor labeling";
    await navigate(destination.id, "monitors");
    await openImport(portableFile([rule(name, { networkDeviceNamePattern: "^core-" })]));
    await preview();
    await importRules(1);
    const saved: Array<JSONish> = await rulesNamed(destination.id, name, monitorRulePath);
    expect(saved).toHaveLength(1);
    const item: JSONish = await getItem({
      page,
      projectId: destination.id,
      path: monitorRulePath,
      id: saved[0]!["_id"] as string,
      select: {
        monitorNamePattern: true,
        monitorDescriptionPattern: true,
        monitorLabels: { _id: true, name: true },
        labelsToAdd: { _id: true, name: true },
      },
    });
    expect(item["monitorNamePattern"]).toBe("^core-");
    expect(item["monitorDescriptionPattern"]).toBe("production");
    expect(item["monitorLabels"]).toEqual([
      expect.objectContaining({ _id: destination.productionLabelId }),
    ]);
  });

  test("exports every rule beyond the visible table page and uses portable names", async () => {
    for (let index: number = 0; index < 30; index++) {
      await createItem({
        page,
        projectId: source.id,
        path: networkRulePath,
        item: {
          name: `Export pagination ${String(index + 1).padStart(2, "0")}`,
          projectId: source.id,
          isEnabled: index % 2 === 0,
          networkDeviceNamePattern: "^edge-",
          networkDeviceLabels: [source.productionLabelId],
          labelsToAdd: [source.networkLabelId],
        },
      });
    }
    await navigate(source.id);
    const downloadPromise: Promise<Download> = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export JSON" }).click();
    const exported: PortableRuleFile = await downloadJson(await downloadPromise);
    expect(exported.fileType).toBe("oneuptime-label-rules");
    expect(exported.schemaVersion).toBe(1);
    expect(exported.resourceType).toBe("NetworkDeviceLabelRule");
    expect(exported.items).toHaveLength(31);
    expect(exported.items.filter((item: JSONish) => { return item["isEnabled"] === false; })).toHaveLength(16);
    expect(exported.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Production core switches", networkDeviceNamePattern: "core-.*", labelsToAdd: ["Network"], networkDeviceLabels: ["Production"] }),
      expect.objectContaining({ name: "Export pagination 30" }),
    ]));
    for (const item of exported.items) {
      expect(item).not.toHaveProperty("_id");
      expect(item).not.toHaveProperty("projectId");
      expect(item).not.toHaveProperty("createdAt");
      expect(item["labelsToAdd"]).toEqual(["Network"]);
    }
    if (process.env["LABEL_RULE_SCREENSHOTS"] === "true") {
      await page.screenshot({ path: path.join(artifacts, "label-rules-toolbar.png"), fullPage: true });
    }
    // Feed the actual download back into a different project, then inspect the
    // preview's second page before creating only the selected JSON sample.
    await navigate(destination.id);
    await openImport(exported);
    await preview();
    await expect(page.getByTestId("modal")).toContainText("Page 1 of 2");
    await page.getByTestId("modal").getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByTestId("modal")).toContainText("Page 2 of 2");
    expect(await rulesNamed(destination.id, "Production core switches")).toHaveLength(0);
    await page.getByRole("button", { name: "Edit JSON", exact: true }).click();
    await page.getByTestId("label-rule-import-json").fill(JSON.stringify({ ...exported, items: exported.items.filter((item: JSONish) => { return item["name"] === "Production core switches"; }) }));
    await preview();
    await importRules(1);
    const sourceRows: Array<JSONish> = await rulesNamed(source.id, "Production core switches");
    const destinationRows: Array<JSONish> = await rulesNamed(destination.id, "Production core switches");
    expect(destinationRows).toHaveLength(1);
    expect(toId(destinationRows[0]!["_id"])).not.toBe(toId(sourceRows[0]!["_id"]));
    expect(destinationRows[0]!["isEnabled"]).toBe(false);
  });

  test("refuses cross-resource wildcard patterns instead of changing their matching behavior", async () => {
    const name: string = "Wildcard matching semantics";
    await navigate(destination.id, "monitors");
    await openImport(portableFile([rule(name, { networkDeviceNamePattern: "core-*" })]));
    await page.getByRole("button", { name: "Validate and preview" }).click();
    await expect(page.getByTestId("modal").getByRole("alert")).toContainText(/wildcard matching/i);
    expect(await rulesNamed(destination.id, name, monitorRulePath)).toHaveLength(0);
  });

  test("requires labels to exist in the destination project before preview", async () => {
    await navigate(emptyProjectId);
    await openImport(portableFile([rule("Unresolved destination references")]));
    await page.getByRole("button", { name: "Validate and preview" }).click();
    await expect(page.getByTestId("modal").getByRole("alert")).toContainText(/not found|does not exist|missing/i);
    expect(await rulesNamed(emptyProjectId, "Unresolved destination references")).toHaveLength(0);
  });

  const invalidPayloads: Array<{ title: string; payload: PortableRuleFile | string }> = [
    { title: "malformed JSON", payload: "{ broken json" },
    { title: "an unsupported version", payload: { ...portableFile([rule("Invalid version")]), schemaVersion: 99 } },
    { title: "an empty rule list", payload: portableFile([]) },
    { title: "an unknown condition", payload: portableFile([rule("Unknown condition", { unsupportedCondition: "do not drop me" })]) },
    { title: "a missing destination label", payload: portableFile([rule("Missing label", { labelsToAdd: ["Does not exist"] })]) },
    { title: "a missing prerequisite label", payload: portableFile([rule("Missing prerequisite", { networkDeviceLabels: ["Absent prerequisite"] })]) },
    { title: "a nonboolean enabled value", payload: portableFile([rule("Invalid enabled", { isEnabled: "true" })]) },
  ];

  for (const invalid of invalidPayloads) {
    test(`rejects ${invalid.title} before creating any rules`, async () => {
      await navigate(destination.id);
      const before: Array<JSONish> = await listItems({ page, projectId: destination.id, path: networkRulePath, select: { _id: true } });
      await openImport(invalid.payload);
      await page.getByRole("button", { name: "Validate and preview" }).click();
      await expect(page.getByText("Preview import", { exact: true })).not.toBeVisible();
      await expect(page.getByTestId("label-rule-import-json")).toBeVisible();
      await expect(page.getByTestId("modal").getByRole("alert")).toContainText(/invalid|unsupported|unknown|must|required|not found|not exist|at least/i);
      const after: Array<JSONish> = await listItems({ page, projectId: destination.id, path: networkRulePath, select: { _id: true } });
      expect(after.map((item: JSONish) => { return item["_id"]; }).sort()).toEqual(before.map((item: JSONish) => { return item["_id"]; }).sort());
    });
  }

  test("cancelling a valid preview leaves the destination unchanged", async () => {
    const name: string = "Cancelled import";
    await navigate(destination.id);
    await openImport(portableFile([rule(name)]));
    await preview();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await rulesNamed(destination.id, name)).toHaveLength(0);
    await expect(page.getByRole("button", { name: "Import JSON" })).toBeVisible();
  });

  test("reports partial failures and downloads only failed rules for safe retry", async () => {
    const names: Array<string> = ["Partial import first", "Partial import denied", "Partial import last"];
    await navigate(destination.id);
    await page.route(`**${networkRulePath}`, async (route: Route) => {
      if (route.request().method() === "POST" && route.request().postDataJSON()?.data?.name === names[1]) {
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Temporary label-rule creation failure" }) });
        return;
      }
      await route.continue();
    });
    await openImport(portableFile(names.map((name: string) => { return rule(name); })));
    await preview();
    await importRules(3);
    expect(await rulesNamed(destination.id, names[0]!)).toHaveLength(1);
    expect(await rulesNamed(destination.id, names[1]!)).toHaveLength(0);
    expect(await rulesNamed(destination.id, names[2]!)).toHaveLength(1);
    const downloadPromise: Promise<Download> = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download failed rules" }).click();
    const failed: PortableRuleFile = await downloadJson(await downloadPromise);
    expect(failed.items.map((item: JSONish) => { return item["name"]; })).toEqual([names[1]]);
    await page.unroute(`**${networkRulePath}`);
    await navigate(destination.id);
    await openImport(failed);
    await preview();
    await importRules(1);
    for (const name of names) {
      expect(await rulesNamed(destination.id, name)).toHaveLength(1);
    }
  });

  test("a forbidden create is reported and leaves the project unchanged", async () => {
    const name: string = "Permission denied import";
    await navigate(destination.id);
    await page.route(`**${networkRulePath}`, async (route: Route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ message: "You do not have permission to create Network Device Label Rules." }) });
        return;
      }
      await route.continue();
    });
    await openImport(portableFile([rule(name)]));
    await preview();
    await importRules(1);
    await expect(page.getByTestId("modal")).toContainText(/permission/i);
    expect(await rulesNamed(destination.id, name)).toHaveLength(0);
    await page.unroute(`**${networkRulePath}`);
  });
});
