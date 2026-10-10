import {
  Download,
  expect,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import zlib from "zlib";

/*
 * Issue #4616: Export PDF on the network topology map, in a real browser,
 * with the real jsPDF the dashboard loads on demand. The fixture (see
 * Fixture.js and README.md) fakes only the API; the page, the map, the
 * export's layout and the library are production code, so the file these
 * tests open is the file a customer downloads.
 *
 * The PDF is read back here without a PDF library: every content stream is
 * inflated and its text operators are decoded, which is enough to check that
 * the whole map is in the file — every device and link, the legend, the
 * header — and that it is drawn as vectors rather than pasted as a picture.
 */

const ROUTE: string =
  "/dashboard/10000000-0000-4000-8000-000000000001/topology/overview";
const OUTPUT: string = path.resolve(
  __dirname,
  "../../../output/playwright/topology/pdf",
);

// The fixture's own clock (TopologyExperience pins the same day).
const NOW: string = "2026-09-07T10:00:00Z";

const pageErrors: Map<Page, Array<string>> = new Map();

interface PdfContents {
  bytes: Buffer;
  pageCount: number;
  // [width, height] of every page, in points.
  pageSizes: Array<[number, number]>;
  // Every string drawn with a text operator, in drawing order.
  texts: Array<string>;
  // The page content streams, inflated, joined.
  content: string;
}

const STREAM: RegExp = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
const TEXT_OPERATOR: RegExp = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
const MEDIA_BOX: RegExp = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g;
const PAGE_OBJECT: RegExp = /\/Type\s*\/Page(?!s)/g;
const OCTAL_ESCAPE: RegExp = /\\([0-7]{1,3})/g;
const CHARACTER_ESCAPE: RegExp = /\\(.)/g;
const IMAGE_XOBJECT: RegExp = /\/Subtype\s*\/Image/;
// PDF path operators: move, line, curve, and fill-and-stroke or fill.
const PATH_MOVE: RegExp = /[\d.] m\n/;
const PATH_LINE: RegExp = /[\d.] l\n/;
const PATH_CURVE: RegExp = /[\d.] c\n/;
const PATH_PAINT: RegExp = /\n(B|f)\n/;
// A graphics state drawing at 20% (/ca is fill opacity) and its use on a page.
const FADED_GRAPHICS_STATE: RegExp = /\/ca\s+0?\.2\b/;
const GRAPHICS_STATE_OPERATOR: RegExp = /\/GS\d+ gs/;

function decodePdfString(raw: string): string {
  return raw
    .replace(OCTAL_ESCAPE, (_match: string, octal: string): string => {
      return String.fromCharCode(parseInt(octal, 8));
    })
    .replace(CHARACTER_ESCAPE, (_match: string, character: string): string => {
      const named: Record<string, string> = { n: "\n", r: "\r", t: "\t" };
      return named[character] ?? character;
    });
}

function readPdf(bytes: Buffer): PdfContents {
  const latin1: string = bytes.toString("latin1");
  const contents: Array<string> = [];
  for (const match of latin1.matchAll(STREAM)) {
    const raw: Buffer = Buffer.from(match[1] || "", "latin1");
    try {
      contents.push(zlib.inflateSync(raw).toString("latin1"));
    } catch {
      contents.push(raw.toString("latin1"));
    }
  }
  const content: string = contents.join("\n");
  const texts: Array<string> = [];
  for (const match of content.matchAll(TEXT_OPERATOR)) {
    texts.push(decodePdfString(match[1] || ""));
  }
  const pageSizes: Array<[number, number]> = [];
  for (const match of latin1.matchAll(MEDIA_BOX)) {
    pageSizes.push([Number(match[1]), Number(match[2])]);
  }
  return {
    bytes: bytes,
    pageCount: (latin1.match(PAGE_OBJECT) || []).length,
    pageSizes: pageSizes,
    texts: texts,
    content: content,
  };
}

async function openNetwork(page: Page, query: string = ""): Promise<void> {
  await page.goto(`${ROUTE}?tab=Network${query ? `&${query}` : ""}`);
  await expect(page.getByTestId("topology-hierarchy-grid")).toBeVisible();
}

async function openLondon(page: Page, query: string = ""): Promise<void> {
  await openNetwork(page, query);
  await page.getByTestId("site-card-london").click();
  await expect(
    page.locator('[data-testid^="network-topology-node-"]'),
  ).toHaveCount(7);
}

function exportButton(page: Page): ReturnType<Page["getByRole"]> {
  return page.getByRole("button", { name: "Export PDF", exact: true });
}

async function exportPdf(
  page: Page,
  name: string,
): Promise<{ download: Download; pdf: PdfContents }> {
  const downloadEvent: Promise<Download> = page.waitForEvent("download", {
    timeout: 90000,
  });
  await exportButton(page).click();
  const download: Download = await downloadEvent;
  await fs.mkdir(OUTPUT, { recursive: true });
  const saved: string = path.join(OUTPUT, `${name}-synthetic.pdf`);
  await download.saveAs(saved);
  const pdf: PdfContents = readPdf(await fs.readFile(saved));
  // The button is ready for the next export once the file has been handed over.
  await expect(exportButton(page)).toBeEnabled();
  return { download: download, pdf: pdf };
}

test.beforeEach(async ({ page }: { page: Page }) => {
  pageErrors.set(page, []);
  page.on("pageerror", (error: Error): void => {
    pageErrors.get(page)!.push(error.message);
  });
  await page.clock.setFixedTime(new Date(NOW));
  // Offline: nothing but the fixture server is reachable.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (
      target.protocol === "http:" &&
      target.hostname === "127.0.0.1" &&
      target.port === "4199"
    ) {
      await route.continue();
    } else {
      await route.abort();
    }
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "No uncaught browser errors").toEqual([]);
  pageErrors.delete(page);
});

