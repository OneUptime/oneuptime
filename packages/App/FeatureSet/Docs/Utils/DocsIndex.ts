import { DocsVocabulary } from "./DocsSearchWords";
import { AIDocsSection } from "Common/Server/Utils/AI/Docs/AIDocsLibrary";

/*
 * A DOCS LANGUAGE'S INDEX, LAID OUT TO HOLD LITTLE (issue #8818).
 *
 * The docs search box (DocsSearch) and Ask AI's search_docs (AIDocsReader)
 * read one index per docs language. It used to keep each page's and each
 * section's words as a Map of their own - 600,000 entries for English, two
 * million for Japanese - each section's text, the phrase form of it the
 * first phrase search made, and, without meaning to, the whole Markdown of
 * every page: a section's heading was cut from the page, and V8 keeps a
 * string cut from another as a view that keeps the other alive (ownCopy).
 * That was 62 to 101 MB a language once searched, 1.3 GB for all seventeen.
 *
 * Here every word the index holds is one entry of one sorted list
 * (DocsVocabulary), its number in the index is its place in that list, and
 * where it is written is a run of small numbers in typed arrays
 * (DocsIndexPostings): for each word, the pages that hold it - how many
 * times each page's body says it, and whether its title, its nav group, its
 * summary or its headings do - and then the sections that hold it, the same
 * way. A search reads the runs of the few words it looks for, page by page
 * (DocsTermReader), where it used to ask every page's Maps. A page's and a
 * section's words are still asked about by name (DocsTermSet), for the
 * tests and for whoever reads an index by hand.
 *
 * Both ways of building an index - the docs on disk (AIDocsReader.build) and
 * the small hand-made ones the tests rank (DocsSearchHelpers) - hand their
 * pages, words already read, to DocsIndexBuilder.
 */

// Where a page holds a word besides its body: the bits of the page's entry for the word.
export const IN_PAGE_TITLE: number = 1;
export const IN_PAGE_GROUP: number = 2;
export const IN_PAGE_SUMMARY: number = 4;
export const IN_PAGE_HEADINGS: number = 8;
// The section's heading holds the word: the bit of a section's entry for it.
export const IN_SECTION_TITLE: number = 1;

// The words one part of a page holds, asked about one by one.
export interface DocsTermSet {
  has(term: string): boolean;
}

// The words one part of a page holds, with how many times it says each.
export interface DocsTermCounts extends DocsTermSet {
  // Undefined for a word it does not hold, as a Map's get is.
  get(term: string): number | undefined;
}

export interface AIDocsIndexedSection extends AIDocsSection {
  // Its place among the index's sections, counted page by page: where its entries are.
  readonly number: number;
  // The words of what it says, with how many times each is written.
  readonly terms: DocsTermCounts;
  readonly titleTerms: DocsTermSet;
  /*
   * What the section says, as plain text (plainTextOfDocs): the line a
   * search result shows is cut from it.
   */
  readonly text: string;
  // Its heading and its text as a phrase is compared with them (docsPhraseOf).
  readonly phrase: string;
  // How many words `terms` counts: how long DocsSearch reads the section as.
  readonly wordCount: number;
  /*
   * A name the Glossary gives a term besides its own ("Service Catalog
   * (Service)"), as a section that opens the term: found by that name.
   */
  readonly isOtherName: boolean;
}

export interface AIDocsIndexedPage {
  // Its place among the index's pages: where its entries are.
  readonly number: number;
  readonly page: string;
  readonly title: string;
  readonly group: string;
  readonly summary: string;
  readonly language: string;
  readonly titleTerms: DocsTermSet;
  readonly groupTerms: DocsTermSet;
  readonly summaryTerms: DocsTermSet;
  readonly headingTerms: DocsTermSet;
  readonly bodyTerms: DocsTermCounts;
  // How many words its body holds.
  readonly bodyLength: number;
  readonly sections: ReadonlyArray<AIDocsIndexedSection>;
  // A guide (NavLink.isGuide): docs search ranks it above a reference page for the same words.
  readonly isGuide: boolean;
}

