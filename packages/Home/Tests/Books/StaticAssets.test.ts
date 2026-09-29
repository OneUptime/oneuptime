import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import {
  BookPageAssets,
  getBookPageAssets,
  versionedStaticPath,
} from "../../Utils/StaticAssets";

/*
 * Static files are served as immutable for a year, so a page must reference
 * each revision of its CSS and JavaScript by a URL of its own. These tests
 * pin the content hash, the cache invalidation on change, and that the
 * helper never looks outside the static root.
 */

const VERSION_PATTERN: RegExp = /\?v=[0-9a-f]{12}$/;
const REAL_STATIC_ROOT: string = path.join(__dirname, "..", "..", "Static");

const hashOf: (content: string | Buffer) => string = (
  content: string | Buffer,
): string => {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);
};

describe("versionedStaticPath", () => {
  let sandbox: string;
  let root: string;

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "books-static-"));
    root = path.join(sandbox, "Static");
    fs.mkdirSync(path.join(root, "css"), { recursive: true });
    fs.writeFileSync(path.join(sandbox, "outside.txt"), "outside the root");
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  test("appends the first 12 hex characters of the content's SHA-256", () => {
    fs.writeFileSync(path.join(root, "css", "app.css"), "body { color: red; }");

    const url: string = versionedStaticPath("/css/app.css", root);

    expect(url).toBe(`/css/app.css?v=${hashOf("body { color: red; }")}`);
    expect(url).toMatch(VERSION_PATTERN);
  });

  test("is stable while the file does not change", () => {
    fs.writeFileSync(path.join(root, "css", "app.css"), "a { }");

    expect(versionedStaticPath("/css/app.css", root)).toBe(
      versionedStaticPath("/css/app.css", root),
    );
  });

  test("reads an unchanged file only once", () => {
    fs.writeFileSync(path.join(root, "css", "once.css"), "p { }");
    const read: jest.SpyInstance = jest.spyOn(fs, "readFileSync");

    versionedStaticPath("/css/once.css", root);
    versionedStaticPath("/css/once.css", root);
    versionedStaticPath("/css/once.css", root);

    const reads: number = read.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return String(call[0]).endsWith("once.css");
      },
    ).length;

    expect(reads).toBe(1);
  });

  test("changes when the content changes", () => {
    const file: string = path.join(root, "css", "app.css");
    fs.writeFileSync(file, "version one");
    const first: string = versionedStaticPath("/css/app.css", root);

    fs.writeFileSync(file, "version two");
    const later: Date = new Date(Date.now() + 5000);
    fs.utimesSync(file, later, later);
    const second: string = versionedStaticPath("/css/app.css", root);

    expect(first).toBe(`/css/app.css?v=${hashOf("version one")}`);
    expect(second).toBe(`/css/app.css?v=${hashOf("version two")}`);
    expect(second).not.toBe(first);
  });

  test("changes when a same-sized edit lands with a new modification time", () => {
    const file: string = path.join(root, "css", "same-size.css");
    fs.writeFileSync(file, "aaaa");
    const first: string = versionedStaticPath("/css/same-size.css", root);

    fs.writeFileSync(file, "bbbb");
    const later: Date = new Date(Date.now() + 10000);
    fs.utimesSync(file, later, later);

    expect(versionedStaticPath("/css/same-size.css", root)).not.toBe(first);
    expect(versionedStaticPath("/css/same-size.css", root)).toBe(
      `/css/same-size.css?v=${hashOf("bbbb")}`,
    );
  });

  test("a missing file keeps its plain URL", () => {
    expect(versionedStaticPath("/css/missing.css", root)).toBe(
      "/css/missing.css",
    );
  });

  test("a directory keeps its plain URL", () => {
    expect(versionedStaticPath("/css", root)).toBe("/css");
  });

  test.each([
    "/../outside.txt",
    "/../../etc/passwd",
    "/css/../../outside.txt",
    "/",
  ])(
    "never versions or reads a path outside the root (%s)",
    (assetPath: string) => {
      const stat: jest.SpyInstance = jest.spyOn(fs, "statSync");
      const read: jest.SpyInstance = jest.spyOn(fs, "readFileSync");

      expect(versionedStaticPath(assetPath, root)).toBe(assetPath);
      expect(stat).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    },
  );

  test("a path that only climbs back into the root is still served", () => {
    fs.writeFileSync(path.join(root, "css", "inside.css"), "inside");

    expect(versionedStaticPath("/css/../css/inside.css", root)).toBe(
      `/css/../css/inside.css?v=${hashOf("inside")}`,
    );
  });
});

describe("getBookPageAssets", () => {
  test("versions the books page's stylesheet and scripts by their real content", () => {
    const assets: BookPageAssets = getBookPageAssets(REAL_STATIC_ROOT);
    const expected: Record<keyof BookPageAssets, string> = {
      css: "/css/books.css",
      coreJs: "/js/book-reader-core.js",
      readerJs: "/js/book-reader.js",
      pageJs: "/js/books.js",
    };

    for (const key of Object.keys(expected) as Array<keyof BookPageAssets>) {
      const file: Buffer = fs.readFileSync(
        path.join(REAL_STATIC_ROOT, expected[key]),
      );

      expect(assets[key]).toBe(`${expected[key]}?v=${hashOf(file)}`);
    }
  });

  test("falls back to plain URLs when the files are not there", () => {
    const empty: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "books-empty-"),
    );

    try {
      expect(getBookPageAssets(empty)).toEqual({
        css: "/css/books.css",
        coreJs: "/js/book-reader-core.js",
        readerJs: "/js/book-reader.js",
        pageJs: "/js/books.js",
      });
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
