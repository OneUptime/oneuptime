import Includes from "../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../Types/JSON";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepSeries, {
  MONITOR_STEP_ID_ATTRIBUTE,
  MonitorStepSeriesScope,
} from "../../../Types/Monitor/MonitorStepSeries";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * WHICH ROWS A WINDOW OF ONE STEP READS (#10906): the step's own, and on a
 * monitor with one step the rows written before rows named their step.
 */

function stepsOf(count: number): {
  monitorSteps: MonitorSteps;
  steps: Array<MonitorStep>;
} {
  const steps: Array<MonitorStep> = [];

  for (let index: number = 0; index < count; index++) {
    steps.push(new MonitorStep());
  }

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: steps,
    defaultMonitorStatusId: undefined,
  };

  return { monitorSteps, steps };
}

describe("MonitorStepSeries", () => {
  test("names the step in the attribute every row is written with", () => {
    expect(MONITOR_STEP_ID_ATTRIBUTE).toBe("monitorStepId");
  });

  describe("getScope", () => {
    test("a monitor with one step reads its own rows and the rows that name none", () => {
      const { monitorSteps, steps } = stepsOf(1);

      expect(
        MonitorStepSeries.getScope({
          monitorStepId: steps[0]!.id,
          monitorSteps: monitorSteps,
        }),
      ).toEqual({
        monitorStepId: steps[0]!.id.toString(),
        readsRowsWithoutStep: true,
      });
    });

    test("a monitor with several steps reads each step's own rows alone", () => {
      const { monitorSteps, steps } = stepsOf(3);

      for (const step of steps) {
        expect(
          MonitorStepSeries.getScope({
            monitorStepId: step.id.toString(),
            monitorSteps: monitorSteps,
          }),
        ).toEqual({
          monitorStepId: step.id.toString(),
          readsRowsWithoutStep: false,
        });
      }
    });

    test("steps not read with the monitor count as one step: the old rows are its own", () => {
      for (const monitorSteps of [undefined, null, new MonitorSteps()]) {
        if (monitorSteps) {
          monitorSteps.data = undefined;
        }

        expect(
          MonitorStepSeries.getScope({
            monitorStepId: "step",
            monitorSteps: monitorSteps,
          }).readsRowsWithoutStep,
        ).toBe(true);
      }
    });
  });

  describe("getAttributeValues and toQueryAttributes", () => {
    const ONE_STEP: MonitorStepSeriesScope = {
      monitorStepId: "a",
      readsRowsWithoutStep: true,
    };
    const SEVERAL_STEPS: MonitorStepSeriesScope = {
      monitorStepId: "a",
      readsRowsWithoutStep: false,
    };

    test('the step\'s id, and "" - a row without the attribute - on a monitor with one step', () => {
      expect(MonitorStepSeries.getAttributeValues(ONE_STEP)).toEqual(["a", ""]);
      expect(MonitorStepSeries.getAttributeValues(SEVERAL_STEPS)).toEqual([
        "a",
      ]);
    });

    test("as an analytics query: the id itself, or either value", () => {
      const several: JSONObject =
        MonitorStepSeries.toQueryAttributes(SEVERAL_STEPS);
      expect(several).toEqual({ [MONITOR_STEP_ID_ATTRIBUTE]: "a" });

      const one: JSONObject = MonitorStepSeries.toQueryAttributes(ONE_STEP);
      const values: unknown = one[MONITOR_STEP_ID_ATTRIBUTE];
      expect(values).toBeInstanceOf(Includes);
      expect((values as Includes).values).toEqual(["a", ""]);
    });

    test("isRowInScope reads a row as the reads above select it", () => {
      const cases: Array<{
        attributes: Record<string, unknown> | undefined;
        oneStep: boolean;
        severalSteps: boolean;
      }> = [
        {
          attributes: { monitorStepId: "a" },
          oneStep: true,
          severalSteps: true,
        },
        {
          attributes: { monitorStepId: "b" },
          oneStep: false,
          severalSteps: false,
        },
        {
          attributes: { monitorStepId: "" },
          oneStep: true,
          severalSteps: false,
        },
        { attributes: { probeId: "p" }, oneStep: true, severalSteps: false },
        { attributes: undefined, oneStep: true, severalSteps: false },
      ];

      for (const row of cases) {
        expect(
          MonitorStepSeries.isRowInScope({
            attributes: row.attributes,
            scope: ONE_STEP,
          }),
        ).toBe(row.oneStep);
        expect(
          MonitorStepSeries.isRowInScope({
            attributes: row.attributes,
            scope: SEVERAL_STEPS,
          }),
        ).toBe(row.severalSteps);
      }
    });
  });

  describe("getStepNumber", () => {
    test("a row's step, counted from 1, on a monitor with several steps", () => {
      const { monitorSteps, steps } = stepsOf(3);

      steps.forEach((step: MonitorStep, index: number) => {
        expect(
          MonitorStepSeries.getStepNumber({
            attributes: { [MONITOR_STEP_ID_ATTRIBUTE]: step.id.toString() },
            monitorSteps: monitorSteps,
          }),
        ).toBe(index + 1);
      });
    });

    test("none on a monitor with one step, for a row that names none, or a step since removed", () => {
      const one: { monitorSteps: MonitorSteps; steps: Array<MonitorStep> } =
        stepsOf(1);
      const several: {
        monitorSteps: MonitorSteps;
        steps: Array<MonitorStep>;
      } = stepsOf(2);

      expect(
        MonitorStepSeries.getStepNumber({
          attributes: {
            [MONITOR_STEP_ID_ATTRIBUTE]: one.steps[0]!.id.toString(),
          },
          monitorSteps: one.monitorSteps,
        }),
      ).toBeNull();

      for (const attributes of [
        {},
        { [MONITOR_STEP_ID_ATTRIBUTE]: "" },
        { [MONITOR_STEP_ID_ATTRIBUTE]: ObjectID.generate().toString() },
        undefined,
      ]) {
        expect(
          MonitorStepSeries.getStepNumber({
            attributes: attributes,
            monitorSteps: several.monitorSteps,
          }),
        ).toBeNull();
      }

      expect(
        MonitorStepSeries.getStepNumber({
          attributes: { [MONITOR_STEP_ID_ATTRIBUTE]: "x" },
          monitorSteps: undefined,
        }),
      ).toBeNull();
    });
  });
});
