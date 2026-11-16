import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import TwilioConfigDefaultCopy from "../../../FeatureSet/Dashboard/src/Components/CallSMS/TwilioConfigDefaultCopy";
import TwilioConfigUseCopy from "../../../FeatureSet/Dashboard/src/Components/CallSMS/TwilioConfigUseCopy";
import { drawnCreateButton, drawnDashboardLabel } from "./DocsDashboardLabels";
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
 *   the same way (ProjectCallSMSConfigService). Saving, the last step, says
 *   a project has a default for SMS and one for calls, so a config for SMS
 *   only and one for calls only can both be the default (#6574): it said
 *   only one config could be.
 * - on-call/incoming-call-policy.md sends people to create a config for an
 *   incoming call policy, which is very often the project's first: it says
 *   that config also takes the project's SMS and calls, and how not to. It
 *   also named a button the page never had ("Create Custom Call/SMS
 *   Config"); the card's button is "Create Twilio Config".
 *
 * That button is the table's: "Create" and the name the table gives its
 * rows. The table used to set the whole phrase as its verb, and drew it
 * before the model's own name - "Create Twilio Config Call and SMS Config";
 * it now names its rows "Twilio Config", as the card does.
 *
 * Markdown is not compiled, so these read the pages, the Dashboard's locale
 * files and the table's source. Each page, Persian included, names the
 * card, the switch and the button in the words its language's Dashboard
 * shows them, the button as the table draws it (drawnCreateButton).
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

/*
 * The "Used for" row of the Twilio guide's table of a project's config and
 * the installation-wide one, in every language (#6604): a project's config
 * takes its project's SMS while it is the default for SMS, and its calls
 * while it is the default for calls; the installation's account takes the
 * SMS or calls of a project with no default for them. It said one default
 * took both.
 */
const USED_FOR_ROWS: Record<string, string> = {
  en: "| Used for | SMS to the project's members while it is the project default for SMS, calls to them while it is the project default for calls, status pages it is assigned to, and incoming call policies that use it | SMS and calls to the members of any project that has no default configuration for them |",
  da: "| Bruges til | SMS til projektets medlemmer, så længe den er projektstandarden for SMS, opkald til dem, så længe den er projektstandarden for opkald, de statussider, den er tildelt, og de politikker for indgående opkald, der bruger den | SMS og opkald til medlemmerne af ethvert projekt, der ikke har en standardkonfiguration til dem |",
  de: "| Verwendet für | SMS an die Mitglieder des Projekts, solange sie der Projektstandard für SMS ist, Anrufe an sie, solange sie der Projektstandard für Anrufe ist, die Statusseiten, denen sie zugewiesen ist, und die Richtlinien für eingehende Anrufe, die sie verwenden | SMS und Anrufe an die Mitglieder jedes Projekts, das keine Standardkonfiguration dafür hat |",
  es: "| Se usa para | Los SMS a los miembros del proyecto mientras sea la predeterminada del proyecto para SMS, las llamadas a ellos mientras sea la predeterminada para llamadas, las páginas de estado a las que está asignada y las políticas de llamadas entrantes que la usan | Los SMS y las llamadas a los miembros de cualquier proyecto que no tenga configuración predeterminada para ellos |",
  fa: "| برای چه به کار می‌رود | پیامک‌ها به اعضای پروژه تا وقتی پیش‌فرض پروژه برای پیامک است، تماس‌ها با آن‌ها تا وقتی پیش‌فرض پروژه برای تماس است، صفحه‌های وضعیتی که به آن‌ها اختصاص یافته، و سیاست‌های تماس ورودی‌ای که از آن استفاده می‌کنند | پیامک‌ها و تماس‌ها به اعضای هر پروژه‌ای که برای آن‌ها پیکربندی پیش‌فرض ندارد |",
  fr: "| Utilisée pour | Les SMS vers les membres du projet tant qu'elle est la configuration par défaut du projet pour les SMS, les appels vers eux tant qu'elle est celle par défaut pour les appels, les pages de statut auxquelles elle est attribuée et les politiques d'appels entrants qui l'utilisent | Les SMS et appels vers les membres de tout projet qui n'a pas de configuration par défaut pour eux |",
  hi: "| किसके लिए इस्तेमाल होता है | जब तक यह SMS के लिए प्रोजेक्ट का डिफ़ॉल्ट है, प्रोजेक्ट के सदस्यों को SMS, जब तक यह कॉल के लिए प्रोजेक्ट का डिफ़ॉल्ट है, उन्हें कॉल, जिन स्थिति पृष्ठों को यह सौंपा गया है, और जो आने वाली कॉल नीतियाँ इसे इस्तेमाल करती हैं | किसी भी ऐसे प्रोजेक्ट के सदस्यों को SMS और कॉल जिसका उनके लिए कोई डिफ़ॉल्ट कॉन्फ़िगरेशन नहीं है |",
  it: "| Usata per | Gli SMS ai membri del progetto finché è la predefinita del progetto per gli SMS, le chiamate a loro finché è la predefinita per le chiamate, le pagine di stato a cui è assegnata e le policy delle chiamate in arrivo che la usano | SMS e chiamate ai membri di qualsiasi progetto che non ha una configurazione predefinita per essi |",
  ja: "| 用途 | SMS のプロジェクトのデフォルトである間のプロジェクトメンバーへの SMS、通話のプロジェクトのデフォルトである間のメンバーへの通話、割り当てられたステータスページ、この設定を使う着信ポリシー | それぞれのデフォルトの設定がないプロジェクトのメンバーへの SMS と通話 |",
  ko: "| 사용처 | SMS의 프로젝트 기본값인 동안 프로젝트 구성원에게 보내는 SMS, 통화의 프로젝트 기본값인 동안 그들에게 거는 통화, 이 구성이 할당된 상태 페이지, 이 구성을 쓰는 수신 전화 정책 | 해당 기본 구성이 없는 모든 프로젝트의 구성원에게 보내는 SMS와 통화 |",
  nl: "| Gebruikt voor | Sms naar de leden van het project zolang het de projectstandaard voor sms is, oproepen naar hen zolang het de projectstandaard voor oproepen is, de statuspagina's waaraan het is toegewezen en het beleid voor inkomende oproepen dat het gebruikt | Sms en oproepen naar de leden van elk project dat er geen standaardconfiguratie voor heeft |",
  no: "| Brukes til | SMS til prosjektets medlemmer så lenge den er prosjektstandarden for SMS, anrop til dem så lenge den er prosjektstandarden for anrop, statussidene den er tildelt, og policyene for innkommende anrop som bruker den | SMS og anrop til medlemmene i alle prosjekter som ikke har en standardkonfigurasjon for dem |",
  pt: "| Usada para | SMS aos membros do projeto enquanto ela for a padrão do projeto para SMS, chamadas a eles enquanto ela for a padrão para chamadas, as páginas de status às quais está atribuída e as políticas de chamadas recebidas que a usam | SMS e chamadas aos membros de qualquer projeto que não tenha configuração padrão para eles |",
  ru: "| Используется для | SMS участникам проекта, пока она используется по умолчанию для SMS проекта, звонков им, пока она используется по умолчанию для звонков проекта, страниц статуса, которым она назначена, и политик входящих звонков, которые её используют | SMS и звонков участникам любого проекта, в котором для них нет конфигурации по умолчанию |",
  sv: "| Används för | SMS till projektets medlemmar så länge den är projektstandard för SMS, samtal till dem så länge den är projektstandard för samtal, de statussidor den är tilldelad och de policyer för inkommande samtal som använder den | SMS och samtal till medlemmarna i alla projekt som saknar standardkonfiguration för dem |",
  "zh-CN":
    "| 用于 | 作为短信的项目默认配置期间发给项目成员的短信、作为通话的项目默认配置期间打给他们的电话、分配给它的状态页面，以及使用它的来电策略 | 发给任何没有相应默认配置的项目成员的短信和电话 |",
  "zh-TW":
    "| 用於 | 作為簡訊的專案預設設定期間傳給專案成員的簡訊、作為通話的專案預設設定期間打給他們的電話、指派給它的狀態頁面，以及使用它的來電原則 | 傳給任何沒有相應預設設定的專案成員的簡訊和電話 |",
};

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

// A label as the language's Dashboard draws it, Persian included.
function dashboardWords(lang: string): (english: string) => string {
  return (english: string): string => {
    return drawnDashboardLabel(lang, english);
  };
}

// The value of a key in the language's Dashboard locale, if it has one.
function localeValue(lang: string, key: string): unknown {
  const locale: Record<string, unknown> = JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES_DIR, `${lang}.json`), "utf8"),
  ) as Record<string, unknown>;

  return locale[key];
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

