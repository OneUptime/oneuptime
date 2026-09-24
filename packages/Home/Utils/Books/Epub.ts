import path from "path";
import ZipArchive, { normalizeZipPath, ZipLimits } from "./Zip";
import {
  childElements,
  findElements,
  findFirstElement,
  MarkupElement,
  normalizeWhitespace,
  parseMarkupTree,
  textContent,
} from "./Markup";
import { bookAnchorId, InternalBookLink, sanitizeBookHtml } from "./BookHtml";

/*
 * Reads an EPUB 3 (or EPUB 2) publication into the sections and table of
 * contents the in-page reader needs.
 *
 * Every section is sanitized on the way out (see BookHtml.ts), so the result
 * is safe to serve to the browser as-is.
 */

export class EpubError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EpubError";
  }
}

export type BookSectionKind = "text" | "contents";

export interface BookSection {
  // Stable, URL-safe id derived from the document's path ("m/01.xhtml" -> "m01").
  id: string;
  kind: BookSectionKind;
  // The document title, e.g. "The bill, and the three lines that are most of it".
  title: string;
  // The table of contents label, e.g. "01 · The bill, and the three lines...".
  label: string;
  // A leading chapter number from the label ("01"), when there is one.
  number?: string | undefined;
  // The part the section belongs to, e.g. "Stage 1 · Decide".
  part?: string | undefined;
  html: string;
  words: number;
}

export interface BookTocEntry {
  label: string;
  sectionId: string;
  anchorId?: string | undefined;
  children: Array<BookTocEntry>;
}

export interface BookMetadata {
  title: string;
  creator: string;
  publisher: string;
  language: string;
  description: string;
  identifier: string;
  modified: string;
}

export interface ParsedEpub {
  metadata: BookMetadata;
  sections: Array<BookSection>;
  toc: Array<BookTocEntry>;
}

export interface EpubLimits extends ZipLimits {
  maxSections: number;
  maxSectionHtmlBytes: number;
}

export const DEFAULT_EPUB_LIMITS: EpubLimits = {
  maxArchiveBytes: 25 * 1024 * 1024,
  maxEntries: 2000,
  maxEntryBytes: 4 * 1024 * 1024,
  maxSections: 400,
  maxSectionHtmlBytes: 1024 * 1024,
};

interface ManifestItem {
  id: string;
  path: string;
  mediaType: string;
  properties: Array<string>;
}

// The id the navigation document takes; the reader renders its own contents page there.
export const CONTENTS_SECTION_ID: string = "contents";

const XHTML_MEDIA_TYPES: Set<string> = new Set<string>([
  "application/xhtml+xml",
  "text/html",
]);

const NUMBERED_LABEL_PATTERN: RegExp =
  /^(\d{1,3})\s*[\u00b7.:\u2013\u2014-]\s*(.+)$/;

const splitHref: (href: string) => { file: string; fragment: string } = (
  href: string,
): { file: string; fragment: string } => {
  const hash: number = href.indexOf("#");

  return hash < 0
    ? { file: href, fragment: "" }
    : { file: href.slice(0, hash), fragment: href.slice(hash + 1) };
};

const safeDecodeUri: (value: string) => string = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

// Resolves `href` relative to the document at `basePath`, both archive paths.
export const resolveArchivePath: (
  basePath: string,
  href: string,
) => string | null = (basePath: string, href: string): string | null => {
  const file: string = safeDecodeUri(splitHref(href).file.split("?")[0]!);

  if (!file) {
    return normalizeZipPath(basePath);
  }

  const directory: string = path.posix.dirname(basePath);
  const joined: string =
    file.startsWith("/") || directory === "." ? file : `${directory}/${file}`;

  return normalizeZipPath(joined);
};

/*
 * "OEBPS/m/01.xhtml" relative to "OEBPS/" becomes "m01"; "why.xhtml" becomes
 * "why". Ids are lower-case ASCII so they are safe in URLs and attributes.
 */
