import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";
import {
  SiteSearchResponse,
  SiteSearchResultView,
  parseSiteSearchResponse,
} from "./SiteHierarchyTypes";
import {
  MIN_SITE_SEARCH_CHARS,
  isRemoteSearchable,
  normalizeSiteSearchText,
} from "./SiteSearchUtil";
import { pluralizeSiteType } from "./SiteMapViewModel";

/*
 * The Network Map's search box.
 *
 * It answers two different questions with one control, because they are the
 * same question asked from different distances:
 *
 *   "narrow what I am looking at" — handled by the PAGE, which applies the
 *     same text to the markers, the cards and the WAN links of the level in
 *     view. That is instant and local, so it happens on every keystroke.
 *
 *   "where is Unit 104822" — handled here, against /network-site/search,
 *     because the answer is somewhere the page is not: the map holds one
 *     level and the site is four levels down. Each hit prints the path to
 *     it, and picking one drills straight there.
 *
 * The second is why this box exists at all. A drill-down map without it can
 * only be searched by someone who already knows which region to open, which
 * is the one thing they are trying to find out.
 */

// Per-keystroke requests would be one round trip per character typed.
const SEARCH_DEBOUNCE_MS: number = 250;

/*
 * The input's own classes, not the shared default: the box carries a search
 * glyph on the left and a clear button on the right, and both need room that
 * the default padding does not leave.
 */
const INPUT_CLASS: string =
  "block w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-9 text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm";

const NO_STATUS_COLOR: string = "#9ca3af"; // gray-400

export interface ComponentProps {
  value: string;
  onChange: (value: string) => void;
  /** Drill to a site the reader picked out of the results. */
  onSelectSite: (siteId: string) => void;
  /*
   * How the level in view narrowed under this text. Shown as a quiet count
   * so a search that hides most of the map says so, rather than leaving the
   * reader to wonder where their sites went.
   */
  localMatchCount: number;
  localTotalCount: number;
  /*
   * What the children of this level are called, in the customer's own words
   * ("Regions", "Markets"). The box must not invent vocabulary either.
   */
  childTypeLabel: string;
}

