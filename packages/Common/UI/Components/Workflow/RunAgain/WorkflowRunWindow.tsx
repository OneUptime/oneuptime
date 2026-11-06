/*
 * A run opened from a run list, with Run again beside its status. Pressing it
 * starts the new run and the window follows that one, as the Builder's does: the
 * person is trying something, and how it went is what they want to see next.
 */

import ObjectID from "../../../../Types/ObjectID";
import useRunWatch, {
  UseRunWatchResult,
  WatchedRunDetail,
} from "../UseRunWatch";
import WorkflowLogModal from "../WorkflowLogModal";
import { WorkflowRunExport } from "../WorkflowRunExport";
import RunAgainButton, { RunAgainCopy } from "./RunAgainButton";
import { fetchLatestWorkflowRun, sendRunAgain } from "./RunAgainSource";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface OpenWorkflowRun {
  run: WorkflowRunExport;
  // Run again was just pressed on the run's row: open on the new run.
  isNewRun?: boolean | undefined;
}

export interface ComponentProps {
  openRun: OpenWorkflowRun;
  onClose: () => void;
  // A new run started from here, for the page to show it in its list.
  onRunStarted?: (() => void) | undefined;
}

const WorkflowRunWindow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const opened: WorkflowRunExport = props.openRun.run;
  const [isFollowing, setIsFollowing] = useState<boolean>(
    Boolean(props.openRun.isNewRun),
  );

  const runWatch: UseRunWatchResult = useRunWatch({
    fetchLatestRun: async (): Promise<WatchedRunDetail | null> => {
      return opened.workflowId
        ? await fetchLatestWorkflowRun(new ObjectID(opened.workflowId))
        : null;
    },
  });

  /*
   * The row's request has already been answered, and the new run's row was
   * written before it was, so the newest run is the new one.
   */
  useEffect(() => {
    if (props.openRun.isNewRun) {
      runWatch.startWatchingRun();
    }
  }, []);

  const watched: WatchedRunDetail | null = runWatch.run;

  const shown: WorkflowRunExport = !isFollowing
    ? opened
    : {
        runId: watched?.runId,
        workflowId: opened.workflowId,
        workflowName: opened.workflowName,
        status: watched?.status,
        scheduledAt: watched?.scheduledAt,
        startedAt: watched?.startedAt,
        completedAt: watched?.completedAt,
        isTestRun: watched?.isTestRun,
        startedBy: watched?.startedBy,
        canRunAgain: watched?.canRunAgain,
        logs: runWatch.logs,
        stepTrace: runWatch.stepTrace,
      };

  const shownRunId: string | null | undefined = shown.runId;

  const canRunAgain: boolean =
    Boolean(shownRunId) && shown.canRunAgain === true && !runWatch.isWatching;

  return (
    <WorkflowLogModal
      title="Workflow Run"
      description={isFollowing ? RunAgainCopy.newRunDescription : undefined}
      logs={shown.logs}
      stepTrace={shown.stepTrace}
      run={shown}
      statusMessage={isFollowing ? runWatch.message : undefined}
      isStatusMessageError={isFollowing && runWatch.hasFailed}
      isRunning={isFollowing && runWatch.isWatching}
      toolbar={
        canRunAgain ? (
          <RunAgainButton
            send={async (): Promise<void> => {
              await runWatch.captureRunBeforeTrigger();
              await sendRunAgain(shownRunId as string);
              setIsFollowing(true);
              runWatch.startWatchingRun();
              props.onRunStarted?.();
            }}
          />
        ) : undefined
      }
      onClose={props.onClose}
    />
  );
};

export default WorkflowRunWindow;
