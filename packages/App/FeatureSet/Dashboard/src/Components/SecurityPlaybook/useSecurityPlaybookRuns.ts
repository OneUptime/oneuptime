import SecurityPlaybookRun from "Common/Models/DatabaseModels/SecurityPlaybookRun";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import ModelEventType from "Common/Types/Realtime/ModelEventType";
import { isFinishedSecurityPlaybookRunStatus } from "Common/Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import Realtime from "Common/UI/Utils/Realtime";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

// How often a page with a run still going looks again: steps take seconds.
export const RUN_POLL_INTERVAL_IN_MS: number = 4000;

export interface UseSecurityPlaybookRunsResult {
  runs: Array<SecurityPlaybookRun>;
  isLoading: boolean;
  error: string;
  refresh: () => void;
}

/*
 * Playbook runs, kept current: read once, again whenever a run is created
 * for the project, and every few seconds while any run shown is still
 * going - the engine moves runs along with hook-free writes, which send no
 * live update of their own.
 */
const useSecurityPlaybookRuns: (data: {
  query: Query<SecurityPlaybookRun>;
  queryKey: string;
  limit: number;
}) => UseSecurityPlaybookRunsResult = (data: {
  query: Query<SecurityPlaybookRun>;
  queryKey: string;
  limit: number;
}): UseSecurityPlaybookRunsResult => {
  const [runs, setRuns] = useState<Array<SecurityPlaybookRun>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const queryRef: MutableRefObject<Query<SecurityPlaybookRun>> = useRef(
    data.query,
  );

  queryRef.current = data.query;

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      const result: ListResult<SecurityPlaybookRun> =
        await ModelAPI.getList<SecurityPlaybookRun>({
          modelType: SecurityPlaybookRun,
          query: queryRef.current,
          select: {
            _id: true,
            securityCaseId: true,
            securityCase: {
              _id: true,
              caseNumberWithPrefix: true,
              title: true,
            },
            playbookName: true,
            trigger: true,
            status: true,
            steps: true,
            stepResults: true,
            currentStepIndex: true,
            startedAt: true,
            completedAt: true,
            errorMessage: true,
            createdAt: true,
            triggeredByUser: {
              name: true,
              email: true,
            },
          },
          sort: { createdAt: SortOrder.Descending },
          skip: 0,
          limit: data.limit,
        });

      setRuns(result.data);
      setError("");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  }, [data.limit]);

  useEffect(() => {
    setIsLoading(true);
    void load();
  }, [data.queryKey, load]);

  // New runs for the project: someone ran one, or a case opened and a playbook started.
  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    const stopListening: () => void =
      Realtime.listenToModelEvent<SecurityPlaybookRun>(
        {
          eventType: ModelEventType.Create,
          modelType: SecurityPlaybookRun,
          tenantId: projectId,
        },
        () => {
          void load();
        },
      );

    return () => {
      stopListening();
    };
  }, [load]);

  const hasRunGoing: boolean = runs.some(
    (run: SecurityPlaybookRun): boolean => {
      return !isFinishedSecurityPlaybookRunStatus(run.status);
    },
  );

  useEffect(() => {
    if (!hasRunGoing) {
      return;
    }

    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      void load();
    }, RUN_POLL_INTERVAL_IN_MS);

    return () => {
      clearInterval(timer);
    };
  }, [hasRunGoing, load]);

  return {
    runs,
    isLoading,
    error,
    refresh: () => {
      void load();
    },
  };
};

export default useSecurityPlaybookRuns;
