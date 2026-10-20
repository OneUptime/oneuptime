/*
 * The pure half of a template picker: which templates it shows, in what
 * order, how search finds and ranks them, which one is picked, and how the
 * arrow keys move the pick. No React here, so every rule can be tested on
 * its own.
 *
 * Two catalogs are picked from this way: workflow templates (Create a
 * workflow, Utils/Workflow/WorkflowTemplatePickerUtil) and dashboard
 * templates (Create a dashboard, Utils/Dashboard/DashboardTemplatePickerUtil).
 * The workflow picker came first. It started as a wall of forty-odd equally
 * large cards, then a column of categories with counts beside a list and a
 * preview that was always open, and the maintainer found both too much:
 * "extremely hard to use because it shows a lot of information on the
 * modal". What it became - Start from scratch first, a few recommended
 * templates as one-line rows, a search box and a category select, and the
 * details of a template only once it is picked - is what the maintainer then
 * asked the dashboard templates to become as well: "The workflow templates
 * model is a lot easier to understand and use. Please make the dashboard
 * templates model like workflow templates." So the rules live here, once,
 * and each catalog says only what is its own (TemplateCatalog): its
 * templates, the few it recommends, its categories and the text a search
 * reads.
 */

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

export type TemplateCountTextFunction = (
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
export const templateCountText: TemplateCountTextFunction = (
  tx: TranslateFunction,
  count: number,
  one: string,
  many: string,
): string => {
  return count === 1 ? tx(one) : tx(many).replace("{count}", String(count));
};

/** The two lists that are not a category: the starting handful, and everything. */
export enum TemplateCollection {
  Recommended = "recommended",
  All = "all",
}

/** What the template list is showing: one of the collections, or one category. */
export type TemplatePickerView<C extends string> = TemplateCollection | C;

/*
 * A view as the category select offers it. Only its name: the select is
 * meant to be quiet, so it carries no icons, counts or descriptions.
 */
export interface TemplatePickerViewInfo<C extends string> {
  view: TemplatePickerView<C>;
  /** The option's name in the category select. */
  label: string;
}

export const RECOMMENDED_TEMPLATES_VIEW_INFO: TemplatePickerViewInfo<never> = {
  view: TemplateCollection.Recommended,
  label: "Recommended",
};

export const ALL_TEMPLATES_VIEW_INFO: TemplatePickerViewInfo<never> = {
  view: TemplateCollection.All,
  label: "All templates",
};

/** What every catalog's templates have: what a row shows, and an id to pick it by. */
export interface TemplatePickerTemplate {
  /** Stable key: the row's DOM id is made from it, and the pick is kept by it. */
  id: string;
  name: string;
  /** One line on the row while it is closed, all of it once it is picked. */
  description: string;
}

/** A piece of text a search reads, and how much a match in it is worth. */
export interface TemplateSearchField {
  text: string;
  /** Zero: searched, but not scored. */
  weight: number;
}

/*
 * What a catalog says about itself. Everything else - the views, the
 * search, the list, the pick - follows from it, the same way for every
 * catalog.
 */
export interface TemplateCatalog<
  T extends TemplatePickerTemplate,
  C extends string,
> {
  /** Every template, in the catalog's own order. */
  getTemplates: () => Array<T>;
  /** The handful the picker opens on, in the order it lists them. */
  getRecommendedTemplates: () => Array<T>;
  /** The categories, in the order the category select lists them. */
  categories: ReadonlyArray<C>;
  /** The name the picker shows for a category. */
  getCategoryLabel: (category: C) => string;
  getCategory: (template: T) => C;
  /*
   * A part of a large category, shown under a heading of its own when that
   * category is picked (Jira's incident and alert templates). Absent, or
   * empty: the category is one list.
   */
  getSubcategory?: ((template: T) => string | undefined) | undefined;
  /*
   * What a search reads, and how much a match in each place is worth. The
   * name should count for the most, as in the Add Component picker.
   */
  getSearchFields: (template: T) => Array<TemplateSearchField>;
}

/* ------------------------------ State ------------------------------- */

/*
 * Everything the picker remembers. It lives in the wizard that holds the
 * picker, not in the picker, so stepping back from the next step finds the
 * picker as it was left: the same search, the same category and the same
 * template picked.
 */
export interface TemplatePickerState<C extends string> {
  search: string;
  /** The view picked while browsing. Kept through a search, and back when it is cleared. */
  browseView: TemplatePickerView<C>;
  /** The view a search is narrowed to. A new search starts on All templates. */
  searchView: TemplatePickerView<C>;
  /**
   * The template picked, by a click or the arrow keys: its details are
   * open, and "Use this template" and Enter take it. Null when none has
   * been, and then the picker shows no details at all while browsing - a
   * template's details are there when asked for - and treats a search's
   * best match as picked, so Enter after typing takes it.
   */
  selectedTemplateId: string | null;
}

/** Where every picker starts: the recommended handful, nothing picked. */
export const INITIAL_TEMPLATE_PICKER_STATE: TemplatePickerState<never> = {
  search: "",
  browseView: TemplateCollection.Recommended,
  searchView: TemplateCollection.All,
  selectedTemplateId: null,
};

export interface TemplatePickerSection<T extends TemplatePickerTemplate> {
  /** Stable key, also used in the section's DOM id. */
  id: string;
  /** Heading over the section's rows. Empty for a list with one section. */
  title: string;
  templates: Array<T>;
}

export interface TemplatePickerList<
  T extends TemplatePickerTemplate,
  C extends string,
> {
  view: TemplatePickerView<C>;
  isSearching: boolean;
  /** The words of the search read as typos, for the rows to mark what they were read as. */
  typoTokens: Array<string>;
  sections: Array<TemplatePickerSection<T>>;
  /** Every template on the list, in the order shown: what the arrow keys walk. */
  templates: Array<T>;
}

export enum TemplateMove {
  Next = "next",
  Previous = "previous",
  First = "first",
  Last = "last",
}

export type TemplateHighlightSegment = HighlightSegment;

/*
 * The rules of one catalog's picker, bound to it. createTemplatePickerRules
 * builds them; the picker component (Components/TemplatePicker) and the
 * wizards read them.
 */
export interface TemplatePickerRules<
  T extends TemplatePickerTemplate,
  C extends string,
> {
  catalog: TemplateCatalog<T, C>;
  /**
   * Every view, in the order the category select lists them: Recommended,
   * then each category in the catalog's display order, then All templates.
   */
  getViews: () => Array<TemplatePickerViewInfo<C>>;
  getViewInfo: (view: TemplatePickerView<C>) => TemplatePickerViewInfo<C>;
  /** The name the picker shows for a category: in the select, and over its group in All templates. */
  getCategoryLabel: (category: C) => string;
  /** A view's templates, in its own order: curated for Recommended, the catalog's otherwise. */
  getTemplatesInView: (view: TemplatePickerView<C>) => Array<T>;
  /**
   * The words a search is matched on, lower case and each once, without the
   * ones that say nothing. Empty when nothing searchable was typed.
   */
  getSearchTokens: (search: string) => Array<string>;
  /**
   * The words typed that no template holds as written, which are then
   * looked for again as typos.
   */
  getTypoTokens: (tokens: Array<string>) => Array<string>;
  /** Does this template match every word typed? */
  matchesSearch: (
    template: T,
    tokens: Array<string>,
    typoTokens?: Array<string> | undefined,
  ) => boolean;
  /** How well a template matches. Higher is better. */
  getSearchScore: (
    template: T,
    tokens: Array<string>,
    phrase?: string | undefined,
    typoTokens?: Array<string> | undefined,
  ) => number;
  /** The templates that match every word, best first. */
  search: (templates: Array<T>, search: string) => Array<T>;
  getHighlightSegments: (
    text: string,
    tokens: Array<string>,
    typoTokens?: Array<string> | undefined,
  ) => Array<TemplateHighlightSegment>;
  isSearching: (state: TemplatePickerState<C>) => boolean;
  /** The view the list shows: the search's while searching, the browsing one otherwise. */
  getCurrentView: (state: TemplatePickerState<C>) => TemplatePickerView<C>;
  /** What the list shows for this state. */
  getList: (state: TemplatePickerState<C>) => TemplatePickerList<T, C>;
  /** How many templates each view holds, or while searching, how many of them match. */
  getCounts: (search: string) => Map<TemplatePickerView<C>, number>;
  /** The template the picker has picked: its details are open, and Use this template takes it. */
  getActiveTemplate: (state: TemplatePickerState<C>) => T | null;
  /** Typing. */
  withSearch: (
    state: TemplatePickerState<C>,
    search: string,
  ) => TemplatePickerState<C>;
  /** Choosing a category. */
  withView: (
    state: TemplatePickerState<C>,
    view: TemplatePickerView<C>,
  ) => TemplatePickerState<C>;
  /** Picking a template: a click on its row, or the arrow keys landing on it. */
  withSelected: (
    state: TemplatePickerState<C>,
    templateId: string,
  ) => TemplatePickerState<C>;
  /** The template an arrow key (or Home, or End) picks. */
  getMovedTemplateId: (
    state: TemplatePickerState<C>,
    move: TemplateMove,
  ) => string | null;
}

/* ------------------------------ Search ------------------------------ */

/*
 * Search reads words the way the workflow builder's Add Component picker
 * does, on its word matching (ComponentPicker/ComponentSearch), so every
 * picker answers the same typing the same way. Every word typed has to be
 * found, in any order and in any field; it may be a plural of what is
 * written ("webhooks"), the start of a longer word ("inc"), or inside one
 * ("script"); a word that matches nothing as typed is read as a typo
 * ("incidnet"); and words that say nothing about which template is meant
 * ("when", "the") are left out unless they are all there is.
 */

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

// Runs of white space in a search: read as one space.
const WHITE_SPACE_RUN: RegExp = /\s+/g;

type SearchPhraseFunction = (search: string) => string;

// The search as one phrase: lower case, trimmed, any run of spaces one space.
const searchPhraseOf: SearchPhraseFunction = (search: string): string => {
  return search.trim().toLowerCase().replace(WHITE_SPACE_RUN, " ");
};

interface SearchWords {
  words: Array<string>;
  weight: number;
}

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

/* ------------------------------ Lists ------------------------------- */

// A run of anything that is not a letter or a digit, in a section heading made into an id.
const NOT_ID_CHARACTERS: RegExp = /[^a-z0-9]+/;

type SectionIdFunction = (title: string) => string;

// "Monitoring & APM" is "monitoring-apm": its words, joined by dashes.
const sectionIdOf: SectionIdFunction = (title: string): string => {
  return title
    .toLowerCase()
    .split(NOT_ID_CHARACTERS)
    .filter((word: string): boolean => {
      return word.length > 0;
    })
    .join("-");
};

type GroupFunction = <T extends TemplatePickerTemplate>(
  templates: Array<T>,
  keyOf: (template: T) => string,
) => Array<TemplatePickerSection<T>>;

// Groups in the order each first appears, which is the order they come in.
const groupTemplates: GroupFunction = <T extends TemplatePickerTemplate>(
  templates: Array<T>,
  keyOf: (template: T) => string,
): Array<TemplatePickerSection<T>> => {
  const sections: Array<TemplatePickerSection<T>> = [];

  for (const template of templates) {
    const title: string = keyOf(template);
    const existing: TemplatePickerSection<T> | undefined = sections.find(
      (section: TemplatePickerSection<T>) => {
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

/* ------------------------------ Rules ------------------------------- */

export type CreateTemplatePickerRulesFunction = <
  T extends TemplatePickerTemplate,
  C extends string,
>(
  catalog: TemplateCatalog<T, C>,
) => TemplatePickerRules<T, C>;

/**
 * The rules of a picker over this catalog. Build them once per catalog, at
 * module level: they keep the words of each template once read, since a
 * catalog does not change while the page is open.
 */
export const createTemplatePickerRules: CreateTemplatePickerRulesFunction = <
  T extends TemplatePickerTemplate,
  C extends string,
>(
  catalog: TemplateCatalog<T, C>,
): TemplatePickerRules<T, C> => {
  const searchWordsByTemplateId: Map<string, Array<SearchWords>> = new Map();

  const getCategoryLabel: (category: C) => string = (category: C): string => {
    return catalog.getCategoryLabel(category);
  };

  const getViews: () => Array<TemplatePickerViewInfo<C>> = (): Array<
    TemplatePickerViewInfo<C>
  > => {
    return [
      RECOMMENDED_TEMPLATES_VIEW_INFO,
      ...catalog.categories.map((category: C): TemplatePickerViewInfo<C> => {
        return {
          view: category,
          label: getCategoryLabel(category),
        };
      }),
      ALL_TEMPLATES_VIEW_INFO,
    ];
  };

  const getViewInfo: (
    view: TemplatePickerView<C>,
  ) => TemplatePickerViewInfo<C> = (
    view: TemplatePickerView<C>,
  ): TemplatePickerViewInfo<C> => {
    return (
      getViews().find((info: TemplatePickerViewInfo<C>) => {
        return info.view === view;
      }) || ALL_TEMPLATES_VIEW_INFO
    );
  };

  const isCategoryView: (view: TemplatePickerView<C>) => view is C = (
    view: TemplatePickerView<C>,
  ): view is C => {
    return (catalog.categories as ReadonlyArray<string>).includes(view);
  };

  const subcategoryOf: (template: T) => string = (template: T): string => {
    return catalog.getSubcategory ? catalog.getSubcategory(template) || "" : "";
  };

  const getTemplatesInView: (view: TemplatePickerView<C>) => Array<T> = (
    view: TemplatePickerView<C>,
  ): Array<T> => {
    if (view === TemplateCollection.Recommended) {
      return catalog.getRecommendedTemplates();
    }

    const templates: Array<T> = catalog.getTemplates();

    if (view === TemplateCollection.All) {
      /*
       * In category order, so the list's groups come out in the same order
       * as the categories in the select beside it.
       */
      return catalog.categories.flatMap((category: C): Array<T> => {
        return templates.filter((template: T) => {
          return catalog.getCategory(template) === category;
        });
      });
    }

    return templates.filter((template: T) => {
      return catalog.getCategory(template) === view;
    });
  };

  const searchWordsOf: (template: T) => Array<SearchWords> = (
    template: T,
  ): Array<SearchWords> => {
    const known: Array<SearchWords> | undefined = searchWordsByTemplateId.get(
      template.id,
    );

    if (known) {
      return known;
    }

    const fields: Array<SearchWords> = catalog
      .getSearchFields(template)
      .map((field: TemplateSearchField): SearchWords => {
        return { words: getSearchWords(field.text), weight: field.weight };
      });

    searchWordsByTemplateId.set(template.id, fields);

    return fields;
  };

  const isFound: (template: T, token: string, allowTypo: boolean) => boolean = (
    template: T,
    token: string,
    allowTypo: boolean,
  ): boolean => {
    return searchWordsOf(template).some((field: SearchWords) => {
      return bestMatch(token, field.words, allowTypo) > 0;
    });
  };

  const getTypoTokens: (tokens: Array<string>) => Array<string> = (
    tokens: Array<string>,
  ): Array<string> => {
    const templates: Array<T> = catalog.getTemplates();

    /*
     * As in the Add Component picker, a typo is only read where nothing
     * matches the word as typed, so a word that is right is never also read
     * as a near miss of some other word.
     */
    return tokens.filter((token: string) => {
      return !templates.some((template: T) => {
        return isFound(template, token, false);
      });
    });
  };

  const matchesSearch: (
    template: T,
    tokens: Array<string>,
    typoTokens?: Array<string> | undefined,
  ) => boolean = (
    template: T,
    tokens: Array<string>,
    typoTokens?: Array<string> | undefined,
  ): boolean => {
    /*
     * Each word may be found in a different place, so "slack monitor" finds
     * "Tell Slack when a monitor changes status", which a search for the
     * whole phrase never would. The typoTokens are matched forgiving a typo.
     */
    return tokens.every((token: string) => {
      return isFound(template, token, Boolean(typoTokens?.includes(token)));
    });
  };

  const getSearchScore: (
    template: T,
    tokens: Array<string>,
    phrase?: string | undefined,
    typoTokens?: Array<string> | undefined,
  ) => number = (
    template: T,
    tokens: Array<string>,
    phrase?: string | undefined,
    typoTokens?: Array<string> | undefined,
  ): number => {
    const fields: Array<SearchWords> = searchWordsOf(template);
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

    const firstWordOfName: string | undefined = getSearchWords(
      template.name,
    )[0];

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

  const search: (templates: Array<T>, searchText: string) => Array<T> = (
    templates: Array<T>,
    searchText: string,
  ): Array<T> => {
    const tokens: Array<string> = getSearchTokens(searchText);

    if (tokens.length === 0) {
      return [...templates];
    }

    const typoTokens: Array<string> = getTypoTokens(tokens);
    const phrase: string = searchPhraseOf(searchText);

    /*
     * A word in the name counts for more than one elsewhere. Ties keep the
     * order they came in, so equal matches stay in the catalog's order.
     */
    return templates
      .filter((template: T) => {
        return matchesSearch(template, tokens, typoTokens);
      })
      .map((template: T, index: number) => {
        return {
          template: template,
          index: index,
          score: getSearchScore(template, tokens, phrase, typoTokens),
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
      .map((entry: { template: T }) => {
        return entry.template;
      });
  };

  const highlightSegmentsOf: (
    text: string,
    tokens: Array<string>,
    typoTokens?: Array<string> | undefined,
  ) => Array<TemplateHighlightSegment> = (
    text: string,
    tokens: Array<string>,
    typoTokens?: Array<string> | undefined,
  ): Array<TemplateHighlightSegment> => {
    /*
     * The text cut into pieces, each marked by whether a word typed matched
     * it: a whole word, what has been typed of a longer one, the letters
     * inside one, or the word a typo was read as.
     */
    return getHighlightSegments(text, tokens, typoTokens || []);
  };

  const isSearching: (state: TemplatePickerState<C>) => boolean = (
    state: TemplatePickerState<C>,
  ): boolean => {
    return getSearchTokens(state.search).length > 0;
  };

  const getCurrentView: (
    state: TemplatePickerState<C>,
  ) => TemplatePickerView<C> = (
    state: TemplatePickerState<C>,
  ): TemplatePickerView<C> => {
    return isSearching(state) ? state.searchView : state.browseView;
  };

  const getList: (state: TemplatePickerState<C>) => TemplatePickerList<T, C> = (
    state: TemplatePickerState<C>,
  ): TemplatePickerList<T, C> => {
    /*
     * - Searching: the matches in the view the search is narrowed to, best
     *   first, in one list.
     * - All templates: every template, under its category's heading.
     * - A category split into parts: one heading per part.
     * - Anything else: one list, in the view's own order.
     */
    const view: TemplatePickerView<C> = getCurrentView(state);
    const searching: boolean = isSearching(state);
    const inView: Array<T> = getTemplatesInView(view);
    const typoTokens: Array<string> = searching
      ? getTypoTokens(getSearchTokens(state.search))
      : [];

    let sections: Array<TemplatePickerSection<T>>;

    if (searching) {
      sections = [
        {
          id: "results",
          title: "",
          templates: search(inView, state.search),
        },
      ];
    } else if (view === TemplateCollection.All) {
      sections = groupTemplates(inView, (template: T) => {
        return getCategoryLabel(catalog.getCategory(template));
      });
    } else if (
      isCategoryView(view) &&
      inView.some((template: T) => {
        return Boolean(subcategoryOf(template));
      })
    ) {
      sections = groupTemplates(inView, (template: T) => {
        return subcategoryOf(template);
      });
    } else {
      sections = [{ id: "templates", title: "", templates: inView }];
    }

    sections = sections.filter((section: TemplatePickerSection<T>) => {
      return section.templates.length > 0;
    });

    return {
      view: view,
      isSearching: searching,
      typoTokens: typoTokens,
      sections: sections,
      templates: sections.flatMap(
        (section: TemplatePickerSection<T>): Array<T> => {
          return section.templates;
        },
      ),
    };
  };

  const getCounts: (search: string) => Map<TemplatePickerView<C>, number> = (
    searchText: string,
  ): Map<TemplatePickerView<C>, number> => {
    /*
     * The picker prints none of these beside the categories; it reads All
     * templates' count to offer "Search all templates" when a search
     * narrowed to one category finds nothing there but finds matches
     * elsewhere.
     */
    const tokens: Array<string> = getSearchTokens(searchText);
    const typoTokens: Array<string> = getTypoTokens(tokens);
    const counts: Map<TemplatePickerView<C>, number> = new Map();

    for (const info of getViews()) {
      counts.set(
        info.view,
        getTemplatesInView(info.view).filter((template: T) => {
          return matchesSearch(template, tokens, typoTokens);
        }).length,
      );
    }

    return counts;
  };

  const getActiveTemplate: (state: TemplatePickerState<C>) => T | null = (
    state: TemplatePickerState<C>,
  ): T | null => {
    /*
     * - The one picked by a click or the arrow keys, while it is on the
     *   list.
     * - Otherwise, while searching, the best match, so typing and pressing
     *   Enter takes it, as in the command palette.
     * - Otherwise none. Browsing shows no template's details until one is
     *   picked: that is what keeps the step calm when it opens.
     */
    const list: TemplatePickerList<T, C> = getList(state);

    const picked: T | undefined = list.templates.find((template: T) => {
      return template.id === state.selectedTemplateId;
    });

    if (picked) {
      return picked;
    }

    if (list.isSearching) {
      return list.templates[0] || null;
    }

    return null;
  };

  const withSearch: (
    state: TemplatePickerState<C>,
    search: string,
  ) => TemplatePickerState<C> = (
    state: TemplatePickerState<C>,
    searchText: string,
  ): TemplatePickerState<C> => {
    /*
     * A search that starts afresh looks through every template, whatever
     * category was open, and whatever was picked is let go, so the best
     * match is the one picked.
     */
    const wasSearching: boolean = isSearching(state);
    const next: TemplatePickerState<C> = { ...state, search: searchText };

    if (!wasSearching && isSearching(next)) {
      next.searchView = TemplateCollection.All;
    }

    next.selectedTemplateId = null;

    return next;
  };

  const withView: (
    state: TemplatePickerState<C>,
    view: TemplatePickerView<C>,
  ) => TemplatePickerState<C> = (
    state: TemplatePickerState<C>,
    view: TemplatePickerView<C>,
  ): TemplatePickerState<C> => {
    /*
     * Narrows a search, or changes what is being browsed. Whatever was
     * picked is let go: it may not be on the new list, and the details of
     * one that is would open on a list the person has not read yet.
     */
    const next: TemplatePickerState<C> = {
      ...state,
      selectedTemplateId: null,
    };

    if (isSearching(state)) {
      next.searchView = view;
    } else {
      next.browseView = view;
    }

    return next;
  };

  const withSelected: (
    state: TemplatePickerState<C>,
    templateId: string,
  ) => TemplatePickerState<C> = (
    state: TemplatePickerState<C>,
    templateId: string,
  ): TemplatePickerState<C> => {
    return { ...state, selectedTemplateId: templateId };
  };

  const getMovedTemplateId: (
    state: TemplatePickerState<C>,
    move: TemplateMove,
  ) => string | null = (
    state: TemplatePickerState<C>,
    move: TemplateMove,
  ): string | null => {
    /*
     * Stops at either end rather than wrapping round. With nothing picked
     * yet, down picks the first template and up the last, as a combobox's
     * arrows do from its text box.
     */
    const templates: Array<T> = getList(state).templates;

    if (templates.length === 0) {
      return null;
    }

    const first: T = templates[0]!;
    const last: T = templates[templates.length - 1]!;

    if (move === TemplateMove.First) {
      return first.id;
    }

    if (move === TemplateMove.Last) {
      return last.id;
    }

    /*
     * By id: a catalog may build its templates afresh for every list, so the
     * picked one need not be the same object as its row in another list.
     */
    const active: T | null = getActiveTemplate(state);
    const index: number = active
      ? templates.findIndex((candidate: T) => {
          return candidate.id === active.id;
        })
      : -1;

    if (index === -1) {
      return move === TemplateMove.Next ? first.id : last.id;
    }

    const nextIndex: number =
      move === TemplateMove.Next
        ? Math.min(index + 1, templates.length - 1)
        : Math.max(index - 1, 0);

    return templates[nextIndex]!.id;
  };

  return {
    catalog: catalog,
    getViews: getViews,
    getViewInfo: getViewInfo,
    getCategoryLabel: getCategoryLabel,
    getTemplatesInView: getTemplatesInView,
    getSearchTokens: getSearchTokens,
    getTypoTokens: getTypoTokens,
    matchesSearch: matchesSearch,
    getSearchScore: getSearchScore,
    search: search,
    getHighlightSegments: highlightSegmentsOf,
    isSearching: isSearching,
    getCurrentView: getCurrentView,
    getList: getList,
    getCounts: getCounts,
    getActiveTemplate: getActiveTemplate,
    withSearch: withSearch,
    withView: withView,
    withSelected: withSelected,
    getMovedTemplateId: getMovedTemplateId,
  };
};
