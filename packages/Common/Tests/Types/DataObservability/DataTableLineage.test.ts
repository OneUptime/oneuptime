import { describe, expect, test } from "@jest/globals";
import {
  DATA_LINEAGE_DEPTH_CHOICES,
  DEFAULT_DATA_LINEAGE_DEPTH,
  DEFAULT_DATA_PIPELINE_LINEAGE_DEPTH,
  DataLineageEdgeKind,
  MAX_DATA_LINEAGE_DEPTH,
  getLineageDashboardNodeId,
  getLineageEdgeId,
  getLineagePipelineNodeId,
  getLineageTableNodeId,
  isFailedLineageRunState,
  isLineagePipelineNodeId,
  isRunningLineageRunState,
  readDataLineageDepth,
} from "../../../Types/DataObservability/DataTableLineage";
import { MAX_CAUSE_DEPTH } from "../../../Server/Utils/DataObservability/DataAlertCause";

/*
 * What a table's lineage request and drawing agree on
 * (Types/DataObservability/DataTableLineage): the steps a request may ask
 * for, how cards and arrows are named, and which pipeline runs count as
 * failed or running.
 */

describe("readDataLineageDepth", () => {
  test.each([
    [1, 1],
    [3, 3],
    [5, 5],
    ["2", 2],
    [" 4 ", 4],
    [2.9, 2],
  ])("reads %p as %p steps", (value: unknown, steps: number) => {
    expect(readDataLineageDepth(value)).toBe(steps);
  });

  test.each([[0], [-2], ["0"]])("holds %p to one step", (value: unknown) => {
    expect(readDataLineageDepth(value)).toBe(1);
  });

  test.each([[6], [500], ["99"]])("holds %p to the most", (value: unknown) => {
    expect(readDataLineageDepth(value)).toBe(MAX_DATA_LINEAGE_DEPTH);
  });

  test.each([
    [undefined],
    [null],
    [""],
    ["lots"],
    [NaN],
    [Infinity],
    [{}],
    [[3]],
    [true],
  ])("reads %p as the default", (value: unknown) => {
    expect(readDataLineageDepth(value)).toBe(DEFAULT_DATA_LINEAGE_DEPTH);
  });

  test("the default and every choice the Lineage tab offers are within the most", () => {
    expect(DATA_LINEAGE_DEPTH_CHOICES).toContain(DEFAULT_DATA_LINEAGE_DEPTH);

    for (const choice of DATA_LINEAGE_DEPTH_CHOICES) {
      expect(readDataLineageDepth(choice)).toBe(choice);
    }
  });

  test("the most steps are the steps a data alert's cause is looked for at", () => {
    expect(MAX_DATA_LINEAGE_DEPTH).toBe(MAX_CAUSE_DEPTH);
  });

  test.each([[undefined], ["lots"], [null], [NaN]])(
    "a pipeline's request reading %p: the pipeline's default, one step",
    (value: unknown) => {
      expect(
        readDataLineageDepth(value, DEFAULT_DATA_PIPELINE_LINEAGE_DEPTH),
      ).toBe(1);
    },
  );

  test("a pipeline's request for steps reads them as a table's does", () => {
    for (const [value, steps] of [
      [2, 2],
      ["4", 4],
      [0, 1],
      [99, MAX_DATA_LINEAGE_DEPTH],
    ] as Array<[unknown, number]>) {
      expect(
        readDataLineageDepth(value, DEFAULT_DATA_PIPELINE_LINEAGE_DEPTH),
      ).toBe(steps);
    }
  });

  test("a pipeline's default is a choice its page offers, within the most", () => {
    expect(DATA_LINEAGE_DEPTH_CHOICES).toContain(
      DEFAULT_DATA_PIPELINE_LINEAGE_DEPTH,
    );
    expect(DEFAULT_DATA_PIPELINE_LINEAGE_DEPTH).toBeLessThan(
      DEFAULT_DATA_LINEAGE_DEPTH,
    );
  });
});

describe("whose card a drawing is about", () => {
  test("a pipeline's card is known by its name", () => {
    expect(isLineagePipelineNodeId(getLineagePipelineNodeId("p1"))).toBe(true);
    expect(isLineagePipelineNodeId(getLineageTableNodeId("p1"))).toBe(false);
    expect(isLineagePipelineNodeId(getLineageDashboardNodeId("p1"))).toBe(
      false,
    );
    // A table whose id reads like a pipeline's card is still a table's.
    expect(isLineagePipelineNodeId(getLineageTableNodeId("pipeline:x"))).toBe(
      false,
    );
  });
});

describe("names of cards and arrows", () => {
  test("each kind of card has a name of its own, so a table and a pipeline with one id never meet", () => {
    const id: string = "11111111-1111-4111-8111-111111111111";

    expect(getLineageTableNodeId(id)).toBe(`table:${id}`);
    expect(getLineagePipelineNodeId(id)).toBe(`pipeline:${id}`);
    expect(getLineageDashboardNodeId(id)).toBe(`dashboard:${id}`);
    expect(
      new Set([
        getLineageTableNodeId(id),
        getLineagePipelineNodeId(id),
        getLineageDashboardNodeId(id),
      ]).size,
    ).toBe(3);
  });

  test("an arrow is named by its kind and its two ends", () => {
    expect(
      getLineageEdgeId({
        kind: DataLineageEdgeKind.Feeds,
        source: "table:a",
        target: "table:b",
      }),
    ).toBe("Feeds:table:a>table:b");
    expect(
      getLineageEdgeId({
        kind: DataLineageEdgeKind.Feeds,
        source: "table:b",
        target: "table:a",
      }),
    ).not.toBe(
      getLineageEdgeId({
        kind: DataLineageEdgeKind.Feeds,
        source: "table:a",
        target: "table:b",
      }),
    );
  });
});

describe("pipeline runs", () => {
  test("a failed or aborted run went wrong; nothing else did", () => {
    expect(isFailedLineageRunState("FAIL")).toBe(true);
    expect(isFailedLineageRunState("ABORT")).toBe(true);

    for (const state of [
      "COMPLETE",
      "START",
      "RUNNING",
      "RESCHEDULED",
      "OTHER",
      null,
      undefined,
    ]) {
      expect(isFailedLineageRunState(state)).toBe(false);
    }
  });

  test("a started or running run is running", () => {
    expect(isRunningLineageRunState("START")).toBe(true);
    expect(isRunningLineageRunState("RUNNING")).toBe(true);

    for (const state of ["COMPLETE", "FAIL", "ABORT", null, undefined]) {
      expect(isRunningLineageRunState(state)).toBe(false);
    }
  });
});
