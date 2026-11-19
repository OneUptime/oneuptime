import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import FixProductionVerdict from "../../../Components/AI/FixProductionVerdict";
import PageComponentProps from "../../PageComponentProps";
import CodeApi, { CodeTaskResponse } from "../../../Components/Code/CodeApi";
import { CODE_COLUMN_CLASS_NAME } from "../../../Components/Code/CodeAskBox";
import CodeBlockerNotice from "../../../Components/Code/CodeBlockerNotice";
import CodeComposer from "../../../Components/Code/CodeComposer";
import CodeDiffStat from "../../../Components/Code/CodeDiffStat";
import CodeProductionReviewTask from "../../../Components/Code/CodeProductionReviewTask";
import { GitBranchMark } from "../../../Components/Code/CodeMarks";
import {
  getRepositoryFullName,
  getRepositoryRoute,
  getRepositorySettingsRoute,
} from "../../../Components/Code/CodePaths";
import { CodeRepositorySetting } from "../../../Components/Code/CodeRepositorySettingsCopy";
import {
  CODE_TASK_START_FOOTER_BRANCH_ONLY,
  getRecipeLabel,
} from "../../../Components/Code/CodeTaskCopy";
import CodeTaskDetails, {
  getTaskBaseBranch,
} from "../../../Components/Code/CodeTaskDetails";
import CodeTaskStateBadge from "../../../Components/Code/CodeTaskStateBadge";
import CodeTaskRetryNote from "../../../Components/Code/CodeTaskRetryNote";
import CodeTaskWorkTime from "../../../Components/Code/CodeTaskWorkTime";
import { getCodeTaskTrail } from "../../../Components/Code/CodeTaskTrail";
import CodeTaskTurn, {
  CodeTaskTurnHost,
} from "../../../Components/Code/CodeTaskTurn";
import CodeTaskTurnsNotShown from "../../../Components/Code/CodeTaskTurnsNotShown";
import CodeTaskJumpToNewest from "../../../Components/Code/CodeTaskJumpToNewest";
import {
  CodeTaskConversationEntry,
  CodeTaskNumberedTurnJSON,
  getConversationEntries,
  getKeptEarlierTurns,
  keepEarlierTurns,
  keepTurnsNoLongerSent,
  mergeNumberedTurns,
  numberEarlierTurns,
  numberSentTurns,
} from "../../../Components/Code/CodeTaskEarlierTurns";
import CodeHostMark from "../../../Components/Code/CodeHostMark";
import {
  getConversationGrowthKey,
  getLastStepSequence,
  getLiveTurn,
  mergeTurnProgress,
} from "../../../Components/Code/CodeTaskLive";
import useCodeTaskLive from "../../../Components/Code/UseCodeTaskLive";
import useFollowLatest, {
  FollowLatest,
  goToPageEnd,
} from "../../../Components/Code/UseFollowLatest";
import {
  CodePullRequestCopy,
  getPullRequestCopy,
  opensPullRequests,
} from "../../../Components/Code/CodeHostCopy";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import CodeFixTaskType, {
  CodeFixTaskTypeHelper,
} from "Common/Types/AI/CodeFixTaskType";
import {
  CodeTaskBlockerType,
  CodeTaskContextInput,
  CodeTaskEarlierTurnsJSON,
  CodeTaskState,
  CodeTaskTurnJSON,
  CodeTaskTurnProgressJSON,
} from "Common/Types/AI/CodeTask";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/Types/Link";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import LinkComponent from "Common/UI/Components/Link/Link";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import { usePageBreadcrumbLinks } from "Common/UI/Components/Page/Page";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";

export { getTaskBaseBranch };

/*
 * The page on a wide screen: the conversation at the width a person reads
 * at, and the task's Details beside it, as an issue tracker lays out an
 * issue. Narrower, the conversation alone, its facts in the header.
 */
export const CODE_TASK_PAGE_CLASS_NAME: string =
  "mx-auto w-full max-w-3xl xl:grid xl:max-w-none xl:grid-cols-[minmax(0,48rem)_18rem] xl:items-start xl:justify-center xl:gap-10";

// The header's line of facts, which Details says on a wide screen instead.
export const CODE_TASK_HEADER_FACTS_CLASS_NAME: string =
  "mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-500 xl:hidden";

