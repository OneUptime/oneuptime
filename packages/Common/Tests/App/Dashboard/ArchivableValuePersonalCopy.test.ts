import Entities from "../../../Models/DatabaseModels/Index";
import ArchivableValueUsage, {
  ValueReference,
} from "../../../Server/Utils/Database/ArchivableValueUsage";
import { ArchivableValueUsageKind } from "../../../Types/ArchivableValue/ArchivableValueUsage";
import {
  ARCHIVABLE_VALUE_TABLE_NAMES,
  ArchivableValueDefinition,
  getArchivableValueByTableName,
} from "../../../Utils/ArchivableValues";
import {
  PERSONAL_USAGE_ITEMS,
  PERSONAL_USAGE_NOTES,
  PersonalUsageNote,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ArchivableValue/ArchivableValueCopy";
import { getOwnSettingsRoute } from "../../../../App/FeatureSet/Dashboard/src/Components/ArchivableValue/UseArchivableValues";
import { DataSource } from "typeorm";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * PEOPLE'S OWN SETTINGS THAT NAME A VALUE HAVE WORDS OF THEIR OWN.
 *
 * The usage counter calls a table whose rows belong to one person
 * (@CurrentUserCanAccessRecordBy) people's own settings, counted by person
 * (ArchivableValueUsageKind.Personal): a member's on-call rules for a
 * severity, their notification settings for a security case priority. The
 * dialogs say them as whose they are - "On-call rules of 11 people", and in
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
        });
      }
    }
  }

  return uses;
};

describe("people's own settings that name a value", () => {
  test("the models declare some: the on-call rules and notification settings", () => {
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
      PERSONAL_USAGE_NOTES["IncidentSeverity:UserNotificationRule"]!.sentence
        .other,
    ).toBe(
      "{{count}} people have on-call rules for this severity. They stay as they are, so incidents with it still page them.",
    );
    expect(
      PERSONAL_USAGE_NOTES["AlertSeverity:UserNotificationRule"]!.sentence
        .other,
    ).toBe(
      "{{count}} people have on-call rules for this severity. They stay as they are, so alerts with it still page them.",
    );
  });
});
