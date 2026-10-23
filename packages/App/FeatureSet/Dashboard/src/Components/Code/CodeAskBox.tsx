import CodeApi, {
  CodeRepositoryListItem,
  CodeRepositoryResponse,
} from "./CodeApi";
import CodeBlockerNotice, { CodeConnectGitHubFix } from "./CodeBlockerNotice";
import CodeBranchPicker from "./CodeBranchPicker";
import CodeComposer from "./CodeComposer";
import { getTaskRoute } from "./CodePaths";
import CodeRepositoryPicker from "./CodeRepositoryPicker";
import {
  CODE_TASK_EXAMPLE_REQUESTS,
  CODE_TASK_START_FOOTER,
  CODE_TASK_START_FOOTER_BRANCH_ONLY,
} from "./CodeTaskCopy";
import { opensPullRequests } from "./CodeHostCopy";
import {
  CodeTaskBlocker,
  CodeTaskBlockerType,
  CodeTaskContextInput,
  CodeTaskRepositoryConnectionJSON,
} from "Common/Types/AI/CodeTask";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  /*
   * Code's first page: every repository a request can go to, picked in the
   * box. A repository's own page passes `repository` instead.
   */
  repositories?: Array<CodeRepositoryListItem> | undefined;
  /*
   * A repository's page: the repository, as the page read it - with whether
   * the reader may ask AI in it, and what stops AI there.
   */
  repository?: CodeRepositoryResponse | undefined;
  // Suggest what to ask under the box: nothing has been asked yet.
  showExamples?: boolean | undefined;
  // Code's first page: a taller box.
  isLarge?: boolean | undefined;
  // What connects GitHub from the box, where a repository is not connected.
  connectGitHub?: CodeConnectGitHubFix | undefined;
  dataTestId?: string | undefined;
}

/*
 * The column Code's pages read at - the request box and the tasks under
 * it - as wide as a conversation, centred in the page.
 */
export const CODE_COLUMN_CLASS_NAME: string = "mx-auto w-full max-w-3xl";

// Where the repository last picked on Code's first page is kept, per project.
export const getRememberedRepositoryKey: (projectId: string) => string = (
  projectId: string,
): string => {
  return `oneuptime.code.repository.${projectId}`;
};

const readRememberedRepositoryId: () => string | null = (): string | null => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return null;
  }

  try {
    const value: unknown = LocalStorage.getItem(
      getRememberedRepositoryKey(projectId.toString()),
    );

    return typeof value === "string" && value ? value : null;
  } catch {
    // Storage this browser refuses (a private window): nothing remembered.
    return null;
  }
};

const rememberRepositoryId: (repositoryId: string) => void = (
  repositoryId: string,
): void => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return;
  }

  try {
    LocalStorage.setItem(
      getRememberedRepositoryKey(projectId.toString()),
      repositoryId,
    );
  } catch {
    // Not kept: the box picks again next time.
  }
};

/*
 * The repository Code's request box starts on: the one picked last time,
 * while it is still there; else the connected repository where something
 * happened most recently (then by name); else the first repository - even
 * one AI cannot reach, so the box can say what connects it.
 */
export const pickStartingRepository: (
  repositories: Array<CodeRepositoryListItem>,
  rememberedId: string | null,
) => string | null = (
  repositories: Array<CodeRepositoryListItem>,
  rememberedId: string | null,
): string | null => {
  if (
    rememberedId &&
    repositories.some((repository: CodeRepositoryListItem): boolean => {
      return repository.id === rememberedId;
    })
  ) {
    return rememberedId;
  }

  const connected: Array<CodeRepositoryListItem> = repositories.filter(
    (repository: CodeRepositoryListItem): boolean => {
      return repository.isConnected;
    },
  );

  const pool: Array<CodeRepositoryListItem> =
    connected.length > 0 ? connected : repositories;

  const activity: (repository: CodeRepositoryListItem) => number = (
    repository: CodeRepositoryListItem,
  ): number => {
    const time: number = repository.stats.lastActivityAt
      ? new Date(repository.stats.lastActivityAt).getTime()
      : 0;

    return Number.isNaN(time) ? 0 : time;
  };

  const sorted: Array<CodeRepositoryListItem> = [...pool].sort(
    (a: CodeRepositoryListItem, b: CodeRepositoryListItem): number => {
      return activity(b) - activity(a) || a.name.localeCompare(b.name);
    },
  );

  return sorted[0]?.id || null;
};

