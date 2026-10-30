import {
  STEP_ERROR_PORT_ID,
  getUnhandledStepFailureLogLine,
  isUnhandledStepFailure,
  readUnhandledStepFailures,
} from "../../../Types/Workflow/UnhandledStepFailure";
import ComponentMetadata, { Port } from "../../../Types/Workflow/Component";
import Components from "../../../Types/Workflow/Components";
import { describe, expect, test } from "@jest/globals";

// The words a step's failure output would be called by.
const FAILURE_PORT_WORDS: RegExp = /error|fail/i;

describe("UnhandledStepFailure", () => {
  describe("isUnhandledStepFailure", () => {
    test("an Error output with nothing connected is one", () => {
      expect(
        isUnhandledStepFailure({ portId: "error", connectedComponentIds: [] }),
      ).toBe(true);
      expect(
        isUnhandledStepFailure({
          portId: "error",
          connectedComponentIds: undefined,
        }),
      ).toBe(true);
      expect(
        isUnhandledStepFailure({ portId: "error", connectedComponentIds: null }),
      ).toBe(true);
    });

    test("an Error output that leads somewhere is handled", () => {
      expect(
        isUnhandledStepFailure({
          portId: "error",
          connectedComponentIds: ["log-1"],
        }),
      ).toBe(false);
    });

    test.each(["success", "out", "yes", "no", "default", "case-1", ""])(
      "%s with nothing connected is not a failure",
      (portId: string) => {
        expect(
          isUnhandledStepFailure({ portId: portId, connectedComponentIds: [] }),
        ).toBe(false);
      },
    );

    test("a step that left by no output is not a failure", () => {
      expect(
        isUnhandledStepFailure({ portId: null, connectedComponentIds: [] }),
      ).toBe(false);
      expect(
        isUnhandledStepFailure({
          portId: undefined,
          connectedComponentIds: [],
        }),
      ).toBe(false);
    });

    /*
     * The rule reads one id. A step whose failure output were named anything
     * else would never fail a run, so every built-in step that can fail
     * names it the same.
     */
    test("every built-in step's failure output is the Error output", () => {
      for (const component of Components as Array<ComponentMetadata>) {
        const failurePorts: Array<Port> = component.outPorts.filter(
          (port: Port): boolean => {
            return FAILURE_PORT_WORDS.test(`${port.id} ${port.title}`);
          },
        );

        for (const port of failurePorts) {
          expect(`${component.id}: ${port.id}`).toBe(
            `${component.id}: ${STEP_ERROR_PORT_ID}`,
          );
        }
      }
    });
  });

  describe("getUnhandledStepFailureLogLine", () => {
    test("names the one step that failed", () => {
      expect(
        getUnhandledStepFailureLogLine([
          { componentId: "api-get-1", title: "API GET" },
        ]),
      ).toBe(
        "The run failed: step api-get-1 (API GET) failed, and nothing is connected to its Error output. Why is in its Steps entry above.",
      );
    });

    test("names every step, in order, in one line", () => {
      const line: string = getUnhandledStepFailureLogLine([
        { componentId: "a", title: "API GET" },
        { componentId: "b", title: "Send Message to Slack" },
      ]);

      expect(line).toBe(
        "The run failed: steps a (API GET), b (Send Message to Slack) failed, and nothing is connected to their Error outputs. Why is in their Steps entries above.",
      );
      expect(line).not.toContain("\n");
    });
  });

  describe("readUnhandledStepFailures", () => {
    test("reads back what a run kept when it slept", () => {
      expect(
        readUnhandledStepFailures([
          { componentId: "a", title: "API GET" },
          { componentId: "b", title: "Log" },
        ]),
      ).toEqual([
        { componentId: "a", title: "API GET" },
        { componentId: "b", title: "Log" },
      ]);
    });

    test.each([undefined, null, "a", 1, {}, true])(
      "a run that kept none (%p) has none",
      (value: unknown) => {
        expect(readUnhandledStepFailures(value)).toEqual([]);
      },
    );

    test("drops entries that are not failures, and anything else they carry", () => {
      expect(
        readUnhandledStepFailures([
          null,
          "a",
          { componentId: "a" },
          { title: "Log" },
          { componentId: 1, title: "Log" },
          { componentId: "b", title: "Log", extra: "dropped" },
        ]),
      ).toEqual([{ componentId: "b", title: "Log" }]);
    });
  });
});
