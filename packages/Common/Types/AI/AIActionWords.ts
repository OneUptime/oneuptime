import {
  composedValue,
  createTranslator,
  DEFAULT_LANGUAGE,
  fillTemplate,
  formatList,
  getSentenceLanguage,
  PluralTemplate,
  SentenceOptions,
  TemplateValues,
  translatableTerm,
  translationKey,
  Translator,
} from "../Translator";
import { getReadingDirection, ReadingDirection } from "../ReadingDirection";
import {
  AI_AFFECTED_RESOURCE_KINDS,
  AiAffectedResourceKindInfo,
} from "./AiAffectedResources";

/*
 * WHAT AN AI ACTION'S CARD SAYS, IN EVERY READER'S LANGUAGE.
 *
 * Before OneUptime AI changes anything - declares an incident, links a host,
 * pages an on-call policy - Ask AI and an incident's or alert's
 * conversation show the action on a card for the person to allow or skip,
 * and keep it as a line of the answer once it ran: "Create incident:
 * Checkout down", and under it "Linked to host "test01".". Those words were
 * built on the server in English, so a person whose Dashboard is in German
 * or Japanese read one English card in the middle of a translated page -
 * and a shared thread is read by responders in several languages at once.
 *
 * So the server writes each line as a sentence of this module: its English
 * template - a translationKey every Dashboard locale words (the extractor
 * reads this file) - and what fills it. A value is data, drawn as it is
 * written: the title the model gave the incident, its number ("INC-42"), a
 * host's name, a severity the project named - never a translated sentence
 * with the data inside it. A word of this module that goes into a sentence
 * - the kind of a resource, "Untitled" - is a term, translated with the
 * sentence; a list of resources is a list of sentences, joined the way the
 * reader's language joins a list.
 *
 * The Dashboard words a stored sentence in the reader's language, when it
 * is one of this module's (isKnownAIActionSentence; anything else reads as
 * the English the action stores). The server writes the same sentence in
 * English (describeAIActionSentence's default translator) for everything
 * that reads it so: the action's own title and description, which the
 * model reads in a turn's history, the conversation's PDF and Markdown
 * exports, and conversations saved before the words were.
 */

// A word of this module that goes into a sentence, translated with it.
export interface AIActionTerm {
  term: string;
  // Cased as the middle of a sentence is, in the reader's language.
  inSentence?: boolean | undefined;
}

// Sentences of this module, listed as the reader's language lists them.
export interface AIActionList {
  list: Array<AIActionSentence>;
}

/*
 * What fills a sentence's {{placeholder}}: data as written, a number, a
 * term, or a list.
 */
export type AIActionSentenceValue =
  | string
  | number
  | AIActionTerm
  | AIActionList;

export interface AIActionSentence {
  /*
   * The English template: one of AI_ACTION_SENTENCES, or the "other" form
   * of one of AI_ACTION_PLURAL_SENTENCES (with `count`).
   */
  template: string;
  // For a sentence that counts: the count, which picks its form.
  count?: number | undefined;
  values?: Record<string, AIActionSentenceValue> | undefined;
}

/*
 * An action's card: its title, and the sentences of the line under it
 * (what it names by name, what the prepare chose for the person).
 */
export interface AIActionWords {
  title: AIActionSentence;
  description?: Array<AIActionSentence> | undefined;
  /*
   * The arguments the title names by name - incidentId, once it says
   * "INC-42" - so the card's line of arguments need not repeat their IDs.
   */
  namedArguments?: Array<string> | undefined;
}

/*
 * ---------------------------------------------------------------------------
 * The titles. Each names what it acts on by the number or the name the
 * person knows it by - or, when the call names no record, says so.
 * ---------------------------------------------------------------------------
 */