/*
 * Asking OneUptime AI to do something, the way coding agents ask: one box
 * for the request, with the repository and the branch it goes to picked in
 * the box's bottom row (on a repository's page the repository is the
 * page's, and only the branch is picked). Whatever stops AI working in the
 * repository picked - permission, the plan, the AI switch, a repository
 * GitHub does not reach, no LLM provider or credits, a limit, no Runner -
 * is said once at the top of the box with the one thing that fixes it, and
 * the box sends nothing until it is fixed. Under it, what happens when it
 * is sent; with nothing asked yet, requests to try. Sending opens the new
 * task's conversation, where the AI's work shows as it happens.
 */
const CodeAskBox: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const repositories: Array<CodeRepositoryListItem> = props.repositories || [];
  const isPicking: boolean = !props.repository;

  const [pickedId, setPickedId] = useState<string | null>(() => {
    return props.repository
      ? props.repository.repository.id
      : pickStartingRepository(repositories, readRememberedRepositoryId());
  });
  const [branch, setBranch] = useState<string | null>(null);
  const [access, setAccess] = useState<CodeRepositoryResponse | null>(null);
  // The repository whose read failed: the box stops waiting for it.
  const [unreadId, setUnreadId] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<
    { text: string; token: number } | undefined
  >(undefined);

  // What each repository picked answered, so picking it again asks nothing.
  const accessByRepository: React.MutableRefObject<
    Map<string, CodeRepositoryResponse>
  > = useRef<Map<string, CodeRepositoryResponse>>(new Map());

  // A repository list that no longer holds the pick starts over.
  useEffect(() => {
    if (!isPicking) {
      return;
    }

    if (
      !pickedId ||
      !repositories.some((repository: CodeRepositoryListItem): boolean => {
        return repository.id === pickedId;
      })
    ) {
      setPickedId(
        pickStartingRepository(repositories, readRememberedRepositoryId()),
      );
    }
  }, [repositories]);

  /*
   * Whether the reader may ask AI in the repository picked, and what stops
   * AI there - read when it is picked. A failed read stops the waiting
   * rather than hold the box shut with nothing said: the box sends, and the
   * server says what stops a request, as it would anyway.
   */
  useEffect(() => {
    if (!isPicking || !pickedId) {
      return;
    }

    const known: CodeRepositoryResponse | undefined =
      accessByRepository.current.get(pickedId);

    if (known) {
      setAccess(known);
      return;
    }

    setAccess(null);
    setUnreadId(null);
    let isCurrent: boolean = true;

    CodeApi.getRepository(pickedId)
      .then((answer: CodeRepositoryResponse) => {
        accessByRepository.current.set(pickedId, answer);

        if (isCurrent) {
          setAccess(answer);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setUnreadId(pickedId);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [pickedId, isPicking]);

  const pickedListItem: CodeRepositoryListItem | undefined = repositories.find(
    (repository: CodeRepositoryListItem): boolean => {
      return repository.id === pickedId;
    },
  );

  const current: CodeRepositoryResponse | null = props.repository || access;
  const blocker: CodeTaskBlocker | null = current?.blocker || null;
  const canAsk: boolean = current ? current.canAsk : true;
  const isBlocked: boolean = Boolean(blocker) || !canAsk;
  /*
   * The repository is being read: the box takes words, and sends once it is
   * known - or once its read failed.
   */
  const isWaiting: boolean =
    Boolean(pickedId) && !current && unreadId !== pickedId;
  const isConnected: boolean = current
    ? current.repository.isConnected
    : Boolean(pickedListItem?.isConnected);
  const defaultBranch: string =
    current?.repository.mainBranchName || pickedListItem?.mainBranchName || "";
  /*
   * Where the repository picked is hosted: a Git repository gets a branch
   * pushed, not a pull request, and one only a Runner of the project's own
   * reaches has no branches OneUptime reads.
   */
  const provider: string | undefined =
    current?.repository.provider || pickedListItem?.provider;
  const connection: CodeTaskRepositoryConnectionJSON | undefined =
    current?.repository.connection || pickedListItem?.connection;

  const notice: ReactElement | undefined = blocker ? (
    <div
      className={`rounded-t-2xl px-4 py-3 ${
        blocker.type === CodeTaskBlockerType.NoPermission
          ? "bg-gray-50"
          : "bg-amber-50"
      }`}
    >
      <CodeBlockerNotice
        blocker={blocker}
        repositoryId={pickedId || undefined}
        provider={provider}
        isInline={true}
        connectGitHub={props.connectGitHub}
      />
    </div>
  ) : undefined;

  /*
   * A repository's page, for a reader who may only read it: the reason, on
   * its own - there is nothing to pick and nothing to write.
   */
  if (!isPicking && blocker?.type === CodeTaskBlockerType.NoPermission) {
    return (
      <div data-testid={props.dataTestId || "code-ask"}>
        <CodeBlockerNotice blocker={blocker} />
      </div>
    );
  }

  const tools: ReactElement = (
    <>
      {isPicking ? (
        <CodeRepositoryPicker
          repositories={repositories}
          value={pickedId}
          onChange={(repositoryId: string) => {
            if (repositoryId !== pickedId) {
              setPickedId(repositoryId);
              setBranch(null);
              rememberRepositoryId(repositoryId);
            }
          }}
        />
      ) : (
        <></>
      )}
      {pickedId ? (
        <CodeBranchPicker
          repositoryId={pickedId}
          defaultBranch={defaultBranch}
          value={branch}
          onChange={setBranch}
          provider={provider}
          isNotReadByServer={connection?.isReachableFromServer === false}
          isDisabled={isBlocked || isWaiting || !isConnected}
        />
      ) : (
        <></>
      )}
    </>
  );

  const showExamples: boolean = Boolean(props.showExamples) && !isBlocked;

  return (
    <div data-testid={props.dataTestId || "code-ask"}>
      <CodeComposer
        dataTestId="code-ask-composer"
        isLarge={props.isLarge}
        label={translator.translateTemplate("What should AI do?")}
        placeholder={translator.translateTemplate(
          "Describe the change, the bug or your question. Add files, incidents, logs or notes as context.",
        )}
        sendLabel={translator.translateTemplate("Start task")}
        isDisabled={isBlocked || !pickedId}
        isWaiting={isWaiting}
        prefill={prefill}
        notice={notice}
        tools={tools}
        onSend={async (data: {
          message: string;
          context: Array<CodeTaskContextInput>;
        }): Promise<void> => {
          if (!pickedId) {
            return;
          }

          const taskId: string = await CodeApi.createTask({
            repositoryId: pickedId,
            message: data.message,
            context: data.context,
            branch: branch || undefined,
          });

          Navigation.navigate(getTaskRoute(taskId));
        }}
        footer={
          isBlocked ? undefined : (
            <p
              data-testid="code-ask-footer"
              className="text-xs leading-5 text-gray-500"
            >
              {translator.translateTemplate(
                opensPullRequests(provider)
                  ? CODE_TASK_START_FOOTER
                  : CODE_TASK_START_FOOTER_BRANCH_ONLY,
              )}
            </p>
          )
        }
      />

      {showExamples ? (
        <div data-testid="code-examples" className="mt-5">
          <p className="px-1 text-xs font-medium text-gray-500">
            {translator.translateTemplate("Try asking")}
          </p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                  className="flex items-start gap-2.5 rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-left text-sm text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <Icon
                    icon={IconProp.Sparkles}
                    className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-500"
                  />
                  <span className="text-pretty">
                    {translator.translateTemplate(example)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default CodeAskBox;
