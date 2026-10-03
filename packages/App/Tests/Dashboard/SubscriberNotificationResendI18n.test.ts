import SubscriberNotificationResendCopy from "../../FeatureSet/Dashboard/src/Components/StatusPageSubscribers/SubscriberNotificationResendCopy";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Resend and Retry for a status page subscriber notification: the buttons
 * and the confirmation that says what sending it again does and to whom.
 *
 * Every string lives in SubscriberNotificationResendCopy and reaches the
 * screen through components that look it up in the Dashboard locale files by
 * its English text. A string with no entry silently stays English, so this
 * pins:
 *
 *   - the components render the shared constants, so rewording one there
 *     cannot leave the page showing an untranslated copy;
 *   - which screens offer Resend: the incident's 'created' notification and
 *     its public notes do, with the incident's audience in the confirmation;
 *     the episode and scheduled maintenance notes, the state timelines, the
 *     postmortem, the scheduled maintenance overview and announcements keep
 *     Retry after a failure only;
 *   - en.json maps each string to itself, and all sixteen other locales carry
 *     a real translation.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

const STRINGS: Array<string> = Object.values(
  SubscriberNotificationResendCopy,
) as Array<string>;

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function readSource(...relativePath: Array<string>): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativePath), "utf8")
    .replace(/\s+/g, " ");
}

describe("SubscriberNotificationResendCopy wiring", () => {
  test("the status badge takes its buttons and confirmation titles from the shared copy", () => {
    const source: string = readSource(
      "Components",
      "StatusPageSubscribers",
      "SubscriberNotificationStatus.tsx",
    );

    for (const key of [
      "resendButton",
      "retryButton",
      "resendToAllStatusPagesButton",
      "resendConfirmTitle",
      "retryConfirmTitle",
      "cancelButton",
    ]) {
      expect(source).toContain(`SubscriberNotificationResendCopy.${key}`);
    }

    // A caller's descriptions and box label are looked up too.
    expect(source).toContain("tx(description)");
    expect(source).toContain(
      'tx(confirmation.retryToAllStatusPagesLabel || "")',
    );
  });

  test("the notes' badge takes its buttons and confirmation titles from the shared copy", () => {
    const source: string = readSource(
      "Components",
      "EventNotes",
      "NoteNotificationBadge.tsx",
    );

    for (const key of [
      "resendNoteNotificationButton",
      "retryNoteNotificationButton",
      "resendButton",
      "retryButton",
      "resendConfirmTitle",
      "retryConfirmTitle",
      "cancelButton",
      "queueError",
    ]) {
      expect(source).toContain(`SubscriberNotificationResendCopy.${key}`);
    }
  });

  test("the notes feed describes a note's resend and retry with the shared copy", () => {
    const source: string = readSource(
      "Components",
      "EventNotes",
      "EventNotes.tsx",
    );

    expect(source).toContain(
      "resendDescription: SubscriberNotificationResendCopy.noteResendDescription",
    );
    expect(source).toContain(
      "retryDescription: SubscriberNotificationResendCopy.noteRetryDescription",
    );
  });

  test("the incident overview offers Resend of the 'created' notification, confirmed with the incident's audience", () => {
    const source: string = readSource(
      "Pages",
      "Incidents",
      "View",
      "Index.tsx",
    );

    // Only for whoever may send it again.
    expect(source).toContain(
      "resendConfirmation={ canSendCreatedNotificationAgain ? {",
    );
    for (const key of [
      "incidentCreatedResendDescription",
      "incidentCreatedRetryDescription",
      "incidentCreatedRetryToAllStatusPagesLabel",
      "incidentCreatedResendToAllStatusPagesDescription",
    ]) {
      expect(source).toContain(`SubscriberNotificationResendCopy.${key}`);
    }
    /*
     * Both always answer, "no one" included: who it reaches is what is
     * being confirmed (saysWhenNobodyIsNotified).
     */
    expect(source).toContain(
      'SubscriberAudienceSummary request={{ incidentId: modelId }} dataTestId="incident-created-resend-audience" saysWhenNobodyIsNotified={true} />',
    );
    // Retry's own: without the pages already sent it in full.
    expect(source).toContain(
      'SubscriberAudienceSummary request={{ incidentId: modelId, excludeStatusPagesNotifiedOnCreation: true, }} dataTestId="incident-created-retry-audience" saysWhenNobodyIsNotified={true} />',
    );
    // 'Resend to all pages' is the server's request, not a guess.
    expect(source).toContain("IncidentCreatedResend.getMiscDataProps()");
    expect(source).toContain("IncidentCreatedResend.retryQueuedMessage");
  });

  test("the incident's public notes offer Resend, confirmed with the incident's audience", () => {
    // The incident's public note kind, which its Public Notes page reads.
    const source: string = readSource(
      "Components",
      "EventNotes",
      "NoteKinds",
      "IncidentNoteKinds.tsx",
    );

    // It always answers, "no one" included.
    expect(source).toContain(
      'resend: { audience: ( <SubscriberAudienceSummary request={{ incidentId: incidentId }} dataTestId="incident-public-note-resend-audience" saysWhenNobodyIsNotified={true} /> ), }',
    );
  });

  test.each([
    ["Components", "EventNotes", "NoteKinds", "IncidentEpisodeNoteKinds.ts"],
    [
      "Components",
      "EventNotes",
      "NoteKinds",
      "ScheduledMaintenanceNoteKinds.ts",
    ],
    ["Pages", "Incidents", "EpisodeView", "PublicNote.tsx"],
    ["Pages", "ScheduledMaintenanceEvents", "View", "PublicNote.tsx"],
  ])(
    "%s/%s/%s/%s keeps Retry after a failure only",
    (...relativePath: Array<string>) => {
      expect(readSource(...relativePath)).not.toContain("resend:");
    },
  );

  test.each([
    ["Pages", "Incidents", "View", "StateTimeline.tsx"],
    ["Pages", "Incidents", "View", "Postmortem.tsx"],
    ["Pages", "ScheduledMaintenanceEvents", "View", "Index.tsx"],
    ["Pages", "ScheduledMaintenanceEvents", "View", "StateTimeline.tsx"],
    ["Pages", "StatusPages", "AnnouncementView.tsx"],
  ])(
    "%s/%s/%s/%s keeps its status badge to Retry after a failure",
    (...relativePath: Array<string>) => {
      const source: string = readSource(...relativePath);

      expect(source).toContain("<SubscriberNotificationStatus");
      expect(source).not.toContain("resendConfirmation");
    },
  );
});

describe("SubscriberNotificationResendCopy strings in the dashboard locales", () => {
  test("every string is a non-empty string", () => {
    expect(STRINGS.length).toBeGreaterThan(0);

    for (const text of STRINGS) {
      expect(typeof text).toBe("string");
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  test.each(STRINGS)("en.json maps %j to itself", (text: string) => {
    expect(readLocale("en")[text]).toBe(text);
  });

  describe.each(OTHER_LOCALES)("%s", (locale: string) => {
    const translations: Record<string, unknown> = readLocale(locale);

    test.each(STRINGS)("translates %j", (text: string) => {
      const value: unknown = translations[text];

      expect(typeof value).toBe("string");
      expect((value as string).trim().length).toBeGreaterThan(0);
      expect(value).not.toBe(text);
      expect(value as string).not.toMatch(/{{|}}/);
    });
  });
});
