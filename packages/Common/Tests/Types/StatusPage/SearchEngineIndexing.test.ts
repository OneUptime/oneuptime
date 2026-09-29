/**
 * The single place that decides "is this status page indexable?".
 *
 * Every renderer feeds this the raw flag off the /seo API response, and the
 * answer decides whether a <meta name="robots"> and an X-Robots-Tag go out.
 * The interesting half is what it does with values that are NOT an explicit
 * off - a missing field, a null, an API that did not answer - because that is
 * the state the internal HTTP call lands in whenever anything goes wrong, and
 * it must resolve to "indexable" rather than silently de-indexing pages whose
 * owners never asked for it.
 */

import {
  NOINDEX_ROBOTS_DIRECTIVE,
  SEARCH_ENGINE_INDEXING_FLAG_NAME,
  X_ROBOTS_TAG_HEADER_NAME,
  isSearchEngineIndexingEnabled,
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
