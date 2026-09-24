import {
  BrowserContext,
  expect,
  Locator,
  Page,
  Request as PlaywrightRequest,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Renders the real Security Events and Security Events > Connections pages
 * of a project that has neither sent nor connected anything, against the
 * offline fixture (Fixture/Fixture.js). The layout, both pages, the
 * Connections table and the Add connection form are production components;
 * only the data boundary and the signed-in user are synthetic. Every test
 * pins the browser clock to NOW and puts up a network fence that aborts
 * anything leaving the fixture server, and fails on an uncaught page error,
 * on a request the fixture does not model and on any request the fence had
 * to abort. Setup guide links open the docs in a new tab; those tabs have a
 * fence of their own that answers the one docs page each link names and
 * fails the test on anything else.
 */

const PORT: string = "4232";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
// The fixture's ?latest=old event is dated before this.
const NOW: Date = new Date("2026-09-22T12:00:00.000Z");

const DASHBOARD: string = `/dashboard/${PROJECT_ID}`;
const EVENTS_PATH: string = `${DASHBOARD}/security-events`;
const CONNECTIONS_PATH: string = `${EVENTS_PATH}/connections`;
const DOCUMENTATION_PATH: string = `${EVENTS_PATH}/documentation`;

/*
 * server.js sets HOST to this made-up domain, and DOCS_URL is built from
 * it, so the setup guides point where they would on a real install.
 */
const DOCS_URL: string = "https://oneuptime.acme-commerce.example/docs";

const CONNECTIONS_ID: string = "security-event-connections-empty-state";
const EVENTS_ID: string = "security-events-empty-state";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/security-events-empty-states-ui",
);

/*
 * The connector catalog, in its order. Written out rather than imported so
 * a reordered, renamed or re-categorised catalog fails here, where the
 * tiles are seen, and not only in the unit tests.
 */
interface Provider {
  value: string;
  title: string;
  category: string;
  docsSlug: string;
}

const PROVIDERS: ReadonlyArray<Provider> = [
  {
    value: "microsoft-sentinel",
    title: "Microsoft Sentinel",
    category: "SIEM",
    docsSlug: "microsoft-sentinel",
  },
  {
    value: "microsoft-defender-xdr",
    title: "Microsoft Defender XDR",
    category: "EDR / XDR",
    docsSlug: "microsoft-defender-xdr",
  },
  {
    value: "crowdstrike-falcon",
    title: "CrowdStrike Falcon",
    category: "EDR / XDR",
    docsSlug: "crowdstrike-falcon",
  },
  {
    value: "splunk",
    title: "Splunk Enterprise Security",
    category: "SIEM",
    docsSlug: "splunk",
  },
  {
    value: "elastic-security",
    title: "Elastic Security",
    category: "SIEM",
    docsSlug: "elastic-security",
  },
  {
    value: "aws-security-hub",
    title: "AWS Security Hub",
    category: "Cloud security",
    docsSlug: "aws-security-hub",
  },
  {
    value: "okta",
    title: "Okta System Log",
    category: "Identity",
    docsSlug: "okta",
  },
  {
    value: "google-secops",
    title: "Google SecOps",
    category: "SIEM",
    docsSlug: "google-secops",
  },
];

function docsUrl(provider: Provider): string {
  return `${DOCS_URL}/integrations/${provider.docsSlug}`;
}

function provider(value: string): Provider {
  const found: Provider | undefined = PROVIDERS.find(
    (candidate: Provider): boolean => {
      return candidate.value === value;
    },
  );
  if (!found) {
    throw new Error(`No provider ${value} in the catalog`);
  }
  return found;
}

const SENTINEL: Provider = provider("microsoft-sentinel");
const DEFENDER: Provider = provider("microsoft-defender-xdr");
const CROWDSTRIKE: Provider = provider("crowdstrike-falcon");
const SPLUNK: Provider = provider("splunk");
const OKTA: Provider = provider("okta");

const DOCS_GUIDE_URLS: ReadonlyArray<string> = PROVIDERS.map(
  (item: Provider): string => {
    return docsUrl(item);
  },
);

// What a docs tab is answered with. data: favicon: no second request.
const DOCS_STUB_TITLE: string = "Setup guide (stub)";
const DOCS_STUB_HTML: string = `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>${DOCS_STUB_TITLE}</title></head><body>Docs stub</body></html>`;

const CONNECTIONS_HEADING: string = "No security event connections yet";
const CONNECTIONS_DESCRIPTION: string =
  "Connect a SIEM, EDR / XDR, cloud security or identity product and OneUptime polls it on a schedule, importing each new alert, finding or log event as an OCSF security event.";
// PermissionGate's sentence for a member who holds Security Viewer only.
const CREATE_DISABLED_REASON: string =
  "You do not have permission to create this Security Event Connection. You need one of these permissions: Project Owner, Project Admin, Security Admin.";

const REQUIREMENTS: ReadonlyArray<{ id: string; title: string }> = [
  { id: "credential", title: "A read-only credential" },
  { id: "worker", title: "A running OneUptime worker" },
];

const EVENTS_HEADING: string = "No security events yet";
const EVENTS_DESCRIPTION: string =
  "Events show up here as soon as a source starts sending. Every event is normalized to OCSF, whatever format it arrives in.";
const INGEST_METHOD: string = "POST";
const INGEST_PATH: string = "/security-events/v1/ingest";
const CATEGORIES_LINE: string = "SIEM · EDR / XDR · Cloud security · Identity";

interface WayIn {
  id: string;
  title: string;
  description: string;
  action: string;
}

const WAYS_IN: ReadonlyArray<WayIn> = [
  {
    id: "send",
    title: "Send events to OneUptime",
    description:
      "POST JSON from a SIEM, a SOAR webhook, a log forwarder or any other source.",
    action: "Read the setup guide",
  },
  {
    id: "connect",
    title: "Pull from a security product",
    description:
      "OneUptime polls Microsoft Sentinel, CrowdStrike, Splunk and more on a schedule.",
    action: "Connect a security product",
  },
];

// Computed colours the assertions compare against.
const WHITE_RGB: string = "rgb(255, 255, 255)";
const GRAY_900_RGB: string = "rgb(17, 24, 39)";
const GRAY_200_RGB: string = "rgb(229, 231, 235)";
const INDIGO_50_RGB: string = "rgb(238, 242, 255)";
const INDIGO_300_RGB: string = "rgb(165, 180, 252)";
const INDIGO_400_RGB: string = "rgb(129, 140, 248)";
const INDIGO_500_RGB: string = "rgb(99, 102, 241)";
const INDIGO_600_RGB: string = "rgb(79, 70, 229)";
const TRANSPARENT: string = "rgba(0, 0, 0, 0)";
// Theme.css's dark tint of bg-indigo-50: indigo-900 at partial opacity.
const DARK_INDIGO_TINT: RegExp = /^rgba\(49, 46, 129, 0\.\d+\)$/;

// WCAG AA for body text.
const MIN_CONTRAST: number = 4.5;

interface RecordedModelRequest {
  modelName: string;
  analytics?: boolean;
  query?: Record<string, unknown> | null;
  skip?: number;
  limit?: number;
}

interface RecordedApiRequest {
  method: string;
  url: string;
}

interface RecordedWrite {
  modelName: string;
  data?: Record<string, unknown> | null;
}

interface UnhandledRequest {
  kind: string;
  modelName?: string;
  method?: string;
  url?: string;
}

interface FixtureState {
  role: string;
  latest: string;
  listRequests: Array<RecordedModelRequest>;
  countRequests: Array<RecordedModelRequest>;
  aggregateRequests: Array<RecordedModelRequest>;
  apiRequests: Array<RecordedApiRequest>;
  creates: Array<RecordedWrite>;
  unhandled: Array<UnhandledRequest>;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

interface OpenOptions {
  role?: "owner" | "viewer" | undefined;
  theme?: "light" | "dark" | undefined;
  latest?: "none" | "pending" | "old" | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

interface TileLayout {
  provider: string;
  box: Box;
  nameLines: number;
  nameClipped: boolean;
}

interface Paint {
  element: string;
  background: string;
  color: string;
  width: number;
  height: number;
}

interface ContrastFailure {
  text: string;
  color: string;
  background: string;
  ratio: number;
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

// Where on a tile a click lands. "blank" is the tile's bottom-right padding.
type TileSpot = "category" | "blank" | "badge" | "plus" | "name";

const TILE_SPOTS: ReadonlyArray<TileSpot> = [
  "category",
  "blank",
  "badge",
  "plus",
  "name",
];

/*
 * Every test renders at 2x, so the screenshots are sharp enough for a PR.
 * Actions and locator.evaluate wait without limit by default; a selector
 * that matches nothing should fail on its own line, not as a test timeout.
 */
test.use({ deviceScaleFactor: 2, actionTimeout: 15000 });

const pageErrors: Map<Page, Array<string>> = new Map();
const abortedRequests: Map<Page, Array<string>> = new Map();
const docsNavigations: Map<Page, Array<string>> = new Map();

test.beforeEach(
  async ({ page, context }: { page: Page; context: BrowserContext }) => {
    const errors: Array<string> = [];
    const aborted: Array<string> = [];
    const docs: Array<string> = [];
    pageErrors.set(page, errors);
    abortedRequests.set(page, aborted);
    docsNavigations.set(page, docs);
    page.on("pageerror", (error: Error) => {
      errors.push(error.message);
    });

    // Nothing the page asks for may leave the fixture server.
    await page.route("**/*", async (route: PlaywrightRoute) => {
      const target: URL = new URL(route.request().url());
      if (target.hostname === "127.0.0.1" && target.port === PORT) {
        await route.continue();
        return;
      }
      aborted.push(route.request().url());
      await route.abort();
    });

    /*
     * page.route never sees a popup's requests: a new tab is a page of its
     * own, so it falls through to the context's routes (a page route wins
     * over a context route, so the page above never reaches this one). A
     * Setup guide link opens its docs page in a new tab. That one document
     * is answered here with a stub, so nothing leaves the machine and the
     * tab really lands on the docs URL, and it is recorded for the test to
     * claim. Anything else a new tab asks for is aborted and fails the test
     * like the page's own fence.
     */
    await context.route("**/*", async (route: PlaywrightRoute) => {
      const request: PlaywrightRequest = route.request();
      const url: string = request.url();
      if (request.isNavigationRequest() && DOCS_GUIDE_URLS.includes(url)) {
        docs.push(url);
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: DOCS_STUB_HTML,
        });
        return;
      }
      aborted.push(url);
      await route.abort();
    });
  },
);

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    abortedRequests.get(page) || [],
    "requests that left the fixture server",
  ).toEqual([]);
  expect(
    docsNavigations.get(page) || [],
    "docs tabs no test asked for",
  ).toEqual([]);

  const hasFixture: boolean = await page
    .evaluate((): boolean => {
      return Boolean(
        (window as unknown as { __securityEventsEmptyStatesFixture?: unknown })
          .__securityEventsEmptyStatesFixture,
      );
    })
    .catch((): boolean => {
      return false;
    });
  if (hasFixture) {
    expect(
      (await fixture(page)).unhandled,
      "requests the fixture does not model",
    ).toEqual([]);
  }
});

/*
 * ---------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------
 */

