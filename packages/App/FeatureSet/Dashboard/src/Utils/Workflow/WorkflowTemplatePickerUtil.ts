/*
 * The pure half of the workflow template picker: which templates it shows,
 * in what order, how search finds and ranks them, and what the preview says
 * about one. No React here, so every rule can be tested on its own.
 *
 * The picker this serves replaced a wall of forty-odd equally large cards,
 * all on screen at once, that the maintainer described as decision paralysis.
 * It now opens on a handful of recommended templates and keeps the rest
 * behind a short list of categories, each with its count, and a search that
 * reads every word typed. Picking a template shows what it does before
 * anything is created.
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

/** The two lists that are not a category: the starting handful, and everything. */
export enum WorkflowTemplateCollection {
  Recommended = "recommended",
  All = "all",
}

/** What the template list is showing: one of the collections, or one category. */
export type WorkflowTemplatePickerView =
  | WorkflowTemplateCollection
  | WorkflowTemplateCategory;

export interface WorkflowTemplatePickerViewInfo {
  view: WorkflowTemplatePickerView;
  /** The name in the list of categories, and the list's heading. */
  label: string;
  /** One line under the heading. */
  description: string;
  icon: IconProp;
}

export const RECOMMENDED_VIEW_INFO: WorkflowTemplatePickerViewInfo = {
  view: WorkflowTemplateCollection.Recommended,
  label: "Recommended",
  description: "A few good places to start.",
  icon: IconProp.Star,
};

export const ALL_TEMPLATES_VIEW_INFO: WorkflowTemplatePickerViewInfo = {
  view: WorkflowTemplateCollection.All,
  label: "All templates",
  description: "Every template, grouped by what it is for.",
  icon: IconProp.Squares,
};

export type GetWorkflowTemplatePickerViewsFunction =
  () => Array<WorkflowTemplatePickerViewInfo>;

/**
 * Every view, in the order the picker lists them: Recommended, then each
 * category in the catalog's display order, then All templates.
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
            description: info.description,
            icon: info.icon,
          };
        },
      ),
      ALL_TEMPLATES_VIEW_INFO,
    ];
  };

export type GetWorkflowTemplateCategoryLabelFunction = (
  category: WorkflowTemplateCategory,
) => string;

/** The name the picker shows for a category, on its rows and in the preview too. */
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

export type GetWorkflowTemplateSearchTokensFunction = (
  search: string,
) => Array<string>;

/** The words of a search, in lower case, each once. Empty when nothing was typed. */
export const getWorkflowTemplateSearchTokens: GetWorkflowTemplateSearchTokensFunction =
  (search: string): Array<string> => {
    const tokens: Array<string> = search
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter((token: string) => {
        return token.length > 0;
      });

    return Array.from(new Set(tokens));
  };

type WordsOfFunction = (text: string) => Array<string>;

const wordsOf: WordsOfFunction = (text: string): Array<string> => {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word: string) => {
      return word.length > 0;
    });
};

interface SearchField {
  text: string;
  /** Points for a word in this field that starts with the token. */
  wordStart: number;
  /** Points for the token anywhere else in the field. */
  anywhere: number;
}

type SearchFieldsFunction = (template: WorkflowTemplate) => Array<SearchField>;

/*
 * What a search reads, and how much a hit in each is worth. The template's
 * own words only: the category's description is left out on purpose, because
 * the Jira category's mentions both incidents and alerts, and searching for
 * "alert" would then bring back every incident Jira template as well.
 *
 * What a template teaches is searched but not scored. It is about the
 * builder, not about the job ("how to read a Jira changelog"), so a word in it
 * should find a template without lifting it over one whose name says it.
 */
const searchFields: SearchFieldsFunction = (
  template: WorkflowTemplate,
): Array<SearchField> => {
  return [
    { text: template.name, wordStart: 70, anywhere: 40 },
    {
      // The category's own name and the one the picker shows, which can differ.
      text: `${template.category} ${getWorkflowTemplateCategoryLabel(
        template.category,
      )} ${template.subcategory || ""}`,
      wordStart: 30,
      anywhere: 20,
    },
    { text: template.description, wordStart: 15, anywhere: 10 },
    { text: template.teaches, wordStart: 0, anywhere: 0 },
  ];
};

/** Extra points when the name itself starts with the word: "jira" finds "Jira…" first. */
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

type TokenScoreFunction = (template: WorkflowTemplate, token: string) => number;

