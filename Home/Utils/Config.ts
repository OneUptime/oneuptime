export const ViewsPath: string = "/usr/src/app/Views";
export const StaticPath: string = "/usr/src/app/Static";

/*
 * The blog is no longer baked into the Home image. It is cloned into a mounted
 * volume (see HelmChart home.yaml initContainer / docker-compose dev volume) and
 * kept fresh at runtime by the UpdateBlog cron. These are env-configurable so the
 * clone location, source repo (e.g. an in-cluster mirror for air-gapped installs)
 * and partial-clone filter can be overridden without rebuilding the image.
 */
export const BlogRootPath: string =
  process.env["BLOG_ROOT_PATH"] || "/usr/src/blog";

export const BlogRepositoryUrl: string =
  process.env["BLOG_REPOSITORY_URL"] || "https://github.com/oneuptime/blog";

/*
 * "blob:none" keeps the full commit + tree history (needed for the blog
 * contributor list derived from `git log`) while omitting only the HISTORICAL
 * versions of file blobs — this shrinks the .git download but not the working
 * tree (current post images are still checked out). Set BLOG_CLONE_FILTER="" for
 * a full clone. Do NOT use a shallow clone — it collapses contributors to a
 * single author.
 */
export const BlogCloneFilter: string =
  process.env["BLOG_CLONE_FILTER"] ?? "blob:none";

/*
 * Emergency kill-switch. When true, the blog is not downloaded at all: the
 * UpdateBlog job skips both clone and pull (the Kubernetes clone initContainer is
 * likewise skipped). Home then serves with no blog content — blog pages degrade
 * to empty while marketing/product/docs pages are unaffected. Use when the blog
 * source is unreachable or a bad clone is blocking Home from starting.
 */
export const BlogSkipDownload: boolean =
  process.env["BLOG_SKIP_DOWNLOAD"] === "true";
