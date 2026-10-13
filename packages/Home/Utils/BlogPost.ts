import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import BlogTag from "./BlogTag";
import { BlogRootPath } from "./Config";
import LocalFile from "Common/Server/Utils/LocalFile";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import CodeRepositoryUtil from "Common/Server/Utils/CodeRepository/CodeRepository";
import logger from "Common/Server/Utils/Logger";
import crypto from "crypto";

// The "#" (or "##" ...) a README's title line starts with.
const TITLE_MARKER: RegExp = /^#+/;

export interface BlogPostAuthor {
  username: string;
  githubUrl: string;
  profileImageUrl: string;
  name: string;
  bio?: string | undefined; // optional bio from Authors.json
}

/*
 * A person who has contributed to a blog post (derived from git history of the
 * post folder, plus the declared author). `username`/`githubUrl` are only set
 * when we can resolve the commit to a GitHub account.
 */
export interface BlogPostContributor {
  username?: string | undefined;
  name: string;
  profileImageUrl: string;
  githubUrl?: string | undefined;
}

export interface BlogPostBaseProps {
  title: string;
  description: string;

  formattedPostDate: string;
  fileName: string;
  tags: string[];
  postDate: string;
  blogUrl: string;
  // Author first, then other git contributors ordered by commit count.
  contributors: BlogPostContributor[];
}

export interface BlogPostHeader extends BlogPostBaseProps {
  authorGitHubUsername: string;
}

/*
 * A tag that has a page: the posts whose tags share one slug. The name is how
 * most of those posts write it - "CI/CD" rather than "Ci-cd" or "CI CD".
 */
export interface BlogTagSummary {
  slug: string;
  name: string;
}

export interface BlogPost extends BlogPostBaseProps {
  htmlBody: string;
  markdownBody: string;
  socialMediaImageUrl: string;
  author: BlogPostAuthor | null;
  /*
   * Status from the post's validation.json (e.g. "validated"), or null when the
   * post has not been validated yet.
   */
  validationStatus: string | null;
  // Formatted validation date (from validation.json `validatedAt`), or null.
  validationDate: string | null;
}

export default class BlogPostUtil {
  // Cache Blogs.json contents to avoid repeated disk reads and external calls.
  private static blogsMetaCache: Array<JSONObject> | null = null;
  // Cache Authors.json (keyed by github username)
  private static authorsMetaCache: JSONObject | null = null;
  // Cache the constructed blog post header list (without git-derived contributors)
  private static blogPostListCache: Array<BlogPostHeader> | null = null;
  /*
   * Cache the header list enriched with git-history contributors. Building this
   * runs an expensive `git log` over the whole blog repo, so it is only computed
   * when a caller explicitly asks for contributors (the blog list/tag pages).
   */
  private static blogPostListWithContributorsCache: Array<BlogPostHeader> | null =
    null;
  // Cache tags from Tags.md
  private static tagsCache: string[] | null = null;
  /*
   * The tags that have a page, by slug, and the post list they were read
   * from: built once per post list (61,000 posts carry about 250,000 tags).
   */
  private static tagIndexCache: {
    posts: Array<BlogPostHeader>;
    tagsBySlug: Map<string, BlogTagSummary>;
  } | null = null;
  /*
   * The slug of every tag the posts carry, as written. Only the blog's own
   * tags go in, so it holds at most one entry per tag (about 21,000), and a
   * tag page filters every post's tags with a lookup each.
   */
  private static tagSlugCache: Map<string, string> = new Map();
  // Cache fully rendered blog posts by fileName
  private static blogPostCache: Map<string, BlogPost> = new Map();
  /*
   * Cache contributors (from git history) keyed by post folder name. Populated
   * only by a successful background warm (see warmContributors) — never on the
   * request path, which reads this best-effort and falls back to author-only.
   */
  private static contributorsByPostCache: Map<
    string,
    BlogPostContributor[]
  > | null = null;
  /*
   * In-flight promise of the background contributor warm, so concurrent triggers
   * share a single `git log` instead of spawning one per request (a cold-start
   * burst on /blog would otherwise launch many parallel git walks).
   */
  private static contributorsWarmInFlight: Promise<void> | null = null;
  /*
   * Whether a warm has been kicked off this process (reset by clearAllCaches on
   * the periodic repo pull). Stops the request path from re-launching the walk
   * over and over once an attempt has failed.
   */
  private static contributorsWarmAttempted: boolean = false;
  /*
   * Hard upper bound for the background `git log` walk. It runs off the request
   * path so it can be generous (the full-history blog repo walk takes ~60s+),
   * but is still bounded so a pathological repo can never pin a git process for
   * the lifetime of the service.
   */
  private static readonly CONTRIBUTORS_WARM_TIMEOUT_IN_MS: number =
    4 * 60 * 1000;

