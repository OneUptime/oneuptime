import { expect, Locator, Page, Route, test } from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";
import { FrameBox, boxesInOneFrame } from "../SuiteHelpers/Frames";

/*
 * A Docker and a Podman host's pages, in a browser, against the offline
 * fixture (ContainerHostPages/Fixture): what the containers' rules say
 * (ContainerHostHealth) on a host in trouble - one container in a restart
 * loop, one that restarted, one near its memory limit, a service that
 * stopped, a migration that finished - read the way a person reads it: the
 * Overview's health and Needs attention, the Containers list, a container's
 * own page; at a phone's width and a laptop's, beside the side menu, dark,
 * German and Persian; with a calm host, a new one, a disconnected agent and
 * a read that fails. The fixture records every read, so each test also
 * checks that nothing it does not model was asked for.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const DOCKER_HOST_ID: string = "72000000-0000-4000-8000-000000000001";
const PODMAN_HOST_ID: string = "73000000-0000-4000-8000-000000000001";

const DOCKER_PATH: string = `/dashboard/${PROJECT_ID}/docker/${DOCKER_HOST_ID}`;
const PODMAN_PATH: string = `/dashboard/${PROJECT_ID}/podman/${PODMAN_HOST_ID}`;

const PHONE: { width: number; height: number } = { width: 390, height: 844 };
const TABLET: { width: number; height: number } = { width: 768, height: 1024 };
const SMALL_LAPTOP: { width: number; height: number } = {
  width: 1024,
  height: 900,
};
const LAPTOP: { width: number; height: number } = { width: 1280, height: 900 };

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/container-host-pages-ui",
);

function localeOf(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        `../../App/FeatureSet/Dashboard/src/Locales/${language}.json`,
      ),
      "utf8",
    ),
  ) as Record<string, string>;
}

// The Dashboard's German and Persian words, as the fixture draws them.
const GERMAN: Record<string, string> = localeOf("de");
const PERSIAN: Record<string, string> = localeOf("fa");

// Unicode's isolate marks, which set a Persian sentence's values apart.
const ISOLATE_MARKS: RegExp = /[⁦-⁩]/g;

interface Recorded {
  listRequests: Array<{ modelName: string; query: Record<string, unknown> }>;
  aggregateRequests: Array<{ modelName: string; name: string | null }>;
  apiRequests: Array<{ method: string; url: string }>;
  unhandled: Array<Record<string, unknown>>;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const pageErrors: Map<Page, Array<string>> = new Map();
const outsideRequests: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const outside: Array<string> = [];
  pageErrors.set(page, errors);
  outsideRequests.set(page, outside);

  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });

  // Nothing may leave the fixture: no CDN, no telemetry, no real API.
  await page.route("**/*", async (route: Route) => {
    const url: URL = new URL(route.request().url());

    if (url.hostname === "127.0.0.1") {
      await route.continue();
      return;
    }

    outside.push(url.toString());
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  // A page that threw while drawing is a bug even when the test passed.
  expect(pageErrors.get(page) || []).toEqual([]);
  expect(outsideRequests.get(page) || []).toEqual([]);

  if (!page.isClosed()) {
    const unhandled: Array<Record<string, unknown>> = await page.evaluate(
      (): Array<Record<string, unknown>> => {
        const fixture: Recorded | undefined = (
          window as unknown as { __containerHostPagesFixture?: Recorded }
        ).__containerHostPagesFixture;
        return fixture ? fixture.unhandled : [];
      },
    );

    // Every read the page made is one the fixture answers as the server does.
    expect(unhandled).toEqual([]);
  }
});

