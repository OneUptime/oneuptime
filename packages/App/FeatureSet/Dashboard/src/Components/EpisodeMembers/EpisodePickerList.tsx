import { Black } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useRef,
} from "react";
import RelativeTime from "../EpisodeView/RelativeTime";
import { EpisodePickerPill } from "./EpisodeMembersApi";

/*
 * The list the episode dialogs pick from: incidents or alerts to add to an
 * episode (several), or the episode to add them to (one). A search box over
 * a scrolling list of rows, each a native checkbox or radio inside its
 * label - so the keyboard, a screen reader and a click on any part of the
 * row all work as they do for any checkbox - drawn the way the episode's
 * own members card draws its members: the number, the title, then the
 * state and severity pills and when it happened.
 *
 * The dialog owns the data and what is picked; this only draws them.
 */

export interface EpisodePickerItem {
  id: string;
  // "ALT-63", "#63".
  number?: string | undefined;
  title: string;
  isPrivate?: boolean | undefined;
  state?: EpisodePickerPill | undefined;
  severity?: EpisodePickerPill | undefined;
  date?: Date | undefined;
  // A short fact after the pills, already translated: "4 alerts".
  meta?: string | undefined;
  /*
   * A line under the row, already translated: "Also in episode AE-3". Its
   * hover says more, when there is more to say.
   */
  note?: string | undefined;
  noteTooltip?: string | undefined;
}

export interface EpisodePickerSection {
  key: string;
  // A heading over the section's rows, already translated: "Open".
  title?: string | undefined;
  items: Array<EpisodePickerItem>;
}

export type EpisodePickerSelectionMode = "single" | "multiple";

export interface ComponentProps {
  // The data-testid every part of the list is named from.
  testId: string;
  selectionMode: EpisodePickerSelectionMode;
  sections: Array<EpisodePickerSection>;
  selectedIds: Array<string>;
  onToggle: (id: string) => void;
  // A row that cannot be picked right now (the most were picked already).
  isItemDisabled?: ((id: string) => boolean) | undefined;
  searchText: string;
  onSearchTextChange: (text: string) => void;
  // Already translated.
  searchPlaceholder: string;
  isLoading: boolean;
  error: string;
  onRetry: () => void;
  // What the list says when there is nothing to pick at all.
  emptyState: ReactElement;
  // What it says when a search matches nothing, already translated.
  noMatchText: string;
  // Under the list: how much it shows, a limit, a note.
  footer?: ReactElement | undefined;
}

// The state and severity pills, as the episode's members card draws them.
export const EpisodePickerPillBadge: FunctionComponent<{
  pill: EpisodePickerPill;
  testId: string;
  tooltip: string;
}> = (props: {
  pill: EpisodePickerPill;
  testId: string;
  tooltip: string;
}): ReactElement => {
  return (
    <span
      data-testid={props.testId}
      title={props.tooltip}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200"
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
        style={{ backgroundColor: (props.pill.color || Black).toString() }}
      />
      <span className="truncate">{props.pill.name}</span>
    </span>
  );
};

