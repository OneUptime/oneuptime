import { describe, expect, it } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";

const INDEX_TEMPLATE: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "StatusPage",
  "views",
  "index.ejs",
);

const STORAGE_KEY: string = "oneuptime-status-page-login-code";

function renderIndexPage(enableGoogleTagManager: boolean): string {
  return ejs.render(
    fs.readFileSync(INDEX_TEMPLATE, "utf8"),
    {
      title: "Acme Status",
      enableGoogleTagManager,
    },
    // The template includes the shared sensitive-URL-token partial.
    { filename: INDEX_TEMPLATE },
  );
}

function loadPage(url: string, existingCode?: string): JSDOM {
  return new JSDOM(renderIndexPage(true), {
    url,
    runScripts: "dangerously",
    beforeParse: (pageWindow: JSDOM["window"]): void => {
      (pageWindow as any).tailwind = { config: {} };

      if (existingCode) {
        pageWindow.sessionStorage.setItem(STORAGE_KEY, existingCode);
      }
    },
  });
}

describe("Status Page login-code head bootstrap", () => {
  it("runs before every external script and declares a no-referrer policy", () => {
    const html: string = renderIndexPage(true);
    const bootstrap: number = html.indexOf(`var storageKey = "${STORAGE_KEY}"`);
    const firstExternalScript: number = html.indexOf(
      '<script src="/status-page/env.js">',
    );

    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
    expect(bootstrap).toBeGreaterThan(-1);
    expect(firstExternalScript).toBeGreaterThan(bootstrap);
  });

  it("captures and removes the code and legacy token before page scripts run", () => {
    const page: JSDOM = loadPage(
      "https://status.example/incidents?keep=yes&loginCode=single-use-code&token=legacy#event",
    );

    expect(page.window.location.href).toBe(
      "https://status.example/incidents?keep=yes#event",
    );
    expect(page.window.sessionStorage.getItem(STORAGE_KEY)).toBe(
      "single-use-code",
    );
    expect(
      (page.window as any).__ONEUPTIME_STATUS_PAGE_LOGIN_HANDOFF_PENDING__,
    ).toBe(true);
    page.window.close();
  });

  /*
   * A status page belongs to OneUptime's customer, and its visitors are not
   * OneUptime's to measure - so no Google tag loads on one at all, whether a
   * bearer code is in flight or not. That is stronger than the guard this
   * replaced, which held the Tag Manager container back only while a code was
   * pending and loaded it on every other visit.
   */
  it.each([
    [
      "while a bearer code is pending",
      "https://status.example/?loginCode=single-use-code",
      undefined,
    ],
    ["on an ordinary visit", "https://status.example/", undefined],
    [
      "after a reload, before React consumes the stored code",
      "https://status.example/",
      "stored-single-use-code",
    ],
  ])(
    "loads no Google tag %s",
    (_label: string, url: string, existingCode: string | undefined) => {
      const page: JSDOM = loadPage(url, existingCode);

      expect((page.window as any).dataLayer).toBeUndefined();
      expect((page.window as any).gtag).toBeUndefined();
      expect(
        page.window.document.querySelector(
          'script[src*="googletagmanager.com"]',
        ),
      ).toBeNull();
      page.window.close();
    },
  );

  it("keeps a stored code for React to consume after a reload", () => {
    const page: JSDOM = loadPage(
      "https://status.example/",
      "stored-single-use-code",
    );

    expect(page.window.sessionStorage.getItem(STORAGE_KEY)).toBe(
      "stored-single-use-code",
    );
    expect(
      (page.window as any).__ONEUPTIME_STATUS_PAGE_LOGIN_HANDOFF_PENDING__,
    ).toBe(true);
    page.window.close();
  });

  it("switches off the product's own analytics", () => {
    const page: JSDOM = loadPage("https://status.example/");

    expect((page.window as any).oneUptimeProductAnalyticsDisabled).toBe(true);
    page.window.close();
  });
});
