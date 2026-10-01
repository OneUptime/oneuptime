import ComponentMetadata from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import { DatabaseOperation } from "../../../../Types/Workflow/DatabaseOperation";
import {
  PickerCatalog,
  PickerResource,
  getComponentOperation,
  getOperationRank,
  isResourceComponent,
} from "./PickerCatalog";

/*
 * Search for the Add Component and Add Trigger pickers. Pure and React-free,
 * so the ranking can be tested on its own and over the real catalog.
 *
 * What it has to get right, in the words of the people using it:
 *
 *   - Every word typed counts, in any order and any field. "create monitor"
 *     finds "Create One Monitor" although that is not a substring of it.
 *   - The resource you named comes first. "incident" lists Incident's steps
 *     before Incident State's, and "create incident" puts Create One Incident
 *     first. The old picker drew its results group by group in the order the
 *     models are registered, which put Incident State above Incident whatever
 *     the scores said.
 *   - Plurals, a typo, and the words people actually use: "incidents",
 *     "incidnet", "add note", "http request", "wait".
 *   - It is fast. The index is built once per catalog; a search scans a few
 *     thousand distinct words and then scores each step against them, a few
 *     milliseconds over the full catalog of about two thousand steps.
 */

// How a typed word matched a word of the catalog, best first.
export enum WordMatchKind {
  Exact = "Exact",
  // The same word in another number: "incidents" and "incident".
  Variant = "Variant",
  // What has been typed so far of a longer word: "inc" and "incident".
  Prefix = "Prefix",
  // Inside a longer word: "script" in "javascript".
  Substring = "Substring",
  // A typo, tried only for a word that matches nothing otherwise.
  Fuzzy = "Fuzzy",
}

export const WORD_MATCH_QUALITY: Readonly<Record<WordMatchKind, number>> = {
  [WordMatchKind.Exact]: 1,
  [WordMatchKind.Variant]: 0.95,
  [WordMatchKind.Prefix]: 0.8,
  [WordMatchKind.Fuzzy]: 0.6,
  [WordMatchKind.Substring]: 0.45,
};

// Where in a step a word was found, and how much a match there counts.
export enum SearchField {
  Title = "Title",
  Resource = "Resource",
  Category = "Category",
  Keyword = "Keyword",
  Description = "Description",
}

export const SEARCH_FIELD_WEIGHT: Readonly<Record<SearchField, number>> = {
  [SearchField.Title]: 1,
  [SearchField.Resource]: 1,
  [SearchField.Category]: 0.7,
  [SearchField.Keyword]: 0.7,
  [SearchField.Description]: 0.35,
};

/*
 * How a step that matched every word ranks, best first. Within a tier the
 * score decides.
 */
export enum SearchTier {
  // The search is the step's whole title: "log", "if else".
  ExactTitle = 0,
  /*
   * Every word landed in the step's name, resource, category or keywords,
   * and the step is hand-written or the resource is the one named in full:
   * "incident" for Incident's steps, not for Incident State's.
   */
  Named = 1,
  // Every word landed in the step's name, resource, category or keywords.
  Related = 2,
  // Some word was found only in the description.
  Mentioned = 3,
}

const SCORE_PER_WORD: number = 100;
const BUILT_IN_BONUS: number = 30;
const POPULAR_BONUS: number = 20;
const COMMON_RESOURCE_BONUS: number = 30;
// For each word of a resource's name the search did not mention.
const UNNAMED_RESOURCE_WORD_PENALTY: number = 25;

const MIN_SUBSTRING_LENGTH: number = 3;
const MIN_FUZZY_LENGTH: number = 4;
// A pasted sentence is still a search, just a bounded one.
const MAX_SEARCH_WORDS: number = 8;

/*
 * Words that say nothing about which step is meant: "send a message to
 * slack", "when an incident is created". Dropped from a search unless they
 * are all it holds. "on" is not one of them: it is half of "on-call", and
 * every generated trigger starts with it.
 */
const STOP_WORDS: ReadonlySet<string> = new Set<string>([
  "a",
  "an",
  "and",
  "are",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "my",
  "of",
  "the",
  "then",
  "to",
  "when",
  "with",
]);

/*
 * The words people type for a step that are not in its name. Kept to words
 * that mean that step and nothing else here: "create" on API Post would put
 * it above every Create One step.
 */
