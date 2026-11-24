import DataPipeline from "Common/Models/DatabaseModels/DataPipeline";
import Select from "Common/Types/BaseDatabase/Select";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * THE ERROR A PIPELINE'S LATEST RUN REPORTED, READ FROM THE PIPELINE.
 *
 * A table's Lineage says how the latest run of the pipeline behind each
 * edge went, read through the edge's relation (DataPipeline.lastRunState),
 * and when it failed, the error it reported. That error is free text a run
 * writes, which no relation reads - a column read on a relation query skips
 * every permission check, so only a label on a joined row is - and naming
 * it through the edge made the server refuse the Lineage's lists whole
 * (#10238's guard). It is read from the pipeline itself, by the pipeline's
 * own read permissions: only for a run that failed, once a run for every
 * edge of the page.
 */

export const PIPELINE_LAST_ERROR_SELECT: Select<DataPipeline> = {
  _id: true,
  lastErrorMessage: true,
};

// One read of each failed run's error, by its pipeline and when it started.
const lastErrors: Map<string, Promise<string>> = new Map<
  string,
  Promise<string>
>();

/*
 * The error a pipeline's latest run reported: "" when it reported none, or
 * the pipeline cannot be read. `runStartedAt` tells one run from the next,
 * so a pipeline that failed again is read again.
 */
export function readPipelineLastError(
  pipelineId: ObjectID,
  runStartedAt?: Date | string | undefined,
): Promise<string> {
  const key: string = `${pipelineId.toString()}|${String(runStartedAt || "")}`;
  const known: Promise<string> | undefined = lastErrors.get(key);

  if (known) {
    return known;
  }

  const read: Promise<string> = ModelAPI.getItem<DataPipeline>({
    modelType: DataPipeline,
    id: pipelineId,
    select: PIPELINE_LAST_ERROR_SELECT,
  }).then(
    (pipeline: DataPipeline | null): string => {
      return pipeline?.lastErrorMessage || "";
    },
    (): string => {
      // Not readable now: the run's state says it failed; read again later.
      lastErrors.delete(key);
      return "";
    },
  );

  lastErrors.set(key, read);

  return read;
}

// Every error read, forgotten: for tests.
export function forgetPipelineLastErrors(): void {
  lastErrors.clear();
}

export interface ComponentProps {
  pipelineId: ObjectID;
  runStartedAt?: Date | string | undefined;
}

const PipelineLastError: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [message, setMessage] = useState<string>("");
  const pipelineId: string = props.pipelineId.toString();
  const runStartedAt: string = String(props.runStartedAt || "");

  useEffect(() => {
    let isCurrent: boolean = true;

    void readPipelineLastError(props.pipelineId, props.runStartedAt).then(
      (text: string) => {
        if (isCurrent) {
          setMessage(text);
        }
      },
    );

    return () => {
      isCurrent = false;
    };
  }, [pipelineId, runStartedAt]);

  if (!message) {
    return <></>;
  }

  return (
    <span
      className="block max-w-md truncate text-xs text-red-600"
      data-testid="data-pipeline-last-error"
    >
      {message}
    </span>
  );
};

export default PipelineLastError;
