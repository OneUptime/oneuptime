// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import {
  SETUP_GUIDE_DOCUMENTATION_PRODUCTS,
  SetupGuideDocumentationProduct,
} from "../../Helpers/SetupGuideDocumentationProducts";

/*
 * EVERY PRODUCT'S HELP > DOCUMENTATION PAGE, IN THE READER'S LANGUAGE (#8341).
 *
 * Each product's Help > Documentation page reaches its reader in their
 * language one of three ways:
 *
 * - one Markdown text per language (DocumentationInReadersLanguage), as
 *   Data Observability's page is;
 * - a setup guide whose markdown each language has its words for
 *   (SetupGuideTranslation), as Docker's and Podman's are - their parity in
 *   every language is SetupGuideDocumentationInLocale's;
 * - a page whose every sentence is a key of the locale files, worded in
 *   every language - checked here, string by string.
 *
 * A product whose page still reads English in some language is listed in
 * STILL_IN_ENGLISH, and the list may only shrink: a new product's page
 * has to be one of the three ways from its first day.
 */

const DASHBOARD_SOURCE: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

type Way = "a text per language" | "a setup guide's words" | "locale keys";

interface PageReading {
  way: Way;
  // For "locale keys": every file whose sentences the page draws.
  files?: ReadonlyArray<string> | undefined;
}

// The telemetry products' pages: one component, its guides and key step.
const TELEMETRY_FILES: ReadonlyArray<string> = [
  "Components/Telemetry/Documentation.tsx",
  "Components/Telemetry/CompatibleIngestGuide.ts",
  "Components/Telemetry/IngestionKeySelector.tsx",
  "Components/Telemetry/FrameworkGuideLinks.tsx",
];

const PAGES: Readonly<Record<string, PageReading>> = {
  DataObservability: { way: "a text per language" },
  Docker: { way: "a setup guide's words" },
  Podman: { way: "a setup guide's words" },
  Proxmox: { way: "a setup guide's words" },
  StorageArray: { way: "a setup guide's words" },
  Kubernetes: { way: "a setup guide's words" },
  IoT: { way: "a setup guide's words" },
  Ceph: { way: "a setup guide's words" },
  DockerSwarm: { way: "a setup guide's words" },
  OpenStack: { way: "a setup guide's words" },
  VMware: { way: "a setup guide's words" },
  Database: { way: "a setup guide's words" },
  Host: { way: "a setup guide's words" },
  MessageQueue: { way: "a setup guide's words" },
  DataSecurity: {
    way: "locale keys",
    files: ["Pages/DataSecurity/Documentation.tsx"],
  },
  /*
   * The page, and the catalog it draws: the sources a row comes from, what
   * deleting one does, the categories and every kind of thing in them.
   */
  Inventory: {
    way: "locale keys",
    files: [
      "Pages/Inventory/Documentation.tsx",
      "Components/Inventory/InventorySource.ts",
      "Components/Inventory/InventoryTypeCatalog.ts",
    ],
  },
  Exceptions: { way: "locale keys", files: TELEMETRY_FILES },
  Logs: { way: "locale keys", files: TELEMETRY_FILES },
  Metrics: { way: "locale keys", files: TELEMETRY_FILES },
  Traces: { way: "locale keys", files: TELEMETRY_FILES },
  Profiles: { way: "locale keys", files: TELEMETRY_FILES },
  SecurityEvents: {
    way: "locale keys",
    files: [
      "Components/SecurityEvents/SecurityEventsSetupGuide.tsx",
      "Components/Telemetry/IngestionKeySelector.tsx",
    ],
  },
};

/*
 * The pages that still read English in some language: their setup guide's
 * markdown has no words in any other language yet. #8341. Only ever
 * shorter, and empty since the Queues guide (MessageQueue) has its words:
 * a new product's page reads one of the three ways from its first day.
 */
const STILL_IN_ENGLISH: ReadonlyArray<string> = [];

// Every product that has a Help > Documentation page.
function productsWithADocumentationPage(): Array<string> {
  return fs
    .readdirSync(path.join(DASHBOARD_SOURCE, "Pages"))
    .filter((product: string): boolean => {
      return fs.existsSync(
        path.join(DASHBOARD_SOURCE, "Pages", product, "Documentation.tsx"),
      );
    })
    .sort();
}

// Words, not a code or a sign: two Latin letters in a row.
const TWO_LETTERS: RegExp = /[A-Za-z]{2}/;

// Two English words: a sentence, not a name.
const TWO_WORDS: RegExp = /[A-Za-z]{3} [A-Za-z]{3}/;

const LITERAL: string = '"((?:[^"\\\\\\n]|\\\\.)*)"';

/*
 * What a file hands the translator to word, or a shared component to word
 * for it: a translate*() call's text, a TranslatedSentence's template, and
 * a title, description, summary, label or text prop or field.
 */
const HANDED_TO_THE_TRANSLATOR: ReadonlyArray<RegExp> = [
  new RegExp(
    `(?:translateText|translateTemplate|translationKey|translate)\\(\\s*${LITERAL}`,
    "g",
  ),
  new RegExp(`template=${LITERAL}`, "g"),
  new RegExp(`(?:title|description|summary|label|text)=${LITERAL}`, "g"),
  new RegExp(`(?:title|description|summary|label):\\s*${LITERAL}`, "g"),
];

