import { describe, expect, test } from "@jest/globals";
import {
  FIRST_STRONG_ISOLATE,
  getServerTranslator,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Server/Utils/ServerTranslation";
import {
  describeOnCallAcknowledgementTimeout,
  getOnCallPageAgainEmailLine,
  getOnCallPageAgainHeadline,
  getOnCallPageAgainWhyLine,
} from "../../../Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import {
  getOnCallPersonPageEmailLine,
  getOnCallPersonPageEmailMessageLine,
  getOnCallPersonPageEmailSubject,
  getOnCallPersonPageLead,
  getOnCallPersonPagePushBody,
  getOnCallPersonPagePushTitle,
  getOnCallPersonPageWhyLine,
  OnCallPersonPageNotice,
} from "../../../Types/OnCallDutyPolicy/OnCallPersonPage";
import { Translator } from "../../../Types/Translator";

/*
 * A PAGE AGAIN AND A PERSON'S PAGE, IN THE LANGUAGE OF THE PERSON PAGED
 * (fu-i18n-larger).
 *
 * The sentences a page again (OnCallAcknowledgementTimeout) and a person's
 * page (OnCallPersonPage) add to a page take the translator of the person
 * it pages: whole sentences for each kind of record, so a language words
 * "this alert" with its own article. Without one they write English, as
 * they always have (their own suites hold the English word for word).
 */

const GERMAN: Translator = getServerTranslator("de");
const SPANISH: Translator = getServerTranslator("es");
const RUSSIAN: Translator = getServerTranslator("ru");
const JAPANESE: Translator = getServerTranslator("ja");
const PERSIAN: Translator = getServerTranslator("fa");

const withoutIsolates: (text: string) => string = (text: string): string => {
  return text
    .split(FIRST_STRONG_ISOLATE)
    .join("")
    .split(POP_DIRECTIONAL_ISOLATE)
    .join("");
};

describe("a timeout in words, in the person's language", () => {
  test("German, with its own singular and plural", () => {
    expect(describeOnCallAcknowledgementTimeout(1, GERMAN)).toBe("1 Minute");
    expect(describeOnCallAcknowledgementTimeout(30, GERMAN)).toBe("30 Minuten");
    expect(describeOnCallAcknowledgementTimeout(60, GERMAN)).toBe("1 Stunde");
    expect(describeOnCallAcknowledgementTimeout(120, GERMAN)).toBe("2 Stunden");
    expect(describeOnCallAcknowledgementTimeout(90, GERMAN)).toBe(
      "1 Stunde 30 Minuten",
    );
  });

  test("Spanish joins hours and minutes with its own word", () => {
    expect(describeOnCallAcknowledgementTimeout(61, SPANISH)).toBe(
      "1 hora y 1 minuto",
    );
  });

  test("Russian writes a count in a form that reads for any number", () => {
    expect(describeOnCallAcknowledgementTimeout(21, RUSSIAN)).toBe("21 мин");
    expect(describeOnCallAcknowledgementTimeout(22, RUSSIAN)).toBe("22 мин");
    expect(describeOnCallAcknowledgementTimeout(1440, RUSSIAN)).toBe("24 ч");
  });

  test("Persian writes its own digits", () => {
    expect(
      withoutIsolates(describeOnCallAcknowledgementTimeout(90, PERSIAN)),
    ).toBe("۱ ساعت و ۳۰ دقیقه");
  });

  test("without a translator: English, as always", () => {
    expect(describeOnCallAcknowledgementTimeout(90)).toBe("1 hour 30 minutes");
    expect(describeOnCallAcknowledgementTimeout(1)).toBe("1 minute");
  });
});

describe("a page again, in the person's language", () => {
  test("its email line names the kind of record with the language's own words", () => {
    expect(
      getOnCallPageAgainEmailLine({
        recordNoun: "incident",
        projectName: "Acme",
        notice: { pageAgainNumber: 1, minutes: 30 },
        translator: GERMAN,
      }),
    ).toBe(
      "Dieser Vorfall im Projekt Acme ist 30 Minuten nach der Bestätigung noch immer nicht behoben.",
    );
    expect(
      getOnCallPageAgainEmailLine({
        recordNoun: "alert",
        projectName: "Acme",
        notice: { pageAgainNumber: 1 },
        translator: GERMAN,
      }),
    ).toBe(
      "Diese Warnung im Projekt Acme ist nach der Bestätigung noch immer nicht behoben.",
    );
    expect(
      getOnCallPageAgainEmailLine({
        recordNoun: "alert episode",
        projectName: "",
        notice: { pageAgainNumber: 1, minutes: 60 },
        translator: SPANISH,
      }),
    ).toBe(
      "Este episodio de alerta sigue sin resolverse 1 hora después de reconocerse.",
    );
  });

  test("its headline and why line", () => {
    expect(getOnCallPageAgainHeadline("incident episode", GERMAN)).toBe(
      "Vorfallsepisode noch nicht behoben",
    );
    expect(
      getOnCallPageAgainWhyLine({ pageAgainNumber: 2, minutes: 5 }, GERMAN),
    ).toBe(
      "Sie erhalten diese Nachricht, weil das Problem 5 Minuten nach der Bestätigung noch immer nicht behoben ist.",
    );
  });

  test("a kind of record it has no words for reads in English, as it always did", () => {
    expect(getOnCallPageAgainHeadline("monitor", GERMAN)).toBe(
      "Monitor still not resolved",
    );
    expect(
      getOnCallPageAgainEmailLine({
        recordNoun: "monitor",
        projectName: "Acme",
        notice: { pageAgainNumber: 1, minutes: 30 },
        translator: GERMAN,
      }),
    ).toBe(
      "This monitor in the project Acme is still not resolved 30 minutes after it was acknowledged.",
    );
  });
});

