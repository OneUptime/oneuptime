/*
 * The first step of the create-a-workflow wizard: how to start.
 *
 * The maintainer, about the version before this one: "This select template
 * for workflow is extremely hard to use because it shows a lot of
 * information on the modal ... 'Start from scratch' should be more visible
 * as well because that's the most commonly used option." That version had a
 * search box with a plain Start from scratch button beside it, a column of
 * twelve categories with counts, the list, and a preview column that was
 * always open.
 *
 * So the step now reads top to bottom, and shows little until asked:
 *
 * - Start from scratch, first and largest. One click goes on to Name.
 * - "Or start from a template": a few recommended templates as one-line
 *   rows, with a search box and a category select beside the heading.
 * - A template's details - what starts it, what it is made of, what it will
 *   ask for - open inside its row once it is picked, and nowhere else.
 * - The dialog's one primary button, Use this template, is in its footer,
 *   and only there while a template is picked (see CreateWorkflowModal).
 *
 * The keyboard works as the command palette's does. The search box is a
 * combobox over the list: the arrow keys pick while typing, Enter uses what
 * is picked, and a search picks its best match on its own. The list takes
 * the arrow keys, Home and End once it has the focus, and "/" jumps to the
 * search from anywhere in the step. Start from scratch is a button, and is
 * where the focus starts.
 *
 * Everything it remembers is held by the wizard (see
 * WorkflowTemplatePickerState), so Back from Name finds it as it was left.
 */

import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
} from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import useTranslateValue from "Common/UI/Utils/Translation";
import {
  WorkflowTemplate,
  WorkflowTemplateVariable,
} from "Common/Types/Workflow/Templates";
import {
  WorkflowTemplateCollection,
  WorkflowTemplateHighlightSegment,
  WorkflowTemplateMove,
  WorkflowTemplatePickerList,
  WorkflowTemplatePickerSection,
  WorkflowTemplatePickerState,
  WorkflowTemplatePickerView,
  WorkflowTemplatePickerViewInfo,
  WorkflowTemplatePreview,
  WorkflowTemplatePreviewBlock,
  getActiveWorkflowTemplate,
  getMovedWorkflowTemplateId,
  getWorkflowTemplateHighlightSegments,
  getWorkflowTemplatePickerCounts,
  getWorkflowTemplatePickerList,
  getWorkflowTemplatePickerViews,
  getWorkflowTemplatePreview,
  getWorkflowTemplateSearchTokens,
  withWorkflowTemplateSearch,
  withWorkflowTemplateSelected,
  withWorkflowTemplateView,
  workflowTemplateCountText,
} from "../../Utils/Workflow/WorkflowTemplatePickerUtil";

export interface ComponentProps {
  state: WorkflowTemplatePickerState;
  onStateChange: (state: WorkflowTemplatePickerState) => void;
  /** Go on to the Name step with this template. */
  onUseTemplate: (template: WorkflowTemplate) => void;
  /** Go on to the Name step with an empty canvas. */
  onStartFromScratch: () => void;
  /** An empty canvas is the start already chosen, as after Back from Name. */
  isStartFromScratchChosen: boolean;
}

export const WORKFLOW_START_FROM_SCRATCH_ID: string =
  "workflow-start-from-scratch";
export const WORKFLOW_TEMPLATE_SEARCH_INPUT_ID: string =
  "workflow-template-search";
export const WORKFLOW_TEMPLATE_VIEW_SELECT_ID: string =
  "workflow-template-view-select";
export const WORKFLOW_TEMPLATE_LISTBOX_ID: string = "workflow-template-listbox";
const LIST_HEADING_ID: string = "workflow-template-list-heading";
const SCRATCH_DESCRIPTION_ID: string =
  "workflow-start-from-scratch-description";

/*
 * The product's plain secondary button, for the two ways out of an empty
 * search. Never filled: the dialog's one primary action is in its footer.
 */
const SECONDARY_BUTTON_CLASS_NAME: string =
  "inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors duration-150 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

type OptionDomIdFunction = (templateId: string) => string;

export const workflowTemplateOptionDomId: OptionDomIdFunction = (
  templateId: string,
): string => {
  return `workflow-template-option-${templateId}`;
};

type TranslateFunction = (value: string) => string;

interface HighlightedTextProps {
  text: string;
  tokens: Array<string>;
  typoTokens: Array<string>;
}

