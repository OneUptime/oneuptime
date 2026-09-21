import {
  BookSection,
  BookTocEntry,
  CONTENTS_SECTION_ID,
  EpubError,
  isPartEntry,
  parseEpub,
  ParsedEpub,
  resolveArchivePath,
  sectionIdForPath,
} from "../../Utils/Books/Epub";
import { isValidSectionId } from "../../Utils/Books/BookHtml";
import { ZipError } from "../../Utils/Books/Zip";
import {
  buildEpub,
  buildOpf,
  containerXml,
  DEFAULT_SPINE,
  defaultBookItems,
  EpubItem,
  NAV_DOCUMENT,
  xhtml,
} from "./Helpers/EpubFixture";
import { createZip } from "./Helpers/ZipFixture";

/*
 * The EPUB parser behind the in-page reader. Archives are built in memory
 * from Helpers/EpubFixture.ts, whose default book mirrors the layout of the
 * real Back to Metal EPUB (OEBPS/ package directory, Moves under OEBPS/m/,
 * an EPUB 3 navigation document with stages as parts, cross-links between
 * chapters and anchors into the worksheets).
 */

const MIDDOT: string = String.fromCharCode(0xb7);
const EM_DASH: string = String.fromCharCode(0x2014);
const E_ACUTE: string = String.fromCharCode(0xe9);
const SCRIPT_PATTERN: RegExp = /<script|alert\(/i;

const parseDefault: () => ParsedEpub = (): ParsedEpub => {
  return parseEpub(buildEpub());
};

const sectionById: (book: ParsedEpub, id: string) => BookSection = (
  book: ParsedEpub,
  id: string,
): BookSection => {
  const section: BookSection | undefined = book.sections.find(
    (candidate: BookSection): boolean => {
      return candidate.id === id;
    },
  );

  if (!section) {
    throw new Error(`No section ${id} in ${sectionIds(book).join(", ")}`);
  }

  return section;
};

const sectionIds: (book: ParsedEpub) => Array<string> = (
  book: ParsedEpub,
): Array<string> => {
  return book.sections.map((section: BookSection): string => {
    return section.id;
  });
};

const withItems: (
  mutate: (items: Array<EpubItem>) => Array<EpubItem>,
) => Array<EpubItem> = (
  mutate: (items: Array<EpubItem>) => Array<EpubItem>,
): Array<EpubItem> => {
  return mutate(defaultBookItems());
};

const replaceItem: (
  items: Array<EpubItem>,
  id: string,
  change: Partial<EpubItem>,
) => Array<EpubItem> = (
  items: Array<EpubItem>,
  id: string,
  change: Partial<EpubItem>,
): Array<EpubItem> => {
  return items.map((item: EpubItem): EpubItem => {
    return item.id === id ? { ...item, ...change } : item;
  });
};

const withoutItem: (items: Array<EpubItem>, id: string) => Array<EpubItem> = (
  items: Array<EpubItem>,
  id: string,
): Array<EpubItem> => {
  return items.filter((item: EpubItem): boolean => {
    return item.id !== id;
  });
};

const catchError: (action: () => unknown) => unknown = (
  action: () => unknown,
): unknown => {
  try {
    action();
  } catch (error) {
    return error;
  }

  throw new Error("Expected the action to throw.");
};

describe("parseEpub: the default Back to Metal-shaped fixture", () => {
  let book: ParsedEpub;

  beforeAll(() => {
    book = parseDefault();
  });

  test("reads the publication metadata from the package document", () => {
    expect(book.metadata).toEqual({
      title: "Back to Metal",
      creator: "Nawaz Dhandala",
      publisher: "HackerBay, Inc.",
      language: "en",
      description: "How a company leaves the cloud, one move at a time",
      identifier: "urn:uuid:00000000-0000-4000-8000-000000000000",
      modified: "2026-09-14T15:33:10Z",
    });
  });

  test("keeps the spine order and derives ids from document paths", () => {
    expect(sectionIds(book)).toEqual([
      "titlepage",
      "copyright",
      CONTENTS_SECTION_ID,
      "why",
      "rollback",
      "m01",
      "m02",
      "m03",
      "worksheets",
    ]);

    for (const id of sectionIds(book)) {
      expect(isValidSectionId(id)).toBe(true);
    }
  });

  test("the navigation document becomes an empty contents placeholder at its spine position", () => {
    expect(book.sections[2]).toEqual({
      id: "contents",
      kind: "contents",
      title: "Contents",
      label: "Contents",
      html: "",
      words: 0,
    });
    expect(CONTENTS_SECTION_ID).toBe("contents");
  });

  test("every other section is a text section", () => {
    for (const section of book.sections) {
      if (section.id !== CONTENTS_SECTION_ID) {
        expect(section.kind).toBe("text");
        expect(section.html.length).toBeGreaterThan(0);
      }
    }
  });

  test("titles come from each document's <title>", () => {
    expect(sectionById(book, "titlepage").title).toBe("Back to Metal");
    expect(sectionById(book, "copyright").title).toBe("Copyright");
    expect(sectionById(book, "m01").title).toBe(
      "The bill, and the three lines that are most of it",
    );
    expect(sectionById(book, "worksheets").title).toBe("Operator worksheets");
  });

  test("labels come from the table of contents entry that points at the whole section", () => {
    expect(sectionById(book, "titlepage").label).toBe("Title page");
    expect(sectionById(book, "m01").label).toBe(
      `01 ${MIDDOT} The bill, and the three lines that are most of it`,
    );
    expect(sectionById(book, "m03").label).toBe(
      `03 ${MIDDOT} From rented vCPUs to cores you own`,
    );
    // Entries that point at anchors inside the worksheets do not relabel them.
    expect(sectionById(book, "worksheets").label).toBe("Operator worksheets");
  });

  test("sections without a table of contents entry are labelled with their title", () => {
    expect(sectionById(book, "copyright").label).toBe("Copyright");
  });

  test("numbers are read from numbered labels only", () => {
    expect(sectionById(book, "m01").number).toBe("01");
    expect(sectionById(book, "m02").number).toBe("02");
    expect(sectionById(book, "m03").number).toBe("03");
    expect(sectionById(book, "why").number).toBeUndefined();
    expect(sectionById(book, "worksheets").number).toBeUndefined();
  });

  test("stages are parts, including a stage with a single Move", () => {
    expect(sectionById(book, "m01").part).toBe(`Stage 1 ${MIDDOT} Decide`);
    expect(sectionById(book, "m02").part).toBe(`Stage 1 ${MIDDOT} Decide`);
    expect(sectionById(book, "m03").part).toBe(`Stage 2 ${MIDDOT} Buy`);
  });

  test("an entry whose children only point at anchors in its own section is not a part", () => {
    expect(sectionById(book, "worksheets").part).toBeUndefined();
    expect(sectionById(book, "why").part).toBeUndefined();
  });

  test("the table of contents keeps its tree and namespaces anchors", () => {
    expect(book.toc).toEqual([
      { label: "Title page", sectionId: "titlepage", children: [] },
      { label: "Why this book exists", sectionId: "why", children: [] },
      {
        label: "Before you touch anything",
        sectionId: "rollback",
        children: [],
      },
      {
        label: `Stage 1 ${MIDDOT} Decide`,
        sectionId: "m01",
        children: [
          {
            label: `01 ${MIDDOT} The bill, and the three lines that are most of it`,
            sectionId: "m01",
            children: [],
          },
          {
            label: `02 ${MIDDOT} What you actually run`,
            sectionId: "m02",
            children: [],
          },
        ],
      },
      {
        label: `Stage 2 ${MIDDOT} Buy`,
        sectionId: "m03",
        children: [
          {
            label: `03 ${MIDDOT} From rented vCPUs to cores you own`,
            sectionId: "m03",
            children: [],
          },
        ],
      },
      {
        label: "Operator worksheets",
        sectionId: "worksheets",
        children: [
          {
            label: "Rehearsal record",
            sectionId: "worksheets",
            anchorId: "bk-worksheets--rehearsal-record",
            children: [],
          },
          {
            label: "Restore proof",
            sectionId: "worksheets",
            anchorId: "bk-worksheets--restore-proof",
            children: [],
          },
        ],
      },
    ]);
  });

  test("links across directories resolve to reader sections", () => {
    const html: string = sectionById(book, "m01").html;

    expect(html).toContain(
      '<a href="#read/rollback" data-book-section="rollback">Before you touch anything</a>',
    );
    expect(html).toContain(
      '<a href="#read/m02" data-book-section="m02">Move 02</a>',
    );
    expect(html).toContain(
      '<a href="#read/worksheets" data-book-section="worksheets" data-book-anchor="bk-worksheets--restore-proof">Restore proof</a>',
    );
  });

  test("links from the package root into a subdirectory resolve", () => {
    expect(sectionById(book, "worksheets").html).toContain(
      '<a href="#read/m02" data-book-section="m02">Move 02</a>',
    );
  });

  test("a bare fragment links inside the same section, and its target keeps a namespaced id", () => {
    const html: string = sectionById(book, "m02").html;

    expect(html).toContain(
      '<a href="#read/m02" data-book-section="m02" data-book-anchor="bk-m02--local-note">below</a>',
    );
    expect(html).toContain('<p id="bk-m02--local-note">');
    expect(html).toContain(
      '<a href="#read/m01" data-book-section="m01">Move 01</a>',
    );
  });

  test("the content is sanitised: book classes are namespaced and scripts are gone", () => {
    const html: string = sectionById(book, "m02").html;

    expect(html).not.toMatch(SCRIPT_PATTERN);
    expect(html).toContain('<p class="bk-meta">');
    expect(html).toContain('<p class="bk-hook">');
    expect(sectionById(book, "m01").html).toContain(
      `<div class="bk-rollback"><h3>Rollback ${EM_DASH} read this first</h3>`,
    );
  });

  test("external links keep their destination and open in a new tab", () => {
    expect(sectionById(book, "copyright").html).toContain(
      '<a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener noreferrer" target="_blank">the licence</a>',
    );
  });

  test("the <head> never leaks into a section", () => {
    for (const section of book.sections) {
      expect(section.html).not.toContain("stylesheet");
      expect(section.html).not.toContain("<title");
      expect(section.html).not.toContain("<meta");
    }
  });

  test("counts the words each section contains", () => {
    expect(sectionById(book, "rollback").words).toBe(8);
    expect(sectionById(book, "m01").words).toBeGreaterThan(20);
    expect(sectionById(book, "contents").words).toBe(0);
  });

  test("the whole parsed shape, end to end", () => {
    expect(
      book.sections.map((section: BookSection): Record<string, unknown> => {
        return {
          id: section.id,
          kind: section.kind,
          title: section.title,
          label: section.label,
          number: section.number,
          part: section.part,
        };
      }),
    ).toEqual([
      {
        id: "titlepage",
        kind: "text",
        title: "Back to Metal",
        label: "Title page",
      },
      {
        id: "copyright",
        kind: "text",
        title: "Copyright",
        label: "Copyright",
      },
      {
        id: "contents",
        kind: "contents",
        title: "Contents",
        label: "Contents",
      },
      {
        id: "why",
        kind: "text",
        title: "Why this book exists",
        label: "Why this book exists",
      },
      {
        id: "rollback",
        kind: "text",
        title: "Before you touch anything",
        label: "Before you touch anything",
      },
      {
        id: "m01",
        kind: "text",
        title: "The bill, and the three lines that are most of it",
        label: `01 ${MIDDOT} The bill, and the three lines that are most of it`,
        number: "01",
        part: `Stage 1 ${MIDDOT} Decide`,
      },
      {
        id: "m02",
        kind: "text",
        title: "What you actually run",
        label: `02 ${MIDDOT} What you actually run`,
        number: "02",
        part: `Stage 1 ${MIDDOT} Decide`,
      },
      {
        id: "m03",
        kind: "text",
        title: "From rented vCPUs to cores you own",
        label: `03 ${MIDDOT} From rented vCPUs to cores you own`,
        number: "03",
        part: `Stage 2 ${MIDDOT} Buy`,
      },
      {
        id: "worksheets",
        kind: "text",
        title: "Operator worksheets",
        label: "Operator worksheets",
      },
    ]);
    expect(sectionById(book, "titlepage").html).toBe(
      '<div class="bk-front"><h1>Back to Metal</h1><p>How a company leaves the cloud, one move at a time</p><p>Nawaz Dhandala</p><p class="bk-small">backtometal.oneuptime.com</p></div>',
    );
    expect(sectionById(book, "rollback").html).toBe(
      '<h1>Before you touch anything</h1><p id="bk-rollback--first-rule">Read the rollback first.</p>',
    );
  });

  test("parsing is deterministic", () => {
    expect(JSON.stringify(parseDefault())).toBe(JSON.stringify(book));
  });
});

describe("parseEpub: titles", () => {
  const titled: (content: string) => BookSection = (
    content: string,
  ): BookSection => {
    const items: Array<EpubItem> = [
      { id: "chapter", href: "chapter.xhtml", content },
    ];

    return parseEpub(buildEpub({ items })).sections[0]!;
  };

  test("falls back to the first h1 when there is no <title>", () => {
    expect(
      titled(
        "<html><body><h1>Heading one</h1><h2>Heading two</h2><p>Text</p></body></html>",
      ).title,
    ).toBe("Heading one");
  });

  test("falls back to the first h1 when the <title> is empty", () => {
    expect(titled(xhtml("", "<h1>From the heading</h1>")).title).toBe(
      "From the heading",
    );
  });

  test("falls back to the first h2 when there is neither a title nor an h1", () => {
    expect(
      titled("<html><body><h2>Only an h2</h2><p>Text</p></body></html>").title,
    ).toBe("Only an h2");
  });

  test("falls back to the section id when the document names nothing", () => {
    expect(titled("<html><body><p>Just text</p></body></html>").title).toBe(
      "chapter",
    );
  });

  test("collapses whitespace and decodes entities in titles", () => {
    expect(
      titled(xhtml("  Two \n   words &amp; more  ", "<p>x</p>")).title,
    ).toBe("Two words & more");
  });
});

describe("parseEpub: links", () => {
  test("links to documents outside the spine keep their text but lose their link", () => {
    const items: Array<EpubItem> = withItems((defaults: Array<EpubItem>) => {
      return replaceItem(defaults, "f1", {
        content: xhtml(
          "Why this book exists",
          '<p><a href="style.css">the stylesheet</a> and <a href="img/cover.jpg">the cover</a> and <a href="missing.xhtml">a missing chapter</a>.</p>',
        ),
      });
    });
    const html: string = sectionById(
      parseEpub(buildEpub({ items })),
      "why",
    ).html;

    expect(html).toBe(
      "<p><span>the stylesheet</span> and <span>the cover</span> and <span>a missing chapter</span>.</p>",
    );
  });

  test("links to the navigation document point at the reader's contents page", () => {
    const items: Array<EpubItem> = withItems((defaults: Array<EpubItem>) => {
      return replaceItem(defaults, "f1", {
        content: xhtml(
          "Why this book exists",
          '<p><a href="nav.xhtml#toc">Contents</a></p>',
        ),
      });
    });
    const html: string = sectionById(
      parseEpub(buildEpub({ items })),
      "why",
    ).html;

    expect(html).toBe(
      '<p><a href="#read/contents" data-book-section="contents" data-book-anchor="bk-contents--toc">Contents</a></p>',
    );
  });

  test("percent-encoded paths resolve to the decoded archive entry", () => {
    const items: Array<EpubItem> = [
      {
        id: "intro",
        href: "intro.xhtml",
        content: xhtml(
          "Intro",
          '<p><a href="chapter%20one.xhtml#part%20two">Chapter one</a></p>',
        ),
      },
      {
        id: "one",
        href: "chapter%20one.xhtml",
        content: xhtml("Encoded name", "<p>encoded entry</p>"),
      },
    ];
    const book: ParsedEpub = parseEpub(
      buildEpub({
        items,
        extraEntries: [
          {
            name: "OEBPS/chapter one.xhtml",
            data: xhtml("Chapter one", '<p id="part two">Decoded entry</p>'),
          },
        ],
      }),
    );

    expect(sectionIds(book)).toEqual(["intro", "chapter-one"]);
    expect(sectionById(book, "chapter-one").title).toBe("Chapter one");
    expect(sectionById(book, "chapter-one").html).toContain("Decoded entry");
    // "part two" is not a valid id, so the link keeps its section but no anchor.
    expect(sectionById(book, "intro").html).toBe(
      '<p><a href="#read/chapter-one" data-book-section="chapter-one">Chapter one</a></p>',
    );
  });

  test("links carrying a query string still resolve", () => {
    const items: Array<EpubItem> = withItems((defaults: Array<EpubItem>) => {
      return replaceItem(defaults, "f1", {
        content: xhtml(
          "Why this book exists",
          '<p><a href="rollback.xhtml?v=2#first-rule">rule</a></p>',
        ),
      });
    });

    expect(sectionById(parseEpub(buildEpub({ items })), "why").html).toBe(
      '<p><a href="#read/rollback" data-book-section="rollback" data-book-anchor="bk-rollback--first-rule">rule</a></p>',
    );
  });

  test("links that climb out of the archive are removed", () => {
    const items: Array<EpubItem> = withItems((defaults: Array<EpubItem>) => {
      return replaceItem(defaults, "m01", {
        content: xhtml(
          "Escape",
          '<p><a href="../../../../etc/passwd">escape</a></p>',
        ),
      });
    });

    expect(sectionById(parseEpub(buildEpub({ items })), "m01").html).toBe(
      "<p><span>escape</span></p>",
    );
  });

  test("unsafe schemes are removed from links", () => {
    const items: Array<EpubItem> = withItems((defaults: Array<EpubItem>) => {
      return replaceItem(defaults, "f1", {
        content: xhtml(
          "Why this book exists",
          '<p><a href="javascript:alert(1)">one</a><a href="data:text/html,x">two</a><a href="mailto:book@example.com">three</a></p>',
        ),
      });
    });
    const html: string = sectionById(
      parseEpub(buildEpub({ items })),
      "why",
    ).html;

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:");
    expect(html).toContain("<span>one</span><span>two</span>");
    expect(html).toContain('href="mailto:book@example.com"');
  });
});

describe("parseEpub: spines", () => {
  test("a package document at the archive root works", () => {
    const book: ParsedEpub = parseEpub(buildEpub({ packageDirectory: "" }));

    expect(sectionIds(book)).toEqual(sectionIds(parseDefault()));
    expect(sectionById(book, "m01").html).toContain(
      'data-book-section="rollback"',
    );
    expect(sectionById(book, "m01").part).toBe(`Stage 1 ${MIDDOT} Decide`);
  });

  test("a deeper package directory keeps ids relative to it", () => {
    const book: ParsedEpub = parseEpub(
      buildEpub({ packageDirectory: "book/OPS" }),
    );

    expect(sectionIds(book)).toEqual(sectionIds(parseDefault()));
  });

  test("documents whose paths map to the same id get numbered suffixes", () => {
    const items: Array<EpubItem> = [
      { id: "a", href: "m/01.xhtml", content: xhtml("A", "<p>a</p>") },
      { id: "b", href: "m01.xhtml", content: xhtml("B", "<p>b</p>") },
      { id: "c", href: "M01.html", content: xhtml("C", "<p>c</p>") },
      {
        id: "d",
        href: "intro.xhtml",
        content: xhtml(
          "D",
          '<p><a href="m01.xhtml">b</a> <a href="M01.html">c</a></p>',
        ),
      },
    ];
    const book: ParsedEpub = parseEpub(buildEpub({ items }));

    expect(sectionIds(book)).toEqual(["m01", "m01-2", "m01-3", "intro"]);
    expect(sectionById(book, "m01-2").title).toBe("B");
    expect(sectionById(book, "m01-3").title).toBe("C");
    expect(sectionById(book, "intro").html).toBe(
      '<p><a href="#read/m01-2" data-book-section="m01-2">b</a> <a href="#read/m01-3" data-book-section="m01-3">c</a></p>',
    );
  });

  test("the navigation document is always the contents page, even when a chapter's path maps to the same id", () => {
    const items: Array<EpubItem> = withItems((defaults: Array<EpubItem>) => {
      return [
        ...defaults,
        {
          id: "own-contents",
          href: "contents.xhtml",
          content: xhtml("Table", "<p>The book's own contents page.</p>"),
        },
      ];
    });
    const book: ParsedEpub = parseEpub(
      buildEpub({
        items,
        spine: ["f0", "own-contents", "nav", "f1"],
      }),
    );
    const contents: Array<BookSection> = book.sections.filter(
      (section: BookSection): boolean => {
        return section.kind === "contents";
      },
    );
    const ownContents: BookSection | undefined = book.sections.find(
      (section: BookSection): boolean => {
        return section.title === "Table";
      },
    );

    expect(contents).toHaveLength(1);
    expect(contents[0]!.id).toBe(CONTENTS_SECTION_ID);
    expect(ownContents).toBeDefined();
    expect(ownContents!.kind).toBe("text");
    expect(ownContents!.html).toContain("The book&#39;s own contents page.");
  });

  test("non-XHTML spine items and unknown idrefs are skipped", () => {
    const book: ParsedEpub = parseEpub(
      buildEpub({ spine: ["f0", "css", "ghost", "cover-img", "m01"] }),
    );

    expect(sectionIds(book)).toEqual(["titlepage", "m01"]);
  });

  test("a document listed twice in the spine appears once", () => {
    const book: ParsedEpub = parseEpub(
      buildEpub({ spine: ["f0", "m01", "f0", "m01", "m02"] }),
    );

    expect(sectionIds(book)).toEqual(["titlepage", "m01", "m02"]);
  });

  test("two manifest items for the same file appear once", () => {
    const items: Array<EpubItem> = withItems((defaults: Array<EpubItem>) => {
      return [
        ...defaults,
        { id: "m01-again", href: "m/01.xhtml", content: "" },
      ];
    });
    const book: ParsedEpub = parseEpub(
      buildEpub({ items, spine: ["m01", "m01-again", "m02"] }),
    );

    expect(sectionIds(book)).toEqual(["m01", "m02"]);
  });

  test("non-linear spine items are kept, in spine order", () => {
    const items: Array<EpubItem> = withItems((defaults: Array<EpubItem>) => {
      return replaceItem(defaults, "copy", { linear: "no" });
    });
    const book: ParsedEpub = parseEpub(
      buildEpub({ items, spine: DEFAULT_SPINE }),
    );

    expect(sectionIds(book)).toEqual(sectionIds(parseDefault()));
    expect(sectionById(book, "copyright").kind).toBe("text");
  });

  test("a navigation document outside the spine still supplies the table of contents, without a contents page", () => {
    const book: ParsedEpub = parseEpub(
      buildEpub({
        spine: DEFAULT_SPINE.filter((id: string): boolean => {
          return id !== "nav";
        }),
      }),
    );

    expect(sectionIds(book)).not.toContain(CONTENTS_SECTION_ID);
    expect(book.toc).toEqual(parseDefault().toc);
    expect(sectionById(book, "m01").part).toBe(`Stage 1 ${MIDDOT} Decide`);
  });

  test("text/html spine documents are read like XHTML", () => {
    const items: Array<EpubItem> = [
      {
        id: "html",
        href: "page.html",
        mediaType: "text/html",
        content:
          "<html><head><title>Plain HTML</title></head><body><p>Hello</p></body></html>",
      },
    ];
    const book: ParsedEpub = parseEpub(buildEpub({ items, spine: ["html"] }));

    expect(book.sections).toHaveLength(1);
    expect(book.sections[0]).toMatchObject({
      id: "page",
      title: "Plain HTML",
      html: "<p>Hello</p>",
    });
  });

  test("files with a UTF-8 byte order mark are read", () => {
    const BOM: string = String.fromCharCode(0xfeff);
    const items: Array<EpubItem> = withItems((defaults: Array<EpubItem>) => {
      return replaceItem(defaults, "f1", {
        content: `${BOM}${xhtml("Why this book exists", "<p>With a BOM</p>")}`,
      });
    });
    const opf: string = `${BOM}${buildOpf(items, DEFAULT_SPINE, {})}`;
    const book: ParsedEpub = parseEpub(
      buildEpub({
        items,
        opf,
        container: `${BOM}${containerXml("OEBPS/content.opf")}`,
      }),
    );

    expect(book.metadata.title).toBe("Back to Metal");
    expect(sectionById(book, "why").html).toBe("<p>With a BOM</p>");
    expect(sectionById(book, "why").title).toBe("Why this book exists");
  });

  test("an unreadable spine document becomes an empty section titled by its id", () => {
    const book: ParsedEpub = parseEpub(
      buildEpub({
        items: [
          { id: "a", href: "a.xhtml", content: xhtml("A", "<p>a</p>") },
          { id: "b", href: "b.xhtml", content: "" },
        ],
      }),
    );

    expect(sectionById(book, "b")).toMatchObject({
      id: "b",
      kind: "text",
      title: "b",
      label: "b",
      html: "",
      words: 0,
    });
  });

  test("manifest items without an id or href are ignored", () => {
    const opf: string = buildOpf(defaultBookItems(), DEFAULT_SPINE, {}).replace(
      "<manifest>",
      '<manifest>\n<item href="stray.xhtml" media-type="application/xhtml+xml"/>\n<item id="no-href" media-type="application/xhtml+xml"/>',
    );
    const book: ParsedEpub = parseEpub(buildEpub({ opf }));

    expect(sectionIds(book)).toEqual(sectionIds(parseDefault()));
  });
});

describe("parseEpub: the EPUB 2 NCX fallback", () => {
  const ncx: string = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">',
    "<head/><docTitle><text>Back to Metal</text></docTitle>",
    "<navMap>",
    '<navPoint id="p1" playOrder="1"><navLabel><text>Why this book exists</text></navLabel><content src="why.xhtml"/></navPoint>',
    `<navPoint id="p2" playOrder="2"><navLabel><text>Stage 1 ${MIDDOT} Decide</text></navLabel><content src="m/01.xhtml"/>`,
    `<navPoint id="p3" playOrder="3"><navLabel><text>01 ${MIDDOT} The bill</text></navLabel><content src="m/01.xhtml"/></navPoint>`,
    `<navPoint id="p4" playOrder="4"><navLabel><text>02 ${MIDDOT} What you run</text></navLabel><content src="m/02.xhtml"/></navPoint>`,
    "</navPoint>",
    '<navPoint id="p5" playOrder="5"><navLabel><text>Operator worksheets</text></navLabel><content src="worksheets.xhtml"/>',
    '<navPoint id="p6" playOrder="6"><navLabel><text>Restore proof</text></navLabel><content src="worksheets.xhtml#restore-proof"/></navPoint>',
    "</navPoint>",
    "</navMap>",
    "</ncx>",
  ].join("\n");

  const ncxItems: (mediaType?: string) => Array<EpubItem> = (
    mediaType: string = "application/x-dtbncx+xml",
  ): Array<EpubItem> => {
    return withItems((defaults: Array<EpubItem>) => {
      return [
        ...withoutItem(defaults, "nav"),
        { id: "ncx", href: "toc.ncx", mediaType, content: ncx },
      ];
    });
  };

  const noNavSpine: Array<string> = DEFAULT_SPINE.filter(
    (id: string): boolean => {
      return id !== "nav";
    },
  );

  const expectedToc: Array<BookTocEntry> = [
    { label: "Why this book exists", sectionId: "why", children: [] },
    {
      label: `Stage 1 ${MIDDOT} Decide`,
      sectionId: "m01",
      children: [
        { label: `01 ${MIDDOT} The bill`, sectionId: "m01", children: [] },
        {
          label: `02 ${MIDDOT} What you run`,
          sectionId: "m02",
          children: [],
        },
      ],
    },
    {
      label: "Operator worksheets",
      sectionId: "worksheets",
      children: [
        {
          label: "Restore proof",
          sectionId: "worksheets",
          anchorId: "bk-worksheets--restore-proof",
          children: [],
        },
      ],
    },
  ];

  test("reads the NCX named by the spine's toc attribute", () => {
    const book: ParsedEpub = parseEpub(
      buildEpub({
        items: ncxItems("application/xml"),
        spine: noNavSpine,
        spineTocId: "ncx",
      }),
    );

    expect(book.toc).toEqual(expectedToc);
  });

  test("finds the NCX by media type when the spine does not name it", () => {
    const book: ParsedEpub = parseEpub(
      buildEpub({ items: ncxItems(), spine: noNavSpine }),
    );

    expect(book.toc).toEqual(expectedToc);
    expect(sectionIds(book)).not.toContain(CONTENTS_SECTION_ID);
  });

  test("labels, numbers and parts come from the NCX", () => {
    const book: ParsedEpub = parseEpub(
      buildEpub({ items: ncxItems(), spine: noNavSpine, spineTocId: "ncx" }),
    );

    expect(sectionById(book, "m01")).toMatchObject({
      label: `01 ${MIDDOT} The bill`,
      number: "01",
      part: `Stage 1 ${MIDDOT} Decide`,
    });
    expect(sectionById(book, "m02").part).toBe(`Stage 1 ${MIDDOT} Decide`);
    expect(sectionById(book, "worksheets").part).toBeUndefined();
    // Move 03 is not in this NCX: it keeps its title as its label.
    expect(sectionById(book, "m03")).toMatchObject({
      label: "From rented vCPUs to cores you own",
      number: undefined,
      part: undefined,
    });
  });

  test("falls back to the NCX when the navigation document has no list", () => {
    const items: Array<EpubItem> = withItems((defaults: Array<EpubItem>) => {
      return [
        ...replaceItem(defaults, "nav", {
          content: xhtml(
            "Contents",
            '<nav epub:type="toc"><h1>Empty</h1></nav>',
          ),
        }),
        {
          id: "ncx",
          href: "toc.ncx",
          mediaType: "application/x-dtbncx+xml",
          content: ncx,
        },
      ];
    });
    const book: ParsedEpub = parseEpub(
      buildEpub({ items, spine: DEFAULT_SPINE }),
    );

    expect(book.toc).toEqual(expectedToc);
    expect(sectionById(book, CONTENTS_SECTION_ID).kind).toBe("contents");
  });

  test("a book without any table of contents still parses", () => {
    const book: ParsedEpub = parseEpub(
      buildEpub({
        items: withoutItem(defaultBookItems(), "nav"),
        spine: noNavSpine,
      }),
    );

    expect(book.toc).toEqual([]);
    expect(sectionById(book, "m01")).toMatchObject({
      label: "The bill, and the three lines that are most of it",
      number: undefined,
      part: undefined,
    });
  });
});

