import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  TELEMETRY_ARCHIVE_CARD_DESCRIPTION,
  TELEMETRY_UNARCHIVE_CARD_DESCRIPTION,
  UNARCHIVE_CARD_TITLE,
  UNARCHIVE_CONFIRM_MESSAGE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Archive/ArchiveCardWords";
import {
  SLO_ARCHIVE_CARD_DESCRIPTION,
  SLO_ARCHIVE_CONFIRM_MESSAGE,
  SLO_BULK_ARCHIVE_CONFIRM_MESSAGE,
  SLO_BULK_UNARCHIVE_CONFIRM_MESSAGE,
  SLO_UNARCHIVE_CARD_DESCRIPTION,
  SLO_UNARCHIVE_CONFIRM_MESSAGE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloArchiveCopy";
import {
  DASHBOARD_ARCHIVE_COPY,
  MONITOR_ARCHIVE_COPY,
  ON_CALL_POLICY_ARCHIVE_COPY,
  ResourceArchiveCopy,
  STATUS_PAGE_ARCHIVE_COPY,
  WORKFLOW_ARCHIVE_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Archive/ResourceArchiveCopy";
import {
  BULK_ARCHIVE_TELEMETRY_SENTENCE,
  BULK_ARCHIVE_TELEMETRY_SENTENCE_ONE,
  BULK_ARCHIVE_TITLE,
  BULK_UNARCHIVE_SENTENCE,
  BULK_UNARCHIVE_SENTENCE_ONE,
  BULK_UNARCHIVE_TITLE,
  ROW_ARCHIVE_TELEMETRY_SENTENCE,
  ROW_UNARCHIVE_QUESTION,
  ROW_UNARCHIVE_TITLE,
} from "../../../UI/Components/BulkUpdate/BulkArchiveActions";
import { PluralTemplate, translatableTerm } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * ARCHIVE'S WORDS AGREE WITH EACH OTHER, IN EVERY LANGUAGE (#7387).
 *
 * A reader who presses a button reads its words again in the dialog it
 * opens, in the banner over an archived page and in the toast after it. In
 * German the button said "Aus Archiv entfernen" over a card titled "... aus
 * dem Archiv holen"; Hindi, Danish, Norwegian and Dutch each had two or three
 * verbs for unarchiving. Russian named a service "Сервис" and its list
 * "Службы", Dutch "dienst" and "services". The Arabic bulk title put a
 * nominative plural after من ("أرشفة 3 من المضيفون؟"), and the French one
 * said "éléments" twice for inventory items.
 *
 * Each check reads the Dashboard's shipped locale files.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);
const MODELS_DIR: string = path.resolve(
  __dirname,
  "../../../Models/DatabaseModels",
);

/*
 * The one way each language says "unarchive": the button's verb, which the
 * card's and the dialogs' titles, the banner and every sentence about
 * unarchiving say too.
 */
const UNARCHIVE_VERB: Record<string, RegExp> = {
  de: /aus dem Archiv (holen|geholt|zu holen)|holen Sie .{1,30}? aus dem Archiv/i,
  fr: /désarchiv/i,
  es: /desarch[ií]v/i,
  it: /annull\S*\s+(l')?archiviazione/i,
  pt: /desarquiv/i,
  nl: /uit het archief/i,
  da: /fra arkivet/i,
  no: /fra arkivet/i,
  sv: /avarkiv/i,
  ru: /из архива/i,
  ko: /보관(을|이)? 취소/,
  "zh-CN": /取消归档/,
  "zh-TW": /取消封存/,
  hi: /संग्रह से निकाल/,
  ja: /アーカイブ.{0,6}解除/,
  fa: /از بایگانی/,
  ar: /(إلغاء|ألغِ|أُلغيت|ألغيت) (ال)?أرشف/,
};

function oneFormKey(template: PluralTemplate): string {
  return `${template.other}_one`;
}

const OWN_COPIES: ReadonlyArray<ResourceArchiveCopy> = [
  WORKFLOW_ARCHIVE_COPY,
  MONITOR_ARCHIVE_COPY,
  STATUS_PAGE_ARCHIVE_COPY,
  DASHBOARD_ARCHIVE_COPY,
  ON_CALL_POLICY_ARCHIVE_COPY,
];

/*
 * Every key of the archive card, its dialogs, the banner, the Archived
 * pages and the bulk and row dialogs whose English says "unarchive".
 */
const UNARCHIVE_KEYS: ReadonlyArray<string> = Array.from(
  new Set<string>(
    [
      "Unarchive",
      "When Unarchived",
      UNARCHIVE_CARD_TITLE,
      ROW_UNARCHIVE_TITLE,
      ROW_UNARCHIVE_QUESTION,
      ROW_ARCHIVE_TELEMETRY_SENTENCE,
      TELEMETRY_ARCHIVE_CARD_DESCRIPTION,
      TELEMETRY_UNARCHIVE_CARD_DESCRIPTION,
      UNARCHIVE_CONFIRM_MESSAGE,
      SLO_ARCHIVE_CARD_DESCRIPTION,
      SLO_UNARCHIVE_CARD_DESCRIPTION,
      SLO_ARCHIVE_CONFIRM_MESSAGE,
      SLO_UNARCHIVE_CONFIRM_MESSAGE,
      SLO_BULK_ARCHIVE_CONFIRM_MESSAGE,
      SLO_BULK_UNARCHIVE_CONFIRM_MESSAGE,
      BULK_UNARCHIVE_TITLE.other,
      oneFormKey(BULK_UNARCHIVE_TITLE),
      BULK_UNARCHIVE_SENTENCE,
      BULK_UNARCHIVE_SENTENCE_ONE,
      BULK_ARCHIVE_TELEMETRY_SENTENCE,
      BULK_ARCHIVE_TELEMETRY_SENTENCE_ONE,
      ...OWN_COPIES.flatMap((copy: ResourceArchiveCopy): Array<string> => {
        return Object.values(copy);
      }),
    ].filter((key: string): boolean => {
      return /unarchiv/i.test(key);
    }),
  ),
);

/*
 * Sentences about another product's own action, said in that product's
 * words: a Slack or Mattermost channel is unarchived in Slack or
 * Mattermost, whichever verb its own screens use.
 */
const OTHER_PRODUCTS_ACTIONS: ReadonlyArray<string> = [
  "This channel is archived. Unarchive it in Slack to add people.",
  "This channel is archived. Unarchive it in Mattermost to add people.",
];

// Every key of the Dashboard whose English says "unarchive".
function everyUnarchiveKey(): Array<string> {
  return Object.keys(readDashboardLocale("en")).filter(
    (key: string): boolean => {
      return /unarchiv/i.test(key) && !OTHER_PRODUCTS_ACTIONS.includes(key);
    },
  );
}

/*
 * The languages whose verb was split before #7387, held to it across the
 * whole Dashboard, not just the archive card's family.
 */
const ONE_VERB_EVERYWHERE: ReadonlyArray<string> = [
  "de",
  "hi",
  "da",
  "no",
  "nl",
];

function sourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFiles(entryPath));
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

interface ListNames {
  model: string;
  singularName: string;
  pluralName: string;
}

// A model's own names, as its @TableMetadata says them.
function modelNames(model: string): ListNames {
  const source: string = fs.readFileSync(
    path.join(MODELS_DIR, `${model}.ts`),
    "utf8",
  );
  const singular: RegExpMatchArray | null = source.match(
    /singularName:\s*"([^"]+)"/,
  );
  const plural: RegExpMatchArray | null = source.match(
    /pluralName:\s*"([^"]+)"/,
  );

  expect({ model, singular: singular?.[1], plural: plural?.[1] }).toEqual({
    model,
    singular: expect.any(String),
    plural: expect.any(String),
  });

  return {
    model: model,
    singularName: singular![1]!,
    pluralName: plural![1]!,
  };
}