async function open(
  page: Page,
  pathname: string,
  options: OpenOptions = {},
): Promise<void> {
  if (options.width) {
    await page.setViewportSize({
      width: options.width,
      height: options.height || 1000,
    });
  }
  // The histogram and the ?latest=old event are relative to NOW.
  await page.clock.setFixedTime(NOW);
  const params: URLSearchParams = new URLSearchParams();
  if (options.role && options.role !== "owner") {
    params.set("role", options.role);
  }
  if (options.theme === "dark") {
    params.set("theme", "dark");
  }
  if (options.latest && options.latest !== "none") {
    params.set("latest", options.latest);
  }
  const query: string = params.toString();
  await page.goto(query ? `${pathname}?${query}` : pathname);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  /*
   * The layout tests measure text, so they must measure it in Inter, the
   * font production ships, rather than in whatever the machine falls back to
   * while it loads (font-display: swap). Loading it by name also fails here,
   * rather than as a wrapped name, if the fixture stops serving it.
   */
  const interFaces: number = await page.evaluate(async (): Promise<number> => {
    const faces: Array<FontFace> = await document.fonts.load("600 14px Inter");
    await document.fonts.ready;
    return faces.length;
  });
  expect(interFaces, "Inter faces loaded").toBeGreaterThan(0);
}

async function openConnections(
  page: Page,
  options: OpenOptions = {},
): Promise<void> {
  await open(page, CONNECTIONS_PATH, options);
  await expect(connectionsEmptyState(page)).toBeVisible({ timeout: 30000 });
}

async function openEvents(
  page: Page,
  options: OpenOptions = {},
): Promise<void> {
  await open(page, EVENTS_PATH, options);
  await expect(eventsEmptyState(page)).toBeVisible({ timeout: 30000 });
}

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (
          window as unknown as {
            __securityEventsEmptyStatesFixture: FixtureState;
          }
        ).__securityEventsEmptyStatesFixture,
      ),
    ) as FixtureState;
  });
}

// Hands the docs tabs opened so far to the test, which must expect them.
function claimDocsNavigations(page: Page): Array<string> {
  const docs: Array<string> = docsNavigations.get(page) || [];
  const claimed: Array<string> = [...docs];
  docs.length = 0;
  return claimed;
}

interface ScreenshotOptions {
  fullPage?: boolean | undefined;
  // Leave the pointer where it is, e.g. on a hovered tile.
  keepPointer?: boolean | undefined;
  // Capture only this element, padded, instead of the page.
  clip?: Locator | undefined;
}

async function screenshot(
  page: Page,
  name: string,
  options: ScreenshotOptions = {},
): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  if (!options.keepPointer) {
    await page.mouse.move(0, 0);
  }
  const file: string = path.join(SCREENSHOTS, `${name}-synthetic.png`);
  if (options.clip) {
    const box: Box = await viewportBox(options.clip);
    const padding: number = 16;
    await page.screenshot({
      path: file,
      clip: {
        x: Math.max(0, box.x - padding),
        y: Math.max(0, box.y - padding),
        width: box.width + 2 * padding,
        height: box.height + 2 * padding,
      },
      animations: "disabled",
    });
    return;
  }
  await page.screenshot({
    path: file,
    fullPage: options.fullPage !== false,
    animations: "disabled",
  });
}

// A bounding box in document coordinates (independent of scroll).
async function documentBox(locator: Locator): Promise<Box> {
  return locator.evaluate((element: Element): Box => {
    const rect: DOMRect = element.getBoundingClientRect();
    return {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
    };
  });
}

// A bounding box in viewport coordinates, for clips and mouse positions.
async function viewportBox(locator: Locator): Promise<Box> {
  return locator.evaluate((element: Element): Box => {
    const rect: DOMRect = element.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
  });
}

function centreX(box: Box): number {
  return box.x + box.width / 2;
}

async function expectAbove(
  upper: Locator,
  lower: Locator,
  message: string,
): Promise<void> {
  const upperBox: Box = await documentBox(upper);
  const lowerBox: Box = await documentBox(lower);
  expect(upperBox.y + upperBox.height, message).toBeLessThanOrEqual(
    lowerBox.y + 1,
  );
}

async function expectInside(
  inner: Locator,
  outer: Locator,
  message: string,
): Promise<void> {
  const innerBox: Box = await documentBox(inner);
  const outerBox: Box = await documentBox(outer);
  expect(innerBox.x, `${message}: left edge`).toBeGreaterThanOrEqual(
    outerBox.x - 1,
  );
  expect(
    innerBox.x + innerBox.width,
    `${message}: right edge`,
  ).toBeLessThanOrEqual(outerBox.x + outerBox.width + 1);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow: number = await page.evaluate((): number => {
    return document.documentElement.scrollWidth - window.innerWidth;
  });
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

async function backgroundColor(locator: Locator): Promise<string> {
  return locator.evaluate((element: Element): string => {
    return getComputedStyle(element).backgroundColor;
  });
}

async function textColor(locator: Locator): Promise<string> {
  return locator.evaluate((element: Element): string => {
    return getComputedStyle(element).color;
  });
}

async function borderColor(locator: Locator): Promise<string> {
  return locator.evaluate((element: Element): string => {
    return getComputedStyle(element).borderTopColor;
  });
}

// The ring a stretched button draws on its ::after, which covers its card.
async function overlayRing(button: Locator): Promise<string> {
  return button.evaluate((element: Element): string => {
    return getComputedStyle(element, "::after").boxShadow;
  });
}

async function ownRing(locator: Locator): Promise<string> {
  return locator.evaluate((element: Element): string => {
    return getComputedStyle(element).boxShadow;
  });
}

// The nearest ancestor that paints an opaque background.
async function surfaceOf(locator: Locator): Promise<string> {
  return locator.evaluate((element: Element): string => {
    let current: Element | null = element.parentElement;
    while (current) {
      const background: string = getComputedStyle(current).backgroundColor;
      const alpha: RegExpMatchArray | null = background.match(
        /rgba\([^)]*,\s*([\d.]+)\)$/,
      );
      if (background.startsWith("rgb(") || (alpha && Number(alpha[1]) >= 1)) {
        return background;
      }
      current = current.parentElement;
    }
    return "rgb(255, 255, 255)";
  });
}

