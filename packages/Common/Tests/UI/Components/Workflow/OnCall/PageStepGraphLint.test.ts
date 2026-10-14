/*
 * What the Builder's checks say of a Page step, before the workflow is ever
 * run: on the canvas ("Click to set up", a red badge), in the issues panel
 * and beside Save.
 *
 * A Page step that is set up wrong pages nobody, and the first anybody
 * hears of it is an incident nobody was woken for. So the checks have to
 * catch what can be caught here:
 *
 *   - nobody to page, and the settings its answer to Page About needs;
 *   - a Page About that is none of the answers;
 *   - a value from a step that is not there, in the list of who to page as
 *     in any other setting.
 *
 * And they must not cry wolf: a setting that goes with another answer is
 * not on the form and is not read, so nothing it still holds is a problem.
 */

import {
  LintGraphEdge,
  LintGraphNode,
  WorkflowLintIssue,
  WorkflowLintResult,
  WorkflowLintRule,
  WorkflowLintSeverity,
  lintWorkflowGraph,
} from "../../../../../UI/Components/Workflow/GraphLint";
import {
  WorkflowNodeIssueSummary,
  buildNodeIssueSummaries,
} from "../../../../../UI/Components/Workflow/GraphLintSummary";
import { JSONObject } from "../../../../../Types/JSON";
import ComponentMetadata, {
  NodeType,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import { PAGE_ARGUMENT_IDS } from "../../../../../Types/Workflow/Components/OnCallPageSettings";
import { describe, expect, test } from "@jest/globals";

const JANE: string = "10000000-0000-4000-8000-000000000001";
const JOHN: string = "10000000-0000-4000-8000-000000000002";

const MANUAL_VALUE: string = "{{local.components.manual-1.returnValues.value}}";
const GONE: string = "{{local.components.deleted-step-9.returnValues.value}}";

interface PageStep {
  id: ComponentID;
  who: string;
  whoName: string;
}

const PAGE_STEPS: Array<PageStep> = [
  { id: ComponentID.PageUsers, who: PAGE_ARGUMENT_IDS.users, whoName: "Users" },
  { id: ComponentID.PageTeam, who: PAGE_ARGUMENT_IDS.teams, whoName: "Teams" },
  {
    id: ComponentID.PageOnCall,
    who: PAGE_ARGUMENT_IDS.onCallSchedules,
    whoName: "On-Call Schedules",
  },
  {
    id: ComponentID.PageOnCallPolicy,
    who: PAGE_ARGUMENT_IDS.onCallPolicies,
    whoName: "On-Call Policies",
  },
];

function metadataOf(id: ComponentID): ComponentMetadata {
  return Components.find((component: ComponentMetadata): boolean => {
    return component.id === id;
  })!;
}

function node(
  id: ComponentID,
  componentId: string,
  args: JSONObject = {},
): LintGraphNode {
  const metadata: ComponentMetadata = metadataOf(id);

  return {
    id: `canvas-${componentId}`,
    data: {
      id: componentId,
      internalId: `runner-${componentId}`,
      nodeType: NodeType.Node,
      componentType: metadata.componentType,
      metadataId: metadata.id,
      metadata: metadata,
      error: "",
      arguments: args,
      returnValues: {},
    },
  };
}

// Manual → the Page step: a whole, connected workflow.
function lintPageStep(id: ComponentID, args: JSONObject): WorkflowLintResult {
  const edges: Array<LintGraphEdge> = [
    {
      source: "canvas-manual-1",
      sourceHandle: "success",
      target: "canvas-page-1",
    },
  ];

  return lintWorkflowGraph({
    nodes: [node(ComponentID.Manual, "manual-1"), node(id, "page-1", args)],
    edges: edges,
  });
}

function issuesOf(result: WorkflowLintResult): Array<WorkflowLintIssue> {
  return result.issues.filter((issue: WorkflowLintIssue): boolean => {
    return issue.componentId === "page-1";
  });
}

// What is said of the step, as [rule, setting].
function said(
  result: WorkflowLintResult,
): Array<[WorkflowLintRule, string | null]> {
  return issuesOf(result).map(
    (issue: WorkflowLintIssue): [WorkflowLintRule, string | null] => {
      return [issue.rule, issue.argumentId];
    },
  );
}

function messages(result: WorkflowLintResult): Array<string> {
  return issuesOf(result).map((issue: WorkflowLintIssue): string => {
    return issue.message;
  });
}

describe.each(PAGE_STEPS)("$id", (step: PageStep) => {
  test("a new step still needs who to page and a title", () => {
    const result: WorkflowLintResult = lintPageStep(step.id, {});

    expect(said(result)).toEqual([
      [WorkflowLintRule.MissingRequiredArgument, step.who],
      [WorkflowLintRule.MissingRequiredArgument, PAGE_ARGUMENT_IDS.title],
    ]);
    expect(messages(result)).toEqual([
      `"${step.whoName}" is required but empty.`,
      '"Title" is required but empty.',
    ]);

    // On the canvas that is "Click to set up", not a red badge.
    const summary: WorkflowNodeIssueSummary = buildNodeIssueSummaries(
      result.issues,
    )["canvas-page-1"]!;

    expect(summary.missingSettingMessages).toHaveLength(2);
    expect(summary.errorMessages).toEqual([]);
  });

  test("somebody named and a title: nothing to say", () => {
    expect(
      said(
        lintPageStep(step.id, {
          [step.who]: [JANE],
          [PAGE_ARGUMENT_IDS.title]: "Database CPU is above 90%",
        }),
      ),
    ).toEqual([]);
  });

  test("a page about an incident needs its Incident ID, and no title", () => {
    expect(
      said(
        lintPageStep(step.id, {
          [step.who]: [JANE],
          [PAGE_ARGUMENT_IDS.about]: "incident",
        }),
      ),
    ).toEqual([
      [WorkflowLintRule.MissingRequiredArgument, PAGE_ARGUMENT_IDS.incidentId],
    ]);

    expect(
      said(
        lintPageStep(step.id, {
          [step.who]: [JANE],
          [PAGE_ARGUMENT_IDS.about]: "incident",
          [PAGE_ARGUMENT_IDS.incidentId]: MANUAL_VALUE,
        }),
      ),
    ).toEqual([]);
  });

  test("a page about an alert needs its Alert ID, and no title", () => {
    expect(
      said(
        lintPageStep(step.id, {
          [step.who]: [JANE],
          [PAGE_ARGUMENT_IDS.about]: "alert",
        }),
      ),
    ).toEqual([
      [WorkflowLintRule.MissingRequiredArgument, PAGE_ARGUMENT_IDS.alertId],
    ]);

    expect(
      said(
        lintPageStep(step.id, {
          [step.who]: [JANE],
          [PAGE_ARGUMENT_IDS.about]: "alert",
          [PAGE_ARGUMENT_IDS.alertId]: "a1e70000-0000-4000-8000-000000000001",
        }),
      ),
    ).toEqual([]);
  });

  test("the list emptied is nobody again", () => {
    for (const nobody of [[], "", null, undefined]) {
      expect(
        said(
          lintPageStep(step.id, {
            [step.who]: nobody,
            [PAGE_ARGUMENT_IDS.title]: "Database CPU is above 90%",
          } as JSONObject),
        ),
      ).toEqual([[WorkflowLintRule.MissingRequiredArgument, step.who]]);
    }
  });

  test("a value from an earlier step is somebody: who it names is known when the step runs", () => {
    expect(
      said(
        lintPageStep(step.id, {
          [step.who]: [MANUAL_VALUE],
          [PAGE_ARGUMENT_IDS.title]: "Database CPU is above 90%",
        }),
      ),
    ).toEqual([]);
  });

  test("a value from a step that is not in the workflow is caught in the list, as in any setting", () => {
    const result: WorkflowLintResult = lintPageStep(step.id, {
      [step.who]: [JANE, GONE],
      [PAGE_ARGUMENT_IDS.title]: "Database CPU is above 90%",
    });

    expect(said(result)).toEqual([
      [WorkflowLintRule.UnknownReferencedComponent, step.who],
    ]);
    expect(issuesOf(result)[0]!.severity).toBe(WorkflowLintSeverity.Error);
    expect(messages(result)[0]).toContain(`"${step.whoName}"`);
    expect(messages(result)[0]).toContain("deleted-step-9");
  });
});

describe("a Page About that is none of the answers", () => {
  test("is an error that names the setting and what it holds", () => {
    const result: WorkflowLintResult = lintPageStep(ComponentID.PageUsers, {
      users: [JANE],
      about: "postmortem",
    });

    expect(said(result)).toEqual([
      [WorkflowLintRule.UnknownChoice, PAGE_ARGUMENT_IDS.about],
    ]);
    expect(messages(result)).toEqual([
      '"Page About" is set to "postmortem", which is not one of its choices. Open the step and pick one.',
    ]);
    expect(issuesOf(result)[0]!.severity).toBe(WorkflowLintSeverity.Error);

    // A red badge on the canvas: this is a mistake, not a step left to set up.
    expect(
      buildNodeIssueSummaries(result.issues)["canvas-page-1"]!.errorMessages,
    ).toHaveLength(1);
    expect(result.errorCount).toBe(1);
  });

  test("the settings of no answer are asked for: there is nothing to go with", () => {
    expect(
      said(lintPageStep(ComponentID.PageUsers, { users: [JANE], about: "x" })),
    ).toEqual([[WorkflowLintRule.UnknownChoice, PAGE_ARGUMENT_IDS.about]]);
  });

  test.each<[unknown, string]>([
    [7, "7"],
    [true, "true"],
    [["incident"], '["incident"]'],
    [{ about: "incident" }, '{"about":"incident"}'],
  ])(
    "a value that is not text (%p) is said as it is written",
    (stored: unknown, shown: string) => {
      expect(
        messages(
          lintPageStep(ComponentID.PageUsers, {
            users: [JANE],
            about: stored,
          } as JSONObject),
        ),
      ).toEqual([
        `"Page About" is set to "${shown}", which is not one of its choices. Open the step and pick one.`,
      ]);
    },
  );

  test("a long one is cut short", () => {
    const message: string = messages(
      lintPageStep(ComponentID.PageUsers, {
        users: [JANE],
        about: "x".repeat(200),
      }),
    )[0]!;

    expect(message).toContain(`"${"x".repeat(60)}…"`);
    expect(message).not.toContain("x".repeat(61));
  });

  test.each(["new-alert", "incident", "alert", "Incident", " ALERT "])(
    "'%s' is one of them, whatever case it was written in",
    (stored: string) => {
      expect(
        said(
          lintPageStep(ComponentID.PageUsers, {
            users: [JANE],
            about: stored,
            title: "Database CPU is above 90%",
            "incident-id": MANUAL_VALUE,
            "alert-id": MANUAL_VALUE,
          }),
        ),
      ).toEqual([]);
    },
  );

  test("an empty one is the first answer, and no mistake", () => {
    for (const empty of ["", "  ", null]) {
      expect(
        said(
          lintPageStep(ComponentID.PageUsers, {
            users: [JANE],
            about: empty,
            title: "Database CPU is above 90%",
          } as JSONObject),
        ),
      ).toEqual([]);
    }
  });
});

describe("a Page About that comes from an earlier step", () => {
  test("is not judged as a choice, and the settings that could go with it are not asked for", () => {
    expect(
      said(
        lintPageStep(ComponentID.PageUsers, {
          users: [JANE],
          about: MANUAL_VALUE,
        }),
      ),
    ).toEqual([]);
  });

  test("who to page is still asked for", () => {
    expect(
      said(lintPageStep(ComponentID.PageUsers, { about: MANUAL_VALUE })),
    ).toEqual([
      [WorkflowLintRule.MissingRequiredArgument, PAGE_ARGUMENT_IDS.users],
    ]);
  });

  test("the value itself is checked as any value is: a step that is not there is caught", () => {
    expect(
      said(lintPageStep(ComponentID.PageUsers, { users: [JANE], about: GONE })),
    ).toEqual([
      [WorkflowLintRule.UnknownReferencedComponent, PAGE_ARGUMENT_IDS.about],
    ]);
  });

  test("and so is what its settings hold, since any of them may be read", () => {
    expect(
      said(
        lintPageStep(ComponentID.PageUsers, {
          users: [JANE],
          about: MANUAL_VALUE,
          "incident-id": GONE,
        }),
      ),
    ).toEqual([
      [
        WorkflowLintRule.UnknownReferencedComponent,
        PAGE_ARGUMENT_IDS.incidentId,
      ],
    ]);
  });
});

describe("a setting that goes with another answer", () => {
  /*
   * It is not on the form to be put right, and the step does not read it:
   * whatever it still holds from before the answer was changed says nothing
   * about the workflow.
   */
  test("a title left over, pointing at a step since taken out, is no problem for a page about an incident", () => {
    expect(
      said(
        lintPageStep(ComponentID.PageUsers, {
          users: [JANE, JOHN],
          about: "incident",
          "incident-id": MANUAL_VALUE,
          title: `Disk full on ${GONE}`,
          message: GONE,
          "alert-id": GONE,
          "alert-severity": GONE,
        }),
      ),
    ).toEqual([]);
  });

  test("the same title is caught once the page is about a new alert again", () => {
    expect(
      said(
        lintPageStep(ComponentID.PageUsers, {
          users: [JANE],
          about: "new-alert",
          title: `Disk full on ${GONE}`,
          "incident-id": GONE,
        }),
      ),
    ).toEqual([
      [WorkflowLintRule.UnknownReferencedComponent, PAGE_ARGUMENT_IDS.title],
    ]);
  });

  test("an Incident ID left over is no problem for a page about an alert", () => {
    expect(
      said(
        lintPageStep(ComponentID.PageTeam, {
          teams: [JANE],
          about: "alert",
          "alert-id": MANUAL_VALUE,
          "incident-id": GONE,
        }),
      ),
    ).toEqual([]);
  });
});

describe("the other steps are checked as they were", () => {
  test("a step with no such setting is not asked for a choice", () => {
    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [
        node(ComponentID.Manual, "manual-1"),
        node(ComponentID.Log, "log-1", { value: "hello" }),
      ],
      edges: [
        {
          source: "canvas-manual-1",
          sourceHandle: "success",
          target: "canvas-log-1",
        },
      ],
    });

    expect(result.issues).toEqual([]);
  });

  test("a setting of theirs holding a step that is not there is still caught", () => {
    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [
        node(ComponentID.Manual, "manual-1"),
        node(ComponentID.Log, "log-1", { value: GONE }),
      ],
      edges: [
        {
          source: "canvas-manual-1",
          sourceHandle: "success",
          target: "canvas-log-1",
        },
      ],
    });

    expect(
      result.issues.map((issue: WorkflowLintIssue): WorkflowLintRule => {
        return issue.rule;
      }),
    ).toEqual([WorkflowLintRule.UnknownReferencedComponent]);
  });
});
