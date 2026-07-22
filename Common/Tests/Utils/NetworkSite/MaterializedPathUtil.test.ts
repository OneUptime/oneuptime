import MaterializedPathUtil from "../../../Utils/NetworkSite/MaterializedPathUtil";

describe("MaterializedPathUtil.buildPath", () => {
  it("builds a root path from a null parent path", () => {
    expect(MaterializedPathUtil.buildPath(null, "a")).toBe("/a/");
  });

  it("builds a root path from an undefined parent path", () => {
    expect(MaterializedPathUtil.buildPath(undefined, "a")).toBe("/a/");
  });

  it("builds a root path from an empty parent path", () => {
    expect(MaterializedPathUtil.buildPath("", "a")).toBe("/a/");
  });

  it("appends the site id to the parent path", () => {
    expect(MaterializedPathUtil.buildPath("/a/", "b")).toBe("/a/b/");
  });

  it("builds deep paths", () => {
    expect(MaterializedPathUtil.buildPath("/a/b/c/", "d")).toBe("/a/b/c/d/");
  });

  it("normalizes a parent path missing its trailing slash", () => {
    expect(MaterializedPathUtil.buildPath("/a/b", "c")).toBe("/a/b/c/");
  });

  it("normalizes a parent path missing its leading slash", () => {
    expect(MaterializedPathUtil.buildPath("a/b/", "c")).toBe("/a/b/c/");
  });

  it("collapses duplicate slashes in the parent path", () => {
    expect(MaterializedPathUtil.buildPath("//a//b//", "c")).toBe("/a/b/c/");
  });

  it("treats a bare slash parent as root", () => {
    expect(MaterializedPathUtil.buildPath("/", "a")).toBe("/a/");
  });
});

describe("MaterializedPathUtil.segmentsOf", () => {
  it("splits a path into ids", () => {
    expect(MaterializedPathUtil.segmentsOf("/a/b/c/")).toEqual(["a", "b", "c"]);
  });

  it("returns [] for null, undefined and empty", () => {
    expect(MaterializedPathUtil.segmentsOf(null)).toEqual([]);
    expect(MaterializedPathUtil.segmentsOf(undefined)).toEqual([]);
    expect(MaterializedPathUtil.segmentsOf("")).toEqual([]);
  });

  it("ignores empty segments", () => {
    expect(MaterializedPathUtil.segmentsOf("///a///b//")).toEqual(["a", "b"]);
  });

  it("returns [] for a bare slash", () => {
    expect(MaterializedPathUtil.segmentsOf("/")).toEqual([]);
  });
});

describe("MaterializedPathUtil.depthOf", () => {
  it("is 0 for a root path", () => {
    expect(MaterializedPathUtil.depthOf("/a/")).toBe(0);
  });

  it("counts ancestors for nested paths", () => {
    expect(MaterializedPathUtil.depthOf("/a/b/")).toBe(1);
    expect(MaterializedPathUtil.depthOf("/a/b/c/d/")).toBe(3);
  });

  it("is 0 for empty or invalid paths", () => {
    expect(MaterializedPathUtil.depthOf("")).toBe(0);
    expect(MaterializedPathUtil.depthOf(null)).toBe(0);
    expect(MaterializedPathUtil.depthOf(undefined)).toBe(0);
    expect(MaterializedPathUtil.depthOf("/")).toBe(0);
  });
});

describe("MaterializedPathUtil.isDescendant", () => {
  it("is true for a strict descendant", () => {
    expect(MaterializedPathUtil.isDescendant("/a/b/", "/a/")).toBe(true);
    expect(MaterializedPathUtil.isDescendant("/a/b/c/", "/a/")).toBe(true);
  });

  it("is false for the same path (a site is not its own descendant)", () => {
    expect(MaterializedPathUtil.isDescendant("/a/", "/a/")).toBe(false);
  });

  it("is false for unrelated paths", () => {
    expect(MaterializedPathUtil.isDescendant("/x/y/", "/a/")).toBe(false);
  });

  it("is false for an ancestor (direction matters)", () => {
    expect(MaterializedPathUtil.isDescendant("/a/", "/a/b/")).toBe(false);
  });

  it("does not treat an id sharing a prefix as a descendant", () => {
    // '/ab/' is NOT under '/a/' - the trailing slash protects the boundary.
    expect(MaterializedPathUtil.isDescendant("/ab/", "/a/")).toBe(false);
    expect(MaterializedPathUtil.isDescendant("/ab/c/", "/a/")).toBe(false);
  });

  it("is false when either path is missing", () => {
    expect(MaterializedPathUtil.isDescendant(null, "/a/")).toBe(false);
    expect(MaterializedPathUtil.isDescendant("/a/b/", null)).toBe(false);
    expect(MaterializedPathUtil.isDescendant(undefined, undefined)).toBe(false);
  });
});

