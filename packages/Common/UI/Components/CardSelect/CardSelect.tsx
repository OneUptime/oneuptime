import IconProp from "../../../Types/Icon/IconProp";
import Icon, { SizeProp } from "../Icon/Icon";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useRef,
  useState,
} from "react";

export interface CardSelectOption {
  value: string;
  title: string;
  description: string;
  icon: IconProp;
  /*
   * Words that should match this card in search but are not on it - product
   * names, protocols, synonyms. Optional: a catalog small enough to read in
   * one screen has no use for them.
   */
  keywords?: Array<string> | undefined;
}

export interface CardSelectOptionGroup {
  label: string;
  options: Array<CardSelectOption>;
}

export function isCardSelectOptionGroup(
  option: CardSelectOption | CardSelectOptionGroup,
): option is CardSelectOptionGroup {
  return (
    (option as CardSelectOptionGroup).label !== undefined &&
    Array.isArray((option as CardSelectOptionGroup).options)
  );
}

export interface ComponentProps {
  options: Array<CardSelectOption | CardSelectOptionGroup>;
  value?: string | undefined;
  onChange: (value: string) => void;
  error?: string | undefined;
  tabIndex?: number | undefined;
  dataTestId?: string | undefined;
  ariaLabelledby?: string | undefined;
  // Force single-column (1 item per row). Default: responsive 1/2/3 grid.
  singleColumn?: boolean | undefined;
  /*
   * Opt in to the search box. Off by default so a picker with a handful of
   * cards is not given a search box it does not need, and so existing callers
   * keep the exact markup they had.
   */
  searchable?: boolean | undefined;
  searchPlaceholder?: string | undefined;
  /*
   * Opt in to collapsing groups behind their headers. Off by default. Only
   * has an effect on grouped options: the first group and the group holding
   * the current selection start open, the rest start closed behind a count.
   */
  collapsibleGroups?: boolean | undefined;
}

interface RenderGroup {
  label: string | null;
  options: Array<CardSelectOption>;
}

/**
 * The words of a search, in lower case. Empty when nothing was typed.
 */
export type CardSelectSearchTokensFunction = (search: string) => Array<string>;

export const getCardSelectSearchTokens: CardSelectSearchTokensFunction = (
  search: string,
): Array<string> => {
  return search
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token: string) => {
      return token.length > 0;
    });
};

/*
 * The text a search runs against: everything visible on the card, the heading
 * it sits under, and its hidden keywords.
 */
type CardSelectHaystackFunction = (
  option: CardSelectOption,
  groupLabel: string | null,
) => string;

const getHaystack: CardSelectHaystackFunction = (
  option: CardSelectOption,
  groupLabel: string | null,
): string => {
  return `${option.title} ${option.description} ${groupLabel || ""} ${(
    option.keywords || []
  ).join(" ")}`.toLowerCase();
};

/**
 * Does this card match every word typed?
 *
 * Every word, anywhere across title, description, group heading and keywords -
 * not the whole search string as one substring. Matching the words separately
 * is what lets "expired cert" and "cert expired" both find SSL Certificate.
 * The same rule the workflow component palette settled on, for the same
 * reason: in a catalog this size, browsing is not a fallback.
 */
export type CardSelectMatchesSearchFunction = (
  option: CardSelectOption,
  tokens: Array<string>,
  groupLabel?: string | null | undefined,
) => boolean;

export const cardSelectOptionMatchesSearch: CardSelectMatchesSearchFunction = (
  option: CardSelectOption,
  tokens: Array<string>,
  groupLabel?: string | null | undefined,
): boolean => {
  if (tokens.length === 0) {
    return true;
  }

  const haystack: string = getHaystack(option, groupLabel || null);

  return tokens.every((token: string) => {
    return haystack.includes(token);
  });
};

type CardSelectScoreForTokenFunction = (
  option: CardSelectOption,
  groupLabel: string | null,
  searchTerm: string,
) => number;

