import { JSONObject } from "../JSON";
import { translationKey } from "../Translator";
import {
  ComplianceFact,
  getFactKeys,
  getFactsHash,
  getUnfoundedNumbers,
  readComplianceFacts,
  withoutFactIds,
} from "./ComplianceFacts";
import DataCategory from "./DataCategory";
import { RecordTransfer } from "./RecordOfProcessing";

/*
 * A DATA PROTECTION IMPACT ASSESSMENT FOR A STORE THAT NEEDS ONE (#10375).
 *
 * GDPR Article 35 asks for an assessment before processing that is likely
 * to put people at high risk. Data Security knows which of the project's
 * stores those are (getImpactAssessmentTriggers):
 *
 *   - one that holds special category data - health data, or what Article
 *     9 protects most: ethnicity, religion, biometrics and the rest;
 *   - one that holds data about many people, read from its record count;
 *   - one whose data leaves the countries its people are in (the record's
 *     transfers).
 *
 * One assessment per store, since a store is what Data Security knows;
 * grouping stores into a processing activity is a later step. OneUptime
 * AI drafts it on request, in Article 35(7)'s four parts, from facts the
 * scans know - what the store holds and why, its open issues, how exposed
 * it is and who can reach it, its encryption and backups, and the fixes on
 * its timeline - and each part says which facts it rests on.
 *
 * It is a document a person edits, part by part. A part a person edited is
 * never drafted again; Draft Again drafts only the parts still OneUptime
 * AI's (mergeImpactAssessmentDraft). Exported as Markdown and PDF.
 *
 * Pure, for the server and the Dashboard alike.
 */

export enum ImpactAssessmentTrigger {
  // Health data, or another of Article 9's special categories.
  SpecialCategory = "SpecialCategory",
  // About LARGE_SCALE_RECORDS records or more.
  LargeScale = "LargeScale",
  // Its data leaves the countries its people are in.
  LeavesCountries = "LeavesCountries",
}

/*
 * About how many records make a store's processing large-scale for this
 * purpose: Article 35(3)(b)'s "large scale" has no number in the law, and
 * supervisory authorities weigh the people involved. A hundred thousand
 * records is where an assessment is worth a look; the team decides.
 */
export const LARGE_SCALE_RECORDS: number = 100_000;

// The categories GDPR Article 9 protects most.
export const SPECIAL_CATEGORIES: ReadonlyArray<DataCategory> = [
  DataCategory.Health,
  DataCategory.SpecialCategory,
];

export interface ImpactAssessmentTriggerView {
  trigger: ImpactAssessmentTrigger;
  // The special categories it holds.
  categories?: Array<string> | undefined;
  // About how many records it holds.
  records?: number | undefined;
  // Where its data leaves its people's countries.
  transfers?: Array<RecordTransfer> | undefined;
}

export const IMPACT_ASSESSMENT_TRIGGER_TITLES: Readonly<
  Record<ImpactAssessmentTrigger, string>
> = {
  [ImpactAssessmentTrigger.SpecialCategory]: translationKey(
    "Holds special category data",
  ),
  [ImpactAssessmentTrigger.LargeScale]: translationKey(
    "Holds data about many people",
  ),
  [ImpactAssessmentTrigger.LeavesCountries]: translationKey(
    "Its data leaves its people's countries",
  ),
};

/*
 * Why a store needs an impact assessment, or nothing when it does not: its
 * categories, its record count and its transfers, each a reason of its
 * own. A store OneUptime declares never needs one here: what it holds is
 * known by design, and its record says so (#10398).
 */
