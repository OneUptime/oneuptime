import fs from "fs";
import path from "path";
import {
  BackToMetal,
  BookChapter,
  BookMove,
  Books,
  BookStage,
  getBookBySlug,
} from "../../Utils/Books/BookCatalog";
import { isValidSectionId } from "../../Utils/Books/BookHtml";
import { sectionIdForPath } from "../../Utils/Books/Epub";

/*
 * The catalog renders the /books landing page and tells the reader which
 * EPUB section each contents link opens, so its ids must match what the
 * parser derives from the book's layout, and its links must stay on the
 * book's own website.
 */

const SITE: string = "https://backtometal.oneuptime.com/";
const MOVE_URL_PATTERN: RegExp =
  /^https:\/\/backtometal\.oneuptime\.com\/m\/(\d{2})-[a-z0-9-]+\.html$/;
const STATIC_ROOT: string = path.join(__dirname, "..", "..", "Static");

const allMoves: () => Array<BookMove> = (): Array<BookMove> => {
  return BackToMetal.stages.flatMap((stage: BookStage): Array<BookMove> => {
    return stage.moves;
  });
};

const allChapters: () => Array<BookChapter> = (): Array<BookChapter> => {
  return [...BackToMetal.frontMatter, ...allMoves(), ...BackToMetal.backMatter];
};

