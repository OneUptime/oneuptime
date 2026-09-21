import { createZip, ZipFixtureEntry } from "./ZipFixture";

/*
 * EPUB fixtures for the book tests.
 *
 * defaultBookItems() mirrors the structure of the real Back to Metal EPUB
 * (OEBPS/ package directory, Moves under OEBPS/m/, an EPUB 3 navigation
 * document with stages as parts, cross-links between chapters and anchors
 * into the worksheets) so the parser is exercised on the same shapes it
 * meets in production, without the tests depending on the network.
 */

export interface EpubItem {
  id: string;
  // Path relative to the package document's directory.
  href: string;
  mediaType?: string;
  properties?: string;
  content: string;
  // Defaults to true for XHTML items.
  inSpine?: boolean;
  linear?: "yes" | "no";
}

export interface EpubMetadata {
  title?: string;
  creator?: string;
  publisher?: string;
  language?: string;
  description?: string;
  identifier?: string;
  modified?: string;
}

export interface EpubFixtureOptions {
  packageDirectory?: string;
  metadata?: EpubMetadata;
  items?: Array<EpubItem>;
  spine?: Array<string>;
  spineTocId?: string;
  // null leaves the file out of the archive entirely.
  mimetype?: string | null;
  container?: string | null;
  opf?: string | null;
  extraEntries?: Array<ZipFixtureEntry>;
}

export const xhtml: (title: string, body: string) => string = (
  title: string,
  body: string,
): string => {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<!DOCTYPE html>",
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">',
    `<head><meta charset="utf-8"/><title>${title}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>`,
    "<body>",
    body,
    "</body>",
    "</html>",
  ].join("\n");
};

const moveBody: (number: string, title: string, extra: string) => string = (
  number: string,
  title: string,
  extra: string,
): string => {
  return [
    `<h1>${number} &#183; ${title}</h1>`,
    '<p class="meta">Decide &#183; Low risk &#183; 0 min cutover</p>',
    `<p class="hook">The hook of Move ${number}.</p>`,
    "<h2>Why this works</h2>",
    `<p>Body text for Move ${number}, with <strong>bold</strong> and <code>aws ec2</code>.</p>`,
    extra,
  ].join("\n");
};

export const NAV_DOCUMENT: string = xhtml(
  "Contents",
  [
    '<nav epub:type="toc" id="toc"><h1>Contents</h1>',
    "<ol>",
    '<li><a href="titlepage.xhtml">Title page</a></li>',
    '<li><a href="why.xhtml">Why this book exists</a></li>',
    '<li><a href="rollback.xhtml">Before you touch anything</a></li>',
    '<li><a href="m/01.xhtml">Stage 1 &#183; Decide</a>',
    "<ol>",
    '<li><a href="m/01.xhtml">01 &#183; The bill, and the three lines that are most of it</a></li>',
    '<li><a href="m/02.xhtml">02 &#183; What you actually run</a></li>',
    "</ol>",
    "</li>",
    '<li><a href="m/03.xhtml">Stage 2 &#183; Buy</a>',
    "<ol>",
    '<li><a href="m/03.xhtml">03 &#183; From rented vCPUs to cores you own</a></li>',
    "</ol>",
    "</li>",
    '<li><a href="worksheets.xhtml">Operator worksheets</a><ol><li><a href="worksheets.xhtml#rehearsal-record">Rehearsal record</a></li><li><a href="worksheets.xhtml#restore-proof">Restore proof</a></li></ol></li>',
    "</ol>",
    '</nav><nav epub:type="landmarks" hidden="hidden"><h2>Navigation</h2><ol><li><a epub:type="toc" href="nav.xhtml#toc">Contents</a></li></ol></nav>',
  ].join("\n"),
);

