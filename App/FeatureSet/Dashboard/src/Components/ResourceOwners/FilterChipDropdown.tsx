import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import useComponentOutsideClick from "Common/UI/Types/UseComponentOutsideClick";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface FilterChipDropdownOption {
  value: string;
  label: string;
  /** Optional sub-label shown smaller below the main label. */
  sublabel?: string | undefined;
  /** Optional icon shown as a fallback to the left of the label. */
  icon?: IconProp | undefined;
  /**
   * Initials shown in a colored circle as the option avatar. Takes precedence
   * over `icon`. The background color is hashed from `value`.
   */
  initials?: string | undefined;
  /** Optional group key for sectioning options under a heading. */
  group?: string | undefined;
}

export interface ComponentProps {
  label: string;
  /**
   * Static option list. Used directly when provided. Client-side searched
   * by the chip's built-in search input.
   *
   * For large/unbounded option sets (e.g. a Monitor picker that could
   * grow to thousands of entries) pass `loadOptions` instead.
   */
  options?: Array<FilterChipDropdownOption> | undefined;
  /**
   * Async loader invoked with the current search term whenever the user
   * opens the dropdown or types (debounced ~250ms). Server is responsible
   * for the actual matching + pagination; the chip just renders the
   * returned list. When supplied, `options` is ignored.
   */
  loadOptions?:
    | ((searchTerm: string) => Promise<Array<FilterChipDropdownOption>>)
    | undefined;
  /**
   * Resolve selected values into label-bearing options, for cases where a
   * selection isn't in the current `loadOptions` page (the user picked it
   * earlier or it's a saved view that pre-populates the chip). Called
   * lazily when needed. Optional but strongly recommended alongside
   * `loadOptions`.
   */
  resolveOptions?:
    | ((values: Array<string>) => Promise<Array<FilterChipDropdownOption>>)
    | undefined;
  /**
   * Selected value. For single-select pass a string (or null). For
   * multi-select pass an array of strings.
   */
  value: string | Array<string> | null;
  onChange: (value: string | Array<string> | null) => void;
  isMultiSelect?: boolean | undefined;
  /**
   * Hint shown in the search input inside the popover.
   */
  searchPlaceholder?: string | undefined;
  /**
   * Width of the popover. Defaults to 16rem.
   */
  popoverWidthClassName?: string | undefined;
  /**
   * Optional icon shown to the left of the label when the chip has no
   * active selection (e.g. a filter or category icon).
   */
  emptyIcon?: IconProp | undefined;
}

const AVATAR_PALETTE: Array<string> = [
  "bg-indigo-500",
  "bg-blue-500",
  "bg-violet-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-teal-500",
  "bg-cyan-500",
  "bg-fuchsia-500",
];

const getAvatarColorClass: (key: string) => string = (key: string): string => {
  let hash: number = 0;
  for (let i: number = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]!;
};

type AvatarSize = "xs" | "sm";

