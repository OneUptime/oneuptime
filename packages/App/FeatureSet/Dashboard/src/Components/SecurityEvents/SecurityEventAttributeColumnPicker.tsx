import React, {
  ChangeEvent,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import useComponentOutsideClick from "Common/UI/Types/UseComponentOutsideClick";
import {
  SecurityEventAttributeColumn,
  SecurityEventAttributeKeySearchResult,
  buildSecurityEventAttributeColumns,
  moveSecurityEventAttributeColumnKey,
  normalizeSecurityEventAttributeColumnKeys,
  searchSecurityEventAttributeKeys,
} from "./SecurityEventAttributeColumns";

export const SECURITY_EVENT_ATTRIBUTE_COLUMN_PICKER_TEST_ID: string =
  "security-event-attribute-column-picker";

export const SECURITY_EVENT_ATTRIBUTE_COLUMN_PICKER_PANEL_TEST_ID: string =
  "security-event-attribute-column-picker-panel";

/*
 * How many matching keys the panel lists at once. A Google SecOps detection
 * alone carries hundreds of attributes, so a project's key list runs to
 * thousands; the search narrows it, and the panel says when it is showing a
 * slice.
 */
export const SECURITY_EVENT_ATTRIBUTE_COLUMN_PICKER_RESULT_LIMIT: number = 50;

export interface ComponentProps {
  // Every attribute key the project's events have been seen with.
  attributeKeys: Array<string>;
  isLoading?: boolean | undefined;
  selectedKeys: Array<string>;
  onChange: (keys: Array<string>) => void;
}

const triggerButtonClassName: string =
  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors";

const iconButtonClassName: string =
  "rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400";

/*
 * "Columns" for the security events list: which source attributes each row
 * shows as extra chips.
 *
 * The rows are chips rather than a grid, so this only ever manages the
 * attribute chips — the typed ones (who, on what, which rule) are always
 * there. Shaped like the logs explorer's column selector so the two read the
 * same: the chosen keys first, reorderable and removable, then a search over
 * everything the project has sent.
 */
const SecurityEventAttributeColumnPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);
  const triggerRef: React.MutableRefObject<HTMLButtonElement | null> =
    useRef<HTMLButtonElement | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const selectedKeys: Array<string> = useMemo(() => {
    return normalizeSecurityEventAttributeColumnKeys(props.selectedKeys);
  }, [props.selectedKeys]);

  const selectedColumns: Array<SecurityEventAttributeColumn> = useMemo(() => {
    return buildSecurityEventAttributeColumns(selectedKeys);
  }, [selectedKeys]);

  const searchResult: SecurityEventAttributeKeySearchResult = useMemo(() => {
    return searchSecurityEventAttributeKeys({
      keys: props.attributeKeys,
      query: searchQuery,
      excludeKeys: selectedKeys,
      limit: SECURITY_EVENT_ATTRIBUTE_COLUMN_PICKER_RESULT_LIMIT,
    });
  }, [props.attributeKeys, searchQuery, selectedKeys]);

  /*
   * Each match as the chip it would add. Labelled one key at a time, so a
   * key reads the same however many others the search happens to match.
   */
  const resultColumns: Array<SecurityEventAttributeColumn> = useMemo(() => {
    return searchResult.keys.map(
      (key: string): SecurityEventAttributeColumn => {
        return (
          buildSecurityEventAttributeColumns([key])[0] || {
            key: key,
            label: key,
          }
        );
      },
    );
  }, [searchResult.keys]);

  /*
   * The key list is sampled from recent events, so an attribute can exist
   * without being in it. Typing its exact key offers it anyway — but only
   * once nothing listed matches, so a half-typed search is never offered up
   * as a key of its own.
   */
  const typedKey: string = searchQuery.trim();
  const canAddTypedKey: boolean =
    typedKey.length > 0 &&
    !selectedKeys.includes(typedKey) &&
    searchResult.total === 0;

  // Escape closes the panel and hands focus back to the button that opened it.
  useEffect(() => {
    if (!isComponentVisible) {
      return undefined;
    }

    const handleEscape: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (event.key !== "Escape") {
        return;
      }

      event.stopPropagation();
      setIsComponentVisible(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("keydown", handleEscape, true);

    return () => {
      document.removeEventListener("keydown", handleEscape, true);
    };
  }, [isComponentVisible, setIsComponentVisible]);

  const updateKeys: (keys: Array<string>) => void = (
    keys: Array<string>,
  ): void => {
    props.onChange(normalizeSecurityEventAttributeColumnKeys(keys));
  };

  const addKey: (key: string) => void = (key: string): void => {
    updateKeys([...selectedKeys, key]);
  };

  const removeKey: (key: string) => void = (key: string): void => {
    updateKeys(
      selectedKeys.filter((selectedKey: string): boolean => {
        return selectedKey !== key;
      }),
    );
  };

  const moveKey: (key: string, direction: -1 | 1) => void = (
    key: string,
    direction: -1 | 1,
  ): void => {
    updateKeys(
      moveSecurityEventAttributeColumnKey(selectedKeys, key, direction),
    );
  };

  const hasSelection: boolean = selectedKeys.length > 0;

  return (
    /*
     * Anchored to the button from md up. Below md the panel spans the
     * nearest positioned ancestor instead and drops below the button, since
     * the wrapped toolbar can put the button anywhere on a phone's width —
     * the same arrangement as the logs explorer's column selector.
     */
    <div
      className="md:relative"
      ref={ref}
      data-testid={SECURITY_EVENT_ATTRIBUTE_COLUMN_PICKER_TEST_ID}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`${triggerButtonClassName} ${
          hasSelection
            ? "border-indigo-200 bg-indigo-50 text-indigo-700 hover:border-indigo-300"
            : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
        }`}
        onClick={() => {
          setIsComponentVisible(!isComponentVisible);
        }}
        aria-haspopup="dialog"
        aria-expanded={isComponentVisible}
        title="Choose source attributes to show on every event row"
      >
        <Icon icon={IconProp.ViewColumns} className="h-3.5 w-3.5" />
        <span>Columns</span>
        {hasSelection && (
          <span className="rounded bg-indigo-100 px-1 text-[10px] font-semibold tabular-nums text-indigo-700">
            {selectedKeys.length}
          </span>
        )}
      </button>

      {isComponentVisible && (
        <div
          role="dialog"
          aria-label="Attribute columns"
          className="absolute left-0 right-0 z-20 mt-2 rounded-lg border border-gray-200 bg-white p-4 shadow-xl md:left-auto md:w-[26rem]"
          data-testid={SECURITY_EVENT_ATTRIBUTE_COLUMN_PICKER_PANEL_TEST_ID}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900">
                Attribute columns
              </h3>
              <p className="mt-0.5 text-xs text-gray-500">
                Show source attributes on every event row. A row that does not
                carry one leaves it off.
              </p>
            </div>

            {hasSelection && (
              <button
                type="button"
                className="flex-shrink-0 text-xs font-medium text-gray-500 transition-colors hover:text-gray-700"
                onClick={() => {
                  updateKeys([]);
                }}
              >
                Clear all
              </button>
            )}
          </div>

          <div className="mt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Shown on rows
            </p>

            {!hasSelection ? (
              <p className="rounded-md border border-dashed border-gray-200 px-3 py-3 text-xs text-gray-500">
                None yet. Add one below, or open an event and use the column
                button beside any of its attributes.
              </p>
            ) : (
              <ul className="space-y-1.5" aria-label="Attributes shown on rows">
                {selectedColumns.map(
                  (
                    column: SecurityEventAttributeColumn,
                    index: number,
                  ): ReactElement => {
                    return (
                      <li
                        key={column.key}
                        className="flex items-center gap-2 rounded-md border border-gray-200 px-2.5 py-1.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-gray-900">
                            {column.label}
                          </p>
                          <p className="break-all font-mono text-[10px] leading-snug text-gray-400">
                            {column.key}
                          </p>
                        </div>

                        <div className="flex flex-shrink-0 items-center">
                          <button
                            type="button"
                            className={iconButtonClassName}
                            aria-label={`Move ${column.key} up`}
                            title="Move up"
                            disabled={index === 0}
                            onClick={() => {
                              moveKey(column.key, -1);
                            }}
                          >
                            <Icon
                              icon={IconProp.ChevronUp}
                              className="h-3.5 w-3.5"
                            />
                          </button>
                          <button
                            type="button"
                            className={iconButtonClassName}
                            aria-label={`Move ${column.key} down`}
                            title="Move down"
                            disabled={index === selectedColumns.length - 1}
                            onClick={() => {
                              moveKey(column.key, 1);
                            }}
                          >
                            <Icon
                              icon={IconProp.ChevronDown}
                              className="h-3.5 w-3.5"
                            />
                          </button>
                          <button
                            type="button"
                            className={iconButtonClassName}
                            aria-label={`Remove ${column.key}`}
                            title="Remove"
                            onClick={() => {
                              removeKey(column.key);
                            }}
                          >
                            <Icon
                              icon={IconProp.Close}
                              className="h-3.5 w-3.5"
                            />
                          </button>
                        </div>
                      </li>
                    );
                  },
                )}
              </ul>
            )}
          </div>

          <div className="mt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Add an attribute
            </p>

            <input
              type="text"
              value={searchQuery}
              aria-label="Search attributes"
              placeholder="Search attributes, e.g. user firstName"
              autoFocus={true}
              className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 placeholder:text-gray-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                setSearchQuery(event.target.value);
              }}
              onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                if (event.key !== "Enter") {
                  return;
                }

                event.preventDefault();

                /*
                 * Enter takes the top match. It never adds the typed text
                 * itself: a search that matched nothing is far more often a
                 * phrase than an exact key, and a column for a key no event
                 * carries is an empty column that looks like a broken one.
                 * An unlisted key is added with its own Add button.
                 */
                const key: string | undefined = searchResult.keys[0];

                if (key) {
                  addKey(key);
                  setSearchQuery("");
                }
              }}
            />

            <div className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1">
              {canAddTypedKey && (
                <div className="flex items-center gap-2 rounded-md border border-dashed border-indigo-200 bg-indigo-50/50 px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="break-all font-mono text-xs text-gray-700">
                      {typedKey}
                    </p>
                    <p className="text-[10px] text-gray-500">
                      Add this exact key as a column.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="flex-shrink-0 rounded-md px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-100 hover:text-indigo-700"
                    aria-label={`Add ${typedKey}`}
                    onClick={() => {
                      addKey(typedKey);
                      setSearchQuery("");
                    }}
                  >
                    Add
                  </button>
                </div>
              )}

              {props.isLoading && searchResult.total === 0 && (
                <p className="px-1 py-2 text-xs text-gray-500">
                  Loading attributes...
                </p>
              )}

              {!props.isLoading &&
                searchResult.total === 0 &&
                !canAddTypedKey && (
                  <p className="px-1 py-2 text-xs text-gray-500">
                    {typedKey
                      ? "No attribute matches that search."
                      : "No attributes seen on recent events yet."}
                  </p>
                )}

              {/*
               * The full key wraps rather than truncates: these keys share
               * long prefixes, so a right-hand ellipsis would cut off the
               * one part that tells them apart.
               */}
              {resultColumns.map(
                (column: SecurityEventAttributeColumn): ReactElement => {
                  return (
                    <div
                      key={column.key}
                      className="flex items-center gap-2 rounded-md px-2.5 py-1.5 hover:bg-gray-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-gray-800">
                          {column.label}
                        </p>
                        <p className="break-all font-mono text-[10px] leading-snug text-gray-400">
                          {column.key}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="flex-shrink-0 rounded-md px-2 py-0.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-indigo-700"
                        aria-label={`Add ${column.key}`}
                        onClick={() => {
                          addKey(column.key);
                        }}
                      >
                        Add
                      </button>
                    </div>
                  );
                },
              )}
            </div>

            {searchResult.total > searchResult.keys.length && (
              <p className="mt-2 text-[11px] text-gray-400">
                Showing {searchResult.keys.length.toLocaleString()} of{" "}
                {searchResult.total.toLocaleString()} matching attributes. Keep
                typing to narrow.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SecurityEventAttributeColumnPicker;
