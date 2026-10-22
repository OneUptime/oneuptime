import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { hasPage, readPage } from "./DocsContentSupport";
import { lineShape } from "./DocsPageShape";
import {
  anchorProblems,
  boldSpans,
  cardLines,
  cardTargets,
  inlineCode,
  navTitle,
  tableShape,
} from "./DocsTranslationChecks";
import { describe, expect, it, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Self Hosted > Behind a VPN or Firewall: what reaches a self-hosted server
 * from outside, who sends it and on which path - for an operator who keeps
 * OneUptime off the public internet and has to say exactly what to publish.
 * An operator copies these paths into a proxy or a firewall, so each one is
 * held to the code that serves it:
 *
 *   - an acknowledgement link opens a short link (/l/), the acknowledge page
 *     and its button, and the pass-on page and its button, all under
 *     /api/user-notification-log-timeline, styled from /oneuptime-assets/;
 *   - a key pressed on a call comes back from Twilio on call/gather-input;
 *   - Telegram's webhook and WhatsApp's are the Notification feature set's
 *     routes, under /api/notification;
 *   - "Poll Telegram for Messages" is the Admin Dashboard's switch for
 *     polling (TelegramUpdatePolling), so nothing at all needs Telegram to
 *     reach the server;
 *   - a short link is eight letters, as the page says when it asks for a
 *     rate limit.
 *
 * Every translation keeps the English page's lines, code, tables, cards and
 * links, and is titled as its nav link.
 */

const PAGE: string = "self-hosted/behind-a-firewall";
const NAV_TITLE: string = "Behind a VPN or Firewall";

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

// A Markdown link's address: [words](address).
const LINK_ADDRESS: RegExp = /\]\(([^)\s]+)\)/g;
// A row of the table of published paths: "| GET | `/l/*` | ... |".
const PUBLISHED_PATH_ROW: RegExp = /^\| (GET|POST) \| `([^`]+)` \|/;

function source(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

function linksIn(markdown: string): Array<string> {
  return [...markdown.matchAll(LINK_ADDRESS)].map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

// Links to other pages and sites; an #anchor on this page is translated.
function linksOut(markdown: string): Array<string> {
  return linksIn(markdown).filter((address: string): boolean => {
    return !address.startsWith("#");
  });
}

const english: string = readPage("en", PAGE);

describe("Behind a VPN or Firewall, in English", () => {
  const timelineApi: string = source(
    "Common/Server/API/UserOnCallLogTimelineAPI.ts",
  );

  test("is in the Self Hosted section of the nav, after Private Network Access", () => {
    const nav: string = source("App/FeatureSet/Docs/Utils/Nav.ts");
    const privateNetwork: number = nav.indexOf(
      'url: "/docs/self-hosted/private-network-access"',
    );
    const thisPage: number = nav.indexOf(`url: "/docs/${PAGE}"`);

    expect(privateNetwork).toBeGreaterThan(-1);
    expect(thisPage).toBeGreaterThan(privateNetwork);
    expect(nav).toContain(`title: "${NAV_TITLE}",`);
    expect(english.split("\n")[0]).toBe(`# ${NAV_TITLE}`);
  });

  test("lists the paths an acknowledgement link opens, with their methods", () => {
    const rows: Array<string> = english
      .split("\n")
      .map((line: string): string | null => {
        const match: RegExpExecArray | null = PUBLISHED_PATH_ROW.exec(line);
        return match ? `${match[1]} ${match[2]}` : null;
      })
      .filter((row: string | null): row is string => {
        return row !== null;
      });

    expect(rows).toEqual([
      "GET /l/*",
      "GET /api/user-notification-log-timeline/acknowledge-page/*",
      "GET /api/user-notification-log-timeline/acknowledge/*",
      "GET /api/user-notification-log-timeline/pass-on-page/*",
      "POST /api/user-notification-log-timeline/pass-on/*",
      "GET /oneuptime-assets/*",
    ]);
  });

  test("names the routes the timeline API serves those pages on", () => {
    expect(source("Common/ServiceRoute.ts")).toContain(
      'export const AppApiRoute: Route = new Route("/api");',
    );
    expect(
      source("Common/Models/DatabaseModels/UserOnCallLogTimeline.ts"),
    ).toContain(
      '@CrudApiEndpoint(new Route("/user-notification-log-timeline"))',
    );

    for (const [method, route] of [
      ["get", "/acknowledge-page/:itemId"],
      ["get", "/acknowledge/:itemId"],
      ["get", "/pass-on-page/:itemId"],
      ["post", "/pass-on/:itemId"],
      ["post", "/call/gather-input/:itemId"],
    ] as Array<[string, string]>) {
      const registered: RegExp = new RegExp(
        `this\\.router\\.${method}\\(\\s*\`\\$\\{new this\\.entityType\\(\\)\\s*\\.getCrudApiPath\\(\\)\\s*\\?\\.toString\\(\\)\\}${route.replace(/\//g, "\\/")}\``,
      );

      expect({
        method,
        route,
        registered: registered.test(timelineApi),
      }).toEqual({ method, route, registered: true });
    }
  });

  test("names the short-link path the messages carry, and its length", () => {
    expect(source("Common/ServiceRoute.ts")).toContain(
      'export const LinkShortenerRoute: Route = new Route("/l");',
    );
    expect(source("Nginx/default.conf.template")).toContain("location /l/ {");
    expect(source("Common/Server/Services/ShortLinkService.ts")).toContain(
      "createBy.data.shortId = Text.generateRandomText(8);",
    );
    // generateRandomText draws letters only: "eight letters long".
    expect(source("Common/Types/Text.ts")).toContain(
      '"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"',
    );
    expect(english).toContain("a short link is eight letters long");
  });

  test("covers everything the acknowledge page loads from the server", () => {
    const views: string = "Common/Server/Views";
    const page: string = [
      source(`${views}/AcknowledgeUserOnCallNotification.ejs`),
      source(`${views}/PassOnUserOnCallNotification.ejs`),
      source(`${views}/Partials/Head.ejs`),
      source(`${views}/Partials/ProductLogo.ejs`),
    ].join("\n");

    const fixedAddresses: Array<string> = [
      ...page.matchAll(/(?:src|href)=["'](\/[^"'<]*)["']/g),
      ...page.matchAll(/url\('(\/[^']*)'\)/g),
    ].map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(fixedAddresses.length).toBeGreaterThan(0);

    /*
     * The web app manifest is read only to install a site as an app: the
     * page draws and works without it, so the page does not ask for it.
     */
    const needed: Array<string> = fixedAddresses.filter(
      (address: string): boolean => {
        return address !== "/manifest.json";
      },
    );

    expect(needed.length).toBeGreaterThan(0);

    for (const address of needed) {
      expect({
        address,
        isAsset: address.startsWith("/oneuptime-assets/"),
      }).toEqual({ address, isAsset: true });
    }
  });

  test("names the Telegram and WhatsApp webhooks where the Notification feature set serves them", () => {
    const notification: string = source("App/FeatureSet/Notification/Index.ts");

    expect(notification).toContain(
      'app.use([`/${APP_NAME}/telegram`, "/telegram"], TelegramAPI);',
    );
    expect(notification).toContain(
      'app.use([`/${APP_NAME}/whatsapp`, "/whatsapp"], WhatsAppAPI);',
    );
    expect(source("App/FeatureSet/Notification/API/Telegram.ts")).toContain(
      'router.post(\n  "/webhook",',
    );
    expect(source("App/FeatureSet/Notification/API/WhatsApp.ts")).toContain(
      'router.get("/webhook",',
    );
    // The address the Admin Dashboard tells administrators to register.
    expect(
      source(
        "App/FeatureSet/AdminDashboard/src/Pages/Settings/Telegram/Index.tsx",
      ),
    ).toContain("/notification/telegram/webhook");

    expect(english).toContain("`POST /api/notification/telegram/webhook`");
    expect(english).toContain("`/api/notification/whatsapp/webhook`");
    expect(english).toContain(
      "`POST /api/user-notification-log-timeline/call/gather-input/*`",
    );
  });

  test("names the polling switch as the Admin Dashboard shows it, on the page that has it", () => {
    expect(english).toContain(
      "turn on **Poll Telegram for Messages** in **Admin Dashboard > Settings > Telegram**",
    );
    expect(
      source(
        "App/FeatureSet/AdminDashboard/src/Pages/Settings/Telegram/Index.tsx",
      ),
    ).toContain('title: "Poll Telegram for Messages",');
    expect(source("Common/Models/DatabaseModels/GlobalConfig.ts")).toContain(
      'title: "Poll Telegram for Messages",',
    );
    // Polling is a worker job; without it the switch would fetch nothing.
    expect(source("App/FeatureSet/Workers/Index.ts")).toContain(
      'import "./Jobs/Telegram/PollUpdates";',
    );
  });

  test("gives Telegram's webhook source ranges, and says no OneUptime list exists", () => {
    expect(english).toContain("`149.154.160.0/20` and `91.108.4.0/22`");
    expect(english).toContain(
      "there is no list of OneUptime addresses to allow",
    );
  });

  test("says a link in a messaging app never opens the OneUptime app", () => {
    const app: string = source("MobileApp/app.json");

    // Only its own scheme: the app claims no web address a link could open.
    expect(app).toContain('"scheme": "oneuptime"');
    expect(app).not.toContain("associatedDomains");
    expect(app).not.toContain("intentFilters");
    expect(english).toContain("never in the OneUptime app");
  });
});

