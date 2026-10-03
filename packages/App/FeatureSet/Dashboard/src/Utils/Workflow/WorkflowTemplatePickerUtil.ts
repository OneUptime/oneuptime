/*
 * The pure half of the workflow template picker: which templates it shows,
 * in what order, how search finds and ranks them, which one is picked, and
 * what its details say. No React here, so every rule can be tested on its
 * own.
 *
 * The picker started as a wall of forty-odd equally large cards. Its next
 * version opened on a handful of recommended templates but kept a column of
 * categories with counts, a list and a permanent preview side by side, and
 * the maintainer found that too much as well: "extremely hard to use because
 * it shows a lot of information on the modal". So now it shows little until
 * asked: Start from scratch first, a few recommended templates as one-line
 * rows, a search box and a category select, and the details of a template
 * only once it is picked.
 */

import IconProp from "Common/Types/Icon/IconProp";
import ComponentMetadata from "Common/Types/Workflow/Component";
import {
  WorkflowTemplate,
  WorkflowTemplateCategories,
  WorkflowTemplateCategory,
  WorkflowTemplateCategoryInfo,
  WorkflowTemplateOutline,
  WorkflowTemplateVariable,
  getRecommendedWorkflowTemplates,
  getWorkflowTemplateCategoryInfo,
  getWorkflowTemplateOutline,
  getWorkflowTemplates,
} from "Common/Types/Workflow/Templates";
import { loadComponentsAndCategories } from "Common/UI/Components/Workflow/Utils";
import {
  HighlightSegment,
  WORD_MATCH_QUALITY,
  WordMatchKind,
  getHighlightSegments,
  getSearchTokens,
  getSearchWords,
  matchWord,
  matchWordWithTypo,
} from "Common/UI/Components/Workflow/ComponentPicker/ComponentSearch";

type TranslateFunction = (value: string) => string;

export type WorkflowTemplateCountTextFunction = (
  tx: TranslateFunction,
  count: number,
  one: string,
  many: string,
) => string;

/*
 * A count and its noun, translated as one phrase - "1 result", "{count}
 * results" - so each language can put the number where its grammar wants it
 * (Russian "Результатов: 12"), rather than a number glued to a word
 * translated on its own. "{count}" has single braces so i18next leaves it be.
 */
export const workflowTemplateCountText: WorkflowTemplateCountTextFunction = (
  tx: TranslateFunction,
  count: number,
  one: string,
  many: string,
): string => {
  return count === 1 ? tx(one) : tx(many).replace("{count}", String(count));
};

/** The two lists that are not a category: the starting handful, and everything. */
export enum WorkflowTemplateCollection {
  Recommended = "recommended",
  All = "all",
}

/** What the template list is showing: one of the collections, or one category. */
export type WorkflowTemplatePickerView =
  | WorkflowTemplateCollection
  | WorkflowTemplateCategory;

/*
 * A view as the category select offers it. Only its name: the select is
 * meant to be quiet, so it carries no icons, counts or descriptions.
 */
export interface WorkflowTemplatePickerViewInfo {
  view: WorkflowTemplatePickerView;
  /** The option's name in the category select. */
  label: string;
}

export const RECOMMENDED_VIEW_INFO: WorkflowTemplatePickerViewInfo = {
  view: WorkflowTemplateCollection.Recommended,
  label: "Recommended",
};

export const ALL_TEMPLATES_VIEW_INFO: WorkflowTemplatePickerViewInfo = {
  view: WorkflowTemplateCollection.All,
  label: "All templates",
};

export type GetWorkflowTemplatePickerViewsFunction =
  () => Array<WorkflowTemplatePickerViewInfo>;

/**
 * Every view, in the order the category select lists them: Recommended, then
 * each category in the catalog's display order, then All templates.
 */
export const getWorkflowTemplatePickerViews: GetWorkflowTemplatePickerViewsFunction =
  (): Array<WorkflowTemplatePickerViewInfo> => {
    return [
      RECOMMENDED_VIEW_INFO,
      ...WorkflowTemplateCategories.map(
        (
          category: WorkflowTemplateCategory,
        ): WorkflowTemplatePickerViewInfo => {
          const info: WorkflowTemplateCategoryInfo =
            getWorkflowTemplateCategoryInfo(category);

          return {
            view: category,
            label: info.label,
          };
        },
      ),
      ALL_TEMPLATES_VIEW_INFO,
    ];
  };

