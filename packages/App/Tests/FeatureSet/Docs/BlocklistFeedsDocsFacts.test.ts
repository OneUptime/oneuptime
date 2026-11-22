import { DocsHeading, readPage, scanMarkdown } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import {
  FEED_SINGULAR,
  PREVIOUS_SECRET_USED,
  REVOKE_SECRET,
  ROTATE_SECRET,
  SETUP_CARD_TITLE,
  STATUS_LABELS,
} from "../../../FeatureSet/Dashboard/src/Components/SecurityEvents/BlocklistFeeds/BlocklistFeedsCopy";
import {
  SECURITY_EVENTS_MENU,
  SecurityEventsMenuItem,
  SecurityEventsMenuSection,
} from "../../../FeatureSet/Dashboard/src/Utils/SecurityEventsNavigation";
import {
  SECURITY_BLOCKLIST_FEED_RATE_LIMIT_PER_FEED,
  SECURITY_BLOCKLIST_FEED_RATE_LIMIT_PER_IP,
} from "Common/Server/Middleware/SecurityBlocklistFeedRateLimit";
import { SECURITY_BLOCKLIST_MAX_ACTIVE_BLOCKS } from "Common/Server/Utils/SecurityBlocklist/SecurityBlocklistReconciler";
import {
  SECURITY_BLOCKLIST_FEED_FETCH_RETENTION_IN_DAYS,
  SECURITY_BLOCKLIST_FEED_FIREWALLS,
  SECURITY_BLOCKLIST_FEED_MAX_ALLOWED_SOURCES,
  SECURITY_BLOCKLIST_FEED_SECRET_GRACE_IN_MS,
  SecurityBlocklistFeedFirewall,
  SecurityBlocklistFeedStatus,
} from "Common/Types/SecurityBlocklist/SecurityBlocklistFeed";
import {
  SECURITY_BLOCKLIST_FEED_EMPTY_IPV4_PLACEHOLDER,
  SECURITY_BLOCKLIST_FEED_EMPTY_IPV6_PLACEHOLDER,
  SECURITY_BLOCKLIST_FEED_FILE_NAMES,
  SECURITY_BLOCKLIST_FEED_MD5_SUFFIX,
  SecurityBlocklistFeedFormat,
} from "Common/Types/SecurityBlocklist/SecurityBlocklistFeedFormat";
import {
  SECURITY_BLOCKLIST_FEED_BASIC_USERNAME,
  SecurityBlocklistFeedSetup,
  SecurityBlocklistFeedUrls,
  buildSecurityBlocklistFeedSnippet,
  buildSecurityBlocklistFeedUrls,
  getSecurityBlocklistFeedSetup,
} from "Common/Types/SecurityBlocklist/SecurityBlocklistFeedSetup";
import { SECURITY_BLOCK_CONFIRMATION_MAX_AGE_IN_MS } from "Common/Types/SecurityBlocklist/SecurityBlockEnforcement";
import { describe, expect, test } from "@jest/globals";

/*
 * BLOCKLIST FEEDS FOR FIREWALLS AND PROXIES (#10345), held to the product.
 *
 * The page a feed's setup card links to, a section per firewall
 * (`#${setup.docsAnchor}`): every firewall the product offers has its
 * section there, under the heading the link names. The host commands it
 * shows are the ones the feed's page shows before its secret is known, word
 * for word; the limits it gives are the code's constants; the files it lists
 * are the files a feed serves; and the Dashboard words it names in bold are
 * the Dashboard's own. A change to any of them fails here until the page
 * says so too.
 */

const PAGE: string = "telemetry/blocklist-feeds";

const LINE_BREAK: RegExp = /\n/;
const TRAILING_LINE_BREAKS: RegExp = /\n+$/;
const HOUR_IN_MS: number = 60 * 60 * 1000;
const MINUTE_IN_MS: number = 60 * 1000;

function englishPage(): string {
  return readPage("en", PAGE);
}

function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

function section(markdown: string, heading: string): string {
  const headings: Array<DocsHeading> = scanMarkdown(markdown).headings;
  const index: number = headings.findIndex((entry: DocsHeading): boolean => {
    return entry.text === heading;
  });

  expect({ heading, found: index >= 0 }).toEqual({ heading, found: true });

  const start: DocsHeading = headings[index] as DocsHeading;
  const next: DocsHeading | undefined = headings
    .slice(index + 1)
    .find((entry: DocsHeading): boolean => {
      return entry.level <= start.level;
    });
  const lines: Array<string> = markdown.split(LINE_BREAK);

  return lines
    .slice(start.line, next ? next.line - 1 : lines.length)
    .join("\n");
}

// A table's rows under a heading, its header left out, as label -> value.
function rowsOf(heading: string): Map<string, string> {
  const found: Array<Array<Array<string>>> = tables(
    section(englishPage(), heading),
  );

  expect(found.length).toBeGreaterThan(0);

  return new Map(
    (found[0] as Array<Array<string>>).slice(1).map((row: Array<string>) => {
      return [row[0] as string, row[1] as string];
    }),
  );
}