  public static clearAllCaches(): void {
    this.blogsMetaCache = null;
    this.authorsMetaCache = null;
    this.blogPostListCache = null;
    this.blogPostListWithContributorsCache = null;
    this.tagsCache = null;
    this.tagIndexCache = null;
    this.tagSlugCache.clear();
    this.blogPostCache.clear();
    this.contributorsByPostCache = null;
    this.contributorsWarmInFlight = null;
    this.contributorsWarmAttempted = false;
  }
  private static async getBlogsMeta(): Promise<Array<JSONObject>> {
    if (this.blogsMetaCache) {
      return this.blogsMetaCache;
    }

    const filePath: string = `${BlogRootPath}/Blogs.json`;
    let jsonContent: string | JSONArray = await LocalFile.read(filePath);
    if (typeof jsonContent === "string") {
      jsonContent = JSONFunctions.parseJSONArray(jsonContent);
    }
    const blogs: Array<JSONObject> = JSONFunctions.deserializeArray(
      jsonContent as Array<JSONObject>,
    );
    this.blogsMetaCache = blogs;
    return blogs;
  }

  private static async getAuthorsMeta(): Promise<JSONObject> {
    if (this.authorsMetaCache) {
      return this.authorsMetaCache;
    }
    const filePath: string = `${BlogRootPath}/Authors.json`;
    try {
      let jsonContent: string | JSONObject = await LocalFile.read(filePath);
      if (typeof jsonContent === "string") {
        jsonContent = JSONFunctions.parse(jsonContent) as JSONObject;
      }
      this.authorsMetaCache = jsonContent as JSONObject;
      return this.authorsMetaCache || ({} as JSONObject);
    } catch {
      this.authorsMetaCache = {} as JSONObject;
      return this.authorsMetaCache;
    }
  }

  /*
   * Every post, newest first - or, given a tag's slug (BlogTag.getSlug), the
   * posts carrying a tag with that slug.
   */
  public static async getBlogPostList(
    tagSlug?: string | undefined,
    options?: { includeContributors?: boolean } | undefined,
  ): Promise<BlogPostHeader[]> {
    /*
     * Contributors are derived from git history (one expensive `git log` over the
     * whole blog repo) and are only needed by the blog list/tag pages. Callers
     * that do not render them (sitemap, RSS feed) get the lightweight list so
     * they never trigger that work — previously the sitemap index timed out (504)
     * because it ran the contributor `git log` just to count posts.
     */
    const includeContributors: boolean = options?.includeContributors === true;

    // Build the base (lightweight) list once, from Blogs.json only.
    if (!this.blogPostListCache) {
      const blogs: Array<JSONObject> = [
        ...(await this.getBlogsMeta()),
      ].reverse(); // reverse so new content comes first

      const resultList: Array<BlogPostHeader> = [];

      for (const blog of blogs) {
        const fileName: string = blog["post"] as string;
        const formattedPostDate: string =
          this.getFormattedPostDateFromFileName(fileName);
        const postDate: string = this.getPostDateFromFileName(fileName);
        const authorGitHubUsername: string = blog[
          "authorGitHubUsername"
        ] as string;

        resultList.push({
          title: this.getTrimmedText(blog["title"]),
          description: this.getTrimmedText(blog["description"]),
          fileName,
          formattedPostDate,
          postDate,
          tags: blog["tags"] as string[],
          authorGitHubUsername,
          contributors: [],
          blogUrl: `/blog/post/${fileName}/view`,
        });
      }

      this.blogPostListCache = resultList;
    }

    let list: Array<BlogPostHeader> = this.blogPostListCache;

    if (includeContributors) {
      // Enrich each post with git-history contributors (cached after first build).
      if (this.blogPostListWithContributorsCache) {
        list = this.blogPostListWithContributorsCache;
      } else {
        const enriched: Array<BlogPostHeader> = [];
        for (const post of this.blogPostListCache) {
          enriched.push({
            ...post,
            contributors: await this.buildContributors(
              post.fileName,
              post.authorGitHubUsername,
            ),
          });
        }
        /*
         * Only cache once the background warm has resolved contributors. Before
         * that, buildContributors returns author-only, so caching here would pin
         * the degraded list for the whole process lifetime; instead we rebuild
         * (cheap — no git, metadata is cached) until the warm completes, which
         * also clears this cache so the next call rebuilds with full contributors.
         */
        if (this.contributorsByPostCache) {
          this.blogPostListWithContributorsCache = enriched;
        }
        list = enriched;
      }
    }

    if (tagSlug) {
      return list.filter((blog: BlogPostHeader) => {
        return blog.tags.some((tag: string) => {
          return this.getTagSlug(tag) === tagSlug;
        });
      });
    }

    return list;
  }

