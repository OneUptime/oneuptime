// UX rule: Docs/ux/README.md#side-menus
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A STATUS PAGE'S SUBSCRIBERS ARE ONE PAGE, WITH A TAB PER CHANNEL.
 *
 * They were five pages - Email, SMS, Slack, Microsoft Teams and Webhook
 * Subscribers - five menu entries for one kind of record, each a near-copy
 * of the same ModelTable on StatusPageSubscriber, some 3,200 lines, and
 * nobody could see who was subscribed without opening all five (#9125).
 * They are one Subscribers page now, with a tab per channel. This holds that
 * shape, so a page written later cannot quietly bring a per-channel page
 * back:
 *
 *   - one component draws a channel's list (StatusPageSubscriberList), and
 *     only the Subscribers page draws it, a tab per channel;
 *   - one menu entry, and no page, route or menu entry per channel;
 *   - the five old addresses are named in one place (Common's
 *     StatusPageSubscriberChannel), which the routes forward from and the
 *     server's emails link through, and linked from nowhere else.
 *
 * Source is read as text: App's tests never import a React module.
 */

const PACKAGES: string = path.join(__dirname, "..", "..", "..");
const REPO_ROOT: string = path.join(PACKAGES, "..");

const DASHBOARD_SRC: string = path.join(
  PACKAGES,
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

const PAGE_FILE: string = "Pages/StatusPages/View/Subscribers.tsx";
const LIST_FILE: string = "Components/StatusPage/StatusPageSubscriberList.tsx";
const CHANNELS_FILE: string = "Components/StatusPage/SubscriberListChannels.ts";
const MENU_FILE: string = "Pages/StatusPages/View/SideMenu.tsx";
const ROUTES_FILE: string = "Routes/StatusPagesRoutes.tsx";

const COMMON_CHANNEL_FILE: string = path.join(
  PACKAGES,
  "Common",
  "Types",
  "StatusPage",
  "StatusPageSubscriberChannel.ts",
);

const RETIRED_PAGE_PATHS: Array<string> = [
  "email-subscribers",
  "sms-subscribers",
  "slack-subscribers",
  "microsoft-teams-subscribers",
  "webhook-subscribers",
];

const RETIRED_PAGE_FILES: Array<string> = [
  "EmailSubscribers.tsx",
  "SMSSubscribers.tsx",
  "SlackSubscribers.tsx",
  "MicrosoftTeamsSubscribers.tsx",
  "WebhookSubscribers.tsx",
];

const RETIRED_MENU_TITLES: Array<string> = [
  "Email Subscribers",
  "SMS Subscribers",
  "Slack Subscribers",
  "Microsoft Teams Subscribers",
  "Webhook Subscribers",
];

function readDashboard(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8");
}

// Without comments, so a sentence about the old pages is not mistaken for code.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function collapsed(source: string): string {
  return stripComments(source).replace(/\s+/g, " ");
}

const SOURCE_FILE: RegExp = /\.(ts|tsx)$/;

// Every .ts/.tsx source under a directory, skipping dependencies and builds.
function sourcesUnder(directory: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "build" ||
      entry.name === "dist" ||
      entry.name.startsWith(".")
    ) {
      continue;
    }

    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourcesUnder(full));
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

// The product's sources that could link a page or draw a list. Tests are not sources.
function productSources(): Array<string> {
  return [
    ...sourcesUnder(path.join(PACKAGES, "App", "FeatureSet")),
    ...sourcesUnder(path.join(PACKAGES, "Common", "Server")),
    ...sourcesUnder(path.join(PACKAGES, "Common", "UI")),
    ...sourcesUnder(path.join(PACKAGES, "Common", "Types")),
    ...sourcesUnder(path.join(PACKAGES, "Common", "Utils")),
    ...sourcesUnder(path.join(REPO_ROOT, "ee", "Dashboard")),
    ...sourcesUnder(path.join(REPO_ROOT, "ee", "Server")),
  ];
}

