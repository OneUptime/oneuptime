import {
  CodeTaskEarlierTurnsJSON,
  CodeTaskTurnJSON,
} from "Common/Types/AI/CodeTask";

/*
 * A LONG TASK'S TURNS, WITH THEIR PLACES: THE ONES ITS PAGE SHOWS, AND THE
 * EARLIER ONES THE READER ASKED FOR (Show earlier turns, #7128).
 *
 * A task's page is sent its first turn and its newest 199 (a conversation
 * reads at most 200), and how many turns between them it does not show.
 * Under the first turn, where the page says how many are not shown, Show
 * earlier turns reads the 50 just before the oldest turn the page has
 * (POST /code-task/turns/:taskId) and draws them there, between the first
 * turn and the rest; the line stays with a smaller count until none is
 * left. So the page holds turns by their places in the task: the first
 * (1), the ones it was sent - the oldest of them at 2 plus however many
 * are not shown - and the earlier ones it read, numbered as the server
 * numbered them. A line marks each gap between two turns it holds, and
 * reads the turns just before the turn after it.
 *
 * The earlier turns are kept for the task while the Dashboard is open, so
 * coming back to the task - from a turn's Log - keeps what was shown, and
 * the Log page's turn picker lists them at their places too
 * (CodeTaskLogTurns). A turn a re-read no longer sends - a task that grew
 * by a turn leaves its oldest shown out - is kept with them, so nothing
 * the reader sees goes away under them.
 *
 * React-free, so the pages and the tests read one rule.
 */

// A turn at its place in the task: the first turn is 1.
export interface CodeTaskNumberedTurnJSON {
  number: number;
  turn: CodeTaskTurnJSON;
}

/*
 * One item of a conversation, in the task's order: a turn - one the page
 * was sent (`isSent`), or an earlier one the reader asked for - or a line
 * where turns between two it holds are not shown, with the turn after it,
 * whose earlier turns Show earlier turns reads.
 */
export type CodeTaskConversationEntry =
  | {
      kind: "turn";
      number: number;
      turn: CodeTaskTurnJSON;
      isSent: boolean;
    }
  | { kind: "notShown"; count: number; beforeRunId: string };

// The most tasks whose earlier turns are kept at once: the newest ones.
export const MAX_TASKS_WITH_EARLIER_TURNS_KEPT: number = 20;

const kept: Map<string, Array<CodeTaskNumberedTurnJSON>> = new Map<
  string,
  Array<CodeTaskNumberedTurnJSON>
>();

const taskKey: (taskId: string) => string = (taskId: string): string => {
  return (taskId || "").toLowerCase();
};

// The earlier turns kept for a task: none until the reader asked for some.
export function getKeptEarlierTurns(
  taskId: string,
): Array<CodeTaskNumberedTurnJSON> {
  return kept.get(taskKey(taskId)) || [];
}

// Keeps a task's earlier turns, the newest tasks first, so few are kept.
export function keepEarlierTurns(
  taskId: string,
  turns: Array<CodeTaskNumberedTurnJSON>,
): void {
  const key: string = taskKey(taskId);

  kept.delete(key);

  if (turns.length === 0) {
    return;
  }

  kept.set(key, turns);

  while (kept.size > MAX_TASKS_WITH_EARLIER_TURNS_KEPT) {
    const oldest: string | undefined = kept.keys().next().value;

    if (oldest === undefined) {
      break;
    }

    kept.delete(oldest);
  }
}

// Forgets every task's earlier turns: for tests.
export function forgetEarlierTurns(): void {
  kept.clear();
}

/*
 * The turns a task's page was sent, at their places: the first is 1, and
 * the newest follow the ones not shown - the oldest of them at 2 plus how
 * many are not shown.
 */
export function numberSentTurns(
  turns: ReadonlyArray<CodeTaskTurnJSON>,
  turnsNotShown: number = 0,
): Array<CodeTaskNumberedTurnJSON> {
  const skipped: number =
    Number.isInteger(turnsNotShown) && turnsNotShown > 0 ? turnsNotShown : 0;

  return turns.map(
    (turn: CodeTaskTurnJSON, index: number): CodeTaskNumberedTurnJSON => {
      return { number: index === 0 ? 1 : index + 1 + skipped, turn };
    },
  );
}

// A page of earlier turns, at their places.
export function numberEarlierTurns(
  earlier: CodeTaskEarlierTurnsJSON,
): Array<CodeTaskNumberedTurnJSON> {
  return earlier.turns.map(
    (turn: CodeTaskTurnJSON, index: number): CodeTaskNumberedTurnJSON => {
      return { number: earlier.firstNumber + index, turn };
    },
  );
}

/*
 * Turns put together, each once - by its place and by its run - in the
 * task's order. A turn listed earlier keeps its place: the turns a page
 * was sent are read last, and win.
 */