async function screenshot(page: Page, name: string): Promise<void> {
  await fsPromises.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

function withQuery(pagePath: string, query: string): string {
  return query ? `${pagePath}?${query}` : pagePath;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

// Whether an element's text is cut: wider than the box it is drawn in.
async function isCut(locator: Locator): Promise<boolean> {
  return await locator.evaluate((element: Element): boolean => {
    return element.scrollWidth > element.clientWidth + 0.5;
  });
}

function attentionCard(page: Page, testId: string): Locator {
  return page.getByTestId(testId);
}

async function attentionKeys(
  page: Page,
  testId: string,
): Promise<Array<string>> {
  return await attentionCard(page, testId)
    .getByTestId(`${testId}-item`)
    .evaluateAll((items: Array<Element>): Array<string> => {
      return items.map((item: Element): string => {
        return item.getAttribute("data-key") || "";
      });
    });
}

async function openOverview(
  page: Page,
  hostPath: string,
  query: string = "",
): Promise<void> {
  await page.goto(withQuery(hostPath, query));
  await expect(page.getByTestId("resource-hero-identity")).toBeVisible();
}

async function waitForHealth(page: Page, health: string): Promise<void> {
  await expect(page.getByTestId("container-host-health")).toHaveAttribute(
    "data-health",
    health,
  );
}

/*
 * ---------------------------------------------------------------------------
 * The Overview
 * ---------------------------------------------------------------------------
 */
test.describe("a host in trouble: the Overview says what needs attention", () => {
  for (const [runtime, hostPath] of [
    ["Docker", DOCKER_PATH],
    ["Podman", PODMAN_PATH],
  ] as Array<[string, string]>) {
    test(`${runtime}: Unhealthy beside Connected, the crash loop first, the finished job left out`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize(LAPTOP);
      await openOverview(page, hostPath);
      await waitForHealth(page, "Unhealthy");

      await expect(page.getByTestId("container-host-health")).toHaveText(
        "Unhealthy",
      );

      const card: Locator = attentionCard(
        page,
        "container-host-needs-attention",
      );
      await expect(card).toBeVisible();
      expect(
        await attentionKeys(page, "container-host-needs-attention"),
      ).toEqual([
        "container:shop-worker-1",
        "container:billing-exporter",
        "container:cache",
        "container:shop-search-1",
      ]);

      const items: Locator = card.getByTestId(
        "container-host-needs-attention-item",
      );
      await expect(items.nth(0)).toHaveAttribute("data-severity", "critical");
      await expect(items.nth(0)).toContainText("6 restarts in 15 minutes");
      await expect(items.nth(1)).toContainText("Stopped reporting");
      await expect(items.nth(1)).toContainText("Last reported");
      await expect(items.nth(2)).toContainText("1 restart in 15 minutes");
      await expect(items.nth(3)).toContainText("Memory 91.4% used");
      // Every row is a container: no Container chip on each.
      await expect(
        card.getByTestId("container-host-needs-attention-kind"),
      ).toHaveCount(0);

      // The count opens the Containers list: every container it has.
      const chip: Locator = page.getByTestId("container-host-hero-containers");
      await expect(chip).toHaveText("7 containers");
      await expect(chip).toHaveAttribute("href", `${hostPath}/containers`);

      await screenshot(page, `${runtime.toLowerCase()}-overview-trouble-1280`);
    });
  }

  test("a row opens its container's page", async ({ page }: { page: Page }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page, DOCKER_PATH);
    await waitForHealth(page, "Unhealthy");

    await attentionCard(page, "container-host-needs-attention")
      .getByTestId("container-host-needs-attention-item")
      .first()
      .getByRole("link")
      .click();

    await expect(page).toHaveURL(
      new RegExp(`${DOCKER_HOST_ID}/containers/shop-worker-1$`),
    );
    await expect(
      page.getByTestId("container-host-container-hero"),
    ).toContainText("Restart loop");
  });

  test("on a phone: the card fits, names whole, no sideways scroll", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openOverview(page, DOCKER_PATH);
    await waitForHealth(page, "Unhealthy");

    const names: Locator = attentionCard(
      page,
      "container-host-needs-attention",
    ).getByTestId("container-host-needs-attention-name");
    await expect(names).toHaveCount(4);
    for (let index: number = 0; index < 4; index++) {
      expect(await isCut(names.nth(index))).toBe(false);
    }

    await expectNoSidewaysScroll(page);
    await screenshot(page, "docker-overview-trouble-390");
  });

  test("dark: the health pill and the card in the dark palette", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page, DOCKER_PATH, "theme=dark");
    await waitForHealth(page, "Unhealthy");

    expect(
      await page.evaluate((): boolean => {
        return document.documentElement.classList.contains("dark");
      }),
    ).toBe(true);
    await expect(
      attentionCard(page, "container-host-needs-attention"),
    ).toBeVisible();
    await screenshot(page, "docker-overview-trouble-dark-1280");
  });

  test("German: the pill, the card and the reasons in German, nothing cut at 1024", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(SMALL_LAPTOP);
    await openOverview(page, DOCKER_PATH, "lang=de");
    await waitForHealth(page, "Unhealthy");

    await expect(page.getByTestId("container-host-health")).toHaveText(
      GERMAN["Unhealthy"]!,
    );
    const card: Locator = attentionCard(page, "container-host-needs-attention");
    await expect(card).toContainText(GERMAN["Needs attention"]!);
    await expect(card).toContainText(
      GERMAN["{{count}} restarts in 15 minutes"]!.replace("{{count}}", "6"),
    );
    await expect(card).toContainText(GERMAN["Stopped reporting"]!);

    await expectNoSidewaysScroll(page);
    await screenshot(page, "docker-overview-trouble-de-1024");
  });

  test("Persian: right to left, the reasons in Persian with Persian digits", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openOverview(page, DOCKER_PATH, "lang=fa");
    await waitForHealth(page, "Unhealthy");

    expect(
      await page.evaluate((): string => {
        return document.documentElement.dir;
      }),
    ).toBe("rtl");
    await expect(page.getByTestId("container-host-health")).toHaveText(
      PERSIAN["Unhealthy"]!,
    );
    const first: Locator = attentionCard(page, "container-host-needs-attention")
      .getByTestId("container-host-needs-attention-item")
      .first();
    const text: string = ((await first.textContent()) || "").replace(
      ISOLATE_MARKS,
      "",
    );
    expect(text).toContain(
      PERSIAN["{{count}} restarts in 15 minutes"]!.replace("{{count}}", "۶"),
    );

    await expectNoSidewaysScroll(page);
    await screenshot(page, "docker-overview-trouble-fa-390");
  });
});