const tokenScore: TokenScoreFunction = (
  template: WorkflowTemplate,
  token: string,
): number => {
  let score: number = 0;

  for (const field of searchFields(template)) {
    const text: string = field.text.toLowerCase();

    if (
      wordsOf(text).some((word: string) => {
        return word.startsWith(token);
      })
    ) {
      score += field.wordStart;
    } else if (text.includes(token)) {
      score += field.anywhere;
    }
  }

  if (template.name.toLowerCase().startsWith(token)) {
    score += NAME_PREFIX_BONUS;
  }

  return score;
};

export type WorkflowTemplateMatchesSearchFunction = (
  template: WorkflowTemplate,
  tokens: Array<string>,
) => boolean;

/**
 * Does this template match every word typed? Each word may be found in a
 * different place - the name, the category, the description or what the
 * template teaches - so "slack monitor" finds "Tell Slack when a monitor
 * changes status", which a search for the whole phrase never would.
 */
export const workflowTemplateMatchesSearch: WorkflowTemplateMatchesSearchFunction =
  (template: WorkflowTemplate, tokens: Array<string>): boolean => {
    if (tokens.length === 0) {
      return true;
    }

    const haystack: string = searchFields(template)
      .map((field: SearchField) => {
        return field.text;
      })
      .join(" ")
      .toLowerCase();

    return tokens.every((token: string) => {
      return haystack.includes(token);
    });
  };

export type GetWorkflowTemplateSearchScoreFunction = (
  template: WorkflowTemplate,
  tokens: Array<string>,
  phrase?: string | undefined,
) => number;

/**
 * How well a template matches, summed over the words typed, plus a large
 * bonus when its name holds the phrase typed (by default, the words in the
 * order given). Higher is better.
 */
