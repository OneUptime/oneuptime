import { Download, Page, expect, test } from "@playwright/test";
import { mkdir, readFile } from "fs/promises";
import path from "path";

const artifacts: string = path.resolve(
  __dirname,
  "../../output/playwright/label-rule-import-export",
);
const source: string = "10000000-0000-4000-8000-000000000001";
const destination: string = "10000000-0000-4000-8000-000000000002";
interface RuleFile {
  fileType: string;
  schemaVersion: number;
  resourceType: string;
  items: Array<Record<string, unknown>>;
}
interface FixtureState {
  writes: Array<Record<string, unknown>>;
  requests: Array<Record<string, unknown>>;
  projectId: string;
  labelIds: Array<string>;
}
const ruleFile: (names?: Array<string>) => RuleFile = (
  names: Array<string> = ["Production switch discovery"],
): RuleFile => {
  return {
    fileType: "oneuptime-label-rules",
    schemaVersion: 1,
    resourceType: "NetworkDeviceLabelRule",
    items: names.map((name: string, index: number) => {
      return {
        name,
        description:
          "Automatically label discovered production network resources.",
        isEnabled: index !== 1,
        networkDeviceNamePattern: "^core-",
        networkDeviceDescriptionPattern: "production",
        networkDeviceLabels: ["Production"],
        labelsToAdd: ["Network"],
      };
    }),
  };
};
const state: (page: Page) => Promise<FixtureState> = async (
  page: Page,
): Promise<FixtureState> => {
  return page.evaluate((): FixtureState => {
    return (window as unknown as { __labelRuleFixture: FixtureState })
      .__labelRuleFixture;
  });
};
const navigate: (
  page: Page,
  options?: { projectId?: string; resource?: string; query?: string },
) => Promise<void> = async (
  page: Page,
  options: { projectId?: string; resource?: string; query?: string } = {},
): Promise<void> => {
  await page.goto(
    `/dashboard/${options.projectId || source}/${options.resource || "network-devices"}/settings/label-rules${options.query || ""}`,
  );
  await page.getByRole("button", { name: "More options", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Import JSON", exact: true }),
  ).toBeVisible();
};
const paste: (page: Page, file: RuleFile | string) => Promise<void> = async (
  page: Page,
  file: RuleFile | string,
): Promise<void> => {
  await page
    .getByRole("menuitem", { name: "Import JSON", exact: true })
    .click();
  await page
    .getByTestId("label-rule-import-json")
    .fill(typeof file === "string" ? file : JSON.stringify(file, null, 2));
};
const preview: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await page.getByRole("button", { name: "Validate and preview" }).click();
  await expect(page.getByText("Preview import", { exact: true })).toBeVisible();
};
const readDownload: (download: Download) => Promise<RuleFile> = async (
  download: Download,
): Promise<RuleFile> => {
  const file: string | null = await download.path();
  expect(file).not.toBeNull();
  return JSON.parse(await readFile(file!, "utf8")) as RuleFile;
};

