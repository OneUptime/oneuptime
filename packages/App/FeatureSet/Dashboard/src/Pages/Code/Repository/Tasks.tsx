import PageComponentProps from "../../PageComponentProps";
import AIPlanGate from "../../../Components/AI/AIPlanGate";
import CodeApi, {
  CodeRepositoryResponse,
} from "../../../Components/Code/CodeApi";
import CodeBlockerNotice from "../../../Components/Code/CodeBlockerNotice";
import CodeComposer from "../../../Components/Code/CodeComposer";
import { CODE_TASK_EXAMPLE_REQUESTS } from "../../../Components/Code/CodeTaskCopy";
import CodeTaskList, {
  getTaskRoute,
} from "../../../Components/Code/CodeTaskList";
import { GitHubMark } from "../../../Components/Code/GitHubConnect";
import { getRepositoryFullName } from "../../../Components/Code/RepositoryCard";
import { CodeTaskContextInput } from "Common/Types/AI/CodeTask";
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
 * A repository's page in Code: ask OneUptime AI to do something in it, and
 * its tasks, newest first.
 *
 * The request box comes first - it is what the page is for. Whatever stops
 * AI working here (permission, plan, the AI switch, a disconnected
 * repository, no LLM provider or credits, a limit, no Runner) is said right
 * above it with the link that fixes it, and the box sends nothing until it
 * is fixed. A repository with no task yet suggests what to ask. Sending
 * opens the new task's conversation, where the AI's work shows as it
 * happens.
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
  const [prefill, setPrefill] = useState<
    { text: string; token: number } | undefined
  >(undefined);

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
  const canSend: boolean = repository.canAsk && !repository.blocker;
  const showExamples: boolean = canSend && taskCount === 0;

  return (
    <div className="space-y-5">
      <AIPlanGate />

      <div
        data-testid="code-repository-header"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500"
      >
        {fullName ? (
          <span className="inline-flex items-center gap-1.5">
            <GitHubMark className="h-4 w-4 text-gray-700" />
            {repository.repository.repositoryUrl ? (
              <Link
                to={URL.fromString(repository.repository.repositoryUrl)}
                openInNewTab={true}
                className="font-medium text-gray-700 hover:text-indigo-600 hover:underline"
              >
                <>{fullName}</>
              </Link>
            ) : (
              <span className="font-medium text-gray-700">{fullName}</span>
            )}
          </span>
        ) : (
          <></>
        )}
        {repository.repository.mainBranchName ? (
          <span className="inline-flex items-center gap-1">
            <Icon icon={IconProp.Code} className="h-3.5 w-3.5" />
            <span className="font-mono text-xs">
              {repository.repository.mainBranchName}
            </span>
          </span>
        ) : (
          <></>
        )}
        {repository.repository.description ? (
          <span className="min-w-0 truncate">
            {repository.repository.description}
          </span>
        ) : (
          <></>
        )}
      </div>

      <section
        data-testid="code-ask"
        aria-labelledby="code-ask-heading"
        className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5"
      >
        <h2
          id="code-ask-heading"
          className="mb-3 text-base font-semibold text-gray-900"
        >
          {translator.translateText("Ask AI to do something")}
        </h2>

        {repository.blocker ? (
          <div className="mb-3">
            <CodeBlockerNotice blocker={repository.blocker} />
          </div>
        ) : (
          <></>
        )}

        {repository.canAsk ? (
          <CodeComposer
            dataTestId="code-repository-composer"
            label={translator.translateTemplate("What should AI do?")}
            placeholder={translator.translateTemplate(
              "Describe the change, the bug or your question. Add files, incidents, logs or notes as context.",
            )}
            sendLabel={translator.translateTemplate("Start task")}
            isDisabled={!canSend}
            prefill={prefill}
            onSend={async (data: {
              message: string;
              context: Array<CodeTaskContextInput>;
            }): Promise<void> => {
              const taskId: string = await CodeApi.createTask({
                repositoryId: repositoryId,
                message: data.message,
                context: data.context,
              });

              Navigation.navigate(getTaskRoute(taskId));
            }}
            footer={
              <p className="text-xs leading-5 text-gray-500">
                {translator.translateText(
                  "AI works on a new branch and opens a pull request for you to review when it changes code. Nothing is merged on its own.",
                )}
              </p>
            }
          />
        ) : (
          <></>
        )}

        {showExamples ? (
          <div data-testid="code-examples" className="mt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
              {translator.translateText("Try asking")}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {CODE_TASK_EXAMPLE_REQUESTS.map((example: string) => {
                return (
                  <button
                    key={example}
                    type="button"
                    data-testid="code-example"
                    onClick={() => {
                      setPrefill({
                        text: translator.translateTemplate(example),
                        token: Date.now(),
                      });
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-left text-xs font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <Icon
                      icon={IconProp.Sparkles}
                      className="h-3.5 w-3.5 flex-shrink-0 text-indigo-400"
                    />
                    {translator.translateText(example)}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <></>
        )}
      </section>

      <section
        aria-labelledby="code-tasks-heading"
        className="rounded-xl border border-gray-200 bg-white shadow-sm"
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3.5 sm:px-5">
          <h2
            id="code-tasks-heading"
            className="text-base font-semibold text-gray-900"
          >
            {translator.translateText("Tasks")}
            {taskCount ? (
              <span className="ml-2 text-sm font-normal text-gray-500">
                {taskCount}
              </span>
            ) : (
              <></>
            )}
          </h2>
        </div>
        <CodeTaskList
          repositoryId={new ObjectID(repositoryId).toString()}
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
      </section>
    </div>
  );
};

export default CodeRepositoryTasks;
