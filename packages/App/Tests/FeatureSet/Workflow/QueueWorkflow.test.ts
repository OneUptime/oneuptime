import QueueWorkflow from "../../../FeatureSet/Workflow/Services/QueueWorkflow";
import { describe, expect, test } from "@jest/globals";

/**
 * These tests lock in the fix for scheduled workflows that reference a
 * workflow / global variable in their "Schedule at" cron. The pattern is
 * resolved (and validated) at registration time, because BullMQ needs a
 * concrete cron to create the repeatable job — the runner's run-time variable
 * substitution happens too late for scheduling.
 */
describe("QueueWorkflow.buildScheduleCronFromVariables", () => {
  test("passes a plain cron expression through unchanged", () => {
    const result: { cron: string; error: string | null } =
      QueueWorkflow.buildScheduleCronFromVariables("0 * * * *", {}, {});

    expect(result.error).toBeNull();
    expect(result.cron).toBe("0 * * * *");
  });

  test("resolves a full local variable reference to its cron value", () => {
    const result: { cron: string; error: string | null } =
      QueueWorkflow.buildScheduleCronFromVariables(
        "{{local.variables.schedule}}",
        { schedule: "0 */18 * * *" },
        {},
      );

    expect(result.error).toBeNull();
    expect(result.cron).toBe("0 */18 * * *");
  });

  test("resolves a global variable reference to its cron value", () => {
    const result: { cron: string; error: string | null } =
      QueueWorkflow.buildScheduleCronFromVariables(
        "{{global.variables.cron}}",
        {},
        { cron: "*/5 * * * *" },
      );

    expect(result.error).toBeNull();
    expect(result.cron).toBe("*/5 * * * *");
  });

  test("resolves a variable embedded inside a cron pattern", () => {
    const result: { cron: string; error: string | null } =
      QueueWorkflow.buildScheduleCronFromVariables(
        "0 */{{local.variables.hours}} * * *",
        { hours: "6" },
        {},
      );

    expect(result.error).toBeNull();
    expect(result.cron).toBe("0 */6 * * *");
  });

  test("prefers the local variable when a name exists in both scopes", () => {
    const result: { cron: string; error: string | null } =
      QueueWorkflow.buildScheduleCronFromVariables(
        "{{local.variables.schedule}}",
        { schedule: "0 0 * * *" },
        { schedule: "* * * * *" },
      );

    expect(result.error).toBeNull();
    expect(result.cron).toBe("0 0 * * *");
  });

  test("returns an error when the referenced variable does not exist", () => {
    const result: { cron: string; error: string | null } =
      QueueWorkflow.buildScheduleCronFromVariables(
        "{{local.variables.missing}}",
        {},
        {},
      );

    expect(result.error).not.toBeNull();
    expect(result.error).toContain("could not be resolved");
  });

  test("returns an error when a variable resolves to an invalid cron", () => {
    const result: { cron: string; error: string | null } =
      QueueWorkflow.buildScheduleCronFromVariables(
        "{{local.variables.schedule}}",
        { schedule: "99 99 99 99 99" },
        {},
      );

    expect(result.error).not.toBeNull();
  });

  test("returns an error for an invalid plain cron expression", () => {
    const result: { cron: string; error: string | null } =
      QueueWorkflow.buildScheduleCronFromVariables("60 * * * *", {}, {});

    expect(result.error).not.toBeNull();
  });
});
