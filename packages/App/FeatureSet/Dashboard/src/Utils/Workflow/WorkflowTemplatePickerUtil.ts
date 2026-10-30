/*
 * The workflow template picker's rules: the shared template picker's
 * (Utils/TemplatePicker/TemplatePickerUtil) bound to the workflow catalog,
 * and what a picked workflow template's details say. No React here, so every
 * rule can be tested on its own.
 *
 * The picker started as a wall of forty-odd equally large cards. Its next
 * version opened on a handful of recommended templates but kept a column of
 * categories with counts, a list and a permanent preview side by side, and
 * the maintainer found that too much as well: "extremely hard to use because
 * it shows a lot of information on the modal". So now it shows little until
 * asked: Start from scratch first, a few recommended templates as one-line
 * rows, a search box and a category select, and the details of a template
 * only once it is picked. Dashboards pick their templates the same way
 * (Utils/Dashboard/DashboardTemplatePickerUtil), on the same rules.
 */

import IconProp from "Common/Types/Icon/IconProp";
import ComponentMetadata from "Common/Types/Workflow/Component";
import {
  WorkflowTemplate,
  WorkflowTemplateCategories,
  WorkflowTemplateCategory,
  WorkflowTemplateOutline,
  WorkflowTemplateVariable,
  WorkflowTemplateWhoToPage,
  getRecommendedWorkflowTemplates,
  getWorkflowTemplateCategoryInfo,
  getWorkflowTemplateOutline,
  getWorkflowTemplates,
} from "Common/Types/Workflow/Templates";
import { loadComponentsAndCategories } from "Common/UI/Components/Workflow/Utils";
import {
  ALL_TEMPLATES_VIEW_INFO as ALL_VIEW_INFO,
  INITIAL_TEMPLATE_PICKER_STATE,
  RECOMMENDED_TEMPLATES_VIEW_INFO,
  TemplateCatalog,
  TemplateCountTextFunction,
  TemplateHighlightSegment,
  TemplateMove,
  TemplatePickerList,
  TemplatePickerRules,
  TemplatePickerSection,
  TemplatePickerState,
  TemplatePickerView,
  TemplatePickerViewInfo,
  createTemplatePickerRules,
  templateCountText,
} from "../TemplatePicker/TemplatePickerUtil";

export {
  TemplateCollection as WorkflowTemplateCollection,
  TemplateMove as WorkflowTemplateMove,
} from "../TemplatePicker/TemplatePickerUtil";

export type WorkflowTemplateCountTextFunction = TemplateCountTextFunction;

/*
 * A count and its noun, translated as one phrase - "1 result", "{count}
 * results" - so each language can put the number where its grammar wants it.
 */
export const workflowTemplateCountText: WorkflowTemplateCountTextFunction =
  templateCountText;

/** What the template list is showing: one of the collections, or one category. */
export type WorkflowTemplatePickerView =
  TemplatePickerView<WorkflowTemplateCategory>;

/*
 * A view as the category select offers it. Only its name: the select is
 * meant to be quiet, so it carries no icons, counts or descriptions.
 */
export type WorkflowTemplatePickerViewInfo =
  TemplatePickerViewInfo<WorkflowTemplateCategory>;

export const RECOMMENDED_VIEW_INFO: WorkflowTemplatePickerViewInfo =
  RECOMMENDED_TEMPLATES_VIEW_INFO;

export const ALL_TEMPLATES_VIEW_INFO: WorkflowTemplatePickerViewInfo =
  ALL_VIEW_INFO;

/* ------------------------------ Search ------------------------------ */

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

/** The name the picker shows for a category: in the select, and over its group in All templates. */
export type GetWorkflowTemplateCategoryLabelFunction = (
  category: WorkflowTemplateCategory,
) => string;

export const getWorkflowTemplateCategoryLabel: GetWorkflowTemplateCategoryLabelFunction =
  (category: WorkflowTemplateCategory): string => {
    return getWorkflowTemplateCategoryInfo(category).label;
  };

/*
 * The workflow catalog, as the shared picker reads it. Basics first: the
 * catalog's display order is the select's.
 */
export const WORKFLOW_TEMPLATE_CATALOG: TemplateCatalog<
  WorkflowTemplate,
  WorkflowTemplateCategory
> = {
  getTemplates: getWorkflowTemplates,
  getRecommendedTemplates: getRecommendedWorkflowTemplates,
  categories: WorkflowTemplateCategories,
  getCategoryLabel: getWorkflowTemplateCategoryLabel,
  getCategory: (template: WorkflowTemplate): WorkflowTemplateCategory => {
    return template.category;
  },
  getSubcategory: (template: WorkflowTemplate): string | undefined => {
    return template.subcategory;
  },
  getSearchFields: (template: WorkflowTemplate) => {
    return [
      { text: template.name, weight: NAME_WEIGHT },
      {
        // The category's own name and the one the picker shows, which can differ.
        text: `${template.category} ${getWorkflowTemplateCategoryLabel(
          template.category,
        )} ${template.subcategory || ""}`,
        weight: CATEGORY_WEIGHT,
      },
      { text: template.description, weight: DESCRIPTION_WEIGHT },
      { text: template.teaches, weight: TEACHES_WEIGHT },
    ];
  },
};

/** The shared picker's rules over the workflow catalog. */
export const WORKFLOW_TEMPLATE_PICKER_RULES: TemplatePickerRules<
  WorkflowTemplate,
  WorkflowTemplateCategory