export const AI_ACTION_TITLES: {
  createIncident: string;
  acknowledgeIncident: string;
  acknowledgeIncidentUnnamed: string;
  resolveIncident: string;
  resolveIncidentUnnamed: string;
  createAlert: string;
  acknowledgeAlert: string;
  acknowledgeAlertUnnamed: string;
  resolveAlert: string;
  resolveAlertUnnamed: string;
  linkIncident: string;
  linkThisIncident: string;
  linkAlert: string;
  linkThisAlert: string;
  pageOnCallPolicy: string;
  pageOnCallPolicyForIncident: string;
  pageOnCallPolicyUnnamed: string;
  runRunbook: string;
  runRunbookForIncident: string;
  runRunbookUnnamed: string;
  postIncidentStatusUpdate: string;
  postIncidentStatusUpdateUnnamed: string;
  changeIncidentSeverity: string;
  changeIncidentSeverityUnnamed: string;
  addIncidentNote: string;
  addIncidentNoteUnnamed: string;
  addAlertNote: string;
  addAlertNoteUnnamed: string;
  startIncidentInvestigation: string;
  startAlertInvestigation: string;
  startInvestigation: string;
  addSecurityCaseNote: string;
  addSecurityCaseNoteUnnamed: string;
  runSecurityPlaybook: string;
  runSecurityPlaybookUnnamed: string;
  openPullRequest: string;
} = {
  createIncident: translationKey("Create incident: {{title}}"),
  acknowledgeIncident: translationKey("Acknowledge incident {{incident}}"),
  acknowledgeIncidentUnnamed: translationKey("Acknowledge incident"),
  resolveIncident: translationKey("Resolve incident {{incident}}"),
  resolveIncidentUnnamed: translationKey("Resolve incident"),
  createAlert: translationKey("Create alert: {{title}}"),
  acknowledgeAlert: translationKey("Acknowledge alert {{alert}}"),
  acknowledgeAlertUnnamed: translationKey("Acknowledge alert"),
  resolveAlert: translationKey("Resolve alert {{alert}}"),
  resolveAlertUnnamed: translationKey("Resolve alert"),
  linkIncident: translationKey(
    "Link incident {{incident}} to affected resources",
  ),
  linkThisIncident: translationKey("Link this incident to affected resources"),
  linkAlert: translationKey("Link alert {{alert}} to affected resources"),
  linkThisAlert: translationKey("Link this alert to affected resources"),
  pageOnCallPolicy: translationKey("Page on-call policy {{policy}}"),
  /*
   * The incident a page or a run is for, by its number: without it, the
   * card's line of arguments showed the incident's ID.
   */
  pageOnCallPolicyForIncident: translationKey(
    "Page on-call policy {{policy}} for incident {{incident}}",
  ),
  pageOnCallPolicyUnnamed: translationKey("Page on-call policy"),
  runRunbook: translationKey("Run runbook {{runbook}}"),
  runRunbookForIncident: translationKey(
    "Run runbook {{runbook}} for incident {{incident}}",
  ),
  runRunbookUnnamed: translationKey("Run runbook"),
  postIncidentStatusUpdate: translationKey(
    "Post public status update on incident {{incident}}",
  ),
  postIncidentStatusUpdateUnnamed: translationKey(
    "Post public status update on incident",
  ),
  changeIncidentSeverity: translationKey(
    "Change incident {{incident}} severity to {{severity}}",
  ),
  changeIncidentSeverityUnnamed: translationKey("Change incident severity"),
  addIncidentNote: translationKey(
    "Add private internal note to incident {{incident}}",
  ),
  addIncidentNoteUnnamed: translationKey(
    "Add private internal note to incident",
  ),
  addAlertNote: translationKey("Add private internal note to alert {{alert}}"),
  addAlertNoteUnnamed: translationKey("Add private internal note to alert"),
  startIncidentInvestigation: translationKey(
    "Start AI investigation for incident {{incident}}",
  ),
  startAlertInvestigation: translationKey(
    "Start AI investigation for alert {{alert}}",
  ),
  startInvestigation: translationKey("Start AI investigation"),
  addSecurityCaseNote: translationKey(
    "Add a note to security case {{securityCase}}",
  ),
  addSecurityCaseNoteUnnamed: translationKey("Add a note to security case"),
  runSecurityPlaybook: translationKey(
    "Run playbook {{playbook}} on security case {{securityCase}}",
  ),
  runSecurityPlaybookUnnamed: translationKey(
    "Run a playbook on a security case",
  ),
  openPullRequest: translationKey("Open pull request: {{title}}"),
};

export const AI_ACTION_PLURAL_TITLES: {
  commitFiles: PluralTemplate;
} = {
  commitFiles: {
    one: translationKey("Commit {{count}} file to {{branch}}"),
    other: translationKey("Commit {{count}} files to {{branch}}"),
  },
};