export interface AIDocsLanguageIndex {
  // The language it was built for; a page not translated yet is its English copy.
  readonly language: string;
  readonly pages: ReadonlyArray<AIDocsIndexedPage>;
  // How many pages hold each word.
  readonly documentFrequency: DocsTermCounts;
  // How many words a page's body holds, on average.
  readonly averageBodyLength: number;
  // Every word, laid out to find the ones a typed word starts or nearly spells.
  readonly vocabulary: DocsVocabulary;
  // Where each word is written: what a search reads (DocsTermReader).
  readonly postings: DocsIndexPostings;
}

// A section as DocsIndexBuilder is handed it: its words already read (tokenizeForDocs).
export interface DocsIndexSectionInput {
  title: string;
  anchor: string;
  text: string;
  isOtherName?: boolean | undefined;
  terms: ReadonlyMap<string, number>;
  titleTerms: ReadonlySet<string>;
}

// A page as DocsIndexBuilder is handed it: its words already read.
export interface DocsIndexPageInput {
  page: string;
  title: string;
  group: string;
  summary: string;
  language: string;
  isGuide: boolean;
  titleTerms: ReadonlySet<string>;
  groupTerms: ReadonlySet<string>;
  summaryTerms: ReadonlySet<string>;
  headingTerms: ReadonlySet<string>;
  bodyTerms: ReadonlyMap<string, number>;
  bodyLength: number;
  sections: ReadonlyArray<DocsIndexSectionInput>;
}

/*
 * A string of its own. V8 keeps a string cut from another - a slice, a
 * regular expression's match, a split's part - of 13 characters or more as
 * a view of the one it was cut from, and that one stays as long as the
 * view does: the index kept every page's Markdown, 14 MB of English, for
 * the sake of its section headings. A copy holds only its own characters,
 * one byte each where every one of them fits in a byte. UTF-16 carries
 * every string as it is, a lone surrogate too.
 */
export const ownCopy: (text: string) => string = (text: string): string => {
  return Buffer.from(text, "utf16le").toString("utf16le");
};

// What is not a word of a phrase: everything but letters, marks and digits.
const NOT_A_PHRASE_WORD: RegExp = /[^\p{L}\p{M}\p{N}]+/u;

/*
 * Text as a phrase is compared with it: lower case, one space between
 * words, and one at each end, so " a phrase " is found only where its
 * words are whole.
 */
export const docsPhraseOf: (text: string) => string = (
  text: string,
): string => {
  return ` ${text
    .normalize("NFKC")
    .toLowerCase()
    .split(NOT_A_PHRASE_WORD)
    .filter((word: string): boolean => {
      return word.length > 0;
    })
    .join(" ")} `;
};

// Numbers in the narrowest typed array that holds the largest of them.
type DocsUints = Uint8Array | Uint16Array | Uint32Array;

const narrowest: (length: number, largest: number) => DocsUints = (
  length: number,
  largest: number,
): DocsUints => {
  if (largest <= 0xff) {
    return new Uint8Array(length);
  }

  return largest <= 0xffff ? new Uint16Array(length) : new Uint32Array(length);
};

// Numbers added one by one, kept four bytes each while an index is built.
class GrowingUints {
  private data: Uint32Array = new Uint32Array(4096);
  public length: number = 0;

  public push(value: number): void {
    if (this.length === this.data.length) {
      const larger: Uint32Array = new Uint32Array(this.data.length * 2);
      larger.set(this.data);
      this.data = larger;
    }

    this.data[this.length++] = value;
  }

  public at(position: number): number {
    return this.data[position]!;
  }
}

/*
 * Every entry of an index: for each word, by its place in the vocabulary,
 * a run of the pages that hold it (page order) and a run of the sections
 * that do (section order). A page's entry says how many times its body
 * says the word and where else it holds it (IN_PAGE_*); a section's, how
 * many times its text says it and whether its heading does
 * (IN_SECTION_TITLE).
 */