> = createTemplatePickerRules(WORKFLOW_TEMPLATE_CATALOG);

const RULES: TemplatePickerRules<WorkflowTemplate, WorkflowTemplateCategory> =
  WORKFLOW_TEMPLATE_PICKER_RULES;

export type GetWorkflowTemplatePickerViewsFunction =
  () => Array<WorkflowTemplatePickerViewInfo>;

/**
 * Every view, in the order the category select lists them: Recommended, then
 * each category in the catalog's display order, then All templates.
 */
export const getWorkflowTemplatePickerViews: GetWorkflowTemplatePickerViewsFunction =
  RULES.getViews;

export type GetWorkflowTemplatePickerViewInfoFunction = (
  view: WorkflowTemplatePickerView,
) => WorkflowTemplatePickerViewInfo;

export const getWorkflowTemplatePickerViewInfo: GetWorkflowTemplatePickerViewInfoFunction =
  RULES.getViewInfo;

export type GetTemplatesInViewFunction = (
  view: WorkflowTemplatePickerView,
) => Array<WorkflowTemplate>;

/** A view's templates, in its own order: curated for Recommended, the catalog's otherwise. */
export const getTemplatesInView: GetTemplatesInViewFunction =
  RULES.getTemplatesInView;

export type GetWorkflowTemplateSearchTokensFunction = (
  search: string,
) => Array<string>;

/**
 * The words a search is matched on, lower case and each once, without the
 * ones that say nothing. Empty when nothing searchable was typed.
 */
export const getWorkflowTemplateSearchTokens: GetWorkflowTemplateSearchTokensFunction =
  RULES.getSearchTokens;

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
  RULES.getTypoTokens;

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
  RULES.matchesSearch;

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
  RULES.getSearchScore;

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
export const searchWorkflowTemplates: SearchWorkflowTemplatesFunction =
  RULES.search;

export type WorkflowTemplateHighlightSegment = TemplateHighlightSegment;

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
  RULES.getHighlightSegments;

/* ------------------------------ State ------------------------------- */

/*
 * Everything the picker remembers. It lives in the wizard, not in the picker,
 * so stepping back from Name finds the picker as it was left: the same
 * search, the same category and the same template picked.
 */
export type WorkflowTemplatePickerState =
  TemplatePickerState<WorkflowTemplateCategory>;

export const INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE: WorkflowTemplatePickerState =
  { ...INITIAL_TEMPLATE_PICKER_STATE };

export type IsSearchingFunction = (
  state: WorkflowTemplatePickerState,
) => boolean;

export const isSearchingTemplates: IsSearchingFunction = RULES.isSearching;

export type GetCurrentViewFunction = (
  state: WorkflowTemplatePickerState,
) => WorkflowTemplatePickerView;

/** The view the list shows: the search's while searching, the browsing one otherwise. */
export const getCurrentWorkflowTemplatePickerView: GetCurrentViewFunction =
  RULES.getCurrentView;

export type WorkflowTemplatePickerSection =
  TemplatePickerSection<WorkflowTemplate>;

export type WorkflowTemplatePickerList = TemplatePickerList<
  WorkflowTemplate,
  WorkflowTemplateCategory
>;

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
  RULES.getList;

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
  RULES.getCounts;

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
export const getActiveWorkflowTemplate: GetActiveWorkflowTemplateFunction =
  RULES.getActiveTemplate;

export type WithSearchFunction = (
  state: WorkflowTemplatePickerState,
  search: string,
) => WorkflowTemplatePickerState;

/**
 * Typing. A search that starts afresh looks through every template, whatever
 * category was open, and whatever was picked is let go, so the best match
 * is the one picked.
 */
export const withWorkflowTemplateSearch: WithSearchFunction = RULES.withSearch;

export type WithViewFunction = (
  state: WorkflowTemplatePickerState,
  view: WorkflowTemplatePickerView,
) => WorkflowTemplatePickerState;

/**
 * Choosing a category: narrows a search, or changes what is being browsed.
 * Whatever was picked is let go: it may not be on the new list, and the
 * details of one that is would open on a list the person has not read yet.
 */
export const withWorkflowTemplateView: WithViewFunction = RULES.withView;

export type WithSelectedFunction = (
  state: WorkflowTemplatePickerState,
  templateId: string,
) => WorkflowTemplatePickerState;

/** Picking a template: a click on its row, or the arrow keys landing on it. */
export const withWorkflowTemplateSelected: WithSelectedFunction =
  RULES.withSelected;

export type GetMovedWorkflowTemplateIdFunction = (
  state: WorkflowTemplatePickerState,
  move: TemplateMove,
) => string | null;

/**
 * The template an arrow key (or Home, or End) picks. Stops at either end
 * rather than wrapping round. With nothing picked yet, down picks the first
 * template and up the last, as a combobox's arrows do from its text box.
 */
export const getMovedWorkflowTemplateId: GetMovedWorkflowTemplateIdFunction =
  RULES.getMovedTemplateId;

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
  /** Who its Page steps page, which the Configure step asks after the settings. */
  whoToPage: Array<WorkflowTemplateWhoToPage>;
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

// Every dash of a component id, read as a space when the id is all there is to name it by.
const COMPONENT_ID_DASHES: RegExp = /-/g;

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
  const words: string = componentId.replace(COMPONENT_ID_DASHES, " ");

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
    whoToPage: [...(template.whoToPage || [])],
  };
};