function relativeToRepo(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

function inDashboard(relative: string): string {
  return `packages/App/FeatureSet/Dashboard/src/${relative}`;
}

describe("one component draws a channel's list, a tab each on one page", () => {
  test("only the Subscribers page draws the list", () => {
    const drawers: Array<string> = productSources()
      .filter((file: string): boolean => {
        return stripComments(fs.readFileSync(file, "utf8")).includes(
          "<StatusPageSubscriberList",
        );
      })
      .map(relativeToRepo);

    expect(drawers).toEqual([inDashboard(PAGE_FILE)]);
  });

  test("only the shared list draws a dashboard table of subscribers", () => {
    const drawers: Array<string> = productSources()
      .filter((file: string): boolean => {
        return relativeToRepo(file).startsWith(
          "packages/App/FeatureSet/Dashboard/",
        );
      })
      .filter((file: string): boolean => {
        return stripComments(fs.readFileSync(file, "utf8")).includes(
          "<ModelTable<StatusPageSubscriber>",
        );
      })
      .map(relativeToRepo);

    expect(drawers).toEqual([inDashboard(LIST_FILE)]);
  });

  test("the page draws a tab per channel, keyed by channel, opened from the address", () => {
    const page: string = collapsed(readDashboard(PAGE_FILE));

    expect(page).toContain("SUBSCRIBER_LIST_CHANNELS.map(");
    expect(page).toContain("key={definition.channel}");
    expect(page).toContain("countBadge: counts[definition.channel],");
    expect(page).toContain("readStatusPageSubscriberChannel(");
    expect(page).toContain("Navigation.setQueryString({");
    expect(page).toContain(
      "initialTabName={getSubscriberListChannel(requestedChannel).copy.title}",
    );
  });

  test("the channels' differences live in one React-free file", () => {
    const channels: string = readDashboard(CHANNELS_FILE);

    expect(channels).not.toMatch(/from "react"/);
    expect(channels).toContain("STATUS_PAGE_SUBSCRIBER_CHANNELS.map(");
  });

  test("the five old page files are gone", () => {
    for (const file of RETIRED_PAGE_FILES) {
      expect([
        file,
        fs.existsSync(
          path.join(DASHBOARD_SRC, "Pages", "StatusPages", "View", file),
        ),
      ]).toEqual([file, false]);
    }
  });
});

describe("one menu entry, and no page per channel", () => {
  test("the Subscribers section holds Subscribers, Subscriber Settings and Notification Logs", () => {
    const menu: string = collapsed(readDashboard(MENU_FILE));
    const section: number = menu.indexOf(
      '<SideMenuSection title="Subscribers"',
    );
    const next: number = menu.indexOf("<SideMenuSection", section + 1);
    const entries: Array<string> = Array.from(
      menu.slice(section, next).matchAll(/title: "([^"]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(section).toBeGreaterThan(-1);
    expect(entries).toEqual([
      "Subscribers",
      "Subscriber Settings",
      "Notification Logs",
    ]);

    // Notification Logs is no section of its own any more.
    expect(menu).not.toContain('<SideMenuSection title="Notification Logs"');

    for (const title of RETIRED_MENU_TITLES) {
      expect(menu).not.toContain(`title: "${title}"`);
    }
  });

  test("the page map, the route table and the breadcrumbs have one page", () => {
    const pageMap: string = readDashboard("Utils/PageMap.ts");
    const routeMap: string = readDashboard("Utils/RouteMap.ts");
    const breadcrumbs: string = readDashboard(
      "Utils/Breadcrumbs/StatusPagesBreadcrumbs.ts",
    );

    expect(
      (pageMap.match(/^\s*STATUS_PAGE_VIEW_\w*_SUBSCRIBERS\b/gm) || []).map(
        (key: string): string => {
          return key.trim();
        },
      ),
    ).toEqual([]);
    expect(pageMap).toMatch(/^\s*STATUS_PAGE_VIEW_SUBSCRIBERS\b/m);
    expect(routeMap).toContain(
      "[PageMap.STATUS_PAGE_VIEW_SUBSCRIBERS]: `${RouteParams.ModelID}/subscribers`,",
    );

    for (const title of RETIRED_MENU_TITLES) {
      expect(breadcrumbs).not.toContain(`"${title}"`);
    }
  });
});

describe("the old addresses are named once, and linked from nowhere", () => {
  test("only Common's StatusPageSubscriberChannel names them", () => {
    const offenders: Array<string> = [];

    for (const file of productSources()) {
      if (file === COMMON_CHANNEL_FILE) {
        continue;
      }

      const source: string = stripComments(fs.readFileSync(file, "utf8"));

      for (const retired of RETIRED_PAGE_PATHS) {
        // As a path segment or a quoted value, not inside a longer name.
        const asPath: RegExp = new RegExp(`(^|[^\\w#-])${retired}(?![\\w-])`);

        if (asPath.test(source)) {
          offenders.push(`${relativeToRepo(file)}: ${retired}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("Common's StatusPageSubscriberChannel forwards each of them to a tab", () => {
    const source: string = fs.readFileSync(COMMON_CHANNEL_FILE, "utf8");

    for (const retired of RETIRED_PAGE_PATHS) {
      expect(source).toContain(`"${retired}": StatusPageSubscriberChannel.`);
    }
  });

  test("the status page routes forward every old address with its tab", () => {
    const routes: string = collapsed(readDashboard(ROUTES_FILE));

    expect(routes).toContain("Object.keys(MOVED_SUBSCRIBER_LIST_PATHS).map(");
    expect(routes).toContain(
      "<MovedPageRedirect pageMap={PageMap.STATUS_PAGE_VIEW_SUBSCRIBERS} searchParams={getStatusPageSubscriberChannelQuery(channel)} />",
    );
  });

  test("the server's email links to the tab through the same vocabulary", () => {
    const notice: string = collapsed(
      fs.readFileSync(
        path.join(
          PACKAGES,
          "Common",
          "Server",
          "Utils",
          "StatusPage",
          "StatusPageSubscriberUnsubscribeNotice.ts",
        ),
        "utf8",
      ),
    );

    expect(notice).toContain("return STATUS_PAGE_SUBSCRIBERS_PAGE_PATH;");
    expect(notice).toContain("getStatusPageSubscriberChannelQuery(");
  });
});