export type GetWorkflowTemplateCategoryLabelFunction = (
  category: WorkflowTemplateCategory,
) => string;

/** The name the picker shows for a category: in the select, and over its group in All templates. */
export const getWorkflowTemplateCategoryLabel: GetWorkflowTemplateCategoryLabelFunction =
  (category: WorkflowTemplateCategory): string => {
    return getWorkflowTemplateCategoryInfo(category).label;
  };

type IsCategoryViewFunction = (
  view: WorkflowTemplatePickerView,
) => view is WorkflowTemplateCategory;

const isCategoryView: IsCategoryViewFunction = (
  view: WorkflowTemplatePickerView,
): view is WorkflowTemplateCategory => {
  return (WorkflowTemplateCategories as Array<string>).includes(view);
};

export type GetWorkflowTemplatePickerViewInfoFunction = (
  view: WorkflowTemplatePickerView,
) => WorkflowTemplatePickerViewInfo;

export const getWorkflowTemplatePickerViewInfo: GetWorkflowTemplatePickerViewInfoFunction =
  (view: WorkflowTemplatePickerView): WorkflowTemplatePickerViewInfo => {
    return (
      getWorkflowTemplatePickerViews().find(
        (info: WorkflowTemplatePickerViewInfo) => {
          return info.view === view;
        },
      ) || ALL_TEMPLATES_VIEW_INFO
    );
  };

export type GetTemplatesInViewFunction = (
  view: WorkflowTemplatePickerView,
) => Array<WorkflowTemplate>;

/** A view's templates, in its own order: curated for Recommended, the catalog's otherwise. */
export const getTemplatesInView: GetTemplatesInViewFunction = (
  view: WorkflowTemplatePickerView,
): Array<WorkflowTemplate> => {
  if (view === WorkflowTemplateCollection.Recommended) {
    return getRecommendedWorkflowTemplates();
  }

  const templates: Array<WorkflowTemplate> = getWorkflowTemplates();

  if (view === WorkflowTemplateCollection.All) {
    /*
     * In category order, so the list's groups come out in the same order as
     * the list of categories beside it.
     */
    return WorkflowTemplateCategories.flatMap(
      (category: WorkflowTemplateCategory): Array<WorkflowTemplate> => {
        return templates.filter((template: WorkflowTemplate) => {
          return template.category === category;
        });
      },
    );
  }

  return templates.filter((template: WorkflowTemplate) => {
    return template.category === view;
  });
};

/* ------------------------------ Search ------------------------------ */

/*
 * Search reads words the way the builder's Add Component picker does, on its
 * word matching (ComponentPicker/ComponentSearch), so the two pickers answer
 * the same typing the same way. Every word typed has to be found, in any
 * order and in any field; it may be a plural of what is written ("webhooks"),
 * the start of a longer word ("inc"), or inside one ("script"); a word that
 * matches nothing as typed is read as a typo ("incidnet"); and words that say
 * nothing about which template is meant ("when", "the") are left out unless
 * they are all there is.
 */

export type GetWorkflowTemplateSearchTokensFunction = (
  search: string,
) => Array<string>;

/**
 * The words a search is matched on, lower case and each once, without the
 * ones that say nothing. Empty when nothing searchable was typed.
 */
export const getWorkflowTemplateSearchTokens: GetWorkflowTemplateSearchTokensFunction =
  (search: string): Array<string> => {
    return getSearchTokens(search);
  };

interface SearchField {
  words: Array<string>;
  // How much a match here counts. Zero: searched, but not scored.
  weight: number;
}

/*
 * What a search reads, and how much a match in each place is worth: the
 * name, then the category, then the description, as in the Add Component
 * picker. The template's own words only: the category's description is left
 * out on purpose, because the Jira category's mentions both incidents and
 * alerts, and searching for "alert" would then bring back every incident
 * Jira template as well.
 *
 * What a template teaches is searched but not scored. It is about the
 * builder, not the job ("how to read a Jira changelog"), so a word in it
 * should find a template without lifting it over one whose name says it.
 */
