import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import TwilioConfigDefaultCopy from "../../../FeatureSet/Dashboard/src/Components/CallSMS/TwilioConfigDefaultCopy";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A project's first Twilio config becomes its default, in the two docs pages
 * that walk someone through adding one, in every docs language.
 *
 * - self-hosted/twilio-integration.md told people to switch "Set as Project
 *   Default" on, and that a config created without it is not used for the
 *   project's SMS and calls. Now the switch starts on for the project's
 *   first config, a later one starts off, the row menu makes any config the
 *   default, and an API create that leaves isProjectDefault out is treated
 *   the same way (ProjectCallSMSConfigService).
 * - on-call/incoming-call-policy.md sends people to create a config for an
 *   incoming call policy, which is very often the project's first: it says
 *   that config also takes the project's SMS and calls, and how not to. It
 *   also named a button the page never had ("Create Custom Call/SMS
 *   Config"); the card's button is "Create Twilio Config".
 *
 * Markdown is not compiled, so these read the pages, the Dashboard's locale
 * files and the table's source. Each page names the switch and the button
 * in the words its language's dashboard shows them; the Persian pages keep
 * the dashboard's English names, as the rest of the Persian docs do.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

const DASHBOARD_LOCALES_DIR: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Locales",
);

const TABLE_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Components/CallSMS/CallSMSConfigTable.tsx",
);

const SWITCH: string = TwilioConfigDefaultCopy.setDefaultTitle;
const CREATE_BUTTON: string = "Create Twilio Config";
const CARD_TITLE: string = "Twilio Config";

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

// The button the incoming call page used to name, in its languages.
const OLD_BUTTONS: Array<string> = [
  "Create Custom Call/SMS Config",
  "Benutzerdefinierte Anruf-/SMS-Konfiguration erstellen",
  "Opret brugerdefineret opkalds-/SMS-konfiguration",
  "Crear configuración personalizada de llamadas/SMS",
  "Créer une configuration d'appel/SMS personnalisée",
  "Crea Config Chiamata/SMS Personalizzata",
  "カスタム通話/SMS設定の作成",
  "커스텀 Call/SMS 구성 생성",
  "Aangepaste bel/SMS-configuratie aanmaken",
  "Создать пользовательскую конфигурацию Call/SMS",
  "Skapa anpassad Samtal/SMS-konfiguration",
  "创建自定义通话/短信配置",
];

function readPage(lang: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, lang, page), "utf8");
}

// A label as the language's dashboard shows it (English in the Persian docs).
function dashboardWords(lang: string): (english: string) => string {
  const locale: Record<string, unknown> = JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES_DIR, `${lang}.json`), "utf8"),
  ) as Record<string, unknown>;

  return (english: string): string => {
    if (lang === "fa") {
      return english;
    }

    const translated: unknown = locale[english];

    return typeof translated === "string" && translated ? translated : english;
  };
}

// A section whose heading is "2. ..." (Persian pages number it "۲.").
const SAVING_HEADING: RegExp = /^[^\n]*(2|۲)\./;

const NUMBERED_STEP: RegExp = /^\d\. /;

// The numbered steps of the "## 2." section of the Twilio guide.
function savingSteps(lang: string): Array<string> {
  const page: string = readPage(lang, "self-hosted/twilio-integration.md");
  const sections: Array<string> = page.split(/^## /m);
  const saving: Array<string> = sections.filter((section: string): boolean => {
    return SAVING_HEADING.test(section);
  });

  expect(saving).toHaveLength(1);

  // Its heading ("2. Save the credentials ...") is not one of its steps.
  return saving[0]!
    .split("\n")
    .slice(1)
    .filter((line: string): boolean => {
      return NUMBERED_STEP.test(line);
    });
}

// The step of the incoming call page that fills in the Twilio config.
function configStep(lang: string): Array<string> {
  const lines: Array<string> = readPage(
    lang,
    "on-call/incoming-call-policy.md",
  ).split("\n");

  const sid: number = lines.findIndex((line: string): boolean => {
    return line.includes("`AC`");
  });

  expect(sid).toBeGreaterThan(5);

  // From "3. ... Create Twilio Config" to "5. ... Save".
  const end: number = lines.findIndex((line: string, index: number) => {
    return index > sid && line.startsWith("5. ");
  });

  return lines.slice(sid - 4, end + 1);
}

describe("the docs on a project's first Twilio config", () => {
  it("are checked in all seventeen docs languages", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(LANGUAGES).toContain("en");
    expect(LANGUAGES).toContain("fa");
  });

  it("quote the table's own words", () => {
    const table: string = fs.readFileSync(TABLE_FILE, "utf8");

    expect(SWITCH).toBe("Set as Project Default");
    expect(table).toContain(`createVerb="${CREATE_BUTTON}"`);
    expect(table).toContain(`title: "${CARD_TITLE}"`);
    expect(table).toContain("title: TwilioConfigDefaultCopy.setDefaultTitle");
  });

  it.each(LANGUAGES)(
    "%s: the Twilio guide says the first config starts as the default, a later one does not, and how to move it",
    (lang: string) => {
      const words: (english: string) => string = dashboardWords(lang);
      const steps: Array<string> = savingSteps(lang);

      const step: string | undefined = steps.find((line: string): boolean => {
        return line.startsWith("4. ");
      });

      expect(step).toBeDefined();

      // Named twice: the form's switch, and the row menu's action.
      expect(step!.split(`**${words(SWITCH)}**`).length - 1).toBe(2);
      // And what an API create gets.
      expect(step).toContain("`isProjectDefault`");

      // Still five steps, the fifth still saying only one is the default.
      expect(
        steps.map((line: string): string => {
          return line.slice(0, 2);
        }),
      ).toEqual(["1.", "2.", "3.", "4.", "5."]);
    },
  );

  it("English no longer says a new config is not used until the switch is set", () => {
    const steps: string = savingSteps("en").join("\n");

    expect(steps).not.toContain("does not select it for those notifications");
    expect(steps).not.toContain("Enable **Set as Project Default** to use");
    expect(steps).toContain(
      "**Set as Project Default** starts on for the project's first configuration",
    );
    expect(steps).toContain("A later configuration starts with the switch off");
  });

  it.each(LANGUAGES)(
    "%s: the incoming call page names the real button, and says the config takes the project's SMS and calls",
    (lang: string) => {
      const words: (english: string) => string = dashboardWords(lang);
      const step: Array<string> = configStep(lang);

      expect(step[0]!.startsWith("3. ")).toBe(true);
      expect(step[0]).toContain(`**${words(CREATE_BUTTON)}**`);
      expect(step[0]).toContain(`**${words(CARD_TITLE)}**`);

      const switchLine: Array<string> = step.filter((line: string) => {
        return line.startsWith(`   - **${words(SWITCH)}**`);
      });

      expect(switchLine).toHaveLength(1);
      expect(switchLine[0]).toContain("Twilio");

      // The bullet sits with the other fields, before Save.
      expect(step[step.length - 1]!.startsWith("5. ")).toBe(true);
      expect(step[step.length - 2]).toBe(switchLine[0]);

      for (const old of OLD_BUTTONS) {
        expect({ lang, old, named: step.join("\n").includes(old) }).toEqual({
          lang,
          old,
          named: false,
        });
      }
    },
  );
});