export class DocsIndexPostings {
  public readonly vocabulary: DocsVocabulary;
  // Word w's page entries are pageStart[w] up to pageStart[w + 1].
  private readonly pageStart: Uint32Array;
  private readonly pageOf: DocsUints;
  private readonly pageCountOf: DocsUints;
  private readonly pageFieldsOf: Uint8Array;
  private readonly sectionStart: Uint32Array;
  private readonly sectionOf: DocsUints;
  private readonly sectionCountOf: DocsUints;
  private readonly sectionFieldsOf: Uint8Array;

  public constructor(data: {
    vocabulary: DocsVocabulary;
    pageStart: Uint32Array;
    pageOf: DocsUints;
    pageCountOf: DocsUints;
    pageFieldsOf: Uint8Array;
    sectionStart: Uint32Array;
    sectionOf: DocsUints;
    sectionCountOf: DocsUints;
    sectionFieldsOf: Uint8Array;
  }) {
    this.vocabulary = data.vocabulary;
    this.pageStart = data.pageStart;
    this.pageOf = data.pageOf;
    this.pageCountOf = data.pageCountOf;
    this.pageFieldsOf = data.pageFieldsOf;
    this.sectionStart = data.sectionStart;
    this.sectionOf = data.sectionOf;
    this.sectionCountOf = data.sectionCountOf;
    this.sectionFieldsOf = data.sectionFieldsOf;
  }

  // How many entries it holds, pages' and sections'.
  public get size(): number {
    return this.pageOf.length + this.sectionOf.length;
  }

  // The entries of `term`, or none for a word no page or section holds.
  public runOf(term: string): DocsTermRun {
    const word: number = this.vocabulary.positionOf(term);

    if (word < 0) {
      return { pageFrom: 0, pageTo: 0, sectionFrom: 0, sectionTo: 0 };
    }

    return {
      pageFrom: this.pageStart[word]!,
      pageTo: this.pageStart[word + 1]!,
      sectionFrom: this.sectionStart[word]!,
      sectionTo: this.sectionStart[word + 1]!,
    };
  }

  public pageAt(entry: number): number {
    return this.pageOf[entry]!;
  }

  public pageCountAt(entry: number): number {
    return this.pageCountOf[entry]!;
  }

  public pageFieldsAt(entry: number): number {
    return this.pageFieldsOf[entry]!;
  }

  public sectionAt(entry: number): number {
    return this.sectionOf[entry]!;
  }

  public sectionCountAt(entry: number): number {
    return this.sectionCountOf[entry]!;
  }

  public sectionFieldsAt(entry: number): number {
    return this.sectionFieldsOf[entry]!;
  }

  // The entry of `term` for page `page`, or -1.
  public pageEntryOf(term: string, page: number): number {
    const run: DocsTermRun = this.runOf(term);

    return DocsIndexPostings.find(this.pageOf, run.pageFrom, run.pageTo, page);
  }

  // The entry of `term` for section `section`, or -1.
  public sectionEntryOf(term: string, section: number): number {
    const run: DocsTermRun = this.runOf(term);

    return DocsIndexPostings.find(
      this.sectionOf,
      run.sectionFrom,
      run.sectionTo,
      section,
    );
  }

  // The first place from `from` up to `to` whose number is `number` or more.
  public static firstFrom(
    numbers: DocsUints,
    from: number,
    to: number,
    number: number,
  ): number {
    let low: number = from;
    let high: number = to;

    while (low < high) {
      const middle: number = (low + high) >>> 1;

      if (numbers[middle]! < number) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    return low;
  }

  private static find(
    numbers: DocsUints,
    from: number,
    to: number,
    number: number,
  ): number {
    const at: number = DocsIndexPostings.firstFrom(numbers, from, to, number);

    return at < to && numbers[at] === number ? at : -1;
  }

  public pageNumbers(): DocsUints {
    return this.pageOf;
  }

  public sectionNumbers(): DocsUints {
    return this.sectionOf;
  }
}

// Where one word's entries are: pages' from pageFrom up to pageTo, and sections'.
export interface DocsTermRun {
  pageFrom: number;
  pageTo: number;
  sectionFrom: number;
  sectionTo: number;
}

/*
 * One word's entries, read as a search goes through the pages and their
 * sections in order: each question about a page or a section moves on from
 * the last one asked, so a word is read once a search, however many pages
 * and sections ask about it. Asked about an earlier one, it looks back.
 */
export class DocsTermReader {
  public readonly term: string;
  private readonly postings: DocsIndexPostings;
  private readonly pageFrom: number;
  private readonly pageTo: number;
  private readonly sectionFrom: number;
  private readonly sectionTo: number;
  private pageAt: number;
  private sectionAt: number;

