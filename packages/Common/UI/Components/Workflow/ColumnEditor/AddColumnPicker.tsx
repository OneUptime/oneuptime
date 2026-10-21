/*
 * "Add a field" / "Add a condition": the list a builder picks a model's
 * column from.
 *
 * It was a react-select dropdown 18rem wide, each option reading
 * "Change Monitor Status To ID · changeMonitorStatusToId" over the column's
 * whole description - three options to a screen, a horizontal scrollbar under
 * them, nothing saying which fields mattered, and Created At sitting between
 * the incident's real fields. The system columns are now filtered out before
 * they get here (ColumnUse), and the list itself is drawn by hand so it can be
 * read:
 *
 *   - a search box, always there, that finds a field by its name, its key, its
 *     description or its kind of value - best match first, so typing and
 *     pressing Enter picks the field you meant;
 *   - groups that say what matters (Required, Main fields, Other fields);
 *   - one line per field: its name, its kind of value, and its description cut
 *     to a line (the full sentence is in the tooltip). The key only appears
 *     where it says something the name does not.
 *
 * The list opens in place, under the rows, rather than floating. It sits in a
 * modal, inside a bordered box that clips its corners; a popover there needs a
 * portal and has to chase the trigger as the modal scrolls, while an inline
 * panel has nothing to get wrong at any width. It stops at max-w-2xl, so in
 * the wide settings modal a field's kind of value stays next to its name
 * instead of a thousand pixels to the right of it.
 */

import IconProp from "../../../../Types/Icon/IconProp";
import Button, { ButtonSize, ButtonStyleType } from "../../Button/Button";
import Icon from "../../Icon/Icon";
import Input from "../../Input/Input";
import { ModelSchemaColumn } from "../ModelSchema";
import { columnTypeLabel } from "./ColumnControl";
import {
  ColumnPickerGroup,
  groupPickerColumns,
  isColumnDescriptionInformative,
  isColumnKeyInformative,
  searchPickerColumns,
} from "./ColumnPickerOptions";
import { ColumnUse } from "./ColumnUse";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";

export interface ComponentProps {
  /** Already filtered to what may be offered for this use, and to what is not on screen. */
  columns: Array<ModelSchemaColumn>;
  use: ColumnUse;
  /** Column ids a create must be given a value for, listed first. */
  requiredColumnIds: Array<string>;
  /** The button's words: "Add a field", "Add a condition". */
  triggerLabel: string;
  /**
   * Whether the builder may also name a column the list does not show. The
   * runner accepts column names this endpoint does not describe, and when the
   * schema failed to load this is the only way to add one at all.
   */
  allowCustomColumn: boolean;
  onAdd: (columnId: string) => void;
  dataTestId?: string | undefined;
}

/*
 * What a search box typed into should keep when it turns into "Add a column by
 * name": a single word reads as a column name someone was looking for, a
 * phrase does not.
 */
const LOOKS_LIKE_COLUMN_NAME: RegExp = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface PickerSection {
  group: ColumnPickerGroup | null;
  columns: Array<ModelSchemaColumn>;
}

const AddColumnPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const testId: string = props.dataTestId || "model-column-add";
  const idPrefix: string = useId();
  const listboxId: string = `${idPrefix}-listbox`;

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [isNamingCustomColumn, setIsNamingCustomColumn] =
    useState<boolean>(false);
  const [customColumnId, setCustomColumnId] = useState<string>("");

  const panelRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const searchRef: React.MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);
  const triggerRef: React.MutableRefObject<HTMLButtonElement | null> =
    useRef<HTMLButtonElement | null>(null);
  /*
   * Set when the panel is dismissed (Escape, the close button) rather than
   * used, so focus goes back to the button that opened it. After a pick it is
   * left alone: the new row takes focus for its value.
   */
  const returnFocusToTrigger: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const groups: Array<ColumnPickerGroup> = useMemo(() => {
    return groupPickerColumns({
      columns: props.columns,
      use: props.use,
      requiredColumnIds: props.requiredColumnIds,
    });
  }, [props.columns, props.use, props.requiredColumnIds]);

  const trimmedQuery: string = query.trim();

  /*
   * Groups while browsing; one ranked list while searching, because what was
   * typed says more about the field wanted than which group it sits in.
   */
  const sections: Array<PickerSection> = useMemo(() => {
    if (trimmedQuery === "") {
      return groups.map((group: ColumnPickerGroup) => {
        return { group: group, columns: group.columns };
      });
    }

    const inGroupOrder: Array<ModelSchemaColumn> = groups.flatMap(
      (group: ColumnPickerGroup) => {
        return group.columns;
      },
    );

    return [
      { group: null, columns: searchPickerColumns(inGroupOrder, trimmedQuery) },
    ];
  }, [groups, trimmedQuery]);

  const visibleColumns: Array<ModelSchemaColumn> = sections.flatMap(
    (section: PickerSection) => {
      return section.columns;
    },
  );

  // A lone "Other fields" heading over the whole list says nothing.
  const showGroupHeadings: boolean = sections.length > 1;

  const activeColumn: ModelSchemaColumn | undefined =
    visibleColumns[Math.min(activeIndex, visibleColumns.length - 1)];

  type OptionIdFunction = (column: ModelSchemaColumn) => string;

  const optionId: OptionIdFunction = (column: ModelSchemaColumn): string => {
    return `${idPrefix}-option-${column.id}`;
  };

  type CloseFunction = (options: { returnFocus: boolean }) => void;

  const close: CloseFunction = (options: { returnFocus: boolean }): void => {
    returnFocusToTrigger.current = options.returnFocus;
    setIsOpen(false);
    setQuery("");
    setActiveIndex(0);
  };

  type PickFunction = (columnId: string) => void;

  const pick: PickFunction = (columnId: string): void => {
    close({ returnFocus: false });
    props.onAdd(columnId);
  };

  useEffect(() => {
    if (isOpen) {
      searchRef.current?.focus();
      return;
    }

    if (returnFocusToTrigger.current) {
      returnFocusToTrigger.current = false;
      triggerRef.current?.focus();
    }
  }, [isOpen]);

  /*
   * A press anywhere outside the panel closes it, the way a menu would. Focus
   * moving elsewhere by keyboard does the same, through onBlur below.
   */
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onPointerDown: (event: MouseEvent) => void = (
      event: MouseEvent,
    ): void => {
      const panel: HTMLDivElement | null = panelRef.current;

      if (
        panel &&
        event.target instanceof Node &&
        panel.contains(event.target)
      ) {
        return;
      }

      close({ returnFocus: false });
    };

    document.addEventListener("mousedown", onPointerDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [isOpen]);

  // Keep the option the keyboard is on in view as it moves through a long list.
  useEffect(() => {
    if (!isOpen || !activeColumn) {
      return;
    }

    const element: HTMLElement | null = document.getElementById(
      optionId(activeColumn),
    );

    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, isOpen]);

  type StartNamingCustomColumnFunction = () => void;

  const startNamingCustomColumn: StartNamingCustomColumnFunction = (): void => {
    setCustomColumnId(
      LOOKS_LIKE_COLUMN_NAME.test(trimmedQuery) ? trimmedQuery : "",
    );
    close({ returnFocus: false });
    setIsNamingCustomColumn(true);
  };

  type AddCustomColumnFunction = () => void;

  const addCustomColumn: AddCustomColumnFunction = (): void => {
    const columnId: string = customColumnId.trim();

    if (columnId === "") {
      return;
    }

    props.onAdd(columnId);
    setCustomColumnId("");
    setIsNamingCustomColumn(false);
  };

  const hasOptions: boolean = props.columns.length > 0;

  if (isNamingCustomColumn || !hasOptions) {
    if (!props.allowCustomColumn) {
      return <></>;
    }

    return (
      <div className="flex flex-wrap items-start gap-2">
        <div className="w-64 max-w-full">
          <Input
            value={customColumnId}
            placeholder="Column name"
            outerDivClassName="relative w-full"
            dataTestId={`${testId}-custom`}
            /*
             * Focused when someone asked for it from the list, so they can type
             * straight away - but not when it is here only because the schema
             * did not load, which would take focus from wherever it was each
             * time a step's settings opened.
             */
            autoFocus={isNamingCustomColumn}
            onChange={setCustomColumnId}
            onEnterPress={addCustomColumn}
          />
        </div>
        <Button
          title="Add"
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.OUTLINE}
          onClick={addCustomColumn}
        />
        {hasOptions && (
          <Button
            title="Cancel"
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.SECONDARY_LINK}
            onClick={() => {
              setIsNamingCustomColumn(false);
              setCustomColumnId("");
            }}
          />
        )}
      </div>
    );
  }

  if (!isOpen) {
    return (
      <button
        ref={triggerRef}
        type="button"
        data-testid={testId}
        aria-haspopup="listbox"
        aria-expanded={false}
        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        onClick={() => {
          setIsOpen(true);
        }}
      >
        <Icon icon={IconProp.Add} className="h-4 w-4 text-gray-500" />
        {translator.translateText(props.triggerLabel)}
      </button>
    );
  }

  type MoveFunction = (step: number) => void;

  const move: MoveFunction = (step: number): void => {
    if (visibleColumns.length === 0) {
      return;
    }

    const current: number = Math.min(activeIndex, visibleColumns.length - 1);

    setActiveIndex(
      (current + step + visibleColumns.length) % visibleColumns.length,
    );
  };

  type OnSearchKeyDownFunction = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => void;

  const onSearchKeyDown: OnSearchKeyDownFunction = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ): void => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        return;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        return;
      case "Enter":
        // Never the surrounding form's submit.
        event.preventDefault();

        if (activeColumn) {
          pick(activeColumn.id);
        }

        return;
      case "Escape":
        /*
         * The settings modal closes on Escape too, from a document listener
         * that stands down for an event already handled. Escape here means
         * "close this list", not "throw away the step's settings".
         */
        event.preventDefault();
        event.stopPropagation();
        close({ returnFocus: true });
        return;
      default:
        return;
    }
  };

  const searchLabel: string = translator.translatePlural(
    { one: "Search {{count}} field", other: "Search {{count}} fields" },
    props.columns.length,
  );

  return (
    <div
      ref={panelRef}
      data-testid={`${testId}-panel`}
      className="w-full max-w-2xl overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm"
      onBlur={(event: React.FocusEvent<HTMLDivElement>) => {
        const next: EventTarget | null = event.relatedTarget;

        // Tabbing out of the panel closes it; moving within it does not.
        if (
          next instanceof Node &&
          panelRef.current &&
          !panelRef.current.contains(next)
        ) {
          close({ returnFocus: false });
        }
      }}
    >
      <div className="flex items-center gap-2 border-b border-gray-100 px-3">
        <div className="shrink-0">
          <Icon
            icon={IconProp.MagnifyingGlass}
            className="h-4 w-4 text-gray-400"
          />
        </div>
        <input
          ref={searchRef}
          type="text"
          role="combobox"
          aria-expanded={true}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeColumn ? optionId(activeColumn) : undefined
          }
          aria-label={searchLabel}
          data-testid={`${testId}-search`}
          autoComplete="off"
          spellCheck={false}
          value={query}
          placeholder={searchLabel}
          className="block w-full min-w-0 border-0 bg-transparent px-0 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0"
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onSearchKeyDown}
        />
        <button
          type="button"
          aria-label={translator.translateText("Close")}
          data-testid={`${testId}-close`}
          className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          onClick={() => {
            close({ returnFocus: true });
          }}
        >
          <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
        </button>
      </div>

      <div
        id={listboxId}
        role="listbox"
        aria-label={translator.translateText(props.triggerLabel)}
        data-testid={`${testId}-list`}
        className="max-h-72 overflow-y-auto overflow-x-hidden py-1"
      >
        {visibleColumns.length === 0 && (
          <p
            className="px-3 py-6 text-center text-sm text-gray-500"
            data-testid={`${testId}-no-match`}
          >
            {translator.translateTemplate("No fields match “{{query}}”.", {
              query: trimmedQuery,
            })}
          </p>
        )}

        {sections.map((section: PickerSection, sectionIndex: number) => {
          if (section.columns.length === 0) {
            return null;
          }

          const headingId: string = `${idPrefix}-group-${sectionIndex}`;
          const hasHeading: boolean =
            showGroupHeadings && section.group !== null;

          return (
            <div
              key={section.group?.id || "matches"}
              role={hasHeading ? "group" : "presentation"}
              aria-labelledby={hasHeading ? headingId : undefined}
              data-testid={`${testId}-group-${section.group?.id || "matches"}`}
            >
              {hasHeading && section.group && (
                <div
                  id={headingId}
                  className="flex min-w-0 items-baseline gap-2 px-3 pb-1 pt-2"
                >
                  <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                    {translator.translateText(section.group.label)}
                  </span>
                  {section.group.hint && (
                    <span className="truncate text-[11px] text-gray-400">
                      {translator.translateText(section.group.hint)}
                    </span>
                  )}
                </div>
              )}

              {section.columns.map((column: ModelSchemaColumn) => {
                const index: number = visibleColumns.indexOf(column);
                const isActive: boolean = column === activeColumn;
                const typeLabel: string = columnTypeLabel(column);

                return (
                  <div
                    key={column.id}
                    id={optionId(column)}
                    role="option"
                    aria-selected={isActive}
                    data-testid={`${testId}-option-${column.id}`}
                    className={`flex cursor-pointer items-start gap-3 px-3 py-2 ${
                      isActive ? "bg-indigo-50" : "hover:bg-gray-50"
                    }`}
                    onMouseDown={(event: React.MouseEvent<HTMLDivElement>) => {
                      // Keep focus in the search box, so the panel stays open.
                      event.preventDefault();
                    }}
                    onMouseMove={() => {
                      if (index !== activeIndex) {
                        setActiveIndex(index);
                      }
                    }}
                    onClick={() => {
                      pick(column.id);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-baseline gap-2">
                        <span className="truncate text-sm font-medium text-gray-900">
                          {translator.translateText(column.title) || column.id}
                        </span>
                        {/*
                          flex-1 from a zero basis: the key only gets the room
                          the name leaves, so a long name squeezes the key out
                          before it is cut itself.
                        */}
                        {isColumnKeyInformative(column) && (
                          <span className="max-sm:hidden min-w-0 flex-1 truncate font-mono text-[11px] text-gray-400">
                            {column.id}
                          </span>
                        )}
                      </div>
                      {isColumnDescriptionInformative(column) && (
                        <div
                          className="truncate text-xs text-gray-500"
                          title={translator.translateText(column.description)}
                        >
                          {translator.translateText(column.description)}
                        </div>
                      )}
                    </div>
                    <span className="mt-0.5 shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">
                      {typeLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {props.allowCustomColumn && (
        <div className="border-t border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-500">
          {translator.translateText("Not in the list?")}{" "}
          <button
            type="button"
            data-testid={`${testId}-by-name`}
            className="font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:underline"
            onMouseDown={(event: React.MouseEvent<HTMLButtonElement>) => {
              event.preventDefault();
            }}
            onClick={startNamingCustomColumn}
          >
            {translator.translateText("Add a column by name")}
          </button>
        </div>
      )}
    </div>
  );
};

export default AddColumnPicker;
