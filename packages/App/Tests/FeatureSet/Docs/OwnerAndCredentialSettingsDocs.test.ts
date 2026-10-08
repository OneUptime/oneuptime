import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHO OWNS A RESOURCE, AND A SETTING THAT HOLDS CREDENTIALS, ARE NAMED ONLY
 * BY SOMEONE WHO MAY READ THEM.
 *
 * Every owner table is read through the resource it owns
 * (@CanAccessIfCanReadOn, held by OwnerTablesReadThroughResource), the
 * settings that hold credentials are named only by a caller who may read
 * their table (RelationListPermission.isHeldToTableRead, and a runbook's
 * steps through RunbookService), and where a project was bought is written
 * by OneUptime alone.
 *
 * Users, Teams & Permissions says so in every docs language - a paragraph
 * closing the Owners section, and one after the paragraph on fields under
 * How OneUptime decides - the API reference says what a client sees, and the
 * upgrade notes say what changes, at length in English and in one line in
 * every other guide.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

// The Owners section's last paragraph: owners are read through the resource.
const OWNERS: Record<string, string> = {
  en: "Who owns a resource is read through the resource. The owners of a monitor or of any other resource are listed, read, added and removed only by someone who may read that resource, and a permission on owners alone reaches the owners of no resource you may not read.",
  da: "Hvem der ejer en ressource, læses gennem ressourcen.",
  de: "Wer eine Ressource besitzt, wird über die Ressource gelesen.",
  es: "Quién es propietario de un recurso se lee a través del recurso.",
  fa: "اینکه چه کسی مالک یک منبع است از طریق خودِ آن منبع خوانده می‌شود.",
  fr: "Les propriétaires d'une ressource se lisent à travers la ressource.",
  hi: "किसी संसाधन का स्वामी कौन है, यह उसी संसाधन के माध्यम से पढ़ा जाता है।",
  it: "Chi possiede una risorsa si legge attraverso la risorsa.",
  ja: "リソースのオーナーは、そのリソースを通じて読み取られます。",
  ko: "리소스의 소유자는 그 리소스를 통해 읽습니다.",
  nl: "Wie eigenaar is van een resource, wordt gelezen via die resource.",
  no: "Hvem som eier en ressurs, leses gjennom ressursen.",
  pt: "Quem é proprietário de um recurso é lido por meio do recurso.",
  ru: "Владельцы ресурса читаются через сам ресурс.",
  sv: "Vem som äger en resurs läses genom resursen.",
  "zh-CN": "资源的所有者通过该资源来读取。",
  "zh-TW": "資源的擁有者透過該資源來讀取。",
};

// After the paragraph on fields: a setting that holds credentials.
const CREDENTIALS: Record<string, string> = {
  en: "A setting that holds credentials is named only by someone who may read it. A create or a change names an SMTP server, a call and SMS provider, a runbook credential, SNMP credentials, a video call connection or an API key — such as the SMTP server a status page sends email with, or the credential a runbook step runs with — only when you may read that kind of setting; one you may not read is refused as if it did not exist, while a record keeps the one it names already. Searching a call and SMS provider for numbers to buy, or listing the numbers it owns, takes the same read. Approving an AI command plan with an SSH command, which runs with a runbook credential OneUptime AI picked from those of its Runner, takes the read of runbook credentials (**Read Runbook Credential**; Project Owners and Project Admins may), and so does saving an auto remediation rule that lets OneUptime AI run its commands without asking, when the save turns that on or adds allowlist patterns or Runners, or turning on **Runs AI Remediation Commands** for a Runner that holds SSH credentials.",
  da: "En indstilling, der indeholder legitimationsoplysninger, angives kun af en, der må læse den.",
  de: "Eine Einstellung, die Zugangsdaten enthält, nennt nur, wer sie lesen darf.",
  es: "Una configuración que contiene credenciales solo la nombra quien puede leerla.",
  fa: "تنظیمی که اطلاعات ورود را نگه می‌دارد فقط توسط کسی نام برده می‌شود که اجازه خواندنش را دارد.",
  fr: "Un paramètre qui contient des identifiants n'est désigné que par quelqu'un qui peut le lire.",
  hi: "क्रेडेंशियल रखने वाली सेटिंग को केवल वही व्यक्ति बता सकता है जो उसे पढ़ सकता है।",
  it: "Un'impostazione che contiene credenziali la nomina solo chi può leggerla.",
  ja: "認証情報を保持する設定は、それを読み取れる人だけが指定できます。",
  ko: "자격 증명을 담은 설정은 그것을 읽을 수 있는 사람만 지정할 수 있습니다.",
  nl: "Een instelling met inloggegevens wordt alleen genoemd door iemand die haar mag lezen.",
  no: "En innstilling som inneholder påloggingsinformasjon, angis bare av noen som kan lese den.",
  pt: "Uma configuração que guarda credenciais só é nomeada por quem pode lê-la.",
  ru: "Настройку, хранящую учётные данные, указывает только тот, кому можно её читать.",
  sv: "En inställning som innehåller inloggningsuppgifter anges bara av någon som får läsa den.",
  "zh-CN": "保存凭据的设置，只有能读取它的人才能指定。",
  "zh-TW": "保存憑證的設定，只有能讀取它的人才能指定。",
};