test.describe("the Overview's other hosts", () => {
  test("a calm host: Healthy, and no Needs attention card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page, DOCKER_PATH, "host=calm");
    await waitForHealth(page, "Healthy");

    await expect(
      page.getByTestId("container-host-needs-attention"),
    ).toHaveCount(0);
    await screenshot(page, "docker-overview-calm-1280");
  });

  test("a new host: no health to tell, no count", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page, DOCKER_PATH, "host=empty");

    await expect(page.getByTestId("container-host-health")).toHaveCount(0);
    await expect(
      page.getByTestId("container-host-hero-containers"),
    ).toHaveCount(0);
    await screenshot(page, "docker-overview-empty-1280");
  });

  test("a disconnected agent: Health Unknown in grey, no card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page, DOCKER_PATH, "collector=disconnected");
    await waitForHealth(page, "Unknown");

    await expect(page.getByTestId("container-host-health")).toHaveText(
      "Health Unknown",
    );
    await expect(
      page.getByTestId("container-host-needs-attention"),
    ).toHaveCount(0);
    await screenshot(page, "docker-overview-disconnected-1280");
  });

  test("a read that fails: says so in the card's frame, with Refresh", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page, DOCKER_PATH, "fail=readings");

    const frame: Locator = page.getByTestId(
      "container-host-needs-attention-error",
    );
    await expect(frame).toContainText(
      "The analytics database did not answer in time.",
    );
    await expect(frame.getByRole("button")).toBeVisible();
    await screenshot(page, "docker-overview-read-error-1280");
  });
});

/*
 * ---------------------------------------------------------------------------
 * The Containers list
 * ---------------------------------------------------------------------------
 */
async function openContainers(
  page: Page,
  hostPath: string,
  query: string = "",
): Promise<void> {
  await page.goto(withQuery(`${hostPath}/containers`, query));
  await expect(page.getByText("shop-worker-1").first()).toBeVisible();
}

