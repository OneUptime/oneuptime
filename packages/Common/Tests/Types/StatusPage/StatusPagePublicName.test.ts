import { describe, expect, test } from "@jest/globals";
import getStatusPagePublicName, {
  getStatusPagePublicName as namedExport,
} from "../../../Types/StatusPage/StatusPagePublicName";

/*
 * A STATUS PAGE'S NAME, AS ITS VISITORS READ IT (#7467).
 *
 * A new status page - made by Create Status Page or the guided setup - has
 * a name and no Page Title, and its public page read the Page Title alone:
 * its tab said "Status Page" and its header nothing. The page goes by its
 * Page Title when it has one, else by its name, everywhere a visitor reads
 * it.
 */
describe("a status page's public name", () => {
  test("is its Page Title when it has one", () => {
    expect(
      getStatusPagePublicName({
        pageTitle: "Acme Status",
        name: "acme-prod (internal)",
      }),
    ).toBe("Acme Status");
  });

  test("is its name when it has no Page Title: a page made by Create Status Page or the guided setup", () => {
    expect(getStatusPagePublicName({ name: "Walk Co Status" })).toBe(
      "Walk Co Status",
    );
    expect(
      getStatusPagePublicName({ pageTitle: null, name: "Walk Co Status" }),
    ).toBe("Walk Co Status");
    expect(
      getStatusPagePublicName({ pageTitle: undefined, name: "Walk Co Status" }),
    ).toBe("Walk Co Status");
  });

  test("a Page Title of nothing but spaces is none", () => {
    expect(
      getStatusPagePublicName({ pageTitle: "   ", name: "Walk Co Status" }),
    ).toBe("Walk Co Status");
  });

  test("is trimmed, either way", () => {
    expect(
      getStatusPagePublicName({ pageTitle: "  Acme Status  ", name: "x" }),
    ).toBe("Acme Status");
    expect(getStatusPagePublicName({ name: "  Walk Co Status " })).toBe(
      "Walk Co Status",
    );
  });

  test("is empty for a page with neither", () => {
    expect(getStatusPagePublicName({})).toBe("");
    expect(getStatusPagePublicName({ pageTitle: "", name: "" })).toBe("");
    expect(getStatusPagePublicName({ pageTitle: null, name: null })).toBe("");
  });

  test("is written in any script, as typed", () => {
    expect(getStatusPagePublicName({ name: "حالة أكمي" })).toBe("حالة أكمي");
    expect(getStatusPagePublicName({ pageTitle: "アクメの状態" })).toBe(
      "アクメの状態",
    );
  });

  test("is the module's default export too", () => {
    expect(namedExport).toBe(getStatusPagePublicName);
  });
});