describe("MaterializedPathUtil.wouldCreateCycle", () => {
  it("detects re-parenting under a descendant", () => {
    // Moving 'a' under '/a/b/' (its own child) is a cycle.
    expect(MaterializedPathUtil.wouldCreateCycle("a", "/a/b/")).toBe(true);
  });

  it("detects re-parenting under itself", () => {
    expect(MaterializedPathUtil.wouldCreateCycle("a", "/a/")).toBe(true);
  });

  it("detects the site id anywhere in the parent chain", () => {
    expect(MaterializedPathUtil.wouldCreateCycle("b", "/a/b/c/")).toBe(true);
  });

  it("allows re-parenting under an unrelated site", () => {
    expect(MaterializedPathUtil.wouldCreateCycle("a", "/x/y/")).toBe(false);
  });

  it("allows becoming a root (no parent path)", () => {
    expect(MaterializedPathUtil.wouldCreateCycle("a", null)).toBe(false);
    expect(MaterializedPathUtil.wouldCreateCycle("a", undefined)).toBe(false);
    expect(MaterializedPathUtil.wouldCreateCycle("a", "")).toBe(false);
  });

  it("does not confuse ids that share a prefix", () => {
    expect(MaterializedPathUtil.wouldCreateCycle("a", "/ab/")).toBe(false);
    expect(MaterializedPathUtil.wouldCreateCycle("ab", "/a/")).toBe(false);
  });

  it("is false for an empty site id", () => {
    expect(MaterializedPathUtil.wouldCreateCycle("", "/a/")).toBe(false);
  });
});

describe("MaterializedPathUtil.rebasePaths", () => {
  it("rewrites the moved subtree's prefix", () => {
    expect(
      MaterializedPathUtil.rebasePaths("/a/b/", "/x/b/", [
        "/a/b/",
        "/a/b/c/",
        "/a/b/c/d/",
      ]),
    ).toEqual(["/x/b/", "/x/b/c/", "/x/b/c/d/"]);
  });

  it("leaves paths outside the subtree unchanged", () => {
    expect(
      MaterializedPathUtil.rebasePaths("/a/b/", "/x/b/", ["/a/", "/a/z/"]),
    ).toEqual(["/a/", "/a/z/"]);
  });

  it("supports moving a subtree to the root", () => {
    expect(
      MaterializedPathUtil.rebasePaths("/a/b/", "/b/", ["/a/b/", "/a/b/c/"]),
    ).toEqual(["/b/", "/b/c/"]);
  });

  it("supports moving a root subtree under another site", () => {
    expect(
      MaterializedPathUtil.rebasePaths("/b/", "/a/b/", ["/b/", "/b/c/"]),
    ).toEqual(["/a/b/", "/a/b/c/"]);
  });

  it("does not rebase ids that merely share a prefix with the old path", () => {
    expect(
      MaterializedPathUtil.rebasePaths("/a/b/", "/x/b/", ["/a/bc/"]),
    ).toEqual(["/a/bc/"]);
  });

  it("preserves input order", () => {
    expect(
      MaterializedPathUtil.rebasePaths("/a/", "/z/a/", [
        "/other/",
        "/a/x/",
        "/other2/",
        "/a/",
      ]),
    ).toEqual(["/other/", "/z/a/x/", "/other2/", "/z/a/"]);
  });

  it("returns [] for an empty affected list", () => {
    expect(MaterializedPathUtil.rebasePaths("/a/", "/b/", [])).toEqual([]);
  });

  it("works with uuid-shaped segments", () => {
    const root: string = "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e";
    const child: string = "11111111-2222-4333-8444-555555555555";
    const newRoot: string = "99999999-8888-4777-8666-555555555555";

    expect(
      MaterializedPathUtil.rebasePaths(`/${root}/`, `/${newRoot}/${root}/`, [
        `/${root}/${child}/`,
      ]),
    ).toEqual([`/${newRoot}/${root}/${child}/`]);
  });
});
