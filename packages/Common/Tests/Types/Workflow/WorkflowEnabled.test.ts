import {
  WORKFLOW_ENABLED_SWITCH_LABEL,
  WORKFLOW_TEST_RUN_STARTER_MAX_LENGTH,
  WORKFLOW_TURNED_OFF_MESSAGE,
  getChildWorkflowTurnedOffMessage,
  getWorkflowTestRunLogLine,
  getWorkflowTestRunStarter,
} from "../../../Types/Workflow/WorkflowEnabled";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the server says about a workflow that is turned off.
 *
 * Off pauses what starts a workflow without a person - its trigger and other
 * workflows' Execute Workflow steps - and not a person testing it from the
 * Builder: "Run - Why do I have to enable a workflow in order to test run
 * it? Can you please fix it?" So:
 *
 *   - the refusal a webhook caller reads says the trigger can't start the
 *     workflow, and how to turn it on - not that the workflow "can't run",
 *     which it now can, by hand;
 *   - a test run's log opens with a line that says it is one, and who
 *     started it, quoting a name the person typed on one line.
 */

const DASHBOARD_PAGES: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "Workflow",
);

describe("the refusal to start a workflow that is off", () => {
  test("says the workflow is off, so its trigger can't start it", () => {
    expect(WORKFLOW_TURNED_OFF_MESSAGE).toMatch(
      /^This workflow is turned off, so its trigger can't start it\./,
    );
  });

  test("no longer says the workflow can't run: a person can still test it", () => {
    expect(WORKFLOW_TURNED_OFF_MESSAGE).not.toContain("so it can't run");
  });

  test("says how to turn it on, and where the switch is", () => {
    expect(WORKFLOW_TURNED_OFF_MESSAGE).toContain("Turn it on");
    expect(WORKFLOW_TURNED_OFF_MESSAGE).toContain(
      `the ${WORKFLOW_ENABLED_SWITCH_LABEL} switch at the top of its Builder`,
    );
    expect(WORKFLOW_TURNED_OFF_MESSAGE).toMatch(/then try again\.$/);
  });

  test("is no longer the bare 'not enabled'", () => {
    expect(WORKFLOW_TURNED_OFF_MESSAGE).not.toMatch(/not enabled/i);
  });

  test("is pinned word for word: a webhook sender's delivery log quotes it", () => {
    expect(WORKFLOW_TURNED_OFF_MESSAGE).toBe(
      "This workflow is turned off, so its trigger can't start it. Turn it on with the Enabled switch at the top of its Builder, then try again.",
    );
  });

  test("names the switch by the name the Overview page gives the same field", () => {
    /*
     * The message tells people to look for "the Enabled switch". The Builder
     * draws it under that name (WorkflowEnabledSwitch), and so does the
     * Overview's Workflow Details, where the switch also lives.
     */
    const overview: string = fs.readFileSync(
      path.join(DASHBOARD_PAGES, "View", "Index.tsx"),
      "utf8",
    );

    expect(overview).toMatch(
      new RegExp(
        `isEnabled: true,\\s*\\},\\s*title: "${WORKFLOW_ENABLED_SWITCH_LABEL}"`,
      ),
    );
  });
});

describe("the refusal as an Execute Workflow step reports it", () => {
  const CHILD_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194161004";

  test("names the workflow it called, so it is not read as the one running", () => {
    const message: string = getChildWorkflowTurnedOffMessage({
      workflowId: CHILD_ID,
      workflowName: "Page the on-call engineer",
    });

    expect(message).toBe(
      'The workflow "Page the on-call engineer" is turned off, so this step could not start it. Turn it on with the Enabled switch at the top of its Builder.',
    );
    expect(message).not.toMatch(/^This workflow/);
  });

  test.each([undefined, null, "", "   "])(
    "falls back to the ID when the workflow has no name (%p)",
    (workflowName: string | null | undefined) => {
      expect(
        getChildWorkflowTurnedOffMessage({
          workflowId: CHILD_ID,
          workflowName: workflowName,
        }),
      ).toBe(
        `The workflow ${CHILD_ID} is turned off, so this step could not start it. Turn it on with the Enabled switch at the top of its Builder.`,
      );
    },
  );

  test("trims the name it quotes", () => {
    expect(
      getChildWorkflowTurnedOffMessage({
        workflowId: CHILD_ID,
        workflowName: "  Nightly sync  ",
      }),
    ).toContain('The workflow "Nightly sync" is turned off');
  });
});

