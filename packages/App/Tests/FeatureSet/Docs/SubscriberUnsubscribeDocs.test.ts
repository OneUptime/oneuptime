import slugify from "Common/Server/Types/MarkdownSlugify";
import StatusPageSubscriberUnsubscribe from "Common/Types/StatusPage/StatusPageSubscriberUnsubscribe";
import SubscriberUnsubscribeCopy from "../../../FeatureSet/Dashboard/src/Components/StatusPage/SubscriberUnsubscribeCopy";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The docs on unsubscribing, against the feature. Markdown is not compiled,
 * so nothing else notices when the link's shape, the page's routes, the
 * dashboard's column or the English wording the docs quote change, or when
 * the Persian page falls behind the English one.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const STATUS_PAGE_LOCALE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/StatusPage/src/Locales/en.json",
);

// `fa` is the only translated corpus; every other language falls back to English.
const LANGUAGES: ReadonlyArray<string> = ["en", "fa"];

function read(language: string, page: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${page}.md`),
    "utf8",
  );
}

const SECTION_HEADING: RegExp = /^#{2,3} /;

function headingSlugs(markdown: string): Array<string> {
  return markdown
    .split("\n")
    .filter((line: string): boolean => {
      return SECTION_HEADING.test(line);
    })
    .map((line: string): string => {
      return slugify(line.replace(/^#+ /, "").trim());
    });
}

const statusPageCopy: Record<string, string> = (
  JSON.parse(fs.readFileSync(STATUS_PAGE_LOCALE, "utf8")) as Record<string, any>
)["subscribe"]["unsubscribe"];

describe.each(LANGUAGES)("%s: status-pages/subscribers", (language: string) => {
  const markdown: string = read(language, "status-pages/subscribers");

  test("describes the link notifications carry now, in the shape the builder makes", () => {
    const shape: string = `{statusPageUrl}/${StatusPageSubscriberUnsubscribe.PAGE_ROUTE_SEGMENT}/{statusPageSubscriberId}-{token}`;

    expect(markdown).toContain(`\`${shape}\``);

    // The builder puts the id and the token in one segment, joined the same way.
    expect(
      StatusPageSubscriberUnsubscribe.buildCredential({
        subscriberId: "22222222-2222-4222-8222-222222222222",
        unsubscribeToken: "ab".repeat(32),
      }),
    ).toBe(`22222222-2222-4222-8222-222222222222-${"ab".repeat(32)}`);
  });

  test("names the unsubscribe endpoints and quotes the page's own words", () => {
    expect(markdown).toContain(
      "`POST .../unsubscribe/:statusPageId/:subscriberId/:token`",
    );
    expect(markdown).toContain("`List-Unsubscribe=One-Click`");
    expect(markdown).toContain(`*${statusPageCopy["confirmPrompt"]}*`);
    expect(markdown).toContain(`**${statusPageCopy["confirmButton"]}**`);
  });

  test("documents the Unsubscribed At column by the name the dashboard shows", () => {
    expect(markdown).toContain(
      `**${SubscriberUnsubscribeCopy.unsubscribedAtTitle}** (\`unsubscribedAt\`)`,
    );
  });

  test("says what happens to the old links", () => {
    expect(markdown).toContain(
      "`/api/status-page-subscriber/unsubscribe/{statusPageSubscriberId}`",
    );
    expect(markdown).toContain(
      "`{statusPageUrl}/update-subscription/{statusPageSubscriberId}`",
    );
  });

  test("warns about shared addresses in its own section", () => {
    expect(markdown).toContain("`site03-all@`");
    expect(markdown).toMatch(/^### .+$/m);
    expect(markdown).toContain("**Add in Bulk**");
  });
});

describe("both languages put the shared-address section under unsubscribing", () => {
  /*
   * The Persian page predates some English sections, so the two are not
   * compared whole; the unsubscribe sections are.
   */
  test.each([
    [
      "en",
      "managing-and-canceling-a-subscription",
      "shared-addresses-and-mailing-lists",
    ],
    [
      "fa",
      slugify("مدیریت و لغو اشتراک"),
      slugify("نشانی‌های مشترک و فهرست‌های پستی"),
    ],
  ])("%s", (language: string, managing: string, sharedAddresses: string) => {
    const slugs: Array<string> = headingSlugs(
      read(language, "status-pages/subscribers"),
    );

    expect(slugs).toContain(managing);
    expect(slugs.indexOf(sharedAddresses)).toBe(slugs.indexOf(managing) + 1);
  });
});

describe("One Status Page per Audience sends readers to the unsubscribe docs", () => {
  test("in English, to the sections that exist", () => {
    const guide: string = read(
      "en",
      "status-pages/one-status-page-per-audience",
    );
    const anchors: Array<string> = headingSlugs(
      read("en", "status-pages/subscribers"),
    );

    const links: Array<string> = Array.from(
      guide.matchAll(/\]\(\/docs\/status-pages\/subscribers#([^)\s]+)\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(links).toEqual(
      expect.arrayContaining([
        "managing-and-canceling-a-subscription",
        "shared-addresses-and-mailing-lists",
      ]),
    );

    for (const anchor of links) {
      expect(anchors).toContain(anchor);
    }
  });

  test("in Persian too", () => {
    const guide: string = read(
      "fa",
      "status-pages/one-status-page-per-audience",
    );

    expect(guide).toContain("`site03-all@`");
    expect(guide).toContain("](/docs/status-pages/subscribers)");
  });
});
