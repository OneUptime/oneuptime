import { isWhiteSpaceCode } from "../RegExpCharacterClasses";

/*
 * THE WORDS AN AI REPORT'S HEADINGS AND IMPACT LABELS ARE WRITTEN WITH, IN
 * EVERY LANGUAGE THE DASHBOARD READS (issue #6542).
 *
 * OneUptime AI writes what people read in the language a team's AI context
 * asks for, the investigation report's headings included. The AI card lays
 * the report out by those headings - the summary first, the impact with a
 * mark for each line, the causes ruled out as a list (InvestigationReport) -
 * so a heading the card cannot read leaves the report as one block of text.
 * Both sides read this table: a run that read an AI context is told each
 * language's words for the headings its persona asks for
 * (AIInvestigationEngine.getReportLanguageInstructions), and the report
 * parser reads those words, and a few others a model writes for them, as it
 * reads the English ones.
 *
 * The words are the Dashboard's own where its locale files have them
 * ("Summary", "Impact", "Evidence", "Root cause", "Next steps", "Users",
 * "Services", "SLOs", and "ruled out" in "Fixes it ruled out"), so a report
 * reads as the page around it does.
 *
 * Pure data and one key: no server or UI code, so it loads the same in the
 * dashboard, the API server and Common jest.
 */

// What a word names: a heading the persona asks for, or an Impact line's label.
export enum InvestigationReportTerm {
  Summary = "Summary",
  Impact = "Impact",
  RootCause = "RootCause",
  Evidence = "Evidence",
  RuledOut = "RuledOut",
  NextSteps = "NextSteps",
  Users = "Users",
  Services = "Services",
  Slos = "Slos",
}

// The section headings, in the order the investigation persona asks for them.
export const INVESTIGATION_REPORT_HEADING_TERMS: ReadonlyArray<InvestigationReportTerm> =
  [
    InvestigationReportTerm.Summary,
    InvestigationReportTerm.Impact,
    InvestigationReportTerm.RootCause,
    InvestigationReportTerm.Evidence,
    InvestigationReportTerm.RuledOut,
    InvestigationReportTerm.NextSteps,
  ];

// The labels the Impact section's lines open with, in order.
export const INVESTIGATION_REPORT_IMPACT_LABEL_TERMS: ReadonlyArray<InvestigationReportTerm> =
  [
    InvestigationReportTerm.Users,
    InvestigationReportTerm.Services,
    InvestigationReportTerm.Slos,
  ];

export interface InvestigationReportLanguage {
  // The Dashboard's code for the language (DashboardLanguage): "zh-CN".
  code: string;
  // The word for each term: what a run is asked to write.
  words: Readonly<Record<InvestigationReportTerm, string>>;
  // Other words a model writes for a term, read as the term too.
  otherWords: Readonly<
    Partial<Record<InvestigationReportTerm, ReadonlyArray<string>>>
  >;
}

export const ENGLISH_REPORT_LANGUAGE_CODE: string = "en";

/*
 * English first: the words the personas spell out, which the report parser
 * reads with its own English tables (KNOWN_LABELS, IMPACT_ASPECT_WORDS) as
 * it always has. Then the Dashboard's other languages, in its order.
 */
