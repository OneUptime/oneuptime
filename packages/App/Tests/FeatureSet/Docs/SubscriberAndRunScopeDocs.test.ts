import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT A SUBSCRIPTION, A RULE'S RUN NOW, AN LLM PROVIDER LIST AND AN AI
 * PLAN'S APPROVAL REACH STAYS WITHIN WHAT THEY ARE ALLOWED.
 *
 * - A status page subscription names only resources of its own page, and a
 *   visitor only those the page shows (StatusPageSubscriberResources): the
 *   Subscribers page says so.
 * - A network's site assignment, device label and auto import rules run
 *   only with permissions that reach the whole project, and a block with
 *   labels refuses every rule's Run Now (RuleRunPermission): Run Rules on
 *   Existing Resources and the network device page say so.
 * - LLM providers are read by the project's members who may read its
 *   settings, the global list by anyone signed in: the LLM provider page
 *   says so.
 * - Approving an AI plan with an SSH command, and letting a rule run AI
 *   commands without asking, take the read of runbook credentials
 *   (AiRemediationCredentialUse): the AI SRE page says so.
 *
 * Users, Teams & Permissions carries the two rules in every docs language -
 * a paragraph before the scope-exempt roles, and the last paragraph of How
 * OneUptime decides - and the upgrade notes say what changes, at length in
 * English and in one line in every other guide.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

// Acting on the whole project: the opening of the paragraph in Scope.
const RUN_NOW: Record<string, string> = {
  en: "**Acting on the whole project takes a permission that reaches it.**",
  da: "**At handle på hele projektet kræver en tilladelse, der når hele projektet.**",
  de: "**Was auf das ganze Projekt wirkt, braucht eine Berechtigung, die das ganze Projekt erreicht.**",
  es: "**Actuar sobre todo el proyecto requiere un permiso que lo alcance.**",
  fa: "**عملی که روی کل پروژه انجام می‌شود به مجوزی نیاز دارد که به کل پروژه برسد.**",
  fr: "**Agir sur tout le projet demande une permission qui l'atteint.**",
  hi: "**पूरे प्रोजेक्ट पर कार्य करने के लिए ऐसी अनुमति चाहिए जो पूरे प्रोजेक्ट तक पहुँचे।**",
  it: "**Agire su tutto il progetto richiede un permesso che lo raggiunga.**",
  ja: "**プロジェクト全体に作用する操作には、プロジェクト全体に届く権限が必要です。**",
  ko: "**프로젝트 전체에 작용하는 작업에는 프로젝트 전체에 미치는 권한이 필요합니다.**",
  nl: "**Werken op het hele project vraagt een machtiging die het hele project bereikt.**",
  no: "**Å handle på hele prosjektet krever en tillatelse som når hele prosjektet.**",
  pt: "**Agir sobre todo o projeto exige uma permissão que o alcance.**",
  ru: "**Действие на весь проект требует разрешения, которое охватывает весь проект.**",
  sv: "**Att verka på hela projektet kräver en behörighet som når hela projektet.**",
  "zh-CN": "**作用于整个项目的操作，需要覆盖整个项目的权限。**",
  "zh-TW": "**作用於整個專案的操作，需要涵蓋整個專案的權限。**",
};

