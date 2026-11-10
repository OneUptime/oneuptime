import type { Ionicons } from "@expo/vector-icons";

type IconName = keyof typeof Ionicons.glyphMap;

/*
 * THE WORDS A SECURITY CASE IS READ IN - the values the server stores and the
 * sentences the dashboard says of them (Common/Types/SecurityCase/
 * SecurityCaseVerdict, SecurityCaseAiVerdict and SecurityEntity), kept here
 * because the app is built without Common's runtime code. Common's
 * SecurityCaseMobileParity suite reads this file and holds every value and
 * sentence to Common's, so a verdict added or reworded there fails until it
 * is here too.
 */

/*
 * What a closed case turned out to be, in the order the close sheet offers
 * them, each with what it means.
 */
export type SecurityCaseVerdict =
  | "True Positive"
  | "Benign Positive"
  | "False Positive"
  | "Undetermined";

export interface SecurityCaseVerdictTerm {
  verdict: SecurityCaseVerdict;
  description: string;
}

export const SECURITY_CASE_VERDICTS: ReadonlyArray<SecurityCaseVerdictTerm> = [
  {
    verdict: "True Positive",
    description: "Malicious or unauthorized activity really happened.",
  },
  {
    verdict: "Benign Positive",
    description:
      "The activity was real but expected, such as a penetration test or an admin task.",
  },
  {
    verdict: "False Positive",
    description:
      "The detection was wrong: the rule or the data misread normal activity.",
  },
  {
    verdict: "Undetermined",
    description: "There was not enough information to tell.",
  },
];

export function isSecurityCaseVerdict(
  value: unknown,
): value is SecurityCaseVerdict {
  return SECURITY_CASE_VERDICTS.some(
    (term: SecurityCaseVerdictTerm): boolean => {
      return term.verdict === value;
    },
  );
}

/*
 * What OneUptime AI made of a case when it triaged it: its read, never the
 * case's verdict, which a person sets. Each read lines up with the verdict a
 * close starts on; Inconclusive suggests none.
 */
export type SecurityCaseAiVerdict =
  | "Likely Malicious"
  | "Likely Benign"
  | "Likely False Positive"
  | "Inconclusive";

export type SecurityCaseAiTone = "danger" | "warning" | "success" | "neutral";

export interface SecurityCaseAiVerdictTerm {
  verdict: SecurityCaseAiVerdict;
  description: string;
  suggestedCloseVerdict?: SecurityCaseVerdict | undefined;
  // The colour family of the verdict it suggests, as the dashboard draws it.
  tone: SecurityCaseAiTone;
}

// In the order a reader weighs them: the worst first.
export const SECURITY_CASE_AI_VERDICTS: ReadonlyArray<SecurityCaseAiVerdictTerm> =
  [
    {
      verdict: "Likely Malicious",
      description: "The evidence points at malicious or unauthorized activity.",
      suggestedCloseVerdict: "True Positive",
      tone: "danger",
    },
    {
      verdict: "Likely Benign",
      description:
        "The activity looks real but expected, such as an admin task or a scan your team runs.",
      suggestedCloseVerdict: "Benign Positive",
      tone: "warning",
    },
    {
      verdict: "Likely False Positive",
      description: "The detection looks like it misread normal activity.",
      suggestedCloseVerdict: "False Positive",
      tone: "success",
    },
    {
      verdict: "Inconclusive",
      description:
        "There was not enough evidence to tell. A person has to look.",
      tone: "neutral",
    },
  ];

export function getAiVerdictTerm(
  value: unknown,
): SecurityCaseAiVerdictTerm | undefined {
  return SECURITY_CASE_AI_VERDICTS.find(
    (term: SecurityCaseAiVerdictTerm): boolean => {
      return term.verdict === value;
    },
  );
}

/*
 * The kinds of things a case is about, as the server types them, each with
 * the icon the app draws it with and the words a reader sees.
 */
export type SecurityEntityType =
  | "User"
  | "Host"
  | "IP Address"
  | "Domain"
  | "URL"
  | "File Hash"
  | "Process"
  | "Data Store"
  | "Other";

export interface SecurityEntityTerm {
  type: SecurityEntityType;
  label: string;
  icon: IconName;
}