const SiteSearchBox: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [results, setResults] = useState<Array<SiteSearchResultView>>([]);
  const [isTruncated, setIsTruncated] = useState<boolean>(false);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [isFocused, setIsFocused] = useState<boolean>(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  /*
   * The text the results on screen actually answer. Without it the "no
   * matches" line would appear the instant somebody types, over the results
   * of the previous query, before the new request has even left.
   */
  const [answeredText, setAnsweredText] = useState<string>("");

  const normalized: string = normalizeSiteSearchText(props.value);
  const canSearchRemotely: boolean = isRemoteSearchable(normalized);

  /*
   * Cancel-stale: every request takes a sequence number and only the latest
   * may write state, so a slow response for "kan" can never land on top of
   * the results for "kansas city".
   */
  const requestSeq: React.MutableRefObject<number> = useRef<number>(0);
  const isMounted: React.MutableRefObject<boolean> = useRef<boolean>(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const runSearch: (searchText: string) => Promise<void> = useCallback(
    async (searchText: string): Promise<void> => {
      const seq: number = ++requestSeq.current;
      try {
        const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
          "/network-site/search",
        );
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: url,
            data: { searchText: searchText },
            headers: { ...ModelAPI.getCommonHeaders() },
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        if (!isMounted.current || seq !== requestSeq.current) {
          return;
        }

        const parsed: SiteSearchResponse = parseSiteSearchResponse(
          response.data,
        );
        setResults(parsed.results);
        setIsTruncated(parsed.isTruncated);
        setError("");
      } catch (err) {
        if (!isMounted.current || seq !== requestSeq.current) {
          return;
        }
        setResults([]);
        setIsTruncated(false);
        setError(API.getFriendlyMessage(err));
      }
      if (isMounted.current && seq === requestSeq.current) {
        setIsSearching(false);
        setAnsweredText(searchText);
      }
    },
    [],
  );

  useEffect(() => {
    setActiveIndex(-1);

    if (!canSearchRemotely) {
      /*
       * Below the threshold there is nothing to show — and the sequence
       * number is bumped so a request already in flight for a longer string
       * cannot arrive and repopulate the list after it was cleared.
       */
      requestSeq.current++;
      setResults([]);
      setIsTruncated(false);
      setIsSearching(false);
      setError("");
      setAnsweredText("");
      return undefined;
    }

    setIsSearching(true);
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      runSearch(normalized).catch(() => {
        // runSearch handles its own failures; this keeps the promise quiet.
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [normalized, canSearchRemotely, runSearch]);

  const selectResult: (result: SiteSearchResultView) => void = (
    result: SiteSearchResultView,
  ): void => {
    /*
     * Clear the box on the way through. The text was a question ("where is
     * 104822"), and it has been answered by going there — leaving it behind
     * would also leave the destination level filtered by it, which is very
     * rarely what somebody wants after arriving.
     */
    props.onChange("");
    setIsFocused(false);
    props.onSelectSite(result.id);
  };

  const onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (event.key === "Escape") {
      setIsFocused(false);
      return;
    }
    if (results.length === 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsFocused(true);
      setActiveIndex((previous: number): number => {
        return previous + 1 >= results.length ? 0 : previous + 1;
      });
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((previous: number): number => {
        return previous <= 0 ? results.length - 1 : previous - 1;
      });
      return;
    }
    if (event.key === "Enter") {
      /*
       * Enter only commits an entry the reader has actually moved onto.
       * Firing the first hit on a bare Enter would drill somewhere they
       * never looked at, which is the worst outcome this control can have.
       */
      const active: SiteSearchResultView | undefined = results[activeIndex];
      if (active) {
        event.preventDefault();
        selectResult(active);
      }
    }
  };

  const isNarrowed: boolean =
    Boolean(normalized) && props.localMatchCount < props.localTotalCount;

  const showResultsPanel: boolean = isFocused && canSearchRemotely;
  const hasAnsweredCurrentText: boolean = answeredText === normalized;

  return (
    <div className="relative w-full" onKeyDown={onKeyDown}>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center pl-3">
          <Icon className="h-4 w-4 text-gray-400" icon={IconProp.Search} />
        </div>
        <Input
          dataTestId="network-map-search"
          placeholder="Search sites by name — anywhere in your network"
          value={props.value}
          className={INPUT_CLASS}
          outerDivClassName="relative w-full rounded-md shadow-sm"
          disableSpellCheck={true}
          autoComplete="off"
          onChange={(value: string) => {
            /*
             * Typing re-opens the panel. Picking a result closes it while
             * leaving focus in the box (see selectResult), so without this
             * the next search would run with nowhere to show its answers.
             */
            setIsFocused(true);
            props.onChange(value);
          }}
          onFocus={() => {
            setIsFocused(true);
          }}
          /*
           * Closing on blur is enough, and it is exact: the panel swallows
           * mousedown, so clicking a result never blurs the input, and the
           * only thing that does is the reader going somewhere else.
           */
          onBlur={() => {
            setIsFocused(false);
          }}
        />
        {props.value ? (
          <button
            type="button"
            data-testid="network-map-search-clear"
            aria-label="Clear search"
            className="absolute inset-y-0 right-0 z-10 flex items-center pr-3 text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:text-indigo-600"
            onClick={() => {
              props.onChange("");
            }}
          >
            <Icon className="h-4 w-4" icon={IconProp.Close} />
          </button>
        ) : (
          <></>
        )}
      </div>

      {/*
       * The local half's feedback: how far this text narrowed the level in
       * view. It sits outside the dropdown because it stays true whether or
       * not the reader is looking at the hierarchy-wide results.
       */}
      {/*
       * The live region is always mounted, empty when there is nothing to
       * say. A region that appears at the same moment as its first message
       * is unreliably announced — screen readers watch regions that were
       * already there.
       */}
      <div aria-live="polite">
        {isNarrowed ? (
          <p
            className="mt-1 text-xs text-gray-500"
            data-testid="network-map-search-local-count"
          >
            {/*
             * pluralizeSiteType, not "+ s": the label is a per-project type
             * name the customer wrote, and naive pluralization prints
             * "Facilitys" and "Branchs" on a real estate's map.
             */}
            {`Showing ${props.localMatchCount} of ${props.localTotalCount} ${(props.localTotalCount ===
            1
              ? props.childTypeLabel
              : pluralizeSiteType(props.childTypeLabel)
            ).toLowerCase()} at this level`}
          </p>
        ) : (
          <></>
        )}
      </div>

      {showResultsPanel ? (
        /*
         * mousedown is where a blur would be triggered from, so swallowing
         * it here is what lets a click on a result land at all — without it
         * the panel unmounts under the pointer before the click fires.
         */
        <div
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          onMouseDown={(event: React.MouseEvent<HTMLDivElement>) => {
            event.preventDefault();
          }}
        >
          <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Anywhere in your network
          </p>

          {error ? (
            <p className="px-3 py-2 text-xs text-red-600">{error}</p>
          ) : (
            <></>
          )}

          {!error && isSearching && !hasAnsweredCurrentText ? (
            <p className="px-3 py-2 text-xs text-gray-500">Searching…</p>
          ) : (
            <></>
          )}

          {!error && hasAnsweredCurrentText && results.length === 0 ? (
            <p
              className="px-3 py-2 text-xs text-gray-500"
              data-testid="network-map-search-no-results"
            >
              No sites match that name.
            </p>
          ) : (
            <></>
          )}

          <div role="listbox" aria-label="Site search results">
            {results.map(
              (result: SiteSearchResultView, index: number): ReactElement => {
                const isActive: boolean = index === activeIndex;
                return (
                  <div
                    key={result.id}
                    role="option"
                    tabIndex={-1}
                    aria-selected={isActive}
                    data-testid={`network-map-search-result-${result.id}`}
                    className={`cursor-pointer px-3 py-2 ${
                      isActive ? "bg-indigo-50" : "hover:bg-gray-50"
                    }`}
                    onMouseEnter={() => {
                      setActiveIndex(index);
                    }}
                    onClick={() => {
                      selectResult(result);
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {result.currentMonitorStatus ? (
                          <span
                            className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                            title={result.currentMonitorStatus.name}
                            style={{
                              backgroundColor:
                                result.currentMonitorStatus.color ||
                                NO_STATUS_COLOR,
                            }}
                          />
                        ) : (
                          /*
                           * Hollow ring: "no data" is a different shape, not
                           * merely a grayer color. Same rule as SiteCard.
                           */
                          <span
                            className="h-1.5 w-1.5 flex-shrink-0 rounded-full border border-gray-400"
                            title="Not reporting"
                          />
                        )}
                        <span className="truncate text-sm font-medium text-gray-900">
                          {result.name}
                        </span>
                      </span>
                      <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                        {result.siteType}
                      </span>
                    </div>
                    {result.path ? (
                      <div className="mt-0.5 truncate pl-3 text-[11px] leading-4 text-gray-500">
                        {result.path}
                      </div>
                    ) : (
                      <></>
                    )}
                  </div>
                );
              },
            )}
          </div>

          {isTruncated ? (
            <p className="border-t border-gray-100 px-3 py-2 text-[11px] text-gray-500">
              More sites match than are shown — keep typing to narrow it down.
            </p>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export { MIN_SITE_SEARCH_CHARS };
export default SiteSearchBox;