const EpisodePickerList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const baseId: string = useId();
  const searchInputRef: React.MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);

  // The search box is where a dialog that picks starts.
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const itemCount: number = props.sections.reduce(
    (count: number, section: EpisodePickerSection): number => {
      return count + section.items.length;
    },
    0,
  );

  const hasSearch: boolean = props.searchText.trim().length > 0;

  const renderItem: (
    item: EpisodePickerItem,
    sectionKey: string,
  ) => ReactElement = (
    item: EpisodePickerItem,
    sectionKey: string,
  ): ReactElement => {
    const isSelected: boolean = props.selectedIds.includes(item.id);
    const isDisabled: boolean =
      !isSelected && Boolean(props.isItemDisabled?.(item.id));
    const inputId: string = `${baseId}-${sectionKey}-${item.id}`;
    const noteId: string = `${inputId}-note`;

    let rowClassName: string =
      "flex items-start gap-3 px-3 py-2.5 transition-colors duration-100";

    if (isSelected) {
      rowClassName += " bg-indigo-50";
    } else if (isDisabled) {
      rowClassName += " cursor-not-allowed opacity-60";
    } else {
      rowClassName += " cursor-pointer hover:bg-gray-50";
    }

    return (
      <li key={`${sectionKey}-${item.id}`}>
        <label
          htmlFor={inputId}
          data-testid={`${props.testId}-option`}
          data-option-id={item.id}
          data-selected={isSelected ? "true" : "false"}
          className={rowClassName}
        >
          <input
            id={inputId}
            type={props.selectionMode === "single" ? "radio" : "checkbox"}
            name={props.selectionMode === "single" ? baseId : undefined}
            className={`accent-indigo-600 mt-1 h-4 w-4 flex-shrink-0 border-gray-300 text-indigo-600 focus:ring-indigo-600 ${
              props.selectionMode === "single" ? "" : "rounded"
            }`}
            checked={isSelected}
            disabled={isDisabled}
            aria-describedby={item.note ? noteId : undefined}
            onChange={() => {
              // A row that cannot be picked is not, however it is reached.
              if (isDisabled) {
                return;
              }

              props.onToggle(item.id);
            }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-start gap-2">
              {item.number && (
                <span
                  data-testid={`${props.testId}-option-number`}
                  className="mt-px inline-flex flex-shrink-0 items-center rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-gray-600"
                >
                  {item.number}
                </span>
              )}
              <span
                data-testid={`${props.testId}-option-title`}
                title={item.title}
                className="line-clamp-2 min-w-0 break-words text-sm font-medium leading-6 text-gray-900"
              >
                {item.title || translator.translateText("Untitled")}
              </span>
              {item.isPrivate && (
                <div
                  data-testid={`${props.testId}-option-private`}
                  title={translator.translateText(
                    "Private: only its owners, project admins and project owners can see it.",
                  )}
                  className="mt-px inline-flex flex-shrink-0 items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600"
                >
                  <Icon icon={IconProp.Lock} className="h-3 w-3" />
                  {translator.translateText("Private")}
                </div>
              )}
            </div>
            {(item.state || item.severity || item.meta || item.date) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                {item.state && (
                  <EpisodePickerPillBadge
                    pill={item.state}
                    testId={`${props.testId}-option-state`}
                    tooltip={translator.translateTemplate("State: {{name}}", {
                      name: item.state.name,
                    })}
                  />
                )}
                {item.severity && (
                  <EpisodePickerPillBadge
                    pill={item.severity}
                    testId={`${props.testId}-option-severity`}
                    tooltip={translator.translateTemplate(
                      "Severity: {{name}}",
                      {
                        name: item.severity.name,
                      },
                    )}
                  />
                )}
                {item.meta && (
                  <span className="text-xs text-gray-500">{item.meta}</span>
                )}
                {item.date && (
                  <RelativeTime
                    date={item.date}
                    className="whitespace-nowrap text-xs tabular-nums text-gray-500"
                  />
                )}
              </div>
            )}
            {item.note && (
              <div
                id={noteId}
                data-testid={`${props.testId}-option-note`}
                title={item.noteTooltip || undefined}
                className="mt-1.5 flex items-start gap-1 text-xs text-amber-700"
              >
                <Icon
                  icon={IconProp.Layers}
                  className="mt-px h-3.5 w-3.5 flex-shrink-0"
                />
                <span className="min-w-0 break-words">{item.note}</span>
              </div>
            )}
          </div>
        </label>
      </li>
    );
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (props.error && itemCount === 0) {
      return (
        <div className="px-3 py-6">
          <ErrorMessage message={props.error} onRefreshClick={props.onRetry} />
        </div>
      );
    }

    if (props.isLoading && itemCount === 0) {
      return (
        <div role="status" aria-live="polite">
          <span className="sr-only">{translator.translateText("Loading")}</span>
          <ul
            aria-hidden="true"
            data-testid={`${props.testId}-skeleton`}
            className="divide-y divide-gray-100 motion-safe:animate-pulse"
          >
            {[0, 1, 2, 3].map((row: number) => {
              return (
                <li key={row} className="flex items-start gap-3 px-3 py-3">
                  <div className="mt-0.5 h-4 w-4 flex-shrink-0 rounded bg-gray-100" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-4 w-2/3 rounded bg-gray-200" />
                    <div className="h-3 w-1/3 rounded bg-gray-100" />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      );
    }

    if (itemCount === 0) {
      if (hasSearch) {
        return (
          <div
            data-testid={`${props.testId}-no-match`}
            className="px-4 py-8 text-center text-sm text-gray-500"
          >
            {props.noMatchText}
          </div>
        );
      }

      return (
        <div data-testid={`${props.testId}-empty`} className="px-4 py-8">
          {props.emptyState}
        </div>
      );
    }

    return (
      <div>
        {props.sections
          .filter((section: EpisodePickerSection): boolean => {
            return section.items.length > 0;
          })
          .map((section: EpisodePickerSection) => {
            return (
              <div
                key={section.key}
                data-testid={`${props.testId}-section-${section.key}`}
              >
                {section.title && (
                  <div
                    role="presentation"
                    className="sticky top-0 z-10 border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500"
                  >
                    {section.title}
                  </div>
                )}
                <ul className="divide-y divide-gray-100">
                  {section.items.map((item: EpisodePickerItem) => {
                    return renderItem(item, section.key);
                  })}
                </ul>
              </div>
            );
          })}
      </div>
    );
  };

  return (
    <div data-testid={props.testId}>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          {props.isLoading && itemCount > 0 ? (
            <Icon
              icon={IconProp.Spinner}
              className="h-4 w-4 animate-spin text-gray-400"
            />
          ) : (
            <Icon icon={IconProp.Search} className="h-4 w-4 text-gray-400" />
          )}
        </div>
        <input
          ref={searchInputRef}
          type="search"
          data-testid={`${props.testId}-search`}
          aria-label={props.searchPlaceholder}
          placeholder={props.searchPlaceholder}
          value={props.searchText}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            props.onSearchTextChange(event.target.value);
          }}
          className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-500 focus:border-indigo-500 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <div
        data-testid={`${props.testId}-list`}
        className="mt-3 max-h-96 overflow-y-auto rounded-lg border border-gray-200 bg-white"
      >
        {getBody()}
      </div>
      {props.footer && (
        <div className="mt-2 text-xs leading-5 text-gray-500">
          {props.footer}
        </div>
      )}
    </div>
  );
};

export default EpisodePickerList;
