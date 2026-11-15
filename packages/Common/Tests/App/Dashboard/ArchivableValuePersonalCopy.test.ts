import Entities from "../../../Models/DatabaseModels/Index";
import ArchivableValueUsage, {
  ValueReference,
} from "../../../Server/Utils/Database/ArchivableValueUsage";
import {
  ArchivableValueDeleteEffect,
  ArchivableValueUsageItem,
  ArchivableValueUsageKind,
} from "../../../Types/ArchivableValue/ArchivableValueUsage";
import {
  ARCHIVABLE_VALUE_TABLE_NAMES,
  ArchivableValueDefinition,
  getArchivableValueByTableName,
} from "../../../Utils/ArchivableValues";
import {
  PERSONAL_USAGE_ITEMS,
  PERSONAL_USAGE_NOTES,
  PERSONAL_USAGE_NOTE_FALLBACK,
  PersonalUsageNote,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ArchivableValue/ArchivableValueCopy";
import { getUsageItemText } from "../../../../App/FeatureSet/Dashboard/src/Components/ArchivableValue/ArchivableValueUsageList";
import {
  UsageGroup,
  getDeleteDialogGroups,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ArchivableValue/ArchivableValueUsageText";
import {
  PluralTemplate,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import { getOwnSettingsRoute } from "../../../../App/FeatureSet/Dashboard/src/Components/ArchivableValue/UseArchivableValues";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
} from "../../Helpers/DashboardLocales";
import { DataSource } from "typeorm";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * PEOPLE'S OWN SETTINGS THAT NAME A VALUE HAVE WORDS OF THEIR OWN.
 *
 * The usage counter calls a table whose rows belong to one person
 * (@CurrentUserCanAccessRecordBy) people's own settings, counted by person
 * (ArchivableValueUsageKind.Personal): a member's rules for a severity in
 * How to Reach Me, their notification settings for a security case
 * priority. The dialogs say them as what they are and whose - "11 people's
 * rules in How to Reach Me" (they were "On-call rules of 11 people" until
 * #6817 gave the name to the project's rules alone, then "11 people's How
 * to Reach Me", which read as if the whole page went, until #7816) - and in
 * the Archive dialog what stays and where to see your own. This holds every
 * such table the models declare, for every kind of value, to its words in
 * the Dashboard, and the words to tables that are really people's own: a
 * model that starts naming a value from a person's own table fails here
 * until it is said properly, instead of reading "Own settings of 2 people".
 */

let dataSource: DataSource;

// What a note says happens to people's own settings: they stay.
const STAYS: RegExp = /stays? as (it|they) (is|are)/;

beforeAll(async () => {
  dataSource = new DataSource({
    type: "postgres",
    entities: Entities,
    synchronize: false,
  });

  await (
    dataSource as unknown as { buildMetadatas: () => Promise<void> }
  ).buildMetadatas();
});

interface PersonalUse {
  // "IncidentSeverity:UserNotificationRule", as PERSONAL_USAGE_NOTES keys it.
  key: string;
  recordTable: string;
  // Its model's names: "Notification Rules", "Notification Rule".
  title: string;
  singularTitle: string;
  // What deleting the value does to the rows, by their foreign key.
  effect: ArchivableValueDeleteEffect;
}

const personalUses: () => Array<PersonalUse> = (): Array<PersonalUse> => {
  const uses: Array<PersonalUse> = [];

  for (const valueTable of ARCHIVABLE_VALUE_TABLE_NAMES) {
    const definition: ArchivableValueDefinition | null =
      getArchivableValueByTableName(valueTable);

    for (const reference of ArchivableValueUsage.getReferences({
      dataSource,
      valueTable,
    }) as Array<ValueReference>) {
      if (reference.kind === ArchivableValueUsageKind.Personal) {
        uses.push({
          key: `${definition!.type}:${reference.recordTable}`,
          recordTable: reference.recordTable,
          title: reference.title,
          singularTitle: reference.singularTitle,
          effect: reference.effect,
        });
      }
    }
  }

  return uses;
};

// The use as the server sends it to the dialogs: `count` people.
const usageItemOf: (
  use: PersonalUse,
  count: number,
) => ArchivableValueUsageItem = (
  use: PersonalUse,
  count: number,
): ArchivableValueUsageItem => {
  return {
    tableName: use.recordTable,
    title: use.title,
    singularTitle: use.singularTitle,
    count: count,
    isCountCapped: false,
    effect: use.effect,
    kind: ArchivableValueUsageKind.Personal,
  };
};

/*
 * What a person's own rows are, as their model calls them: the last word of
 * its plural name - "Notification Rules" are rules, "Notification Settings"
 * settings.
 */
const rowsWord: (title: string) => string = (title: string): string => {
  return (title.split(" ").pop() || title).toLowerCase();
};

describe("people's own settings that name a value", () => {
  test("the models declare some: How to Reach Me's rules and notification settings", () => {
    expect(
      personalUses()
        .map((use: PersonalUse): string => {
          return use.key;
        })
        .sort(),
    ).toEqual([
      "AlertSeverity:UserNotificationRule",
      "IncidentSeverity:UserNotificationRule",
      "SecurityCasePriority:UserNotificationSetting",
    ]);
  });

  test("each table of them is named as whose it is, in a list", () => {
    for (const use of personalUses()) {
      expect({
        table: use.recordTable,
        item: PERSONAL_USAGE_ITEMS[use.recordTable],
      }).toEqual({
        table: use.recordTable,
        item: {
          one: expect.stringContaining("{{count}} person"),
          other: expect.stringContaining("{{count}} people"),
        },
      });
    }
  });

  test("each, for its kind of value, says what stays - with a link to the reader's own", () => {
    for (const use of personalUses()) {
      const note: PersonalUsageNote | undefined = PERSONAL_USAGE_NOTES[use.key];

      expect({ key: use.key, hasNote: Boolean(note) }).toEqual({
        key: use.key,
        hasNote: true,
      });

      expect(note!.sentence.one).toContain("{{count}} person");
      expect(note!.sentence.other).toContain("{{count}} people");
      // What happens to them: they stay.
      expect(note!.sentence.other).toMatch(STAYS);

      const [type] = use.key.split(":");

      expect(
        getOwnSettingsRoute(
          type as Parameters<typeof getOwnSettingsRoute>[0],
          use.recordTable,
        ),
      ).not.toBeNull();
    }
  });

  test("the words are for tables that really are people's own, and nothing else", () => {
    const uses: Array<PersonalUse> = personalUses();

    for (const table of Object.keys(PERSONAL_USAGE_ITEMS)) {
      expect({
        table,
        declared: uses.some((use: PersonalUse): boolean => {
          return use.recordTable === table;
        }),
      }).toEqual({ table, declared: true });
    }

    for (const key of Object.keys(PERSONAL_USAGE_NOTES)) {
      expect({
        key,
        declared: uses.some((use: PersonalUse): boolean => {
          return use.key === key;
        }),
      }).toEqual({ key, declared: true });
    }
  });

  test("a severity's note says what its records keep doing: paging people", () => {
    expect(
      PERSONAL_USAGE_NOTES["IncidentSeverity:UserNotificationRule"]!.sentence,
    ).toEqual({
      one: "{{count}} person has rules for this severity in How to Reach Me. Those rules stay as they are, so incidents with it still page them.",
      other:
        "{{count}} people have rules for this severity in How to Reach Me. Those rules stay as they are, so incidents with it still page them.",
    });
    expect(
      PERSONAL_USAGE_NOTES["AlertSeverity:UserNotificationRule"]!.sentence,
    ).toEqual({
      one: "{{count}} person has rules for this severity in How to Reach Me. Those rules stay as they are, so alerts with it still page them.",
      other:
        "{{count}} people have rules for this severity in How to Reach Me. Those rules stay as they are, so alerts with it still page them.",
    });
  });

  /*
   * The UI review: "They stay as they are, so incidents with it still page
   * them" read "They" as the people, the sentence before's last subject.
   * Every note says whose its rules are - the people's own, not the
   * project's rules the dialog lists above it - and names what stays.
   */
  test("every note says the settings are people's own, and names what stays rather than a bare They", () => {
    const notes: Array<PluralTemplate> = [
      ...Object.values(PERSONAL_USAGE_NOTES).map(
        (note: PersonalUsageNote): PluralTemplate => {
          return note.sentence;
        },
      ),
      PERSONAL_USAGE_NOTE_FALLBACK,
    ];

    for (const note of notes) {
      for (const sentence of [note.one, note.other]) {
        expect({ sentence, bareThey: sentence.includes(". They ") }).toEqual({
          sentence,
          bareThey: false,
        });
      }
    }

    for (const key of [
      "IncidentSeverity:UserNotificationRule",
      "AlertSeverity:UserNotificationRule",
    ]) {
      const note: PersonalUsageNote = PERSONAL_USAGE_NOTES[key]!;

      // How to Reach Me is each person's own page, never the project's rules.
      expect(note.sentence.other).toContain("in How to Reach Me");
      expect(note.sentence.one).toContain("in How to Reach Me");
      expect(note.sentence.other).toContain("Those rules stay as they are");
    }

    expect(
      PERSONAL_USAGE_NOTES["SecurityCasePriority:UserNotificationSetting"]!
        .sentence.other,
    ).toContain("Their settings stay as they are");
  });
});

/*
 * THE DELETE DIALOG'S LINE NAMES THE ROWS THAT GO, NOT THE PAGE (#7816).
 *
 * Deleting a severity listed "Deleted with it: 2 people's How to Reach Me".
 * The page the people's rules are kept on stood where the rules were, and
 * read as if their whole How to Reach Me went. Only each person's rules for
 * that severity go (ON DELETE CASCADE); their other rules, their
 * notification methods and the rest of the page stay.
 *
 * Every kind of value, and a single and a bulk Delete alike, draw the line
 * from one table's words (getDeleteDialogGroups and getUsageItemText), so it
 * is held here, where the list is built: for every personal use the models
 * declare, with the effect its foreign key really has, the line names the
 * rows a delete takes or changes, as their model calls them, then whose.
 */
describe("the Delete dialog's line for people's own settings", () => {
  const ENGLISH: Translator = dashboardTranslator("en");

  interface DeleteLine {
    // What happens to them: the group the line is listed under.
    labels: Array<string>;
    one: string;
    other: string;
  }

  test("each names the rows a delete takes or changes, under what happens to them", () => {
    const lines: Record<string, DeleteLine> = {};

    for (const use of personalUses()) {
      lines[use.key] = {
        labels: getDeleteDialogGroups([usageItemOf(use, 2)]).map(
          (group: UsageGroup): string => {
            return group.label;
          },
        ),
        one: getUsageItemText(usageItemOf(use, 1), ENGLISH),
        other: getUsageItemText(usageItemOf(use, 2), ENGLISH),
      };
    }

    const severityRules: DeleteLine = {
      labels: ["Deleted with it"],
      one: "1 person's rules in How to Reach Me",
      other: "2 people's rules in How to Reach Me",
    };

    expect(lines).toEqual({
      "AlertSeverity:UserNotificationRule": severityRules,
      "IncidentSeverity:UserNotificationRule": severityRules,
      "SecurityCasePriority:UserNotificationSetting": {
        labels: ["Cleared on"],
        one: "Notification settings of 1 person",
        other: "Notification settings of 2 people",
      },
    });
  });

  test("a table that starts naming a value is held to it too: its line says what its rows are, by its model's own name", () => {
    for (const use of personalUses()) {
      for (const count of [1, 2, 11]) {
        const line: string = getUsageItemText(usageItemOf(use, count), ENGLISH);

        expect({
          key: use.key,
          line,
          namesItsRows: line.toLowerCase().includes(rowsWord(use.title)),
        }).toEqual({ key: use.key, line, namesItsRows: true });
      }
    }
  });

  /*
   * Each language's word for those rules, as its Archive sentence about
   * them says it ("2 people have rules for this severity in How to Reach
   * Me."), so the two dialogs call them the same.
   */
  const RULES_WORD: Record<string, string> = {
    en: "rules",
    ar: "قواعد",
    da: "regler",
    de: "regeln",
    es: "reglas",
    fa: "قواعد",
    fr: "règles",
    hi: "नियम",
    it: "regole",
    ja: "ルール",
    ko: "규칙",
    nl: "regels",
    no: "regler",
    pt: "regras",
    ru: "правил",
    sv: "regler",
    "zh-CN": "规则",
    "zh-TW": "規則",
  };

  const LANGUAGES: Array<string> = ["en", ...DASHBOARD_LANGUAGES];

  test("every Dashboard language has its word for the rules", () => {
    expect(Object.keys(RULES_WORD).sort()).toEqual([...LANGUAGES].sort());
  });

  test.each(LANGUAGES)(
    "%s names people's rules in How to Reach Me, in the word its Archive sentence uses",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const word: string = RULES_WORD[language]!;
      const page: string =
        translator.translateText("How to Reach Me") || "How to Reach Me";
      const rules: PersonalUse = personalUses().find(
        (use: PersonalUse): boolean => {
          return use.key === "IncidentSeverity:UserNotificationRule";
        },
      )!;

      const archive: string = translator.translatePlural(
        PERSONAL_USAGE_NOTES[rules.key]!.sentence,
        2,
        { count: translator.formatNumber(2) },
      );

      expect(archive.toLowerCase()).toContain(word);

      for (const count of [1, 2]) {
        const line: string = getUsageItemText(
          usageItemOf(rules, count),
          translator,
        );

        expect({
          language,
          count,
          line,
          namesTheRules: line.toLowerCase().includes(word),
          namesThePage: line.includes(page),
        }).toEqual({
          language,
          count,
          line,
          namesTheRules: true,
          namesThePage: true,
        });
      }
    },
  );
});
