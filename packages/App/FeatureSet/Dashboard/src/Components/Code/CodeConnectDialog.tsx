import CodeConnectApi, { CodeConnectSource } from "./CodeConnectApi";
import CodeHostChoices from "./CodeHostChoices";
import CodeHostMark from "./CodeHostMark";
import {
  CODE_CONNECT_COPY,
  CODE_CONNECT_DOCS,
  CODE_CONNECT_TOKEN_TITLES,
  getDefaultHostUrl,
  getHostLabel,
} from "./CodeHostCopy";
import {
  CodeConnectStep,
  getConnectableIds,
  getTokenProviderOf,
  isTokenProvider,
  readTokenForm,
  toggleSelection,
} from "./CodeConnectFlow";
import { UseGitHubConnect } from "./GitHubConnect";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import {
  CodeHostConnectResultJSON,
  CodeHostConnectionJSON,
  CodeHostListedRepositoryJSON,
  CodeHostRepositoryListJSON,
  GitRepositoryConnectResultJSON,
} from "Common/Types/CodeRepository/CodeHostConnect";
import Exception from "Common/Types/Exception/Exception";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Icon from "Common/UI/Components/Icon/Icon";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * CONNECTING REPOSITORIES, WHEREVER THEY ARE HOSTED.
 *
 * One dialog, in as few steps as the host needs:
 *
 *   1. Where is your code? GitHub, GitLab, Forgejo or Gitea, or any Git
 *      server (CodeHostChoices). GitHub hands over to the GitHub App's
 *      install, as Connect GitHub always did.
 *   2. GitLab, Forgejo or Gitea: the server's address (the public one most
 *      people use, filled in) and an access token - or a connection the
 *      project already has. Any Git server: the repository's address, a
 *      username and a password or token.
 *   3. GitLab, Forgejo or Gitea: the repositories the token can push to, to
 *      pick - searched on the server - and Connect.
 *
 * A token goes to the server and nothing sends one back. Whatever the
 * server refuses is said in the dialog, in its words, and keeps what was
 * typed. A Git repository whose address OneUptime cannot reach is asked
 * about first: connect it anyway, for a Runner on its network to work in.
 */

export interface ComponentProps {
  // Skips the first step: the host was picked already (the empty page's tiles).
  initialProvider?: CodeRepositoryType | undefined;
  gitHub: UseGitHubConnect;
  onClose: () => void;
  // The repositories were connected: how many, and from where.
  onConnected: (data: {
    count: number;
    provider: CodeRepositoryType;
    repositoryId?: string | undefined;
  }) => void;
}

export const CODE_CONNECT_DIALOG_TEST_ID: string = "code-connect-dialog";

// How long typing rests before the server is asked for matching repositories.
export const REPOSITORY_SEARCH_DELAY_MS: number = 300;