describe.each(TRANSLATIONS)(
  "Behind a VPN or Firewall, in %s",
  (language: string) => {
    it("is translated", () => {
      expect(hasPage(language, PAGE)).toBe(true);
    });

    const translated: () => string = (): string => {
      return readPage(language, PAGE);
    };

    it("is titled as its nav link", () => {
      const title: string = navTitle(language, NAV_TITLE);

      expect(title).toBeTruthy();
      expect(translated().split("\n")[0]).toBe(`# ${title}`);
    });

    it("keeps every line where the English page has it", () => {
      expect(lineShape(translated())).toEqual(lineShape(english));
    });

    it("keeps the English page's code, tables and links", () => {
      expect(inlineCode(translated())).toEqual(inlineCode(english));
      expect(tableShape(translated())).toEqual(tableShape(english));
      expect(linksOut(translated())).toEqual(linksOut(english));
      expect(cardTargets(cardLines(translated()))).toEqual(
        cardTargets(cardLines(english)),
      );
    });

    it("links only to headings it has", () => {
      expect(anchorProblems(language, PAGE)).toEqual([]);
    });

    it("names the switch and the acknowledge button as the product shows them, in English", () => {
      const bold: Array<string> = boldSpans(translated());

      expect(bold).toContain("Poll Telegram for Messages");
      expect(bold).toContain("Acknowledge");
    });
  },
);
