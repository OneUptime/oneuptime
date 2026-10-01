import RemediationExecutionRunner from "../../../../Server/Utils/AI/Remediation/RemediationExecutionRunner";
import ProjectService from "../../../../Server/Services/ProjectService";
import Project from "../../../../Models/DatabaseModels/Project";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the project switch a remediation round must still
 * pass when it runs (RemediationExecutionRunner.checkProjectGates):
 *
 * - Enable AI is the project's only AI switch and the kill switch for every
 *   round, rule, cluster and resource alike. It reads as "off" only when
 *   === false: the column is NOT NULL DEFAULT true, so undefined means "not
 *   selected", never "off";
 * - the project is read as root, by id, with Enable AI alone. The retired
 *   "Enable auto-remediation" kill switch and "Enable AI command execution"
 *   opt-in are never asked for, and a stale value of either on a row
 *   changes nothing in either direction;
 * - a project row that is gone fails closed, with the same refusal;
 * - the refusal sends people to the always-visible Project Settings → AI
 *   Features page, never to AI Credits (billing-only), says nothing ran,
 *   and never names a retired switch.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const AI_DISABLED_MESSAGE: string =
  "AI was disabled for this project before the run started (Project Settings → AI Features) — nothing was run or proposed.";

function mockProject(
  project: Record<string, unknown> | null,
): jest.SpyInstance {
  return jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue(project as unknown as Project);
}

function aiOn(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: PROJECT_ID,
    enableAi: true,
    ...overrides,
  };
}

async function gates(): Promise<string | null> {
  return RemediationExecutionRunner.checkProjectGates({
    projectId: PROJECT_ID,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("RemediationExecutionRunner.checkProjectGates", () => {
  it("reads the project as root, by id, with Enable AI alone", async () => {
    const find: jest.SpyInstance = mockProject(aiOn());

    await gates();

    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith({
      id: PROJECT_ID,
      select: {
        enableAi: true,
      },
      props: { isRoot: true },
    });
  });

  it("never asks for a retired switch", async () => {
    const find: jest.SpyInstance = mockProject(aiOn());

    await gates();

    const select: Record<string, unknown> = (
      find.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;
    expect(Object.keys(select)).toEqual(["enableAi"]);
    expect(select).not.toHaveProperty("enableAutoRemediation");
    expect(select).not.toHaveProperty("enableAiCommandExecution");
  });

  describe("Enable AI off stops the round", () => {
    it("when Enable AI is explicitly off", async () => {
      mockProject(aiOn({ enableAi: false }));

      expect(await gates()).toBe(AI_DISABLED_MESSAGE);
    });

    it("when the project row is gone — a project it cannot read is not one it may act in", async () => {
      mockProject(null);

      expect(await gates()).toBe(AI_DISABLED_MESSAGE);
    });
  });

  describe("Enable AI on lets the round through with nothing else from the project", () => {
    it.each([
      ["explicitly on", true],
      ["not selected (undefined)", undefined],
      ["null", null],
    ])(
      "passes when Enable AI is %s — it is off only when explicitly false",
      async (_label: string, value: boolean | null | undefined) => {
        mockProject(aiOn({ enableAi: value }));

        expect(await gates()).toBeNull();
      },
    );
  });

  describe("the retired switches mean nothing", () => {
    it.each([
      ["auto-remediation switched off", { enableAutoRemediation: false }],
      [
        "AI command execution explicitly off",
        { enableAiCommandExecution: false },
      ],
      [
        "AI command execution never opted into",
        { enableAiCommandExecution: undefined },
      ],
      [
        "both off",
        { enableAutoRemediation: false, enableAiCommandExecution: false },
      ],
    ])(
      "a stale %s on a row with Enable AI on changes nothing",
      async (_label: string, stale: Record<string, unknown>) => {
        mockProject(aiOn(stale));

        expect(await gates()).toBeNull();
      },
    );

    it("and neither can keep a round going once Enable AI is off", async () => {
      mockProject(
        aiOn({
          enableAi: false,
          enableAutoRemediation: true,
          enableAiCommandExecution: true,
        }),
      );

      expect(await gates()).toBe(AI_DISABLED_MESSAGE);
    });
  });

  describe("the refusal", () => {
    it("names Project Settings → AI Features, the page every install shows, and says nothing ran", async () => {
      mockProject(aiOn({ enableAi: false }));

      const failure: string = (await gates()) || "";

      expect(failure).toContain("(Project Settings → AI Features)");
      expect(failure).toContain("nothing was run or proposed");
      expect(failure).not.toContain("AI Credits");
      expect(failure).not.toMatch(/Project Settings → AI\)/);
    });

    it("never names a retired switch", async () => {
      mockProject(aiOn({ enableAi: false }));

      const failure: string = (await gates()) || "";

      expect(failure).not.toMatch(/auto-remediation/i);
      expect(failure).not.toMatch(/command execution/i);
    });
  });
});