  /*
   * The tag whose page has this slug, or null when no post carries a tag with
   * it. A tag page and a tag feed exist only for these.
   */
  public static async getTagBySlug(
    slug: string,
  ): Promise<BlogTagSummary | null> {
    const posts: Array<BlogPostHeader> = await this.getBlogPostList();

    if (!this.tagIndexCache || this.tagIndexCache.posts !== posts) {
      this.tagIndexCache = {
        posts: posts,
        tagsBySlug: this.buildTagIndex(posts),
      };
    }

    const tag: BlogTagSummary | undefined =
      this.tagIndexCache.tagsBySlug.get(slug);

    return tag ? { ...tag } : null;
  }

  /*
   * One entry per slug, named the way most of its posts write it; on a tie,
   * the way the newest of them does (the list is newest first).
   */
  private static buildTagIndex(
    posts: Array<BlogPostHeader>,
  ): Map<string, BlogTagSummary> {
    const spellingCountsBySlug: Map<string, Map<string, number>> = new Map();

    for (const post of posts) {
      for (const tag of post.tags) {
        const slug: string = this.getTagSlug(tag);

        if (!slug) {
          continue;
        }

        let spellingCounts: Map<string, number> | undefined =
          spellingCountsBySlug.get(slug);

        if (!spellingCounts) {
          spellingCounts = new Map();
          spellingCountsBySlug.set(slug, spellingCounts);
        }

        spellingCounts.set(tag, (spellingCounts.get(tag) || 0) + 1);
      }
    }

    const tagsBySlug: Map<string, BlogTagSummary> = new Map();

    for (const [slug, spellingCounts] of spellingCountsBySlug) {
      let name: string = "";
      let nameCount: number = 0;

      // A Map iterates in insertion order: the first spelling met is the newest.
      for (const [spelling, count] of spellingCounts) {
        if (count > nameCount) {
          name = spelling;
          nameCount = count;
        }
      }

      tagsBySlug.set(slug, { slug: slug, name: name });
    }

    return tagsBySlug;
  }

  // BlogTag.getSlug of one of the posts' own tags, worked out once per tag.
  private static getTagSlug(tag: string): string {
    let slug: string | undefined = this.tagSlugCache.get(tag);

    if (slug === undefined) {
      slug = BlogTag.getSlug(tag);
      this.tagSlugCache.set(tag, slug);
    }

    return slug;
  }

