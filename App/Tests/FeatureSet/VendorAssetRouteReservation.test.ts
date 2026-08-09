import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The App container answers "/" with the dashboard SPA on any install with
 * billing off - which is every self-hosted one. Its fallback hands back the
 * dashboard's index page, HTTP 200, Content-Type text/html, for anything that
 * reaches it.
 *
 * That is the worst possible answer for a missing stylesheet or script: a
 * <script> given HTML fires onload rather than onerror, so the docs' lazy
 * highlight.js grammar loader (App/FeatureSet/Docs/Views/Partials/Head.ejs)
 * counts it as loaded and quietly highlights nothing. Nothing logs, nothing
 * 404s, and the page looks like it worked.
 *
 * mountVendorAssets terminates its own prefix with a 404, so this list is the
 * second line of defence - it matters if that mount ever moves after
 * FrontendRoutes.init(), or if a service registers a catch-all earlier. The
 * arrays are module-private, so this reads the source the same way
 * StripeOfflineLoading.test.ts does.
 */

const FRONTEND_INDEX: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Frontend",
  "Index.ts",
);

const VENDOR_ASSETS_ROUTE: string = "/oneuptime-assets";

function arrayLiteral(name: string): Array<string> {
  const source: string = fs.readFileSync(FRONTEND_INDEX, "utf8");

  const declaration: RegExpMatchArray | null = source.match(
    new RegExp(`const ${name}: Array<string> = \\[([\\s\\S]*?)\\n\\];`),
  );

  if (!declaration || !declaration[1]) {
    return [];
  }

  return (declaration[1].match(/"([^"]+)"/g) || []).map(
    (entry: string): string => {
      return entry.replace(/"/g, "");
    },
  );
}

describe("the vendored-asset prefix is reserved against the SPA fallbacks", () => {
  const lists: Array<string> = [
    "DashboardFallbackRoutePrefixesToSkip",
    "StatusPageDomainFallbackRoutePrefixesToSkip",
  ];

  for (const list of lists) {
    describe(list, () => {
      const entries: Array<string> = arrayLiteral(list);

      test("was found and parsed", () => {
        /*
         * A rename would otherwise make the assertion below vacuous rather
         * than failing.
         */
        expect(entries.length).toBeGreaterThan(3);
      });

      test(`reserves ${VENDOR_ASSETS_ROUTE}`, () => {
        expect(entries).toContain(VENDOR_ASSETS_ROUTE);
      });
    });
  }

  test("matches the route the server actually mounts", () => {
    /*
     * Two files have to agree on this string. Reading it out of VendorAssets.ts
     * rather than repeating the literal means renaming the route fails here
     * instead of silently un-reserving the prefix.
     */
    const vendorAssets: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Common",
        "Server",
        "Utils",
        "VendorAssets.ts",
      ),
      "utf8",
    );

    const route: RegExpMatchArray | null = vendorAssets.match(
      /VendorAssetsRoute: string = "([^"]+)"/,
    );

    expect(route?.[1]).toBe(VENDOR_ASSETS_ROUTE);
  });

  test("the fallback matches on prefix, so reserving the parent is enough", () => {
    /*
     * The skip predicate is `path === prefix || path.startsWith(prefix + "/")`.
     * If that ever became an exact match, the entry above would stop covering
     * /oneuptime-assets/tailwind/... and the reservation would be decorative.
     */
    const source: string = fs.readFileSync(FRONTEND_INDEX, "utf8");

    expect(source).toContain("path.startsWith(`${prefix}/`)");
  });
});
