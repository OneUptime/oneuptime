import { PAGED_RECORD_COLUMN_OF } from "Common/Server/Utils/Notification/OwnersReachedByAPage";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE DOCS ON AN OWNER THE ON-CALL PAGE REACHED ALREADY (#7987).
 *
 * A new incident's, alert's or episode's owners are told it was created
 * about a minute after its on-call policies paged whoever is on call. An
 * owner the record's page reached already is left out of that notification
 * (OwnersReachedByAPage): someone who is both is told once, by the page. The
 * owners page, the alerts page and the notification settings page say so,
 * where each says who the "created" notification goes to, in every
 * language. Markdown is not compiled, so these tests are what notices when
 * the pages and the jobs part ways.
 */

const PACKAGES_ROOT: string = path.resolve(__dirname, "../../../..");
const JOBS: string = path.join(PACKAGES_ROOT, "App/FeatureSet/Workers/Jobs");

const OWNERS: string = "incidents/notes-owners-and-feed";
const ALERTS: string = "alerts/index";
const SETTINGS: string = "notifications/notification-settings";

// The jobs whose notification an owner the page reached is left out of.
const CREATED_JOBS: Array<string> = [
  "IncidentOwners/SendCreatedResourceNotification.ts",
  "AlertOwners/SendCreatedResourceNotification.ts",
  "IncidentEpisodeOwners/SendCreatedResourceNotification.ts",
  "AlertEpisodeOwners/SendCreatedResourceNotification.ts",
];

// The words each language says "the page reached them, they are not told again" with.
const PAGED_ONCE: Record<string, RegExp> = {
  en: /on-call page (of a new incident, alert or episode )?has reached already is not notified again/,
  da: /vagttilkald\S* (for en ny hændelse, advarsel eller episode )?allerede har nået, får ikke besked igen/,
  de: /Bereitschaftsalarm .*schon erreicht wurde, wird nicht noch einmal benachrichtigt/,
  es: /ya le haya llegado el aviso de guardia .*no se le vuelve a notificar/,
  fa: /فراخوان آنکال .*دوباره خبردار نمی‌شود/,
  fr: /l'appel d'astreinte .*a déjà atteint n'est pas notifié à nouveau/,
  hi: /का ऑन-कॉल पेज पहले ही पहुँच चुका है, उसे .*दोबारा/,
  it: /è già stato raggiunto dalla chiamata di reperibilità .*di nuovo/,
  ja: /オンコールの呼び出しがすでに届いている人には、.*もう一度は送られません/,
  ko: /온콜 호출을 이미 받은 사람에게는 .*다시 보내지 않습니다/,
  nl: /al door de dienstoproep .*is bereikt, krijgt geen tweede melding/,
  no: /vakttilkalling\S* (for en ny hendelse, et nytt varsel eller en ny episode )?allerede har nådd, får ikke beskjed på nytt/,
  pt: /já foi alcançado pelo acionamento de plantão .*não é notificado de novo/,
  ru: /до кого уже дошёл вызов дежурных .*повторно не приходит/,
  sv: /jourlarm\S* (för en ny incident, ett nytt larm eller en ny episod )?redan har nått får inget nytt besked/,
  "zh-CN": /值班呼叫已经送达的人不会再次收到/,
  "zh-TW": /待命呼叫已經送達的人不會再次收到/,
};

// The words each language says "a few minutes late" with, which mark the alerts page's owners bullet.
const A_FEW_MINUTES: Record<string, RegExp> = {
  en: /a few minutes late/,
  da: /et par minutter/,
  de: /ein paar Minuten/,
  es: /unos minutos/,
  fa: /چند دقیقه/,
  fr: /quelques minutes/,
  hi: /कुछ मिनट/,
  it: /qualche minuto/,
  ja: /数分遅れ/,
  ko: /몇 분 늦게/,
  nl: /een paar minuten/,
  no: /noen minutter/,
  pt: /alguns minutos/,
  ru: /несколько минут/,
  sv: /några minuter/,
  "zh-CN": /晚几分钟/,
  "zh-TW": /晚幾分鐘/,
};

// The paragraph after the owners page's table, on whom the Created notification reaches.
function ownerlessParagraph(language: string): string {
  const lines: Array<string> = readPage(language, OWNERS).split("\n");
  const lastRow: number = lines.findIndex((line: string): boolean => {
    return line.includes(
      "`[Reminder] Incident {number} is still {state} - {title}`",
    );
  });

  expect([language, lastRow >= 0]).toEqual([language, true]);

  return lines[lastRow + 4] || "";
}

// The alerts page's bullet on what the alert's owners are told.
function alertOwnersBullet(language: string): string {
  const bullets: Array<string> = readPage(language, ALERTS)
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("- **") && A_FEW_MINUTES[language]!.test(line);
    });

  expect([language, bullets.length]).toEqual([language, 1]);

  return bullets[0]!;
}