  // A title or description from Blogs.json, without the space around it.
  private static getTrimmedText(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  public static async getBlogPost(fileName: string): Promise<BlogPost | null> {
    const cached: BlogPost | undefined = this.blogPostCache.get(fileName);
    if (cached) {
      return cached;
    }

    try {
      const blogPost: BlogPost | null =
        await this.getBlogPostFromFile(fileName);
      if (blogPost && this.contributorsByPostCache) {
        /*
         * Only cache once the background warm has resolved contributors, so a
         * post rendered before the warm finishes isn't pinned with author-only
         * contributors. The warm clears this cache on completion too.
         */
        this.blogPostCache.set(fileName, blogPost);
      }
      return blogPost;
    } catch {
      return null;
    }
  }

  public static async getTags(): Promise<string[]> {
    if (this.tagsCache) {
      return this.tagsCache;
    }

    const tags: string[] = await this.getAllTagsFromGitHub();
    this.tagsCache = tags;
    return tags;
  }

  public static async getAllTagsFromGitHub(): Promise<string[]> {
    const filePath: string = `${BlogRootPath}/Tags.md`;

    const tagsMarkdownContent: string | null = await LocalFile.read(filePath);

    if (!tagsMarkdownContent) {
      return [];
    }

    const tags: Array<string> = tagsMarkdownContent
      .split("\n")
      .map((tag: string) => {
        return tag.trim();
      })
      .filter((tag: string) => {
        return tag.startsWith("-");
      })
      .map((tag: string) => {
        return tag.replace("-", "").trim();
      });

    return tags;
  }

  public static async getHomeUrl(): Promise<URL> {
    return await DatabaseConfig.getHomeUrl();
  }

  public static async getBlogPostFromFile(
    fileName: string,
  ): Promise<BlogPost | null> {
    const filePath: string = `${BlogRootPath}/posts/${fileName}/README.md`;

    const postDate: string = this.getPostDateFromFileName(fileName);
    const formattedPostDate: string =
      this.getFormattedPostDateFromFileName(fileName);

    let markdownContent: string = await LocalFile.read(filePath);

    // Resolve author WITHOUT hitting GitHub API. Use Blogs.json to get username, Authors.json for name/bio.
    let blogPostAuthor: BlogPostAuthor | null = null;
    try {
      const blogsMeta: Array<JSONObject> = await this.getBlogsMeta();
      const blogMeta: JSONObject | undefined = blogsMeta.find(
        (b: JSONObject) => {
          return (b["post"] as string) === fileName;
        },
      );
      const username: string | undefined = blogMeta?.[
        "authorGitHubUsername"
      ] as string | undefined;
      if (username) {
        const authorsMeta: JSONObject = await this.getAuthorsMeta();
        const authorMeta: JSONObject | undefined = authorsMeta[username] as
          | JSONObject
          | undefined;
        const authorName: string | undefined =
          (authorMeta?.["authorName"] as string) || undefined;
        const authorBio: string | undefined =
          (authorMeta?.["authorBio"] as string) || undefined;
        blogPostAuthor = {
          username,
          githubUrl: `https://github.com/${username}`,
          profileImageUrl: `https://avatars.githubusercontent.com/${username}`,
          name: authorName || username,
          bio: authorBio,
        };
      }
    } catch {
      // ignore and fallback
    }

    // Fallback to parsing markdown (no network) if metadata missing.
    if (!blogPostAuthor) {
      blogPostAuthor = await this.getAuthorFromFileContent(markdownContent);
    }

    const title: string = this.getTitleFromFileContent(markdownContent);
    const description: string =
      this.getDescriptionFromFileContent(markdownContent);
    const tags: Array<string> = this.getTagsFromFileContent(markdownContent);

    markdownContent = this.getPostFromMarkdown(markdownContent);

    const htmlBody: string = await Markdown.convertToHTML(
      markdownContent,
      MarkdownContentType.Blog,
    );

    const validation: { status: string; validatedAt: string | null } | null =
      await this.getValidation(fileName);

    const blogPost: BlogPost = {
      title,
      description,
      author: blogPostAuthor,
      contributors: await this.buildContributors(
        fileName,
        blogPostAuthor?.username,
      ),
      validationStatus: validation?.status ?? null,
      validationDate: validation?.validatedAt
        ? this.getFormattedValidationDate(validation.validatedAt)
        : null,
      htmlBody,
      markdownBody: markdownContent,
      fileName,
      tags,
      postDate,
      formattedPostDate,
      socialMediaImageUrl: `${(await this.getHomeUrl()).toString()}blog/post/${fileName}/social-media.png`,
      blogUrl: `${(await this.getHomeUrl()).toString()}blog/post/${fileName}/view`,
    };

    return blogPost;
  }

  /*
   * Build the ordered contributor list for a post: the declared author first,
   * then every other git contributor (most commits first), de-duplicated.
   */
  private static async buildContributors(
    fileName: string,
    authorUsername: string | undefined,
  ): Promise<BlogPostContributor[]> {
    const contributors: BlogPostContributor[] = [];

    /*
     * Identity de-dup. A person can appear more than once when they commit under
     * different emails: once with a GitHub noreply email (resolved to a username)
     * and once with a personal email (resolved to a Gravatar entry whose display
     * name is often their username or real name). We merge those, preferring the
     * first-seen entry — and the declared author is always seen first.
     *
     * We only trust strong signals so two *different* GitHub users who merely
     * share a display name are never merged:
     *   - username  == a seen username
     *   - Gravatar display name == a seen username (the reported case)
     *   - Gravatar display name == another Gravatar display name
     *   - Gravatar display name == the declared author's display name
     * A GitHub user's display name is never used as a merge key.
     */
    const seenUsernames: Set<string> = new Set<string>();
    const seenGravatarNames: Set<string> = new Set<string>();
    /*
     * Position of each accepted Gravatar entry, keyed by its display name, so a
     * later GitHub entry for the same person can replace (upgrade) it in place.
     */
    const gravatarIndexByName: Map<string, number> = new Map();
    let authorNameLower: string | null = null;

    const normalize: (value: string | undefined) => string | null = (
      value: string | undefined,
    ): string | null => {
      const normalized: string = (value || "").trim().toLowerCase();
      return normalized.length > 0 ? normalized : null;
    };

    const isDuplicate: (contributor: BlogPostContributor) => boolean = (
      contributor: BlogPostContributor,
    ): boolean => {
      const username: string | null = normalize(contributor.username);
      const name: string | null = normalize(contributor.name);

      if (username) {
        // Same GitHub user (the Gravatar-name match is handled as an upgrade).
        return seenUsernames.has(username);
      }

      if (name) {
        return (
          seenUsernames.has(name) ||
          seenGravatarNames.has(name) ||
          name === authorNameLower
        );
      }

      return false;
    };

    const accept: (contributor: BlogPostContributor) => void = (
      contributor: BlogPostContributor,
    ): void => {
      contributors.push(contributor);
      const username: string | null = normalize(contributor.username);
      const name: string | null = normalize(contributor.name);
      if (username) {
        seenUsernames.add(username);
      } else if (name) {
        seenGravatarNames.add(name);
        gravatarIndexByName.set(name, contributors.length - 1);
      }
    };

    // Declared author goes first (with name/bio resolved from Authors.json).
    if (authorUsername) {
      const authorsMeta: JSONObject = await this.getAuthorsMeta();
      const authorMeta: JSONObject | undefined = authorsMeta[authorUsername] as
        | JSONObject
        | undefined;
      const authorContributor: BlogPostContributor = {
        username: authorUsername,
        name: (authorMeta?.["authorName"] as string) || authorUsername,
        githubUrl: `https://github.com/${authorUsername}`,
        profileImageUrl: `https://avatars.githubusercontent.com/${authorUsername}?s=64`,
      };
      authorNameLower = normalize(authorContributor.name);
      accept(authorContributor);
    }

    /*
     * Never block the request on the expensive `git log`: read whatever the
     * background warm has resolved so far and kick the warm off if it has not
     * started. Until it completes (or if it fails) this is empty and the caller
     * degrades to the declared author only.
     */
    this.ensureContributorsWarmStarted();
    const contributorsByPost: Map<string, BlogPostContributor[]> =
      this.contributorsByPostCache ?? new Map<string, BlogPostContributor[]>();

    for (const contributor of contributorsByPost.get(fileName) || []) {
      const username: string | null = normalize(contributor.username);

      /*
       * Same person already shown as a Gravatar (commit under a personal email):
       * upgrade that entry in place to this richer GitHub entry (avatar + link).
       */
      if (
        username &&
        !seenUsernames.has(username) &&
        gravatarIndexByName.has(username)
      ) {
        const index: number = gravatarIndexByName.get(username) as number;
        contributors[index] = contributor;
        gravatarIndexByName.delete(username);
        seenGravatarNames.delete(username);
        seenUsernames.add(username);
        continue;
      }

      if (isDuplicate(contributor)) {
        continue;
      }
      accept(contributor);
    }

    return contributors;
  }

  /*
   * Derive per-post contributors from git history in the background so the blog
   * list/post pages never pay the cold-start `git log` cost on the request path
   * (over the full-history blog repo that walk takes ~60s+ and previously risked
   * 504s). Idempotent and concurrency-safe: a single walk is shared across
   * callers, and once it succeeds the derived list/post caches are dropped so
   * they rebuild with the full contributor lists. Triggered at boot / after each
   * repo pull (see the UpdateBlog job) and lazily on first request as a fallback.
   */
  public static async warmContributors(): Promise<void> {
    // Already resolved — nothing to do.
    if (this.contributorsByPostCache) {
      return;
    }
    // A walk is already running — share it instead of launching another.
    if (this.contributorsWarmInFlight) {
      return this.contributorsWarmInFlight;
    }

    this.contributorsWarmAttempted = true;
    const warm: Promise<void> = (async (): Promise<void> => {
      await this.getContributorsByPost(this.CONTRIBUTORS_WARM_TIMEOUT_IN_MS);
      if (this.contributorsByPostCache) {
        /*
         * Contributors are now available. Drop the derived caches (which may have
         * been built author-only while the walk was running) so the blog
         * list/post pages rebuild with the full contributor lists.
         */
        this.blogPostListWithContributorsCache = null;
        this.blogPostCache.clear();
      }
    })();

    this.contributorsWarmInFlight = warm;
    try {
      await warm;
    } finally {
      this.contributorsWarmInFlight = null;
    }
  }

  /*
   * Kick the background warm once per process (until the next repo pull resets
   * it). Fire-and-forget: the request path must never wait on the `git log`.
   */
  private static ensureContributorsWarmStarted(): void {
    if (this.contributorsByPostCache || this.contributorsWarmAttempted) {
      return;
    }
    this.warmContributors().catch(() => {
      // Failures are already logged inside the walk; nothing actionable here.
    });
  }

  /*
   * One `git log` pass over the cloned blog repo, bucketed into a map of
   * post folder name -> contributors (ordered by commit count, most first).
   * Bounded by `timeoutInMS` (the child is killed on timeout). Only invoked by
   * the background warm. Returns an empty map WITHOUT caching when the walk
   * fails (timeout / shallow clone / not a repo / git missing) so a later warm
   * can retry; callers fall back to the declared author only.
   */
  private static async getContributorsByPost(
    timeoutInMS: number,
  ): Promise<Map<string, BlogPostContributor[]>> {
    if (this.contributorsByPostCache) {
      return this.contributorsByPostCache;
    }

    // Per slug: map of contributor key -> { contributor, commit count }.
    const countsByPost: Map<
      string,
      Map<string, { contributor: BlogPostContributor; count: number }>
    > = new Map();

    try {
      const commits: Array<{
        authorName: string;
        authorEmail: string;
        files: Array<string>;
      }> = await CodeRepositoryUtil.getCommitAuthorsWithFiles({
        repoPath: BlogRootPath,
        path: "posts",
        timeoutInMS,
      });

      for (const commit of commits) {
        const resolved: {
          key: string;
          contributor: BlogPostContributor;
        } | null = this.resolveContributor(
          commit.authorName,
          commit.authorEmail,
        );

        if (!resolved) {
          continue;
        }

        // A commit may touch several posts; count it once per post folder.
        const slugs: Set<string> = new Set<string>();
        for (const file of commit.files) {
          const parts: Array<string> = file.split("/");
          if (parts[0] === "posts" && parts[1]) {
            slugs.add(parts[1]);
          }
        }

        for (const slug of slugs) {
          let bySlug:
            | Map<string, { contributor: BlogPostContributor; count: number }>
            | undefined = countsByPost.get(slug);
          if (!bySlug) {
            bySlug = new Map();
            countsByPost.set(slug, bySlug);
          }

          const existing:
            | { contributor: BlogPostContributor; count: number }
            | undefined = bySlug.get(resolved.key);
          if (existing) {
            existing.count++;
          } else {
            bySlug.set(resolved.key, {
              contributor: resolved.contributor,
              count: 1,
            });
          }
        }
      }
    } catch (err) {
      /*
       * Walk failed (timed out / shallow clone / not a repo / git missing). Do
       * NOT cache: a later warm (e.g. after the next repo pull) can retry, and
       * callers fall back to the declared author only in the meantime.
       */
      logger.debug("BlogPost: unable to derive contributors from git history");
      logger.debug(err);
      return new Map<string, BlogPostContributor[]>();
    }

    const result: Map<string, BlogPostContributor[]> = new Map();
    for (const [slug, bySlug] of countsByPost) {
      const ordered: BlogPostContributor[] = [...bySlug.values()]
        .sort(
          (
            a: { contributor: BlogPostContributor; count: number },
            b: { contributor: BlogPostContributor; count: number },
          ) => {
            return b.count - a.count;
          },
        )
        .map((entry: { contributor: BlogPostContributor; count: number }) => {
          return entry.contributor;
        });
      result.set(slug, ordered);
    }

    this.contributorsByPostCache = result;
    return result;
  }

  /*
   * Map a commit's author (name + email) to a contributor. Resolves a GitHub
   * username from `users.noreply.github.com` emails; otherwise falls back to a
   * Gravatar identicon. Returns null for bots / unusable identities.
   */
  private static resolveContributor(
    rawName: string,
    rawEmail: string,
  ): { key: string; contributor: BlogPostContributor } | null {
    const name: string = (rawName || "").trim();
    const email: string = (rawEmail || "").trim().toLowerCase();

    const botPatterns: Array<RegExp> = [
      /\[bot\]/i,
      /github-actions/i,
      /dependabot/i,
      /web-flow/i,
      /actions-user/i,
    ];
    if (
      botPatterns.some((pattern: RegExp) => {
        return pattern.test(name) || pattern.test(email);
      })
    ) {
      return null;
    }

    /*
     * GitHub noreply emails: "username@users.noreply.github.com" or
     * "12345678+username@users.noreply.github.com".
     */
    const githubNoReplyMatch: RegExpMatchArray | null = email.match(
      /^(?:\d+\+)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)@users\.noreply\.github\.com$/,
    );
    if (githubNoReplyMatch && githubNoReplyMatch[1]) {
      const username: string = githubNoReplyMatch[1];
      return {
        key: `gh:${username.toLowerCase()}`,
        contributor: {
          username,
          name: name || username,
          githubUrl: `https://github.com/${username}`,
          profileImageUrl: `https://avatars.githubusercontent.com/${username}?s=64`,
        },
      };
    }

    // Fall back to a stable Gravatar identicon for real emails.
    if (email && email !== "noreply@github.com") {
      const hash: string = crypto.createHash("md5").update(email).digest("hex");
      return {
        key: `em:${email}`,
        contributor: {
          name: name || email,
          profileImageUrl: `https://www.gravatar.com/avatar/${hash}?d=identicon&s=64`,
        },
      };
    }

    return null;
  }