export const defaultBookItems: () => Array<EpubItem> = (): Array<EpubItem> => {
  return [
    {
      id: "nav",
      href: "nav.xhtml",
      properties: "nav",
      content: NAV_DOCUMENT,
    },
    {
      id: "css",
      href: "style.css",
      mediaType: "text/css",
      content: "body { font-family: serif; }",
    },
    {
      id: "cover-img",
      href: "img/cover.jpg",
      mediaType: "image/jpeg",
      properties: "cover-image",
      content: "not really a jpeg",
    },
    {
      id: "f0",
      href: "titlepage.xhtml",
      content: xhtml(
        "Back to Metal",
        '<div class="front"><h1>Back to Metal</h1><p>How a company leaves the cloud, one move at a time</p><p>Nawaz Dhandala</p><p class="small">backtometal.oneuptime.com</p></div>',
      ),
    },
    {
      id: "copy",
      href: "copyright.xhtml",
      content: xhtml(
        "Copyright",
        '<div class="front small"><p>Copyright &#169; 2026 Nawaz Dhandala</p><p>Licensed under CC BY 4.0. See <a href="https://creativecommons.org/licenses/by/4.0/">the licence</a>.</p></div>',
      ),
    },
    {
      id: "f1",
      href: "why.xhtml",
      content: xhtml(
        "Why this book exists",
        '<div class="front"><h1>You are allowed to run your own computers</h1><p>A generation of engineers has been trained to believe that owning a server is a failure.</p><p>It is not.</p></div>',
      ),
    },
    {
      id: "f4",
      href: "rollback.xhtml",
      content: xhtml(
        "Before you touch anything",
        '<h1>Before you touch anything</h1><p id="first-rule">Read the rollback first.</p>',
      ),
    },
    {
      id: "m01",
      href: "m/01.xhtml",
      content: xhtml(
        "The bill, and the three lines that are most of it",
        moveBody(
          "01",
          "The bill, and the three lines that are most of it",
          '<div class="rollback"><h3>Rollback &#8212; read this first</h3><p>Back out. <a href="../rollback.xhtml">Before you touch anything</a></p></div><p>Next: <a href="02.xhtml">Move 02</a>. Proof: <a href="../worksheets.xhtml#restore-proof">Restore proof</a>.</p>',
        ),
      ),
    },
    {
      id: "m02",
      href: "m/02.xhtml",
      content: xhtml(
        "What you actually run",
        moveBody(
          "02",
          "What you actually run",
          '<p>Needs first: <a href="01.xhtml">Move 01</a>. See <a href="#local-note">below</a>.</p><p id="local-note">A note inside the Move.</p><script>alert("xss")</script>',
        ),
      ),
    },
    {
      id: "m03",
      href: "m/03.xhtml",
      content: xhtml(
        "From rented vCPUs to cores you own",
        moveBody(
          "03",
          "From rented vCPUs to cores you own",
          '<table><tbody><tr><th scope="row">Cloud</th><td>$100,000</td></tr></tbody></table>',
        ),
      ),
    },
    {
      id: "worksheets",
      href: "worksheets.xhtml",
      content: xhtml(
        "Operator worksheets",
        '<h1>Operator worksheets</h1><section id="rehearsal-record"><h2>Rehearsal record</h2><p class="small"><a href="m/02.xhtml">Move 02</a></p></section><section id="restore-proof"><h2>Restore proof</h2><p>Restore it.</p></section>',
      ),
    },
  ];
};

export const DEFAULT_SPINE: Array<string> = [
  "f0",
  "copy",
  "nav",
  "f1",
  "f4",
  "m01",
  "m02",
  "m03",
  "worksheets",
];

const escapeXml: (value: string) => string = (value: string): string => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

