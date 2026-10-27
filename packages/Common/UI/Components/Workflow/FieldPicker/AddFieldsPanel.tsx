/*
 * "Add field": the list a record step's field list is picked from - every
 * field of the record, grouped the way people think of it (FieldPickerOptions),
 * searched by name, kind or description, picked several at a time.
 *
 * It opens in place under the chosen fields, as the Query and record
 * editors' "Add a field" list does (AddColumnPicker): the settings dialog
 * scrolls and clips, and an inline panel has nothing to get wrong there.
 * Unlike that list, a pick keeps it open - a step usually passes on several
 * fields - and each field shows whether it is chosen; Done closes it.
 *
 * Opening it brings the whole list into view: on a phone the settings
 * dialog's buttons take a third of the screen, and the list opened under
 * them. There it opens for browsing, too, as the Add Component panel does:
 * focusing the search box would throw the keyboard over the fields.
 *
 * Escape is the field's to hear, not this list's (ModelFieldPicker): it has
 * to close the list from the Add field button and the chips as well, so one
 * place answers it for all of them.
 *
 * A press outside the list closes it once the press is over, not as it
 * lands (Utils/UseAfterPress). The list is in the page, so closing it pulls
 * everything under it up by its height: closed on the press, the button
 * being pressed - Edit as JSON under it, the other list's Add field - was
 * gone from under the pointer before the release, and the click did nothing.
 */

import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import {
  FieldGroup,
  FieldOption,
  PanelRow,
  PanelRowKind,
  getPanelRows,
} from "./FieldPickerOptions";
import {
  PluralTemplate,
  translationKey,
  Translator,
} from "../../../Utils/TranslateTemplate";
import prefersTouch from "../../../Utils/PrefersTouch";
import useAfterPress, {
  AfterPressFunction,
} from "../../../Utils/UseAfterPress";
import useTranslator from "../../../Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * How tall the list of fields gets before it scrolls: 18rem, five rows and a
 * bit of the next. Set on the element itself, not as a class: the Dashboard
 * builds a class's style the first time the class is drawn, a moment after
 * the element, and the list is brought into view as it opens - measured
 * without its height it was every field tall, and landed at the top of the
 * dialog with the chosen fields scrolled out of sight.
 */
export const ADD_FIELDS_LIST_MAX_HEIGHT: string = "18rem";

// The counts are plurals, written whole so the extractor reads both forms.
export const AddFieldsPanelCopy: {
  readonly search: PluralTemplate;
  readonly noMatch: string;
  readonly done: string;
  readonly close: string;
  readonly chosen: PluralTemplate;
  readonly fields: PluralTemplate;
} = {
  search: { one: "Search {{count}} field", other: "Search {{count}} fields" },
  noMatch: translationKey("No fields match “{{query}}”."),
  done: translationKey("Done"),
  close: translationKey("Close"),
  chosen: { one: "{{count}} chosen", other: "{{count}} chosen" },
  fields: { one: "{{count}} field", other: "{{count}} fields" },
};

export interface ComponentProps {
  options: Array<FieldOption>;
  groups: Array<FieldGroup>;
  // The paths chosen now.
  chosen: Array<string>;
  onToggle: (option: FieldOption) => void;
  // Closes the list; returnFocus when it was dismissed rather than left.
  onClose: (options: { returnFocus: boolean }) => void;
  // What the list is for, for its name: "Fields to pass on".
  label: string;
  dataTestId: string;
  /*
   * The button that opens and closes the list. A press on it is its own to
   * answer: closing here as well would have its click open the list again.
   */
  toggleRef?: React.RefObject<HTMLElement | null> | undefined;
}

const AddFieldsPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const idPrefix: string = useId();
  const listboxId: string = `${idPrefix}-fields`;
  const testId: string = props.dataTestId;

  const [query, setQuery] = useState<string>("");
  const [expanded, setExpanded] = useState<Array<string>>(() => {
    // A related record some of whose fields are chosen opens on them.
    return props.options
      .filter((option: FieldOption): boolean => {
        return (
          Boolean(option.isRelation) &&
          props.chosen.some((path: string): boolean => {
            return path.startsWith(`${option.path}.`);
          })
        );
      })
      .map((option: FieldOption): string => {
        return option.path;
      });
  });
  const [activeIndex, setActiveIndex] = useState<number>(0);

  const panelRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const searchRef: React.MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);

  const afterPress: AfterPressFunction = useAfterPress();

  // The latest onClose, for what is called a moment after it was asked for.
  const onCloseRef: React.MutableRefObject<
    (options: { returnFocus: boolean }) => void
  > = useRef(props.onClose);
  onCloseRef.current = props.onClose;

  type CloseAfterPressFunction = () => void;

  /*
   * Left by a press or by Tab: closed once the press is over and the click
   * it makes has been handled, so what was pressed is still where it was.
   */
  const closeAfterPress: CloseAfterPressFunction = (): void => {
    afterPress(() => {
      onCloseRef.current({ returnFocus: false });
    });
  };

  const rows: Array<PanelRow> = useMemo(() => {
    return getPanelRows({
      options: props.options,
      groups: props.groups,
      query: query,
      expanded: expanded,
    });
  }, [props.options, props.groups, query, expanded]);

  const optionRows: Array<PanelRow> = rows.filter((row: PanelRow): boolean => {
    return row.kind === PanelRowKind.Option;
  });

  const activeRow: PanelRow | undefined =
    optionRows[Math.min(activeIndex, optionRows.length - 1)];

  type OptionIdFunction = (option: FieldOption) => string;

  const optionId: OptionIdFunction = (option: FieldOption): string => {
    return `${idPrefix}-field-${option.path}`;
  };

  /*
   * The record's own fields and related records, as the list shows them:
   * counting every field of every related record said "Search 766 fields".
   */
  const pickableCount: number = props.options.filter(
    (option: FieldOption): boolean => {
      return !option.relationPath;
    },
  ).length;

  useEffect(() => {
    // Where a finger is the pointer, the list opens for browsing.
    if (!prefersTouch()) {
      searchRef.current?.focus({ preventScroll: true });
    }
  }, []);

  /*
   * The whole list in view, down to Done, not just its first row: as it
   * opens, and again after each pick. A pick can add a line of chips above
   * the list, which pushes it down - on a phone, back under the dialog's
   * buttons, from under the finger that made the pick.
   */
  useEffect(() => {
    const panel: HTMLDivElement | null = panelRef.current;

    if (panel && typeof panel.scrollIntoView === "function") {
      panel.scrollIntoView({ block: "nearest" });
    }
  }, [props.chosen.length]);

  // A press anywhere outside the list closes it, the way a menu would.
  useEffect(() => {
    const onPointerDown: (event: MouseEvent) => void = (
      event: MouseEvent,
    ): void => {
      const panel: HTMLDivElement | null = panelRef.current;

      if (!(event.target instanceof Node)) {
        return;
      }

      if (panel && panel.contains(event.target)) {
        return;
      }

      // The button that opened it closes it itself.
      if (props.toggleRef?.current?.contains(event.target)) {
        return;
      }

      closeAfterPress();
    };

    document.addEventListener("mousedown", onPointerDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, []);

  // The row the keyboard is on stays in view.
  useEffect(() => {
    const option: FieldOption | undefined = activeRow?.option;

    if (!option) {
      return;
    }

    const element: HTMLElement | null = document.getElementById(
      optionId(option),
    );

    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, activeRow?.option?.path]);

  type ToggleExpandedFunction = (path: string, open?: boolean) => void;

  const toggleExpanded: ToggleExpandedFunction = (
    path: string,
    open?: boolean,
  ): void => {
    setExpanded((current: Array<string>) => {
      const isOpen: boolean = current.includes(path);
      const shouldOpen: boolean = open === undefined ? !isOpen : open;

      if (shouldOpen === isOpen) {
        return current;
      }

      return shouldOpen
        ? [...current, path]
        : current.filter((candidate: string): boolean => {
            return candidate !== path;
          });
    });
  };

  type ActivateFunction = (option: FieldOption) => void;

  const activate: ActivateFunction = (option: FieldOption): void => {
    if (option.isRelation) {
      toggleExpanded(option.path);
      return;
    }

    props.onToggle(option);
  };

  type MoveFunction = (step: number) => void;

  const move: MoveFunction = (step: number): void => {
    if (optionRows.length === 0) {
      return;
    }

    const current: number = Math.min(activeIndex, optionRows.length - 1);

    setActiveIndex((current + step + optionRows.length) % optionRows.length);
  };

  type OnKeyDownFunction = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => void;

  const onKeyDown: OnKeyDownFunction = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ): void => {
    const option: FieldOption | undefined = activeRow?.option;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        return;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        return;
      case "ArrowRight":
        if (option?.isRelation && !expanded.includes(option.path)) {
          event.preventDefault();
          toggleExpanded(option.path, true);
        }

        return;
      case "ArrowLeft":
        if (option?.isRelation && expanded.includes(option.path)) {
          event.preventDefault();
          toggleExpanded(option.path, false);
          return;
        }

        if (option?.relationPath && query.trim() === "") {
          // Back up to the related record the field is in.
          event.preventDefault();

          const parentIndex: number = optionRows.findIndex(
            (row: PanelRow): boolean => {
              return row.option?.path === option.relationPath;
            },
          );

          if (parentIndex >= 0) {
            setActiveIndex(parentIndex);
          }
        }

        return;
      case "Enter":
        // Never the settings form's submit.
        event.preventDefault();

        if (option) {
          activate(option);
        }

        return;
      default:
        return;
    }
  };

  const chosenCount: number = props.chosen.length;

  let optionIndex: number = -1;

  return (
    <div
      ref={panelRef}
      data-testid={`${testId}-panel`}
      className="mt-2 w-full max-w-2xl overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm"
      onBlur={(event: React.FocusEvent<HTMLDivElement>) => {
        const next: EventTarget | null = event.relatedTarget;

        // Tabbing out of the list closes it; moving within it does not.
        if (
          next instanceof Node &&
          panelRef.current &&
          !panelRef.current.contains(next)
        ) {
          // To the button that opened it: that button closes it itself.
          if (props.toggleRef?.current?.contains(next)) {
            return;
          }

          closeAfterPress();
        }
      }}
    >
      <div className="flex items-center gap-2 border-b border-gray-100 px-3">
        <Icon
          icon={IconProp.MagnifyingGlass}
          className="h-4 w-4 shrink-0 text-gray-400"
        />
        <input
          data-unsaved-changes-ignore
          ref={searchRef}
          type="text"
          role="combobox"
          aria-expanded={true}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeRow?.option ? optionId(activeRow.option) : undefined
          }
          aria-label={translator.translatePlural(
            AddFieldsPanelCopy.search,
            pickableCount,
          )}
          placeholder={translator.translatePlural(
            AddFieldsPanelCopy.search,
            pickableCount,
          )}
          data-testid={`${testId}-search`}
          autoComplete="off"
          spellCheck={false}
          value={query}
          className="block w-full min-w-0 border-0 bg-transparent px-0 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0"
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          aria-label={translator.translateText(AddFieldsPanelCopy.close)}
          data-testid={`${testId}-close`}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          onClick={() => {
            props.onClose({ returnFocus: true });
          }}
        >
          <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
        </button>
      </div>

      <div
        id={listboxId}
        role="listbox"
        aria-multiselectable={true}
        aria-label={translator.translateText(props.label)}
        data-testid={`${testId}-list`}
        className="overflow-x-hidden py-1"
        style={{ maxHeight: ADD_FIELDS_LIST_MAX_HEIGHT, overflowY: "auto" }}
      >
        {optionRows.length === 0 ? (
          <p
            className="px-3 py-6 text-center text-sm text-gray-500"
            data-testid={`${testId}-no-match`}
          >
            {translator.translateTemplate(AddFieldsPanelCopy.noMatch, {
              query: query.trim(),
            })}
          </p>
        ) : null}

        {rows.map((row: PanelRow) => {
          if (row.kind === PanelRowKind.Heading && row.group) {
            return (
              <div
                key={`heading-${row.group.id}`}
                role="presentation"
                data-testid={`${testId}-group-${row.group.id}`}
                className="flex min-w-0 items-baseline gap-2 px-3 pb-1 pt-2"
              >
                <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  {translator.translateText(row.group.label)}
                </span>
                {/* Says how the group works: written to be read, not gray-400. */}
                {row.group.hint ? (
                  <span
                    className="truncate text-[11px] text-gray-500"
                    data-part="hint"
                  >
                    {translator.translateText(row.group.hint)}
                  </span>
                ) : null}
              </div>
            );
          }

          const option: FieldOption = row.option as FieldOption;
          optionIndex++;
          const index: number = optionIndex;
          const isActive: boolean = row === activeRow;
          const isChosen: boolean = props.chosen.includes(option.path);
          const isExpanded: boolean = expanded.includes(option.path);
          const chosenInside: number = option.isRelation
            ? props.chosen.filter((path: string): boolean => {
                return path.startsWith(`${option.path}.`);
              }).length
            : 0;

          return (
            <div
              key={option.path}
              id={optionId(option)}
              role="option"
              aria-selected={option.isRelation ? false : isChosen}
              aria-expanded={option.isRelation ? isExpanded : undefined}
              data-testid={`${testId}-option-${option.path}`}
              data-chosen={isChosen ? "true" : "false"}
              className={`flex cursor-pointer items-center gap-3 py-2 pr-3 ${
                row.depth > 0 ? "pl-10" : "pl-3"
              } ${isActive ? "bg-indigo-50" : "hover:bg-gray-50"}`}
              onMouseDown={(event: React.MouseEvent<HTMLDivElement>) => {
                // The focus stays in the search box, so the list stays open.
                event.preventDefault();
              }}
              onMouseMove={() => {
                if (index !== activeIndex) {
                  setActiveIndex(index);
                }
              }}
              onClick={() => {
                setActiveIndex(index);
                activate(option);
              }}
            >
              {option.isRelation ? (
                <Icon
                  icon={
                    isExpanded ? IconProp.ChevronDown : IconProp.ChevronRight
                  }
                  className="h-4 w-4 shrink-0 text-gray-400"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    isChosen
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-gray-300 bg-white"
                  }`}
                >
                  {isChosen ? (
                    <Icon icon={IconProp.Check} className="h-3 w-3" />
                  ) : null}
                </span>
              )}
              <div className="min-w-0 flex-1">
                {/*
                 * A field's name, description and kind come in the reader's
                 * language already (FieldPickerOptions): they are what the
                 * list is searched and sorted by.
                 */}
                <div
                  data-part="name"
                  className="truncate text-sm font-medium text-gray-900"
                >
                  {row.depth > 0 ? option.shortTitle : option.title}
                </div>
                {/*
                 * The line under the name: gray-500 on white, and a shade
                 * darker on the row the pointer or the keys are on, whose
                 * tint would otherwise leave it at 4.3:1.
                 */}
                {option.isRelation ? (
                  <div
                    data-part="detail"
                    className={`truncate text-xs ${
                      isActive ? "text-gray-600" : "text-gray-500"
                    }`}
                  >
                    {chosenInside > 0
                      ? translator.translatePlural(
                          AddFieldsPanelCopy.chosen,
                          chosenInside,
                        )
                      : translator.translatePlural(
                          AddFieldsPanelCopy.fields,
                          option.fieldCount || 0,
                        )}
                  </div>
                ) : option.description ? (
                  <div
                    data-part="detail"
                    className={`truncate text-xs ${
                      isActive ? "text-gray-600" : "text-gray-500"
                    }`}
                    title={option.description}
                  >
                    {option.description}
                  </div>
                ) : null}
              </div>
              <span
                data-part="kind"
                className="mt-0.5 shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600"
              >
                {option.typeLabel}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-gray-100 bg-gray-50 px-3 py-2">
        <span
          className="text-xs text-gray-500"
          data-testid={`${testId}-chosen-count`}
        >
          {translator.translatePlural(AddFieldsPanelCopy.chosen, chosenCount)}
        </span>
        <button
          type="button"
          data-testid={`${testId}-done`}
          className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          onClick={() => {
            props.onClose({ returnFocus: true });
          }}
        >
          {translator.translateText(AddFieldsPanelCopy.done)}
        </button>
      </div>
    </div>
  );
};

export default AddFieldsPanel;