const Avatar: FunctionComponent<{
  option: FilterChipDropdownOption;
  size?: AvatarSize;
}> = ({
  option,
  size = "sm",
}: {
  option: FilterChipDropdownOption;
  size?: AvatarSize;
}): ReactElement => {
  const sizeClass: string =
    size === "xs" ? "h-4 w-4 text-[9px]" : "h-6 w-6 text-[11px]";

  if (option.initials) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${sizeClass} ${getAvatarColorClass(
          option.value,
        )}`}
        aria-hidden="true"
      >
        {option.initials.slice(0, 2).toUpperCase()}
      </span>
    );
  }

  if (option.icon) {
    return (
      <Icon
        icon={option.icon}
        className={`shrink-0 text-gray-400 ${size === "xs" ? "h-3.5 w-3.5" : "h-4 w-4"}`}
      />
    );
  }

  return <></>;
};

const FilterChipDropdown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);
  const [searchText, setSearchText] = useState<string>("");
  const searchInputRef: React.MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);

  const isMulti: boolean = Boolean(props.isMultiSelect);
  const isAsync: boolean = Boolean(props.loadOptions);

  /**
   * For async (loadOptions) mode, this holds the server's last response.
   * For static (options) mode, it mirrors props.options.
   */
  const [loadedOptions, setLoadedOptions] = useState<
    Array<FilterChipDropdownOption>
  >(props.options || []);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  /**
   * Cache of values → resolved option, populated lazily for selections
   * that aren't in `loadedOptions` (e.g. saved-view restoration before
   * the dropdown has ever opened).
   */
  const [resolvedSelections, setResolvedSelections] = useState<{
    [value: string]: FilterChipDropdownOption;
  }>({});

  // Mirror static options into loadedOptions when not in async mode.
  useEffect(() => {
    if (!isAsync) {
      setLoadedOptions(props.options || []);
    }
  }, [props.options, isAsync]);

  // Async: load on open + whenever the search term changes (debounced).
  useEffect(() => {
    if (!isAsync || !props.loadOptions) {
      return;
    }
    if (!isComponentVisible) {
      return;
    }

    let cancelled: boolean = false;
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      setIsLoading(true);
      props.loadOptions!(searchText)
        .then((opts: Array<FilterChipDropdownOption>) => {
          if (!cancelled) {
            setLoadedOptions(opts);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setLoadedOptions([]);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsLoading(false);
          }
        });
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isAsync, isComponentVisible, searchText, props.loadOptions]);

  const selectedValues: Array<string> = useMemo((): Array<string> => {
    if (props.value === null) {
      return [];
    }
    if (Array.isArray(props.value)) {
      return props.value;
    }
    return [props.value];
  }, [props.value]);

  const hasValue: boolean = selectedValues.length > 0;

  /*
   * Resolve labels for selected values that aren't in loadedOptions or
   * already-resolved cache. Only relevant in async mode.
   */
  useEffect(() => {
    if (!isAsync || !props.resolveOptions || selectedValues.length === 0) {
      return;
    }

    const unresolved: Array<string> = selectedValues.filter((v: string) => {
      const inLoaded: boolean = loadedOptions.some(
        (o: FilterChipDropdownOption) => {
          return o.value === v;
        },
      );
      return !inLoaded && !resolvedSelections[v];
    });

    if (unresolved.length === 0) {
      return;
    }

    let cancelled: boolean = false;
    props
      .resolveOptions(unresolved)
      .then((opts: Array<FilterChipDropdownOption>) => {
        if (cancelled) {
          return;
        }
        setResolvedSelections(
          (prev: { [v: string]: FilterChipDropdownOption }) => {
            const next: { [v: string]: FilterChipDropdownOption } = { ...prev };
            for (const o of opts) {
              next[o.value] = o;
            }
            return next;
          },
        );
      })
      .catch(() => {
        // leave unresolved; chip falls back to raw value as the label
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  }, [isAsync, props.resolveOptions, selectedValues, loadedOptions]);

  const selectedOptions: Array<FilterChipDropdownOption> =
    useMemo((): Array<FilterChipDropdownOption> => {
      return selectedValues.map((v: string) => {
        const fromLoaded: FilterChipDropdownOption | undefined =
          loadedOptions.find((o: FilterChipDropdownOption) => {
            return o.value === v;
          });
        if (fromLoaded) {
          return fromLoaded;
        }
        if (resolvedSelections[v]) {
          return resolvedSelections[v]!;
        }
        // Fallback so the chip still renders something usable.
        return { value: v, label: v };
      });
    }, [selectedValues, loadedOptions, resolvedSelections]);

  const displayValue: string = useMemo((): string => {
    if (selectedOptions.length === 0) {
      return "";
    }
    if (selectedOptions.length === 1) {
      return selectedOptions[0]!.label;
    }
    const visible: Array<string> = selectedOptions
      .slice(0, 2)
      .map((o: FilterChipDropdownOption) => {
        return o.label;
      });
    const extra: number = selectedOptions.length - visible.length;
    return `${visible.join(", ")}${extra > 0 ? ` +${extra}` : ""}`;
  }, [selectedOptions]);

  // In async mode, the server already filtered — don't re-filter client-side.
  const filteredOptions: Array<FilterChipDropdownOption> =
    useMemo((): Array<FilterChipDropdownOption> => {
      if (isAsync) {
        return loadedOptions;
      }
      const trimmed: string = searchText.trim().toLowerCase();
      if (!trimmed) {
        return loadedOptions;
      }
      return loadedOptions.filter((o: FilterChipDropdownOption) => {
        return (
          o.label.toLowerCase().includes(trimmed) ||
          (o.sublabel ? o.sublabel.toLowerCase().includes(trimmed) : false)
        );
      });
    }, [isAsync, searchText, loadedOptions]);

  const groupedOptions: Array<{
    group: string | undefined;
    items: Array<FilterChipDropdownOption>;
  }> = useMemo((): Array<{
    group: string | undefined;
    items: Array<FilterChipDropdownOption>;
  }> => {
    const groups: Map<
      string | undefined,
      Array<FilterChipDropdownOption>
    > = new Map();
    for (const opt of filteredOptions) {
      const key: string | undefined = opt.group;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(opt);
    }
    return Array.from(groups.entries()).map(
      ([group, items]: [
        string | undefined,
        Array<FilterChipDropdownOption>,
      ]) => {
        return { group, items };
      },
    );
  }, [filteredOptions]);

  const hasAnyGroup: boolean = groupedOptions.some(
    (g: {
      group: string | undefined;
      items: Array<FilterChipDropdownOption>;
    }) => {
      return Boolean(g.group);
    },
  );

  useEffect(() => {
    if (isComponentVisible) {
      // Focus the search field on open for instant typing.
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 0);
    } else {
      setSearchText("");
    }
  }, [isComponentVisible]);

  const togglePopover: () => void = (): void => {
    setIsComponentVisible(!isComponentVisible);
  };

  const clearSelection: (e: React.MouseEvent) => void = (
    e: React.MouseEvent,
  ): void => {
    e.stopPropagation();
    if (isMulti) {
      props.onChange([]);
    } else {
      props.onChange(null);
    }
  };

  const selectOption: (optionValue: string) => void = (
    optionValue: string,
  ): void => {
    if (isMulti) {
      const next: Array<string> = selectedValues.includes(optionValue)
        ? selectedValues.filter((v: string) => {
            return v !== optionValue;
          })
        : [...selectedValues, optionValue];
      props.onChange(next);
      return;
    }

    if (selectedValues[0] === optionValue) {
      props.onChange(null);
    } else {
      props.onChange(optionValue);
    }
    setIsComponentVisible(false);
  };

  const chipBaseClasses: string =
    "group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1";
  const chipActiveClasses: string =
    "border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm hover:border-indigo-300 hover:bg-indigo-100";
  const chipInactiveClasses: string =
    "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50";

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={togglePopover}
        className={`${chipBaseClasses} ${hasValue ? chipActiveClasses : chipInactiveClasses}`}
        aria-expanded={isComponentVisible}
        aria-haspopup="listbox"
      >
        {hasValue && selectedOptions[0] ? (
          <>
            <Avatar option={selectedOptions[0]} size="xs" />
            <span className="whitespace-nowrap">
              <span className="text-indigo-500/80">{props.label}</span>
              <span className="mx-1 text-indigo-300">·</span>
              <span className="font-semibold">{displayValue}</span>
            </span>
            <span
              role="button"
              tabIndex={0}
              onClick={clearSelection}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  if (isMulti) {
                    props.onChange([]);
                  } else {
                    props.onChange(null);
                  }
                }
              }}
              className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-indigo-400 transition-colors hover:bg-indigo-200 hover:text-indigo-900 focus:outline-none"
              aria-label={`Clear ${props.label} filter`}
            >
              <Icon icon={IconProp.Close} className="h-3 w-3" />
            </span>
          </>
        ) : (
          <>
            {props.emptyIcon && (
              <Icon
                icon={props.emptyIcon}
                className="h-3.5 w-3.5 text-gray-400"
              />
            )}
            <span className="whitespace-nowrap">{props.label}</span>
            <Icon
              icon={IconProp.ChevronDown}
              className="h-3 w-3 text-gray-400 transition-transform group-aria-expanded:rotate-180"
            />
          </>
        )}
      </button>

      {isComponentVisible && (
        <div
          ref={ref}
          className={`absolute left-0 top-full z-20 mt-2 ${props.popoverWidthClassName || "w-72"} origin-top-left overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl ring-1 ring-black/5`}
          role="dialog"
        >
          <div className="border-b border-gray-100 p-2">
            <div className="relative">
              <Icon
                icon={IconProp.Search}
                className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
              />
              <input
                ref={searchInputRef}
                type="text"
                value={searchText}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setSearchText(e.target.value);
                }}
                placeholder={
                  props.searchPlaceholder ||
                  `Search ${props.label.toLowerCase()}...`
                }
                className="w-full rounded-md border border-gray-200 bg-gray-50 py-1.5 pl-7 pr-2 text-sm placeholder-gray-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
          </div>
          <div
            className="max-h-72 overflow-y-auto py-1"
            role="listbox"
            aria-multiselectable={isMulti}
          >
            {isLoading && (
              <div className="flex items-center justify-center gap-2 px-3 py-3 text-xs text-gray-500">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-500" />
                Loading...
              </div>
            )}
            {!isLoading && filteredOptions.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100">
                  <Icon
                    icon={IconProp.Search}
                    className="h-4 w-4 text-gray-400"
                  />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700">
                    No matches
                  </p>
                  <p className="text-xs text-gray-400">
                    {searchText.trim()
                      ? "Try a different search term"
                      : "Type to search"}
                  </p>
                </div>
              </div>
            )}
            {groupedOptions.map(
              (
                section: {
                  group: string | undefined;
                  items: Array<FilterChipDropdownOption>;
                },
                sectionIndex: number,
              ) => {
                return (
                  <div
                    key={section.group || `__ungrouped-${sectionIndex}`}
                    className={
                      sectionIndex > 0 && hasAnyGroup
                        ? "border-t border-gray-100 pt-1"
                        : ""
                    }
                  >
                    {hasAnyGroup && section.group && (
                      <div className="sticky top-0 bg-white px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                        {section.group}
                      </div>
                    )}
                    {section.items.map((option: FilterChipDropdownOption) => {
                      const optionValue: string = option.value;
                      const isSelected: boolean =
                        selectedValues.includes(optionValue);
                      return (
                        <button
                          key={optionValue}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => {
                            selectOption(optionValue);
                          }}
                          className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                            isSelected
                              ? "bg-indigo-50 text-indigo-900"
                              : "text-gray-700 hover:bg-gray-50"
                          }`}
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            <Avatar option={option} />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">
                                {option.label}
                              </span>
                              {option.sublabel && (
                                <span className="block truncate text-xs text-gray-400">
                                  {option.sublabel}
                                </span>
                              )}
                            </span>
                          </span>
                          {isSelected && (
                            <Icon
                              icon={IconProp.Check}
                              className="h-4 w-4 shrink-0 text-indigo-600"
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              },
            )}
          </div>
          {isMulti && hasValue && (
            <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-3 py-2">
              <span className="text-xs text-gray-500">
                {selectedValues.length} selected
              </span>
              <button
                type="button"
                onClick={() => {
                  props.onChange([]);
                }}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FilterChipDropdown;