test.describe("the Containers list", () => {
  test("at a laptop's width: each state with why, restarts toned at their alert's lines", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openContainers(page, DOCKER_PATH);

    const row: (name: string) => Locator = (name: string): Locator => {
      return page.locator("tr").filter({
        has: page.getByRole("link", { name: name, exact: true }),
      });
    };

    await expect(row("shop-worker-1")).toContainText("Restart loop");
    await expect(row("shop-worker-1")).toContainText(
      "6 restarts in 15 minutes",
    );
    await expect(
      row("shop-worker-1").locator('[data-tone="danger"]').first(),
    ).toBeVisible();
    await expect(row("billing-exporter")).toContainText("Stopped reporting");
    await expect(row("shop-migrate-run-8d2f1c9a")).toContainText(
      "Not reporting",
    );
    await expect(row("shop-search-1")).toContainText("Memory 91.4% used");
    await expect(row("shop-checkout-api-1")).toContainText("Running");

    /*
     * Compose made most of them: its project is said, as a column where the
     * table has room, or under the name where it folds.
     */
    await expect(row("shop-worker-1")).toContainText("shop");

    // Every name whole: none cut short.
    const names: Locator = page.locator("tbody tr td:first-child a");
    const count: number = await names.count();
    for (let index: number = 0; index < count; index++) {
      expect(await isCut(names.nth(index))).toBe(false);
    }

    await screenshot(page, "docker-containers-1280");
  });

  test("beside the side menu at 768: the list fits its card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(TABLET);
    await openContainers(page, DOCKER_PATH);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "docker-containers-768");
  });

  test("on a phone: a card a container, no sideways scroll", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openContainers(page, PODMAN_PATH);
    await expect(page.getByText("Restart loop").first()).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "podman-containers-390");
  });

  test("Persian: right to left, every state in Persian", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openContainers(page, DOCKER_PATH, "lang=fa");
    await expect(
      page.getByText(PERSIAN["Restart loop"]!).first(),
    ).toBeVisible();
    await expect(
      page.getByText(PERSIAN["Stopped reporting"]!).first(),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "docker-containers-fa-1280");
  });
});

/*
 * ---------------------------------------------------------------------------
 * A container's page
 * ---------------------------------------------------------------------------
 */
async function openContainer(
  page: Page,
  hostPath: string,
  name: string,
  query: string = "",
): Promise<void> {
  await page.goto(withQuery(`${hostPath}/containers/${name}`, query));
  await expect(page.getByTestId("container-host-container-hero")).toBeVisible();
  await expect(
    page
      .getByTestId("container-host-container-overview")
      .or(page.getByTestId("container-host-container-not-reported")),
  ).toBeVisible();
}