describe("parseEpub: navigation documents", () => {
  const navWith: (list: string) => Array<EpubItem> = (
    list: string,
  ): Array<EpubItem> => {
    return withItems((defaults: Array<EpubItem>) => {
      return replaceItem(defaults, "nav", {
        content: xhtml("Contents", `<nav epub:type="toc">${list}</nav>`),
      });
    });
  };

  test("prefers the toc nav over other navs", () => {
    const items: Array<EpubItem> = withItems((defaults: Array<EpubItem>) => {
      return replaceItem(defaults, "nav", {
        content: xhtml(
          "Contents",
          '<nav epub:type="page-list"><ol><li><a href="why.xhtml">Page list</a></li></ol></nav><nav epub:type="toc"><ol><li><a href="m/01.xhtml">From the toc</a></li></ol></nav>',
        ),
      });
    });

    expect(parseEpub(buildEpub({ items })).toc).toEqual([
      { label: "From the toc", sectionId: "m01", children: [] },
    ]);
  });

  test("span headings group their children under the first child's section", () => {
    const book: ParsedEpub = parseEpub(
      buildEpub({
        items: navWith(
          '<ol><li><span>Part One</span><ol><li><a href="m/02.xhtml">Two</a></li><li><a href="m/03.xhtml">Three</a></li></ol></li></ol>',
        ),
      }),
    );

    expect(book.toc).toEqual([
      {
        label: "Part One",
        sectionId: "m02",
        children: [
          { label: "Two", sectionId: "m02", children: [] },
          { label: "Three", sectionId: "m03", children: [] },
        ],
      },
    ]);
    expect(sectionById(book, "m03").part).toBe("Part One");
  });

  test("drops entries with no label, and entries that lead nowhere", () => {
    const book: ParsedEpub = parseEpub(
      buildEpub({
        items: navWith(
          '<ol><li><a href="why.xhtml"> </a></li><li><a href="missing.xhtml">Missing</a></li><li><span>Empty part</span></li><li><a href="rollback.xhtml">Kept</a></li></ol>',
        ),
      }),
    );

    expect(book.toc).toEqual([
      { label: "Kept", sectionId: "rollback", children: [] },
    ]);
  });

  test("anchors that are not valid ids are dropped from entries", () => {
    const book: ParsedEpub = parseEpub(
      buildEpub({
        items: navWith(
          '<ol><li><a href="worksheets.xhtml#9-bad id">Bad anchor</a></li></ol>',
        ),
      }),
    );

    expect(book.toc).toEqual([
      { label: "Bad anchor", sectionId: "worksheets", children: [] },
    ]);
  });

  test("the fixture's navigation document is the one the parser reads", () => {
    expect(NAV_DOCUMENT).toContain('epub:type="toc"');
  });
});