  /*
   * Reads the post's validation.json ({ status, validatedAt }), or null when the
   * post has not been validated yet / the file is absent or malformed.
   */
  public static async getValidation(
    fileName: string,
  ): Promise<{ status: string; validatedAt: string | null } | null> {
    const filePath: string = `${BlogRootPath}/posts/${fileName}/validation.json`;

    try {
      if (!(await LocalFile.doesFileExist(filePath))) {
        return null;
      }
      const content: string = await LocalFile.read(filePath);
      const json: JSONObject = JSONFunctions.parse(content) as JSONObject;
      const status: string | null = (json["status"] as string) || null;
      if (!status) {
        return null;
      }
      return {
        status,
        validatedAt: (json["validatedAt"] as string) || null,
      };
    } catch {
      return null;
    }
  }

  /*
   * Formats validation.json `validatedAt` (YYYY-MM-DD) into a friendly date,
   * matching how post dates are rendered. Returns null on malformed input.
   */
  private static getFormattedValidationDate(
    validatedAt: string,
  ): string | null {
    const [year, month, day] = validatedAt.split("-");
    if (!year || !month || !day) {
      return null;
    }
    try {
      const date: Date = OneUptimeDate.getDateFromYYYYMMDD(year, month, day);
      return OneUptimeDate.getDateAsLocalFormattedString(date, true);
    } catch {
      return null;
    }
  }

