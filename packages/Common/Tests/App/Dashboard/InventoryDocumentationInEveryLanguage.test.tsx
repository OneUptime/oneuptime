import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import InventoryDocumentation from "../../../../App/FeatureSet/Dashboard/src/Pages/Inventory/Documentation";
import {
  INVENTORY_SOURCE_ORDER,
  InventorySourceDescriptor,
  getInventoryDeleteCaveat,
  getInventorySourceDescriptor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventorySource";
import {
  INVENTORY_CATEGORY_NAMES,
  INVENTORY_CATEGORY_ORDER,
  InventoryCategory,
  InventoryTypeDescriptor,
  buildInventoryBreakdown,
  getEntityTypesInCategory,
  getInventoryTypeDescriptor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryTypeCatalog";
import {
  INVENTORY_LIVE_WINDOW_MINUTES,
  INVENTORY_STALE_AFTER_MINUTES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryLiveness";
import Alert, { AlertType } from "../../../UI/Components/Alerts/Alert";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import EntityType from "../../../Types/Telemetry/EntityType";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
  readDashboardLocaleAsDrawn,
} from "../../Helpers/DashboardLocales";

/*
 * INVENTORY'S HELP > DOCUMENTATION, IN EVERY LANGUAGE (#8341).
 *
 * Inventory's page is worded by keys of the locale files: its own
 * sentences, and what it draws from the catalog - the three sources a row
 * comes from (Discovered, Mirrored, Added by you), what deleting one does,
 * the categories and every kind of thing in them. Eleven languages read
 * the whole page in English, and de, fr, es and ja the kinds added after
 * them (OpenStack, storage arrays). Two delete caveats and the "Network &
 * Devices" category were in no locale file at all: a descriptor's
 * deleteCaveat is not a field the i18n extractor reads, nor an enum's
 * values, so they read English in every language, on Help > Documentation
 * and on an item's Delete tab.
 *
 * Here every sentence the page draws - read from the catalog itself, not
 * from a list kept beside it - is a key worded in every language, with its
 * placeholders and the names and codes it says as written. The page is
 * drawn in English, German and Arabic (right to left): the reader's words
 * and no English sentence, the bold words of its sentences in the reader's
 * words. And the Delete tab's caveat reads in the reader's language.
 */

const DASHBOARD_SOURCE: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

const PAGE_FILE: string = "Pages/Inventory/Documentation.tsx";

const LITERAL: string = '"((?:[^"\\\\\\n]|\\\\.)*)"';

// What the page's own source hands the translator, as literals.
const PAGE_LITERALS: ReadonlyArray<RegExp> = [
  new RegExp(`(?:translateText|translateTemplate)\\(\\s*${LITERAL}`, "g"),
  new RegExp(`template=${LITERAL}`, "g"),
  new RegExp(`(?:title|description)=${LITERAL}`, "g"),
];

// The plural forms the liveness sentence draws its windows with.
const PLURAL_KEYS: ReadonlyArray<string> = [
  "{{count}} minutes",
  "{{count}} minutes_one",
  "{{count}} hours",
  "{{count}} hours_one",
];

// The title of the Delete tab's caveat.
const DELETE_CAVEAT_TITLE: string = "This may not be permanent";

function pageOwnSentences(): Array<string> {
  const source: string = fs.readFileSync(
    path.join(DASHBOARD_SOURCE, PAGE_FILE),
    "utf8",
  );
  const found: Set<string> = new Set<string>();

  for (const pattern of PAGE_LITERALS) {
    for (const match of source.matchAll(pattern)) {
      found.add(JSON.parse(`"${match[1]}"`) as string);
    }
  }

  return [...found];
}

function sourceDescriptors(): Array<InventorySourceDescriptor> {
  return INVENTORY_SOURCE_ORDER.map(
    (source: EntitySource): InventorySourceDescriptor => {
      return getInventorySourceDescriptor(source)!;
    },
  );
}

function listedTypes(): Array<InventoryTypeDescriptor> {
  return INVENTORY_CATEGORY_ORDER.flatMap(
    (category: InventoryCategory): Array<InventoryTypeDescriptor> => {
      return getEntityTypesInCategory(category).map(
        (entityType: string): InventoryTypeDescriptor => {
          return getInventoryTypeDescriptor(entityType)!;
        },
      );
    },
  );
}

// Every sentence the page draws, from its source and from the catalog.
function pageSentences(): Array<string> {
  const sentences: Set<string> = new Set<string>(pageOwnSentences());

  for (const descriptor of sourceDescriptors()) {
    sentences.add(descriptor.label);
    sentences.add(descriptor.description);

    if (descriptor.deleteCaveat) {
      sentences.add(descriptor.deleteCaveat);
    }
  }

  for (const category of INVENTORY_CATEGORY_ORDER) {
    sentences.add(INVENTORY_CATEGORY_NAMES[category]);
  }

  for (const descriptor of listedTypes()) {
    sentences.add(descriptor.label);
    sentences.add(descriptor.description);
  }

  for (const key of PLURAL_KEYS) {
    sentences.add(key);
  }

  return [...sentences].sort();
}

// A sentence, not a name: three words, one of them lower case.
const SENTENCE: RegExp = /\S+ \S+ \S+/;
const LOWER_CASE_WORD: RegExp = /(?:^|\s)\p{Ll}/u;

function isSentence(text: string): boolean {
  return SENTENCE.test(text) && LOWER_CASE_WORD.test(text);
}

// The words of a text between its placeholders, each long enough to find.
const PLACEHOLDER: RegExp = /\{\{\s*[\w.]+\s*\}\}/g;

function piecesOf(text: string): Array<string> {
  return text
    .split(PLACEHOLDER)
    .map((piece: string): string => {
      return piece.replace(/^[\s,.;:]+|[\s,;:]+$/g, "");
    })
    .filter((piece: string): boolean => {
      return piece.length >= 4;
    });
}

/*
 * An English clause no other language's sentence could hold by chance:
 * "past" could be part of a word, "is shown as" of a quoted name.
 */
function isLongEnough(piece: string): boolean {
  return piece.length >= 12;
}

/*
 * The names and codes a sentence says as written, in every language. Not
 * "URL", a word a language may say its own way: Persian's نشانی صفحه.
 */
const KEPT_AS_WRITTEN: ReadonlyArray<string> = [
  "OneUptime",
  "OpenTelemetry",
  "OpenStack",
  "Keystone",
  "Pure Storage",
  "FlashArray",
  "FlashBlade",
  "Docker",
  "Podman",
  "Kubernetes",
  "Proxmox",
  "VMware",
  "vCenter",
  "ESXi",
  "vSphere",
  "VMFS",
  "NFS",
  "vSAN",
  "Ceph",
  "Swarm",
  "SNMP",
  "IoT",
  "SDK",
  "API",
  "IP",
];

function namesIn(text: string): Array<string> {
  return KEPT_AS_WRITTEN.filter((name: string): boolean => {
    return new RegExp(`(?<![A-Za-z])${name}(?![A-Za-z])`).test(text);
  });
}

// The marks a sentence sets its values apart with, and the no-break spaces.
const DIRECTION_MARKS: RegExp = new RegExp(
  "[\\u200E\\u200F\\u2066-\\u2069]",
  "g",
);
const NO_BREAK_SPACES: RegExp = new RegExp("[\\u00A0\\u202F]", "g");

// What a reader reads: no isolate or direction marks, one kind of space.
function asRead(text: string): string {
  return text.replace(DIRECTION_MARKS, "").replace(NO_BREAK_SPACES, " ");
}

describe("every sentence Inventory's Help > Documentation draws", () => {
  test("is read from the page and the catalog: its own sentences, the sources, the categories and every kind", () => {
    const sentences: Array<string> = pageSentences();

    expect(pageOwnSentences().length).toBeGreaterThan(25);
    expect(sentences).toEqual(
      expect.arrayContaining([
        "What is Inventory?",
        "identity key",
        "Discovered",
        "Mirrored",
        "Added by you",
        "Network & Devices",
        "A Ceph storage cluster.",
        getInventoryDeleteCaveat(EntitySource.Discovered)!,
        getInventoryDeleteCaveat(EntitySource.Inventory)!,
      ]),
    );
    // Every kind the catalog files under a category is on the page.
    expect(listedTypes().length).toBeGreaterThan(30);
  });

  test("is a key of en.json, so the extractor found it and every locale can word it", () => {
    const english: Record<string, string> = readDashboardLocale("en");
    const notKeys: Array<string> = pageSentences().filter(
      (sentence: string): boolean => {
        return english[sentence] === undefined;
      },
    );

    expect(notKeys).toEqual([]);
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every one of them",
    (language: string) => {
      const notWorded: Array<string> = pageSentences().filter(
        (sentence: string): boolean => {
          return !isWordedInDashboardLocale(sentence, language);
        },
      );

      expect({ language, notWorded }).toEqual({ language, notWorded: [] });
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s keeps every placeholder, and the names and codes as written",
    (language: string) => {
      const english: Record<string, string> = readDashboardLocale("en");
      const words: Record<string, string> = readDashboardLocale(language);

      for (const sentence of pageSentences()) {
        const translated: string = words[sentence]!;

        expect({
          language,
          sentence,
          placeholders: placeholdersOf(translated),
        }).toEqual({
          language,
          sentence,
          placeholders: placeholdersOf(english[sentence]!),
        });

        for (const name of namesIn(english[sentence]!)) {
          expect({
            language,
            sentence,
            name,
            kept: translated.includes(name),
          }).toEqual({ language, sentence, name, kept: true });
        }
      }
    },
  );

  test("the checks find a name dropped and a sentence left in English (control)", () => {
    expect(namesIn("A machine running the Docker engine.")).toEqual(["Docker"]);
    expect(namesIn("An application, rapid and dependable.")).toEqual([]);
    expect(isSentence("A Kubernetes cluster.")).toBe(true);
    expect(isSentence("Kubernetes Pod")).toBe(false);
    expect(isSentence("Network & Devices")).toBe(false);
    expect(piecesOf("{{link}} to see service dependencies, and more.")).toEqual(
      ["to see service dependencies, and more."],
    );
  });
});

/*
 * The side menu the page is drawn beside: its sections and pages, and the
 * sources it lists ("By Source", "Added by You" were English in eleven
 * languages).
 */
const SIDE_MENU_FILE: string = "Pages/Inventory/SideMenu.tsx";

const SIDE_MENU_TITLES: ReadonlyArray<RegExp> = [
  new RegExp(`title:\\s*${LITERAL}`, "g"),
  new RegExp(`return\\s+${LITERAL}`, "g"),
];

function sideMenuTitles(): Array<string> {
  const source: string = fs.readFileSync(
    path.join(DASHBOARD_SOURCE, SIDE_MENU_FILE),
    "utf8",
  );
  const found: Set<string> = new Set<string>();

  for (const pattern of SIDE_MENU_TITLES) {
    for (const match of source.matchAll(pattern)) {
      found.add(JSON.parse(`"${match[1]}"`) as string);
    }
  }

  return [...found].sort();
}

describe("the side menu beside Inventory's Help > Documentation", () => {
  test("is read from its source: every section, page and source", () => {
    expect(sideMenuTitles()).toEqual(
      expect.arrayContaining([
        "Inventory",
        "All Items",
        "Gone Quiet",
        "By Source",
        "Discovered",
        "Mirrored",
        "Added by You",
        "Documentation",
      ]),
    );
  });

  test.each(DASHBOARD_LANGUAGES)("%s words every title", (language: string) => {
    const notWorded: Array<string> = sideMenuTitles().filter(
      (title: string): boolean => {
        return !isWordedInDashboardLocale(title, language);
      },
    );

    expect({ language, notWorded }).toEqual({ language, notWorded: [] });
  });
});

describe("Inventory's categories and delete caveats are keys", () => {
  test("every category has its name, and the name is the one the catalog files its kinds under", () => {
    expect(Object.keys(INVENTORY_CATEGORY_NAMES).sort()).toEqual(
      [...INVENTORY_CATEGORY_ORDER].sort(),
    );

    for (const category of INVENTORY_CATEGORY_ORDER) {
      expect(INVENTORY_CATEGORY_NAMES[category]).toBe(category);
    }
  });

  test("the Overview's breakdown labels each category with its name", () => {
    const breakdown: ReturnType<typeof buildInventoryBreakdown> =
      buildInventoryBreakdown({
        [EntityType.Host]: 2,
        [EntityType.NetworkDevice]: 1,
      });

    expect(
      breakdown.map((group: { label: string }): string => {
        return group.label;
      }),
    ).toEqual([
      INVENTORY_CATEGORY_NAMES[InventoryCategory.Compute],
      INVENTORY_CATEGORY_NAMES[InventoryCategory.Network],
    ]);
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words each source's delete caveat, the unknown source's and their title",
    (language: string) => {
      const caveats: Array<string> = [
        ...Object.values(EntitySource).map(
          (source: EntitySource): string | null => {
            return getInventoryDeleteCaveat(source);
          },
        ),
        getInventoryDeleteCaveat("a-source-from-a-newer-server"),
      ].filter((caveat: string | null): caveat is string => {
        return Boolean(caveat);
      });

      // Discovered, Mirrored, and a source this build does not know.
      expect(caveats.length).toBe(3);

      for (const text of [...caveats, DELETE_CAVEAT_TITLE]) {
        expect({
          language,
          text,
          worded: isWordedInDashboardLocale(text, language),
        }).toEqual({ language, text, worded: true });
      }
    },
  );

  test("a manual item's delete has no caveat: it is gone for good", () => {
    expect(getInventoryDeleteCaveat(EntitySource.Manual)).toBeNull();
  });
});

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar"];

const PAGE_PROPS: {
  pageRoute: Route;
  currentProject: null;
  hasPaymentMethod: boolean;
} = {
  pageRoute: new Route("/dashboard/inventory/documentation"),
  currentProject: null,
  hasPaymentMethod: true,
};

async function drawIn(
  language: string,
  element: React.ReactElement,
): Promise<HTMLElement> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });

  const drawn: { container?: HTMLElement } = {};

  await act(async () => {
    drawn.container = render(<MemoryRouter>{element}</MemoryRouter>).container;
  });

  return drawn.container!;
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of LANGUAGES) {
    resources[language] = {
      translation: readDashboardLocaleAsDrawn(language),
    };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID("10000000-0000-4000-8000-000000000001"));
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await i18next.changeLanguage("en");
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe("Inventory > Help > Documentation, drawn", () => {
  test("in English, every sentence as written (control: what the other languages must not draw is found)", async () => {
    const page: HTMLElement = await drawIn(
      "en",
      <InventoryDocumentation {...PAGE_PROPS} />,
    );
    const drawn: string = asRead(page.textContent || "");

    for (const sentence of pageSentences()) {
      if (sentence.endsWith("_one") || sentence.startsWith("{{count}}")) {
        continue;
      }

      for (const piece of piecesOf(sentence)) {
        expect({ piece, drawn: drawn.includes(piece) }).toEqual({
          piece,
          drawn: true,
        });
      }
    }
  });

  test.each(["de", "ar"])(
    "in %s, every sentence in the reader's words and none in English",
    async (language: string) => {
      const page: HTMLElement = await drawIn(
        language,
        <InventoryDocumentation {...PAGE_PROPS} />,
      );
      const drawn: string = asRead(page.textContent || "");
      const words: Record<string, string> =
        readDashboardLocaleAsDrawn(language);
      const english: Record<string, string> = readDashboardLocale("en");

      for (const sentence of pageSentences()) {
        if (sentence.endsWith("_one") || sentence.startsWith("{{count}}")) {
          continue;
        }

        for (const piece of piecesOf(asRead(words[sentence]!))) {
          expect({ language, piece, drawn: drawn.includes(piece) }).toEqual({
            language,
            piece,
            drawn: true,
          });
        }

        if (!isSentence(sentence) || words[sentence] === english[sentence]) {
          continue;
        }

        // A clause of the English, long enough to be its words alone.
        for (const piece of piecesOf(sentence).filter(isLongEnough)) {
          expect({
            language,
            english: piece,
            drawn: drawn.includes(piece),
          }).toEqual({ language, english: piece, drawn: false });
        }
      }
    },
  );

  test.each(["de", "ar"])(
    "in %s, the bold words of its sentences are the reader's: the identity key, the windows and the liveness states",
    async (language: string) => {
      const page: HTMLElement = await drawIn(
        language,
        <InventoryDocumentation {...PAGE_PROPS} />,
      );
      const words: Record<string, string> =
        readDashboardLocaleAsDrawn(language);
      const translator: ReturnType<typeof dashboardTranslator> =
        dashboardTranslator(language);
      const bold: Array<string> = Array.from(
        page.querySelectorAll("strong"),
      ).map((element: Element): string => {
        return asRead(element.textContent || "");
      });

      expect(bold).toEqual(
        expect.arrayContaining([
          asRead(words["identity key"]!),
          asRead(words["Live"]!),
          asRead(words["Recent"]!),
          asRead(words["Gone Quiet"]!),
          asRead(
            translator.translatePlural(
              { one: "{{count}} minute", other: "{{count}} minutes" },
              INVENTORY_LIVE_WINDOW_MINUTES,
            ),
          ),
          asRead(
            translator.translatePlural(
              { one: "{{count}} hour", other: "{{count}} hours" },
              Math.round(INVENTORY_STALE_AFTER_MINUTES / 60),
            ),
          ),
        ]),
      );
      expect(bold).not.toContain("identity key");
      expect(bold).not.toContain("Gone Quiet");
      expect(bold).not.toContain("30 minutes");
    },
  );

  test("in Arabic, the category no locale file had and the caveats are drawn in Arabic", async () => {
    const page: HTMLElement = await drawIn(
      "ar",
      <InventoryDocumentation {...PAGE_PROPS} />,
    );
    const drawn: string = asRead(page.textContent || "");
    const words: Record<string, string> = readDashboardLocale("ar");

    const headings: Array<string> = Array.from(page.querySelectorAll("h3")).map(
      (element: Element): string => {
        return asRead(element.textContent || "");
      },
    );

    expect(headings).toContain(words["Network & Devices"]);
    expect(headings).not.toContain("Network & Devices");
    expect(drawn).toContain(
      words[getInventoryDeleteCaveat(EntitySource.Discovered)!],
    );
    expect(drawn).toContain(
      words[getInventoryDeleteCaveat(EntitySource.Inventory)!],
    );
    // The names the kinds say are as written, in a right-to-left page.
    expect(drawn).toContain("Pure Storage FlashArray");
    expect(drawn).toContain("OpenStack");
  });
});

describe("an item's Delete tab, drawn", () => {
  test.each(["de", "ar"])(
    "in %s, the caveat and its title are the reader's",
    async (language: string) => {
      const caveat: string = getInventoryDeleteCaveat(EntitySource.Inventory)!;
      const page: HTMLElement = await drawIn(
        language,
        <Alert
          dataTestId="inventory-delete-caveat"
          type={AlertType.WARNING}
          strongTitle={DELETE_CAVEAT_TITLE}
          title={caveat}
        />,
      );
      const drawn: string = asRead(page.textContent || "");
      const words: Record<string, string> = readDashboardLocale(language);

      expect(drawn).toContain(asRead(words[caveat]!));
      expect(drawn).toContain(asRead(words[DELETE_CAVEAT_TITLE]!));
      expect(drawn).not.toContain("Delete the original record");
      expect(drawn).not.toContain(DELETE_CAVEAT_TITLE);
    },
  );
});