const HTTP_KEYWORDS: ReadonlyArray<string> = [
  "http",
  "https",
  "rest",
  "request",
  "call",
  "url",
  "endpoint",
  "integration",
];

const MESSAGE_KEYWORDS: ReadonlyArray<string> = [
  "message",
  "chat",
  "notify",
  "notification",
  "channel",
];

export const COMPONENT_KEYWORDS: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  [ComponentID.Log]: ["print", "console", "debug", "output", "write"],
  [ComponentID.IfElse]: [
    "condition",
    "conditional",
    "branch",
    "compare",
    "comparison",
    "check",
    "filter",
    "switch",
  ],
  [ComponentID.ApiGet]: [...HTTP_KEYWORDS, "fetch", "read", "download"],
  [ComponentID.ApiPost]: [...HTTP_KEYWORDS, "webhook", "send", "submit"],
  [ComponentID.ApiPut]: [...HTTP_KEYWORDS, "replace"],
  [ComponentID.ApiPatch]: [...HTTP_KEYWORDS, "modify"],
  [ComponentID.ApiDelete]: [...HTTP_KEYWORDS, "remove"],
  [ComponentID.SlackSendMessageToChannel]: [...MESSAGE_KEYWORDS, "post"],
  [ComponentID.MicrosoftTeamsSendMessageToChannel]: [
    ...MESSAGE_KEYWORDS,
    "microsoft",
    "msteams",
  ],
  [ComponentID.DiscordSendMessageToChannel]: [...MESSAGE_KEYWORDS],
  [ComponentID.TelegramSendMessageToChat]: [...MESSAGE_KEYWORDS, "bot"],
  [ComponentID.SendEmail]: [
    "mail",
    "smtp",
    "inbox",
    "notify",
    "notification",
    "message",
  ],
  [ComponentID.JavaScriptCode]: [
    "code",
    "script",
    "js",
    "javascript",
    "function",
    "transform",
    "program",
  ],
  [ComponentID.JsonToText]: ["stringify", "serialize", "convert", "string"],
  [ComponentID.TextToJson]: ["parse", "deserialize", "convert", "string"],
  [ComponentID.MergeJson]: ["combine", "join", "object"],
  [ComponentID.Sleep]: ["wait", "delay", "pause", "timer", "later"],
  [ComponentID.WorkflowRun]: [
    "run",
    "call",
    "start",
    "trigger",
    "invoke",
    "subworkflow",
    "another",
    "chain",
  ],
  [ComponentID.AIGenerateText]: [
    "llm",
    "gpt",
    "chatgpt",
    "openai",
    "anthropic",
    "claude",
    "prompt",
    "summarize",
    "summary",
    "write",
  ],
  [ComponentID.Schedule]: [
    "cron",
    "interval",
    "every",
    "recurring",
    "periodic",
    "timer",
    "hourly",
    "daily",
    "weekly",
    "time",
  ],
  [ComponentID.Webhook]: [
    "http",
    "url",
    "incoming",
    "receive",
    "callback",
    "endpoint",
    "request",
    "api",
  ],
  [ComponentID.Manual]: ["button", "run", "now", "test", "hand", "demand"],
};

const MANY_KEYWORDS: ReadonlyArray<string> = [
  "all",
  "bulk",
  "multiple",
  "several",
];

export const OPERATION_KEYWORDS: Readonly<
  Record<DatabaseOperation, ReadonlyArray<string>>
> = {
  [DatabaseOperation.CreateOne]: [
    "add",
    "new",
    "insert",
    "make",
    "open",
    "raise",
    "declare",
  ],
  [DatabaseOperation.CreateMany]: [
    "add",
    "new",
    "insert",
    "make",
    ...MANY_KEYWORDS,
  ],
  [DatabaseOperation.FindOne]: [
    "get",
    "read",
    "fetch",
    "search",
    "query",
    "lookup",
    "load",
    "retrieve",
  ],
  [DatabaseOperation.FindMany]: [
    "get",
    "read",
    "fetch",
    "list",
    "search",
    "query",
    "lookup",
    "load",
    "retrieve",
    ...MANY_KEYWORDS,
  ],
  [DatabaseOperation.UpdateOne]: [
    "edit",
    "change",
    "modify",
    "set",
    "save",
    "resolve",
    "acknowledge",
    "assign",
    "close",
  ],
  [DatabaseOperation.UpdateMany]: [
    "edit",
    "change",
    "modify",
    "set",
    "save",
    ...MANY_KEYWORDS,
  ],
  [DatabaseOperation.DeleteOne]: ["remove", "destroy", "erase"],
  [DatabaseOperation.DeleteMany]: [
    "remove",
    "destroy",
    "erase",
    "purge",
    ...MANY_KEYWORDS,
  ],
  [DatabaseOperation.OnCreate]: [
    "created",
    "new",
    "added",
    "opened",
    "raised",
    "declared",
  ],
  [DatabaseOperation.OnUpdate]: [
    "updated",
    "changed",
    "change",
    "edited",
    "modified",
    "resolved",
    "acknowledged",
    "status",
  ],
  [DatabaseOperation.OnDelete]: ["deleted", "removed"],
};