export const SECURITY_ENTITY_TERMS: ReadonlyArray<SecurityEntityTerm> = [
  { type: "User", label: "User", icon: "person-outline" },
  { type: "Host", label: "Host", icon: "desktop-outline" },
  { type: "IP Address", label: "IP address", icon: "globe-outline" },
  { type: "Domain", label: "Domain", icon: "at-outline" },
  { type: "URL", label: "URL", icon: "link-outline" },
  { type: "File Hash", label: "File hash", icon: "document-outline" },
  { type: "Process", label: "Process", icon: "terminal-outline" },
  { type: "Data Store", label: "Data store", icon: "server-outline" },
  { type: "Other", label: "Other", icon: "ellipse-outline" },
];

export function getEntityTerm(type: unknown): SecurityEntityTerm {
  return (
    SECURITY_ENTITY_TERMS.find((term: SecurityEntityTerm): boolean => {
      return term.type === type;
    }) || SECURITY_ENTITY_TERMS[SECURITY_ENTITY_TERMS.length - 1]!
  );
}

export interface SecurityEntity {
  type: SecurityEntityType;
  value: string;
}

/*
 * A case's stored entities, read defensively: an entry without a value is
 * dropped, an unknown type reads as Other, and a value that appears twice
 * (whatever its case) is listed once, as the server merges them.
 */
export function readCaseEntities(value: unknown): Array<SecurityEntity> {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen: Set<string> = new Set();
  const entities: Array<SecurityEntity> = [];

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record: Record<string, unknown> = item as Record<string, unknown>;
    const entityValue: string =
      typeof record["value"] === "string" ? record["value"].trim() : "";

    if (!entityValue || seen.has(entityValue.toLowerCase())) {
      continue;
    }

    seen.add(entityValue.toLowerCase());
    entities.push({
      type: getEntityTerm(record["type"]).type,
      value: entityValue,
    });
  }

  return entities;
}

/*
 * What opened the case, as the server names its sources, in the words the
 * phone reads them in. A source this build does not know reads as stored.
 */
const SOURCE_LABELS: Readonly<Record<string, string>> = {
  "Detection Rule": "Detection rule",
  "Threat Intel": "Threat intel",
  "Connected Product": "Connected product",
  "Entity Risk": "Entity risk",
  "Data Security": "Data security",
  Manual: "A person",
};

export function describeCaseSource(source: unknown): string {
  if (typeof source !== "string" || !source.trim()) {
    return "";
  }

  return SOURCE_LABELS[source] || source;
}

/*
 * How the triage report's own heads-up starts, when the case's data held text
 * written to steer an AI (Common/Utils/AI/InvestigationReport,
 * SECURITY_CASE_TRIAGE_INJECTION_LEAD_PREFIX). The AI section says the same
 * first, as a warning, so the report is drawn without it.
 */
export const TRIAGE_INJECTION_LEAD_PREFIX: string =
  "**Heads up:** some text in this case's data reads like instructions to an AI";

/*
 * The triage report as the phone draws it, under its own "OneUptime AI"
 * heading: without the report's brand heading ("## 🧠 AI — Security Case
 * Triage") and without the runner's heads-up paragraph, which the section
 * shows as a warning instead. Anything the model wrote stays as written.
 */
export function getTriageReportBody(markdown: unknown): string {
  if (typeof markdown !== "string") {
    return "";
  }

  const lines: Array<string> = markdown.split("\n");
  const isFilled: (line: string) => boolean = (line: string): boolean => {
    return line.trim() !== "";
  };

  let index: number = lines.findIndex(isFilled);

  if (index !== -1 && lines[index]!.trim().startsWith("## ")) {
    lines.splice(index, 1);
    index = lines.findIndex(isFilled);
  }

  if (
    index !== -1 &&
    lines[index]!.trim().startsWith(TRIAGE_INJECTION_LEAD_PREFIX)
  ) {
    lines.splice(index, 1);
  }

  return lines.join("\n").trim();
}

