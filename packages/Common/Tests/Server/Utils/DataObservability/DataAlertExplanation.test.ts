import { afterEach, describe, expect, jest, test } from "@jest/globals";
import Alert from "../../../../Models/DatabaseModels/Alert";
import DataAlert from "../../../../Models/DatabaseModels/DataAlert";
import DataPipeline from "../../../../Models/DatabaseModels/DataPipeline";
import DataPipelineRun from "../../../../Models/DatabaseModels/DataPipelineRun";
import AlertService from "../../../../Server/Services/AlertService";
import DataAlertService from "../../../../Server/Services/DataAlertService";
import DataPipelineRunService from "../../../../Server/Services/DataPipelineRunService";
import DataPipelineService from "../../../../Server/Services/DataPipelineService";
import DataAlertExplanationReader from "../../../../Server/Utils/DataObservability/DataAlertExplanation";
import { DataAlertCauseKind } from "../../../../Types/DataObservability/DataAlertFeedback";
import ObjectID from "../../../../Types/ObjectID";

/*
 * What a pipeline alert's card says about its cause, read from the runs
 * around it. A run's state decides: a failed one is the cause, with its
 * error, and one that finished is not.
 */

const FAILED_AT: Date = new Date("2026-11-04T08:00:00.000Z");

function runOf(state: string, errorMessage?: string): DataPipelineRun {
  const run: DataPipelineRun = new DataPipelineRun();
  run.state = state;
  run.startedAt = FAILED_AT;

  if (errorMessage) {
    run.errorMessage = errorMessage;
  }

  return run;
}

function stubAlertOfPipeline(runs: Array<DataPipelineRun>): void {
  const row: DataAlert = new DataAlert();
  row.dataPipelineId = ObjectID.generate();

  const alert: Alert = new Alert();
  alert.createdAt = new Date("2026-11-04T09:00:00.000Z");

  const pipeline: DataPipeline = new DataPipeline();
  pipeline.jobName = "nightly_orders";

  jest.spyOn(DataAlertService, "findOneBy").mockResolvedValue(row);
  jest.spyOn(AlertService, "findOneBy").mockResolvedValue(alert);
  jest.spyOn(DataPipelineRunService, "findBy").mockResolvedValue(runs);
  jest.spyOn(DataPipelineService, "findOneById").mockResolvedValue(pipeline);
}

describe("the likely cause of a data alert", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a failed run of the pipeline is the cause, with its error", async () => {
    stubAlertOfPipeline([
      runOf("COMPLETE"),
      runOf("FAIL", "relation \n orders does not exist"),
    ]);

    const explanation: Awaited<
      ReturnType<typeof DataAlertExplanationReader.read>
    > = await DataAlertExplanationReader.read({
      projectId: ObjectID.generate(),
      alertId: ObjectID.generate(),
    });

    expect(explanation?.causes).toEqual([
      {
        kind: DataAlertCauseKind.FailedRun,
        title: "nightly_orders failed",
        detail: "relation orders does not exist",
        at: FAILED_AT.toISOString(),
      },
    ]);
  });

  test("a run that finished is no cause", async () => {
    stubAlertOfPipeline([runOf("COMPLETE")]);

    const explanation: Awaited<
      ReturnType<typeof DataAlertExplanationReader.read>
    > = await DataAlertExplanationReader.read({
      projectId: ObjectID.generate(),
      alertId: ObjectID.generate(),
    });

    expect(explanation?.causes).toEqual([]);
  });

  test("an alert that is not a data alert has no explanation", async () => {
    jest.spyOn(DataAlertService, "findOneBy").mockResolvedValue(null);

    await expect(
      DataAlertExplanationReader.read({
        projectId: ObjectID.generate(),
        alertId: ObjectID.generate(),
      }),
    ).resolves.toBeNull();
  });
});