export type GetSearchWordsFunction = (text: string) => Array<string>;

/*
 * The words of a piece of text, lower case, without accents or punctuation:
 * "On-Call Policy" is "on", "call", "policy" and "If / Else" is "if", "else".
 */
export const getSearchWords: GetSearchWordsFunction = (
  text: string,
): Array<string> => {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word: string): boolean => {
      return word.length > 0;
    });
};

export type GetSearchTokensFunction = (search: string) => Array<string>;

/*
 * The words a search is matched on: its words without the stop words (unless
 * nothing else was typed), each once, and at most MAX_SEARCH_WORDS of them.
 * Empty when nothing searchable was typed.
 */
export const getSearchTokens: GetSearchTokensFunction = (
  search: string,
): Array<string> => {
  const words: Array<string> = getSearchWords(search);
  const meaningful: Array<string> = words.filter((word: string): boolean => {
    return !STOP_WORDS.has(word);
  });

  return Array.from(new Set(meaningful.length > 0 ? meaningful : words)).slice(
    0,
    MAX_SEARCH_WORDS,
  );
};

export type GetWordVariantsFunction = (word: string) => Array<string>;

/*
 * A word and the singulars it could be the plural of: "policies" is
 * "policy", "statuses" is "status", "incidents" is "incident". Comparing
 * these on both sides is what makes the number not matter, without a
 * dictionary.
 */
export const getWordVariants: GetWordVariantsFunction = (
  word: string,
): Array<string> => {
  const variants: Set<string> = new Set<string>([word]);

  if (word.length > 3) {
    if (word.endsWith("ies")) {
      variants.add(`${word.slice(0, -3)}y`);
    }

    if (word.endsWith("es")) {
      variants.add(word.slice(0, -2));
    }

    if (word.endsWith("s") && !word.endsWith("ss")) {
      variants.add(word.slice(0, -1));
    }
  }

  return Array.from(variants);
};

export type GetEditDistanceFunction = (
  a: string,
  b: string,
  maxDistance: number,
) => number;

/*
 * Edits between two words - insert, delete, replace, or swap two letters
 * side by side ("incidnet") - stopping early once it is past maxDistance,
 * when it returns maxDistance + 1.
 */
export const getEditDistance: GetEditDistanceFunction = (
  a: string,
  b: string,
  maxDistance: number,
): number => {
  if (Math.abs(a.length - b.length) > maxDistance) {
    return maxDistance + 1;
  }

  const columns: number = b.length + 1;
  let previousPrevious: Array<number> = new Array<number>(columns).fill(0);
  let previous: Array<number> = new Array<number>(columns);
  let current: Array<number> = new Array<number>(columns);

  for (let j: number = 0; j < columns; j++) {
    previous[j] = j;
  }

  for (let i: number = 1; i <= a.length; i++) {
    current[0] = i;
    let rowMinimum: number = current[0]!;

    for (let j: number = 1; j < columns; j++) {
      const cost: number = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      let value: number = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + cost,
      );

      if (
        i > 1 &&
        j > 1 &&
        a.charAt(i - 1) === b.charAt(j - 2) &&
        a.charAt(i - 2) === b.charAt(j - 1)
      ) {
        value = Math.min(value, previousPrevious[j - 2]! + 1);
      }

      current[j] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }

    if (rowMinimum > maxDistance) {
      return maxDistance + 1;
    }

    const recycled: Array<number> = previousPrevious;
    previousPrevious = previous;
    previous = current;
    current = recycled;
  }

  return Math.min(previous[b.length]!, maxDistance + 1);
};