/*
 * The names every list's bulk Archive and Unarchive dialog says: the model's
 * own names, unless the page hands the hook a resource's archive copy (the
 * five kinds above, checked through OWN_COPIES).
 */
function bulkArchiveListNames(): Array<ListNames> {
  const byModel: Map<string, ListNames> = new Map<string, ListNames>();

  for (const file of sourceFiles(DASHBOARD_SRC)) {
    const source: string = fs.readFileSync(file, "utf8");
    const pattern: RegExp = /useBulkArchiveActions<(\w+)>\(\s*\{([^}]*)\}/g;
    let match: RegExpExecArray | null = pattern.exec(source);

    while (match) {
      const model: string = match[1]!;
      const options: string = match[2]!;

      if (!/pluralName:/.test(options) && !byModel.has(model)) {
        byModel.set(model, modelNames(model));
      }

      match = pattern.exec(source);
    }
  }

  return Array.from(byModel.values()).sort((a: ListNames, b: ListNames) => {
    return a.model.localeCompare(b.model);
  });
}

const LIST_NAMES: Array<ListNames> = [
  ...bulkArchiveListNames(),
  ...OWN_COPIES.map((copy: ResourceArchiveCopy): ListNames => {
    return {
      model: copy.singularName,
      singularName: copy.singularName,
      pluralName: copy.pluralName,
    };
  }),
];