/*
 * THE TRIAGE'S SUMMARY, READ BEFORE ANYTHING IS TAPPED.
 *
 * The triage writes its report in sections, as bold headings, Summary first
 * (Common/Server/Utils/AI/Security/SecurityCaseTriagePrompt): "two sentences
 * the analyst can read in five seconds: what happened and what it most
 * likely is". The dashboard lifts that Summary above the rest of the report
 * (InvestigationReportView); the phone shows it at once too, and folds the
 * rest under it.
 *
 * Only a report that opens with its Summary has one to lift: a Summary
 * label on the report's first line - "**Summary**", "**Summary:** text",
 * "**Summary** - text", "## Summary" or "Summary: text" - and then its first
 * paragraph, which ends sooner at any line that could open another section
 * (a heading, a bold label, a rule, a fence, "Evidence: ..."). So what the
 * phone lifts is the start of the Summary Common's report parser reads
 * (parseInvestigationReport), never anything after it, and whatever is not
 * lifted stays in the folded report. Any other shape lifts nothing, and the
 * whole report folds, as written. Common's SecurityCaseMobileParity holds
 * this to the parser. Each line is read by position, in time in line with
 * its length.
 *
 * A team's AI context may ask OneUptime AI to write in another language,
 * headings included (Common/Utils/AI/InvestigationReportLanguages). Such a
 * report is read the same way, by that language's words for the headings -
 * "**摘要**", "**Zusammenfassung:** text", "الملخص: text" - with the
 * full-width colon and brackets Chinese and Japanese write: "摘要：text".
 */

// The labels a Summary goes by, lower-cased (Common's KNOWN_LABELS).
export const SUMMARY_LABELS: ReadonlyArray<string> = [
  "summary",
  "tl;dr",
  "tl; dr",
  "tldr",
];

/*
 * The parser's other known labels, lower-cased: "Evidence: ..." and
 * "Impact: ..." each open a section of their own.
 */
export const OTHER_SECTION_LABELS: ReadonlyArray<string> = [
  "impact",
  "customer impact",
  "user impact",
  "business impact",
  "impact assessment",
  "impact and scope",
  "scope of impact",
  "blast radius",
  "who is affected",
  "what is affected",
  "most likely root cause",
  "likely root cause",
  "probable root cause",
  "root cause",
  "root cause hypothesis",
  "evidence",
  "key evidence",
  "supporting evidence",
  "key findings",
  "findings",
  "ruled out",
  "what was ruled out",
  "other causes ruled out",
  "causes ruled out",
  "other causes checked",
  "alternatives ruled out",
  "hypotheses ruled out",
  "suggested next steps",
  "next steps",
  "recommended next steps",
  "recommended actions",
  "recommendations",
  "evidence checked",
];

// The Summary's words in every other language the dashboard reads, as Common writes them.
export const TRANSLATED_SUMMARY_LABELS: ReadonlyArray<string> = [
  "Zusammenfassung",
  "Kurzfassung",
  "Résumé",
  "Synthèse",
  "Resumen",
  "Riepilogo",
  "Sintesi",
  "Riassunto",
  "Resumo",
  "Samenvatting",
  "Oversigt",
  "Resumé",
  "Opsummering",
  "Sammendrag",
  "Oppsummering",
  "Sammanfattning",
  "Сводка",
  "Резюме",
  "Итог",
  "Итоги",
  "Кратко",
  "概要",
  "要約",
  "サマリー",
  "요약",
  "摘要",
  "总结",
  "概述",
  "總結",
  "सारांश",
  "خلاصه",
  "جمع‌بندی",
  "الملخص",
  "ملخص",
];

/*
 * Their words for the report's other sections: its impact, root cause,
 * evidence, the causes it ruled out and its next steps.
 */