test("Export PDF downloads a site's whole map, named after the site", async ({
  page,
}: {
  page: Page;
}) => {
  await openLondon(page);
  await expect(exportButton(page)).toBeEnabled();
  const { download, pdf } = await exportPdf(page, "network-map");

  expect(download.suggestedFilename()).toBe(
    "network-topology-london-office-2026-09-07T10-00-00.pdf",
  );
  expect(pdf.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(pdf.pageCount).toBeGreaterThanOrEqual(2);
  expect(pdf.pageSizes).toHaveLength(pdf.pageCount);

  // The header: what, where, when.
  expect(pdf.texts).toContain("NETWORK TOPOLOGY");
  expect(pdf.texts).toContain("London office");
  expect(pdf.texts.join(" ")).toContain("Exported Sep 07 2026");
  expect(pdf.texts).toContain("7 devices");
  expect(pdf.texts).toContain("6 connections");

  // Every device, by name, with its status, type and kind, in the table.
  for (const name of [
    "London edge router",
    "London core switch",
    "Office access switch",
    "Backup firewall",
    "Reception phone",
    "Design workstation",
    "Office printer",
  ]) {
    expect(pdf.texts).toContain(name);
  }
  expect(pdf.texts).toContain("Devices (7)");
  expect(pdf.texts).toContain("Connections (6)");
  for (const word of [
    "Up",
    "Down",
    "Unknown",
    "Managed device",
    "Unmanaged peer",
    "Endpoint",
    "Router",
    "Switch",
    "Firewall",
  ]) {
    expect(pdf.texts).toContain(word);
  }
  // Connections with their ports and how they were found.
  expect(pdf.texts).toContain("Gi1/0/3");
  expect(pdf.texts).toContain("port1");
  expect(pdf.texts).toContain("LLDP");

  // The legend, as the map draws it.
  for (const label of [
    "Healthy",
    "Busy (over 80%)",
    "An end is down",
    "Learned from FDB",
    "Discovered endpoint",
  ]) {
    expect(pdf.texts).toContain(label);
  }

  // Every page numbered.
  for (let pageNumber: number = 1; pageNumber <= pdf.pageCount; pageNumber++) {
    expect(pdf.texts).toContain(`Page ${pageNumber} of ${pdf.pageCount}`);
  }

  /*
   * Vectors, not a screenshot: no image anywhere, and the map drawn as paths
   * — moves, lines and Bézier curves, filled and stroked.
   */
  expect(pdf.bytes.toString("latin1")).not.toMatch(IMAGE_XOBJECT);
  for (const operator of [PATH_MOVE, PATH_LINE, PATH_CURVE, PATH_PAINT]) {
    expect(pdf.content).toMatch(operator);
  }
});

test("the PDF is the map as the reader filtered it", async ({
  page,
}: {
  page: Page;
}) => {
  await openLondon(page);
  await page.getByRole("button", { name: /Map options/ }).click();
  await page
    .getByRole("button", { name: "Discovered neighbors", exact: true })
    .click();
  await expect(
    page.locator('[data-testid^="network-topology-node-"]'),
  ).toHaveCount(6);
  const { pdf } = await exportPdf(page, "network-map-filtered");
  expect(pdf.texts).not.toContain("Reception phone");
  expect(pdf.texts).toContain("Devices (6)");
  expect(pdf.texts.join(" ")).toContain(
    "Filtered view: Hidden: Discovered neighbors.",
  );
});

test("a search fades the other devices in the PDF too, see-through as on screen", async ({
  page,
}: {
  page: Page;
}) => {
  await openLondon(page);
  await page
    .getByRole("textbox", { name: "Find a network device" })
    .fill("switch");
  const { pdf } = await exportPdf(page, "network-map-search");
  expect(pdf.texts.join(" ")).toContain(
    'Filtered view: Search: "switch". Faded devices are shown for context.',
  );
  // Every device is still on the page and in the table...
  expect(pdf.texts).toContain("Devices (7)");
  /*
   * ...and the faded ones are drawn through PDF transparency (a graphics
   * state at the canvas's 20%), so a link under one still shows.
   */
  const latin1: string = pdf.bytes.toString("latin1");
  expect(latin1).toMatch(FADED_GRAPHICS_STATE);
  expect(pdf.content).toMatch(GRAPHICS_STATE_OPERATOR);
});

test("a PDF exported in dark mode is the same light document", async ({
  page,
}: {
  page: Page;
}) => {
  await openLondon(page);
  const light: PdfContents = (await exportPdf(page, "network-map-light")).pdf;

  await openLondon(page, "theme=dark");
  await expect(page.locator("html")).toHaveClass(/dark/);
  const dark: PdfContents = (await exportPdf(page, "network-map-dark")).pdf;

  expect(dark.texts).toEqual(light.texts);
  expect(dark.pageSizes).toEqual(light.pageSizes);
  expect(dark.content).toBe(light.content);
  // Device names are drawn in the map's light-mode grey (#374151).
  expect(light.content).toContain("0.216 0.255 0.318 rg");
});

test("the map of every device shows the devices with no links, and a large network exports without freezing the page", async ({
  page,
}: {
  page: Page;
}) => {
  test.setTimeout(240000);
  await openNetwork(page, "network=large");
  await page.getByTestId("topology-hierarchy-scope-devices").click();
  await expect(page.getByTestId("network-topology-graph")).toBeVisible({
    timeout: 120000,
  });
  await expect(page.getByTestId("network-topology-visible-count")).toHaveText(
    "Showing 1203 of 1203 devices",
    { timeout: 120000 },
  );

  /*
   * Watch the frames the page paints between the click and the download.
   * An export that held the main thread from start to finish would paint
   * nothing in between, leaving one gap as long as the whole export. The
   * painter hands control back every few thousand items, so the page keeps
   * painting — the button keeps spinning — and no single gap comes close to
   * the whole export.
   */
  await page.evaluate((): void => {
    interface FrameLog {
      frames: Array<number>;
      start: number;
      end: number;
    }
    const log: FrameLog = { frames: [], start: 0, end: 0 };
    (window as unknown as { __exportFrames: FrameLog }).__exportFrames = log;
    document.addEventListener(
      "click",
      (event: MouseEvent): void => {
        const target: Element | null = event.target as Element | null;
        if (target?.closest?.("a[download]")) {
          log.end = performance.now();
        } else if (target?.closest?.("button")?.textContent === "Export PDF") {
          log.start = performance.now();
        }
      },
      true,
    );
    const tick: (time: number) => void = (time: number): void => {
      log.frames.push(time);
      if (!log.end) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  });
  const { download, pdf } = await exportPdf(page, "network-large");
  const timing: { total: number; longestGap: number; painted: number } =
    await page.evaluate(
      (): { total: number; longestGap: number; painted: number } => {
        const log: { frames: Array<number>; start: number; end: number } = (
          window as unknown as {
            __exportFrames: {
              frames: Array<number>;
              start: number;
              end: number;
            };
          }
        ).__exportFrames;
        const marks: Array<number> = [
          log.start,
          ...log.frames.filter((time: number): boolean => {
            return time > log.start && time < log.end;
          }),
          log.end,
        ];
        let longestGap: number = 0;
        for (let index: number = 1; index < marks.length; index++) {
          longestGap = Math.max(longestGap, marks[index]! - marks[index - 1]!);
        }
        return {
          total: log.end - log.start,
          longestGap: longestGap,
          painted: marks.length - 2,
        };
      },
    );
  /*
   * Measured on the fixture: the longest gap is about a quarter of the
   * export; with the painter's pauses removed it is four fifths of it.
   */
  expect(timing.total).toBeGreaterThan(0);
  expect(timing.painted).toBeGreaterThanOrEqual(3);
  expect(timing.longestGap).toBeLessThan(timing.total * 0.5);

  expect(download.suggestedFilename()).toMatch(
    /^network-topology-[a-z0-9-]+-2026-09-07T10-00-00\.pdf$/,
  );
  expect(pdf.texts).toContain("1,203 devices");
  expect(pdf.texts).toContain("Devices (1,203)");
  expect(pdf.texts).toContain("Connections (1,199)");
  // The strip of devices with no links, captioned as on screen.
  expect(pdf.texts).toContain("Not linked to anything (3)");
  for (const name of [
    "Spare core switch",
    "Lab router",
    "Unpatched firewall",
  ]) {
    expect(pdf.texts).toContain(name);
  }
  // Too large for A4 with legible names: the map page grows instead.
  const [width, height] = pdf.pageSizes[0]!;
  expect(Math.max(width, height)).toBeGreaterThan(842);
  expect(Math.max(width, height)).toBeLessThanOrEqual(14400);
  // The tables follow on A4.
  const [tableWidth, tableHeight] = pdf.pageSizes[1]!;
  expect([Math.round(tableWidth), Math.round(tableHeight)]).toEqual([842, 595]);
});

test("Export PDF fits on a phone", async ({ page }: { page: Page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLondon(page);
  await expect(exportButton(page)).toBeVisible();
  const box: { x: number; width: number } | null =
    await exportButton(page).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await expect
    .poll(
      async (): Promise<number> => {
        return page.evaluate((): number => {
          return document.documentElement.scrollWidth - window.innerWidth;
        });
      },
      { message: "The map and its header fit the phone" },
    )
    .toBeLessThanOrEqual(1);
});
