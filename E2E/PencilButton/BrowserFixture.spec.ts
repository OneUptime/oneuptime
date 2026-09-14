import { Locator, Page, TestInfo, expect, test } from "@playwright/test";

interface Alignment {
  iconWidth: number;
  iconHeight: number;
  iconCenterOffset: number;
  labelCenterOffset: number;
  labelGap: number;
}

const alignment: (button: Locator) => Promise<Alignment> = async (
  button: Locator,
): Promise<Alignment> => {
  return button.evaluate((element: HTMLButtonElement): Alignment => {
    const svg: SVGSVGElement = element.querySelector("svg")!;
    const icon: DOMRect = svg.getBoundingClientRect();
    const bounds: DOMRect = element.getBoundingClientRect();
    const label: ChildNode | undefined = Array.from(element.childNodes).find(
      (node: ChildNode): boolean => {
        return (
          node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim())
        );
      },
    );
    const range: Range = document.createRange();
    range.selectNode(label!);
    const text: DOMRect = range.getBoundingClientRect();
    return {
      iconWidth: icon.width,
      iconHeight: icon.height,
      iconCenterOffset:
        icon.y + icon.height / 2 - (bounds.y + bounds.height / 2),
      labelCenterOffset: icon.y + icon.height / 2 - (text.y + text.height / 2),
      labelGap: text.x - icon.right,
    };
  });
};

test.beforeEach(async ({ page }: { page: Page }) => {
  await page.goto("/");
  await expect(page.getByTestId("edit-project")).toBeVisible();
  await expect(page.getByTestId("edit-project").locator("svg")).toHaveCSS(
    "width",
    "20px",
  );
});

test("all labeled variants and sizes center the pencil without changing its button slot", async ({
  page,
}: {
  page: Page;
}) => {
  const buttons: Locator = page.locator(
    '[data-testid="edit-project"], [data-testid^="variant-"], [data-testid^="size-"]',
  );
  expect(await buttons.count()).toBe(24);
  for (const button of await buttons.all()) {
    const name: string | null = await button.getAttribute("data-testid");
    const result: Alignment = await alignment(button);
    expect(result.iconWidth, name || "icon width").toBe(20);
    expect(result.iconHeight, name || "icon height").toBe(20);
    expect(
      Math.abs(result.iconCenterOffset),
      `${name}: button center`,
    ).toBeLessThanOrEqual(0.25);
    expect(
      Math.abs(result.labelCenterOffset),
      `${name}: text center`,
    ).toBeLessThanOrEqual(1.5);
    expect(result.labelGap, `${name}: label gap`).toBeGreaterThanOrEqual(4);
    await expect(button.locator("svg")).toHaveAttribute("aria-hidden", "true");
  }
  expect(
    await page.evaluate((): number => {
      return document.documentElement.scrollWidth - window.innerWidth;
    }),
  ).toBeLessThanOrEqual(0);
});

test("pencil is visibly wider and shorter while both aliases and all sizes share the same geometry", async ({
  page,
}: {
  page: Page;
}) => {
  const pencil: Locator = page.getByTestId("edit-project").locator("svg path");
  const edit: Locator = page.getByTestId("variant-NORMAL").locator("svg path");
  expect(await pencil.getAttribute("d")).toBe(await edit.getAttribute("d"));
  const geometry: {
    width: number;
    length: number;
    x: number;
    y: number;
    right: number;
    bottom: number;
  } = await pencil.evaluate((path: SVGPathElement) => {
    const bounds: DOMRect = path.getBBox();
    const perimeter: number = path.getTotalLength();
    const along: number[] = [];
    const across: number[] = [];
    // Project the actual rendered outline onto the pencil's diagonal axes.
    for (let index: number = 0; index <= 1000; index++) {
      const point: DOMPoint = path.getPointAtLength((perimeter * index) / 1000);
      along.push((point.x - point.y) / Math.SQRT2);
      across.push((point.x + point.y) / Math.SQRT2);
    }
    return {
      width: Math.max(...across) - Math.min(...across),
      length: Math.max(...along) - Math.min(...along),
      x: bounds.x,
      y: bounds.y,
      right: bounds.x + bounds.width,
      bottom: bounds.y + bounds.height,
    };
  });
  // The previous narrow pencil measured 3 units wide and 21.4 units long.
  expect(geometry.width).toBeGreaterThan(5);
  expect(geometry.length).toBeLessThan(20);
  expect(geometry.length / geometry.width).toBeLessThan(4);
  expect(geometry.x).toBeGreaterThan(4);
  expect(geometry.y).toBeGreaterThan(4);
  expect(geometry.right).toBeLessThan(20);
  expect(geometry.bottom).toBeLessThan(20);
  const sizes: number[] = [];
  for (const svg of await page.locator('[data-testid^="standalone-"]').all()) {
    sizes.push(
      await svg.evaluate((element: SVGSVGElement): number => {
        return element.getBoundingClientRect().width;
      }),
    );
    expect(await svg.locator("path").getAttribute("d")).toBe(
      await pencil.getAttribute("d"),
    );
  }
  expect(sizes).toEqual([16, 20, 24]);
});

test("labeled and icon-only edit actions remain accessible to pointer and keyboard users", async ({
  page,
}: {
  page: Page;
}) => {
  const project: Locator = page.getByRole("button", {
    name: "Edit Project",
    exact: true,
  });
  await project.click();
  await project.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await expect(page.getByRole("status")).toHaveText("Edits requested: 3");
  for (const name of ["ICON", "ICON_LIGHT"]) {
    const button: Locator = page.getByRole("button", {
      name: `Edit ${name}`,
      exact: true,
    });
    await expect(button).toHaveText("");
    const offset: number = await button.evaluate(
      (element: HTMLButtonElement): number => {
        const buttonBounds: DOMRect = element.getBoundingClientRect();
        const iconBounds: DOMRect = element
          .querySelector("svg")!
          .getBoundingClientRect();
        return Math.abs(
          iconBounds.y +
            iconBounds.height / 2 -
            (buttonBounds.y + buttonBounds.height / 2),
        );
      },
    );
    expect(offset).toBeLessThanOrEqual(0.25);
    await button.focus();
    await page.keyboard.press("Enter");
  }
  await expect(page.getByRole("status")).toHaveText("Edits requested: 5");
  await expect(
    page.getByRole("button", { name: "Disabled edit" }),
  ).toBeDisabled();
});

test("captures the project action and button variants for visual review", async ({
  page,
}: { page: Page }, testInfo: TestInfo) => {
  await page
    .getByTestId("project-card")
    .screenshot({ path: testInfo.outputPath("edit-project.png") });
  await page.screenshot({
    path: testInfo.outputPath("pencil-buttons.png"),
    fullPage: true,
  });
  await testInfo.attach("Edit Project", {
    path: testInfo.outputPath("edit-project.png"),
    contentType: "image/png",
  });
});
