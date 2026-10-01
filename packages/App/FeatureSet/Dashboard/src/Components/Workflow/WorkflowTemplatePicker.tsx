/*
 * The "Start from" step of the create-a-workflow wizard.
 *
 * It used to show every template at once, as a grid of large cards that all
 * looked equally important: forty-odd choices before anything could happen.
 * Now the step offers two ways in. "Start from scratch" sits beside the
 * search for anyone who already knows what they want to build. Everyone else
 * starts on a handful of recommended templates, with the rest one click away
 * under a short list of categories, each with its count, or found by typing.
 *
 * Templates are compact rows. Picking one previews it on the right before
 * anything is created: what starts it, the blocks it is made of, and the
 * settings it will ask for. The wizard's one primary button, "Use this
 * template", then takes it to the Name step; so do Enter and a double-click.
 * On a narrow screen the preview takes the list's place, with a way back.
 *
 * The keyboard works the way the command palette's does. The search box is a
 * combobox over the list: the arrow keys move the highlight while typing,
 * and Enter uses the highlighted template. The list itself takes the arrow
 * keys, Home and End once it has focus, the categories are a radio group,
 * and "/" jumps back to the search from anywhere in the step.
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
import KeyboardShortcut, {
  KeyboardKey,
  KeyboardShortcutSize,
  KeyboardShortcutVariant,
} from "Common/UI/Components/KeyboardShortcut/KeyboardShortcut";
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
  getWorkflowTemplateCategoryLabel,
  getWorkflowTemplateHighlightSegments,
  getWorkflowTemplatePickerCounts,
  getWorkflowTemplatePickerList,
  getWorkflowTemplatePickerViewInfo,
  getWorkflowTemplatePickerViews,
  getWorkflowTemplatePreview,
  getWorkflowTemplateSearchTokens,
  withWorkflowTemplateSearch,
  withWorkflowTemplateView,
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

export const WORKFLOW_TEMPLATE_SEARCH_INPUT_ID: string =
  "workflow-template-search";
export const WORKFLOW_TEMPLATE_LISTBOX_ID: string = "workflow-template-listbox";
const PREVIEW_BACK_BUTTON_ID: string = "workflow-template-preview-back";

/*
 * The product's plain secondary button, drawn here rather than through Button
 * so it can say aria-pressed. Never filled: the dialog's one primary action
 * is "Use this template", in its footer.
 */
const SECONDARY_BUTTON_BASE_CLASS_NAME: string =
  "inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-md border bg-white px-3 py-2 text-sm font-medium shadow-sm transition-colors duration-150 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

const SECONDARY_BUTTON_CLASS_NAME: string = `${SECONDARY_BUTTON_BASE_CLASS_NAME} border-gray-300 text-gray-700`;

type OptionDomIdFunction = (templateId: string) => string;

export const workflowTemplateOptionDomId: OptionDomIdFunction = (
  templateId: string,
): string => {
  return `workflow-template-option-${templateId}`;
};

type ViewDomIdFunction = (view: WorkflowTemplatePickerView) => string;

const viewDomId: ViewDomIdFunction = (
  view: WorkflowTemplatePickerView,
): string => {
  return `workflow-template-view-${String(view)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`;
};

type TranslateFunction = (value: string) => string;

interface HighlightedTextProps {
  text: string;
  tokens: Array<string>;
}