const getSearchScoreForToken: CardSelectScoreForTokenFunction = (
  option: CardSelectOption,
  groupLabel: string | null,
  searchTerm: string,
): number => {
  const title: string = option.title.toLowerCase();
  const description: string = option.description.toLowerCase();
  const label: string = (groupLabel || "").toLowerCase();
  const keywords: Array<string> = (option.keywords || []).map(
    (keyword: string) => {
      return keyword.toLowerCase();
    },
  );

  let score: number = 0;

  if (title === searchTerm) {
    score += 200;
  } else if (title.startsWith(searchTerm)) {
    score += 140;
  } else if (title.includes(searchTerm)) {
    score += 100;
  }

  /*
   * An exact keyword hit is the strongest signal there is after the title
   * itself: someone who types "k8s" or "postgres" has named the thing, they
   * just have not named it the way the card does.
   */
  if (
    keywords.some((keyword: string) => {
      return keyword === searchTerm;
    })
  ) {
    score += 120;
  } else if (
    keywords.some((keyword: string) => {
      return keyword.startsWith(searchTerm);
    })
  ) {
    score += 80;
  } else if (
    keywords.some((keyword: string) => {
      return keyword.includes(searchTerm);
    })
  ) {
    score += 50;
  }

  if (label.startsWith(searchTerm)) {
    score += 75;
  } else if (label.includes(searchTerm)) {
    score += 55;
  }

  if (description.includes(searchTerm)) {
    score += 35;
  }

  if (
    title.split(" ").some((word: string) => {
      return word.trim().startsWith(searchTerm);
    })
  ) {
    score += 15;
  }

  return score;
};

/**
 * Ranking, summed over the words typed.
 */
export type CardSelectSearchScoreFunction = (
  option: CardSelectOption,
  tokens: Array<string>,
  groupLabel?: string | null | undefined,
) => number;

export const getCardSelectOptionSearchScore: CardSelectSearchScoreFunction = (
  option: CardSelectOption,
  tokens: Array<string>,
  groupLabel?: string | null | undefined,
): number => {
  return tokens.reduce((total: number, token: string) => {
    return total + getSearchScoreForToken(option, groupLabel || null, token);
  }, 0);
};

interface ScoredOption {
  option: CardSelectOption;
  groupLabel: string | null;
  score: number;
}

type NormalizeGroupsFunction = (
  options: Array<CardSelectOption | CardSelectOptionGroup>,
) => Array<RenderGroup>;

/*
 * Flat options and groups can be interleaved by the caller, so a run of flat
 * options becomes its own unlabelled group wherever it appears.
 */
export const normalizeCardSelectGroups: NormalizeGroupsFunction = (
  options: Array<CardSelectOption | CardSelectOptionGroup>,
): Array<RenderGroup> => {
  const groups: Array<RenderGroup> = [];
  let ungroupedOptions: Array<CardSelectOption> = [];

  for (const option of options) {
    if (isCardSelectOptionGroup(option)) {
      if (ungroupedOptions.length > 0) {
        groups.push({ label: null, options: ungroupedOptions });
        ungroupedOptions = [];
      }
      groups.push({ label: option.label, options: option.options });
    } else {
      ungroupedOptions.push(option);
    }
  }

  if (ungroupedOptions.length > 0) {
    groups.push({ label: null, options: ungroupedOptions });
  }

  return groups;
};

