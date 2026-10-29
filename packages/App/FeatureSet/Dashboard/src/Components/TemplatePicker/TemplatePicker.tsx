/*
 * The first step of a create wizard that starts from a template: how to
 * start. Create a workflow (Components/Workflow/WorkflowTemplatePicker) and
 * Create a dashboard (Components/Dashboard/DashboardTemplatePicker) both draw
 * it, each over its own catalog, so the two read and work the same way.
 *
 * The maintainer, about the workflow picker before this one: "This select
 * template for workflow is extremely hard to use because it shows a lot of
 * information on the modal ... 'Start from scratch' should be more visible
 * as well because that's the most commonly used option." And, about the
 * dashboard templates' wall of cards: "The workflow templates model is a lot
 * easier to understand and use. Please make the dashboard templates model
 * like workflow templates."
 *
 * So the step reads top to bottom, and shows little until asked:
 *
 * - Start from scratch, first and largest. One click goes on to the next
 *   step.
 * - "Or start from a template": a few recommended templates as one-line
 *   rows, with a search box and a category select beside the heading.
 * - A template's details - what the catalog says it is made of - open
 *   inside its row once it is picked, and nowhere else (renderDetails).
 * - The dialog's one primary button is in its footer, and only there while
 *   a template is picked ("Use this template", drawn by the wizard).
 *
 * The keyboard works as the command palette's does. The search box is a
 * combobox over the list: the arrow keys pick while typing, Enter uses what
 * is picked, and a search picks its best match on its own. The list takes
 * the arrow keys, Home and End once it has the focus, and "/" jumps to the
 * search from anywhere in the step. Start from scratch is a button, and is
 * where the focus starts.
 *
 * Everything it remembers is held by the wizard (TemplatePickerState), so
 * Back from the next step finds it as it was left. Every id and test id in
 * it starts with the wizard's idPrefix ("workflow", "dashboard").
 */

import React, { ReactElement, useEffect, useMemo, useRef } from "react";
import { Indigo500 } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Loader, { LoaderType } from "Common/UI/Components/Loader/Loader";
import useTranslateValue from "Common/UI/Utils/Translation";
import {
  TemplateCollection,
  TemplateHighlightSegment,
  TemplateMove,
  TemplatePickerList,
  TemplatePickerRules,
  TemplatePickerSection,
  TemplatePickerState,
  TemplatePickerTemplate,
  TemplatePickerView,
  TemplatePickerViewInfo,
  templateCountText,
} from "../../Utils/TemplatePicker/TemplatePickerUtil";
import { isComposingKey } from "../../Utils/TemplatePicker/WizardKeys";

/** A template as the picker draws its row: an icon, a name and a line of description. */
export interface TemplatePickerRowTemplate extends TemplatePickerTemplate {
  icon: IconProp;
}

export interface ComponentProps<
  T extends TemplatePickerRowTemplate,
  C extends string,
> {
  /** What every id and test id in the step starts with: "workflow", "dashboard". */
  idPrefix: string;
  rules: TemplatePickerRules<T, C>;
  state: TemplatePickerState<C>;
  onStateChange: (state: TemplatePickerState<C>) => void;
  /** Go on to the next step with this template. */
  onUseTemplate: (template: T) => void;
  /** Go on to the next step with nothing to start from. */
  onStartFromScratch: () => void;
  /** Nothing to start from is the start already chosen, as after Back. */
  isStartFromScratchChosen: boolean;
  /**
   * Under Start from scratch: what an empty start gives. Translated by the
   * wizard, which says it in its own words ("an empty canvas", "an empty
   * dashboard").
   */
  startFromScratchDescription: string;
  /** What the picked template's row opens to show, under its description. */
  renderDetails?: ((template: T) => ReactElement | null) | undefined;
  /*
   * A template taken, while the wizard still waits for something before it
   * can go on with it (a dashboard's name waits for the names the project
   * has). Its row says so.
   */
  busyTemplateId?: string | null | undefined;
}