  public constructor(postings: DocsIndexPostings, term: string) {
    const run: DocsTermRun = postings.runOf(term);

    this.term = term;
    this.postings = postings;
    this.pageFrom = run.pageFrom;
    this.pageTo = run.pageTo;
    this.sectionFrom = run.sectionFrom;
    this.sectionTo = run.sectionTo;
    this.pageAt = run.pageFrom;
    this.sectionAt = run.sectionFrom;
  }

  // Whether any page or section holds the word.
  public get isHeld(): boolean {
    return this.pageTo > this.pageFrom || this.sectionTo > this.sectionFrom;
  }

  // How many times page `page`'s body says the word.
  public bodyCount(page: number): number {
    const entry: number = this.pageEntry(page);

    return entry < 0 ? 0 : this.postings.pageCountAt(entry);
  }

  // Where else page `page` holds the word (IN_PAGE_* bits; 0 for nowhere).
  public pageFields(page: number): number {
    const entry: number = this.pageEntry(page);

    return entry < 0 ? 0 : this.postings.pageFieldsAt(entry);
  }

  // How many times section `section`'s text says the word.
  public sectionCount(section: number): number {
    const entry: number = this.sectionEntry(section);

    return entry < 0 ? 0 : this.postings.sectionCountAt(entry);
  }

  // Whether section `section`'s heading holds the word (IN_SECTION_TITLE; 0 for no).
  public sectionFields(section: number): number {
    const entry: number = this.sectionEntry(section);

    return entry < 0 ? 0 : this.postings.sectionFieldsAt(entry);
  }

  private pageEntry(page: number): number {
    const pages: DocsUints = this.postings.pageNumbers();

    if (this.pageAt > this.pageFrom && pages[this.pageAt - 1]! >= page) {
      this.pageAt = DocsIndexPostings.firstFrom(
        pages,
        this.pageFrom,
        this.pageAt,
        page,
      );
    }

    while (this.pageAt < this.pageTo && pages[this.pageAt]! < page) {
      this.pageAt++;
    }

    return this.pageAt < this.pageTo && pages[this.pageAt] === page
      ? this.pageAt
      : -1;
  }

  private sectionEntry(section: number): number {
    const sections: DocsUints = this.postings.sectionNumbers();

    if (
      this.sectionAt > this.sectionFrom &&
      sections[this.sectionAt - 1]! >= section
    ) {
      this.sectionAt = DocsIndexPostings.firstFrom(
        sections,
        this.sectionFrom,
        this.sectionAt,
        section,
      );
    }

    while (
      this.sectionAt < this.sectionTo &&
      sections[this.sectionAt]! < section
    ) {
      this.sectionAt++;
    }

    return this.sectionAt < this.sectionTo &&
      sections[this.sectionAt] === section
      ? this.sectionAt
      : -1;
  }
}

// A page's title, group, summary or headings, as a set of words (IN_PAGE_*).
class PageFieldTerms implements DocsTermSet {
  public constructor(
    private readonly postings: DocsIndexPostings,
    private readonly page: number,
    private readonly field: number,
  ) {}

  public has(term: string): boolean {
    const entry: number = this.postings.pageEntryOf(term, this.page);

    return entry >= 0 && (this.postings.pageFieldsAt(entry) & this.field) !== 0;
  }
}

// A page's body, as its words with how many times it says each.
class PageBodyTerms implements DocsTermCounts {
  public constructor(
    private readonly postings: DocsIndexPostings,
    private readonly page: number,
  ) {}

  public get(term: string): number | undefined {
    const entry: number = this.postings.pageEntryOf(term, this.page);
    const count: number = entry < 0 ? 0 : this.postings.pageCountAt(entry);

    return count > 0 ? count : undefined;
  }