export type GetMaxTypoDistanceFunction = (word: string) => number;

// How many typos a word of this length may carry and still be recognised.
export const getMaxTypoDistance: GetMaxTypoDistanceFunction = (
  word: string,
): number => {
  if (word.length >= 8) {
    return 2;
  }

  if (word.length >= MIN_FUZZY_LENGTH) {
    return 1;
  }

  return 0;
};

export type MatchWordFunction = (
  token: string,
  word: string,
  tokenVariants?: Array<string>,
  wordVariants?: Array<string>,
) => WordMatchKind | null;

/*
 * How a typed word matches one word of the catalog, without typos: those are
 * only looked for when nothing else matches (see searchComponents). The
 * variants can be passed in when the caller has them already.
 */
export const matchWord: MatchWordFunction = (
  token: string,
  word: string,
  tokenVariants: Array<string> = getWordVariants(token),
  wordVariants: Array<string> = getWordVariants(word),
): WordMatchKind | null => {
  if (token === word) {
    return WordMatchKind.Exact;
  }

  if (
    tokenVariants.some((variant: string): boolean => {
      return wordVariants.includes(variant);
    })
  ) {
    return WordMatchKind.Variant;
  }

  if (word.startsWith(token)) {
    return WordMatchKind.Prefix;
  }

  if (token.length >= MIN_SUBSTRING_LENGTH && word.includes(token)) {
    return WordMatchKind.Substring;
  }

  return null;
};

export type MatchWordWithTypoFunction = (
  token: string,
  word: string,
) => boolean;

/*
 * A typo of the whole word ("incidnet"), or of what has been typed of it so
 * far ("incidne" for "inciden...").
 */
export const matchWordWithTypo: MatchWordWithTypoFunction = (
  token: string,
  word: string,
): boolean => {
  const maxDistance: number = getMaxTypoDistance(token);

  if (maxDistance === 0) {
    return false;
  }

  if (getEditDistance(token, word, maxDistance) <= maxDistance) {
    return true;
  }

  return (
    word.length > token.length &&
    getEditDistance(token, word.slice(0, token.length), maxDistance) <=
      maxDistance
  );
};

// A word of a step, and how much a match on it counts.
interface IndexedTerm {
  wordId: number;
  weight: number;
}

/*
 * A catalog word that names one word of a resource's name when a typed word
 * of at least minTokenLength letters matches it: the word itself, a pair it
 * is part of ("oncall" names "on" and "call") or the name's initials ("slo").
 * A pair names its second word only when what was typed reaches into it, so
 * "incident" names the "incident" of "incidentepisode" but not the
 * "episode".
 */
interface CoveringWord {
  wordId: number;
  minTokenLength: number;
}

interface IndexedComponent {
  component: ComponentMetadata;
  terms: Array<IndexedTerm>;
  // The title's words, joined by single spaces.
  titleKey: string;
  // For a database step, the words that name each word of its resource.
  resourceWords: Array<Array<CoveringWord>> | null;
  isBuiltIn: boolean;
  popularRank: number;
  commonRank: number;
  // Position in A to Z order: resource, then operation, then title.
  alphabeticalRank: number;
}

export interface ComponentSearchIndex {
  entries: Array<IndexedComponent>;
  // Every distinct word of the catalog; a word's id is its position here.
  words: Array<string>;
  // getWordVariants of each word, worked out once.
  wordVariants: Array<Array<string>>;
  /*
   * 1 for a word that only matches when typed in full: a resource's
   * initials. "if" is not the start of "iflr" (IoT Fleet Label Rule).
   */
  exactOnly: Uint8Array;
}

type WordIdFunction = (word: string) => number;

interface SortKey {
  key: string;
  componentMetadata: ComponentMetadata;
}

type CompoundsOfFunction = (words: Array<string>) => Array<string>;

// Neighbouring words run together: "on call policy" -> "oncall", "callpolicy".
const compoundsOf: CompoundsOfFunction = (
  words: Array<string>,
): Array<string> => {
  const compounds: Array<string> = [];

  for (let i: number = 0; i + 1 < words.length; i++) {
    compounds.push(`${words[i]}${words[i + 1]}`);
  }

  return compounds;
};

type SplitTitleFunction = (title: string) => {
  main: string;
  qualifier: string;
};