export const sectionIdForPath: (relativePath: string) => string = (
  relativePath: string,
): string => {
  const withoutExtension: string = relativePath.replace(/\.[^./]+$/, "");
  const id: string = withoutExtension
    .toLowerCase()
    .replace(/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return id || "section";
};

export const isPartEntry: (entry: BookTocEntry) => boolean = (
  entry: BookTocEntry,
): boolean => {
  return entry.children.some((child: BookTocEntry): boolean => {
    return !child.anchorId;
  });
};

const countWords: (html: string) => number = (html: string): number => {
  const text: string = html.replace(/<[^>]*>/g, " ");
  return text.split(/\s+/).filter(Boolean).length;
};

const firstText: (root: MarkupElement, name: string) => string = (
  root: MarkupElement,
  name: string,
): string => {
  const element: MarkupElement | null = findFirstElement(
    root,
    (candidate: MarkupElement): boolean => {
      return candidate.qualifiedName === name || candidate.name === name;
    },
  );

  return element ? normalizeWhitespace(textContent(element)) : "";
};

const readMetadata: (opf: MarkupElement) => BookMetadata = (
  opf: MarkupElement,
): BookMetadata => {
  const modified: MarkupElement | null = findFirstElement(
    opf,
    (element: MarkupElement): boolean => {
      return (
        element.name === "meta" &&
        element.attributes["property"] === "dcterms:modified"
      );
    },
  );

  return {
    title: firstText(opf, "dc:title"),
    creator: firstText(opf, "dc:creator"),
    publisher: firstText(opf, "dc:publisher"),
    language: firstText(opf, "dc:language"),
    description: firstText(opf, "dc:description"),
    identifier: firstText(opf, "dc:identifier"),
    modified: modified ? normalizeWhitespace(textContent(modified)) : "",
  };
};

interface RawTocEntry {
  label: string;
  href: string;
  children: Array<RawTocEntry>;
}

const readNavList: (list: MarkupElement) => Array<RawTocEntry> = (
  list: MarkupElement,
): Array<RawTocEntry> => {
  return childElements(list, "li").map((item: MarkupElement): RawTocEntry => {
    const link: MarkupElement | undefined =
      childElements(item, "a")[0] || childElements(item, "span")[0];
    const nested: MarkupElement | undefined = childElements(item, "ol")[0];

    return {
      label: link ? normalizeWhitespace(textContent(link)) : "",
      href: link?.attributes["href"] || "",
      children: nested ? readNavList(nested) : [],
    };
  });
};

const readNavDocument: (nav: MarkupElement) => Array<RawTocEntry> = (
  nav: MarkupElement,
): Array<RawTocEntry> => {
  const tocNav: MarkupElement | null =
    findFirstElement(nav, (element: MarkupElement): boolean => {
      return (
        element.name === "nav" &&
        (element.attributes["epub:type"] || "").split(/\s+/).includes("toc")
      );
    }) ||
    findFirstElement(nav, (element: MarkupElement): boolean => {
      return element.name === "nav";
    });

  const list: MarkupElement | undefined = tocNav
    ? childElements(tocNav, "ol")[0]
    : undefined;

  return list ? readNavList(list) : [];
};

const readNcxPoints: (parent: MarkupElement) => Array<RawTocEntry> = (
  parent: MarkupElement,
): Array<RawTocEntry> => {
  return childElements(parent, "navpoint").map(
    (point: MarkupElement): RawTocEntry => {
      const label: MarkupElement | undefined = childElements(
        point,
        "navlabel",
      )[0];
      const content: MarkupElement | undefined = childElements(
        point,
        "content",
      )[0];

      return {
        label: label ? normalizeWhitespace(textContent(label)) : "",
        href: content?.attributes["src"] || "",
        children: readNcxPoints(point),
      };
    },
  );
};

const readNcxDocument: (ncx: MarkupElement) => Array<RawTocEntry> = (
  ncx: MarkupElement,
): Array<RawTocEntry> => {
  const navMap: MarkupElement | null = findFirstElement(
    ncx,
    (element: MarkupElement): boolean => {
      return element.name === "navmap";
    },
  );

  return navMap ? readNcxPoints(navMap) : [];
};

export const parseEpub: (
  archiveBuffer: Buffer,
  limits?: Partial<EpubLimits>,
) => ParsedEpub = (
  archiveBuffer: Buffer,
  limits: Partial<EpubLimits> = {},
): ParsedEpub => {
  const effectiveLimits: EpubLimits = { ...DEFAULT_EPUB_LIMITS, ...limits };
  const archive: ZipArchive = new ZipArchive(archiveBuffer, effectiveLimits);

  const mimetype: string | null = archive.readText("mimetype");

  if (mimetype !== null && mimetype.trim() !== "application/epub+zip") {
    throw new EpubError(`Unexpected EPUB mimetype "${mimetype.trim()}".`);
  }

  const container: string | null = archive.readText("META-INF/container.xml");

  if (!container) {
    throw new EpubError("The EPUB has no META-INF/container.xml.");
  }

  const rootfiles: Array<MarkupElement> = findElements(
    parseMarkupTree(container),
    (element: MarkupElement): boolean => {
      return element.name === "rootfile";
    },
  );
  const rootfile: MarkupElement | undefined =
    rootfiles.find((element: MarkupElement): boolean => {
      return (
        element.attributes["media-type"] === "application/oebps-package+xml"
      );
    }) || rootfiles[0];
  const packagePath: string | null = rootfile?.attributes["full-path"]
    ? normalizeZipPath(rootfile.attributes["full-path"])
    : null;

  if (!packagePath) {
    throw new EpubError("The EPUB container names no package document.");
  }

  const packageSource: string | null = archive.readText(packagePath);

  if (!packageSource) {
    throw new EpubError(`The package document ${packagePath} is missing.`);
  }

  const opf: MarkupElement = parseMarkupTree(packageSource);
  const packageDirectory: string = path.posix.dirname(packagePath);
  const relativeToPackage: (archivePath: string) => string = (
    archivePath: string,
  ): string => {
    return packageDirectory === "."
      ? archivePath
      : path.posix.relative(packageDirectory, archivePath);
  };

  const manifest: Map<string, ManifestItem> = new Map<string, ManifestItem>();

  for (const item of findElements(opf, (element: MarkupElement): boolean => {
    return element.name === "item";
  })) {
    const id: string | undefined = item.attributes["id"];
    const href: string | undefined = item.attributes["href"];
    const itemPath: string | null = href
      ? resolveArchivePath(packagePath, href)
      : null;

    if (id && itemPath && !manifest.has(id)) {
      manifest.set(id, {
        id,
        path: itemPath,
        mediaType: (item.attributes["media-type"] || "").toLowerCase(),
        properties: (item.attributes["properties"] || "")
          .split(/\s+/)
          .filter(Boolean),
      });
    }
  }

  const spineElement: MarkupElement | null = findFirstElement(
    opf,
    (element: MarkupElement): boolean => {
      return element.name === "spine";
    },
  );

  if (!spineElement) {
    throw new EpubError("The package document has no spine.");
  }

  const navItem: ManifestItem | undefined = [...manifest.values()].find(
    (item: ManifestItem): boolean => {
      return item.properties.includes("nav");
    },
  );
  const ncxItem: ManifestItem | undefined =
    (spineElement.attributes["toc"]
      ? manifest.get(spineElement.attributes["toc"])
      : undefined) ||
    [...manifest.values()].find((item: ManifestItem): boolean => {
      return item.mediaType === "application/x-dtbncx+xml";
    });

  /*
   * Assign every spine document an id before sanitizing, so links can
   * resolve. "contents" is reserved for the navigation document, so a chapter
   * that happens to be called contents.xhtml becomes "contents-2" instead of
   * being mistaken for it.
   */
  const spineItems: Array<ManifestItem> = [];
  const sectionIdByPath: Map<string, string> = new Map<string, string>();
  const usedIds: Set<string> = new Set<string>([CONTENTS_SECTION_ID]);

  for (const itemref of childElements(spineElement, "itemref")) {
    const item: ManifestItem | undefined = manifest.get(
      itemref.attributes["idref"] || "",
    );

    if (
      !item ||
      !XHTML_MEDIA_TYPES.has(item.mediaType) ||
      sectionIdByPath.has(item.path)
    ) {
      continue;
    }

    if (spineItems.length >= effectiveLimits.maxSections) {
      throw new EpubError(
        `The EPUB has more than ${effectiveLimits.maxSections} sections.`,
      );
    }

    let id: string =
      item === navItem
        ? CONTENTS_SECTION_ID
        : sectionIdForPath(relativeToPackage(item.path));

    if (item !== navItem && usedIds.has(id)) {
      let suffix: number = 2;

      while (usedIds.has(`${id}-${suffix}`)) {
        suffix++;
      }

      id = `${id}-${suffix}`;
    }

    usedIds.add(id);
    sectionIdByPath.set(item.path, id);
    spineItems.push(item);
  }

  if (spineItems.length === 0) {
    throw new EpubError("The EPUB spine has no readable documents.");
  }

  const linkTo: (
    basePath: string,
    href: string,
  ) => { sectionId: string; fragment: string } | null = (
    basePath: string,
    href: string,
  ): { sectionId: string; fragment: string } | null => {
    const target: string | null = resolveArchivePath(basePath, href);
    const sectionId: string | undefined = target
      ? sectionIdByPath.get(target)
      : undefined;

    return sectionId
      ? { sectionId, fragment: safeDecodeUri(splitHref(href).fragment) }
      : null;
  };

  // The table of contents: EPUB 3 navigation document, else the EPUB 2 NCX.
  let rawToc: Array<RawTocEntry> = [];
  let tocBasePath: string = packagePath;

  if (navItem) {
    const navSource: string | null = archive.readText(navItem.path);

    if (navSource) {
      rawToc = readNavDocument(parseMarkupTree(navSource));
      tocBasePath = navItem.path;
    }
  }

  if (rawToc.length === 0 && ncxItem) {
    const ncxSource: string | null = archive.readText(ncxItem.path);

    if (ncxSource) {
      rawToc = readNcxDocument(parseMarkupTree(ncxSource));
      tocBasePath = ncxItem.path;
    }
  }

  const toTocEntries: (entries: Array<RawTocEntry>) => Array<BookTocEntry> = (
    entries: Array<RawTocEntry>,
  ): Array<BookTocEntry> => {
    const result: Array<BookTocEntry> = [];

    for (const entry of entries) {
      const target: { sectionId: string; fragment: string } | null = entry.href
        ? linkTo(tocBasePath, entry.href)
        : null;
      const children: Array<BookTocEntry> = toTocEntries(entry.children);

      if (!entry.label || (!target && children.length === 0)) {
        continue;
      }

      result.push({
        label: entry.label,
        sectionId: target?.sectionId || children[0]!.sectionId,
        anchorId:
          target && target.fragment
            ? bookAnchorId(target.sectionId, target.fragment) || undefined
            : undefined,
        children,
      });
    }

    return result;
  };

  const toc: Array<BookTocEntry> = toTocEntries(rawToc);

  /*
   * Labels come from the entry that points at the section itself (not at an
   * anchor inside it). Parts are top-level entries with whole chapters under
   * them, e.g. "Stage 1 · Decide" over Moves 01-04; an entry whose children
   * are only anchors into its own chapter ("Operator worksheets") is not.
   */
  const labelBySection: Map<string, string> = new Map<string, string>();
  const partBySection: Map<string, string> = new Map<string, string>();

  const collectLabels: (entries: Array<BookTocEntry>) => void = (
    entries: Array<BookTocEntry>,
  ): void => {
    for (const entry of entries) {
      if (!entry.anchorId) {
        labelBySection.set(entry.sectionId, entry.label);
      }

      collectLabels(entry.children);
    }
  };

  collectLabels(toc);

  for (const entry of toc) {
    if (isPartEntry(entry)) {
      for (const child of entry.children) {
        if (!child.anchorId) {
          partBySection.set(child.sectionId, entry.label);
        }
      }
    }
  }

  const sections: Array<BookSection> = spineItems.map(
    (item: ManifestItem): BookSection => {
      const id: string = sectionIdByPath.get(item.path)!;

      if (item === navItem) {
        return {
          id,
          kind: "contents",
          title: "Contents",
          label: "Contents",
          html: "",
          words: 0,
        };
      }

      const source: string = archive.readText(item.path) || "";
      const document: MarkupElement = parseMarkupTree(source);
      const title: string =
        firstText(document, "title") ||
        firstText(document, "h1") ||
        firstText(document, "h2") ||
        id;
      const html: string = sanitizeBookHtml(source, {
        sectionId: id,
        resolveRelativeLink: (href: string): InternalBookLink | null => {
          const target: { sectionId: string; fragment: string } | null = linkTo(
            item.path,
            href,
          );

          return target
            ? {
                kind: "internal",
                sectionId: target.sectionId,
                fragment: target.fragment || undefined,
              }
            : null;
        },
      });

      if (Buffer.byteLength(html) > effectiveLimits.maxSectionHtmlBytes) {
        throw new EpubError(`Section ${id} is too large.`);
      }

      const label: string = labelBySection.get(id) || title;
      const numbered: RegExpExecArray | null =
        NUMBERED_LABEL_PATTERN.exec(label);

      return {
        id,
        kind: "text",
        title,
        label,
        number: numbered ? numbered[1] : undefined,
        part: partBySection.get(id),
        html,
        words: countWords(html),
      };
    },
  );

  return {
    metadata: readMetadata(opf),
    sections,
    toc,
  };
};
