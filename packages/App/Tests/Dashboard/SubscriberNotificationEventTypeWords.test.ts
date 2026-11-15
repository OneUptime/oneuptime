import {
  SUBSCRIBER_NOTIFICATION_EVENT_TYPE_LABELS,
  getSubscriberNotificationEventTypeLabel,
  getSubscriberNotificationEventTypeOptions,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/SubscriberNotificationEventTypeOptions";
import {
  MAINTENANCE_EVENT_WORDS,
  MaintenanceEventWords,
} from "./MaintenanceEventWords";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A SUBSCRIBER TEMPLATE'S EVENT TYPE IN EVERY DASHBOARD LANGUAGE (#8179).
 *
 * The Dashboard drew a template's event type as it is stored ("Subscriber
 * Incident Note Created") in every language. Each is now a key of the
 * Dashboard's locales (SUBSCRIBER_NOTIFICATION_EVENT_TYPE_LABELS): English
 * reads the name the API and Terraform take, and every other language
 * words the event, with the words its Dashboard names the record by - an
 * incident, an announcement, a maintenance event (#7982) - so a German
 * reader sees "Wartungsereignis erstellt" where the maintenance list says
 * "Wartungsereignis". The stored values stay as they are.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src/Locales",
);

const localeCache: Map<string, Record<string, unknown>> = new Map();

function locale(language: string): Record<string, unknown> {
  if (!localeCache.has(language)) {
    localeCache.set(
      language,
      JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
      ) as Record<string, unknown>,
    );
  }

  return localeCache.get(language)!;
}

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json") && file !== "en.json";
  })
  .map((file: string): string => {
    return file.replace(/\.json$/, "");
  })
  .sort();

const EVENT_TYPES: Array<StatusPageSubscriberNotificationEventType> =
  Object.values(StatusPageSubscriberNotificationEventType);

// The stored names' first word, which no language but English keeps.
const SUBSCRIBER_WORD: RegExp = /\bSubscriber\b/;

const T: typeof StatusPageSubscriberNotificationEventType =
  StatusPageSubscriberNotificationEventType;

// The event types that name each record, by the Dashboard key that names it.
const RECORDS: Record<
  string,
  ReadonlyArray<StatusPageSubscriberNotificationEventType>
> = {
  Incident: [
    T.SubscriberIncidentCreated,
    T.SubscriberIncidentStateChanged,
    T.SubscriberIncidentNoteCreated,
    T.SubscriberIncidentNoteUpdated,
    T.SubscriberIncidentPostmortemPublished,
  ],
  "Incident Episode": [
    T.SubscriberEpisodeCreated,
    T.SubscriberEpisodeStateChanged,
    T.SubscriberEpisodeNoteCreated,
    T.SubscriberEpisodeNoteUpdated,
  ],
  Announcement: [
    T.SubscriberAnnouncementCreated,
    T.SubscriberAnnouncementUpdated,
  ],
};

const MAINTENANCE_EVENT_TYPES: ReadonlyArray<StatusPageSubscriberNotificationEventType> =
  [
    T.SubscriberScheduledMaintenanceCreated,
    T.SubscriberScheduledMaintenanceStateChanged,
    T.SubscriberScheduledMaintenanceNoteCreated,
    T.SubscriberScheduledMaintenanceNoteUpdated,
  ];

/*
 * A text as its words are compared: lower case, and without Arabic's
 * article, which a noun takes as its phrase needs ("حالة حلقة الحوادث", the
 * episode's state, beside the Dashboard's "حلقة حوادث").
 */
function comparable(text: string): string {
  return text.toLocaleLowerCase().replace(/(^|\s)ال/g, "$1");
}

// A word's stem: its last letter left off, so an inflected form still holds it.
function stemOf(word: string): string {
  const letters: Array<string> = Array.from(comparable(word));

  return letters.slice(0, Math.max(1, letters.length - 1)).join("");
}

function drawn(
  language: string,
  eventType: StatusPageSubscriberNotificationEventType,
): string {
  return locale(language)[
    SUBSCRIBER_NOTIFICATION_EVENT_TYPE_LABELS[eventType]
  ] as string;
}

