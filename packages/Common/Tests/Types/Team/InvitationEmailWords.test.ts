import { TRANSLATED_LANGUAGES } from "../../../Scripts/I18n/ServerLocales";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
  getServerTranslator,
} from "../../../Server/Utils/ServerTranslation";
import {
  getInvitationLanguage,
  getInvitationProjectLogLanguage,
  getInvitationSubject,
} from "../../../Types/Team/InvitationEmailWords";
import { Translator } from "../../../Types/Translator";
import { describe, expect, test } from "@jest/globals";

/*
 * THE INVITATION EMAIL'S LANGUAGE AND SUBJECT (#9897): the invitee's own
 * language, else the inviter's, else English - and the project's email log
 * keeps the subject in the language the email has for an invitee with no
 * language of their own, whatever the invitee's account says.
 */

const PROJECT: string = "Acme Production";
const INVITER: string = "Ada Walker";

function subjectsIn(language: string): Array<string> {
  const translator: Translator = getServerTranslator(language);

  return [
    getInvitationSubject(translator, {
      projectName: PROJECT,
      inviterName: INVITER,
      isAccepted: false,
    }),
    getInvitationSubject(translator, {
      projectName: PROJECT,
      inviterName: INVITER,
      isAccepted: true,
    }),
    getInvitationSubject(translator, {
      projectName: PROJECT,
      inviterName: null,
      isAccepted: false,
    }),
    getInvitationSubject(translator, {
      projectName: PROJECT,
      inviterName: null,
      isAccepted: true,
    }),
  ];
}

describe("getInvitationLanguage", () => {
  test.each([
    ["the invitee's German, over the inviter's French", "de", "fr", "de"],
    ["the inviter's French, when the invitee picked none", null, "fr", "fr"],
    ["the inviter's French, when the invitee's is empty", "  ", "fr", "fr"],
    ["English the invitee picked, over the inviter's French", "en", "fr", "en"],
    ["English, when nobody picked one", null, null, "en"],
    ["English, when the inviter picked none either", undefined, "", "en"],
    ["a regional tag as its language: de-AT is German", "de-AT", null, "de"],
    ["Traditional Chinese, from zh-HK", "zh-HK", null, "zh-TW"],
    [
      "the inviter's, past a language OneUptime does not write in",
      "tlh",
      "fa",
      "fa",
    ],
    ["English, past two it does not write in", "tlh", "xx", "en"],
  ])(
    "%s",
    (
      _case: string,
      invitee: string | null | undefined,
      inviter: string | null | undefined,
      expected: string,
    ) => {
      expect(
        getInvitationLanguage({
          inviteeLanguage: invitee,
          inviterLanguage: inviter,
        }),
      ).toBe(expected);
    },
  );
});

describe("getInvitationProjectLogLanguage", () => {
  test("is the inviter's language, never the invitee's", () => {
    expect(getInvitationProjectLogLanguage({ inviterLanguage: "fr" })).toBe(
      "fr",
    );
    expect(getInvitationProjectLogLanguage({ inviterLanguage: null })).toBe(
      "en",
    );
  });

  test("is what an invitee with no language of their own is written to in", () => {
    for (const inviterLanguage of [null, "fr", "de", "fa", "en", "zh-HK"]) {
      expect(getInvitationProjectLogLanguage({ inviterLanguage })).toBe(
        getInvitationLanguage({
          inviteeLanguage: null,
          inviterLanguage: inviterLanguage,
        }),
      );
    }
  });
});

describe("getInvitationSubject", () => {
  test("in English, what it always said", () => {
    expect(subjectsIn("en")).toEqual([
      "Ada Walker invited you to Acme Production",
      "Ada Walker added you to Acme Production",
      "You have been invited to Acme Production",
      "You have been added to Acme Production",
    ]);
  });

  test("in German", () => {
    expect(subjectsIn("de")).toEqual([
      "Ada Walker hat Sie zu Acme Production eingeladen",
      "Ada Walker hat Sie zu Acme Production hinzugefügt",
      "Sie wurden zu Acme Production eingeladen",
      "Sie wurden zu Acme Production hinzugefügt",
    ]);
  });

  test("in Japanese", () => {
    expect(subjectsIn("ja")).toEqual([
      "Ada Walker さんから Acme Production に招待されました",
      "Ada Walker さんが Acme Production にあなたを追加しました",
      "Acme Production に招待されました",
      "Acme Production に追加されました",
    ]);
  });

  test.each(["fa", "ar"])(
    "in %s, read from the right, the names set apart to read their own way",
    (language: string) => {
      const isolated: (name: string) => string = (name: string): string => {
        return `${FIRST_STRONG_ISOLATE}${name}${POP_DIRECTIONAL_ISOLATE}`;
      };

      for (const subject of subjectsIn(language)) {
        expect(subject).toContain(isolated(PROJECT));
      }

      expect(subjectsIn(language)[0]).toContain(isolated(INVITER));
    },
  );

  test("in Persian, word for word", () => {
    expect(subjectsIn("fa")[0]).toBe(
      `${FIRST_STRONG_ISOLATE}${INVITER}${POP_DIRECTIONAL_ISOLATE} شما را به پروژهٔ ${FIRST_STRONG_ISOLATE}${PROJECT}${POP_DIRECTIONAL_ISOLATE} دعوت کرده است`,
    );
  });

  test.each([...TRANSLATED_LANGUAGES])(
    "%s words every subject, the project and the inviter as written",
    (language: string) => {
      const english: Array<string> = subjectsIn("en");
      const subjects: Array<string> = subjectsIn(language);

      subjects.forEach((subject: string, index: number) => {
        expect([language, index, subject === english[index]]).toEqual([
          language,
          index,
          false,
        ]);
        expect(subject).toContain(PROJECT);
      });

      expect(subjects[0]).toContain(INVITER);
      expect(subjects[1]).toContain(INVITER);
    },
  );

  test("the names go in as written: a subject is text, and the template's marks are not read in them", () => {
    const subject: string = getInvitationSubject(getServerTranslator("de"), {
      projectName: "Acme <Prod> & {{year}}",
      inviterName: "Ada {{inviter}}",
      isAccepted: false,
    });

    expect(subject).toBe(
      "Ada {{inviter}} hat Sie zu Acme <Prod> & {{year}} eingeladen",
    );
  });
});