/** The ids the step gives its parts, from the wizard's prefix. */
export interface TemplatePickerIds {
  picker: string;
  startFromScratch: string;
  startFromScratchDescription: string;
  searchInput: string;
  searchClear: string;
  viewSelect: string;
  listHeading: string;
  listbox: string;
  resultCount: string;
  empty: string;
  emptyClear: string;
  searchEverywhere: string;
}

type TemplatePickerIdsFunction = (idPrefix: string) => TemplatePickerIds;

export const getTemplatePickerIds: TemplatePickerIdsFunction = (
  idPrefix: string,
): TemplatePickerIds => {
  return {
    picker: `${idPrefix}-template-picker`,
    startFromScratch: `${idPrefix}-start-from-scratch`,
    startFromScratchDescription: `${idPrefix}-start-from-scratch-description`,
    searchInput: `${idPrefix}-template-search`,
    searchClear: `${idPrefix}-template-search-clear`,
    viewSelect: `${idPrefix}-template-view-select`,
    listHeading: `${idPrefix}-template-list-heading`,
    listbox: `${idPrefix}-template-listbox`,
    resultCount: `${idPrefix}-template-result-count`,
    empty: `${idPrefix}-template-empty`,
    emptyClear: `${idPrefix}-template-empty-clear`,
    searchEverywhere: `${idPrefix}-template-search-everywhere`,
  };
};

type OptionDomIdFunction = (idPrefix: string, templateId: string) => string;

/** A template's row: its DOM id and test id. */
export const templateOptionDomId: OptionDomIdFunction = (
  idPrefix: string,
  templateId: string,
): string => {
  return `${idPrefix}-template-option-${templateId}`;
};

/*
 * The product's plain secondary button, for the two ways out of an empty
 * search. Never filled: the dialog's one primary action is in its footer.
 */
const SECONDARY_BUTTON_CLASS_NAME: string =
  "inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors duration-150 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

type TranslateFunction = (value: string) => string;

type HighlightFunction = (
  text: string,
  tokens: Array<string>,
  typoTokens?: Array<string> | undefined,
) => Array<TemplateHighlightSegment>;

interface HighlightedTextProps {
  text: string;
  tokens: Array<string>;
  typoTokens: Array<string>;
  getSegments: HighlightFunction;
}

// What a search matched, marked as the workflow builder's Add Component picker marks it.
const HighlightedText: (props: HighlightedTextProps) => ReactElement = (
  props: HighlightedTextProps,
): ReactElement => {
  return (
    <>
      {props
        .getSegments(props.text, props.tokens, props.typoTokens)
        .map(
          (segment: TemplateHighlightSegment, index: number): ReactElement => {
            if (!segment.isMatch) {
              return (
                <React.Fragment key={index}>{segment.text}</React.Fragment>
              );
            }

            return (
              <mark
                key={index}
                className="bg-transparent font-semibold text-indigo-700"
              >
                {segment.text}
              </mark>
            );
          },
        )}
    </>
  );
};

interface TemplateOptionProps {
  idPrefix: string;
  template: TemplatePickerRowTemplate;
  isActive: boolean;
  isBusy: boolean;
  /** The picked template's details, shown in its row. */
  details: ReactElement | null;
  tokens: Array<string>;
  typoTokens: Array<string>;
  getSegments: HighlightFunction;
  onPick: () => void;
  onUse: () => void;
}

