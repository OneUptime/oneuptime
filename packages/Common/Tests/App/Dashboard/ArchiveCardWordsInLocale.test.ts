import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ARCHIVE_CARD_TITLE,
  ArchiveCardCopy,
  ArchiveCardWords,
  getArchiveCardWords,
  TELEMETRY_ARCHIVE_CARD_DESCRIPTION,
  TELEMETRY_ARCHIVE_CONFIRM_MESSAGE,
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
} from "../../../UI/Components/BulkUpdate/BulkArchiveActions";
import { PluralTemplate, translatableTerm } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * THE ARCHIVE CARD'S AND THE BULK DIALOG'S WORDS, IN EVERY LANGUAGE (#7195).
 *
 * The Settings page's Archive card and the lists' bulk Archive dialog say
 * their title, their sentence and the resource's name as keys of the
 * Dashboard's locales. Every one of them is worded in every language the
 * Dashboard offers - with the same {{placeholders}} as its English, so no
 * translation drops the name or the count - and so is every name a Settings
 * page hands the card, read from the pages themselves.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

// The "_one" key a plural's one form is stored under (i18next's).
function oneFormKey(template: PluralTemplate): string {
  return `${template.other}_one`;
}

// Every sentence key, with the English its placeholders must match.
const SENTENCES: ReadonlyArray<{ key: string; english: string }> = [
  ARCHIVE_CARD_TITLE,
  UNARCHIVE_CARD_TITLE,
  TELEMETRY_ARCHIVE_CARD_DESCRIPTION,
  TELEMETRY_UNARCHIVE_CARD_DESCRIPTION,
  TELEMETRY_ARCHIVE_CONFIRM_MESSAGE,
  UNARCHIVE_CONFIRM_MESSAGE,
  SLO_ARCHIVE_CARD_DESCRIPTION,
  SLO_UNARCHIVE_CARD_DESCRIPTION,
  SLO_ARCHIVE_CONFIRM_MESSAGE,
  SLO_UNARCHIVE_CONFIRM_MESSAGE,
  SLO_BULK_ARCHIVE_CONFIRM_MESSAGE,
  SLO_BULK_UNARCHIVE_CONFIRM_MESSAGE,
  BULK_ARCHIVE_TITLE.other,
  BULK_UNARCHIVE_TITLE.other,
  BULK_ARCHIVE_TELEMETRY_SENTENCE_ONE,
  BULK_ARCHIVE_TELEMETRY_SENTENCE,
  BULK_UNARCHIVE_SENTENCE_ONE,
  BULK_UNARCHIVE_SENTENCE,
]
  .map((key: string): { key: string; english: string } => {
    return { key: key, english: key };
  })
  .concat(
    [BULK_ARCHIVE_TITLE, BULK_UNARCHIVE_TITLE].map(
      (template: PluralTemplate): { key: string; english: string } => {
        return { key: oneFormKey(template), english: template.one };
      },
    ),
  );

/*
 * The resources whose Settings card says sentences of their own
 * (ResourceArchiveCopy): a workflow stops running, a monitor stops being
 * checked, a status page goes offline. Their card titles are worded with
 * the name, so their sentences must be too - or the card reads "Arbeitsablauf
 * archivieren" over an English paragraph.
 */
const OWN_COPY_KINDS: ReadonlyArray<{
  kind: string;
  copy: ResourceArchiveCopy;
}> = [
  { kind: "workflow", copy: WORKFLOW_ARCHIVE_COPY },
  { kind: "monitor", copy: MONITOR_ARCHIVE_COPY },
  { kind: "status page", copy: STATUS_PAGE_ARCHIVE_COPY },
  { kind: "dashboard", copy: DASHBOARD_ARCHIVE_COPY },
  { kind: "on-call policy", copy: ON_CALL_POLICY_ARCHIVE_COPY },
];

/*
 * Each of those cards' sentences, live and archived, its dialogs', and the
 * sentence of their lists' bulk dialogs, whose title is worded too - and the
 * banner across the top of an archived one's pages and its list's Archived
 * page: their title, their sentence and the empty list's message (#7386).
 */
const OWN_COPY_SENTENCES: ReadonlyArray<{ kind: string; key: string }> =
  OWN_COPY_KINDS.flatMap(
    ({
      kind,
      copy,
    }: {
      kind: string;
      copy: ResourceArchiveCopy;
    }): Array<{ kind: string; key: string }> => {
      return [
        copy.archiveCardDescription,
        copy.unarchiveCardDescription,
        copy.archiveConfirmMessage,
        copy.unarchiveConfirmMessage,
        copy.bulkArchiveConfirmMessage,
        copy.bulkUnarchiveConfirmMessage,
        copy.bannerTitle,
        copy.bannerBody,
        copy.archivedPageTitle,
        copy.archivedPageDescription,
        copy.noArchivedItemsMessage,
      ].map((key: string): { kind: string; key: string } => {
        return { kind: kind, key: key };
      });
    },
  );

/*
 * The other words an Archived page draws: the archived workflows' column
 * and its two values, and the monitor table's search boxes and template
 * column, with the file that says each.
 */
const ARCHIVED_PAGE_WORDS: ReadonlyArray<{ file: string; key: string }> = [
  { file: "Pages/Workflow/Archived.tsx", key: "When Unarchived" },
  { file: "Pages/Workflow/Archived.tsx", key: "Runs again" },
  { file: "Pages/Workflow/Archived.tsx", key: "Stays disabled" },
  { file: "Components/Monitor/MonitorTable.tsx", key: "Search templates..." },
  { file: "Components/Monitor/MonitorTable.tsx", key: "Search statuses..." },
  {
    file: "Components/Monitor/MonitorTable.tsx",
    key: "Search monitor types...",
  },
  {
    file: "Components/Monitor/MonitorTable.tsx",
    key: "The monitor template this monitor is linked to, if any.",
  },
];

function sourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFiles(entryPath));
    } else if (entry.name.endsWith(".tsx")) {
      files.push(entryPath);
    }
  }

  return files;
}