export const TRANSLATED_SECTION_LABELS: ReadonlyArray<string> = [
  "Auswirkungen",
  "Auswirkung",
  "Impact",
  "Impacto",
  "Impatto",
  "Påvirkning",
  "Påverkan",
  "Последствия",
  "Влияние",
  "影響",
  "影響範囲",
  "영향",
  "영향 범위",
  "影响",
  "影响范围",
  "影響範圍",
  "प्रभाव",
  "تأثیر",
  "اثرات",
  "التأثير",
  "الأثر",
  "تأثير",
  "Wahrscheinlichste Grundursache",
  "Grundursache",
  "Wahrscheinliche Grundursache",
  "Wahrscheinlichste Ursache",
  "Ursache",
  "Cause racine la plus probable",
  "Cause racine",
  "Cause racine probable",
  "Causa raíz más probable",
  "Causa raíz",
  "Causa raíz probable",
  "Causa principale più probabile",
  "Causa principale",
  "Causa principale probabile",
  "Causa radice",
  "Causa raiz mais provável",
  "Causa raiz",
  "Causa raiz provável",
  "Meest waarschijnlijke hoofdoorzaak",
  "Hoofdoorzaak",
  "Waarschijnlijke hoofdoorzaak",
  "Mest sandsynlige grundårsag",
  "Grundårsag",
  "Sandsynlig grundårsag",
  "Mest sannsynlige rotårsak",
  "Rotårsak",
  "Sannsynlig rotårsak",
  "Mest sannsynlig rotårsak",
  "Mest trolig rotorsak",
  "Rotorsak",
  "Trolig rotorsak",
  "Troligaste rotorsak",
  "Наиболее вероятная корневая причина",
  "Корневая причина",
  "Вероятная корневая причина",
  "Первопричина",
  "最も可能性の高い根本原因",
  "根本原因",
  "考えられる根本原因",
  "最も考えられる根本原因",
  "推定される根本原因",
  "가장 가능성 높은 근본 원인",
  "근본 원인",
  "가능성 높은 근본 원인",
  "가장 가능성이 높은 근본 원인",
  "最可能的根本原因",
  "可能的根本原因",
  "最可能的根因",
  "根因",
  "सबसे संभावित मूल कारण",
  "मूल कारण",
  "संभावित मूल कारण",
  "محتمل‌ترین علت ریشه‌ای",
  "علت ریشه‌ای",
  "علت ریشه‌ای محتمل",
  "السبب الجذري الأكثر احتمالًا",
  "السبب الجذري",
  "السبب الجذري المحتمل",
  "Belege",
  "Beweise",
  "Nachweise",
  "Preuves",
  "Éléments de preuve",
  "Evidencias",
  "Evidencia",
  "Pruebas",
  "Prove",
  "Evidenze",
  "Evidências",
  "Evidência",
  "Provas",
  "Bewijs",
  "Bewijzen",
  "Bewijsmateriaal",
  "Beviser",
  "Bevis",
  "Доказательства",
  "Свидетельства",
  "証拠",
  "根拠",
  "증거",
  "근거",
  "证据",
  "依据",
  "證據",
  "依據",
  "साक्ष्य",
  "सबूत",
  "प्रमाण",
  "شواهد",
  "الأدلة",
  "أدلة",
  "Ausgeschlossene Ursachen",
  "Ausgeschlossen",
  "Causes écartées",
  "Écartées",
  "Hypothèses écartées",
  "Causas descartadas",
  "Descartadas",
  "Hipótesis descartadas",
  "Cause scartate",
  "Cause escluse",
  "Escluse",
  "Hipóteses descartadas",
  "Uitgesloten oorzaken",
  "Uitgesloten",
  "Udelukkede årsager",
  "Udelukket",
  "Utelukkede årsaker",
  "Utelukket",
  "Uteslutna orsaker",
  "Uteslutet",
  "Uteslutna",
  "Исключённые причины",
  "Исключено",
  "Исключённые гипотезы",
  "除外した原因",
  "除外された原因",
  "除外",
  "제외한 원인",
  "제외된 원인",
  "배제된 원인",
  "已排除的原因",
  "已排除",
  "排除的原因",
  "खारिज किए गए कारण",
  "ख़ारिज किए गए कारण",
  "खारिज किए गए",
  "علت‌های ردشده",
  "موارد ردشده",
  "فرضیه‌های ردشده",
  "الأسباب المستبعدة",
  "المستبعد",
  "الأسباب التي تم استبعادها",
  "Vorgeschlagene nächste Schritte",
  "Nächste Schritte",
  "Empfohlene nächste Schritte",
  "Prochaines étapes suggérées",
  "Prochaines étapes",
  "Étapes suivantes",
  "Próximos pasos sugeridos",
  "Próximos pasos",
  "Siguientes pasos",
  "Prossimi passi suggeriti",
  "Prossimi passi",
  "Passi successivi",
  "Próximos passos sugeridos",
  "Próximos passos",
  "Próximas etapas",
  "Voorgestelde volgende stappen",
  "Volgende stappen",
  "Foreslåede næste trin",
  "Næste trin",
  "Foreslåtte neste steg",
  "Neste steg",
  "Föreslagna nästa steg",
  "Nästa steg",
  "Предлагаемые следующие шаги",
  "Следующие шаги",
  "Рекомендуемые следующие шаги",
  "推奨される次のステップ",
  "次のステップ",
  "推奨する次のステップ",
  "推奨対応",
  "제안된 다음 단계",
  "다음 단계",
  "권장 다음 단계",
  "建议的后续步骤",
  "后续步骤",
  "建议的下一步",
  "下一步",
  "建议措施",
  "建議的後續步驟",
  "後續步驟",
  "建議的下一步",
  "建議措施",
  "सुझाए गए अगले कदम",
  "अगले कदम",
  "सुझाए गए अगले क़दम",
  "گام‌های بعدی پیشنهادی",
  "گام‌های بعدی",
  "اقدامات پیشنهادی",
  "الخطوات التالية المقترحة",
  "الخطوات التالية",
  "الخطوات المقترحة",
];