export function getImpactAssessmentTriggers(data: {
  dataCategories: ReadonlyArray<string>;
  estimatedRecords?: number | null | undefined;
  transfers: ReadonlyArray<RecordTransfer>;
  isDeclared?: boolean | undefined;
}): Array<ImpactAssessmentTriggerView> {
  if (data.isDeclared) {
    return [];
  }

  const triggers: Array<ImpactAssessmentTriggerView> = [];
  const special: Array<string> = SPECIAL_CATEGORIES.filter(
    (category: DataCategory): boolean => {
      return data.dataCategories.includes(category);
    },
  );

  if (special.length > 0) {
    triggers.push({
      trigger: ImpactAssessmentTrigger.SpecialCategory,
      categories: special,
    });
  }

  if (
    typeof data.estimatedRecords === "number" &&
    Number.isFinite(data.estimatedRecords) &&
    data.estimatedRecords >= LARGE_SCALE_RECORDS
  ) {
    triggers.push({
      trigger: ImpactAssessmentTrigger.LargeScale,
      records: Math.round(data.estimatedRecords),
    });
  }

  if (data.transfers.length > 0) {
    triggers.push({
      trigger: ImpactAssessmentTrigger.LeavesCountries,
      transfers: [...data.transfers],
    });
  }

  return triggers;
}

/*
 * Article 35(7)'s parts, in its order. Stored as the keys of an
 * assessment's sections: never rename one.
 */
export enum ImpactAssessmentPart {
  // (a) A description of the processing and its purposes.
  Processing = "processing",
  // (b) Whether it is necessary, and in proportion to its purposes.
  Necessity = "necessity",
  // (c) The risks to the people it is about.
  Risks = "risks",
  // (d) The measures that address them.
  Measures = "measures",
}

export const IMPACT_ASSESSMENT_PARTS: ReadonlyArray<ImpactAssessmentPart> = [
  ImpactAssessmentPart.Processing,
  ImpactAssessmentPart.Necessity,
  ImpactAssessmentPart.Risks,
  ImpactAssessmentPart.Measures,
];

export function isImpactAssessmentPart(
  value: unknown,
): value is ImpactAssessmentPart {
  return (
    typeof value === "string" &&
    (IMPACT_ASSESSMENT_PARTS as ReadonlyArray<string>).includes(value)
  );
}

export const IMPACT_ASSESSMENT_PART_TITLES: Readonly<
  Record<ImpactAssessmentPart, string>
> = {
  [ImpactAssessmentPart.Processing]: translationKey(
    "The Processing and Its Purposes",
  ),
  [ImpactAssessmentPart.Necessity]: translationKey(
    "Necessity and Proportionality",
  ),
  [ImpactAssessmentPart.Risks]: translationKey("Risks to the People It Is About"),
  [ImpactAssessmentPart.Measures]: translationKey(
    "Measures That Address the Risks",
  ),
};

// Each part's point of Article 35(7), as the document cites it.
export const IMPACT_ASSESSMENT_PART_ARTICLES: Readonly<
  Record<ImpactAssessmentPart, string>
> = {
  [ImpactAssessmentPart.Processing]: "Art. 35(7)(a)",
  [ImpactAssessmentPart.Necessity]: "Art. 35(7)(b)",
  [ImpactAssessmentPart.Risks]: "Art. 35(7)(c)",
  [ImpactAssessmentPart.Measures]: "Art. 35(7)(d)",
};

// What OneUptime AI is asked to write in each part.
export const IMPACT_ASSESSMENT_PART_ASKS: Readonly<
  Record<ImpactAssessmentPart, string>
> = {
  [ImpactAssessmentPart.Processing]:
    "what the store holds, about whom, where it is kept and who receives it, and why it is processed",
  [ImpactAssessmentPart.Necessity]:
    "whether holding this data, for this long and in these places, is necessary for the purpose and in proportion to it - and what the facts leave open",
  [ImpactAssessmentPart.Risks]:
    "the risks to the people it is about, from the store's open issues, how exposed it is, who can reach it and where its data goes",
  [ImpactAssessmentPart.Measures]:
    "the measures in place - its encryption, who can reach it, its backups and the fixes on its timeline - and which risks they do not yet address",
};