// The commands a host's section shows: the feed's page's, before its secret is known.
function hostCommands(firewall: SecurityBlocklistFeedFirewall): string {
  const setup: SecurityBlocklistFeedSetup =
    getSecurityBlocklistFeedSetup(firewall);
  const urls: SecurityBlocklistFeedUrls = buildSecurityBlocklistFeedUrls({
    apiUrl: "https://oneuptime.com/api",
    feedId: "<feed ID>",
    setup,
    secret: null,
  });

  return (
    buildSecurityBlocklistFeedSnippet({ setup, url: urls.url, secret: null }) ||
    ""
  );
}

describe("the blocklist feeds page, held to the product", () => {
  test("has a section for every firewall the setup card offers, under the anchor its link names", () => {
    const slugs: Array<string> = scanMarkdown(englishPage()).headings.map(
      (heading: DocsHeading): string => {
        return heading.slug;
      },
    );

    for (const firewall of SECURITY_BLOCKLIST_FEED_FIREWALLS) {
      const anchor: string = getSecurityBlocklistFeedSetup(firewall).docsAnchor;
      expect([firewall, slugs.includes(anchor)]).toEqual([firewall, true]);
    }
  });

  test("shows the nftables and nginx commands word for word as the feed's page does", () => {
    const page: string = englishPage();

    for (const [firewall, heading] of [
      [SecurityBlocklistFeedFirewall.Nftables, "nftables"],
      [SecurityBlocklistFeedFirewall.Nginx, "nginx"],
    ] as Array<[SecurityBlocklistFeedFirewall, string]>) {
      // As a code block holds it: the script's own last line ends the block.
      const commands: string = hostCommands(firewall).replace(
        TRAILING_LINE_BREAKS,
        "",
      );

      expect(commands.length).toBeGreaterThan(0);
      expect(section(page, heading)).toContain(
        "```bash\n" + commands + "\n```",
      );
    }
  });

  test("gives the code's limits", () => {
    const limits: Map<string, string> = rowsOf("Limits");

    expect(SECURITY_BLOCKLIST_MAX_ACTIVE_BLOCKS).toBe(20000);
    expect(limits.get("Entries in a feed")).toBe("20,000");
    expect(limits.get("Allowed Source Addresses")).toBe(
      `${SECURITY_BLOCKLIST_FEED_MAX_ALLOWED_SOURCES} addresses and ranges`,
    );
    expect(limits.get("Fetches of one feed from one address")).toBe(
      `${SECURITY_BLOCKLIST_FEED_RATE_LIMIT_PER_FEED} a minute`,
    );
    expect(limits.get("Fetches of all feeds from one address")).toBe(
      `${SECURITY_BLOCKLIST_FEED_RATE_LIMIT_PER_IP} a minute`,
    );
    expect(limits.get("A replaced secret keeps working")).toBe(
      `${SECURITY_BLOCKLIST_FEED_SECRET_GRACE_IN_MS / HOUR_IN_MS} hours`,
    );
    expect(limits.get("A block counts as enforced after a fetch")).toBe(
      `${SECURITY_BLOCK_CONFIRMATION_MAX_AGE_IN_MS / MINUTE_IN_MS} minutes`,
    );
    expect(limits.get("Fetches kept")).toBe(
      `${SECURITY_BLOCKLIST_FEED_FETCH_RETENTION_IN_DAYS} days`,
    );
  });

  test("lists the files a feed serves, and the address an empty list holds", () => {
    const serves: string = flat(section(englishPage(), "What a feed serves"));

    for (const file of Object.values(SECURITY_BLOCKLIST_FEED_FILE_NAMES)) {
      expect(serves).toContain(`\`${file}\``);
    }
    expect(serves).toContain(
      `\`${SECURITY_BLOCKLIST_FEED_FILE_NAMES[SecurityBlocklistFeedFormat.Plain]}${SECURITY_BLOCKLIST_FEED_MD5_SUFFIX}\``,
    );
    expect(serves).toContain(
      `\`${SECURITY_BLOCKLIST_FEED_EMPTY_IPV4_PLACEHOLDER}\` (\`${SECURITY_BLOCKLIST_FEED_EMPTY_IPV6_PLACEHOLDER}\``,
    );
  });

  test("names the Dashboard's menu entry, buttons and statuses as it draws them", () => {
    const page: string = flat(englishPage());
    const playbooks: SecurityEventsMenuSection | undefined =
      SECURITY_EVENTS_MENU.find((menu: SecurityEventsMenuSection): boolean => {
        return menu.title === "Playbooks";
      });

    expect(
      playbooks?.items.map((item: SecurityEventsMenuItem): string => {
        return item.title;
      }),
    ).toContain("Blocklist Feeds");
    expect(page).toContain(
      "**Products → Security Events → Playbooks → Blocklist Feeds**",
    );

    for (const words of [
      `Create ${FEED_SINGULAR}`,
      SETUP_CARD_TITLE,
      ROTATE_SECRET,
      REVOKE_SECRET,
      PREVIOUS_SECRET_USED,
      STATUS_LABELS[SecurityBlocklistFeedStatus.Reading],
      STATUS_LABELS[SecurityBlocklistFeedStatus.StoppedReading],
    ]) {
      expect([words, page.includes(`**${words}**`)]).toEqual([words, true]);
    }

    // The username the steps fill in.
    expect(page).toContain(
      `**Username** \`${SECURITY_BLOCKLIST_FEED_BASIC_USERNAME}\``,
    );
  });
});
