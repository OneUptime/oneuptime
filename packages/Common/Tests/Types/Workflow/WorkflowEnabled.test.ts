import {
  WORKFLOW_ENABLED_SWITCH_LABEL,
  WORKFLOW_TURNED_OFF_MESSAGE,
  getChildWorkflowTurnedOffMessage,
} from "../../../Types/Workflow/WorkflowEnabled";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the server says when something tries to run a workflow that is
 * turned off. It used to be "This workflow is not enabled", which the
 * maintainer read in an Error dialog with no idea how to turn the workflow
 * on. The same words reach a webhook sender's delivery log, where they are
 * the only explanation anyone gets, so they say what to do and where.
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

describe("the refusal to run a workflow that is off", () => {
  test("says the workflow is off, so it cannot run", () => {
    expect(WORKFLOW_TURNED_OFF_MESSAGE).toMatch(
      /^This workflow is turned off, so it can't run\./,
    );
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