export enum ImpactAssessmentSectionSource {
  // OneUptime AI's draft: Draft Again may write it again.
  Drafted = "Drafted",
  // A person edited it: never drafted again.
  Edited = "Edited",
}

export interface ImpactAssessmentSection {
  part: ImpactAssessmentPart;
  // Its words, as Markdown: paragraphs and lists, no headings.
  markdown: string;
  source: ImpactAssessmentSectionSource;
  // The keys of the facts a drafted part rests on.
  factKeys: Array<string>;
  /*
   * What its facts said when it was written: a drafted part's, the facts
   * it cites; an edited part's, every fact the person had in front of
   * them. A part whose facts changed since says so (getStaleImpactAssessmentParts).
   */
  factsHash?: string | undefined;
  draftedAt?: string | undefined;
  editedAt?: string | undefined;
  editedByUserId?: string | undefined;
}

function allKeys(facts: ReadonlyArray<ComplianceFact>): Array<string> {
  return facts.map((fact: ComplianceFact): string => {
    return fact.key;
  });
}

/*
 * The parts of an assessment written over facts that say something else
 * now: a new open issue, a fix, a transfer that began - for the page to
 * say, and the person to look at.
 */
export function getStaleImpactAssessmentParts(data: {
  assessment: StoreImpactAssessment | null;
  facts: ReadonlyArray<ComplianceFact>;
}): Array<ImpactAssessmentPart> {
  if (!data.assessment) {
    return [];
  }

  return IMPACT_ASSESSMENT_PARTS.filter(
    (part: ImpactAssessmentPart): boolean => {
      const section: ImpactAssessmentSection | undefined =
        data.assessment!.sections[part];

      if (!section?.factsHash) {
        return false;
      }

      const keys: Array<string> =
        section.source === ImpactAssessmentSectionSource.Edited
          ? allKeys(data.facts)
          : section.factKeys;

      return getFactsHash({ facts: data.facts, keys }) !== section.factsHash;
    },
  );
}

// What a store keeps (DataStore.impactAssessment).
export interface StoreImpactAssessment {
  version: number;
  // The language its drafted parts are written in.
  language: string;
  sections: Partial<Record<ImpactAssessmentPart, ImpactAssessmentSection>>;
  // The facts its drafted parts were written from.
  facts: Array<ComplianceFact>;
  // Why the store needed it, when it was drafted.
  triggers: Array<ImpactAssessmentTrigger>;
  draftedAt?: string | undefined;
}

export const IMPACT_ASSESSMENT_VERSION: number = 1;

// The longest part a draft keeps, and the shortest that says anything.
export const MAX_IMPACT_ASSESSMENT_SECTION_LENGTH: number = 4000;
export const MIN_IMPACT_ASSESSMENT_SECTION_LENGTH: number = 40;
// The longest part a person may write.
export const MAX_EDITED_SECTION_LENGTH: number = 20000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function readSection(
  part: ImpactAssessmentPart,
  value: unknown,
): ImpactAssessmentSection | null {
  if (!isRecord(value)) {
    return null;
  }

  const markdown: string = readText(value["markdown"], MAX_EDITED_SECTION_LENGTH);
  const source: unknown = value["source"];

  if (!markdown.trim()) {
    return null;
  }

  return {
    part,
    markdown,
    source:
      source === ImpactAssessmentSectionSource.Edited
        ? ImpactAssessmentSectionSource.Edited
        : ImpactAssessmentSectionSource.Drafted,
    factKeys: Array.isArray(value["factKeys"])
      ? value["factKeys"]
          .filter((key: unknown): key is string => {
            return typeof key === "string";
          })
          .slice(0, 60)
      : [],
    factsHash: readText(value["factsHash"], 64) || undefined,
    draftedAt: readText(value["draftedAt"], 40) || undefined,
    editedAt: readText(value["editedAt"], 40) || undefined,
    editedByUserId: readText(value["editedByUserId"], 40) || undefined,
  };
}

