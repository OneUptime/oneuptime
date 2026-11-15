import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE DASHBOARD'S SENTENCES NAME A MAINTENANCE EVENT AS #6817 DOES (#7824).
 *
 * #6817 named the ScheduledMaintenance record "Maintenance Event" ("maintenance
 * event" in a sentence). Its guard reads title case only, so about sixty
 * Dashboard sentences still said "scheduled maintenance event": the empty
 * lists of every resource's Scheduled Maintenance tab, the calendar and its
 * subscribe link, the notification rules' channel names and previews, the
 * numbering settings, the rule pages, the monitoring paused banner, the
 * overview's loading and not-found states and more. Each now says
 * "maintenance event", and each language says it with the word its
 * Dashboard gives the record ("Maintenance Event"): never its old
 * "scheduled" one. The keys are renamed in place, so every locale file
 * keeps en.json's order; the sentences no code wrote any more are gone.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src/Locales",
);

type Locale = Record<string, unknown>;

function readLocale(language: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Locale;
}

// The sentences #7824 renamed, as en.json keys them.
const SENTENCES: ReadonlyArray<string> = [
  "A new maintenance event is created on a resource you own.",
  "All changes made to this maintenance event.",
  "Auto-assign owner users and teams when matching maintenance events are created.",
  "Match maintenance events and add owner users/teams automatically.",
  "No maintenance events for this cluster.",
  "No maintenance events for this host.",
  "No maintenance events for this service.",
  "Select the state to change maintenance events to. Events already at or past the selected state will be skipped.",
  "The state of a maintenance event you own changes.",
  "Maintenance events that are in progress right now. An event leaves this list when it ends.",
  "Forms anyone with the link can fill in, without a OneUptime account. Each submission creates an incident or a maintenance event.",
  "Always required: a maintenance event cannot be created without it.",
  "Each field of the new maintenance event, and where its value comes from: an answer, or a setting of this form.",
  "The short text in front of maintenance event numbers, like SM- in SM-42.",
  "Auto-attach labels to new maintenance events that match, including labels from their monitors and infrastructure.",
  "No maintenance events for this database.",
  "No maintenance events for this fleet.",
  "No maintenance events for this site. Attach this site to an event to exclude its planned downtime from uptime.",
  "No maintenance events for this vCenter.",
  "No status pages selected for this maintenance event.",
  "Only apply this rule to maintenance events with these labels. Leave empty to match events with any labels.",
  "Periodic reminder that a maintenance event you own has not yet finished, based on the project's reminder rules.",
  "Periodically remind maintenance event owners while an event has not yet finished. Rules are evaluated in order — the first matching rule wins.",
  "Status of the monitors will not be changed when this maintenance event starts.",
  "Summarize this maintenance event.",
  "This maintenance event could not be found.",
  "Loading maintenance event",
  "Auto-attach runbooks when matching maintenance events are created.",
  "Match maintenance events and start runbooks automatically.",
  "We are not monitoring this monitor since it is disabled because of an ongoing maintenance event. To enable active monitoring, please end the maintenance event.",
  "Ready-made text for maintenance updates. Pick one when writing a public or private note on a maintenance event, or when changing its state, and edit it before posting.",
  "No monitors affected by this maintenance event.",
  "No other resources affected by this maintenance event.",
  "No maintenance events for this storage array.",
  "Nothing has happened to this maintenance event yet.",
  "For maintenance event {{record}}.",
  "Each new channel is named after its maintenance event. Anything you write here replaces the event's number prefix.",
  "The number the next maintenance event gets. Moving from another tool? Start after its last number, so a number never means two events.",
  "Create a channel for each maintenance event",
  "Creates a channel for each maintenance event.",
  "Creates a channel like {{channel}} for each maintenance event.",
  "Each rule picks the maintenance events it is for, then posts their updates to channels you have, or creates a channel for each event.",
  "Every maintenance event.",
  "The first time a maintenance event matches this rule, OneUptime creates its channel and posts the event's updates there.",
  "Anyone with this link sees every maintenance event in this project. It belongs to the project: treat it like a password, and regenerate it if it is shared by mistake.",
  "Every maintenance event in this project, in Google Calendar, Outlook or Apple Calendar. It keeps itself up to date.",
  "Publish one link for your team. Anyone with it sees every maintenance event in this project, in their own calendar app, kept up to date.",
  "Create, change and delete maintenance events.",
  "Maintenance events, with their states.",
  "Every maintenance event by month, week or day, in your own time zone.",
  "Describe the maintenance event here.",
  "Notify me about maintenance events I own.",
  "Maintenance event",
  "No maintenance events for this cloud.",
  "No maintenance events for this resource.",
  "Have someone approve public notes on maintenance events before customers see them. Off by default: notes are published as soon as they are posted.",
  "A form is a page anyone with its link can fill in, without an account. Each answer creates an incident or a maintenance event.",
  "{{count}} maintenance events carry this label.",
  "{{count}} maintenance events carry this label._one",
];