// Relative luminance of an "rgb(r, g, b)" colour, 0 (black) to 1 (white).
function luminance(rgb: string): number {
  const channels: Array<number> = (rgb.match(/\d+(\.\d+)?/g) || [])
    .slice(0, 3)
    .map((value: string): number => {
      const channel: number = Number(value) / 255;
      return channel <= 0.03928
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
  return (
    0.2126 * (channels[0] || 0) +
    0.7152 * (channels[1] || 0) +
    0.0722 * (channels[2] || 0)
  );
}

/*
 * Every piece of visible text in `scope` whose colour does not reach
 * `minimum` contrast against the opaque background behind it. Hidden and
 * screen-reader-only text is skipped; semi-transparent tints are looked
 * through to the surface under them.
 */
async function lowContrastText(
  scope: Locator,
  minimum: number,
): Promise<Array<ContrastFailure>> {
  return scope.evaluate(
    (root: Element, minimumRatio: number): Array<ContrastFailure> => {
      const parse: (value: string) => Rgba = (value: string): Rgba => {
        const parts: Array<number> = (value.match(/[\d.]+/g) || []).map(
          (part: string): number => {
            return Number(part);
          },
        );
        return {
          r: parts[0] || 0,
          g: parts[1] || 0,
          b: parts[2] || 0,
          a: parts.length > 3 ? (parts[3] as number) : 1,
        };
      };
      const linear: (value: number) => number = (value: number): number => {
        const channel: number = value / 255;
        return channel <= 0.03928
          ? channel / 12.92
          : Math.pow((channel + 0.055) / 1.055, 2.4);
      };
      const lum: (colour: Rgba) => number = (colour: Rgba): number => {
        return (
          0.2126 * linear(colour.r) +
          0.7152 * linear(colour.g) +
          0.0722 * linear(colour.b)
        );
      };
      const surface: (element: Element) => string = (
        element: Element,
      ): string => {
        let current: Element | null = element;
        while (current) {
          const background: string = getComputedStyle(current).backgroundColor;
          if (parse(background).a >= 0.99) {
            return background;
          }
          current = current.parentElement;
        }
        return "rgb(255, 255, 255)";
      };

      const failures: Array<ContrastFailure> = [];
      const elements: Array<Element> = [
        root,
        ...Array.from(root.querySelectorAll("*")),
      ];
      for (const element of elements) {
        const ownText: string = Array.from(element.childNodes)
          .filter((node: ChildNode): boolean => {
            return node.nodeType === Node.TEXT_NODE;
          })
          .map((node: ChildNode): string => {
            return node.textContent || "";
          })
          .join("")
          .trim();
        if (!ownText || element.closest("[aria-hidden='true'], .sr-only")) {
          continue;
        }
        const rect: DOMRect = element.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) {
          continue;
        }
        const color: string = getComputedStyle(element).color;
        const background: string = surface(element);
        const light: number = Math.max(
          lum(parse(color)),
          lum(parse(background)),
        );
        const dark: number = Math.min(
          lum(parse(color)),
          lum(parse(background)),
        );
        const ratio: number = (light + 0.05) / (dark + 0.05);
        if (ratio < minimumRatio) {
          failures.push({
            text: ownText,
            color,
            background,
            ratio: Math.round(ratio * 100) / 100,
          });
        }
      }
      return failures;
    },
    minimum,
  );
}

// The painted colours of `scope` and everything in it.
async function paintOf(scope: Locator): Promise<Array<Paint>> {
  return scope.evaluate((root: Element): Array<Paint> => {
    return [root, ...Array.from(root.querySelectorAll("*"))].map(
      (element: Element): Paint => {
        const style: CSSStyleDeclaration = getComputedStyle(element);
        const rect: DOMRect = element.getBoundingClientRect();
        return {
          element: `${element.tagName.toLowerCase()}.${String(
            element.getAttribute("class") || "",
          ).slice(0, 60)}`,
          background: style.backgroundColor,
          color: style.color,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      },
    );
  });
}

// What has keyboard focus, named the way the Tab-order tests compare it.
async function focusedStop(page: Page): Promise<string> {
  return page.evaluate((): string => {
    const element: Element | null = document.activeElement;
    if (!element || element === document.body) {
      return "body";
    }
    const tile: string | null = element.getAttribute("data-provider-tile");
    if (tile) {
      return `tile:${tile}`;
    }
    if (element.tagName === "A") {
      return `link:${element.getAttribute("href") || ""}`;
    }
    return `${element.tagName.toLowerCase()}:${(
      element.textContent || ""
    ).trim()}`;
  });
}

/*
 * ------------------------------- Connections -------------------------------
 */

function connectionsEmptyState(page: Page): Locator {
  return page.locator(`#${CONNECTIONS_ID}`);
}

function connectionsCard(page: Page): Locator {
  return page.getByTestId("card").filter({
    has: page.getByRole("heading", {
      level: 2,
      name: "Security Event Connections",
      exact: true,
    }),
  });
}

function heroAddConnection(page: Page): Locator {
  return page.getByTestId(`${CONNECTIONS_ID}-add-connection`);
}

// The Add connection button in the table card's own header.
function headerAddConnection(page: Page): Locator {
  return connectionsCard(page)
    .getByTestId("card-button")
    .filter({ hasText: "Add connection" });
}

function providersSection(page: Page): Locator {
  return page.locator(`#${CONNECTIONS_ID}-providers`);
}

function requirementsSection(page: Page): Locator {
  return page.locator(`#${CONNECTIONS_ID}-requirements`);
}

function tiles(page: Page): Locator {
  return connectionsEmptyState(page).locator(
    `li[data-testid^='${CONNECTIONS_ID}-provider-']`,
  );
}

function tile(page: Page, item: Provider): Locator {
  return page.getByTestId(`${CONNECTIONS_ID}-provider-${item.value}`);
}

function tileButton(page: Page, item: Provider): Locator {
  return tile(page, item).locator(`button[data-provider-tile='${item.value}']`);
}

function guideLink(page: Page, item: Provider): Locator {
  return tile(page, item).getByRole("link");
}

function tileCategory(page: Page, item: Provider): Locator {
  return page.locator(`#${CONNECTIONS_ID}-provider-${item.value}-category`);
}

// The badge's icon (the tile's first <svg>) and the plus at its end.
function tileIcon(page: Page, item: Provider): Locator {
  return tile(page, item).locator("svg").first();
}

function tileBadge(page: Page, item: Provider): Locator {
  return tile(page, item).locator(":scope > div").first();
}

function tilePlus(page: Page, item: Provider): Locator {
  return tile(page, item).locator(":scope > div").nth(2).locator("svg");
}

function addConnectionDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Add connection", exact: true });
}

function providerOption(page: Page, item: Provider): Locator {
  return addConnectionDialog(page).getByTestId(
    `card-select-option-${item.value}`,
  );
}

function checkedOptions(page: Page): Locator {
  return addConnectionDialog(page).locator(
    "[role='radio'][aria-checked='true']",
  );
}

function activeStep(page: Page): Locator {
  return addConnectionDialog(page).locator("[aria-current='step']");
}

async function cancelDialog(page: Page): Promise<void> {
  await addConnectionDialog(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

// The dialog is open on its first step with `item` (or nothing) chosen.
async function expectProviderStep(
  page: Page,
  item: Provider | null,
): Promise<void> {
  const dialog: Locator = addConnectionDialog(page);
  await expect(dialog).toBeVisible();
  await expect(activeStep(page)).toHaveText("Provider");
  await expect(dialog.getByRole("radio")).toHaveCount(PROVIDERS.length);
  await expect(
    dialog.getByRole("button", { name: "Next", exact: true }),
  ).toBeVisible();
  if (!item) {
    await expect(checkedOptions(page)).toHaveCount(0);
    return;
  }
  await expect(checkedOptions(page)).toHaveCount(1);
  await expect(providerOption(page, item)).toHaveAttribute(
    "aria-checked",
    "true",
  );
  for (const other of PROVIDERS) {
    if (other.value !== item.value) {
      await expect(providerOption(page, other)).toHaveAttribute(
        "aria-checked",
        "false",
      );
    }
  }
}

// A point on the tile, relative to its top-left corner.
async function tileSpot(
  page: Page,
  item: Provider,
  spot: TileSpot,
): Promise<Point> {
  return tile(page, item).evaluate((element: Element, where: string): Point => {
    const tileRect: DOMRect = element.getBoundingClientRect();
    const centre: (target: Element | null) => Point = (
      target: Element | null,
    ): Point => {
      if (!target) {
        throw new Error(`No ${where} on the tile`);
      }
      const rect: DOMRect = target.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2 - tileRect.left,
        y: rect.top + rect.height / 2 - tileRect.top,
      };
    };
    if (where === "category") {
      return centre(element.querySelector("[id$='-category']"));
    }
    if (where === "badge") {
      return centre(element.children[0] || null);
    }
    if (where === "plus") {
      return centre(element.children[2] || null);
    }
    if (where === "name") {
      return centre(
        element.querySelector("[data-provider-tile]") ||
          element.querySelector("p"),
      );
    }
    return { x: tileRect.width - 8, y: tileRect.height - 8 };
  }, spot);
}

/*
 * What a click at a spot of the tile hits, in page terms: the tile's
 * stretched button (its ::after covers the tile), the guide link, or
 * something else.
 */
async function hitAt(page: Page, item: Provider, spot: Point): Promise<string> {
  return tile(page, item).evaluate((element: Element, point: Point): string => {
    const rect: DOMRect = element.getBoundingClientRect();
    const hit: Element | null = document.elementFromPoint(
      rect.left + point.x,
      rect.top + point.y,
    );
    if (!hit) {
      return "nothing";
    }
    const button: Element | null = hit.closest("[data-provider-tile]");
    if (button) {
      return `tile:${button.getAttribute("data-provider-tile")}`;
    }
    if (hit.closest("a")) {
      return "link";
    }
    return `${hit.tagName.toLowerCase()}`;
  }, spot);
}

async function tileLayouts(page: Page): Promise<Array<TileLayout>> {
  return tiles(page).evaluateAll(
    (elements: Array<Element>): Array<TileLayout> => {
      return elements.map((element: Element): TileLayout => {
        const rect: DOMRect = element.getBoundingClientRect();
        const name: HTMLElement = (element.querySelector(
          "[data-provider-tile]",
        ) || element.querySelector("p")) as HTMLElement;
        const lineHeight: number = parseFloat(
          getComputedStyle(name).lineHeight,
        );
        return {
          provider: (element.getAttribute("data-testid") || "").replace(
            /^.*-provider-/,
            "",
          ),
          box: {
            x: rect.left + window.scrollX,
            y: rect.top + window.scrollY,
            width: rect.width,
            height: rect.height,
          },
          nameLines: Math.round(
            name.getBoundingClientRect().height / lineHeight,
          ),
          nameClipped: name.scrollWidth > name.clientWidth + 1,
        };
      });
    },
  );
}

interface NameFit {
  provider: string;
  // The name's width on one line, in the tile's own font.
  textWidth: number;
  // The width the tile gives the name.
  columnWidth: number;
}

/*
 * Each tile's name measured on one line against the column it sits in, in
 * this browser's own text metrics. Only the visible title is measured: the
 * button also holds a screen-reader-only "Connect " that takes no space.
 */
async function nameFits(page: Page): Promise<Array<NameFit>> {
  return tiles(page).evaluateAll((elements: Array<Element>): Array<NameFit> => {
    return elements.map((element: Element): NameFit => {
      const name: HTMLElement = (element.querySelector(
        "[data-provider-tile]",
      ) || element.querySelector("p")) as HTMLElement;
      const title: string = Array.from(name.childNodes)
        .filter((node: ChildNode): boolean => {
          return node.nodeType === Node.TEXT_NODE;
        })
        .map((node: ChildNode): string => {
          return node.textContent || "";
        })
        .join("")
        .trim();
      const style: CSSStyleDeclaration = getComputedStyle(name);
      const probe: HTMLSpanElement = document.createElement("span");
      probe.style.font = style.font;
      probe.style.letterSpacing = style.letterSpacing;
      probe.style.whiteSpace = "nowrap";
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      probe.textContent = title;
      document.body.appendChild(probe);
      const textWidth: number = probe.getBoundingClientRect().width;
      probe.remove();
      return {
        provider: (element.getAttribute("data-testid") || "").replace(
          /^.*-provider-/,
          "",
        ),
        textWidth,
        columnWidth: (name.parentElement as HTMLElement).getBoundingClientRect()
          .width,
      };
    });
  });
}

// Tiles grouped into rows by their top edge, top to bottom.
function rowsOf(layouts: Array<TileLayout>): Array<Array<TileLayout>> {
  const rows: Map<number, Array<TileLayout>> = new Map();
  for (const layout of layouts) {
    const top: number = Math.round(layout.box.y);
    rows.set(top, [...(rows.get(top) || []), layout]);
  }
  return Array.from(rows.keys())
    .sort((a: number, b: number): number => {
      return a - b;
    })
    .map((top: number): Array<TileLayout> => {
      return rows.get(top) || [];
    });
}

// What the tiles look like structurally, so every tile can be compared.
async function tileShapes(page: Page): Promise<Array<string>> {
  return tiles(page).evaluateAll((elements: Array<Element>): Array<string> => {
    return elements.map((element: Element): string => {
      const children: Array<string> = Array.from(element.children).map(
        (child: Element): string => {
          return `${child.tagName}.${child.getAttribute("class") || ""}[${
            child.querySelectorAll("svg").length
          }svg]`;
        },
      );
      return `${element.getAttribute("class") || ""} > ${children.join(" + ")}`;
    });
  });
}

/*
 * -------------------------------- Events ----------------------------------
 */

function eventsEmptyState(page: Page): Locator {
  return page.locator(`#${EVENTS_ID}`);
}

// The Security Events list card: TelemetryViewer's bordered list column.
function eventsListCard(page: Page): Locator {
  return page.getByTestId("telemetry-viewer-list");
}

// The row (md up) or column (below md) holding the facet sidebar and list.
function eventsMainArea(page: Page): Locator {
  return page.getByTestId("telemetry-viewer-main-area");
}

// Below md the facet sidebar is folded behind this toggle.
function filtersToggle(page: Page): Locator {
  return page.getByTestId("telemetry-viewer-filters-toggle");
}

// The facet sidebar, found through the toggle's aria-controls.
async function filtersSidebar(page: Page): Promise<Locator> {
  const id: string | null =
    await filtersToggle(page).getAttribute("aria-controls");
  expect(id, "the Filters toggle names the sidebar").toBeTruthy();
  // useId's ids contain colons, so match the attribute, not an #id selector.
  return page.locator(`[id="${id}"]`);
}

function wayInCard(page: Page, id: string): Locator {
  return page.getByTestId(`${EVENTS_ID}-${id}`);
}

function setupGuideButton(page: Page): Locator {
  return page.getByTestId(`${EVENTS_ID}-setup-guide`);
}

function connectButton(page: Page): Locator {
  return page.getByTestId(`${EVENTS_ID}-connections`);
}

function ingestEndpoint(page: Page): Locator {
  return page.getByTestId(`${EVENTS_ID}-ingest-endpoint`);
}

function noResults(page: Page): Locator {
  return page.locator("#security-events-no-results");
}

// The card's description paragraph, where a click should still count.
function wayInDescription(page: Page, id: string): Locator {
  return wayInCard(page, id).locator("p").first();
}

/*
 * The centre of `target`, relative to the way-in card `id`. The card's
 * stretched button covers the description and the categories line, so
 * Playwright refuses to click them directly ("intercepts pointer events");
 * clicking the card at that spot is what a pointer there really does, and
 * eventsHitAt() proves the overlay is what sits under it.
 */
async function spotOnWayIn(
  page: Page,
  id: string,
  target: Locator,
): Promise<Point> {
  const cardBox: Box = await viewportBox(wayInCard(page, id));
  const box: Box = await viewportBox(target);
  return {
    x: box.x + box.width / 2 - cardBox.x,
    y: box.y + box.height / 2 - cardBox.y,
  };
}

async function clickWayInAt(
  page: Page,
  id: string,
  target: Locator,
): Promise<void> {
  await wayInCard(page, id).scrollIntoViewIfNeeded();
  await wayInCard(page, id).click({
    position: await spotOnWayIn(page, id, target),
  });
}

/*
 * The Security Events page writes its time range into the query string
 * (?range=Past+1+Day), so compare paths, not whole URLs.
 */
async function expectPath(page: Page, pathname: string): Promise<void> {
  await expect
    .poll((): string => {
      return new URL(page.url()).pathname;
    })
    .toBe(pathname);
}

// What a click at the centre of `locator` hits in the events empty state.
async function eventsHitAt(locator: Locator): Promise<string> {
  return locator.evaluate((element: Element): string => {
    const rect: DOMRect = element.getBoundingClientRect();
    const hit: Element | null = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    if (!hit) {
      return "nothing";
    }
    if (hit.closest("code")) {
      return "code";
    }
    const button: Element | null = hit.closest("button");
    return button
      ? `button:${button.getAttribute("data-testid") || ""}`
      : hit.tagName.toLowerCase();
  });
}

/*
 * ---------------------------------------------------------------------------
 * Connections: what is on the page
 * ---------------------------------------------------------------------------
 */

/*
 * The Connections empty state replaced a stack of differently aligned
 * blocks (icon and paragraph, button, grey requirements box, docs cards)
 * with a centred header, one tile per product and what a connection needs.
 * These tests hold where it sits, what it says and what it no longer has.
 */
test.describe("connections empty state", () => {
  test("sits inside the table card, above its Refresh? and pagination", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openConnections(page);
    const tableCard: Locator = connectionsCard(page);
    await expect(tableCard).toHaveCount(1);

    // Rendered by the table as its no-items message, in the body cell.
    await expect(tableCard.locator(`td #${CONNECTIONS_ID}`)).toHaveCount(1);
    const refresh: Locator = tableCard.getByTestId("refresh-button");
    await expect(refresh).toHaveText("Refresh?");
    const summary: Locator = tableCard.getByTestId("pagination-summary");
    await expect(summary).toHaveText("No security event connections");

    await expectAbove(
      tableCard.getByTestId("card-details-heading"),
      connectionsEmptyState(page),
      "card heading above the empty state",
    );
    await expectAbove(
      headerAddConnection(page),
      connectionsEmptyState(page),
      "card's Add connection above the empty state",
    );
    await expectAbove(
      connectionsEmptyState(page),
      refresh,
      "empty state above Refresh?",
    );
    await expectAbove(refresh, summary, "Refresh? above the pagination");
    await expectInside(
      connectionsEmptyState(page),
      tableCard,
      "empty state within the table card",
    );

    // Read once; nothing written.
    const state: FixtureState = await fixture(page);
    expect(state.role).toBe("owner");
    expect(
      state.listRequests.filter((request: RecordedModelRequest): boolean => {
        return !request.analytics;
      }).length,
    ).toBeGreaterThanOrEqual(1);
    expect(state.creates).toEqual([]);
  });

  test("header: badge, heading, description and Add connection share one centre line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openConnections(page);
    const root: Locator = connectionsEmptyState(page);

    await expect(root.getByRole("heading", { level: 3 })).toHaveText(
      CONNECTIONS_HEADING,
    );
    await expect(page.getByTestId(`${CONNECTIONS_ID}-description`)).toHaveText(
      CONNECTIONS_DESCRIPTION,
    );
    await expect(heroAddConnection(page)).toBeEnabled();
    await expect(heroAddConnection(page)).toHaveText("Add connection");
    await expect(
      page.getByTestId(`${CONNECTIONS_ID}-disabled-reason`),
    ).toHaveCount(0);

    const badge: Locator = root.locator("div[aria-hidden='true']").first();
    await expect(badge).toHaveClass(/bg-indigo-50/);
    const rootCentre: number = centreX(await documentBox(root));
    const centred: Array<[string, Locator]> = [
      ["badge", badge],
      ["heading", root.getByRole("heading", { level: 3 })],
      ["description", page.getByTestId(`${CONNECTIONS_ID}-description`)],
      ["Add connection", heroAddConnection(page)],
      ["Refresh?", connectionsCard(page).getByTestId("refresh-button")],
      ["table card", connectionsCard(page)],
    ];
    for (const [label, locator] of centred) {
      expect(
        Math.abs(centreX(await documentBox(locator)) - rootCentre),
        `${label} centred on the empty state`,
      ).toBeLessThanOrEqual(2);
    }

    // The header reads top to bottom: badge, heading, description, button.
    await expectAbove(badge, root.getByRole("heading", { level: 3 }), "badge");
    await expectAbove(
      root.getByRole("heading", { level: 3 }),
      page.getByTestId(`${CONNECTIONS_ID}-description`),
      "heading",
    );
    await expectAbove(
      page.getByTestId(`${CONNECTIONS_ID}-description`),
      heroAddConnection(page),
      "description",
    );
    await expectAbove(
      heroAddConnection(page),
      providersSection(page),
      "button",
    );
  });

  test("offers every catalog product as a tile, in catalog order, with its category and setup guide", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openConnections(page);

    await expect(tiles(page)).toHaveCount(PROVIDERS.length);
    expect(
      await tiles(page).evaluateAll(
        (elements: Array<Element>): Array<string> => {
          return elements.map((element: Element): string => {
            return element.getAttribute("data-testid") || "";
          });
        },
      ),
    ).toEqual(
      PROVIDERS.map((item: Provider): string => {
        return `${CONNECTIONS_ID}-provider-${item.value}`;
      }),
    );

    for (const item of PROVIDERS) {
      await expect(tileButton(page, item)).toHaveText(`Connect ${item.title}`);
      await expect(tileButton(page, item)).toBeVisible();
      await expect(tileCategory(page, item)).toHaveText(item.category);
      const link: Locator = guideLink(page, item);
      await expect(link).toHaveCount(1);
      await expect(link).toHaveAttribute("href", docsUrl(item));
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute(
        "href",
        new RegExp(`/docs/integrations/${item.docsSlug}$`),
      );
      /*
       * What a sighted reader sees is the short label; the product name and
       * "(opens in a new tab)" are sr-only. innerText counts sr-only text
       * (it is clipped, not hidden), so drop it before reading.
       */
      expect(
        await link.evaluate((element: Element): string => {
          const copy: Element = element.cloneNode(true) as Element;
          copy.querySelectorAll(".sr-only").forEach((node: Element): void => {
            node.remove();
          });
          return (copy.textContent || "").trim();
        }),
      ).toBe("Setup guide");
    }

    // The providers come first, then what a connection needs.
    await expect(
      providersSection(page).getByRole("heading", { level: 4 }),
    ).toHaveText("Pick a product to connect");
    await expect(
      requirementsSection(page).getByRole("heading", { level: 4 }),
    ).toHaveText("What you'll need");
    for (const requirement of REQUIREMENTS) {
      await expect(
        page.getByTestId(`${CONNECTIONS_ID}-requirement-${requirement.id}`),
      ).toContainText(requirement.title);
    }
  });

  test("every tile is built the same way, and no two share an icon", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openConnections(page);

    // Same classes and children on every tile: badge, name block, plus.
    const shapes: Array<string> = await tileShapes(page);
    expect(shapes).toHaveLength(PROVIDERS.length);
    expect(new Set(shapes).size, shapes.join("\n")).toBe(1);
    expect(shapes[0]).toContain("[1svg] + DIV");
    expect(await tile(page, SENTINEL).locator(":scope > div").count()).toBe(3);

    /*
     * Three providers used to share a shield. Each badge draws its own
     * icon now; compared by the SVG's markup, so a same-named icon with a
     * different size still counts as the same picture.
     */
    const icons: Array<string> = [];
    for (const item of PROVIDERS) {
      icons.push(
        await tileIcon(page, item).evaluate((svg: Element): string => {
          return svg.innerHTML;
        }),
      );
    }
    expect(new Set(icons).size, "distinct tile icons").toBe(PROVIDERS.length);
  });

  test("the old grey requirements box and the Setup guides list are gone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openConnections(page);
    const root: Locator = connectionsEmptyState(page);

    // The requirements come after the tiles, not in a box before them.
    await expectAbove(
      providersSection(page),
      requirementsSection(page),
      "providers above requirements",
    );
    expect(await backgroundColor(requirementsSection(page))).toBe(TRANSPARENT);
    await expect(
      root.getByText("Before you connect", { exact: true }),
    ).toHaveCount(0);

    /*
     * Nothing larger than an icon badge or the button paints a tinted
     * background: the grey box was a full-width bg-gray-50 panel.
     */
    const tinted: Array<Paint> = (await paintOf(root)).filter(
      (paint: Paint): boolean => {
        return (
          paint.background !== TRANSPARENT &&
          paint.background !== WHITE_RGB &&
          paint.height > 48
        );
      },
    );
    expect(tinted, "large tinted panels").toEqual([]);

    // One docs link per tile and none anywhere else: no docs-card list.
    await expect(root.getByText("Setup guides", { exact: true })).toHaveCount(
      0,
    );
    await expect(page.locator(`#${CONNECTIONS_ID}-guides`)).toHaveCount(0);
    await expect(root.getByRole("link")).toHaveCount(PROVIDERS.length);
    await expect(tiles(page).getByRole("link")).toHaveCount(PROVIDERS.length);
    // One list of products, one of requirements.
    await expect(root.getByRole("list")).toHaveCount(2);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Connections: accessibility
 * ---------------------------------------------------------------------------
 */

/*
 * A tile carries two actions: the whole tile starts a connection (a
 * stretched button) and a link opens the setup guide. They are siblings,
 * never nested, so a screen reader and the keyboard get two plain controls
 * with names of their own.
 */
test.describe("connections empty state accessibility", () => {
  test("sections, lists, headings and tile controls have names", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openConnections(page);
    const root: Locator = connectionsEmptyState(page);

    await expect(
      root.getByRole("heading", { level: 3, name: CONNECTIONS_HEADING }),
    ).toBeVisible();
    await expect(
      root.getByRole("region", { name: "Pick a product to connect" }),
    ).toBeVisible();
    await expect(
      root.getByRole("region", { name: "What you'll need" }),
    ).toBeVisible();

    const products: Locator = root.getByRole("list", {
      name: "Pick a product to connect",
    });
    await expect(products.getByRole("listitem")).toHaveCount(PROVIDERS.length);
    const needs: Locator = root.getByRole("list", { name: "What you'll need" });
    await expect(needs.getByRole("listitem")).toHaveCount(REQUIREMENTS.length);

    for (const item of PROVIDERS) {
      const button: Locator = tileButton(page, item);
      await expect(button).toHaveAttribute("type", "button");
      await expect(button).toHaveAccessibleName(`Connect ${item.title}`);
      // "Connect Okta System Log", described by "Identity".
      await expect(button).toHaveAccessibleDescription(item.category);
      await expect(
        page.getByRole("button", {
          name: `Connect ${item.title}`,
          exact: true,
        }),
      ).toHaveCount(1);
      await expect(guideLink(page, item)).toHaveAccessibleName(
        `${item.title} Setup guide (opens in a new tab)`,
      );

      // Decoration stays out of the accessibility tree.
      await expect(tileBadge(page, item)).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      await expect(
        tile(page, item).locator(":scope > div").nth(2),
      ).toHaveAttribute("aria-hidden", "true");

      // The two controls are siblings, never one inside the other.
      await expect(tile(page, item).locator("button a, a button")).toHaveCount(
        0,
      );
      // The tile itself is not a control and takes no focus.
      await expect(tile(page, item)).not.toHaveAttribute("tabindex", /.*/);
      await expect(tile(page, item)).not.toHaveAttribute("role", /.*/);
    }
  });

  test("Tab visits each tile, then its guide, in catalog order", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openConnections(page);
    await heroAddConnection(page).focus();
    expect(await focusedStop(page)).toBe("button:Add connection");

    const expected: Array<string> = [];
    for (const item of PROVIDERS) {
      expected.push(`tile:${item.value}`, `link:${docsUrl(item)}`);
    }
    // After the last guide the table's own Refresh? comes next.
    expected.push("button:Refresh?");

    const visited: Array<string> = [];
    for (let stop: number = 0; stop < expected.length; stop++) {
      await page.keyboard.press("Tab");
      visited.push(await focusedStop(page));
    }
    expect(visited).toEqual(expected);

    // And back: the first tile's Shift+Tab lands on the hero button.
    await tileButton(page, SENTINEL).focus();
    await page.keyboard.press("Shift+Tab");
    expect(await focusedStop(page)).toBe("button:Add connection");
  });

  test("a focused tile shows a ring and opens Add connection with Enter or Space", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openConnections(page);
    // Nothing is ringed before the keyboard arrives.
    for (const item of PROVIDERS) {
      expect(await overlayRing(tileButton(page, item))).toBe("none");
    }

    await heroAddConnection(page).focus();
    await page.keyboard.press("Tab");
    await expect(tileButton(page, SENTINEL)).toBeFocused();
    /*
     * The button's own outline is off (focus:outline-none); the ring is
     * drawn on the ::after that covers the tile, so it wraps the tile.
     */
    expect(await overlayRing(tileButton(page, SENTINEL))).toContain(
      INDIGO_500_RGB,
    );
    expect(await overlayRing(tileButton(page, DEFENDER))).toBe("none");
    expect(await ownRing(guideLink(page, SENTINEL))).not.toContain(
      INDIGO_500_RGB,
    );

    // The guide is its own stop, with a ring of its own.
    await page.keyboard.press("Tab");
    await expect(guideLink(page, SENTINEL)).toBeFocused();
    expect(await ownRing(guideLink(page, SENTINEL))).toContain(INDIGO_500_RGB);
    expect(await overlayRing(tileButton(page, SENTINEL))).toBe("none");

    // On to CrowdStrike: Defender's tile, its guide, then CrowdStrike.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(tileButton(page, CROWDSTRIKE)).toBeFocused();
    const ring: string = await overlayRing(tileButton(page, CROWDSTRIKE));
    expect(ring).toContain(INDIGO_500_RGB);
    // A 2px ring, not a hairline.
    expect(ring).toMatch(/0px 0px 0px 2px/);
    await screenshot(page, "connections-tile-focus", {
      clip: providersSection(page),
    });

    await page.keyboard.press("Enter");
    await expectProviderStep(page, CROWDSTRIKE);
    // Escape closes and hands focus back to the tile that opened it.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(tileButton(page, CROWDSTRIKE)).toBeFocused();

    await page.keyboard.press("Space");
    await expectProviderStep(page, CROWDSTRIKE);
    await cancelDialog(page);
    await expect(tileButton(page, CROWDSTRIKE)).toBeFocused();
    expect((await fixture(page)).creates).toEqual([]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Connections: what a click does
 * ---------------------------------------------------------------------------
 */

/*
 * A tile is one click target through a stretched button, so a click on the
 * name, the category, the badge, the plus or empty padding must all open
 * the real Add connection form with that product chosen. The guide link is
 * raised above that overlay and must never open the form.
 */
test.describe("connections empty state actions", () => {
  test("anywhere on a tile opens Add connection on the Provider step with only that product chosen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openConnections(page);

    for (const [index, item] of PROVIDERS.entries()) {
      const spot: TileSpot = TILE_SPOTS[index % TILE_SPOTS.length] as TileSpot;
      const point: Point = await tileSpot(page, item, spot);
      // The overlay really is what sits under that spot.
      expect(await hitAt(page, item, point), `${item.title} ${spot}`).toBe(
        `tile:${item.value}`,
      );
      await tile(page, item).click({ position: point });

      await expectProviderStep(page, item);
      await expect(
        addConnectionDialog(page).getByRole("heading", {
          name: "Add connection",
        }),
      ).toBeVisible();

      // Next skips straight to that product's own settings.
      await addConnectionDialog(page)
        .getByRole("button", { name: "Next", exact: true })
        .click();
      await expect(activeStep(page)).toHaveText("Connection");
      await expect(
        addConnectionDialog(page).getByText(`${item.title} settings`, {
          exact: true,
        }),
      ).toBeVisible();
      for (const other of PROVIDERS) {
        if (other.value !== item.value) {
          await expect(
            addConnectionDialog(page).getByText(`${other.title} settings`, {
              exact: true,
            }),
          ).toHaveCount(0);
        }
      }
      // The form's guide is the tile's guide.
      await expect(
        addConnectionDialog(page).getByRole("link", {
          name: `${item.title} setup guide`,
        }),
      ).toHaveAttribute("href", docsUrl(item));

      await cancelDialog(page);
    }

    expect((await fixture(page)).creates).toEqual([]);
  });

  test("the picker shows the same eight products, each with its tile's icon", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openConnections(page);
    await tile(page, CROWDSTRIKE).click({
      position: await tileSpot(page, CROWDSTRIKE, "blank"),
    });
    await expectProviderStep(page, CROWDSTRIKE);

    const pickerIcons: Array<string> = [];
    for (const item of PROVIDERS) {
      const option: Locator = providerOption(page, item);
      await expect(option).toContainText(item.title);
      const pickerIcon: string = await option
        .locator("svg")
        .first()
        .evaluate((svg: Element): string => {
          return svg.innerHTML;
        });
      const tileIconMarkup: string = await tileIcon(page, item).evaluate(
        (svg: Element): string => {
          return svg.innerHTML;
        },
      );
      expect(pickerIcon, `${item.title} icon`).toBe(tileIconMarkup);
      pickerIcons.push(pickerIcon);
    }
    expect(new Set(pickerIcons).size, "distinct picker icons").toBe(
      PROVIDERS.length,
    );

    // The chosen card is on screen when the dialog opens, no scrolling.
    const content: Box = await viewportBox(
      addConnectionDialog(page).getByTestId("modal-content"),
    );
    const chosen: Box = await viewportBox(providerOption(page, CROWDSTRIKE));
    expect(chosen.y).toBeGreaterThanOrEqual(content.y);
    expect(chosen.y + chosen.height).toBeLessThanOrEqual(
      content.y + content.height,
    );

    await screenshot(page, "connections-preselected-modal", {
      fullPage: false,
    });
    await cancelDialog(page);
  });

  test("the hero and card-header Add connection open the form with nothing chosen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openConnections(page);

    await heroAddConnection(page).click();
    await expectProviderStep(page, null);
    await cancelDialog(page);

    await expect(headerAddConnection(page)).toHaveCount(1);
    await expect(headerAddConnection(page)).toBeEnabled();
    await headerAddConnection(page).click();
    await expectProviderStep(page, null);
    await cancelDialog(page);

    // A tile's choice does not stick to the next plain open.
    await tileButton(page, SPLUNK).click();
    await expectProviderStep(page, SPLUNK);
    await cancelDialog(page);
    await headerAddConnection(page).click();
    await expectProviderStep(page, null);
    await cancelDialog(page);
    await heroAddConnection(page).click();
    await expectProviderStep(page, null);
    await cancelDialog(page);
  });

  test("a Setup guide opens its docs in a new tab and never the form", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openConnections(page);

    for (const item of PROVIDERS) {
      // The link is raised above the tile's overlay.
      const link: Locator = guideLink(page, item);
      const linkBox: Box = await viewportBox(link);
      const tileBox: Box = await viewportBox(tile(page, item));
      expect(
        await hitAt(page, item, {
          x: linkBox.x + linkBox.width / 2 - tileBox.x,
          y: linkBox.y + linkBox.height / 2 - tileBox.y,
        }),
        `${item.title} guide on top`,
      ).toBe("link");

      const [popup]: [Page, void] = await Promise.all([
        page.waitForEvent("popup"),
        link.click(),
      ]);
      await popup.waitForLoadState("domcontentloaded");
      expect(popup.url()).toBe(docsUrl(item));
      expect(await popup.title()).toBe(DOCS_STUB_TITLE);
      await popup.close();

      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(new URL(page.url()).pathname).toBe(CONNECTIONS_PATH);
    }

    expect(claimDocsNavigations(page)).toEqual([...DOCS_GUIDE_URLS]);
    expect((await fixture(page)).creates).toEqual([]);
  });

  test("hovering a tile turns its border, badge and plus indigo", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openConnections(page);
    expect(await borderColor(tile(page, CROWDSTRIKE))).toBe(GRAY_200_RGB);
    const restingIcon: string = await textColor(tileIcon(page, CROWDSTRIKE));
    expect(restingIcon).not.toBe(INDIGO_600_RGB);

    await tile(page, CROWDSTRIKE).hover({
      position: await tileSpot(page, CROWDSTRIKE, "blank"),
    });
    await expect
      .poll(async (): Promise<string> => {
        return borderColor(tile(page, CROWDSTRIKE));
      })
      .toBe(INDIGO_300_RGB);
    await expect
      .poll(async (): Promise<string> => {
        return textColor(tileIcon(page, CROWDSTRIKE));
      })
      .toBe(INDIGO_600_RGB);
    await expect
      .poll(async (): Promise<string> => {
        return textColor(tilePlus(page, CROWDSTRIKE));
      })
      .toBe(INDIGO_600_RGB);
    await expect
      .poll(async (): Promise<string> => {
        return backgroundColor(tileBadge(page, CROWDSTRIKE));
      })
      .toBe(INDIGO_50_RGB);
    // The name keeps its colour, and the cursor says it is clickable.
    expect(await textColor(tileButton(page, CROWDSTRIKE))).toBe(GRAY_900_RGB);
    expect(
      await tileButton(page, CROWDSTRIKE).evaluate(
        (element: Element): string => {
          return getComputedStyle(element, "::after").cursor;
        },
      ),
    ).toBe("pointer");
    // Only the hovered tile changes.
    expect(await borderColor(tile(page, SENTINEL))).toBe(GRAY_200_RGB);
    expect(await textColor(tilePlus(page, SENTINEL))).not.toBe(INDIGO_600_RGB);

    await screenshot(page, "connections-tile-hover", {
      keepPointer: true,
      clip: providersSection(page),
    });

    await page.mouse.move(0, 0);
    await expect
      .poll(async (): Promise<string> => {
        return borderColor(tile(page, CROWDSTRIKE));
      })
      .toBe(GRAY_200_RGB);
    await expect
      .poll(async (): Promise<string> => {
        return textColor(tileIcon(page, CROWDSTRIKE));
      })
      .toBe(restingIcon);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Connections: layout
 * ---------------------------------------------------------------------------
 */

/*
 * The tile grid uses viewport columns (1, then 2 from sm, 4 from lg) and the
 * tile stands upright from lg so a long name gets the tile's full width.
 * Measured in the browser: the unit tests cannot see a wrapped name or a
 * row of unequal tiles.
 */
test.describe("connections empty state layout", () => {
  test("1440: four tiles a row, one size, every name on one line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openConnections(page, { width: 1440, height: 1000 });
    await expectNoHorizontalOverflow(page);

    const layouts: Array<TileLayout> = await tileLayouts(page);
    const rows: Array<Array<TileLayout>> = rowsOf(layouts);
    expect(
      rows.map((row: Array<TileLayout>): number => {
        return row.length;
      }),
    ).toEqual([4, 4]);
    // Row-major, in catalog order.
    expect(
      rows.flat().map((layout: TileLayout): string => {
        return layout.provider;
      }),
    ).toEqual(
      PROVIDERS.map((item: Provider): string => {
        return item.value;
      }),
    );

    const first: TileLayout = layouts[0] as TileLayout;
    for (const layout of layouts) {
      expect(
        Math.abs(layout.box.height - first.box.height),
        `${layout.provider} height`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(layout.box.width - first.box.width),
        `${layout.provider} width`,
      ).toBeLessThanOrEqual(1);
      expect(layout.nameLines, `${layout.provider} name lines`).toBe(1);
      expect(layout.nameClipped, `${layout.provider} name clipped`).toBe(false);
    }

    // The grid spans the empty state's content box, inside the card.
    await expectInside(
      providersSection(page),
      connectionsCard(page),
      "providers",
    );
    // The two requirements sit side by side.
    const needs: Array<Box> = [];
    for (const requirement of REQUIREMENTS) {
      needs.push(
        await documentBox(
          page.getByTestId(`${CONNECTIONS_ID}-requirement-${requirement.id}`),
        ),
      );
    }
    expect(
      Math.abs((needs[0] as Box).y - (needs[1] as Box).y),
    ).toBeLessThanOrEqual(1);

    await screenshot(page, "connections-desktop");
  });

  const LAYOUTS: ReadonlyArray<{
    width: number;
    height: number;
    columns: number;
    screenshot?: string;
    fullPage?: boolean;
  }> = [
    { width: 1024, height: 900, columns: 4 },
    {
      width: 768,
      height: 1024,
      columns: 2,
      screenshot: "connections-tablet",
    },
    {
      width: 390,
      height: 844,
      columns: 1,
      screenshot: "connections-mobile",
      fullPage: true,
    },
  ];

  for (const layout of LAYOUTS) {
    test(`${layout.width}: ${layout.columns} column${
      layout.columns === 1 ? "" : "s"
    }, nothing wider than the card`, async ({ page }: { page: Page }) => {
      await openConnections(page, {
        width: layout.width,
        height: layout.height,
      });
      await expectNoHorizontalOverflow(page);

      const layouts: Array<TileLayout> = await tileLayouts(page);
      const rows: Array<Array<TileLayout>> = rowsOf(layouts);
      expect(
        rows.every((row: Array<TileLayout>): boolean => {
          return row.length === layout.columns;
        }),
        `rows of ${layout.columns}`,
      ).toBe(true);
      expect(rows).toHaveLength(PROVIDERS.length / layout.columns);

      for (const row of rows) {
        const height: number = (row[0] as TileLayout).box.height;
        for (const cell of row) {
          expect(
            Math.abs(cell.box.height - height),
            `${cell.provider} as tall as its row`,
          ).toBeLessThanOrEqual(1);
          expect(cell.nameClipped, `${cell.provider} name clipped`).toBe(false);
        }
      }

      const card: Locator = connectionsCard(page);
      await expectInside(connectionsEmptyState(page), card, "empty state");
      for (const item of PROVIDERS) {
        await expectInside(tile(page, item), card, item.title);
      }
      // Nothing inside the table scrolls sideways either.
      const tableScroll: number = await connectionsEmptyState(page).evaluate(
        (element: Element): number => {
          const scroller: Element | null = element.closest(".overflow-x-auto");
          return scroller ? scroller.scrollWidth - scroller.clientWidth : 0;
        },
      );
      expect(tableScroll, "table scrolls sideways").toBeLessThanOrEqual(1);

      // The header stays centred on the card.
      const rootCentre: number = centreX(
        await documentBox(connectionsEmptyState(page)),
      );
      expect(
        Math.abs(
          centreX(await documentBox(heroAddConnection(page))) - rootCentre,
        ),
      ).toBeLessThanOrEqual(2);

      if (layout.screenshot) {
        await screenshot(page, layout.screenshot, {
          fullPage: layout.fullPage !== false,
        });
      }
    });
  }

  /*
   * At 1024 the four columns are 202px wide, narrower than "Splunk
   * Enterprise Security" in the tile's semibold: it wraps, onto two lines.
   * The grid keeps every tile in its row the same height regardless (checked
   * above).
   *
   * Which OTHER names wrap is a property of the platform's text rendering,
   * not of the layout: "Microsoft Defender XDR" fits its 168px column with
   * about 4px to spare in Chromium on macOS, and FreeType's metrics on Linux
   * spend them, so it wraps there - for real users too. So this pins the
   * layout instead: every name wraps exactly when it is wider than its column
   * as measured in this browser, and never before. A layout change that
   * narrowed the column, or made names wrap early, still fails here; a
   * rendering difference of a few pixels does not.
   */
  test("1024: a name wraps only when it is wider than its column, and Splunk Enterprise Security does", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openConnections(page, { width: 1024, height: 900 });
    const layouts: Array<TileLayout> = await tileLayouts(page);
    const fits: Array<NameFit> = await nameFits(page);

    expect(
      layouts.find((layout: TileLayout): boolean => {
        return layout.provider === SPLUNK.value;
      })?.nameLines,
    ).toBe(2);

    for (const layout of layouts) {
      const fit: NameFit | undefined = fits.find((item: NameFit): boolean => {
        return item.provider === layout.provider;
      });
      expect(fit, `${layout.provider} measured`).toBeDefined();
      expect(layout.nameClipped, `${layout.provider} name clipped`).toBe(false);
      expect(
        layout.nameLines,
        `${layout.provider} name lines`,
      ).toBeLessThanOrEqual(2);

      // Sub-pixel rounding makes a name within half a pixel of the edge a coin toss.
      if (Math.abs(fit!.textWidth - fit!.columnWidth) < 0.5) {
        continue;
      }

      expect(
        layout.nameLines > 1,
        `${layout.provider}: ${fit!.textWidth.toFixed(1)}px of text in a ${fit!.columnWidth.toFixed(1)}px column`,
      ).toBe(fit!.textWidth > fit!.columnWidth);
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * Connections: a member who cannot create connections
 * ---------------------------------------------------------------------------
 */

/*
 * ?role=viewer holds Security Viewer only. The gate disables both Add
 * connection buttons, and a tooltip never shows on a touch screen, so the
 * reason is written out under the hero button. The tiles become a plain
 * list headed "Supported products": no buttons, no plus, nothing that looks
 * clickable, but the setup guides still work.
 */
test.describe("connections empty state for a viewer", () => {
  test("says why Add connection is disabled and lists the products as static tiles", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openConnections(page, { role: "viewer" });
    expect((await fixture(page)).role).toBe("viewer");

    await expect(heroAddConnection(page)).toBeDisabled();
    await expect(headerAddConnection(page)).toBeDisabled();
    const reason: Locator = page.getByTestId(
      `${CONNECTIONS_ID}-disabled-reason`,
    );
    await expect(reason).toBeVisible();
    await expect(reason).toHaveText(CREATE_DISABLED_REASON);
    // The lock icon, then the sentence.
    await expect(reason.locator("svg")).toHaveCount(1);
    await expectAbove(heroAddConnection(page), reason, "button above reason");
    await expectAbove(reason, providersSection(page), "reason above tiles");
    // Centred under the button, like the rest of the header.
    expect(
      Math.abs(
        centreX(await documentBox(reason)) -
          centreX(await documentBox(connectionsEmptyState(page))),
      ),
    ).toBeLessThanOrEqual(2);

    await expect(
      connectionsEmptyState(page).getByRole("region", {
        name: "Supported products",
      }),
    ).toBeVisible();
    await expect(
      connectionsEmptyState(page).getByText("Pick a product to connect"),
    ).toHaveCount(0);

    // Static tiles: no buttons, no plus, the same shape as each other.
    await expect(page.locator("[data-provider-tile]")).toHaveCount(0);
    await expect(providersSection(page).getByRole("button")).toHaveCount(0);
    await expect(tiles(page)).toHaveCount(PROVIDERS.length);
    const shapes: Array<string> = await tileShapes(page);
    expect(new Set(shapes).size, shapes.join("\n")).toBe(1);
    for (const item of PROVIDERS) {
      await expect(tile(page, item).locator(":scope > div")).toHaveCount(2);
      // The badge's icon and the guide's external-link icon: no plus.
      await expect(tile(page, item).locator("svg")).toHaveCount(2);
      await expect(tile(page, item).locator("p").first()).toHaveText(
        item.title,
      );
      await expect(tileCategory(page, item)).toHaveText(item.category);
      await expect(guideLink(page, item)).toHaveAttribute(
        "href",
        docsUrl(item),
      );
      await expect(guideLink(page, item)).toHaveAttribute("target", "_blank");
    }

    // Hovering a static tile changes nothing, and clicking it opens nothing.
    await tile(page, OKTA).hover({
      position: await tileSpot(page, OKTA, "blank"),
    });
    await page.waitForTimeout(250);
    expect(await borderColor(tile(page, OKTA))).toBe(GRAY_200_RGB);
    expect(await backgroundColor(tileBadge(page, OKTA))).not.toBe(
      INDIGO_50_RGB,
    );
    for (const spot of ["badge", "name", "blank"] as Array<TileSpot>) {
      await tile(page, OKTA).click({
        position: await tileSpot(page, OKTA, spot),
      });
    }
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(CONNECTIONS_PATH);

    // Hovering the disabled button still shows its tooltip.
    await heroAddConnection(page).hover({ force: true });
    await expect(page.locator("[data-tippy-root]")).toHaveText(
      CREATE_DISABLED_REASON,
    );

    await screenshot(page, "connections-viewer");
    expect((await fixture(page)).creates).toEqual([]);
  });

  test("Tab moves from guide to guide, and a guide still opens its docs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openConnections(page, { role: "viewer" });

    await guideLink(page, SENTINEL).focus();
    const visited: Array<string> = [await focusedStop(page)];
    for (let stop: number = 1; stop < PROVIDERS.length; stop++) {
      await page.keyboard.press("Tab");
      visited.push(await focusedStop(page));
    }
    expect(visited).toEqual(
      PROVIDERS.map((item: Provider): string => {
        return `link:${docsUrl(item)}`;
      }),
    );

    const [popup]: [Page, void] = await Promise.all([
      page.waitForEvent("popup"),
      guideLink(page, OKTA).click(),
    ]);
    await popup.waitForLoadState("domcontentloaded");
    expect(popup.url()).toBe(docsUrl(OKTA));
    await popup.close();
    expect(claimDocsNavigations(page)).toEqual([docsUrl(OKTA)]);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Connections: dark theme
 * ---------------------------------------------------------------------------
 */

/*
 * Theme.css re-colours the light classes under html.dark; a class it does
 * not remap stays light. The tiles, badges and requirement icons must sit on
 * the card's dark surface, and the text on them must stay readable.
 */
test.describe("connections empty state in the dark theme", () => {
  test("tiles sit on the card surface, text is readable, hover stays indigo", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openConnections(page, { theme: "dark" });
    await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
    const root: Locator = connectionsEmptyState(page);

    const surface: string = await surfaceOf(root);
    expect(surface).not.toBe(WHITE_RGB);
    expect(luminance(surface), "card surface is dark").toBeLessThan(0.05);
    for (const item of PROVIDERS) {
      expect(await backgroundColor(tile(page, item)), item.title).toBe(surface);
    }

    const paints: Array<Paint> = await paintOf(root);
    expect(
      paints.filter((paint: Paint): boolean => {
        return paint.background === WHITE_RGB;
      }),
      "white backgrounds",
    ).toEqual([]);
    expect(
      paints.filter((paint: Paint): boolean => {
        return paint.color === GRAY_900_RGB;
      }),
      "near-black text",
    ).toEqual([]);
    expect(await lowContrastText(root, MIN_CONTRAST)).toEqual([]);
    expect(
      luminance(await textColor(root.getByRole("heading", { level: 3 }))),
      "heading is light",
    ).toBeGreaterThan(0.5);

    // Hover: indigo border, badge tint and icon, still on the dark surface.
    await tile(page, CROWDSTRIKE).hover({
      position: await tileSpot(page, CROWDSTRIKE, "blank"),
    });
    await expect
      .poll(async (): Promise<string> => {
        return borderColor(tile(page, CROWDSTRIKE));
      })
      .toBe(INDIGO_400_RGB);
    await expect
      .poll(async (): Promise<string> => {
        return backgroundColor(tileBadge(page, CROWDSTRIKE));
      })
      .toMatch(DARK_INDIGO_TINT);
    await expect
      .poll(async (): Promise<string> => {
        return textColor(tileIcon(page, CROWDSTRIKE));
      })
      .toBe(INDIGO_300_RGB);
    await expect
      .poll(async (): Promise<string> => {
        return textColor(tilePlus(page, CROWDSTRIKE));
      })
      .toBe(INDIGO_300_RGB);
    expect(await backgroundColor(tile(page, CROWDSTRIKE))).toBe(surface);
    expect(
      await lowContrastText(tile(page, CROWDSTRIKE), MIN_CONTRAST),
    ).toEqual([]);

    await page.mouse.move(0, 0);
    await expect
      .poll(async (): Promise<string> => {
        return borderColor(tile(page, CROWDSTRIKE));
      })
      .not.toBe(INDIGO_400_RGB);
    await screenshot(page, "connections-dark");
  });

  test("light theme text meets the same contrast", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openConnections(page);
    await expect(page.locator("html")).not.toHaveClass(/(^|\s)dark(\s|$)/);
    expect(
      await lowContrastText(connectionsEmptyState(page), MIN_CONTRAST),
    ).toEqual([]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Security Events
 * ---------------------------------------------------------------------------
 */

/*
 * The Security Events list shows its empty state only for a project that
 * has never received an event, which it learns from a one-row lookup once
 * the window comes back empty. Until that answers (or when the newest
 * event is simply older than the window) it must say "nothing in this time
 * range" instead, and never offer setup to someone already ingesting.
 */
test.describe("security events empty state: when it shows", () => {
  test("waits for the newest-event lookup before saying nothing has arrived", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, EVENTS_PATH, { latest: "pending" });
    await expect(noResults(page)).toBeVisible({ timeout: 30000 });
    await expect(noResults(page)).toContainText(
      "No security events in this time range",
    );
    await expect(eventsEmptyState(page)).toHaveCount(0);

    const lookups: Array<RecordedModelRequest> = (
      await fixture(page)
    ).listRequests.filter((request: RecordedModelRequest): boolean => {
      return (
        Boolean(request.analytics) &&
        request.limit === 1 &&
        !(request.query && "time" in request.query)
      );
    });
    expect(lookups, "one newest-event lookup").toHaveLength(1);

    await page.evaluate((): void => {
      (
        window as unknown as {
          __securityEventsEmptyStatesFixture: {
            resolveLatestEvent: () => void;
          };
        }
      ).__securityEventsEmptyStatesFixture.resolveLatestEvent();
    });
    await expect(eventsEmptyState(page)).toBeVisible();
    await expect(noResults(page)).toHaveCount(0);
  });

  test("a project whose newest event is older than the window never sees it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, EVENTS_PATH, { latest: "old" });
    await expect(noResults(page)).toContainText(
      "The most recent security event arrived",
      { timeout: 30000 },
    );
    await expect(
      page.getByTestId("security-events-no-results-show-range"),
    ).toBeVisible();
    await expect(eventsEmptyState(page)).toHaveCount(0);
    await expect(page.getByText(EVENTS_HEADING)).toHaveCount(0);
  });
});

/*
 * Two equal cards replaced a primary and a secondary button under one long
 * sentence: push events to the ingest endpoint, or have OneUptime poll a
 * product. Each card is one click target through a stretched button, and
 * the endpoint chip is raised above it so it can be selected and copied.
 */
test.describe("security events empty state", () => {
  test("sits in the list card: header, then the two ways in", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEvents(page);
    const root: Locator = eventsEmptyState(page);
    const listCard: Locator = eventsListCard(page);

    await expect(listCard).toHaveCount(1);
    await expect(listCard.locator(`#${EVENTS_ID}`)).toHaveCount(1);
    await expectInside(root, listCard, "empty state within the list card");
    // The list's own pagination stays under it, in the same card.
    const pagination: Locator = listCard.getByTestId("telemetry-pagination");
    await expect(pagination).toHaveCount(1);
    await expect(pagination.getByTestId("pagination-summary")).toHaveText(
      "No security events",
    );
    await expectAbove(root, pagination, "empty state above the pagination");
    // The filters sidebar stays beside the list card, not above or in it.
    const filters: Locator = page.getByRole("heading", {
      name: "Filters",
      exact: true,
    });
    await expect(filters).toHaveCount(1);
    await expect(
      listCard.getByRole("heading", { name: "Filters", exact: true }),
    ).toHaveCount(0);
    expect(centreX(await documentBox(filters))).toBeLessThan(
      (await documentBox(listCard)).x,
    );
    // From md up the sidebar always shows, so there is nothing to unfold.
    await expect(filtersToggle(page)).toBeHidden();

    await expect(root.getByRole("heading", { level: 3 })).toHaveText(
      EVENTS_HEADING,
    );
    await expect(page.getByTestId(`${EVENTS_ID}-description`)).toHaveText(
      EVENTS_DESCRIPTION,
    );
    const badge: Locator = root.locator(":scope > div[aria-hidden='true']");
    await expect(badge).toHaveCount(1);
    const listCentre: number = centreX(await documentBox(listCard));
    for (const [label, locator] of [
      ["badge", badge],
      ["heading", root.getByRole("heading", { level: 3 })],
      ["description", page.getByTestId(`${EVENTS_ID}-description`)],
    ] as Array<[string, Locator]>) {
      expect(
        Math.abs(centreX(await documentBox(locator)) - listCentre),
        `${label} centred on the list card`,
      ).toBeLessThanOrEqual(2);
    }

    const ways: Locator = root.getByRole("list", {
      name: "Ways to start sending security events",
    });
    await expect(ways.getByRole("listitem")).toHaveCount(2);
    expect(
      await ways
        .getByRole("listitem")
        .evaluateAll((items: Array<Element>): Array<string> => {
          return items.map((item: Element): string => {
            return item.getAttribute("data-testid") || "";
          });
        }),
    ).toEqual(
      WAYS_IN.map((way: WayIn): string => {
        return `${EVENTS_ID}-${way.id}`;
      }),
    );

    for (const way of WAYS_IN) {
      const card: Locator = wayInCard(page, way.id);
      await expect(card.getByRole("heading", { level: 4 })).toHaveText(
        way.title,
      );
      await expect(wayInDescription(page, way.id)).toHaveText(way.description);
      await expect(card.getByRole("button")).toHaveCount(1);
      await expect(card.getByRole("button")).toHaveText(way.action);
    }
    await expectAbove(
      page.getByTestId(`${EVENTS_ID}-description`),
      ways,
      "description above the cards",
    );

    // The endpoint is code, method then path, and never a link.
    const chip: Locator = ingestEndpoint(page);
    expect(
      await chip.evaluate((element: Element): string => {
        return element.tagName;
      }),
    ).toBe("CODE");
    await expect(chip.locator("span")).toHaveText([INGEST_METHOD, INGEST_PATH]);
    expect(
      await chip.evaluate((element: Element): string => {
        return getComputedStyle(element).fontFamily;
      }),
    ).toMatch(/mono/i);
    await expect(page.getByTestId(`${EVENTS_ID}-categories`)).toHaveText(
      CATEGORIES_LINE,
    );
    await expect(root.getByRole("link")).toHaveCount(0);

    // Equal weight: same classes on both actions, and the cards line up.
    const actionClasses: Array<string> = [
      (await setupGuideButton(page).getAttribute("class")) || "",
      (await connectButton(page).getAttribute("class")) || "",
    ];
    expect(actionClasses[0]).toBe(actionClasses[1]);
    const send: Box = await documentBox(wayInCard(page, "send"));
    const connect: Box = await documentBox(wayInCard(page, "connect"));
    expect(Math.abs(send.y - connect.y), "side by side").toBeLessThanOrEqual(1);
    expect(send.x + send.width).toBeLessThanOrEqual(connect.x);
    expect(Math.abs(send.height - connect.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(send.width - connect.width)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        (await documentBox(setupGuideButton(page))).y -
          (await documentBox(connectButton(page))).y,
      ),
      "actions level",
    ).toBeLessThanOrEqual(1);

    await expectNoHorizontalOverflow(page);
    expect(await lowContrastText(root, MIN_CONTRAST)).toEqual([]);
    await screenshot(page, "events-desktop");
  });

  test("each card is one control, named by its action and described by its title", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEvents(page);

    await expect(setupGuideButton(page)).toHaveAccessibleName(
      "Read the setup guide",
    );
    await expect(setupGuideButton(page)).toHaveAccessibleDescription(
      "Send events to OneUptime",
    );
    await expect(connectButton(page)).toHaveAccessibleName(
      "Connect a security product",
    );
    await expect(connectButton(page)).toHaveAccessibleDescription(
      "Pull from a security product",
    );
    await expect(
      wayInCard(page, "send").locator("div[aria-hidden='true']"),
    ).toHaveCount(1);

    // Title, description and category line sit under the card's overlay.
    for (const way of WAYS_IN) {
      const expected: string = `button:${
        way.id === "send"
          ? `${EVENTS_ID}-setup-guide`
          : `${EVENTS_ID}-connections`
      }`;
      expect(await eventsHitAt(wayInDescription(page, way.id))).toBe(expected);
      expect(
        await eventsHitAt(wayInCard(page, way.id).getByRole("heading")),
      ).toBe(expected);
    }
    expect(await eventsHitAt(page.getByTestId(`${EVENTS_ID}-categories`))).toBe(
      `button:${EVENTS_ID}-connections`,
    );
    // The endpoint is raised above it.
    expect(await eventsHitAt(ingestEndpoint(page))).toBe("code");

    // Keyboard: two stops, each ringing its whole card.
    expect(await overlayRing(setupGuideButton(page))).toBe("none");
    await setupGuideButton(page).focus();
    await page.keyboard.press("Tab");
    await expect(connectButton(page)).toBeFocused();
    expect(await overlayRing(connectButton(page))).toContain(INDIGO_500_RGB);
    await page.keyboard.press("Shift+Tab");
    await expect(setupGuideButton(page)).toBeFocused();
    expect(await overlayRing(setupGuideButton(page))).toContain(INDIGO_500_RGB);
    expect(await overlayRing(connectButton(page))).toBe("none");

    // Hover: the card's border turns indigo.
    await wayInCard(page, "connect").hover({
      position: await spotOnWayIn(
        page,
        "connect",
        wayInDescription(page, "connect"),
      ),
    });
    await expect
      .poll(async (): Promise<string> => {
        return borderColor(wayInCard(page, "connect"));
      })
      .toBe(INDIGO_300_RGB);
    expect(await borderColor(wayInCard(page, "send"))).toBe(GRAY_200_RGB);
  });

  test("Read the setup guide opens the Documentation tab, and back returns", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEvents(page);

    await setupGuideButton(page).click();
    await expectPath(page, DOCUMENTATION_PATH);
    await expect(page.getByTestId("stub-page")).toHaveAttribute(
      "data-page",
      "SECURITY_EVENTS_DOCUMENTATION",
    );
    await expect(page.getByTestId("stub-page")).toHaveText(DOCUMENTATION_PATH);
    await expect(eventsEmptyState(page)).toHaveCount(0);

    await page.goBack();
    await expectPath(page, EVENTS_PATH);
    await expect(eventsEmptyState(page)).toBeVisible({ timeout: 30000 });

    // A click on the card's description counts as the card.
    await clickWayInAt(page, "send", wayInDescription(page, "send"));
    await expectPath(page, DOCUMENTATION_PATH);
    await expect(page.getByTestId("stub-page")).toHaveAttribute(
      "data-page",
      "SECURITY_EVENTS_DOCUMENTATION",
    );
    await page.goBack();
    await expectPath(page, EVENTS_PATH);
    await expect(eventsEmptyState(page)).toBeVisible({ timeout: 30000 });

    // And Enter on the focused action.
    await setupGuideButton(page).focus();
    await page.keyboard.press("Enter");
    await expectPath(page, DOCUMENTATION_PATH);
    await expect(page.getByTestId("stub-page")).toHaveAttribute(
      "data-page",
      "SECURITY_EVENTS_DOCUMENTATION",
    );
  });

  test("anywhere on Pull from a security product opens Connections, and back returns", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEvents(page);

    await clickWayInAt(page, "connect", wayInDescription(page, "connect"));
    await expectPath(page, CONNECTIONS_PATH);
    await expect(connectionsEmptyState(page)).toBeVisible({ timeout: 30000 });
    await expect(tiles(page)).toHaveCount(PROVIDERS.length);
    await expect(eventsEmptyState(page)).toHaveCount(0);
    // It is the real Connections page: its table card is there.
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Security Event Connections",
        exact: true,
      }),
    ).toBeVisible();

    await page.goBack();
    await expectPath(page, EVENTS_PATH);
    await expect(eventsEmptyState(page)).toBeVisible({ timeout: 30000 });
    await expect(connectionsEmptyState(page)).toHaveCount(0);

    // The categories line is part of the card too.
    await clickWayInAt(
      page,
      "connect",
      page.getByTestId(`${EVENTS_ID}-categories`),
    );
    await expectPath(page, CONNECTIONS_PATH);
    await expect(connectionsEmptyState(page)).toBeVisible({ timeout: 30000 });
    await page.goBack();
    await expectPath(page, EVENTS_PATH);
    await expect(eventsEmptyState(page)).toBeVisible({ timeout: 30000 });
  });

  test("the endpoint can be clicked and selected without leaving the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEvents(page);
    const chip: Locator = ingestEndpoint(page);

    await chip.click();
    expect(new URL(page.url()).pathname).toBe(EVENTS_PATH);
    await expect(eventsEmptyState(page)).toBeVisible();

    await chip.click({ clickCount: 3 });
    const tripleSelection: string = await page.evaluate((): string => {
      return String(window.getSelection() || "");
    });
    expect(tripleSelection).toContain(INGEST_PATH);
    expect(new URL(page.url()).pathname).toBe(EVENTS_PATH);

    // A drag across the path selects that text and nothing navigates.
    await page.evaluate((): void => {
      window.getSelection()?.removeAllRanges();
    });
    const pathBox: Box = await viewportBox(chip.locator("span").nth(1));
    await page.mouse.move(pathBox.x + 1, pathBox.y + pathBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      pathBox.x + pathBox.width - 1,
      pathBox.y + pathBox.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();
    const dragSelection: string = await page.evaluate((): string => {
      return String(window.getSelection() || "");
    });
    expect(dragSelection.length).toBeGreaterThan(10);
    expect(INGEST_PATH).toContain(dragSelection.trim());
    expect(new URL(page.url()).pathname).toBe(EVENTS_PATH);
    await expect(eventsEmptyState(page)).toBeVisible();
  });

  test("dark theme: the cards sit on the list surface with readable text", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEvents(page, { theme: "dark", width: 1440, height: 1000 });
    await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
    const root: Locator = eventsEmptyState(page);

    const surface: string = await backgroundColor(eventsListCard(page));
    expect(surface).not.toBe(WHITE_RGB);
    expect(luminance(surface), "list surface is dark").toBeLessThan(0.05);
    for (const way of WAYS_IN) {
      expect(await backgroundColor(wayInCard(page, way.id))).toBe(surface);
    }
    const paints: Array<Paint> = await paintOf(root);
    expect(
      paints.filter((paint: Paint): boolean => {
        return paint.background === WHITE_RGB;
      }),
      "white backgrounds",
    ).toEqual([]);
    expect(
      paints.filter((paint: Paint): boolean => {
        return paint.color === GRAY_900_RGB;
      }),
      "near-black text",
    ).toEqual([]);
    expect(await lowContrastText(root, MIN_CONTRAST)).toEqual([]);
    // The chip is a shade off the card, not a white pill.
    expect(await backgroundColor(ingestEndpoint(page))).not.toBe(surface);
    expect(luminance(await backgroundColor(ingestEndpoint(page)))).toBeLessThan(
      0.1,
    );
    await expectNoHorizontalOverflow(page);
    await screenshot(page, "events-dark");
  });

  test("768: the cards fit the list card without scrolling sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEvents(page, { width: 768, height: 1024 });
    await expectNoHorizontalOverflow(page);
    const listCard: Locator = eventsListCard(page);

    // 768 is md: the sidebar is back beside the list and the toggle is gone.
    await expect(filtersToggle(page)).toBeHidden();
    const sidebar: Locator = await filtersSidebar(page);
    await expect(sidebar).toBeVisible();
    const sidebarBox: Box = await documentBox(sidebar);
    expect(
      sidebarBox.x + sidebarBox.width,
      "filters to the left of the list",
    ).toBeLessThanOrEqual((await documentBox(listCard)).x);

    for (const way of WAYS_IN) {
      await expectInside(wayInCard(page, way.id), listCard, way.title);
      await expectInside(
        wayInCard(page, way.id).getByRole("button"),
        wayInCard(page, way.id),
        `${way.title} action`,
      );
    }
    await expectInside(ingestEndpoint(page), wayInCard(page, "send"), "chip");
    const listScroll: number = await listCard.evaluate(
      (element: Element): number => {
        return element.scrollWidth - element.clientWidth;
      },
    );
    expect(listScroll, "list card scrolls sideways").toBeLessThanOrEqual(1);

    // Side by side or stacked, but never overlapping, and the same width.
    const send: Box = await documentBox(wayInCard(page, "send"));
    const connect: Box = await documentBox(wayInCard(page, "connect"));
    const sideBySide: boolean = Math.abs(send.y - connect.y) <= 1;
    if (sideBySide) {
      expect(send.x + send.width).toBeLessThanOrEqual(connect.x);
    } else {
      expect(send.y + send.height).toBeLessThanOrEqual(connect.y);
    }
    expect(Math.abs(send.width - connect.width)).toBeLessThanOrEqual(1);
  });

  /*
   * Below md the TelemetryViewer stacks its facet sidebar above the list,
   * folded behind a "Filters" toggle, and wraps its toolbar. The list and
   * its empty state used to share a row with the 14rem sidebar at every
   * width, which left them about 110px on a phone: one word per line, and
   * a pagination footer that scrolled the page sideways. Now the list gets
   * the page's full width and nothing sticks out.
   */
  test("390: the list gets the full width, the filters fold above it, nothing scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    const width: number = 390;
    await openEvents(page, { width, height: 844 });
    await expectNoHorizontalOverflow(page);
    const root: Locator = eventsEmptyState(page);
    const listCard: Locator = eventsListCard(page);

    // Folded by default: the toggle shows, the sidebar does not.
    const toggle: Locator = filtersToggle(page);
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const sidebar: Locator = await filtersSidebar(page);
    await expect(sidebar).toBeHidden();

    // The list card is the main area's whole width, most of the phone's.
    const list: Box = await documentBox(listCard);
    const main: Box = await documentBox(eventsMainArea(page));
    expect(
      Math.abs(list.x - main.x),
      "list starts where the row does",
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(list.width - main.width),
      "list as wide as the main area",
    ).toBeLessThanOrEqual(1);
    expect(list.width, "list not squeezed by the sidebar").toBeGreaterThan(
      width - 80,
    );
    expect(list.x + list.width).toBeLessThanOrEqual(width);
    const listScroll: number = await listCard.evaluate(
      (element: Element): number => {
        return element.scrollWidth - element.clientWidth;
      },
    );
    expect(listScroll, "list card scrolls sideways").toBeLessThanOrEqual(1);

    // The header reads normally: a one-line heading, centred on the card.
    const heading: Locator = root.getByRole("heading", { level: 3 });
    const headingLines: number = await heading.evaluate(
      (element: Element): number => {
        return Math.round(
          element.getBoundingClientRect().height /
            parseFloat(getComputedStyle(element).lineHeight),
        );
      },
    );
    expect(headingLines, "heading lines").toBe(1);
    expect(
      Math.abs(centreX(await documentBox(heading)) - centreX(list)),
      "heading centred on the list card",
    ).toBeLessThanOrEqual(2);

    // The two cards stack, each the list's width less its gutters.
    const send: Box = await documentBox(wayInCard(page, "send"));
    const connect: Box = await documentBox(wayInCard(page, "connect"));
    expect(send.y + send.height, "cards stacked").toBeLessThanOrEqual(
      connect.y,
    );
    expect(Math.abs(send.x - connect.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(send.width - connect.width)).toBeLessThanOrEqual(1);
    expect(send.width, "cards use the list's width").toBeGreaterThan(
      list.width - 64,
    );
    for (const way of WAYS_IN) {
      const card: Locator = wayInCard(page, way.id);
      await expectInside(card, listCard, way.title);
      await expectInside(card.getByRole("button"), card, `${way.title} action`);
      // The title stays beside its badge instead of wrapping under it.
      const badge: Box = await documentBox(
        card.locator("div[aria-hidden='true']").first(),
      );
      const title: Box = await documentBox(card.getByRole("heading"));
      expect(
        Math.abs(title.y + title.height / 2 - (badge.y + badge.height / 2)),
        `${way.title} title beside its badge`,
      ).toBeLessThanOrEqual(2);
    }
    await expectInside(ingestEndpoint(page), wayInCard(page, "send"), "chip");

    // The pagination stays inside the card, under the empty state.
    const pagination: Locator = listCard.getByTestId("telemetry-pagination");
    await expectInside(pagination, listCard, "pagination");
    await expectAbove(root, pagination, "empty state above the pagination");

    await screenshot(page, "events-mobile");

    // Unfolded, the sidebar sits above the list at the same width.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(sidebar).toBeVisible();
    await expectAbove(sidebar, listCard, "filters above the list");
    const sidebarBox: Box = await documentBox(sidebar);
    expect(
      Math.abs(sidebarBox.width - main.width),
      "filters as wide as the list",
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs((await documentBox(listCard)).width - list.width),
      "list keeps its width",
    ).toBeLessThanOrEqual(1);
    await expect(root).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(sidebar).toBeHidden();
  });
});