describe("a template's event type is a key of its own", () => {
  test("every event type has one, the name it is stored by", () => {
    expect(
      Object.keys(SUBSCRIBER_NOTIFICATION_EVENT_TYPE_LABELS).sort(),
    ).toEqual([...EVENT_TYPES].sort());

    for (const eventType of EVENT_TYPES) {
      expect(SUBSCRIBER_NOTIFICATION_EVENT_TYPE_LABELS[eventType]).toBe(
        eventType,
      );
      expect(getSubscriberNotificationEventTypeLabel(eventType)).toBe(
        eventType,
      );
    }
  });

  test("the menus offer every event type, in its order, as a key looked up in the reader's language", () => {
    const options: Array<DropdownOption> =
      getSubscriberNotificationEventTypeOptions();

    expect(
      options.map((option: DropdownOption): unknown => {
        return option.value;
      }),
    ).toEqual(EVENT_TYPES);

    for (const option of options) {
      // Looked up, never drawn as written.
      expect(option.isUserContent).toBeFalsy();
      expect(option.label).toBe(option.value);
    }
  });

  test("an event type this Dashboard does not know has no key, and an empty one none", () => {
    expect(getSubscriberNotificationEventTypeLabel("Report")).toBeNull();
    expect(
      getSubscriberNotificationEventTypeLabel("Subscriber Status Changed"),
    ).toBeNull();
    expect(getSubscriberNotificationEventTypeLabel(undefined)).toBeNull();
    expect(getSubscriberNotificationEventTypeLabel(null)).toBeNull();
    expect(getSubscriberNotificationEventTypeLabel("")).toBeNull();
  });

  test("English reads each as the API and Terraform name it", () => {
    for (const eventType of EVENT_TYPES) {
      expect(drawn("en", eventType)).toBe(eventType);
    }
  });
});

describe.each(LANGUAGES)("%s words each event type", (language: string) => {
  test("in words of its own, a different one for each event", () => {
    const words: Array<string> = EVENT_TYPES.map(
      (eventType: StatusPageSubscriberNotificationEventType): string => {
        return drawn(language, eventType);
      },
    );

    for (const [index, eventType] of EVENT_TYPES.entries()) {
      expect({ eventType, word: typeof words[index] }).toEqual({
        eventType,
        word: "string",
      });
      expect({ eventType, inEnglish: words[index] === eventType }).toEqual({
        eventType,
        inEnglish: false,
      });
      // No word of the stored name is left in English.
      expect({
        eventType,
        says: SUBSCRIBER_WORD.test(words[index]!),
      }).toEqual({ eventType, says: false });
    }

    expect(new Set<string>(words).size).toBe(EVENT_TYPES.length);
  });

  test("naming each record by the word its Dashboard names it by", () => {
    for (const [recordKey, eventTypes] of Object.entries(RECORDS)) {
      const record: string = locale(language)[recordKey] as string;
      // An episode is the incident's: its word, or the incident's beside "Episode".
      const stems: Array<string> =
        recordKey === "Incident Episode"
          ? [stemOf(record), stemOf(locale(language)["Episode"] as string)]
          : [stemOf(record)];

      for (const eventType of eventTypes) {
        const word: string = comparable(drawn(language, eventType));

        expect({
          eventType,
          record,
          holds: stems.some((stem: string): boolean => {
            return word.includes(stem);
          }),
        }).toEqual({ eventType, record, holds: true });
      }
    }
  });

  test("and a maintenance event by its record word, never another (#7982)", () => {
    const words: MaintenanceEventWords = MAINTENANCE_EVENT_WORDS[language]!;

    for (const eventType of MAINTENANCE_EVENT_TYPES) {
      const word: string = drawn(language, eventType);

      expect({
        eventType,
        word,
        record: words.record.test(word),
        other: words.otherRecord?.test(word) ?? false,
      }).toEqual({ eventType, word, record: true, other: false });
    }
  });
});

describe("the words are told apart (control)", () => {
  test("a stem holds an inflected form", () => {
    expect(stemOf("Incidente")).toBe("incident");
    expect("estado del incidente cambiado".includes(stemOf("Incidente"))).toBe(
      true,
    );
    expect("أُنشئت ملاحظة حادثة".includes(stemOf("حادثة"))).toBe(true);
    expect("инцидент создан".includes(stemOf("Инцидент"))).toBe(true);
    expect("anuncio creado".includes(stemOf("Incidente"))).toBe(false);
  });

  test("the German words are the Dashboard's", () => {
    expect(drawn("de", T.SubscriberIncidentNoteCreated)).toBe(
      "Vorfallsnotiz erstellt",
    );
    expect(drawn("de", T.SubscriberScheduledMaintenanceCreated)).toBe(
      "Wartungsereignis erstellt",
    );
    expect(drawn("de", T.SubscriberReport)).toBe("Bericht für Abonnenten");
    expect(drawn("fa", T.SubscriberAnnouncementUpdated)).toBe(
      "اطلاعیه به‌روزرسانی شد",
    );
  });
});
