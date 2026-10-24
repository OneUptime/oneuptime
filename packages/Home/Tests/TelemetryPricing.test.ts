import Pricing from "../Utils/Pricing";
import { getPageSEO, PageSEOData } from "../Utils/PageSEO";
import { markupAsSpaces } from "../../Common/Tests/Helpers/HtmlText";
import {
  TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS,
  TELEMETRY_PRICE_IN_USD_PER_GB,
  TELEMETRY_PRICE_RETENTION_IN_DAYS,
} from "Common/Types/Billing/PayAsYouGoPricing";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ejs, { IncluderResult } from "ejs";
import { DOMWindow, JSDOM, VirtualConsole } from "jsdom";
import path from "path";

// The pricing page is long: rendering it and running it in jsdom takes time.
jest.setTimeout(60000);

/*
 * The pricing page's telemetry panel and its price calculator. Logs,
 * traces, metrics, profiles and security events are billed for at least 7
 * days of retention (TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS): the
 * panel and the FAQ say so, and the calculator prices a shorter retention
 * as 7 days, exactly as the metered plans bill it.
 */

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");
const HOME_URL: string = "https://oneuptime.com";
const MINIMUM: number = TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS;

function textContent(html: string): string {
  return markupAsSpaces(html).replace(/\s+/g, " ").trim();
}

function pageLocals(): Record<string, unknown> {
  const seo: PageSEOData = getPageSEO("/pricing");

  // The locals Routes.ts hands the template, plus homeUrl.
  return {
    pricing: Pricing,
    enableGoogleTagManager: false,
    seo: { ...seo, fullCanonicalUrl: `${HOME_URL}/pricing` },
    homeUrl: HOME_URL,
  };
}

// What billing charges for a month's GB kept that many days, in dollars.
function billedPrice(gigabytes: number, days: number): string {
  const perGbPerDay: number =
    TELEMETRY_PRICE_IN_USD_PER_GB / TELEMETRY_PRICE_RETENTION_IN_DAYS;

  return `$${(gigabytes * Math.max(days, MINIMUM) * perGbPerDay).toFixed(2)}`;
}

describe("The rendered telemetry pricing", () => {
  let html: string = "";
  let telemetry: string = "";
  let script: string = "";

  beforeAll(async () => {
    html = (await ejs.renderFile(
      path.join(VIEWS_ROOT, "pricing.ejs"),
      pageLocals(),
      { views: [VIEWS_ROOT] },
    )) as string;

    telemetry =
      html.match(
        /<div\b[^>]*id="content-telemetry"[\s\S]*?(?=<div\b[^>]*id="content-ai-agent")/,
      )?.[0] || "";

    script =
      (html.match(/<script>[\s\S]*?<\/script>/g) || []).find(
        (block: string) => {
          return block.includes("function updateTelemetryPrice");
        },
      ) || "";
  });

  test("states the advertised price and the 7-day minimum", () => {
    const text: string = textContent(telemetry);

    expect(text).toContain(
      `We charge $${TELEMETRY_PRICE_IN_USD_PER_GB.toFixed(2)} for every GB of data ingested (for ${TELEMETRY_PRICE_RETENTION_IN_DAYS} day retention).`,
    );
    expect(text).toContain(
      `Retention is billed for at least ${MINIMUM} days: telemetry kept for fewer days is still deleted on time, and billed as ${MINIMUM} days.`,
    );
  });

  test("lets the retention slider go down to a day, and not to none", () => {
    const slider: string =
      telemetry.match(
        /<input\b[^>]*id="telemetry-retention-range"[^>]*>/,
      )?.[0] || "";

    expect(slider).toContain('min="1"');
    expect(slider).toContain('max="180"');
    expect(slider).toContain('value="15"');
    expect(slider).toContain('step="1"');
    expect(slider).toContain(
      'oninput="updateTelemetryPrice(null, this.value)"',
    );
    expect(slider).toContain(
      'onchange="updateTelemetryPrice(null, this.value)"',
    );
  });

  test("has a note for a retention under the minimum, hidden until it is chosen", () => {
    const note: string =
      telemetry.match(
        /<p\b[^>]*id="less-than-minimum-billable-retention-message"[^>]*>[\s\S]*?<\/p>/,
      )?.[0] || "";

    expect(note).toContain('style="display: none;"');
    expect(textContent(note)).toBe(
      `Retention shorter than ${MINIMUM} days is billed as ${MINIMUM} days.`,
    );
  });

  test("answers whether there is a minimum retention in the FAQ, session replay included", () => {
    const entry: string =
      (
        html.match(/<div class="pt-6">\s*<dt>[\s\S]*?<\/dd>\s*<\/div>/g) || []
      ).find((faq: string) => {
        return faq.includes("Is there a minimum telemetry retention?");
      }) || "";

    expect(entry).not.toBe("");

    const answer: string = textContent(
      entry.match(/<dd\b[^>]*>[\s\S]*?<\/dd>/)?.[0] || "",
    );

    expect(answer).toContain(
      `Logs, traces, metrics, profiles and security events are billed for at least ${MINIMUM} days of retention.`,
    );
    expect(answer).toContain(
      `a GB kept for fewer than ${MINIMUM} days is billed as if it were kept for ${MINIMUM}.`,
    );
    expect(answer).toContain(
      "Session replay recordings have no minimum: they are billed for the days they are kept.",
    );
  });

  test("prices with the rate and the minimum billing uses", () => {
    const rate: RegExpMatchArray | null = script.match(
      /const perGbPerDayPrice = ([\d.]+) \/ (\d+);/,
    );
    const minimum: RegExpMatchArray | null = script.match(
      /const minimumBillableDays = (\d+);/,
    );

    expect(Number(rate?.[1])).toBe(TELEMETRY_PRICE_IN_USD_PER_GB);
    expect(Number(rate?.[2])).toBe(TELEMETRY_PRICE_RETENTION_IN_DAYS);
    expect(Number(minimum?.[1])).toBe(MINIMUM);
    expect(script).toContain(
      "const billableDays = Math.max(numberOfDays, minimumBillableDays);",
    );
    expect(script).toContain(
      "const monthlyPrice = numberOfGb * billableDays * perGbPerDayPrice;",
    );
  });
});