/*
 * ---------------------------------------------------------------------------
 * The line under a title: what an action names, by name, and what its
 * prepare chose for the person (Server/Utils/AI/Toolbox/ToolTypes'
 * PreparedMutation).
 * ---------------------------------------------------------------------------
 */

export const AI_ACTION_LINES: {
  linkedTo: string;
  adds: string;
  someNotLinked: string;
  noneLinked: string;
  severity: string;
} = {
  // A new incident's or alert's resources: "Linked to host "test01"."
  linkedTo: translationKey("Linked to {{resources}}."),
  // What linking an existing one adds to what it lists already.
  adds: translationKey("Adds {{resources}}."),
  someNotLinked: translationKey(
    "Some of the other resources named will not be linked.",
  ),
  noneLinked: translationKey("The resources named will not be linked."),
  // The severity a new alert takes.
  severity: translationKey("Severity: {{severity}}."),
};

/*
 * One resource in a list: its kind, then its name in quotes - 'host
 * "test01"'. The name is written as a JSON string, so a name with a quote
 * in it can never read as two resources ('host "a" and host "b"'); the
 * template has no words of its own, so it takes the reader's words for
 * the kind in every language.
 */
export const AI_ACTION_RESOURCE_BY_NAME: string = "{{kind}} {{name}}";

/*
 * ---------------------------------------------------------------------------
 * Terms: words a sentence takes, translated with it.
 * ---------------------------------------------------------------------------
 */

export const AI_ACTION_TERMS: {
  untitled: string;
  aBranch: string;
} = {
  // What an incident, alert or pull request the call gave no title is called.
  untitled: translationKey("Untitled"),
  // The branch of a commit whose call names none.
  aBranch: translationKey("a branch"),
};

/*
 * ---------------------------------------------------------------------------
 * Every sentence and term a stored action may name.
 * ---------------------------------------------------------------------------
 */

export const AI_ACTION_SENTENCES: ReadonlyArray<string> = [
  ...Object.values(AI_ACTION_TITLES),
  ...Object.values(AI_ACTION_LINES),
  AI_ACTION_RESOURCE_BY_NAME,
];

export const AI_ACTION_PLURAL_SENTENCES: ReadonlyArray<PluralTemplate> = [
  ...Object.values(AI_ACTION_PLURAL_TITLES),
];

// The kinds of resource, by the nouns the server names them by.
export const AI_ACTION_RESOURCE_NOUNS: ReadonlyArray<string> =
  AI_AFFECTED_RESOURCE_KINDS.map((info: AiAffectedResourceKindInfo): string => {
    return info.noun;
  });

export const AI_ACTION_TERM_WORDS: ReadonlyArray<string> = [
  ...Object.values(AI_ACTION_TERMS),
  ...AI_ACTION_RESOURCE_NOUNS,
];

/*
 * ---------------------------------------------------------------------------
 * Building a sentence (the server's tools).
 * ---------------------------------------------------------------------------
 */

export function aiActionSentence(
  template: string,
  values?: Record<string, AIActionSentenceValue> | undefined,
): AIActionSentence {
  return values ? { template, values } : { template };
}

export function aiActionPluralSentence(
  template: PluralTemplate,
  count: number,
  values?: Record<string, AIActionSentenceValue> | undefined,
): AIActionSentence {
  return {
    template: template.other,
    count,
    ...(values ? { values } : {}),
  };
}

export function aiActionTerm(
  term: string,
  options?: { inSentence?: boolean | undefined } | undefined,
): AIActionTerm {
  return options?.inSentence ? { term, inSentence: true } : { term };
}

export function aiActionList(list: Array<AIActionSentence>): AIActionList {
  return { list };
}

/*
 * One resource in a list, by its kind's noun and its name: 'host
 * "test01"' (AI_ACTION_RESOURCE_BY_NAME).
 */
export function aiActionResourceByName(data: {
  noun: string;
  name: string;
}): AIActionSentence {
  return aiActionSentence(AI_ACTION_RESOURCE_BY_NAME, {
    kind: aiActionTerm(data.noun, { inSentence: true }),
    name: JSON.stringify(data.name),
  });
}

/*
 * ---------------------------------------------------------------------------
 * Reading a stored sentence (the Dashboard).
 * ---------------------------------------------------------------------------
 */