// The bulk dialog's title as useBulkArchiveActions draws it.
function bulkTitle(
  language: string,
  template: PluralTemplate,
  names: ListNames,
  count: number,
): string {
  return dashboardTranslator(language).translatePlural(template, count, {
    itemName: translatableTerm(names.singularName, { inSentence: true }),
    itemsName: translatableTerm(names.pluralName, { inSentence: true }),
  });
}

function namesOf(model: string): ListNames {
  const names: ListNames | undefined = LIST_NAMES.find(
    (entry: ListNames): boolean => {
      return entry.model === model;
    },
  );

  expect({ model, found: Boolean(names) }).toEqual({ model, found: true });

  return names!;
}

describe("the lists whose bulk dialogs are checked", () => {
  test("are read from every page that asks for bulk Archive", () => {
    const models: Array<string> = LIST_NAMES.map((names: ListNames) => {
      return names.model;
    });

    expect(models).toEqual(
      expect.arrayContaining([
        "Host",
        "Service",
        "InventoryItem",
        "MessageQueue",
        "DockerSwarmCluster",
        "DatabaseServer",
        "workflow",
        "on-call policy",
      ]),
    );
    expect(models.length).toBeGreaterThanOrEqual(24);
  });

  test("every language has a verb in the table", () => {
    expect(Object.keys(UNARCHIVE_VERB).sort()).toEqual(
      [...DASHBOARD_LANGUAGES].sort(),
    );
  });

  test("the keys checked include the button, the titles, the banner and the toasts' family", () => {
    expect(UNARCHIVE_KEYS).toEqual(
      expect.arrayContaining([
        "Unarchive",
        "Unarchive {{itemName}}",
        "Unarchive {{count}} {{itemsName}}?",
        "Unarchive {{count}} {{itemsName}}?_one",
        "When Unarchived",
        WORKFLOW_ARCHIVE_COPY.bannerBody,
        WORKFLOW_ARCHIVE_COPY.archivedPageDescription,
        MONITOR_ARCHIVE_COPY.bulkUnarchiveConfirmMessage,
      ]),
    );
    expect(UNARCHIVE_KEYS.length).toBeGreaterThanOrEqual(50);
  });
});