describe("parseEpub: failures", () => {
  test("rejects an archive whose mimetype is not EPUB", () => {
    const error: unknown = catchError(() => {
      return parseEpub(buildEpub({ mimetype: "application/zip" }));
    });

    expect(error).toBeInstanceOf(EpubError);
    expect((error as Error).message).toContain("application/zip");
  });

  test("tolerates a missing mimetype entry", () => {
    expect(sectionIds(parseEpub(buildEpub({ mimetype: null })))).toEqual(
      sectionIds(parseDefault()),
    );
  });

  test("tolerates whitespace around the mimetype", () => {
    expect(() => {
      return parseEpub(buildEpub({ mimetype: "application/epub+zip\n" }));
    }).not.toThrow();
  });

  test("requires META-INF/container.xml", () => {
    expect(() => {
      return parseEpub(buildEpub({ container: null }));
    }).toThrow(new EpubError("The EPUB has no META-INF/container.xml."));
  });

  test("requires the container to name a package document", () => {
    expect(() => {
      return parseEpub(
        buildEpub({
          container:
            '<?xml version="1.0"?><container><rootfiles></rootfiles></container>',
        }),
      );
    }).toThrow(EpubError);
    expect(() => {
      return parseEpub(
        buildEpub({
          container:
            '<container><rootfiles><rootfile media-type="application/oebps-package+xml"/></rootfiles></container>',
        }),
      );
    }).toThrow("names no package document");
  });

  test("prefers the OEBPS rootfile when the container lists several", () => {
    const container: string =
      '<container><rootfiles><rootfile full-path="other/thing.pdf" media-type="application/pdf"/><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';

    expect(sectionIds(parseEpub(buildEpub({ container })))).toEqual(
      sectionIds(parseDefault()),
    );
  });

  test("falls back to the first rootfile when none declares its media type", () => {
    const container: string =
      '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>';

    expect(sectionIds(parseEpub(buildEpub({ container })))).toEqual(
      sectionIds(parseDefault()),
    );
  });

  test("requires the package document the container names", () => {
    expect(() => {
      return parseEpub(buildEpub({ opf: null }));
    }).toThrow(
      new EpubError("The package document OEBPS/content.opf is missing."),
    );
  });

  test("requires a spine", () => {
    const opf: string = buildOpf(defaultBookItems(), DEFAULT_SPINE, {}).replace(
      /<spine[\s\S]*<\/spine>/,
      "",
    );

    expect(() => {
      return parseEpub(buildEpub({ opf }));
    }).toThrow(new EpubError("The package document has no spine."));
  });

  test("requires at least one readable document in the spine", () => {
    expect(() => {
      return parseEpub(buildEpub({ spine: [] }));
    }).toThrow(new EpubError("The EPUB spine has no readable documents."));
    expect(() => {
      return parseEpub(buildEpub({ spine: ["css", "cover-img", "ghost"] }));
    }).toThrow(EpubError);
  });

  test("enforces the section limit", () => {
    expect(() => {
      return parseEpub(buildEpub(), { maxSections: 3 });
    }).toThrow(new EpubError("The EPUB has more than 3 sections."));
    expect(() => {
      return parseEpub(buildEpub(), { maxSections: DEFAULT_SPINE.length });
    }).not.toThrow();
  });

  test("enforces the per-section size limit", () => {
    const error: unknown = catchError(() => {
      return parseEpub(buildEpub(), { maxSectionHtmlBytes: 60 });
    });

    expect(error).toBeInstanceOf(EpubError);
    expect((error as Error).message).toMatch(/Section \S+ is too large/);
  });

  test("lets ZIP errors from corrupt archives through", () => {
    expect(() => {
      return parseEpub(Buffer.from("this is not an epub at all"));
    }).toThrow(ZipError);
  });

  test("applies the archive size limit", () => {
    expect(() => {
      return parseEpub(buildEpub(), { maxArchiveBytes: 100 });
    }).toThrow(ZipError);
  });

  test("applies the entry size limit", () => {
    expect(() => {
      return parseEpub(buildEpub(), { maxEntryBytes: 64 });
    }).toThrow(ZipError);
  });

  test("an archive with only a mimetype is not a book", () => {
    const archive: Buffer = createZip([
      { name: "mimetype", data: "application/epub+zip", method: "store" },
    ]);

    expect(() => {
      return parseEpub(archive);
    }).toThrow(EpubError);
  });
});

