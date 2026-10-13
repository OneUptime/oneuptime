/**
 * The single place that decides "is this status page indexable here?".
 *
 * Every renderer feeds isSearchEngineIndexingAllowed the path it was asked for
 * and the raw flag off the /seo API response, and the answer decides whether a
 * <meta name="robots"> and an X-Robots-Tag go out. A preview URL is never
 * indexable. On a custom domain, the interesting half is what the flag reading
 * does with values that are NOT an explicit off - a missing field, a null, an
 * API that did not answer - because that is the state the internal HTTP call
 * lands in whenever anything goes wrong, and it must resolve to "indexable"
 * rather than silently de-indexing pages whose owners never asked for it.
 */

import {
  NOINDEX_ROBOTS_DIRECTIVE,
  SEARCH_ENGINE_INDEXING_FLAG_NAME,
  X_ROBOTS_TAG_HEADER_NAME,
  isSearchEngineIndexingAllowed,
  isSearchEngineIndexingEnabled,
  isStatusPagePreviewPath,
} from "../../../Types/StatusPage/SearchEngineIndexing";
import { describe, expect, test } from "@jest/globals";

describe("isSearchEngineIndexingEnabled", () => {
  test("the owner turning the toggle off is the only thing that blocks indexing", () => {
    expect(isSearchEngineIndexingEnabled(false)).toBe(false);
  });

  test("the toggle left on indexes", () => {
    expect(isSearchEngineIndexingEnabled(true)).toBe(true);
  });

  test("a JSON round-trip that stringified the boolean still reads as off", () => {
    /*
     * The flag crosses an HTTP boundary between the API and the two frontend
     * servers. A serializer that renders booleans as strings must not turn an
     * opt-out back into an opt-in.
     */
    expect(isSearchEngineIndexingEnabled("false")).toBe(false);
    expect(isSearchEngineIndexingEnabled("true")).toBe(true);
  });

  describe("anything that is not an explicit off leaves the page indexable", () => {
    /*
     * These are the shapes an unreachable or older /seo API produces. Reading
     * any of them as "noindex" would take a page out of Google over a blip on
     * an internal HTTP call - a failure the owner never asked for and would
     * have no way to see.
     */
    const notAnExplicitOff: Array<[string, unknown]> = [
      ["field absent from the response", undefined],
      ["field present but null", null],
      ["empty string", ""],
      ["zero", 0],
      ["the string 'no'", "no"],
      ["the string 'FALSE' in the wrong case", "FALSE"],
      ["an object", {}],
    ];

    test.each(notAnExplicitOff)("%s", (_label: string, value: unknown) => {
      expect(isSearchEngineIndexingEnabled(value)).toBe(true);
    });
  });
});

const STATUS_PAGE_ID: string = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("isStatusPagePreviewPath", () => {
  test("a status page's preview URL and every page under it", () => {
    for (const path of [
      `/status-page/${STATUS_PAGE_ID}`,
      `/status-page/${STATUS_PAGE_ID}/incidents`,
      `/status-page/${STATUS_PAGE_ID}/incidents/${STATUS_PAGE_ID}`,
      `/status-page/${STATUS_PAGE_ID}/rss`,
      `/status-page/${STATUS_PAGE_ID}/llms.txt`,
      "/status-page/",
    ]) {
      expect(isStatusPagePreviewPath(path)).toBe(true);
    }
  });

  test("a status page served from the root of its custom domain", () => {
    for (const path of [
      "/",
      "/incidents",
      `/incidents/${STATUS_PAGE_ID}`,
      "/rss",
      "/llms.txt",
    ]) {
      expect(isStatusPagePreviewPath(path)).toBe(false);
    }
  });
});

describe("isSearchEngineIndexingAllowed", () => {
  /*
   * Spam sites created status pages to get pages for pirated films into
   * search results under OneUptime's domain, at their preview URLs. The owner's
   * setting is what they control, so it must not reach the preview URL.
   */
  describe("on a preview URL", () => {
    const flags: Array<[string, unknown]> = [
      ["the owner left indexing on", true],
      ["the owner turned indexing off", false],
      ["the owner's setting could not be read", undefined],
    ];

    test.each(flags)(
      "never, when %s",
      (_label: string, indexingFlag: unknown) => {
        expect(
          isSearchEngineIndexingAllowed({
            path: `/status-page/${STATUS_PAGE_ID}`,
            indexingFlag: indexingFlag,
          }),
        ).toBe(false);
      },
    );

    test("never, on the pages under it either", () => {
      expect(
        isSearchEngineIndexingAllowed({
          path: `/status-page/${STATUS_PAGE_ID}/incidents/${STATUS_PAGE_ID}`,
          indexingFlag: true,
        }),
      ).toBe(false);
    });
  });

  describe("on a custom domain", () => {
    test("when the owner left indexing on", () => {
      expect(
        isSearchEngineIndexingAllowed({ path: "/", indexingFlag: true }),
      ).toBe(true);
    });

    test("not when the owner turned indexing off", () => {
      expect(
        isSearchEngineIndexingAllowed({ path: "/", indexingFlag: false }),
      ).toBe(false);
      expect(
        isSearchEngineIndexingAllowed({
          path: "/incidents",
          indexingFlag: "false",
        }),
      ).toBe(false);
    });

    test("when the owner's setting could not be read, as before", () => {
      expect(
        isSearchEngineIndexingAllowed({ path: "/", indexingFlag: undefined }),
      ).toBe(true);
    });
  });
});

describe("the directives that go on the wire", () => {
  /*
   * Pinned strings. Crawlers parse these literally, so a typo here is a
   * feature that silently does nothing - the page keeps being indexed and
   * nothing errors.
   */
  test("the robots directive is noindex, nofollow", () => {
    expect(NOINDEX_ROBOTS_DIRECTIVE).toBe("noindex, nofollow");
  });

  test("the response header is X-Robots-Tag", () => {
    expect(X_ROBOTS_TAG_HEADER_NAME).toBe("X-Robots-Tag");
  });

  test("the API/template flag name matches the model column name", () => {
    /*
     * The /seo API keys its response off this constant, and index.ejs reads a
     * variable of the same name. Renaming the column without renaming this
     * would leave the template reading undefined - which reads as indexable,
     * so the toggle would just stop working, quietly.
     */
    expect(SEARCH_ENGINE_INDEXING_FLAG_NAME).toBe("enableSearchEngineIndexing");
  });
});
