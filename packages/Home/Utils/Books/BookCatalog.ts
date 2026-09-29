/*
 * The books on /books.
 *
 * The landing page is rendered from this catalog, so it never waits on the
 * book's own website. The in-page reader loads the full text separately from
 * the book's official EPUB (see BookStore.ts), and the section ids below are
 * the ids that EPUB produces (see sectionIdForPath in Epub.ts), which is what
 * lets a contents entry on the page open the reader at that chapter.
 */

export interface BookChapter {
  // The reader section this chapter opens at, e.g. "m01".
  sectionId: string;
  title: string;
  // The chapter on the book's own website: the no-JavaScript fallback.
  webUrl: string;
}

export interface BookMove extends BookChapter {
  number: string;
}

export interface BookStage {
  number: number;
  name: string;
  summary: string;
  doneWhen: string;
  moves: Array<BookMove>;
}

export interface BookFact {
  value: string;
  label: string;
}

export interface BookExcerpt {
  heading: string;
  paragraphs: Array<string>;
  source: BookChapter;
}

export interface BookDefinition {
  slug: string;
  title: string;
  titleLead: string;
  titleAccent: string;
  subtitle: string;
  author: string;
  publisher: string;
  language: string;
  description: string;
  collectionNumber: string;
  siteUrl: string;
  epubUrl: string;
  pdfUrl: string;
  sourceUrl: string;
  aboutUrl: string;
  license: { name: string; url: string };
  coverPath: string;
  coverWidth: number;
  coverHeight: number;
  // Where the reader fetches the book's text from on this site.
  contentPath: string;
  facts: Array<BookFact>;
  excerpt: BookExcerpt;
  frontMatter: Array<BookChapter>;
  stages: Array<BookStage>;
  backMatter: Array<BookChapter>;
}

const BACK_TO_METAL_SITE: string = "https://backtometal.oneuptime.com/";

const move: (number: string, title: string, webSlug: string) => BookMove = (
  number: string,
  title: string,
  webSlug: string,
): BookMove => {
  return {
    number,
    title,
    sectionId: `m${number}`,
    webUrl: `${BACK_TO_METAL_SITE}m/${number}-${webSlug}.html`,
  };
};