  public has(term: string): boolean {
    return this.get(term) !== undefined;
  }
}

// A section's heading, as a set of words.
class SectionTitleTerms implements DocsTermSet {
  public constructor(
    private readonly postings: DocsIndexPostings,
    private readonly section: number,
  ) {}

  public has(term: string): boolean {
    const entry: number = this.postings.sectionEntryOf(term, this.section);

    return (
      entry >= 0 &&
      (this.postings.sectionFieldsAt(entry) & IN_SECTION_TITLE) !== 0
    );
  }
}

// A section's text, as its words with how many times it says each.
class SectionTextTerms implements DocsTermCounts {
  public constructor(
    private readonly postings: DocsIndexPostings,
    private readonly section: number,
  ) {}

  public get(term: string): number | undefined {
    const entry: number = this.postings.sectionEntryOf(term, this.section);
    const count: number = entry < 0 ? 0 : this.postings.sectionCountAt(entry);

    return count > 0 ? count : undefined;
  }

  public has(term: string): boolean {
    return this.get(term) !== undefined;
  }
}

// How many pages hold each word, as the vocabulary counts them.
class PagesHoldingEachWord implements DocsTermCounts {
  public constructor(private readonly vocabulary: DocsVocabulary) {}

  public get(term: string): number | undefined {
    const pages: number = this.vocabulary.pagesHolding(term);

    return pages > 0 ? pages : undefined;
  }

  public has(term: string): boolean {
    return this.vocabulary.has(term);
  }
}

/*
 * The index's entries, once it is built: pages and sections are made
 * while their entries are still being gathered, and read them after.
 */
class DocsIndexEntries {
  public postings: DocsIndexPostings | null = null;

  public get(): DocsIndexPostings {
    if (!this.postings) {
      throw new Error("The docs index is still being built.");
    }

    return this.postings;
  }
}

class DocsIndexedSection implements AIDocsIndexedSection {
  public constructor(
    private readonly entries: DocsIndexEntries,
    public readonly number: number,
    public readonly title: string,
    public readonly anchor: string,
    public readonly text: string,
    public readonly phrase: string,
    public readonly wordCount: number,
    public readonly isOtherName: boolean,
  ) {}

  public get terms(): DocsTermCounts {
    return new SectionTextTerms(this.entries.get(), this.number);
  }

  public get titleTerms(): DocsTermSet {
    return new SectionTitleTerms(this.entries.get(), this.number);
  }
}

class DocsIndexedPage implements AIDocsIndexedPage {
  public constructor(
    private readonly entries: DocsIndexEntries,
    public readonly number: number,
    public readonly page: string,
    public readonly title: string,
    public readonly group: string,
    public readonly summary: string,
    public readonly language: string,
    public readonly bodyLength: number,
    public readonly sections: ReadonlyArray<AIDocsIndexedSection>,
    public readonly isGuide: boolean,
  ) {}

  public get titleTerms(): DocsTermSet {
    return new PageFieldTerms(this.entries.get(), this.number, IN_PAGE_TITLE);
  }

  public get groupTerms(): DocsTermSet {
    return new PageFieldTerms(this.entries.get(), this.number, IN_PAGE_GROUP);
  }

  public get summaryTerms(): DocsTermSet {
    return new PageFieldTerms(this.entries.get(), this.number, IN_PAGE_SUMMARY);
  }

  public get headingTerms(): DocsTermSet {
    return new PageFieldTerms(
      this.entries.get(),
      this.number,
      IN_PAGE_HEADINGS,
    );
  }