// The forms page's line in the navigation, a nested key.
const NAVIGATION_PATH: ReadonlyArray<string> = [
  "navbar",
  "items",
  "formsDescription",
];

// Sentences no code wrote any more: gone from every locale.
const STALE: ReadonlyArray<string> = [
  "Manage your scheduled maintenance event settings here.",
  "Control reminder notifications for this scheduled maintenance event.",
  "No resources affected by this scheduled maintenance event.",
  "No conditions: the rule is for every scheduled maintenance event.",
  "Scheduled maintenance events are planned maintenance events that you can use to notify your team and subscribers about upcoming maintenance events.",
  "Auto-attach labels to scheduled maintenance events — including labels inherited from the event's monitors, hosts, Kubernetes clusters, and Docker hosts — when matching events are created.",
  "Add Public Note to this scheduled maintenance",
  "Add Private Note to this scheduled maintenance",
  "Add a public note to this scheduled maintenance. This note will be visible to all subscribers of this scheduled maintenance and will show up on the status page.",
  "Add a private note to this scheduled maintenance. This note will be visible only to the team members of this scheduled maintenance.",
  "Should status page subscribers be notified when this event state changes to ended?",
  "Should status page subscribers be notified when this event state changes to ongoing?",
];

/*
 * Each language's word for the record, as its Dashboard words "Maintenance
 * Event", in any of the forms a sentence takes; and the "scheduled" wording
 * it had before, which none of these sentences may keep.
 */
const LANGUAGES: Record<string, { record: RegExp; scheduled: RegExp }> = {
  en: {
    record: /\b[Mm]aintenance events?\b/,
    scheduled: /\bscheduled maintenance/i,
  },
  de: {
    record: /Wartungsereignis/,
    scheduled: /geplante\S* Wartung/i,
  },
  fr: {
    record: /[ée]v[ée]nements? de maintenance/i,
    scheduled: /maintenances? (?:planifi|programm)/i,
  },
  es: {
    record: /eventos? de mantenimiento/i,
    scheduled: /mantenimientos? (?:programad|planificad)/i,
  },
  it: {
    record: /event[oi] di manutenzione/i,
    scheduled: /manutenzion[ei] (?:pianificat|programmat)/i,
  },
  pt: {
    record: /eventos? de manutenção/i,
    scheduled: /manuten(?:ção|ções) (?:programad|agendad)/i,
  },
  nl: {
    record: /onderhoudsgebeurtenis/i,
    scheduled: /geplande? onderhoud/i,
  },
  da: {
    record: /vedligeholdelseshændelse/i,
    scheduled: /planlagte? vedligehold/i,
  },
  no: {
    record: /vedlikeholdshendelse/i,
    scheduled: /planlagte? vedlikehold/i,
  },
  sv: {
    record: /underhållshändelse/i,
    scheduled: /schemalagd|planerade? underhåll/i,
  },
  ru: {
    record: /[Сс]обыти\S* обслуживания/,
    scheduled:
      /(?:планов|запланированн)\S* (?:событи\S* )?(?:обслуживани|работ)/i,
  },
  ja: {
    record: /メンテナンスイベント/,
    scheduled: /定期メンテナンス|予定されたメンテナンス/,
  },
  ko: {
    record: /유지 관리 이벤트/,
    scheduled: /예정된|예약된/,
  },
  "zh-CN": {
    record: /维护事件/,
    scheduled: /计划维护/,
  },
  "zh-TW": {
    record: /維護事件/,
    scheduled: /排定維護|排程維護|排定的維護/,
  },
  hi: {
    record: /रखरखाव इवेंट/,
    scheduled: /अनुसूचित|निर्धारित|मेंटेनेंस/,
  },
  fa: {
    record: /رویداد(?:های)? تعمیر و نگهداری/,
    scheduled: new RegExp(`زمان${String.fromCharCode(0x200c)}بندی`),
  },
  ar: {
    record: /(?:حدث|أحداث) (?:ال)?صيانة/,
    scheduled: /مجدول/,
  },
};