/*
 * A title's words in parentheses qualify it rather than name it: "API Post
 * (JSON)" is an API step that speaks JSON, and a search for "json" means the
 * JSON steps first.
 */
const splitTitle: SplitTitleFunction = (
  title: string,
): { main: string; qualifier: string } => {
  const qualifiers: Array<string> = [];
  const main: string = title.replace(
    /\(([^)]*)\)/g,
    (_match: string, inner: string): string => {
      qualifiers.push(inner);
      return " ";
    },
  );

  return { main: main, qualifier: qualifiers.join(" ") };
};

type InitialsOfFunction = (words: Array<string>) => string | null;

// "service level objective" -> "slo". Only for three words or more.
const initialsOf: InitialsOfFunction = (
  words: Array<string>,
): string | null => {
  if (words.length < 3) {
    return null;
  }

  return words
    .map((word: string): string => {
      return word.charAt(0);
    })
    .join("");
};

export type BuildComponentSearchIndexFunction = (
  catalog: PickerCatalog,
) => ComponentSearchIndex;

export const buildComponentSearchIndex: BuildComponentSearchIndexFunction = (
  catalog: PickerCatalog,
): ComponentSearchIndex => {
  const words: Array<string> = [];
  const idsByWord: Map<string, number> = new Map();
  const initialsIds: Set<number> = new Set();
  const plainWordIds: Set<number> = new Set();

  const wordId: WordIdFunction = (word: string): number => {
    let id: number | undefined = idsByWord.get(word);

    if (id === undefined) {
      id = words.length;
      words.push(word);
      idsByWord.set(word, id);
    }

    return id;
  };

  const resourceByKey: Map<string, PickerResource> = catalog.resourcesByKey;

  /*
   * A to Z by resource, then operation, then title, as one plain string
   * compare: localeCompare over a few thousand steps costs a visible pause
   * on a slow machine, every time the picker opens.
   */
  const sortKeys: Array<SortKey> = catalog.components.map(
    (componentMetadata: ComponentMetadata): SortKey => {
      const resource: string = componentMetadata.tableName
        ? componentMetadata.category.toLowerCase()
        : "";
      const operationRank: string = String(
        getOperationRank(getComponentOperation(componentMetadata)),
      ).padStart(2, "0");

      return {
        key: [
          resource,
          operationRank,
          componentMetadata.title.toLowerCase(),
        ].join("\u0000"),
        componentMetadata: componentMetadata,
      };
    },
  );

  sortKeys.sort((a: SortKey, b: SortKey): number => {
    if (a.key === b.key) {
      return 0;
    }

    return a.key < b.key ? -1 : 1;
  });

  const alphabeticalRankByComponent: Map<ComponentMetadata, number> = new Map();

  sortKeys.forEach((item: SortKey, rank: number) => {
    alphabeticalRankByComponent.set(item.componentMetadata, rank);
  });

  const entries: Array<IndexedComponent> = catalog.components.map(
    (componentMetadata: ComponentMetadata): IndexedComponent => {
      const weightsByWordId: Map<number, number> = new Map();

      const addWords: (
        list: Array<string>,
        field: SearchField,
        isInitials?: boolean,
      ) => void = (
        list: Array<string>,
        field: SearchField,
        isInitials?: boolean,
      ): void => {
        const weight: number = SEARCH_FIELD_WEIGHT[field];

        for (const word of list) {
          const id: number = wordId(word);
          weightsByWordId.set(
            id,
            Math.max(weightsByWordId.get(id) || 0, weight),
          );

          if (isInitials) {
            initialsIds.add(id);
          } else {
            plainWordIds.add(id);
          }
        }
      };

      const titleWords: Array<string> = getSearchWords(componentMetadata.title);
      const titleParts: { main: string; qualifier: string } = splitTitle(
        componentMetadata.title,
      );
      const mainTitleWords: Array<string> = getSearchWords(titleParts.main);
      const isBuiltIn: boolean = !isResourceComponent(componentMetadata);
      const operation: DatabaseOperation | null =
        getComponentOperation(componentMetadata);

      addWords(mainTitleWords, SearchField.Title);
      addWords(getSearchWords(titleParts.qualifier), SearchField.Category);
      addWords(
        getSearchWords(componentMetadata.description),
        SearchField.Description,
      );
      addWords(
        [...(COMPONENT_KEYWORDS[componentMetadata.id] || [])],
        SearchField.Keyword,
      );

      if (operation) {
        addWords([...OPERATION_KEYWORDS[operation]], SearchField.Keyword);
      }

      let resourceWords: Array<Array<CoveringWord>> | null = null;

      if (isBuiltIn) {
        addWords(compoundsOf(mainTitleWords), SearchField.Title);
        addWords(
          getSearchWords(componentMetadata.category),
          SearchField.Category,
        );
      } else {
        const nameWords: Array<string> = getSearchWords(
          componentMetadata.category,
        );
        const compounds: Array<string> = compoundsOf(nameWords);
        const initials: string | null = initialsOf(nameWords);

        addWords(nameWords, SearchField.Resource);
        addWords(compounds, SearchField.Resource);

        if (initials) {
          addWords([initials], SearchField.Keyword, true);
        }

        resourceWords = nameWords.map(
          (word: string, index: number): Array<CoveringWord> => {
            const covering: Array<CoveringWord> = [
              { wordId: wordId(word), minTokenLength: 0 },
            ];

            /*
             * Two letters into the second word, not one: "incidents" runs on
             * into "incidentseverity", "incidentsla" and "incidentstate",
             * and its plural "s" names none of them.
             */
            if (index > 0) {
              covering.push({
                wordId: wordId(compounds[index - 1]!),
                minTokenLength: nameWords[index - 1]!.length + 2,
              });
            }

            if (index < compounds.length) {
              covering.push({
                wordId: wordId(compounds[index]!),
                minTokenLength: 0,
              });
            }

            if (initials) {
              covering.push({ wordId: wordId(initials), minTokenLength: 0 });
            }

            return covering;
          },
        );
      }

      const resource: PickerResource | undefined = componentMetadata.tableName
        ? resourceByKey.get(componentMetadata.tableName)
        : undefined;
      const popularRank: number | undefined = catalog.popularRankById.get(
        componentMetadata.id,
      );

      return {
        component: componentMetadata,
        terms: Array.from(weightsByWordId.entries()).map(
          ([id, weight]: [number, number]): IndexedTerm => {
            return { wordId: id, weight: weight };
          },
        ),
        titleKey: titleWords.join(" "),
        resourceWords: resourceWords,
        isBuiltIn: isBuiltIn,
        popularRank:
          popularRank === undefined ? Number.POSITIVE_INFINITY : popularRank,
        commonRank:
          resource && resource.commonRank !== null
            ? resource.commonRank
            : Number.POSITIVE_INFINITY,
        alphabeticalRank: alphabeticalRankByComponent.get(componentMetadata)!,
      };
    },
  );

  const exactOnly: Uint8Array = new Uint8Array(words.length);

  for (const id of initialsIds) {
    if (!plainWordIds.has(id)) {
      exactOnly[id] = 1;
    }
  }

  return {
    entries: entries,
    words: words,
    wordVariants: words.map((word: string): Array<string> => {
      return getWordVariants(word);
    }),
    exactOnly: exactOnly,
  };
};