describe.each(DASHBOARD_LANGUAGES)(
  "one verb for unarchiving in %s",
  (language: string) => {
    const words: Record<string, string> = readDashboardLocale(language);
    const verb: RegExp = UNARCHIVE_VERB[language]!;

    test("the button says it", () => {
      expect(words["Unarchive"]).toMatch(verb);
    });

    test("the card's, the banner's, the pages' and the dialogs' words say it", () => {
      const without: Array<{ key: string; worded: string }> =
        UNARCHIVE_KEYS.filter((key: string): boolean => {
          return !verb.test(words[key] || "");
        }).map((key: string): { key: string; worded: string } => {
          return { key: key, worded: words[key] || "" };
        });

      expect(without).toEqual([]);
    });

    test("an archived workflow's card title and its button say the same verb", () => {
      const title: string = dashboardTranslator(language).translateTemplate(
        UNARCHIVE_CARD_TITLE,
        {
          itemName: translatableTerm(WORKFLOW_ARCHIVE_COPY.singularName),
        },
      );

      expect(title).toMatch(verb);
      expect(words["Unarchive"]).toMatch(verb);
    });
  },
);

describe.each(ONE_VERB_EVERYWHERE)(
  "every unarchive sentence of the Dashboard in %s",
  (language: string) => {
    test("says the button's verb", () => {
      const words: Record<string, string> = readDashboardLocale(language);
      const verb: RegExp = UNARCHIVE_VERB[language]!;
      const keys: Array<string> = everyUnarchiveKey().filter(
        (key: string): boolean => {
          return isWordedInDashboardLocale(key, language);
        },
      );

      // The exceptions', the toasts', the resources' Archived pages' ...
      expect(keys.length).toBeGreaterThanOrEqual(60);

      const without: Array<{ key: string; worded: string }> = keys
        .filter((key: string): boolean => {
          return !verb.test(words[key]!);
        })
        .map((key: string): { key: string; worded: string } => {
          return { key: key, worded: words[key]! };
        });

      expect(without).toEqual([]);
    });
  },
);

describe("the verbs above, against the words they replaced", () => {
  // Without these, a pattern that matched everything would look the same.
  test.each([
    ["de", "Aus Archiv entfernen"],
    ["de", "Wählen Sie Hosts aus, um ihre Archivierung aufzuheben."],
    ["de", "Bei Aufhebung der Archivierung"],
    ["hi", "अनसंग्रहीत करें"],
    ["hi", "{{count}} {{itemsName}} को संग्रह से हटाएँ"],
    ["da", "Fjern fra arkiv"],
    ["da", "Vælg rækker for at gendanne dem."],
    ["no", "Fjern fra arkiv"],
    ["no", "Hent den ut av arkivet i Slack."],
    ["nl", "Uit archief halen"],
    ["nl", "Selecteer arrays om ze te dearchiveren."],
    ["it", "I workflow non più archiviati riappaiono."],
    ["ar", "أرشفة {{count}} من {{itemsName}}؟"],
  ])("%s does not take %p", (language: string, old: string) => {
    expect(old).not.toMatch(UNARCHIVE_VERB[language]!);
  });
});

describe("Danish spells Archive one way", () => {
  test("the button is Arkiver, and so is every sentence", () => {
    const words: Record<string, string> = readDashboardLocale("da");

    expect(words["Archive"]).toBe("Arkiver");
    expect(words["Archive {{itemName}}"]).toBe("Arkiver {{itemName}}");

    const accented: Array<string> = Object.keys(words).filter(
      (key: string): boolean => {
        const value: unknown = words[key];

        return typeof value === "string" && /arkivér/i.test(value);
      },
    );

    expect(accented).toEqual([]);
  });
});

/*
 * Hindi spelled archive two ways: the Archive button and about a hundred
 * sentences संग्रहित, the Archived state and twice as many संग्रहीत - so
 * the Archived SLOs page said "संग्रहित SLO" under a menu saying
 * "संग्रहीत". One spelling, the dictionary's (#7387).
 */