function nested(locale: Locale, keys: ReadonlyArray<string>): unknown {
  let value: unknown = locale;

  for (const key of keys) {
    value = (value as Locale | undefined)?.[key];
  }

  return value;
}

/*
 * The banner's verb changed with its name: a maintenance event ends, it is
 * not resolved, as its translations and the server's message say.
 */
const OLD_KEYS: Record<string, string> = {
  "We are not monitoring this monitor since it is disabled because of an ongoing maintenance event. To enable active monitoring, please end the maintenance event.":
    "We are not monitoring this monitor since it is disabled because of an ongoing scheduled maintenance event. To enable active monitoring, please resolve the scheduled maintenance event.",
};

// The sentence as it said "scheduled maintenance event" before #7824.
function oldKeyOf(sentence: string): string {
  if (OLD_KEYS[sentence]) {
    return OLD_KEYS[sentence]!;
  }

  if (sentence.startsWith("Maintenance event")) {
    return `Scheduled maintenance event${sentence.slice("Maintenance event".length)}`;
  }

  return sentence
    .split("maintenance event")
    .join("scheduled maintenance event");
}

const ENGLISH: Locale = readLocale("en");

describe("the sentences #7824 renamed", () => {
  test("are en.json's keys, each its own English, and the old ones are gone", () => {
    for (const sentence of SENTENCES) {
      const english: string = sentence.endsWith("_one")
        ? "{{count}} maintenance event carries this label."
        : sentence;

      expect({ sentence, english: ENGLISH[sentence] }).toEqual({
        sentence,
        english,
      });
      expect({
        old: oldKeyOf(sentence),
        kept: oldKeyOf(sentence) in ENGLISH,
      }).toEqual({ old: oldKeyOf(sentence), kept: false });
    }

    expect(nested(ENGLISH, NAVIGATION_PATH)).toBe(
      "Forms anyone can fill in that create incidents or maintenance events.",
    );
  });

  test("the old key is the sentence with the old name (control)", () => {
    expect(oldKeyOf("Maintenance events, with their states.")).toBe(
      "Scheduled maintenance events, with their states.",
    );
    expect(
      oldKeyOf(
        "No maintenance events for this host. No maintenance event is open.",
      ),
    ).toBe(
      "No scheduled maintenance events for this host. No scheduled maintenance event is open.",
    );
    expect(
      oldKeyOf(
        "We are not monitoring this monitor since it is disabled because of an ongoing maintenance event. To enable active monitoring, please end the maintenance event.",
      ),
    ).toBe(
      "We are not monitoring this monitor since it is disabled because of an ongoing scheduled maintenance event. To enable active monitoring, please resolve the scheduled maintenance event.",
    );
  });

  test.each(Object.keys(LANGUAGES))(
    "%s names the record with its own word, never the scheduled one",
    (language: string) => {
      const locale: Locale = readLocale(language);
      const words: { record: RegExp; scheduled: RegExp } = LANGUAGES[language]!;
      const texts: Array<[string, unknown]> = [
        ...SENTENCES.map((sentence: string): [string, unknown] => {
          return [sentence, locale[sentence]];
        }),
        [NAVIGATION_PATH.join("."), nested(locale, NAVIGATION_PATH)],
      ];

      for (const [key, text] of texts) {
        expect({
          language,
          key,
          isText: typeof text === "string",
          namesTheRecord: words.record.test(String(text)),
          saysScheduled: words.scheduled.test(String(text)),
        }).toEqual({
          language,
          key,
          isText: true,
          namesTheRecord: true,
          saysScheduled: false,
        });
      }

      // A translation is its language's, not the English.
      if (language !== "en") {
        for (const sentence of SENTENCES) {
          expect({ language, sentence, value: locale[sentence] }).not.toEqual({
            language,
            sentence,
            value: sentence,
          });
        }
      }
    },
  );

  test("the record and scheduled words tell the new wording from the old (control)", () => {
    expect(
      LANGUAGES["de"]!.scheduled.test("Keine geplanten Wartungsereignisse"),
    ).toBe(true);
    expect(LANGUAGES["de"]!.record.test("Keine Wartungsereignisse")).toBe(true);
    expect(
      LANGUAGES["ru"]!.scheduled.test("событий планового обслуживания"),
    ).toBe(true);
    expect(
      LANGUAGES["ru"]!.scheduled.test(
        "нет запланированных событий обслуживания",
      ),
    ).toBe(true);
    // Planned downtime is not the old name: Russian keeps its "плановый простой".
    expect(LANGUAGES["ru"]!.scheduled.test("её плановый простой")).toBe(false);
    expect(LANGUAGES["ar"]!.scheduled.test("أحداث صيانة مجدولة")).toBe(true);
    expect(
      LANGUAGES["ar"]!.record.test("لا توجد أحداث صيانة لهذا المورد."),
    ).toBe(true);
  });
});

