import PageComponentProps from "../PageComponentProps";
import AIPlanGate, {
  isAIAccessibleOnCurrentPlan,
} from "../../Components/AI/AIPlanGate";
import CodeApi, {
  CodeRepositoriesResponse,
  CodeRepositoryListItem,
} from "../../Components/Code/CodeApi";
import CodeAskBox, {
  CODE_COLUMN_CLASS_NAME,
} from "../../Components/Code/CodeAskBox";
import { CodeConnectGitHubFix } from "../../Components/Code/CodeBlockerNotice";
import CodeTaskList, {
  CodeTaskRepositoryHost,
} from "../../Components/Code/CodeTaskList";
import {
  useCodeConnectDialog,
  UseCodeConnectDialog,
} from "../../Components/Code/CodeConnectDialog";
import {
  ConnectGitHubEmptyState,
  useGitHubConnect,
  UseGitHubConnect,
} from "../../Components/Code/GitHubConnect";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * Where each repository is hosted, by id, for the mark beside its name on
 * task rows across repositories.
 */
export const getRepositoryHosts: (
  repositories: Array<CodeRepositoryListItem>,
) => Map<string, CodeTaskRepositoryHost> = (
  repositories: Array<CodeRepositoryListItem>,
): Map<string, CodeTaskRepositoryHost> => {
  return new Map<string, CodeTaskRepositoryHost>(
    repositories.map(
      (
        repository: CodeRepositoryListItem,
      ): [string, CodeTaskRepositoryHost] => {
        return [
          repository.id,
          {
            provider: repository.provider,
            hostProduct: repository.connection?.hostProduct,
          },
        ];
      },
    ),
  );
};

// The repositories' names by id, for task rows across repositories.
export const getRepositoryNames: (
  repositories: Array<CodeRepositoryListItem>,
) => Map<string, string> = (
  repositories: Array<CodeRepositoryListItem>,
): Map<string, string> => {
  return new Map<string, string>(
    repositories.map((repository: CodeRepositoryListItem): [string, string] => {
      return [repository.id, repository.name];
    }),
  );
};

/*
 * What connecting GitHub from the request box does on this page, where
 * GitHub sends the browser back: the install, or why the reader may not.
 * Nothing on a server with no GitHub App - the box links Repositories,
 * which says what the server needs.
 */
export const getConnectGitHubFix: (
  connection: UseGitHubConnect,
) => CodeConnectGitHubFix | undefined = (
  connection: UseGitHubConnect,
): CodeConnectGitHubFix | undefined => {
  if (!connection.isGitHubAppConfigured) {
    return undefined;
  }

  return {
    onConnect: connection.connect,
    lockReason: connection.connectLock.isLocked
      ? connection.connectLock.reason
      : undefined,
  };
};

/*
 * Code's first page, the way coding agents open: the question - "What
 * should AI do?" - over one box to ask it in, with the repository and the
 * branch picked in the box, and every task under it, newest first, across
 * the repositories. The repositories themselves are a page of their own
 * (Repositories), and something to pick here, not what the page is about.
 *
 * With no repository yet, the page is one thing: what Code is for, and
 * Connect GitHub - with GitLab, Forgejo or Gitea and any Git server under
 * it, each opening the connect dialog. GitHub sends the browser back here
 * once it is connected; the others connect in the dialog.
 */