describe("resolveArchivePath", () => {
  test.each([
    ["OEBPS/m/01.xhtml", "../rollback.xhtml", "OEBPS/rollback.xhtml"],
    ["OEBPS/m/01.xhtml", "02.xhtml", "OEBPS/m/02.xhtml"],
    ["OEBPS/m/01.xhtml", "02.xhtml#step-1", "OEBPS/m/02.xhtml"],
    ["OEBPS/m/01.xhtml", "#local", "OEBPS/m/01.xhtml"],
    ["OEBPS/m/01.xhtml", "", "OEBPS/m/01.xhtml"],
    ["OEBPS/content.opf", "m/01.xhtml", "OEBPS/m/01.xhtml"],
    ["OEBPS/content.opf", "./m/./01.xhtml", "OEBPS/m/01.xhtml"],
    ["OEBPS/content.opf", "a%20b.xhtml", "OEBPS/a b.xhtml"],
    ["OEBPS/content.opf", "chapter.xhtml?v=2#x", "OEBPS/chapter.xhtml"],
    ["OEBPS/content.opf", "/abs/file.xhtml", "abs/file.xhtml"],
    ["content.opf", "m/01.xhtml", "m/01.xhtml"],
    ["content.opf", "../outside.xhtml", null],
    ["OEBPS/x.xhtml", "../../../etc/passwd", null],
    ["OEBPS/x.xhtml", "%E0%A4%A.xhtml", "OEBPS/%E0%A4%A.xhtml"],
  ] as Array<[string, string, string | null]>)(
    "resolveArchivePath(%j, %j) is %j",
    (basePath: string, href: string, expected: string | null) => {
      expect(resolveArchivePath(basePath, href)).toBe(expected);
    },
  );
});