// A command runs with a credential only for its reader: How OneUptime decides.
const CREDENTIAL_USE: Record<string, string> = {
  en: "A command runs with a runbook credential only for someone who may read runbook credentials",
  da: "En kommando kører kun med runbook-legitimationsoplysninger for en, der må læse runbook-legitimationsoplysninger",
  de: "Ein Befehl läuft mit Runbook-Zugangsdaten nur für jemanden, der Runbook-Zugangsdaten lesen darf",
  es: "Un comando se ejecuta con una credencial de runbook solo para quien puede leer credenciales de runbook",
  fa: "یک فرمان فقط برای کسی با اطلاعات ورود ران‌بوک اجرا می‌شود که اجازه خواندن اطلاعات ورود ران‌بوک را دارد",
  fr: "Une commande s'exécute avec un identifiant de runbook seulement pour quelqu'un qui peut lire les identifiants de runbook",
  hi: "कोई कमांड रनबुक क्रेडेंशियल के साथ केवल उसी के लिए चलता है जो रनबुक क्रेडेंशियल पढ़ सकता है",
  it: "Un comando viene eseguito con una credenziale di runbook solo per chi può leggere le credenziali di runbook",
  ja: "Runbook の認証情報を使ってコマンドが実行されるのは、Runbook の認証情報を読み取れる人の場合だけです",
  ko: "런북 자격 증명으로 명령이 실행되는 것은 런북 자격 증명을 읽을 수 있는 사람에게만 허용됩니다",
  nl: "Een opdracht draait alleen met runbook-inloggegevens voor iemand die runbook-inloggegevens mag lezen",
  no: "En kommando kjører bare med runbook-påloggingsinformasjon for noen som kan lese runbook-påloggingsinformasjon",
  pt: "Um comando é executado com uma credencial de runbook só para quem pode ler credenciais de runbook",
  ru: "Команда выполняется с учётными данными runbook только для того, кому можно читать учётные данные runbook",
  sv: "Ett kommando körs med runbook-inloggningsuppgifter bara för någon som får läsa runbook-inloggningsuppgifter",
  "zh-CN": "只有能读取运行手册凭据的人，命令才会使用运行手册凭据运行",
  "zh-TW": "只有能讀取 Runbook 憑證的人，命令才會使用 Runbook 憑證執行",
};

// The upgrade note's bold opening.
const UPGRADE_HEADING: Record<string, string> = {
  en: "What a subscription, a rule's Run Now, an LLM provider list and an AI",
  da: "Hvad et abonnement, en regels Run Now, en liste over LLM-udbydere og godkendelsen af en AI-plan når, holder sig inden for det tilladte.",
  de: "Was ein Abonnement, das Run Now einer Regel, eine Liste der LLM-Anbieter und die Genehmigung eines KI-Plans erreichen, bleibt im erlaubten Rahmen.",
  es: "Lo que alcanzan una suscripción, el Run Now de una regla, una lista de proveedores de LLM y la aprobación de un plan de IA se queda dentro de lo permitido.",
  fa: "آنچه یک اشتراک، Run Now یک قانون، فهرست ارائه‌دهندگان LLM و تأیید یک برنامه هوش مصنوعی به آن می‌رسند در محدوده مجاز می‌ماند.",
  fr: "Ce qu'atteignent un abonnement, le Run Now d'une règle, une liste de fournisseurs LLM et l'approbation d'un plan IA reste dans ce qui est permis.",
  hi: "सदस्यता, किसी नियम का Run Now, LLM प्रदाताओं की सूची और AI योजना की स्वीकृति जहाँ तक पहुँचते हैं, वह अनुमति की सीमा में रहता है।",
  it: "Ciò che raggiungono un'iscrizione, il Run Now di una regola, un elenco di provider LLM e l'approvazione di un piano IA resta entro quanto consentito.",
  ja: "サブスクリプション、ルールの Run Now、LLM プロバイダーの一覧、AI プランの承認が届く範囲は、許可された範囲内に収まります。",
  ko: "구독, 규칙의 Run Now, LLM 공급자 목록, AI 계획 승인이 닿는 범위는 허용된 범위 안에 머뭅니다.",
  nl: "Wat een abonnement, de Run Now van een regel, een lijst van LLM-providers en de goedkeuring van een AI-plan bereiken, blijft binnen wat is toegestaan.",
  no: "Det et abonnement, en regels Run Now, en liste over LLM-leverandører og godkjenningen av en AI-plan når, holder seg innenfor det som er tillatt.",
  pt: "O que uma assinatura, o Run Now de uma regra, uma lista de provedores de LLM e a aprovação de um plano de IA alcançam fica dentro do permitido.",
  ru: "То, до чего доходят подписка, Run Now правила, список провайдеров LLM и одобрение плана ИИ, остаётся в пределах разрешённого.",
  sv: "Det en prenumeration, en regels Run Now, en lista över LLM-leverantörer och godkännandet av en AI-plan når håller sig inom det som är tillåtet.",
  "zh-CN":
    "订阅、规则的 Run Now、LLM 提供商列表和 AI 计划的批准所能触及的范围，都在允许之内。",
  "zh-TW":
    "訂閱、規則的 Run Now、LLM 提供者清單和 AI 計畫的核准所能觸及的範圍，都在允許之內。",
};

