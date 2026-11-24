import PageComponentProps from "../PageComponentProps";
import {
  CodeRepositoryListItem,
  NO_CODE_REPOSITORY_FACTS,
} from "../../Components/Code/CodeApi";
import {
  CODE_REPOSITORIES_COPY,
  REPOSITORIES_PAGE_SIZE,
  REPOSITORY_SEARCH_DELAY_MS,
  REPOSITORY_SEARCH_THRESHOLD,
} from "../../Components/Code/CodeRepositoriesList";
import CodeRepositoriesTable from "../../Components/Code/CodeRepositoriesTable";
import useCodeRepositoryPage, {
  CodeRepositoryPageState,
  getPageWithinList,
} from "../../Components/Code/UseCodeRepositoryPage";
import {
  useCodeConnectDialog,
  UseCodeConnectDialog,
} from "../../Components/Code/CodeConnectDialog";
import { getCodeConnectLock } from "../../Components/CodeRepository/GitHubConnectLock";
import { CODE_GITHUB_NOT_CONNECTED } from "../../Components/Code/CodeTaskCopy";
import {
  ConnectGitHubEmptyState,
  useGitHubConnect,
  UseGitHubConnect,
} from "../../Components/Code/GitHubConnect";
import {
  CodeRepositoryListFactsJSON,
  CodeRepositoryListGroup,
  CodeRepositoryListMatchesJSON,
  CodeRepositoryListOrder,
} from "Common/Types/AI/CodeTask";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import Icon from "Common/UI/Components/Icon/Icon";
import {
  TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME,
  TABLE_HEADER_SEARCH_CLEAR_BUTTON_CLASS_NAME,
  TableHeaderSearchSlot,
  TableHeaderToolbar,
  renderTableHeaderMainAndMore,
  renderTableHeaderMainButton,
  renderTableHeaderMoreMenu,
  useTableHeaderSearchShortcut,
} from "Common/UI/Components/Table/TableHeaderControls";
import TableEmptyState, {
  TableEmptyStateAction,
  TableEmptyStateKind,
  TableEmptyStateProps,
} from "Common/UI/Components/Table/TableEmptyState";
import {
  CLEAR_SEARCH,
  getLoadErrorStateProps,
} from "Common/UI/Components/Table/TableEmptyStateBuilders";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * The list rules live in Components/Code/CodeRepositoriesList (React-free);
 * they are re-exported here for the pages and tests that read them from
 * this page.
 */
export {
  groupRepositories,
  isFoundOnlyUnderNotConnected,
  isGitHubDisconnected,
  matchesRepositorySearch,
  REPOSITORY_SEARCH_THRESHOLD,
  sortRepositories,
} from "../../Components/Code/CodeRepositoriesList";

export const CODE_REPOSITORIES_CARD_TEST_ID: string = "code-repositories-card";

export const CODE_REPOSITORIES_NOT_CONNECTED_TEST_ID: string =
  "code-repositories-not-connected";

// Where a list of the page stands: the page it shows, and how many a page holds.
interface ListPaging {
  pageNumber: number;
  pageSize: number;
}

const FIRST_PAGE: ListPaging = {
  pageNumber: 1,
  pageSize: REPOSITORIES_PAGE_SIZE,
};

/*
 * Whether a search found repositories only under Not connected: none among
 * those AI can work in, some among those it cannot. The page then opens Not
 * connected, so what was found is in sight - not a count behind a fold.
 */
export const isSearchFoundOnlyUnderNotConnected: (
  matches: CodeRepositoryListMatchesJSON,
  search: string,
) => boolean = (
  matches: CodeRepositoryListMatchesJSON,
  search: string,
): boolean => {
  return (
    search.trim().length > 0 &&
    matches.connected === 0 &&
    matches.notConnected > 0
  );
};

/*
 * Code's Repositories: the repositories of the project - on GitHub, GitLab,
 * Forgejo or Gitea, or any Git server, each with its host's mark - drawn as
 * every list in OneUptime is: a card with the shared table, its header's
 * search, its main button (Connect repositories, which asks where the code
 * is) and ⋯.
 *
 * The repositories AI can work in are the list, most recently active
 * first. Those OneUptime does not reach any more - the project's GitHub
 * App no longer reaching them, their server refusing their access token,
 * or their connection gone - are listed apart, below it, folded: how many
 * there are, why AI cannot work in them, and Connect GitHub for those on
 * GitHub, which puts every one the installation reaches back on it (one
 * on another host has Replace access token in its settings).
 *
 * However many repositories the project has (#10764): each list is a page
 * the server reads - searched, ordered and counted over every repository
 * the reader may read - and the search is the server's too. The page used
 * to hold the first 500 and page through them itself, so a repository past
 * them was never listed, counted or found.
 *
 * With none connected at all, the list says GitHub is not connected and
 * offers Connect GitHub (or, when some are on another host, that
 * OneUptime cannot reach them); with no repository yet, what Code is for
 * and where to connect from.
 */
const CodeRepositoriesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();

  const [search, setSearch] = useState<string>("");
  // What the lists are searched for: the search, once typing rests.
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [refreshToken, setRefreshToken] = useState<number>(0);
  const [connectedPaging, setConnectedPaging] =
    useState<ListPaging>(FIRST_PAGE);
  const [notConnectedPaging, setNotConnectedPaging] =
    useState<ListPaging>(FIRST_PAGE);
  /*
   * Not connected starts folded, and opens and closes as the reader says -
   * except that a search finding repositories only there opens it, so what
   * was found is in sight rather than counted behind a fold.
   */
  const [isNotConnectedOpen, setIsNotConnectedOpen] = useState<boolean>(false);
  const searchInputRef: MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const trimmed: string = search.trim();

    // Cleared: at once. Typed: once typing rests.
    if (!trimmed) {
      setSearchTerm("");
      return;
    }

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      setSearchTerm(trimmed);
    }, REPOSITORY_SEARCH_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [search]);

  // A new search starts both lists from their first page.
  useEffect(() => {
    setConnectedPaging((current: ListPaging): ListPaging => {
      return { ...current, pageNumber: 1 };
    });
    setNotConnectedPaging((current: ListPaging): ListPaging => {
      return { ...current, pageNumber: 1 };
    });
  }, [searchTerm]);

  const connected: CodeRepositoryPageState = useCodeRepositoryPage({
    group: CodeRepositoryListGroup.Connected,
    order: CodeRepositoryListOrder.Activity,
    search: searchTerm,
    pageNumber: connectedPaging.pageNumber,
    pageSize: connectedPaging.pageSize,
    isEnabled: true,
    refreshToken,
  });

  const facts: CodeRepositoryListFactsJSON =
    connected.data?.facts || NO_CODE_REPOSITORY_FACTS;
  const matches: CodeRepositoryListMatchesJSON = connected.data?.matches || {
    connected: 0,
    notConnected: 0,
  };

  const notConnected: CodeRepositoryPageState = useCodeRepositoryPage({
    group: CodeRepositoryListGroup.NotConnected,
    order: CodeRepositoryListOrder.Activity,
    search: searchTerm,
    pageNumber: notConnectedPaging.pageNumber,
    pageSize: notConnectedPaging.pageSize,
    isEnabled: isNotConnectedOpen && facts.notConnected > 0,
    refreshToken,
  });

  // A list that shrank under its page (a repository deleted) shows its last page.
  useEffect(() => {
    if (connected.data) {
      const pageNumber: number = getPageWithinList({
        ...connectedPaging,
        count: connected.data.count,
      });

      if (pageNumber !== connectedPaging.pageNumber) {
        setConnectedPaging({ ...connectedPaging, pageNumber });
      }
    }
  }, [connected.data]);

  useEffect(() => {
    if (notConnected.data) {
      const pageNumber: number = getPageWithinList({
        ...notConnectedPaging,
        count: notConnected.data.count,
      });

      if (pageNumber !== notConnectedPaging.pageNumber) {
        setNotConnectedPaging({ ...notConnectedPaging, pageNumber });
      }
    }
  }, [notConnected.data]);

  const reload: () => void = (): void => {
    setRefreshToken((current: number): number => {
      return current + 1;
    });
  };

  const connection: UseGitHubConnect = useGitHubConnect({
    onConnected: reload,
  });

  /*
   * Connect repositories opens the connect dialog: where the code is first -
   * GitHub, GitLab, Forgejo or Gitea, any Git server - then what that needs.
   */
  const connectDialog: UseCodeConnectDialog = useCodeConnectDialog({
    gitHub: connection,
    onConnected: reload,
  });

  const hasSearch: boolean = facts.total > REPOSITORY_SEARCH_THRESHOLD;
  // The search the lists show: none while the page offers no search box.
  const shownSearch: string = hasSearch ? searchTerm : "";

  const isSearchFoundOnlyNotConnected: boolean =
    isSearchFoundOnlyUnderNotConnected(matches, shownSearch);

  useEffect(() => {
    if (isSearchFoundOnlyNotConnected) {
      setIsNotConnectedOpen(true);
    }
  }, [isSearchFoundOnlyNotConnected]);

  const openSearch: () => void = (): void => {
    setIsSearchOpen(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  };

  useTableHeaderSearchShortcut(hasSearch, openSearch);

  const clearSearch: () => void = (): void => {
    setSearch("");
  };

  /*
   * The header's controls, as every table's: the search (once there are more
   * repositories than fit at a glance), Connect repositories - the main
   * button - and the ⋯ with Refresh. With none connected, the list itself
   * offers Connect GitHub: one way to connect, not two.
   */
  const getHeaderToolbar: (isDisconnected: boolean) => ReactElement = (
    isDisconnected: boolean,
  ): ReactElement => {
    const connectLock: { isLocked: boolean; reason?: string | undefined } =
      getCodeConnectLock();

    /*
     * With none connected, the list itself offers Connect GitHub: one way
     * to connect, not two - unless some of them are not on GitHub, which
     * the dialog connects (and Connect GitHub would not).
     */
    const connectButton: CardButtonSchema | null =
      !isDisconnected || !facts.areAllOnGitHub
        ? {
            title: "Connect repositories",
            phoneTitle: "Connect",
            icon: IconProp.Add,
            buttonStyle: ButtonStyleType.NORMAL,
            disabled: connectLock.isLocked,
            tooltip: connectLock.reason,
            onClick: (): void => {
              connectDialog.open();
            },
          }
        : null;

    const moreMenu: ReactElement | null = renderTableHeaderMoreMenu(
      [
        {
          title: "Refresh",
          icon: IconProp.Refresh,
          buttonStyle: ButtonStyleType.ICON,
          onClick: reload,
        },
      ],
      { dataTestId: "code-repositories-more" },
    );

    const isSearchExpanded: boolean = isSearchOpen || search.trim().length > 0;

    return (
      <TableHeaderToolbar
        dataTestId="code-repositories-toolbar"
        isSearchOpen={hasSearch && isSearchExpanded}
        search={
          hasSearch ? (
            <TableHeaderSearchSlot
              isOpen={isSearchExpanded}
              onOpen={openSearch}
              dataTestId="code-repository-search-slot"
            >
              <label
                className={`flex w-full items-center gap-2 rounded-md border border-gray-300 bg-white px-3 shadow-sm ${TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME}`}
              >
                <Icon
                  icon={IconProp.Search}
                  className="h-4 w-4 flex-none text-gray-500"
                />
                <input
                  ref={searchInputRef}
                  type="search"
                  data-testid="code-repository-search"
                  aria-label={translator.translateText(
                    CODE_REPOSITORIES_COPY.searchPlaceholder,
                  )}
                  placeholder={translator.translateText(
                    CODE_REPOSITORIES_COPY.searchPlaceholder,
                  )}
                  value={search}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                    setSearch(event.target.value);
                  }}
                  onBlur={() => {
                    if (!search.trim()) {
                      setIsSearchOpen(false);
                    }
                  }}
                  onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                    if (event.key === "Escape") {
                      setSearch("");
                      setIsSearchOpen(false);
                      event.currentTarget.blur();
                    }
                  }}
                  className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm leading-5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0 [&::-webkit-search-cancel-button]:hidden"
                />
                {search ? (
                  <button
                    type="button"
                    data-testid="code-repository-search-clear"
                    aria-label={translator.translateText(CLEAR_SEARCH)}
                    title={translator.translateText(CLEAR_SEARCH)}
                    onMouseDown={(event: React.MouseEvent) => {
                      event.preventDefault();
                    }}
                    onClick={() => {
                      clearSearch();
                      searchInputRef.current?.focus();
                    }}
                    className={TABLE_HEADER_SEARCH_CLEAR_BUTTON_CLASS_NAME}
                  >
                    <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <></>
                )}
              </label>
            </TableHeaderSearchSlot>
          ) : undefined
        }
      >
        {renderTableHeaderMainAndMore(connectButton, moreMenu)}
      </TableHeaderToolbar>
    );
  };

  // What the list of connected repositories shows with none to list.
  const getConnectedEmptyState: () => TableEmptyStateProps =
    (): TableEmptyStateProps => {
      if (connected.error) {
        // A page that failed to read says so, with Try again.
        return getLoadErrorStateProps({
          pluralLabel: "Repositories",
          error: connected.error,
          onRetry: reload,
          translate: (text: string): string => {
            return translator.translateTemplate(text);
          },
          translator: translator,
        });
      }

      if (shownSearch) {
        return {
          kind: TableEmptyStateKind.Filtered,
          title: translator.translateTemplate(
            CODE_REPOSITORIES_COPY.noMatchTitle,
          ),
          // Found under Not connected, which the search opened, just below.
          description:
            matches.notConnected > 0
              ? translator.translatePlural(
                  {
                    one: "{{count}} repository under Not connected matches it.",
                    other:
                      "{{count}} repositories under Not connected match it.",
                  },
                  matches.notConnected,
                )
              : undefined,
          // What was found is just below: this says so in less room.
          isCompact: matches.notConnected > 0,
          actions: [
            {
              title: CLEAR_SEARCH,
              icon: IconProp.Close,
              onClick: clearSearch,
              dataTestId: "code-repository-search-empty-clear",
            },
          ],
          dataTestId: "code-repository-search-empty",
        };
      }

      // GitHub reaches none of them: the project's connection is gone.
      const actions: Array<TableEmptyStateAction> = [];

      if (
        connection.isGitHubAppConfigured &&
        !connection.connectLock.isLocked &&
        facts.isAnyOnGitHub
      ) {
        actions.push({
          title: "Connect GitHub",
          // GitHub's own mark, as the Connect GitHub button of Code's start has.
          icon: IconProp.GitHub,
          onClick: (): void => {
            connection.connect();
          },
          dataTestId: "code-github-reconnect",
        });
      }

      return {
        kind: TableEmptyStateKind.Empty,
        icon: IconProp.LinkSlash,
        title: translator.translateTemplate(
          CODE_REPOSITORIES_COPY.noneConnectedTitle,
        ),
        description: translator.translateTemplate(
          facts.areAllOnGitHub
            ? CODE_GITHUB_NOT_CONNECTED
            : CODE_REPOSITORIES_COPY.notConnectedSummaryAnyHost,
        ),
        actions: actions,
        ...(connection.isGitHubAppConfigured && connection.connectLock.isLocked
          ? {
              note: (
                <span data-testid="code-github-disconnected-lock">
                  {connection.connectLock.reason}
                </span>
              ),
            }
          : {}),
        dataTestId: "code-github-disconnected",
      };
    };

  const renderBody: () => ReactElement = (): ReactElement => {
    if (!connected.data && connected.isLoading) {
      return (
        <Card
          title={CODE_REPOSITORIES_COPY.cardTitle}
          description={CODE_REPOSITORIES_COPY.cardDescription}
        >
          <div data-testid="code-repositories-loading" role="status">
            <span className="sr-only">
              {translator.translateText("Loading…")}
            </span>
            <CodeRepositoriesTable
              id="code-repositories"
              repositories={[]}
              isLoading={true}
            />
          </div>
        </Card>
      );
    }

    if (!connected.data) {
      return (
        <Card
          title={CODE_REPOSITORIES_COPY.cardTitle}
          description={CODE_REPOSITORIES_COPY.cardDescription}
        >
          <div data-testid="code-repositories-error">
            <TableEmptyState
              {...getLoadErrorStateProps({
                pluralLabel: "Repositories",
                error: connected.error || "",
                onRetry: reload,
                translate: (text: string): string => {
                  return translator.translateTemplate(text);
                },
                translator: translator,
              })}
            />
          </div>
        </Card>
      );
    }

    if (facts.total === 0) {
      return (
        <ConnectGitHubEmptyState
          connection={connection}
          onConnectOtherHost={connectDialog.open}
        />
      );
    }

    const isDisconnected: boolean = facts.connected === 0;
    const headerToolbar: ReactElement = getHeaderToolbar(isDisconnected);
    const connectedRows: Array<CodeRepositoryListItem> = connected.error
      ? []
      : connected.data.repositories;

    return (
      <>
        <div data-testid={CODE_REPOSITORIES_CARD_TEST_ID}>
          <Card
            title={CODE_REPOSITORIES_COPY.cardTitle}
            description={CODE_REPOSITORIES_COPY.cardDescription}
            headerLayout="toolbar"
            buttons={[headerToolbar]}
          >
            <CodeRepositoriesTable
              id="code-repositories"
              repositories={connectedRows}
              isLoading={connected.isLoading}
              paging={{
                totalCount: connected.error ? 0 : connected.data.count,
                pageNumber: connectedPaging.pageNumber,
                pageSize: connectedPaging.pageSize,
                onNavigateToPage: (
                  pageNumber: number,
                  pageSize: number,
                ): void => {
                  setConnectedPaging({ pageNumber, pageSize });
                },
              }}
              emptyState={getConnectedEmptyState()}
            />
          </Card>
        </div>

        {facts.notConnected > 0 ? (
          <FoldedSection
            title={CODE_REPOSITORIES_COPY.notConnectedTitle}
            icon={IconProp.LinkSlash}
            items={[
              {
                key: "count",
                title: translator.translatePlural(
                  {
                    one: "{{count}} repository",
                    other: "{{count}} repositories",
                  },
                  matches.notConnected,
                ),
                isSet: false,
              },
            ]}
            summary={
              facts.areAllNotConnectedOnGitHub
                ? CODE_REPOSITORIES_COPY.notConnectedSummary
                : CODE_REPOSITORIES_COPY.notConnectedSummaryAnyHost
            }
            isCollapsed={!isNotConnectedOpen}
            onToggle={(isCollapsed: boolean): void => {
              setIsNotConnectedOpen(!isCollapsed);
            }}
            isElevated={true}
            isBodyFlush={true}
            className="mb-5"
            dataTestId={CODE_REPOSITORIES_NOT_CONNECTED_TEST_ID}
          >
            <div className="border-t border-gray-200 px-5 pb-6 pt-4 md:px-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                <p
                  data-testid="code-not-connected-explanation"
                  className="min-w-0 flex-1 basis-64 text-sm leading-6 text-gray-600"
                >
                  {translator.translateText(
                    facts.areAllNotConnectedOnGitHub
                      ? CODE_REPOSITORIES_COPY.notConnectedExplanation
                      : CODE_REPOSITORIES_COPY.notConnectedExplanationAnyHost,
                  )}
                </p>
                {/*
                 * With none connected, the list above already offers Connect
                 * GitHub: one way to connect, not two. Only for repositories
                 * on GitHub: one on another host connects again in its own
                 * settings (Replace access token).
                 */}
                {connection.isGitHubAppConfigured &&
                !isDisconnected &&
                facts.isAnyNotConnectedOnGitHub ? (
                  connection.connectLock.isLocked ? (
                    <p
                      data-testid="code-not-connected-lock"
                      className="text-sm text-gray-500"
                    >
                      {connection.connectLock.reason}
                    </p>
                  ) : (
                    <span data-testid="code-not-connected-reconnect">
                      {renderTableHeaderMainButton({
                        title: "Connect GitHub",
                        icon: IconProp.GitHub,
                        buttonStyle: ButtonStyleType.NORMAL,
                        onClick: (): void => {
                          connection.connect();
                        },
                      })}
                    </span>
                  )
                ) : (
                  <></>
                )}
              </div>
              <CodeRepositoriesTable
                id="code-repositories-not-connected-table"
                repositories={
                  notConnected.error || !notConnected.data
                    ? []
                    : notConnected.data.repositories
                }
                isNotConnected={true}
                isLoading={notConnected.isLoading}
                paging={{
                  totalCount:
                    notConnected.error || !notConnected.data
                      ? 0
                      : notConnected.data.count,
                  pageNumber: notConnectedPaging.pageNumber,
                  pageSize: notConnectedPaging.pageSize,
                  onNavigateToPage: (
                    pageNumber: number,
                    pageSize: number,
                  ): void => {
                    setNotConnectedPaging({ pageNumber, pageSize });
                  },
                }}
                emptyState={
                  notConnected.error
                    ? getLoadErrorStateProps({
                        pluralLabel: "Repositories",
                        error: notConnected.error,
                        onRetry: reload,
                        translate: (text: string): string => {
                          return translator.translateTemplate(text);
                        },
                        translator: translator,
                      })
                    : {
                        kind: TableEmptyStateKind.Filtered,
                        title: translator.translateTemplate(
                          CODE_REPOSITORIES_COPY.noMatchTitle,
                        ),
                        isCompact: true,
                        actions: [
                          {
                            title: CLEAR_SEARCH,
                            icon: IconProp.Close,
                            onClick: clearSearch,
                          },
                        ],
                      }
                }
              />
            </div>
          </FoldedSection>
        ) : (
          <></>
        )}
      </>
    );
  };

  return (
    <div>
      {connection.notices}
      {connectDialog.notice}
      {renderBody()}
      {connectDialog.dialog}
    </div>
  );
};

export default CodeRepositoriesPage;