// An assessment as a store keeps it, or null: none, or one this build cannot read.
export function readStoreImpactAssessment(
  value: unknown,
): StoreImpactAssessment | null {
  if (!isRecord(value) || !isRecord(value["sections"])) {
    return null;
  }

  const sections: Partial<
    Record<ImpactAssessmentPart, ImpactAssessmentSection>
  > = {};

  for (const part of IMPACT_ASSESSMENT_PARTS) {
    const section: ImpactAssessmentSection | null = readSection(
      part,
      (value["sections"] as Record<string, unknown>)[part],
    );

    if (section) {
      sections[part] = section;
    }
  }

  if (Object.keys(sections).length === 0) {
    return null;
  }

  return {
    version: IMPACT_ASSESSMENT_VERSION,
    language: readText(value["language"], 20) || "en",
    sections,
    facts: readComplianceFacts(value["facts"]),
    triggers: Array.isArray(value["triggers"])
      ? value["triggers"].filter(
          (trigger: unknown): trigger is ImpactAssessmentTrigger => {
            return (
              typeof trigger === "string" &&
              (Object.values(ImpactAssessmentTrigger) as Array<string>).includes(
                trigger,
              )
            );
          },
        )
      : [],
    draftedAt: readText(value["draftedAt"], 40) || undefined,
  };
}

export function toStoreImpactAssessmentJson(
  assessment: StoreImpactAssessment,
): JSONObject {
  return JSON.parse(JSON.stringify(assessment)) as JSONObject;
}

/*
 * A part's words as a document may hold them: Markdown paragraphs and
 * lists, with no headings of its own (the document draws each part's), no
 * HTML, no image and no link - a link's words stay. Whatever a model, or a
 * person, writes is cleaned the same way.
 */