interface OpenedPage {
  window: DOMWindow;
  document: Document;
  errors: Array<string>;
}

interface Readout {
  price: string;
  description: string;
  gigabytes: string;
  days: string;
  minimumNoteShown: boolean;
  sixMonthNoteShown: boolean;
  terabyteNoteShown: boolean;
}

let opened: OpenedPage | null = null;

afterEach(() => {
  opened?.window.close();
  opened = null;
});

function settle(): Promise<void> {
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, 20);
  });
}

/*
 * The pricing page with its own scripts run, as a browser runs them, and
 * every shared partial left out.
 */
let pageWithoutPartials: Promise<string> | null = null;

async function openPricingPage(): Promise<OpenedPage> {
  // Rendered once: every test runs it in a jsdom of its own.
  pageWithoutPartials =
    pageWithoutPartials ||
    (ejs.renderFile(path.join(VIEWS_ROOT, "pricing.ejs"), pageLocals(), {
      views: [VIEWS_ROOT],
      includer: (included: string): IncluderResult => {
        return { template: `<!-- ${included} -->` };
      },
    }) as Promise<string>);

  const html: string = await pageWithoutPartials;
  const errors: Array<string> = [];
  const virtualConsole: VirtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error: Error) => {
    errors.push(`script error: ${error.message}`);
  });

  const dom: JSDOM = new JSDOM(html, {
    url: `${HOME_URL}/pricing`,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse: (window: DOMWindow): void => {
      // The cookie banner's, from a partial left out.
      (window as unknown as { checkCookies: () => void }).checkCookies =
        (): void => {};
    },
  });

  await settle();

  opened = { window: dom.window, document: dom.window.document, errors };

  return opened;
}

// Drags a slider to a value, as a person would: the input event follows.
function slide(page: OpenedPage, id: string, value: number): void {
  const slider: HTMLInputElement = page.document.getElementById(
    id,
  ) as HTMLInputElement;

  slider.value = String(value);
  slider.dispatchEvent(new page.window.Event("input", { bubbles: true }));
}

function shown(page: OpenedPage, id: string): boolean {
  return (
    (page.document.getElementById(id) as HTMLElement).style.display === "block"
  );
}

function readout(page: OpenedPage): Readout {
  const text: (id: string) => string = (id: string): string => {
    return (page.document.getElementById(id)?.textContent || "").trim();
  };

  return {
    price: text("total-telemetry-price"),
    description: text("total-telemetry-price-description"),
    gigabytes: text("total-number-of-gb-ingested"),
    days: text("data-retention-in-days"),
    minimumNoteShown: shown(
      page,
      "less-than-minimum-billable-retention-message",
    ),
    sixMonthNoteShown: shown(page, "more-than-6-months-retention"),
    terabyteNoteShown: shown(page, "more-than-10-tb-ingested-message"),
  };
}