export const INVESTIGATION_REPORT_LANGUAGES: ReadonlyArray<InvestigationReportLanguage> =
  [
    {
      code: ENGLISH_REPORT_LANGUAGE_CODE,
      words: {
        Summary: "Summary",
        Impact: "Impact",
        RootCause: "Most likely root cause",
        Evidence: "Evidence",
        RuledOut: "Ruled out",
        NextSteps: "Suggested next steps",
        Users: "Users",
        Services: "Services",
        Slos: "SLOs",
      },
      otherWords: {},
    },
    {
      code: "de",
      words: {
        Summary: "Zusammenfassung",
        Impact: "Auswirkungen",
        RootCause: "Wahrscheinlichste Grundursache",
        Evidence: "Belege",
        RuledOut: "Ausgeschlossene Ursachen",
        NextSteps: "Vorgeschlagene nächste Schritte",
        Users: "Benutzer",
        Services: "Dienste",
        Slos: "SLOs",
      },
      otherWords: {
        Summary: ["Kurzfassung"],
        Impact: ["Auswirkung"],
        RootCause: [
          "Grundursache",
          "Wahrscheinliche Grundursache",
          "Wahrscheinlichste Ursache",
          "Ursache",
        ],
        Evidence: ["Beweise", "Nachweise"],
        RuledOut: ["Ausgeschlossen"],
        NextSteps: ["Nächste Schritte", "Empfohlene nächste Schritte"],
        Users: ["Nutzer"],
        Slos: ["SLO"],
      },
    },
    {
      code: "fr",
      words: {
        Summary: "Résumé",
        Impact: "Impact",
        RootCause: "Cause racine la plus probable",
        Evidence: "Preuves",
        RuledOut: "Causes écartées",
        NextSteps: "Prochaines étapes suggérées",
        Users: "Utilisateurs",
        Services: "Services",
        Slos: "SLOs",
      },
      otherWords: {
        Summary: ["Synthèse"],
        RootCause: ["Cause racine", "Cause racine probable"],
        Evidence: ["Éléments de preuve"],
        RuledOut: ["Écartées", "Hypothèses écartées"],
        NextSteps: ["Prochaines étapes", "Étapes suivantes"],
        Slos: ["SLO"],
      },
    },
    {
      code: "es",
      words: {
        Summary: "Resumen",
        Impact: "Impacto",
        RootCause: "Causa raíz más probable",
        Evidence: "Evidencias",
        RuledOut: "Causas descartadas",
        NextSteps: "Próximos pasos sugeridos",
        Users: "Usuarios",
        Services: "Servicios",
        Slos: "SLO",
      },
      otherWords: {
        RootCause: ["Causa raíz", "Causa raíz probable"],
        Evidence: ["Evidencia", "Pruebas"],
        RuledOut: ["Descartadas", "Hipótesis descartadas"],
        NextSteps: ["Próximos pasos", "Siguientes pasos"],
        Slos: ["SLOs"],
      },
    },
    {
      code: "it",
      words: {
        Summary: "Riepilogo",
        Impact: "Impatto",
        RootCause: "Causa principale più probabile",
        Evidence: "Prove",
        RuledOut: "Cause scartate",
        NextSteps: "Prossimi passi suggeriti",
        Users: "Utenti",
        Services: "Servizi",
        Slos: "SLOs",
      },
      otherWords: {
        Summary: ["Sintesi", "Riassunto"],
        RootCause: [
          "Causa principale",
          "Causa principale probabile",
          "Causa radice",
        ],
        Evidence: ["Evidenze"],
        RuledOut: ["Cause escluse", "Escluse"],
        NextSteps: ["Prossimi passi", "Passi successivi"],
        Slos: ["SLO"],
      },
    },
    {
      code: "pt",
      words: {
        Summary: "Resumo",
        Impact: "Impacto",
        RootCause: "Causa raiz mais provável",
        Evidence: "Evidências",
        RuledOut: "Causas descartadas",
        NextSteps: "Próximos passos sugeridos",
        Users: "Usuários",
        Services: "Serviços",
        Slos: "SLOs",
      },
      otherWords: {
        RootCause: ["Causa raiz", "Causa raiz provável"],
        Evidence: ["Evidência", "Provas"],
        RuledOut: ["Descartadas", "Hipóteses descartadas"],
        NextSteps: ["Próximos passos", "Próximas etapas"],
        Users: ["Utilizadores"],
        Slos: ["SLO"],
      },
    },
    {
      code: "nl",
      words: {
        Summary: "Samenvatting",
        Impact: "Impact",
        RootCause: "Meest waarschijnlijke hoofdoorzaak",
        Evidence: "Bewijs",
        RuledOut: "Uitgesloten oorzaken",
        NextSteps: "Voorgestelde volgende stappen",
        Users: "Gebruikers",
        Services: "Services",
        Slos: "SLOs",
      },
      otherWords: {
        RootCause: ["Hoofdoorzaak", "Waarschijnlijke hoofdoorzaak"],
        Evidence: ["Bewijzen", "Bewijsmateriaal"],
        RuledOut: ["Uitgesloten"],
        NextSteps: ["Volgende stappen"],
        Services: ["Diensten"],
        Slos: ["SLO"],
      },
    },
    {
      code: "da",
      words: {
        Summary: "Oversigt",
        Impact: "Påvirkning",
        RootCause: "Mest sandsynlige grundårsag",
        Evidence: "Beviser",
        RuledOut: "Udelukkede årsager",
        NextSteps: "Foreslåede næste trin",
        Users: "Brugere",
        Services: "Tjenester",
        Slos: "SLOs",
      },
      otherWords: {
        Summary: ["Resumé", "Opsummering"],
        RootCause: ["Grundårsag", "Sandsynlig grundårsag"],
        Evidence: ["Bevis"],
        RuledOut: ["Udelukket"],
        NextSteps: ["Næste trin"],
        Slos: ["SLO"],
      },
    },
    {
      code: "no",
      words: {
        Summary: "Sammendrag",
        Impact: "Påvirkning",
        RootCause: "Mest sannsynlige rotårsak",
        Evidence: "Bevis",
        RuledOut: "Utelukkede årsaker",
        NextSteps: "Foreslåtte neste steg",
        Users: "Brukere",
        Services: "Tjenester",
        Slos: "SLOs",
      },
      otherWords: {
        Summary: ["Oppsummering"],
        RootCause: [
          "Rotårsak",
          "Sannsynlig rotårsak",
          "Mest sannsynlig rotårsak",
        ],
        RuledOut: ["Utelukket"],
        NextSteps: ["Neste steg"],
        Slos: ["SLO"],
      },
    },
    {
      code: "sv",
      words: {
        Summary: "Sammanfattning",
        Impact: "Påverkan",
        RootCause: "Mest trolig rotorsak",
        Evidence: "Bevis",
        RuledOut: "Uteslutna orsaker",
        NextSteps: "Föreslagna nästa steg",
        Users: "Användare",
        Services: "Tjänster",
        Slos: "SLOs",
      },
      otherWords: {
        RootCause: ["Rotorsak", "Trolig rotorsak", "Troligaste rotorsak"],
        RuledOut: ["Uteslutet", "Uteslutna"],
        NextSteps: ["Nästa steg"],
        Slos: ["SLO"],
      },
    },
    {
      code: "ru",
      words: {
        Summary: "Сводка",
        Impact: "Последствия",
        RootCause: "Наиболее вероятная корневая причина",
        Evidence: "Доказательства",
        RuledOut: "Исключённые причины",
        NextSteps: "Предлагаемые следующие шаги",
        Users: "Пользователи",
        Services: "Службы",
        Slos: "SLOs",
      },
      otherWords: {
        Summary: ["Резюме", "Итог", "Итоги", "Кратко"],
        Impact: ["Влияние"],
        RootCause: [
          "Корневая причина",
          "Вероятная корневая причина",
          "Первопричина",
        ],
        Evidence: ["Свидетельства"],
        RuledOut: ["Исключено", "Исключённые гипотезы"],
        NextSteps: ["Следующие шаги", "Рекомендуемые следующие шаги"],
        Services: ["Сервисы"],
        Slos: ["SLO"],
      },
    },
    {
      code: "ja",
      words: {
        Summary: "概要",
        Impact: "影響",
        RootCause: "最も可能性の高い根本原因",
        Evidence: "証拠",
        RuledOut: "除外した原因",
        NextSteps: "推奨される次のステップ",
        Users: "ユーザー",
        Services: "サービス",
        Slos: "SLO",
      },
      otherWords: {
        Summary: ["要約", "サマリー"],
        Impact: ["影響範囲"],
        RootCause: [
          "根本原因",
          "考えられる根本原因",
          "最も考えられる根本原因",
          "推定される根本原因",
        ],
        Evidence: ["根拠"],
        RuledOut: ["除外された原因", "除外"],
        NextSteps: ["次のステップ", "推奨する次のステップ", "推奨対応"],
        Users: ["利用者"],
        Slos: ["SLOs"],
      },
    },
    {
      code: "ko",
      words: {
        Summary: "요약",
        Impact: "영향",
        RootCause: "가장 가능성 높은 근본 원인",
        Evidence: "증거",
        RuledOut: "제외한 원인",
        NextSteps: "제안된 다음 단계",
        Users: "사용자",
        Services: "서비스",
        Slos: "SLOs",
      },
      otherWords: {
        Impact: ["영향 범위"],
        RootCause: [
          "근본 원인",
          "가능성 높은 근본 원인",
          "가장 가능성이 높은 근본 원인",
        ],
        Evidence: ["근거"],
        RuledOut: ["제외된 원인", "배제된 원인"],
        NextSteps: ["다음 단계", "권장 다음 단계"],
        Slos: ["SLO"],
      },
    },
    {
      code: "zh-CN",
      words: {
        Summary: "摘要",
        Impact: "影响",
        RootCause: "最可能的根本原因",
        Evidence: "证据",
        RuledOut: "已排除的原因",
        NextSteps: "建议的后续步骤",
        Users: "用户",
        Services: "服务",
        Slos: "SLOs",
      },
      otherWords: {
        Summary: ["总结", "概要", "概述"],
        Impact: ["影响范围"],
        RootCause: ["根本原因", "可能的根本原因", "最可能的根因", "根因"],
        Evidence: ["依据"],
        RuledOut: ["已排除", "排除的原因"],
        NextSteps: ["后续步骤", "建议的下一步", "下一步", "建议措施"],
        Slos: ["SLO"],
      },
    },
    {
      code: "zh-TW",
      words: {
        Summary: "摘要",
        Impact: "影響",
        RootCause: "最可能的根本原因",
        Evidence: "證據",
        RuledOut: "已排除的原因",
        NextSteps: "建議的後續步驟",
        Users: "使用者",
        Services: "服務",
        Slos: "SLOs",
      },
      otherWords: {
        Summary: ["總結", "概要", "概述"],
        Impact: ["影響範圍"],
        RootCause: ["根本原因", "可能的根本原因", "最可能的根因", "根因"],
        Evidence: ["依據"],
        RuledOut: ["已排除", "排除的原因"],
        NextSteps: ["後續步驟", "建議的下一步", "下一步", "建議措施"],
        Users: ["用戶"],
        Slos: ["SLO"],
      },
    },
    {
      code: "hi",
      words: {
        Summary: "सारांश",
        Impact: "प्रभाव",
        RootCause: "सबसे संभावित मूल कारण",
        Evidence: "साक्ष्य",
        RuledOut: "खारिज किए गए कारण",
        NextSteps: "सुझाए गए अगले कदम",
        Users: "उपयोगकर्ता",
        Services: "सेवाएं",
        Slos: "SLOs",
      },
      otherWords: {
        RootCause: ["मूल कारण", "संभावित मूल कारण"],
        Evidence: ["सबूत", "प्रमाण"],
        RuledOut: ["ख़ारिज किए गए कारण", "खारिज किए गए"],
        NextSteps: ["अगले कदम", "सुझाए गए अगले क़दम"],
        Services: ["सेवाएँ"],
        Slos: ["SLO"],
      },
    },
    {
      code: "fa",
      words: {
        Summary: "خلاصه",
        Impact: "تأثیر",
        RootCause: "محتمل‌ترین علت ریشه‌ای",
        Evidence: "شواهد",
        RuledOut: "علت‌های ردشده",
        NextSteps: "گام‌های بعدی پیشنهادی",
        Users: "کاربران",
        Services: "سرویس‌ها",
        Slos: "SLOs",
      },
      otherWords: {
        Summary: ["جمع‌بندی"],
        Impact: ["اثرات"],
        RootCause: ["علت ریشه‌ای", "علت ریشه‌ای محتمل"],
        RuledOut: ["موارد ردشده", "فرضیه‌های ردشده"],
        NextSteps: ["گام‌های بعدی", "اقدامات پیشنهادی"],
        Services: ["خدمات"],
        Slos: ["SLO"],
      },
    },
    {
      code: "ar",
      words: {
        Summary: "الملخص",
        Impact: "التأثير",
        RootCause: "السبب الجذري الأكثر احتمالًا",
        Evidence: "الأدلة",
        RuledOut: "الأسباب المستبعدة",
        NextSteps: "الخطوات التالية المقترحة",
        Users: "المستخدمون",
        Services: "الخدمات",
        Slos: "أهداف SLO",
      },
      otherWords: {
        Summary: ["ملخص"],
        Impact: ["الأثر", "تأثير"],
        RootCause: ["السبب الجذري", "السبب الجذري المحتمل"],
        Evidence: ["أدلة"],
        RuledOut: ["المستبعد", "الأسباب التي تم استبعادها"],
        NextSteps: ["الخطوات التالية", "الخطوات المقترحة"],
        Users: ["المستخدمين"],
        Services: ["خدمات"],
        Slos: ["SLOs", "SLO"],
      },
    },
  ];

