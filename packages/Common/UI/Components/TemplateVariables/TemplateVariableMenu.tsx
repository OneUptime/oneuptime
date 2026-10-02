/*
 * The list of template variables to pick from, in the popup that the editor's
 * Insert variable button opens and in the one that opens under the cursor
 * while "{{" is being typed.
 *
 * Each variable says what it is filled with first - "Declared At" - and its
 * {{name}} under that, so nobody has to know the syntax to pick one. Grouped
 * as the field groups them ("Incident", "Custom Fields"), searchable, and
 * walked with the arrow keys; Enter (and, while typing, Tab) picks.
 *
 * Two ways of being driven:
 * - with a search box of its own (the toolbar button): the box takes the
 *   focus and its keys move through the list;
 * - filtered by what is typed after "{{" in the field, which keeps the focus
 *   and hands its keys over (handleKeyDown).
 */

import { SearchIcon } from "./TemplateVariableIcons";
import TemplateVariablesCopy from "./TemplateVariablesCopy";
import {
  TemplateVariable,
  TemplateVariableGroup,
  TemplateVariableGroups,
  filterTemplateVariableGroups,
  formatTemplateVariable,
} from "../../../Types/Template/TemplateVariable";
import useTranslateValue from "../../Utils/Translation";
import React, {
  ReactElement,
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";

export interface TemplateVariableMenuHandle {
  /**
   * Typing mode: the field passes its keys here. True when the menu used the
   * key, in which case the field must not.
   */
  handleKeyDown: (event: {
    key: string;
    preventDefault: () => void;
  }) => boolean;
}

export interface TemplateVariableMenuProps {
  groups: TemplateVariableGroups;
  /**
   * True: a search box of its own, which takes the focus. False: filtered by
   * `query`, what is typed after "{{" in the field, which keeps the focus.
   */
  hasSearchBox: boolean;
  query?: string | undefined;
  onPick: (variable: TemplateVariable) => void;
  /** The listbox's id, for the field's aria-controls. */
  listboxId?: string | undefined;
  /** The option the arrow keys are on, for the field's aria-activedescendant. */
  onActiveOptionChange?: ((optionId: string | undefined) => void) | undefined;
  /** Typing mode: called when nothing matches what was typed, to close. */
  onNoMatches?: (() => void) | undefined;
}

interface MenuOption {
  variable: TemplateVariable;
  description: string;
  index: number;
}

interface MenuSection {
  key: string;
  // For the group's heading id: an id may not hold the title's spaces.
  index: number;
  title?: string | undefined;
  options: Array<MenuOption>;
}

const TemplateVariableMenu: React.ForwardRefExoticComponent<
  TemplateVariableMenuProps & React.RefAttributes<TemplateVariableMenuHandle>
> = forwardRef<TemplateVariableMenuHandle, TemplateVariableMenuProps>(
  (
    props: TemplateVariableMenuProps,
    ref: React.ForwardedRef<TemplateVariableMenuHandle>,
  ): ReactElement => {
    const { translateString } = useTranslateValue();
    const generatedId: string = useId();
    const listboxId: string =
      props.listboxId || `template-variables-${generatedId}`;

    const [search, setSearch] = useState<string>("");
    const [activeIndex, setActiveIndex] = useState<number>(0);

    const tx: (text: string) => string = (text: string): string => {
      return translateString(text) || text;
    };

    const describe: (variable: TemplateVariable) => string = (
      variable: TemplateVariable,
    ): string => {
      return variable.isDescriptionVerbatim
        ? variable.description
        : tx(variable.description);
    };

    const query: string = props.hasSearchBox ? search : props.query || "";

    const sections: Array<MenuSection> = useMemo(() => {
      const groups: Array<TemplateVariableGroup> = filterTemplateVariableGroups(
        props.groups,
        query,
        describe,
      );
      let index: number = 0;

      return groups.map(
        (group: TemplateVariableGroup, groupIndex: number): MenuSection => {
          return {
            key: `${groupIndex}-${group.title || ""}`,
            index: groupIndex,
            title: group.title,
            options: group.variables.map(
              (variable: TemplateVariable): MenuOption => {
                return {
                  variable: variable,
                  description: describe(variable),
                  index: index++,
                };
              },
            ),
          };
        },
      );
    }, [props.groups, query]);

    const options: Array<MenuOption> = useMemo(() => {
      return sections.flatMap((section: MenuSection): Array<MenuOption> => {
        return section.options;
      });
    }, [sections]);

    // A new search starts at the top of what it found.
    useEffect(() => {
      setActiveIndex(0);
    }, [query]);

    const safeActiveIndex: number =
      options.length === 0 ? -1 : Math.min(activeIndex, options.length - 1);

    const optionId: (index: number) => string = (index: number): string => {
      return `${listboxId}-option-${index}`;
    };

    const activeOptionId: string | undefined =
      safeActiveIndex >= 0 ? optionId(safeActiveIndex) : undefined;

    useEffect(() => {
      props.onActiveOptionChange?.(activeOptionId);
    }, [activeOptionId]);

    useEffect(() => {
      if (!props.hasSearchBox && options.length === 0) {
        props.onNoMatches?.();
      }
    }, [options.length, props.hasSearchBox]);

    // The option the keys are on stays in view as the list scrolls.
    useEffect(() => {
      if (!activeOptionId || typeof document === "undefined") {
        return;
      }

      const element: HTMLElement | null =
        document.getElementById(activeOptionId);

      if (element && typeof element.scrollIntoView === "function") {
        element.scrollIntoView({ block: "nearest" });
      }
    }, [activeOptionId]);

    const pick: (option: MenuOption | undefined) => boolean = (
      option: MenuOption | undefined,
    ): boolean => {
      if (!option) {
        return false;
      }

      props.onPick(option.variable);
      return true;
    };

    const handleKeyDown: (event: {
      key: string;
      preventDefault: () => void;
    }) => boolean = (event: {
      key: string;
      preventDefault: () => void;
    }): boolean => {
      if (options.length === 0) {
        return false;
      }

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setActiveIndex((safeActiveIndex + 1) % options.length);
          return true;
        case "ArrowUp":
          event.preventDefault();
          setActiveIndex(
            (safeActiveIndex - 1 + options.length) % options.length,
          );
          return true;
        case "Enter":
          event.preventDefault();
          return pick(options[safeActiveIndex]);
        case "Tab":
          // While typing, Tab takes the variable, as in a code editor.
          if (props.hasSearchBox) {
            return false;
          }
          event.preventDefault();
          return pick(options[safeActiveIndex]);
        default:
          return false;
      }
    };

    useImperativeHandle(ref, () => {
      return { handleKeyDown: handleKeyDown };
    });

    return (
      <div
        className="flex min-h-0 flex-col"
        data-testid="template-variable-menu"
      >
        {props.hasSearchBox ? (
          <div className="border-b border-gray-200 p-2">
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-gray-400">
                <SearchIcon className="h-4 w-4" />
              </span>
              <input
                type="text"
                role="combobox"
                autoFocus={true}
                value={search}
                aria-label={tx(TemplateVariablesCopy.searchPlaceholder)}
                aria-expanded={true}
                aria-controls={listboxId}
                aria-autocomplete="list"
                aria-activedescendant={activeOptionId}
                placeholder={tx(TemplateVariablesCopy.searchPlaceholder)}
                data-testid="template-variable-search"
                className="block w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-2 text-sm text-gray-900 placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setSearch(event.target.value);
                }}
                onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                  handleKeyDown(event);
                }}
              />
            </div>
          </div>
        ) : null}

        {options.length === 0 ? (
          <p
            className="px-3 py-4 text-center text-sm text-gray-500"
            data-testid="template-variable-menu-empty"
          >
            {tx(TemplateVariablesCopy.noMatches)}
          </p>
        ) : (
          <div
            id={listboxId}
            role="listbox"
            aria-label={tx(TemplateVariablesCopy.listTitle)}
            className="min-h-0 flex-1 overflow-y-auto py-1"
          >
            {sections.map((section: MenuSection): ReactElement => {
              const headingId: string = `${listboxId}-group-${section.index}`;

              return (
                <div
                  key={section.key}
                  role="group"
                  aria-labelledby={section.title ? headingId : undefined}
                >
                  {section.title ? (
                    <div
                      id={headingId}
                      className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500"
                    >
                      {tx(section.title)}
                    </div>
                  ) : null}
                  {section.options.map((option: MenuOption): ReactElement => {
                    const isActive: boolean = option.index === safeActiveIndex;

                    return (
                      <div
                        key={`${option.index}-${option.variable.name}`}
                        id={optionId(option.index)}
                        role="option"
                        aria-selected={isActive}
                        data-testid="template-variable-option"
                        data-variable-name={option.variable.name}
                        className={`mx-1 flex cursor-pointer flex-col gap-0.5 rounded-md px-2 py-1.5 ${
                          isActive ? "bg-indigo-50" : ""
                        }`}
                        onMouseDown={(event: React.MouseEvent) => {
                          // The focus stays where the typing is.
                          event.preventDefault();
                        }}
                        onMouseMove={() => {
                          if (!isActive) {
                            setActiveIndex(option.index);
                          }
                        }}
                        onClick={() => {
                          pick(option);
                        }}
                      >
                        <span className="truncate text-sm text-gray-900">
                          {option.description}
                        </span>
                        <span className="truncate font-mono text-xs text-indigo-700">
                          {formatTemplateVariable(option.variable.name)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  },
);

TemplateVariableMenu.displayName = "TemplateVariableMenu";

export default TemplateVariableMenu;