describe("the book catalog", () => {
  test("finds books by slug", () => {
    expect(getBookBySlug("back-to-metal")).toBe(BackToMetal);
    expect(getBookBySlug("Back-To-Metal")).toBeUndefined();
    expect(getBookBySlug("")).toBeUndefined();
    expect(getBookBySlug("../back-to-metal")).toBeUndefined();
  });

  test("lists Back to Metal, with unique slugs", () => {
    expect(Books).toContain(BackToMetal);

    const slugs: Array<string> = Books.map((book: { slug: string }): string => {
      return book.slug;
    });

    expect(new Set<string>(slugs).size).toBe(slugs.length);
  });

  test("identifies the book the way the book does", () => {
    expect(BackToMetal).toMatchObject({
      slug: "back-to-metal",
      title: "Back to Metal",
      titleLead: "Back to",
      titleAccent: "Metal",
      subtitle: "How a company leaves the cloud, one move at a time",
      author: "Nawaz Dhandala",
      publisher: "HackerBay, Inc.",
      language: "en",
      collectionNumber: "001",
    });
    expect(`${BackToMetal.titleLead} ${BackToMetal.titleAccent}`).toBe(
      BackToMetal.title,
    );
  });

  test("points at the official website, downloads and source", () => {
    expect(BackToMetal.siteUrl).toBe(SITE);
    expect(BackToMetal.epubUrl).toBe(`${SITE}Back-to-Metal.epub`);
    expect(BackToMetal.pdfUrl).toBe(`${SITE}Back-to-Metal.pdf`);
    expect(BackToMetal.aboutUrl).toBe(`${SITE}about.html`);
    expect(BackToMetal.sourceUrl).toBe(
      "https://github.com/OneUptime/back-to-metal",
    );
  });

  test("carries its open licence", () => {
    expect(BackToMetal.license).toEqual({
      name: "CC BY 4.0",
      url: "https://creativecommons.org/licenses/by/4.0/",
    });
  });

  test("the reader loads the text from this site's content route", () => {
    expect(BackToMetal.contentPath).toBe(
      `/books/${BackToMetal.slug}/content.json`,
    );
  });

  test("ships the cover it names, as a real JPEG of the stated size ratio", () => {
    const coverFile: string = path.join(STATIC_ROOT, BackToMetal.coverPath);
    const cover: Buffer = fs.readFileSync(coverFile);

    expect(BackToMetal.coverPath).toBe("/img/books/back-to-metal.jpg");
    expect(cover.length).toBeGreaterThan(10000);
    expect(cover.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(BackToMetal.coverWidth).toBe(1600);
    expect(BackToMetal.coverHeight).toBe(2560);
  });

  test("states facts for the page", () => {
    expect(BackToMetal.facts.length).toBeGreaterThan(0);

    for (const fact of BackToMetal.facts) {
      expect(fact.value.trim()).not.toBe("");
      expect(fact.label.trim()).not.toBe("");
    }

    expect(BackToMetal.facts[0]).toEqual({
      value: String(allMoves().length),
      label: "practical moves",
    });
    expect(BackToMetal.facts[1]!.value).toBe(String(BackToMetal.stages.length));
  });

  test("quotes an excerpt from one of the front-matter chapters", () => {
    expect(BackToMetal.frontMatter).toContainEqual(BackToMetal.excerpt.source);
    expect(BackToMetal.excerpt.heading.trim()).not.toBe("");
    expect(BackToMetal.excerpt.paragraphs.length).toBeGreaterThan(0);
  });
});

describe("the stages and moves", () => {
  test("five stages, numbered in order", () => {
    expect(
      BackToMetal.stages.map((stage: BookStage): [number, string] => {
        return [stage.number, stage.name];
      }),
    ).toEqual([
      [1, "Decide"],
      [2, "Buy"],
      [3, "Build"],
      [4, "Move"],
      [5, "Run"],
    ]);
  });

  test("each stage has a summary, a finish line and four moves", () => {
    for (const stage of BackToMetal.stages) {
      expect(stage.summary.trim()).not.toBe("");
      expect(stage.doneWhen.trim()).not.toBe("");
      expect(stage.moves).toHaveLength(4);
    }
  });

  test("twenty moves, numbered 01 to 20 in reading order", () => {
    expect(
      allMoves().map((move: BookMove): string => {
        return move.number;
      }),
    ).toEqual(
      Array.from({ length: 20 }, (_value: unknown, index: number): string => {
        return String(index + 1).padStart(2, "0");
      }),
    );
  });

  test("every move opens the reader at m<number>", () => {
    for (const move of allMoves()) {
      expect(move.sectionId).toBe(`m${move.number}`);
      expect(isValidSectionId(move.sectionId)).toBe(true);
      expect(move.title.trim()).not.toBe("");
    }
  });

  test("every move links to its own chapter on the book's website", () => {
    for (const move of allMoves()) {
      const match: RegExpExecArray | null = MOVE_URL_PATTERN.exec(move.webUrl);

      expect(match).not.toBeNull();
      expect(match![1]).toBe(move.number);
    }
  });

  test("move titles are unique", () => {
    const titles: Array<string> = allMoves().map((move: BookMove): string => {
      return move.title;
    });

    expect(new Set<string>(titles).size).toBe(titles.length);
  });
});

describe("chapter ids and links", () => {
  test("every section id is valid and used once", () => {
    const ids: Array<string> = allChapters().map(
      (chapter: BookChapter): string => {
        return chapter.sectionId;
      },
    );

    for (const id of ids) {
      expect(isValidSectionId(id)).toBe(true);
    }

    expect(new Set<string>(ids).size).toBe(ids.length);
  });

  test("the front and back matter open the sections the EPUB produces", () => {
    expect(
      BackToMetal.frontMatter.map((chapter: BookChapter): string => {
        return chapter.sectionId;
      }),
    ).toEqual(["why", "decision", "costs", "rollback", "kit", "replaces"]);
    expect(
      BackToMetal.backMatter.map((chapter: BookChapter): string => {
        return chapter.sectionId;
      }),
    ).toEqual(["worksheets"]);
  });

  test("every catalog id is the id the parser derives from the book's layout", () => {
    for (const move of allMoves()) {
      expect(sectionIdForPath(`m/${move.number}.xhtml`)).toBe(move.sectionId);
    }

    for (const chapter of [
      ...BackToMetal.frontMatter,
      ...BackToMetal.backMatter,
    ]) {
      expect(sectionIdForPath(`${chapter.sectionId}.xhtml`)).toBe(
        chapter.sectionId,
      );
    }
  });

  test("every chapter's fallback link stays on the book's website over HTTPS", () => {
    for (const chapter of allChapters()) {
      const url: URL = new URL(chapter.webUrl);

      expect(url.protocol).toBe("https:");
      expect(url.hostname).toBe("backtometal.oneuptime.com");
      expect(chapter.title.trim()).not.toBe("");
    }
  });
});
