import crypto from "crypto";
import fs from "fs";
import path from "path";
import { StaticPath } from "./Config";

/*
 * Content-versioned URLs for files under Static/.
 *
 * Static files are served with "Cache-Control: public, max-age=31536000,
 * immutable" (see Routes.ts), so a file whose content changes under the same
 * URL stays stale in browsers and CDNs for a year. Appending a hash of the
 * content gives every revision its own URL. The hash is recomputed when the
 * file's size or modification time changes, so development picks up edits.
 */

interface CachedVersion {
  mtimeMs: number;
  size: number;
  version: string;
}

const versions: Map<string, CachedVersion> = new Map<string, CachedVersion>();

export const versionedStaticPath: (
  assetPath: string,
  staticRoot?: string,
) => string = (assetPath: string, staticRoot: string = StaticPath): string => {
  const root: string = path.resolve(staticRoot);
  const filePath: string = path.resolve(root, `.${assetPath}`);

  if (!filePath.startsWith(`${root}${path.sep}`)) {
    return assetPath;
  }

  try {
    const stat: fs.Stats = fs.statSync(filePath);
    const cached: CachedVersion | undefined = versions.get(filePath);

    if (
      cached &&
      cached.mtimeMs === stat.mtimeMs &&
      cached.size === stat.size
    ) {
      return `${assetPath}?v=${cached.version}`;
    }

    const version: string = crypto
      .createHash("sha256")
      .update(fs.readFileSync(filePath))
      .digest("hex")
      .slice(0, 12);

    versions.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, version });
    return `${assetPath}?v=${version}`;
  } catch {
    // A missing file still gets its plain URL; the page should not fail to render.
    return assetPath;
  }
};

export interface BookPageAssets {
  css: string;
  coreJs: string;
  readerJs: string;
  pageJs: string;
}

export const getBookPageAssets: (staticRoot?: string) => BookPageAssets = (
  staticRoot: string = StaticPath,
): BookPageAssets => {
  return {
    css: versionedStaticPath("/css/books.css", staticRoot),
    coreJs: versionedStaticPath("/js/book-reader-core.js", staticRoot),
    readerJs: versionedStaticPath("/js/book-reader.js", staticRoot),
    pageJs: versionedStaticPath("/js/books.js", staticRoot),
  };
};