/*
 * The box that stays at the bottom of the window as the conversation
 * scrolls, on the page's own ground (the theme's canvas, light or dark), so
 * the turns pass under it rather than show through it.
 */
export const STICKY_FOOTER_STYLE: React.CSSProperties = {
  backgroundColor: "var(--ou-background-primary)",
};

const STICKY_FADE_STYLE: React.CSSProperties = {
  background:
    "linear-gradient(to top, var(--ou-background-primary), transparent)",
};

// The same turns at the same places: nothing to draw again.
const isSameTurns: (
  left: ReadonlyArray<CodeTaskNumberedTurnJSON>,
  right: ReadonlyArray<CodeTaskNumberedTurnJSON>,
) => boolean = (
  left: ReadonlyArray<CodeTaskNumberedTurnJSON>,
  right: ReadonlyArray<CodeTaskNumberedTurnJSON>,
): boolean => {
  return (
    left.length === right.length &&
    left.every((entry: CodeTaskNumberedTurnJSON, index: number): boolean => {
      return (
        entry.number === right[index]!.number &&
        entry.turn.runId === right[index]!.turn.runId
      );
    })
  );
};

/*
 * A task's page in Code: its conversation, as Claude Code or Codex show
 * one. At the top, what it is and how it stands - working, waiting for you,
 * done, failed or stopped - where it works (its repository and branch), how
 * much it changed, and its pull request one click away. Then the
 * conversation: each request as the person's message, and AI's side of it -
 * the steps it takes as it takes them, its reply, the files it changed and
 * their diff, the pull request. At the bottom, held at the bottom of the
 * window, the box to reply: an answer, more context, or the next change -
 * each one a new turn of the same task, on the same branch and pull
 * request. On a wide screen the task's Details sit beside it: who started
 * it and from what, where it works, its pull request, what it changed and
 * when (CodeTaskDetails).
 *
 * While AI works the box waits (with Stop beside it), and each step shows as
 * AI takes it: the server announces every change of the task's turns, and
 * the page reads the working turn's new steps at once - the whole task once
 * the turn is done (CodeTaskLive). A reader at the end of the page keeps
 * the newest step in view. A person who may only read the repository
 * reads, and is told why they cannot reply.
 */
