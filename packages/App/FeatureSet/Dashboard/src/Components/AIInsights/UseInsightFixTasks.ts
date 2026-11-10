import CodeApi from "../Code/CodeApi";
import { CodeTaskSummaryJSON } from "Common/Types/AI/CodeTask";
import CodeTaskStageUtil from "Common/Types/AI/CodeTaskStage";
import API from "Common/UI/Utils/API/API";
import { useCallback, useEffect, useState } from "react";

// How often insights read their fix tasks again while one is still moving.
export const INSIGHT_FIX_TASK_POLL_MS: number = 15000;

export interface InsightFixTasks {
  // The tasks read, by id (lowercase); a task the reader may not read is absent.
  tasks: Map<string, CodeTaskSummaryJSON>;
  // Whether the first read has come back (or failed).
  isLoaded: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/*
 * The fix tasks of the insights a page shows, read together
 * (POST /code-task/summaries): what an insight says of its fix comes from
 * the task's real state, read again while any of them is still moving.
 * Only the tasks the reader may read come back; an insight whose task
 * does not says that it has one, and nothing more.
 */
const useInsightFixTasks: (
  taskIds: Array<string | undefined | null>,
) => InsightFixTasks = (
  taskIds: Array<string | undefined | null>,
): InsightFixTasks => {
  // The ids as one value, so a new array of the same ids reads nothing again.
  const idsKey: string = [
    ...new Set(
      taskIds
        .filter((id: string | undefined | null): id is string => {
          return Boolean(id);
        })
        .map((id: string): string => {
          return id.toLowerCase();
        }),
    ),
  ]
    .sort()
    .join(",");

  const [tasks, setTasks] = useState<Map<string, CodeTaskSummaryJSON>>(
    new Map(),
  );
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const reload: () => Promise<void> = useCallback(async (): Promise<void> => {
    const ids: Array<string> = idsKey ? idsKey.split(",") : [];

    if (ids.length === 0) {
      setTasks(new Map());
      setIsLoaded(true);
      return;
    }

    try {
      const summaries: Array<CodeTaskSummaryJSON> =
        await CodeApi.getTaskSummaries(ids);
      const next: Map<string, CodeTaskSummaryJSON> = new Map();

      for (const summary of summaries) {
        next.set(summary.id.toLowerCase(), summary);
      }

      setTasks(next);
      setError(null);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoaded(true);
  }, [idsKey]);

  useEffect(() => {
    setIsLoaded(false);
    reload().catch(() => {
      // handled inside reload
    });
  }, [reload]);

  const isAnyMoving: boolean = [...tasks.values()].some(
    (task: CodeTaskSummaryJSON): boolean => {
      return CodeTaskStageUtil.isMoving(CodeTaskStageUtil.fromSummary(task));
    },
  );

  useEffect(() => {
    if (!isAnyMoving) {
      return;
    }

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      reload().catch(() => {
        // handled inside reload
      });
    }, INSIGHT_FIX_TASK_POLL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [isAnyMoving, reload]);

  return { tasks, isLoaded, error, reload };
};

export default useInsightFixTasks;