// The sections of Users, Teams & Permissions these rules sit in.
const SCOPE_SECTION: number = 4;
const DECISION_SECTION: number = 9;

function read(language: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
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

// The paragraph of `markdown` that starts with `opening`, or "".
function paragraphStartingWith(markdown: string, opening: string): string {
  return (
    markdown
      .split(/\n\s*\n/)
      .map((paragraph: string): string => {
        return paragraph.trim();
      })
      .find((paragraph: string): boolean => {
        return paragraph.startsWith(opening);
      }) || ""
  );
}

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("Docs: what a subscription, a rule run, an LLM provider list and an AI plan reach", () => {
  test("every docs language is checked, each with its own words", () => {
    expect(LANGUAGES).toHaveLength(17);

    for (const words of [RUN_NOW, CREDENTIAL_USE, UPGRADE_HEADING]) {
      expect(Object.keys(words).sort()).toEqual([...LANGUAGES].sort());

      for (const language of LANGUAGES) {
        if (language === "en") {
          continue;
        }

        expect([language, words[language] === words["en"]]).toEqual([
          language,
          false,
        ]);
      }
    }
  });

  test("Subscribers says a subscription chooses among its own page's resources", () => {
    const page: string = read("en", "status-pages/subscribers.md");
    const paragraph: string = paragraphStartingWith(
      page,
      "**A subscriber chooses among its own page's resources.**",
    );

    for (const sentence of [
      "**Subscribed to Resources** names resources of the subscriber's own status page, whoever writes it: a visitor on the page, a teammate on the dashboard, an API key or a workflow.",
      "A visitor picks from what the page shows them, so a resource whose monitor is archived, which the page hides, is not one they can pick.",
      "A resource of another status page, or one the page hides from a visitor, is refused with the `400` that names the field and the ID, as an ID that matches nothing is.",
      "A change asks only about the resources it adds, so a subscription keeps a resource it names already",
      "A subscriber is told about an event only through resources of its own page.",
    ]) {
      expect([sentence, paragraph.includes(sentence)]).toEqual([
        sentence,
        true,
      ]);
    }

    // Right after the fields the choices land on, under the choosing section.
    const choosing: number = page.indexOf(
      "## Letting subscribers choose resources and event types",
    );
    const fields: number = page.indexOf(
      "The choices land on the subscriber record as **Is Subscribed to All Resources**",
    );
    const rule: number = page.indexOf(paragraph);

    expect(choosing).toBeGreaterThan(0);
    expect(fields).toBeGreaterThan(choosing);
    expect(rule).toBeGreaterThan(fields);
    expect(page.slice(fields, rule).split(/\n\s*\n/)).toHaveLength(2);
  });

  test("Run Rules on Existing Resources says a run takes permissions that reach the whole project", () => {
    const page: string = read("en", "configuration/run-rules-now.md");
    const permissions: string = page.slice(
      page.indexOf("## Permissions"),
      page.indexOf("## Related"),
    );

    for (const sentence of [
      "A permission limited to specific labels, or to owned resources, is not enough, because a run can change every resource in the project.",
      "a block limited to some labels counts too: a run would change the resources carrying those labels, so a block with labels on editing the resources a rule changes refuses the run.",
      "a site assignment or device label rule's **Run Now** needs permission to edit the rule and **Edit Network Device**",
      "an auto import rule's **Dry Run** and **Run Rule** need permission to edit the rule, **Create Network Device** and, when the rule has a Monitor Template, **Create Monitor** - each reaching the whole project.",
      "(/docs/monitor/network-device-monitor#importing-automatically-with-auto-import-rules)",
    ]) {
      expect([sentence, permissions.includes(sentence)]).toEqual([
        sentence,
        true,
      ]);
    }
  });

  test("the network device page says who may run an auto import rule", () => {
    const page: string = read("en", "monitor/network-device-monitor.md");
    const paragraph: string = paragraphStartingWith(
      page,
      "**Who may run a rule.**",
    );

    for (const sentence of [
      "A run reaches every scan of the project, so pressing **Dry Run** or **Run Rule** takes permissions that reach the whole project:",
      "**Edit Network Device Auto Import Rule** and **Create Network Device** - and **Create Monitor** when the rule has a Monitor Template - each scoped to all resources in the project.",
      "A permission restricted to labels or to owned devices is not enough, and a team's block with labels on creating devices or monitors refuses the run.",
      "(/docs/configuration/run-rules-now#permissions)",
    ]) {
      expect([sentence, paragraph.includes(sentence)]).toEqual([
        sentence,
        true,
      ]);
    }

    // Right after the two buttons it is about.
    const runRule: number = page.indexOf(
      "- **Run Rule** does the same evaluation and performs the import.",
    );

    expect(runRule).toBeGreaterThan(0);
    expect(page.indexOf(paragraph)).toBeGreaterThan(runRule);
    expect(
      page.slice(runRule, page.indexOf(paragraph)).split(/\n\s*\n/),
    ).toHaveLength(2);
  });

  test("the LLM provider page says who can see a provider", () => {
    const page: string = read("en", "ai/llm-provider.md");
    const section: string = page.slice(
      page.indexOf("### Who can see a provider"),
      page.indexOf("## Provider-Specific Configuration"),
    );

    expect(page.indexOf("### Who can see a provider")).toBeGreaterThan(0);

    for (const sentence of [
      "A project's LLM providers are read only by its members who may read the project's settings: **Project Owner**, **Project Admin**, **Project Member**, **Viewer**, **Settings Admin**, **Settings Member**, **Settings Viewer** and **Read LLM**.",
      "A provider's **API Key** is read by the project's owners and admins alone.",
      "shows their name, description and price to anyone signed in, and nothing else about them.",
    ]) {
      expect([sentence, section.includes(sentence)]).toEqual([sentence, true]);
    }
  });

  test.each(
    LANGUAGES.filter((language: string) => {
      return language !== "en";
    }),
  )(
    "the %s LLM provider guide names who can see a provider, before the provider-specific configuration",
    (language: string) => {
      const lines: Array<string> = read(language, "ai/llm-provider.md").split(
        "\n",
      );
      const roles: number = lines.findIndex((line: string): boolean => {
        return (
          line.includes("**Settings Viewer**") && line.includes("**Read LLM**")
        );
      });

      expect([language, roles > 0]).toEqual([language, true]);

      // A heading of its own right above it, and the next section right after.
      expect([language, lines[roles - 2]!.startsWith("### ")]).toEqual([
        language,
        true,
      ]);
      expect([language, lines[roles + 2]!.startsWith("## ")]).toEqual([
        language,
        true,
      ]);

      for (const role of [
        "**Project Owner**",
        "**Project Admin**",
        "**Project Member**",
        "**Viewer**",
        "**Settings Admin**",
        "**Settings Member**",
      ]) {
        expect([language, role, lines[roles]!.includes(role)]).toEqual([
          language,
          role,
          true,
        ]);
      }
    },
  );

  test("the AI SRE page says what approving an SSH command and running without asking take", () => {
    const page: string = read("en", "ai/ai-sre.md");
    const paragraph: string = paragraphStartingWith(
      page,
      "**Commands on Runners and the credentials they run with.**",
    );

    for (const sentence of [
      "Approving a plan with an SSH command confirms that pick, so it takes permission to read runbook credentials (**Read Runbook Credential**, or a Project Owner or Project Admin), as naming a credential in a runbook step does; without it the approval is refused, saying who may approve the plan, and nothing runs.",
      "Letting such a rule run its commands without asking - **Fix without asking**, with a command allowlist - takes the same permission when a save turns that on or adds allowlist patterns or Runners; narrowing the rule, or turning that off, does not.",
      "A kubectl command runs with the credential bound to its cluster on the **AI agent** page, which only someone who may read runbook credentials can bind (see [Who may change it](#who-may-change-it)), so approving it asks nothing more.",
    ]) {
      expect([sentence, paragraph.includes(sentence)]).toEqual([
        sentence,
        true,
      ]);
    }

    // It closes the rules section, before auto-remediation waits for the analysis.
    const rule: number = page.indexOf(paragraph);

    expect(rule).toBeGreaterThan(0);
    expect(page.indexOf("## Auto-remediation waits for the analysis")).toBe(
      page.indexOf("\n## ", rule) + 1,
    );
    expect(page).toContain("\n### Who may change it\n");
  });

  test.each(LANGUAGES)(
    "Users, Teams & Permissions (%s) says acting on the whole project takes a permission that reaches it, before the scope-exempt roles",
    (language: string) => {
      const markdown: string = read(language, "permissions/index.md");
      const scope: Array<string> = sectionParagraphs(markdown, SCOPE_SECTION);
      const english: Array<string> = sectionParagraphs(
        read("en", "permissions/index.md"),
        SCOPE_SECTION,
      );

      expect([language, countOf(markdown, RUN_NOW[language]!)]).toEqual([
        language,
        1,
      ]);

      const at: number = scope.findIndex((paragraph: string): boolean => {
        return paragraph.startsWith(RUN_NOW[language]!);
      });
      const exempt: number = scope.indexOf("{{PERMISSION_SCOPE_EXEMPT_ROLES}}");

      // The paragraph introducing the scope-exempt roles comes right after.
      expect([language, at, exempt]).toEqual([language, exempt - 2, exempt]);
      expect([language, scope.length]).toEqual([language, english.length]);

      for (const token of ["**Run Now**"]) {
        expect([language, token, scope[at]!.includes(token)]).toEqual([
          language,
          token,
          true,
        ]);
      }
    },
  );

  test.each(LANGUAGES)(
    "Users, Teams & Permissions (%s) closes How OneUptime decides with the credential a command runs with",
    (language: string) => {
      const markdown: string = read(language, "permissions/index.md");
      const decision: Array<string> = sectionParagraphs(
        markdown,
        DECISION_SECTION,
      );
      const english: Array<string> = sectionParagraphs(
        read("en", "permissions/index.md"),
        DECISION_SECTION,
      );
      const last: string = decision[decision.length - 1]!;

      expect([language, countOf(markdown, CREDENTIAL_USE[language]!)]).toEqual([
        language,
        1,
      ]);
      expect([language, last.startsWith(CREDENTIAL_USE[language]!)]).toEqual([
        language,
        true,
      ]);
      expect([language, decision.length]).toEqual([language, english.length]);

      for (const token of [
        "**Read Runbook Credential**",
        "SSH",
        "OneUptime AI",
      ]) {
        expect([language, token, last.includes(token)]).toEqual([
          language,
          token,
          true,
        ]);
      }
    },
  );

  test("the English upgrade notes say what changes, before who owns a resource", () => {
    const page: string = read("en", "installation/upgrading.md");

    for (const sentence of [
      `- **${UPGRADE_HEADING["en"]!}`,
      "  - A status page subscription names only resources of its own status page.",
      "    names the field and the ID, as one that does not exist is. A change asks",
      "  - **Run Now** on a network's site assignment, device label and auto import",
      "    or to owned resources is refused with a `422`, and so is a team's block",
      "    a request that is not signed in gets a `401`. The list of global LLM",
      "  - Approving an AI command plan with an SSH command needs permission to",
      "    read runbook credentials (`ReadRunbookCredential`, or `ProjectOwner` or",
      "  See [Letting subscribers choose resources and event types](/docs/status-pages/subscribers#letting-subscribers-choose-resources-and-event-types),",
      "  [Run Rules on Existing Resources](/docs/configuration/run-rules-now#permissions)",
    ]) {
      expect([sentence, page.includes(sentence)]).toEqual([sentence, true]);
    }

    const named: number = page.indexOf(
      "- **The one record a write names, and a change of a record's labels, keep to",
    );
    const reach: number = page.indexOf(`- **${UPGRADE_HEADING["en"]!}`);
    const owners: number = page.indexOf(
      "- **Who owns a resource, and a setting that holds credentials, are named",
    );

    expect(named).toBeGreaterThan(0);
    expect(reach).toBeGreaterThan(named);
    expect(owners).toBeGreaterThan(reach);
  });

  test.each(
    LANGUAGES.filter((language: string) => {
      return language !== "en";
    }),
  )(
    "the %s upgrade guide has the line, right before who owns a resource",
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

      // The next line is who owns a resource, and a setting with credentials.
      expect([
        language,
        next.startsWith("- **") && next.includes("`resellerId`"),
      ]).toEqual([language, true]);

      for (const token of [
        "`400`",
        "`422`",
        "`401`",
        "`ReadRunbookCredential`",
        "`ProjectOwner`",
        "`ProjectAdmin`",
        "**Run Now**",
        "OneUptime AI",
        "SSH",
        "LLM",
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