/*
 * What a key leaves out: the joiners Persian writes inside a word (a model
 * writes the same word with one, a space or nothing), the word joiner, the
 * byte order mark, and the Arabic letters' stretch (tatweel).
 */
const KEY_LEFT_OUT_CODES: ReadonlySet<number> = new Set<number>([
  0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x0640,
]);

// The Arabic vowel marks a model may or may not write over a word.
function isArabicVowelMark(code: number): boolean {
  return (code >= 0x064b && code <= 0x065f) || code === 0x0670;
}

/*
 * Letters written two ways for one word: Russian "ё" and "е"; an alef with
 * a hamza or a madda and a bare alef; the Arabic and the Persian yeh and
 * kaf. Each is read as the second.
 */
const KEY_SAME_LETTERS: ReadonlyMap<number, string> = new Map<number, string>([
  [0x0451, String.fromCharCode(0x0435)],
  [0x0622, String.fromCharCode(0x0627)],
  [0x0623, String.fromCharCode(0x0627)],
  [0x0625, String.fromCharCode(0x0627)],
  [0x0671, String.fromCharCode(0x0627)],
  [0x064a, String.fromCharCode(0x06cc)],
  [0x0649, String.fromCharCode(0x06cc)],
  [0x0643, String.fromCharCode(0x06a9)],
]);