const NAME_WEIGHT: number = 1;
const CATEGORY_WEIGHT: number = 0.7;
const DESCRIPTION_WEIGHT: number = 0.35;
const TEACHES_WEIGHT: number = 0;

// The catalog does not change while the page is open, so its words are read once.
const searchFieldsByTemplateId: Map<string, Array<SearchField>> = new Map();

type SearchFieldsFunction = (template: WorkflowTemplate) => Array<SearchField>;

const searchFieldsOf: SearchFieldsFunction = (
  template: WorkflowTemplate,
): Array<SearchField> => {
  const known: Array<SearchField> | undefined = searchFieldsByTemplateId.get(
    template.id,
  );

  if (known) {
    return known;
  }

  const fields: Array<SearchField> = [
    { words: getSearchWords(template.name), weight: NAME_WEIGHT },
    {
      // The category's own name and the one the picker shows, which can differ.
      words: getSearchWords(
        `${template.category} ${getWorkflowTemplateCategoryLabel(
          template.category,
        )} ${template.subcategory || ""}`,
      ),
      weight: CATEGORY_WEIGHT,
    },
    { words: getSearchWords(template.description), weight: DESCRIPTION_WEIGHT },
    { words: getSearchWords(template.teaches), weight: TEACHES_WEIGHT },
  ];

  searchFieldsByTemplateId.set(template.id, fields);

  return fields;
};

type BestMatchFunction = (
  token: string,
  words: Array<string>,
  allowTypo: boolean,
) => number;

// How well a typed word matches the best of these words, from 0 (not at all) to 1.
const bestMatch: BestMatchFunction = (
  token: string,
  words: Array<string>,
  allowTypo: boolean,
): number => {
  let best: number = 0;

  for (const word of words) {
    const kind: WordMatchKind | null = matchWord(token, word);

    if (kind) {
      best = Math.max(best, WORD_MATCH_QUALITY[kind]);
    } else if (allowTypo && matchWordWithTypo(token, word)) {
      best = Math.max(best, WORD_MATCH_QUALITY[WordMatchKind.Fuzzy]);
    }
  }

  return best;
};

type IsFoundFunction = (
  template: WorkflowTemplate,
  token: string,
  allowTypo: boolean,
) => boolean;

const isFound: IsFoundFunction = (
  template: WorkflowTemplate,
  token: string,
  allowTypo: boolean,
): boolean => {
  return searchFieldsOf(template).some((field: SearchField) => {
    return bestMatch(token, field.words, allowTypo) > 0;
  });
};

export type GetWorkflowTemplateTypoTokensFunction = (
  tokens: Array<string>,
) => Array<string>;

/**
 * The words typed that no template holds as written, which are then looked
 * for again as typos. As in the Add Component picker, a typo is only read
 * where nothing matches the word as typed, so a word that is right is never
 * also read as a near miss of some other word.
 */
export const getWorkflowTemplateTypoTokens: GetWorkflowTemplateTypoTokensFunction =
  (tokens: Array<string>): Array<string> => {
    const templates: Array<WorkflowTemplate> = getWorkflowTemplates();

    return tokens.filter((token: string) => {
      return !templates.some((template: WorkflowTemplate) => {
        return isFound(template, token, false);
      });
    });
  };

export type WorkflowTemplateMatchesSearchFunction = (
  template: WorkflowTemplate,
  tokens: Array<string>,
  typoTokens?: Array<string> | undefined,
) => boolean;

/**
 * Does this template match every word typed? Each word may be found in a
 * different place - the name, the category, the description or what the
 * template teaches - so "slack monitor" finds "Tell Slack when a monitor
 * changes status", which a search for the whole phrase never would. The
 * typoTokens are matched forgiving a typo.
 */
export const workflowTemplateMatchesSearch: WorkflowTemplateMatchesSearchFunction =
  (
    template: WorkflowTemplate,
    tokens: Array<string>,
    typoTokens?: Array<string> | undefined,
  ): boolean => {
    return tokens.every((token: string) => {
      return isFound(template, token, Boolean(typoTokens?.includes(token)));
    });
  };

