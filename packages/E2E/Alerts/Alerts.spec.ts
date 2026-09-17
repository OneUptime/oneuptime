import { expect, Locator, Page, test, TestInfo } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

interface Appearance {
  background: string;
  color: string;
  contrast: number;
  fontSize: number;
  fontWeight: number;
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const appearance: (locator: Locator) => Promise<Appearance> = async (
  locator: Locator,
): Promise<Appearance> => {
  return locator.evaluate((element: HTMLElement | SVGElement): Appearance => {
    const style: CSSStyleDeclaration = getComputedStyle(element);
    type Channels = [number, number, number, number];
    const parseColor: (color: string) => Channels = (
      color: string,
    ): Channels => {
      const values: Array<number> = (color.match(/[\d.]+/g) || []).map(
        (value: string): number => {
          return Number(value);
        },
      );
      return [values[0] || 0, values[1] || 0, values[2] || 0, values[3] ?? 1];
    };
    let backgroundElement: Element | null = element;
    const layers: Array<string> = [];
    while (backgroundElement) {
      const candidate: string =
        getComputedStyle(backgroundElement).backgroundColor;
      if (parseColor(candidate)[3] > 0) {
        layers.push(candidate);
      }
      backgroundElement = backgroundElement.parentElement;
    }
    const background: string = layers[0] || "rgb(255, 255, 255)";
    // Theme surfaces are translucent: composite each ancestor before measuring.
    let composite: Channels = [255, 255, 255, 1];
    for (const layer of layers.reverse()) {
      const foreground: Channels = parseColor(layer);
      const alpha: number = foreground[3];
      composite = [
        foreground[0] * alpha + composite[0] * (1 - alpha),
        foreground[1] * alpha + composite[1] * (1 - alpha),
        foreground[2] * alpha + composite[2] * (1 - alpha),
        1,
      ];
    }
    const luminance: (color: Channels) => number = (
      color: Channels,
    ): number => {
      const channels: Array<number> = color
        .slice(0, 3)
        .map((value: number): number => {
          const channel: number = value / 255;
          return channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4;
        });
      return (
        (channels[0] || 0) * 0.2126 +
        (channels[1] || 0) * 0.7152 +
        (channels[2] || 0) * 0.0722
      );
    };
    const foregroundLuminance: number = luminance(parseColor(style.color));
    const backgroundLuminance: number = luminance(composite);
    return {
      background,
      color: style.color,
      contrast:
        (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05),
      fontSize: parseFloat(style.fontSize),
      fontWeight: parseFloat(style.fontWeight),
    };
  });
};

const bounds: (locator: Locator) => Promise<Bounds> = async (
  locator: Locator,
): Promise<Bounds> => {
  const rectangle: Bounds | null = await locator.boundingBox();
  if (!rectangle) {
    throw new Error("Expected a visible element with a layout box");
  }
  return rectangle;
};

const expectNoOverflow: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  expect(
    await page.evaluate((): boolean => {
      return document.documentElement.scrollWidth <= window.innerWidth;
    }),
  ).toBe(true);
  const overflowingAlerts: Array<string | null> = await page
    .getByRole("alert")
    .evaluateAll((alerts: Array<HTMLElement>): Array<string | null> => {
      return alerts
        .filter((alert: HTMLElement): boolean => {
          return alert.scrollWidth > alert.clientWidth + 1;
        })
        .map((alert: HTMLElement): string | null => {
          return alert.getAttribute("data-testid");
        });
    });
  expect(overflowingAlerts).toEqual([]);
};

test.beforeEach(async ({ page }: { page: Page }) => {
  await page.goto("/?view=regressions");
  await expect(page.getByTestId("regression-fixtures")).toBeVisible();
  // The bundled Tailwind runtime compiles styles after React creates the DOM.
  await expect(page.getByTestId("variant-danger")).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
});

