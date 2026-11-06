import { describe, expect, test } from "@jest/globals";
import {
  FIRST_STRONG_ISOLATE,
  getServerTranslator,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Server/Utils/ServerTranslation";
import { CANT_TAKE_IT_ESCALATE } from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import {
  DEFAULT_ALERT_SEVERITY_NAMES,
  getEnglishPageTranslator,
  getOnCallPageAcknowledge,
  getOnCallPageCantTakeItEscalate,
  getOnCallPageChatHeadline,
  getOnCallPageEmailSubject,
  getOnCallPageKindLabel,
  getOnCallPageMemberMonitor,
  getOnCallPageMemberView,
  getOnCallPageNoResources,
  getOnCallPageNoRootCause,
  getOnCallPageOnCallWhyLine,
  getOnCallPagePersonPagePushBody,
  getOnCallPagePushWords,
  getOnCallPageRecordLabel,
  getOnCallPageSmsWords,
  getOnCallPageStateName,
  getOnCallPageTapToAcknowledge,
  getOnCallPageUntitledMember,
  getOnCallPageViewInOneUptime,
  ON_CALL_PAGE_KINDS,
  OnCallPageKind,
  OnCallPagePushWords,
  OnCallPageSmsWords,
} from "../../../Types/OnCallDutyPolicy/OnCallPageWords";
import { READER_LANGUAGE_CODES } from "../../../Types/ReaderLanguage";
import { Translator } from "../../../Types/Translator";

/*
 * WHAT A PAGE SAYS, IN THE LANGUAGE OF THE PERSON IT PAGES (fu-i18n-larger).
 *
 * Every sentence a page writes about its record - its email's subject and
 * fallbacks, its push, its chat and Telegram headline and links, its text
 * message's words - is looked up whole, for each kind of record, in the
 * person's language (Common/Server/Locales). English is what a translator
 * for no language writes: exactly what the page always said, which the
 * first block holds word for word. Then the same sentences in German, and
 * the rules every language keeps.
 */

const ENGLISH: Translator = getEnglishPageTranslator();
const GERMAN: Translator = getServerTranslator("de");
const PERSIAN: Translator = getServerTranslator("fa");
const JAPANESE: Translator = getServerTranslator("ja");

// The kinds as the page has always named them, in labels and in sentences.
const KIND_NAMES: Record<OnCallPageKind, { label: string; noun: string }> = {
  [OnCallPageKind.Incident]: { label: "Incident", noun: "incident" },
  [OnCallPageKind.Alert]: { label: "Alert", noun: "alert" },
  [OnCallPageKind.IncidentEpisode]: {
    label: "Incident Episode",
    noun: "incident episode",
  },
  [OnCallPageKind.AlertEpisode]: {
    label: "Alert Episode",
    noun: "alert episode",
  },
};

describe("in English, a page reads exactly as it always has", () => {
  test.each(ON_CALL_PAGE_KINDS)(
    "%s: its label, with and without a number",
    (kind: OnCallPageKind) => {
      const label: string = KIND_NAMES[kind].label;

      expect(getOnCallPageKindLabel(ENGLISH, kind)).toBe(label);
      expect(getOnCallPageRecordLabel(ENGLISH, kind, "INC-42")).toBe(
        `${label} INC-42`,
      );
      expect(getOnCallPageRecordLabel(ENGLISH, kind, "")).toBe(label);
      expect(getOnCallPageRecordLabel(ENGLISH, kind, undefined)).toBe(label);
      expect(getOnCallPageRecordLabel(ENGLISH, kind, "  ")).toBe(label);
    },
  );

  test.each(ON_CALL_PAGE_KINDS)(
    "%s: its email's subject, a first page and a page again",
    (kind: OnCallPageKind) => {
      const label: string = KIND_NAMES[kind].label;

      expect(
        getOnCallPageEmailSubject(ENGLISH, {
          kind: kind,
          number: "INC-42",
          title: "Checkout is down",
          isPageAgain: false,
        }),
      ).toBe(`ACTION REQUIRED: ${label} INC-42 created - Checkout is down`);
      expect(
        getOnCallPageEmailSubject(ENGLISH, {
          kind: kind,
          number: "INC-42",
          title: "Checkout is down",
          isPageAgain: true,
        }),
      ).toBe(
        `ACTION REQUIRED: ${label} INC-42 still not resolved - Checkout is down`,
      );
      // A record without a number keeps the two spaces it always had.
      expect(
        getOnCallPageEmailSubject(ENGLISH, {
          kind: kind,
          number: "",
          title: "Checkout is down",
          isPageAgain: false,
        }),
      ).toBe(`ACTION REQUIRED: ${label}  created - Checkout is down`);
    },
  );

  test.each(ON_CALL_PAGE_KINDS)(
    "%s: its push, a first page",
    (kind: OnCallPageKind) => {
      const { label, noun } = KIND_NAMES[kind];
      const words: OnCallPagePushWords = getOnCallPagePushWords(ENGLISH, {
        kind: kind,
        number: "INC-42",
        title: "Checkout is down",
        projectName: "Acme",
      });

      expect(words.title).toBe(`New ${label} INC-42: Checkout is down`);
      expect(words.body).toBe(
        `A new ${noun} has been created: INC-42 (Checkout is down) in Acme. Click to view details.`,
      );

      const withoutNumber: OnCallPagePushWords = getOnCallPagePushWords(
        ENGLISH,
        {
          kind: kind,
          number: "",
          title: "Checkout is down",
          projectName: "Acme",
        },
      );

      expect(withoutNumber.title).toBe(`New ${label}: Checkout is down`);
      expect(withoutNumber.body).toBe(
        `A new ${noun} has been created: Checkout is down in Acme. Click to view details.`,
      );
    },
  );

  test.each(ON_CALL_PAGE_KINDS)(
    "%s: its push, a page again, with and without the minutes",
    (kind: OnCallPageKind) => {
      const { label } = KIND_NAMES[kind];

      const after: OnCallPagePushWords = getOnCallPagePushWords(ENGLISH, {
        kind: kind,
        number: "INC-42",
        title: "Checkout is down",
        projectName: "Acme",
        pageAgain: { pageAgainNumber: 1, minutes: 90 },
      });

      expect(after.title).toBe(
        `${label} INC-42 still not resolved: Checkout is down`,
      );
      expect(after.body).toBe(
        `${label} INC-42 (Checkout is down) in Acme is still not resolved 1 hour 30 minutes after it was acknowledged. Click to view details.`,
      );

      const unknown: OnCallPagePushWords = getOnCallPagePushWords(ENGLISH, {
        kind: kind,
        number: "",
        title: "Checkout is down",
        projectName: "Acme",
        pageAgain: { pageAgainNumber: 2 },
      });

      expect(unknown.title).toBe(
        `${label} still not resolved: Checkout is down`,
      );
      expect(unknown.body).toBe(
        `${label} Checkout is down in Acme is still not resolved after it was acknowledged. Click to view details.`,
      );
    },
  );

  test.each(ON_CALL_PAGE_KINDS)(
    "%s: its chat and Telegram words",
    (kind: OnCallPageKind) => {
      const { noun } = KIND_NAMES[kind];

      expect(getOnCallPageChatHeadline(ENGLISH, kind)).toBe(
        `New ${noun} assigned to you`,
      );
      expect(getOnCallPageViewInOneUptime(ENGLISH, kind)).toBe(
        `View ${noun} in OneUptime`,
      );
      expect(getOnCallPageNoRootCause(ENGLISH, kind)).toBe(
        `No root cause identified for this ${noun}`,
      );
    },
  );

  test("the words every page shares", () => {
    expect(getOnCallPageOnCallWhyLine(ENGLISH)).toBe(
      "You're getting this because you're on call.",
    );
    expect(getOnCallPageTapToAcknowledge(ENGLISH)).toBe("Tap to acknowledge");
    expect(getOnCallPageAcknowledge(ENGLISH)).toBe("Acknowledge");
    expect(getOnCallPageCantTakeItEscalate(ENGLISH)).toBe(
      CANT_TAKE_IT_ESCALATE,
    );
    expect(getOnCallPageNoResources(ENGLISH)).toBe("No resources identified");
    expect(getOnCallPagePersonPagePushBody(ENGLISH, "Checkout is down.")).toBe(
      "Checkout is down. Click to view details.",
    );
  });

  test("an episode's members", () => {
    expect(getOnCallPageUntitledMember(ENGLISH, OnCallPageKind.Incident)).toBe(
      "Untitled Incident",
    );
    expect(getOnCallPageUntitledMember(ENGLISH, OnCallPageKind.Alert)).toBe(
      "Untitled Alert",
    );
    expect(getOnCallPageMemberMonitor(ENGLISH, "API, Web")).toBe(
      "Monitor: API, Web",
    );
    expect(getOnCallPageMemberView(ENGLISH)).toBe("View →");
  });

  test("a state's or a severity's name reads as written", () => {
    for (const name of [
      "Identified",
      "Critical Incident",
      "High",
      "Low",
      "SEV1",
      "Investigating",
    ]) {
      expect(getOnCallPageStateName(ENGLISH, name)).toBe(name);
    }

    expect(getOnCallPageStateName(ENGLISH, "")).toBe("");
    expect(getOnCallPageStateName(ENGLISH, undefined)).toBe("");
  });
});

describe("in German, the same page in German", () => {
  test("an email's subject and its labels", () => {
    expect(
      getOnCallPageEmailSubject(GERMAN, {
        kind: OnCallPageKind.Incident,
        number: "INC-42",
        title: "Checkout is down",
        isPageAgain: false,
      }),
    ).toBe("HANDLUNG ERFORDERLICH: Vorfall INC-42 erstellt - Checkout is down");
    expect(
      getOnCallPageEmailSubject(GERMAN, {
        kind: OnCallPageKind.Alert,
        number: "ALT-7",
        title: "Disk full",
        isPageAgain: true,
      }),
    ).toBe(
      "HANDLUNG ERFORDERLICH: Warnung ALT-7 noch nicht behoben - Disk full",
    );
    expect(
      getOnCallPageRecordLabel(GERMAN, OnCallPageKind.Alert, "ALT-7"),
    ).toBe("Warnung ALT-7");
    expect(
      getOnCallPageNoRootCause(GERMAN, OnCallPageKind.IncidentEpisode),
    ).toBe("Für diese Vorfallsepisode wurde keine Grundursache ermittelt");
  });

  test("a push, its duration written in German", () => {
    const words: OnCallPagePushWords = getOnCallPagePushWords(GERMAN, {
      kind: OnCallPageKind.Incident,
      number: "INC-42",
      title: "Checkout is down",
      projectName: "Acme",
      pageAgain: { pageAgainNumber: 1, minutes: 90 },
    });

    expect(words.title).toBe(
      "Vorfall INC-42 noch nicht behoben: Checkout is down",
    );
    expect(words.body).toBe(
      "Vorfall INC-42 (Checkout is down) in Acme ist 1 Stunde 30 Minuten nach der Bestätigung noch nicht behoben. Tippen Sie für Details.",
    );
  });

  test("chat and Telegram words", () => {
    expect(getOnCallPageChatHeadline(GERMAN, OnCallPageKind.Alert)).toBe(
      "Neue Warnung für Sie",
    );
    expect(getOnCallPageOnCallWhyLine(GERMAN)).toBe(
      "Sie erhalten diese Nachricht, weil Sie Bereitschaft haben.",
    );
    expect(getOnCallPageTapToAcknowledge(GERMAN)).toBe("Zum Bestätigen tippen");
    expect(getOnCallPageCantTakeItEscalate(GERMAN)).toBe(
      "Keine Zeit? Eskalieren",
    );
  });

  test("OneUptime's default names in German, a project's own as written", () => {
    expect(getOnCallPageStateName(GERMAN, "Critical Incident")).toBe(
      "Kritischer Vorfall",
    );
    expect(getOnCallPageStateName(GERMAN, "Identified")).toBe("Identifiziert");
    expect(getOnCallPageStateName(GERMAN, "High")).toBe("Hoch");
    expect(getOnCallPageStateName(GERMAN, "Low")).toBe("Niedrig");
    expect(getOnCallPageStateName(GERMAN, " Low ")).toBe("Niedrig");
    expect(getOnCallPageStateName(GERMAN, "SEV1")).toBe("SEV1");
    expect(getOnCallPageStateName(GERMAN, "Investigating")).toBe(
      "Investigating",
    );
  });

  test("a text message's words around its values", () => {
    const words: OnCallPageSmsWords = getOnCallPageSmsWords(GERMAN);

    expect(
      words.record({
        kind: OnCallPageKind.Incident,
        number: "INC-42",
        severityName: "Kritischer Vorfall",
      }),
    ).toBe("Vorfall INC-42 (Kritischer Vorfall)");
    expect(
      words.record({
        kind: OnCallPageKind.AlertEpisode,
        number: "",
        severityName: "",
      }),
    ).toBe("Warnungsepisode");
    expect(
      words.head({
        record: "Vorfall INC-42",
        projectName: "Acme",
        isPageAgain: false,
        lead: "",
      }),
    ).toBe("Vorfall INC-42 im Projekt Acme");
    expect(
      words.head({
        record: "Vorfall INC-42",
        projectName: "",
        isPageAgain: true,
        lead: "",
      }),
    ).toBe("Vorfall INC-42 ist noch nicht behoben");
    expect(
      words.head({
        record: "Vorfall INC-42",
        projectName: "Acme",
        isPageAgain: false,
        lead: "Alice Kim hat Sie alarmiert",
      }),
    ).toBe("Alice Kim hat Sie alarmiert, wegen Vorfall INC-42 in Acme");
    expect(words.action).toBe("Bestätigen oder eskalieren:");
  });
});

describe("in every language", () => {
  test("the record's own default alert severities are among the page's words", () => {
    expect(DEFAULT_ALERT_SEVERITY_NAMES).toEqual(["High", "Low"]);
  });

  test.each(READER_LANGUAGE_CODES.filter((code: string) => code !== "en"))(
    "%s words every kind's headline, subject, push and link apart from the English, and keeps the product's name",
    (language: string) => {
      const translator: Translator = getServerTranslator(language);

      for (const kind of ON_CALL_PAGE_KINDS) {
        expect(getOnCallPageChatHeadline(translator, kind)).not.toBe(
          getOnCallPageChatHeadline(ENGLISH, kind),
        );

        // A product name a licence replaces is found and renamed as written.
        expect(getOnCallPageViewInOneUptime(translator, kind)).toContain(
          "OneUptime",
        );
        expect(getOnCallPageViewInOneUptime(translator, kind)).not.toBe(
          getOnCallPageViewInOneUptime(ENGLISH, kind),
        );

        const subject: string = getOnCallPageEmailSubject(translator, {
          kind: kind,
          number: "INC-42",
          title: "Checkout is down",
          isPageAgain: false,
        });

        expect(subject).toContain("INC-42");
        expect(subject).toContain("Checkout is down");
        expect(subject.startsWith("ACTION REQUIRED")).toBe(false);

        const push: OnCallPagePushWords = getOnCallPagePushWords(translator, {
          kind: kind,
          number: "INC-42",
          title: "Checkout is down",
          projectName: "Acme",
        });

        expect(push.title).toContain("Checkout is down");
        expect(push.body).toContain("Acme");
        expect(push.body).not.toContain("Click to view details.");
      }

      expect(getOnCallPageSmsWords(translator).action).not.toBe(
        "Ack or escalate:",
      );
    },
  );

  test("a language read from the right sets the team's words apart; a link it leaves whole", () => {
    const subject: string = getOnCallPageEmailSubject(PERSIAN, {
      kind: OnCallPageKind.Incident,
      number: "INC-42",
      title: "Checkout is down (EU).",
      isPageAgain: false,
    });

    expect(subject).toContain(
      `${FIRST_STRONG_ISOLATE}Checkout is down (EU).${POP_DIRECTIONAL_ISOLATE}`,
    );
    expect(subject).toContain(
      `${FIRST_STRONG_ISOLATE}INC-42${POP_DIRECTIONAL_ISOLATE}`,
    );

    const head: string = getOnCallPageSmsWords(PERSIAN).head({
      record: "INC-42",
      projectName: "https://acme.example",
      isPageAgain: false,
      lead: "",
    });

    expect(head).toContain("https://acme.example");
    expect(head).not.toContain(`${FIRST_STRONG_ISOLATE}https://`);
  });

  test("a language read from the left sets nothing apart", () => {
    const subject: string = getOnCallPageEmailSubject(JAPANESE, {
      kind: OnCallPageKind.Incident,
      number: "INC-42",
      title: "Checkout is down",
      isPageAgain: false,
    });

    expect(subject).not.toContain(FIRST_STRONG_ISOLATE);
    expect(subject).toContain("インシデント");
  });
});