const HINDI_ARCHIVE_OTHER_SPELLING: RegExp = /संग्रहित/;

describe("Hindi spells archive one way", () => {
  test("the button, the card's title and the state say संग्रहीत", () => {
    const words: Record<string, string> = readDashboardLocale("hi");

    expect([
      words["Archive"],
      words["Archive {{itemName}}"],
      words["Archived"],
      words["Archived SLOs"],
    ]).toEqual([
      "संग्रहीत करें",
      "{{itemName}} संग्रहीत करें",
      "संग्रहीत",
      "संग्रहीत SLO",
    ]);
  });

  test("no sentence of the Dashboard spells it संग्रहित", () => {
    const words: Record<string, string> = readDashboardLocale("hi");
    const other: Array<string> = Object.keys(words).filter(
      (key: string): boolean => {
        const value: unknown = words[key];

        return (
          typeof value === "string" && HINDI_ARCHIVE_OTHER_SPELLING.test(value)
        );
      },
    );

    expect(other).toEqual([]);
  });

  test("the pattern finds the spelling it replaced", () => {
    expect("संग्रहित करें").toMatch(HINDI_ARCHIVE_OTHER_SPELLING);
    expect("संग्रहीत करें").not.toMatch(HINDI_ARCHIVE_OTHER_SPELLING);
  });
});

/*
 * The first three letters of a name's first word, as its locale says it:
 * "сервис" and "сервисы" agree, as do "база" and "базы"; "служба" and
 * "сервисы" do not, nor "dienst" and "services".
 */
function stem(text: string): string {
  return text.trim().split(/\s+/)[0]!.toLowerCase().slice(0, 3);
}

describe.each(["ru", "nl"])(
  "one noun for a thing and its list in %s",
  (language: string) => {
    test("every bulk-archived list's one and many share their noun", () => {
      const translator: ReturnType<typeof dashboardTranslator> =
        dashboardTranslator(language);
      const disagree: Array<{ one: string; many: string }> = [];

      for (const names of LIST_NAMES) {
        for (const inSentence of [false, true]) {
          const one: string = translator.translateText(names.singularName);
          const many: string = translator.translateText(names.pluralName);
          const pair: { one: string; many: string } = {
            one: inSentence ? one.toLowerCase() : one,
            many: inSentence ? many.toLowerCase() : many,
          };

          if (stem(pair.one) !== stem(pair.many)) {
            disagree.push(pair);
          }
        }
      }

      expect(disagree).toEqual([]);
    });
  },
);