  public get bodyTerms(): DocsTermCounts {
    return new PageBodyTerms(this.entries.get(), this.number);
  }
}

/*
 * Builds a language's index from its pages, one page at a time: each
 * page's words become entries as it is added, numbered by when the word
 * was first met, so a page's own Maps and Sets are let go as soon as the
 * next page comes. Once every page is in, the words are sorted and each
 * entry is laid out under its word's place (build).
 */
export class DocsIndexBuilder {
  private readonly language: string;
  private readonly entries: DocsIndexEntries = new DocsIndexEntries();
  private readonly pages: Array<AIDocsIndexedPage> = [];
  private sectionCount: number = 0;
  private bodyLengths: number = 0;
  // Each word met, by the number it was met as, and that number by the word.
  private readonly met: Map<string, number> = new Map();
  private readonly words: Array<string> = [];
  // How many pages hold each word met (the pages that make up its documentFrequency).
  private readonly pagesHolding: Array<number> = [];
  // [word met, page, count in the body, IN_PAGE_* bits] for each page's each word.
  private readonly pageEntries: GrowingUints = new GrowingUints();
  // [word met, section, count in the text, IN_SECTION_TITLE] for each section's each word.
  private readonly sectionEntries: GrowingUints = new GrowingUints();
  private largestCount: number = 0;

  public constructor(language: string) {
    this.language = language;
  }

  public addPage(input: DocsIndexPageInput): void {
    const number: number = this.pages.length;
    const fields: Map<string, number> = new Map();
    const mark: (terms: ReadonlySet<string>, field: number) => void = (
      terms: ReadonlySet<string>,
      field: number,
    ): void => {
      for (const term of terms) {
        fields.set(term, (fields.get(term) || 0) | field);
      }
    };

    mark(input.titleTerms, IN_PAGE_TITLE);
    mark(input.groupTerms, IN_PAGE_GROUP);
    mark(input.summaryTerms, IN_PAGE_SUMMARY);
    mark(input.headingTerms, IN_PAGE_HEADINGS);

    for (const term of input.bodyTerms.keys()) {
      if (!fields.has(term)) {
        fields.set(term, 0);
      }
    }

    for (const [term, field] of fields) {
      this.addEntry(
        this.pageEntries,
        this.meet(term),
        number,
        input.bodyTerms.get(term) || 0,
        field,
      );
    }

    /*
     * The pages that hold a word: its title, headings, summary or body, or
     * one of the Glossary's other names on it - not its nav group, which a
     * page shares with the others of its group.
     */
    const held: Set<string> = new Set<string>([
      ...input.titleTerms,
      ...input.headingTerms,
      ...input.summaryTerms,
      ...input.bodyTerms.keys(),
    ]);

    for (const section of input.sections) {
      if (section.isOtherName) {
        for (const term of section.titleTerms) {
          held.add(term);
        }
      }
    }

    for (const term of held) {
      this.pagesHolding[this.meet(term)]!++;
    }

    const sections: Array<AIDocsIndexedSection> = input.sections.map(
      (section: DocsIndexSectionInput): AIDocsIndexedSection => {
        return this.addSection(section);
      },
    );

    this.bodyLengths += input.bodyLength;
    this.pages.push(
      new DocsIndexedPage(
        this.entries,
        number,
        ownCopy(input.page),
        ownCopy(input.title),
        ownCopy(input.group),
        ownCopy(input.summary),
        ownCopy(input.language),
        input.bodyLength,
        sections,
        input.isGuide,
      ),
    );
  }

  public build(): AIDocsLanguageIndex {
    // The words in sorted order: a word's number in the index is its place there.
    const order: Array<number> = this.words
      .map((_word: string, met: number): number => {
        return met;
      })
      .sort((a: number, b: number): number => {
        const left: string = this.words[a]!;
        const right: string = this.words[b]!;

        if (left < right) {
          return -1;
        }

        return left > right ? 1 : 0;
      });
    const placeOf: Uint32Array = new Uint32Array(this.words.length);
    const sorted: Array<string> = [];
    const pageCounts: Uint32Array = new Uint32Array(this.words.length);

    order.forEach((met: number, place: number): void => {
      placeOf[met] = place;
      sorted.push(this.words[met]!);
      pageCounts[place] = this.pagesHolding[met]!;
    });

    const vocabulary: DocsVocabulary = new DocsVocabulary({
      sorted,
      pageCounts: DocsIndexBuilder.narrowed(pageCounts),
    });
    const pages: LaidOut = this.layOut(
      this.pageEntries,
      placeOf,
      this.pages.length,
    );
    const sections: LaidOut = this.layOut(
      this.sectionEntries,
      placeOf,
      this.sectionCount,
    );
    const postings: DocsIndexPostings = new DocsIndexPostings({
      vocabulary,
      pageStart: pages.start,
      pageOf: pages.of,
      pageCountOf: pages.counts,
      pageFieldsOf: pages.fields,
      sectionStart: sections.start,
      sectionOf: sections.of,
      sectionCountOf: sections.counts,
      sectionFieldsOf: sections.fields,
    });

    this.entries.postings = postings;

    return {
      language: this.language,
      pages: this.pages,
      documentFrequency: new PagesHoldingEachWord(vocabulary),
      averageBodyLength: this.bodyLengths / Math.max(1, this.pages.length),
      vocabulary,
      postings,
    };
  }

