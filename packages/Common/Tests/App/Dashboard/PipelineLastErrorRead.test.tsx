import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import PipelineLastError, {
  PIPELINE_LAST_ERROR_SELECT,
  forgetPipelineLastErrors,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/PipelineLastError";
import DataPipeline from "../../../Models/DatabaseModels/DataPipeline";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

/*
 * A table's Lineage says why the latest run of an edge's pipeline failed:
 * its error, free text a run writes, which no relation reads (#10238's
 * guard found the Lineage's lists refused whole for it). It is read from
 * the pipeline itself: once a run, however many edges show it.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

const PIPELINE_ID: string = "10238000-0000-4000-8000-000000000a21";
const FIRST_RUN: Date = new Date("2026-11-20T06:00:00.000Z");
const NEXT_RUN: Date = new Date("2026-11-20T07:00:00.000Z");

let getItem: ReturnType<typeof jest.spyOn>;

function answerWith(message: string): void {
  getItem = jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation((async (): Promise<DataPipeline | null> => {
      const pipeline: DataPipeline = new DataPipeline();
      pipeline.lastErrorMessage = message;
      return pipeline;
    }) as never);
}

async function renderErrors(runs: Array<Date>): Promise<void> {
  await act(async () => {
    render(
      <div>
        {runs.map((run: Date, index: number) => {
          return (
            <PipelineLastError
              key={`${index}-${run.toISOString()}`}
              pipelineId={new ObjectID(PIPELINE_ID)}
              runStartedAt={run}
            />
          );
        })}
      </div>,
    );
  });
}

beforeEach(() => {
  forgetPipelineLastErrors();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the error of a pipeline's failed run, on a table's Lineage", () => {
  test("is read from the pipeline itself, once a run however many edges show it", async () => {
    answerWith('relation "orders" does not exist');

    await renderErrors([FIRST_RUN, FIRST_RUN]);

    expect(
      screen.getAllByText('relation "orders" does not exist'),
    ).toHaveLength(2);
    expect(getItem).toHaveBeenCalledTimes(1);

    const read: {
      modelType: unknown;
      id: ObjectID;
      select: unknown;
    } = getItem.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      select: unknown;
    };

    expect(read.modelType).toBe(DataPipeline);
    expect(read.id.toString()).toBe(PIPELINE_ID);
    expect(read.select).toEqual(PIPELINE_LAST_ERROR_SELECT);
  });

  test("a run after it is read again", async () => {
    answerWith("permission denied for table orders");

    await renderErrors([FIRST_RUN, NEXT_RUN]);

    expect(getItem).toHaveBeenCalledTimes(2);
  });

  test("a pipeline that cannot be read shows no error, and is read again next time", async () => {
    getItem = jest
      .spyOn(ModelAPI, "getItem")
      .mockRejectedValue(new Error("Not allowed.") as never);

    await renderErrors([FIRST_RUN]);

    expect(screen.queryByTestId("data-pipeline-last-error")).toBeNull();

    cleanup();
    await renderErrors([FIRST_RUN]);

    expect(getItem).toHaveBeenCalledTimes(2);
  });

  test("a run that reported no error shows none", async () => {
    answerWith("");

    await renderErrors([FIRST_RUN]);

    expect(screen.queryByTestId("data-pipeline-last-error")).toBeNull();
  });
});