const TemplateOption: (props: TemplateOptionProps) => ReactElement = (
  props: TemplateOptionProps,
): ReactElement => {
  const template: TemplatePickerRowTemplate = props.template;
  const optionId: string = templateOptionDomId(props.idPrefix, template.id);

  return (
    <div
      id={optionId}
      role="option"
      aria-selected={props.isActive}
      aria-labelledby={`${optionId}-name`}
      aria-describedby={`${optionId}-description`}
      aria-busy={props.isBusy ? true : undefined}
      data-testid={optionId}
      onClick={props.onPick}
      onDoubleClick={props.onUse}
      className={`cursor-pointer scroll-my-2 px-3 py-3 transition-colors duration-100 sm:px-4 ${
        props.isActive ? "bg-indigo-50/60" : "hover:bg-gray-50"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${
            props.isActive
              ? "bg-white text-indigo-600 ring-1 ring-indigo-200"
              : "bg-gray-100 text-gray-500"
          }`}
        >
          <Icon icon={template.icon} className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div
            id={`${optionId}-name`}
            className="text-sm font-medium leading-5 text-gray-900"
          >
            <HighlightedText
              text={template.name}
              tokens={props.tokens}
              typoTokens={props.typoTokens}
              getSegments={props.getSegments}
            />
          </div>
          {/*
           * One line while the row is closed, so the list reads at a glance;
           * all of it once the template is picked.
           */}
          <div
            id={`${optionId}-description`}
            className={`mt-0.5 text-sm leading-5 text-gray-500 ${
              props.isActive ? "" : "truncate"
            }`}
          >
            <HighlightedText
              text={template.description}
              tokens={props.tokens}
              typoTokens={props.typoTokens}
              getSegments={props.getSegments}
            />
          </div>
          {props.isBusy ? (
            /*
             * Taken, and waiting a moment before the next step can open:
             * usually too short to see, on a slow connection it says the
             * click was heard.
             */
            <div className="mt-2 w-16" data-testid={`${optionId}-busy`}>
              <Loader loaderType={LoaderType.Bar} size={64} color={Indigo500} />
            </div>
          ) : (
            <></>
          )}
          {props.isActive && props.details ? props.details : <></>}
        </div>
      </div>
    </div>
  );
};