test("gives every severity a distinct surface with readable text and icons", async ({
  page,
}: {
  page: Page;
}) => {
  const backgrounds: Array<string> = [];
  for (const severity of ["info", "success", "warning", "danger"]) {
    const alert: Locator = page.getByTestId(`variant-${severity}`);
    await expect(alert).toHaveAttribute("role", "alert");
    await expect(alert).toHaveAttribute("aria-live", "polite");
    const text: Appearance = await appearance(alert.locator(".alert-message"));
    const icon: Appearance = await appearance(alert.locator("svg").first());
    backgrounds.push(text.background);
    expect(text.contrast, `${severity} text contrast`).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(icon.contrast, `${severity} icon contrast`).toBeGreaterThanOrEqual(
      3,
    );
    expect(text.fontSize).toBeGreaterThanOrEqual(14);
    expect(await alert.getAttribute("tabindex")).toBeNull();
    await expect(alert.getByRole("button")).toHaveCount(0);
  }
  expect(new Set(backgrounds).size).toBe(4);
});

test("places the emphasized title above its supporting message", async ({
  page,
}: {
  page: Page;
}) => {
  const alert: Locator = page.getByTestId("variant-danger");
  const title: Locator = alert.getByText("DANGER ZONE", { exact: true });
  const message: Locator = alert.getByText(
    "Deleting your project will delete it permanently and there is no way to recover.",
    { exact: true },
  );
  const titleBounds: Bounds = await bounds(title);
  const messageBounds: Bounds = await bounds(message);
  expect(messageBounds.y).toBeGreaterThanOrEqual(
    titleBounds.y + titleBounds.height,
  );
  expect(Math.abs(messageBounds.x - titleBounds.x)).toBeLessThanOrEqual(1);
  expect((await appearance(title)).fontWeight).toBeGreaterThanOrEqual(600);
  expect((await alert.innerText()).includes("DANGER ZONE -")).toBe(false);
});

for (const width of [320, 390, 1440]) {
  test(`wraps long prose, unbroken links and metadata at ${width}px`, async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const alert: Locator = page.getByTestId("long-alert");
    await expect(alert.getByRole("link")).toBeVisible();
    await expectNoOverflow(page);
    const link: Locator = alert.getByRole("link");
    const linkLines: number = await link.evaluate(
      (element: HTMLElement): number => {
        return element.getClientRects().length;
      },
    );
    expect(linkLines).toBeGreaterThan(1);
    const alertBounds: Bounds = await bounds(alert);
    const dismissBounds: Bounds = await bounds(
      alert.getByRole("button", { name: "Close", exact: true }),
    );
    expect(dismissBounds.x).toBeGreaterThanOrEqual(alertBounds.x);
    expect(dismissBounds.x + dismissBounds.width).toBeLessThanOrEqual(
      alertBounds.x + alertBounds.width,
    );
    const copyBounds: Bounds = await bounds(page.getByTestId("long-copy"));
    const metadataBounds: Bounds = await bounds(
      alert.getByText("Updated 2 minutes ago", { exact: true }),
    );
    if (width < 640) {
      expect(metadataBounds.y).toBeGreaterThanOrEqual(
        copyBounds.y + copyBounds.height,
      );
    } else {
      expect(metadataBounds.x).toBeGreaterThan(copyBounds.x);
      expect(metadataBounds.y).toBeLessThan(copyBounds.y + copyBounds.height);
    }
  });
}

test("does not reserve icon space when icons are hidden", async ({
  page,
}: {
  page: Page;
}) => {
  const alert: Locator = page.getByTestId("no-icon-alert");
  await expect(alert.locator("svg")).toHaveCount(0);
  const alertBounds: Bounds = await bounds(alert);
  const copyBounds: Bounds = await bounds(page.getByTestId("no-icon-copy"));
  const padding: number = await alert.evaluate(
    (element: HTMLElement): number => {
      const style: CSSStyleDeclaration = getComputedStyle(element);
      return parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
    },
  );
  expect(Math.abs(copyBounds.x - alertBounds.x - padding)).toBeLessThanOrEqual(
    1,
  );
});