  private addSection(section: DocsIndexSectionInput): AIDocsIndexedSection {
    const number: number = this.sectionCount++;
    const fields: Map<string, number> = new Map();
    let wordCount: number = 0;

    for (const term of section.titleTerms) {
      fields.set(term, IN_SECTION_TITLE);
    }

    for (const [term, count] of section.terms) {
      wordCount += count;

      if (!fields.has(term)) {
        fields.set(term, 0);
      }
    }

    for (const [term, field] of fields) {
      this.addEntry(
        this.sectionEntries,
        this.meet(term),
        number,
        section.terms.get(term) || 0,
        field,
      );
    }

    return new DocsIndexedSection(
      this.entries,
      number,
      ownCopy(section.title),
      ownCopy(section.anchor),
      ownCopy(section.text),
      ownCopy(docsPhraseOf(`${section.title} ${section.text}`)),
      wordCount,
      section.isOtherName === true,
    );
  }

  private addEntry(
    entries: GrowingUints,
    word: number,
    at: number,
    count: number,
    fields: number,
  ): void {
    entries.push(word);
    entries.push(at);
    entries.push(count);
    entries.push(fields);
    this.largestCount = Math.max(this.largestCount, count);
  }

  // The number `term` was first met as: a new one for a word not met before.
  private meet(term: string): number {
    const known: number | undefined = this.met.get(term);

    if (known !== undefined) {
      return known;
    }

    const number: number = this.words.length;

    this.met.set(term, number);
    this.words.push(ownCopy(term));
    this.pagesHolding.push(0);

    return number;
  }

  /*
   * The entries gathered, laid out under each word's place: the entries
   * of a word come one after another, in the order they were added - page
   * by page, section by section - so each run is in order.
   */
  private layOut(
    gathered: GrowingUints,
    placeOf: Uint32Array,
    units: number,
  ): LaidOut {
    const total: number = gathered.length / 4;
    const start: Uint32Array = new Uint32Array(placeOf.length + 1);

    for (let entry: number = 0; entry < total; entry++) {
      start[placeOf[gathered.at(entry * 4)]! + 1]!++;
    }

    for (let place: number = 0; place < placeOf.length; place++) {
      start[place + 1]! += start[place]!;
    }

    const next: Uint32Array = start.slice(0, placeOf.length);
    const of: DocsUints = narrowest(total, Math.max(0, units - 1));
    const counts: DocsUints = narrowest(total, this.largestCount);
    const fields: Uint8Array = new Uint8Array(total);

    for (let entry: number = 0; entry < total; entry++) {
      const at: number = next[placeOf[gathered.at(entry * 4)]!]!++;

      of[at] = gathered.at(entry * 4 + 1);
      counts[at] = gathered.at(entry * 4 + 2);
      fields[at] = gathered.at(entry * 4 + 3);
    }

    return { start, of, counts, fields };
  }

  private static narrowed(numbers: Uint32Array): DocsUints {
    let largest: number = 0;

    for (const value of numbers) {
      largest = Math.max(largest, value);
    }

    const narrow: DocsUints = narrowest(numbers.length, largest);

    narrow.set(numbers);

    return narrow;
  }
}

interface LaidOut {
  start: Uint32Array;
  of: DocsUints;
  counts: DocsUints;
  fields: Uint8Array;
}
