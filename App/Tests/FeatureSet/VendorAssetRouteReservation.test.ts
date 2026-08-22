import { describe, expect, test } from "@jest/globals";
import {
  DashboardFallbackRoutePrefixesToSkip,
  StatusPageDomainFallbackRoutePrefixesToSkip,
  isRouteReservedAgainstSpaFallback,
} from "../../FeatureSet/Frontend/RouteReservations";
import { APP_DIR, REPO_ROOT, readSource } from "./RouteReservationSource";

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
 * FrontendRoutes.init(), or if a service registers a catch-all earlier.
 *
 * The lists are imported from FeatureSet/Frontend/RouteReservations.ts rather
 * than scraped out of the source: this file used to read them with a regex
 * that harvested every quoted string inside the array literal, which also
 * picked up paths quoted in the surrounding comments. That parser reported
 * more prefixes than the array had entries and would have stayed green
 * through the very deletion it exists to catch.
 */

const VENDOR_ASSETS_ROUTE: string = "/oneuptime-assets";

describe("the vendored-asset prefix is reserved against the SPA fallbacks", () => {
  const lists: Array<[string, Array<string>]> = [
    [
      "DashboardFallbackRoutePrefixesToSkip",
      DashboardFallbackRoutePrefixesToSkip,
    ],
    [
      "StatusPageDomainFallbackRoutePrefixesToSkip",
      StatusPageDomainFallbackRoutePrefixesToSkip,
    ],
  ];

  for (const [name, entries] of lists) {
    describe(name, () => {
      test("is a non-trivial list of absolute prefixes", () => {
        // Guards every assertion below from passing against an empty list.
        expect(entries.length).toBeGreaterThan(3);
        expect(
          entries.every((entry: string): boolean => {
            return entry.startsWith("/") && entry !== "/";
          }),
        ).toBe(true);
      });

      test(`reserves ${VENDOR_ASSETS_ROUTE}`, () => {
        expect(entries).toContain(VENDOR_ASSETS_ROUTE);
      });

      test(`reserves assets below ${VENDOR_ASSETS_ROUTE}, not just the bare prefix`, () => {
        expect(
          isRouteReservedAgainstSpaFallback(
            entries,
            `${VENDOR_ASSETS_ROUTE}/tailwind/tailwind.min.css`,
          ),
        ).toBe(true);
      });
    });
  }

  test("matches the route the server actually mounts", () => {
    /*
     * Two files have to agree on this string. Reading it out of VendorAssets.ts
     * rather than repeating the literal means renaming the route fails here
     * instead of silently un-reserving the prefix.
     */
    const vendorAssets: string = readSource(
      REPO_ROOT,
      "Common",
      "Server",
      "Utils",
      "VendorAssets.ts",
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
    const source: string = readSource(
      APP_DIR,
      "FeatureSet",
      "Frontend",
      "RouteReservations.ts",
    );

    expect(source).toContain("path.startsWith(`${prefix}/`)");

    // And prove it by behaviour, not only by the shape of the source.
    expect(
      isRouteReservedAgainstSpaFallback(
        [VENDOR_ASSETS_ROUTE],
        `${VENDOR_ASSETS_ROUTE}/x.css`,
      ),
    ).toBe(true);
    expect(
      isRouteReservedAgainstSpaFallback(
        [VENDOR_ASSETS_ROUTE],
        `${VENDOR_ASSETS_ROUTE}-other/x.css`,
      ),
    ).toBe(false);
  });
});
