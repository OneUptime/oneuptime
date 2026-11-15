/*
 * EACH LANGUAGE'S WORDS FOR A MAINTENANCE EVENT (#6817, #7982, #7639, #8090).
 *
 * #6817 named one record of Scheduled Maintenance a "Maintenance Event".
 * #7982 settled each language's word for it: the Dashboard's
 * ("Maintenance Event", in packages/App/FeatureSet/Dashboard/src/Locales).
 * The locale suites (MaintenanceEventSentencesInLocales,
 * MaintenanceWordsInLocales) and the docs check (MaintenanceEventDocsWords)
 * hold every sentence that names the record to it, with these patterns:
 *
 *   - record: the record's word, in any form a sentence takes;
 *   - scheduled: the "scheduled maintenance (event)" wording it had before,
 *     which a sentence naming the record may not keep;
 *   - otherRecord: another word a language has used for the record, which
 *     is never right ("vedligeholdelsesbegivenhed" beside the Dashboard's
 *     "vedligeholdelseshændelse").
 *
 * Danish, Korean, Hindi and Persian also called maintenance itself by two
 * words (#7639): MAINTENANCE_WORDS has the one each keeps, and the ones it
 * dropped.
 */

export interface MaintenanceEventWords {
  record: RegExp;
  scheduled: RegExp;
  otherRecord?: RegExp | undefined;
}

const ZWNJ: string = String.fromCharCode(0x200c);

export const MAINTENANCE_EVENT_WORDS: Record<string, MaintenanceEventWords> = {
  en: {
    record: /\b[Mm]aintenance events?\b/,
    scheduled: /\bscheduled maintenance/i,
  },
  de: {
    record: /Wartungsereignis/,
    scheduled: /geplante\S* Wartung/i,
  },
  fr: {
    record: /[ée]v[ée]nements? de maintenance/i,
    scheduled: /maintenances? (?:planifi|programm)/i,
  },
  es: {
    record: /eventos? de mantenimiento/i,
    scheduled: /mantenimientos? (?:programad|planificad)/i,
  },
  it: {
    record: /event[oi] di manutenzione/i,
    scheduled: /manutenzion[ei] (?:pianificat|programmat)/i,
  },
  pt: {
    record: /eventos? de manutenção/i,
    scheduled: /manuten(?:ção|ções) (?:programad|agendad)/i,
  },
  nl: {
    record: /onderhoudsgebeurtenis/i,
    scheduled: /geplande? onderhoud/i,
    // A het-word; the record is "de onderhoudsgebeurtenis".
    otherRecord: /onderhoudsevenement|onderhoudsmoment/i,
  },
  da: {
    record: /vedligeholdelseshændelse/i,
    scheduled: /planlagte? vedligehold/i,
    otherRecord: /vedligeholdelsesbegivenhed/i,
  },
  no: {
    record: /vedlikeholdshendelse/i,
    scheduled: /planlagte? vedlikehold/i,
    otherRecord: /vedlikeholdsbegivenhet/i,
  },
  sv: {
    record: /underhållshändelse/i,
    scheduled: /schemalagd|planerade? underhåll/i,
  },
  ru: {
    record: /[Сс]обыти\S* обслуживания/,
    scheduled:
      /(?:планов|запланированн)\S* (?:событи\S* )?(?:обслуживани|работ)/i,
  },
  ja: {
    record: /メンテナンスイベント/,
    scheduled: /定期メンテナンス|予定されたメンテナンス/,
  },
  ko: {
    record: /유지 관리 이벤트/,
    scheduled: /예정된|예약된/,
    otherRecord: /점검 이벤트|유지\s?보수 이벤트/,
  },
  "zh-CN": {
    record: /维护事件/,
    scheduled: /计划维护/,
    otherRecord: /维护活动/,
  },
  "zh-TW": {
    record: /維護事件/,
    scheduled: /排定維護|排程維護|排定的維護/,
    otherRecord: /維護活動/,
  },
  hi: {
    record: /रखरखाव इवेंट/,
    scheduled: /अनुसूचित|निर्धारित|मेंटेनेंस/,
    otherRecord: /मेंटेनेंस|मेंटेनेन्स|रखरखाव घटना/,
  },
  fa: {
    record: /رویداد(?:\u200c?های)? تعمیر و نگهداری/,
    scheduled: new RegExp(`زمان${ZWNJ}بندی`),
    otherRecord: /رویداد(?:\u200c?های)?\s+نگهداری/,
  },
  ar: {
    record: /(?:حدث|أحداث) (?:ال)?صيانة/,
    scheduled: /مجدول/,
  },
};

export interface MaintenanceWords {
  // The language's one word for maintenance.
  word: RegExp;
  // The words it dropped for it (#7639).
  dropped: RegExp;
}

/*
 * Korean 점검 is also "check" (a monitor's checks, a pre-flight 사전 점검),
 * so it counts as a dropped word only where the English says maintenance
 * and no check: see droppedMaintenanceWordIn.
 */
export const MAINTENANCE_WORDS: Record<string, MaintenanceWords> = {
  da: {
    word: /vedligehold/i,
    dropped: /vedligeholdelsesbegivenhed/i,
  },
  ko: {
    word: /유지 관리/,
    dropped: /점검|유지\s?보수/,
  },
  hi: {
    word: /रखरखाव/,
    dropped: /मेंटेनेंस|मेंटेनेन्स/,
  },
  fa: {
    word: /تعمیر و نگهداری/,
    // نگهداری on its own, and تعمیرات (repairs).
    dropped: /(?<!تعمیر و )نگهداری|تعمیرات/,
  },
};

