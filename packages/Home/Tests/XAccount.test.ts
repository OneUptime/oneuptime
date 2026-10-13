import { PageSEOData, getPageSEO } from "../Utils/PageSEO";
import type { BlogPost } from "../Utils/BlogPost";
import ejs from "ejs";
import fs from "fs";
import path from "path";

/*
 * ONE X ACCOUNT.
 *
 * Pages named @oneuptimeinc as their twitter:site and blog posts named
 * @OneUptimeHQ, and the Organization structured data listed both
 * twitter.com/OneUptimeInc and x.com/oneuptimehq. The account the site sends
 * people to is @OneUptimeHQ: the footer's X link, and the handle of every
 * other OneUptime profile (YouTube, Reddit). Every template names it, here
 * and in the services that write OneUptime's head for pages on the same
 * domain.
 */

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");
const PACKAGES_ROOT: string = path.join(__dirname, "..", "..");
const HOME_URL: string = "https://oneuptime.com";

const X_HANDLE: string = "@OneUptimeHQ";
const X_PROFILE_URL: string = "https://x.com/oneuptimehq";

// A profile on X, under either of its domains.
const X_PROFILE: RegExp = /^https:\/\/(?:www\.)?(?:twitter|x)\.com\//;

/*
 * Templates outside Home/Views that write OneUptime's head: the API
 * reference, sign-in messages, and the on-call acknowledgement pages.
 */
const SHARED_TEMPLATES: Array<string> = [
  "Common/Server/Views/Partials/Head.ejs",
  "App/FeatureSet/Identity/Views/Partials/Head.ejs",
  "App/FeatureSet/APIReference/views/partials/head.ejs",
  "App/FeatureSet/APIReference/views/partials/footer.ejs",
];

// Share links (twitter.com/intent/tweet) and site paths name no account.
const NOT_AN_ACCOUNT: Set<string> = new Set<string>([
  "intent",
  "share",
  "home",
  "i",
  "search",
  "hashtag",
]);

function seoFor(pagePath: string): PageSEOData & { fullCanonicalUrl: string } {
  const seo: PageSEOData = getPageSEO(pagePath);

  return { ...seo, fullCanonicalUrl: `${HOME_URL}${seo.canonicalPath}` };
}

async function render(
  templateFileName: string,
  locals: Record<string, unknown>,
): Promise<string> {
  return (await ejs.renderFile(
    path.join(VIEWS_ROOT, templateFileName),
    locals,
    { views: [VIEWS_ROOT] },
  )) as string;
}

function openingTags(html: string, tag: string): Array<string> {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "gi"))].map(
    (match: RegExpMatchArray): string => {
      return match[0];
    },
  );
}