/*
 * The notification settings page's bullet on where an update goes: the
 * line the English page says it on, which every language's page keeps in
 * the same place (rather than a fixed line, which a bullet added above it
 * moves).
 */
function settingsOwnersBullet(language: string): string {
  const index: number = readPage("en", SETTINGS)
    .split("\n")
    .findIndex((line: string): boolean => {
      return line.startsWith("- An update goes to the record's owners:");
    });

  expect(index).toBeGreaterThan(0);

  return readPage(language, SETTINGS).split("\n")[index] || "";
}

describe("the docs on an owner the record's on-call page reached already", () => {
  test("the four Created jobs leave such an owner out, and no other notification does", () => {
    expect(Object.keys(PAGED_RECORD_COLUMN_OF).sort()).toEqual(
      [
        OwnerNotificationKind.IncidentCreated,
        OwnerNotificationKind.AlertCreated,
        OwnerNotificationKind.IncidentEpisodeCreated,
        OwnerNotificationKind.AlertEpisodeCreated,
      ].sort(),
    );

    const ownerJobs: Array<string> = fs
      .readdirSync(JOBS)
      .filter((folder: string): boolean => {
        return folder.endsWith("Owners");
      })
      .flatMap((folder: string): Array<string> => {
        return fs
          .readdirSync(path.join(JOBS, folder))
          .map((file: string): string => {
            return `${folder}/${file}`;
          });
      });

    expect(ownerJobs).toEqual(expect.arrayContaining(CREATED_JOBS));

    for (const job of ownerJobs) {
      const source: string = fs.readFileSync(path.join(JOBS, job), "utf8");

      expect({
        job,
        leavesOutThePaged: source.includes("OwnersReachedByAPage.findAmong("),
      }).toEqual({ job, leavesOutThePaged: CREATED_JOBS.includes(job) });
    }
  });

  test("the English pages say it where they say whom the created notification reaches", () => {
    expect(ownerlessParagraph("en")).toContain(
      "and to the Project Owners only if it still has none. Someone the incident's on-call page has reached already is not notified again.",
    );
    expect(alertOwnersBullet("en")).toContain(
      "An alert with no owners notifies the Project Owners instead. Someone the alert's on-call page has reached already is not notified again that it was created.",
    );
    expect(settingsOwnersBullet("en")).toContain(
      "When a record has no owners, it goes to the Project Owners instead. Someone the on-call page of a new incident, alert or episode has reached already is not notified again that it was created.",
    );
  });

  test("every language says it in the same three places", () => {
    expect([...DOCS_LANGUAGES].sort()).toEqual(Object.keys(PAGED_ONCE).sort());

    for (const language of DOCS_LANGUAGES) {
      const says: RegExp = PAGED_ONCE[language]!;

      expect([
        language,
        says.test(ownerlessParagraph(language)),
        says.test(alertOwnersBullet(language)),
        says.test(settingsOwnersBullet(language)),
      ]).toEqual([language, true, true, true]);
    }
  });
});