/** Points for each word typed, at the best place it was found. */
const SCORE_PER_WORD: number = 100;

/** Extra points when the name itself starts with a word typed: "send" finds "Send…" first. */
const NAME_PREFIX_BONUS: number = 30;

/*
 * Extra points when the name holds the whole search as it was typed, words
 * in order. Word by word, "Create a Jira issue when an alert is created" and
 * "Create an alert when a Jira issue is created" are the same search; only
 * the phrase tells them apart, so typing a template's name puts it first.
 */
const NAME_PHRASE_BONUS: number = 500;

type SearchPhraseFunction = (search: string) => string;

// The search as one phrase: lower case, trimmed, any run of spaces one space.
const searchPhraseOf: SearchPhraseFunction = (search: string): string => {
  return search.trim().toLowerCase().replace(/\s+/g, " ");
};

export type GetWorkflowTemplateSearchScoreFunction = (
  template: WorkflowTemplate,
  tokens: Array<string>,
  phrase?: string | undefined,
  typoTokens?: Array<string> | undefined,
) => number;

/**
 * How well a template matches: for each word typed, how well and where it
 * was found at best, plus a bonus when the name starts with a word typed,
 * and a large one when the name holds the phrase typed (by default, the
 * words in the order given). Higher is better.
 */
export const getWorkflowTemplateSearchScore: GetWorkflowTemplateSearchScoreFunction =
  (
    template: WorkflowTemplate,
    tokens: Array<string>,
    phrase?: string | undefined,
    typoTokens?: Array<string> | undefined,
  ): number => {
    const fields: Array<SearchField> = searchFieldsOf(template);
    let score: number = 0;

    for (const token of tokens) {
      const allowTypo: boolean = Boolean(typoTokens?.includes(token));
      let best: number = 0;

      for (const field of fields) {
        best = Math.max(
          best,
          bestMatch(token, field.words, allowTypo) * field.weight,
        );
      }

      score += best * SCORE_PER_WORD;
    }

    const firstWordOfName: string | undefined = fields[0]?.words[0];

    if (
      firstWordOfName &&
      tokens.some((token: string) => {
        const kind: WordMatchKind | null = matchWord(token, firstWordOfName);

        return (
          kind === WordMatchKind.Exact ||
          kind === WordMatchKind.Variant ||
          kind === WordMatchKind.Prefix
        );
      })
    ) {
      score += NAME_PREFIX_BONUS;
    }

    const wholePhrase: string = phrase ?? tokens.join(" ");

    if (
      tokens.length > 1 &&
      wholePhrase.length > 0 &&
      template.name.toLowerCase().includes(wholePhrase)
    ) {
      score += NAME_PHRASE_BONUS;
    }

    return score;
  };

export type SearchWorkflowTemplatesFunction = (
  templates: Array<WorkflowTemplate>,
  search: string,
) => Array<WorkflowTemplate>;

/**
 * The templates that match every word, best first. A word in the name counts
 * for more than one in the category, which counts for more than one in the
 * description. Ties keep the order they came in, so equal matches stay in the
 * catalog's order. An empty search returns the templates as they are.
 */
export const searchWorkflowTemplates: SearchWorkflowTemplatesFunction = (
  templates: Array<WorkflowTemplate>,
  search: string,
): Array<WorkflowTemplate> => {
  const tokens: Array<string> = getWorkflowTemplateSearchTokens(search);

  if (tokens.length === 0) {
    return [...templates];
  }

  const typoTokens: Array<string> = getWorkflowTemplateTypoTokens(tokens);
  const phrase: string = searchPhraseOf(search);

  return templates
    .filter((template: WorkflowTemplate) => {
      return workflowTemplateMatchesSearch(template, tokens, typoTokens);
    })
    .map((template: WorkflowTemplate, index: number) => {
      return {
        template: template,
        index: index,
        score: getWorkflowTemplateSearchScore(
          template,
          tokens,
          phrase,
          typoTokens,
        ),
      };
    })
    .sort(
      (
        a: { index: number; score: number },
        b: { index: number; score: number },
      ): number => {
        return b.score - a.score || a.index - b.index;
      },
    )
    .map((entry: { template: WorkflowTemplate }) => {
      return entry.template;
    });
};

