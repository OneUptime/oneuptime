import { dashboardTranslator } from "./DocsDashboardLabels";
import { escapeRegExp } from "./DocsTranslationChecks";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";

/*
 * THE TITLES AND NAMES A NEW MONITOR IS GIVEN, AS A DOCS PAGE QUOTES THEM
 * (#8526).
 *
 * A new monitor's default criteria are made with the reader's translator
 * (MonitorCriteria.getDefaultMonitorCriteria), so a German project's DNS
 * monitor opens incidents titled "Acme ist offline" and names its criteria
 * "Prüfen, ob Acme offline ist". A page quotes what the reader will see:
 *
 *   - the words are the Dashboard locale's value of the English text;
 *   - between the language's own quotation marks ("...", „...“, « ... »,
 *     「...」), not in bold, which is for what the reader clicks or picks,
 *     and not as code, which a translation keeps in English;
 *   - the monitor's name, which the Dashboard fills in before anyone sees
 *     the title, is an italic placeholder in the reader's words
 *     (_Monitorname_), as the English page's _monitor name_;
 *   - a variable the title keeps until an incident is created
 *     ({{disconnectedProbeNames}}) is written as the Incident Title field
 *     shows it.
 *
 * Packages/App/FeatureSet/Docs/README.md (Translating) says the same for
 * whoever writes the next page.
 */

// The monitor's name, as each language's pages write it in a quoted title.
export const MONITOR_NAME_PLACEHOLDER: Readonly<Record<string, string>> = {
  en: "monitor name",
  da: "monitornavn",
  de: "Monitorname",
  es: "nombre del monitor",
  fa: "نام مانیتور",
  fr: "nom du moniteur",
  hi: "मॉनिटर का नाम",
  it: "nome del monitor",
  ja: "モニター名",
  ko: "모니터 이름",
  nl: "monitornaam",
  no: "monitornavn",
  pt: "nome do monitor",
  ru: "имя монитора",
  sv: "monitornamn",
  "zh-CN": "监视器名称",
  "zh-TW": "監測器名稱",
};

/*
 * The quotation marks that open and close a quoted title, in every
 * language: straight, German „“, guillemets (French with a space inside),
 * Chinese “” and the corner brackets of Japanese and Traditional Chinese.
 */
const OPENING_QUOTES: string = "\"„«“「";
const CLOSING_QUOTES: string = "\"“»”」";

// A monitor name no title holds otherwise, filled in and then replaced.
const SAMPLE_MONITOR_NAME: string = "Acme";

export function monitorNamePlaceholder(language: string): string {
  const placeholder: string | undefined = MONITOR_NAME_PLACEHOLDER[language];

  if (!placeholder) {
    throw new Error(`No monitor name placeholder for ${language}`);
  }

  return placeholder;
}

/*
 * A text the Dashboard wrote with the sample monitor name, as a page writes
 * it: the name as the italic placeholder. Before a letter (Korean "Acme의")
 * an underscore would not close the italics, so asterisks do.
 */
export function withMonitorNamePlaceholder(
  text: string,
  language: string,
): string {
  const placeholder: string = monitorNamePlaceholder(language);

  return text.replace(
    new RegExp(`${escapeRegExp(SAMPLE_MONITOR_NAME)}(?=(.?))`, "u"),
    (_match: string, next: string): string => {
      const marker: string = /\p{L}/u.test(next) ? "*" : "_";

      return `${marker}${placeholder}${marker}`;
    },
  );
}

// Whether `markdown` has `text` between quotation marks, a space inside them allowed.
export function isQuotedIn(markdown: string, text: string): boolean {
  return new RegExp(
    `[${escapeRegExp(OPENING_QUOTES)}][ \\u00A0]?${escapeRegExp(text)}[ \\u00A0]?[${escapeRegExp(CLOSING_QUOTES)}]`,
    "u",
  ).test(markdown);
}

function defaultCriteria(
  monitorType: MonitorType,
  language: string,
): Array<MonitorCriteriaInstance> {
  return (
    MonitorCriteria.getDefaultMonitorCriteria({
      monitorType: monitorType,
      monitorName: SAMPLE_MONITOR_NAME,
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      warningAlertSeverityId: ObjectID.generate(),
      translator: dashboardTranslator(language),
    }).data?.monitorCriteriaInstanceArray || []
  );
}

/*
 * The titles of the incidents and alerts a new monitor of this type opens,
 * in this language, as a page quotes them: "_Monitorname_ ist offline".
 */
export function defaultTitlesAsQuoted(
  monitorType: MonitorType,
  language: string,
): Array<string> {
  const titles: Array<string> = [];

  for (const instance of defaultCriteria(monitorType, language)) {
    for (const item of [
      ...(instance.data?.createIncidents ? instance.data.incidents : []),
      ...(instance.data?.createAlerts ? instance.data.alerts : []),
    ] as Array<{ title: string }>) {
      const title: string = withMonitorNamePlaceholder(item.title, language);

      if (!titles.includes(title)) {
        titles.push(title);
      }
    }
  }

  return titles;
}

/*
 * The names of the criteria a new monitor of this type starts with, in this
 * language, as a page writes them: "Prüfen, ob _Monitorname_ offline ist".
 */
export function defaultCriteriaNamesAsWritten(
  monitorType: MonitorType,
  language: string,
): Array<string> {
  return defaultCriteria(monitorType, language).map(
    (instance: MonitorCriteriaInstance): string => {
      return withMonitorNamePlaceholder(instance.data?.name || "", language);
    },
  );
}