// The colons a label ends with: ASCII, and the full-width one CJK text writes.
const LABEL_COLONS: ReadonlyArray<string> = [":", "\uFF1A"];
// The full-width brackets "（high confidence）" is written in, in Chinese and Japanese.
const FULL_WIDTH_OPEN_BRACKET: string = "\uFF08";
const FULL_WIDTH_CLOSE_BRACKET: string = "\uFF09";
// Every label the parser knows is shorter: a longer one is prose to it.
const MAX_LABEL_LENGTH: number = 160;

const WHITESPACE_RUN: RegExp = /\s+/;

function isSpace(character: string): boolean {
  return character === " " || character === "\t";
}

// White space, as trim() and \s read it (Common's isWhiteSpaceCode).
function isWhiteSpaceCode(code: number): boolean {
  if (code <= 0x20) {
    return code === 0x20 || (code >= 0x09 && code <= 0x0d);
  }

  return (
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

/*
 * What a word's key leaves out, as Common's does
 * (getInvestigationReportWordKey): the joiners Persian writes inside a word
 * (a model writes the same word with one, a space or nothing), the word
 * joiner, the byte order mark, and the Arabic letters' stretch (tatweel).
 */
const WORD_KEY_LEFT_OUT_CODES: ReadonlySet<number> = new Set<number>([
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
const WORD_KEY_SAME_LETTERS: ReadonlyMap<number, string> = new Map<
  number,
  string
>([
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
const MAX_WORD_KEY_INPUT_LENGTH: number = 200;

/*
 * The text in its compatibility form (NFKC: a full-width letter is the
 * plain one), as the parser reads a word - where the engine has normalize;
 * without it, the text as written.
 */
function toCompatibleForm(text: string): string {
  try {
    return typeof text.normalize === "function" ? text.normalize("NFKC") : text;
  } catch {
    return text;
  }
}

/*
 * A word as Common's report parser looks it up in another language: in
 * lower case, without white space (Korean spaces its words as a writer
 * likes; Chinese and Japanese do not space them), without the codes above,
 * and with the letters a word is written either way with read as one.
 * Compatible, the text is first put in its compatibility form, as the
 * parser puts it; otherwise it is read as written. One pass over at most a
 * short label's length.
 */
export function toReportWordKey(text: string, compatible: boolean): string {
  if (text.length > MAX_WORD_KEY_INPUT_LENGTH) {
    return "";
  }

  let key: string = "";

  for (const character of (compatible
    ? toCompatibleForm(text)
    : text
  ).toLowerCase()) {
    const code: number = character.codePointAt(0) || 0;

    if (
      isWhiteSpaceCode(code) ||
      WORD_KEY_LEFT_OUT_CODES.has(code) ||
      isArabicVowelMark(code)
    ) {
      continue;
    }

    key += WORD_KEY_SAME_LETTERS.get(code) || character;
  }

  return key;
}

function toWordKeys(words: ReadonlyArray<string>): ReadonlySet<string> {
  return new Set<string>(
    words.map((word: string): string => {
      return toReportWordKey(word, false);
    }),
  );
}

const SUMMARY_LABEL_SET: ReadonlySet<string> = new Set<string>(SUMMARY_LABELS);
const SECTION_LABEL_SET: ReadonlySet<string> = new Set<string>(
  OTHER_SECTION_LABELS,
);
const SUMMARY_WORD_KEYS: ReadonlySet<string> = toWordKeys(
  TRANSLATED_SUMMARY_LABELS,
);
const SECTION_WORD_KEYS: ReadonlySet<string> = toWordKeys(
  TRANSLATED_SECTION_LABELS,
);

function endsWithColon(value: string): boolean {
  const trimmed: string = value.trimEnd();

  return LABEL_COLONS.some((colon: string): boolean => {
    return trimmed.endsWith(colon);
  });
}

function stripColon(value: string): string {
  const trimmed: string = value.trimEnd();

  return endsWithColon(trimmed) ? trimmed.slice(0, -1).trimEnd() : trimmed;
}

// The first colon of either kind, or -1.
function indexOfFirstColon(value: string): number {
  let first: number = -1;

  for (const colon of LABEL_COLONS) {
    const index: number = value.indexOf(colon);

    if (index !== -1 && (first === -1 || index < first)) {
      first = index;
    }
  }

  return first;
}

/*
 * A label without its colon and the qualifier after it, as the parser
 * looks it up: "Summary:" and "Summary (high confidence)" are "Summary",
 * "摘要（草稿）：" is "摘要".
 */
function toBareLabel(label: string): string {
  let bare: string = stripColon(label.trim());

  if (bare.endsWith(")") || bare.endsWith(FULL_WIDTH_CLOSE_BRACKET)) {
    const open: number = Math.max(
      bare.lastIndexOf("("),
      bare.lastIndexOf(FULL_WIDTH_OPEN_BRACKET),
    );
    const inside: string = bare.slice(open + 1, -1);

    if (
      open !== -1 &&
      !inside.includes(")") &&
      !inside.includes(FULL_WIDTH_CLOSE_BRACKET)
    ) {
      bare = bare.slice(0, open).trimEnd();
    }
  }

  return stripColon(bare);
}

// An English label as the parser looks it up: "Summary:" and "summary" are both "summary".
function toLabelKey(label: string): string {
  return toBareLabel(label)
    .split(WHITESPACE_RUN)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/*
 * Whether a word is the Summary's in another language: as written, and as
 * the parser reads it - so the app lifts no Summary the parser does not
 * read. A word written in compatibility forms (full-width letters) ends a
 * Summary, as the parser reads it, but is not lifted.
 */
function isTranslatedSummary(word: string): boolean {
  return (
    SUMMARY_WORD_KEYS.has(toReportWordKey(word, false)) &&
    SUMMARY_WORD_KEYS.has(toReportWordKey(word, true))
  );
}

// Whether a bold or heading label names the Summary, in any language.
function isSummaryLabel(label: string): boolean {
  return (
    label.length <= MAX_LABEL_LENGTH &&
    (SUMMARY_LABEL_SET.has(toLabelKey(label)) ||
      isTranslatedSummary(toBareLabel(label)))
  );
}

// "- text", ": text", "— text" after a label: the text; null without a separator.
function textAfterSeparator(rest: string): string | null {
  for (const separator of [...LABEL_COLONS, "—", "–", "--", "-"]) {
    if (rest.startsWith(separator)) {
      return rest.slice(separator.length).trim();
    }
  }

  return null;
}

/*
 * The Summary label a report opens with, and any text after it on that
 * line; null for a line that is not one. A bold phrase followed by prose
 * with no separator ("**Summary** is below") is prose, as the parser reads
 * it.
 */
export function readSummaryLabel(line: string): { text: string } | null {
  const content: string = line.trim();

  if (content.startsWith("#")) {
    let level: number = 0;

    while (content[level] === "#") {
      level += 1;
    }

    let heading: string = content.slice(level);

    if (level > 6 || (heading !== "" && !isSpace(heading[0]!))) {
      return null;
    }

    heading = heading.trim();

    // "## Summary ##": an ATX heading may close with hashes of its own.
    let end: number = heading.length;

    while (end > 0 && heading[end - 1] === "#") {
      end -= 1;
    }

    if (end < heading.length && isSpace(heading[end - 1] || "")) {
      heading = heading.slice(0, end);
    }

    return isSummaryLabel(heading) ? { text: "" } : null;
  }

  const marker: string | undefined = ["***", "___", "**", "__"].find(
    (candidate: string): boolean => {
      return content.startsWith(candidate);
    },
  );

  if (marker) {
    const close: number = content.indexOf(marker, marker.length);

    if (close <= marker.length) {
      return null;
    }

    const inner: string = content.slice(marker.length, close);
    const after: string = content.slice(close + marker.length).trim();

    if (!isSummaryLabel(inner)) {
      return null;
    }

    if (after === "" || LABEL_COLONS.includes(after)) {
      return { text: "" };
    }

    const separated: string | null = textAfterSeparator(after);

    if (separated !== null) {
      return { text: separated };
    }

    return endsWithColon(inner) ? { text: after } : null;
  }

  const colon: number = indexOfFirstColon(content);
  const plainLabel: string = colon > 0 ? content.slice(0, colon).trim() : "";
  const isSummary: boolean =
    (isPlainLabel(plainLabel) &&
      SUMMARY_LABEL_SET.has(toLabelKey(plainLabel))) ||
    (isPlainWord(plainLabel) && isTranslatedSummary(plainLabel));

  return isSummary ? { text: content.slice(colon + 1).trim() } : null;
}

function isLetter(character: string): boolean {
  return (
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z")
  );
}

/*
 * The words before a plain label's colon, as the parser takes them: a
 * letter first, then letters, spaces and ";,()" - "Summary", "TL;DR" - and
 * no more than 61 characters.
 */
function isPlainLabel(label: string): boolean {
  return (
    label.length > 0 &&
    label.length <= 61 &&
    isLetter(label[0]!) &&
    [...label].every((character: string): boolean => {
      return isLetter(character) || " \t;,()".includes(character);
    })
  );
}

/*
 * A plain label in another language, as the parser takes one: no more than
 * 61 characters, a letter first - not a joiner, a vowel mark or white space
 * - and no white space but spaces and tabs. Only a word of the table above
 * is looked up, whole (isTranslatedSummary), so the rest is that word's
 * letters and the marks and joiners it is written with.
 */
function isPlainWord(label: string): boolean {
  const first: number = label.codePointAt(0) || 0;

  if (
    label.length === 0 ||
    label.length > 61 ||
    (first < 0x80 && !isLetter(label[0]!)) ||
    isWhiteSpaceCode(first) ||
    (WORD_KEY_LEFT_OUT_CODES.has(first) && first !== 0x0640) ||
    isArabicVowelMark(first)
  ) {
    return false;
  }

  return [...label].every((character: string): boolean => {
    return (
      !isWhiteSpaceCode(character.codePointAt(0) || 0) || isSpace(character)
    );
  });
}

// "---", "***", "_ _ _": a rule, which the report's footer starts with.
function isRule(content: string): boolean {
  const character: string = content[0] || "";
  let count: number = 0;

  if (character !== "-" && character !== "*" && character !== "_") {
    return false;
  }

  for (const next of content) {
    if (next === character) {
      count += 1;
    } else if (!isSpace(next)) {
      return false;
    }
  }

  return count >= 3;
}

/*
 * Whether a line ends the Summary's first paragraph: a blank line, or a
 * line that could open another section or a block of its own - in any
 * language, and in the compatibility forms the parser reads a word in.
 */
function endsSummary(line: string): boolean {
  const content: string = line.trim();

  if (
    content === "" ||
    isRule(content) ||
    ["#", "**", "__", "```", "~~~"].some((start: string): boolean => {
      return content.startsWith(start);
    })
  ) {
    return true;
  }

  const colon: number = indexOfFirstColon(content);

  if (colon <= 0) {
    return false;
  }

  const label: string = content.slice(0, colon);
  const key: string = toLabelKey(label);

  if (SUMMARY_LABEL_SET.has(key) || SECTION_LABEL_SET.has(key)) {
    return true;
  }

  const wordKey: string = toReportWordKey(toBareLabel(label), true);

  return SUMMARY_WORD_KEYS.has(wordKey) || SECTION_WORD_KEYS.has(wordKey);
}

export interface TriageReportParts {
  // The start of the report's Summary, as written, or "" when it has none to lift.
  summary: string;
  // Everything after it, as written: the whole report when nothing was lifted.
  rest: string;
}

export function splitTriageReport(markdown: unknown): TriageReportParts {
  const body: string = getTriageReportBody(markdown);
  const none: TriageReportParts = { summary: "", rest: body };
  const lines: Array<string> = body.split("\n");
  const label: { text: string } | null = readSummaryLabel(lines[0] || "");

  if (!label) {
    return none;
  }

  const summaryLines: Array<string> = label.text ? [label.text] : [];
  let index: number = 1;

  // Blank lines between the label and its text.
  while (
    summaryLines.length === 0 &&
    index < lines.length &&
    !lines[index]!.trim()
  ) {
    index += 1;
  }

  while (index < lines.length && !endsSummary(lines[index]!)) {
    summaryLines.push(lines[index]!);
    index += 1;
  }

  const summary: string = summaryLines.join("\n").trim();

  return summary
    ? { summary, rest: lines.slice(index).join("\n").trim() }
    : none;
}