export type WorkflowTemplateHighlightSegment = HighlightSegment;

export type GetWorkflowTemplateHighlightSegmentsFunction = (
  text: string,
  tokens: Array<string>,
  typoTokens?: Array<string> | undefined,
) => Array<WorkflowTemplateHighlightSegment>;

/**
 * The text cut into pieces, each marked by whether a word typed matched it:
 * a whole word, what has been typed of a longer one, the letters inside one,
 * or the word a typo was read as. Marked as the Add Component picker marks
 * its rows.
 */
export const getWorkflowTemplateHighlightSegments: GetWorkflowTemplateHighlightSegmentsFunction =
  (
    text: string,
    tokens: Array<string>,
    typoTokens?: Array<string> | undefined,
  ): Array<WorkflowTemplateHighlightSegment> => {
    return getHighlightSegments(text, tokens, typoTokens || []);
  };

/* ------------------------------ State ------------------------------- */

/*
 * Everything the picker remembers. It lives in the wizard, not in the picker,
 * so stepping back from Name finds the picker as it was left: the same
 * search, the same category and the same template picked.
 */
export interface WorkflowTemplatePickerState {
  search: string;
  /** The view picked while browsing. Kept through a search, and back when it is cleared. */
  browseView: WorkflowTemplatePickerView;
  /** The view a search is narrowed to. A new search starts on All templates. */
  searchView: WorkflowTemplatePickerView;
  /**
   * The template picked, by a click or the arrow keys: its details are
   * open, and "Use this template" and Enter take it. Null when none has
   * been, and then the picker shows no details at all while browsing - a
   * template's details are there when asked for - and treats a search's
   * best match as picked, so Enter after typing takes it.
   */
  selectedTemplateId: string | null;
}

export const INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE: WorkflowTemplatePickerState =
  {
    search: "",
    browseView: WorkflowTemplateCollection.Recommended,
    searchView: WorkflowTemplateCollection.All,
    selectedTemplateId: null,
  };

export type IsSearchingFunction = (
  state: WorkflowTemplatePickerState,
) => boolean;

export const isSearchingTemplates: IsSearchingFunction = (
  state: WorkflowTemplatePickerState,
): boolean => {
  return getWorkflowTemplateSearchTokens(state.search).length > 0;
};

export type GetCurrentViewFunction = (
  state: WorkflowTemplatePickerState,
) => WorkflowTemplatePickerView;

/** The view the list shows: the search's while searching, the browsing one otherwise. */
export const getCurrentWorkflowTemplatePickerView: GetCurrentViewFunction = (
  state: WorkflowTemplatePickerState,
): WorkflowTemplatePickerView => {
  return isSearchingTemplates(state) ? state.searchView : state.browseView;
};

export interface WorkflowTemplatePickerSection {
  /** Stable key, also used in the section's DOM id. */
  id: string;
  /** Heading over the section's rows. Empty for a list with one section. */
  title: string;
  templates: Array<WorkflowTemplate>;
}

export interface WorkflowTemplatePickerList {
  view: WorkflowTemplatePickerView;
  isSearching: boolean;
  /** The words of the search read as typos, for the rows to mark what they were read as. */
  typoTokens: Array<string>;
  sections: Array<WorkflowTemplatePickerSection>;
  /** Every template on the list, in the order shown: what the arrow keys walk. */
  templates: Array<WorkflowTemplate>;
}

type SectionIdFunction = (title: string) => string;