export interface ComponentSearchResult {
  component: ComponentMetadata;
  tier: SearchTier;
  score: number;
}

export interface ComponentSearchOutcome {
  // The words the search was matched on (see getSearchTokens).
  tokens: Array<string>;
  // Those of them read as typos, because they match nothing as typed.
  typoTokens: Array<string>;
  // Every step that matched every word, best first.
  results: Array<ComponentSearchResult>;
}

// Per typed word: how well it matches each catalog word, by word id.
interface TokenMatches {
  quality: Float32Array;
  // Whether a match on the word id names it (anything but a substring).
  names: Uint8Array;
  isTypo: boolean;
  tokenLength: number;
}

type MatchTokenFunction = (
  token: string,
  index: ComponentSearchIndex,
) => TokenMatches;

const matchToken: MatchTokenFunction = (
  token: string,
  index: ComponentSearchIndex,
): TokenMatches => {
  const words: Array<string> = index.words;
  const quality: Float32Array = new Float32Array(words.length);
  const names: Uint8Array = new Uint8Array(words.length);
  const tokenVariants: Array<string> = getWordVariants(token);
  let found: boolean = false;

  for (let id: number = 0; id < words.length; id++) {
    if (index.exactOnly[id] === 1) {
      if (words[id] === token) {
        quality[id] = WORD_MATCH_QUALITY[WordMatchKind.Exact];
        names[id] = 1;
        found = true;
      }

      continue;
    }

    const kind: WordMatchKind | null = matchWord(
      token,
      words[id]!,
      tokenVariants,
      index.wordVariants[id]!,
    );

    if (kind) {
      quality[id] = WORD_MATCH_QUALITY[kind];
      names[id] = kind === WordMatchKind.Substring ? 0 : 1;
      found = true;
    }
  }

  /*
   * Typos only for a word that matches nothing as typed. Otherwise "host"
   * would also find "post", and a search would widen as it was spelled out.
   */
  if (!found) {
    for (let id: number = 0; id < words.length; id++) {
      if (index.exactOnly[id] !== 1 && matchWordWithTypo(token, words[id]!)) {
        quality[id] = WORD_MATCH_QUALITY[WordMatchKind.Fuzzy];
        names[id] = 1;
      }
    }
  }

  return {
    quality: quality,
    names: names,
    isTypo: !found,
    tokenLength: token.length,
  };
};

