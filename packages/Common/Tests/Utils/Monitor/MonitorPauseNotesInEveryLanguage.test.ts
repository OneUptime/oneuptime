import { Translator } from "../../../Types/Translator";
import {
  BACK_IN_STATUS_OF_INCIDENT,
  BACK_IN_STATUS_OF_MAINTENANCE,
  MONITORING_PAUSED_BY_INCIDENTS,
  MONITORING_PAUSED_BY_INCIDENTS_AND_MAINTENANCE,
  MONITORING_PAUSED_FOR_MAINTENANCE,
  MONITORING_RESUMED,
  PAUSING_INCIDENTS_SET_STATUS,
  PAUSING_MAINTENANCE_SETS_STATUS,
  getStatusChangeNotePlaceholders,
  readStatusChangeNote,
  wordStatusChangeNote,
  writeStatusChangeNote,
} from "../../../Utils/Monitor/StatusChangeNotes";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { describe, expect, test } from "@jest/globals";

/*
 * THE NOTES A PAUSE WRITES, AND THE BAND NOTES OF THE EVALUATION LOG, IN
 * EVERY LANGUAGE THE DASHBOARD SHIPS (issues #11141, #11301, #11349).
 *
 * A monitor's Status Timeline marks where a pause by an incident declared
 * by hand or by scheduled maintenance starts leaving its time out of uptime,
 * and where it counts again (MonitorIncidentPause), and says why a monitor
 * went back to the status of what still pauses it. The server writes each
 * note in English, once; View Cause reads it back by its template
 * (StatusChangeNotes) and words it in the reader's language, the links in
 * it kept as written. The evaluation log's sentences for a series one band
 * left to another (MonitorResource.getLeftToEarlierBandEvent) are worded the
 * same way, from the sentence the check stored.
 *
 * Here each is read from the locale files as the Dashboard ships them.
 */

const INCIDENT_LINK: string = "[INC-12](https://oneuptime.example/incidents/1)";
const EVENT_LINK: string =
  "[SM-3](https://oneuptime.example/scheduled-maintenance/1)";

// Each note, with the links it is written with.
const PAUSE_NOTES: ReadonlyArray<[string, Record<string, string>]> = [
  [MONITORING_PAUSED_BY_INCIDENTS, { incidents: INCIDENT_LINK }],
  [MONITORING_PAUSED_FOR_MAINTENANCE, { events: EVENT_LINK }],
  [
    MONITORING_PAUSED_BY_INCIDENTS_AND_MAINTENANCE,
    { incidents: INCIDENT_LINK, events: EVENT_LINK },
  ],
  [PAUSING_INCIDENTS_SET_STATUS, { incidents: INCIDENT_LINK }],
  [PAUSING_MAINTENANCE_SETS_STATUS, { events: EVENT_LINK }],
  [MONITORING_RESUMED, {}],
  [BACK_IN_STATUS_OF_INCIDENT, { incident: INCIDENT_LINK }],
  [BACK_IN_STATUS_OF_MAINTENANCE, { event: EVENT_LINK }],
];

// The evaluation log's sentences for a series left to an earlier band.
const BAND_SENTENCES: ReadonlyArray<string> = [
  'Alert left to "{{criteria}}"',
  'Incident left to "{{criteria}}"',
  'Skipped creating an alert for this series ({{series}}) because "{{criteria}}", listed before this criteria, checks the same thing and matched it too. A series in two bands of one check gets one alert, from the first.',
  'Skipped creating an alert because "{{criteria}}", listed before this criteria, checks the same thing and matched too. Two bands of one check open one alert, from the first.',
  'Skipped creating an incident for this series ({{series}}) because "{{criteria}}", listed before this criteria, checks the same thing and matched it too. A series in two bands of one check gets one incident, from the first.',
  'Skipped creating an incident because "{{criteria}}", listed before this criteria, checks the same thing and matched too. Two bands of one check open one incident, from the first.',
];

describe("the pause and band notes in English", () => {
  test("each pause note is read back as itself, its links as its values", () => {
    for (const [note, values] of PAUSE_NOTES) {
      const read: ReturnType<typeof readStatusChangeNote> =
        readStatusChangeNote(writeStatusChangeNote(note, values));

      expect({ note: read?.note.written, values: read?.values }).toEqual({
        note: note,
        values: values,
      });
    }
  });

  test("English reads each note as written", () => {
    const english: Translator = dashboardTranslator("en");

    for (const [note, values] of PAUSE_NOTES) {
      const stored: string = writeStatusChangeNote(note, values);

      expect(
        withoutIsolateMarks(wordStatusChangeNote(stored, english) || ""),
      ).toBe(stored);
    }
  });

  test("every note and sentence is a key of the English locale", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const key of [
      ...PAUSE_NOTES.map(([note]: [string, Record<string, string>]) => {
        return note;
      }),
      ...BAND_SENTENCES,
    ]) {
      expect({ key, value: english[key] }).toEqual({ key, value: key });
    }
  });
});

describe.each(DASHBOARD_LANGUAGES)(
  "in %s, from the Dashboard's own locale",
  (language: string) => {
    const translator: Translator = dashboardTranslator(language);
    const words: Record<string, string> = readDashboardLocale(language);

    test.each(
      PAUSE_NOTES.map(
        ([note, values]: [string, Record<string, string>]): [
          string,
          Record<string, string>,
        ] => {
          return [note, values];
        },
      ),
    )(
      "%s reads in the reader's words, its links as written",
      (note: string, values: Record<string, string>) => {
        const stored: string = writeStatusChangeNote(note, values);
        const worded: string = withoutIsolateMarks(
          wordStatusChangeNote(stored, translator) || "",
        );

        expect(translator.hasTranslation(note)).toBe(true);
        // The reader's sentence, never the stored English.
        expect({ stored, worded }).not.toEqual({ stored, worded: stored });

        for (const link of Object.values(values)) {
          expect({ link, kept: worded.includes(link) }).toEqual({
            link,
            kept: true,
          });
        }
      },
    );

    test("every band sentence is worded, with the placeholders English has", () => {
      for (const sentence of BAND_SENTENCES) {
        const worded: string | undefined = words[sentence];

        expect({
          sentence,
          isWorded: Boolean(worded) && worded !== sentence,
        }).toEqual({ sentence, isWorded: true });
        expect(placeholdersOf(worded!).sort()).toEqual(
          placeholdersOf(sentence).sort(),
        );
      }
    });

    test("every note's placeholders are the English note's", () => {
      for (const [note] of PAUSE_NOTES) {
        expect(
          getStatusChangeNotePlaceholders(words[note] || "").sort(),
        ).toEqual(getStatusChangeNotePlaceholders(note).sort());
      }
    });
  },
);