export const getWorkflowTemplateSearchScore: GetWorkflowTemplateSearchScoreFunction =
  (
    template: WorkflowTemplate,
    tokens: Array<string>,
    phrase?: string | undefined,
  ): number => {
    const wordScore: number = tokens.reduce(
      (total: number, token: string): number => {
        return total + tokenScore(template, token);
      },
      0,
    );
    const wholePhrase: string = phrase ?? tokens.join(" ");
    const hasPhrase: boolean =
      tokens.length > 1 &&
      wholePhrase.length > 0 &&
      template.name.toLowerCase().includes(wholePhrase);

    return wordScore + (hasPhrase ? NAME_PHRASE_BONUS : 0);
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

  const phrase: string = searchPhraseOf(search);

  return templates
    .map((template: WorkflowTemplate, index: number) => {
      return {
        template: template,
        index: index,
        score: getWorkflowTemplateSearchScore(template, tokens, phrase),
      };
    })
    .filter((entry: { template: WorkflowTemplate }) => {
      return workflowTemplateMatchesSearch(entry.template, tokens);
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

export interface WorkflowTemplateHighlightSegment {
  text: string;
  isMatch: boolean;
}

const escapeRegExp: (value: string) => string = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

export type GetWorkflowTemplateHighlightSegmentsFunction = (
  text: string,
  tokens: Array<string>,
) => Array<WorkflowTemplateHighlightSegment>;

/**
 * The text cut into pieces, each marked by whether it is one of the words
 * typed, so the row can highlight them. Longer words are tried first, so
 * typing "inc incident" marks "incident" whole rather than "inc" and a rest.
 */
export const getWorkflowTemplateHighlightSegments: GetWorkflowTemplateHighlightSegmentsFunction =
  (
    text: string,
    tokens: Array<string>,
  ): Array<WorkflowTemplateHighlightSegment> => {
    if (tokens.length === 0 || text.length === 0) {
      return [{ text: text, isMatch: false }];
    }

    const pattern: RegExp = new RegExp(
      `(${[...tokens]
        .sort((a: string, b: string) => {
          return b.length - a.length;
        })
        .map(escapeRegExp)
        .join("|")})`,
      "gi",
    );

    return text
      .split(pattern)
      .filter((piece: string) => {
        return piece.length > 0;
      })
      .map((piece: string): WorkflowTemplateHighlightSegment => {
        return {
          text: piece,
          isMatch: tokens.includes(piece.toLowerCase()),
        };
      });
  };

/* ------------------------------ State ------------------------------- */

/*
 * Everything the picker remembers. It lives in the wizard, not in the picker,
 * so stepping back from Name finds the picker as it was left: the same
 * search, the same category and the same template highlighted.
 */
export interface WorkflowTemplatePickerState {
  search: string;
  /** The view picked while browsing. Kept through a search, and back when it is cleared. */
  browseView: WorkflowTemplatePickerView;
  /** The view a search is narrowed to. A new search starts on All templates. */
  searchView: WorkflowTemplatePickerView;
  /**
   * The template highlighted, previewed, and used by Enter or "Use this
   * template". Null means the first one in the list.
   */
  activeTemplateId: string | null;
  /**
   * Narrow screens have no room for the preview beside the list, so opening
   * a template shows its preview in the list's place, with a way back.
   */
  isPreviewOpen: boolean;
}

export const INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE: WorkflowTemplatePickerState =
  {
    search: "",
    browseView: WorkflowTemplateCollection.Recommended,
    searchView: WorkflowTemplateCollection.All,
    activeTemplateId: null,
    isPreviewOpen: false,
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
 * match. Shown beside each category, so a search also says where its matches
 * are.
 */
export const getWorkflowTemplatePickerCounts: GetWorkflowTemplatePickerCountsFunction =
  (search: string): Map<WorkflowTemplatePickerView, number> => {
    const tokens: Array<string> = getWorkflowTemplateSearchTokens(search);
    const counts: Map<WorkflowTemplatePickerView, number> = new Map();

    for (const info of getWorkflowTemplatePickerViews()) {
      counts.set(
        info.view,
        getTemplatesInView(info.view).filter((template: WorkflowTemplate) => {
          return workflowTemplateMatchesSearch(template, tokens);
        }).length,
      );
    }

    return counts;
  };

export type GetActiveWorkflowTemplateFunction = (
  state: WorkflowTemplatePickerState,
) => WorkflowTemplate | null;

/**
 * The template the picker has highlighted: the one picked, while it is still
 * on the list, and otherwise the first on the list - so there is always a
 * template to preview and to use, and after a search it is the best match.
 * Null only when the list is empty.
 */
export const getActiveWorkflowTemplate: GetActiveWorkflowTemplateFunction = (
  state: WorkflowTemplatePickerState,
): WorkflowTemplate | null => {
  const templates: Array<WorkflowTemplate> =
    getWorkflowTemplatePickerList(state).templates;

  return (
    templates.find((template: WorkflowTemplate) => {
      return template.id === state.activeTemplateId;
    }) ||
    templates[0] ||
    null
  );
};

export type WithSearchFunction = (
  state: WorkflowTemplatePickerState,
  search: string,
) => WorkflowTemplatePickerState;

/**
 * Typing. A search that starts afresh looks through every template, whatever
 * category was open; the best match becomes the highlighted one.
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

  next.activeTemplateId = null;
  next.isPreviewOpen = false;

  return next;
};

export type WithViewFunction = (
  state: WorkflowTemplatePickerState,
  view: WorkflowTemplatePickerView,
) => WorkflowTemplatePickerState;

/** Choosing a category: narrows a search, or changes what is being browsed. */
export const withWorkflowTemplateView: WithViewFunction = (
  state: WorkflowTemplatePickerState,
  view: WorkflowTemplatePickerView,
): WorkflowTemplatePickerState => {
  const next: WorkflowTemplatePickerState = {
    ...state,
    activeTemplateId: null,
    isPreviewOpen: false,
  };

  if (isSearchingTemplates(state)) {
    next.searchView = view;
  } else {
    next.browseView = view;
  }

  return next;
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
 * The template an arrow key (or Home, or End) moves the highlight to. Stops
 * at either end rather than wrapping round.
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

  if (move === WorkflowTemplateMove.First) {
    return templates[0]!.id;
  }

  if (move === WorkflowTemplateMove.Last) {
    return templates[templates.length - 1]!.id;
  }

  /*
   * By id: every list is built from fresh template objects, so the highlighted
   * one is never the same object as its row in another list.
   */
  const active: WorkflowTemplate | null = getActiveWorkflowTemplate(state);
  const index: number = Math.max(
    0,
    templates.findIndex((candidate: WorkflowTemplate) => {
      return candidate.id === active?.id;
    }),
  );
  const nextIndex: number =
    move === WorkflowTemplateMove.Next
      ? Math.min(index + 1, templates.length - 1)
      : Math.max(index - 1, 0);

  return templates[nextIndex]!.id;
};

/* ------------------------------ Preview ----------------------------- */

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

/** Everything the preview shows about a template, before anything is created. */
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