describe("a person's page, in the language of the person it pages", () => {
  const BY_NAME: OnCallPersonPageNotice = {
    pagedByName: "Alice Kim",
    message: "Can you check the database?",
  };
  const AS_TEAM: OnCallPersonPageNotice = {
    pagedByName: "Alice Kim",
    teamName: "Platform",
  };
  const IN_SCHEDULE: OnCallPersonPageNotice = {
    pagedByName: "Alice Kim",
    scheduleName: "Primary",
  };
  const NAMELESS: OnCallPersonPageNotice = { pagedByName: "  " };

  test("who paged whom", () => {
    expect(getOnCallPersonPageLead(BY_NAME, GERMAN)).toBe(
      "Alice Kim hat Sie alarmiert",
    );
    expect(getOnCallPersonPageLead(AS_TEAM, GERMAN)).toBe(
      "Alice Kim hat Platform alarmiert",
    );
    expect(getOnCallPersonPageLead(IN_SCHEDULE, GERMAN)).toBe(
      "Alice Kim hat die Bereitschaft von Primary alarmiert",
    );
    // Nobody named: "Someone", in the sentence's language.
    expect(getOnCallPersonPageLead(NAMELESS, GERMAN)).toBe(
      "Jemand hat Sie alarmiert",
    );
    expect(getOnCallPersonPageLead(NAMELESS)).toBe("Someone paged you");
  });

  test("why this person", () => {
    expect(getOnCallPersonPageWhyLine(AS_TEAM, GERMAN)).toBe(
      "Sie erhalten diese Nachricht, weil Sie Mitglied von Platform sind.",
    );
    expect(getOnCallPersonPageWhyLine(IN_SCHEDULE, GERMAN)).toBe(
      "Sie erhalten diese Nachricht, weil Sie in Primary Bereitschaft haben.",
    );
    expect(getOnCallPersonPageWhyLine(BY_NAME, GERMAN)).toBe(
      "Sie erhalten diese Nachricht, weil Alice Kim Sie namentlich alarmiert hat.",
    );
  });

  test("its email: the first line, the team line after it, the message and the subject", () => {
    expect(
      getOnCallPersonPageEmailLine({
        recordNoun: "incident",
        projectName: "Acme",
        notice: AS_TEAM,
        translator: GERMAN,
      }),
    ).toBe(
      "Alice Kim hat Platform alarmiert, wegen dieses Vorfalls im Projekt Acme. Sie sind Mitglied von Platform.",
    );
    expect(
      getOnCallPersonPageEmailLine({
        recordNoun: "alert",
        projectName: "",
        notice: BY_NAME,
        translator: GERMAN,
      }),
    ).toBe("Alice Kim hat Sie alarmiert, wegen dieser Warnung.");
    expect(getOnCallPersonPageEmailMessageLine(BY_NAME, GERMAN)).toBe(
      "Alice Kim schrieb: „Can you check the database?“",
    );
    expect(
      getOnCallPersonPageEmailSubject({
        recordLabel: "Vorfall INC-42",
        recordTitle: "Checkout is down",
        notice: BY_NAME,
        translator: GERMAN,
      }),
    ).toBe(
      "HANDLUNG ERFORDERLICH: Alice Kim hat Sie alarmiert, wegen Vorfall INC-42 - Checkout is down",
    );
  });

  test("a language that writes sentences without spaces puts the two together", () => {
    const line: string = getOnCallPersonPageEmailLine({
      recordNoun: "incident",
      projectName: "Acme",
      notice: IN_SCHEDULE,
      translator: JAPANESE,
    });

    expect(line).toContain("。あなたは");
    expect(line).not.toContain("。 あなたは");
  });

  test("its push", () => {
    expect(
      getOnCallPersonPagePushTitle({
        recordLabel: "Vorfall INC-42",
        notice: BY_NAME,
        translator: GERMAN,
      }),
    ).toBe("Alice Kim hat Sie alarmiert: Vorfall INC-42");
    expect(
      getOnCallPersonPagePushBody({
        recordTitle: "Checkout is down",
        projectName: "Acme",
        notice: BY_NAME,
        translator: GERMAN,
      }),
    ).toBe("Checkout is down, im Projekt Acme. „Can you check the database?“");
  });

  test("a kind of record it has no words for reads in English, as it always did", () => {
    expect(
      getOnCallPersonPageEmailLine({
        recordNoun: "monitor",
        projectName: "Acme",
        notice: BY_NAME,
        translator: GERMAN,
      }),
    ).toBe("Alice Kim paged you about this monitor in the project Acme.");
  });

  test("a language read from the right sets the names apart", () => {
    const lead: string = getOnCallPersonPageLead(AS_TEAM, PERSIAN);

    expect(lead).toContain(
      `${FIRST_STRONG_ISOLATE}Alice Kim${POP_DIRECTIONAL_ISOLATE}`,
    );
    expect(lead).toContain(
      `${FIRST_STRONG_ISOLATE}Platform${POP_DIRECTIONAL_ISOLATE}`,
    );
  });
});