export const buildOpf: (
  items: Array<EpubItem>,
  spine: Array<string>,
  metadata: EpubMetadata,
  spineTocId?: string,
) => string = (
  items: Array<EpubItem>,
  spine: Array<string>,
  metadata: EpubMetadata,
  spineTocId?: string,
): string => {
  const manifest: string = items
    .map((item: EpubItem): string => {
      const mediaType: string = item.mediaType || "application/xhtml+xml";
      const properties: string = item.properties
        ? ` properties="${escapeXml(item.properties)}"`
        : "";
      return `<item id="${escapeXml(item.id)}" href="${escapeXml(item.href)}" media-type="${escapeXml(mediaType)}"${properties}/>`;
    })
    .join("\n");
  const spineRefs: string = spine
    .map((id: string): string => {
      const item: EpubItem | undefined = items.find(
        (candidate: EpubItem): boolean => {
          return candidate.id === id;
        },
      );
      const linear: string =
        item && item.linear ? ` linear="${item.linear}"` : "";
      return `<itemref idref="${escapeXml(id)}"${linear}/>`;
    })
    .join("\n");
  const meta: EpubMetadata = {
    title: "Back to Metal",
    creator: "Nawaz Dhandala",
    publisher: "HackerBay, Inc.",
    language: "en",
    description: "How a company leaves the cloud, one move at a time",
    identifier: "urn:uuid:00000000-0000-4000-8000-000000000000",
    modified: "2026-09-14T15:33:10Z",
    ...metadata,
  };

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">',
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">',
    `<dc:identifier id="pub-id">${escapeXml(meta.identifier || "")}</dc:identifier>`,
    `<dc:title>${escapeXml(meta.title || "")}</dc:title>`,
    `<dc:creator>${escapeXml(meta.creator || "")}</dc:creator>`,
    `<dc:publisher>${escapeXml(meta.publisher || "")}</dc:publisher>`,
    `<dc:language>${escapeXml(meta.language || "")}</dc:language>`,
    `<dc:description>${escapeXml(meta.description || "")}</dc:description>`,
    `<meta property="dcterms:modified">${escapeXml(meta.modified || "")}</meta>`,
    "</metadata>",
    `<manifest>\n${manifest}\n</manifest>`,
    `<spine${spineTocId ? ` toc="${escapeXml(spineTocId)}"` : ""}>\n${spineRefs}\n</spine>`,
    "</package>",
  ].join("\n");
};

export const containerXml: (packagePath: string) => string = (
  packagePath: string,
): string => {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">',
    `<rootfiles><rootfile full-path="${packagePath}" media-type="application/oebps-package+xml"/></rootfiles>`,
    "</container>",
  ].join("\n");
};

export const buildEpub: (options?: EpubFixtureOptions) => Buffer = (
  options: EpubFixtureOptions = {},
): Buffer => {
  const directory: string =
    options.packageDirectory === undefined ? "OEBPS" : options.packageDirectory;
  const prefix: string = directory ? `${directory}/` : "";
  const items: Array<EpubItem> = options.items || defaultBookItems();
  const spine: Array<string> =
    options.spine ||
    (options.items
      ? items
          .filter((item: EpubItem): boolean => {
            return (
              (item.mediaType || "application/xhtml+xml") ===
                "application/xhtml+xml" && item.inSpine !== false
            );
          })
          .map((item: EpubItem): string => {
            return item.id;
          })
      : DEFAULT_SPINE);
  const packagePath: string = `${prefix}content.opf`;
  const entries: Array<ZipFixtureEntry> = [];

  if (options.mimetype !== null) {
    entries.push({
      name: "mimetype",
      data: options.mimetype ?? "application/epub+zip",
      method: "store",
    });
  }

  if (options.container !== null) {
    entries.push({
      name: "META-INF/container.xml",
      data: options.container ?? containerXml(packagePath),
    });
  }

  if (options.opf !== null) {
    entries.push({
      name: packagePath,
      data:
        options.opf ??
        buildOpf(items, spine, options.metadata || {}, options.spineTocId),
    });
  }

  for (const item of items) {
    entries.push({ name: `${prefix}${item.href}`, data: item.content });
  }

  entries.push(...(options.extraEntries || []));

  return createZip(entries);
};