const CodeTaskConversation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const taskId: string = Navigation.getLastParamAsObjectID().toString();

  const [data, setData] = useState<CodeTaskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState<boolean>(false);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const [isAskingAgain, setIsAskingAgain] = useState<boolean>(false);
  /*
   * A reply was just sent: the page goes to its end, where the reply is
   * drawn, once the task is read again with it.
   */
  const isGoingToEndRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  // Cancels the second look at the end (goToPageEnd), if the page goes first.
  const cancelGoingToEndRef: React.MutableRefObject<(() => void) | null> =
    useRef<(() => void) | null>(null);
  // The conversation's turns: its last item is the latest turn's reply.
  const turnsRef: React.MutableRefObject<HTMLOListElement | null> =
    useRef<HTMLOListElement | null>(null);
  /*
   * The same list, once drawn: what the page follows late layout in
   * (useFollowLatest) and watches for Jump to newest.
   */
  const [turnsElement, setTurnsElement] = useState<HTMLOListElement | null>(
    null,
  );
  /*
   * The list's ref, one function for the page's life: a new one each
   * drawing is called again on every drawing - with nothing, then the list
   * - and setting the list to nothing and back drew the conversation twice
   * more after each read, so a step that had just arrived no longer rose
   * into place.
   */
  const setTurnsList: (element: HTMLOListElement | null) => void = useCallback(
    (element: HTMLOListElement | null): void => {
      turnsRef.current = element;
      setTurnsElement(element);
    },
    [],
  );
  // The reply box held at the bottom of the window.
  const footerRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);

  /*
   * The earlier turns of a long task the reader asked for (Show earlier
   * turns, #7128), at their places - kept for the task while the
   * Dashboard is open, so coming back to it keeps them.
   */
  const [earlier, setEarlier] = useState<Array<CodeTaskNumberedTurnJSON>>(
    () => {
      return getKeptEarlierTurns(taskId);
    },
  );
  // The line whose earlier turns are being read: the turn after it.
  const [showingBefore, setShowingBefore] = useState<string | null>(null);
  // Why the last read of them failed, and under which line.
  const [earlierError, setEarlierError] = useState<{
    beforeRunId: string;
    message: string;
  } | null>(null);
  /*
   * The line pressed, and the first turn of the page it read: when the
   * line went away with the page, the focus goes to that turn, rather than
   * to nowhere.
   */
  const focusTurnRef: React.MutableRefObject<{
    line: string;
    runId: string;
  } | null> = useRef<{ line: string; runId: string } | null>(null);
  // The turns the page was sent, at their places, as last read.
  const sentRef: React.MutableRefObject<Array<CodeTaskNumberedTurnJSON>> =
    useRef<Array<CodeTaskNumberedTurnJSON>>([]);

  // The task as shown, for a read that merges into it.
  const dataRef: React.MutableRefObject<CodeTaskResponse | null> =
    useRef<CodeTaskResponse | null>(null);
  dataRef.current = data;

  /*
   * Each read is numbered as it starts: an answer that arrives after a
   * later read started is not the page's any more (that read's is).
   */
  const readRef: React.MutableRefObject<number> = useRef<number>(0);

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    const read: number = ++readRef.current;

    try {
      const response: CodeTaskResponse = await CodeApi.getTask(taskId);

      if (read !== readRef.current) {
        return;
      }

      setData(response);
      setError(null);
    } catch (err) {
      if (read !== readRef.current) {
        return;
      }

      setError(API.getFriendlyMessage(err));
    }
  }, [taskId]);

  useEffect(() => {
    load().catch(() => {
      // handled inside load
    });
  }, [load]);

  /*
   * A read that no longer sends a turn the page showed - a task that grew
   * by a turn leaves its oldest shown out - keeps it with the earlier
   * turns, at its place: nothing the reader sees goes away under them.
   * Worked out as the read is drawn (React's state adjusted in render), so
   * no frame is drawn without it.
   */
  const sentNow: Array<CodeTaskNumberedTurnJSON> = data
    ? numberSentTurns(data.turns, data.turnsNotShown?.count || 0)
    : [];
  const [sentBefore, setSentBefore] = useState<Array<CodeTaskNumberedTurnJSON>>(
    [],
  );

  if (data && !isSameTurns(sentBefore, sentNow)) {
    const kept: Array<CodeTaskNumberedTurnJSON> = keepTurnsNoLongerSent({
      earlier,
      sentBefore,
      sentNow,
    });

    setSentBefore(sentNow);

    if (!isSameTurns(earlier, kept)) {
      setEarlier(kept);
    }
  }

  sentRef.current = sentNow;

  // Kept for the task, for the page's next visit and its Log's turn picker.
  useEffect(() => {
    keepEarlierTurns(taskId, earlier);
  }, [taskId, earlier]);

  /*
   * Show earlier turns: the turns just before `beforeRunId`, drawn where
   * the line is - between the first turn and the rest. Nothing the reader
   * sees moves: the line pressed stays where it is, the turns drawn under
   * it, and the line says how many are left (or goes, with the focus on
   * the first turn drawn).
   */
  const showEarlierTurns: (
    beforeRunId: string,
    line: string,
  ) => Promise<void> = async (
    beforeRunId: string,
    line: string,
  ): Promise<void> => {
    // One read at a time: a second press while one is on its way waits.
    if (showingBefore) {
      return;
    }

    setShowingBefore(beforeRunId);
    setEarlierError(null);

    try {
      const page: CodeTaskEarlierTurnsJSON = await CodeApi.getEarlierTurns({
        taskId,
        before: beforeRunId,
      });

      const added: Array<CodeTaskNumberedTurnJSON> = numberEarlierTurns(page);
      const windowStart: number = sentRef.current[1]?.number ?? Infinity;

      setEarlier((current: Array<CodeTaskNumberedTurnJSON>) => {
        return mergeNumberedTurns(current, added).filter(
          (entry: CodeTaskNumberedTurnJSON): boolean => {
            return entry.number > 1 && entry.number < windowStart;
          },
        );
      });

      // Where the focus goes, should the line pressed go with this page.
      focusTurnRef.current = added[0]
        ? { line, runId: added[0].turn.runId }
        : null;
    } catch (err) {
      setEarlierError({
        beforeRunId,
        message: API.getFriendlyMessage(err),
      });
    }

    setShowingBefore(null);
  };

  /*
   * The line pressed went with the last page: the focus goes to the first
   * turn it drew, which takes the line's place.
   */
  useLayoutEffect(() => {
    const pressed: { line: string; runId: string } | null =
      focusTurnRef.current;

    if (!pressed || !turnsRef.current) {
      return;
    }

    focusTurnRef.current = null;

    // The line is still there, with fewer to say: its button keeps the focus.
    if (turnsRef.current.querySelector(`[data-line="${pressed.line}"]`)) {
      return;
    }

    const first: HTMLElement | null = turnsRef.current.querySelector(
      `[data-turn-id="${pressed.runId}"]`,
    );

    first?.focus({ preventScroll: true });
  }, [earlier]);

  /*
   * What changed since the page last read: the working turn's new steps,
   * or - once it is done, or on a turn the page does not show yet - the
   * whole task again.
   */
  const refreshLive: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const current: CodeTaskResponse | null = dataRef.current;
      const turn: CodeTaskTurnJSON | null = current
        ? getLiveTurn({ recipe: current.task.recipe, turns: current.turns })
        : null;

      if (!current || !turn) {
        await load();
        return;
      }

      const read: number = ++readRef.current;
      let progress: CodeTaskTurnProgressJSON;

      try {
        progress = await CodeApi.getTurnProgress({
          taskId,
          runId: turn.runId,
          afterSequence: getLastStepSequence(turn),
        });
      } catch {
        // Kept as it is: the next announcement, or read, tries again.
        return;
      }

      if (read !== readRef.current || !dataRef.current) {
        return;
      }

      const merged: CodeTaskResponse | null = mergeTurnProgress(
        dataRef.current,
        progress,
      );

      if (!merged) {
        await load();
        return;
      }

      if (merged !== dataRef.current) {
        setData(merged);
      }
    }, [taskId, load]);

  const isWorking: boolean = data?.task.state === CodeTaskState.Working;

  useCodeTaskLive({
    projectId: ProjectUtil.getCurrentProjectId(),
    /*
     * Every turn of the task is announced in the task's own room - the
     * task's id as read, which an old link to one of its replies leads to.
     */
    recordId: data?.task.id || taskId,
    isWorking,
    refresh: refreshLive,
  });

  /*
   * The reply just sent, drawn at the end of the conversation: the page
   * goes there before it is painted, from wherever the reader sent it - a
   * long task's first turn is as near the reply box as its newest - and
   * again on the next frame, once what lays out a moment later is in.
   * Before useFollowLatest, which then finds the reader at the end,
   * watching AI take up the reply.
   */
  // What follows the reader (useFollowLatest, below), for the effect above it.
  const followRef: React.MutableRefObject<FollowLatest | null> =
    useRef<FollowLatest | null>(null);

  useLayoutEffect(() => {
    if (!data || !isGoingToEndRef.current) {
      return;
    }

    isGoingToEndRef.current = false;
    cancelGoingToEndRef.current?.();
    cancelGoingToEndRef.current = goToPageEnd();
    // Followed from the end, as a reader who came there.
    followRef.current?.followFromHere();
  }, [data]);

  useEffect(() => {
    return (): void => {
      cancelGoingToEndRef.current?.();
    };
  }, []);

  const follow: FollowLatest = useFollowLatest({
    growthKey: data ? getConversationGrowthKey(data.turns) : "",
    isLive: isWorking,
    // A reply that ends the turn is read from its first line.
    getLatestStart: (): Element | null => {
      return turnsRef.current?.lastElementChild || null;
    },
    // A reply's Markdown that lays out later is followed too (#7644).
    container: turnsElement,
  });

  followRef.current = follow;

  /*
   * Jump to newest (#7129): the page to the newest turn, and followed from
   * there; the focus on its reply, where the reader reads on.
   */
  const jumpToNewest: () => void = (): void => {
    cancelGoingToEndRef.current?.();
    cancelGoingToEndRef.current = follow.jumpToNewest();

    const newest: Element | null | undefined =
      turnsRef.current?.lastElementChild;

    if (newest instanceof HTMLElement) {
      newest.focus({ preventScroll: true });
    }
  };

  // Code > the repository > Task #42, once the task's repository is known.
  const breadcrumbs: Array<Link> | null = useMemo(() => {
    if (!data) {
      return null;
    }

    return getCodeTaskTrail({
      taskId: taskId,
      response: data,
      translator: translator,
    });
  }, [
    data?.repository?.id,
    data?.repository?.name,
    data?.task.taskNumber,
    translator.language,
  ]);

  usePageBreadcrumbLinks(breadcrumbs);

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

  if (!data) {
    return <PageSkeleton />;
  }

  /*
   * A pull request's production review is not a conversation: its page is
   * the latest review, with Review again where the reply box would be.
   */
  if (data.task.recipe === CodeFixTaskType.GitHubPullRequestProductionReview) {
    const reviewAgain: () => Promise<void> = async (): Promise<void> => {
      setIsAskingAgain(true);
      setActionError(null);

      try {
        await CodeApi.reviewAgain(taskId);
        await load();
      } catch (err) {
        setActionError(API.getFriendlyMessage(err));
      }

      setIsAskingAgain(false);
    };

    return (
      <div className={CODE_COLUMN_CLASS_NAME}>
        <CodeProductionReviewTask
          data={data}
          isAskingAgain={isAskingAgain}
          actionError={actionError}
          onReviewAgain={() => {
            void reviewAgain();
          }}
          footerStyle={STICKY_FOOTER_STYLE}
          fadeStyle={STICKY_FADE_STYLE}
        />
      </div>
    );
  }

  const turns: Array<CodeTaskTurnJSON> = data.turns;
  const latestTurn: CodeTaskTurnJSON | undefined = turns[turns.length - 1];
  // The task's pull request: open, or merged or closed since.
  const pullRequest: CodeTaskTurnJSON["pullRequests"][number] | undefined =
    data.task.pullRequest;
  const isPullRequestOpen: boolean = pullRequest?.state === "open";
  const title: string =
    data.task.title ||
    translator.translateTemplate(getRecipeLabel(data.task.recipe));
  const baseBranch: string = getTaskBaseBranch(data);
  /*
   * Where the task's repository is hosted: its marks, how its pull request
   * is named (a merge request, "!12", on GitLab), and - for a Git
   * repository, where AI pushes a branch and opens none - where a change
   * goes.
   */
  const repositoryHost: CodeTaskTurnHost = {
    provider: data.repository?.provider,
    hostProduct: data.repository?.connection?.hostProduct,
  };
  const pullRequestCopy: CodePullRequestCopy = getPullRequestCopy(
    repositoryHost.provider,
  );

  /*
   * Why the failed or stopped latest turn - a fix OneUptime started - is
   * not asked again (it may already have written), for a reader who could
   * otherwise ask it: said where Try again would be (#6509).
   */
  const tryAgainRefusal: string | undefined =
    data.canAsk && !data.blocker && data.tryAgainRefusal
      ? data.tryAgainRefusal
      : undefined;

  /*
   * A failed or stopped latest turn is asked again: a request in its own
   * words, and a fix OneUptime started with its own context - not a task
   * asked for on GitHub, and not one that may already have written.
   */
  const canRetry: boolean = Boolean(
    data.canAsk &&
      !data.blocker &&
      latestTurn &&
      CodeFixTaskTypeHelper.canBeAskedAgain(latestTurn.recipe) &&
      !tryAgainRefusal &&
      (latestTurn.state === CodeTaskState.Failed ||
        latestTurn.state === CodeTaskState.Stopped),
  );

  /*
   * A latest turn AI tries again by itself, waiting for its next attempt:
   * whoever may ask in the repository may start it now.
   */
  const canRetryNow: boolean = Boolean(
    data.canAsk &&
      !data.blocker &&
      latestTurn &&
      latestTurn.state === CodeTaskState.Working &&
      latestTurn.retry?.nextAttemptAt,
  );

  const stop: () => Promise<void> = async (): Promise<void> => {
    setIsStopping(true);
    setActionError(null);

    try {
      await CodeApi.stop(taskId);
      await load();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    setIsStopping(false);
  };

  const retry: () => Promise<void> = async (): Promise<void> => {
    setIsRetrying(true);
    setActionError(null);

    try {
      await CodeApi.retry(taskId);
      await load();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    setIsRetrying(false);
  };

  const renderFooter: () => ReactElement = (): ReactElement => {
    if (!data.repository) {
      return (
        <p
          data-testid="code-task-no-repository"
          className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600"
        >
          {translator.translateText(
            "This task is not linked to a repository, so AI cannot continue it. Start a new task from a repository.",
          )}
        </p>
      );
    }

    if (data.blocker?.type === CodeTaskBlockerType.NoPermission) {
      return <CodeBlockerNotice blocker={data.blocker} />;
    }

    if (isWorking) {
      return (
        <div
          data-testid="code-task-working-footer"
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm"
        >
          {/* The turn above already shows AI at work; this says what it means for the reader. */}
          <p className="min-w-0 flex-1 text-sm text-gray-600">
            {translator.translateText(
              "AI is working on this. You can reply when it finishes.",
            )}
          </p>
          {data.canAsk ? (
            <button
              type="button"
              data-testid="code-task-stop"
              disabled={isStopping}
              onClick={() => {
                void stop();
              }}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 ${getHandDrawnButtonStateClassName(
                {
                  isBusy: isStopping,
                  hoverClassName: "hover:bg-gray-50",
                },
              )}`}
            >
              <span className="h-2.5 w-2.5 rounded-[2px] bg-current" />
              {isStopping
                ? translator.translateText("Stopping…")
                : translator.translateText("Stop")}
            </button>
          ) : (
            <></>
          )}
        </div>
      );
    }

    return (
      <CodeComposer
        dataTestId="code-task-composer"
        label={translator.translateTemplate("Reply to OneUptime AI")}
        placeholder={
          data.task.state === CodeTaskState.WaitingForYou
            ? translator.translateTemplate(
                "Answer the question, add context, or ask for changes…",
              )
            : translator.translateTemplate(
                "Ask for changes, add context, or ask a question…",
              )
        }
        sendLabel={translator.translateTemplate("Send")}
        isDisabled={!data.canAsk || Boolean(data.blocker)}
        autoFocus={data.task.state === CodeTaskState.WaitingForYou}
        notice={
          data.blocker ? (
            <div className="rounded-t-2xl bg-amber-50 px-4 py-3">
              <CodeBlockerNotice
                blocker={data.blocker}
                repositoryId={data.repository?.id}
                provider={repositoryHost.provider}
                isInline={true}
              />
            </div>
          ) : undefined
        }
        onSend={async (reply: {
          message: string;
          context: Array<CodeTaskContextInput>;
        }): Promise<void> => {
          await CodeApi.reply({
            taskId: taskId,
            message: reply.message,
            context: reply.context,
          });
          isGoingToEndRef.current = true;
          await load();
        }}
        footer={
          /*
           * Where a change goes: the open pull request, or - none open,
           * or it was merged or closed - a new branch and pull request; in
           * a Git repository, a new branch the person opens one from.
           */
          <p
            data-testid="code-task-composer-footer"
            className="text-xs leading-5 text-gray-500"
          >
            {isPullRequestOpen
              ? translator.translateTemplate(pullRequestCopy.replyFooter, {
                  number: pullRequest?.number?.toString() || "",
                })
              : translator.translateText(
                  opensPullRequests(repositoryHost.provider)
                    ? pullRequestCopy.startFooter
                    : CODE_TASK_START_FOOTER_BRANCH_ONLY,
                )}
          </p>
        }
      />
    );
  };

  // One turn of the conversation: its own turns and its earlier ones alike.
  const renderTurn: (data: {
    turn: CodeTaskTurnJSON;
    isFirst: boolean;
    isLatest: boolean;
  }) => ReactElement = (entry: {
    turn: CodeTaskTurnJSON;
    isFirst: boolean;
    isLatest: boolean;
  }): ReactElement => {
    return (
      <CodeTaskTurn
        key={entry.turn.runId}
        turn={entry.turn}
        isLatest={entry.isLatest}
        origin={entry.isFirst ? data.task.origin : undefined}
        repositorySettingsRoute={
          /*
           * A slow queue points at the repository's Runner: its settings
           * open there, with More settings open.
           */
          data.repository
            ? getRepositorySettingsRoute(
                data.repository.id,
                CodeRepositorySetting.Runner,
              )
            : undefined
        }
        onRetry={
          entry.isLatest && canRetry
            ? () => {
                void retry();
              }
            : undefined
        }
        onRetryNow={
          entry.isLatest && canRetryNow
            ? () => {
                void retry();
              }
            : undefined
        }
        tryAgainRefusal={entry.isLatest ? tryAgainRefusal : undefined}
        isRetrying={isRetrying}
        repositoryHost={repositoryHost}
        logRoute={new Route(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.CODE_TASK_VIEW_LOG] as Route,
            { modelId: new ObjectID(taskId) },
          ).toString(),
        ).addQueryParams({ turn: entry.turn.runId })}
      />
    );
  };

  /*
   * The conversation, in the task's order: its first turn; a line wherever
   * turns are not shown, with Show earlier turns; the earlier turns the
   * reader asked for (#7128) - drawn where a screen reader is not told each
   * of them as it arrives, as it is a new step - then the newest.
   */
  const renderConversation: () => Array<ReactElement> =
    (): Array<ReactElement> => {
      const entries: Array<CodeTaskConversationEntry> = getConversationEntries({
        turns,
        turnsNotShown: data.turnsNotShown?.count || 0,
        earlier,
      });
      const items: Array<ReactElement> = [];
      let earlierRun: Array<ReactElement> = [];
      let lines: number = 0;

      const closeEarlierRun: () => void = (): void => {
        if (earlierRun.length === 0) {
          return;
        }

        items.push(
          <li
            key={`earlier-${items.length}`}
            data-testid="code-task-earlier-turns"
          >
            <ol aria-live="off" className="space-y-6">
              {earlierRun}
            </ol>
          </li>,
        );
        earlierRun = [];
      };

      for (const entry of entries) {
        if (entry.kind === "notShown") {
          closeEarlierRun();

          const line: string = `line-${lines++}`;

          items.push(
            <CodeTaskTurnsNotShown
              key={line}
              line={line}
              count={entry.count}
              onShow={() => {
                void showEarlierTurns(entry.beforeRunId, line);
              }}
              isShowing={showingBefore === entry.beforeRunId}
              error={
                earlierError?.beforeRunId === entry.beforeRunId
                  ? earlierError.message
                  : null
              }
            />,
          );
          continue;
        }

        const element: ReactElement = renderTurn({
          turn: entry.turn,
          isFirst: entry.number === 1,
          isLatest: entry.isSent && entry.turn === latestTurn,
        });

        if (entry.isSent) {
          closeEarlierRun();
          items.push(element);
        } else {
          earlierRun.push(element);
        }
      }

      closeEarlierRun();

      return items;
    };

  return (
    <div className={CODE_TASK_PAGE_CLASS_NAME}>
      <div data-testid="code-task-main" className="min-w-0">
        <header
          data-testid="code-task-header"
          className="border-b border-gray-200 pb-5"
        >
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
            <div className="min-w-0 flex-1 basis-80">
              <div className="flex flex-wrap items-center gap-2">
                <CodeTaskStateBadge
                  state={data.task.state}
                  isQueued={data.task.isQueued}
                  isRetrying={Boolean(
                    data.task.isQueued &&
                      latestTurn?.state === CodeTaskState.Working &&
                      latestTurn.retry?.nextAttemptAt,
                  )}
                />
                {/* AI tries the latest turn again by itself: which attempt. */}
                {latestTurn?.state === CodeTaskState.Working &&
                latestTurn.retry ? (
                  <CodeTaskRetryNote
                    retry={latestTurn.retry}
                    isCompact={true}
                    className="text-sm"
                    dataTestId="code-task-header-retry"
                  />
                ) : (
                  <></>
                )}
                {data.task.taskNumber ? (
                  <span className="text-sm text-gray-500">
                    #{data.task.taskNumber}
                  </span>
                ) : (
                  <></>
                )}
                {data.task.recipe !== CodeFixTaskType.CodeRequest ? (
                  <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
                    {translator.translateText(getRecipeLabel(data.task.recipe))}
                  </span>
                ) : (
                  <></>
                )}
              </div>
              <h1
                data-testid="code-task-title"
                className="mt-2 break-words text-xl font-semibold leading-7 text-gray-900"
              >
                {/* Words someone wrote, read the way they are written. */}
                <IsolatedText text={title} />
              </h1>
            </div>

            {pullRequest?.url ? (
              <LinkComponent
                to={URL.fromString(pullRequest.url)}
                openInNewTab={true}
                dataTestId="code-task-pull-request"
                className="inline-flex h-9 flex-shrink-0 items-center gap-2 rounded-lg bg-white px-3 text-sm font-medium text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <>
                  <span className="inline-flex flex-shrink-0">
                    <CodeHostMark
                      provider={repositoryHost.provider}
                      hostProduct={repositoryHost.hostProduct}
                      className="h-4 w-4"
                    />
                  </span>
                  {translator.translateTemplate(pullRequestCopy.title, {
                    number: pullRequest.number?.toString() || "",
                  })}
                  <Icon
                    icon={IconProp.ExternalLink}
                    className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                  />
                </>
              </LinkComponent>
            ) : (
              <></>
            )}
          </div>

          {/*
           * Where the task works and what it changed: its repository, the
           * branch it works from, its lines added and removed, and - once its
           * pull request is merged or closed - that, with what production
           * showed. Open is the usual state, so it is not said.
           */}
          <div
            data-testid="code-task-facts"
            className={CODE_TASK_HEADER_FACTS_CLASS_NAME}
          >
            {data.repository ? (
              <LinkComponent
                to={getRepositoryRoute(data.repository.id)}
                dataTestId="code-task-repository"
                className="inline-flex min-w-0 items-center gap-1.5 hover:text-indigo-600"
              >
                <>
                  <span className="inline-flex flex-shrink-0">
                    <CodeHostMark
                      provider={repositoryHost.provider}
                      hostProduct={repositoryHost.hostProduct}
                      className="h-4 w-4"
                    />
                  </span>
                  <span className="truncate">
                    {getRepositoryFullName(data.repository) ||
                      data.repository.name}
                  </span>
                </>
              </LinkComponent>
            ) : (
              <></>
            )}
            {data.repository && baseBranch ? (
              <span
                data-testid="code-task-branch"
                className="inline-flex min-w-0 items-center gap-1"
              >
                <GitBranchMark className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                <span className="truncate font-mono text-xs">{baseBranch}</span>
              </span>
            ) : (
              <></>
            )}
            {data.task.changes ? (
              <span
                data-testid="code-task-files-changed"
                className="inline-flex items-center gap-2 whitespace-nowrap"
              >
                {translator.translatePlural(
                  {
                    one: "{{count}} file changed",
                    other: "{{count}} files changed",
                  },
                  data.task.changes.files,
                )}
                <CodeDiffStat
                  changes={data.task.changes}
                  dataTestId="code-task-changes-stat"
                />
              </span>
            ) : (
              <></>
            )}
            {/* How long AI has worked on it, over all its turns - shown or not. */}
            <CodeTaskWorkTime
              turns={turns}
              notShownMilliseconds={data.turnsNotShown?.workMilliseconds}
              hasClock={true}
            />
            {pullRequest &&
            (pullRequest.state === "merged" ||
              pullRequest.state === "closed") ? (
              <span
                data-testid="code-task-pull-request-state"
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  pullRequest.state === "merged"
                    ? "bg-violet-50 text-violet-700"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {pullRequest.state === "merged"
                  ? translator.translateText("Merged")
                  : translator.translateText("Closed")}
              </span>
            ) : (
              <></>
            )}
            {/* What production showed once it shipped; the turn says why. */}
            {pullRequest?.production ? (
              <FixProductionVerdict
                production={pullRequest.production}
                isCompact={true}
                testId="code-task-pull-request-production"
              />
            ) : (
              <></>
            )}
          </div>
        </header>

        {actionError ? (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700"
          >
            <ErrorInSentence message={actionError} showWhereToLook={true} />
          </p>
        ) : (
          <></>
        )}

        {/*
        A log, as Ask AI's conversation is: a screen reader says each step
        as it arrives, and the reply when the turn ends - what a reader who
        sees the page watches come in.
      */}
        <ol
          ref={setTurnsList}
          data-testid="code-task-turns"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label={translator.translateText("Conversation")}
          className="mt-6 space-y-6"
        >
          {renderConversation()}
        </ol>

        {/*
         * The reply box, held at the bottom of the window as the
         * conversation scrolls - its ground is the page's, faded above it.
         */}
        <div
          ref={footerRef}
          data-testid="code-task-footer"
          className="sticky bottom-0 z-10 mt-8 pb-4"
          style={STICKY_FOOTER_STYLE}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 -top-6 h-6"
            style={STICKY_FADE_STYLE}
          />
          {/* While the newest turn is out of view: a way there (#7129). */}
          <CodeTaskJumpToNewest
            getNewest={(): Element | null => {
              return turnsRef.current?.lastElementChild || null;
            }}
            getFooter={(): Element | null => {
              return footerRef.current;
            }}
            container={turnsElement}
            onJump={jumpToNewest}
          />
          {renderFooter()}
        </div>
      </div>
      <CodeTaskDetails data={data} />
    </div>
  );
};

export default CodeTaskConversation;