describe("a service's noun", () => {
  const SERVICE_LABELS: ReadonlyArray<string> = [
    "Service",
    "Services",
    "service",
    "services",
    "All Services",
    "All services",
    "Delete Service",
    "No services yet.",
    "Service Detail",
    "View all services",
    "Services it owns",
    "{{count}} more services",
    "{{count}} more services_one",
  ];

  test("is сервис in Russian, wherever the Services list or a service is named", () => {
    const words: Record<string, string> = readDashboardLocale("ru");
    const other: Array<{ key: string; worded: string }> = SERVICE_LABELS.filter(
      (key: string): boolean => {
        return !/сервис/i.test(words[key] || "") || /служб/i.test(words[key]!);
      },
    ).map((key: string): { key: string; worded: string } => {
      return { key: key, worded: words[key] || "" };
    });

    expect(other).toEqual([]);
    expect(words["Service"]).toBe("Сервис");
    expect(words["Services"]).toBe("Сервисы");
  });

  /*
   * The sentences about the Services list's records - its page, a service's
   * own pages, the lists and forms that pick services, the permissions, the
   * imports - say the list's noun too, not служба, which stays for a
   * system's own services (systemd, Windows, OpenStack, a cloud's services).
   */
  const RU_SERVICE_SENTENCES: ReadonlyArray<string> = [
    "The applications and microservices you run. Each service brings together its logs, traces, metrics, exceptions, incidents and owners in one place.",
    "Link services from your service catalog to this code repository. Specify the path where each service's code lives.",
    "No telemetry services entered",
    "Only services that match conditions",
    "Only exceptions from these services. Empty: every service.",
    "Only logs from these services. Empty: every service.",
    "Only spans from these services. Empty: every service.",
    "List of services affected by this alert.",
    "List of services affected by this event.",
    "List of services affected by this incident.",
    "List of services to pre-populate on incidents created from this template.",
    "List of services to pre-populate on scheduled maintenance events created from this template.",
    "Search and attach hosts, Kubernetes clusters, Docker hosts, databases, or services affected by this incident.",
    "Search and attach hosts, Kubernetes clusters, Docker hosts, or services that incidents created from this template should pre-populate.",
    "{{count}} services affected",
    "{{count}} services affected_one",
    "No monitor watches this service yet",
    "The monitors watching this service, and the SLOs that measure them.",
    "This team owns {{count}} services.",
    "This team owns {{count}} services._one",
    "{{count}} SLOs measure monitors of this service.",
    "{{count}} SLOs measure monitors of this service._one",
    "{{count}} monitors watch this service.",
    "{{count}} monitors watch this service._one",
    "{{count}} services carry this label.",
    "{{count}} services carry this label._one",
    "Services that keep failing",
    "No service came up more than once.",
    "Create, change and delete services, infrastructure and integrations.",
    "Services, infrastructure and integrations, video calls and the audit log.",
    "Created in the service catalog, owned by their team when the tool names one.",
    "Open any trace of the service under **Services → Traces** and check that its resource attributes carry `cloud.platform={{platform}}` — without it, the telemetry is not filed as a cloud environment.",
  ];

  test("is сервис in the Russian sentences about the Services list's records", () => {
    const words: Record<string, string> = readDashboardLocale("ru");
    const other: Array<{ key: string; worded: string }> =
      RU_SERVICE_SENTENCES.filter((key: string): boolean => {
        return !/сервис/i.test(words[key] || "") || /служб/i.test(words[key]!);
      }).map((key: string): { key: string; worded: string } => {
        return { key: key, worded: words[key] || "" };
      });

    expect(other).toEqual([]);
  });

  test("the Admin Dashboard's Russian pair of options says one noun", () => {
    const admin: Record<string, unknown> = JSON.parse(
      fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../../App/FeatureSet/AdminDashboard/src/Locales/ru.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;

    expect([admin["All services"], admin["Only services that match conditions"]])
      .toEqual(["Все сервисы", "Только сервисы, соответствующие условиям"]);
  });

  test("is service in Dutch, one and many", () => {
    const words: Record<string, string> = readDashboardLocale("nl");

    for (const key of ["Service", "Services", "service", "services"]) {
      expect({ key, worded: words[key] }).toEqual({
        key,
        worded: expect.stringMatching(/^[Ss]ervices?$/),
      });
    }
  });

  test("the bulk dialog names services the way their list does", () => {
    const services: ListNames = namesOf("Service");

    expect(bulkTitle("ru", BULK_ARCHIVE_TITLE, services, 3)).toBe(
      "Архивировать объекты (сервисы): 3?",
    );
    expect(bulkTitle("ru", BULK_ARCHIVE_TITLE, services, 1)).toBe(
      "Архивировать объект (сервис): 1?",
    );
    expect(bulkTitle("nl", BULK_UNARCHIVE_TITLE, services, 3)).toBe(
      "3 services uit het archief halen?",
    );
    expect(bulkTitle("nl", BULK_UNARCHIVE_TITLE, services, 1)).toBe(
      "1 service uit het archief halen?",
    );
  });
});

describe("the Arabic bulk title names the list before its count", () => {
  /*
   * After من a noun is genitive: "من المضيفين", never "من المضيفون". The
   * name arrives in its locale's own (nominative) form, so the title names
   * it first, as a label, and counts after it.
   */
  test.each([
    ["Host", "المضيفون", "المضيف"],
    ["Service", "الخدمات", "الخدمة"],
    ["MessageQueue", "قوائم الانتظار", "قائمة الانتظار"],
    ["DatabaseServer", "قواعد البيانات", "قاعدة بيانات"],
  ])("%s", (model: string, many: string, one: string) => {
    const names: ListNames = namesOf(model);
    const words: Record<string, string> = readDashboardLocale("ar");

    expect(words[names.pluralName]).toBe(many);
    expect(words[names.singularName]).toBe(one);
    expect(bulkTitle("ar", BULK_ARCHIVE_TITLE, names, 3)).toBe(
      `${many}: أرشفة 3؟`,
    );
    expect(bulkTitle("ar", BULK_ARCHIVE_TITLE, names, 1)).toBe(
      `${one}: أرشفة 1؟`,
    );
    expect(bulkTitle("ar", BULK_UNARCHIVE_TITLE, names, 3)).toBe(
      `${many}: إلغاء أرشفة 3؟`,
    );
  });

  test("no bulk title puts a name after من", () => {
    for (const template of [BULK_ARCHIVE_TITLE, BULK_UNARCHIVE_TITLE]) {
      for (const names of LIST_NAMES) {
        for (const count of [1, 3, 11]) {
          expect(bulkTitle("ar", template, names, count)).not.toMatch(/ من /);
        }
      }
    }
  });
});

/*
 * A title's words, without its count, its marks and its short linking
 * words ("di" in "l'archiviazione di 3 dispositivi di rete").
 */
function wordsOf(title: string): Array<string> {
  return title
    .toLowerCase()
    .split(/[\s()«»"“”„،:?？؟¿]+/u)
    .filter((word: string): boolean => {
      return word.length > 3 && !/^\d+$/.test(word);
    });
}

describe.each(DASHBOARD_LANGUAGES)(
  "the bulk dialog's title in %s",
  (language: string) => {
    test("says no word twice, inventory items included", () => {
      const doubled: Array<string> = [];

      for (const template of [BULK_ARCHIVE_TITLE, BULK_UNARCHIVE_TITLE]) {
        for (const names of LIST_NAMES) {
          for (const count of [1, 3]) {
            const title: string = bulkTitle(language, template, names, count);
            const seen: Array<string> = wordsOf(title);

            if (new Set(seen).size !== seen.length) {
              doubled.push(title);
            }
          }
        }
      }

      expect(doubled).toEqual([]);
    });

    test("names every list in the reader's language", () => {
      const unworded: Array<string> = LIST_NAMES.flatMap(
        (names: ListNames): Array<string> => {
          return [names.singularName, names.pluralName];
        },
      ).filter((name: string): boolean => {
        return !isWordedInDashboardLocale(name, language);
      });

      expect(unworded).toEqual([]);
    });
  },
);

describe("the French bulk title for inventory items", () => {
  test("says éléments once", () => {
    const items: ListNames = namesOf("InventoryItem");

    expect(bulkTitle("fr", BULK_ARCHIVE_TITLE, items, 3)).toBe(
      "Archiver 3 éléments d'inventaire ?",
    );
    expect(bulkTitle("fr", BULK_UNARCHIVE_TITLE, items, 1)).toBe(
      "Désarchiver 1 élément d'inventaire ?",
    );
  });

  test("and English says the name in the middle of a sentence", () => {
    const items: ListNames = namesOf("InventoryItem");

    expect(bulkTitle("en", BULK_ARCHIVE_TITLE, items, 3)).toBe(
      "Archive 3 inventory items?",
    );
    expect(bulkTitle("en", BULK_UNARCHIVE_TITLE, namesOf("Host"), 1)).toBe(
      "Unarchive 1 host?",
    );
  });
});