function sentencesOf(file: string): Array<string> {
  const source: string = fs.readFileSync(
    path.join(DASHBOARD_SOURCE, file),
    "utf8",
  );
  const sentences: Set<string> = new Set<string>();

  for (const pattern of HANDED_TO_THE_TRANSLATOR) {
    for (const match of source.matchAll(pattern)) {
      const text: string = JSON.parse(`"${match[1]}"`) as string;

      // Words, not a code or a name: a key of the locale files.
      if (TWO_LETTERS.test(text) && readDashboardLocale("en")[text]) {
        sentences.add(text);
      }
    }
  }

  return [...sentences].sort();
}

describe("every product's Help > Documentation page", () => {
  test("is read one of the three ways, or is listed as still in English", () => {
    expect(productsWithADocumentationPage()).toEqual(
      [...Object.keys(PAGES), ...STILL_IN_ENGLISH].sort(),
    );

    for (const product of STILL_IN_ENGLISH) {
      expect(PAGES[product]).toBeUndefined();
    }
  });

  test("a text per language: the page draws DocumentationInReadersLanguage", () => {
    for (const [product, reading] of Object.entries(PAGES)) {
      if (reading.way !== "a text per language") {
        continue;
      }

      const page: string = fs.readFileSync(
        path.join(DASHBOARD_SOURCE, "Pages", product, "Documentation.tsx"),
        "utf8",
      );

      expect({
        product,
        draws: page.includes("<DocumentationInReadersLanguage"),
      }).toEqual({
        product,
        draws: true,
      });
    }
  });

  test("a setup guide's words: the page draws the product's card, and the card hands the guide its words in every language", () => {
    // A guide drawn on another page (RUM's, on each application) has no Help page.
    const guides: Array<string> = SETUP_GUIDE_DOCUMENTATION_PRODUCTS.filter(
      (product: SetupGuideDocumentationProduct): boolean => {
        return product.isHelpDocumentationPage;
      },
    ).map((product: SetupGuideDocumentationProduct): string => {
      return product.name;
    });

    expect(
      Object.entries(PAGES)
        .filter(([, reading]: [string, PageReading]): boolean => {
          return reading.way === "a setup guide's words";
        })
        .map(([product]: [string, PageReading]): string => {
          return product;
        })
        .sort(),
    ).toEqual([...guides].sort());

    for (const product of SETUP_GUIDE_DOCUMENTATION_PRODUCTS) {
      const pageFile: string = product.documentationPage;
      const page: string = fs.readFileSync(pageFile, "utf8");
      // The files the page imports, by relative path ("./Utils/Card").
      const imported: Array<string> = [
        ...page.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g),
      ].map((match: RegExpMatchArray): string => {
        return path.resolve(path.dirname(pageFile), match[1] as string);
      });

      expect({
        product: product.name,
        drawsItsCard: imported.includes(product.cardFile.replace(/\.tsx$/, "")),
      }).toEqual({ product: product.name, drawsItsCard: true });
      expect(Object.keys(product.translations).length).toBe(
        DASHBOARD_LANGUAGES.length,
      );
    }
  });

  test("locale keys: every sentence the page draws is worded in every language", () => {
    for (const [product, reading] of Object.entries(PAGES)) {
      if (reading.way !== "locale keys") {
        continue;
      }

      const sentences: Array<string> = (reading.files || []).flatMap(
        sentencesOf,
      );

      expect({ product, sentences: sentences.length > 2 }).toEqual({
        product,
        sentences: true,
      });

      for (const language of DASHBOARD_LANGUAGES) {
        const notWorded: Array<string> = sentences.filter(
          (sentence: string): boolean => {
            return !isWordedInDashboardLocale(sentence, language);
          },
        );

        expect({ product, language, notWorded }).toEqual({
          product,
          language,
          notWorded: [],
        });
      }
    }
  });

  test("a page still in English is not yet a setup guide with words of its own: done, it leaves the list", () => {
    const guides: Array<string> = SETUP_GUIDE_DOCUMENTATION_PRODUCTS.map(
      (product: SetupGuideDocumentationProduct): string => {
        return product.name;
      },
    );

    for (const product of STILL_IN_ENGLISH) {
      expect({ product, done: guides.includes(product) }).toEqual({
        product,
        done: false,
      });
      expect({
        product,
        hasWords: fs.existsSync(
          path.join(
            DASHBOARD_SOURCE,
            "Pages",
            product,
            "DocumentationTranslations",
          ),
        ),
      }).toEqual({ product, hasWords: false });
    }
  });
});

describe("the checks above (negative control)", () => {
  test("a sentence a language still reads in English is found", () => {
    const english: Record<string, string> = readDashboardLocale("en");
    const sentence: string | undefined = Object.keys(english).find(
      (key: string): boolean => {
        return TWO_WORDS.test(key) && !isWordedInDashboardLocale(key, "it");
      },
    );

    // Some key is always still English in some language while #8341 is open.
    expect(sentence).toBeDefined();
    expect(isWordedInDashboardLocale(sentence!, "it")).toBe(false);
  });

  test("the scan finds what a page hands the translator", () => {
    expect(sentencesOf("Pages/DataSecurity/Documentation.tsx")).toContain(
      "What is Data Security?",
    );
  });

  test("the scan finds what a catalog marks as a key: Inventory's caveats and categories", () => {
    expect(sentencesOf("Components/Inventory/InventorySource.ts")).toEqual(
      expect.arrayContaining([
        "Discovered",
        "This item was discovered from telemetry. Deleting it clears it from the list, but it will be re-created the next time it sends data.",
        "This item's source is unknown to this version of OneUptime. Deleting it may not be permanent.",
      ]),
    );
    expect(sentencesOf("Components/Inventory/InventoryTypeCatalog.ts")).toEqual(
      expect.arrayContaining(["Network & Devices", "A Ceph storage cluster."]),
    );
  });
});
