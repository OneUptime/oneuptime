import PageComponentProps from "../../PageComponentProps";
import CodeApi, {
  CodeRepositoryResponse,
} from "../../../Components/Code/CodeApi";
import CodeAskBox, {
  CODE_COLUMN_CLASS_NAME,
} from "../../../Components/Code/CodeAskBox";
import { GitBranchMark } from "../../../Components/Code/CodeMarks";
import { getRepositoryFullName } from "../../../Components/Code/CodePaths";
import CodeTaskList from "../../../Components/Code/CodeTaskList";
import CodeHostMark from "../../../Components/Code/CodeHostMark";
import { getRepositoryHostNote } from "../../../Components/Code/CodeHostCopy";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

/*
 * A repository's page in Code: the same request box as Code's first page,
 * on this repository - only its branch is picked - and its tasks, newest
 * first.
 *
 * Whatever stops AI working here (permission, plan, the AI switch, a
 * disconnected repository, no LLM provider or credits, a limit, no Runner)
 * is said once at the top of the box with the link that fixes it, and the
 * box sends nothing until it is fixed. The plan is said there too, once:
 * the page draws no plan banner of its own above it (the server's
 * PlanRequired is the same check). A reader who may only read is told why,
 * with no box, and reads the tasks. A repository with no task yet suggests
 * what to ask. Sending opens the new task's conversation.
 */
const CodeRepositoryTasks: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const repositoryId: string = Navigation.getLastParamAsObjectID().toString();

  const [repository, setRepository] = useState<CodeRepositoryResponse | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [taskCount, setTaskCount] = useState<number | null>(null);

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      setRepository(await CodeApi.getRepository(repositoryId));
      setError(null);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
  }, [repositoryId]);

  useEffect(() => {
    load().catch(() => {
      // handled inside load
    });
  }, [load]);

  if (error && !repository) {
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

  if (!repository) {
    return <PageLoader isVisible={true} />;
  }

  const fullName: string = getRepositoryFullName(repository.repository);
  // A self-hosted server, named beside the repository: "git.example.com".
  const hostNote: string = getRepositoryHostNote(repository.repository);
  const hasNoTasks: boolean = (taskCount ?? repository.stats.taskCount) === 0;
  /*
   * A repository with no task yet, for someone who may ask: the request box
   * and its examples are the one thing to do, so no empty list beside them.
   * Someone who may only read is told where tasks will show up.
   */
  const showTaskList: boolean = !(repository.canAsk && hasNoTasks);

  return (
    <div className={`${CODE_COLUMN_CLASS_NAME} space-y-8 pb-10`}>
      <div className="space-y-4">
        <div
          data-testid="code-repository-header"
          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500"
        >
          {fullName ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span className="inline-flex flex-shrink-0 text-gray-700">
                <CodeHostMark
                  provider={repository.repository.provider}
                  hostProduct={repository.repository.connection?.hostProduct}
                  className="h-4 w-4"
                />
              </span>
              {repository.repository.repositoryUrl ? (
                <Link
                  to={URL.fromString(repository.repository.repositoryUrl)}
                  openInNewTab={true}
                  className="truncate font-medium text-gray-700 hover:text-indigo-600 hover:underline"
                >
                  <>{fullName}</>
                </Link>
              ) : (
                <span className="truncate font-medium text-gray-700">
                  {fullName}
                </span>
              )}
            </span>
          ) : (
            <></>
          )}
          {hostNote ? (
            <span
              data-testid="code-repository-host"
              className="truncate text-xs text-gray-500"
            >
              {hostNote}
            </span>
          ) : (
            <></>
          )}
          {repository.repository.mainBranchName ? (
            <span className="inline-flex items-center gap-1">
              <GitBranchMark className="h-3.5 w-3.5 text-gray-400" />
              <span className="font-mono text-xs">
                {repository.repository.mainBranchName}
              </span>
            </span>
          ) : (
            <></>
          )}
        </div>
        {repository.repository.description ? (
          <p
            data-testid="code-repository-description"
            className="text-sm leading-6 text-gray-600"
          >
            {repository.repository.description}
          </p>
        ) : (
          <></>
        )}

        <CodeAskBox repository={repository} showExamples={hasNoTasks} />
      </div>

      {showTaskList ? (
        <section data-testid="code-tasks" aria-labelledby="code-tasks-heading">
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
              scope={{ repositoryId: new ObjectID(repositoryId).toString() }}
              repositoryHost={{
                provider: repository.repository.provider,
                hostProduct: repository.repository.connection?.hostProduct,
              }}
              onCount={(count: number) => {
                setTaskCount(count);
              }}
              emptyState={
                <div
                  data-testid="code-tasks-empty"
                  className="px-6 py-10 text-center"
                >
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50">
                    <Icon
                      icon={IconProp.Sparkles}
                      className="h-5 w-5 text-indigo-500"
                    />
                  </div>
                  <p className="mt-3 text-sm font-medium text-gray-900">
                    {translator.translateText("No tasks yet")}
                  </p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
                    {repository.canAsk
                      ? translator.translateText(
                          "Ask AI something above. Each request becomes a task here that you can follow and reply to.",
                        )
                      : translator.translateText(
                          "When someone asks AI to work in this repository, the task shows up here.",
                        )}
                  </p>
                </div>
              }
            />
          </div>
        </section>
      ) : (
        <></>
      )}
    </div>
  );
};

export default CodeRepositoryTasks;
