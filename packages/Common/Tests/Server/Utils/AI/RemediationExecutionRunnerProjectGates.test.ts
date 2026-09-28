import RemediationExecutionRunner, {
  isClusterRemediationRound,
} from "../../../../Server/Utils/AI/Remediation/RemediationExecutionRunner";
import ProjectService from "../../../../Server/Services/ProjectService";
import Project from "../../../../Models/DatabaseModels/Project";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — which project switches a remediation round must
 * still pass when it runs (RemediationExecutionRunner.checkProjectGates),
 * and which rounds count as cluster rounds (isClusterRemediationRound):
 *
 * - Enable AI and Enable auto-remediation are kill switches for EVERY
 *   round, cluster or rule (read as "off only when === false");
 * - the project's "Enable AI command execution" opt-in (=== true) gates
 *   rule rounds only. A cluster round's consent is the cluster's own Fixes
 *   mode (and the chart's write RBAC on the in-cluster agent); a cluster
 *   reached through an advanced Runner is held back by its status gap, not
 *   here;
 * - a cluster round is a suggestion that names a cluster and NO rule — a
 *   row naming a rule is a rule round whatever else it carries, so the
 *   exemption can never be reached from the rule lane;
 * - the refusals send people to the always-visible Project Settings → AI
 *   Features page, never to AI Credits (billing-only).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const RULE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

const KILL_SWITCH_MESSAGE: string =
  "AI or auto-remediation was disabled for this project before the run started";
const OPT_IN_MESSAGE: string =
  "AI command execution is not enabled for this project";

function mockProject(
  project: Record<string, unknown> | null,
): jest.SpyInstance {
  return jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue(project as unknown as Project);
}

function allOn(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: PROJECT_ID,
    enableAi: true,
    enableAutoRemediation: true,
    enableAiCommandExecution: true,
    ...overrides,
  };
}

async function gates(isClusterRound: boolean): Promise<string | null> {
  return RemediationExecutionRunner.checkProjectGates({
    projectId: PROJECT_ID,
    isClusterRound,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("isClusterRemediationRound", () => {
  it("is a cluster round when the suggestion names a cluster and no rule", () => {
    expect(
      isClusterRemediationRound({
        kubernetesClusterId: CLUSTER_ID,
        autoRemediationRuleId: undefined,
      }),
    ).toBe(true);
  });

  it("is a rule round when the suggestion names a rule and no cluster", () => {
    expect(
      isClusterRemediationRound({
        kubernetesClusterId: undefined,
        autoRemediationRuleId: RULE_ID,
      }),
    ).toBe(false);
  });

  it("is a rule round when the suggestion names BOTH — a rule id always wins, so the exemption fails closed", () => {
    expect(
      isClusterRemediationRound({
        kubernetesClusterId: CLUSTER_ID,
        autoRemediationRuleId: RULE_ID,
      }),
    ).toBe(false);
  });

  it("is not a cluster round when the suggestion names neither (a deleted cluster, or a deleted rule)", () => {
    expect(isClusterRemediationRound({})).toBe(false);
    expect(
      isClusterRemediationRound({
        kubernetesClusterId: undefined,
        autoRemediationRuleId: undefined,
      }),
    ).toBe(false);
  });
});

describe("RemediationExecutionRunner.checkProjectGates", () => {
  it("reads the project as root, by id, with exactly the three switches", async () => {
    const find: jest.SpyInstance = mockProject(allOn());

    await gates(false);

    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith({
      id: PROJECT_ID,
      select: {
        enableAi: true,
        enableAutoRemediation: true,
        enableAiCommandExecution: true,
      },
      props: { isRoot: true },
    });
  });

  describe.each([
    ["a rule round", false],
    ["a cluster round", true],
  ])("the kill switches stop %s", (_label: string, isClusterRound: boolean) => {
    it("when the project row is gone", async () => {
      mockProject(null);

      expect(await gates(isClusterRound)).toContain(KILL_SWITCH_MESSAGE);
    });

    it("when Enable AI is off", async () => {
      mockProject(allOn({ enableAi: false }));

      expect(await gates(isClusterRound)).toContain(KILL_SWITCH_MESSAGE);
    });

    it("when Enable auto-remediation is off", async () => {
      mockProject(allOn({ enableAutoRemediation: false }));

      expect(await gates(isClusterRound)).toContain(KILL_SWITCH_MESSAGE);
    });

    it("but not when the kill switches were never set — they are on unless explicitly false", async () => {
      mockProject({
        id: PROJECT_ID,
        enableAi: undefined,
        enableAutoRemediation: null,
        enableAiCommandExecution: true,
      });

      expect(await gates(isClusterRound)).toBeNull();
    });

    it("and a kill switch wins over the opt-in: the message names the kill switch, not command execution", async () => {
      mockProject(allOn({ enableAi: false, enableAiCommandExecution: false }));

      const failure: string | null = await gates(isClusterRound);

      expect(failure).toContain(KILL_SWITCH_MESSAGE);
      expect(failure).not.toContain(OPT_IN_MESSAGE);
    });
  });

  describe("a rule round needs the AI command execution opt-in", () => {
    it.each([
      ["false", false],
      ["never set (undefined)", undefined],
      ["null", null],
    ])(
      "is refused when the opt-in is %s — only an explicit true opts in",
      async (_label: string, value: boolean | null | undefined) => {
        mockProject(allOn({ enableAiCommandExecution: value }));

        expect(await gates(false)).toContain(OPT_IN_MESSAGE);
      },
    );

    it("passes when the opt-in is explicitly true", async () => {
      mockProject(allOn());

      expect(await gates(false)).toBeNull();
    });
  });

  describe("a cluster round does not need the AI command execution opt-in", () => {
    it.each([
      ["false", false],
      ["never set (undefined)", undefined],
      ["null", null],
      ["true", true],
    ])(
      "passes when the opt-in is %s",
      async (_label: string, value: boolean | null | undefined) => {
        mockProject(allOn({ enableAiCommandExecution: value }));

        expect(await gates(true)).toBeNull();
      },
    );
  });

  describe("the refusals point at the page that owns the switches", () => {
    it.each([
      ["a kill switch", allOn({ enableAi: false }), true],
      [
        "a kill switch (rule round)",
        allOn({ enableAutoRemediation: false }),
        false,
      ],
      [
        "the command execution opt-in",
        allOn({ enableAiCommandExecution: false }),
        false,
      ],
    ])(
      "%s names Project Settings → AI Features and says nothing ran",
      async (
        _label: string,
        project: Record<string, unknown>,
        isClusterRound: boolean,
      ) => {
        mockProject(project);

        const failure: string = (await gates(isClusterRound)) || "";

        expect(failure).toContain("Project Settings → AI Features");
        expect(failure).not.toContain("AI Credits");
        expect(failure).not.toMatch(/Project Settings → AI\)/);
        expect(failure).toContain("nothing was run or proposed");
      },
    );
  });
});