test.describe("a container's page", () => {
  for (const [runtime, hostPath] of [
    ["Docker", DOCKER_PATH],
    ["Podman", PODMAN_PATH],
  ] as Array<[string, string]>) {
    test(`${runtime}: a crash-looping container - its state, why, what it uses, what is open, its alerts`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize(LAPTOP);
      await openContainer(page, hostPath, "shop-worker-1");

      const hero: Locator = page.getByTestId("container-host-container-hero");
      await expect(hero).toContainText("Restart loop");
      await expect(hero).toContainText("Container on");
      await expect(hero).toContainText("shop / worker");

      const attention: Locator = page.getByTestId(
        "container-host-container-attention",
      );
      await expect(attention).toContainText("This container");
      await expect(attention).toContainText("6 restarts in 15 minutes");

      // The count's window: the hero and Needs attention say it is a loop.
      const tiles: Locator = page.getByTestId("container-host-container-tiles");
      await expect(tiles).toContainText("in the last 15 minutes");
      await expect(tiles).not.toContainText("A restart loop");

      // The cards under the tabs line up with the hero above them.
      const [heroBox, attentionBox]: Array<FrameBox> = await boxesInOneFrame([
        hero,
        attention,
      ]);
      expect(Math.abs(heroBox!.x - attentionBox!.x)).toBeLessThan(1);

      // The alert the loop raised, about this container.
      await expect(
        page.getByTestId("container-host-container-open"),
      ).toContainText("Container Restart Loop");

      // The container alerts, with one step to turn the missing ones on.
      const alerts: Locator = page.getByTestId(
        "container-host-container-alerts",
      );
      await expect(alerts).toContainText("Container Restart Loop");
      const turnOn: Locator = alerts
        .getByRole("link")
        .filter({ hasText: "Turn on" });
      await expect(turnOn).toBeVisible();
      expect((await turnOn.getAttribute("href")) || "").toContain(
        `${hostPath}/recommendations`,
      );

      await screenshot(page, `${runtime.toLowerCase()}-container-loop-1280`);
    });
  }

  test("a service that stopped: Stopped reporting, when it last reported, no readings", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openContainer(page, DOCKER_PATH, "billing-exporter");

    const hero: Locator = page.getByTestId("container-host-container-hero");
    await expect(hero).toContainText("Stopped reporting");
    await expect(hero).toContainText("Last reported");
    await expect(
      page.getByTestId("container-host-container-tiles"),
    ).toHaveCount(0);
    await screenshot(page, "docker-container-stopped-1280");
  });

  test("on a phone: the hero, the tiles and the details fit, the image whole", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openContainer(page, DOCKER_PATH, "shop-checkout-api-1");

    await expect(
      page.getByTestId("container-host-container-details"),
    ).toContainText("registry.acme-containers.example/shop/checkout-api:2.4.1");
    await expectNoSidewaysScroll(page);
    await screenshot(page, "docker-container-running-390");
  });

  test("German and Persian: the state and the cards in the reader's language", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openContainer(page, DOCKER_PATH, "shop-worker-1", "lang=de");
    await expect(
      page.getByTestId("container-host-container-hero"),
    ).toContainText(GERMAN["Restart loop"]!);
    await expect(
      page.getByTestId("container-host-container-attention"),
    ).toContainText(GERMAN["This container"]!);
    await screenshot(page, "docker-container-loop-de-1280");

    await openContainer(page, DOCKER_PATH, "shop-worker-1", "lang=fa");
    await expect(
      page.getByTestId("container-host-container-hero"),
    ).toContainText(PERSIAN["Restart loop"]!);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "docker-container-loop-fa-1280");
  });

  test("dark: a container's page in the dark palette", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openContainer(page, PODMAN_PATH, "shop-search-1", "theme=dark");
    await expect(
      page.getByTestId("container-host-container-attention"),
    ).toContainText("Memory 91.4% used");
    await screenshot(page, "podman-container-memory-dark-1280");
  });

  test("a container nothing reported: says so, and the hero says where it would run", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openContainer(page, DOCKER_PATH, "ghost");
    await expect(
      page.getByTestId("container-host-container-not-reported"),
    ).toBeVisible();
    await expect(
      page.getByTestId("container-host-container-hero"),
    ).toContainText("Container on");
  });

  test("a read that fails: in its own frame, with Try again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto(
      withQuery(`${DOCKER_PATH}/containers/shop-worker-1`, "fail=readings"),
    );
    const error: Locator = page.getByTestId(
      "container-host-container-read-error",
    );
    await expect(error).toContainText("Couldn't load this container");
    await expect(
      error.getByRole("button", { name: /Try again/ }),
    ).toBeVisible();
    await screenshot(page, "docker-container-read-error-1280");
  });
});

test.describe("the fixture's reads", () => {
  test("the Overview reads its containers once each, for its own runtime", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page, PODMAN_PATH);
    await waitForHealth(page, "Unhealthy");

    const fixture: Recorded = await page.evaluate((): Recorded => {
      return (window as unknown as { __containerHostPagesFixture: Recorded })
        .__containerHostPagesFixture;
    });
    const readings: Array<{ query: Record<string, unknown> }> =
      fixture.listRequests.filter(
        (request: { query: Record<string, unknown> }): boolean => {
          return String(request.query?.["name"] || "").startsWith("container.");
        },
      );
    expect(readings.length).toBeGreaterThanOrEqual(5);
    for (const request of readings) {
      const attributes: Record<string, string> = (request.query["attributes"] ||
        {}) as Record<string, string>;
      expect(attributes["resource.container.runtime"]).toBe("podman");
    }
    expect(
      fixture.aggregateRequests.some(
        (request: { name: string | null }): boolean => {
          return request.name === "container.restarts.increase";
        },
      ),
    ).toBe(true);
    expect(
      fixture.listRequests.some((request: { modelName: string }): boolean => {
        return request.modelName === "PodmanResource";
      }),
    ).toBe(true);
  });
});

// Keep the boxes helper used: the phone's hero name and its controls.
test("the hero's name keeps its room beside the controls at 1280", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize(LAPTOP);
  await openOverview(page, DOCKER_PATH);
  const identity: Box = await boxOf(page.getByTestId("resource-hero-identity"));
  const controls: Box = await boxOf(page.getByTestId("resource-hero-controls"));
  expect(identity.width).toBeGreaterThan(0);
  expect(controls.width).toBeGreaterThan(0);
});