// How deep a list may hold lists: a list of resources is one level.
const MAX_SENTENCE_DEPTH: number = 3;

// The most items a stored list may hold, and the most values a sentence may.
const MAX_LIST_ITEMS: number = 100;
const MAX_SENTENCE_VALUES: number = 10;

const isPlainObject: (value: unknown) => value is Record<string, unknown> = (
  value: unknown,
): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

export function isAIActionTerm(value: unknown): value is AIActionTerm {
  return isPlainObject(value) && typeof value["term"] === "string";
}

export function isAIActionList(value: unknown): value is AIActionList {
  return isPlainObject(value) && Array.isArray(value["list"]);
}

// The plural template whose "other" form is `template`, if it is one.
export function getAIActionPluralTemplate(
  template: string,
): PluralTemplate | undefined {
  return AI_ACTION_PLURAL_SENTENCES.find((plural: PluralTemplate): boolean => {
    return plural.other === template;
  });
}

const isKnownValue: (value: unknown, depth: number) => boolean = (
  value: unknown,
  depth: number,
): boolean => {
  if (typeof value === "string") {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (isAIActionTerm(value)) {
    return (
      AI_ACTION_TERM_WORDS.includes(value.term) &&
      (value.inSentence === undefined || typeof value.inSentence === "boolean")
    );
  }

  if (isAIActionList(value)) {
    return (
      depth < MAX_SENTENCE_DEPTH &&
      value.list.length <= MAX_LIST_ITEMS &&
      value.list.every((item: unknown): boolean => {
        return isKnownSentence(item, depth + 1);
      })
    );
  }

  return false;
};

const isKnownSentence: (value: unknown, depth: number) => boolean = (
  value: unknown,
  depth: number,
): boolean => {
  if (!isPlainObject(value) || typeof value["template"] !== "string") {
    return false;
  }

  const template: string = value["template"];
  const isPlural: boolean = getAIActionPluralTemplate(template) !== undefined;

  if (!isPlural && !AI_ACTION_SENTENCES.includes(template)) {
    return false;
  }

  // A plural sentence counts; any other sentence does not.
  const count: unknown = value["count"];

  if (
    isPlural
      ? typeof count !== "number" || !Number.isFinite(count)
      : count !== undefined
  ) {
    return false;
  }

  const values: unknown = value["values"];

  if (values === undefined) {
    return true;
  }

  return (
    isPlainObject(values) &&
    Object.keys(values).length <= MAX_SENTENCE_VALUES &&
    Object.keys(values).every((name: string): boolean => {
      return isKnownValue(values[name], depth);
    })
  );
};

/*
 * Whether a stored sentence is one of this module's, filled with values it
 * can say: only then does the Dashboard word it in the reader's language.
 * A stored action is read from a conversation's saved JSON, so anything
 * else - another template, a value of another shape - reads as the
 * English the action stores.
 */
export function isKnownAIActionSentence(
  value: unknown,
): value is AIActionSentence {
  return isKnownSentence(value, 0);
}

export function isKnownAIActionWords(value: unknown): value is AIActionWords {
  if (!isPlainObject(value) || !isKnownAIActionSentence(value["title"])) {
    return false;
  }

  const description: unknown = value["description"];
  const namedArguments: unknown = value["namedArguments"];

  return (
    (description === undefined ||
      (Array.isArray(description) &&
        description.length <= MAX_SENTENCE_VALUES &&
        description.every((sentence: unknown): boolean => {
          return isKnownAIActionSentence(sentence);
        }))) &&
    (namedArguments === undefined ||
      (Array.isArray(namedArguments) &&
        namedArguments.length <= MAX_SENTENCE_VALUES &&
        namedArguments.every((name: unknown): boolean => {
          return typeof name === "string";
        })))
  );
}

// The translator the server writes its sentences with: English, as written.
let englishTranslator: Translator | null = null;

const getEnglishTranslator: () => Translator = (): Translator => {
  if (!englishTranslator) {
    englishTranslator = createTranslator(undefined, DEFAULT_LANGUAGE);
  }

  return englishTranslator;
};

const toTemplateValues: (
  values: Record<string, AIActionSentenceValue> | undefined,
  options: SentenceOptions | undefined,
) => TemplateValues = (
  values: Record<string, AIActionSentenceValue> | undefined,
  options: SentenceOptions | undefined,
): TemplateValues => {
  const result: TemplateValues = {};

  for (const name of Object.keys(values || {})) {
    const value: AIActionSentenceValue = values![name]!;

    if (typeof value === "string" || typeof value === "number") {
      result[name] = value;
    } else if (isAIActionTerm(value)) {
      result[name] = translatableTerm(value.term, {
        inSentence: value.inSentence === true,
      });
    } else if (isAIActionList(value)) {
      const list: Array<AIActionSentence> = value.list;

      // Each item in the sentence's language, joined as it joins a list.
      result[name] = composedValue((sentenceTranslator: Translator): string => {
        return formatList(
          list.map((item: AIActionSentence): string => {
            return describeAIActionSentence(item, sentenceTranslator, options);
          }),
          sentenceTranslator,
        );
      });
    }
  }

  return result;
};

/*
 * A sentence in the translator's language: the reader's on the Dashboard
 * (with setsValuesApart, so a value in Latin letters keeps its place in a
 * Persian sentence), English on the server and by default. A template that
 * is none of this module's is filled as written, never looked up.
 */
export function describeAIActionSentence(
  sentence: AIActionSentence,
  translator: Translator = getEnglishTranslator(),
  options?: SentenceOptions | undefined,
): string {
  const values: TemplateValues = toTemplateValues(sentence.values, options);
  const plural: PluralTemplate | undefined = getAIActionPluralTemplate(
    sentence.template,
  );

  if (plural) {
    return translator.translatePlural(
      plural,
      sentence.count ?? 0,
      values,
      options,
    );
  }

  if (!AI_ACTION_SENTENCES.includes(sentence.template)) {
    return fillTemplate(sentence.template, values);
  }

  return translator.translateTemplate(sentence.template, values, options);
}

// The language a sentence is drawn in: the reader's when it words it.
export function getAIActionSentenceLanguage(
  sentence: AIActionSentence,
  translator: Translator,
): string {
  const plural: PluralTemplate | undefined = getAIActionPluralTemplate(
    sentence.template,
  );

  return getSentenceLanguage(translator, plural || sentence.template);
}

// Which way a sentence is read once drawn in the translator's language.
export function getAIActionSentenceDirection(
  sentence: AIActionSentence,
  translator: Translator,
): ReadingDirection {
  return getReadingDirection(getAIActionSentenceLanguage(sentence, translator));
}

// A full stop that needs no space after it: Chinese and Japanese.
const FULL_WIDTH_SENTENCE_ENDS: ReadonlyArray<string> = ["。", "！", "？"];

/*
 * What goes between a sentence and the next in a line: a space, but none
 * after a Chinese or Japanese full stop - and nothing before the first.
 */
export function getAIActionSentenceSeparator(previous: string): string {
  if (!previous) {
    return "";
  }

  return FULL_WIDTH_SENTENCE_ENDS.some((end: string): boolean => {
    return previous.endsWith(end);
  })
    ? ""
    : " ";
}

// Sentences one after another, as a line reads them.
export function joinAIActionSentences(texts: Array<string>): string {
  let joined: string = "";

  for (const text of texts) {
    if (text) {
      joined = `${joined}${getAIActionSentenceSeparator(joined)}${text}`;
    }
  }

  return joined;
}

/*
 * A card's title and line, in the translator's language - English, as the
 * action stores them for the model and the exports, by default. No line
 * when the card has none.
 */
export function describeAIActionWords(
  words: AIActionWords,
  translator: Translator = getEnglishTranslator(),
): { title: string; description?: string | undefined } {
  const description: string = joinAIActionSentences(
    (words.description || []).map((sentence: AIActionSentence): string => {
      return describeAIActionSentence(sentence, translator);
    }),
  );

  return {
    title: describeAIActionSentence(words.title, translator),
    ...(description ? { description } : {}),
  };
}

/*
 * The data a sentence shows itself - the title it quotes, the number it
 * names - so a line listing the action's arguments need not repeat it.
 */
export function getAIActionSentenceShownValues(
  sentence: AIActionSentence,
): Array<string> {
  const shown: Array<string> = [];

  for (const value of Object.values(sentence.values || {})) {
    if (typeof value === "string" && value.trim()) {
      shown.push(value.trim());
    }
  }

  return shown;
}
