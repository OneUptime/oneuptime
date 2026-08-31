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
  return ejs.render(fs.readFileSync(INDEX_TEMPLATE, "utf8"), {
    title: "Acme Status",
    enableGoogleTagManager,
  });
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

  it("does not start Google Tag Manager while a bearer code is pending", () => {
    const page: JSDOM = loadPage(
      "https://status.example/?loginCode=single-use-code",
    );

    expect((page.window as any).dataLayer).toBeUndefined();
    expect(
      page.window.document.querySelector(
        'script[src^="https://www.googletagmanager.com/gtm.js"]',
      ),
    ).toBeNull();
    page.window.close();
  });

  it("keeps analytics enabled on ordinary status-page visits", () => {
    const page: JSDOM = loadPage("https://status.example/");

    expect((page.window as any).dataLayer).toHaveLength(1);
    page.window.close();
  });

  it("continues suppressing analytics after a reload until React consumes the stored code", () => {
    const page: JSDOM = loadPage(
      "https://status.example/",
      "stored-single-use-code",
    );

    expect((page.window as any).dataLayer).toBeUndefined();
    expect(page.window.sessionStorage.getItem(STORAGE_KEY)).toBe(
      "stored-single-use-code",
    );
    page.window.close();
  });
});
