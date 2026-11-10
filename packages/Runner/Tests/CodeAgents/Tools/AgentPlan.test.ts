/*
 * update_plan (issue #6441): the agent's plan for a task of several steps,
 * kept on the Runner so it survives the oldest turns being left out of a
 * long task's conversation.
 */

import AgentPlan from "../../../CodeAgents/Tools/AgentPlan";
import { ToolExecution } from "../../../CodeAgents/Tools/CodeAgentToolTypes";

function update(plan: AgentPlan, args: Record<string, unknown>): ToolExecution {
  return plan.update(args as never);
}

describe("update_plan", () => {
  test("keeps the plan, and shows it with what is done, what is now and what is next", () => {
    const plan: AgentPlan = new AgentPlan();

    const result: ToolExecution = update(plan, {
      plan: [
        { step: "Find where the discount is applied", status: "done" },
        { step: "Fix the rounding", status: "in_progress" },
        { step: "Run the tests", status: "pending" },
      ],
    });

    expect(result.output).toBe(
      [
        "Plan updated:",
        "[x] Find where the discount is applied",
        "[>] Fix the rounding",
        "[ ] Run the tests",
      ].join("\n"),
    );
    expect(result.narration).toBe(
      "updated the plan: 1 of 3 steps done; now: Fix the rounding",
    );
    expect(plan.hasSteps()).toBe(true);
    expect(plan.describe()).toBe(
      "[x] Find where the discount is applied\n[>] Fix the rounding\n[ ] Run the tests",
    );
  });

  test("reads the words models use for a step and its status", () => {
    const plan: AgentPlan = new AgentPlan();

    update(plan, {
      steps: [
        { title: "One", state: "Completed" },
        { description: "Two", status: "In Progress" },
        "Three",
        { step: "Four", status: "something else" },
      ],
    });

    expect(plan.describe()).toBe("[x] One\n[>] Two\n[ ] Three\n[ ] Four");
  });

  test("each update replaces the plan", () => {
    const plan: AgentPlan = new AgentPlan();

    update(plan, { plan: [{ step: "A", status: "in_progress" }] });
    update(plan, {
      plan: [
        { step: "A", status: "done" },
        { step: "B", status: "in_progress" },
      ],
    });

    expect(plan.describe()).toBe("[x] A\n[>] B");
  });

  test("refuses a plan that is missing, empty, too long, has a step without text or two steps in progress - and keeps the one it had", () => {
    const plan: AgentPlan = new AgentPlan();
    update(plan, { plan: [{ step: "Kept", status: "pending" }] });

    expect(update(plan, {}).output).toBe(
      'Error: plan is required: a list of steps, each {"step": "...", "status": "pending" | "in_progress" | "done"}.',
    );
    expect(update(plan, { plan: [] }).output).toContain("plan is required");
    expect(
      update(plan, {
        plan: Array.from({ length: 41 }, (_: unknown, index: number) => {
          return { step: `Step ${index}`, status: "pending" };
        }),
      }).output,
    ).toBe("Error: a plan has at most 40 steps; group the small ones.");
    expect(
      update(plan, { plan: [{ step: "  ", status: "pending" }] }).output,
    ).toBe("Error: every step needs its text (step).");
    expect(
      update(plan, {
        plan: [
          { step: "A", status: "in_progress" },
          { step: "B", status: "in_progress" },
        ],
      }).output,
    ).toBe(
      "Error: one step at most may be in_progress: the one you are working on now.",
    );

    expect(plan.describe()).toBe("[ ] Kept");
  });

  test("a very long step is cut", () => {
    const plan: AgentPlan = new AgentPlan();

    update(plan, { plan: [{ step: "x".repeat(1000), status: "pending" }] });

    expect(plan.describe()).toBe(`[ ] ${"x".repeat(397)}...`);
  });

  test("a new plan has no steps", () => {
    expect(new AgentPlan().hasSteps()).toBe(false);
  });
});
