import {
  CodeTaskState,
  CodeTaskStepJSON,
  CodeTaskTurnJSON,
  CodeTaskTurnProgressJSON,
} from "Common/Types/AI/CodeTask";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";

/*
 * A TASK'S CONVERSATION KEEPS UP WITH AI AS IT WORKS.
 *
 * Every change of a turn - a step the Runner reports, the turn starting,
 * ending or being stopped - is announced to the pages open on it as it
 * happens (Common/Server/Utils/AI/CodeTask/CodeTaskLive). The conversation
 * hears its task's announcements (every turn's), a turn's Log hears its
 * turn's, and each reads what is new at once: the conversation only the
 * working turn's new steps (/code-task/progress), and the whole task once
 * the turn is done - its reply, its files, its pull request.
 *
 * A page also reads on its own while AI works, for the announcements it
 * does not hear - a role that does not read AI runs, a server whose socket
 * the page is not on, a connection that dropped: every few seconds until
 * one is heard, and seldom while they keep coming.
 *
 * React-free, so the pages and the tests read one rule (the hook is
 * UseCodeTaskLive.ts).
 */

/*
 * The quickest two reads follow each other after announcements: steps come
 * in bursts (a tool call and the note after it), and one read takes them
 * all.
 */
export const CODE_TASK_LIVE_MIN_INTERVAL_MS: number = 300;

// How often a working turn is read when no announcement has been heard.
export const CODE_TASK_POLL_MS: number = 3000;

/*
 * How often while announcements arrive: only a safety net for one that is
 * missed.
 */
export const CODE_TASK_LIVE_POLL_MS: number = 15000;

/*
 * An announcement heard this recently means the page hears them. A long
 * command (a test suite) reports nothing for minutes; past this the page
 * reads on its own again, until the next one is heard.
 */
export const CODE_TASK_LIVE_HEARD_WITHIN_MS: number = 60000;

// How long until a working page reads on its own again.
export const getCodeTaskPollInterval: (data: {
  lastHeardAt: number | null;
  now: number;
  pollMs?: number | undefined;
  livePollMs?: number | undefined;
  heardWithinMs?: number | undefined;
}) => number = (data: {
  lastHeardAt: number | null;
  now: number;
  pollMs?: number | undefined;
  livePollMs?: number | undefined;
  heardWithinMs?: number | undefined;
}): number => {
  const pollMs: number = data.pollMs ?? CODE_TASK_POLL_MS;
  const livePollMs: number = data.livePollMs ?? CODE_TASK_LIVE_POLL_MS;
  const heardWithinMs: number =
    data.heardWithinMs ?? CODE_TASK_LIVE_HEARD_WITHIN_MS;

  if (data.lastHeardAt === null || data.now - data.lastHeardAt < 0) {
    return pollMs;
  }

  return data.now - data.lastHeardAt <= heardWithinMs ? livePollMs : pollMs;
};

/*
 * The turn whose new steps a read brings: the task's latest turn while AI
 * works on it. None for a production review, whose page is its latest
 * review rather than steps: it is read whole.
 */
export const getLiveTurn: (data: {
  recipe: string;
  turns: ReadonlyArray<CodeTaskTurnJSON>;
}) => CodeTaskTurnJSON | null = (data: {
  recipe: string;
  turns: ReadonlyArray<CodeTaskTurnJSON>;
}): CodeTaskTurnJSON | null => {
  if (data.recipe === CodeFixTaskType.GitHubPullRequestProductionReview) {
    return null;
  }

  const latest: CodeTaskTurnJSON | undefined =
    data.turns[data.turns.length - 1];

  return latest && latest.state === CodeTaskState.Working ? latest : null;
};

// The sequence of the last step a turn shows: -1 for none yet.
export const getLastStepSequence: (turn: CodeTaskTurnJSON) => number = (
  turn: CodeTaskTurnJSON,
): number => {
  let last: number = -1;

  for (const step of turn.steps) {
    if (step.sequence > last) {
      last = step.sequence;
    }
  }

  return last;
};

// The most steps a turn keeps, as the server sends at most (MAX_STEPS_PER_TURN).
export const MAX_LIVE_STEPS_PER_TURN: number = 400;

/*
 * What the page shows once a read of its working turn arrives: the turn with
 * its new steps, and how it stands. Unchanged when the read brought nothing
 * new. Null when the page must read the whole task instead: the turn is no
 * longer working (its reply, files and pull request are in the task), more
 * steps arrived than one read sends, or the page moved on to another turn
 * meanwhile.
 */
export const mergeTurnProgress: <
  Response extends {
    task: { recipe: string; isQueued: boolean };
    turns: Array<CodeTaskTurnJSON>;
  },
>(
  data: Response,
  progress: CodeTaskTurnProgressJSON,
) => Response | null = <
  Response extends {
    task: { recipe: string; isQueued: boolean };
    turns: Array<CodeTaskTurnJSON>;
  },
>(
  data: Response,
  progress: CodeTaskTurnProgressJSON,
): Response | null => {
  const turn: CodeTaskTurnJSON | null = getLiveTurn({
    recipe: data.task.recipe,
    turns: data.turns,
  });

  if (
    !turn ||
    turn.runId.toLowerCase() !== progress.runId.toLowerCase() ||
    progress.state !== CodeTaskState.Working ||
    progress.hasMore
  ) {
    return null;
  }

  const lastSequence: number = getLastStepSequence(turn);

  const newSteps: Array<CodeTaskStepJSON> = progress.steps.filter(
    (step: CodeTaskStepJSON): boolean => {
      return step.sequence > lastSequence;
    },
  );

  const isStartedAtNew: boolean =
    Boolean(progress.startedAt) && progress.startedAt !== turn.startedAt;

  const isStatusSame: boolean =
    turn.status === progress.status &&
    data.task.isQueued === progress.isQueued &&
    !isStartedAtNew;

  if (newSteps.length === 0 && isStatusSame) {
    return data;
  }

  const steps: Array<CodeTaskStepJSON> = [...turn.steps, ...newSteps];

  const mergedTurn: CodeTaskTurnJSON = {
    ...turn,
    status: progress.status,
    steps:
      steps.length > MAX_LIVE_STEPS_PER_TURN
        ? steps.slice(steps.length - MAX_LIVE_STEPS_PER_TURN)
        : steps,
    ...(progress.startedAt ? { startedAt: progress.startedAt } : {}),
  };

  return {
    ...data,
    task: { ...data.task, isQueued: progress.isQueued },
    turns: [...data.turns.slice(0, data.turns.length - 1), mergedTurn],
  };
};

/*
 * How much a page has grown since it was last drawn, as a key: a new step,
 * a new turn, a turn's state or reply. The page keeps its latest step in
 * view while the reader is at the end of it (UseFollowLatest).
 */
export const getConversationGrowthKey: (
  turns: ReadonlyArray<CodeTaskTurnJSON>,
) => string = (turns: ReadonlyArray<CodeTaskTurnJSON>): string => {
  const latest: CodeTaskTurnJSON | undefined = turns[turns.length - 1];

  if (!latest) {
    return "";
  }

  return [
    turns.length,
    latest.runId,
    latest.state,
    latest.steps.length,
    getLastStepSequence(latest),
    latest.outcome ? 1 : 0,
  ].join(":");
};
