import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { ProductBranding } from "Common/Types/Branding/ProductBranding";
import { JSONObject } from "Common/Types/JSON";
import { getBrandedDashboardManifest } from "../../FeatureSet/Frontend/BrandedManifest";

/*
 * The Dashboard's web app manifest - what a browser shows when the
 * Dashboard is installed as an app - for an installation that names or shows
 * itself its own way. Built from the real public/manifest.json.
 *
 * Without branding, or with one that changes neither the name nor the
 * browser tab icon, there is nothing to build: the server serves the static
 * file exactly as before (Frontend/Index.ts, registerBrandedDashboardManifest).
 */

const APP_ROOT: string = path.resolve(__dirname, "..", "..");

const MANIFEST_FILE: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Dashboard",
  "public",
  "manifest.json",
);

const readManifest: () => JSONObject = (): JSONObject => {
  return JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8")) as JSONObject;
};

const ONEUPTIME_WORD: RegExp = /\bOneUptime\b/;

describe("getBrandedDashboardManifest", () => {
  test.each([
    ["no branding", null],
    ["an empty branding", {}],
    ["a logo alone", { logoUrl: "/api/branding/logo?v=1" }],
    ["a website alone", { websiteUrl: "https://acme.example" }],
    ["the name OneUptime", { productName: "OneUptime" }],
  ])(
    "%s: nothing to build, the static file is served",
    (_label: string, branding: ProductBranding | null) => {
      expect(getBrandedDashboardManifest(readManifest(), branding)).toBeNull();
    },
  );

  describe("a renamed installation", () => {
    const manifest: JSONObject = readManifest();
    const branded: JSONObject = getBrandedDashboardManifest(manifest, {
      productName: "Acme",
    })!;

    test("is named after it", () => {
      expect(branded["name"]).toBe("Acme");
      expect(branded["short_name"]).toBe("Acme");
    });

    test("never names OneUptime in what people read", () => {
      const readable: Array<unknown> = [
        branded["name"],
        branded["short_name"],
        branded["description"],
        ...((branded["shortcuts"] as Array<JSONObject>) || []).flatMap(
          (shortcut: JSONObject) => {
            return [
              shortcut["name"],
              shortcut["short_name"],
              shortcut["description"],
            ];
          },
        ),
      ];

      for (const text of readable) {
        if (typeof text === "string") {
          expect(text).not.toMatch(ONEUPTIME_WORD);
        }
      }

      expect(
        ((branded["shortcuts"] as Array<JSONObject>) || [])[0]?.["name"],
      ).toBe("Acme Dashboard");
    });

    test("leaves out OneUptime's screenshots, app rating and domain", () => {
      expect(manifest["screenshots"]).toBeDefined();
      expect(branded["screenshots"]).toBeUndefined();
      expect(branded["iarc_rating_id"]).toBeUndefined();
      expect(branded["scope_extensions"]).toBeUndefined();
    });

    test("stays the same installed app: its id, start URL and scope", () => {
      expect(branded["id"]).toBe(manifest["id"]);
      expect(branded["start_url"]).toBe(manifest["start_url"]);
      expect(branded["scope"]).toBe(manifest["scope"]);
    });

    test("keeps OneUptime's icons when it has no icon of its own", () => {
      expect(branded["icons"]).toEqual(manifest["icons"]);
    });

    test("does not change the file it was built from", () => {
      expect(manifest).toEqual(readManifest());
    });
  });

  describe("a browser tab icon of its own", () => {
    test("is the app's only icon, and every shortcut's", () => {
      const branded: JSONObject = getBrandedDashboardManifest(readManifest(), {
        faviconUrl: "/api/branding/favicon?v=1",
      })!;

      expect(branded["icons"]).toEqual([
        { src: "/api/branding/favicon?v=1", sizes: "any", purpose: "any" },
      ]);

      for (const shortcut of branded["shortcuts"] as Array<JSONObject>) {
        expect(shortcut["icons"]).toEqual([
          { src: "/api/branding/favicon?v=1", sizes: "any" },
        ]);
      }
    });

    test("without a name of its own, the app keeps OneUptime's name", () => {
      const manifest: JSONObject = readManifest();
      const branded: JSONObject = getBrandedDashboardManifest(manifest, {
        faviconUrl: "/api/branding/favicon?v=1",
      })!;

      expect(branded["name"]).toBe(manifest["name"]);
      expect(branded["short_name"]).toBe(manifest["short_name"]);
      expect(branded["iarc_rating_id"]).toBe(manifest["iarc_rating_id"]);
    });
  });
});

describe("the server's manifest route", () => {
  const source: string = fs.readFileSync(
    path.join(APP_ROOT, "FeatureSet", "Frontend", "Index.ts"),
    "utf8",
  );

  test("serves the built manifest only when there is one, and the static file otherwise", () => {
    expect(source).toContain(
      'app.get(\n    ["/dashboard/manifest.json", "/manifest.json"],',
    );
    expect(source).toContain("EnterpriseEdition.getProductBranding()");
    expect(source).toContain("if (!branded) {\n          return next();");
    expect(source).toContain(
      'res.set("Content-Type", "application/manifest+json; charset=utf-8");',
    );
  });

  test("is registered ahead of the Dashboard's static files and root PWA files", () => {
    const init: string = source.slice(source.indexOf("const init"));
    const registered: number = init.indexOf(
      "  registerBrandedDashboardManifest();",
    );

    expect(registered).toBeGreaterThan(-1);
    expect(
      init.indexOf("registerFrontendApp(DashboardFrontendConfig);"),
    ).toBeGreaterThan(registered);
    expect(init.indexOf("registerDashboardRootPwaFiles();")).toBeGreaterThan(
      registered,
    );
  });
});
