import RemediationCodeRepositories from "../../../../Server/Utils/AI/Remediation/RemediationCodeRepositories";
import AutoRemediationRuleService from "../../../../Server/Services/AutoRemediationRuleService";
import logger from "../../../../Server/Utils/Logger";
import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import {
  CodeRepositoryAllowance,
  EVERY_CODE_REPOSITORY,
  NO_CODE_REPOSITORY,
} from "../../../../Types/CodeRepository/CodeRepositoryAllowance";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import fs from "fs";
import path from "path";

/*
 * The code repositories a fix run may read: "The remediation should also
 * take into the context of code repos if any" - the maintainer. The ones
 * the run's auto remediation rule names, or every connected repository when
 * it names none. A run no rule started reads every one, as before; a rule
 * that cannot be read leaves the run reading none.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RULE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CHECKOUT_REPO: string = "c1111111-1111-4111-8111-111111111111";
const BILLING_REPO: string = "c2222222-2222-4222-8222-222222222222";

function repository(id: string): CodeRepository {
  const model: CodeRepository = new CodeRepository();
  model._id = id;
  return model;
}

function mockRule(
  rule: Partial<AutoRemediationRule> | null | Error,
): SpyInstance<typeof AutoRemediationRuleService.findOneBy> {
  return jest
    .spyOn(AutoRemediationRuleService, "findOneBy")
    .mockImplementation(async () => {
      if (rule instanceof Error) {
        throw rule;
      }

      return rule
        ? Object.assign(new AutoRemediationRule(), {
            _id: RULE_ID.toString(),
            ...rule,
          })
        : null;
    });
}

async function forRule(): Promise<CodeRepositoryAllowance> {
  return await RemediationCodeRepositories.forRule({
    projectId: PROJECT_ID,
    autoRemediationRuleId: RULE_ID,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("RemediationCodeRepositories.forRule", () => {
  test("a run no rule started reads every connected repository, and reads no rule", async () => {
    const findOneBy: SpyInstance<typeof AutoRemediationRuleService.findOneBy> =
      mockRule({});

    for (const autoRemediationRuleId of [undefined, null]) {
      expect(
        await RemediationCodeRepositories.forRule({
          projectId: PROJECT_ID,
          autoRemediationRuleId,
        }),
      ).toEqual(EVERY_CODE_REPOSITORY);
    }

    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("reads the run's rule in the run's project, as root, with the repositories it names", async () => {
    const findOneBy: SpyInstance<typeof AutoRemediationRuleService.findOneBy> =
      mockRule({});

    await forRule();

    expect(findOneBy.mock.calls[0]![0]).toMatchObject({
      query: { _id: RULE_ID, projectId: PROJECT_ID },
      select: { codeRepositories: { _id: true } },
      props: { isRoot: true },
    });
  });

  test("a rule that names none: every connected repository", async () => {
    mockRule({});
    expect(await forRule()).toEqual(EVERY_CODE_REPOSITORY);

    jest.restoreAllMocks();
    mockRule({ codeRepositories: [] });
    expect(await forRule()).toEqual(EVERY_CODE_REPOSITORY);
  });

  test("a rule that names some: those, and only those", async () => {
    mockRule({
      codeRepositories: [
        repository(CHECKOUT_REPO),
        repository(BILLING_REPO.toUpperCase()),
      ],
    });

    expect(await forRule()).toEqual({
      isEveryRepository: false,
      repositoryIds: [CHECKOUT_REPO, BILLING_REPO],
    });
  });

  test("a rule that is gone, or cannot be read, leaves the run reading none", async () => {
    mockRule(null);
    expect(await forRule()).toEqual(NO_CODE_REPOSITORY);

    jest.restoreAllMocks();
    const error: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });
    mockRule(new Error("database is down"));
    expect(await forRule()).toEqual(NO_CODE_REPOSITORY);
    expect(String(error.mock.calls[0]![0])).toContain(
      `could not read which code repositories AI rule ${RULE_ID.toString()} allows`,
    );
  });
});

/*
 * Every AI run for an incident or an alert is held to the repositories its
 * rules name: each runner that starts one on the investigation engine works
 * the allowance out first and passes it on. AI Insights' triage has no rule
 * of its own, so it reads every repository.
 */
describe("every incident and alert AI run is held to its rules' repositories", () => {
  const AI_DIRECTORY: string = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "Server",
    "Utils",
    "AI",
  );

  function read(...parts: Array<string>): string {
    return fs.readFileSync(path.join(AI_DIRECTORY, ...parts), "utf8");
  }

  // The allowance is worked out for the rule the run's suggestion names.
  const FOR_THE_RUNS_RULE: RegExp =
    /RemediationCodeRepositories\.forRule\(\{\s+projectId,\s+autoRemediationRuleId: suggestion!?\.autoRemediationRuleId,\s+\}\)/;

  // The source of the engine call: from executeRun( to its closing "});".
  function engineCall(source: string): string {
    const start: number = source.indexOf("AIInvestigationEngine.executeRun(");

    expect(start).toBeGreaterThan(-1);

    return source.slice(start, source.indexOf("\n    });", start));
  }

  test.each([
    ["Remediation", "RemediationExecutionRunner.ts"],
    ["Remediation", "RemediationPlanRunner.ts"],
    ["Remediation", "McpRemediationRunner.ts"],
  ])(
    "%s/%s works out the run's rule's repositories and passes them to the run",
    (directory: string, file: string) => {
      const source: string = read(directory, file);

      expect(source).toContain("await RemediationCodeRepositories.forRule({\n");
      expect(source).toMatch(FOR_THE_RUNS_RULE);
      expect(engineCall(source)).toContain("codeRepositoryAllowance,");
    },
  );

  test.each([
    ["IncidentInvestigationRunner.ts", "forIncident"],
    ["AlertInvestigationRunner.ts", "forAlert"],
  ])(
    "SRE/%s works out the repositories the AI rules that investigate allow, and passes them to the run",
    (file: string, reader: string) => {
      const source: string = read("SRE", file);

      expect(source).toContain(
        `await InvestigationCodeRepositories.${reader}({`,
      );
      expect(engineCall(source)).toContain("codeRepositoryAllowance,");
    },
  );

  test("the engine hands the allowance to the code tools, and the tools hold every read to it", () => {
    expect(read("SRE", "AIInvestigationEngine.ts")).toContain(
      "codeRepositoryAllowance: request.codeRepositoryAllowance",
    );
    expect(read("Chat", "ObservabilityAssistant.ts")).toContain(
      "codeRepositoryAllowance: request.codeRepositoryAllowance",
    );
    expect(read("Toolbox", "CodeTools.ts")).toContain(
      "allowance: ctx.codeRepositoryAllowance,",
    );
  });
});