export function mergeNumberedTurns(
  ...lists: Array<ReadonlyArray<CodeTaskNumberedTurnJSON>>
): Array<CodeTaskNumberedTurnJSON> {
  const byNumber: Map<number, CodeTaskNumberedTurnJSON> = new Map<
    number,
    CodeTaskNumberedTurnJSON
  >();
  const numberOfRun: Map<string, number> = new Map<string, number>();

  for (const list of lists) {
    for (const entry of list) {
      if (!Number.isInteger(entry.number) || entry.number < 1) {
        continue;
      }

      const runKey: string = entry.turn.runId.toLowerCase();
      const placedAt: number | undefined = numberOfRun.get(runKey);

      // The same turn at another place: the newer reading of it is kept.
      if (placedAt !== undefined) {
        byNumber.delete(placedAt);
      }

      // Another turn at this place: it gives way.
      const displaced: CodeTaskNumberedTurnJSON | undefined = byNumber.get(
        entry.number,
      );

      if (displaced) {
        numberOfRun.delete(displaced.turn.runId.toLowerCase());
      }

      byNumber.set(entry.number, entry);
      numberOfRun.set(runKey, entry.number);
    }
  }

  return [...byNumber.values()].sort(
    (left: CodeTaskNumberedTurnJSON, right: CodeTaskNumberedTurnJSON) => {
      return left.number - right.number;
    },
  );
}

/*
 * The earlier turns a page keeps after a read of the task: the ones it
 * kept, and those of the turns it was sent before that the read no longer
 * sends - a task that grew by a turn leaves its oldest shown out, and it
 * stays where the reader saw it. None of the turns the read sends, and
 * never the first.
 */
export function keepTurnsNoLongerSent(data: {
  earlier: ReadonlyArray<CodeTaskNumberedTurnJSON>;
  sentBefore: ReadonlyArray<CodeTaskNumberedTurnJSON>;
  sentNow: ReadonlyArray<CodeTaskNumberedTurnJSON>;
}): Array<CodeTaskNumberedTurnJSON> {
  const sentNow: Set<string> = new Set<string>(
    data.sentNow.map((entry: CodeTaskNumberedTurnJSON): string => {
      return entry.turn.runId.toLowerCase();
    }),
  );
  const firstNow: number =
    data.sentNow.length > 1 ? data.sentNow[1]!.number : Infinity;

  const noLongerSent: Array<CodeTaskNumberedTurnJSON> = data.sentBefore.filter(
    (entry: CodeTaskNumberedTurnJSON): boolean => {
      return (
        entry.number > 1 &&
        entry.number < firstNow &&
        !sentNow.has(entry.turn.runId.toLowerCase())
      );
    },
  );

  return mergeNumberedTurns(
    data.earlier.filter((entry: CodeTaskNumberedTurnJSON): boolean => {
      return entry.number > 1 && !sentNow.has(entry.turn.runId.toLowerCase());
    }),
    noLongerSent,
  );
}

/*
 * A conversation's items, in the task's order: its first turn; then each
 * turn it holds, earlier ones and sent ones, with a line before any that
 * does not follow the turn before it - how many are not shown there, and
 * the turn whose earlier turns are read to show them.
 */
export function getConversationEntries(data: {
  turns: ReadonlyArray<CodeTaskTurnJSON>;
  turnsNotShown?: number | undefined;
  earlier?: ReadonlyArray<CodeTaskNumberedTurnJSON> | undefined;
}): Array<CodeTaskConversationEntry> {
  const sent: Array<CodeTaskNumberedTurnJSON> = numberSentTurns(
    data.turns,
    data.turnsNotShown || 0,
  );
  const sentRuns: Set<string> = new Set<string>(
    sent.map((entry: CodeTaskNumberedTurnJSON): string => {
      return entry.turn.runId.toLowerCase();
    }),
  );

  const all: Array<CodeTaskNumberedTurnJSON> = mergeNumberedTurns(
    (data.earlier || []).filter((entry: CodeTaskNumberedTurnJSON): boolean => {
      return entry.number > 1;
    }),
    sent,
  );

  const entries: Array<CodeTaskConversationEntry> = [];

  all.forEach((entry: CodeTaskNumberedTurnJSON, index: number): void => {
    const before: CodeTaskNumberedTurnJSON | undefined = all[index - 1];
    const notShown: number = before ? entry.number - before.number - 1 : 0;

    if (notShown > 0) {
      entries.push({
        kind: "notShown",
        count: notShown,
        beforeRunId: entry.turn.runId,
      });
    }

    entries.push({
      kind: "turn",
      number: entry.number,
      turn: entry.turn,
      isSent: sentRuns.has(entry.turn.runId.toLowerCase()),
    });
  });

  return entries;
}