test("preserves a custom status color and genuinely enlarges its text", async ({
  page,
}: {
  page: Page;
}) => {
  const alert: Locator = page.getByTestId("custom-dark-alert");
  await expect(alert).toHaveCSS("background-color", "rgb(22, 101, 52)");
  const text: Appearance = await appearance(
    page.getByTestId("custom-dark-copy"),
  );
  expect(text.color).toBe("rgb(255, 255, 255)");
  expect(text.contrast).toBeGreaterThanOrEqual(4.5);
  expect(text.fontSize).toBeGreaterThanOrEqual(18);
  const ordinaryText: Appearance = await appearance(
    page.getByTestId("no-icon-copy"),
  );
  expect(text.fontSize).toBeGreaterThan(ordinaryText.fontSize);
  const customLight: Locator = page.getByTestId("custom-light-alert");
  await expect(customLight).toHaveCSS("background-color", "rgb(240, 253, 244)");
  const lightText: Appearance = await appearance(
    page.getByTestId("custom-light-copy"),
  );
  expect(lightText.contrast).toBeGreaterThanOrEqual(4.5);
  const background: string = text.background;
  await alert.hover();
  await expect(alert).toHaveCSS("background-color", background);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expectNoOverflow(page);
  }
});

for (const interaction of ["click", "Enter", "Space"]) {
  test(`dismisses with ${interaction} without submitting a form or activating its parent`, async ({
    page,
  }: {
    page: Page;
  }) => {
    const alert: Locator = page.getByTestId("form-dismissible");
    const close: Locator = alert.getByRole("button", {
      name: "Close",
      exact: true,
    });
    await expect(close).toHaveAttribute("type", "button");
    const closeBounds: Bounds = await bounds(close);
    expect(closeBounds.width).toBeGreaterThanOrEqual(24);
    expect(closeBounds.height).toBeGreaterThanOrEqual(24);
    if (interaction === "click") {
      await close.click();
    } else {
      await close.focus();
      await expect(close).toBeFocused();
      await close.press(interaction);
    }
    await expect(alert).toHaveCount(0);
    await expect(page.getByTestId("close-count")).toHaveText("1");
    await expect(page.getByTestId("submit-count")).toHaveText("0");
    await expect(page.getByTestId("parent-count")).toHaveText("0");
    await expect(page.getByTestId("action-count")).toHaveText("0");
  });
}

test("makes the clickable banner keyboard accessible with a visible focus indicator", async ({
  page,
}: {
  page: Page;
}) => {
  const alert: Locator = page.getByTestId("interactive-alert");
  const action: Locator = alert.getByRole("button", {
    name: /Notification delivery needs attention/,
  });
  await expect(action).toHaveAttribute("type", "button");
  await action.focus();
  await expect(action).toBeFocused();
  const hasFocusIndicator: boolean = await action.evaluate(
    (element: HTMLElement): boolean => {
      const style: CSSStyleDeclaration = getComputedStyle(element);
      return (
        style.boxShadow !== "none" ||
        (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0)
      );
    },
  );
  expect(hasFocusIndicator).toBe(true);
  await action.press("Enter");
  await expect(page.getByTestId("action-count")).toHaveText("1");
  await action.press("Space");
  await expect(page.getByTestId("action-count")).toHaveText("2");
  await alert
    .getByText("Notification delivery needs attention", { exact: true })
    .click();
  await expect(page.getByTestId("action-count")).toHaveText("3");
  await expect(page.getByTestId("link-count")).toHaveText("0");
  await expect(page.getByTestId("button-count")).toHaveText("0");
});

