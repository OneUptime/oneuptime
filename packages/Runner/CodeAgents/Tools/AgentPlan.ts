import { JSONObject } from "Common/Types/JSON";
import { readStringArgument, ToolExecution } from "./CodeAgentToolTypes";
import { PLAN_MAX_STEPS, PLAN_MAX_STEP_LENGTH } from "./CodeAgentToolLimits";

export const UPDATE_PLAN_TOOL_NAME: string = "update_plan";

export enum PlanStepStatus {
  Pending = "pending",
  InProgress = "in_progress",
  Done = "done",
}

export interface PlanStep {
  step: string;
  status: PlanStepStatus;
}

const STATUS_MARKS: Record<PlanStepStatus, string> = {
  [PlanStepStatus.Pending]: "[ ]",
  [PlanStepStatus.InProgress]: "[>]",
  [PlanStepStatus.Done]: "[x]",
};

/*
 * The agent's plan for a task of several steps (update_plan, issue #6441):
 * what it will do, what it is doing, what is done. The model writes the
 * whole plan each time it changes, with one step in progress at most.
 *
 * Keeping it here, not only in the conversation, is what lets a long task
 * keep its course: when the oldest turns are dropped to keep the
 * conversation inside the model's context window (CodeAgentContext), the
 * plan is put back in front of the model as it stands. The run's trail
 * shows each update, so a person sees the plan too.
 */
export default class AgentPlan {
  private steps: Array<PlanStep> = [];

  public update(args: JSONObject): ToolExecution {
    const raw: unknown = args["plan"] ?? args["steps"];

    if (!Array.isArray(raw) || raw.length === 0) {
      return {
        narration: `refused ${UPDATE_PLAN_TOOL_NAME}: no plan given`,
        output:
          'Error: plan is required: a list of steps, each {"step": "...", "status": "pending" | "in_progress" | "done"}.',
      };
    }

    if (raw.length > PLAN_MAX_STEPS) {
      return {
        narration: `refused ${UPDATE_PLAN_TOOL_NAME}: too many steps`,
        output: `Error: a plan has at most ${PLAN_MAX_STEPS} steps; group the small ones.`,
      };
    }

    const steps: Array<PlanStep> = [];

    for (const entry of raw) {
      const item: JSONObject =
        entry && typeof entry === "object" && !Array.isArray(entry)
          ? (entry as JSONObject)
          : { step: typeof entry === "string" ? entry : "" };
      const step: string = (
        readStringArgument(item, ["step", "title", "description"]) || ""
      ).trim();

      if (!step) {
        return {
          narration: `refused ${UPDATE_PLAN_TOOL_NAME}: a step without text`,
          output: "Error: every step needs its text (step).",
        };
      }

      steps.push({
        step:
          step.length > PLAN_MAX_STEP_LENGTH
            ? `${step.substring(0, PLAN_MAX_STEP_LENGTH - 3)}...`
            : step,
        status: AgentPlan.readStatus(
          readStringArgument(item, ["status", "state"]),
        ),
      });
    }

    const inProgress: number = steps.filter((step: PlanStep): boolean => {
      return step.status === PlanStepStatus.InProgress;
    }).length;

    if (inProgress > 1) {
      return {
        narration: `refused ${UPDATE_PLAN_TOOL_NAME}: more than one step in progress`,
        output:
          "Error: one step at most may be in_progress: the one you are working on now.",
      };
    }

    this.steps = steps;

    const done: number = steps.filter((step: PlanStep): boolean => {
      return step.status === PlanStepStatus.Done;
    }).length;
    const current: PlanStep | undefined = steps.find(
      (step: PlanStep): boolean => {
        return step.status === PlanStepStatus.InProgress;
      },
    );

    return {
      narration: `updated the plan: ${done} of ${steps.length} steps done${
        current ? `; now: ${current.step.substring(0, 160)}` : ""
      }`,
      output: `Plan updated:\n${this.describe()}`,
    };
  }

  public hasSteps(): boolean {
    return this.steps.length > 0;
  }

  // The plan as it stands, one step a line: [x] done, [>] now, [ ] to do.
  public describe(): string {
    return this.steps
      .map((step: PlanStep): string => {
        return `${STATUS_MARKS[step.status]} ${step.step}`;
      })
      .join("\n");
  }

  private static readStatus(value: string | undefined): PlanStepStatus {
    const normalized: string = (value || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");

    if (
      normalized === "in_progress" ||
      normalized === "active" ||
      normalized === "doing"
    ) {
      return PlanStepStatus.InProgress;
    }

    if (
      normalized === "done" ||
      normalized === "completed" ||
      normalized === "complete"
    ) {
      return PlanStepStatus.Done;
    }

    return PlanStepStatus.Pending;
  }
}
