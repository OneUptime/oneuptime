import BlogPagination, { BlogPageRequest } from "../Utils/BlogPagination";

/*
 * Which page of a blog post list a request asks for (Utils/BlogPagination.ts).
 *
 * Search Console counted 16,116 blog URLs "Crawled - currently not indexed",
 * most of them pages of /blog at two page sizes: ?pageSize= took any value
 * from 1 to 100, the pagination links carried it along, a page past the end
 * (/blog?page=99999) answered 200 with the last page, and every page named
 * /blog as its canonical. A list now has one page size; a request with
 * pageSize, or with its page written another way, is sent to the page's one
 * URL; a page that does not exist is a 404.
 *
 * BlogPages.test.ts sends these requests through the real routes.
 */

const resolve: (
  query: Record<string, unknown>,
  totalPosts: number,
  hasPageWhenEmpty?: boolean,
) => BlogPageRequest = (
  query: Record<string, unknown>,
  totalPosts: number,
  hasPageWhenEmpty: boolean = true,
): BlogPageRequest => {
  return BlogPagination.resolve({
    query: query,
    totalPosts: totalPosts,
    hasPageWhenEmpty: hasPageWhenEmpty,
  });
};

describe("the page size", () => {
  test("is 25, the size the lists always defaulted to", () => {
    expect(BlogPagination.PAGE_SIZE).toBe(25);
  });

  test("a list of 61,019 posts has 2,441 pages", () => {
    expect(BlogPagination.getTotalPages(61019)).toBe(2441);
  });

  test.each([
    [0, 0],
    [1, 1],
    [25, 1],
    [26, 2],
    [50, 2],
    [51, 3],
  ])("%i posts are %i pages", (posts: number, pages: number) => {
    expect(BlogPagination.getTotalPages(posts)).toBe(pages);
  });

  test("a page holds the posts of its place in the list, 25 at most", () => {
    const posts: Array<number> = Array.from(
      { length: 60 },
      (_: unknown, index: number) => {
        return index;
      },
    );

    expect(BlogPagination.getPagePosts(posts, 1)).toEqual(posts.slice(0, 25));
    expect(BlogPagination.getPagePosts(posts, 2)).toEqual(posts.slice(25, 50));
    expect(BlogPagination.getPagePosts(posts, 3)).toEqual(posts.slice(50, 60));
  });
});

describe("a page that exists", () => {
  test("the list's own URL is its first page", () => {
    expect(resolve({}, 60)).toEqual({ kind: "page", page: 1, totalPages: 3 });
  });

  test("?page=N is page N", () => {
    expect(resolve({ page: "2" }, 60)).toEqual({
      kind: "page",
      page: 2,
      totalPages: 3,
    });
    expect(resolve({ page: "3" }, 60)).toEqual({
      kind: "page",
      page: 3,
      totalPages: 3,
    });
  });

  test("other parameters do not change the page", () => {
    expect(
      resolve({ page: "2", utm_source: "newsletter", gclid: "abc" }, 60),
    ).toEqual({ kind: "page", page: 2, totalPages: 3 });
  });

  test("/blog with no posts is still a page", () => {
    expect(resolve({}, 0, true)).toEqual({
      kind: "page",
      page: 1,
      totalPages: 1,
    });
  });
});

describe("a page that does not exist is a 404", () => {
  test("one past the last page", () => {
    expect(resolve({ page: "4" }, 60)).toEqual({ kind: "not-found" });
    expect(resolve({ page: "3" }, 50)).toEqual({ kind: "not-found" });
  });

  test("far past the last page (/blog?page=99999)", () => {
    expect(resolve({ page: "99999" }, 61019)).toEqual({ kind: "not-found" });
    expect(resolve({ page: "9".repeat(400) }, 61019)).toEqual({
      kind: "not-found",
    });
  });

  test.each(["0", "00", "-1", "-0"])(
    "?page=%s, below the first page",
    (page: string) => {
      expect(resolve({ page: page }, 60)).toEqual({ kind: "not-found" });
    },
  );

  test.each([
    "abc",
    "",
    " ",
    "2abc",
    "2.5",
    "2.0",
    "1e3",
    "+2",
    " 2",
    "2 ",
    "0x2",
    "٢",
    "Infinity",
    "NaN",
  ])("?page=%j, not a whole number", (page: string) => {
    expect(resolve({ page: page }, 60)).toEqual({ kind: "not-found" });
  });

  test("?page given twice, or as an object", () => {
    expect(resolve({ page: ["1", "2"] }, 60)).toEqual({ kind: "not-found" });
    expect(resolve({ page: { a: "2" } }, 60)).toEqual({ kind: "not-found" });
  });

  test("a list with no posts has no pages, unless it is /blog", () => {
    expect(resolve({}, 0, false)).toEqual({ kind: "not-found" });
    expect(resolve({ page: "2" }, 0, true)).toEqual({ kind: "not-found" });
  });

  test("a request for a missing page with pageSize is a 404, not a redirect to one", () => {
    expect(resolve({ page: "99999", pageSize: "24" }, 61019)).toEqual({
      kind: "not-found",
    });
    expect(resolve({ page: "abc", pageSize: "24" }, 60)).toEqual({
      kind: "not-found",
    });
    expect(resolve({ page: "0", pageSize: "25" }, 60)).toEqual({
      kind: "not-found",
    });
  });
});