const sectionIdOf: SectionIdFunction = (title: string): string => {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

type GroupFunction = (
  templates: Array<WorkflowTemplate>,
  keyOf: (template: WorkflowTemplate) => string,
) => Array<WorkflowTemplatePickerSection>;

// Groups in the order each first appears, which is the order they come in.
const groupTemplates: GroupFunction = (
  templates: Array<WorkflowTemplate>,
  keyOf: (template: WorkflowTemplate) => string,
): Array<WorkflowTemplatePickerSection> => {
  const sections: Array<WorkflowTemplatePickerSection> = [];

  for (const template of templates) {
    const title: string = keyOf(template);
    const existing: WorkflowTemplatePickerSection | undefined = sections.find(
      (section: WorkflowTemplatePickerSection) => {
        return section.title === title;
      },
    );

    if (existing) {
      existing.templates.push(template);
    } else {
      sections.push({
        id: sectionIdOf(title) || "templates",
        title: title,
        templates: [template],
      });
    }
  }

  return sections;
};

export type GetWorkflowTemplatePickerListFunction = (
  state: WorkflowTemplatePickerState,
) => WorkflowTemplatePickerList;

/**
 * What the list shows for this state.
 *
 * - Searching: the matches in the view the search is narrowed to, best first,
 *   in one list.
 * - All templates: every template, under its category's heading.
 * - A category split into parts (Jira's incident and alert templates): one
 *   heading per part.
 * - Anything else: one list, in the view's own order.
 */
export const getWorkflowTemplatePickerList: GetWorkflowTemplatePickerListFunction =
  (state: WorkflowTemplatePickerState): WorkflowTemplatePickerList => {
    const view: WorkflowTemplatePickerView =
      getCurrentWorkflowTemplatePickerView(state);
    const isSearching: boolean = isSearchingTemplates(state);
    const inView: Array<WorkflowTemplate> = getTemplatesInView(view);
    const typoTokens: Array<string> = isSearching
      ? getWorkflowTemplateTypoTokens(
          getWorkflowTemplateSearchTokens(state.search),
        )
      : [];

    let sections: Array<WorkflowTemplatePickerSection>;

    if (isSearching) {
      sections = [
        {
          id: "results",
          title: "",
          templates: searchWorkflowTemplates(inView, state.search),
        },
      ];
    } else if (view === WorkflowTemplateCollection.All) {
      sections = groupTemplates(inView, (template: WorkflowTemplate) => {
        return getWorkflowTemplateCategoryLabel(template.category);
      });
    } else if (
      isCategoryView(view) &&
      inView.some((template: WorkflowTemplate) => {
        return Boolean(template.subcategory);
      })
    ) {
      sections = groupTemplates(inView, (template: WorkflowTemplate) => {
        return template.subcategory || "";
      });
    } else {
      sections = [{ id: "templates", title: "", templates: inView }];
    }

    sections = sections.filter((section: WorkflowTemplatePickerSection) => {
      return section.templates.length > 0;
    });

    return {
      view: view,
      isSearching: isSearching,
      typoTokens: typoTokens,
      sections: sections,
      templates: sections.flatMap(
        (section: WorkflowTemplatePickerSection): Array<WorkflowTemplate> => {
          return section.templates;
        },
      ),
    };
  };

export type GetWorkflowTemplatePickerCountsFunction = (
  search: string,
) => Map<WorkflowTemplatePickerView, number>;

/**
 * How many templates each view holds, or while searching, how many of them
 * match. The picker no longer prints these beside the categories; it reads
 * All templates' count to offer "Search all templates" when a search
 * narrowed to one category finds nothing there but finds matches elsewhere.
 */
export const getWorkflowTemplatePickerCounts: GetWorkflowTemplatePickerCountsFunction =
  (search: string): Map<WorkflowTemplatePickerView, number> => {
    const tokens: Array<string> = getWorkflowTemplateSearchTokens(search);
    const typoTokens: Array<string> = getWorkflowTemplateTypoTokens(tokens);
    const counts: Map<WorkflowTemplatePickerView, number> = new Map();

    for (const info of getWorkflowTemplatePickerViews()) {
      counts.set(
        info.view,
        getTemplatesInView(info.view).filter((template: WorkflowTemplate) => {
          return workflowTemplateMatchesSearch(template, tokens, typoTokens);
        }).length,
      );
    }

    return counts;
  };

export type GetActiveWorkflowTemplateFunction = (
  state: WorkflowTemplatePickerState,
) => WorkflowTemplate | null;

/**
 * The template the picker has picked: its details are open, and "Use this
 * template" and Enter take it.
 *
 * - The one picked by a click or the arrow keys, while it is on the list.
 * - Otherwise, while searching, the best match, so typing and pressing
 *   Enter takes it, as in the command palette.
 * - Otherwise none. Browsing shows no template's details until one is
 *   picked: that is what keeps the step calm when it opens.
 *
 * Null when none is picked, and when a search finds nothing.
 */
export const getActiveWorkflowTemplate: GetActiveWorkflowTemplateFunction = (
  state: WorkflowTemplatePickerState,
): WorkflowTemplate | null => {
  const list: WorkflowTemplatePickerList = getWorkflowTemplatePickerList(state);

  const picked: WorkflowTemplate | undefined = list.templates.find(
    (template: WorkflowTemplate) => {
      return template.id === state.selectedTemplateId;
    },
  );

  if (picked) {
    return picked;
  }

  if (list.isSearching) {
    return list.templates[0] || null;
  }

  return null;
};

export type WithSearchFunction = (
  state: WorkflowTemplatePickerState,
  search: string,
) => WorkflowTemplatePickerState;

/**
 * Typing. A search that starts afresh looks through every template, whatever
 * category was open, and whatever was picked is let go, so the best match
 * is the one picked.
 */
export const withWorkflowTemplateSearch: WithSearchFunction = (
  state: WorkflowTemplatePickerState,
  search: string,
): WorkflowTemplatePickerState => {
  const wasSearching: boolean = isSearchingTemplates(state);
  const next: WorkflowTemplatePickerState = { ...state, search: search };

  if (!wasSearching && isSearchingTemplates(next)) {
    next.searchView = WorkflowTemplateCollection.All;
  }

  next.selectedTemplateId = null;

  return next;
};

export type WithViewFunction = (
  state: WorkflowTemplatePickerState,
  view: WorkflowTemplatePickerView,
) => WorkflowTemplatePickerState;

/**
 * Choosing a category: narrows a search, or changes what is being browsed.
 * Whatever was picked is let go: it may not be on the new list, and the
 * details of one that is would open on a list the person has not read yet.
 */
export const withWorkflowTemplateView: WithViewFunction = (
  state: WorkflowTemplatePickerState,
  view: WorkflowTemplatePickerView,
): WorkflowTemplatePickerState => {
  const next: WorkflowTemplatePickerState = {
    ...state,
    selectedTemplateId: null,
  };

  if (isSearchingTemplates(state)) {
    next.searchView = view;
  } else {
    next.browseView = view;
  }

  return next;
};

export type WithSelectedFunction = (
  state: WorkflowTemplatePickerState,
  templateId: string,
) => WorkflowTemplatePickerState;

/** Picking a template: a click on its row, or the arrow keys landing on it. */
export const withWorkflowTemplateSelected: WithSelectedFunction = (
  state: WorkflowTemplatePickerState,
  templateId: string,
): WorkflowTemplatePickerState => {
  return { ...state, selectedTemplateId: templateId };
};

export enum WorkflowTemplateMove {
  Next = "next",
  Previous = "previous",
  First = "first",
  Last = "last",
}

export type GetMovedWorkflowTemplateIdFunction = (
  state: WorkflowTemplatePickerState,
  move: WorkflowTemplateMove,
) => string | null;

/**
 * The template an arrow key (or Home, or End) picks. Stops at either end
 * rather than wrapping round. With nothing picked yet, down picks the first
 * template and up the last, as a combobox's arrows do from its text box.
 */
export const getMovedWorkflowTemplateId: GetMovedWorkflowTemplateIdFunction = (
  state: WorkflowTemplatePickerState,
  move: WorkflowTemplateMove,
): string | null => {
  const templates: Array<WorkflowTemplate> =
    getWorkflowTemplatePickerList(state).templates;

  if (templates.length === 0) {
    return null;
  }

  const first: WorkflowTemplate = templates[0]!;
  const last: WorkflowTemplate = templates[templates.length - 1]!;

  if (move === WorkflowTemplateMove.First) {
    return first.id;
  }

  if (move === WorkflowTemplateMove.Last) {
    return last.id;
  }

  /*
   * By id: every list is built from fresh template objects, so the picked
   * one is never the same object as its row in another list.
   */
  const active: WorkflowTemplate | null = getActiveWorkflowTemplate(state);
  const index: number = active
    ? templates.findIndex((candidate: WorkflowTemplate) => {
        return candidate.id === active.id;
      })
    : -1;

  if (index === -1) {
    return move === WorkflowTemplateMove.Next ? first.id : last.id;
  }

  const nextIndex: number =
    move === WorkflowTemplateMove.Next
      ? Math.min(index + 1, templates.length - 1)
      : Math.max(index - 1, 0);

  return templates[nextIndex]!.id;
};

/* ------------------------------ Details ----------------------------- */

/*
 * What a picked template's row opens to show: what starts it, the kinds of
 * block it is made of, and the settings it will ask for. Named "preview"
 * because it is shown before anything is created.
 */

export interface WorkflowTemplatePreviewBlock {
  componentId: string;
  /** The block's name, as the builder's canvas shows it. */
  title: string;
  icon: IconProp;
}

export interface WorkflowTemplatePreview {
  template: WorkflowTemplate;
  trigger: WorkflowTemplatePreviewBlock;
  /** Every other kind of block in it, once each, the main path first and Log last. */
  steps: Array<WorkflowTemplatePreviewBlock>;
  /** How many blocks the created workflow has, the trigger included. */
  blockCount: number;
  /** What the Configure step will ask for, in the order it asks. */
  settings: Array<WorkflowTemplateVariable>;
}

export type FindWorkflowComponentFunction = (
  componentId: string,
) => ComponentMetadata | undefined;

let componentsById: Map<string, ComponentMetadata> | null = null;

/**
 * A component from the builder's own registry - the static components and
 * one set per database model - so the preview names each block the way the
 * canvas will. Built on first use and kept: it walks every model.
 */
export const findWorkflowComponent: FindWorkflowComponentFunction = (
  componentId: string,
): ComponentMetadata | undefined => {
  if (!componentsById) {
    componentsById = new Map();

    for (const component of loadComponentsAndCategories().components) {
      componentsById.set(component.id, component);
    }
  }

  return componentsById.get(componentId);
};

type ToBlockFunction = (
  componentId: string,
  findComponent: FindWorkflowComponentFunction,
) => WorkflowTemplatePreviewBlock;

const toBlock: ToBlockFunction = (
  componentId: string,
  findComponent: FindWorkflowComponentFunction,
): WorkflowTemplatePreviewBlock => {
  const component: ComponentMetadata | undefined = findComponent(componentId);

  if (component) {
    return {
      componentId: componentId,
      title: component.title,
      icon: component.iconProp,
    };
  }

  // Not expected - every template's blocks are checked against the registry.
  const words: string = componentId.replace(/-/g, " ");

  return {
    componentId: componentId,
    title: words.charAt(0).toUpperCase() + words.slice(1),
    icon: IconProp.Cube,
  };
};

export type GetWorkflowTemplatePreviewFunction = (
  template: WorkflowTemplate,
  findComponent?: FindWorkflowComponentFunction | undefined,
) => WorkflowTemplatePreview | null;

/** Everything a picked template's details show, before anything is created. */
export const getWorkflowTemplatePreview: GetWorkflowTemplatePreviewFunction = (
  template: WorkflowTemplate,
  findComponent?: FindWorkflowComponentFunction | undefined,
): WorkflowTemplatePreview | null => {
  const outline: WorkflowTemplateOutline | null = getWorkflowTemplateOutline(
    template.id,
  );

  if (!outline) {
    return null;
  }

  const find: FindWorkflowComponentFunction =
    findComponent || findWorkflowComponent;

  return {
    template: template,
    trigger: toBlock(outline.triggerComponentId, find),
    steps: outline.stepComponentIds.map(
      (componentId: string): WorkflowTemplatePreviewBlock => {
        return toBlock(componentId, find);
      },
    ),
    blockCount: outline.blockCount,
    settings: [...template.variables],
  };
};
