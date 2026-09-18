import { describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import path from "path";
import { VendorAssetsPath } from "../../../Server/Utils/VendorAssets";

/*
 * Renders the pages, rather than reading them.
 *
 * The static scan in OfflineAssetHygiene.test.ts reads each .ejs on its own,
 * so it cannot see what an include pulls in - and every one of these pages
 * gets its <head>, and therefore all of its assets, from a partial. Rendering
 * is the only way to assert on the HTML a browser is actually handed.
 *
 * These are also the pages where the failure hurts most: an on-call engineer
 * following an acknowledge link from the alert they were just paged by, and
 * someone completing an SSO round trip. Both come out of the App/API
 * container, which is what nginx routes "/" to on every install with billing
 * off.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

interface Page {
  label: string;
  viewPath: string;
  variables: Record<string, unknown>;
}

/*
 * Only the elements whose URL the browser goes and fetches while building the
 * page. A <meta property="og:image"> pointing at oneuptime.com, a schema.org
 * blob, and the acknowledge button's own <a href> all name absolute URLs and
 * none of them can hang a render - the acknowledge link in particular has to
 * be absolute, because it arrives by SMS.
 */
const SUBRESOURCE_ELEMENT: RegExp =
  /<(?:script|link|img|iframe|source|embed|object|video|audio)\b[^>]*>/gi;

const SUBRESOURCE_URL_ATTRIBUTE: RegExp =
  /(?:src|href|data)\s*=\s*["'](?:https?:)?\/\/([^/"']+)/i;

/*
 * Prefetch hints cost a DNS lookup and nothing else, but they are still a hint
 * at a host this page expects to talk to, so they count. rel=canonical and
 * rel=alternate are pure metadata and do not.
 */
const METADATA_ONLY_LINK: RegExp = /rel=["'](?:canonical|alternate)["']/i;

/* @import and background-image: url(...) fetch just as hard as a <link>. */
const CSS_URL: RegExp = /url\(\s*["']?(?:https?:)?\/\/([^/"')]+)/gi;

const PAGES: Array<Page> = [
  {
    label: "on-call acknowledge",
    viewPath: path.join(
      REPOSITORY_ROOT,
      "Common",
      "Server",
      "Views",
      "AcknowledgeUserOnCallNotification.ejs",
    ),
    variables: {
      title: "Acknowledge Incident - Database is down",
      message: "Do you want to acknowledge this Incident?",
      acknowledgeText: "Acknowledge Incident",
      acknowledgeUrl: "https://oneuptime.example.com/api/ack/1",
    },
  },
  {
    label: "on-call message",
    viewPath: path.join(
      REPOSITORY_ROOT,
      "Common",
      "Server",
      "Views",
      "ViewMessage.ejs",
    ),
    variables: {
      title: "Notification Already Acknowledged",
      message: "This notification has already been acknowledged.",
      viewDetailsText: "View Incident",
      viewDetailsUrl: "https://oneuptime.example.com/dashboard/incident/1",
    },
  },
  {
    label: "SSO message",
    viewPath: path.join(
      REPOSITORY_ROOT,
      "App",
      "FeatureSet",
      "Identity",
      "Views",
      "Message.ejs",
    ),
    variables: {
      title: "Single Sign On",
      message: "You have been logged out.",
    },
  },
];

function render(page: Page, extraVariables: Record<string, unknown>): string {
  return ejs.render(
    fs.readFileSync(page.viewPath, "utf8"),
    { ...page.variables, ...extraVariables },
    { filename: page.viewPath },
  );
}

function externalHostsFetchedBy(html: string): Array<string> {
  const hosts: Set<string> = new Set<string>();

  for (const element of html.match(SUBRESOURCE_ELEMENT) || []) {
    if (METADATA_ONLY_LINK.test(element)) {
      continue;
    }

    const url: RegExpMatchArray | null = element.match(
      SUBRESOURCE_URL_ATTRIBUTE,
    );

    if (url && url[1]) {
      hosts.add(url[1]);
    }
  }

  for (const match of html.matchAll(CSS_URL)) {
    if (match[1]) {
      hosts.add(match[1]);
    }
  }

  return Array.from(hosts).sort();
}

describe("the detector these pages are checked with", () => {
  /*
   * An assertion that a page fetches nothing off-box is only worth as much as
   * the thing doing the looking. Without this, a typo in the regex would make
   * every test in this file pass on a page full of CDN tags.
   */
  test("catches the exact tags this change removed", () => {
    expect(
      externalHostsFetchedBy(
        '<script src="https://cdn.tailwindcss.com"></script>',
      ),
    ).toEqual(["cdn.tailwindcss.com"]);

    expect(
      externalHostsFetchedBy(
        '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/vs2015.min.css">',
      ),
    ).toEqual(["cdnjs.cloudflare.com"]);

    expect(
      externalHostsFetchedBy(
        '<script src="//cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>',
      ),
    ).toEqual(["cdnjs.cloudflare.com"]);

    expect(
      externalHostsFetchedBy(
        '<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">',
      ),
    ).toEqual(["fonts.googleapis.com"]);

    expect(
      externalHostsFetchedBy(
        "<style>@font-face { src: url('https://fonts.gstatic.com/s/inter.woff2'); }</style>",
      ),
    ).toEqual(["fonts.gstatic.com"]);
  });

  test("ignores the absolute URLs a notification page legitimately carries", () => {
    expect(
      externalHostsFetchedBy(
        '<a href="https://oneuptime.example.com/api/ack/1">Acknowledge</a>',
      ),
    ).toEqual([]);

    expect(
      externalHostsFetchedBy(
        '<meta property="og:image" content="https://oneuptime.com/img/hou-wb.svg">',
      ),
    ).toEqual([]);

    expect(
      externalHostsFetchedBy(
        '<link rel="canonical" href="https://oneuptime.com/docs">',
      ),
    ).toEqual([]);
  });

  test("does not treat a local path as an external host", () => {
    expect(
      externalHostsFetchedBy(
        '<script src="/oneuptime-assets/tailwind/tailwind-3.4.5.js"></script>',
      ),
    ).toEqual([]);
  });
});

describe("server-rendered notification pages", () => {
  for (const page of PAGES) {
    describe(page.label, () => {
      describe("with the default Response.render supplies for a self-hosted install", () => {
        test("fetches nothing from another host", () => {
          expect(
            externalHostsFetchedBy(
              render(page, { enableGoogleTagManager: false }),
            ),
          ).toEqual([]);
        });

        test("loads Tailwind from this install", () => {
          expect(render(page, { enableGoogleTagManager: false })).toContain(
            '<script src="/oneuptime-assets/tailwind/tailwind-3.4.5.js"></script>',
          );
        });

        test("carries no Google Tag Manager snippet", () => {
          expect(render(page, { enableGoogleTagManager: false })).not.toContain(
            "googletagmanager.com",
          );
        });
      });

      describe("when the flag is missing entirely", () => {
        /*
         * Every Response.render call site predates the flag and none of them
         * pass it. The partials have to treat "undefined" as off, or the guard
         * is decoration.
         */
        test("still leaves analytics out", () => {
          expect(render(page, {})).not.toContain("googletagmanager.com");
        });

        test("still renders the page body", () => {
          expect(render(page, {})).toContain(String(page.variables["message"]));
        });
      });

      describe("on the hosted product", () => {
        test("keeps analytics working", () => {
          expect(render(page, { enableGoogleTagManager: true })).toContain(
            "googletagmanager.com",
          );
        });

        test("still loads no library from a CDN", () => {
          /*
           * GTM injects itself by script rather than through a src attribute,
           * so it is not in the set this returns - which is the point: nothing
           * that blocks a render comes from off-box either way.
           */
          expect(
            externalHostsFetchedBy(
              render(page, { enableGoogleTagManager: true }),
            ),
          ).toEqual([]);
        });
      });
    });
  }

  describe("the font the on-call pages ask for", () => {
    const html: string = render(PAGES[0] as Page, {
      enableGoogleTagManager: false,
    });

    test("is declared as a local woff2", () => {
      expect(html).toContain(
        "url('/oneuptime-assets/fonts/InterVariable.woff2')",
      );
    });

    test("is a file that exists", () => {
      expect(
        fs.existsSync(
          path.join(VendorAssetsPath, "fonts", "InterVariable.woff2"),
        ),
      ).toBe(true);
    });

    test("is preloaded, so the swap does not flash on a cold cache", () => {
      expect(html).toContain(
        '<link rel="preload" href="/oneuptime-assets/fonts/InterVariable.woff2" as="font" type="font/woff2" crossorigin>',
      );
    });

    test("no longer comes from Google Fonts", () => {
      expect(html).not.toContain("fonts.googleapis.com");
      expect(html).not.toContain("fonts.gstatic.com");
    });
  });
});
