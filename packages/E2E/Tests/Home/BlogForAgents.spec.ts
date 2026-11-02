import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * The blog as AI agents and search engines read it, on the deployed site:
 *
 *   - /llms.txt lists posts by topic, each linked by its page - the address
 *     to cite - with its Markdown copy beside it.
 *   - A post's page asked for Markdown before HTML (as coding agents ask)
 *     answers with the post as Markdown, naming the page as canonical, and
 *     says it varies by Accept. Asked for HTML, it is the page, and the page
 *     links the posts most like it.
 *   - A post's Markdown copy names the page as canonical, so search engines
 *     show the page rather than the copy.
 *   - The page never says it was modified before it was published.
 *   - IndexNow's key is where the blog's IndexNow notices say it is.
 *
 * Unit tests pin how each answer is built (Home/Tests); this proves the
 * deployed site gives them - that no route, proxy or cache in front of it
 * changes them. The post is the first one /llms.txt lists, so no post is
 * named here. These run only where the Home marketing site is deployed, which
 * the suite gates on IS_BILLING_ENABLED like the other Home specs.
 */

// Home/Utils/IndexNow.ts (INDEXNOW_KEY); Home/Tests/IndexNow.test.ts keeps the two the same.
const INDEXNOW_KEY: string = "f1116b8541f25b1e65e888216f990bbf";

const MARKDOWN_FIRST: string = "text/markdown, text/html, */*";
const BROWSER: string =
  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

// A post line of a "## Blog: <topic>" section of /llms.txt.
const LISTED_POST: RegExp =
  /^- \[[^\]]+\]\((https?:\/\/[^)\s]+\/blog\/post\/([^/)\s]+)\/view)\): .* \(\[Markdown\]\((https?:\/\/[^)\s]+\/blog\/post\/([^/)\s]+)\/markdown)\)\)$/;

interface ListedPost {
  pageUrl: string;
  markdownUrl: string;
  post: string;
}

function endpointFor(path: string): string {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
}

// The site's own address for one of its URLs, so a test asks the site it runs against.
function onThisSite(url: string): string {
  const parsed: globalThis.URL = new globalThis.URL(url);
  return endpointFor(`${parsed.pathname}${parsed.search}`);
}

async function getListedPosts(page: Page): Promise<Array<ListedPost>> {
  const response: APIResponse = await page.request.get(
    endpointFor("/llms.txt"),
  );

  expect(response.status()).toBe(200);

  const posts: Array<ListedPost> = [];
  let inBlogTopic: boolean = false;

  for (const line of (await response.text()).split("\n")) {
    if (line.startsWith("## ")) {
      inBlogTopic = line.startsWith("## Blog: ");
      continue;
    }

    const match: RegExpExecArray | null = inBlogTopic
      ? LISTED_POST.exec(line)
      : null;

    if (match) {
      // The page and the Markdown copy are the same post.
      expect(match[4]).toBe(match[2]);
      posts.push({
        pageUrl: match[1] as string,
        post: match[2] as string,
        markdownUrl: match[3] as string,
      });
    }
  }

  return posts;
}

// The header names an answer varies on, lowercased.
function varyOf(response: APIResponse): Array<string> {
  return (response.headers()["vary"] || "")
    .toLowerCase()
    .split(/\s*,\s*/)
    .filter(Boolean);
}

function expectCanonicalLinkTo(response: APIResponse, post: string): void {
  expect(response.headers()["link"] || "").toMatch(
    new RegExp(
      `^<https?://[^>]+/blog/post/${post.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/view>; rel="canonical"$`,
    ),
  );
}

test.describe("Home: the blog for AI agents and search engines", () => {
  test("/llms.txt lists posts by topic, by their pages and their Markdown copies", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return; // Home marketing site is only deployed in the SaaS stack.
    }

    page.setDefaultNavigationTimeout(120000);

    expect((await getListedPosts(page)).length).toBeGreaterThan(0);
  });

  test("a post's page asked for Markdown first is the post as Markdown, naming the page canonical", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }

    page.setDefaultNavigationTimeout(120000);

    const listed: ListedPost = (await getListedPosts(page))[0] as ListedPost;
    const response: APIResponse = await page.request.get(
      onThisSite(listed.pageUrl),
      { headers: { accept: MARKDOWN_FIRST } },
    );

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"] || "").toContain("text/markdown");
    expect(varyOf(response)).toContain("accept");
    expectCanonicalLinkTo(response, listed.post);

    const body: string = await response.text();
    expect(body.startsWith("# ")).toBe(true);
    expect(body).toContain("- Canonical: ");
    expect(body).not.toContain("<html");
  });

  test("a post's page asked for HTML is the page, linking the posts most like it", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }

    page.setDefaultNavigationTimeout(120000);

    const listed: ListedPost = (await getListedPosts(page))[0] as ListedPost;
    const response: APIResponse = await page.request.get(
      onThisSite(listed.pageUrl),
      { headers: { accept: BROWSER } },
    );

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"] || "").toContain("text/html");
    expect(varyOf(response)).toContain("accept");

    const html: string = await response.text();
    const related: string =
      html.match(/<nav[^>]*data-related-posts[\s\S]*?<\/nav>/)?.[0] || "";
    const linked: Array<string> = [
      ...related.matchAll(/href="\/blog\/post\/([^/"]+)\/view"/g),
    ].map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(linked.length).toBeGreaterThan(0);
    expect(linked).not.toContain(listed.post);
  });

  test("a post's Markdown copy names the post's page canonical", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }

    page.setDefaultNavigationTimeout(120000);

    const listed: ListedPost = (await getListedPosts(page))[0] as ListedPost;
    const response: APIResponse = await page.request.get(
      onThisSite(listed.markdownUrl),
    );

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"] || "").toContain("text/markdown");
    expectCanonicalLinkTo(response, listed.post);
  });

  test("a post's page never says it was modified before it was published", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }

    page.setDefaultNavigationTimeout(120000);

    const listed: ListedPost = (await getListedPosts(page))[0] as ListedPost;
    const html: string = await (
      await page.request.get(onThisSite(listed.pageUrl), {
        headers: { accept: BROWSER },
      })
    ).text();

    const published: string =
      html.match(/"datePublished":\s*"([^"]+)"/)?.[1] || "";
    const modified: string =
      html.match(/"dateModified":\s*"([^"]+)"/)?.[1] || "";

    expect(published).not.toBe("");
    expect(modified >= published).toBe(true);
    expect(html).toContain(
      `<meta property="article:modified_time" content="${modified}">`,
    );
  });

  test("IndexNow's key is where the blog's notices say it is", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }

    page.setDefaultNavigationTimeout(120000);

    const response: APIResponse = await page.request.get(
      endpointFor(`/${INDEXNOW_KEY}.txt`),
    );

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"] || "").toContain("text/plain");
    expect(await response.text()).toBe(INDEXNOW_KEY);
  });
});