export type SearchComponentsFunction = (
  index: ComponentSearchIndex,
  search: string,
) => ComponentSearchOutcome;

export const searchComponents: SearchComponentsFunction = (
  index: ComponentSearchIndex,
  search: string,
): ComponentSearchOutcome => {
  const tokens: Array<string> = getSearchTokens(search);

  if (tokens.length === 0) {
    return { tokens: tokens, typoTokens: [], results: [] };
  }

  const searchKey: string = getSearchWords(search).join(" ");
  const matches: Array<TokenMatches> = tokens.map(
    (token: string): TokenMatches => {
      return matchToken(token, index);
    },
  );

  // A match anywhere but the description names the step.
  const descriptionWeight: number =
    SEARCH_FIELD_WEIGHT[SearchField.Description];
  const scored: Array<{
    entry: IndexedComponent;
    result: ComponentSearchResult;
  }> = [];

  for (const entry of index.entries) {
    let total: number = 0;
    let everyWordNamed: boolean = true;
    let matchedAll: boolean = true;

    for (const tokenMatches of matches) {
      let best: number = 0;
      let named: boolean = false;

      for (const term of entry.terms) {
        const quality: number = tokenMatches.quality[term.wordId]!;

        if (quality === 0) {
          continue;
        }

        const value: number = quality * term.weight;

        if (value > best) {
          best = value;
        }

        if (term.weight > descriptionWeight) {
          named = true;
        }
      }

      if (best === 0) {
        matchedAll = false;
        break;
      }

      total += best;
      everyWordNamed = everyWordNamed && named;
    }

    if (!matchedAll) {
      continue;
    }

    let score: number = total * SCORE_PER_WORD;
    let resourceNamedInFull: boolean = false;

    if (entry.resourceWords) {
      let named: number = 0;

      for (const covering of entry.resourceWords) {
        const isNamed: boolean = matches.some(
          (tokenMatches: TokenMatches): boolean => {
            return covering.some((word: CoveringWord): boolean => {
              return (
                tokenMatches.names[word.wordId] === 1 &&
                tokenMatches.tokenLength >= word.minTokenLength
              );
            });
          },
        );

        if (isNamed) {
          named++;
        }
      }

      const unnamed: number = entry.resourceWords.length - named;
      resourceNamedInFull = named > 0 && unnamed === 0;

      // Closer resources first: Incident Feed before Incident Episode Feed.
      if (named > 0) {
        score -= unnamed * UNNAMED_RESOURCE_WORD_PENALTY;
      }
    }

    if (entry.isBuiltIn) {
      score += BUILT_IN_BONUS;
    }

    if (Number.isFinite(entry.popularRank)) {
      score += POPULAR_BONUS;
    }

    if (Number.isFinite(entry.commonRank)) {
      score += COMMON_RESOURCE_BONUS;
    }

    let tier: SearchTier = SearchTier.Mentioned;

    if (entry.titleKey === searchKey) {
      tier = SearchTier.ExactTitle;
    } else if (everyWordNamed && (entry.isBuiltIn || resourceNamedInFull)) {
      tier = SearchTier.Named;
    } else if (everyWordNamed) {
      tier = SearchTier.Related;
    }

    scored.push({
      entry: entry,
      result: { component: entry.component, tier: tier, score: score },
    });
  }

  scored.sort(
    (
      a: { entry: IndexedComponent; result: ComponentSearchResult },
      b: { entry: IndexedComponent; result: ComponentSearchResult },
    ): number => {
      return (
        a.result.tier - b.result.tier ||
        b.result.score - a.result.score ||
        compareRanks(a.entry.popularRank, b.entry.popularRank) ||
        Number(b.entry.isBuiltIn) - Number(a.entry.isBuiltIn) ||
        compareRanks(a.entry.commonRank, b.entry.commonRank) ||
        a.entry.alphabeticalRank - b.entry.alphabeticalRank
      );
    },
  );

  return {
    tokens: tokens,
    typoTokens: tokens.filter((_token: string, i: number): boolean => {
      return matches[i]!.isTypo;
    }),
    results: scored.map(
      (item: {
        entry: IndexedComponent;
        result: ComponentSearchResult;
      }): ComponentSearchResult => {
        return item.result;
      },
    ),
  };
};

