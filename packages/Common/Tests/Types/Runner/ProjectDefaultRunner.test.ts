import {
  ProjectDefaultRunnerCandidate,
  ProjectDefaultRunnerRefusal,
  canBeProjectDefaultRunner,
  describeDefaultRunnerStopsRunningRunbooks,
  describeProjectDefaultRunnerRefusal,
  getProjectDefaultRunnerRefusal,
  isKubernetesAgentRunnerCandidate,
} from "../../../Types/Runner/ProjectDefaultRunner";
import { describe, expect, test } from "@jest/globals";

/*
 * WHICH OF A PROJECT'S RUNNERS MAY BE ITS DEFAULT.
 *
 * The project's default Runner runs the runbook steps that pick no Runner
 * of their own, so only a Runner that can run them may be it: never a
 * global Runner (no project owns it), never the in-cluster Runner the
 * Kubernetes agent chart installed (kubectl for its own cluster only), and
 * never one with "Runs Runbooks" off. The server refuses a write that makes
 * one of those the default, and reads a stored default through the same
 * rule; the Dashboard offers "Set as Project Default" only where it holds.
 */

const ORDINARY: ProjectDefaultRunnerCandidate = {
  name: "prod-eu-west-1",
  isGlobalRunner: false,
  canRunRunbooks: true,
  hostInfo: { hostname: "runner-1", platform: "linux" },
};

describe("a Runner of the project's own that runs runbooks", () => {
  test("may be the project's default", () => {
    expect(getProjectDefaultRunnerRefusal(ORDINARY)).toBeNull();
    expect(canBeProjectDefaultRunner(ORDINARY)).toBe(true);
  });

  test("whose capabilities were never read reads as running runbooks, as the column's default does", () => {
    expect(canBeProjectDefaultRunner({ name: "fresh" })).toBe(true);
    expect(
      canBeProjectDefaultRunner({ name: "fresh", canRunRunbooks: null }),
    ).toBe(true);
  });

  test("an in-cluster posture that names no cluster is not the agent chart's Runner", () => {
    expect(
      canBeProjectDefaultRunner({
        ...ORDINARY,
        hostInfo: { kubernetes: { inCluster: true, clusterIdentifier: "  " } },
      }),
    ).toBe(true);
  });
});

describe("a Runner that may not be the default", () => {
  test("a global Runner belongs to no project", () => {
    const runner: ProjectDefaultRunnerCandidate = {
      ...ORDINARY,
      isGlobalRunner: true,
    };

    expect(getProjectDefaultRunnerRefusal(runner)).toBe(
      ProjectDefaultRunnerRefusal.GlobalRunner,
    );
    expect(canBeProjectDefaultRunner(runner)).toBe(false);
  });

  test.each([
    ["by name", "kubernetes-agent/prod-us", null],
    ["by name, any case, padded", "  Kubernetes-Agent/prod-eu ", null],
    [
      "by posture",
      "renamed-in-cluster-runner",
      { kubernetes: { inCluster: true, clusterIdentifier: "prod-ap" } },
    ],
  ])(
    "the in-cluster Runner the Kubernetes agent chart installed (%s)",
    (_label: string, name: string, hostInfo: unknown) => {
      const runner: ProjectDefaultRunnerCandidate = {
        ...ORDINARY,
        name,
        hostInfo,
      };

      expect(isKubernetesAgentRunnerCandidate(runner)).toBe(true);
      expect(getProjectDefaultRunnerRefusal(runner)).toBe(
        ProjectDefaultRunnerRefusal.KubernetesAgentRunner,
      );
    },
  );

  test("one with Runs Runbooks off would take no step", () => {
    expect(
      getProjectDefaultRunnerRefusal({ ...ORDINARY, canRunRunbooks: false }),
    ).toBe(ProjectDefaultRunnerRefusal.DoesNotRunRunbooks);
  });

  test("a global Runner is refused as one first, whatever else it is", () => {
    expect(
      getProjectDefaultRunnerRefusal({
        name: "kubernetes-agent/prod-us",
        isGlobalRunner: true,
        canRunRunbooks: false,
      }),
    ).toBe(ProjectDefaultRunnerRefusal.GlobalRunner);
  });

  test("the agent chart's Runner is refused as one before its switch is read", () => {
    expect(
      getProjectDefaultRunnerRefusal({
        name: "kubernetes-agent/prod-us",
        canRunRunbooks: false,
      }),
    ).toBe(ProjectDefaultRunnerRefusal.KubernetesAgentRunner);
  });
});

describe("the refusals' words", () => {
  test("name the Runner, quoted, and say why", () => {
    expect(
      describeProjectDefaultRunnerRefusal({
        refusal: ProjectDefaultRunnerRefusal.DoesNotRunRunbooks,
        name: "office-runner",
      }),
    ).toBe(
      '"office-runner" does not run runbooks, so it cannot be the project\'s default Runner. Turn on Runs Runbooks for it first.',
    );

    expect(
      describeProjectDefaultRunnerRefusal({
        refusal: ProjectDefaultRunnerRefusal.KubernetesAgentRunner,
        name: "kubernetes-agent/prod-us",
      }),
    ).toBe(
      '"kubernetes-agent/prod-us" is the in-cluster Runner the Kubernetes agent chart installed. It runs kubectl for its own cluster only, so it cannot be the project\'s default Runner.',
    );

    expect(
      describeProjectDefaultRunnerRefusal({
        refusal: ProjectDefaultRunnerRefusal.GlobalRunner,
        name: "Global Runner",
      }),
    ).toContain("Runbooks → Runners");
  });

  test.each(Object.values(ProjectDefaultRunnerRefusal))(
    "%s reads without a name too",
    (refusal: ProjectDefaultRunnerRefusal) => {
      expect(
        describeProjectDefaultRunnerRefusal({ refusal }).startsWith(
          "This Runner ",
        ),
      ).toBe(true);
    },
  );

  test("turning Runs Runbooks off for the default says what to do first", () => {
    expect(describeDefaultRunnerStopsRunningRunbooks("prod-eu-west-1")).toBe(
      '"prod-eu-west-1" is the project\'s default Runner: the runbook steps that pick no Runner run on it, so Runs Runbooks stays on. Make another Runner the default, or stop using this one as the default, first.',
    );
    expect(
      describeDefaultRunnerStopsRunningRunbooks(undefined).startsWith(
        "This Runner is the project's default Runner",
      ),
    ).toBe(true);
  });
});