// A key is looked up, never stored: longer text than any word is no word.
const MAX_KEY_INPUT_LENGTH: number = 200;

/*
 * A word as it is looked up, in any language: in its compatibility form
 * (NFKC - a full-width letter or colon is the plain one), in lower case,
 * without white space (Korean spaces its words as a writer likes; Chinese
 * and Japanese do not space them), and with the letters a word is written
 * either way with read as one (above). One pass over at most a short
 * label's length.
 */
export function getInvestigationReportWordKey(text: string): string {
  if (typeof text !== "string" || text.length > MAX_KEY_INPUT_LENGTH) {
    return "";
  }

  let key: string = "";

  for (const character of text.normalize("NFKC").toLowerCase()) {
    const code: number = character.codePointAt(0) || 0;

    if (
      isWhiteSpaceCode(code) ||
      KEY_LEFT_OUT_CODES.has(code) ||
      isArabicVowelMark(code)
    ) {
      continue;
    }

    key += KEY_SAME_LETTERS.get(code) || character;
  }

  return key;
}

// Every word a language other than English writes for a term, by its key.
function buildTermsByKey(): Map<string, InvestigationReportTerm> {
  const termsByKey: Map<string, InvestigationReportTerm> = new Map<
    string,
    InvestigationReportTerm
  >();

  for (const language of INVESTIGATION_REPORT_LANGUAGES) {
    if (language.code === ENGLISH_REPORT_LANGUAGE_CODE) {
      continue;
    }

    for (const term of Object.values(InvestigationReportTerm)) {
      for (const word of [
        language.words[term],
        ...(language.otherWords[term] || []),
      ]) {
        const key: string = getInvestigationReportWordKey(word);

        // The first language to write a word keeps it (a test holds them apart).
        if (key && !termsByKey.has(key)) {
          termsByKey.set(key, term);
        }
      }
    }
  }

  return termsByKey;
}

