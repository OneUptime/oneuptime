import slugify from "Common/Server/Types/MarkdownSlugify";
import StatusPageSubscriberUnsubscribe from "Common/Types/StatusPage/StatusPageSubscriberUnsubscribe";
import SubscriberUnsubscribeCopy from "../../../FeatureSet/Dashboard/src/Components/StatusPage/SubscriberUnsubscribeCopy";
import { drawnActionLabel } from "./DocsDashboardLabels";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The docs on unsubscribing, against the feature. Markdown is not compiled,
 * so nothing else notices when the link's shape, the page's routes, the
 * dashboard's column or the wording the docs quote change, or when the
 * Persian page falls behind the English one.
 *
 * A page names the Dashboard as its language's Dashboard draws it
 * (drawnActionLabel), and quotes the unsubscribe page as visitors read it in
 * that language, from the status page app's own locale, as
 * StatusPageDocsTranslations holds every language.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const STATUS_PAGE_LOCALES_DIR: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/StatusPage/src/Locales",
);

/*
 * English, and Persian, whose page these checks were first written for. The
 * other translations are held to the same words by StatusPageDocsTranslations.
 */
const LANGUAGES: ReadonlyArray<string> = ["en", "fa"];

function read(language: string, page: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${page}.md`),
    "utf8",
  );
}

/*
 * The docs renderer gives every heading an id, whatever its level, so a link
 * may point at an H4 such as "Incident custom fields in notifications". A
 * `#` line inside a fenced block is a comment, not a heading.
 */
const HEADING: RegExp = /^#{1,6} /;
const FENCE: RegExp = /^\s*```/;

function headingSlugs(markdown: string): Array<string> {
  let inFence: boolean = false;

  return markdown
    .split("\n")
    .filter((line: string): boolean => {
      if (FENCE.test(line)) {
        inFence = !inFence;
        return false;
      }

      return !inFence && HEADING.test(line);
    })
    .map((line: string): string => {
      return slugify(line.replace(/^#+ /, "").trim());
    });
}

// The unsubscribe page's words, as the status page app shows them in this language.
function statusPageCopy(language: string): Record<string, string> {
  return (
    JSON.parse(
      fs.readFileSync(
        path.join(STATUS_PAGE_LOCALES_DIR, `${language}.json`),
        "utf8",
      ),
    ) as Record<string, any>
  )["subscribe"]["unsubscribe"];
}

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
    const copy: Record<string, string> = statusPageCopy(language);

    expect(markdown).toContain(`*${copy["confirmPrompt"]}*`);
    expect(markdown).toContain(`**${copy["confirmButton"]}**`);
  });

  test("documents the Unsubscribed At column by the name the dashboard shows", () => {
    expect(markdown).toContain(
      `**${drawnActionLabel(language, SubscriberUnsubscribeCopy.unsubscribedAtTitle)}** (\`unsubscribedAt\`)`,
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
    expect(markdown).toContain(
      `**${drawnActionLabel(language, "Add in Bulk")}**`,
    );
  });
});

describe("both languages put the shared-address section under unsubscribing", () => {
  /*
   * StatusPageDocsTranslations lays each translation beside the English page
   * whole; here, the shared-address section is held right after the
   * unsubscribe section it belongs to.
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