describe("the line a test run's log opens with", () => {
  test("says it is a test run, who started it, and that the workflow is off", () => {
    expect(getWorkflowTestRunLogLine({ startedBy: "Ada Lovelace" })).toBe(
      "Test run, started by Ada Lovelace while this workflow is turned off.",
    );
  });

  test.each([undefined, null, "", "   ", "\n\t"])(
    "says started by hand when nobody is named (%p)",
    (startedBy: string | null | undefined) => {
      expect(getWorkflowTestRunLogLine({ startedBy: startedBy })).toBe(
        "Test run, started by hand while this workflow is turned off.",
      );
    },
  );

  test("keeps a name the person typed over several lines on one line", () => {
    const line: string = getWorkflowTestRunLogLine({
      startedBy: "Ada\n10:00:00: Workflow finished.\r\nLovelace",
    });

    expect(line).not.toMatch(/[\r\n]/);
    expect(line).toBe(
      "Test run, started by Ada 10:00:00: Workflow finished. Lovelace while this workflow is turned off.",
    );
  });
});

describe("a person's name as a run's log quotes it", () => {
  test("is trimmed, with every run of white space made one space", () => {
    expect(getWorkflowTestRunStarter("  Ada \t  Lovelace  ")).toBe(
      "Ada Lovelace",
    );
  });

  test("breaks no line, whichever line break the name holds", () => {
    for (const lineBreak of ["\n", "\r", "\r\n", "\u2028", "\u2029", "\v", "\f"]) {
      expect(getWorkflowTestRunStarter(`Ada${lineBreak}Lovelace`)).toBe(
        "Ada Lovelace",
      );
    }
  });

  test.each([undefined, null, ""])("is empty for no name (%p)", (name: unknown) => {
    expect(getWorkflowTestRunStarter(name as string | null | undefined)).toBe(
      "",
    );
  });

  test("a name of the longest length is kept whole", () => {
    const name: string = "a".repeat(WORKFLOW_TEST_RUN_STARTER_MAX_LENGTH);

    expect(getWorkflowTestRunStarter(name)).toBe(name);
  });

  test("a longer name is cut, and says so", () => {
    const cut: string = getWorkflowTestRunStarter(
      "a".repeat(WORKFLOW_TEST_RUN_STARTER_MAX_LENGTH + 50),
    );

    expect(Array.from(cut)).toHaveLength(WORKFLOW_TEST_RUN_STARTER_MAX_LENGTH);
    expect(cut.endsWith("…")).toBe(true);
  });

  test("is cut by letters, never in the middle of one", () => {
    const cut: string = getWorkflowTestRunStarter(
      "😀".repeat(WORKFLOW_TEST_RUN_STARTER_MAX_LENGTH + 1),
    );

    expect(Array.from(cut)).toHaveLength(WORKFLOW_TEST_RUN_STARTER_MAX_LENGTH);
    // No lone half of a surrogate pair is left behind.
    expect(cut).toBe(
      `${"😀".repeat(WORKFLOW_TEST_RUN_STARTER_MAX_LENGTH - 1)}…`,
    );
  });

  test("allows a sensible name of real length", () => {
    expect(WORKFLOW_TEST_RUN_STARTER_MAX_LENGTH).toBeGreaterThanOrEqual(60);
  });
});
