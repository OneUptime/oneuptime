import { describe, expect, test } from "@jest/globals";
import {
  getNotesCopy,
  NotesCopy,
  NoteVisibility,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotesUtil";
import {
  getScheduledMaintenancePrivateNoteKind,
  getScheduledMaintenancePublicNoteKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/NoteKinds/ScheduledMaintenanceNoteKinds";
import ObjectID from "../../../Types/ObjectID";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";

/*
 * A MAINTENANCE EVENT'S NOTES PAGES CALL IT A MAINTENANCE EVENT (#7824).
 *
 * #6817 named the record "Maintenance Event", but its Public Notes and
 * Private Notes pages put the old noun into their sentences: "Customer-facing
 * updates about this scheduled maintenance event." under a page whose title
 * and menus say Maintenance Event. The pages take the noun from their note
 * kinds (eventNoun), and it is now "maintenance event": each language puts
 * its own word for the record into the sentence, German its
 * "Wartungsereignis", as its menus say "Wartungsereignis".
 */

const EVENT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

// What a notes page takes from its note kind to word its sentences.
interface NotesPageWords {
  visibility: NoteVisibility;
  eventNoun: string;
}

const PAGES: Array<[string, () => NotesPageWords, string, string]> = [
  [
    "Public Notes",
    (): NotesPageWords => {
      return getScheduledMaintenancePublicNoteKind({
        scheduledMaintenanceId: EVENT_ID,
        isNotifyingByDefault: true,
      });
    },
    "Customer-facing updates about this maintenance event. They appear on your status page, and subscribers can be notified when you post one.",
    "Updates für Kunden zu diesem Eintrag (Wartungsereignis). Sie erscheinen auf Ihrer Statusseite, und Abonnenten können benachrichtigt werden, wenn Sie eines veröffentlichen.",
  ],
  [
    "Private Notes",
    (): NotesPageWords => {
      return getScheduledMaintenancePrivateNoteKind({
        scheduledMaintenanceId: EVENT_ID,
      });
    },
    "Internal notes about this maintenance event. They are never shown on a status page or sent to subscribers.",
    "Interne Notizen zu diesem Eintrag (Wartungsereignis). Sie werden nie auf einer Statusseite angezeigt oder an Abonnenten gesendet.",
  ],
];

describe("a maintenance event's notes pages", () => {
  test.each(PAGES)(
    "%s say what they are about by the record's name, in English and German",
    (
      _page: string,
      wordsOf: () => NotesPageWords,
      english: string,
      german: string,
    ) => {
      const words: NotesPageWords = wordsOf();
      const inEnglish: NotesCopy = getNotesCopy(
        words.visibility,
        words.eventNoun,
        dashboardTranslator("en"),
      );
      const inGerman: NotesCopy = getNotesCopy(
        words.visibility,
        words.eventNoun,
        dashboardTranslator("de"),
      );

      expect(inEnglish.description).toBe(english);
      expect(inGerman.description).toBe(german);
      expect(inEnglish.emptyDescription).toContain("this maintenance event");

      // Neither the old name nor its German, "geplantes Wartungsereignis".
      for (const copy of [inEnglish, inGerman]) {
        expect([copy.description, copy.emptyDescription].join(" ")).not.toMatch(
          /scheduled|geplant/i,
        );
      }
    },
  );
});