/*
 * The step of the incoming call page's setup that adds the Twilio account:
 * from the step's heading to the next one. Its text names the card and the
 * button, then lists the form's fields.
 */
function configStep(lang: string): Array<string> {
  const lines: Array<string> = readPage(
    lang,
    "on-call/incoming-call-policy.md",
  ).split("\n");

  const sid: number = lines.findIndex((line: string): boolean => {
    return line.includes("`AC`");
  });

  expect(sid).toBeGreaterThan(5);

  let start: number = sid;

  while (start > 0 && !lines[start]!.startsWith("### ")) {
    start--;
  }

  let end: number = sid;

  while (end < lines.length - 1 && !lines[end + 1]!.startsWith("### ")) {
    end++;
  }

  return lines.slice(start, end + 1).filter((line: string): boolean => {
    return line.trim().length > 0;
  });
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
    expect(table).toContain(`title: "${CARD_TITLE}"`);
    expect(table).toContain("title: TwilioConfigDefaultCopy.setDefaultTitle");
  });

  it("the table's button is Create and the name it gives its rows, the card's title", () => {
    const table: string = fs.readFileSync(TABLE_FILE, "utf8");

    expect(table).toContain(`singularName="${CARD_TITLE}"`);
    expect(table).toContain(`pluralName="${CARD_TITLE}s"`);
    /*
     * A verb is drawn before the row's name: "Create Twilio Config" as the
     * verb drew "Create Twilio Config Call and SMS Config".
     */
    expect(table).not.toContain("createVerb=");
    expect(CREATE_BUTTON).toBe(`Create ${CARD_TITLE}`);
    expect(drawnCreateButton("en", CREATE_BUTTON)).toBe(CREATE_BUTTON);
  });

  it("the table's plural name is translated in every language, as its singular one is", () => {
    for (const lang of LANGUAGES) {
      const singular: unknown = localeValue(lang, CARD_TITLE);
      const plural: unknown = localeValue(lang, `${CARD_TITLE}s`);

      expect({
        lang,
        singular: typeof singular,
        plural: typeof plural,
      }).toEqual({ lang, singular: "string", plural: "string" });

      if (lang !== "en") {
        expect({ lang, translated: plural !== `${CARD_TITLE}s` }).toEqual({
          lang,
          translated: true,
        });
      }
    }
  });

  it.each(LANGUAGES)(
    "%s: the button is drawn as the Dashboard draws it, with the card's own word for a config",
    (lang: string) => {
      const button: string = drawnCreateButton(lang, CREATE_BUTTON);
      const card: string = dashboardWords(lang)(CARD_TITLE);

      // Never the English phrase where the language words the card.
      if (card !== CARD_TITLE) {
        expect(button).not.toBe(CREATE_BUTTON);
      }

      const wholePhrase: unknown = localeValue(lang, CREATE_BUTTON);

      if (typeof wholePhrase === "string" && wholePhrase !== CREATE_BUTTON) {
        expect(button).toBe(wholePhrase);
      } else {
        expect(button).toContain(card);
      }
    },
  );

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

      // Still five steps.
      expect(
        steps.map((line: string): string => {
          return line.slice(0, 2);
        }),
      ).toEqual(["1.", "2.", "3.", "4.", "5."]);
    },
  );

  it.each(LANGUAGES)(
    "%s: the Twilio guide's last step says a config for SMS only and one for calls only can both be the default",
    (lang: string) => {
      const words: (english: string) => string = dashboardWords(lang);
      const step: string | undefined = savingSteps(lang).find(
        (line: string): boolean => {
          return line.startsWith("5. ");
        },
      );

      expect(step).toBeDefined();

      // The two choices of Use This Account For, as the form names them.
      for (const use of ["SMS only", "Calls only"]) {
        expect({
          lang,
          use,
          named: step!.includes(`**${words(use)}**`),
        }).toEqual({ lang, use, named: true });
      }

      /*
       * And it sends the reader to the section that says how: the link the
       * page's troubleshooting table has for it too.
       */
      const page: string = readPage(lang, "self-hosted/twilio-integration.md");
      const links: Array<string> = step!.match(/\]\(#[^)]+\)/g) || [];

      expect(links).toHaveLength(1);
      expect(page.split(links[0]!).length - 1).toBeGreaterThanOrEqual(2);
    },
  );

  it("English no longer says only one configuration can be the project default", () => {
    const page: string = readPage("en", "self-hosted/twilio-integration.md");

    expect(page).not.toContain(
      "Only one configuration can be the project default",
    );
    expect(page).toContain(
      "A project has one default for SMS and one for calls, so a configuration used for **SMS only** and one used for **Calls only** can both be the default",
    );
  });

  /*
   * The card waits folded under Notification Settings' More settings: most
   * projects never add a Twilio account of their own
   * (Components/NotificationMethods/OwnSendersFold).
   */
  it.each(LANGUAGES)(
    "%s: the Twilio guide's first step opens More settings, in the dashboard's words",
    (lang: string) => {
      const words: (english: string) => string = dashboardWords(lang);
      const step: string | undefined = savingSteps(lang).find(
        (line: string): boolean => {
          return line.startsWith("1. ");
        },
      );

      expect(step).toBeDefined();
      expect(step).toContain(`**${words("More settings")}**`);
    },
  );

  it.each(LANGUAGES)(
    "%s: the Twilio guide's second step names the card, and its button as the table draws it",
    (lang: string) => {
      const words: (english: string) => string = dashboardWords(lang);
      const step: string | undefined = savingSteps(lang).find(
        (line: string): boolean => {
          return line.startsWith("2. ");
        },
      );

      expect(step).toBeDefined();
      expect(step).toContain(`**${words(CARD_TITLE)}**`);
      expect(step).toContain(`**${drawnCreateButton(lang, CREATE_BUTTON)}**`);
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

      // The step's heading, then where to go: the card and its button.
      expect(step[0]!.startsWith("### ")).toBe(true);
      expect(step[1]).toContain(
        `**${drawnCreateButton(lang, CREATE_BUTTON)}**`,
      );
      expect(step[1]).toContain(`**${words(CARD_TITLE)}**`);
      // Under More settings, where the card waits folded.
      expect(step[1]).toContain(`**${words("More settings")}**`);

      const fields: Array<string> = step.filter((line: string): boolean => {
        return line.startsWith("- **");
      });
      const switchLine: Array<string> = fields.filter((line: string) => {
        return line.startsWith(`- **${words(SWITCH)}**`);
      });

      expect(switchLine).toHaveLength(1);
      expect(switchLine[0]).toContain("Twilio");

      // The switch is the form's last field, and the step's last line.
      expect(fields[fields.length - 1]).toBe(switchLine[0]);
      expect(step[step.length - 1]).toBe(switchLine[0]);

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

/*
 * A project has one default for SMS and one for calls (#6574), and the two
 * pages say so where they still described one default for everything
 * (#6604): the Twilio guide's "Used for" row and its step 4, and the
 * fields of the incoming call page's Twilio config, which is very often a
 * config for calls only.
 */
describe("the docs on a project's default for SMS and its default for calls", () => {
  it("pins a Used for row for every docs language", () => {
    expect(Object.keys(USED_FOR_ROWS).sort()).toEqual([...LANGUAGES].sort());
  });

  it.each(LANGUAGES)(
    "%s: the Twilio guide's Used for row gives each default what it is the default for, and the installation's account what has none",
    (lang: string) => {
      const lines: Array<string> = readPage(
        lang,
        "self-hosted/twilio-integration.md",
      ).split("\n");

      expect(lines).toContain(USED_FOR_ROWS[lang]);
    },
  );

  it("English: a project's config while it is the default for SMS, for calls; the installation's for what has no default", () => {
    const row: string = USED_FOR_ROWS["en"]!;

    expect(row).toContain("while it is the project default for SMS");
    expect(row).toContain("while it is the project default for calls");
    expect(row).toContain("that has no default configuration for them |");
    expect(row).not.toContain("while it is the project default,");
  });

  it.each(LANGUAGES)(
    "%s: step 4 names the row menu's action for SMS and for calls, in the Dashboard's words",
    (lang: string) => {
      const words: (english: string) => string = dashboardWords(lang);
      const step: string | undefined = savingSteps(lang).find(
        (line: string): boolean => {
          return line.startsWith("4. ");
        },
      );

      expect(step).toBeDefined();

      for (const action of [
        TwilioConfigDefaultCopy.setSmsDefaultTitle,
        TwilioConfigDefaultCopy.setCallsDefaultTitle,
      ]) {
        expect({
          lang,
          action,
          named: step!.includes(`**${words(action)}**`),
        }).toEqual({ lang, action, named: true });
      }

      // The switch is still named twice: the actions for one kind are labels of their own.
      expect(step!.split(`**${words(SWITCH)}**`).length - 1).toBe(2);
    },
  );

  it("English step 4 says the menu names which, for a config that would take one kind", () => {
    const step: string | undefined = savingSteps("en").find(
      (line: string): boolean => {
        return line.startsWith("4. ");
      },
    );

    expect(TwilioConfigDefaultCopy.setSmsDefaultTitle).toBe(
      "Set as Project Default for SMS",
    );
    expect(TwilioConfigDefaultCopy.setCallsDefaultTitle).toBe(
      "Set as Project Default for Calls",
    );
    expect(step).toContain(
      "For a configuration that would take only the SMS or only the calls, the menu says which: **Set as Project Default for SMS** or **Set as Project Default for Calls**.",
    );
  });

  it.each(LANGUAGES)(
    "%s: the incoming call page names Use This Account For right after the name, with its choices for calls, and what the switch then takes",
    (lang: string) => {
      const words: (english: string) => string = dashboardWords(lang);
      const fields: Array<string> = configStep(lang).filter(
        (line: string): boolean => {
          return line.startsWith("- **");
        },
      );

      const useLines: Array<string> = fields.filter((line: string) => {
        return line.startsWith(
          `- **${words(TwilioConfigUseCopy.fieldTitle)}**`,
        );
      });

      expect(useLines).toHaveLength(1);
      // Asked after the name and description, as the form asks it.
      expect(fields.indexOf(useLines[0]!)).toBe(1);

      for (const use of [
        TwilioConfigUseCopy.callsAndSmsTitle,
        TwilioConfigUseCopy.callsOnlyTitle,
      ]) {
        expect({
          lang,
          use,
          named: useLines[0]!.includes(`**${words(use)}**`),
        }).toEqual({ lang, use, named: true });
      }

      // The switch takes the project's calls, and its SMS for an account used for both.
      const switchLine: string | undefined = fields.find((line: string) => {
        return line.startsWith(`- **${words(SWITCH)}**`);
      });

      expect(switchLine).toContain(
        `**${words(TwilioConfigUseCopy.callsAndSmsTitle)}**`,
      );
    },
  );

  it("English: the incoming call page's account for calls only, its primary number, and what the switch takes", () => {
    const step: string = configStep("en").join("\n");

    expect(step).toContain(
      "- **Use This Account For**: **Calls and SMS**, or **Calls only** when the account's numbers cannot send SMS. Incoming calls work with either.",
    );
    expect(step).toContain(
      "- **Twilio Primary Phone Number**: a number of that account, for the calls it makes, and for its SMS when it sends them.",
    );
    expect(step).toContain(
      "- **Set as Project Default**: on for the project's first Twilio config, so the calls to the project's members go through this account too, and their SMS when it is used for **Calls and SMS**. Turn it off if this account is only for incoming calls.",
    );
    expect(step).not.toContain("for the SMS and calls it sends");
  });
});