describe("the sentences no code writes any more", () => {
  test.each(Object.keys(LANGUAGES))("are gone from %s", (language: string) => {
    const locale: Locale = readLocale(language);

    expect(
      STALE.filter((sentence: string): boolean => {
        return sentence in locale;
      }),
    ).toEqual([]);
  });
});

/*
 * THE TEXTS COMMON WRITES FOR THE RECORD, WHICH THE DASHBOARD TRANSLATES
 * (#7825): its models' descriptions, a form's fields, the delete question,
 * a manual monitor's explanation, the only state's refusal and a quiet
 * event's Notify Subscribers default. Each said "scheduled maintenance
 * event"; each says "maintenance event" now, renamed in place with its
 * translation in the language's word for the record. The bare noun
 * "scheduled maintenance event" is no key any more: no code looks it up.
 */
const COMMON_SENTENCES: Record<string, string> = {
  "Unticked by default because status page subscribers were not notified when this maintenance event was created.":
    "Unticked by default because status page subscribers were not notified when this scheduled maintenance event was created.",
  "A one-line summary that becomes the maintenance event's title.":
    "A one-line summary that becomes the scheduled maintenance event's title.",
  "Rich text that becomes the maintenance event's description.":
    "Rich text that becomes the scheduled maintenance event's description.",
  "A named duration between two points in a maintenance event's life, computed automatically for every event":
    "A named duration between two points in a scheduled maintenance event's life, computed automatically for every event",
  "Add teams as owners to your maintenance event.":
    "Add teams as owners to your Scheduled Maintenance event.",
  "Add users as owners to your maintenance event.":
    "Add users as owners to your scheduled maintenance event.",
  "Auto-attach runbooks to incidents, alerts, or maintenance events when they are created.":
    "Auto-attach runbooks to incidents, alerts, or scheduled maintenance events when they are created.",
  "Change state of your maintenance event.":
    "Change state of your scheduled maintenance event.",
  "Configure reminder rules to periodically notify maintenance event owners while an event is still not complete":
    "Configure reminder rules to periodically notify scheduled maintenance event owners while an event is still not complete",
  "Configure rules for automatically assigning owner users and teams when matching maintenance events are created":
    "Configure rules for automatically assigning owner users and teams when matching scheduled maintenance events are created",
  "Configure rules for automatically attaching labels to maintenance events — including labels inherited from the event's monitors — when matching events are created":
    "Configure rules for automatically attaching labels to scheduled maintenance events — including labels inherited from the event's monitors — when matching events are created",
  "Forms anyone with the link can fill in, without a OneUptime account. Each submission creates an incident or a maintenance event in this project.":
    "Forms anyone with the link can fill in, without a OneUptime account. Each submission creates an incident or a scheduled maintenance event in this project.",
  "The computed value of one measurement for one maintenance event. Written by OneUptime, never edited by hand.":
    "The computed value of one measurement for one scheduled maintenance event. Written by OneUptime, never edited by hand.",
  "The submissions made through this project's forms: every answer, the name and email the submitter gave, and the incident or maintenance event each one created.":
    "The submissions made through this project's forms: every answer, the name and email the submitter gave, and the incident or scheduled maintenance event each one created.",
  "Deleting a maintenance event also deletes its notes and state timeline, and takes it off status pages.":
    "Deleting a scheduled maintenance event also deletes its notes and state timeline, and takes it off status pages.",
  "The event's only state can't be deleted: a maintenance event always has a state. To change it, add a new state.":
    "The event's only state can't be deleted: a scheduled maintenance event always has a state. To change it, add a new state.",
  "The team's calendar link that puts every maintenance event of the project in a calendar app.":
    "The team's calendar link that puts every scheduled maintenance event of the project in a calendar app.",
  "Manual monitor: OneUptime runs no checks. The status changes when someone sets it, or when an incident or maintenance event changes it.":
    "Manual monitor: OneUptime runs no checks. The status changes when someone sets it, or when an incident or scheduled maintenance event changes it.",
  "List of Docker hosts to pre-populate on maintenance events created from this template.":
    "List of Docker hosts to pre-populate on scheduled maintenance events created from this template.",
  "List of Kubernetes clusters to pre-populate on maintenance events created from this template.":
    "List of Kubernetes clusters to pre-populate on scheduled maintenance events created from this template.",
  "List of Podman hosts to pre-populate on maintenance events created from this template.":
    "List of Podman hosts to pre-populate on scheduled maintenance events created from this template.",
  "List of services to pre-populate on maintenance events created from this template.":
    "List of services to pre-populate on scheduled maintenance events created from this template.",
};