export function cleanSectionMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .split("\n")
    .filter((line: string): boolean => {
      return !/^\s{0,3}#{1,6}\s/.test(line);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/*
 * OneUptime AI's answer, as read (StrictAnswer): each part's Markdown and
 * the ids it says it rests on - not yet held to the facts.
 */
export type ImpactAssessmentAnswer = Partial<
  Record<ImpactAssessmentPart, { markdown: string; facts: Array<string> }>
>;

/*
 * The answer held to its facts: each part keeps only the ids of facts it
 * was given, with the ids taken out of its words, and is dropped when it
 * cites none, says too little, or says a number none of its facts holds.
 */
export function holdImpactAssessmentToFacts(data: {
  answer: ImpactAssessmentAnswer;
  facts: ReadonlyArray<ComplianceFact>;
  now: Date;
}): Partial<Record<ImpactAssessmentPart, ImpactAssessmentSection>> {
  const sections: Partial<
    Record<ImpactAssessmentPart, ImpactAssessmentSection>
  > = {};

  for (const part of IMPACT_ASSESSMENT_PARTS) {
    const raw: { markdown: string; facts: Array<string> } | undefined =
      data.answer[part];

    if (!raw || typeof raw.markdown !== "string") {
      continue;
    }

    const factKeys: Array<string> = getFactKeys({
      facts: data.facts,
      ids: raw.facts || [],
    });

    if (factKeys.length === 0) {
      continue;
    }

    const cleaned: string = withoutFactIds(cleanSectionMarkdown(raw.markdown));
    const markdown: string =
      Array.from(cleaned).length > MAX_IMPACT_ASSESSMENT_SECTION_LENGTH
        ? `${Array.from(cleaned)
            .slice(0, MAX_IMPACT_ASSESSMENT_SECTION_LENGTH - 1)
            .join("")
            .trim()}…`
        : cleaned;

    if (Array.from(markdown).length < MIN_IMPACT_ASSESSMENT_SECTION_LENGTH) {
      continue;
    }

    const cited: Array<ComplianceFact> = data.facts.filter(
      (fact: ComplianceFact): boolean => {
        return factKeys.includes(fact.key);
      },
    );

    if (getUnfoundedNumbers({ text: markdown, facts: cited }).length > 0) {
      continue;
    }

    sections[part] = {
      part,
      markdown,
      source: ImpactAssessmentSectionSource.Drafted,
      factKeys,
      factsHash: getFactsHash({ facts: data.facts, keys: factKeys }),
      draftedAt: data.now.toISOString(),
    };
  }

  return sections;
}

/*
 * A new draft, merged into the assessment a store keeps: every part a
 * person edited stays as they wrote it, whatever the draft says; a part
 * still OneUptime AI's is the new draft's, where it wrote one. The facts
 * and the language are the new draft's.
 */
export function mergeImpactAssessmentDraft(data: {
  previous: StoreImpactAssessment | null;
  drafted: Partial<Record<ImpactAssessmentPart, ImpactAssessmentSection>>;
  facts: ReadonlyArray<ComplianceFact>;
  triggers: ReadonlyArray<ImpactAssessmentTrigger>;
  language: string;
  now: Date;
}): StoreImpactAssessment {
  const sections: Partial<
    Record<ImpactAssessmentPart, ImpactAssessmentSection>
  > = {};

  for (const part of IMPACT_ASSESSMENT_PARTS) {
    const previous: ImpactAssessmentSection | undefined =
      data.previous?.sections[part];

    if (previous?.source === ImpactAssessmentSectionSource.Edited) {
      sections[part] = previous;
      continue;
    }

    const drafted: ImpactAssessmentSection | undefined = data.drafted[part];

    if (drafted) {
      sections[part] = drafted;
    } else if (previous) {
      sections[part] = previous;
    }
  }

  return {
    version: IMPACT_ASSESSMENT_VERSION,
    language: data.language,
    sections,
    facts: [...data.facts],
    triggers: [...data.triggers],
    draftedAt: data.now.toISOString(),
  };
}

export const SECTION_TOO_LONG_MESSAGE: string = translationKey(
  "This part is longer than an assessment keeps. Shorten it, then save it again.",
);

/*
 * A person's words for one part, as the assessment keeps them: cleaned as a
 * draft is, and from then on theirs - never drafted again. An empty part
 * is taken out, for OneUptime AI to draft again.
 */
export function editImpactAssessmentSection(data: {
  assessment: StoreImpactAssessment | null;
  part: ImpactAssessmentPart;
  markdown: string;
  // The facts as the person read them, so a change after is said.
  facts: ReadonlyArray<ComplianceFact>;
  userId?: string | undefined;
  language: string;
  now: Date;
}):
  | { isDone: true; assessment: StoreImpactAssessment }
  | { isDone: false; refusal: string } {
  if (Array.from(data.markdown).length > MAX_EDITED_SECTION_LENGTH) {
    return { isDone: false, refusal: SECTION_TOO_LONG_MESSAGE };
  }

  const markdown: string = cleanSectionMarkdown(data.markdown);
  const assessment: StoreImpactAssessment = data.assessment || {
    version: IMPACT_ASSESSMENT_VERSION,
    language: data.language,
    sections: {},
    facts: [],
    triggers: [],
  };
  const sections: Partial<
    Record<ImpactAssessmentPart, ImpactAssessmentSection>
  > = { ...assessment.sections };

  if (markdown) {
    sections[data.part] = {
      part: data.part,
      markdown,
      source: ImpactAssessmentSectionSource.Edited,
      factKeys: [],
      factsHash: getFactsHash({ facts: data.facts, keys: allKeys(data.facts) }),
      editedAt: data.now.toISOString(),
      editedByUserId: data.userId,
    };
  } else {
    delete sections[data.part];
  }

  return { isDone: true, assessment: { ...assessment, sections } };
}