/*
 * EACH LANGUAGE'S NAME FOR THE PRODUCT (#6817, #7633, #8169).
 *
 * The Dashboard's "Scheduled Maintenance" is the product's name in its
 * language. The status page, the Admin Dashboard, the docs navigation and
 * the server's subscriber emails and chat messages name it the same way:
 * Italian, Japanese, Portuguese, Russian and Swedish status pages and
 * emails gave it a second name ("Manutenzione pianificata" beside the
 * Dashboard's "Manutenzione programmata"), and the Hindi emails one too.
 *
 *   - name: the product's name, in any form a sentence takes;
 *   - maintenance: the language's word for maintenance, which the name,
 *     "Maintenance" and "Maintenance Details" all hold;
 *   - otherName: a name a screen or an email gave the product before,
 *     never right where the English says scheduled maintenance. English
 *     "planned maintenance" is no name of the product, and may say it.
 */
export interface ScheduledMaintenanceName {
  name: RegExp;
  maintenance: RegExp;
  otherName?: RegExp | undefined;
}

export const SCHEDULED_MAINTENANCE_NAMES: Record<
  string,
  ScheduledMaintenanceName
> = {
  en: {
    name: /\bscheduled maintenance\b/i,
    maintenance: /maintenance/i,
  },
  de: {
    name: /geplante\S* Wartung/i,
    maintenance: /wartung/i,
  },
  fr: {
    name: /maintenances? planifiées?/i,
    maintenance: /maintenance/i,
  },
  es: {
    name: /mantenimientos? programados?/i,
    maintenance: /mantenimiento/i,
  },
  it: {
    name: /manutenzion[ei] programmat[ae]/i,
    maintenance: /manutenzion/i,
    otherName: /manutenzion[ei] pianificat[ae]/i,
  },
  pt: {
    name: /manuten(?:ção|ções) programad[ao]s?/i,
    maintenance: /manuten(?:ção|ções)/i,
    otherName: /manuten(?:ção|ções) agendad[ao]s?/i,
  },
  nl: {
    name: /geplande? onderhoud/i,
    maintenance: /onderhoud/i,
  },
  da: {
    name: /planlagte? vedligehold/i,
    maintenance: /vedligehold/i,
  },
  no: {
    name: /planlagte? vedlikehold/i,
    maintenance: /vedlikehold/i,
  },
  sv: {
    name: /schemalag(?:t|da) underhåll/i,
    maintenance: /underhåll/i,
    otherName: /planera(?:t|de) underhåll/i,
  },
  ru: {
    name: /планов\S* обслуживани/i,
    maintenance: /обслуживани/i,
    // "Запланированное обслуживание", "плановые работы", "техобслуживание".
    otherName:
      /запланированн\S* обслуживани|планов\S* (?:работ|техобслуживани)/i,
  },
  ja: {
    name: /定期メンテナンス/,
    maintenance: /メンテナンス/,
    otherName: /予定されたメンテナンス|計画メンテナンス|予定メンテナンス/,
  },
  ko: {
    name: /예정된 유지 관리/,
    maintenance: /유지 관리/,
  },
  "zh-CN": {
    name: /计划维护/,
    maintenance: /维护/,
  },
  "zh-TW": {
    name: /排定維護/,
    maintenance: /維護/,
    otherName: /排定的維護/,
  },
  hi: {
    name: /अनुसूचित रखरखाव/,
    maintenance: /रखरखाव/,
    otherName: /निर्धारित रखरखाव|शेड्यूल किए गए रखरखाव/,
  },
  fa: {
    name: new RegExp(
      `تعمیر و نگهداری(?:${ZWNJ}های)? زمان${ZWNJ}بندی${ZWNJ}شده`,
    ),
    maintenance: /تعمیر و نگهداری/,
  },
  ar: {
    // صيانتها المجدولة: its scheduled maintenance.
    name: /صيان[ةت]\S* (?:ال)?مجدولة/,
    maintenance: /صيان[ةت]/,
  },
};

// The English names the product, as its name or in a sentence.
export const SAYS_SCHEDULED_MAINTENANCE: RegExp =
  /(?<![-.{'_])\bscheduled maintenance\b(?![-}'_]|\.\w)/i;

/*
 * "maintenance" as a word of the sentence: not inside a code name
 * (oneuptime.scheduled-maintenance.measurement, {{maintenance}}) or a
 * quoted state another product reports ('maintenance'). A full stop ends a
 * sentence ("whether it is in maintenance."); a dot between two words joins
 * a code name. It read the full stop as one, so a Persian sentence ending
 * in maintenance said the dropped نگهداری unseen.
 */
export const SAYS_MAINTENANCE: RegExp =
  /(?<![-.{'_])\bmaintenance\b(?![-}'_]|\.\w)/i;

export const SAYS_A_MAINTENANCE_EVENT: RegExp = /\bmaintenance events?\b/i;

// Korean 점검 is a check wherever the English says one.
const SAYS_CHECK: RegExp = /check/i;

// The dropped maintenance word a translation uses, if any.
export function droppedMaintenanceWordIn(
  language: string,
  english: string,
  translation: string,
): string | null {
  const words: MaintenanceWords | undefined = MAINTENANCE_WORDS[language];

  if (!words) {
    return null;
  }

  let text: string = translation;

  if (language === "ko") {
    if (SAYS_CHECK.test(english)) {
      return null;
    }

    text = text.split("사전 점검").join("");
  }

  const match: RegExpExecArray | null = words.dropped.exec(text);

  return match ? match[0] : null;
}