const CodeConnectDialog: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [step, setStep] = useState<CodeConnectStep>(
    props.initialProvider
      ? isTokenProvider(props.initialProvider)
        ? CodeConnectStep.Token
        : CodeConnectStep.Git
      : CodeConnectStep.Choose,
  );
  const [provider, setProvider] = useState<CodeRepositoryType | null>(
    props.initialProvider || null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // The token step.
  const [connections, setConnections] =
    useState<Array<CodeHostConnectionJSON> | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [hostUrl, setHostUrl] = useState<string>(
    props.initialProvider ? getDefaultHostUrl(props.initialProvider) : "",
  );
  const [token, setToken] = useState<string>("");

  // The pick step.
  const [source, setSource] = useState<CodeConnectSource | null>(null);
  const [listing, setListing] = useState<CodeHostRepositoryListJSON | null>(
    null,
  );
  const [repositories, setRepositories] = useState<
    Array<CodeHostListedRepositoryJSON>
  >([]);
  const [page, setPage] = useState<number>(1);
  const [search, setSearch] = useState<string>("");
  const [selected, setSelected] = useState<Array<string>>([]);
  const [isListing, setIsListing] = useState<boolean>(false);

  // The Git step.
  const [gitUrl, setGitUrl] = useState<string>("");
  const [gitUsername, setGitUsername] = useState<string>("");
  const [gitPassword, setGitPassword] = useState<string>("");
  const [confirmation, setConfirmation] = useState<string | null>(null);

  // Only the latest listing counts: an answer to an older search is dropped.
  const listingRef: React.MutableRefObject<number> = useRef<number>(0);
  const searchTimerRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

  // The project's connections, read once a token's host is picked.
  useEffect(() => {
    if (step !== CodeConnectStep.Token || connections !== null) {
      return;
    }

    let isCurrent: boolean = true;

    CodeConnectApi.listConnections()
      .then((found: Array<CodeHostConnectionJSON>) => {
        if (isCurrent) {
          setConnections(found);
        }
      })
      .catch(() => {
        // Without them the dialog asks for a token, as for a first one.
        if (isCurrent) {
          setConnections([]);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [step, connections]);

  const providerConnections: Array<CodeHostConnectionJSON> = (
    connections || []
  ).filter((connection: CodeHostConnectionJSON): boolean => {
    return connection.provider === provider;
  });

  const choose: (picked: CodeRepositoryType) => void = (
    picked: CodeRepositoryType,
  ): void => {
    setError(null);

    if (picked === CodeRepositoryType.GitHub) {
      props.onClose();
      props.gitHub.connect();
      return;
    }

    setProvider(picked);

    if (isTokenProvider(picked)) {
      setHostUrl(getDefaultHostUrl(picked));
      setConnectionId(null);
      setStep(CodeConnectStep.Token);
      return;
    }

    setStep(CodeConnectStep.Git);
  };

  // Reads one page of what a source reaches: page 1 starts the list again.
  const loadRepositories: (data: {
    source: CodeConnectSource;
    search: string;
    page: number;
  }) => Promise<boolean> = async (data: {
    source: CodeConnectSource;
    search: string;
    page: number;
  }): Promise<boolean> => {
    const readId: number = ++listingRef.current;
    setIsListing(true);

    try {
      const answer: CodeHostRepositoryListJSON =
        await CodeConnectApi.listRepositories({
          source: data.source,
          search: data.search,
          page: data.page,
        });

      if (readId !== listingRef.current) {
        return false;
      }

      setListing(answer);
      setRepositories((current: Array<CodeHostListedRepositoryJSON>) => {
        return data.page === 1
          ? answer.repositories
          : [...current, ...answer.repositories];
      });
      setPage(data.page);
      setError(null);
      setIsListing(false);
      return true;
    } catch (err) {
      if (readId === listingRef.current) {
        setError(API.getFriendlyErrorMessage(err as Exception));
        setIsListing(false);
      }

      return false;
    }
  };

  // From the token step to the pick step: the server checks the token first.
  const continueWithToken: () => Promise<void> = async (): Promise<void> => {
    if (!provider || !isTokenProvider(provider)) {
      return;
    }

    const read: { source: CodeConnectSource } | { error: string } =
      readTokenForm({
        provider: getTokenProviderOf(provider),
        connectionId,
        hostUrl,
        token,
      });

    if ("error" in read) {
      setError(translator.translateTemplate(read.error));
      return;
    }

    setIsLoading(true);
    setSearch("");
    setSelected([]);

    const isListed: boolean = await loadRepositories({
      source: read.source,
      search: "",
      page: 1,
    });

    setIsLoading(false);

    if (isListed) {
      setSource(read.source);
      setStep(CodeConnectStep.Pick);
    }
  };

  const onSearch: (value: string) => void = (value: string): void => {
    setSearch(value);

    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }

    if (!source) {
      return;
    }

    searchTimerRef.current = setTimeout(() => {
      void loadRepositories({ source, search: value.trim(), page: 1 });
    }, REPOSITORY_SEARCH_DELAY_MS);
  };

  const connectPicked: () => Promise<void> = async (): Promise<void> => {
    if (!source || !provider || selected.length === 0) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result: CodeHostConnectResultJSON = await CodeConnectApi.connect({
        source,
        repositoryIds: selected,
      });

      props.onConnected({
        count: result.imported + result.reconnected,
        provider,
      });
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Exception));
      setIsLoading(false);
    }
  };

  const connectGit: (connectWithoutCheck: boolean) => Promise<void> = async (
    connectWithoutCheck: boolean,
  ): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      const result: GitRepositoryConnectResultJSON =
        await CodeConnectApi.connectGitRepository({
          url: gitUrl,
          username: gitUsername,
          password: gitPassword,
          connectWithoutCheck,
        });

      if (result.needsConfirmation) {
        setConfirmation(result.message || "");
        setIsLoading(false);
        return;
      }

      props.onConnected({
        count: 1,
        provider: CodeRepositoryType.Git,
        repositoryId: result.repositoryId,
      });
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Exception));
      setIsLoading(false);
    }
  };

  const goBack: () => void = (): void => {
    setError(null);
    setConfirmation(null);

    if (step === CodeConnectStep.Pick) {
      setStep(CodeConnectStep.Token);
      return;
    }

    if (props.initialProvider) {
      props.onClose();
      return;
    }

    setStep(CodeConnectStep.Choose);
  };

  const renderTokenStep: () => ReactElement = (): ReactElement => {
    const tokenProvider:
      | CodeRepositoryType.GitLab
      | CodeRepositoryType.Forgejo = getTokenProviderOf(
      provider || CodeRepositoryType.GitLab,
    );
    const isNewToken: boolean = connectionId === null;

    return (
      <div data-testid="code-connect-token" className="space-y-5">
        {providerConnections.length > 0 ? (
          <fieldset data-testid="code-connect-connections">
            <legend className="text-sm font-medium text-gray-700">
              {translator.translateText(CODE_CONNECT_COPY.useConnectionTitle)}
            </legend>
            <div className="mt-2 divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200">
              {providerConnections.map(
                (connection: CodeHostConnectionJSON): ReactElement => {
                  return (
                    <label
                      key={connection.id}
                      data-testid="code-connect-connection"
                      className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-gray-50"
                    >
                      <input
                        type="radio"
                        name="code-connect-connection"
                        className="h-4 w-4 border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        checked={connectionId === connection.id}
                        onChange={() => {
                          setConnectionId(connection.id);
                          setError(null);
                        }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">
                          {getHostLabel(connection.hostUrl)}
                        </span>
                        <span className="block truncate text-xs text-gray-500">
                          {[
                            connection.accountLogin
                              ? `@${connection.accountLogin}`
                              : "",
                            translator.translatePlural(
                              {
                                one: "{{count}} repository",
                                other: "{{count}} repositories",
                              },
                              connection.repositoryCount,
                            ),
                          ]
                            .filter((part: string): boolean => {
                              return Boolean(part);
                            })
                            .join(" · ")}
                        </span>
                      </span>
                      {connection.isTokenRefused ? (
                        <span className="inline-flex flex-none items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20">
                          {translator.translateText("Token refused")}
                        </span>
                      ) : (
                        <></>
                      )}
                    </label>
                  );
                },
              )}
              <label
                data-testid="code-connect-new-token"
                className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name="code-connect-connection"
                  className="h-4 w-4 border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  checked={isNewToken}
                  onChange={() => {
                    setConnectionId(null);
                    setError(null);
                  }}
                />
                <span className="text-sm font-medium text-gray-900">
                  {translator.translateText(CODE_CONNECT_COPY.newTokenOption)}
                </span>
              </label>
            </div>
          </fieldset>
        ) : (
          <></>
        )}

        {isNewToken ? (
          <div className="space-y-4">
            <div>
              <FieldLabelElement
                title={CODE_CONNECT_COPY.tokenServerTitle}
                htmlFor="code-connect-host-url"
                required={true}
                description={
                  tokenProvider === CodeRepositoryType.GitLab
                    ? CODE_CONNECT_COPY.tokenServerHelpGitLab
                    : CODE_CONNECT_COPY.tokenServerHelpForgejo
                }
              />
              <div className="mt-2">
                <Input
                  id="code-connect-host-url"
                  dataTestId="code-connect-host-url"
                  type={InputType.URL}
                  value={hostUrl}
                  placeholder={getDefaultHostUrl(tokenProvider)}
                  disableSpellCheck={true}
                  onChange={(value: string) => {
                    setHostUrl(value);
                  }}
                  onEnterPress={() => {
                    void continueWithToken();
                  }}
                />
              </div>
            </div>
            <div>
              <FieldLabelElement
                title={CODE_CONNECT_COPY.tokenTitle}
                htmlFor="code-connect-token-input"
                required={true}
                sideLink={{
                  text: CODE_CONNECT_COPY.createTokenLink,
                  url: Route.fromString(CODE_CONNECT_DOCS[tokenProvider]),
                  openLinkInNewTab: true,
                }}
                description={
                  tokenProvider === CodeRepositoryType.GitLab
                    ? CODE_CONNECT_COPY.tokenHelpGitLab
                    : CODE_CONNECT_COPY.tokenHelpForgejo
                }
              />
              <div className="mt-2">
                <Input
                  id="code-connect-token-input"
                  dataTestId="code-connect-token-input"
                  type={InputType.PASSWORD}
                  value={token}
                  disableSpellCheck={true}
                  onChange={(value: string) => {
                    setToken(value);
                  }}
                  onEnterPress={() => {
                    void continueWithToken();
                  }}
                />
              </div>
            </div>
            <p className="text-xs leading-5 text-gray-500">
              {translator.translateText(CODE_CONNECT_COPY.tokenDescription)}
            </p>
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const renderPickStep: () => ReactElement = (): ReactElement => {
    const connectable: Array<string> = getConnectableIds(repositories);

    return (
      <div data-testid="code-connect-pick" className="space-y-3">
        {listing ? (
          <p
            data-testid="code-connect-signed-in"
            className="text-sm text-gray-600"
          >
            {translator.translateTemplate(CODE_CONNECT_COPY.pickDescription, {
              host: getHostLabel(listing.hostUrl),
              account: `@${listing.account.login}`,
            })}
          </p>
        ) : (
          <></>
        )}

        <div className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 shadow-sm focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500">
          <Icon
            icon={IconProp.Search}
            className="h-4 w-4 flex-none text-gray-500"
          />
          <input
            type="search"
            data-testid="code-connect-search"
            aria-label={translator.translateText(
              CODE_CONNECT_COPY.searchPlaceholder,
            )}
            placeholder={translator.translateText(
              CODE_CONNECT_COPY.searchPlaceholder,
            )}
            value={search}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              onSearch(event.target.value);
            }}
            className="min-w-0 flex-1 border-0 bg-transparent py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0"
          />
          {isListing ? (
            <span role="status" className="text-xs text-gray-400">
              {translator.translateText("Loading…")}
            </span>
          ) : (
            <></>
          )}
        </div>

        {repositories.length === 0 && !isListing ? (
          <p
            data-testid="code-connect-no-repositories"
            className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500"
          >
            {translator.translateText(
              search.trim()
                ? CODE_CONNECT_COPY.noRepositoryMatches
                : CODE_CONNECT_COPY.noRepositories,
            )}
          </p>
        ) : (
          <ul
            data-testid="code-connect-repositories"
            className="max-h-80 divide-y divide-gray-200 overflow-y-auto rounded-lg border border-gray-200"
          >
            {repositories.map(
              (repository: CodeHostListedRepositoryJSON): ReactElement => {
                const isConnectable: boolean = connectable.includes(
                  repository.id,
                );
                const isChecked: boolean =
                  repository.isConnected || selected.includes(repository.id);

                return (
                  <li key={repository.id}>
                    <label
                      data-testid="code-connect-repository"
                      data-repository-id={repository.id}
                      title={
                        !repository.canPush && !repository.isConnected
                          ? translator.translateText(
                              CODE_CONNECT_COPY.cannotPushReason,
                            )
                          : undefined
                      }
                      className={`flex items-start gap-3 px-4 py-3 ${
                        isConnectable
                          ? "cursor-pointer hover:bg-gray-50"
                          : "cursor-default"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                        checked={isChecked}
                        disabled={!isConnectable}
                        onChange={() => {
                          setSelected((current: Array<string>) => {
                            return toggleSelection(current, repository.id);
                          });
                        }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span
                            className={`truncate text-sm font-medium ${
                              isConnectable ? "text-gray-900" : "text-gray-500"
                            }`}
                          >
                            {repository.fullName}
                          </span>
                          {repository.isPrivate ? (
                            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                              {translator.translateText(
                                CODE_CONNECT_COPY.privateBadge,
                              )}
                            </span>
                          ) : (
                            <></>
                          )}
                          {repository.isConnected ? (
                            <span
                              data-testid="code-connect-repository-connected"
                              className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20"
                            >
                              {translator.translateText(
                                CODE_CONNECT_COPY.connectedBadge,
                              )}
                            </span>
                          ) : !repository.canPush ? (
                            <span
                              data-testid="code-connect-repository-cannot-push"
                              className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20"
                            >
                              {translator.translateText(
                                CODE_CONNECT_COPY.cannotPushBadge,
                              )}
                            </span>
                          ) : (
                            <></>
                          )}
                        </span>
                        {repository.description ? (
                          <span className="mt-0.5 block truncate text-xs text-gray-500">
                            {repository.description}
                          </span>
                        ) : (
                          <></>
                        )}
                      </span>
                    </label>
                  </li>
                );
              },
            )}
          </ul>
        )}

        {listing?.hasMore ? (
          <button
            type="button"
            data-testid="code-connect-load-more"
            disabled={isListing}
            onClick={() => {
              if (source) {
                void loadRepositories({
                  source,
                  search: search.trim(),
                  page: page + 1,
                });
              }
            }}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {translator.translateText(CODE_CONNECT_COPY.loadMore)}
          </button>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const renderGitStep: () => ReactElement = (): ReactElement => {
    return (
      <div data-testid="code-connect-git" className="space-y-4">
        <div>
          <FieldLabelElement
            title={CODE_CONNECT_COPY.gitUrlTitle}
            htmlFor="code-connect-git-url"
            required={true}
            description={CODE_CONNECT_COPY.gitUrlHelp}
          />
          <div className="mt-2">
            <Input
              id="code-connect-git-url"
              dataTestId="code-connect-git-url"
              type={InputType.URL}
              value={gitUrl}
              placeholder={CODE_CONNECT_COPY.gitUrlPlaceholder}
              disableSpellCheck={true}
              onChange={(value: string) => {
                setGitUrl(value);
                setConfirmation(null);
              }}
            />
          </div>
        </div>
        <div>
          <FieldLabelElement
            title={CODE_CONNECT_COPY.gitUsernameTitle}
            htmlFor="code-connect-git-username"
            required={false}
            description={CODE_CONNECT_COPY.gitUsernameHelp}
          />
          <div className="mt-2">
            <Input
              id="code-connect-git-username"
              dataTestId="code-connect-git-username"
              value={gitUsername}
              disableSpellCheck={true}
              autoComplete="off"
              onChange={(value: string) => {
                setGitUsername(value);
              }}
            />
          </div>
        </div>
        <div>
          <FieldLabelElement
            title={CODE_CONNECT_COPY.gitPasswordTitle}
            htmlFor="code-connect-git-password"
            required={true}
            description={CODE_CONNECT_COPY.gitPasswordHelp}
          />
          <div className="mt-2">
            <Input
              id="code-connect-git-password"
              dataTestId="code-connect-git-password"
              type={InputType.PASSWORD}
              value={gitPassword}
              disableSpellCheck={true}
              onChange={(value: string) => {
                setGitPassword(value);
              }}
            />
          </div>
        </div>
        {confirmation !== null ? (
          <div
            data-testid="code-connect-git-confirm"
            role="alert"
            className="flex items-start gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <Icon
              icon={IconProp.ExclaimationCircle}
              className="mt-0.5 h-4 w-4 flex-none text-amber-600"
            />
            <p className="leading-6">{confirmation}</p>
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const tokenTitle: string =
    provider && isTokenProvider(provider)
      ? CODE_CONNECT_TOKEN_TITLES[getTokenProviderOf(provider)]
      : CODE_CONNECT_COPY.dialogTitle;

  const titles: Record<CodeConnectStep, string> = {
    [CodeConnectStep.Choose]: CODE_CONNECT_COPY.dialogTitle,
    [CodeConnectStep.Token]: tokenTitle,
    [CodeConnectStep.Pick]: CODE_CONNECT_COPY.pickTitle,
    [CodeConnectStep.Git]: CODE_CONNECT_COPY.gitTitle,
  };

  const descriptions: Record<CodeConnectStep, string | undefined> = {
    [CodeConnectStep.Choose]: CODE_CONNECT_COPY.dialogDescription,
    [CodeConnectStep.Token]: undefined,
    [CodeConnectStep.Pick]: undefined,
    [CodeConnectStep.Git]: CODE_CONNECT_COPY.gitDescription,
  };

  const submit: (() => void) | undefined =
    step === CodeConnectStep.Token
      ? () => {
          void continueWithToken();
        }
      : step === CodeConnectStep.Pick
        ? () => {
            void connectPicked();
          }
        : step === CodeConnectStep.Git
          ? () => {
              void connectGit(confirmation !== null);
            }
          : undefined;

  const submitText: string | undefined =
    step === CodeConnectStep.Token
      ? translator.translateText(CODE_CONNECT_COPY.continueButton)
      : step === CodeConnectStep.Pick
        ? translator.translatePlural(
            CODE_CONNECT_COPY.connectRepositories,
            selected.length,
          )
        : step === CodeConnectStep.Git
          ? translator.translateText(
              confirmation !== null
                ? CODE_CONNECT_COPY.gitConnectAnywayButton
                : CODE_CONNECT_COPY.gitConnectButton,
            )
          : undefined;

  return (
    <Modal
      title={titles[step]}
      description={descriptions[step]}
      modalWidth={ModalWidth.Medium}
      onClose={props.onClose}
      onSubmit={submit}
      submitButtonText={submitText}
      isLoading={isLoading}
      disableSubmitButton={
        (step === CodeConnectStep.Pick && selected.length === 0) ||
        (step === CodeConnectStep.Token && connections === null)
      }
      error={error || undefined}
      secondaryButton={
        step === CodeConnectStep.Choose
          ? undefined
          : {
              title: translator.translateTemplate(CODE_CONNECT_COPY.backButton),
              onClick: goBack,
              dataTestId: "code-connect-back",
            }
      }
      rightElement={
        provider && step !== CodeConnectStep.Choose ? (
          <span
            aria-hidden="true"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-gray-900 text-white"
          >
            <CodeHostMark provider={provider} className="h-4 w-4" />
          </span>
        ) : undefined
      }
    >
      <div data-testid={CODE_CONNECT_DIALOG_TEST_ID} data-step={step}>
        {step === CodeConnectStep.Choose ? (
          <CodeHostChoices gitHub={props.gitHub} onChoose={choose} />
        ) : step === CodeConnectStep.Token ? (
          renderTokenStep()
        ) : step === CodeConnectStep.Pick ? (
          renderPickStep()
        ) : (
          renderGitStep()
        )}
        {step === CodeConnectStep.Git ? (
          <p className="mt-5 text-xs text-gray-500">
            <Link
              to={Route.fromString(CODE_CONNECT_DOCS[CodeRepositoryType.Git])}
              openInNewTab={true}
              className="font-medium text-indigo-600 hover:text-indigo-500"
            >
              {translator.translateText("Read about connecting repositories")}
            </Link>
          </p>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export interface UseCodeConnectDialog {
  // Opens the dialog: at its first step, or at a host's.
  open: (provider?: CodeRepositoryType | undefined) => void;
  // The dialog while it is open, and the notice once repositories connect.
  elements: ReactElement;
}

/*
 * The connect dialog as Code's pages use it: open it, and once repositories
 * connect, a notice saying how many and what to do next - and the page
 * reads its repositories again.
 */
export const useCodeConnectDialog: (data: {
  gitHub: UseGitHubConnect;
  onConnected: () => void;
}) => UseCodeConnectDialog = (data: {
  gitHub: UseGitHubConnect;
  onConnected: () => void;
}): UseCodeConnectDialog => {
  const translator: Translator = useTranslator();
  const [openAt, setOpenAt] = useState<{
    provider?: CodeRepositoryType | undefined;
  } | null>(null);
  const [notice, setNotice] = useState<{
    count: number;
    provider: CodeRepositoryType;
  } | null>(null);

  const elements: ReactElement = (
    <>
      {notice ? (
        <Alert
          type={AlertType.SUCCESS}
          dataTestId="code-connected-notice"
          strongTitle={
            notice.provider === CodeRepositoryType.Git
              ? translator.translateTemplate(
                  CODE_CONNECT_COPY.gitConnectedNoticeTitle,
                )
              : translator.translatePlural(
                  CODE_CONNECT_COPY.connectedNoticeTitle,
                  notice.count,
                )
          }
          title={translator.translateTemplate(
            CODE_CONNECT_COPY.connectedNoticeDescription,
          )}
          onClose={() => {
            setNotice(null);
          }}
        />
      ) : (
        <></>
      )}
      {openAt ? (
        <CodeConnectDialog
          initialProvider={openAt.provider}
          gitHub={data.gitHub}
          onClose={() => {
            setOpenAt(null);
          }}
          onConnected={(result: {
            count: number;
            provider: CodeRepositoryType;
          }) => {
            setOpenAt(null);
            setNotice({ count: result.count, provider: result.provider });
            data.onConnected();
          }}
        />
      ) : (
        <></>
      )}
    </>
  );

  return {
    open: (provider?: CodeRepositoryType | undefined): void => {
      setNotice(null);
      setOpenAt({ provider });
    },
    elements,
  };
};

export default CodeConnectDialog;