// Each <ArchiveResourceCard ...> a page draws, its props as written.
function archiveCardCalls(): Array<{ file: string; props: string }> {
  const calls: Array<{ file: string; props: string }> = [];

  for (const file of sourceFiles(DASHBOARD_SRC)) {
    // Its code, without the comments that show a call as an example.
    const source: string = fs
      .readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const pattern: RegExp = /<ArchiveResourceCard\b([\s\S]*?)\/>/g;
    let match: RegExpExecArray | null = pattern.exec(source);

    while (match) {
      calls.push({
        file: path.relative(DASHBOARD_SRC, file),
        props: match[1]!,
      });
      match = pattern.exec(source);
    }
  }

  return calls;
}

// The names the pages hand the card as a literal: "service", "SLO".
function literalCardNames(): Array<string> {
  const names: Set<string> = new Set<string>();

  for (const call of archiveCardCalls()) {
    const literal: RegExpMatchArray | null = call.props.match(
      /singularName="([^"]+)"/,
    );

    if (literal) {
      names.add(literal[1]!);
    }
  }

  return Array.from(names).sort();
}

describe("the pages the Archive card is read from", () => {
  test("every Settings page names what it archives", () => {
    const calls: Array<{ file: string; props: string }> = archiveCardCalls();

    // The SLO and the fifteen telemetry kinds' pages, and the five others'.
    expect(calls.length).toBeGreaterThanOrEqual(20);

    const unnamed: Array<string> = calls
      .filter((call: { file: string; props: string }): boolean => {
        return !call.props.includes("singularName=");
      })
      .map((call: { file: string; props: string }): string => {
        return call.file;
      });

    expect(unnamed).toEqual([]);
  });

  test("the Archived pages still draw the words checked below", () => {
    for (const { file, key } of ARCHIVED_PAGE_WORDS) {
      const source: string = fs.readFileSync(
        path.join(DASHBOARD_SRC, file),
        "utf8",
      );

      expect({ file, key, drawn: source.includes(`"${key}"`) }).toEqual({
        file,
        key,
        drawn: true,
      });
    }
  });

  test("the names read from them include an SLO and a service", () => {
    const names: Array<string> = literalCardNames();

    expect(names).toEqual(expect.arrayContaining(["SLO", "service"]));
    expect(names.length).toBeGreaterThanOrEqual(15);
  });
});