describe("sectionIdForPath", () => {
  test.each([
    ["m/01.xhtml", "m01"],
    ["m/20.xhtml", "m20"],
    ["why.xhtml", "why"],
    ["titlepage.xhtml", "titlepage"],
    ["Text/Chapter 1.XHTML", "textchapter-1"],
    ["file.name.xhtml", "file-name"],
    ["__odd__!!.html", "odd"],
    ["chapter", "chapter"],
    ["dir.v2/chapter", "dir-v2chapter"],
    ["", "section"],
    ["!!!.xhtml", "section"],
    [`${E_ACUTE}t${E_ACUTE}.xhtml`, "t"],
  ])("sectionIdForPath(%j) is %j", (input: string, expected: string) => {
    expect(sectionIdForPath(input)).toBe(expected);
  });

  test("caps ids at 48 characters", () => {
    const id: string = sectionIdForPath(`${"a".repeat(100)}.xhtml`);

    expect(id).toBe("a".repeat(48));
  });

  test("always produces an id the reader accepts", () => {
    for (const input of [
      "m/01.xhtml",
      "Text/Chapter 1.XHTML",
      `${"chapter-".repeat(20)}.xhtml`,
      "-leading/dash.xhtml",
      "",
      `${E_ACUTE.repeat(3)}.xhtml`,
      "12/34/56.xhtml",
    ]) {
      expect(isValidSectionId(sectionIdForPath(input))).toBe(true);
    }
  });
});

describe("isPartEntry", () => {
  test("an entry with whole chapters under it is a part", () => {
    expect(
      isPartEntry({
        label: "Stage 1",
        sectionId: "m01",
        children: [{ label: "01", sectionId: "m01", children: [] }],
      }),
    ).toBe(true);
  });

  test("an entry whose children are all anchors is not a part", () => {
    expect(
      isPartEntry({
        label: "Operator worksheets",
        sectionId: "worksheets",
        children: [
          {
            label: "Restore proof",
            sectionId: "worksheets",
            anchorId: "bk-worksheets--restore-proof",
            children: [],
          },
        ],
      }),
    ).toBe(false);
  });

  test("an entry without children is not a part", () => {
    expect(isPartEntry({ label: "Why", sectionId: "why", children: [] })).toBe(
      false,
    );
  });

  test("one whole chapter among anchors is enough", () => {
    expect(
      isPartEntry({
        label: "Mixed",
        sectionId: "a",
        children: [
          { label: "A1", sectionId: "a", anchorId: "bk-a--x", children: [] },
          { label: "B", sectionId: "b", children: [] },
        ],
      }),
    ).toBe(true);
  });
});