const RETIRED_NOUN: string = "scheduled maintenance event";

// The Delete question's sentence, which the Admin Dashboard says too.
const DELETE_SENTENCE: string =
  "Deleting a maintenance event also deletes its notes and state timeline, and takes it off status pages.";

const ADMIN_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../FeatureSet/AdminDashboard/src/Locales",
);

const STATUS_PAGE_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../FeatureSet/StatusPage/src/Locales",
);

function readLocaleIn(directory: string, language: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(directory, `${language}.json`), "utf8"),
  ) as Locale;
}

describe("the texts Common writes for the record (#7825)", () => {
  test("are en.json's keys, each its own English, and the old ones are gone", () => {
    for (const [sentence, old] of Object.entries(COMMON_SENTENCES)) {
      expect({ sentence, english: ENGLISH[sentence] }).toEqual({
        sentence,
        english: sentence,
      });
      expect({ old, kept: old in ENGLISH }).toEqual({ old, kept: false });
    }

    expect(RETIRED_NOUN in ENGLISH).toBe(false);
  });

  test.each(Object.keys(LANGUAGES))(
    "%s names the record with its own word, never the scheduled one",
    (language: string) => {
      const locale: Locale = readLocale(language);
      const words: { record: RegExp; scheduled: RegExp } = LANGUAGES[language]!;

      for (const [sentence, old] of Object.entries(COMMON_SENTENCES)) {
        const text: unknown = locale[sentence];

        expect({
          language,
          sentence,
          isText: typeof text === "string",
          namesTheRecord: words.record.test(String(text)),
          saysScheduled: words.scheduled.test(String(text)),
          isTheEnglish: language !== "en" && text === sentence,
          keepsTheOldKey: old in locale,
        }).toEqual({
          language,
          sentence,
          isText: true,
          namesTheRecord: true,
          saysScheduled: false,
          isTheEnglish: false,
          keepsTheOldKey: false,
        });
      }

      expect({ language, keepsTheNoun: RETIRED_NOUN in locale }).toEqual({
        language,
        keepsTheNoun: false,
      });
    },
  );

  test.each(Object.keys(LANGUAGES))(
    "%s: the Admin Dashboard's Delete question says what the Dashboard's does",
    (language: string) => {
      const admin: Locale = readLocaleIn(ADMIN_LOCALES_DIR, language);

      expect({
        sentence: admin[DELETE_SENTENCE],
        keepsTheOldKey: COMMON_SENTENCES[DELETE_SENTENCE]! in admin,
      }).toEqual({
        sentence: readLocale(language)[DELETE_SENTENCE],
        keepsTheOldKey: false,
      });
    },
  );

  /*
   * A status page's uptime strip counts a day's maintenance in the page's
   * own keys, with the word its maintenance event pages use
   * (scheduledEvents.singular): "1 Wartungsereignis", never "1 geplante
   * Wartung".
   */
  test.each(Object.keys(LANGUAGES))(
    "%s: a status page's uptime strip counts maintenance events by the record's word",
    (language: string) => {
      const statusPage: Locale = readLocaleIn(
        STATUS_PAGE_LOCALES_DIR,
        language,
      );
      const words: { record: RegExp; scheduled: RegExp } = LANGUAGES[language]!;
      const record: string = String(
        nested(statusPage, ["scheduledEvents", "singular"]),
      ).toLowerCase();
      const one: string = String(
        nested(statusPage, ["uptimeHistory", "oneMaintenanceEvent"]),
      );
      const many: string = String(
        nested(statusPage, ["uptimeHistory", "maintenanceEvents"]),
      );

      expect({
        language,
        oneSaysThePagesWord: one.toLowerCase().includes(record),
        namesTheRecord: [words.record.test(one), words.record.test(many)],
        saysScheduled: [words.scheduled.test(one), words.scheduled.test(many)],
        countsThem: many.includes("{{total}}"),
      }).toEqual({
        language,
        oneSaysThePagesWord: true,
        namesTheRecord: [true, true],
        saysScheduled: [false, false],
        countsThem: true,
      });
    },
  );
});