describe.each(DASHBOARD_LANGUAGES)(
  "the Archive card and bulk dialog in %s",
  (language: string) => {
    const words: Record<string, string> = readDashboardLocale(language);

    test.each(SENTENCES)(
      "$key is worded, with its English's placeholders",
      ({ key, english }: { key: string; english: string }) => {
        expect({
          key,
          worded: isWordedInDashboardLocale(key, language),
        }).toEqual({ key, worded: true });
        expect(placeholdersOf(words[key]!)).toEqual(placeholdersOf(english));
      },
    );

    test("every name a Settings page hands the card is worded", () => {
      const unworded: Array<string> = literalCardNames().filter(
        (name: string): boolean => {
          return !isWordedInDashboardLocale(name, language);
        },
      );

      expect(unworded).toEqual([]);
    });

    test.each(OWN_COPY_SENTENCES)(
      "the $kind card's, banner's or list's own words are worded: $key",
      ({ key }: { kind: string; key: string }) => {
        expect({
          key,
          worded: isWordedInDashboardLocale(key, language),
        }).toEqual({ key, worded: true });
      },
    );

    test.each(ARCHIVED_PAGE_WORDS)(
      "the Archived page's $key is worded",
      ({ key }: { file: string; key: string }) => {
        expect({
          key,
          worded: isWordedInDashboardLocale(key, language),
        }).toEqual({ key, worded: true });
        expect(placeholdersOf(words[key]!)).toEqual(placeholdersOf(key));
      },
    );

    /*
     * The card's title says the singular; those lists' bulk dialog titles
     * say the plural ("3 Arbeitsabläufe archivieren?").
     */
    test("every name a card or list with sentences of its own says is worded", () => {
      const unworded: Array<string> = OWN_COPY_KINDS.flatMap(
        ({
          copy,
        }: {
          kind: string;
          copy: ResourceArchiveCopy;
        }): Array<string> => {
          return [copy.singularName, copy.pluralName];
        },
      ).filter((name: string): boolean => {
        return !isWordedInDashboardLocale(name, language);
      });

      expect(unworded).toEqual([]);
    });

    test("the card's words for a service, an SLO and the five others are not the English", () => {
      const cards: Array<[string, ArchiveCardCopy]> = [
        ["service", {}],
        [
          "SLO",
          {
            archiveCardDescription: SLO_ARCHIVE_CARD_DESCRIPTION,
            unarchiveCardDescription: SLO_UNARCHIVE_CARD_DESCRIPTION,
            archiveConfirmMessage: SLO_ARCHIVE_CONFIRM_MESSAGE,
            unarchiveConfirmMessage: SLO_UNARCHIVE_CONFIRM_MESSAGE,
          },
        ],
        ...OWN_COPY_KINDS.map(
          ({
            copy,
          }: {
            kind: string;
            copy: ResourceArchiveCopy;
          }): [string, ArchiveCardCopy] => {
            return [copy.singularName, copy];
          },
        ),
      ];

      for (const [singularName, copy] of cards) {
        for (const isArchived of [false, true]) {
          const input: Parameters<typeof getArchiveCardWords>[0] = {
            singularName: singularName,
            isArchived: isArchived,
            copy: copy,
            translator: dashboardTranslator(language),
          };
          const drawn: ArchiveCardWords = getArchiveCardWords(input);
          const english: ArchiveCardWords = getArchiveCardWords({
            ...input,
            translator: dashboardTranslator("en"),
          });

          expect(drawn.title).not.toBe(english.title);
          expect(drawn.description).not.toBe(english.description);
          expect(drawn.confirmMessage).not.toBe(english.confirmMessage);
        }
      }
    });
  },
);

describe("the bulk dialog's title on a list with sentences of its own", () => {
  /*
   * As useBulkArchiveActions says it: the list's names, in the reader's
   * language, cased as in the middle of a sentence (#7387).
   */
  function bulkTitle(
    language: string,
    copy: ResourceArchiveCopy,
    count: number,
  ): string {
    return dashboardTranslator(language).translatePlural(
      BULK_ARCHIVE_TITLE,
      count,
      {
        itemName: translatableTerm(copy.singularName, { inSentence: true }),
        itemsName: translatableTerm(copy.pluralName, { inSentence: true }),
      },
    );
  }

  test("names the workflows and dashboards in the reader's language", () => {
    expect(bulkTitle("ru", WORKFLOW_ARCHIVE_COPY, 3)).toBe(
      "Архивировать объекты (рабочие процессы): 3?",
    );
    expect(bulkTitle("fr", DASHBOARD_ARCHIVE_COPY, 3)).toBe(
      "Archiver 3 tableaux de bord ?",
    );
    expect(bulkTitle("ko", DASHBOARD_ARCHIVE_COPY, 3)).toBe(
      "대시보드 3개를 보관하시겠습니까?",
    );
    expect(bulkTitle("zh-TW", WORKFLOW_ARCHIVE_COPY, 1)).toBe(
      "要封存 1 個工作流程嗎？",
    );
  });

  test("English reads as before", () => {
    expect(bulkTitle("en", WORKFLOW_ARCHIVE_COPY, 3)).toBe(
      "Archive 3 workflows?",
    );
    expect(bulkTitle("en", DASHBOARD_ARCHIVE_COPY, 1)).toBe(
      "Archive 1 dashboard?",
    );
  });
});