const CardSelect: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [search, setSearch] = useState<string>("");
  const searchInputRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);
  const containerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  /*
   * Groups the user has toggled by hand, by label. Anything absent falls back
   * to the default below, so a group does not spring shut again the moment
   * the selection moves elsewhere.
   */
  const [toggledGroups, setToggledGroups] = useState<Record<string, boolean>>(
    {},
  );

  const groups: Array<RenderGroup> = useMemo(() => {
    return normalizeCardSelectGroups(props.options);
  }, [props.options]);

  const tokens: Array<string> = useMemo(() => {
    return getCardSelectSearchTokens(search);
  }, [search]);

  const isSearching: boolean = tokens.length > 0;

  const totalOptionCount: number = useMemo(() => {
    return groups.reduce((total: number, group: RenderGroup) => {
      return total + group.options.length;
    }, 0);
  }, [groups]);

  /*
   * A search flattens the groups. Ranked results in nine separate headed
   * sections would bury the best match under whichever heading happens to
   * come first, which is the problem the search is there to solve.
   */
  const { searchResults, isShowingClosestMatches } = useMemo((): {
    searchResults: Array<ScoredOption>;
    isShowingClosestMatches: boolean;
  } => {
    if (!isSearching) {
      return { searchResults: [], isShowingClosestMatches: false };
    }

    type CollectFunction = (requireEveryWord: boolean) => Array<ScoredOption>;

    const collect: CollectFunction = (
      requireEveryWord: boolean,
    ): Array<ScoredOption> => {
      const scored: Array<ScoredOption> = [];

      for (const group of groups) {
        for (const option of group.options) {
          const matches: boolean = requireEveryWord
            ? cardSelectOptionMatchesSearch(option, tokens, group.label)
            : tokens.some((token: string) => {
                return cardSelectOptionMatchesSearch(
                  option,
                  [token],
                  group.label,
                );
              });

          if (!matches) {
            continue;
          }

          scored.push({
            option: option,
            groupLabel: group.label,
            score: getCardSelectOptionSearchScore(option, tokens, group.label),
          });
        }
      }

      return scored.sort((a: ScoredOption, b: ScoredOption) => {
        const scoreDifference: number = b.score - a.score;

        if (scoreDifference !== 0) {
          return scoreDifference;
        }

        return a.option.title.localeCompare(b.option.title);
      });
    };

    const everyWord: Array<ScoredOption> = collect(true);

    if (everyWord.length > 0) {
      return { searchResults: everyWord, isShowingClosestMatches: false };
    }

    /*
     * Nothing contains every word. Rather than a dead end, fall back to the
     * cards matching any of them, ranked the same way - someone who typed
     * "postgres uptime" gets SQL Query rather than an empty panel. With a
     * single word this is the same query, so it correctly stays empty.
     */
    const anyWord: Array<ScoredOption> = collect(false);

    return {
      searchResults: anyWord,
      isShowingClosestMatches: anyWord.length > 0,
    };
  }, [groups, tokens, isSearching]);

  type IsGroupExpandedFunction = (
    group: RenderGroup,
    groupIndex: number,
  ) => boolean;

  const isGroupExpanded: IsGroupExpandedFunction = (
    group: RenderGroup,
    groupIndex: number,
  ): boolean => {
    // Unlabelled groups have no header to collapse behind.
    if (!props.collapsibleGroups || !group.label) {
      return true;
    }

    const toggled: boolean | undefined = toggledGroups[group.label];

    if (toggled !== undefined) {
      return toggled;
    }

    // The group holding the current selection, so re-entering a form shows it.
    if (
      props.value &&
      group.options.some((option: CardSelectOption) => {
        return option.value === props.value;
      })
    ) {
      return true;
    }

    /*
     * The first group is the common case in every catalog that bothers to
     * order itself, so it is the one worth opening for a user who has not
     * told us anything yet.
     */
    return groupIndex === 0;
  };

  const gridClassName: string = props.singleColumn
    ? "grid grid-cols-1 gap-4"
    : "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3";

  /*
   * The cards on screen, in the order they are rendered. A search reorders
   * them and a folded group removes them, so this is recomputed rather than
   * taken from props.
   */
  const visibleOptionValues: Array<string> = useMemo(() => {
    if (isSearching) {
      return searchResults.map((result: ScoredOption) => {
        return result.option.value;
      });
    }

    const values: Array<string> = [];

    groups.forEach((group: RenderGroup, groupIndex: number) => {
      if (!isGroupExpanded(group, groupIndex)) {
        return;
      }

      for (const option of group.options) {
        values.push(option.value);
      }
    });

    return values;
    /*
     * isGroupExpanded is read here rather than listed: it is rebuilt every
     * render, and everything it actually depends on - the groups, the manual
     * toggles and the current value - is in the list.
     */
  }, [groups, isSearching, searchResults, toggledGroups, props.value]);

  /*
   * One tab stop for the whole group, which is what a radiogroup is supposed
   * to be. Every card used to get its own increasing tabIndex - with the 0
   * that FormField passes, that produced 1, 2, 3 ... 28: positive values,
   * which jump ahead of every other control on the page in tab order. Arrow
   * keys move between the cards once the group has focus.
   */
  const activeOptionValue: string | undefined =
    props.value && visibleOptionValues.includes(props.value)
      ? props.value
      : visibleOptionValues[0];

  type FocusCardFunction = (value: string) => void;

  const focusCard: FocusCardFunction = (value: string): void => {
    const card: HTMLElement | null =
      containerRef.current?.querySelector(
        `[data-card-select-value="${CSS.escape(value)}"]`,
      ) || null;

    card?.focus();
  };

  type MoveFocusFunction = (fromValue: string, offset: number) => void;

  const moveFocus: MoveFocusFunction = (
    fromValue: string,
    offset: number,
  ): void => {
    const currentIndex: number = visibleOptionValues.indexOf(fromValue);

    if (currentIndex < 0) {
      return;
    }

    /*
     * Clamped rather than wrapping: running off the end of a 29 card grid and
     * landing back at the top reads as a glitch, not as navigation.
     */
    const nextIndex: number = Math.min(
      Math.max(currentIndex + offset, 0),
      visibleOptionValues.length - 1,
    );

    const nextValue: string | undefined = visibleOptionValues[nextIndex];

    if (!nextValue || nextValue === fromValue) {
      return;
    }

    focusCard(nextValue);
  };

  type RenderCardFunction = (option: CardSelectOption) => ReactElement;

  const renderCard: RenderCardFunction = (
    option: CardSelectOption,
  ): ReactElement => {
    const isSelected: boolean = props.value === option.value;

    return (
      <div
        key={option.value}
        tabIndex={option.value === activeOptionValue ? props.tabIndex || 0 : -1}
        data-card-select-value={option.value}
        onClick={() => {
          props.onChange(option.value);
        }}
        onKeyDown={(e: React.KeyboardEvent) => {
          /*
           * Manual activation: arrows move focus, Enter or Space chooses.
           * Selecting on focus would fire onChange for every card arrowed
           * past, and on this form that resets the criteria below.
           */
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            props.onChange(option.value);
            return;
          }

          if (e.key === "ArrowRight" || e.key === "ArrowDown") {
            e.preventDefault();
            moveFocus(option.value, 1);
            return;
          }

          if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
            e.preventDefault();
            moveFocus(option.value, -1);
          }
        }}
        className={`relative flex cursor-pointer rounded-lg border p-4 shadow-sm transition-all duration-200 hover:border-indigo-400 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
          isSelected
            ? "border-indigo-500 bg-indigo-50/50"
            : "border-gray-200 bg-white"
        }`}
        role="radio"
        aria-checked={isSelected}
        data-testid={`card-select-option-${option.value}`}
      >
        <div className="flex w-full items-start">
          <div
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
              isSelected ? "bg-indigo-100" : "bg-gray-100"
            }`}
          >
            <Icon
              icon={option.icon}
              size={SizeProp.Large}
              className={`h-5 w-5 ${
                isSelected ? "text-indigo-600" : "text-gray-600"
              }`}
            />
          </div>
          <div className="ml-4 flex-1">
            <span
              className={`block text-sm font-semibold ${
                isSelected ? "text-gray-900" : "text-gray-900"
              }`}
            >
              {option.title}
            </span>
            <span
              className={`mt-1 block text-sm ${
                isSelected ? "text-gray-600" : "text-gray-500"
              }`}
            >
              {option.description}
            </span>
          </div>
          {isSelected && (
            <div className="flex-shrink-0 ml-2">
              <Icon
                icon={IconProp.CheckCircle}
                size={SizeProp.Large}
                className="h-5 w-5 text-indigo-500"
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div data-testid={props.dataTestId}>
      {props.searchable && (
        <div className="mb-5">
          <div className="relative flex items-center gap-3 rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm transition-all duration-200 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500">
            <Icon
              icon={IconProp.Search}
              className="h-4 w-4 flex-shrink-0 text-gray-400"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              placeholder={props.searchPlaceholder || "Search"}
              autoComplete="off"
              aria-label={props.searchPlaceholder || "Search"}
              data-testid="card-select-search"
              className="block w-full border-0 bg-transparent p-0 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setSearch(event.target.value);
              }}
              onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                if (event.key === "Escape" && search.length > 0) {
                  /*
                   * Stops the keypress reaching a modal or side over that
                   * would take a clear-the-search Escape as close-the-form.
                   */
                  event.stopPropagation();
                  event.preventDefault();
                  setSearch("");
                  return;
                }

                /*
                 * Type a couple of letters, press Enter, done - the whole
                 * point of the search box for someone who already knows what
                 * they want. Left alone when there is nothing to choose.
                 */
                if (event.key === "Enter" && searchResults[0]) {
                  event.preventDefault();
                  props.onChange(searchResults[0].option.value);
                  return;
                }

                // The only way into the grid without reaching for the mouse.
                if (event.key === "ArrowDown" && activeOptionValue) {
                  event.preventDefault();
                  focusCard(activeOptionValue);
                }
              }}
            />
            {search.length > 0 && (
              <button
                type="button"
                aria-label="Clear search"
                data-testid="card-select-search-clear"
                className="flex flex-shrink-0 items-center text-gray-400 hover:text-gray-600"
                onClick={() => {
                  setSearch("");
                  searchInputRef.current?.focus();
                }}
              >
                <Icon icon={IconProp.Close} className="h-4 w-4" />
              </button>
            )}
          </div>
          <p
            className="mt-2 text-xs text-gray-500"
            data-testid="card-select-search-summary"
            role="status"
          >
            {isSearching
              ? isShowingClosestMatches
                ? `Showing ${searchResults.length} closest of ${totalOptionCount}`
                : `Showing ${searchResults.length} of ${totalOptionCount}`
              : `${totalOptionCount} to choose from. Search by name, category, or what you want to watch.`}
          </p>
        </div>
      )}

      <div
        ref={containerRef}
        role="radiogroup"
        aria-label="Select an option"
        aria-labelledby={props.ariaLabelledby}
      >
        {isSearching && isShowingClosestMatches && (
          <p
            className="mb-4 text-sm text-gray-500"
            data-testid="card-select-closest-matches"
          >
            Nothing matches every word you typed. Closest matches:
          </p>
        )}

        {isSearching && (
          <div className={gridClassName}>
            {searchResults.map((result: ScoredOption) => {
              return renderCard(result.option);
            })}
          </div>
        )}

        {isSearching && searchResults.length === 0 && (
          <div
            className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center"
            data-testid="card-select-no-results"
          >
            <p className="text-sm font-medium text-gray-900">
              Nothing matches every word you typed.
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Try fewer words, or a protocol or product name.
            </p>
            <button
              type="button"
              className="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-500"
              onClick={() => {
                setSearch("");
                searchInputRef.current?.focus();
              }}
            >
              Clear search
            </button>
          </div>
        )}

        {!isSearching &&
          groups.map((group: RenderGroup, groupIndex: number) => {
            const expanded: boolean = isGroupExpanded(group, groupIndex);
            const canCollapse: boolean = Boolean(
              props.collapsibleGroups && group.label,
            );

            return (
              <div key={groupIndex} className={groupIndex > 0 ? "mt-8" : ""}>
                {group.label && !canCollapse && (
                  <div className="relative mb-4">
                    <div
                      className="absolute inset-0 flex items-center"
                      aria-hidden="true"
                    >
                      <div className="w-full border-t border-gray-200"></div>
                    </div>
                    <div className="relative flex justify-start">
                      <span className="bg-white pr-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                        {group.label}
                      </span>
                    </div>
                  </div>
                )}

                {group.label && canCollapse && (
                  <button
                    type="button"
                    aria-expanded={expanded}
                    data-testid={`card-select-group-${group.label}`}
                    className="mb-4 flex w-full items-center gap-2 border-b border-gray-200 pb-2 text-left"
                    onClick={() => {
                      setToggledGroups((previous: Record<string, boolean>) => {
                        return {
                          ...previous,
                          [group.label as string]: !expanded,
                        };
                      });
                    }}
                  >
                    <Icon
                      icon={
                        expanded ? IconProp.ChevronDown : IconProp.ChevronRight
                      }
                      className="h-4 w-4 flex-shrink-0 text-gray-400"
                    />
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                      {group.label}
                    </span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                      {group.options.length}
                    </span>
                  </button>
                )}

                {expanded && (
                  <div className={gridClassName}>
                    {group.options.map((option: CardSelectOption) => {
                      return renderCard(option);
                    })}
                  </div>
                )}
              </div>
            );
          })}
      </div>
      {props.error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {props.error}
        </p>
      )}
    </div>
  );
};

export default CardSelect;