  // Renders the post's validation-summary.md to HTML, or null when absent/empty.
  public static async getValidationSummaryHtml(
    fileName: string,
  ): Promise<string | null> {
    const filePath: string = `${BlogRootPath}/posts/${fileName}/validation-summary.md`;

    try {
      if (!(await LocalFile.doesFileExist(filePath))) {
        return null;
      }
      let markdownContent: string = await LocalFile.read(filePath);
      if (!markdownContent || !markdownContent.trim()) {
        return null;
      }
      // Drop a leading top-level title; the modal already has its own heading.
      markdownContent = markdownContent
        .replace(/^[\uFEFF\s]*#\s+.*(\r?\n)+/, "")
        .trim();
      return await Markdown.convertToHTML(
        markdownContent,
        MarkdownContentType.BlogValidation,
      );
    } catch {
      return null;
    }
  }

  private static getPostDateFromFileName(fileName: string): string {
    const year: string | undefined = fileName.split("-")[0];
    const month: string | undefined = fileName.split("-")[1];
    const day: string | undefined = fileName.split("-")[2];

    if (!year || !month || !day) {
      throw new BadDataException("Invalid file name");
    }

    return `${year}-${month}-${day}`;
  }

  private static getFormattedPostDateFromFileName(fileName: string): string {
    // file name is of the format YYYY-MM-DD-Title.md
    const year: string | undefined = fileName.split("-")[0];
    const month: string | undefined = fileName.split("-")[1];
    const day: string | undefined = fileName.split("-")[2];

    if (!year || !month || !day) {
      throw new BadDataException("Invalid file name");
    }

    const date: Date = OneUptimeDate.getDateFromYYYYMMDD(year, month, day);
    return OneUptimeDate.getDateAsLocalFormattedString(date, true);
  }

  private static getPostFromMarkdown(markdownContent: string): string {
    const authorLine: string | undefined = markdownContent
      .split("\n")
      .find((line: string) => {
        return line.startsWith("Author:");
      });
    const titleLine: string | undefined = markdownContent
      .split("\n")
      .find((line: string) => {
        return line.startsWith("#");
      });
    const descriptionLine: string | undefined =
      markdownContent.split("\n").find((line: string) => {
        return line.startsWith("Description:");
      }) || "";

    const tagsLine: string | undefined =
      markdownContent.split("\n").find((line: string) => {
        return line.startsWith("Tags:");
      }) || "";

    if (!authorLine && !titleLine && !descriptionLine && !tagsLine) {
      return markdownContent;
    }

    const lines: string[] = markdownContent.split("\n");

    if (authorLine) {
      const authorLineIndex: number = lines.indexOf(authorLine);
      lines.splice(authorLineIndex, 1);
    }

    if (titleLine) {
      const titleLineIndex: number = lines.indexOf(titleLine);
      lines.splice(titleLineIndex, 1);
    }

    if (descriptionLine) {
      const descriptionLineIndex: number = lines.indexOf(descriptionLine);
      lines.splice(descriptionLineIndex, 1);
    }

    if (tagsLine) {
      const tagsLineIndex: number = lines.indexOf(tagsLine);
      lines.splice(tagsLineIndex, 1);
    }

    return lines.join("\n").trim();
  }

  /*
   * The title, description and tags are read off the post's README.md, whose
   * head is "# <title>", "Tags: <tag>, <tag>" and "Description: <text>". Each
   * is trimmed here, where it is read: the title used to keep the space after
   * its "#" and the description the space after its "Description:", and every
   * place they went - the <title>, the meta description, Open Graph, Twitter
   * and the structured data - began with that space (and a README saved with
   * CRLF line ends would add a "\r" at the end).
   */
  public static getTitleFromFileContent(fileContent: string): string {
    // title is the first line that starts with "#"

    const titleLine: string | undefined = fileContent
      .split("\n")
      .find((line: string) => {
        return line.startsWith("#");
      });

    const title: string = (titleLine || "").replace(TITLE_MARKER, "").trim();

    return title || "OneUptime Blog";
  }

  public static getTagsFromFileContent(fileContent: string): string[] {
    // tags is the first line that starts with "Tags:"

    const tagsLine: string | undefined =
      fileContent
        .split("\n")
        .find((line: string) => {
          return line.startsWith("Tags:");
        })
        ?.replace("Tags:", "") || "";

    return tagsLine
      .split(",")
      .map((tag: string) => {
        return tag.trim();
      })
      .filter((tag: string) => {
        // A post without a "Tags:" line, or with a stray comma, has no empty tag.
        return tag.length > 0;
      });
  }

  public static getDescriptionFromFileContent(fileContent: string): string {
    // description is the first line that starts with "Description:"

    const descriptionLine: string | undefined =
      fileContent
        .split("\n")
        .find((line: string) => {
          return line.startsWith("Description:");
        })
        ?.replace("Description:", "") || "";

    return descriptionLine.trim();
  }

  public static async getAuthorFromFileContent(
    fileContent: string,
  ): Promise<BlogPostAuthor | null> {
    // author line is in this format: Author: [username](githubUrl)

    const authorLine: string | undefined = fileContent
      .split("\n")
      .find((line: string) => {
        return line.startsWith("Author:");
      });
    const authorUsername: string | undefined = authorLine
      ?.split("[")[1]
      ?.split("]")[0];
    const authorGitHubUrl: string | undefined = authorLine
      ?.split("(")[1]
      ?.split(")")[0];
    const authorProfileImageUrl: string = `https://avatars.githubusercontent.com/${authorUsername}`;

    if (!authorUsername || !authorGitHubUrl) {
      return null;
    }

    return {
      username: authorUsername,
      githubUrl: authorGitHubUrl,
      profileImageUrl: authorProfileImageUrl,
      // Do NOT call GitHub; use username as name placeholder.
      name: authorUsername,
    };
  }
}
