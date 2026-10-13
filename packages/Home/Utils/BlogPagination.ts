/*
 * The pages of the blog's post lists: /blog and each tag's page.
 *
 * In October 2026 Search Console had 16,116 blog URLs "Crawled - currently
 * not indexed", most of them pages of these lists: /blog?page=N at two page
 * sizes, because ?pageSize= took any value from 1 to 100 and the pagination
 * links carried it along; every page past the last one (/blog?page=99999)
 * answered 200 with the last page; and every page declared /blog as its
 * canonical, so none of them was a page in its own right. Now:
 *
 * - A list has one page size, PAGE_SIZE, and its URLs never carry pageSize.
 *   A request that still does is sent (301) to the same page number without
 *   it: the page that holds that number of posts per page, rather than a new
 *   URL for every size. Keeping the number, rather than the posts that page
 *   held, is all that can be kept: a list's pages shift by one post every
 *   time a post is published.
 * - Page 1 is the list's own path; page N is <path>?page=N. Each page
 *   declares itself as its canonical. ?page=1, ?page=02 and the like are
 *   sent to the one way of writing the page they name.
 * - A page that does not exist is a 404: a page number that is not a whole
 *   number from 1 up, or one past the last page. A list with no posts has no
 *   pages at all - except /blog, which is a page of its own even when empty.
 *
 * A redirect keeps the rest of the query as it was sent (Utils/Redirect.ts
 * explains why: an ad click's gclid and utm_* parameters live there).
 */

export type BlogPageRequest =
  // Render this page of the list.
  | { kind: "page"; page: number; totalPages: number }
  // Send the request (301) to this page's one URL.
  | { kind: "redirect"; page: number }
  // There is no such page: answer 404.
  | { kind: "not-found" };

const DIGITS: RegExp = /^[0-9]+$/;

export default class BlogPagination {
  public static readonly PAGE_SIZE: number = 25;

  public static getTotalPages(totalPosts: number): number {
    return Math.ceil(totalPosts / BlogPagination.PAGE_SIZE);
  }

  // Which page of a list of totalPosts a request asks for, if any.
  public static resolve(data: {
    query: Record<string, unknown>;
    totalPosts: number;
    // Whether the list's first page exists when it has no posts (/blog).
    hasPageWhenEmpty: boolean;
  }): BlogPageRequest {
    const pageValue: unknown = data.query["page"];
    let page: number = 1;
    // Whether the request writes the page the way its own URL does.
    let isWrittenAsItsUrl: boolean = true;

    if (pageValue !== undefined) {
      // One whole number: not "abc", "-1", "2.5", "", or ?page=1&page=2.
      if (typeof pageValue !== "string" || !DIGITS.test(pageValue)) {
        return { kind: "not-found" };
      }

      page = Number(pageValue);

      if (page < 1) {
        return { kind: "not-found" };
      }

      isWrittenAsItsUrl = page > 1 && pageValue === String(page);
    }

    const totalPages: number = Math.max(
      BlogPagination.getTotalPages(data.totalPosts),
      data.hasPageWhenEmpty ? 1 : 0,
    );

    if (page > totalPages) {
      return { kind: "not-found" };
    }

    if (data.query["pageSize"] !== undefined || !isWrittenAsItsUrl) {
      return { kind: "redirect", page: page };
    }

    return { kind: "page", page: page, totalPages: totalPages };
  }

  // The path of a page of the list at basePath: the list itself for page 1.
  public static getPagePath(basePath: string, page: number): string {
    return page > 1 ? `${basePath}?page=${page}` : basePath;
  }

  // The posts on a page.
  public static getPagePosts<T>(posts: Array<T>, page: number): Array<T> {
    const start: number = (page - 1) * BlogPagination.PAGE_SIZE;

    return posts.slice(start, start + BlogPagination.PAGE_SIZE);
  }

  /*
   * Where to send a request for a page of the list at basePath: the page's
   * path, with every other parameter of the request's query after it, as
   * sent. The request's page and pageSize parameters are left behind.
   */
  public static getRedirectPath(
    basePath: string,
    page: number,
    originalUrl: string,
  ): string {
    const pagePath: string = BlogPagination.getPagePath(basePath, page);
    const queryStart: number = originalUrl.indexOf("?");

    if (queryStart === -1) {
      return pagePath;
    }

    const keptParameters: Array<string> = originalUrl
      .slice(queryStart + 1)
      .split("&")
      .filter((parameter: string) => {
        return (
          parameter.length > 0 &&
          !BlogPagination.isPaginationParameter(parameter)
        );
      });

    if (keptParameters.length === 0) {
      return pagePath;
    }

    const joiner: string = pagePath.includes("?") ? "&" : "?";

    return `${pagePath}${joiner}${keptParameters.join("&")}`;
  }

  /*
   * Whether a raw "key=value" names page or pageSize, as the query parser
   * reads it: decoded, and with any [..] after the name (pageSize[]=3).
   */
  private static isPaginationParameter(parameter: string): boolean {
    const rawKey: string = parameter.split("=")[0] || "";
    let key: string = rawKey;

    try {
      key = decodeURIComponent(rawKey.split("+").join(" "));
    } catch {
      // A malformed escape: the parser keeps such a key as it is.
    }

    const name: string = key.split("[")[0] || "";

    return name === "page" || name === "pageSize";
  }
}
