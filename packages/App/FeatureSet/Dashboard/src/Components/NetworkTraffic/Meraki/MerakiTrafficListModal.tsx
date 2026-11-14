import { fetchNetworkTrafficUsageList } from "../NetworkTrafficUsageApi";
import { TrafficTopRow, TrafficTopRows } from "../TrafficTopList";
import {
  toApplicationTopRow,
  toClientTopRow,
  toNetworkTopRow,
} from "./MerakiListRows";
import {
  LIST_SORT_LABEL,
  LIST_SORT_WORDS,
  MERAKI_LIST_WORDS,
  MerakiListWords,
} from "./MerakiLinkWords";
import IconProp from "Common/Types/Icon/IconProp";
import {
  NETWORK_TRAFFIC_USAGE_LIST_PAGE_SIZE,
  NETWORK_TRAFFIC_USAGE_LIST_SORTS,
  NetworkTrafficUsageApplicationRow,
  NetworkTrafficUsageClientRow,
  NetworkTrafficUsageKind,
  NetworkTrafficUsageListKind,
  NetworkTrafficUsageListResult,
  NetworkTrafficUsageListSort,
  NetworkTrafficUsageNetworkRow,
  NetworkTrafficUsageRequest,
} from "Common/Types/NetFlow/NetworkTrafficUsage";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pagination from "Common/UI/Components/Pagination/Pagination";
import API from "Common/UI/Utils/API/API";
import { scrollToTopOfScroller } from "Common/UI/Utils/ScrollToTopOfScroller";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";

/*
 * EVERY ROW OF A TOP LIST (issue #5762): all the networks, applications or
 * clients of the page, where its card shows the busiest ten.
 *
 * The page's own traffic - its device or site, its time range, its filters -
 * read a page of rows at a time, searched and sorted by the database
 * (POST /network-traffic/usage-list), so an estate of thousands of
 * networks opens as fast as one of ten. Each row is drawn as its card draws
 * it (MerakiListRows), with its share of the same total. A network is a
 * filter here as on the card: a click narrows the page to it and closes the
 * dialog. Applications and clients are lists, as on the card.
 *
 * The search waits for a pause in the typing; the sort is busiest first, by
 * both directions, what came in or what went out - "Sort by" says it is an
 * order, never a filter, and sorted by one way each row's own figure for
 * it stands out. A change of either goes back to the first page.
 *
 * The search and the sort stay at the top of the dialog while its rows
 * scroll under them, and a page read anew - the next one, a search, another
 * order - opens at its start: the pages are under the rows, so the next one
 * was asked for with the last rows in view. While a page is read the search
 * box's glass turns into the spinner, as the episode pickers' does.
 */

export interface ComponentProps {
  list: NetworkTrafficUsageListKind;
  // The page's request: whose traffic, its time range and filters.
  request: NetworkTrafficUsageRequest;
  // What Top networks is of on the page.
  primaryKind: NetworkTrafficUsageKind;
  // The total every share is of, as on the page's card.
  totalOctets: number;
  // How many rows the page's card said the list has.
  count: number;
  // The network the page is narrowed to.
  activeNetworkId?: string | undefined;
  // Narrows the page to a network: absent where the page cannot narrow.
  onSelectNetwork?: ((controllerNetworkId: string) => void) | undefined;
  // Whether a client's row says its network (a page of several).
  clientsWithNetwork: boolean;
  onClose: () => void;
}

// How long the search waits for the typing to pause.
export const LIST_SEARCH_DELAY_MS: number = 300;

/*
 * The search and the sort, kept at the top of the dialog's scrolling body:
 * edge to edge over the rows that scroll under them, its own padding in
 * place of the body's (Modal: px-5 py-5, sm:px-6).
 */
export const LIST_TOOLBAR_CLASS_NAME: string =
  "sticky -top-5 z-10 -mx-5 -mt-5 border-b border-gray-100 bg-white px-5 pb-4 pt-5 sm:-mx-6 sm:px-6";

const MerakiTrafficListModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const words: MerakiListWords = MERAKI_LIST_WORDS[props.list];
  const sortLabelId: string = useId();

  const [searchInput, setSearchInput] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [sortBy, setSortBy] = useState<NetworkTrafficUsageListSort>(
    NetworkTrafficUsageListSort.Total,
  );
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(
    NETWORK_TRAFFIC_USAGE_LIST_PAGE_SIZE,
  );
  const [result, setResult] = useState<NetworkTrafficUsageListResult | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [retryKey, setRetryKey] = useState<number>(0);
  const latestRef: React.MutableRefObject<number> = useRef<number>(0);
  const rootRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);

  // The search, once the typing pauses: from the first page again.
  useEffect(() => {
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      setSearch(searchInput.trim());
      setPageNumber(1);
    }, LIST_SEARCH_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [searchInput]);

  useEffect(() => {
    latestRef.current += 1;
    const requestId: number = latestRef.current;

    setIsLoading(true);
    setError("");
    // A page read anew opens at its start, under the search and the sort.
    scrollToTopOfScroller(rootRef.current);

    fetchNetworkTrafficUsageList({
      ...props.request,
      list: props.list,
      primaryKind: props.primaryKind,
      search: search,
      sortBy: sortBy,
      skip: (pageNumber - 1) * pageSize,
      limit: pageSize,
    })
      .then((next: NetworkTrafficUsageListResult) => {
        if (requestId === latestRef.current) {
          setResult(next);
        }
      })
      .catch((err: Error) => {
        if (requestId === latestRef.current) {
          setError(API.getFriendlyMessage(err));
        }
      })
      .finally(() => {
        if (requestId === latestRef.current) {
          setIsLoading(false);
        }
      });
  }, [search, sortBy, pageNumber, pageSize, retryKey]);

  const rows: Array<TrafficTopRow> = ((): Array<TrafficTopRow> => {
    if (!result) {
      return [];
    }

    if (props.list === NetworkTrafficUsageListKind.Applications) {
      return result.applications.map(
        (row: NetworkTrafficUsageApplicationRow): TrafficTopRow => {
          return toApplicationTopRow(row, translator, sortBy);
        },
      );
    }

    if (props.list === NetworkTrafficUsageListKind.Clients) {
      return result.clients.map(
        (row: NetworkTrafficUsageClientRow): TrafficTopRow => {
          return toClientTopRow(row, translator, {
            withNetwork: props.clientsWithNetwork,
            sortBy,
          });
        },
      );
    }

    return result.networks.map(
      (row: NetworkTrafficUsageNetworkRow): TrafficTopRow => {
        const onSelectNetwork:
          | ((controllerNetworkId: string) => void)
          | undefined = props.onSelectNetwork;

        return toNetworkTopRow({
          row,
          translator,
          isActive: props.activeNetworkId === row.controllerNetworkId,
          onClick: onSelectNetwork
            ? () => {
                onSelectNetwork(row.controllerNetworkId);
                props.onClose();
              }
            : undefined,
          sortBy,
        });
      },
    );
  })();

  const count: number = result ? result.count : props.count;
  // A page after the first being read: the search box says so.
  const isRereading: boolean = isLoading && Boolean(result);

  const body: ReactElement = ((): ReactElement => {
    if (!result && isLoading) {
      return <ComponentLoader />;
    }

    if (error && !result) {
      return (
        <div className="py-6" data-testid="meraki-list-error">
          <ErrorMessage
            message={error}
            onRefreshClick={() => {
              setRetryKey((key: number) => {
                return key + 1;
              });
            }}
          />
        </div>
      );
    }

    if (rows.length === 0) {
      return (
        <p
          className="py-10 text-center text-sm text-gray-500"
          role="status"
          data-testid="meraki-list-empty"
        >
          {search
            ? translator.translateTemplate(words.noMatch, { search })
            : translator.translateText(words.empty)}
        </p>
      );
    }

    return (
      <div
        className={isLoading ? "opacity-75 transition-opacity" : ""}
        aria-busy={isLoading}
      >
        {error ? (
          <p
            role="alert"
            className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
          >
            <ErrorSentence
              template="Couldn't refresh — showing previously loaded data. {{error}}"
              error={error}
            />
          </p>
        ) : (
          <></>
        )}
        <TrafficTopRows
          rows={rows}
          totalOctets={props.totalOctets}
          dataTestId="meraki-list"
        />
      </div>
    );
  })();

  return (
    <Modal
      title={words.title}
      description={words.description}
      onClose={props.onClose}
      closeButtonText="Close"
      modalWidth={ModalWidth.Medium}
    >
      <div ref={rootRef} data-testid={`meraki-list-${props.list}`}>
        <div
          className={LIST_TOOLBAR_CLASS_NAME}
          data-testid="meraki-list-toolbar"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3">
                {isRereading ? (
                  <Icon
                    icon={IconProp.Spinner}
                    className="h-4 w-4 animate-spin text-gray-400"
                    data-testid="meraki-list-search-busy"
                  />
                ) : (
                  <Icon
                    icon={IconProp.Search}
                    className="h-4 w-4 text-gray-400"
                  />
                )}
              </div>
              <input
                type="search"
                data-unsaved-changes-ignore
                value={searchInput}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setSearchInput(event.target.value);
                }}
                placeholder={translator.translateText(words.searchPlaceholder)}
                aria-label={translator.translateText(words.searchPlaceholder)}
                maxLength={100}
                className="block w-full rounded-md border border-gray-300 bg-white py-2 pe-3 ps-9 text-sm text-gray-900 placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                data-testid="meraki-list-search"
              />
            </div>
            <div className="flex flex-shrink-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span
                id={sortLabelId}
                className="whitespace-nowrap text-xs text-gray-500"
                data-testid="meraki-list-sort-label"
              >
                {translator.translateText(LIST_SORT_LABEL)}
              </span>
              <div
                className="inline-flex rounded-md bg-gray-50 p-0.5 ring-1 ring-gray-200"
                role="group"
                aria-labelledby={sortLabelId}
                data-testid="meraki-list-sort"
              >
                {NETWORK_TRAFFIC_USAGE_LIST_SORTS.map(
                  (option: NetworkTrafficUsageListSort): ReactElement => {
                    return (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={sortBy === option}
                        className={`rounded px-2.5 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                          sortBy === option
                            ? "bg-white text-gray-900 shadow-sm"
                            : "text-gray-500 hover:text-gray-900"
                        }`}
                        onClick={() => {
                          setSortBy(option);
                          setPageNumber(1);
                        }}
                        data-testid={`meraki-list-sort-${option}`}
                      >
                        {translator.translateText(LIST_SORT_WORDS[option])}
                      </button>
                    );
                  },
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-2 min-h-[12rem]">{body}</div>

        {result && count > 0 ? (
          <div className="mt-3 border-t border-gray-100">
            <Pagination
              currentPageNumber={pageNumber}
              totalItemsCount={count}
              itemsOnPage={pageSize}
              onNavigateToPage={(page: number, itemsOnPage: number) => {
                if (itemsOnPage !== pageSize) {
                  setPageSize(itemsOnPage);
                  setPageNumber(1);
                  return;
                }

                setPageNumber(page);
              }}
              isLoading={isLoading}
              isError={Boolean(error)}
              singularLabel={words.singular}
              pluralLabel={words.plural}
              isCompact={true}
              dataTestId="meraki-list-pagination"
            />
          </div>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default MerakiTrafficListModal;