type CompareRanksFunction = (a: number, b: number) => number;

// Ranks that may be Infinity ("not ranked"), without Infinity - Infinity.
const compareRanks: CompareRanksFunction = (a: number, b: number): number => {
  if (a === b) {
    return 0;
  }

  return a < b ? -1 : 1;
};

export interface HighlightSegment {
  text: string;
  isMatch: boolean;
}

export type GetHighlightSegmentsFunction = (
  text: string,
  tokens: Array<string>,
  typoTokens?: Array<string>,
) => Array<HighlightSegment>;

/*
 * The parts of a title to mark for a search: a whole word it named, what has
 * been typed of a longer word, the typed letters inside one, or the word a
 * typo was read as (only for the typoTokens the search read that way).
 * Punctuation is never marked, and no part of the search is ever read as a
 * pattern.
 */
export const getHighlightSegments: GetHighlightSegmentsFunction = (
  text: string,
  tokens: Array<string>,
  typoTokens: Array<string> = [],
): Array<HighlightSegment> => {
  if (tokens.length === 0) {
    return [{ text: text, isMatch: false }];
  }

  const marked: Array<boolean> = new Array<boolean>(text.length).fill(false);
  const wordPattern: RegExp = /[\p{L}\p{N}]+/gu;
  let wordMatch: RegExpExecArray | null = wordPattern.exec(text);

  while (wordMatch) {
    const start: number = wordMatch.index;
    const original: string = wordMatch[0];
    // Same length as the original, so offsets carry over.
    const word: string = original.toLowerCase();

    for (const token of tokens) {
      const kind: WordMatchKind | null = matchWord(token, word);
      let from: number = -1;
      let to: number = -1;

      if (kind === WordMatchKind.Exact || kind === WordMatchKind.Variant) {
        from = 0;
        to = word.length;
      } else if (kind === WordMatchKind.Prefix) {
        from = 0;
        to = token.length;
      } else if (kind === WordMatchKind.Substring) {
        from = word.indexOf(token);
        to = from + token.length;
      } else if (typoTokens.includes(token) && matchWordWithTypo(token, word)) {
        from = 0;
        to = word.length;
      }

      for (let i: number = Math.max(from, 0); i < to; i++) {
        marked[start + i] = true;
      }
    }

    wordMatch = wordPattern.exec(text);
  }

  const segments: Array<HighlightSegment> = [];

  for (let i: number = 0; i < text.length; i++) {
    const last: HighlightSegment | undefined = segments[segments.length - 1];

    if (last && last.isMatch === marked[i]) {
      last.text += text.charAt(i);
    } else {
      segments.push({ text: text.charAt(i), isMatch: Boolean(marked[i]) });
    }
  }

  return segments.length > 0 ? segments : [{ text: text, isMatch: false }];
};

const indexCache: WeakMap<PickerCatalog, ComponentSearchIndex> = new WeakMap();

// buildComponentSearchIndex, once per catalog.
export const getComponentSearchIndex: BuildComponentSearchIndexFunction = (
  catalog: PickerCatalog,
): ComponentSearchIndex => {
  let index: ComponentSearchIndex | undefined = indexCache.get(catalog);

  if (!index) {
    index = buildComponentSearchIndex(catalog);
    indexCache.set(catalog, index);
  }

  return index;
};