// The upgrade note's bold opening.
const UPGRADE_HEADING: Record<string, string> = {
  en: "Who owns a resource, and a setting that holds credentials, are named",
  da: "Hvem der ejer en ressource, og en indstilling med legitimationsoplysninger, angives kun af en, der må læse dem.",
  de: "Wer eine Ressource besitzt, und eine Einstellung mit Zugangsdaten werden nur von jemandem genannt, der sie lesen darf.",
  es: "Quién es propietario de un recurso, y una configuración con credenciales, solo los nombra quien puede leerlos.",
  fa: "مالک یک منبع و تنظیمی که اطلاعات ورود را نگه می‌دارد فقط توسط کسی نام برده می‌شوند که اجازه خواندنشان را دارد.",
  fr: "Les propriétaires d'une ressource, et un paramètre qui contient des identifiants, ne sont désignés que par quelqu'un qui peut les lire.",
  hi: "किसी संसाधन का स्वामी कौन है, और क्रेडेंशियल रखने वाली सेटिंग, केवल वही बता सकता है जो उन्हें पढ़ सकता है।",
  it: "Chi possiede una risorsa, e un'impostazione che contiene credenziali, li nomina solo chi può leggerli.",
  ja: "リソースのオーナーと、認証情報を保持する設定は、それを読み取れる人だけが指定できます。",
  ko: "리소스의 소유자와 자격 증명을 담은 설정은 그것을 읽을 수 있는 사람만 지정할 수 있습니다.",
  nl: "Wie eigenaar is van een resource, en een instelling met inloggegevens, worden alleen genoemd door iemand die ze mag lezen.",
  no: "Hvem som eier en ressurs, og en innstilling med påloggingsinformasjon, angis bare av noen som kan lese dem.",
  pt: "Quem é proprietário de um recurso, e uma configuração que guarda credenciais, só são nomeados por quem pode lê-los.",
  ru: "Владельцев ресурса и настройку с учётными данными указывает только тот, кому можно их читать.",
  sv: "Vem som äger en resurs, och en inställning med inloggningsuppgifter, anges bara av någon som får läsa dem.",
  "zh-CN": "资源的所有者，以及保存凭据的设置，只有能读取它们的人才能指定。",
  "zh-TW": "資源的擁有者，以及保存憑證的設定，只有能讀取它們的人才能指定。",
};

function read(language: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
}

function permissionsPage(language: string): string {
  return read(language, "permissions/index.md");
}

// The paragraphs of the section under the `index`th "## " heading, in order.
function sectionParagraphs(markdown: string, index: number): Array<string> {
  const lines: Array<string> = markdown.split("\n");
  const headings: Array<number> = lines
    .map((line: string, at: number): number => {
      return line.startsWith("## ") ? at : -1;
    })
    .filter((at: number): boolean => {
      return at >= 0;
    });

  return lines
    .slice(headings[index]! + 1, headings[index + 1]!)
    .join("\n")
    .split(/\n\s*\n/)
    .map((paragraph: string): string => {
      return paragraph.trim();
    })
    .filter((paragraph: string): boolean => {
      return paragraph.length > 0;
    });
}

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

// The Owners section, and How OneUptime decides whether a request is allowed.
const OWNERS_SECTION: number = 5;
const DECISION_SECTION: number = 9;