test("keeps JSX links and buttons independently operable by pointer and keyboard", async ({
  page,
}: {
  page: Page;
}) => {
  const alert: Locator = page.getByTestId("interactive-alert");
  const link: Locator = alert.getByRole("link", { name: "delivery guide" });
  const button: Locator = alert.getByRole("button", {
    name: "Retry delivery",
    exact: true,
  });
  await link.click();
  await expect(page).toHaveURL(/#delivery-guide$/);
  await expect(page.getByTestId("link-count")).toHaveText("1");
  await button.click();
  await expect(page.getByTestId("button-count")).toHaveText("1");
  await link.focus();
  await link.press("Enter");
  await expect(page.getByTestId("link-count")).toHaveText("2");
  await button.focus();
  await button.press("Space");
  await expect(page.getByTestId("button-count")).toHaveText("2");
  await expect(page.getByTestId("action-count")).toHaveText("0");
});

test("captures representative desktop and mobile component previews", async ({
  page,
}: { page: Page }, testInfo: TestInfo) => {
  const directory: string = path.resolve(
    __dirname,
    "../../output/playwright/alerts",
  );
  await fs.mkdir(directory, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const view of ["gallery", "danger"]) {
      await page.goto(`/?view=${view}`);
      const preview: Locator = page.getByTestId(
        view === "gallery" ? "alert-gallery" : "danger-zone-preview",
      );
      await expect(preview).toBeVisible();
      await expect(preview.getByRole("alert").first()).not.toHaveCSS(
        "background-color",
        "rgba(0, 0, 0, 0)",
      );
      await expectNoOverflow(page);
      const screenshot: string = path.join(
        directory,
        `${view}-${width}-${testInfo.project.name}-synthetic.png`,
      );
      if (view === "danger") {
        await page.locator("main").screenshot({ path: screenshot });
      } else {
        await page.screenshot({ path: screenshot, fullPage: true });
      }
      await testInfo.attach(`${view}-${width}`, {
        path: screenshot,
        contentType: "image/png",
      });
    }
  }
});

for (const theme of ["light", "dark"]) {
  test(`keeps every severity and its hover controls readable in the ${theme} theme`, async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`/?view=regressions&theme=${theme}`);
    await expect(page.locator("html")).toHaveCSS("color-scheme", theme);
    for (const severity of ["info", "success", "warning", "danger"]) {
      const standard: Locator = page.getByTestId(`variant-${severity}`);
      expect(
        (await appearance(standard.locator(".alert-message"))).contrast,
        `${theme} ${severity} text contrast`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        (await appearance(standard.locator("svg").first())).contrast,
        `${theme} ${severity} icon contrast`,
      ).toBeGreaterThanOrEqual(3);

      const interactive: Locator = page.getByTestId(`interactive-${severity}`);
      await interactive.hover({ position: { x: 4, y: 4 } });
      await interactive.evaluate(
        async (element: HTMLElement): Promise<void> => {
          await Promise.all(
            element
              .getAnimations()
              .map((animation: Animation): Promise<Animation> => {
                return animation.finished;
              }),
          );
        },
      );
      expect(
        (await appearance(interactive.locator(".alert-message"))).contrast,
        `${theme} ${severity} banner hover contrast`,
      ).toBeGreaterThanOrEqual(4.5);
      const close: Locator = interactive.getByRole("button", {
        name: "Close",
        exact: true,
      });
      await close.hover();
      await close.evaluate(async (element: HTMLElement): Promise<void> => {
        await Promise.all(
          element
            .getAnimations()
            .map((animation: Animation): Promise<Animation> => {
              return animation.finished;
            }),
        );
      });
      expect(
        (await appearance(close.locator("svg"))).contrast,
        `${theme} ${severity} close hover contrast`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
}

test("captures desktop and mobile galleries with the production dark theme", async ({
  page,
}: { page: Page }, testInfo: TestInfo) => {
  const directory: string = path.resolve(
    __dirname,
    "../../output/playwright/alerts",
  );
  await fs.mkdir(directory, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/?view=gallery&theme=dark");
    await expect(page.getByTestId("alert-gallery")).toBeVisible();
    await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
    await expectNoOverflow(page);
    const screenshot: string = path.join(
      directory,
      `gallery-dark-${width}-${testInfo.project.name}-synthetic.png`,
    );
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach(`gallery-dark-${width}`, {
      path: screenshot,
      contentType: "image/png",
    });
  }
});