const TemplatePicker: <T extends TemplatePickerRowTemplate, C extends string>(
  props: ComponentProps<T, C>,
) => ReactElement = <T extends TemplatePickerRowTemplate, C extends string>(
  props: ComponentProps<T, C>,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const tx: TranslateFunction = (value: string): string => {
    return translateString(value) || value;
  };

  const ids: TemplatePickerIds = getTemplatePickerIds(props.idPrefix);
  const rules: TemplatePickerRules<T, C> = props.rules;

  const scratchButtonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const searchInputRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);
  const listboxRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  // Set when the keyboard picks a row, so it is brought into view once drawn.
  const scrollPickedIntoViewRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const state: TemplatePickerState<C> = props.state;

  const views: Array<TemplatePickerViewInfo<C>> = useMemo(() => {
    return rules.getViews();
  }, [rules]);

  const list: TemplatePickerList<T, C> = useMemo(() => {
    return rules.getList(state);
  }, [rules, state]);

  const tokens: Array<string> = useMemo(() => {
    return rules.getSearchTokens(state.search);
  }, [rules, state.search]);

  const activeTemplate: T | null = useMemo(() => {
    return rules.getActiveTemplate(state);
  }, [rules, state]);

  // Only read for an empty search narrowed to one category.
  const allMatchCount: number = useMemo(() => {
    if (!list.isSearching || list.templates.length > 0) {
      return 0;
    }

    return rules.getCounts(state.search).get(TemplateCollection.All) || 0;
  }, [rules, list, state.search]);

  /*
   * Where the focus starts. When the dialog opens that is Start from scratch,
   * the first thing in it and the most common choice, so Enter takes it (the
   * dialog puts its focus there too). Back from the next step returns to
   * what was chosen: the list, with the template picked, or Start from
   * scratch.
   */
  useEffect(() => {
    if (activeTemplate && !props.isStartFromScratchChosen) {
      listboxRef.current?.focus();
      return;
    }

    scratchButtonRef.current?.focus();
    // Only on arrival: afterwards the focus is the person's own.
  }, []);

  // A row the keyboard picked is brought into view, details and all.
  useEffect(() => {
    if (!scrollPickedIntoViewRef.current || !activeTemplate) {
      return;
    }

    scrollPickedIntoViewRef.current = false;

    const row: HTMLElement | null = document.getElementById(
      templateOptionDomId(props.idPrefix, activeTemplate.id),
    );

    if (row && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [activeTemplate?.id]);

  /*
   * "/" goes to the search from anywhere in the step, as it does in the
   * workflow builder's Add Component panel. Not while typing somewhere else.
   */
  useEffect(() => {
    const onKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.defaultPrevented
      ) {
        return;
      }

      const target: HTMLElement | null = event.target as HTMLElement | null;

      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      searchInputRef.current?.focus();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  type ChangeFunction = (next: TemplatePickerState<C>) => void;

  const change: ChangeFunction = (next: TemplatePickerState<C>): void => {
    props.onStateChange(next);
  };

  type SetSearchFunction = (search: string) => void;

  const setSearch: SetSearchFunction = (search: string): void => {
    change(rules.withSearch(state, search));
  };

  type MoveFunction = (move: TemplateMove) => void;

  const movePick: MoveFunction = (move: TemplateMove): void => {
    const nextId: string | null = rules.getMovedTemplateId(state, move);

    if (!nextId) {
      return;
    }

    scrollPickedIntoViewRef.current = true;
    change(rules.withSelected(state, nextId));
  };

  type StartFromPickedFunction = () => void;

  /*
   * Not a hook, so not named like one: React reads any use + capital name as
   * a hook, and this one is called from a key handler.
   */
  const startFromPickedTemplate: StartFromPickedFunction = (): void => {
    if (activeTemplate) {
      props.onUseTemplate(activeTemplate);
    }
  };

  type ListKeyDownFunction = (event: React.KeyboardEvent<HTMLElement>) => void;

  // The keys the list answers to, from the search box or from the list itself.
  const onListKeys: ListKeyDownFunction = (
    event: React.KeyboardEvent<HTMLElement>,
  ): void => {
    // Keys an input method is still handling, a CJK search being typed, are its own.
    if (isComposingKey(event)) {
      return;
    }

    const isInSearch: boolean = event.currentTarget === searchInputRef.current;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        movePick(TemplateMove.Next);
        return;
      case "ArrowUp":
        event.preventDefault();
        movePick(TemplateMove.Previous);
        return;
      case "Home":
        // In the search box, Home and End move the caret.
        if (!isInSearch) {
          event.preventDefault();
          movePick(TemplateMove.First);
        }
        return;
      case "End":
        if (!isInSearch) {
          event.preventDefault();
          movePick(TemplateMove.Last);
        }
        return;
      case "Enter":
        event.preventDefault();
        startFromPickedTemplate();
        return;
      case " ":
        // The list does not scroll the dialog on Space.
        if (!isInSearch) {
          event.preventDefault();
        }
        return;
      case "Escape":
        /*
         * A search is cleared first; only an empty one lets Escape through to
         * the dialog, which closes. The dialog skips a key already handled.
         */
        if (isInSearch && state.search.length > 0) {
          event.preventDefault();
          setSearch("");
        }
        return;
      default:
        return;
    }
  };

  type SelectViewFunction = (view: TemplatePickerView<C>) => void;

  const selectView: SelectViewFunction = (
    view: TemplatePickerView<C>,
  ): void => {
    change(rules.withView(state, view));
  };

  const resultCountText: string = templateCountText(
    tx,
    list.templates.length,
    "1 result",
    "{count} results",
  );

  type RenderOptionFunction = (template: T) => ReactElement;

  const renderOption: RenderOptionFunction = (template: T): ReactElement => {
    const isActive: boolean = activeTemplate?.id === template.id;

    return (
      <TemplateOption
        key={template.id}
        idPrefix={props.idPrefix}
        template={template}
        isActive={isActive}
        isBusy={Boolean(
          props.busyTemplateId && props.busyTemplateId === template.id,
        )}
        details={
          isActive && props.renderDetails ? props.renderDetails(template) : null
        }
        tokens={tokens}
        typoTokens={list.typoTokens}
        getSegments={rules.getHighlightSegments}
        onPick={() => {
          change(rules.withSelected(state, template.id));
        }}
        onUse={() => {
          props.onUseTemplate(template);
        }}
      />
    );
  };

  return (
    <div data-testid={ids.picker}>
      {/*
       * The most common way to start, so it comes first and stands out: the
       * one card in the step, with the brand's colour on its icon. One click
       * goes on to the next step. Not a filled button - the dialog's one
       * primary action is in its footer.
       */}
      <button
        ref={scratchButtonRef}
        id={ids.startFromScratch}
        type="button"
        data-testid={ids.startFromScratch}
        aria-describedby={ids.startFromScratchDescription}
        aria-current={props.isStartFromScratchChosen ? "true" : undefined}
        onClick={props.onStartFromScratch}
        className={`group flex w-full items-center gap-4 rounded-xl border p-4 text-left shadow-sm transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
          props.isStartFromScratchChosen
            ? "border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500"
            : "border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40"
        }`}
      >
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200">
          <Icon icon={IconProp.Add} className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-5 text-gray-900">
            {tx("Start from scratch")}
          </div>
          <div
            id={ids.startFromScratchDescription}
            className="mt-0.5 text-sm leading-5 text-gray-600"
          >
            {props.startFromScratchDescription}
          </div>
        </div>
        <Icon
          icon={
            props.isStartFromScratchChosen
              ? IconProp.Check
              : IconProp.ArrowRight
          }
          className="h-5 w-5 flex-shrink-0 text-indigo-600 transition-transform duration-150 group-hover:translate-x-0.5"
        />
      </button>

      <div className="mt-7">
        {/*
         * The heading, then search and categories, kept small: they are there
         * for whoever needs more than the few the list opens on. Laid out for
         * the room there is, so the heading stays one line in every language:
         *
         * - lg and up, where the dialog has all of its 48rem: one row,
         *   heading, search, select - the longest heading and categories
         *   (Portuguese) fit it. Narrower, the three squeezed the heading
         *   into two or three lines.
         * - sm to lg: the select beside the heading, the search a row of its
         *   own.
         * - a phone: one under the other. The select is as wide as its
         *   longest category, so beside the heading it pushed the heading
         *   into two lines, three in Russian.
         *
         * Wherever it is, the search is wide enough to read its prompt: 14.5rem
         * holds the longest, French "Rechercher des modèles…", beside the
         * search icon.
         */}
        <div className="grid grid-cols-1 items-center gap-y-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-2 lg:grid-cols-[minmax(0,1fr)_14.5rem_auto]">
          <h3
            id={ids.listHeading}
            className="min-w-0 text-sm font-semibold text-gray-900 sm:col-start-1 sm:row-start-1"
          >
            {tx("Or start from a template")}
          </h3>
          <div className="relative min-w-0 sm:col-span-2 sm:row-start-2 lg:col-span-1 lg:col-start-2 lg:row-start-1">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5">
              <Icon icon={IconProp.Search} className="h-4 w-4 text-gray-400" />
            </div>
            <input
              data-unsaved-changes-ignore
              ref={searchInputRef}
              id={ids.searchInput}
              data-testid={ids.searchInput}
              type="text"
              role="combobox"
              aria-expanded={true}
              aria-autocomplete="list"
              aria-controls={ids.listbox}
              aria-activedescendant={
                activeTemplate
                  ? templateOptionDomId(props.idPrefix, activeTemplate.id)
                  : undefined
              }
              aria-label={tx("Search templates…")}
              placeholder={tx("Search templates…")}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={state.search}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setSearch(event.target.value);
              }}
              onKeyDown={onListKeys}
              /*
               * Room on the right for the clear button only while it is
               * there: kept always, it cut the prompt short ("Vorlagen
               * durchsuchen..") in the languages whose prompt is longest.
               */
              className={`block w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                state.search.length > 0 ? "pr-8" : "pr-3"
              }`}
            />
            {state.search.length > 0 ? (
              <div className="absolute inset-y-0 right-0 flex items-center pr-1.5">
                <button
                  type="button"
                  data-testid={ids.searchClear}
                  aria-label={tx("Clear search")}
                  title={tx("Clear search")}
                  onClick={() => {
                    setSearch("");
                    searchInputRef.current?.focus();
                  }}
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <></>
            )}
          </div>
          <select
            id={ids.viewSelect}
            data-testid={ids.viewSelect}
            aria-label={tx("Template categories")}
            value={String(list.view)}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              selectView(event.target.value as TemplatePickerView<C>);
            }}
            className="w-full min-w-0 rounded-md border border-gray-300 bg-white py-1.5 pl-3 pr-8 text-sm text-gray-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:col-start-2 sm:row-start-1 sm:w-auto lg:col-start-3"
          >
            {views.map((info: TemplatePickerViewInfo<C>): ReactElement => {
              return (
                <option key={String(info.view)} value={String(info.view)}>
                  {tx(info.label)}
                </option>
              );
            })}
          </select>
        </div>

        <p className="sr-only" aria-live="polite" data-testid={ids.resultCount}>
          {list.isSearching ? resultCountText : ""}
        </p>

        <div
          ref={listboxRef}
          id={ids.listbox}
          role="listbox"
          aria-labelledby={ids.listHeading}
          aria-activedescendant={
            activeTemplate
              ? templateOptionDomId(props.idPrefix, activeTemplate.id)
              : undefined
          }
          tabIndex={0}
          data-testid={ids.listbox}
          onKeyDown={onListKeys}
          className={`mt-3 overflow-hidden rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            list.templates.length > 0
              ? "divide-y divide-gray-200 border border-gray-200"
              : ""
          }`}
        >
          {list.sections.map(
            (section: TemplatePickerSection<T>): ReactElement => {
              if (!section.title) {
                return (
                  <div key={section.id} className="divide-y divide-gray-100">
                    {section.templates.map(renderOption)}
                  </div>
                );
              }

              return (
                <div
                  key={section.id}
                  role="group"
                  aria-label={tx(section.title)}
                  data-testid={`${props.idPrefix}-template-section-${section.id}`}
                  className="divide-y divide-gray-100"
                >
                  <div
                    aria-hidden="true"
                    className="bg-gray-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 sm:px-4"
                  >
                    {tx(section.title)}
                  </div>
                  {section.templates.map(renderOption)}
                </div>
              );
            },
          )}
        </div>

        {list.templates.length === 0 ? (
          <div
            className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center"
            data-testid={ids.empty}
          >
            <p className="text-sm font-medium text-gray-900">
              {tx("No templates match your search.")}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              {tx("Try other words, or start from scratch.")}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {list.view !== TemplateCollection.All && allMatchCount > 0 ? (
                <button
                  type="button"
                  data-testid={ids.searchEverywhere}
                  onClick={() => {
                    selectView(TemplateCollection.All);
                  }}
                  className={SECONDARY_BUTTON_CLASS_NAME}
                >
                  {`${tx("Search all templates")} (${allMatchCount})`}
                </button>
              ) : (
                <></>
              )}
              <button
                type="button"
                data-testid={ids.emptyClear}
                onClick={() => {
                  setSearch("");
                  searchInputRef.current?.focus();
                }}
                className={SECONDARY_BUTTON_CLASS_NAME}
              >
                {tx("Clear search")}
              </button>
            </div>
          </div>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default TemplatePicker;