describe("The telemetry price calculator", () => {
  test("opens on 1 GB kept for 15 days at the advertised price", async () => {
    const page: OpenedPage = await openPricingPage();

    expect(readout(page)).toEqual({
      price: "$0.10",
      description: "per GB ingested (15 day retention)",
      gigabytes: "1 GB",
      days: "15 Days",
      minimumNoteShown: false,
      sixMonthNoteShown: false,
      terabyteNoteShown: false,
    });
    expect(page.errors).toEqual([]);
  });

  test("prices 15 days at the advertised $0.10 per GB", async () => {
    const page: OpenedPage = await openPricingPage();

    slide(page, "telemetry-retention-range", 15);

    expect(readout(page)).toMatchObject({
      price: "$0.10",
      description: "for 1 GB ingested, retained for 15 days.",
      days: "15 Days",
      minimumNoteShown: false,
    });
  });

  test("prices 3 days as 7, says so, and shows the note", async () => {
    const page: OpenedPage = await openPricingPage();

    slide(page, "telemetry-retention-range", 3);

    expect(readout(page)).toMatchObject({
      price: billedPrice(1, 7),
      description: "for 1 GB ingested, retained for 3 days (billed as 7 days).",
      days: "3 Days",
      minimumNoteShown: true,
    });
    expect(billedPrice(1, 7)).toBe("$0.05");
  });

  test("writes a single day as a day, priced as 7", async () => {
    const page: OpenedPage = await openPricingPage();

    slide(page, "telemetry-retention-range", 1);

    expect(readout(page)).toMatchObject({
      price: "$0.05",
      description: "for 1 GB ingested, retained for 1 day (billed as 7 days).",
      days: "1 Day",
      minimumNoteShown: true,
    });
  });

  test("cannot be dragged below a day", async () => {
    const page: OpenedPage = await openPricingPage();

    slide(page, "telemetry-retention-range", 0);

    expect(
      (
        page.document.getElementById(
          "telemetry-retention-range",
        ) as HTMLInputElement
      ).value,
    ).toBe("1");
    expect(readout(page)).toMatchObject({
      days: "1 Day",
      description: "for 1 GB ingested, retained for 1 day (billed as 7 days).",
    });
  });

  test("prices exactly 7 days as 7, with no note", async () => {
    const page: OpenedPage = await openPricingPage();

    slide(page, "telemetry-retention-range", 7);

    expect(readout(page)).toMatchObject({
      price: "$0.05",
      description: "for 1 GB ingested, retained for 7 days.",
      days: "7 Days",
      minimumNoteShown: false,
    });
  });

  test("hides the note again once the retention is back over the minimum", async () => {
    const page: OpenedPage = await openPricingPage();

    slide(page, "telemetry-retention-range", 2);
    expect(readout(page).minimumNoteShown).toBe(true);

    slide(page, "telemetry-retention-range", 10);
    expect(readout(page)).toMatchObject({
      price: billedPrice(1, 10),
      description: "for 1 GB ingested, retained for 10 days.",
      minimumNoteShown: false,
    });
  });

  test("keeps the minimum when the volume changes", async () => {
    const page: OpenedPage = await openPricingPage();

    slide(page, "telemetry-retention-range", 6);
    slide(page, "telemetry-gb-range", 100);

    expect(readout(page)).toMatchObject({
      price: "$4.67",
      description:
        "for 100 GB ingested, retained for 6 days (billed as 7 days).",
      gigabytes: "100 GB",
      minimumNoteShown: true,
    });

    slide(page, "telemetry-retention-range", 8);

    expect(readout(page)).toMatchObject({
      price: "$5.33",
      description: "for 100 GB ingested, retained for 8 days.",
      minimumNoteShown: false,
    });
  });

  test("still points the largest volumes and retentions at sales", async () => {
    const page: OpenedPage = await openPricingPage();

    slide(page, "telemetry-gb-range", 1000);
    slide(page, "telemetry-retention-range", 180);

    expect(readout(page)).toMatchObject({
      price: "$1200.00",
      description: "for 1000 GB ingested, retained for 180 days.",
      sixMonthNoteShown: true,
      terabyteNoteShown: true,
      minimumNoteShown: false,
    });
  });

  test("quotes what billing charges, for every retention the slider offers", async () => {
    const page: OpenedPage = await openPricingPage();
    const mismatches: Array<string> = [];

    for (const gigabytes of [1, 10, 250, 1000]) {
      slide(page, "telemetry-gb-range", gigabytes);

      for (let days: number = 1; days <= 180; days++) {
        slide(page, "telemetry-retention-range", days);

        const quoted: string = readout(page).price;

        if (quoted !== billedPrice(gigabytes, days)) {
          mismatches.push(
            `${gigabytes} GB, ${days} days: ${quoted}, billed ${billedPrice(gigabytes, days)}`,
          );
        }
      }
    }

    expect(mismatches).toEqual([]);
    expect(page.errors).toEqual([]);
  });
});
