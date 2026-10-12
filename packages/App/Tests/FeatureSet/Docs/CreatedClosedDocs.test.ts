import slugify, {
  slugifyMarkdownHeading,
} from "Common/Server/Types/MarkdownSlugify";
import OnCallNotRunOnCreate from "Common/Server/Utils/OnCall/OnCallNotRunOnCreate";
import { StartingStage } from "Common/Utils/StartingStage";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A record created already acknowledged or resolved pages nobody, and one
 * created resolved sets off nothing that answers a live problem. The docs
 * say so where a reader looks: the declare page (English, and Persian, which
 * keeps its incident pages in step), the API reference beside the state a
 * new record starts in, the on-call escalation page, runbook rules, the
 * Slack page, AI SRE, and the 14 upgrade notes. Every link to the section
 * lands on its heading.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

function read(language: string, page: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${page}.md`),
    "utf8",
  );
}

// The text of the section under `heading`, up to the next heading of its level or above.
function section(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(heading);

  expect(start).toBeGreaterThanOrEqual(0);

  const rest: string = markdown.slice(start + heading.length);
  const end: number = rest.search(/\n#{2,3} /);

  return end === -1 ? rest : rest.slice(0, end);
}

const DECLARING: string = "incidents/declaring-incidents";
const EN_HEADING: string = "### Declared already acknowledged or resolved";
const FA_HEADING: string =
  "### حادثه‌ای که از پیش تأییدشده یا برطرف‌شده اعلام می‌شود";

function anchorOf(heading: string): string {
  return slugify(heading.replace(/^#+\s*/, ""));
}

const EN_LINK: string = `(/docs/incidents/declaring-incidents#${anchorOf(EN_HEADING)})`;

describe("the declare page says what a create in a later state sets off", () => {
  const page: string = read("en", DECLARING);
  const text: string = section(page, EN_HEADING);

  test("the section sits with what happens the moment an incident is declared", () => {
    const happens: number = page.indexOf(
      "## What happens the moment an incident is declared",
    );
    const here: number = page.indexOf(EN_HEADING);
    const next: number = page.indexOf("## Where to read next");

    expect(happens).toBeGreaterThan(0);
    expect(here).toBeGreaterThan(happens);
    expect(next).toBeGreaterThan(here);
  });

  test("at or past acknowledged: no one is paged, the policies stay listed, and the feed says why", () => {
    expect(text).toContain("**At or past your acknowledged state**");
    expect(text).toContain("no on-call policy runs, so no one is paged");
    expect(text).toContain("its feed says why in one line");
    expect(text).toContain("starts already responded to");
  });

  test("the feed line it quotes is the one the server writes", () => {
    const written: string = OnCallNotRunOnCreate.getMarkdown({
      noun: "incident",
      stage: StartingStage.Acknowledged,
      policyNames: ["Primary"],
    })
      .toString()
      .replace("📞 ", "")
      .replace("**No one was paged.**", "No one was paged.");

    expect(text).toContain(`_${written}_`);
  });

  test("at or past resolved: nothing that answers a live incident runs", () => {
    /*
     * A state placed below the resolved one counts as resolved too, as the
     * server's StartingStage and the state settings' Counts as read it.
     */
    expect(text).toContain(
      "**At or past your resolved state** — **Resolved**, or any state placed below it",
    );

    for (const sentence of [
      "it is not grouped into an episode",
      "no runbook rule and no auto-remediation rule acts on it",
      "OneUptime AI does not investigate it",
      "**AI Investigation** card says it was created already resolved",
      "no Slack or Microsoft Teams channel is created for it",
      "its monitors keep their status and keep being monitored",
      "no SLA is started for it",
    ]) {
      expect(text).toContain(sentence);
    }
  });

  test("what still happens: rules, owners, the created entry and status page subscribers", () => {
    expect(text).toContain("**What still happens:**");
    expect(text).toContain("privacy, owner, label and on-call rules run");
    expect(text).toContain("**Incident Created** entry");
    expect(text).toContain("status page subscribers are told");
  });

  test("alerts and both kinds of episode follow the same rule; the created state is unchanged", () => {
    expect(text).toContain(
      "Alerts, alert episodes and incident episodes follow the same rule",
    );
    expect(text).toContain("every one a monitor opens");
  });

  test("the Initial State field, the alerts paragraph, the on-call step and the template table point to it", () => {
    const inPageLink: string = `(#${anchorOf(EN_HEADING)})`;
    const links: number = page.split(inPageLink).length - 1;

    expect(links).toBeGreaterThanOrEqual(3);
    expect(page).toContain(
      "An incident that starts acknowledged or resolved pages no one.",
    );
  });
});

describe("the Persian declare page keeps the section in step", () => {
  const page: string = read("fa", DECLARING);
  const text: string = section(page, FA_HEADING);

  test("the section is there, with the same field names and the feed line as written", () => {
    for (const name of [
      "**Initial State**",
      "**Initial Incident State**",
      "`currentIncidentStateId`",
      "**AI Investigation**",
      "**Ask OneUptime AI**",
      "**Change Monitor Status to**",
      "**Incident Created**",
      "**Notify Status Page Subscribers**",
      "_No one was paged. This incident was created already acknowledged, so its on-call policy **Primary** was not run._",
    ]) {
      expect(text).toContain(name);
    }
  });

  test("its links land on its own heading", () => {
    const inPageLink: string = `(#${anchorOf(FA_HEADING)})`;

    expect(page.split(inPageLink).length - 1).toBeGreaterThanOrEqual(3);
  });

  test("it names the resolved state and every state below it, as the English does", () => {
    expect(text).toContain(
      "**در وضعیت برطرف‌شده پروژه‌تان یا پس از آن** — **Resolved**",
    );
  });
});

describe("the API reference on the state a new record starts in", () => {
  test("English says a later state pages no one, and links to the section", () => {
    const text: string = section(
      read("en", "api-reference/api-reference"),
      "### The state a new record starts in",
    );

    expect(text).toContain(
      "A record created at or past your acknowledged state pages no one",
    );
    expect(text).toContain(EN_LINK);
  });

  test("Persian says the same and links to the Persian section", () => {
    const text: string = section(
      read("fa", "api-reference/api-reference"),
      "### وضعیتی که رکورد تازه در آن آغاز می‌شود",
    );

    expect(text).toContain(
      `(/docs/incidents/declaring-incidents#${anchorOf(FA_HEADING)})`,
    );
  });
});

describe("the other pages a reader checks", () => {
  test.each([
    [
      "on-call/escalation-rules",
      "runs none of its policies: no one is paged, and its feed says so",
    ],
    [
      "runbooks/rules",
      "An incident or alert created already resolved starts no runbook",
    ],
    [
      "workspace-connections/slack",
      "An incident, alert or episode created already resolved gets no channel of its own",
    ],
    [
      "ai/ai-sre",
      "An incident or alert **created already resolved** is neither investigated nor remediated",
    ],
  ])(
    "%s says it, and links to the section",
    (page: string, sentence: string) => {
      const markdown: string = read("en", page);

      expect(markdown).toContain(sentence);
      expect(markdown).toContain(EN_LINK);
    },
  );

  test("the 14 upgrade notes tell existing customers what changed", () => {
    const text: string = section(
      read("en", "installation/upgrading"),
      "### Other changes in 14",
    );

    expect(text).toContain(
      "**A record created already acknowledged or resolved pages no one.**",
    );
    expect(text).toContain("Records created in the created state");
    expect(text).toContain(EN_LINK);
  });
});

/*
 * The escalation rules page is kept in step in every docs language, so each
 * says it too: its own paragraph, right after the one that walks Level 1,
 * Level 2 and the repeat - not inside it. The declare page's on-call step
 * says it in the languages whose page has no section on it yet; English and
 * Persian link to their section from there.
 */
const ESCALATION_SENTENCES: Record<string, string> = {
  en: "An incident, alert or episode that is created already acknowledged or resolved — recorded after the fact — runs none of its policies: no one is paged, and its feed says so, naming them.",
  fa: "رخداد، هشدار یا اپیزودی که از پیش تأییدشده یا برطرف‌شده ساخته شود — یعنی پس از رخ دادن ثبت شود — هیچ‌کدام از سیاست‌هایش را اجرا نمی‌کند: کسی خبر نمی‌شود، و فید آن با نام بردن از آن‌ها همین را می‌گوید.",
  da: "En hændelse, en advarsel eller en episode, der oprettes allerede bekræftet eller løst — registreret bagefter — udfører ingen af sine politikker: ingen tilkaldes, og dens feed siger det og nævner dem ved navn.",
  de: "Ein Vorfall, eine Warnung oder eine Episode, die bereits bestätigt oder behoben erstellt wird – also nachträglich erfasst –, führt keine ihrer Richtlinien aus: Niemand wird alarmiert, und ihr Feed vermerkt das und nennt die Richtlinien.",
  es: "Un incidente, una alerta o un episodio que se crea ya reconocido o resuelto —registrado a posteriori— no ejecuta ninguna de sus políticas: no se avisa a nadie, y su feed lo indica, nombrándolas.",
  fr: "Un incident, une alerte ou un épisode créé déjà pris en compte ou résolu — enregistré après coup — n'exécute aucune de ses politiques : personne n'est alerté, et son fil d'activité l'indique en les nommant.",
  hi: "जो घटना, अलर्ट या एपिसोड पहले से स्वीकार की गई या सुलझाई गई स्थिति में बनाया जाता है — यानी बाद में दर्ज किया जाता है — वह अपनी कोई भी नीति नहीं चलाता: किसी को पेज नहीं किया जाता, और उसका feed नीतियों के नाम के साथ यही बताता है।",
  it: "Un incidente, un avviso o un episodio creato già riconosciuto o risolto — registrato a posteriori — non esegue nessuna delle sue policy: nessuno viene avvisato, e il suo feed lo indica nominandole.",
  ja: "すでに確認済みまたは解決済みの状態で作成されたインシデント、アラート、エピソード（後から記録したもの）は、どのポリシーも実行しません。誰も呼び出されず、そのフィードにポリシー名とともにその旨が記録されます。",
  ko: "이미 인지됨 또는 해결됨 상태로 생성된 인시던트, 알림, 에피소드(사후에 기록한 것)는 어떤 정책도 실행하지 않습니다. 아무도 호출되지 않으며, 피드에 정책 이름과 함께 그 사실이 남습니다.",
  nl: "Een incident, waarschuwing of episode die al bevestigd of opgelost wordt aangemaakt — achteraf vastgelegd — voert geen enkel beleid uit: niemand wordt opgeroepen, en de feed meldt dat, met de namen van het beleid erbij.",
  no: "En hendelse, et varsel eller en episode som opprettes allerede bekreftet eller løst — registrert i etterkant — kjører ingen av retningslinjene sine: ingen varsles, og feeden sier det og nevner dem ved navn.",
  pt: "Um incidente, alerta ou episódio criado já confirmado ou resolvido — registrado depois do fato — não executa nenhuma de suas políticas: ninguém é acionado, e o feed dele informa isso, citando-as.",
  ru: "Инцидент, оповещение или эпизод, созданные уже подтверждёнными или устранёнными, — то есть записанные задним числом, — не запускают ни одной своей политики: никого не оповещают, а их Feed сообщает об этом и называет эти политики.",
  sv: "En incident, ett larm eller en episod som skapas redan bekräftad eller löst — registrerad i efterhand — kör ingen av sina policyer: ingen larmas, och dess feed säger det och nämner dem vid namn.",
  "zh-CN":
    "以已确认或已解决状态创建的事件、告警或片段（即事后补录的）不会执行任何策略：不会呼叫任何人，其 Feed 会记录这一点并列出这些策略。",
  "zh-TW":
    "以已確認或已解決狀態建立的事件、警示或片段（即事後補登的）不會執行任何策略：不會呼叫任何人，其 Feed 會記下這一點並列出這些策略。",
};

describe("the escalation rules page says it in every docs language, in a paragraph of its own", () => {
  test("every docs language has a sentence for it", () => {
    const languages: Array<string> = fs
      .readdirSync(CONTENT_DIR)
      .filter((language: string): boolean => {
        return fs.existsSync(
          path.join(CONTENT_DIR, language, "on-call/escalation-rules.md"),
        );
      })
      .sort();

    expect(languages).toEqual(Object.keys(ESCALATION_SENTENCES).sort());
  });

  test.each(Object.keys(ESCALATION_SENTENCES))(
    "%s: right after the levels paragraph, not inside it",
    (language: string) => {
      const lines: Array<string> = read(
        language,
        "on-call/escalation-rules",
      ).split("\n");

      /*
       * The levels paragraph opens the page's third section ("How the levels
       * page people"), whose outline every language keeps.
       */
      const headings: Array<number> = lines
        .map((line: string, index: number): number => {
          return line.startsWith("## ") ? index : -1;
        })
        .filter((index: number): boolean => {
          return index >= 0;
        });
      const levels: number = headings[2]! + 2;

      expect(lines[levels]).toContain("**Level 1**");
      expect(lines[levels]).toContain("**Level 2**");
      expect(lines[levels]).not.toContain(ESCALATION_SENTENCES[language]!);
      expect(lines[levels + 1]).toBe("");
      expect(
        lines[levels + 2]!.startsWith(ESCALATION_SENTENCES[language]!),
      ).toBe(true);
    },
  );

  /*
   * Every language's declare page has the section now (docs task 1 translated
   * it), so every escalation rules page links to it, in its own language: the
   * heading at the place the English page has its own, right after the
   * sentence.
   */
  test.each(Object.keys(ESCALATION_SENTENCES))(
    "%s: links to its own declare page's section, right after the sentence",
    (language: string) => {
      const headingsOf: (page: string) => Array<string> = (
        page: string,
      ): Array<string> => {
        return page.split("\n").filter((line: string): boolean => {
          return line.startsWith("#");
        });
      };
      const englishHeadings: Array<string> = headingsOf(read("en", DECLARING));
      const headings: Array<string> = headingsOf(read(language, DECLARING));
      const index: number = englishHeadings.indexOf(EN_HEADING);

      expect(index).toBeGreaterThan(0);
      expect(headings).toHaveLength(englishHeadings.length);

      const heading: string = headings[index]!;

      expect(heading.startsWith("### ")).toBe(true);

      const link: string = `(/docs/incidents/declaring-incidents#${slugifyMarkdownHeading(heading.replace(/^#+\s*/, ""))})`;
      const page: string = read(language, "on-call/escalation-rules");
      const paragraph: string | undefined = page
        .split("\n")
        .find((line: string): boolean => {
          return line.startsWith(ESCALATION_SENTENCES[language]!);
        });

      expect(paragraph).toBeDefined();
      expect(paragraph).toContain(link);

      if (language === "fa") {
        expect(heading).toBe(FA_HEADING);
        expect(link).toBe(
          `(/docs/incidents/declaring-incidents#${anchorOf(FA_HEADING)})`,
        );
      }

      if (language === "en") {
        expect(paragraph).toContain(`${ESCALATION_SENTENCES["en"]!} See [`);
        expect(link).toBe(EN_LINK);
      }
    },
  );
});

describe("the declare page's on-call step says it in every docs language", () => {
  test.each(
    fs
      .readdirSync(CONTENT_DIR)
      .filter((language: string): boolean => {
        return fs.existsSync(
          path.join(CONTENT_DIR, language, `${DECLARING}.md`),
        );
      })
      .sort(),
  )("%s", (language: string) => {
    const step: string | undefined = read(language, DECLARING)
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("8. ") && line.includes("`IncidentCreated`");
      });

    expect(step).toBeDefined();

    // The step's own words before, the new sentence after: one more sentence.
    const sentences: number = step!
      .split(/[.。।:：؛]\s*/)
      .filter((part: string): boolean => {
        return part.trim().length > 0;
      }).length;

    expect(sentences).toBeGreaterThan(3);

    if (language === "en") {
      expect(step).toContain(
        "An incident declared already acknowledged or resolved runs none of them",
      );
    }
  });
});
