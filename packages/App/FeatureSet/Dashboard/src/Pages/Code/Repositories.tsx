import PageComponentProps from "../PageComponentProps";
import CodeApi, {
  CodeRepositoriesResponse,
  CodeRepositoryListItem,
} from "../../Components/Code/CodeApi";
import {
  areAllOnGitHub,
  CODE_REPOSITORIES_COPY,
  CodeRepositoryGroups,
  groupRepositories,
  isFoundOnlyUnderNotConnected,
  isGitHubDisconnected,
  isGitHubRepository,
  REPOSITORY_SEARCH_THRESHOLD,
} from "../../Components/Code/CodeRepositoriesList";
import CodeRepositoriesTable from "../../Components/Code/CodeRepositoriesTable";
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
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useCallback,
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
 * on another host has Replace access token in its settings). They used to
 * sit among the others, each with a "Not connected" pill, so a project
 * with one connected repository and fourteen others saw its one at the
 * end of the list.
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

  const [data, setData] = useState<CodeRepositoriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>("");
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const searchInputRef: MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    setIsLoading(true);

    try {
      setData(await CodeApi.getRepositories());
      setError(null);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  }, []);

  const reload: () => void = (): void => {
    load().catch(() => {
      // handled inside load
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

  useEffect(() => {
    reload();
  }, [load]);

  const repositories: Array<CodeRepositoryListItem> = data?.repositories || [];
  const hasSearch: boolean = repositories.length > REPOSITORY_SEARCH_THRESHOLD;
  const searchTerm: string = hasSearch ? search.trim() : "";

  // The two lists as the search leaves them, and Not connected as a whole.
  const groups: CodeRepositoryGroups = groupRepositories(
    repositories,
    searchTerm,
  );
  const allGroups: CodeRepositoryGroups = groupRepositories(repositories);

  /*
   * Not connected starts folded, and opens and closes as the reader says -
   * except that a search finding repositories only there opens it, so what
   * was found is in sight rather than counted behind a fold.
   */
  const [isNotConnectedOpen, setIsNotConnectedOpen] = useState<boolean>(false);
  const isSearchFoundOnlyNotConnected: boolean = isFoundOnlyUnderNotConnected(
    groups,
    searchTerm,
  );

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
      !isDisconnected || !areAllOnGitHub(repositories)
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
              <div
                className={`flex w-full items-center gap-2 rounded-md border border-gray-300 bg-white px-3 shadow-sm ${TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME}`}
                onClick={() => {
                  searchInputRef.current?.focus();
                }}
                role="presentation"
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
              </div>
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
      if (searchTerm) {
        return {
          kind: TableEmptyStateKind.Filtered,
          title: translator.translateTemplate(
            CODE_REPOSITORIES_COPY.noMatchTitle,
          ),
          // Found under Not connected, which the search opened, just below.
          description:
            groups.notConnected.length > 0
              ? translator.translatePlural(
                  {
                    one: "{{count}} repository under Not connected matches it.",
                    other:
                      "{{count}} repositories under Not connected match it.",
                  },
                  groups.notConnected.length,
                )
              : undefined,
          // What was found is just below: this says so in less room.
          isCompact: groups.notConnected.length > 0,
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
        repositories.some(isGitHubRepository)
      ) {
        actions.push({
          title: "Connect GitHub",
          icon: IconProp.Link,
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
          areAllOnGitHub(repositories)
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
    if (isLoading && !data) {
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

    if (error && !data) {
      return (
        <Card
          title={CODE_REPOSITORIES_COPY.cardTitle}
          description={CODE_REPOSITORIES_COPY.cardDescription}
        >
          <div data-testid="code-repositories-error">
            <TableEmptyState
              {...getLoadErrorStateProps({
                pluralLabel: "Repositories",
                error: error,
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

    if (repositories.length === 0) {
      return (
        <ConnectGitHubEmptyState
          connection={connection}
          onConnectOtherHost={connectDialog.open}
        />
      );
    }

    const isDisconnected: boolean = isGitHubDisconnected(repositories);
    const headerToolbar: ReactElement = getHeaderToolbar(isDisconnected);

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
              repositories={groups.connected}
              emptyState={getConnectedEmptyState()}
            />
          </Card>
        </div>

        {allGroups.notConnected.length > 0 ? (
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
                  groups.notConnected.length,
                ),
                isSet: false,
              },
            ]}
            summary={
              areAllOnGitHub(allGroups.notConnected)
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
                    areAllOnGitHub(allGroups.notConnected)
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
                allGroups.notConnected.some(isGitHubRepository) ? (
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
                        icon: IconProp.Link,
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
                repositories={groups.notConnected}
                isNotConnected={true}
                emptyState={{
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
                }}
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