const CodePage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const isPlanAccessible: boolean = isAIAccessibleOnCurrentPlan();

  const [data, setData] = useState<CodeRepositoriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [taskCount, setTaskCount] = useState<number | null>(null);

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

  const connection: UseGitHubConnect = useGitHubConnect({
    onConnected: () => {
      load().catch(() => {
        // handled inside load
      });
    },
  });

  const connectDialog: UseCodeConnectDialog = useCodeConnectDialog({
    gitHub: connection,
    onConnected: () => {
      load().catch(() => {
        // handled inside load
      });
    },
  });

  useEffect(() => {
    if (!isPlanAccessible) {
      setIsLoading(false);
      return;
    }

    load().catch(() => {
      // handled inside load
    });
  }, [load, isPlanAccessible]);

  const repositories: Array<CodeRepositoryListItem> = useMemo(() => {
    return data?.repositories || [];
  }, [data]);

  const repositoryNames: Map<string, string> = useMemo(() => {
    return getRepositoryNames(repositories);
  }, [repositories]);

  const repositoryHosts: Map<string, CodeTaskRepositoryHost> = useMemo(() => {
    return getRepositoryHosts(repositories);
  }, [repositories]);

  /*
   * Every task the reader may read, newest first, under the box. With none
   * yet the box suggests what to ask instead, so no empty list sits beside
   * it.
   */
  const renderTasks: () => ReactElement = (): ReactElement => {
    return (
      <section
        data-testid="code-tasks"
        aria-labelledby="code-tasks-heading"
        className={taskCount === 0 ? "hidden" : "mt-10"}
      >
        <h2
          id="code-tasks-heading"
          className="flex items-baseline gap-2 px-1 text-sm font-semibold text-gray-900"
        >
          {translator.translateText("Tasks")}
          {taskCount ? (
            <span
              data-testid="code-tasks-count"
              className="text-sm font-normal text-gray-500"
            >
              {translator.formatNumber(taskCount)}
            </span>
          ) : (
            <></>
          )}
        </h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <CodeTaskList
            scope={{ allRepositories: true }}
            repositoryNames={repositoryNames}
            repositoryHosts={repositoryHosts}
            onCount={(count: number) => {
              setTaskCount(count);
            }}
            emptyState={<></>}
          />
        </div>
      </section>
    );
  };

  const renderBody: () => ReactElement = (): ReactElement => {
    if (!isPlanAccessible) {
      return <></>;
    }

    if (isLoading && !data) {
      return (
        <div
          data-testid="code-home-loading"
          role="status"
          className={`${CODE_COLUMN_CLASS_NAME} pt-4 sm:pt-10`}
        >
          <span className="sr-only">
            {translator.translateText("Loading…")}
          </span>
          {/* A box and rows in the making, where they will be. */}
          <div
            aria-hidden="true"
            className="mx-auto h-7 w-56 rounded-lg bg-gray-100 motion-safe:animate-pulse"
          />
          <div
            aria-hidden="true"
            className="mt-6 h-40 rounded-2xl border border-gray-200 bg-white shadow-sm"
          />
          <div aria-hidden="true" className="mt-10 space-y-3">
            {[0, 1, 2].map((index: number) => {
              return (
                <div
                  key={index}
                  className="h-12 rounded-lg bg-gray-100 motion-safe:animate-pulse"
                />
              );
            })}
          </div>
        </div>
      );
    }

    if (error && !data) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            load().catch(() => {
              // handled inside load
            });
          }}
        />
      );
    }

    if (!data || data.repositories.length === 0) {
      return (
        <div className={`${CODE_COLUMN_CLASS_NAME} pt-2 sm:pt-6`}>
          <ConnectGitHubEmptyState
            connection={connection}
            onConnectOtherHost={connectDialog.open}
          />
          {/* Tasks that never found a repository stay readable. */}
          {data && data.tasksWithoutRepositoryCount > 0 ? renderTasks() : <></>}
        </div>
      );
    }

    return (
      <div
        data-testid="code-home"
        className={`${CODE_COLUMN_CLASS_NAME} pb-10 pt-2 sm:pt-10`}
      >
        <h1
          data-testid="code-home-heading"
          className="mb-6 text-center text-2xl font-semibold tracking-tight text-gray-900 sm:mb-8 sm:text-3xl"
        >
          {translator.translateText("What should AI do?")}
        </h1>

        <CodeAskBox
          repositories={repositories}
          isLarge={true}
          showExamples={taskCount === 0}
          connectGitHub={getConnectGitHubFix(connection)}
        />

        {renderTasks()}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <AIPlanGate />
      {connection.notices}
      {connectDialog.notice}
      {renderBody()}
      {connectDialog.dialog}
    </div>
  );
};

export default CodePage;