test("production toolbar and pasted rules render a validated preview before any write", async ({
  page,
}: {
  page: Page;
}) => {
  await mkdir(artifacts, { recursive: true });
  await navigate(page);
  await expect(
    page.getByText("Production core switches", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(artifacts, "label-rules-toolbar.png"),
    fullPage: true,
  });
  const payload: RuleFile = ruleFile([
    "Production switch discovery",
    "Edge router classification",
    "Critical network devices",
  ]);
  await paste(page, payload);
  await page
    .getByTestId("label-rule-import-json")
    .evaluate((element: HTMLTextAreaElement): void => {
      element.scrollTop = 0;
    });
  await page.screenshot({
    path: path.join(artifacts, "import-json.png"),
    fullPage: true,
  });
  await preview(page);
  await expect(page.getByTestId("modal")).toContainText("3 rules");
  await expect(page.getByTestId("modal")).toContainText("Disabled");
  expect((await state(page)).writes).toHaveLength(0);
  await page.getByText("View conditions and actions").first().click();
  await expect(page.getByTestId("modal")).toContainText('"Production"');
  await expect(page.getByTestId("modal")).not.toContainText('"_id"');
  await page.screenshot({
    path: path.join(artifacts, "import-preview.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Import 3 rules", exact: true })
    .click();
  await expect(
    page.getByText("Import complete", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "3 rules imported successfully. 0 failed.",
  );
  const result: FixtureState = await state(page);
  expect(result.writes).toHaveLength(3);
  expect(result.writes[1]!["isEnabled"]).toBe(false);
  expect(result.writes[0]!["projectId"]).toBe(source);
  await page.screenshot({
    path: path.join(artifacts, "import-complete.png"),
    fullPage: true,
  });
});

test("uploading JSON maps compatible conditions and resolves destination label IDs", async ({
  page,
}: {
  page: Page;
}) => {
  await navigate(page, { projectId: destination, resource: "monitors" });
  await page
    .getByRole("menuitem", { name: "Import JSON", exact: true })
    .click();
  await page.getByTestId("label-rule-import-file").setInputFiles({
    name: "network-rules.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(ruleFile())),
  });
  await preview(page);
  await expect(page.getByTestId("modal")).toContainText(
    "Conditions mapped to this resource type",
  );
  await page.screenshot({
    path: path.join(artifacts, "cross-resource-preview.png"),
    fullPage: true,
  });
  expect((await state(page)).writes).toHaveLength(0);
  await page
    .getByRole("button", { name: "Import 1 rule", exact: true })
    .click();
  await expect(
    page.getByText("Import complete", { exact: true }),
  ).toBeVisible();
  const result: FixtureState = await state(page);
  expect(result.writes).toHaveLength(1);
  expect(result.writes[0]!["monitorNamePattern"]).toBe("^core-");
  expect(result.writes[0]!["projectId"]).toBe(destination);
  expect(result.writes[0]!["labelsToAdd"]).toEqual([result.labelIds[1]]);
});

test("export traverses API pagination beyond the visible table and strips deployment IDs", async ({
  page,
}: {
  page: Page;
}) => {
  await navigate(page, { query: "?count=501" });
  const downloadPromise: Promise<Download> = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Export JSON", exact: true })
    .click();
  const file: RuleFile = await readDownload(await downloadPromise);
  expect(file.items).toHaveLength(501);
  expect(file.items[500]!["name"]).toBe("Network label rule 501");
  expect(file.items[1]!["isEnabled"]).toBe(false);
  for (const item of file.items) {
    expect(item).not.toHaveProperty("_id");
    expect(item).not.toHaveProperty("projectId");
    expect(item["labelsToAdd"]).toEqual(["Network"]);
  }
  expect((await state(page)).requests).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        operation: "list",
        skip: 500,
        limit: 500,
        tenantid: source,
      }),
    ]),
  );
});