function attributeValue(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}=["']([^"']*)["']`, "i").exec(tag)?.[1];
}

// The content of every <meta> whose name or property is `name`.
function metaContents(html: string, name: string): Array<string> {
  return openingTags(html, "meta")
    .filter((meta: string): boolean => {
      return (
        attributeValue(meta, "name") === name ||
        attributeValue(meta, "property") === name
      );
    })
    .map((meta: string): string => {
      return attributeValue(meta, "content") || "";
    });
}

function viewFiles(directory: string = VIEWS_ROOT): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...viewFiles(fullPath));
    } else if (entry.name.endsWith(".ejs")) {
      files.push(path.relative(VIEWS_ROOT, fullPath).split(path.sep).join("/"));
    }
  }

  return files.sort();
}

/*
 * X handles in a template: twitter:site values, and profile links on
 * twitter.com or x.com, but not a domain that merely ends in "x.com".
 */
function xHandlesIn(text: string): Array<string> {
  const handles: Array<string> = [
    ...text.matchAll(/name="twitter:site"\s+content="@([A-Za-z0-9_]+)"/g),
  ].map((match: RegExpMatchArray): string => {
    return match[1]!;
  });

  for (const match of text.matchAll(
    /(?<![\w.-])(?:https?:\/\/)?(?:www\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]+)/g,
  )) {
    if (!NOT_AN_ACCOUNT.has(match[1]!.toLowerCase())) {
      handles.push(match[1]!);
    }
  }

  return handles;
}

describe("one X account", () => {
  test("the scan reads both shapes, and skips share links", () => {
    expect(
      xHandlesIn(
        '<meta name="twitter:site" content="@SomeOne"> https://x.com/other_one "https://twitter.com/Third" https://twitter.com/intent/tweet?text=hi netflix.com/xyz',
      ),
    ).toEqual(["SomeOne", "other_one", "Third"]);
  });

  test("every page's twitter:site names it", async () => {
    for (const pagePath of [
      "/",
      "/pricing",
      "/legal/soc-2",
      "/compare/datadog",
    ]) {
      const html: string = await render("head-social.ejs", {
        homeUrl: HOME_URL,
        seo: seoFor(pagePath),
      });

      expect(metaContents(html, "twitter:site")).toEqual([X_HANDLE]);
    }
  });

  test("a page rendered without SEO data names it too", async () => {
    const html: string = await render("head-social.ejs", {
      homeUrl: HOME_URL,
    });

    expect(metaContents(html, "twitter:site")).toEqual([X_HANDLE]);
  });

  test("the organization lists it as its only X profile", async () => {
    const html: string = await render("head-social.ejs", {
      homeUrl: HOME_URL,
      seo: seoFor("/"),
    });
    const organization: Record<string, unknown> | undefined = [
      ...html.matchAll(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
      ),
    ]
      .map((match: RegExpMatchArray): Record<string, unknown> => {
        return JSON.parse(match[1]!) as Record<string, unknown>;
      })
      .find((data: Record<string, unknown>): boolean => {
        return data["@type"] === "Organization";
      });

    const xProfiles: Array<string> = (
      organization!["sameAs"] as Array<string>
    ).filter((profile: string): boolean => {
      return X_PROFILE.test(profile);
    });

    expect(xProfiles).toEqual([X_PROFILE_URL]);
  });

  test("a blog post names the same account as every other page", async () => {
    const post: BlogPost = {
      title: "One account",
      description: "A post.",
      formattedPostDate: "October 13, 2026",
      fileName: "2026-10-13-one-account",
      tags: ["Observability"],
      postDate: "2026-10-13",
      blogUrl: `${HOME_URL}/blog/post/2026-10-13-one-account/view`,
      contributors: [],
      htmlBody: "<p>Body.</p>",
      markdownBody: "",
      socialMediaImageUrl: `${HOME_URL}/blog/post/2026-10-13-one-account/social-media.png`,
      author: {
        username: "someone",
        githubUrl: "https://github.com/someone",
        profileImageUrl: "https://github.com/someone.png",
        name: "Someone",
      },
      validationStatus: "validated",
      validationDate: "October 13, 2026",
    };

    const html: string = await render(path.join("Blog", "Post.ejs"), {
      support: false,
      footerCards: true,
      cta: true,
      blackLogo: false,
      requestDemoCta: false,
      blogPost: post,
      enableGoogleTagManager: false,
      homeUrl: HOME_URL,
    });

    expect(metaContents(html, "twitter:site")).toEqual([X_HANDLE]);
  });

  test("every template in Home, and in the services that share its head, names only that account", () => {
    const handlesByFile: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    for (const file of viewFiles()) {
      handlesByFile.set(
        `Home/Views/${file}`,
        xHandlesIn(fs.readFileSync(path.join(VIEWS_ROOT, file), "utf8")),
      );
    }

    for (const file of SHARED_TEMPLATES) {
      handlesByFile.set(
        file,
        xHandlesIn(fs.readFileSync(path.join(PACKAGES_ROOT, file), "utf8")),
      );
    }

    // The scan has to find the account where it is known to be named.
    for (const file of [
      "Home/Views/head-social.ejs",
      "Home/Views/footer.ejs",
      "Home/Views/Blog/Post.ejs",
      ...SHARED_TEMPLATES,
    ]) {
      expect([file, (handlesByFile.get(file) || []).length > 0]).toEqual([
        file,
        true,
      ]);
    }

    for (const [file, handles] of handlesByFile) {
      for (const handle of handles) {
        expect([file, handle.toLowerCase()]).toEqual([
          file,
          X_HANDLE.slice(1).toLowerCase(),
        ]);
      }
    }
  });

  test("twitter:site is written the same way everywhere", () => {
    const sources: Array<[string, string]> = [
      ...viewFiles().map((file: string): [string, string] => {
        return [
          `Home/Views/${file}`,
          fs.readFileSync(path.join(VIEWS_ROOT, file), "utf8"),
        ];
      }),
      ...SHARED_TEMPLATES.map((file: string): [string, string] => {
        return [file, fs.readFileSync(path.join(PACKAGES_ROOT, file), "utf8")];
      }),
    ];
    const written: Array<[string, string]> = [];

    for (const [file, source] of sources) {
      for (const match of source.matchAll(
        /name="twitter:site"\s+content="([^"]*)"/g,
      )) {
        written.push([file, match[1]!]);
      }
    }

    // head-social.ejs, Blog/Post.ejs and the three shared heads.
    expect(written.length).toBe(5);
    for (const [file, handle] of written) {
      expect([file, handle]).toEqual([file, X_HANDLE]);
    }
  });
});