const HighlightedText: FunctionComponent<HighlightedTextProps> = (
  props: HighlightedTextProps,
): ReactElement => {
  return (
    <>
      {getWorkflowTemplateHighlightSegments(props.text, props.tokens).map(
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
              className="rounded-sm bg-yellow-100 px-0.5 text-inherit"
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
  template: WorkflowTemplate;
  isActive: boolean;
  tokens: Array<string>;
  /** Shown when the list mixes categories, so each row says where it is from. */
  showCategory: boolean;
  tx: TranslateFunction;
  onActivate: () => void;
  onUse: () => void;
}

const TemplateOption: FunctionComponent<TemplateOptionProps> = (
  props: TemplateOptionProps,
): ReactElement => {
  const template: WorkflowTemplate = props.template;

  return (
    <div
      id={workflowTemplateOptionDomId(template.id)}
      role="option"
      aria-selected={props.isActive}
      data-testid={workflowTemplateOptionDomId(template.id)}
      onClick={props.onActivate}
      onDoubleClick={props.onUse}
      className={`flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 transition-colors duration-100 ${
        props.isActive
          ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200"
          : "hover:bg-gray-50"
      }`}
    >
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
        <div className="text-sm font-medium leading-5 text-gray-900">
          <HighlightedText text={template.name} tokens={props.tokens} />
        </div>
        <div className="mt-0.5 truncate text-xs leading-5 text-gray-500">
          <HighlightedText text={template.description} tokens={props.tokens} />
        </div>
      </div>
      {props.showCategory ? (
        <span
          data-testid="workflow-template-option-category"
          className={`mt-0.5 flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium text-gray-600 max-sm:hidden sm:inline-flex ${
            props.isActive ? "bg-white" : "bg-gray-100"
          }`}
        >
          {props.tx(getWorkflowTemplateCategoryLabel(template.category))}
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};

interface PreviewBlockRowProps {
  block: WorkflowTemplatePreviewBlock;
  isTrigger: boolean;
}

// One block as the canvas will show it: its icon and its name.
const PreviewBlockRow: FunctionComponent<PreviewBlockRowProps> = (
  props: PreviewBlockRowProps,
): ReactElement => {
  return (
    <li
      className="flex items-center gap-2.5"
      data-testid={
        props.isTrigger
          ? "workflow-template-preview-trigger"
          : "workflow-template-preview-step"
      }
    >
      <div
        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${
          props.isTrigger
            ? "bg-indigo-100 text-indigo-600"
            : "bg-white text-gray-500 ring-1 ring-gray-200"
        }`}
      >
        <Icon icon={props.block.icon} className="h-3.5 w-3.5" />
      </div>
      <span className="min-w-0 flex-1 text-sm text-gray-800">
        {props.block.title}
      </span>
    </li>
  );
};

interface TemplatePreviewProps {
  preview: WorkflowTemplatePreview;
  tx: TranslateFunction;
  onBack: () => void;
}

const TemplatePreview: FunctionComponent<TemplatePreviewProps> = (
  props: TemplatePreviewProps,
): ReactElement => {
  const preview: WorkflowTemplatePreview = props.preview;
  const template: WorkflowTemplate = preview.template;
  const tx: TranslateFunction = props.tx;

  return (
    <section
      aria-labelledby="workflow-template-preview-title"
      data-testid="workflow-template-preview"
      className="rounded-xl bg-gray-50 p-4 sm:p-5"
    >
      <button
        type="button"
        id={PREVIEW_BACK_BUTTON_ID}
        data-testid="workflow-template-preview-back"
        onClick={props.onBack}
        className="-ml-1 mb-3 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-sm font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 md:hidden"
      >
        <Icon icon={IconProp.ChevronLeft} className="h-4 w-4" />
        {tx("Back to templates")}
      </button>

      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
          <Icon icon={template.icon} className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3
            id="workflow-template-preview-title"
            className="text-base font-semibold leading-6 text-gray-900"
          >
            {template.name}
          </h3>
          <p
            className="mt-0.5 text-xs text-gray-500"
            data-testid="workflow-template-preview-meta"
          >
            {[
              tx(getWorkflowTemplateCategoryLabel(template.category)),
              template.subcategory ? tx(template.subcategory) : "",
              `${preview.blockCount} ${tx("blocks")}`,
            ]
              .filter((part: string) => {
                return part.length > 0;
              })
              .join(" · ")}
          </p>
        </div>
      </div>

      <p className="mt-3 text-sm leading-6 text-gray-600">
        {template.description}
      </p>

      <h4 className="mt-5 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {tx("How it works")}
      </h4>
      {/*
       * What starts it, then the other blocks it is made of: the shape of the
       * workflow the builder will open with, named as its canvas names them.
       */}
      <dl
        className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2"
        data-testid="workflow-template-preview-blocks"
      >
        <dt className="pt-1.5 text-xs font-medium text-gray-500">
          {tx("Trigger")}
        </dt>
        <dd>
          <ul>
            <PreviewBlockRow block={preview.trigger} isTrigger={true} />
          </ul>
        </dd>
        <dt className="pt-1.5 text-xs font-medium text-gray-500">
          {tx("Steps")}
        </dt>
        <dd>
          <ul className="space-y-2">
            {preview.steps.map(
              (block: WorkflowTemplatePreviewBlock): ReactElement => {
                return (
                  <PreviewBlockRow
                    key={block.componentId}
                    block={block}
                    isTrigger={false}
                  />
                );
              },
            )}
          </ul>
        </dd>
      </dl>

      <h4 className="mt-5 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {tx("You'll need")}
      </h4>
      {preview.settings.length > 0 ? (
        <ul
          className="mt-2 space-y-1.5"
          data-testid="workflow-template-preview-settings"
        >
          {preview.settings.map(
            (variable: WorkflowTemplateVariable): ReactElement => {
              return (
                <li
                  key={variable.name}
                  className="flex items-start gap-2 text-sm text-gray-700"
                  data-testid={`workflow-template-preview-setting-${variable.name}`}
                >
                  {/* A lock marks a secret; anything else is a plain bullet. */}
                  {variable.isSecret ? (
                    <Icon
                      icon={IconProp.Lock}
                      className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      className="flex h-5 w-4 flex-shrink-0 items-center justify-center"
                    >
                      <div className="h-1.5 w-1.5 rounded-full bg-gray-400" />
                    </div>
                  )}
                  <span className="min-w-0">
                    {variable.title}
                    {variable.isSecret ? (
                      <span className="sr-only">, {tx("Secret")}</span>
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
          className="mt-2 text-sm text-gray-600"
          data-testid="workflow-template-preview-no-settings"
        >
          {tx("Nothing to fill in.")}
        </p>
      )}
    </section>
  );
};

const WorkflowTemplatePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const tx: TranslateFunction = (value: string): string => {
    return translateString(value) || value;
  };

  const searchInputRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);
  const listColumnRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const returnFocusToListRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const state: WorkflowTemplatePickerState = props.state;

  /*
   * On a narrow screen the preview takes the list's place, and the list that
   * had focus is gone with it. Focus follows: to the preview's way back when
   * it opens, and to the list again when that is used. Where both are shown
   * side by side, focus stays where it was.
   */
  useEffect(() => {
    if (state.isPreviewOpen) {
      const listColumn: HTMLDivElement | null = listColumnRef.current;

      if (
        listColumn &&
        window.getComputedStyle(listColumn).display === "none"
      ) {
        document.getElementById(PREVIEW_BACK_BUTTON_ID)?.focus();
      }

      return;
    }

    if (returnFocusToListRef.current) {
      returnFocusToListRef.current = false;
      document.getElementById(WORKFLOW_TEMPLATE_LISTBOX_ID)?.focus();
    }
  }, [state.isPreviewOpen]);

  const views: Array<WorkflowTemplatePickerViewInfo> = useMemo(() => {
    return getWorkflowTemplatePickerViews();
  }, []);

  const list: WorkflowTemplatePickerList = useMemo(() => {
    return getWorkflowTemplatePickerList(state);
  }, [state]);

  const counts: Map<WorkflowTemplatePickerView, number> = useMemo(() => {
    return getWorkflowTemplatePickerCounts(state.search);
  }, [state.search]);

  const tokens: Array<string> = useMemo(() => {
    return getWorkflowTemplateSearchTokens(state.search);
  }, [state.search]);

  const activeTemplate: WorkflowTemplate | null = useMemo(() => {
    return getActiveWorkflowTemplate(state);
  }, [state]);

  const preview: WorkflowTemplatePreview | null = useMemo(() => {
    return activeTemplate ? getWorkflowTemplatePreview(activeTemplate) : null;
  }, [activeTemplate]);

  const viewInfo: WorkflowTemplatePickerViewInfo =
    getWorkflowTemplatePickerViewInfo(list.view);

  /*
   * "/" goes back to the search from anywhere in the step, as it does in the
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

  const moveActive: MoveFunction = (move: WorkflowTemplateMove): void => {
    const nextId: string | null = getMovedWorkflowTemplateId(state, move);

    if (!nextId) {
      return;
    }

    change({ ...state, activeTemplateId: nextId });

    // The row is already on the page; only its highlight moves.
    const row: HTMLElement | null = document.getElementById(
      workflowTemplateOptionDomId(nextId),
    );

    if (row && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  };

  type ChooseActiveFunction = () => void;

  const chooseActiveTemplate: ChooseActiveFunction = (): void => {
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
        moveActive(WorkflowTemplateMove.Next);
        return;
      case "ArrowUp":
        event.preventDefault();
        moveActive(WorkflowTemplateMove.Previous);
        return;
      case "Home":
        // In the search box, Home and End move the caret.
        if (!isInSearch) {
          event.preventDefault();
          moveActive(WorkflowTemplateMove.First);
        }
        return;
      case "End":
        if (!isInSearch) {
          event.preventDefault();
          moveActive(WorkflowTemplateMove.Last);
        }
        return;
      case "Enter":
        event.preventDefault();
        chooseActiveTemplate();
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

  type CategoryKeyDownFunction = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => void;

  // A radio group: the arrow keys move between categories, and choose as they go.
  const onCategoryKeyDown: CategoryKeyDownFunction = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    let nextIndex: number | null = null;

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (index + 1) % views.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = (index - 1 + views.length) % views.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = views.length - 1;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();

    const next: WorkflowTemplatePickerViewInfo = views[nextIndex]!;

    selectView(next.view);
    document.getElementById(viewDomId(next.view))?.focus();
  };

  const isSearching: boolean = list.isSearching;
  const resultCount: number = list.templates.length;
  const allMatchCount: number = counts.get(WorkflowTemplateCollection.All) || 0;
  const resultCountText: string = `${resultCount} ${
    resultCount === 1 ? tx("result") : tx("results")
  }`;

  /*
   * A row names its category only in search results that mix categories,
   * where it says why the row is there. Elsewhere a heading already says it,
   * or it is one more word on every row of a list meant to be calm.
   */
  const showCategoryOnRows: boolean =
    isSearching &&
    (list.view === WorkflowTemplateCollection.All ||
      list.view === WorkflowTemplateCollection.Recommended);

  type RenderOptionFunction = (template: WorkflowTemplate) => ReactElement;

  const renderOption: RenderOptionFunction = (
    template: WorkflowTemplate,
  ): ReactElement => {
    return (
      <TemplateOption
        key={template.id}
        template={template}
        isActive={activeTemplate?.id === template.id}
        tokens={tokens}
        showCategory={showCategoryOnRows}
        tx={tx}
        onActivate={() => {
          change({
            ...state,
            activeTemplateId: template.id,
            isPreviewOpen: true,
          });
        }}
        onUse={() => {
          props.onUseTemplate(template);
        }}
      />
    );
  };

  return (
    <div data-testid="workflow-template-picker">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
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
            autoFocus={true}
            value={state.search}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setSearch(event.target.value);
            }}
            onKeyDown={onListKeys}
            className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-10 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <div className="absolute inset-y-0 right-0 flex items-center pr-2">
            {state.search.length > 0 ? (
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
            ) : (
              <KeyboardShortcut
                keys={["/"]}
                size={KeyboardShortcutSize.ExtraSmall}
                variant={KeyboardShortcutVariant.Ghost}
                className="pointer-events-none max-sm:hidden sm:inline-flex"
              />
            )}
          </div>
        </div>
        {/*
         * Drawn like the product's plain secondary button, never filled: the
         * dialog's one primary action is "Use this template". Pressed when an
         * empty canvas is the start already chosen, so Back shows what was
         * picked.
         */}
        <button
          type="button"
          data-testid="workflow-start-from-scratch"
          aria-pressed={props.isStartFromScratchChosen}
          onClick={props.onStartFromScratch}
          className={
            props.isStartFromScratchChosen
              ? `${SECONDARY_BUTTON_BASE_CLASS_NAME} border-indigo-500 text-indigo-700`
              : SECONDARY_BUTTON_CLASS_NAME
          }
        >
          <Icon
            icon={
              props.isStartFromScratchChosen ? IconProp.Check : IconProp.Add
            }
            className={`h-4 w-4 ${
              props.isStartFromScratchChosen
                ? "text-indigo-600"
                : "text-gray-500"
            }`}
          />
          {tx("Start from scratch")}
        </button>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_17rem] xl:grid-cols-[11.5rem_minmax(0,1fr)_19rem] xl:gap-6">
        {/*
         * The categories, as a column beside the list where there is room for
         * one. Narrower screens choose them from the select over the list
         * instead: as a wrapping row of chips they took three lines.
         */}
        <div
          role="radiogroup"
          aria-label={tx("Template categories")}
          data-testid="workflow-template-categories"
          className="max-xl:hidden xl:sticky xl:top-0 xl:flex xl:flex-col xl:gap-0.5 xl:self-start"
        >
          {views.map(
            (
              info: WorkflowTemplatePickerViewInfo,
              index: number,
            ): ReactElement => {
              const isSelected: boolean = info.view === list.view;
              const count: number = counts.get(info.view) || 0;
              const isEmpty: boolean = isSearching && count === 0;

              return (
                <button
                  key={String(info.view)}
                  id={viewDomId(info.view)}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  aria-label={`${tx(info.label)} (${count})`}
                  tabIndex={isSelected ? 0 : -1}
                  data-testid={viewDomId(info.view)}
                  onClick={() => {
                    selectView(info.view);
                  }}
                  onKeyDown={(
                    event: React.KeyboardEvent<HTMLButtonElement>,
                  ) => {
                    onCategoryKeyDown(event, index);
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    isSelected
                      ? "bg-indigo-50 font-medium text-indigo-700"
                      : `hover:bg-gray-50 ${
                          isEmpty ? "text-gray-400" : "text-gray-700"
                        }`
                  } ${index === 1 || index === views.length - 1 ? "mt-2" : ""}`}
                >
                  <Icon
                    icon={info.icon}
                    className={`h-4 w-4 flex-shrink-0 ${
                      isSelected ? "text-indigo-600" : "text-gray-400"
                    }`}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {tx(info.label)}
                  </span>
                  <span
                    className={`flex-shrink-0 text-xs tabular-nums ${
                      isSelected ? "text-indigo-600" : "text-gray-400"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            },
          )}
        </div>

        <div
          ref={listColumnRef}
          className={`min-w-0 ${state.isPreviewOpen ? "max-md:hidden" : ""}`}
          data-testid="workflow-template-list-column"
        >
          <div className="mb-2 px-1">
            <div className="flex items-center justify-between gap-3 xl:hidden">
              <label
                htmlFor="workflow-template-view-select"
                className="sr-only"
              >
                {tx("Template categories")}
              </label>
              <select
                id="workflow-template-view-select"
                data-testid="workflow-template-view-select"
                value={String(list.view)}
                onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                  selectView(event.target.value as WorkflowTemplatePickerView);
                }}
                className="min-w-0 max-w-full rounded-md border border-gray-300 bg-white py-1.5 pl-3 pr-8 text-sm font-semibold text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {views.map(
                  (info: WorkflowTemplatePickerViewInfo): ReactElement => {
                    return (
                      <option key={String(info.view)} value={String(info.view)}>
                        {`${tx(info.label)} (${counts.get(info.view) || 0})`}
                      </option>
                    );
                  },
                )}
              </select>
              {isSearching ? (
                <span className="flex-shrink-0 text-xs text-gray-500">
                  {resultCountText}
                </span>
              ) : (
                <></>
              )}
            </div>
            <h3
              id="workflow-template-list-heading"
              className="text-sm font-semibold text-gray-900 max-xl:sr-only"
            >
              {isSearching ? resultCountText : tx(viewInfo.label)}
            </h3>
            <p
              className={`mt-0.5 text-xs text-gray-500 max-xl:mt-2 ${
                isSearching ? "max-xl:hidden" : ""
              }`}
            >
              {isSearching ? tx(viewInfo.label) : tx(viewInfo.description)}
            </p>
          </div>

          <p
            className="sr-only"
            aria-live="polite"
            data-testid="workflow-template-result-count"
          >
            {isSearching ? resultCountText : ""}
          </p>

          <div
            id={WORKFLOW_TEMPLATE_LISTBOX_ID}
            role="listbox"
            aria-labelledby="workflow-template-list-heading"
            aria-activedescendant={
              activeTemplate
                ? workflowTemplateOptionDomId(activeTemplate.id)
                : undefined
            }
            tabIndex={0}
            data-testid={WORKFLOW_TEMPLATE_LISTBOX_ID}
            onKeyDown={onListKeys}
            className="space-y-0.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {list.sections.map(
              (section: WorkflowTemplatePickerSection): ReactElement => {
                if (!section.title) {
                  return (
                    <React.Fragment key={section.id}>
                      {section.templates.map(renderOption)}
                    </React.Fragment>
                  );
                }

                return (
                  <div
                    key={section.id}
                    role="group"
                    aria-label={tx(section.title)}
                    data-testid={`workflow-template-section-${section.id}`}
                    className="pt-3 first:pt-0"
                  >
                    <div
                      aria-hidden="true"
                      className="flex items-center gap-2 px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500"
                    >
                      <span>{tx(section.title)}</span>
                      <span className="font-normal tabular-nums text-gray-400">
                        {section.templates.length}
                      </span>
                    </div>
                    {section.templates.map(renderOption)}
                  </div>
                );
              },
            )}
          </div>

          {resultCount === 0 ? (
            <div
              className="flex flex-col items-center px-4 py-10 text-center"
              data-testid="workflow-template-empty"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                <Icon
                  icon={IconProp.Search}
                  className="h-5 w-5 text-gray-400"
                />
              </div>
              <p className="mt-3 text-sm font-medium text-gray-900">
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
            <div
              aria-hidden="true"
              className="mt-3 items-center gap-4 px-1 text-xs text-gray-400 max-md:hidden md:flex"
            >
              <span className="inline-flex items-center gap-1.5">
                <KeyboardShortcut
                  keys={[KeyboardKey.ArrowUp, KeyboardKey.ArrowDown]}
                  size={KeyboardShortcutSize.ExtraSmall}
                  variant={KeyboardShortcutVariant.Ghost}
                />
                {tx("to move")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <KeyboardShortcut
                  keys={[KeyboardKey.Enter]}
                  size={KeyboardShortcutSize.ExtraSmall}
                  variant={KeyboardShortcutVariant.Ghost}
                />
                {tx("to use")}
              </span>
            </div>
          )}
        </div>

        <div
          className={`min-w-0 md:sticky md:top-0 md:self-start ${
            state.isPreviewOpen ? "" : "max-md:hidden"
          }`}
          data-testid="workflow-template-preview-column"
        >
          {/* Nothing to preview when a search finds nothing: the list says so. */}
          {preview ? (
            <TemplatePreview
              preview={preview}
              tx={tx}
              onBack={() => {
                returnFocusToListRef.current = true;
                change({ ...state, isPreviewOpen: false });
              }}
            />
          ) : (
            <></>
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkflowTemplatePicker;