const invalid: Array<{
  title: string;
  file: RuleFile | string;
  message: RegExp;
}> = [
  { title: "malformed JSON", file: "{ bad json", message: /not valid JSON/i },
  {
    title: "a newer schema",
    file: { ...ruleFile(), schemaVersion: 99 },
    message: /version/i,
  },
  {
    title: "an empty file",
    file: { ...ruleFile(), items: [] },
    message: /at least one/i,
  },
  {
    title: "a protected ID",
    file: { ...ruleFile(), items: [{ ...ruleFile().items[0], _id: source }] },
    message: /protected field/i,
  },
  {
    title: "a missing label",
    file: {
      ...ruleFile(),
      items: [{ ...ruleFile().items[0], labelsToAdd: ["Missing label"] }],
    },
    message: /was not found/i,
  },
  {
    title: "a missing prerequisite",
    file: {
      ...ruleFile(),
      items: [
        {
          ...ruleFile().items[0],
          networkDeviceLabels: ["Missing prerequisite"],
        },
      ],
    },
    message: /was not found/i,
  },
  {
    title: "a string enabled flag",
    file: {
      ...ruleFile(),
      items: [{ ...ruleFile().items[0], isEnabled: "true" }],
    },
    message: /must be true or false/i,
  },
];
for (const sample of invalid) {
  test(`rejects ${sample.title} without any create request`, async ({
    page,
  }: {
    page: Page;
  }) => {
    await navigate(page);
    await paste(page, sample.file);
    await page.getByRole("button", { name: "Validate and preview" }).click();
    await expect(page.getByTestId("modal").getByRole("alert")).toContainText(
      sample.message,
    );
    if (sample.title === "a missing label") {
      await page.screenshot({
        path: path.join(artifacts, "validation-error.png"),
        fullPage: true,
      });
    }
    expect((await state(page)).writes).toHaveLength(0);
    expect(
      (await state(page)).requests.filter(
        (request: Record<string, unknown>) => {
          return request["operation"] === "create";
        },
      ),
    ).toHaveLength(0);
  });
}

test("preview pagination and editing revalidate the edited JSON without writes", async ({
  page,
}: {
  page: Page;
}) => {
  await navigate(page);
  await paste(
    page,
    ruleFile(
      Array.from({ length: 21 }, (_: unknown, index: number): string => {
        return `Preview rule ${index + 1}`;
      }),
    ),
  );
  await preview(page);
  await expect(page.getByTestId("modal")).toContainText("Page 1 of 2");
  await page
    .getByTestId("modal")
    .getByRole("button", { name: "Next", exact: true })
    .click();
  await expect(page.getByTestId("modal")).toContainText("Preview rule 21");
  await page.getByRole("button", { name: "Edit JSON", exact: true }).click();
  await page.getByTestId("label-rule-import-json").fill("invalid");
  await page.getByRole("button", { name: "Validate and preview" }).click();
  await expect(page.getByTestId("modal").getByRole("alert")).toContainText(
    /not valid JSON/i,
  );
  expect((await state(page)).writes).toHaveLength(0);
});

test("partial failure downloads only unsuccessful rows for review and retry", async ({
  page,
}: {
  page: Page;
}) => {
  await navigate(page);
  await paste(
    page,
    ruleFile([
      "Successful first rule",
      "Fail this rule",
      "Successful last rule",
    ]),
  );
  await preview(page);
  await page
    .getByRole("button", { name: "Import 3 rules", exact: true })
    .click();
  await expect(
    page.getByText("Import complete", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "2 rules imported successfully. 1 failed.",
  );
  const promise: Promise<Download> = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download failed rules" }).click();
  const file: RuleFile = await readDownload(await promise);
  expect(
    file.items.map((item: Record<string, unknown>) => {
      return item["name"];
    }),
  ).toEqual(["Fail this rule"]);
  expect((await state(page)).writes).toHaveLength(2);
});

test("read-only viewers can export but cannot import", async ({
  page,
}: {
  page: Page;
}) => {
  await navigate(page, { query: "?role=viewer" });
  await expect(
    page.getByRole("menuitem", { name: "Import JSON", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("menuitem", { name: "Export JSON", exact: true }),
  ).toBeEnabled();
});

test("oversized uploads cannot advance to a preview", async ({
  page,
}: {
  page: Page;
}) => {
  await navigate(page);
  await page
    .getByRole("menuitem", { name: "Import JSON", exact: true })
    .click();
  await page.getByTestId("label-rule-import-file").setInputFiles({
    name: "oversized.json",
    mimeType: "application/json",
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1, " "),
  });
  await expect(page.getByTestId("modal").getByRole("alert")).toContainText(
    /smaller than 10 MB/i,
  );
  await expect(
    page.getByRole("button", { name: "Validate and preview" }),
  ).toBeDisabled();
  expect((await state(page)).writes).toHaveLength(0);
});
