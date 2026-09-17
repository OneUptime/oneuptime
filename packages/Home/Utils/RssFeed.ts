import { create } from "xmlbuilder2";
import { XMLBuilder } from "xmlbuilder2/lib/interfaces";
import BlogPostUtil, { BlogPostHeader } from "./BlogPost";
import OneUptimeDate from "Common/Types/Date";
import URL from "Common/Types/API/URL";
import Text from "Common/Types/Text";

// Cache TTL: 10 minutes
const TTL_MS: number = 10 * 60 * 1000;

interface CachedData<T> {
  data: T;
  generatedAt: number;
}

// Caches
let mainFeedCache: CachedData<string> | null = null;
const tagFeedCaches: Map<string, CachedData<string>> = new Map();

function isCacheValid<T>(cache: CachedData<T> | null | undefined): boolean {
  if (!cache) {
    return false;
  }
  const now: number = OneUptimeDate.getCurrentDate().getTime();
  return now - cache.generatedAt < TTL_MS;
}

// Maximum number of items in an RSS feed
const MAX_RSS_ITEMS: number = 100;

function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function buildRssFeed(data: {
  title: string;
  description: string;
  feedUrl: string;
  siteUrl: string;
  posts: Array<BlogPostHeader>;
  baseUrlString: string;
}): Promise<string> {
  const rss: XMLBuilder = create().ele("rss");
  rss.att("version", "2.0");
  rss.att("xmlns:atom", "http://www.w3.org/2005/Atom");
  rss.att("xmlns:content", "http://purl.org/rss/1.0/modules/content/");

  const channel: XMLBuilder = rss.ele("channel");
  channel.ele("title").txt(data.title);
  channel.ele("description").txt(data.description);
  channel.ele("link").txt(data.siteUrl);
  channel.ele("language").txt("en-us");
  channel
    .ele("lastBuildDate")
    .txt(OneUptimeDate.getCurrentDate().toUTCString());
  channel.ele("generator").txt("OneUptime Blog");

  // Atom self-link for feed validators
  const atomLink: XMLBuilder = channel.ele("atom:link");
  atomLink.att("href", data.feedUrl);
  atomLink.att("rel", "self");
  atomLink.att("type", "application/rss+xml");

  // Image
  const image: XMLBuilder = channel.ele("image");
  image.ele("url").txt(`${data.baseUrlString}/img/OneUptimePNG/1.png`);
  image.ele("title").txt(data.title);
  image.ele("link").txt(data.siteUrl);

  // Items
  for (const post of data.posts.slice(0, MAX_RSS_ITEMS)) {
    const item: XMLBuilder = channel.ele("item");
    item.ele("title").txt(escapeXmlText(post.title));
    item.ele("description").txt(escapeXmlText(post.description));

    const postUrl: string = post.blogUrl.startsWith("http")
      ? post.blogUrl
      : `${data.baseUrlString}${post.blogUrl.startsWith("/") ? post.blogUrl : `/${post.blogUrl}`}`;

    item.ele("link").txt(postUrl);
    item.ele("guid").att("isPermaLink", "true").txt(postUrl);
    item
      .ele("pubDate")
      .txt(new Date(`${post.postDate}T00:00:00.000Z`).toUTCString());

    if (post.authorGitHubUsername) {
      item.ele("author").txt(post.authorGitHubUsername);
    }

    // Categories (tags)
    for (const tag of post.tags) {
      if (tag && tag.trim()) {
        item.ele("category").txt(tag.trim());
      }
    }
  }

  return rss.end({ prettyPrint: true });
}

// Generate the main blog RSS feed
export async function generateBlogRssFeed(): Promise<string> {
  if (isCacheValid(mainFeedCache)) {
    return mainFeedCache!.data;
  }

  const baseUrl: URL = await BlogPostUtil.getHomeUrl();
  const baseUrlString: string = baseUrl.toString().replace(/\/$/, "");

  const blogPosts: Array<BlogPostHeader> = await BlogPostUtil.getBlogPostList();

  const xml: string = await buildRssFeed({
    title: "OneUptime Blog",
    description:
      "Latest posts on Observability, Monitoring, Reliability and more from OneUptime.",
    feedUrl: `${baseUrlString}/blog/rss.xml`,
    siteUrl: `${baseUrlString}/blog`,
    posts: blogPosts,
    baseUrlString,
  });

  mainFeedCache = {
    data: xml,
    generatedAt: OneUptimeDate.getCurrentDate().getTime(),
  };

  return xml;
}

// Generate RSS feed for a specific tag
export async function generateTagRssFeed(tagName: string): Promise<string> {
  const cacheKey: string = tagName.toLowerCase();
  const cached: CachedData<string> | undefined = tagFeedCaches.get(cacheKey);

  if (isCacheValid(cached)) {
    return cached!.data;
  }

  const baseUrl: URL = await BlogPostUtil.getHomeUrl();
  const baseUrlString: string = baseUrl.toString().replace(/\/$/, "");

  const blogPosts: Array<BlogPostHeader> =
    await BlogPostUtil.getBlogPostList(tagName);

  const displayTagName: string = Text.fromDashesToPascalCase(tagName);

  const xml: string = await buildRssFeed({
    title: `OneUptime Blog - ${displayTagName}`,
    description: `Latest posts on ${displayTagName} from the OneUptime Blog.`,
    feedUrl: `${baseUrlString}/blog/tag/${encodeURIComponent(tagName)}/rss.xml`,
    siteUrl: `${baseUrlString}/blog/tag/${encodeURIComponent(tagName)}`,
    posts: blogPosts,
    baseUrlString,
  });

  tagFeedCaches.set(cacheKey, {
    data: xml,
    generatedAt: OneUptimeDate.getCurrentDate().getTime(),
  });

  return xml;
}
