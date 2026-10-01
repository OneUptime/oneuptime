/*
 * The list of values a setting can use, grouped by where they come from: each
 * step that runs before this one, by its name, then the workflow's variables.
 * Every value says what it is called, what it holds and what shape it is; the
 * {{...}} reference it inserts is only in its tooltip. Nobody has to know the
 * syntax to use it.
 *
 * A record opens to its fields - the useful reference is almost always one
 * field of it, not the record - and a JSON value or a set of headers can be
 * opened to type a path into it.
 *
 * The list is searchable, and walked with the arrow keys and Enter.
 */

import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import {
  ChildrenState,
  ChildrenStatus,
  ValuePickerContextValue,
  useValuePicker,
} from "./ValuePickerContext";
import {
  ValueSuggestion,
  ValueSuggestionGroup,
  appendPathToReference,
  filterSuggestionGroups,
  suggestionMatches,
} from "./ValueSuggestion";
import { NOT_SELECTED_BADGE } from "./StepValueSource";
import React, {
  ReactElement,
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

export interface ValuePickerMenuHandle {
  /**
   * Inline mode: the field passes its keys here. True when the menu used the
   * key, in which case the field must not.
   */
  handleKeyDown: (event: {
    key: string;
    shiftKey?: boolean;
    preventDefault: () => void;
  }) => boolean;
}

export interface ValuePickerMenuProps {
  /**
   * True: a search box of its own, which takes the focus. False: filtered by
   * what is typed after "{{" in the field, which keeps the focus.
   */
  hasSearchBox: boolean;
  /** The filter when there is no search box. */
  query?: string | undefined;
  onPick: (reference: string) => void;
  /** Only some groups - the Schedule trigger takes variables only. */
  groupFilter?: ((group: ValueSuggestionGroup) => boolean) | undefined;
  /** Inline mode: the option the arrow keys are on, for aria-activedescendant. */
  onActiveOptionChange?: ((optionId: string | undefined) => void) | undefined;
  /** The listbox's id, for the field's aria-controls. */
  listboxId?: string | undefined;
  searchPlaceholder?: string | undefined;
  /** Said when there is nothing at all to pick. */
  emptyMessage?: string | undefined;
}

interface DrillView {
  item: ValueSuggestion;
  group: ValueSuggestionGroup;
}

interface MenuOption {
  key: string;
  label: string;
  description?: string | undefined;
  typeLabel?: string | undefined;
  badges?: Array<string> | undefined;
  /** What the option inserts, when it inserts something. */
  reference: string;
  /** Picking this opens it rather than inserting it. */
  opens?: boolean | undefined;
  /** Shows a separate "look inside" button. */
  canLookInside?: boolean | undefined;
  item?: ValueSuggestion | undefined;
  group?: ValueSuggestionGroup | undefined;
}

interface OptionSection {
  key: string;
  title?: string | undefined;
  subtitle?: string | undefined;
  iconProp?: IconProp | undefined;
  options: Array<MenuOption>;
}

const BADGE_CLASS: Record<string, string> = {
  [NOT_SELECTED_BADGE]: "border-gray-200 bg-gray-50 text-gray-500",
};

const DEFAULT_BADGE_CLASS: string = "border-amber-200 bg-amber-50 text-amber-700";

const ValuePickerMenu: React.ForwardRefExoticComponent<
  ValuePickerMenuProps & React.RefAttributes<ValuePickerMenuHandle>
> = forwardRef<ValuePickerMenuHandle, ValuePickerMenuProps>(
  (
    props: ValuePickerMenuProps,
    ref: React.ForwardedRef<ValuePickerMenuHandle>,
  ): ReactElement => {
    const picker: ValuePickerContextValue = useValuePicker();
    const generatedId: string = useId();
    const listboxId: string = props.listboxId || `${generatedId}-values`;

    const [search, setSearch] = useState<string>("");
    const [drill, setDrill] = useState<DrillView | null>(null);
    const [activeIndex, setActiveIndex] = useState<number>(0);
    const [path, setPath] = useState<string>("");
    const [pathError, setPathError] = useState<string | null>(null);

    const searchRef: React.MutableRefObject<HTMLInputElement | null> =
      useRef<HTMLInputElement | null>(null);

    const query: string = props.hasSearchBox ? search : props.query || "";

    const groups: Array<ValueSuggestionGroup> = useMemo(() => {
      return props.groupFilter
        ? picker.groups.filter(props.groupFilter)
        : picker.groups;
    }, [picker.groups, props.groupFilter]);

    const drillChildren: ChildrenState | null = drill
      ? picker.getChildren(drill.item)
      : null;

    useEffect(() => {
      if (drill) {
        picker.loadChildren(drill.item);
      }
    }, [drill]);

    // Start from the top whenever what is listed changes.
    useEffect(() => {
      setActiveIndex(0);
    }, [query, drill]);

    const sections: Array<OptionSection> = useMemo(() => {
      if (drill) {
        const whole: MenuOption = {
          key: `whole:${drill.item.reference}`,
          label: drill.item.drillIn?.wholeValueLabel || drill.item.label,
          typeLabel: drill.item.typeLabel,
          reference: drill.item.reference,
        };

        // Inline, what is typed is the reference so far, not a field's name.
        const childQuery: string = props.hasSearchBox ? search : "";

        const children: Array<MenuOption> = (drillChildren?.items || [])
          .filter((child: ValueSuggestion) => {
            return suggestionMatches(child, null, childQuery);
          })
          .map((child: ValueSuggestion): MenuOption => {
            return {
              key: child.reference,
              label: child.label,
              description: child.description,
              typeLabel: child.typeLabel,
              badges: child.badges,
              reference: child.reference,
            };
          });

        return [
          {
            key: "drill",
            options:
              childQuery.trim() === "" ? [whole, ...children] : children,
          },
        ];
      }

      return filterSuggestionGroups(groups, query).map(
        (group: ValueSuggestionGroup): OptionSection => {
          return {
            key: group.id,
            title: group.title,
            subtitle: group.subtitle,
            iconProp: group.iconProp,
            options: group.items.map((item: ValueSuggestion): MenuOption => {
              return {
                key: item.reference,
                label: item.label,
                description: item.description,
                typeLabel: item.typeLabel,
                badges: item.badges,
                reference: item.reference,
                // A record is opened; anything else is inserted whole.
                opens: Boolean(item.drillIn?.loadChildren),
                canLookInside: Boolean(
                  item.drillIn &&
                    !item.drillIn.loadChildren &&
                    item.drillIn.allowsPath,
                ),
                item: item,
                group: group,
              };
            }),
          };
        },
      );
    }, [drill, drillChildren, groups, query, search, props.hasSearchBox]);

    const options: Array<MenuOption> = useMemo(() => {
      return sections.flatMap((section: OptionSection) => {
        return section.options;
      });
    }, [sections]);

    const optionId: (index: number) => string = (index: number): string => {
      return `${listboxId}-option-${index}`;
    };

    const activeOptionId: string | undefined =
      options.length > 0 && activeIndex < options.length
        ? optionId(activeIndex)
        : undefined;

    useEffect(() => {
      props.onActiveOptionChange?.(activeOptionId);
    }, [activeOptionId]);

    // Keep the option the keys are on in view.
    useEffect(() => {
      const element: HTMLElement | null = activeOptionId
        ? document.getElementById(activeOptionId)
        : null;

      if (element && typeof element.scrollIntoView === "function") {
        element.scrollIntoView({ block: "nearest" });
      }
    }, [activeOptionId]);

    useEffect(() => {
      if (props.hasSearchBox) {
        searchRef.current?.focus();
      }
    }, [drill]);

    type OpenFunction = (option: MenuOption) => void;

    const open: OpenFunction = (option: MenuOption): void => {
      if (!option.item || !option.group) {
        return;
      }

      setDrill({ item: option.item, group: option.group });
      setSearch("");
      setPath("");
      setPathError(null);
    };

    type ActivateFunction = (option: MenuOption) => void;

    const activate: ActivateFunction = (option: MenuOption): void => {
      if (option.opens) {
        open(option);
        return;
      }

      props.onPick(option.reference);
    };

    type BackFunction = () => void;

    const back: BackFunction = (): void => {
      setDrill(null);
      setSearch("");
      setPath("");
      setPathError(null);
    };

    type InsertPathFunction = () => void;

    const insertPath: InsertPathFunction = (): void => {
      if (!drill) {
        return;
      }

      const reference: string | null = appendPathToReference(
        drill.item.reference,
        path,
      );

      if (!reference) {
        setPathError(
          "Use names separated by dots, with [0] for a list item - for example title or alerts[0].status.",
        );
        return;
      }

      props.onPick(reference);
    };

    type HandleKeyFunction = (event: {
      key: string;
      shiftKey?: boolean;
      preventDefault: () => void;
    }) => boolean;

    const handleKey: HandleKeyFunction = (event: {
      key: string;
      shiftKey?: boolean;
      preventDefault: () => void;
    }): boolean => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (options.length === 0) {
          return false;
        }

        event.preventDefault();
        const step: number = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((current: number) => {
          return (current + step + options.length) % options.length;
        });
        return true;
      }

      if (event.key === "Enter") {
        const option: MenuOption | undefined = options[activeIndex];

        if (!option) {
          return false;
        }

        event.preventDefault();
        activate(option);
        return true;
      }

      if (event.key === "ArrowRight" && !drill) {
        const option: MenuOption | undefined = options[activeIndex];

        if (!option || (!option.opens && !option.canLookInside)) {
          return false;
        }

        // In the search box the key also moves the caret: only at the end.
        if (
          props.hasSearchBox &&
          searchRef.current &&
          searchRef.current.selectionStart !== search.length
        ) {
          return false;
        }

        event.preventDefault();
        open(option);
        return true;
      }

      if (
        drill &&
        (event.key === "ArrowLeft" || event.key === "Backspace") &&
        (!props.hasSearchBox || search === "")
      ) {
        event.preventDefault();
        back();
        return true;
      }

      return false;
    };

    useImperativeHandle(ref, () => {
      return { handleKeyDown: handleKey };
    });

    const groupFiltered: boolean = Boolean(props.groupFilter);
    const hasAnyValues: boolean = groups.length > 0;
    const showNotConnected: boolean =
      !drill &&
      !groupFiltered &&
      picker.isAvailable &&
      !picker.isTrigger &&
      !picker.hasIncomingConnection;

    type RenderOptionFunction = (option: MenuOption, index: number) => ReactElement;

    const renderOption: RenderOptionFunction = (
      option: MenuOption,
      index: number,
    ): ReactElement => {
      const isActive: boolean = index === activeIndex;

      return (
        <div
          key={option.key}
          id={optionId(index)}
          role="option"
          aria-selected={isActive}
          title={option.reference}
          data-testid="value-picker-option"
          data-reference={option.reference}
          className={`mx-1 flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 ${
            isActive ? "bg-indigo-50" : ""
          }`}
          onMouseMove={() => {
            if (!isActive) {
              setActiveIndex(index);
            }
          }}
          onMouseDown={(event: React.MouseEvent<HTMLDivElement>) => {
            // The focus stays where it is: the search box, or the field.
            event.preventDefault();
          }}
          onClick={() => {
            activate(option);
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm text-gray-900">
                {option.label}
              </span>
              {(option.badges || []).map((badge: string) => {
                return (
                  <span
                    key={badge}
                    className={`shrink-0 rounded border px-1 text-[10px] font-medium leading-4 ${
                      BADGE_CLASS[badge] || DEFAULT_BADGE_CLASS
                    }`}
                  >
                    {badge}
                  </span>
                );
              })}
            </div>
            {option.description && (
              <div className="truncate text-xs text-gray-500">
                {option.description}
              </div>
            )}
          </div>
          {option.typeLabel && (
            <span className="mt-0.5 shrink-0 rounded border border-gray-200 px-1.5 text-[10px] font-medium uppercase leading-4 tracking-wide text-gray-500">
              {option.typeLabel}
            </span>
          )}
          {option.opens && (
            <span
              className="mt-0.5 flex shrink-0 items-center text-gray-400"
              aria-hidden="true"
            >
              <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
            </span>
          )}
          {option.canLookInside && (
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Use a field inside ${option.label}`}
              title={`Use a field inside ${option.label}`}
              data-testid="value-picker-look-inside"
              className="-my-0.5 flex shrink-0 items-center rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              onMouseDown={(event: React.MouseEvent<HTMLButtonElement>) => {
                event.preventDefault();
              }}
              onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                event.stopPropagation();
                open(option);
              }}
            >
              <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
            </button>
          )}
        </div>
      );
    };

    let optionIndex: number = 0;

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {drill && (
          <div className="flex items-center gap-1 border-b border-gray-100 px-2 py-1.5">
            <button
              type="button"
              className="flex items-center gap-0.5 rounded px-1 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              data-testid="value-picker-back"
              onMouseDown={(event: React.MouseEvent<HTMLButtonElement>) => {
                event.preventDefault();
              }}
              onClick={back}
            >
              <Icon icon={IconProp.ChevronLeft} className="h-3.5 w-3.5" />
              Back
            </button>
            <div className="min-w-0 truncate text-xs text-gray-500">
              <span className="font-medium text-gray-900">
                {drill.item.label}
              </span>{" "}
              from {drill.group.title}
            </div>
          </div>
        )}

        {props.hasSearchBox && (
          <div className="border-b border-gray-100 p-2">
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5">
                <Icon icon={IconProp.Search} className="h-4 w-4 text-gray-400" />
              </div>
              <input
                ref={searchRef}
                type="text"
                value={search}
                role="combobox"
                aria-expanded={true}
                aria-controls={listboxId}
                aria-activedescendant={activeOptionId}
                aria-autocomplete="list"
                aria-label={drill ? `Search ${drill.item.label}` : "Search values"}
                placeholder={
                  drill
                    ? `Search the fields of ${drill.item.label}`
                    : props.searchPlaceholder || "Search values"
                }
                data-testid="value-picker-search"
                spellCheck={false}
                autoComplete="off"
                className="block w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setSearch(event.target.value);
                }}
                onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                  handleKey(event);
                }}
              />
            </div>
          </div>
        )}

        <div
          id={listboxId}
          role="listbox"
          aria-label={drill ? `Inside ${drill.item.label}` : "Values"}
          className="min-h-0 flex-1 overflow-y-auto py-1"
        >
          {showNotConnected && (
            <div
              className="mx-1 mb-1 flex items-start gap-1.5 rounded-md bg-gray-50 px-2 py-1.5 text-xs text-gray-600"
              data-testid="value-picker-not-connected"
            >
              <Icon
                icon={IconProp.Info}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400"
              />
              <span>
                Only the trigger&apos;s values are listed until this step is
                connected. Connect it after the steps whose values you need.
              </span>
            </div>
          )}

          {sections.map((section: OptionSection) => {
            const headerId: string = `${listboxId}-${section.key}`;

            return (
              <div
                key={section.key}
                role="group"
                aria-labelledby={section.title ? headerId : undefined}
                className="pb-1"
              >
                {section.title && (
                  <div
                    id={headerId}
                    className="flex min-w-0 items-center gap-1.5 px-3 pb-1 pt-2"
                  >
                    {section.iconProp && (
                      <Icon
                        icon={section.iconProp}
                        className="h-3.5 w-3.5 shrink-0 text-gray-400"
                      />
                    )}
                    <span className="truncate text-xs font-semibold text-gray-700">
                      {section.title}
                    </span>
                    {section.subtitle && (
                      <span className="truncate text-[11px] text-gray-400">
                        {section.subtitle}
                      </span>
                    )}
                  </div>
                )}
                {section.options.map((option: MenuOption) => {
                  return renderOption(option, optionIndex++);
                })}
              </div>
            );
          })}

          {drill && drillChildren?.status === ChildrenStatus.Loading && (
            <div className="px-3 py-2 text-xs text-gray-500">
              Loading the fields of {drill.item.label}…
            </div>
          )}

          {drill && drillChildren?.status === ChildrenStatus.Failed && (
            <div className="px-3 py-2 text-xs text-amber-700">
              Couldn&apos;t load the fields of {drill.item.label}:{" "}
              {drillChildren.error}
            </div>
          )}

          {!drill && options.length === 0 && query.trim() !== "" && (
            <div
              className="px-3 py-2 text-xs text-gray-500"
              data-testid="value-picker-no-match"
            >
              No values match &ldquo;{query.trim()}&rdquo;.
            </div>
          )}

          {!drill &&
            !hasAnyValues &&
            !picker.isLoading &&
            query.trim() === "" && (
              <div
                className="px-3 py-3 text-xs text-gray-500"
                data-testid="value-picker-empty"
              >
                {props.emptyMessage ||
                  (picker.isTrigger
                    ? "A trigger runs first, so there is nothing before it to use. Workflow and global variables show up here."
                    : "Nothing to use yet. The values of the steps that run before this one, and the workflow's variables, show up here.")}
              </div>
            )}

          {!drill && picker.isLoading && (
            <div className="px-3 py-2 text-xs text-gray-500">
              Loading variables…
            </div>
          )}

          {!drill &&
            picker.loadErrors.map((error: string) => {
              return (
                <div key={error} className="px-3 py-2 text-xs text-amber-700">
                  Couldn&apos;t load the variables: {error}
                </div>
              );
            })}
        </div>

        {drill && drill.item.drillIn?.allowsPath && (
          <form
            className="border-t border-gray-100 p-2"
            onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              insertPath();
            }}
          >
            <label
              className="mb-1 block text-xs text-gray-600"
              htmlFor={`${listboxId}-path`}
            >
              Or a field inside {drill.item.label}
            </label>
            <div className="flex gap-1.5">
              <input
                id={`${listboxId}-path`}
                type="text"
                value={path}
                placeholder={drill.item.drillIn.pathPlaceholder}
                data-testid="value-picker-path"
                spellCheck={false}
                autoComplete="off"
                className="block w-full min-w-0 rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-xs text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setPath(event.target.value);
                  setPathError(null);
                }}
                onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                  // Enter submits the form; it must not reach the field.
                  if (event.key === "Enter") {
                    event.stopPropagation();
                  }
                }}
              />
              <button
                type="submit"
                className="shrink-0 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                data-testid="value-picker-path-insert"
              >
                Insert
              </button>
            </div>
            {pathError && (
              <p className="mt-1 text-xs text-red-600" role="alert">
                {pathError}
              </p>
            )}
          </form>
        )}
      </div>
    );
  },
);

ValuePickerMenu.displayName = "ValuePickerMenu";

export default ValuePickerMenu;
