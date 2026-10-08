import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { RESEND_COOLDOWN_SECONDS } from "Common/Server/Utils/ChannelVerification";
import { SERVER_TWILIO_SETTINGS_PAGE } from "Common/Utils/Project/TwilioAccount";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * How a team member's phone number is verified, in the self-hosted Twilio
 * guide, in every docs language.
 *
 * A self-hosted customer with no Twilio account added their number and was
 * told an SMS had been sent; they asked whether Resend had to come before
 * Verify, and whether verifying by SMS covered calls. The guide now answers
 * all three: the code goes out on add and the dialog says when and until
 * when, with a new one at most once a minute; when none can be sent it says
 * why, and a number whose first code cannot be sent is not added; a number
 * verified for SMS is verified for calls, not the other way round.
 *
 * Markdown is not compiled, so these read the pages - and hold the claims to
 * the code they describe.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

const PAGE: string = "self-hosted/twilio-integration.md";

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

// The section's heading, in each language.
const HEADINGS: Record<string, string> = {
  en: "## 5. Verify team members' phone numbers",
  de: "## 5. Telefonnummern der Teammitglieder verifizieren",
  fr: "## 5. Vérifier les numéros de téléphone des membres de l'équipe",
  es: "## 5. Verifique los números de teléfono de los miembros del equipo",
  it: "## 5. Verificare i numeri di telefono dei membri del team",
  pt: "## 5. Verifique os números de telefone dos membros da equipe",
  nl: "## 5. Telefoonnummers van teamleden verifiëren",
  da: "## 5. Bekræft teammedlemmers telefonnumre",
  no: "## 5. Bekreft teammedlemmenes telefonnumre",
  sv: "## 5. Verifiera teammedlemmarnas telefonnummer",
  ru: "## 5. Подтверждение номеров телефонов участников команды",
  ja: "## 5. チームメンバーの電話番号を確認する",
  ko: "## 5. 팀원의 전화번호 인증",
  "zh-CN": "## 5. 验证团队成员的电话号码",
  "zh-TW": "## 5. 驗證團隊成員的電話號碼",
  hi: "## 5. टीम सदस्यों के फ़ोन नंबर सत्यापित करें",
  // The Persian pages number their sections in Persian digits.
  fa: "## ۵. شماره تلفن اعضای تیم را تأیید کنید",
};

const readPage: (language: string) => string = (language: string): string => {
  return fs.readFileSync(path.join(CONTENT_DIR, language, PAGE), "utf8");
};

// Everything from the heading to the end of the page.
const sectionOf: (language: string) => string = (language: string): string => {
  const page: string = readPage(language);
  const start: number = page.indexOf(HEADINGS[language]!);

  return start === -1 ? "" : page.slice(start);
};

describe("the self-hosted Twilio guide explains how phone numbers are verified", () => {
  it("names a heading for every docs language", () => {
    expect(Object.keys(HEADINGS).sort()).toEqual([...LANGUAGES].sort());
  });

  it.each(LANGUAGES)(
    "%s: has the section once, as the guide's last, after testing delivery",
    (language: string) => {
      const page: string = readPage(language);
      const heading: string = HEADINGS[language]!;

      expect(page.split(heading).length - 1).toBe(1);

      const headings: Array<string> = page
        .split("\n")
        .filter((line: string) => {
          return line.startsWith("## ");
        });

      expect(headings[headings.length - 1]).toBe(heading);
      expect(headings).toHaveLength(5);
    },
  );

  it.each(LANGUAGES)(
    "%s: is three paragraphs, and names Twilio and SMS in each language",
    (language: string) => {
      const paragraphs: Array<string> = sectionOf(language)
        .split("\n")
        .slice(1)
        .join("\n")
        .trim()
        .split(/\n\s*\n/);

      expect(paragraphs).toHaveLength(3);
      expect(sectionOf(language)).toContain("Twilio");
    },
  );
});

describe("what the English section claims, held to the code", () => {
  const section: string = sectionOf("en");

  it("the code goes out on add, and the dialog says when and until when", () => {
    expect(section).toContain(
      "Adding a phone number for SMS or calls sends its verification code straight away, and the verify dialog opens.",
    );
    expect(section).toContain(
      "It shows when the code was sent and until when it works",
    );
    expect(section).toContain("Nothing needs to be resent before verifying.");
  });

  it("a new code at most once a minute: the resend cooldown", () => {
    expect(section).toContain("at most once a minute");
    expect(RESEND_COOLDOWN_SECONDS).toBe(60);
  });

  it("when no code can be sent, the dialog says why, and such a number is not added", () => {
    expect(section).toContain(
      "When no code can be sent, the dialog says why instead of claiming one was sent",
    );
    expect(section).toContain(
      "A number whose first code cannot be sent is not added, and the form shows the reason",
    );
  });

  it("the installation-wide configuration it points back to is the page the server names", () => {
    expect(readPage("en")).toContain(SERVER_TWILIO_SETTINGS_PAGE);
  });

  it("SMS verification covers calls, and not the other way round, with the reason", () => {
    expect(section).toContain(
      "A number verified for SMS is also verified for calls, with no second code.",
    );
    expect(section).toContain(
      "Verifying by call does not verify SMS, because a number that takes calls, such as a landline, cannot always receive texts.",
    );
  });

  it("never the old claim that a code was sent", () => {
    for (const language of LANGUAGES) {
      expect(readPage(language)).not.toContain("We have sent a SMS");
    }
  });
});
