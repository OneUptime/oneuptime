/*
 * The Run Workflow panel's shortcut: start from what the last run started with,
 * rather than filling the panel in. It is the way back to a real delivery - a
 * webhook's payload cannot be typed from memory, and asking the other tool to
 * send it again is what someone testing a workflow is trying to avoid.
 *
 * Says nothing until there is a run to start from, and nothing when reading the
 * runs fails: the panel works without it.
 */

import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import RunAgainButton, { RunAgainCopy } from "./RunAgainButton";
import {
  LastRunToRunAgain,
  LoadLastRunToRunAgainFunction,
  loadLastRunToRunAgain,
} from "./RunAgainSource";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  workflowId: ObjectID;
  // Starts the new run. A rejection is said in the dialog.
  onRunAgain: (runId: string) => Promise<void>;
  // Where the last run comes from; the server unless a test says otherwise.
  loadLastRun?: LoadLastRunToRunAgainFunction | undefined;
}

const RunAgainFromLastRun: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [lastRun, setLastRun] = useState<LastRunToRunAgain | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    const load: LoadLastRunToRunAgainFunction =
      props.loadLastRun || loadLastRunToRunAgain;

    load(props.workflowId)
      .then((run: LastRunToRunAgain | null) => {
        if (isCurrent) {
          setLastRun(run);
        }
      })
      .catch(() => {
        // Not offered: the panel's own form still runs the workflow.
      });

    return () => {
      isCurrent = false;
    };
  }, [props.workflowId.toString()]);

  if (!lastRun) {
    return <></>;
  }

  return (
    <div
      className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5"
      data-testid="run-again-last-run"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900">
          {translator.translateText(RunAgainCopy.lastRunTitle)}
        </p>
        {lastRun.scheduledAt && (
          <p className="mt-0.5 text-xs text-gray-500">
            {translator.translateTemplate(RunAgainCopy.lastRunDescription, {
              date: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                lastRun.scheduledAt,
              ),
            })}
          </p>
        )}
      </div>
      <RunAgainButton
        send={async (): Promise<void> => {
          await props.onRunAgain(lastRun.runId);
        }}
      />
    </div>
  );
};

export default RunAgainFromLastRun;