const TERMS_BY_KEY: Map<string, InvestigationReportTerm> = buildTermsByKey();

/*
 * The term a heading or a label of a language other than English names, or
 * null: "摘要" and "Zusammenfassung" are the Summary, "用户" the Users. The
 * text is the label alone - its emphasis, colon and qualifier already taken
 * off. English is read by the report parser's own tables, as it always was.
 */
export function readTranslatedReportTerm(
  text: string,
): InvestigationReportTerm | null {
  const key: string = getInvestigationReportWordKey(text);

  return key ? TERMS_BY_KEY.get(key) || null : null;
}

// Every word for a term in every language other than English, as written.
export function getTranslatedReportWords(
  term: InvestigationReportTerm,
): Array<string> {
  const words: Array<string> = [];

  for (const language of INVESTIGATION_REPORT_LANGUAGES) {
    if (language.code === ENGLISH_REPORT_LANGUAGE_CODE) {
      continue;
    }

    for (const word of [
      language.words[term],
      ...(language.otherWords[term] || []),
    ]) {
      if (!words.includes(word)) {
        words.push(word);
      }
    }
  }

  return words;
}

// The language of a code, or undefined.
export function getInvestigationReportLanguage(
  code: string,
): InvestigationReportLanguage | undefined {
  return INVESTIGATION_REPORT_LANGUAGES.find(
    (language: InvestigationReportLanguage): boolean => {
      return language.code === code;
    },
  );
}

// The words the personas spell out: English's.
export const ENGLISH_REPORT_WORDS: Readonly<
  Record<InvestigationReportTerm, string>
> = getInvestigationReportLanguage(ENGLISH_REPORT_LANGUAGE_CODE)!.words;