export const BackToMetal: BookDefinition = {
  slug: "back-to-metal",
  title: "Back to Metal",
  titleLead: "Back to",
  titleAccent: "Metal",
  subtitle: "How a company leaves the cloud, one move at a time",
  author: "Nawaz Dhandala",
  publisher: "HackerBay, Inc.",
  language: "en",
  description:
    "A practical guide to moving from AWS, Google Cloud, or Azure to dedicated servers you rent or own.",
  collectionNumber: "001",
  siteUrl: BACK_TO_METAL_SITE,
  epubUrl: `${BACK_TO_METAL_SITE}Back-to-Metal.epub`,
  pdfUrl: `${BACK_TO_METAL_SITE}Back-to-Metal.pdf`,
  sourceUrl: "https://github.com/OneUptime/back-to-metal",
  aboutUrl: `${BACK_TO_METAL_SITE}about.html`,
  license: {
    name: "CC BY 4.0",
    url: "https://creativecommons.org/licenses/by/4.0/",
  },
  coverPath: "/img/books/back-to-metal.jpg",
  coverWidth: 1600,
  coverHeight: 2560,
  contentPath: "/books/back-to-metal/content.json",
  facts: [
    { value: "20", label: "practical moves" },
    { value: "5", label: "stages, run in order" },
    { value: "3", label: "clouds: AWS, Google Cloud, Azure" },
    { value: "Free", label: "to read, share and adapt" },
  ],
  excerpt: {
    heading: "You are allowed to run your own computers",
    paragraphs: [
      "A generation of engineers has now been trained to believe that owning a server is a kind of professional failure. It is not. It is a trade, and like every trade it has terms.",
      "What has been missing is not the argument. It is a plan short enough to finish.",
    ],
    source: {
      sectionId: "why",
      title: "Why this book exists",
      webUrl: `${BACK_TO_METAL_SITE}about.html`,
    },
  },
  frontMatter: [
    {
      sectionId: "why",
      title: "Why this book exists",
      webUrl: `${BACK_TO_METAL_SITE}about.html`,
    },
    {
      sectionId: "decision",
      title: "Why leave at all",
      webUrl: `${BACK_TO_METAL_SITE}#why`,
    },
    {
      sectionId: "costs",
      title: "What it costs",
      webUrl: `${BACK_TO_METAL_SITE}cost.html`,
    },
    {
      sectionId: "rollback",
      title: "Before you touch anything",
      webUrl: `${BACK_TO_METAL_SITE}start.html`,
    },
    {
      sectionId: "kit",
      title: "The reference build",
      webUrl: BACK_TO_METAL_SITE,
    },
    {
      sectionId: "replaces",
      title: "What replaces what",
      webUrl: BACK_TO_METAL_SITE,
    },
  ],
  stages: [
    {
      number: 1,
      name: "Decide",
      summary: "Work out whether to do it at all",
      doneWhen:
        "You know what you spend, what you would spend instead, and whether it is worth it.",
      moves: [
        move(
          "01",
          "The bill, and the three lines that are most of it",
          "the-bill-and-the-three-lines-that-are-most-of-it",
        ),
        move("02", "What you actually run", "what-you-actually-run"),
        move("03", "The number that decides it", "the-number-that-decides-it"),
        move(
          "04",
          "The three things you keep renting",
          "the-three-things-you-keep-renting",
        ),
      ],
    },
    {
      number: 2,
      name: "Buy",
      summary: "Order the hardware and sign the space",
      doneWhen: "The machines are on order and the cage is signed.",
      moves: [
        move(
          "05",
          "From rented vCPUs to cores you own",
          "from-rented-vcpus-to-cores-you-own",
        ),
        move(
          "06",
          "Sixteen machines, and the two on the shelf",
          "sixteen-machines-and-the-two-on-the-shelf",
        ),
        move("07", "A cage, not a data centre", "a-cage-not-a-data-centre"),
        move(
          "08",
          "The order, and the weeks you cannot compress",
          "the-order-and-the-weeks-you-cannot-compress",
        ),
      ],
    },
    {
      number: 3,
      name: "Build",
      summary: "Turn the boxes into a cluster",
      doneWhen: "A cluster that could take production traffic, and never has.",
      moves: [
        move("09", "Racking day", "racking-day"),
        move(
          "10",
          "The network, and the way back in when it breaks",
          "the-network-and-the-way-back-in-when-it-breaks",
        ),
        move(
          "11",
          "The platform your workloads need",
          "the-platform-your-workloads-need",
        ),
        move(
          "12",
          "Disks: what goes local, what goes on Ceph",
          "disks-what-goes-local-what-goes-on-ceph",
        ),
      ],
    },
    {
      number: 4,
      name: "Move",
      summary: "Move the app, then the data",
      doneWhen:
        "Everything runs on your machines, and the cloud copy is still warm.",
      moves: [
        move(
          "13",
          "Images, secrets and one-command deploys",
          "images-secrets-and-one-command-deploys",
        ),
        move(
          "14",
          "The first service, end to end",
          "the-first-service-end-to-end",
        ),
        move("15", "Buckets, cache and queues", "buckets-cache-and-queues"),
        move(
          "16",
          "Postgres, the one that matters",
          "postgres-the-one-that-matters",
        ),
      ],
    },
    {
      number: 5,
      name: "Run",
      summary: "Cut the traffic over, and keep it alive",
      doneWhen:
        "Users reach your machines, you can carry it at 03:00, and the cloud bill is zero.",
      moves: [
        move("17", "The front door", "the-front-door"),
        move("18", "Go-live, and how you abort", "go-live-and-how-you-abort"),
        move(
          "19",
          "Backups you have restored, and the pager",
          "backups-you-have-restored-and-the-pager",
        ),
        move("20", "Closing the account", "closing-the-account"),
      ],
    },
  ],
  backMatter: [
    {
      sectionId: "worksheets",
      title: "Operator worksheets",
      webUrl: BACK_TO_METAL_SITE,
    },
  ],
};

export const Books: Array<BookDefinition> = [BackToMetal];

export const getBookBySlug: (slug: string) => BookDefinition | undefined = (
  slug: string,
): BookDefinition | undefined => {
  return Books.find((book: BookDefinition): boolean => {
    return book.slug === slug;
  });
};