describe("a page asked for another way is sent to its URL", () => {
  test.each(["24", "25", "100", "1", "0", "-5", "abc", "", "1000"])(
    "?pageSize=%j keeps the page number and loses the page size",
    (pageSize: string) => {
      expect(resolve({ page: "2", pageSize: pageSize }, 60)).toEqual({
        kind: "redirect",
        page: 2,
      });
    },
  );

  test("?pageSize alone is the first page", () => {
    expect(resolve({ pageSize: "24" }, 60)).toEqual({
      kind: "redirect",
      page: 1,
    });
  });

  test("?pageSize given twice is still a page size", () => {
    expect(resolve({ page: "2", pageSize: ["24", "25"] }, 60)).toEqual({
      kind: "redirect",
      page: 2,
    });
  });

  test("?page=1 is the list's own URL", () => {
    expect(resolve({ page: "1" }, 60)).toEqual({ kind: "redirect", page: 1 });
  });

  test("a page number with leading zeros is the page it names", () => {
    expect(resolve({ page: "02" }, 60)).toEqual({ kind: "redirect", page: 2 });
    expect(resolve({ page: "001" }, 60)).toEqual({
      kind: "redirect",
      page: 1,
    });
  });
});

describe("a page's URL", () => {
  test("page 1 is the list itself; page N is ?page=N", () => {
    expect(BlogPagination.getPagePath("/blog", 1)).toBe("/blog");
    expect(BlogPagination.getPagePath("/blog", 2)).toBe("/blog?page=2");
    expect(BlogPagination.getPagePath("/blog/tag/ci-cd", 7)).toBe(
      "/blog/tag/ci-cd?page=7",
    );
  });

  test("never carries a page size", () => {
    for (let page: number = 1; page <= 50; page++) {
      expect(BlogPagination.getPagePath("/blog", page)).not.toContain(
        "pageSize",
      );
    }
  });
});

describe("where a redirect goes", () => {
  test("to the page's URL, without page or pageSize", () => {
    expect(
      BlogPagination.getRedirectPath("/blog", 2, "/blog?page=2&pageSize=24"),
    ).toBe("/blog?page=2");
    expect(
      BlogPagination.getRedirectPath("/blog", 1, "/blog?pageSize=24&page=1"),
    ).toBe("/blog");
    expect(BlogPagination.getRedirectPath("/blog", 1, "/blog?page=1")).toBe(
      "/blog",
    );
  });

  test("keeping every other parameter as it was sent, in its order", () => {
    expect(
      BlogPagination.getRedirectPath(
        "/blog",
        3,
        "/blog?utm_source=news%20letter&page=3&pageSize=24&gclid=Cj0KCQ&utm_medium=email",
      ),
    ).toBe(
      "/blog?page=3&utm_source=news%20letter&gclid=Cj0KCQ&utm_medium=email",
    );
    expect(
      BlogPagination.getRedirectPath("/blog", 1, "/blog?pageSize=25&ref=hn"),
    ).toBe("/blog?ref=hn");
  });

  test("leaving behind page and pageSize however they are written", () => {
    expect(
      BlogPagination.getRedirectPath(
        "/blog/tag/kubernetes",
        2,
        "/blog/tag/kubernetes?pageSize[]=3&p%61ge=2&pageSize=1&page+=x&keep=1",
      ),
    ).toBe("/blog/tag/kubernetes?page=2&page+=x&keep=1");
  });

  test("keeping a parameter it cannot decode", () => {
    expect(
      BlogPagination.getRedirectPath("/blog", 2, "/blog?page=2&bad%E0%A4=1"),
    ).toBe("/blog?page=2&bad%E0%A4=1");
  });

  test("dropping empty pieces and a bare question mark", () => {
    expect(BlogPagination.getRedirectPath("/blog", 1, "/blog?")).toBe("/blog");
    expect(
      BlogPagination.getRedirectPath("/blog", 2, "/blog?&&page=02&&"),
    ).toBe("/blog?page=2");
  });

  test("to a tag's own address when the request named the tag another way", () => {
    expect(
      BlogPagination.getRedirectPath(
        "/blog/tag/ci-cd",
        2,
        "/blog/tag/ci/cd?page=2&pageSize=25",
      ),
    ).toBe("/blog/tag/ci-cd?page=2");
  });
});