// A title that opens with a small letter: "dienst archiveren".
const STARTS_SMALL: RegExp = /^\p{Ll}/u;

// "vCenter", "iOS": a word with a capital after its first letter keeps its case.
const KEEPS_ITS_CASE: RegExp = /^.+\p{Lu}/u;

describe("the card's title, a heading in every language", () => {
  function title(
    language: string,
    singularName: string,
    isArchived: boolean = false,
  ): string {
    return getArchiveCardWords({
      singularName: singularName,
      isArchived: isArchived,
      copy: {},
      translator: dashboardTranslator(language),
    }).title;
  }

  test("starts with a capital where Dutch puts the name first", () => {
    /*
     * nl words "service" as "service" - its Services list's own noun, not
     * "dienst" (#7387) - and "Archive {{itemName}}" as "{{itemName}} archiveren".
     */
    expect(readDashboardLocale("nl")["service"]).toBe("service");
    expect(title("nl", "service")).toBe("Service archiveren");
    expect(title("nl", "service", true)).toBe("Service uit het archief halen");
  });

  test("keeps a name's own case: vCenter", () => {
    expect(title("nl", "vCenter")).toBe("vCenter archiveren");
    expect(title("de", "vCenter")).toBe("vCenter archivieren");
    expect(title("en", "vCenter")).toBe("Archive vCenter");
  });

  test.each(DASHBOARD_LANGUAGES)(
    "no title in %s opens with a small letter",
    (language: string) => {
      const small: Array<string> = [];
      const names: Array<string> = [
        ...literalCardNames(),
        ...OWN_COPY_KINDS.map(
          ({ copy }: { kind: string; copy: ResourceArchiveCopy }): string => {
            return copy.singularName;
          },
        ),
      ];

      for (const name of names) {
        for (const isArchived of [false, true]) {
          const drawn: string = title(language, name, isArchived);
          const first: string = drawn.split(/\s/)[0]!;

          if (STARTS_SMALL.test(drawn) && !KEEPS_ITS_CASE.test(first)) {
            small.push(drawn);
          }
        }
      }

      expect(small).toEqual([]);
    },
  );
});

describe("the check above, against words nobody has", () => {
  // Without these, a check that passed everything would look the same.
  test("a sentence no locale has is worded in none", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      expect(
        isWordedInDashboardLocale(
          "Archive this {{itemName}} for ever and ever.",
          language,
        ),
      ).toBe(false);
    }
  });

  test("a sentence a language still holds as its English is not worded", () => {
    const english: Record<string, string> = readDashboardLocale("en");
    const german: Record<string, string> = readDashboardLocale("de");

    // German has sentences waiting for a translator: the English in place.
    const waiting: string | undefined = Object.keys(english).find(
      (key: string): boolean => {
        return (
          german[key] === english[key] &&
          key.includes(" ") &&
          !isWordedInDashboardLocale(key, "de")
        );
      },
    );

    expect(waiting).toBeDefined();
    expect(german[waiting!]).toBe(english[waiting!]);
  });

  test("English reads the English as written", () => {
    const english: ArchiveCardWords = getArchiveCardWords({
      singularName: "service",
      isArchived: false,
      copy: {},
      translator: dashboardTranslator("en"),
    });

    expect(english).toEqual({
      title: "Archive service",
      description:
        "Archive this service to hide it from lists while it keeps collecting telemetry. You can unarchive it anytime.",
      confirmMessage:
        "Are you sure you want to archive this service? It will be hidden from the list but will keep collecting telemetry.",
    });
  });
});