describe("Docs: who owns a resource, and a setting that holds credentials", () => {
  test("every docs language is checked, each with its own words", () => {
    expect(LANGUAGES).toHaveLength(17);

    for (const words of [OWNERS, CREDENTIALS, UPGRADE_HEADING]) {
      expect(Object.keys(words).sort()).toEqual([...LANGUAGES].sort());
    }
  });

  test("the sections are where the checks expect them, in English", () => {
    const page: string = permissionsPage("en");

    expect(sectionParagraphs(page, OWNERS_SECTION)[0]).toMatch(
      /^An owner is a user or a team attached to one specific resource/,
    );
    expect(sectionParagraphs(page, DECISION_SECTION)[0]).toMatch(
      /^For a signed-in user, in order:/,
    );
  });

  test.each(LANGUAGES)(
    "%s closes the Owners section with owners read through the resource, translated",
    (language: string) => {
      const page: string = permissionsPage(language);
      const owners: Array<string> = sectionParagraphs(page, OWNERS_SECTION);

      expect([
        language,
        owners[owners.length - 1]!.startsWith(OWNERS[language]!),
      ]).toEqual([language, true]);
      expect([language, countOf(page, OWNERS[language]!)]).toEqual([
        language,
        1,
      ]);

      // Right after the paragraph that says ownership on its own grants nothing.
      expect([
        language,
        owners.length,
        sectionParagraphs(permissionsPage("en"), OWNERS_SECTION).length,
      ]).toEqual([
        language,
        sectionParagraphs(permissionsPage("en"), OWNERS_SECTION).length,
        owners.length,
      ]);

      if (language !== "en") {
        expect([language, page.includes(OWNERS["en"]!)]).toEqual([
          language,
          false,
        ]);
      }
    },
  );

  test("in English the credentials paragraph follows the one on fields and precedes everything else the rule decides", () => {
    const paragraphs: Array<string> = sectionParagraphs(
      permissionsPage("en"),
      DECISION_SECTION,
    );
    const index: number = paragraphs.indexOf(CREDENTIALS["en"]!);

    expect(index).toBeGreaterThan(0);
    expect(paragraphs[index - 1]).toMatch(/^Fields follow the same rule\./);
    expect(paragraphs[index - 2]).toMatch(/^Every field of a record is read/);
    expect(paragraphs[index + 1]).toMatch(
      /^The same rule decides everything else/,
    );
  });

  test.each(LANGUAGES)(
    "%s says a setting that holds credentials is named only by someone who may read it, in the same place, translated",
    (language: string) => {
      const page: string = permissionsPage(language);
      const paragraphs: Array<string> = sectionParagraphs(
        page,
        DECISION_SECTION,
      );
      const english: Array<string> = sectionParagraphs(
        permissionsPage("en"),
        DECISION_SECTION,
      );
      const index: number = english.indexOf(CREDENTIALS["en"]!);

      expect([language, paragraphs.length]).toEqual([language, english.length]);
      expect([
        language,
        paragraphs[index]!.startsWith(CREDENTIALS[language]!),
      ]).toEqual([language, true]);
      expect([language, countOf(page, CREDENTIALS[language]!)]).toEqual([
        language,
        1,
      ]);

      // It names each kind of setting by what it is.
      for (const name of ["SMTP", "SNMP", "API"]) {
        expect([language, name, paragraphs[index]!.includes(name)]).toEqual([
          language,
          name,
          true,
        ]);
      }

      if (language !== "en") {
        expect([language, page.includes(CREDENTIALS["en"]!)]).toEqual([
          language,
          false,
        ]);
      }
    },
  );

  test("the API reference says how owners, settings that hold credentials and where a project was bought answer", () => {
    const page: string = read("en", "api-reference/api-reference.md");
    const section: string = page.slice(
      page.indexOf("### Records a request names"),
      page.indexOf("### Switches"),
    );

    for (const sentence of [
      "The owners of a resource - the user and team owner records of a monitor, an on-call policy, a dashboard and every other resource with owners - are read through the resource they own the same way",
      "an owner record of a resource you may not read is answered as if it did not exist.",
      "A setting that holds credentials - an SMTP server, a call and SMS provider, a runbook credential, SNMP credentials, a video call connection, an API key - is named only by a caller who may read that kind of setting",
      "a status page's `smtpConfig` and `callSmsConfig`, an incoming call policy's `projectCallSMSConfig`, a Kubernetes cluster's `aiAccessCredential`, a network device's or site's `snmpCredentialProfile`, an incident's or alert's video call `videoCallConnection`, an API key permission's `apiKey`, and the `credentialId` of a runbook's SSH and Kubernetes steps.",
      "is refused with the same `400`, under either of its names; a change that keeps the setting a record names already is not asked about.",
      "The number search and the owned-number list of an incoming call policy take the same read of the Call/SMS config they name.",
    ]) {
      expect([sentence, section.includes(sentence)]).toEqual([sentence, true]);
    }

    /*
     * The owners after the records read through another one, the settings
     * after the one record a write names.
     */
    expect(section.indexOf("The owners of a resource - ")).toBeGreaterThan(
      section.indexOf(
        "A change that moves such a record follows the same rule",
      ),
    );
    expect(section.indexOf("The owners of a resource - ")).toBeLessThan(
      section.indexOf("The records a create or a change lists"),
    );
    expect(
      section.indexOf("A setting that holds credentials - "),
    ).toBeGreaterThan(
      section.indexOf("The one record a create or a change names"),
    );

    const bought: string = page.slice(
      page.indexOf("### Where a project was bought"),
      page.indexOf("### Who created a record"),
    );

    expect(page.indexOf("### Where a project was bought")).toBeGreaterThan(
      page.indexOf("### Switches"),
    );

    for (const sentence of [
      "A project's reseller, reseller plan and reseller license (`resellerId`, `resellerPlanId`, `resellerLicenseId`, and the relations `reseller` and `resellerPlan`) are set by OneUptime alone",
      "A create or a change of a project that sends one of them is refused with a `400` that names the field, whoever sends it:",
      "User is not allowed to create on resellerId column of Project",
    ]) {
      expect([sentence, bought.includes(sentence)]).toEqual([sentence, true]);
    }
  });

  test("the English upgrade notes say what changes, after the one record a write names", () => {
    const page: string = read("en", "installation/upgrading.md");

    for (const sentence of [
      `- **${UPGRADE_HEADING["en"]!}`,
      "  rest - are now listed, read, added and removed through the resource they",
      "  incoming call policies now take the policy's own roles (`SettingsAdmin`,",
      "  is otherwise refused with the `400` that names the field and the ID; a",
      "  or call and SMS providers, such as `StatusPageAdmin`, no longer picks one",
      "  for a status page; a runbook author needs `ReadRunbookCredential` to name a",
      "  `resellerId`, `resellerPlanId`, `resellerLicenseId` or their relations is",
    ]) {
      expect([sentence, page.includes(sentence)]).toEqual([sentence, true]);
    }

    const named: number = page.indexOf(
      "- **The one record a write names, and a change of a record's labels, keep to",
    );
    const owners: number = page.indexOf(`- **${UPGRADE_HEADING["en"]!}`);
    const readById: number = page.indexOf(
      "- **Every grant and scope narrows what it reaches, and a read by ID of a",
    );

    expect(named).toBeGreaterThan(0);
    expect(owners).toBeGreaterThan(named);
    expect(readById).toBeGreaterThan(owners);
  });

  test.each(
    LANGUAGES.filter((language: string) => {
      return language !== "en";
    }),
  )(
    "the %s upgrade guide has the line, right before the one record a write names",
    (language: string) => {
      const lines: Array<string> = read(
        language,
        "installation/upgrading.md",
      ).split("\n");
      const found: Array<number> = lines
        .map((line: string, index: number): number => {
          return line.startsWith(`- **${UPGRADE_HEADING[language]!}**`)
            ? index
            : -1;
        })
        .filter((index: number): boolean => {
          return index >= 0;
        });

      expect([language, found.length]).toEqual([language, 1]);

      const line: string = lines[found[0]!]!;
      const next: string = lines[found[0]! + 1] || "";

      /*
       * The next line is the one record a write names, then a create under
       * a readable record.
       */
      expect([
        language,
        next.startsWith("- **") &&
          next.includes("`400`") &&
          next.includes("`422`") &&
          (lines[found[0]! + 2] || "").includes("`CreateIncidentInternalNote`"),
      ]).toEqual([language, true]);

      for (const token of [
        "`400`",
        "`SettingsAdmin`",
        "`SettingsMember`",
        "`SettingsViewer`",
        "`resellerId`",
        "`resellerPlanId`",
        "`resellerLicenseId`",
        "SMTP",
        "SNMP",
        "API",
        "OneUptime",
      ]) {
        expect([language, token, line.includes(token)]).toEqual([
          language,
          token,
          true,
        ]);
      }

      expect([language, line.includes(UPGRADE_HEADING["en"]!)]).toEqual([
        language,
        false,
      ]);
    },
  );
});