// What a search matched, marked as the Add Component picker marks it.
const HighlightedText: FunctionComponent<HighlightedTextProps> = (
  props: HighlightedTextProps,
): ReactElement => {
  return (
    <>
      {getWorkflowTemplateHighlightSegments(
        props.text,
        props.tokens,
        props.typoTokens,
      ).map(
        (
          segment: WorkflowTemplateHighlightSegment,
          index: number,
        ): ReactElement => {
          if (!segment.isMatch) {
            return <React.Fragment key={index}>{segment.text}</React.Fragment>;
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

interface BlockChipProps {
  block: WorkflowTemplatePreviewBlock;
  isTrigger: boolean;
  tx: TranslateFunction;
}

// One block as the builder's canvas names it: its icon and its title.
const BlockChip: FunctionComponent<BlockChipProps> = (
  props: BlockChipProps,
): ReactElement => {
  return (
    <div
      className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-white px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200"
      data-testid={
        props.isTrigger
          ? "workflow-template-details-trigger"
          : "workflow-template-details-step"
      }
    >
      <Icon
        icon={props.block.icon}
        className={`h-3.5 w-3.5 flex-shrink-0 ${
          props.isTrigger ? "text-indigo-600" : "text-gray-400"
        }`}
      />
      <span className="min-w-0 truncate">
        {props.isTrigger ? (
          <span className="sr-only">{`${props.tx("Trigger")}: `}</span>
        ) : (
          <></>
        )}
        {props.block.title}
      </span>
    </div>
  );
};

interface TemplateDetailsProps {
  preview: WorkflowTemplatePreview;
  tx: TranslateFunction;
}

/*
 * What a picked template's row opens to show, before anything is created:
 * how it works - what starts it, then the kinds of block it is made of, as
 * the canvas names them - and what the next steps will ask for. Two short
 * lines, where the old preview was a column of its own.
 */
const TemplateDetails: FunctionComponent<TemplateDetailsProps> = (
  props: TemplateDetailsProps,
): ReactElement => {
  const preview: WorkflowTemplatePreview = props.preview;
  const tx: TranslateFunction = props.tx;

  return (
    <dl className="mt-3 space-y-2.5" data-testid="workflow-template-details">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
        <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500 sm:w-36 sm:flex-shrink-0 sm:pt-1">
          {tx("How It Works")}
        </dt>
        <dd className="min-w-0 flex-1">
          <ul
            className="flex flex-wrap items-center gap-1.5"
            data-testid="workflow-template-details-blocks"
          >
            <li className="flex max-w-full items-center gap-1.5">
              <BlockChip block={preview.trigger} isTrigger={true} tx={tx} />
              <Icon
                icon={IconProp.ArrowRight}
                className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
              />
            </li>
            {preview.steps.map(
              (block: WorkflowTemplatePreviewBlock): ReactElement => {
                return (
                  <li key={block.componentId} className="flex max-w-full">
                    <BlockChip block={block} isTrigger={false} tx={tx} />
                  </li>
                );
              },
            )}
          </ul>
        </dd>
      </div>

      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
        <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500 sm:w-36 sm:flex-shrink-0 sm:pt-0.5">
          {tx("What you'll need")}
        </dt>
        <dd className="min-w-0 flex-1">
          {preview.settings.length > 0 ? (
            <ul
              className="flex flex-wrap gap-x-4 gap-y-1"
              data-testid="workflow-template-details-settings"
            >
              {preview.settings.map(
                (variable: WorkflowTemplateVariable): ReactElement => {
                  return (
                    <li
                      key={variable.name}
                      className="flex items-center gap-1.5 text-sm text-gray-700"
                      data-testid={`workflow-template-details-setting-${variable.name}`}
                    >
                      {/* A lock marks a secret. */}
                      {variable.isSecret ? (
                        <Icon
                          icon={IconProp.Lock}
                          className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                        />
                      ) : (
                        <></>
                      )}
                      <span className="min-w-0">
                        {variable.title}
                        {variable.isSecret ? (
                          <span className="sr-only">{`, ${tx("Secret")}`}</span>
                        ) : (
                          <></>
                        )}
                        {variable.required ? (
                          <></>
                        ) : (
                          <span className="ml-1 text-gray-400">
                            ({tx("Optional")})
                          </span>
                        )}
                      </span>
                    </li>
                  );
                },
              )}
            </ul>
          ) : (
            <p
              className="text-sm text-gray-600"
              data-testid="workflow-template-details-no-settings"
            >
              {tx("Nothing to fill in.")}
            </p>
          )}
        </dd>
      </div>
    </dl>
  );
};

interface TemplateOptionProps {
  template: WorkflowTemplate;
  isActive: boolean;
  /** The picked template's details, shown in its row. */
  preview: WorkflowTemplatePreview | null;
  tokens: Array<string>;
  typoTokens: Array<string>;
  tx: TranslateFunction;
  onPick: () => void;
  onUse: () => void;
}

const TemplateOption: FunctionComponent<TemplateOptionProps> = (
  props: TemplateOptionProps,
): ReactElement => {
  const template: WorkflowTemplate = props.template;
  const optionId: string = workflowTemplateOptionDomId(template.id);

  return (
    <div
      id={optionId}
      role="option"
      aria-selected={props.isActive}
      aria-labelledby={`${optionId}-name`}
      aria-describedby={`${optionId}-description`}
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
            />
          </div>
          {props.isActive && props.preview ? (
            <TemplateDetails preview={props.preview} tx={props.tx} />
          ) : (
            <></>
          )}
        </div>
      </div>
    </div>
  );
};

const WorkflowTemplatePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const tx: TranslateFunction = (value: string): string => {
    return translateString(value) || value;
  };

  const scratchButtonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const searchInputRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);
  const listboxRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  // Set when the keyboard picks a row, so it is brought into view once drawn.
  const scrollPickedIntoViewRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const state: WorkflowTemplatePickerState = props.state;

  const views: Array<WorkflowTemplatePickerViewInfo> = useMemo(() => {
    return getWorkflowTemplatePickerViews();
  }, []);

  const list: WorkflowTemplatePickerList = useMemo(() => {
    return getWorkflowTemplatePickerList(state);
  }, [state]);

  const tokens: Array<string> = useMemo(() => {
    return getWorkflowTemplateSearchTokens(state.search);
  }, [state.search]);

  const activeTemplate: WorkflowTemplate | null = useMemo(() => {
    return getActiveWorkflowTemplate(state);
  }, [state]);

  const preview: WorkflowTemplatePreview | null = useMemo(() => {
    return activeTemplate ? getWorkflowTemplatePreview(activeTemplate) : null;
  }, [activeTemplate]);

  // Only read for an empty search narrowed to one category.
  const allMatchCount: number = useMemo(() => {
    if (!list.isSearching || list.templates.length > 0) {
      return 0;
    }

    return (
      getWorkflowTemplatePickerCounts(state.search).get(
        WorkflowTemplateCollection.All,
      ) || 0
    );
  }, [list, state.search]);

  /*
   * Where the focus starts. When the dialog opens that is Start from scratch,
   * the first thing in it and the most common choice, so Enter takes it (the
   * dialog puts its focus there too). Back from Name returns to what was
   * chosen: the list, with the template picked, or Start from scratch.
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
      workflowTemplateOptionDomId(activeTemplate.id),
    );

    if (row && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [activeTemplate?.id]);

  /*
   * "/" goes to the search from anywhere in the step, as it does in the
   * builder's Add Component panel. Not while typing somewhere else.
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

  type ChangeFunction = (next: WorkflowTemplatePickerState) => void;

  const change: ChangeFunction = (next: WorkflowTemplatePickerState): void => {
    props.onStateChange(next);
  };

  type SetSearchFunction = (search: string) => void;

  const setSearch: SetSearchFunction = (search: string): void => {
    change(withWorkflowTemplateSearch(state, search));
  };

  type MoveFunction = (move: WorkflowTemplateMove) => void;

  const movePick: MoveFunction = (move: WorkflowTemplateMove): void => {
    const nextId: string | null = getMovedWorkflowTemplateId(state, move);

    if (!nextId) {
      return;
    }

    scrollPickedIntoViewRef.current = true;
    change(withWorkflowTemplateSelected(state, nextId));
  };

  type UsePickedFunction = () => void;

  const usePickedTemplate: UsePickedFunction = (): void => {
    if (activeTemplate) {
      props.onUseTemplate(activeTemplate);
    }
  };

  type ListKeyDownFunction = (event: React.KeyboardEvent<HTMLElement>) => void;

  // The keys the list answers to, from the search box or from the list itself.
  const onListKeys: ListKeyDownFunction = (
    event: React.KeyboardEvent<HTMLElement>,
  ): void => {
    if (event.nativeEvent.isComposing) {
      return;
    }

    const isInSearch: boolean = event.currentTarget === searchInputRef.current;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        movePick(WorkflowTemplateMove.Next);
        return;
      case "ArrowUp":
        event.preventDefault();
        movePick(WorkflowTemplateMove.Previous);
        return;
      case "Home":
        // In the search box, Home and End move the caret.
        if (!isInSearch) {
          event.preventDefault();
          movePick(WorkflowTemplateMove.First);
        }
        return;
      case "End":
        if (!isInSearch) {
          event.preventDefault();
          movePick(WorkflowTemplateMove.Last);
        }
        return;
      case "Enter":
        event.preventDefault();
        usePickedTemplate();
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

  type SelectViewFunction = (view: WorkflowTemplatePickerView) => void;

  const selectView: SelectViewFunction = (
    view: WorkflowTemplatePickerView,
  ): void => {
    change(withWorkflowTemplateView(state, view));
  };

  const resultCountText: string = workflowTemplateCountText(
    tx,
    list.templates.length,
    "1 result",
    "{count} results",
  );

  type RenderOptionFunction = (template: WorkflowTemplate) => ReactElement;

  const renderOption: RenderOptionFunction = (
    template: WorkflowTemplate,
  ): ReactElement => {
    const isActive: boolean = activeTemplate?.id === template.id;

    return (
      <TemplateOption
        key={template.id}
        template={template}
        isActive={isActive}
        preview={isActive ? preview : null}
        tokens={tokens}
        typoTokens={list.typoTokens}
        tx={tx}
        onPick={() => {
          change(withWorkflowTemplateSelected(state, template.id));
        }}
        onUse={() => {
          props.onUseTemplate(template);
        }}
      />
    );
  };

  return (
    <div data-testid="workflow-template-picker">
      {/*
       * The most common way to start, so it comes first and stands out: the
       * one card in the step, with the brand's colour on its icon. One click
       * goes on to Name. Not a filled button - the dialog's one primary
       * action is Use this template, in its footer.
       */}
      <button
        ref={scratchButtonRef}
        id={WORKFLOW_START_FROM_SCRATCH_ID}
        type="button"
        data-testid="workflow-start-from-scratch"
        aria-describedby={SCRATCH_DESCRIPTION_ID}
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
            id={SCRATCH_DESCRIPTION_ID}
            className="mt-0.5 text-sm leading-5 text-gray-600"
          >
            {tx(
              "Begin with an empty canvas and add your own trigger and steps.",
            )}
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
         * for whoever needs more than the few the list opens on. One row where
         * there is room. On a phone the select stays beside the heading and
         * the search takes a row of its own, wide enough to read its prompt.
         */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2.5 sm:grid-cols-[minmax(0,1fr)_14rem_auto]">
          <h3
            id={LIST_HEADING_ID}
            className="col-start-1 row-start-1 min-w-0 text-sm font-semibold text-gray-900"
          >
            {tx("Or start from a template")}
          </h3>
          <div className="relative col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5">
              <Icon icon={IconProp.Search} className="h-4 w-4 text-gray-400" />
            </div>
            <input
              ref={searchInputRef}
              id={WORKFLOW_TEMPLATE_SEARCH_INPUT_ID}
              data-testid="workflow-template-search"
              type="text"
              role="combobox"
              aria-expanded={true}
              aria-autocomplete="list"
              aria-controls={WORKFLOW_TEMPLATE_LISTBOX_ID}
              aria-activedescendant={
                activeTemplate
                  ? workflowTemplateOptionDomId(activeTemplate.id)
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
              className="block w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-8 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {state.search.length > 0 ? (
              <div className="absolute inset-y-0 right-0 flex items-center pr-1.5">
                <button
                  type="button"
                  data-testid="workflow-template-search-clear"
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
            id={WORKFLOW_TEMPLATE_VIEW_SELECT_ID}
            data-testid="workflow-template-view-select"
            aria-label={tx("Template categories")}
            value={String(list.view)}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              selectView(event.target.value as WorkflowTemplatePickerView);
            }}
            className="col-start-2 row-start-1 rounded-md border border-gray-300 bg-white py-1.5 pl-3 pr-8 text-sm text-gray-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:col-start-3"
          >
            {views.map((info: WorkflowTemplatePickerViewInfo): ReactElement => {
              return (
                <option key={String(info.view)} value={String(info.view)}>
                  {tx(info.label)}
                </option>
              );
            })}
          </select>
        </div>

        <p
          className="sr-only"
          aria-live="polite"
          data-testid="workflow-template-result-count"
        >
          {list.isSearching ? resultCountText : ""}
        </p>

        <div
          ref={listboxRef}
          id={WORKFLOW_TEMPLATE_LISTBOX_ID}
          role="listbox"
          aria-labelledby={LIST_HEADING_ID}
          aria-activedescendant={
            activeTemplate
              ? workflowTemplateOptionDomId(activeTemplate.id)
              : undefined
          }
          tabIndex={0}
          data-testid={WORKFLOW_TEMPLATE_LISTBOX_ID}
          onKeyDown={onListKeys}
          className={`mt-3 overflow-hidden rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            list.templates.length > 0
              ? "divide-y divide-gray-200 border border-gray-200"
              : ""
          }`}
        >
          {list.sections.map(
            (section: WorkflowTemplatePickerSection): ReactElement => {
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
                  data-testid={`workflow-template-section-${section.id}`}
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
            data-testid="workflow-template-empty"
          >
            <p className="text-sm font-medium text-gray-900">
              {tx("No templates match your search.")}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              {tx("Try other words, or start from scratch.")}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {list.view !== WorkflowTemplateCollection.All &&
              allMatchCount > 0 ? (
                <button
                  type="button"
                  data-testid="workflow-template-search-everywhere"
                  onClick={() => {
                    selectView(WorkflowTemplateCollection.All);
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
                data-testid="workflow-template-empty-clear"
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

export default WorkflowTemplatePicker;
